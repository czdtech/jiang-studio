import { test, expect } from '@playwright/test';

test('基础导航与页面渲染', async ({ page }) => {
  await page.goto('/');

  const tabs = [
    { nav: 'Gemini 官方', heading: 'Gemini 设置' },
    { nav: '第三方中转', heading: 'OpenAI Compatible' },
    { nav: 'Antigravity', heading: 'Antigravity Tools' },
    { nav: 'Kie AI', heading: 'Kie AI 设置' },
    { nav: '作品集', heading: '作品历史' },
  ] as const;

  for (const t of tabs) {
    await page.getByRole('button', { name: t.nav, exact: true }).click({ force: true });
    await expect(page.getByRole('main').getByText(t.heading, { exact: true })).toBeVisible();
  }
});

test('新手引导与禁用逻辑（Gemini）', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('示例提示词（点击填入）', { exact: true })).toBeVisible();
  await expect(page.getByText('未填写 API Key，无法生成。', { exact: true })).toBeVisible();

  const generateBtn = page.getByRole('button', { name: /^生成/ });
  await expect(generateBtn).toBeDisabled();

  await page.getByRole('button', { name: '随机一个', exact: true }).click({ force: true });
  await expect(generateBtn).toBeDisabled(); // 仍需 API Key 才可生成
});
