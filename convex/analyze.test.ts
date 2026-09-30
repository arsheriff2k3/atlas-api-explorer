/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

vi.mock('../server/agent.js',()=>({runAnalysis:vi.fn(async(urls:string[])=>({
 id:'action-result',name:'Test API',version:'1',createdAt:new Date().toISOString(),urls,
 entities:[],operations:[],dependencies:[],coverage:{canonicalVersion:10},mode:'structural',schemaVersion:1,
}))}));

const modules=import.meta.glob(['./**/*.ts','!./**/*.test.ts']);

test('a scheduled Node action completes and saves its project',async()=>{
 const t=convexTest(schema,modules);
 const user=t.withIdentity({subject:'owner',issuer:'https://test.example'});
 const jobId='00000000-0000-4000-8000-000000000008';
 await user.mutation(api.jobs.create,{jobId,urls:['https://example.com/openapi.json'],maxPages:8});
 await t.action(internal.analyze.run,{jobId});
 expect((await user.query(api.jobs.get,{jobId}))?.status).toBe('complete');
 expect((await user.query(api.analyses.list,{})).map(row=>row.analysisId)).toEqual(['action-result']);
});
