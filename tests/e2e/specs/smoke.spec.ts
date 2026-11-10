import { expect, test } from '@playwright/test';

test.describe('E2E Duman Testi (P01c)', () => {
  test('caddy kenar servisi erisilebilir ve sayfa yukleniyor', async ({ page }) => {
    const response = await page.goto('/', { timeout: 10000 });
    expect(response).not.toBeNull();
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/E\.D\.A\. Hukuk/);
  });
});
