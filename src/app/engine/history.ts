// Undo/redo by copy-on-write tiles (TECHNICAL-DESIGN.md 9.1).
//
// The colour layer is split into TILE x TILE tiles. Before an operation
// first changes a tile, `touch()` copies that tile's current pixels. The
// copies taken during one operation form one undo entry. Undo swaps those
// tiles back in (keeping what it replaced as the redo entry), and redo
// does the reverse. Memory therefore scales with what an operation
// actually touched, not with the size of the document, and the oldest
// entries are dropped once the stack goes over its byte budget.
//
// Generic over the pixel store so it can be unit tested without a
// canvas: production uses a CanvasRenderingContext2D surface.

export const TILE = 256;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Reads and writes rectangles of pixels. `T` is whatever holds a copy
// (ImageData in production).
export interface PixelSurface<T> {
  readonly width: number;
  readonly height: number;
  read(rect: Rect): T;
  write(pixels: T, x: number, y: number): void;
  bytes(pixels: T): number;
}

export interface Size {
  width: number;
  height: number;
}

// Keys of the tiles that `rect` overlaps, on a surface of `size`. A key
// is row * columns + column.
export function tileKeysIn(rect: Rect, size: Size): number[] {
  const cols = Math.ceil(size.width / TILE);
  const rows = Math.ceil(size.height / TILE);
  const x0 = Math.max(0, Math.floor(rect.x / TILE));
  const y0 = Math.max(0, Math.floor(rect.y / TILE));
  const x1 = Math.min(cols - 1, Math.floor((rect.x + rect.width - 1) / TILE));
  const y1 = Math.min(rows - 1, Math.floor((rect.y + rect.height - 1) / TILE));
  const keys: number[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) keys.push(ty * cols + tx);
  }
  return keys;
}

// The rectangle a tile key covers, cut short at the surface's edges.
export function tileRect(key: number, size: Size): Rect {
  const cols = Math.ceil(size.width / TILE);
  const x = (key % cols) * TILE;
  const y = Math.floor(key / cols) * TILE;
  return { x, y, width: Math.min(TILE, size.width - x), height: Math.min(TILE, size.height - y) };
}

interface Entry<T> {
  // Tile key -> copy of that tile.
  tiles: Map<number, { rect: Rect; pixels: T }>;
  bytes: number;
}

export class TileHistory<T> {
  private undoStack: Entry<T>[] = [];
  private redoStack: Entry<T>[] = [];
  private current: Entry<T> | null = null;

  constructor(
    private readonly surface: PixelSurface<T>,
    // Total bytes kept across the undo and redo stacks.
    private readonly budgetBytes: number,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get totalBytes(): number {
    const sum = (stack: Entry<T>[]) => stack.reduce((n, e) => n + e.bytes, 0);
    return sum(this.undoStack) + sum(this.redoStack);
  }

  // Starts an operation. Must be followed by commit() or cancel().
  begin(): void {
    this.current = { tiles: new Map(), bytes: 0 };
  }

  // Call before changing pixels inside `rect`: copies every tile it
  // overlaps that this operation hasn't copied yet.
  touch(rect: Rect): void {
    for (const key of tileKeysIn(rect, this.surface)) this.touchTile(key);
  }

  // Copies one tile (by key, see tileKeysIn) if this operation hasn't yet.
  touchTile(key: number): void {
    const entry = this.current;
    if (!entry) throw new Error('TileHistory.touch() outside begin()/commit()');
    if (entry.tiles.has(key)) return;
    const rect = tileRect(key, this.surface);
    const pixels = this.surface.read(rect);
    entry.tiles.set(key, { rect, pixels });
    entry.bytes += this.surface.bytes(pixels);
  }

  commit(): void {
    const entry = this.current;
    this.current = null;
    if (!entry || entry.tiles.size === 0) return;
    this.undoStack.push(entry);
    this.redoStack = [];
    this.enforceBudget();
  }

  // Abandons the operation. The caller is responsible for not having
  // changed any pixels (e.g. a stroke cancelled before it was committed).
  cancel(): void {
    this.current = null;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(this.swap(entry));
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(this.swap(entry));
    this.enforceBudget();
    return true;
  }

  // Abandons the operation and puts back every tile it touched, leaving
  // the undo and redo stacks as they were.
  rollback(): void {
    const entry = this.current;
    this.current = null;
    if (!entry) return;
    for (const { rect, pixels } of entry.tiles.values()) this.surface.write(pixels, rect.x, rect.y);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
  }

  // Writes the entry's tiles back, returning the entry that undoes that.
  private swap(entry: Entry<T>): Entry<T> {
    const opposite: Entry<T> = { tiles: new Map(), bytes: 0 };
    for (const [key, { rect, pixels }] of entry.tiles) {
      const now = this.surface.read(rect);
      opposite.tiles.set(key, { rect, pixels: now });
      opposite.bytes += this.surface.bytes(now);
      this.surface.write(pixels, rect.x, rect.y);
    }
    return opposite;
  }

  // Drops the oldest undo entries (then redo entries) until within budget.
  // The newest undo entry is always kept, even if it alone is over budget.
  private enforceBudget(): void {
    while (this.totalBytes > this.budgetBytes && this.undoStack.length > 1) {
      this.undoStack.shift();
    }
    while (this.totalBytes > this.budgetBytes && this.redoStack.length > 0) {
      this.redoStack.shift();
    }
  }
}

// The production surface: a 2D canvas context.
export function canvasSurface(ctx: CanvasRenderingContext2D): PixelSurface<ImageData> {
  return {
    width: ctx.canvas.width,
    height: ctx.canvas.height,
    read: (r) => ctx.getImageData(r.x, r.y, r.width, r.height),
    write: (pixels, x, y) => ctx.putImageData(pixels, x, y),
    bytes: (pixels) => pixels.data.byteLength,
  };
}
