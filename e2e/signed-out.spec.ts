import { expect, test } from '@playwright/test';

test('signed-out visitors are sent to sign-in and the API refuses them', async ({page, request}) => {
  await page.goto('/?analysis=anything&tab=scenarios');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', {name: /sign in/i})).toBeVisible();
  // Signed-out API calls are redirected or refused; the handler never runs.
  const response = await request.post('/api/ask', {data: {question: 'hi'}, maxRedirects: 0});
  expect(response.status() === 401 || response.status() === 404 || (response.status() >= 300 && response.status() < 400)).toBe(true);
  expect(response.headers()['content-type'] || '').not.toContain('application/json');
});

test('the sign-in page is usable by keyboard', async ({page}) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('button', {name: 'Continue', exact: true})).toBeVisible();
  // Tab until focus reaches the page (dev builds add a Next.js dev-tools button first).
  let focused = '';
  for (let i = 0; i < 6 && !['A', 'BUTTON', 'INPUT'].includes(focused); i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.closest('main') ? document.activeElement.tagName : '');
  }
  expect(['A', 'BUTTON', 'INPUT']).toContain(focused);
});
