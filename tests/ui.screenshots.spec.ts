import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const shotOptions = {
  fullPage: false,
  animations: 'disabled' as const,
  caret: 'hide' as const,
  timeout: 30_000,
};

test.describe('UI 截图回归', () => {
  test('桌面端关键页面', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('main').getByText('Gemini 设置', { exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('desktop-gemini.png', shotOptions);

    const steps = [
      { nav: '第三方中转', waitFor: 'API 设置', shot: 'desktop-openai_proxy.png' },
      { nav: 'Antigravity', waitFor: 'Antigravity', shot: 'desktop-antigravity.png' },
      { nav: 'Kie AI', waitFor: 'Kie AI 设置', shot: 'desktop-kie.png' },
      { nav: '作品集', waitFor: '作品历史', shot: 'desktop-portfolio.png' },
    ] as const;

    for (const s of steps) {
      await page.getByRole('button', { name: s.nav, exact: true }).click();
      await expect(page.getByRole('main').getByText(s.waitFor, { exact: true })).toBeVisible();
      await expect(page).toHaveScreenshot(s.shot, shotOptions);
    }
  });

  test('移动端关键页面', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('main').getByText('Gemini 设置', { exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('mobile-gemini.png', shotOptions);

    const steps = [
      { nav: '中转', waitFor: 'API 设置', shot: 'mobile-openai_proxy.png' },
      { nav: 'AG', waitFor: 'Antigravity', shot: 'mobile-antigravity.png' },
      { nav: 'Kie', waitFor: 'Kie AI 设置', shot: 'mobile-kie.png' },
      { nav: '作品', waitFor: '作品历史', shot: 'mobile-portfolio.png' },
    ] as const;

    for (const s of steps) {
      await page.getByRole('button', { name: s.nav, exact: true }).click();
      await expect(page.getByRole('main').getByText(s.waitFor, { exact: true })).toBeVisible();
      await expect(page).toHaveScreenshot(s.shot, shotOptions);
    }
  });
});
