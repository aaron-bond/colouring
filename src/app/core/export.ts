// Exporting a finished picture (TECHNICAL-DESIGN.md 3, "Finished"): the
// paper, the fill and colour layers and the line art flattened into one PNG at the
// document's full size, then downloaded or handed to the share sheet.

import { Size } from '../engine/viewport';

export const PAPER = '#FFFDF7';

// `layers` are drawn bottom first (the fill layer, then the colour layer).
export async function flatten(layers: HTMLCanvasElement[], svgUrl: string, size: Size): Promise<Blob> {
  const lines = await loadImage(svgUrl);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.width, size.height);
  for (const layer of layers) ctx.drawImage(layer, 0, 0, size.width, size.height);
  // An SVG is rasterised at the size it's drawn, so the lines stay crisp.
  ctx.drawImage(lines, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('PNG encoding failed');
  return blob;
}

export function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'picture'}.png`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

// Resolves 'shared', or 'cancelled' if the person closed the share sheet.
export async function share(blob: Blob, name: string, title: string): Promise<'shared' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/png' });
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${url}`));
    img.src = url;
  });
}
