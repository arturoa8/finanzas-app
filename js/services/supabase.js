// Acceso generico a Supabase. Sin logica de negocio.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {authHeader} from './auth.js';
import {SUPABASE_ANON_KEY, SUPABASE_URL} from './supabase-config.js';

// ── Supabase ──────────────────────────────────────────────────────────────
async function sbRespuesta(path,opts={}){
  const headers={apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json',Authorization:await authHeader(),...(opts.headers||{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...opts,headers});
  if(!r.ok){const body=await r.text();let data;try{data=JSON.parse(body);}catch(e){}const error=new Error(data?.message||body||('HTTP '+r.status));error.status=r.status;error.code=data?.code;error.details=data?.details;throw error;}
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
// El primer pedido trae la primera tanda y el total (Prefer: count=exact,
// cabecera Content-Range). Con el total se piden TODAS las tandas restantes a
// la vez: con 10.000 filas tarda lo mismo que dos viajes. El paso es lo que
// devolvio la primera tanda, no `tanda`: si Supabase bajara max_rows, las
// tandas siguen sin solaparse.
//
// Si al terminar no cuadra con el total (se agrego o borro algo a mitad de la
// carga, un corte de red), reintenta una vez y si sigue sin cuadrar lanza un
// error con incompleto=true: es preferible un aviso a mostrar saldos
// calculados sobre datos parciales.
//
// El orden de `path` debe terminar en una columna unica (id): con empates,
// una tanda podria repetir una fila y saltarse otra.
export async function sbFetchTodo(path,tanda=1000){
  const sep=path.includes('?')?'&':'?';
  const pedir=(desde,conteo)=>sbRespuesta(`${path}${sep}limit=${tanda}&offset=${desde}`,conteo?{headers:{Prefer:'count=exact'}}:{});
  let filas=[],total=null;
  for(let intento=0;intento<2;intento++){
    const r=await pedir(0,true);
    const m=/\/(\d+)$/.exec(r.headers.get('content-range')||'');
    total=m?Number(m[1]):null;
    filas=await r.json();
    if(total===null){
      // Sin total (cabecera no expuesta): continuar hasta una tanda vacía,
      // aunque el servidor limite cada respuesta a menos de `tanda`.
      let parte=filas;
      while(parte.length){parte=await (await pedir(filas.length,false)).json();filas.push(...parte);}
    }
    const paso=filas.length;
    if(paso>0&&paso<total){
      const desdes=[];for(let d=paso;d<total;d+=paso)desdes.push(d);
      const partes=await Promise.all(desdes.map(d=>pedir(d,false).then(x=>x.json())));
      partes.forEach(p=>filas.push(...p));
    }
    const ids=filas.map(f=>f.id).filter(id=>id!==undefined&&id!==null);
    const distintas=new Set(ids).size===ids.length;
    if(distintas&&(total===null||filas.length===total))return filas;
  }
  const e=new Error('No se cargaron todos tus datos de forma consistente. Recarga la página antes de registrar movimientos.');
  e.incompleto=true;
  throw e;
}

export const sbSelectTodo=(table,query='?select=*')=>sbFetchTodo(table+query);

export const sbSelect=(table,query='?select=*')=>sbFetch(table+query);

export const sbInsert=(table,body)=>sbFetch(table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}).then(rows=>Array.isArray(body)?rows:rows[0]);

export const sbUpdate=(table,id,patch,idCol='id')=>sbFetch(`${table}?${idCol}=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)}).then(rows=>rows[0]);

export const sbDelete=(table,id,idCol='id')=>sbFetch(`${table}?${idCol}=eq.${encodeURIComponent(id)}`,{method:'DELETE'});
