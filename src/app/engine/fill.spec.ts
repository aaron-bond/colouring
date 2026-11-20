import { FillMap, paintRegion, wallsFromRgba } from './fill';

// Builds a wall mask from rows of text: '#' is a line, '.' is open.
function walls(rows: string[]): FillMap {
  const h = rows.length;
  const w = rows[0].length;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((c, x) => (mask[y * w + x] = c === '#' ? 1 : 0)));
  return new FillMap(mask, w, h);
}

// The region's mask drawn back as text over the whole map: 'o' filled.
function picture(map: FillMap, rows: string[], x: number, y: number, reach = 0, grow = 0): string[] {
  const region = map.region(x, y, reach, grow);
  const out = rows.map((r) => [...r]);
  if (!region) return rows;
  const { rect, mask } = region;
  for (let j = 0; j < rect.height; j++) {
    for (let i = 0; i < rect.width; i++) if (mask[j * rect.width + i]) out[rect.y + j][rect.x + i] = 'o';
  }
  return out.map((r) => r.join(''));
}

const BOXES = [
  '..........',
  '.####.....',
  '.#..#.###.',
  '.#..#.#.#.',
  '.####.###.',
  '..........',
];

describe('FillMap', () => {
  it('fills the shape inside the lines, and nothing outside it', () => {
    const map = walls(BOXES);
    expect(picture(map, BOXES, 2, 2)).toEqual([
      '..........',
      '.####.....',
      '.#oo#.###.',
      '.#oo#.#.#.',
      '.####.###.',
      '..........',
    ]);
  });

  it('fills around shapes, through gaps of open paper', () => {
    const map = walls(BOXES);
    const out = picture(map, BOXES, 0, 0);
    // Everything outside both boxes, but not inside them.
    expect(out[0]).toBe('oooooooooo');
    expect(out[2]).toBe('o#..#o###o');
    expect(out[3]).toBe('o#..#o#.#o');
  });

  it('grows the fill under the lines, but never out the other side', () => {
    const map = walls(BOXES);
    expect(picture(map, BOXES, 7, 3, 0, 1)).toEqual([
      '..........',
      '.####.....',
      '.#..#.ooo.',
      '.#..#.ooo.',
      '.####.ooo.',
      '..........',
    ]);
  });

  it('a tap on a line fills the nearest shape within reach', () => {
    const map = walls(BOXES);
    // (6, 3) is on the right box's wall: no reach finds nothing, a little
    // reach finds an open pixel beside it.
    expect(map.region(6, 3, 0)).toBeNull();
    expect(map.region(6, 3, 2)).not.toBeNull();
    // A tap well inside a line, with too little reach: nothing.
    const thick = walls(['#####', '#####', '#####', '#####', '#####']);
    expect(thick.region(2, 2, 3)).toBeNull();
  });

  it('a blank page fills completely, and the scratch is reset between taps', () => {
    const blank = new FillMap(new Uint8Array(40 * 30), 40, 30);
    const a = blank.region(10, 10)!;
    expect(a.count).toBe(1200);
    expect(a.rect).toEqual({ x: 0, y: 0, width: 40, height: 30 });
    expect(blank.region(39, 29)!.count).toBe(1200);
  });

  it('fills the largest page whole in well under a second', () => {
    // The worst case: an empty 3072x3072 page, then grown under its edge.
    const size = 3072;
    const map = new FillMap(new Uint8Array(size * size), size, size);
    const t0 = performance.now();
    expect(map.region(5, 5)!.count).toBe(size * size);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });
});

describe('wallsFromRgba and paintRegion', () => {
  it('thresholds alpha into walls', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 64, 9, 9, 9, 255]);
    expect([...wallsFromRgba(rgba)]).toEqual([0, 0, 1, 1]);
  });

  it('paints the mask opaque in the colour, leaving the rest', () => {
    const rgba = new Uint8ClampedArray(8);
    paintRegion({ rect: { x: 0, y: 0, width: 2, height: 1 }, mask: new Uint8Array([1, 0]), count: 1 }, rgba, [10, 20, 30]);
    expect([...rgba]).toEqual([10, 20, 30, 255, 0, 0, 0, 0]);
  });
});
