import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppUpdates } from '../core/app-updates';
import { CatalogueService, Picture, documentSize } from '../core/catalogue.service';
import { BrushId, ERASER, FIXED_PRESSURE, PENCIL, SIZE_FRACTIONS } from '../engine/brush';
import { Diagnostics, megabytes } from '../engine/diagnostics';
import { ColourDocument } from '../engine/document';
import { InputAction, InputMachine, PointerSample } from '../engine/input';
import { PointSmoother } from '../engine/smoothing';
import { Point, Size, View, clampPan, fitScale, fitView, panBy, pinchView, toDoc, zoomAt } from '../engine/viewport';
import { DebugReadout, PencilTuning, ReadoutLine } from './debug-readout';

// The colouring screen (TECHNICAL-DESIGN.md 3, 5, 6). A thin shell: it
// turns DOM events into engine calls and keeps the page transform up to
// date. Milestone 2 has plain controls; the C1 theme comes in milestone 6.

// Until the palette arrives (milestone 5).
const COLOURS = ['#3A2E22', '#E8590C', '#F06595', '#FCC419', '#20C997', '#339AF0', '#7950F2', '#868E96'];
const DEBUG_KEY = 'colouring.debug';

@Component({
  selector: 'app-colouring',
  imports: [RouterLink, DebugReadout],
  templateUrl: './colouring.html',
  styleUrl: './colouring.css',
})
export class Colouring {
  // Route parameters (component input binding).
  readonly pictureId = input.required<string>();
  readonly debug = input<string>();

  private readonly stageRef = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly pageRef = viewChild.required<ElementRef<HTMLDivElement>>('page');
  private readonly colourRef = viewChild.required<ElementRef<HTMLCanvasElement>>('colourCanvas');
  private readonly wetRef = viewChild.required<ElementRef<HTMLCanvasElement>>('wetCanvas');

  private readonly catalogue = inject(CatalogueService);
  private readonly router = inject(Router);
  private readonly updates = inject(AppUpdates);

  protected readonly picture = signal<Picture | null>(null);
  protected readonly docSize = signal<Size | null>(null);
  protected readonly tool = signal<BrushId>('pencil');
  protected readonly sizeIndex = signal(2);
  protected readonly sizes = SIZE_FRACTIONS.map((_, i) => i);
  protected readonly colours = COLOURS;
  protected readonly colour = signal(COLOURS[2]);
  protected readonly canUndo = signal(false);
  protected readonly canRedo = signal(false);
  protected readonly showDebug = signal(false);
  protected readonly readout = signal<ReadoutLine[]>([]);
  protected readonly copyStatus = signal('tap to copy report');
  protected readonly fingersDraw = signal(false);
  protected readonly smoothing = signal(true);
  protected readonly tuning = signal<PencilTuning>({
    sizeMin: PENCIL.sizeMin,
    opacityMin: PENCIL.opacityMin,
    opacityMax: PENCIL.opacityMax,
    gamma: PENCIL.gamma,
  });

  private doc: ColourDocument | null = null;
  private readonly input = new InputMachine();
  private readonly diagnostics = new Diagnostics();
  private smoother: PointSmoother | null = null;
  private stage: Size = { width: 1, height: 1 };
  private stageLeft = 0;
  private stageTop = 0;
  private view: View = { scale: 1, tx: 0, ty: 0 };
  private viewDirty = false;
  // True until the person zooms or pans: a resize then refits the page.
  private fitted = true;
  private pinchStart: { view: View; a: Point; b: Point } | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.showDebug.set(this.debugEnabled());
      const stageEl = this.stageRef().nativeElement;
      const resize = new ResizeObserver(() => this.measureStage());
      resize.observe(stageEl);
      this.measureStage();

      const blockGesture = (e: Event) => e.preventDefault();
      document.addEventListener('gesturestart', blockGesture);
      const onKey = (e: KeyboardEvent) => this.onKey(e);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      const onBlur = () => this.apply(this.input.reset());
      window.addEventListener('blur', onBlur);
      const onVisibility = () => this.diagnostics.log(document.hidden ? 'page hidden' : 'page visible');
      document.addEventListener('visibilitychange', onVisibility);

      let raf = 0;
      let last = performance.now();
      const frame = (now: number) => {
        this.diagnostics.frame(now - last, !document.hidden);
        last = now;
        if (this.viewDirty) this.applyView();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      const readoutTimer = setInterval(() => this.showDebug() && this.updateReadout(), 250);
      const snapshotTimer = setInterval(() => this.showDebug() && !document.hidden && this.snapshot(), 5000);

      destroyRef.onDestroy(() => {
        resize.disconnect();
        document.removeEventListener('gesturestart', blockGesture);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
        cancelAnimationFrame(raf);
        clearInterval(readoutTimer);
        clearInterval(snapshotTimer);
      });

      void this.load();
    });
  }

  // ---- Loading -------------------------------------------------------------

  private async load(): Promise<void> {
    const picture = await this.catalogue.byId(this.pictureId()).catch(() => undefined);
    if (!picture) {
      void this.router.navigate(['/'], { replaceUrl: true });
      return;
    }
    const svg = await fetch(picture.svg).then((res) => res.text());
    const size = documentSize(svg, picture.docLongSide);
    this.doc = new ColourDocument(this.colourRef().nativeElement, this.wetRef().nativeElement, size);
    const page = this.pageRef().nativeElement;
    page.style.width = `${size.width}px`;
    page.style.height = `${size.height}px`;
    this.picture.set(picture);
    this.docSize.set(size);
    this.diagnostics.log(`opened ${picture.id} · document ${size.width}×${size.height}`);
    this.fit();
    this.applyView();
  }

  // ---- Pointer input -------------------------------------------------------

  protected onPointerDown(e: PointerEvent): void {
    if (!this.doc) return;
    e.preventDefault();
    try {
      this.stageRef().nativeElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no real pointer to capture.
    }
    this.measureStageOrigin();
    this.apply(this.input.down(this.sample(e)));
  }

  protected onPointerMove(e: PointerEvent): void {
    if (!this.doc) return;
    const coalesced = e.getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [e];
    const samples = events.map((c) => this.sample(c, e.pointerId, e.pointerType));
    if (this.input.mode !== 'idle') e.preventDefault();
    this.apply(this.input.move(e.pointerId, samples));
  }

  protected onPointerUp(e: PointerEvent): void {
    this.apply(this.input.up(e.pointerId));
  }

  protected onWheel(e: WheelEvent): void {
    if (!this.doc) return;
    e.preventDefault();
    this.measureStageOrigin();
    // A trackpad pinch arrives as ctrl+wheel; a plain wheel zooms too.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const anchor = { x: e.clientX - this.stageLeft, y: e.clientY - this.stageTop };
    this.setView(zoomAt(this.view, factor, anchor, this.doc.size, this.stage));
  }

  private sample(e: PointerEvent, id = e.pointerId, type = e.pointerType): PointerSample {
    const kind = type === 'pen' ? 'pen' : type === 'mouse' ? 'mouse' : 'touch';
    return {
      id,
      kind,
      x: e.clientX - this.stageLeft,
      y: e.clientY - this.stageTop,
      pressure: e.pressure,
      time: e.timeStamp,
      button: e.button,
    };
  }

  // Only a pen has real pressure; touch and mouse draw at a fixed value.
  private pressureOf(s: PointerSample): number {
    return s.kind === 'pen' ? Math.max(0.05, s.pressure) : FIXED_PRESSURE;
  }

  private toDocPoint(s: PointerSample): Point {
    const p = this.smoother ? this.smoother.next(s, s.time) : s;
    return toDoc(this.view, p);
  }

  private apply(actions: InputAction[]): void {
    const doc = this.doc;
    if (!doc) return;
    for (const action of actions) {
      switch (action.type) {
        case 'pen-mode':
          this.diagnostics.log('pen seen: pen mode on');
          break;
        case 'stroke-start': {
          const s = action.sample;
          this.updates.markBusy();
          this.smoother = this.smoothing() ? new PointSmoother() : null;
          const brush = this.tool() === 'eraser' ? ERASER : { ...PENCIL, ...this.tuning() };
          const pressure = this.pressureOf(s);
          doc.beginStroke(brush, this.colour(), this.sizeIndex(), this.toDocPoint(s), pressure);
          this.diagnostics.strokeStart(s.kind, this.tool(), pressure);
          break;
        }
        case 'stroke-move': {
          const t0 = performance.now();
          const pressures = action.samples.map((s) => this.pressureOf(s));
          doc.extendStroke(action.samples.map((s, i) => ({ at: this.toDocPoint(s), pressure: pressures[i] })));
          this.diagnostics.strokeEvent(pressures, performance.now() - t0);
          break;
        }
        case 'stroke-end': {
          const t0 = performance.now();
          doc.endStroke();
          this.diagnostics.strokeEnd('committed', performance.now() - t0, this.undoText());
          this.refreshHistory();
          break;
        }
        case 'stroke-cancel':
          doc.cancelStroke();
          this.diagnostics.strokeEnd('cancelled', 0, this.undoText());
          break;
        case 'pinch-start':
          this.diagnostics.log('pinch');
          this.pinchStart = { view: { ...this.view }, a: action.a, b: action.b };
          break;
        case 'pinch-move':
          if (this.pinchStart) {
            const { view, a, b } = this.pinchStart;
            this.setView(pinchView(view, a, b, action.a, action.b, doc.size, this.stage));
          }
          break;
        case 'pan':
          this.setView(panBy(this.view, action.dx, action.dy, doc.size, this.stage));
          break;
        case 'gesture-end':
          this.pinchStart = null;
          break;
      }
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this.input.spaceHeld = e.type === 'keydown';
      if (e.target === document.body) e.preventDefault();
      return;
    }
    if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  // ---- Toolbar -------------------------------------------------------------

  protected undo(): void {
    if (this.doc?.undo()) this.diagnostics.log(`undo · ${this.undoText()}`);
    this.refreshHistory();
  }

  protected redo(): void {
    if (this.doc?.redo()) this.diagnostics.log(`redo · ${this.undoText()}`);
    this.refreshHistory();
  }

  protected fit(): void {
    if (!this.doc) return;
    this.view = fitView(this.doc.size, this.stage);
    this.viewDirty = true;
    this.fitted = true;
  }

  private refreshHistory(): void {
    this.canUndo.set(this.doc?.canUndo ?? false);
    this.canRedo.set(this.doc?.canRedo ?? false);
  }

  // ---- View ----------------------------------------------------------------

  private setView(view: View): void {
    this.view = view;
    this.viewDirty = true;
    this.fitted = false;
  }

  private measureStage(): void {
    const rect = this.stageRef().nativeElement.getBoundingClientRect();
    if (rect.width === 0) return;
    this.stage = { width: rect.width, height: rect.height };
    this.stageLeft = rect.left;
    this.stageTop = rect.top;
    if (!this.doc) return;
    // Rotating or resizing only refits the view; the document is untouched.
    if (this.fitted) this.fit();
    else this.setView(clampPan(this.view, this.doc.size, this.stage));
  }

  private measureStageOrigin(): void {
    const rect = this.stageRef().nativeElement.getBoundingClientRect();
    this.stageLeft = rect.left;
    this.stageTop = rect.top;
  }

  private applyView(): void {
    const { scale, tx, ty } = this.view;
    this.pageRef().nativeElement.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    this.viewDirty = false;
  }

  // ---- Diagnostics ---------------------------------------------------------

  private debugEnabled(): boolean {
    try {
      const requested = this.debug();
      if (requested === '1') localStorage.setItem(DEBUG_KEY, '1');
      if (requested === '0') localStorage.removeItem(DEBUG_KEY);
      return localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
      return this.debug() === '1';
    }
  }

  private undoText(): string {
    return `${this.doc?.undoDepth ?? 0} steps · ${megabytes(this.doc?.undoBytes ?? 0)}`;
  }

  private readoutLines(): ReadoutLine[] {
    const d = this.diagnostics;
    const s = d.lastStroke;
    const frames = d.frameStats();
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const zoom = this.doc ? Math.round((this.view.scale / fitScale(this.doc.size, this.stage)) * 100) : 0;
    return [
      { label: 'pen mode', value: this.input.penMode ? 'on' : 'off' },
      { label: 'stroke', value: s ? `${s.tool} by ${s.kind} · ${s.hz ?? '-'} Hz · ${s.samples} samples` : '-' },
      { label: 'pressure', value: s ? `${s.pressureMin.toFixed(2)}–${s.pressureMax.toFixed(2)} (avg ${s.pressureAvg.toFixed(2)})` : '-' },
      { label: 'draw', value: s?.drawMsPerEvent != null ? `${s.drawMsPerEvent.toFixed(2)} ms/event` : '-' },
      { label: 'commit', value: `${d.lastCommitMs.toFixed(1)} ms` },
      { label: 'frame', value: `${frames.avg.toFixed(1)} ms avg · ${frames.max.toFixed(0)} ms max` },
      { label: 'zoom', value: `${zoom}% of fit` },
      { label: 'undo', value: this.undoText() },
      { label: 'JS heap', value: memory ? megabytes(memory.usedJSHeapSize) : 'n/a' },
    ];
  }

  private updateReadout(): void {
    this.readout.set(this.readoutLines());
  }

  private snapshot(): void {
    const lines = this.readoutLines();
    const get = (label: string) => lines.find((l) => l.label === label)?.value ?? '-';
    this.diagnostics.snapshot(`frame ${get('frame')} · heap ${get('JS heap')} · undo ${get('undo')} · ${get('zoom')}`);
  }

  protected async copyReport(): Promise<void> {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
    const size = this.docSize();
    const t = this.tuning();
    const text = this.diagnostics.report('Colouring report', [
      [
        'Device',
        [
          `user agent: ${navigator.userAgent}`,
          `screen ${screen.width}×${screen.height} · viewport ${innerWidth}×${innerHeight} · DPR ${devicePixelRatio}`,
          `cores ${navigator.hardwareConcurrency ?? '?'} · device memory ${nav.deviceMemory ?? '?'} GB · touch points ${navigator.maxTouchPoints}`,
          `installed app: ${installed ? 'yes' : 'no'} · secure context: ${isSecureContext}`,
        ],
      ],
      ['App updates', this.updates.events.length ? [...this.updates.events] : ['nothing to report']],
      [
        'Settings',
        [
          `picture ${this.picture()?.id ?? '-'} · document ${size ? `${size.width}×${size.height}` : '-'}`,
          `tool ${this.tool()} · size ${this.sizeIndex() + 1} · colour ${this.colour()}`,
          `fingers draw in pen mode ${this.fingersDraw()} · smoothing ${this.smoothing()}`,
          `pencil: width at no pressure ${t.sizeMin} · opacity ${t.opacityMin}–${t.opacityMax} · curve ${t.gamma}`,
        ],
      ],
      ['Readout now', this.readoutLines().map((l) => `${l.label}: ${l.value}`)],
    ]);
    const ok = await copyText(text);
    this.copyStatus.set(ok ? `copied ${text.split('\n').length} lines ✓` : 'copy failed');
    setTimeout(() => this.copyStatus.set('tap to copy report'), 2500);
  }

  protected clearLog(): void {
    this.diagnostics.clear();
  }

  protected setFingersDraw(value: boolean): void {
    this.fingersDraw.set(value);
    this.input.fingersDrawInPenMode = value;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for when the async clipboard is unavailable.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
