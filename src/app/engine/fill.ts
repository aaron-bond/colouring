// Tap-to-fill (TECHNICAL-DESIGN.md 8). The line art is rasterised once at
// document size into a wall mask (1 = line, 0 = open). A tap flood-fills
// the open pixels it can reach, so the shape a fill covers is always set
// by the lines, never by colour already painted. The shape is then grown
// a few pixels into the lines, so the colour tucks under them and no pale
// halo shows at anti-aliased edges.
//
// Pure logic over typed arrays, so it runs (and is tested) without a
// canvas. Scanline fill: a whole page of 3072x3072 takes tens of ms.

import { Rect } from './history';

// Line pixels at or above this alpha are walls. Low enough that a
// fill can't slip through the soft edge of a line.
export const WALL_ALPHA = 64;

// How far a fill reaches under the lines, in document pixels. Our lines
// are 6-9 px wide at document size, so this stays hidden under them.
export const GROW_PX = 3;

// The wall mask from rasterised line art (RGBA, as ImageData holds it).
export function wallsFromRgba(rgba: Uint8ClampedArray, threshold = WALL_ALPHA): Uint8Array {
  const walls = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < walls.length; i++) walls[i] = rgba[i * 4 + 3] >= threshold ? 1 : 0;
  return walls;
}

export interface FillRegion {
  // The bounding box of the fill, grown under the lines.
  rect: Rect;
  // One byte per pixel of `rect`, row by row: 1 where the fill paints.
  mask: Uint8Array;
  // Pixels painted.
  count: number;
}

export class FillMap {
  // Scratch marks for the flood, kept between taps and cleared after.
  private readonly seen: Uint8Array;

  constructor(
    private readonly walls: Uint8Array,
    readonly width: number,
    readonly height: number,
  ) {
    if (walls.length !== width * height) throw new Error('wall mask does not match the size');
    this.seen = new Uint8Array(width * height);
  }

  isWall(x: number, y: number): boolean {
    return this.walls[y * this.width + x] === 1;
  }

  // The open pixel nearest (x, y) within `reach`, so a tap that lands on
  // a line still fills the shape beside it. Null if there is none.
  nearestOpen(x: number, y: number, reach: number): { x: number; y: number } | null {
    x = Math.round(x);
    y = Math.round(y);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= reach; r++) {
      // Each square ring around the point; stop once a ring can't beat
      // the best found so far.
      if (r > Math.sqrt(bestD)) break;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
          if (this.isWall(px, py)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: px, y: py };
          }
        }
      }
    }
    return best;
  }

  // The shape a tap at (x, y) fills: the open pixels reachable from the
  // nearest open pixel, grown `grow` pixels under the lines.
  region(x: number, y: number, reach = 0, grow = GROW_PX): FillRegion | null {
    const start = this.nearestOpen(x, y, reach);
    if (!start) return null;
    const box = this.flood(start.x, start.y);
    const rect = this.expand(box, grow);
    const mask = new Uint8Array(rect.width * rect.height);
    // Copy the flood into the mask, clearing the scratch as we go.
    for (let row = box.y; row < box.y + box.height; row++) {
      const src = row * this.width;
      const dst = (row - rect.y) * rect.width - rect.x;
      for (let col = box.x; col < box.x + box.width; col++) {
        if (this.seen[src + col]) {
          mask[dst + col] = 1;
          this.seen[src + col] = 0;
        }
      }
    }
    this.growIntoWalls(mask, rect, grow);
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    return { rect, mask, count };
  }

  // Scanline flood over open pixels, marking `seen`. Returns the bounds.
  private flood(x0: number, y0: number): Rect {
    const { width, height, walls, seen } = this;
    let minX = x0,
      maxX = x0,
      minY = y0,
      maxY = y0;
    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      const row = y * width;
      if (seen[row + x] || walls[row + x]) continue;
      let left = x;
      while (left > 0 && !walls[row + left - 1] && !seen[row + left - 1]) left--;
      let right = x;
      while (right < width - 1 && !walls[row + right + 1] && !seen[row + right + 1]) right++;
      seen.fill(1, row + left, row + right + 1);
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // Seed each open run in the rows above and below.
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= height) continue;
        const nrow = ny * width;
        let inRun = false;
        for (let nx = left; nx <= right; nx++) {
          const open = !walls[nrow + nx] && !seen[nrow + nx];
          if (open && !inRun) stack.push(nx, ny);
          inRun = open;
        }
      }
    }
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  private expand(r: Rect, by: number): Rect {
    const x = Math.max(0, r.x - by);
    const y = Math.max(0, r.y - by);
    const right = Math.min(this.width, r.x + r.width + by);
    const bottom = Math.min(this.height, r.y + r.height + by);
    return { x, y, width: right - x, height: bottom - y };
  }

  // Grows the mask `steps` pixels (8-neighbour) into wall pixels only, so
  // the fill tucks under the lines but never crosses into open paper on
  // the far side.
  private growIntoWalls(mask: Uint8Array, rect: Rect, steps: number): void {
    const w = rect.width;
    const h = rect.height;
    for (let step = 0; step < steps; step++) {
      const before = mask.slice();
      for (let y = 0; y < h; y++) {
        const wallRow = (rect.y + y) * this.width + rect.x;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (before[i] || !this.walls[wallRow + x]) continue;
          const y0 = y > 0 ? y - 1 : y;
          const y1 = y < h - 1 ? y + 1 : y;
          const x0 = x > 0 ? x - 1 : x;
          const x1 = x < w - 1 ? x + 1 : x;
          search: for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              if (before[yy * w + xx]) {
                mask[i] = 1;
                break search;
              }
            }
          }
        }
      }
    }
  }
}

// Paints `region` into RGBA pixels covering `region.rect` (fully opaque:
// a fill replaces whatever fill was there before).
export function paintRegion(region: FillRegion, rgba: Uint8ClampedArray, colour: [number, number, number]): void {
  const [r, g, b] = colour;
  const { mask } = region;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
}
