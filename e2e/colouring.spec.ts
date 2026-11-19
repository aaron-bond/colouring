import { Page, expect, test } from '@playwright/test';

// Drives the colouring screen with synthetic pointer events (pen, touch,
// mouse), so the input rules run in real browser engines: Playwright
// can't produce real stylus or multi-touch input, but the handlers only
// see PointerEvents either way.

type PointerKind = 'pen' | 'touch' | 'mouse';

async function pointer(page: Page, type: string, kind: PointerKind, id: number, x: number, y: number, pressure = 0.7) {
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
          pressure: a.kind === 'pen' ? a.pressure : 0.5,
          clientX: rect.left + a.x,
          clientY: rect.top + a.y,
        }),
      );
    },
    { type, kind, id, x, y, pressure },
  );
}

async function stroke(
  page: Page,
  kind: PointerKind,
  id: number,
  from: [number, number],
  to: [number, number],
  pressure = 0.7,
) {
  await pointer(page, 'pointerdown', kind, id, ...from, pressure);
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    await pointer(page, 'pointermove', kind, id, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, pressure);
  }
  await pointer(page, 'pointerup', kind, id, ...to, pressure);
}

// Counts non-transparent pixels on the committed colour layer.
async function paintedPixels(page: Page): Promise<number> {
  return page.locator('canvas.colour').evaluate((c: HTMLCanvasElement) => {
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

async function open(page: Page, pictureId: string) {
  await page.goto(`#/colour/new/${pictureId}`);
  await expect(page.locator('.page')).toHaveClass(/ready/);
  await expect(page.locator('.page')).toHaveAttribute('style', /scale/);
}

test('the library lists the pictures and opens one', async ({ page }) => {
  await page.goto('');
  await page.getByRole('link', { name: /Tulips/ }).click();
  await expect(page).toHaveURL(/#\/colour\/new\/tulips$/);
  await expect(page.locator('.page')).toHaveClass(/ready/);
  // Portrait art makes a portrait document (2048 long side, 3:4).
  const size = await page.locator('canvas.colour').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(size).toEqual([1536, 2048]);
});

test('every picture in the catalogue opens at its document size', async ({ page }) => {
  const expected: Record<string, [number, number]> = {
    'lotus-mandala': [3072, 3072],
    tulips: [1536, 2048],
    butterfly: [2048, 2048],
    'princess-castle': [1536, 2048],
    'moon-and-stars': [2048, 1536],
    blank: [2048, 1536],
  };
  for (const [id, size] of Object.entries(expected)) {
    // Tap the plate in the library, as in the app: going straight from
    // one picture's URL to another's would keep the same screen.
    await page.goto('');
    await page.locator(`a.plate[href$="/colour/new/${id}"]`).click();
    await expect(page.locator('.page')).toHaveClass(/ready/);
    expect(await page.locator('canvas.colour').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual(size);
  }
});

test('the index tabs filter the plates', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('link', { name: /Tulips/ })).toBeVisible();
  await page.getByRole('link', { name: 'Mandalas' }).click();
  await expect(page).toHaveURL(/category=mandalas/);
  await expect(page.getByRole('heading', { name: 'Mandalas' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Lotus mandala/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Tulips/ })).toHaveCount(0);
  // Tapping the open tab again shows every plate.
  await page.getByRole('link', { name: 'Mandalas' }).click();
  await expect(page.getByRole('link', { name: /Tulips/ })).toBeVisible();
});

test('an unknown picture goes back to the library', async ({ page }) => {
  await page.goto('#/colour/new/no-such-picture');
  await expect(page).toHaveURL(/#\/$/);
});

test.describe('on the colouring screen', () => {
  test.beforeEach(async ({ page }) => open(page, 'lotus-mandala'));

  test('a pen stroke is committed and can be undone and redone', async ({ page }) => {
    const [cx, cy] = await stageCentre(page);
    await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy + 40]);
    const painted = await paintedPixels(page);
    expect(painted).toBeGreaterThan(1000);

    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await paintedPixels(page)).toBe(0);
    await page.getByRole('button', { name: 'Redo' }).click();
    expect(await paintedPixels(page)).toBe(painted);

    await page.keyboard.press('Control+z');
    expect(await paintedPixels(page)).toBe(0);
    await page.keyboard.press('Control+Shift+z');
    expect(await paintedPixels(page)).toBe(painted);
  });

  test('pressing harder draws a wider line', async ({ page }) => {
    const [cx, cy] = await stageCentre(page);
    await page.getByRole('button', { name: 'Size 5' }).click();
    await stroke(page, 'pen', 1, [cx - 150, cy - 60], [cx + 150, cy - 60], 0.15);
    const light = await paintedPixels(page);
    await page.getByRole('button', { name: 'Undo' }).click();
    await stroke(page, 'pen', 2, [cx - 150, cy - 60], [cx + 150, cy - 60], 0.9);
    const hard = await paintedPixels(page);
    expect(hard).toBeGreaterThan(light * 1.6);
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

  test('a palm that lands before the pen leaves no paint', async ({ page }) => {
    const [cx, cy] = await stageCentre(page);
    // No pen seen yet, so the palm starts a finger stroke...
    await pointer(page, 'pointerdown', 'touch', 1, cx + 120, cy + 80);
    await pointer(page, 'pointermove', 'touch', 1, cx + 140, cy + 90);
    // ...which the pen cancels.
    await stroke(page, 'pen', 2, [cx - 100, cy], [cx - 60, cy]);
    await pointer(page, 'pointerup', 'touch', 1, cx + 140, cy + 90);
    const withPen = await paintedPixels(page);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await paintedPixels(page)).toBe(0);
    expect(withPen).toBeGreaterThan(0);
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
    for (let i = 1; i <= 5; i++) {
      await pointer(page, 'pointermove', 'touch', 1, cx - 60 - i * 20, cy);
      await pointer(page, 'pointermove', 'touch', 2, cx + 50 + i * 20, cy);
    }
    await pointer(page, 'pointerup', 'touch', 1, cx - 160, cy);
    await pointer(page, 'pointerup', 'touch', 2, cx + 150, cy);

    expect(await paintedPixels(page)).toBe(0);
    await expect.poll(() => pageTransform(page)).not.toBe(before);
  });

  test('choosing a paint switches back from the eraser', async ({ page }) => {
    await page.getByRole('button', { name: 'Eraser' }).click();
    await page.getByRole('button', { name: 'sky', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pencil' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('img', { name: 'Current colour: sky' })).toBeVisible();
  });

  test('leaving with colour on the page asks first', async ({ page }) => {
    // Nothing drawn: no question.
    await page.getByRole('link', { name: 'Back to the guide' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await open(page, 'lotus-mandala');

    const [cx, cy] = await stageCentre(page);
    await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy]);
    await page.getByRole('link', { name: 'Back to the guide' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave this plate?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep colouring' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/colour\/new\/lotus-mandala/);
    expect(await paintedPixels(page)).toBeGreaterThan(1000);

    await page.getByRole('link', { name: 'Back to the guide' }).click();
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('finishing shows the picture to download, and colouring can carry on', async ({ page }) => {
    const [cx, cy] = await stageCentre(page);
    await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy]);
    const painted = await paintedPixels(page);
    await page.getByRole('button', { name: 'Finished' }).click();
    const finished = page.getByRole('dialog', { name: 'Lovely work!' });
    await expect(finished).toBeVisible();
    await expect(finished.getByRole('img', { name: /Your coloured Lotus mandala/ })).toBeVisible();

    const downloading = page.waitForEvent('download');
    await finished.getByRole('button', { name: /Download PNG/ }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toBe('lotus-mandala.png');
    await expect(page.getByRole('status')).toContainText('downloaded');

    await finished.getByRole('button', { name: 'Keep colouring' }).click();
    await expect(finished).toBeHidden();
    expect(await paintedPixels(page)).toBe(painted);

    // From Finished, going back to the guide doesn't ask again.
    await page.getByRole('button', { name: 'Finished' }).click();
    await finished.getByRole('button', { name: 'Back to the guide' }).click();
    await expect(page).toHaveURL(/#\/$/);
  });

  test('resizing (rotating) keeps the colour and refits the page', async ({ page }) => {
    const [cx, cy] = await stageCentre(page);
    await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy]);
    const painted = await paintedPixels(page);
    const before = await pageTransform(page);
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect.poll(() => pageTransform(page)).not.toBe(before);
    expect(await paintedPixels(page)).toBe(painted);
  });
});

test.describe('the debug readout', () => {
  test('is hidden until the gear is tapped', async ({ page }) => {
    await open(page, 'lotus-mandala');
    const readout = page.getByRole('button', { name: 'Copy diagnostics report' });
    await expect(readout).toHaveCount(0);
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await expect(readout).toBeVisible();
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await expect(readout).toHaveCount(0);
  });

  test('copies a report that logs strokes', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'lotus-mandala');
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const [cx, cy] = await stageCentre(page);
    await stroke(page, 'pen', 1, [cx - 100, cy], [cx + 100, cy], 0.4);
    await page.getByRole('button', { name: 'Copy diagnostics report' }).click();
    await expect(page.getByText(/copied \d+ lines/)).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain('## Device');
    expect(report).toMatch(/^# Colouring report · .+ · (desktop|tablet|phone) · /);
    expect(report).toMatch(/\ndevice: .+ · (desktop|tablet|phone)\n/);
    expect(report).toMatch(/stroke pencil by pen · \d+ samples/);
    expect(report).toContain('document 3072×3072');
  });

  test('pen haptics pulse while drawing, and stay off for fingers', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: number[] = [];
      (window as unknown as { vibrateCalls: number[] }).vibrateCalls = calls;
      navigator.vibrate = (pattern: VibratePattern) => {
        calls.push(Number(pattern));
        return true;
      };
    });
    await open(page, 'lotus-mandala');
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await page.getByRole('button', { name: 'Tuning' }).click();
    await page.getByRole('radio', { name: 'grain' }).check();
    const calls = () => page.evaluate(() => (window as unknown as { vibrateCalls: number[] }).vibrateCalls.length);

    const [cx, cy] = await stageCentre(page);
    await stroke(page, 'touch', 1, [cx - 150, cy - 80], [cx + 150, cy - 80]);
    expect(await calls()).toBe(0);
    await stroke(page, 'pen', 2, [cx - 150, cy], [cx + 150, cy]);
    expect(await calls()).toBeGreaterThan(3);
    await expect(page.locator('dd', { hasText: /grain · \d+ pulses last stroke · vibrate ok/ })).toBeVisible();
  });

  test('a long diagonal stroke only stores the tiles it crosses', async ({ page }) => {
    await open(page, 'lotus-mandala');
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const box = (await page.locator('.stage').boundingBox())!;
    const pageBox = (await page.locator('.page').boundingBox())!;
    const from: [number, number] = [pageBox.x - box.x + 10, pageBox.y - box.y + 10];
    const to: [number, number] = [pageBox.x - box.x + pageBox.width - 10, pageBox.y - box.y + pageBox.height - 10];
    await stroke(page, 'pen', 1, from, to);
    // The bounding box would be the whole 3072² page: 36 MB.
    const undo = page.locator('dt', { hasText: 'undo' }).locator('xpath=following-sibling::dd[1]');
    await expect(undo).toContainText('1 steps');
    const mb = Number(/([\d.]+) MB/.exec((await undo.textContent())!)![1]);
    expect(mb).toBeLessThan(12);
  });
});
