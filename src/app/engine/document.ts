// The colouring document (TECHNICAL-DESIGN.md 5): a colour layer whose
// pixels are the pencil work, a fill layer under it for tap-to-fill, a
// wet layer for the stroke in progress, and tile undo over the fill and
// colour layers. Coordinates are document pixels.
//
// Fills go behind the pencil (section 8, decision 15): shading stays on
// top whichever order things are done in, and filling a shape again just
// changes its base colour. The eraser clears both layers.
//
// Paint (strokeAlpha set) is laid down as a whole stroke: its dabs are
// drawn opaque, the wet layer shows them at the stroke's opacity, and the
// commit builds each tile on a scratch canvas before compositing it once
// at that opacity (decision 11's note on stroke-opacity brushes).
//
// The colour layer is CPU-backed (`willReadFrequently`): undo reads tiles
// back on every commit, and on the OnePlus that was 3-5x faster than from
// a GPU canvas (11.1). The wet layer is never read back, so it stays on
// the GPU, and a commit redraws the stroke's dabs onto the colour layer
// rather than copying the wet pixels across (16, decision 11).

import { BrushSpec, Dab, SIZE_FRACTIONS, StrokePlanner } from './brush';
import { hexToRgb } from './colour';
import { FillMap, paintRegion } from './fill';
import { Rect, Size, TILE, TileHistory, canvasSurface, tileKeysIn, tileRect } from './history';
import { Point } from './viewport';

export const UNDO_BUDGET_BYTES = 150 * 1024 * 1024;

// Layers in the undo history.
const FILL = 0;
const COLOUR = 1;

export interface DocumentCanvases {
  fill: HTMLCanvasElement;
  colour: HTMLCanvasElement;
  wet: HTMLCanvasElement;
}

export interface FillResult {
  // Pixels painted, and the area they lie in.
  pixels: number;
  rect: Rect;
}

interface Stroke {
  brush: BrushSpec;
  colour: string;
  planner: StrokePlanner;
  // Tiles the stroke's dabs have landed in.
  tiles: Set<number>;
  // Every dab so far, redrawn onto the colour layer on commit.
  dabs: Dab[];
  // A soft brush's dab, drawn once in the stroke's colour.
  stamp: HTMLCanvasElement | null;
}

export class ColourDocument {
  private readonly fillCtx: CanvasRenderingContext2D;
  private readonly colourCtx: CanvasRenderingContext2D;
  private readonly wetCtx: CanvasRenderingContext2D;
  private readonly wetCanvas: HTMLCanvasElement;
  // Where a paint stroke's tiles are built before compositing.
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private readonly history: TileHistory<ImageData>;
  private stroke: Stroke | null = null;
  // The line art as walls, once it has been rasterised (setLineArt).
  private fillMap: FillMap | null = null;

  constructor(
    canvases: DocumentCanvases,
    readonly size: Size,
    budgetBytes = UNDO_BUDGET_BYTES,
  ) {
    for (const canvas of [canvases.fill, canvases.colour, canvases.wet]) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    // Both read back for undo, so both are CPU-backed.
    this.fillCtx = canvases.fill.getContext('2d', { willReadFrequently: true })!;
    this.colourCtx = canvases.colour.getContext('2d', { willReadFrequently: true })!;
    this.wetCtx = canvases.wet.getContext('2d')!;
    this.wetCanvas = canvases.wet;
    this.history = new TileHistory([canvasSurface(this.fillCtx), canvasSurface(this.colourCtx)], budgetBytes);
  }

  // The line art's wall mask (fill.ts), one byte per document pixel.
  setLineArt(walls: Uint8Array): void {
    this.fillMap = new FillMap(walls, this.size.width, this.size.height);
  }

  get canFill(): boolean {
    return this.fillMap !== null;
  }

  // Fills the shape at `at` with `colour`, as one undo step. A tap within
  // `reach` document pixels of a shape (on a line, say) fills that shape.
  fill(at: Point, colour: string, reach: number): FillResult | null {
    if (!this.fillMap || this.stroke) return null;
    const region = this.fillMap.region(Math.floor(at.x), Math.floor(at.y), Math.ceil(reach));
    if (!region) return null;
    const { rect } = region;
    this.history.begin();
    this.history.touch(rect, FILL);
    const pixels = this.fillCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
    paintRegion(region, pixels.data, hexToRgb(colour));
    this.fillCtx.putImageData(pixels, rect.x, rect.y);
    this.history.commit();
    return { pixels: region.count, rect };
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
    const stamp = brush.softness ? makeStamp(colour, brush.softness) : null;
    this.stroke = { brush, colour, planner, tiles: new Set(), dabs: [], stamp };
    // A paint stroke shows at its own opacity while it's wet.
    if (brush.strokeAlpha !== undefined) this.wetCanvas.style.opacity = String(brush.strokeAlpha);
    // The eraser changes the fill and colour layers directly, snapshotting
    // as it goes.
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
    for (const key of stroke.tiles) this.history.touchTile(key, COLOUR);
    if (stroke.brush.strokeAlpha === undefined) drawDabs(this.colourCtx, stroke.dabs, stroke.colour);
    else this.compositeStroke(stroke, stroke.brush.strokeAlpha);
    for (const key of stroke.tiles) this.clearWetTile(key);
    this.wetCanvas.style.opacity = '';
    this.history.commit();
  }

  // Lays a paint stroke onto the colour layer at one opacity, a tile at a
  // time: the tile's dabs are drawn opaque on the scratch canvas, then
  // composited once.
  private compositeStroke(stroke: Stroke, alpha: number): void {
    if (!this.scratchCtx) {
      const scratch = document.createElement('canvas');
      scratch.width = scratch.height = TILE;
      this.scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;
    }
    const scratch = this.scratchCtx;
    for (const key of stroke.tiles) {
      const r = tileRect(key, this.size);
      const dabs = stroke.dabs.filter(
        (d) => d.x + d.radius > r.x && d.x - d.radius < r.x + r.width && d.y + d.radius > r.y && d.y - d.radius < r.y + r.height,
      );
      if (dabs.length === 0) continue;
      scratch.clearRect(0, 0, TILE, TILE);
      scratch.save();
      scratch.translate(-r.x, -r.y);
      drawDabs(scratch, dabs, stroke.colour, 'source-over', stroke.stamp);
      scratch.restore();
      this.colourCtx.save();
      this.colourCtx.globalAlpha = alpha;
      this.colourCtx.drawImage(scratch.canvas, 0, 0, r.width, r.height, r.x, r.y, r.width, r.height);
      this.colourCtx.restore();
    }
  }

  // Drops the stroke, leaving no paint (a pinch started).
  cancelStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    if (stroke.brush.erases) {
      // Already applied to the layers: put the tiles back.
      this.history.rollback();
      return;
    }
    for (const key of stroke.tiles) this.clearWetTile(key);
    this.wetCanvas.style.opacity = '';
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
        if (erases) {
          this.history.touchTile(key, FILL);
          this.history.touchTile(key, COLOUR);
        }
      }
    }
    if (erases) {
      drawDabs(this.fillCtx, dabs, '#000', 'destination-out');
      drawDabs(this.colourCtx, dabs, '#000', 'destination-out');
    } else {
      drawDabs(this.wetCtx, dabs, stroke.colour, 'source-over', stroke.stamp);
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
// With a stamp (a soft brush), each dab is the stamp scaled to its size.
function drawDabs(
  ctx: CanvasRenderingContext2D,
  dabs: Dab[],
  colour: string,
  op: GlobalCompositeOperation = 'source-over',
  stamp: HTMLCanvasElement | null = null,
): void {
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = colour;
  for (const dab of dabs) {
    ctx.globalAlpha = dab.alpha;
    if (stamp) {
      ctx.drawImage(stamp, dab.x - dab.radius, dab.y - dab.radius, dab.radius * 2, dab.radius * 2);
      continue;
    }
    ctx.beginPath();
    ctx.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const STAMP_RADIUS = 64;

// A round dab in `colour`, solid to (1 - softness) of its radius and
// fading to clear at the edge.
function makeStamp(colour: string, softness: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STAMP_RADIUS * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const [r, g, b] = hexToRgb(colour);
  const fade = ctx.createRadialGradient(STAMP_RADIUS, STAMP_RADIUS, 0, STAMP_RADIUS, STAMP_RADIUS, STAMP_RADIUS);
  fade.addColorStop(0, `rgb(${r} ${g} ${b})`);
  fade.addColorStop(Math.max(0, 1 - softness), `rgb(${r} ${g} ${b})`);
  fade.addColorStop(1, `rgb(${r} ${g} ${b} / 0)`);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, STAMP_RADIUS * 2, STAMP_RADIUS * 2);
  return canvas;
}
