// Diagnostics for device testing, carried over from the spike
// (TECHNICAL-DESIGN.md 11, 15): live measurements for the hidden debug
// readout, an event log, a snapshot every few seconds, and a plain-text
// report that can be copied off the tablet and pasted back verbatim.

export interface StrokeSummary {
  kind: string;
  tool: string;
  samples: number;
  events: number;
  hz: number | null;
  drawMsPerEvent: number | null;
  pressureMin: number;
  pressureMax: number;
  pressureAvg: number;
}

const MAX_EVENTS = 500;
const MAX_SNAPSHOTS = 240;
const MAX_FRAMES = 120;

export class Diagnostics {
  readonly events: string[] = [];
  readonly snapshots: string[] = [];
  private readonly frames: number[] = [];
  private readonly started: number;
  private stroke: {
    kind: string;
    tool: string;
    start: number;
    samples: number;
    events: number;
    drawMs: number;
    pMin: number;
    pMax: number;
    pSum: number;
  } | null = null;
  // The last finished stroke, for the live readout.
  lastStroke: StrokeSummary | null = null;
  lastCommitMs = 0;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = now();
  }

  elapsed(): string {
    return `+${((this.now() - this.started) / 1000).toFixed(1)}s`;
  }

  log(message: string): void {
    this.events.push(`${this.elapsed()} ${message}`);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  // One animation frame took `ms`. Long ones go in the log.
  frame(ms: number, visible = true): void {
    this.frames.push(ms);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
    if (ms > 250 && visible) this.log(`long frame ${Math.round(ms)} ms`);
  }

  frameStats(): { avg: number; max: number } {
    const f = this.frames;
    if (!f.length) return { avg: 0, max: 0 };
    return { avg: f.reduce((a, b) => a + b, 0) / f.length, max: Math.max(...f) };
  }

  strokeStart(kind: string, tool: string, pressure: number): void {
    this.stroke = { kind, tool, start: this.now(), samples: 1, events: 0, drawMs: 0, pMin: pressure, pMax: pressure, pSum: pressure };
  }

  // One pointer event's coalesced samples, and how long drawing them took.
  strokeEvent(pressures: number[], drawMs: number): void {
    const s = this.stroke;
    if (!s) return;
    s.events++;
    s.drawMs += drawMs;
    for (const p of pressures) {
      s.samples++;
      s.pMin = Math.min(s.pMin, p);
      s.pMax = Math.max(s.pMax, p);
      s.pSum += p;
    }
  }

  strokeEnd(outcome: 'committed' | 'cancelled', commitMs: number, undo: string): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const seconds = (this.now() - s.start) / 1000;
    const summary: StrokeSummary = {
      kind: s.kind,
      tool: s.tool,
      samples: s.samples,
      events: s.events,
      hz: seconds > 0.05 ? Math.round(s.samples / seconds) : null,
      drawMsPerEvent: s.events ? s.drawMs / s.events : null,
      pressureMin: s.pMin,
      pressureMax: s.pMax,
      pressureAvg: s.pSum / s.samples,
    };
    this.lastStroke = summary;
    if (outcome === 'committed') this.lastCommitMs = commitMs;
    this.log(
      `stroke ${summary.tool} by ${summary.kind}${outcome === 'cancelled' ? ' CANCELLED' : ''}` +
        ` · ${summary.samples} samples / ${summary.events} events · ${summary.hz ?? '-'} Hz` +
        ` · draw ${summary.drawMsPerEvent?.toFixed(2) ?? '-'} ms/event` +
        ` · pressure ${summary.pressureMin.toFixed(2)}–${summary.pressureMax.toFixed(2)} (avg ${summary.pressureAvg.toFixed(2)})` +
        (outcome === 'committed' ? ` · commit ${commitMs.toFixed(1)} ms` : '') +
        ` · undo ${undo}`,
    );
  }

  snapshot(line: string): void {
    this.snapshots.push(`${this.elapsed()} ${line}`);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  clear(): void {
    this.events.length = 0;
    this.snapshots.length = 0;
    this.log('log cleared');
  }

  // The full report: the caller's sections (device, settings, readout),
  // then the event log and the snapshots.
  report(title: string, sections: [string, string[]][]): string {
    const lines = [`# ${title} · ${new Date().toISOString()} · running ${this.elapsed()}`];
    for (const [heading, body] of sections) lines.push('', `## ${heading}`, ...body);
    lines.push('', `## Events (last ${this.events.length})`, ...this.events);
    lines.push('', `## Readout every 5 s (last ${this.snapshots.length})`, ...this.snapshots);
    return lines.join('\n');
  }
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
