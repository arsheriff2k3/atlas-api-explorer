import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { api } from './_generated/api';

const http=httpRouter();
const MAX_FILE=18*1024*1024;

http.route({path:'/upload-analysis',method:'POST',handler:httpAction(async(ctx,request)=>{
 const user=await ctx.auth.getUserIdentity();
 if(!user)return new Response('Unauthorized',{status:401});
 const declared=Number(request.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_FILE)return new Response('Analysis is limited to 18 MB.',{status:413});
 const blob=await request.blob();
 if(blob.size>MAX_FILE)return new Response('Analysis is limited to 18 MB.',{status:413});
 await ctx.runMutation(api.jobs.reserveUpload,{});
 const storageId=await ctx.storage.store(blob);
 return Response.json({storageId});
})});

export default http;
