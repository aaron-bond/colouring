/// <reference lib="webworker" />

// Spike: how long does PNG-encoding a full colour layer take off the main
// thread? (TECHNICAL-DESIGN.md 9.2 / 11). Receives an ImageBitmap,
// replies with the encode time and the PNG size.

addEventListener('message', async ({ data }: MessageEvent<{ bitmap: ImageBitmap }>) => {
  const { bitmap } = data;
  const start = performance.now();
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  postMessage({ ms: performance.now() - start, bytes: blob.size });
});
