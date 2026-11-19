import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppUpdates } from '../core/app-updates';
import { CatalogueService, Picture, documentSize } from '../core/catalogue.service';
import { flatten } from '../core/export';
import { DEFAULT_PAINT, PAINTS, Paint, plateLabel } from '../core/field-guide';
import { BrushId, ERASER, FIXED_PRESSURE, PENCIL, SIZE_FRACTIONS } from '../engine/brush';
import { Diagnostics, megabytes } from '../engine/diagnostics';
import { DEFAULT_HAPTICS, HapticCall, HapticSettings, HapticStroke } from '../engine/haptics';
import { ColourDocument } from '../engine/document';
import { InputAction, InputMachine, PointerSample } from '../engine/input';
import { PointSmoother } from '../engine/smoothing';
import { Insets, NO_INSETS, Point, Size, View, clampPan, fitView, panBy, pinchView, toDoc, zoomAt } from '../engine/viewport';
import { Finished } from '../finished/finished';
import { DebugReadout, PencilTuning, ReadoutLine } from './debug-readout';

// The colouring screen (TECHNICAL-DESIGN.md 3, 5, 6), in the C1 theme. A
// thin shell: it turns DOM events into engine calls and keeps the page
// transform up to date. "Finished" opens over it (see finished.ts), and
// leaving with colour on the page asks first, as nothing is saved yet.

// Room left between the controls and a fitted page.
const FIT_GAP = 12;
// The size presets' dots on the tool roll, in px.
const DOT_SIZES = [6, 10, 14, 20, 26];

@Component({
  selector: 'app-colouring',
  imports: [RouterLink, DebugReadout, Finished],
  templateUrl: './colouring.html',
  styleUrl: './colouring.css',
})
export class Colouring {
  // Route parameters (component input binding).
  readonly pictureId = input.required<string>();

  private readonly stageRef = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly pageRef = viewChild.required<ElementRef<HTMLDivElement>>('page');
  private readonly colourRef = viewChild.required<ElementRef<HTMLCanvasElement>>('colourCanvas');
  private readonly wetRef = viewChild.required<ElementRef<HTMLCanvasElement>>('wetCanvas');
  private readonly topBarRef = viewChild.required<ElementRef<HTMLElement>>('topBar');
  private readonly toolRollRef = viewChild.required<ElementRef<HTMLElement>>('toolRoll');
  private readonly paintTinRef = viewChild.required<ElementRef<HTMLElement>>('paintTin');
  private readonly leaveDialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('leaveDialog');

  private readonly catalogue = inject(CatalogueService);
  private readonly router = inject(Router);
  private readonly updates = inject(AppUpdates);

  protected readonly picture = signal<Picture | null>(null);
  protected readonly docSize = signal<Size | null>(null);
  protected readonly tool = signal<BrushId>('pencil');
  protected readonly sizeIndex = signal(2);
  protected readonly sizes = SIZE_FRACTIONS.map((_, i) => i);
  protected readonly dotSizes = DOT_SIZES;
  protected readonly paints = PAINTS;
  protected readonly paint = signal<Paint>(DEFAULT_PAINT);
  protected readonly plateNo = computed(() => plateLabel(this.picture()?.plate ?? 0).toLowerCase());
  protected readonly zoomPercent = signal(100);
  protected readonly finishedOpen = signal(false);
  protected readonly finishedPng = signal<Blob | null>(null);
  // The haptics spike: tuned from the diagnostics panel.
  protected readonly haptics = signal<HapticSettings>(DEFAULT_HAPTICS);
  protected readonly canUndo = signal(false);
  protected readonly canRedo = signal(false);
  protected readonly showDebug = signal(false);
  protected readonly readout = signal<ReadoutLine[]>([]);
  protected readonly copyStatus = signal('tap to copy report');
  protected readonly fingersDraw = signal(false);
  // Off: the filter's lag was felt on the tablet, and the raw path is
  // steady enough (TECHNICAL-DESIGN.md 7).
  protected readonly smoothing = signal(false);
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
  // The stage area covered by the controls.
  private insets: Insets = NO_INSETS;
  // Colour has been put down since the picture opened.
  private dirty = false;
  // Leaving was already confirmed (from the Finished screen).
  private leaving = false;
  private resolveLeave: ((leave: boolean) => void) | null = null;
  // The pen stroke's haptics, and where the pen last was on screen.
  private haptic: HapticStroke | null = null;
  private hapticAt: Point | null = null;
  private lastHapticPulses = 0;
  private lastVibrate = 'not called';

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
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
      // Closing or reloading the tab with colour on the page: the browser asks.
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (this.dirty && !this.leaving) e.preventDefault();
      };
      window.addEventListener('beforeunload', onBeforeUnload);

      let raf = 0;
      let last = performance.now();
      const frame = (now: number) => {
        this.diagnostics.frame(now - last, !document.hidden);
        last = now;
        if (this.viewDirty) this.applyView();
        if (this.haptic) this.vibrate(this.haptic.idle(now));
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      const readoutTimer = setInterval(() => this.showDebug() && this.updateReadout(), 250);
      // Snapshots run with the readout closed too, so opening it later
      // still has the history.
      const snapshotTimer = setInterval(() => !document.hidden && this.snapshot(), 5000);

      destroyRef.onDestroy(() => {
        resize.disconnect();
        document.removeEventListener('gesturestart', blockGesture);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('beforeunload', onBeforeUnload);
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
          doc.beginStroke(brush, this.paint().hex, this.sizeIndex(), this.toDocPoint(s), pressure);
          this.diagnostics.strokeStart(s.kind, this.tool(), pressure);
          this.startHaptics(s);
          break;
        }
        case 'stroke-move': {
          const t0 = performance.now();
          const pressures = action.samples.map((s) => this.pressureOf(s));
          doc.extendStroke(action.samples.map((s, i) => ({ at: this.toDocPoint(s), pressure: pressures[i] })));
          this.diagnostics.strokeEvent(pressures, performance.now() - t0);
          this.moveHaptics(action.samples, pressures);
          break;
        }
        case 'stroke-end': {
          const t0 = performance.now();
          doc.endStroke();
          this.endHaptics();
          this.dirty = true;
          this.diagnostics.strokeEnd('committed', performance.now() - t0, this.undoText());
          this.refreshHistory();
          break;
        }
        case 'stroke-cancel':
          doc.cancelStroke();
          this.endHaptics();
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
    this.view = fitView(this.doc.size, this.stage, this.insets);
    this.viewDirty = true;
    this.fitted = true;
  }

  protected choosePaint(p: Paint): void {
    this.paint.set(p);
    this.tool.set('pencil');
  }

  // ---- Finished and leaving --------------------------------------------------

  protected openFinished(): void {
    const doc = this.doc;
    const picture = this.picture();
    if (!doc || !picture) return;
    this.apply(this.input.reset());
    this.finishedPng.set(null);
    this.finishedOpen.set(true);
    const t0 = performance.now();
    flatten(this.colourRef().nativeElement, picture.svg, doc.size)
      .then((png) => {
        this.diagnostics.log(`finished: PNG ${megabytes(png.size)} in ${Math.round(performance.now() - t0)} ms`);
        if (this.finishedOpen()) this.finishedPng.set(png);
      })
      .catch((err: unknown) => this.diagnostics.log(`finished: export failed: ${String(err)}`));
  }

  protected closeFinished(): void {
    this.finishedOpen.set(false);
    this.finishedPng.set(null);
  }

  protected leaveToLibrary(): void {
    this.leaving = true;
    void this.router.navigate(['/']);
  }

  // The route's canDeactivate guard: with colour on the page, ask first.
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty || this.leaving) return true;
    const dialog = this.leaveDialogRef().nativeElement;
    this.apply(this.input.reset());
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => (this.resolveLeave = resolve));
  }

  protected onLeaveDialogClosed(): void {
    const leave = this.leaveDialogRef().nativeElement.returnValue === 'leave';
    if (leave) this.leaving = true;
    this.resolveLeave?.(leave);
    this.resolveLeave = null;
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
    this.measureInsets(rect);
    if (!this.doc) return;
    // Rotating or resizing only refits the view; the document is untouched.
    if (this.fitted) this.fit();
    else this.setView(clampPan(this.view, this.doc.size, this.stage));
  }

  // How much of each stage edge the controls cover. The tool roll runs
  // down the left in landscape and across the top in portrait.
  private measureInsets(stage: DOMRect): void {
    const bar = this.topBarRef().nativeElement.getBoundingClientRect();
    const roll = this.toolRollRef().nativeElement.getBoundingClientRect();
    const tin = this.paintTinRef().nativeElement.getBoundingClientRect();
    const rollAcross = roll.width > roll.height;
    const top = (rollAcross ? roll.bottom : bar.bottom) - stage.top + FIT_GAP;
    const left = rollAcross ? FIT_GAP : roll.right - stage.left + FIT_GAP;
    this.insets = {
      top,
      left,
      // Keep the page centred on the screen when the roll is at the side.
      right: rollAcross ? FIT_GAP : left,
      bottom: stage.bottom - tin.top + FIT_GAP,
    };
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
    if (this.doc) this.zoomPercent.set(Math.round((scale / fitView(this.doc.size, this.stage, this.insets).scale) * 100));
  }

  // ---- Diagnostics ---------------------------------------------------------

  // The gear in the bottom-left corner. Always shown for now; it will
  // move behind a build setting.
  protected toggleDebug(): void {
    this.showDebug.update((on) => !on);
    if (this.showDebug()) this.updateReadout();
  }

  private undoText(): string {
    return `${this.doc?.undoDepth ?? 0} steps · ${megabytes(this.doc?.undoBytes ?? 0)}`;
  }

  private readoutLines(): ReadoutLine[] {
    const d = this.diagnostics;
    const s = d.lastStroke;
    const frames = d.frameStats();
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return [
      { label: 'pen mode', value: this.input.penMode ? 'on' : 'off' },
      { label: 'haptics', value: `${this.haptics().mode} · ${this.lastHapticPulses} pulses last stroke · vibrate ${this.lastVibrate}` },
      { label: 'stroke', value: s ? `${s.tool} by ${s.kind} · ${s.hz ?? '-'} Hz · ${s.samples} samples` : '-' },
      { label: 'pressure', value: s ? `${s.pressureMin.toFixed(2)}–${s.pressureMax.toFixed(2)} (avg ${s.pressureAvg.toFixed(2)})` : '-' },
      { label: 'draw', value: s?.drawMsPerEvent != null ? `${s.drawMsPerEvent.toFixed(2)} ms/event` : '-' },
      { label: 'commit', value: `${d.lastCommitMs.toFixed(1)} ms` },
      { label: 'frame', value: `${frames.avg.toFixed(1)} ms avg · ${frames.max.toFixed(0)} ms max` },
      { label: 'zoom', value: `${this.zoomPercent()}% of fit` },
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
    const device = await deviceLabel();
    const text = this.diagnostics.report(`Colouring report · ${device}`, [
      [
        'Device',
        [
          `device: ${device}`,
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
          `tool ${this.tool()} · size ${this.sizeIndex() + 1} · colour ${this.paint().name} ${this.paint().hex}`,
          `haptics ${JSON.stringify(this.haptics())} · vibrate supported ${'vibrate' in navigator}`,
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

  // ---- Haptics spike ---------------------------------------------------------

  private startHaptics(s: PointerSample): void {
    // Pen strokes only: the idea is a pen that feels like it's on paper.
    this.haptic = s.kind === 'pen' && this.haptics().mode !== 'off' ? new HapticStroke(this.haptics()) : null;
    this.hapticAt = { x: s.x, y: s.y };
  }

  private moveHaptics(samples: PointerSample[], pressures: number[]): void {
    const haptic = this.haptic;
    if (!haptic || !this.hapticAt) return;
    samples.forEach((s, i) => {
      const travelled = Math.hypot(s.x - this.hapticAt!.x, s.y - this.hapticAt!.y);
      this.hapticAt = { x: s.x, y: s.y };
      this.vibrate(haptic.move(travelled, pressures[i], s.time));
    });
  }

  private endHaptics(): void {
    if (!this.haptic) return;
    this.vibrate(this.haptic.end());
    this.lastHapticPulses = this.haptic.pulses;
    this.haptic = null;
  }

  private vibrate(call: HapticCall): void {
    if (call === null) return;
    if (!('vibrate' in navigator)) {
      this.lastVibrate = 'unsupported';
      return;
    }
    // false: blocked (no tap on the page yet) or no motor.
    this.lastVibrate = navigator.vibrate(call) ? 'ok' : 'refused';
  }

  protected testVibration(): void {
    this.vibrate(300);
    this.diagnostics.log(`test vibration: ${this.lastVibrate}`);
    this.updateReadout();
  }

  protected setFingersDraw(value: boolean): void {
    this.fingersDraw.set(value);
    this.input.fingersDrawInPenMode = value;
  }
}

interface UADataValues {
  model?: string;
  platform?: string;
  platformVersion?: string;
  fullVersionList?: { brand: string; version: string }[];
}

// A short name for the device, so reports can be told apart: e.g.
// "Pixel 8 · Android 15 · Chrome 157 · phone". Chrome's user agent string
// hides the model ("Android 10; K"), so ask User-Agent Client Hints for it.
async function deviceLabel(): Promise<string> {
  const short = Math.min(screen.width, screen.height);
  const kind = navigator.maxTouchPoints === 0 ? 'desktop' : short < 600 ? 'phone' : 'tablet';
  const uaData = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<UADataValues> };
  }).userAgentData;
  try {
    const v = await uaData!.getHighEntropyValues(['model', 'platform', 'platformVersion', 'fullVersionList']);
    const chrome = v.fullVersionList?.find((b) => b.brand === 'Google Chrome' || b.brand === 'Chromium');
    const platform = v.platform ? `${v.platform} ${v.platformVersion?.split('.')[0] ?? ''}`.trim() : '';
    const browser = chrome ? `Chrome ${chrome.version.split('.')[0]}` : '';
    return [v.model || 'unknown model', platform, browser, kind].filter(Boolean).join(' · ');
  } catch {
    // Safari and Firefox have no client hints: fall back to the string.
    const ua = navigator.userAgent;
    const os = /iPad|iPhone|Android [\d.]+|Mac OS X|Windows|Linux/.exec(ua)?.[0] ?? 'unknown OS';
    const m = /(Version|Firefox|Chrome)\/(\d+)/.exec(ua);
    const browser = m ? `${m[1] === 'Version' ? 'Safari' : m[1]} ${m[2]}` : '';
    return [os, browser, kind].filter(Boolean).join(' · ');
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
