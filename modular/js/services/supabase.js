// Acceso generico a Supabase. Sin logica de negocio.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {authHeader} from './auth.js';
import {SUPABASE_ANON_KEY, SUPABASE_URL} from './supabase-config.js';

// ── Supabase ──────────────────────────────────────────────────────────────
export async function sbFetch(path,opts={}){
  const headers={apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json',Authorization:await authHeader(),...(opts.headers||{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...opts,headers});
  if(!r.ok){let msg;try{msg=(await r.json()).message;}catch(e){msg=await r.text().catch(()=>r.statusText);}throw new Error(msg||('HTTP '+r.status));}
  const ct=r.headers.get('content-type')||'';
  return ct.includes('application/json')?r.json():null;
}

export const sbSelect=(table,query='?select=*')=>sbFetch(table+query);

export const sbInsert=(table,body)=>sbFetch(table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}).then(rows=>Array.isArray(body)?rows:rows[0]);

export const sbUpdate=(table,id,patch,idCol='id')=>sbFetch(`${table}?${idCol}=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)}).then(rows=>rows[0]);

export const sbDelete=(table,id,idCol='id')=>sbFetch(`${table}?${idCol}=eq.${encodeURIComponent(id)}`,{method:'DELETE'});
