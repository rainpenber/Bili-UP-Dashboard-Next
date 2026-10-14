import { test as base, expect, type Page } from '@playwright/test';

function attachStrictApiGuard(page: Page) {
  const faults: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('ZodError')) {
        faults.push(`console: ${text}`);
      }
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/v1/')) return;
    if (res.status() >= 500) faults.push(`HTTP ${res.status()} ${url}`);
  });
  return () => {
    expect(faults, `API/console faults: ${faults.join('; ')}`).toEqual([]);
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const assertClean = attachStrictApiGuard(page);
    await use(page);
    assertClean();
  },
});

export { expect } from '@playwright/test';

export async function expectLocatorInViewport(page: Page, selector: string) {
  await expect
    .poll(
      async () => {
        const box = await page.locator(selector).first().boundingBox();
        const vp = page.viewportSize();
        if (!box || !vp) return false;
        const margin = 4;
        return (
          box.y >= -margin &&
          box.x >= -margin &&
          box.y + box.height <= vp.height + margin &&
          box.x + box.width <= vp.width + margin
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}
