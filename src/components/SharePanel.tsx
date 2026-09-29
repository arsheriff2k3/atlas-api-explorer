'use client';
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Check, Copy, Share2, Trash2, X } from 'lucide-react';
import { api } from '../../convex/_generated/api';

export default function SharePanel({sourceKey,onClose}:{sourceKey:string;onClose:()=>void}){
 const links=useQuery(api.shares.listForProject,{sourceKey});
 const create=useMutation(api.shares.create);const revoke=useMutation(api.shares.revoke);
 const [copied,setCopied]=useState<string|null>(null);const [error,setError]=useState('');
 const urlFor=(token:string)=>`${window.location.origin}/?share=${token}`;
 const copy=(token:string)=>{void navigator.clipboard.writeText(urlFor(token));setCopied(token);setTimeout(()=>setCopied(null),1500)};
 return <div className="share-panel" role="dialog" aria-label="Share this project">
  <div className="share-head"><Share2 size={15}/><strong>Share read-only</strong><button className="icon-button" aria-label="Close" onClick={onClose}><X size={14}/></button></div>
  <p>Anyone signed in to APIPassage with the link can view this project’s map, endpoints, and scenarios. They cannot change it; your flows, reviews, and comparisons stay private. The link always shows your latest run.</p>
  {links?.map(link=><div key={link.token} className="share-link"><code>{urlFor(link.token)}</code><button className="icon-button" aria-label="Copy link" onClick={()=>copy(link.token)}>{copied===link.token?<Check size={13}/>:<Copy size={13}/>}</button><button className="icon-button" aria-label="Revoke link" title="Revoke" onClick={()=>{if(window.confirm('Revoke this link? People using it lose access.'))void revoke({token:link.token}).catch(()=>setError('Could not revoke the link.'))}}><Trash2 size={13}/></button></div>)}
  <button className="outline-button" onClick={()=>create({sourceKey}).then(copy).catch((e:Error)=>setError(e.message.includes('Save this project')?'Save this project before sharing it.':'Could not create a link.'))}><Share2 size={13}/>{links?.length?'Create another link':'Create link and copy'}</button>
  {error&&<p className="ai-error">{error}</p>}
 </div>;
}
