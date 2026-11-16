import { PixelSurface, Rect, TILE, TileHistory } from './history';

// A fake one-byte-per-pixel surface, so tests can check exact values
// without a canvas (jsdom has none).
class FakeSurface implements PixelSurface<Uint8Array> {
  readonly pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height);
  }
  // Remembers each copy's width, as ImageData would carry it.
  private readonly widths = new WeakMap<Uint8Array, number>();
  read(r: Rect): Uint8Array {
    const out = new Uint8Array(r.width * r.height);
    for (let y = 0; y < r.height; y++) {
      const start = (r.y + y) * this.width + r.x;
      out.set(this.pixels.subarray(start, start + r.width), y * r.width);
    }
    this.widths.set(out, r.width);
    return out;
  }
  write(p: Uint8Array, x: number, y: number): void {
    const w = this.widths.get(p)!;
    for (let row = 0; row * w < p.length; row++) {
      this.pixels.set(p.subarray(row * w, row * w + w), (y + row) * this.width + x);
    }
  }
  bytes(p: Uint8Array): number {
    return p.byteLength;
  }
  paint(r: Rect, value: number): void {
    for (let y = r.y; y < r.y + r.height; y++) {
      this.pixels.fill(value, y * this.width + r.x, y * this.width + r.x + r.width);
    }
  }
  at(x: number, y: number): number {
    return this.pixels[y * this.width + x];
  }
}

// One "operation": snapshot the tiles, then change the pixels.
function op(history: TileHistory<Uint8Array>, surface: FakeSurface, r: Rect, value: number) {
  history.begin();
  history.touch(r);
  surface.paint(r, value);
  history.commit();
}

describe('TileHistory', () => {
  it('undoes and redoes an operation', () => {
    const surface = new FakeSurface(600, 400);
    const history = new TileHistory(surface, Infinity);
    op(history, surface, { x: 10, y: 10, width: 20, height: 20 }, 7);
    expect(surface.at(15, 15)).toBe(7);

    expect(history.undo()).toBe(true);
    expect(surface.at(15, 15)).toBe(0);
    expect(history.canRedo).toBe(true);

    expect(history.redo()).toBe(true);
    expect(surface.at(15, 15)).toBe(7);
  });

  it('only copies the tiles an operation touches', () => {
    const surface = new FakeSurface(1024, 1024);
    const history = new TileHistory(surface, Infinity);
    // Spans the corner of four tiles.
    op(history, surface, { x: TILE - 5, y: TILE - 5, width: 10, height: 10 }, 1);
    expect(history.totalBytes).toBe(4 * TILE * TILE);
  });

  it('copies each tile once per operation, keeping the original pixels', () => {
    const surface = new FakeSurface(512, 512);
    const history = new TileHistory(surface, Infinity);
    history.begin();
    history.touch({ x: 0, y: 0, width: 10, height: 10 });
    surface.paint({ x: 0, y: 0, width: 10, height: 10 }, 3);
    // A second touch of the same tile mid-operation must not re-copy the
    // already-changed pixels.
    history.touch({ x: 5, y: 5, width: 10, height: 10 });
    surface.paint({ x: 5, y: 5, width: 10, height: 10 }, 4);
    history.commit();
    expect(history.totalBytes).toBe(TILE * TILE);
    history.undo();
    expect(surface.at(2, 2)).toBe(0);
    expect(surface.at(8, 8)).toBe(0);
  });

  it('clears the redo stack when a new operation is committed', () => {
    const surface = new FakeSurface(300, 300);
    const history = new TileHistory(surface, Infinity);
    op(history, surface, { x: 0, y: 0, width: 5, height: 5 }, 1);
    history.undo();
    op(history, surface, { x: 0, y: 0, width: 5, height: 5 }, 2);
    expect(history.canRedo).toBe(false);
  });

  it('drops the oldest entries when over budget, keeping the newest', () => {
    const surface = new FakeSurface(TILE, TILE);
    const tileBytes = TILE * TILE;
    const history = new TileHistory(surface, tileBytes * 2);
    for (let i = 1; i <= 5; i++) op(history, surface, { x: 0, y: 0, width: 1, height: 1 }, i);
    expect(history.undoDepth).toBe(2);
    history.undo();
    history.undo();
    // Back to the state after op 3, the oldest one still kept.
    expect(surface.at(0, 0)).toBe(3);
    expect(history.undo()).toBe(false);
  });

  it('ignores a cancelled operation', () => {
    const surface = new FakeSurface(300, 300);
    const history = new TileHistory(surface, Infinity);
    history.begin();
    history.touch({ x: 0, y: 0, width: 5, height: 5 });
    history.cancel();
    expect(history.canUndo).toBe(false);
    expect(history.totalBytes).toBe(0);
  });
});
