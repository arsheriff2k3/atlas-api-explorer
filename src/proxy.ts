import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute=createRouteMatcher(['/sign-in(.*)','/sign-up(.*)','/api/health']);

export default clerkMiddleware(async (auth,request)=>{if(!isPublicRoute(request))await auth.protect()});

export const config={
 matcher:[
  '/',
  '/api/:path*',
  '/sign-in/:path*',
  '/sign-up/:path*',
 ],
};
