import { clerkSetup } from '@clerk/testing/playwright';

// Issues a Clerk testing token so automated browsers pass bot protection.
export default async function globalSetup() {
  if (process.env.CLERK_SECRET_KEY) await clerkSetup();
}
