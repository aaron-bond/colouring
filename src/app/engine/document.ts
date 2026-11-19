// The colouring document (TECHNICAL-DESIGN.md 5): a colour layer whose
// pixels are the artwork, a wet layer for the stroke in progress, and
// tile undo over the colour layer. Coordinates are document pixels.
//
// The colour layer is CPU-backed (`willReadFrequently`): undo reads tiles
// back on every commit, and on the OnePlus that was 3-5x faster than from
// a GPU canvas (11.1). The wet layer is never read back, so it stays on
// the GPU, and a commit redraws the stroke's dabs onto the colour layer
// rather than copying the wet pixels across (16, decision 11).

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
  // Every dab so far, redrawn onto the colour layer on commit.
  dabs: Dab[];
}

export class ColourDocument {
  private readonly colourCtx: CanvasRenderingContext2D;
  private readonly wetCtx: CanvasRenderingContext2D;
  private readonly history: TileHistory<ImageData>;
  private stroke: Stroke | null = null;

  constructor(
    colourCanvas: HTMLCanvasElement,
    wetCanvas: HTMLCanvasElement,
    readonly size: Size,
    budgetBytes = UNDO_BUDGET_BYTES,
  ) {
    for (const canvas of [colourCanvas, wetCanvas]) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    this.colourCtx = colourCanvas.getContext('2d', { willReadFrequently: true })!;
    this.wetCtx = wetCanvas.getContext('2d')!;
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
    this.stroke = { brush, colour, planner, tiles: new Set(), dabs: [] };
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
    for (const key of stroke.tiles) this.history.touchTile(key);
    drawDabs(this.colourCtx, stroke.dabs, stroke.colour);
    for (const key of stroke.tiles) this.clearWetTile(key);
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
    for (const key of stroke.tiles) this.clearWetTile(key);
  }

  undo(): boolean {
    this.endStroke();
    return this.history.undo();
  }

  redo(): boolean {
    this.endStroke();
    return this.history.redo();
  }

  private clearWetTile(key: number): void {
    const r = tileRect(key, this.size);
    this.wetCtx.clearRect(r.x, r.y, r.width, r.height);
  }

  private paint(dabs: Dab[]): void {
    const stroke = this.stroke!;
    const erases = stroke.brush.erases;
    for (const dab of dabs) {
      for (const key of tileKeysIn(this.dabBounds(dab), this.size)) {
        if (stroke.tiles.has(key)) continue;
        stroke.tiles.add(key);
        if (erases) this.history.touchTile(key);
      }
    }
    if (erases) {
      drawDabs(this.colourCtx, dabs, '#000', 'destination-out');
    } else {
      drawDabs(this.wetCtx, dabs, stroke.colour);
      stroke.dabs.push(...dabs);
    }
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

// Source-over is associative, so dabs drawn straight onto the colour layer
// give the same result as dabs drawn onto the wet layer and then copied.
function drawDabs(ctx: CanvasRenderingContext2D, dabs: Dab[], colour: string, op: GlobalCompositeOperation = 'source-over'): void {
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = colour;
  for (const dab of dabs) {
    ctx.globalAlpha = dab.alpha;
    ctx.beginPath();
    ctx.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
