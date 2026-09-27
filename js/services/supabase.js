// Acceso generico a Supabase. Sin logica de negocio.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {authHeader} from './auth.js';
import {SUPABASE_ANON_KEY, SUPABASE_URL} from './supabase-config.js';

// ── Supabase ──────────────────────────────────────────────────────────────
async function sbRespuesta(path,opts={}){
  const headers={apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json',Authorization:await authHeader(),...(opts.headers||{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...opts,headers});
  if(!r.ok){let msg;try{msg=(await r.json()).message;}catch(e){msg=await r.text().catch(()=>r.statusText);}throw new Error(msg||('HTTP '+r.status));}
  return r;
}

export async function sbFetch(path,opts={}){
  const r=await sbRespuesta(path,opts);
  const ct=r.headers.get('content-type')||'';
  return ct.includes('application/json')?r.json():null;
}

// Supabase entrega como maximo 1000 filas por respuesta (max_rows) y corta
// el resto EN SILENCIO. sbFetchTodo pide por tandas hasta tener todas.
//
// El final no se decide por "la tanda vino incompleta" sino por el total que
// Supabase informa en Content-Range (Prefer: count=exact): asi funciona
// aunque max_rows cambie. Si al terminar no cuadra con ese total (se agrego
// o borro algo a mitad de la carga, un corte de red), reintenta una vez y
// si sigue sin cuadrar lanza un error con incompleto=true: es preferible un
// aviso a mostrar saldos calculados sobre datos parciales.
//
// El orden de `path` debe terminar en una columna unica (id): con empates,
// una tanda podria repetir una fila y saltarse otra.
export async function sbFetchTodo(path,tanda=1000){
  const sep=path.includes('?')?'&':'?';
  let filas=[],total=null;
  for(let intento=0;intento<2;intento++){
    filas=[];total=null;
    for(;;){
      const r=await sbRespuesta(`${path}${sep}limit=${tanda}&offset=${filas.length}`,total===null?{headers:{Prefer:'count=exact'}}:{});
      if(total===null){const m=/\/(\d+)$/.exec(r.headers.get('content-range')||'');total=m?Number(m[1]):null;}
      const parte=await r.json();
      filas.push(...parte);
      // Sin total (cabecera no expuesta): cae al criterio de tanda incompleta.
      if(parte.length===0||(total===null?parte.length<tanda:filas.length>=total))break;
    }
    if(total===null||filas.length===total)return filas;
  }
  const e=new Error(`No se cargaron todos tus datos (${filas.length} de ${total}). Recarga la página.`);
  e.incompleto=true;
  throw e;
}

export const sbSelectTodo=(table,query='?select=*')=>sbFetchTodo(table+query);

export const sbSelect=(table,query='?select=*')=>sbFetch(table+query);

export const sbInsert=(table,body)=>sbFetch(table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}).then(rows=>Array.isArray(body)?rows:rows[0]);

export const sbUpdate=(table,id,patch,idCol='id')=>sbFetch(`${table}?${idCol}=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)}).then(rows=>rows[0]);

export const sbDelete=(table,id,idCol='id')=>sbFetch(`${table}?${idCol}=eq.${encodeURIComponent(id)}`,{method:'DELETE'});
