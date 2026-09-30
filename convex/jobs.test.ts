/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules=import.meta.glob(['./**/*.ts','!./**/*.test.ts']);
const owner=(t:ReturnType<typeof convexTest>)=>t.withIdentity({subject:'owner',issuer:'https://test.example'});
const other=(t:ReturnType<typeof convexTest>)=>t.withIdentity({subject:'other',issuer:'https://test.example'});
const createArgs=(jobId:string)=>({jobId,urls:['https://example.com/openapi.json'],maxPages:8});

test('jobs are private and remain queryable after a worker claims them',async()=>{
 const t=convexTest(schema,modules),alice=owner(t),bob=other(t);
 const id='00000000-0000-4000-8000-000000000001';
 await alice.mutation(api.jobs.create,createArgs(id));
 expect(await bob.query(api.jobs.get,{jobId:id})).toBeNull();
 const claimed=await t.mutation(internal.jobs.claimNext,{leaseToken:'worker-one',jobId:id});
 expect(claimed?.jobId).toBe(id);
 expect((await alice.query(api.jobs.get,{jobId:id}))?.status).toBe('running');
 await expect(bob.mutation(api.jobs.cancel,{jobId:id})).rejects.toThrow();
 await alice.mutation(api.jobs.cancel,{jobId:id});
 expect(await t.mutation(internal.jobs.heartbeat,{jobId:id,leaseToken:'worker-one',stage:'read',progress:30,message:'Reading'})).toBe(false);
});

test('creating an analysis schedules a Convex action',async()=>{
 const t=convexTest(schema,modules),alice=owner(t);
 const id='00000000-0000-4000-8000-000000000007';
 await alice.mutation(api.jobs.create,createArgs(id));
 const scheduled=await t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
 expect(scheduled.some(row=>row.name==='analyze:run'&&(row.args as [{jobId:string}])[0]?.jobId===id)).toBe(true);
});

test('a stale worker cannot overwrite a reclaimed job',async()=>{
 const t=convexTest(schema,modules),alice=owner(t);
 const id='00000000-0000-4000-8000-000000000002';
 await alice.mutation(api.jobs.create,createArgs(id));
 await t.mutation(internal.jobs.claimNext,{leaseToken:'old-worker'});
 await t.run(async ctx=>{
  const row=await ctx.db.query('analysisJobs').withIndex('by_jobId',q=>q.eq('jobId',id)).unique();
  if(!row)throw new Error('Missing job');
  await ctx.db.patch('analysisJobs',row._id,{leaseUntil:Date.now()-1});
 });
 const reclaimed=await t.mutation(internal.jobs.claimNext,{leaseToken:'new-worker'});
 expect(reclaimed?.jobId).toBe(id);
 expect(await t.mutation(internal.jobs.heartbeat,{jobId:id,leaseToken:'old-worker',stage:'read',progress:90,message:'Late update'})).toBe(false);
 expect(await t.mutation(internal.jobs.heartbeat,{jobId:id,leaseToken:'new-worker',stage:'read',progress:50,message:'Current update'})).toBe(true);
 expect((await alice.query(api.jobs.get,{jobId:id}))?.progress).toBe(50);
});

test('per-user concurrency limit is enforced',async()=>{
 const t=convexTest(schema,modules),alice=owner(t);
 await alice.mutation(api.jobs.create,createArgs('00000000-0000-4000-8000-000000000003'));
 await alice.mutation(api.jobs.create,createArgs('00000000-0000-4000-8000-000000000004'));
 await expect(alice.mutation(api.jobs.create,createArgs('00000000-0000-4000-8000-000000000005'))).rejects.toThrow('Two analyses');
});

test('completion saves the result for its owner before reporting success',async()=>{
 const t=convexTest(schema,modules),alice=owner(t),bob=other(t);
 const id='00000000-0000-4000-8000-000000000006';
 await alice.mutation(api.jobs.create,createArgs(id));
 await t.mutation(internal.jobs.claimNext,{leaseToken:'worker-one'});
 const storageId=await t.run(ctx=>ctx.storage.store(new Blob(['{"id":"result"}'],{type:'application/json'})));
 const saved=await t.mutation(internal.jobs.complete,{
  jobId:id,leaseToken:'worker-one',storageId,analysisId:'result',sourceKey:'https://example.com/openapi.json',
  schemaVersion:1,name:'Example',version:'1',createdAt:new Date().toISOString(),urls:['https://example.com/openapi.json'],
  mode:'structural',canonicalVersion:10,entityCount:1,operationCount:2,dependencyCount:0,
 });
 expect(saved).toBe(true);
 expect((await alice.query(api.jobs.get,{jobId:id}))?.status).toBe('complete');
 expect((await alice.query(api.analyses.list,{})).map(row=>row.analysisId)).toEqual(['result']);
 expect(await bob.query(api.jobs.get,{jobId:id})).toBeNull();
 expect(await bob.query(api.analyses.list,{})).toEqual([]);
});

test('Try It limits one in-flight request per account',async()=>{
 const t=convexTest(schema,modules),alice=owner(t),bob=other(t);
 await alice.mutation(api.jobs.reserveTry,{});
 await expect(alice.mutation(api.jobs.reserveTry,{})).rejects.toThrow('Try It is busy');
 await bob.mutation(api.jobs.reserveTry,{});
 await alice.mutation(api.jobs.releaseTry,{});
});

test('browser uploads are limited per account each day',async()=>{
 const t=convexTest(schema,modules),alice=owner(t),bob=other(t);
 for(let i=0;i<40;i++)await alice.mutation(api.jobs.reserveUpload,{});
 await expect(alice.mutation(api.jobs.reserveUpload,{})).rejects.toThrow('Daily upload limit reached');
 await bob.mutation(api.jobs.reserveUpload,{});
});
