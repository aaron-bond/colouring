import { BUZZ_MS, DEFAULT_HAPTICS, HapticStroke, REST_MS } from './haptics';

describe('HapticStroke', () => {
  it('does nothing when off', () => {
    const h = new HapticStroke(DEFAULT_HAPTICS);
    expect(h.move(100, 1, 0)).toBeNull();
    expect(h.end()).toBeNull();
  });

  it('pulses once per spacing of travel', () => {
    const h = new HapticStroke({ mode: 'grain', pulseMs: 8, spacingPx: 10, pressureScales: false });
    const calls = [];
    // 4 px per sample, 20 ms apart: a pulse every 10 px.
    for (let i = 1; i <= 10; i++) calls.push(h.move(4, 0.5, i * 20));
    expect(calls.filter((c) => c !== null)).toEqual([8, 8, 8, 8]);
    expect(h.pulses).toBe(4);
  });

  it('never cuts a pulse short: fast strokes skip pulses', () => {
    const h = new HapticStroke({ mode: 'grain', pulseMs: 10, spacingPx: 5, pressureScales: false });
    // 20 px every 4 ms would want a pulse every sample.
    const calls = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => h.move(20, 0.5, i * 4));
    // Each 10 ms pulse blocks the next for 20 ms.
    expect(calls.filter((c) => c !== null).length).toBe(2);
  });

  it('makes pulses longer with pressure', () => {
    const soft = new HapticStroke({ mode: 'grain', pulseMs: 20, spacingPx: 1, pressureScales: true });
    const hard = new HapticStroke({ mode: 'grain', pulseMs: 20, spacingPx: 1, pressureScales: true });
    expect(soft.move(2, 0, 0)).toBe(8);
    expect(hard.move(2, 1, 0)).toBe(20);
  });

  it('buzzes while moving, tops up, and stops at rest and on lift', () => {
    const h = new HapticStroke({ ...DEFAULT_HAPTICS, mode: 'buzz' });
    expect(h.move(3, 0.5, 0)).toBe(BUZZ_MS);
    expect(h.move(3, 0.5, 50)).toBeNull();
    expect(h.move(3, 0.5, BUZZ_MS / 2 + 1)).toBe(BUZZ_MS);
    expect(h.idle(BUZZ_MS / 2 + 10)).toBeNull();
    expect(h.idle(BUZZ_MS / 2 + 1 + REST_MS)).toBe(0);
    expect(h.idle(BUZZ_MS)).toBeNull();
    expect(h.end()).toBe(0);
  });
});
