'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis, Job } from './types';

interface Callbacks {
 onStart: () => void;
 onComplete: (result: Analysis, replacedId: string | null) => void;
 onError: (message: string) => void;
 onToast: (message: string) => void;
}

// Starts a server-side analysis job, polls it until it finishes, and supports cancel.
// Callbacks are read through a ref so the poll loop lives exactly as long as the job.
export function useAnalysisJob({maxPages, ...callbacks}: Callbacks & {maxPages: number}) {
 const [job, setJob] = useState<Job | null>(null);
 const [starting, setStarting] = useState(false);
 const replaceTarget = useRef<string | null>(null);
 const handlers = useRef(callbacks);
 useEffect(() => { handlers.current = callbacks; });

 const launch = useCallback(async (urls: string[], replaceId?: string) => {
  handlers.current.onStart(); setStarting(true);
  try {
   const response = await fetch('/api/analyses', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({urls, maxPages})});
   const data = await response.json();
   if (!response.ok) throw new Error(data.error);
   replaceTarget.current = replaceId || null;
   setJob({id: data.id, status: 'running', progress: 1, stage: 'discover', message: 'Starting your analysis agent…', events: []});
  } catch (error) { handlers.current.onError((error as Error).message); }
  finally { setStarting(false); }
 }, [maxPages]);

 useEffect(() => {
  if (!job?.id || job.status !== 'running') return;
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let failures = 0;
  const finish = () => { replaceTarget.current = null; };
  const poll = async () => {
   try {
    const response = await fetch(`/api/analyses/${job.id}`, {signal: controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setJob(data); failures = 0;
    if (data.status === 'complete') { const replaced = replaceTarget.current; finish(); handlers.current.onComplete({...data.result, jobId: data.id}, replaced); return; }
    if (data.status === 'failed') { finish(); handlers.current.onError(data.error); return; }
    if (data.status === 'cancelled') { finish(); return; }
   } catch (error) {
    if (controller.signal.aborted) return;
    if (++failures >= 3) { finish(); handlers.current.onError(`Connection lost: ${(error as Error).message}. Your previous map is preserved.`); setJob(current => current ? {...current, status: 'failed'} : null); return; }
   }
   timer = setTimeout(poll, 1200);
  };
  timer = setTimeout(poll, 300);
  return () => { controller.abort(); clearTimeout(timer); };
 }, [job?.id, job?.status]);

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

 return {job, starting, running: starting || job?.status === 'running', launch, cancel};
}
