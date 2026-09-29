'use client';
import dynamic from 'next/dynamic';
const App=dynamic(()=>import('../App'),{ssr:false,loading:()=> <div className="boot-screen"><span className="boot-mark">a.</span><p>Opening your API workspace…</p></div>});
export default function Workspace(){return <App/>;}
