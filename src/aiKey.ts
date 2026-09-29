'use client';
import { useCallback } from 'react';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

// The user's OpenAI key lives in Convex only as ciphertext the Next.js server
// produced (bound to the user's Clerk ID). The browser moves that ciphertext
// between Convex and the server; it never sees the plaintext key after saving.
export function useAiKey() {
 const {isAuthenticated}=useConvexAuth();
 const convex=useConvex();
 const status=useQuery(api.aiKeys.status,isAuthenticated?{}:'skip');
 const setKey=useMutation(api.aiKeys.set);
 const removeKey=useMutation(api.aiKeys.remove);
 const save=useCallback(async (apiKey:string)=>{
  const response=await fetch('/api/ai-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'The key could not be saved.');
  await setKey({ciphertext:data.ciphertext,last4:data.last4});
 },[setKey]);
 const remove=useCallback(async ()=>{await removeKey()},[removeKey]);
 const ciphertext=useCallback(async ()=>status?.hasKey?await convex.query(api.aiKeys.ciphertext,{}):null,[convex,status?.hasKey]);
 return {status:status??{hasKey:false,last4:null},save,remove,ciphertext};
}
