import { PointSmoother } from './smoothing';

describe('PointSmoother', () => {
  it('passes the first point through unchanged', () => {
    expect(new PointSmoother().next({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
  });

  it('damps jitter around a point at rest', () => {
    const s = new PointSmoother();
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      const jitter = i % 2 ? 2 : -2;
      const p = s.next({ x: 100 + jitter, y: 100 - jitter }, (i * 1000) / 240);
      if (i > 20) worst = Math.max(worst, Math.abs(p.x - 100));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('keeps up with a fast stroke', () => {
    const s = new PointSmoother();
    let p = { x: 0, y: 0 };
    // 2000 px/s for a quarter of a second, sampled at 240 Hz.
    for (let i = 0; i <= 60; i++) p = s.next({ x: (i * 2000) / 240, y: 0 }, (i * 1000) / 240);
    expect(500 - p.x).toBeLessThan(15);
  });

  it('copes with repeated timestamps', () => {
    const s = new PointSmoother();
    s.next({ x: 0, y: 0 }, 5);
    const p = s.next({ x: 10, y: 0 }, 5);
    expect(Number.isFinite(p.x)).toBe(true);
  });
});
