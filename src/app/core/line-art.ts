// The line art as walls for tap-to-fill (TECHNICAL-DESIGN.md 8): the SVG
// rasterised at document size, its alpha thresholded into a wall mask.
// Runs once when a picture opens. A canvas (not a worker) for now: a
// 2048 page takes well under a second, and fills are disabled until it's
// done.

import { wallsFromRgba } from '../engine/fill';
import { Size } from '../engine/viewport';
import { loadImage } from './export';

export async function lineArtWalls(svgUrl: string, size: Size): Promise<Uint8Array> {
  const img = await loadImage(svgUrl);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // An SVG is rasterised at the size it's drawn, so the walls match the
  // lines on screen exactly.
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const walls = wallsFromRgba(ctx.getImageData(0, 0, size.width, size.height).data);
  canvas.width = canvas.height = 0;
  return walls;
}
