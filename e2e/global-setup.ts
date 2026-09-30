import { clerkSetup } from '@clerk/testing/playwright';

// Issues a Clerk testing token so automated browsers pass bot protection.
export default async function globalSetup() {
  if(process.env.E2E_REQUIRE_AUTH==='1'&&(!process.env.E2E_CLERK_USER_EMAIL||!process.env.E2E_CLERK_USER_2_EMAIL||!process.env.CLERK_SECRET_KEY))throw new Error('Launch browser tests require two Clerk test users and CLERK_SECRET_KEY.');
  if (process.env.CLERK_SECRET_KEY) await clerkSetup();
}
