// Light smoothing of pointer positions (TECHNICAL-DESIGN.md 6): a
// one-euro filter (Casiez et al., 2012). It smooths hard when the pen
// moves slowly, which hides jitter, and hardly at all when it moves fast,
// which keeps lag down. Works in screen pixels, so it behaves the same at
// every zoom.

import { Point } from './viewport';

export interface OneEuroOptions {
  // Smoothing at rest, in Hz: lower smooths more.
  minCutoff: number;
  // How quickly smoothing falls away with speed.
  beta: number;
  // Cutoff for the speed estimate itself, in Hz.
  derivativeCutoff: number;
}

export const DEFAULT_SMOOTHING: OneEuroOptions = { minCutoff: 3, beta: 0.02, derivativeCutoff: 1 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

class Axis {
  private x: number | null = null;
  private dx = 0;

  constructor(private readonly options: OneEuroOptions) {}

  filter(value: number, dt: number): number {
    if (this.x === null) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.options.derivativeCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class PointSmoother {
  private readonly ax: Axis;
  private readonly ay: Axis;
  private lastTime: number | null = null;

  constructor(options: OneEuroOptions = DEFAULT_SMOOTHING) {
    this.ax = new Axis(options);
    this.ay = new Axis(options);
  }

  // `time` in milliseconds (PointerEvent.timeStamp).
  next(p: Point, time: number): Point {
    // Repeated or out-of-order timestamps: assume one 240 Hz sample.
    const dt = this.lastTime === null || time <= this.lastTime ? 1 / 240 : (time - this.lastTime) / 1000;
    this.lastTime = time;
    return { x: this.ax.filter(p.x, dt), y: this.ay.filter(p.y, dt) };
  }
}
