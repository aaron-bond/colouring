// Zoom/pan maths for the document view. Pure functions only, so they can
// be unit tested without a DOM. The view maps document coordinates to
// stage (screen) coordinates as: screen = doc * scale + (tx, ty). The
// page element carries exactly this as a CSS transform
// (`translate(tx, ty) scale(scale)` with `transform-origin: 0 0`), so
// zooming and panning never redraw anything (TECHNICAL-DESIGN.md 5.3).

export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// How far in or out the user can zoom, as multiples of the "fit" scale.
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
// Margin left around the page when fitting it to the stage.
export const FIT_MARGIN = 0.92;

export function fitScale(doc: Size, stage: Size): number {
  return Math.min(stage.width / doc.width, stage.height / doc.height) * FIT_MARGIN;
}

// Space on each side of the stage covered by the screen's controls.
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

// The part of the stage left uncovered by the controls (at least 1 px).
export function freeArea(stage: Size, insets: Insets): Size {
  return {
    width: Math.max(1, stage.width - insets.left - insets.right),
    height: Math.max(1, stage.height - insets.top - insets.bottom),
  };
}

// The document scaled to fit and centred in the stage's free area, so
// the controls floating over the stage don't cover the page.
export function fitView(doc: Size, stage: Size, insets: Insets = NO_INSETS): View {
  const area = freeArea(stage, insets);
  const scale = fitScale(doc, area);
  return {
    scale,
    tx: insets.left + (area.width - doc.width * scale) / 2,
    ty: insets.top + (area.height - doc.height * scale) / 2,
  };
}

export function toDoc(view: View, p: Point): Point {
  return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
}

export function toStage(view: View, p: Point): Point {
  return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty };
}

// Zooms by `factor` keeping the document point under `anchor` (a stage
// point, e.g. the mouse or pinch centre) fixed on screen. The resulting
// scale is clamped to [MIN_ZOOM, MAX_ZOOM] x fit.
export function zoomAt(view: View, factor: number, anchor: Point, doc: Size, stage: Size): View {
  const fit = fitScale(doc, stage);
  const scale = clamp(view.scale * factor, fit * MIN_ZOOM, fit * MAX_ZOOM);
  const docPoint = toDoc(view, anchor);
  return clampPan(
    { scale, tx: anchor.x - docPoint.x * scale, ty: anchor.y - docPoint.y * scale },
    doc,
    stage,
  );
}

export function panBy(view: View, dx: number, dy: number, doc: Size, stage: Size): View {
  return clampPan({ ...view, tx: view.tx + dx, ty: view.ty + dy }, doc, stage);
}

// Two-finger pinch: given the view when the gesture started and both
// fingers' start and current stage positions, returns the view that keeps
// the document points originally under the fingers under them now. Scale
// follows the change in finger distance; translation follows the midpoint.
export function pinchView(
  start: View,
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  doc: Size,
  stage: Size,
): View {
  const d0 = Math.max(1, distance(a0, b0));
  const d1 = Math.max(1, distance(a1, b1));
  const m0 = midpoint(a0, b0);
  const m1 = midpoint(a1, b1);
  const fit = fitScale(doc, stage);
  const scale = clamp(start.scale * (d1 / d0), fit * MIN_ZOOM, fit * MAX_ZOOM);
  const docMid = toDoc(start, m0);
  return clampPan({ scale, tx: m1.x - docMid.x * scale, ty: m1.y - docMid.y * scale }, doc, stage);
}

// Keeps at least a quarter of the page (or of the stage, whichever is
// smaller) on screen, so the picture can't be flung out of reach.
export function clampPan(view: View, doc: Size, stage: Size): View {
  const w = doc.width * view.scale;
  const h = doc.height * view.scale;
  const keepX = Math.min(w, stage.width) / 4;
  const keepY = Math.min(h, stage.height) / 4;
  return {
    scale: view.scale,
    tx: clamp(view.tx, keepX - w, stage.width - keepX),
    ty: clamp(view.ty, keepY - h, stage.height - keepY),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
