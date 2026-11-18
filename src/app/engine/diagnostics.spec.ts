import { Diagnostics } from './diagnostics';

describe('Diagnostics', () => {
  let time: number;
  let d: Diagnostics;
  beforeEach(() => {
    time = 1000;
    d = new Diagnostics(() => time);
  });

  it('timestamps log lines from when it started', () => {
    time = 3500;
    d.log('hello');
    expect(d.events).toEqual(['+2.5s hello']);
  });

  it('summarises a stroke: rate, cost per event and pressure range', () => {
    d.strokeStart('pen', 'pencil', 0.1);
    d.strokeEvent([0.3, 0.5], 0.2);
    d.strokeEvent([0.9], 0.4);
    time += 1000;
    d.strokeEnd('committed', 4, '1 steps · 0.3 MB');
    expect(d.lastStroke).toMatchObject({ samples: 4, events: 2, hz: 4, pressureMin: 0.1, pressureMax: 0.9 });
    expect(d.lastStroke!.drawMsPerEvent).toBeCloseTo(0.3);
    expect(d.lastStroke!.pressureAvg).toBeCloseTo(0.45);
    expect(d.events[0]).toContain('stroke pencil by pen · 4 samples / 2 events · 4 Hz');
    expect(d.events[0]).toContain('pressure 0.10–0.90 (avg 0.45) · commit 4.0 ms');
  });

  it('marks a cancelled stroke', () => {
    d.strokeStart('touch', 'pencil', 0.6);
    d.strokeEnd('cancelled', 0, '0 steps · 0.0 MB');
    expect(d.events[0]).toContain('CANCELLED');
    expect(d.events[0]).not.toContain('commit');
  });

  it('logs long frames and keeps frame statistics', () => {
    d.frame(8);
    d.frame(400);
    expect(d.frameStats()).toEqual({ avg: 204, max: 400 });
    expect(d.events).toEqual(['+0.0s long frame 400 ms']);
  });

  it('caps the log', () => {
    for (let i = 0; i < 600; i++) d.log(`line ${i}`);
    expect(d.events.length).toBe(500);
    expect(d.events[0]).toContain('line 100');
  });

  it('builds a report with sections, events and snapshots', () => {
    d.log('event');
    d.snapshot('frame 8 ms');
    const report = d.report('Report', [['Device', ['tablet']]]);
    expect(report).toMatch(/^# Report · .* · running \+0\.0s\n\n## Device\ntablet\n\n## Events \(last 1\)\n\+0\.0s event/);
    expect(report).toContain('## Readout every 5 s (last 1)\n+0.0s frame 8 ms');
  });
});
