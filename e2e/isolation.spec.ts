import { expect, test } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

const first=process.env.E2E_CLERK_USER_EMAIL;
const second=process.env.E2E_CLERK_USER_2_EMAIL;
test.skip(!first||!second,'Set two Clerk test users to check account isolation.');

test('another user cannot read or cancel a job',async({browser})=>{
 const owner=await browser.newPage();
 const other=await browser.newPage();
 try{
  await setupClerkTestingToken({page:owner});
  await owner.goto('/sign-in');
  await clerk.signIn({page:owner,emailAddress:first!});
  await owner.goto('/');
  await owner.waitForFunction(()=>Boolean((window as unknown as {Clerk?:{session?:unknown}}).Clerk?.session));
  const convexToken=await owner.evaluate(async()=>{try{const token=await (window as unknown as {Clerk:{session:{getToken:()=>Promise<string|null>}}}).Clerk.session.getToken();return token?JSON.parse(atob(token.split('.')[1])).aud||'no audience':'no token'}catch(error){return String(error)}});
  expect(convexToken,'Clerk session token must have the Convex audience.').toBe('convex');
  const response=await owner.request.post('/api/analyses',{data:{urls:['https://example.com/openapi.json'],maxPages:8}});
  const created={status:response.status(),data:await response.json()};
  expect(created.status,JSON.stringify(created.data)).toBe(202);
  const jobId=created.data.id;
  await owner.reload();
  await expect.poll(async()=>(await owner.request.get(`/api/analyses/${jobId}`)).status()).toBe(200);
  await setupClerkTestingToken({page:other});
  await other.goto('/sign-in');
  await clerk.signIn({page:other,emailAddress:second!});
  await other.goto('/');
  await other.waitForFunction(()=>Boolean((window as unknown as {Clerk?:{session?:unknown}}).Clerk?.session));
  const read=await other.request.get(`/api/analyses/${jobId}`);
  const cancel=await other.request.delete(`/api/analyses/${jobId}`);
  const checks=[read.status(),cancel.status()];
  expect(checks).toEqual([404,400]);
  await owner.request.delete(`/api/analyses/${jobId}`);
 }finally{await owner.close();await other.close()}
});
