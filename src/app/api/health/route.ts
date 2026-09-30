import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';

export const dynamic='force-dynamic';
export async function GET(){
 try{
  const url=process.env.NEXT_PUBLIC_CONVEX_URL;
  if(!url)return Response.json({status:'unavailable'},{status:503});
  const status=await new ConvexHttpClient(url).query(api.health.status,{});
  return Response.json({status:status.backendReady?'ready':'backend_unavailable'},{status:status.backendReady?200:503,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({status:'backend_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
