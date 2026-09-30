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
  test.setTimeout(150_000);
  await expect(page.getByRole('heading', {name: /your projects/i})).toBeVisible();
  await expect(page.locator('.project-grid').first()).toBeVisible();
  let open = page.getByRole('link', {name: 'Open project'}).first();
  if(!(await open.count())){
    const created=await page.evaluate(async()=>{
      const response=await fetch('/api/analyses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls:['https://raw.githubusercontent.com/chargebee/openapi/main/spec/chargebee_api_v2_pc_v2_spec.json'],maxPages:24})});
      return {status:response.status,data:await response.json()};
    });
    expect(created.status,JSON.stringify(created.data)).toBe(202);
    await expect.poll(async()=>{
      const job=await page.evaluate(async id=>(await fetch(`/api/analyses/${id}`)).json(),created.data.id);
      return job.status==='failed'?`failed: ${job.error}`:job.status;
    },{timeout:120_000,intervals:[1000,2000,3000]}).toBe('complete');
    await page.reload();
    await expect(page.locator('.project-grid').first()).toBeVisible();
    open=page.getByRole('link', {name: 'Open project'}).first();
  }
  await open.click();
  await expect(page).toHaveURL(/analysis=/, {timeout: 45_000});
  await page.getByRole('button', {name: /Scenarios/}).first().click();
  await expect(page).toHaveURL(/tab=scenarios/);
  await page.reload();
  await expect(page.getByText(/How do I create or change/)).toBeVisible({timeout: 45_000});
  await page.getByRole('link', {name: 'All projects'}).click();
  await expect(page.getByRole('heading', {name: /your projects/i})).toBeVisible();
});

test('a new analysis updates progress and opens its map without a refresh', async ({page}) => {
  test.setTimeout(150_000);
  await page.getByRole('textbox', {name: 'API documentation URL'}).fill('https://petstore3.swagger.io/api/v3/openapi.json');
  await page.getByRole('button', {name: /Analyze API/}).click();
  await expect(page.locator('.analysis-progress')).toBeVisible();
  await expect(page.locator('.example-badge.live')).toHaveText('STRUCTURAL MAP', {timeout: 120_000});
  await expect(page).toHaveURL(/analysis=/);
  await expect(page.locator('.analysis-progress')).toHaveCount(0);
});

test('settings show exploration depth and the theme can be switched', async ({page}) => {
  await page.getByRole('radio', {name: 'Dark'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', {name: 'Light'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', {name: /Settings/}).click();
  await expect(page.getByText('Exploration depth')).toBeVisible();
});

test('Try It can request a public HTTPS API', async ({page}) => {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/try', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: 'https://example.com/', method: 'GET'}),
    });
    return {status: response.status, data: await response.json()};
  });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  expect(result.data.status).toBe(200);
  expect(result.data.body).toContain('Example Domain');
});
