import { PixelSurface, Rect, TILE, TileHistory, tileKeysIn, tileRect } from './history';

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

describe('tile keys', () => {
  const size = { width: TILE * 3 - 56, height: TILE * 2 }; // 3 columns, the last one short

  it('lists the tiles a rectangle overlaps, row by row', () => {
    expect(tileKeysIn({ x: 0, y: 0, width: 1, height: 1 }, size)).toEqual([0]);
    expect(tileKeysIn({ x: TILE - 1, y: TILE - 1, width: 2, height: 2 }, size)).toEqual([0, 1, 3, 4]);
  });

  it('clips to the surface', () => {
    expect(tileKeysIn({ x: -50, y: -50, width: 60, height: 60 }, size)).toEqual([0]);
    expect(tileKeysIn({ x: size.width - 5, y: size.height - 5, width: 50, height: 50 }, size)).toEqual([5]);
  });

  it('maps a key back to its rectangle, cut short at the edge', () => {
    expect(tileRect(4, size)).toEqual({ x: TILE, y: TILE, width: TILE, height: TILE });
    expect(tileRect(2, size)).toEqual({ x: TILE * 2, y: 0, width: TILE - 56, height: TILE });
  });

  it('touchTile copies only that tile, once', () => {
    const surface = new FakeSurface(TILE * 2, TILE * 2);
    const history = new TileHistory(surface, Infinity);
    history.begin();
    history.touchTile(3);
    history.touchTile(3);
    surface.paint({ x: TILE, y: TILE, width: TILE, height: TILE }, 9);
    history.commit();
    expect(history.totalBytes).toBe(TILE * TILE);
    history.undo();
    expect(surface.at(TILE + 5, TILE + 5)).toBe(0);
  });
});

describe('rollback', () => {
  it('puts the touched tiles back and leaves both stacks alone', () => {
    const surface = new FakeSurface(TILE * 2, TILE);
    const history = new TileHistory(surface, Infinity);
    history.begin();
    history.touch({ x: 0, y: 0, width: 1, height: 1 });
    surface.paint({ x: 0, y: 0, width: 10, height: 10 }, 1);
    history.commit();
    history.undo();
    expect(history.canRedo).toBe(true);

    history.begin();
    history.touch({ x: TILE, y: 0, width: 1, height: 1 });
    surface.paint({ x: TILE, y: 0, width: 10, height: 10 }, 7);
    history.rollback();
    expect(surface.at(TILE, 0)).toBe(0);
    expect(history.canRedo).toBe(true);
    expect(history.canUndo).toBe(false);
  });
});

describe('several layers', () => {
  it('snapshots each layer separately, and undoes them together', () => {
    const fill = new FakeSurface(TILE * 2, TILE);
    const colour = new FakeSurface(TILE * 2, TILE);
    const history = new TileHistory([fill, colour], Infinity);
    // One operation (an eraser stroke) changes the same tile on both layers.
    fill.paint({ x: 0, y: 0, width: 4, height: 4 }, 5);
    colour.paint({ x: 0, y: 0, width: 4, height: 4 }, 6);
    history.begin();
    history.touchTile(0, 0);
    history.touchTile(0, 1);
    history.touchTile(0, 1);
    fill.paint({ x: 0, y: 0, width: 4, height: 4 }, 0);
    colour.paint({ x: 0, y: 0, width: 4, height: 4 }, 0);
    history.commit();
    expect(history.totalBytes).toBe(TILE * TILE * 2);

    history.undo();
    expect([fill.at(1, 1), colour.at(1, 1)]).toEqual([5, 6]);
    history.redo();
    expect([fill.at(1, 1), colour.at(1, 1)]).toEqual([0, 0]);

    // A fill touches only the fill layer.
    history.begin();
    history.touch({ x: TILE, y: 0, width: 1, height: 1 }, 0);
    fill.paint({ x: TILE, y: 0, width: 4, height: 4 }, 9);
    colour.paint({ x: TILE, y: 0, width: 4, height: 4 }, 3);
    history.commit();
    history.undo();
    expect([fill.at(TILE, 0), colour.at(TILE, 0)]).toEqual([0, 3]);
  });
});
