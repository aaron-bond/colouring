import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Rect, TileHistory, canvasSurface } from '../engine/history';
import { Point, Size, View, fitScale, fitView, panBy, pinchView, toDoc, zoomAt } from '../engine/viewport';

// THROWAWAY SPIKE (TECHNICAL-DESIGN.md section 11). Answers, on the
// OnePlus Pad 3: is "document-sized canvases + SVG overlay under one CSS
// transform" smooth enough to draw, pinch and pan on, and what do memory,
// undo and PNG encoding cost? Deliberately one file with inline input
// handling: the lessons feed engine/input.ts and engine/brushes, and this
// page is then deleted. Only engine/viewport.ts and engine/history.ts are
// real code.

type Tool = 'pencil' | 'eraser';
type Mode = 'idle' | 'stroke' | 'pinch' | 'pan';

interface TrackedPointer {
  type: string;
  stage: Point;
}

interface Hud {
  pointer: string;
  pressure: string;
  inputHz: string;
  coalesced: string;
  drawMs: string;
  frameMs: string;
  frameMax: string;
  commitMs: string;
  zoom: string;
  undo: string;
  encode: string;
  heap: string;
  stress: string;
}

// Brush diameters as fractions of the document's long side, so the 5
// presets feel the same at every document size (TECHNICAL-DESIGN.md 7).
const SIZE_FRACTIONS = [0.002, 0.004, 0.007, 0.012, 0.02];
const PENCIL_OPACITY = 0.85;
const UNDO_BUDGET_BYTES = 150 * 1024 * 1024;
const COLOURS = ['#3A2E22', '#F06595', '#FCC419', '#20C997', '#339AF0', '#7950F2'];

@Component({
  selector: 'app-spike',
  imports: [RouterLink],
  templateUrl: './spike.html',
  styleUrl: './spike.css',
})
export class Spike {
  private readonly stageRef = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly pageRef = viewChild.required<ElementRef<HTMLDivElement>>('page');
  private readonly colourRef = viewChild.required<ElementRef<HTMLCanvasElement>>('colourCanvas');
  private readonly wetRef = viewChild.required<ElementRef<HTMLCanvasElement>>('wetCanvas');

  protected readonly docSizes = [2048, 3072, 4096];
  protected readonly docSize = signal(3072);
  protected readonly tool = signal<Tool>('pencil');
  protected readonly sizeIndex = signal(2);
  protected readonly colours = COLOURS;
  protected readonly colour = signal(COLOURS[1]);
  protected readonly penMode = signal(false);
  protected readonly fingerDraws = signal(false);
  protected readonly willChange = signal(false);
  protected readonly panelOpen = signal(true);
  protected readonly hud = signal<Hud | null>(null);
  protected readonly pencilOpacity = PENCIL_OPACITY;

  private colourCtx!: CanvasRenderingContext2D;
  private wetCtx!: CanvasRenderingContext2D;
  private history!: TileHistory<ImageData>;
  private doc: Size = { width: 3072, height: 3072 };
  private stage: Size = { width: 1, height: 1 };
  private view: View = { scale: 1, tx: 0, ty: 0 };
  private viewDirty = false;

  // Input state.
  private readonly pointers = new Map<number, TrackedPointer>();
  private mode: Mode = 'idle';
  private strokeId = -1;
  private strokeTool: Tool = 'pencil';
  private lastDoc: Point = { x: 0, y: 0 };
  private carry = 0; // distance travelled since the last dab
  private bbox: Rect | null = null;
  private pinchIds: [number, number] = [-1, -1];
  private pinchStart: { view: View; a: Point; b: Point } | null = null;
  private panLast: Point | null = null;
  private spaceHeld = false;

  // Measurements.
  private stats = {
    pointer: '-',
    pressure: 0,
    samples: 0,
    events: 0,
    strokeStart: 0,
    strokeEnd: 0,
    drawTotal: 0,
    commitMs: 0,
    frames: [] as number[],
    encode: '-',
    stress: '-',
  };
  private worker?: Worker;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.setUpDocument(this.docSize());
      const stageEl = this.stageRef().nativeElement;
      const resize = new ResizeObserver(() => this.measureStage(true));
      resize.observe(stageEl);
      this.measureStage(true);

      // Safari pinch-zoom of the whole page; harmless elsewhere.
      const blockGesture = (e: Event) => e.preventDefault();
      document.addEventListener('gesturestart', blockGesture);
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Space') this.spaceHeld = e.type === 'keydown';
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);

      let raf = 0;
      let last = performance.now();
      const frame = (now: number) => {
        this.stats.frames.push(now - last);
        if (this.stats.frames.length > 120) this.stats.frames.shift();
        last = now;
        if (this.viewDirty) this.applyView();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      const hudTimer = setInterval(() => this.updateHud(), 250);

      destroyRef.onDestroy(() => {
        resize.disconnect();
        document.removeEventListener('gesturestart', blockGesture);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        cancelAnimationFrame(raf);
        clearInterval(hudTimer);
        this.worker?.terminate();
      });
    });
  }

  // ---- Document & view -------------------------------------------------

  private setUpDocument(longSide: number): void {
    this.doc = { width: longSide, height: longSide };
    for (const ref of [this.colourRef(), this.wetRef()]) {
      const canvas = ref.nativeElement;
      canvas.width = longSide;
      canvas.height = longSide;
      canvas.style.width = `${longSide}px`;
      canvas.style.height = `${longSide}px`;
    }
    this.colourCtx = this.colourRef().nativeElement.getContext('2d')!;
    this.wetCtx = this.wetRef().nativeElement.getContext('2d')!;
    this.history = new TileHistory(canvasSurface(this.colourCtx), UNDO_BUDGET_BYTES);
    const page = this.pageRef().nativeElement;
    page.style.width = `${longSide}px`;
    page.style.height = `${longSide}px`;
    this.fit();
  }

  private measureStage(refit: boolean): void {
    const rect = this.stageRef().nativeElement.getBoundingClientRect();
    if (rect.width === 0) return;
    this.stage = { width: rect.width, height: rect.height };
    if (refit) this.fit();
  }

  protected fit(): void {
    this.view = fitView(this.doc, this.stage);
    this.viewDirty = true;
  }

  private applyView(): void {
    const { scale, tx, ty } = this.view;
    this.pageRef().nativeElement.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    this.viewDirty = false;
  }

  private stagePoint(e: PointerEvent | WheelEvent): Point {
    const rect = this.stageRef().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---- Input -------------------------------------------------------------

  onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    try {
      this.stageRef().nativeElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no real pointer to capture.
    }
    const p = this.stagePoint(e);
    this.pointers.set(e.pointerId, { type: e.pointerType, stage: p });
    this.stats.pointer = e.pointerType;

    if (e.pointerType === 'pen') {
      this.penMode.set(true);
      if (this.mode === 'pinch' || this.mode === 'pan') this.mode = 'idle';
      if (this.mode === 'idle') this.startStroke(e);
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
        this.mode = 'pan';
        this.panLast = p;
      } else if (e.button === 0 && this.mode === 'idle') {
        this.startStroke(e);
      }
      return;
    }

    // Touch.
    const touches = [...this.pointers.entries()].filter(([, t]) => t.type === 'touch');
    const fingersDraw = !this.penMode() || this.fingerDraws();
    if (touches.length === 2) {
      // A second finger: whatever the first was doing, this is a pinch. A
      // stroke the first finger started is discarded, never committed.
      if (this.mode === 'stroke' && this.pointers.get(this.strokeId)?.type === 'touch') this.cancelStroke();
      if (this.mode !== 'stroke') this.startPinch(touches[0][0], touches[1][0]);
    } else if (touches.length === 1 && this.mode === 'idle') {
      if (fingersDraw) {
        this.startStroke(e);
      } else {
        this.mode = 'pan';
        this.panLast = p;
      }
    }
  }

  onPointerMove(e: PointerEvent): void {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) return;
    e.preventDefault();
    const p = this.stagePoint(e);
    tracked.stage = p;

    if (this.mode === 'stroke' && e.pointerId === this.strokeId) {
      const t0 = performance.now();
      const samples = e.getCoalescedEvents?.() ?? [];
      const list = samples.length > 0 ? samples : [e];
      for (const s of list) this.addPoint(this.stagePoint(s), this.pressureOf(s));
      this.stats.samples += list.length;
      this.stats.events++;
      this.stats.drawTotal += performance.now() - t0;
    } else if (this.mode === 'pinch' && this.pinchStart) {
      const a = this.pointers.get(this.pinchIds[0]);
      const b = this.pointers.get(this.pinchIds[1]);
      if (!a || !b) return;
      const s = this.pinchStart;
      this.view = pinchView(s.view, s.a, s.b, a.stage, b.stage, this.doc, this.stage);
      this.viewDirty = true;
    } else if (this.mode === 'pan' && this.panLast) {
      this.view = panBy(this.view, p.x - this.panLast.x, p.y - this.panLast.y, this.doc, this.stage);
      this.panLast = p;
      this.viewDirty = true;
    }
  }

  onPointerUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    if (this.mode === 'stroke' && e.pointerId === this.strokeId) {
      if (e.type === 'pointercancel') this.cancelStroke();
      else this.endStroke();
    }
    this.pointers.delete(e.pointerId);
    if (this.mode === 'pinch' && this.pinchIds.includes(e.pointerId)) {
      // The finger left behind after a pinch pans until lifted. It must
      // never turn into a stroke, even when fingers are allowed to draw.
      const rest = [...this.pointers.values()].find((t) => t.type === 'touch');
      this.mode = rest ? 'pan' : 'idle';
      this.panLast = rest ? rest.stage : null;
      this.pinchStart = null;
    }
    if (this.pointers.size === 0) {
      this.mode = 'idle';
      this.panLast = null;
    }
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Trackpad pinch arrives as ctrl+wheel; plain wheel zooms too.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.view = zoomAt(this.view, factor, this.stagePoint(e), this.doc, this.stage);
    this.viewDirty = true;
  }

  private startPinch(idA: number, idB: number): void {
    const a = this.pointers.get(idA)!.stage;
    const b = this.pointers.get(idB)!.stage;
    this.mode = 'pinch';
    this.pinchIds = [idA, idB];
    this.pinchStart = { view: { ...this.view }, a: { ...a }, b: { ...b } };
  }

  private pressureOf(e: PointerEvent): number {
    // Mouse and touch have no meaningful pressure: use a fixed middle.
    return e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 0.6;
  }

  // ---- Strokes -------------------------------------------------------------

  private radius(pressure: number): number {
    const diameter = SIZE_FRACTIONS[this.sizeIndex()] * this.doc.width;
    const scale = this.strokeTool === 'eraser' ? 2 : 0.35 + 0.65 * pressure;
    return Math.max(0.75, (diameter / 2) * scale);
  }

  private startStroke(e: PointerEvent): void {
    this.mode = 'stroke';
    this.strokeId = e.pointerId;
    this.strokeTool = this.tool();
    this.stats.samples = 0;
    this.stats.events = 0;
    this.stats.drawTotal = 0;
    this.stats.strokeStart = performance.now();
    this.carry = 0;
    this.bbox = null;
    const doc = toDoc(this.view, this.stagePoint(e));
    this.lastDoc = doc;
    if (this.strokeTool === 'eraser') this.history.begin();
    const pressure = this.pressureOf(e);
    this.stats.pressure = pressure;
    this.dab([doc], [pressure]);
  }

  private addPoint(stage: Point, pressure: number): void {
    this.stats.pressure = pressure;
    const to = toDoc(this.view, stage);
    const from = this.lastDoc;
    const r = this.radius(pressure);
    const spacing = Math.max(0.5, r * 0.3);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const points: Point[] = [];
    const pressures: number[] = [];
    let d = spacing - this.carry;
    while (d <= dist) {
      const t = d / dist;
      points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      pressures.push(pressure);
      d += spacing;
    }
    this.carry = dist - (d - spacing);
    if (points.length) this.dab(points, pressures);
    this.lastDoc = to;
  }

  private dab(points: Point[], pressures: number[]): void {
    const eraser = this.strokeTool === 'eraser';
    const ctx = eraser ? this.colourCtx : this.wetCtx;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    ctx.beginPath();
    points.forEach((p, i) => {
      const r = this.radius(pressures[i]);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      minX = Math.min(minX, p.x - r);
      minY = Math.min(minY, p.y - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    });
    const rect = this.clampRect({
      x: Math.floor(minX) - 1,
      y: Math.floor(minY) - 1,
      width: Math.ceil(maxX - minX) + 3,
      height: Math.ceil(maxY - minY) + 3,
    });
    if (eraser) {
      // The eraser changes the colour layer directly: snapshot first.
      this.history.touch(rect);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.fillStyle = this.colour();
      ctx.fill();
    }
    this.bbox = this.bbox ? union(this.bbox, rect) : rect;
  }

  private endStroke(): void {
    const t0 = performance.now();
    if (this.strokeTool === 'eraser') {
      this.history.commit();
    } else if (this.bbox) {
      const b = this.bbox;
      this.history.begin();
      this.history.touch(b);
      this.colourCtx.globalAlpha = PENCIL_OPACITY;
      this.colourCtx.drawImage(this.wetRef().nativeElement, b.x, b.y, b.width, b.height, b.x, b.y, b.width, b.height);
      this.colourCtx.globalAlpha = 1;
      this.wetCtx.clearRect(b.x, b.y, b.width, b.height);
      this.history.commit();
    }
    this.stats.commitMs = performance.now() - t0;
    this.stats.strokeEnd = performance.now();
    this.mode = 'idle';
    this.strokeId = -1;
    this.bbox = null;
  }

  private cancelStroke(): void {
    if (this.strokeTool === 'eraser') {
      // Already applied to the colour layer: commit, then undo it.
      this.history.commit();
      this.history.undo();
    } else if (this.bbox) {
      const b = this.bbox;
      this.wetCtx.clearRect(b.x, b.y, b.width, b.height);
    }
    this.mode = 'idle';
    this.strokeId = -1;
    this.bbox = null;
  }

  private clampRect(r: Rect): Rect {
    const x = Math.max(0, r.x);
    const y = Math.max(0, r.y);
    return {
      x,
      y,
      width: Math.max(1, Math.min(this.doc.width, r.x + r.width) - x),
      height: Math.max(1, Math.min(this.doc.height, r.y + r.height) - y),
    };
  }

  // ---- Toolbar actions ---------------------------------------------------

  protected undo(): void {
    this.history.undo();
  }

  protected redo(): void {
    this.history.redo();
  }

  protected clear(): void {
    this.history.begin();
    this.history.touch({ x: 0, y: 0, width: this.doc.width, height: this.doc.height });
    this.colourCtx.clearRect(0, 0, this.doc.width, this.doc.height);
    this.history.commit();
  }

  protected changeDocSize(value: string): void {
    this.docSize.set(Number(value));
    this.setUpDocument(this.docSize());
  }

  // Draws 50 long random strokes and commits each one, to fill the undo
  // stack and see whether the tab survives (memory headroom).
  protected stressTest(): void {
    const t0 = performance.now();
    const saved = { tool: this.strokeTool, size: this.sizeIndex() };
    this.strokeTool = 'pencil';
    this.sizeIndex.set(4);
    for (let i = 0; i < 50; i++) {
      this.carry = 0;
      this.bbox = null;
      let p = { x: Math.random() * this.doc.width, y: Math.random() * this.doc.height };
      this.lastDoc = p;
      const stagePoints: Point[] = [];
      for (let j = 0; j < 60; j++) {
        p = {
          x: Math.min(this.doc.width, Math.max(0, p.x + (Math.random() - 0.5) * this.doc.width * 0.15)),
          y: Math.min(this.doc.height, Math.max(0, p.y + (Math.random() - 0.5) * this.doc.height * 0.15)),
        };
        stagePoints.push({ x: p.x * this.view.scale + this.view.tx, y: p.y * this.view.scale + this.view.ty });
      }
      this.colour.set(COLOURS[i % COLOURS.length]);
      for (const sp of stagePoints) this.addPoint(sp, 0.5 + Math.random() * 0.5);
      this.endStroke();
    }
    this.strokeTool = saved.tool;
    this.sizeIndex.set(saved.size);
    this.stats.stress = `50 strokes in ${Math.round(performance.now() - t0)} ms`;
  }

  protected async encodePng(): Promise<void> {
    this.stats.encode = 'encoding…';
    const t0 = performance.now();
    const bitmap = await createImageBitmap(this.colourRef().nativeElement);
    const bitmapMs = performance.now() - t0;
    this.worker ??= new Worker(new URL('./encode.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<{ ms: number; bytes: number }>) => {
      this.stats.encode = `bitmap ${Math.round(bitmapMs)} ms (main) · PNG ${Math.round(data.ms)} ms (worker) · ${Math.round(data.bytes / 1024)} KB`;
    };
    this.worker.postMessage({ bitmap }, [bitmap]);
  }

  // ---- Readout -----------------------------------------------------------

  private updateHud(): void {
    const s = this.stats;
    const frames = s.frames;
    const avg = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    const max = frames.length ? Math.max(...frames) : 0;
    const strokeSeconds = ((s.strokeEnd > s.strokeStart ? s.strokeEnd : performance.now()) - s.strokeStart) / 1000;
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.hud.set({
      pointer: s.pointer,
      pressure: s.pressure.toFixed(2),
      inputHz: strokeSeconds > 0.05 ? `${Math.round(s.samples / strokeSeconds)} Hz` : '-',
      coalesced: s.events ? (s.samples / s.events).toFixed(1) : '-',
      drawMs: s.events ? (s.drawTotal / s.events).toFixed(2) : '-',
      frameMs: avg.toFixed(1),
      frameMax: max.toFixed(0),
      commitMs: s.commitMs.toFixed(1),
      zoom: `${Math.round((this.view.scale / fitScale(this.doc, this.stage)) * 100)}% of fit`,
      undo: `${this.history.undoDepth} steps · ${(this.history.totalBytes / 1048576).toFixed(1)} MB`,
      encode: s.encode,
      heap: memory ? `${Math.round(memory.usedJSHeapSize / 1048576)} MB` : 'n/a',
      stress: s.stress,
    });
  }
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
