import { query } from './_generated/server';

export const status=query({args:{},handler:async()=>({backendReady:true})});
