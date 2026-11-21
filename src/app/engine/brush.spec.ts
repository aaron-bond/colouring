import { ERASER, PAINT, PENCIL, StrokePlanner, dabAlpha, dabRadius, strokeOpacity } from './brush';

describe('pencil pressure response', () => {
  it('grows in size and opacity with pressure', () => {
    expect(dabRadius(PENCIL, 10, 0.05)).toBeLessThan(dabRadius(PENCIL, 10, 0.5));
    expect(dabRadius(PENCIL, 10, 0.5)).toBeLessThan(dabRadius(PENCIL, 10, 1));
    expect(strokeOpacity(PENCIL, 0.05)).toBeLessThan(0.3);
    expect(strokeOpacity(PENCIL, 0.9)).toBeGreaterThan(0.8);
  });

  it('makes a light stroke visibly thinner than a hard one', () => {
    // The owner saw no difference with the spike's 35-100% width.
    expect(dabRadius(PENCIL, 10, 0.3) / dabRadius(PENCIL, 10, 0.9)).toBeLessThan(0.6);
  });

  it('never makes a dab smaller than 0.75 px', () => {
    expect(dabRadius(PENCIL, 0.1, 0)).toBe(0.75);
  });

  it('leaves the eraser fully opaque', () => {
    expect(strokeOpacity(ERASER, 0.1)).toBe(1);
    expect(dabAlpha(ERASER, 1)).toBe(1);
  });
});

describe('dabAlpha', () => {
  it('builds up to the target opacity over the overlapping dabs', () => {
    const a = dabAlpha(PENCIL, 0.6);
    const layers = 2 / PENCIL.spacing;
    expect(1 - Math.pow(1 - a, layers)).toBeCloseTo(0.6, 5);
    expect(a).toBeLessThan(0.6);
  });
});

describe('StrokePlanner', () => {
  const spacingFor = (pressure: number) => dabRadius(PENCIL, 10, pressure) * PENCIL.spacing;

  it('places dabs evenly along a line', () => {
    const planner = new StrokePlanner(PENCIL, 10, { x: 0, y: 0 }, 1);
    const dabs = planner.to({ x: 100, y: 0 }, 1);
    const step = spacingFor(1);
    expect(dabs.length).toBe(Math.floor(100 / step));
    dabs.forEach((d, i) => expect(d.x).toBeCloseTo(step * (i + 1), 5));
  });

  it('keeps the spacing even when the samples arrive in small steps', () => {
    const whole = new StrokePlanner(PENCIL, 10, { x: 0, y: 0 }, 1).to({ x: 90, y: 0 }, 1);
    const planner = new StrokePlanner(PENCIL, 10, { x: 0, y: 0 }, 1);
    const pieces = [];
    for (let x = 1; x <= 90; x++) pieces.push(...planner.to({ x, y: 0 }, 1));
    expect(pieces.length).toBe(whole.length);
    pieces.forEach((d, i) => expect(d.x).toBeCloseTo(whole[i].x, 5));
  });

  it('eases pressure in rather than jumping', () => {
    const planner = new StrokePlanner(PENCIL, 10, { x: 0, y: 0 }, 0.05);
    const first = planner.first();
    const later = planner.to({ x: 200, y: 0 }, 0.9);
    expect(later[0].radius).toBeGreaterThanOrEqual(first.radius);
    expect(later[0].radius).toBeLessThan(dabRadius(PENCIL, 10, 0.9));
    for (let i = 1; i < later.length; i++) expect(later[i].radius).toBeGreaterThanOrEqual(later[i - 1].radius);
  });
});

describe('paint', () => {
  it('lays opaque dabs, laid down as a whole stroke at its opacity', () => {
    const dabs = new StrokePlanner(PAINT, 10, { x: 0, y: 0 }, 0.3).to({ x: 100, y: 0 }, 0.3);
    expect(dabs.every((d) => d.alpha === 1)).toBe(true);
    expect(PAINT.strokeAlpha).toBeGreaterThan(0.3);
    expect(PAINT.strokeAlpha).toBeLessThan(0.8);
  });

  it('is wider than the pencil, and pressure still changes its width', () => {
    expect(dabRadius(PAINT, 10, 0.6)).toBeGreaterThan(dabRadius(PENCIL, 10, 0.6) * 2);
    expect(dabRadius(PAINT, 10, 0.2)).toBeLessThan(dabRadius(PAINT, 10, 0.9));
  });
});
