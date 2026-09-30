'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Analysis, Job } from './types';
import { readMap } from './savedAnalyses';

interface Callbacks {
 onStart: () => void;
 onComplete: (result: Analysis, replacedId: string | null, previousResultUrl: string | null) => void;
 onError: (message: string) => void;
 onToast: (message: string) => void;
}

// Convex publishes job changes as they happen, including progress and completion.
// Callbacks are read through a ref so an in-flight job uses the latest handlers.
export function useAnalysisJob({maxPages, ...callbacks}: Callbacks & {maxPages: number}) {
 const [job, setJob] = useState<Job | null>(null);
 const [starting, setStarting] = useState(false);
 const replaceTarget = useRef<string | null>(null);
 const openedJob = useRef<string | null>(null);
 const handlers = useRef(callbacks);
 useEffect(() => { handlers.current = callbacks; });
 useEffect(()=>{let active=true;void fetch('/api/analyses').then(response=>response.ok?response.json():null).then(data=>{if(active&&data?.id)setJob(current=>current||data)}).catch(()=>{});return()=>{active=false}},[]);
 const liveJob=useQuery(api.jobs.get,job?.id?{jobId:job.id}:'skip');
 useEffect(()=>{if(liveJob&&liveJob.id===job?.id)setJob(liveJob)},[liveJob,job?.id]);

 const launch = useCallback(async (urls: string[], replaceId?: string) => {
  handlers.current.onStart(); setStarting(true);
  try {
   const response = await fetch('/api/analyses', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({urls, maxPages})});
   const data = await response.json();
   if (!response.ok) throw new Error(data.error);
   replaceTarget.current = replaceId || null;
   openedJob.current = null;
   setJob({id: data.id, status: 'queued', progress: 0, stage: 'queued', message: 'Waiting for analysis', events: []});
  } catch (error) { handlers.current.onError((error as Error).message); }
  finally { setStarting(false); }
 }, [maxPages]);

 useEffect(() => {
  if(!job?.id||!['complete','failed','cancelled'].includes(job.status)||openedJob.current===job.id)return;
  openedJob.current=job.id;
  if(job.status==='failed'){replaceTarget.current=null;handlers.current.onError(job.error||'Analysis failed.');return}
  if(job.status==='cancelled'){replaceTarget.current=null;return}
  const controller=new AbortController();
  const open=async()=>{
   try{
    if(!job.resultUrl)throw new Error('The completed analysis file is unavailable.');
    const response=await fetch(job.resultUrl,{signal:controller.signal});
    if(!response.ok)throw new Error('The completed analysis could not be downloaded.');
    const result=await readMap(response);
    if(controller.signal.aborted)return;
    const replaced=replaceTarget.current;replaceTarget.current=null;
    handlers.current.onComplete({...result,jobId:job.id},replaced,job.previousResultUrl||null);
   }catch(error){
    if(!controller.signal.aborted)handlers.current.onError(`Analysis finished, but the map could not open: ${(error as Error).message} Reload to open it from your projects.`);
   }
  };
  void open();
  return()=>controller.abort();
 },[job?.id,job?.status,job?.error,job?.resultUrl,job?.previousResultUrl]);

 const cancel = useCallback(async () => {
  if (!job) return;
  try {
   const response = await fetch(`/api/analyses/${job.id}`, {method: 'DELETE'});
   if (!response.ok) throw new Error();
   replaceTarget.current = null;
   setJob(current => current ? {...current, status: 'cancelled'} : null);
   handlers.current.onToast('Analysis stopped. Your previous map is preserved.');
  } catch { handlers.current.onError('Could not stop the analysis. Try again.'); }
 }, [job]);

 return {job, starting, running: starting || job?.status === 'queued' || job?.status === 'running', launch, cancel};
}
