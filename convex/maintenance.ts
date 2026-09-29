import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';

const DAY=24*60*60*1000;

// Deletes stored files no saved analysis points to (e.g. an upload whose save failed).
// Files younger than a day are kept so an in-progress save is never raced.
export const cleanOrphanedFiles=internalMutation({
 args:{cursor:v.optional(v.number())},
 handler:async (ctx,{cursor})=>{
  const cutoff=Date.now()-DAY;
  const files=await ctx.db.system.query('_storage').withIndex('by_creation_time',q=>cursor?q.gt('_creationTime',cursor).lt('_creationTime',cutoff):q.lt('_creationTime',cutoff)).take(100);
  let removed=0;
  for(const file of files){
   const used=await ctx.db.query('analyses').withIndex('by_storageId',q=>q.eq('storageId',file._id)).first();
   if(!used){await ctx.storage.delete(file._id);removed++}
  }
  if(files.length===100)await ctx.scheduler.runAfter(0,internal.maintenance.cleanOrphanedFiles,{cursor:files[files.length-1]._creationTime});
  return {checked:files.length,removed};
 },
});
