import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  fitScale,
  fitView,
  pinchView,
  toDoc,
  toStage,
  zoomAt,
} from './viewport';

const doc = { width: 3072, height: 3072 };
const stage = { width: 1180, height: 820 };

describe('viewport', () => {
  it('fits the page inside the stage, centred', () => {
    const view = fitView(doc, stage);
    expect(view.scale).toBeCloseTo((820 / 3072) * 0.92);
    const topLeft = toStage(view, { x: 0, y: 0 });
    const bottomRight = toStage(view, { x: doc.width, y: doc.height });
    expect(topLeft.x + bottomRight.x).toBeCloseTo(stage.width);
    expect(topLeft.y + bottomRight.y).toBeCloseTo(stage.height);
  });

  it('round-trips between stage and document coordinates', () => {
    const view = { scale: 0.37, tx: 120, ty: -45 };
    const p = toDoc(view, toStage(view, { x: 1000, y: 2000 }));
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(2000);
  });

  it('zooms around the anchor point', () => {
    const view = fitView(doc, stage);
    const anchor = { x: 700, y: 300 };
    const before = toDoc(view, anchor);
    const zoomed = zoomAt(view, 2, anchor, doc, stage);
    const after = toDoc(zoomed, anchor);
    expect(zoomed.scale).toBeCloseTo(view.scale * 2);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom to the allowed range', () => {
    const view = fitView(doc, stage);
    const fit = fitScale(doc, stage);
    expect(zoomAt(view, 1000, { x: 590, y: 410 }, doc, stage).scale).toBeCloseTo(fit * MAX_ZOOM);
    expect(zoomAt(view, 0.0001, { x: 590, y: 410 }, doc, stage).scale).toBeCloseTo(fit * MIN_ZOOM);
  });

  it('pinch keeps the document under the fingers', () => {
    const start = fitView(doc, stage);
    const a0 = { x: 500, y: 400 };
    const b0 = { x: 700, y: 400 };
    // Fingers spread apart and drift right.
    const a1 = { x: 450, y: 420 };
    const b1 = { x: 850, y: 420 };
    const view = pinchView(start, a0, b0, a1, b1, doc, stage);
    expect(view.scale).toBeCloseTo(start.scale * 2);
    const docMidBefore = toDoc(start, { x: 600, y: 400 });
    const docMidAfter = toDoc(view, { x: 650, y: 420 });
    expect(docMidAfter.x).toBeCloseTo(docMidBefore.x);
    expect(docMidAfter.y).toBeCloseTo(docMidBefore.y);
  });

  it('never lets the page leave the stage completely', () => {
    const view = clampPan({ scale: 0.25, tx: -100000, ty: 100000 }, doc, stage);
    const w = doc.width * 0.25;
    expect(view.tx + w).toBeGreaterThan(0);
    expect(view.ty).toBeLessThan(stage.height);
  });
});
