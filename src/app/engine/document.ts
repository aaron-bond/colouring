// The colouring document (TECHNICAL-DESIGN.md 5): a colour layer whose
// pixels are the artwork, a wet layer for the stroke in progress, and
// tile undo over the colour layer. Coordinates are document pixels.
//
// Both canvases are CPU-backed (`willReadFrequently`): undo reads tiles
// back on every commit, and on the OnePlus that was 3-5x faster than from
// a GPU canvas, with no difference in drawing cost (11.1).

import { BrushSpec, Dab, SIZE_FRACTIONS, StrokePlanner } from './brush';
import { Rect, Size, TileHistory, canvasSurface, tileKeysIn, tileRect } from './history';
import { Point } from './viewport';

export const UNDO_BUDGET_BYTES = 150 * 1024 * 1024;

interface Stroke {
  brush: BrushSpec;
  colour: string;
  planner: StrokePlanner;
  // Tiles the stroke's dabs have landed in.
  tiles: Set<number>;
}

export class ColourDocument {
  private readonly colourCtx: CanvasRenderingContext2D;
  private readonly wetCtx: CanvasRenderingContext2D;
  private readonly history: TileHistory<ImageData>;
  private stroke: Stroke | null = null;

  constructor(
    private readonly colourCanvas: HTMLCanvasElement,
    private readonly wetCanvas: HTMLCanvasElement,
    readonly size: Size,
    budgetBytes = UNDO_BUDGET_BYTES,
  ) {
    for (const canvas of [colourCanvas, wetCanvas]) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    const options: CanvasRenderingContext2DSettings = { willReadFrequently: true };
    this.colourCtx = colourCanvas.getContext('2d', options)!;
    this.wetCtx = wetCanvas.getContext('2d', options)!;
    this.history = new TileHistory(canvasSurface(this.colourCtx), budgetBytes);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get undoDepth(): number {
    return this.history.undoDepth;
  }

  get undoBytes(): number {
    return this.history.totalBytes;
  }

  get drawing(): boolean {
    return this.stroke !== null;
  }

  // The radius of the size preset `sizeIndex` before pressure.
  baseRadius(sizeIndex: number): number {
    return (SIZE_FRACTIONS[sizeIndex] * Math.max(this.size.width, this.size.height)) / 2;
  }

  beginStroke(brush: BrushSpec, colour: string, sizeIndex: number, at: Point, pressure: number): void {
    if (this.stroke) this.cancelStroke();
    const planner = new StrokePlanner(brush, this.baseRadius(sizeIndex), at, pressure);
    this.stroke = { brush, colour, planner, tiles: new Set() };
    // The eraser changes the colour layer directly, snapshotting as it goes.
    if (brush.erases) this.history.begin();
    this.paint([planner.first()]);
  }

  extendStroke(points: { at: Point; pressure: number }[]): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const dabs: Dab[] = [];
    for (const { at, pressure } of points) dabs.push(...stroke.planner.to(at, pressure));
    this.paint(dabs);
  }

  // Commits the stroke as one undo step.
  endStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    if (stroke.brush.erases) {
      this.history.commit();
      return;
    }
    // Only the tiles the stroke actually crossed are snapshotted and
    // composited, not its whole bounding box (11.1).
    this.history.begin();
    for (const key of stroke.tiles) {
      const r = tileRect(key, this.size);
      this.history.touchTile(key);
      this.colourCtx.drawImage(this.wetCanvas, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
      this.wetCtx.clearRect(r.x, r.y, r.width, r.height);
    }
    this.history.commit();
  }

  // Drops the stroke, leaving no paint (a pinch started).
  cancelStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    if (stroke.brush.erases) {
      // Already applied to the colour layer: put the tiles back.
      this.history.rollback();
      return;
    }
    for (const key of stroke.tiles) {
      const r = tileRect(key, this.size);
      this.wetCtx.clearRect(r.x, r.y, r.width, r.height);
    }
  }

  undo(): boolean {
    this.endStroke();
    return this.history.undo();
  }

  redo(): boolean {
    this.endStroke();
    return this.history.redo();
  }

  private paint(dabs: Dab[]): void {
    const stroke = this.stroke!;
    const erases = stroke.brush.erases;
    const ctx = erases ? this.colourCtx : this.wetCtx;
    ctx.save();
    if (erases) ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = erases ? '#000' : stroke.colour;
    for (const dab of dabs) {
      const bounds = this.dabBounds(dab);
      for (const key of tileKeysIn(bounds, this.size)) {
        if (stroke.tiles.has(key)) continue;
        stroke.tiles.add(key);
        if (erases) this.history.touchTile(key);
      }
      ctx.globalAlpha = dab.alpha;
      ctx.beginPath();
      ctx.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private dabBounds(dab: Dab): Rect {
    const r = dab.radius + 1;
    return {
      x: Math.floor(dab.x - r),
      y: Math.floor(dab.y - r),
      width: Math.ceil(r * 2) + 1,
      height: Math.ceil(r * 2) + 1,
    };
  }
}
