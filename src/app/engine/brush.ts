// Brushes (TECHNICAL-DESIGN.md 7): a brush is plain data, and a stroke is
// turned into evenly spaced round "dabs" along the pointer's path. This
// module only plans dabs; engine/document.ts draws them.

import { Point } from './viewport';

export type BrushId = 'pencil' | 'eraser';

export interface BrushSpec {
  id: BrushId;
  // Removes colour (destination-out) instead of adding it.
  erases: boolean;
  // Dab spacing as a fraction of the dab's radius.
  spacing: number;
  // Radius relative to the chosen size: `sizeMin` at no pressure, 1 at full.
  sizeMin: number;
  // How dark one pass is: `opacityMin` at no pressure, `opacityMax` at full.
  opacityMin: number;
  opacityMax: number;
  // Shapes the pressure response: < 1 reaches full size and opacity sooner.
  gamma: number;
  // Multiplies the chosen size (the eraser is wider than the pencil).
  sizeScale: number;
}

// Tuned on the OnePlus Pad 3 stylus, which reports pressure from 0.05 to
// about 0.92 (TECHNICAL-DESIGN.md 11.1). The spike's 35-100% width with a
// fixed opacity made no visible difference; this varies both.
export const PENCIL: BrushSpec = {
  id: 'pencil',
  erases: false,
  spacing: 0.25,
  sizeMin: 0.3,
  opacityMin: 0.15,
  opacityMax: 0.9,
  gamma: 1,
  sizeScale: 1,
};

export const ERASER: BrushSpec = {
  id: 'eraser',
  erases: true,
  spacing: 0.25,
  sizeMin: 0.6,
  opacityMin: 1,
  opacityMax: 1,
  gamma: 1,
  sizeScale: 2,
};

export const BRUSHES: Record<BrushId, BrushSpec> = { pencil: PENCIL, eraser: ERASER };

// Brush diameters as fractions of the document's long side, so the 5
// presets feel the same at every document size.
export const SIZE_FRACTIONS = [0.002, 0.004, 0.007, 0.012, 0.02];

// Touch and mouse report no real pressure; they draw at a fixed mid value.
export const FIXED_PRESSURE = 0.6;

export function pressureCurve(brush: BrushSpec, pressure: number): number {
  return Math.pow(Math.min(1, Math.max(0, pressure)), brush.gamma);
}

export function dabRadius(brush: BrushSpec, baseRadius: number, pressure: number): number {
  const t = pressureCurve(brush, pressure);
  return Math.max(0.75, baseRadius * brush.sizeScale * (brush.sizeMin + (1 - brush.sizeMin) * t));
}

// How opaque one pass of the brush should look at this pressure.
export function strokeOpacity(brush: BrushSpec, pressure: number): number {
  const t = pressureCurve(brush, pressure);
  return brush.opacityMin + (brush.opacityMax - brush.opacityMin) * t;
}

// The alpha of one dab so that the overlapping dabs along a stroke build
// up to `opacity` along its centre line. With dabs `spacing × radius`
// apart, about 2 / spacing of them cover any point on that line, and n
// layers of alpha a give 1 - (1 - a)^n. The edges get fewer layers, which
// softens them like a pencil's.
export function dabAlpha(brush: BrushSpec, opacity: number): number {
  if (opacity >= 1) return 1;
  const layers = 2 / brush.spacing;
  return 1 - Math.pow(1 - opacity, 1 / layers);
}

export interface Dab {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

// Plans the dabs of one stroke from pointer samples in document
// coordinates. Spacing carries over between calls, so dabs stay even no
// matter how the samples arrive. Pressure is lightly smoothed, which also
// tapers the first few dabs instead of jumping.
export class StrokePlanner {
  private last: Point;
  private carry = 0;
  private pressure: number;

  constructor(
    private readonly brush: BrushSpec,
    private readonly baseRadius: number,
    start: Point,
    pressure: number,
  ) {
    this.last = start;
    this.pressure = pressure;
  }

  // The dab at the start point.
  first(): Dab {
    return this.dab(this.last, this.pressure);
  }

  // Dabs from the last point to `to`.
  to(to: Point, pressure: number): Dab[] {
    const from = this.last;
    const p0 = this.pressure;
    this.pressure += (pressure - this.pressure) * 0.35;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const dabs: Dab[] = [];
    // `carry` is how far the pointer has moved since the last dab.
    let placed = -this.carry;
    let next = placed + this.spacingAt(p0);
    while (next <= dist) {
      const t = next / dist;
      const p = p0 + (this.pressure - p0) * t;
      dabs.push(this.dab({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, p));
      placed = next;
      next += this.spacingAt(p);
    }
    this.carry = dist - placed;
    this.last = to;
    return dabs;
  }

  private spacingAt(pressure: number): number {
    return Math.max(0.5, dabRadius(this.brush, this.baseRadius, pressure) * this.brush.spacing);
  }

  private dab(p: Point, pressure: number): Dab {
    return {
      x: p.x,
      y: p.y,
      radius: dabRadius(this.brush, this.baseRadius, pressure),
      alpha: dabAlpha(this.brush, strokeOpacity(this.brush, pressure)),
    };
  }
}
