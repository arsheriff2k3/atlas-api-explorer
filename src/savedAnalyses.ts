'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { del, get } from 'idb-keyval';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import type { Analysis, SavedAnalysis } from './types';
import { isEndpoint } from './types';
import { sourceKeyFor } from './projectSources';

const LEGACY_KEY='atlas-sessions';

// Maps are gzipped before upload (Chargebee: ~19 MB JSON -> ~2 MB). Older uncompressed
// files still open: the gzip signature (1f 8b) decides how a download is read.
async function gzip(text:string):Promise<Blob>{
 if(typeof CompressionStream==='undefined')return new Blob([text],{type:'application/json'});
 return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob().then(blob=>new Blob([blob],{type:'application/gzip'}));
}
export async function readMap(response:Response):Promise<Analysis>{
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]===0x1f&&bytes[1]===0x8b)return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()) as Analysis;
 return JSON.parse(new TextDecoder().decode(bytes)) as Analysis;
}

// Every completed analysis is stored in the signed-in user's Convex account, so a
// project is generated once and reopened from any browser without re-crawling.
export function useSavedAnalyses() {
 const {isAuthenticated}=useConvexAuth();
 const convex=useConvex();
 const rows=useQuery(api.analyses.list,isAuthenticated?{}:'skip');
 const generateUploadUrl=useMutation(api.analyses.generateUploadUrl);
 const saveRow=useMutation(api.analyses.save);
 const removeRow=useMutation(api.analyses.remove);
 const cache=useRef(new Map<string,Analysis>());
 const migration=useRef<Promise<void>|null>(null);
 const [migrated,setMigrated]=useState(false);
 const history=useMemo<SavedAnalysis[]>(()=>(rows||[]).map(({analysisId,...row})=>({sourceKey:row.sourceKey||sourceKeyFor(row.urls),id:analysisId,name:row.name,version:row.version,createdAt:row.createdAt,urls:row.urls,mode:row.mode,canonicalVersion:row.canonicalVersion,entityCount:row.entityCount,operationCount:row.operationCount,dependencyCount:row.dependencyCount})),[rows]);

 const save=useCallback(async (analysis:Analysis,replaceId?:string)=>{
  const {jobId,...data}=analysis;void jobId;
  const uploadUrl=await generateUploadUrl();
  const body=await gzip(JSON.stringify(data));
  const response=await fetch(uploadUrl,{method:'POST',headers:{'Content-Type':body.type},body});
  if(!response.ok)throw new Error('The analysis could not be uploaded.');
  const {storageId}=await response.json() as {storageId:Id<'_storage'>};
  await saveRow({storageId,replaceId:replaceId&&replaceId!==data.id?replaceId:undefined,analysisId:data.id,sourceKey:sourceKeyFor(data.urls),schemaVersion:data.schemaVersion??0,name:data.name,version:data.version,createdAt:data.createdAt,urls:data.urls,mode:data.mode,canonicalVersion:data.coverage?.canonicalVersion??0,entityCount:data.entities.length,operationCount:data.operations.filter(isEndpoint).length,dependencyCount:data.dependencies.length});
  cache.current.set(data.id,analysis);
  if(replaceId)cache.current.delete(replaceId);
 },[generateUploadUrl,saveRow]);

 const open=useCallback(async (saved:SavedAnalysis)=>{
  const cached=cache.current.get(saved.id);if(cached)return cached;
  const url=await convex.query(api.analyses.fileUrl,{analysisId:saved.id});
  if(!url)throw new Error('This saved analysis is no longer available. Rerun it from its documentation.');
  const response=await fetch(url);
  if(!response.ok)throw new Error('The saved analysis could not be downloaded. Try again.');
  let analysis=await readMap(response);
  // Maps saved by an older engine are upgraded in place (e.g. new ID links), not re-crawled.
  if((analysis.coverage?.canonicalVersion??0)<8||!analysis.schemaVersion){
   try{const normalized=await fetch('/api/analyses/normalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(analysis)});if(normalized.ok){analysis=await normalized.json() as Analysis;void save(analysis).catch(()=>{})}}catch{}
  }
  cache.current.set(saved.id,analysis);
  return analysis;
 },[convex,save]);

 const remove=useCallback(async (id:string)=>{await removeRow({analysisId:id});cache.current.delete(id)},[removeRow]);

 // One-time move of analyses previously kept only in this browser's IndexedDB.
 useEffect(()=>{
  if(!rows||migration.current)return;
  const known=new Set(rows.map(row=>row.analysisId));
  migration.current=(async()=>{
   try{
    const items=await get<Analysis[]>(LEGACY_KEY);
    if(!Array.isArray(items))return;
    let failed=false;
    for(const item of items){if(item.demo||known.has(item.id))continue;try{await save(item)}catch{failed=true}}
    if(!failed)await del(LEGACY_KEY);
   }catch{}
  })().finally(()=>setMigrated(true));
 },[rows,save]);

 return {history,ready:!!rows&&migrated,save,open,remove};
}
