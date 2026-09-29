import { expect, test } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

// Runs only with a Clerk test user: set E2E_CLERK_USER_EMAIL (an existing user in the
// Clerk *development* instance). The tests read projects and create one flow, then delete it.
const email = process.env.E2E_CLERK_USER_EMAIL;
test.skip(!email, 'Set E2E_CLERK_USER_EMAIL to run signed-in tests.');

test.beforeEach(async ({page}) => {
  await setupClerkTestingToken({page});
  await page.goto('/sign-in');
  await clerk.signIn({page, emailAddress: email!});
  await page.goto('/');
});

test('projects list, open a project, switch tabs, and deep links restore the view', async ({page}) => {
  await expect(page.getByRole('heading', {name: /your projects/i})).toBeVisible();
  const open = page.getByRole('link', {name: 'Open project'}).first();
  test.skip(!(await open.count()), 'The test user has no saved projects.');
  await open.click();
  await expect(page).toHaveURL(/analysis=/);
  await page.getByRole('button', {name: /Scenarios/}).first().click();
  await expect(page).toHaveURL(/tab=scenarios/);
  await page.reload();
  await expect(page.getByText(/How do I create or change/)).toBeVisible();
  await page.getByRole('link', {name: 'All projects'}).click();
  await expect(page.getByRole('heading', {name: /your projects/i})).toBeVisible();
});

test('settings show the AI connection and the theme can be switched', async ({page}) => {
  await page.getByRole('radio', {name: 'Dark'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', {name: 'Light'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', {name: /Settings/}).click();
  await expect(page.getByText('AI reasoning')).toBeVisible();
});
