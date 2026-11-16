import { Page, expect, test } from '@playwright/test';

// Drives the spike with synthetic pointer events (pen, touch, mouse), so
// the input rules run in real browser engines: Playwright can't produce
// real stylus or multi-touch input, but the handlers only see
// PointerEvents either way.

type PointerKind = 'pen' | 'touch' | 'mouse';

async function pointer(page: Page, type: string, kind: PointerKind, id: number, x: number, y: number) {
  await page.locator('.stage').evaluate(
    (el, a) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(a.type, {
          bubbles: true,
          cancelable: true,
          pointerId: a.id,
          pointerType: a.kind,
          isPrimary: true,
          button: a.type === 'pointermove' ? -1 : 0,
          buttons: a.type === 'pointerup' ? 0 : 1,
          pressure: a.kind === 'pen' ? 0.7 : 0.5,
          clientX: rect.left + a.x,
          clientY: rect.top + a.y,
        }),
      );
    },
    { type, kind, id, x, y },
  );
}

async function stroke(page: Page, kind: PointerKind, id: number, from: [number, number], to: [number, number]) {
  await pointer(page, 'pointerdown', kind, id, ...from);
  for (let i = 1; i <= 10; i++) {
    await pointer(page, 'pointermove', kind, id, from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10);
  }
  await pointer(page, 'pointerup', kind, id, ...to);
}

// Counts non-transparent pixels on the committed colour layer.
async function paintedPixels(page: Page): Promise<number> {
  return page.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
}

async function pageTransform(page: Page): Promise<string> {
  return page.locator('.page').evaluate((el: HTMLElement) => el.style.transform);
}

async function stageCentre(page: Page): Promise<[number, number]> {
  const box = (await page.locator('.stage').boundingBox())!;
  return [box.width / 2, box.height / 2];
}

test.beforeEach(async ({ page }) => {
  await page.goto('#/spike');
  await expect(page.locator('.page')).toHaveAttribute('style', /scale/);
});

test('the library links to the spike', async ({ page }) => {
  await page.goto('');
  await page.getByRole('link', { name: /drawing spike/ }).click();
  await expect(page).toHaveURL(/#\/spike$/);
});

test('a pen stroke is committed and can be undone and redone', async ({ page }) => {
  const [cx, cy] = await stageCentre(page);
  await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy + 40]);
  const painted = await paintedPixels(page);
  expect(painted).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await paintedPixels(page)).toBe(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await paintedPixels(page)).toBe(painted);
});

test('the eraser removes colour', async ({ page }) => {
  const [cx, cy] = await stageCentre(page);
  await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy]);
  const before = await paintedPixels(page);
  await page.getByRole('button', { name: 'Eraser' }).click();
  await stroke(page, 'pen', 2, [cx - 100, cy], [cx + 100, cy]);
  expect(await paintedPixels(page)).toBeLessThan(before / 10);
});

test('palm rejection: once a pen is used, a finger pans instead of drawing', async ({ page }) => {
  const [cx, cy] = await stageCentre(page);
  await stroke(page, 'pen', 1, [cx, cy], [cx + 10, cy]);
  const painted = await paintedPixels(page);
  const before = await pageTransform(page);

  await stroke(page, 'touch', 2, [cx - 150, cy - 100], [cx - 50, cy]);
  expect(await paintedPixels(page)).toBe(painted);
  await expect.poll(() => pageTransform(page)).not.toBe(before);
});

test('without a pen, a finger draws', async ({ page }) => {
  const [cx, cy] = await stageCentre(page);
  await stroke(page, 'touch', 1, [cx - 100, cy], [cx + 100, cy]);
  expect(await paintedPixels(page)).toBeGreaterThan(1000);
});

test('a second finger turns a stroke into a pinch and leaves no paint', async ({ page }) => {
  const [cx, cy] = await stageCentre(page);
  const before = await pageTransform(page);
  await pointer(page, 'pointerdown', 'touch', 1, cx - 50, cy);
  await pointer(page, 'pointermove', 'touch', 1, cx - 60, cy);
  await pointer(page, 'pointerdown', 'touch', 2, cx + 50, cy);
  // Spread the fingers apart: zoom in.
  for (let i = 1; i <= 5; i++) {
    await pointer(page, 'pointermove', 'touch', 1, cx - 60 - i * 20, cy);
    await pointer(page, 'pointermove', 'touch', 2, cx + 50 + i * 20, cy);
  }
  await pointer(page, 'pointerup', 'touch', 1, cx - 160, cy);
  await pointer(page, 'pointerup', 'touch', 2, cx + 150, cy);

  expect(await paintedPixels(page)).toBe(0);
  await expect.poll(() => pageTransform(page)).not.toBe(before);
});

test('PNG encoding in a worker reports a result', async ({ page }) => {
  const [cx, cy] = await stageCentre(page);
  await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy]);
  await page.getByRole('button', { name: 'Encode PNG' }).click();
  await expect(page.locator('.hud')).toContainText(/PNG \d+ ms \(worker\)/, { timeout: 20_000 });
});
