'use client';
import { useEffect } from 'react';

// Shown instead of a blank page when the workspace crashes. Saved projects are in
// the user's account, so retrying or reloading loses nothing.
export default function WorkspaceError({error,retry}:{error:Error&{digest?:string};retry:()=>void}){
 useEffect(()=>{console.error('[apipassage] workspace crashed',error)},[error]);
 return <main className="auth-page"><div className="crash-card" role="alert"><h1>Something went wrong.</h1><p>The workspace hit an unexpected error. Your saved projects are safe in your account.</p>{error.digest&&<p className="small muted">Reference: {error.digest}</p>}<div><button className="primary-button" onClick={()=>retry()}>Try again</button><button className="outline-button" onClick={()=>window.location.replace(window.location.origin)}>Reload projects</button></div></div></main>;
}
