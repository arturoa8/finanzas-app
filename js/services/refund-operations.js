// La devolución y su excedente se insertan juntos. Los UUID persistidos
// permiten confirmar un lote cuya respuesta se perdió, sin duplicar dinero.
import {sessionUserId} from './auth.js';
import {sbInsert, sbSelect} from './supabase.js';

let enCurso=null;
const clave=()=>{
  const usuario=sessionUserId();
  if(!usuario)throw new Error('Inicia sesión para guardar la devolución.');
  return 'finanzas.reembolsos-pendientes.v1.'+usuario;
};
const leer=k=>{const raw=localStorage.getItem(k);return raw?JSON.parse(raw):null;};
const sinId=filas=>filas.map(({id,...fila})=>fila);
const coincide=(fila,body)=>['descripcion','categoria','tipo','cuenta','transaccion_origen_id','moneda_original','monto_original','tc','tc_fuente','moneda_destino','monto_destino','cuenta_destino'].every(k=>(fila[k]??null)===(body[k]??null))
  &&Math.round(Number(fila.monto)*100)===Math.round(Number(body.monto)*100)
  &&new Date(fila.fecha).getTime()===new Date(body.fecha).getTime();

async function ejecutar(filas=null){
  const k=clave(),validar=()=>{if(clave()!==k)throw new Error('La sesión cambió durante el guardado.');};
  let op=leer(k);
  if(op&&filas&&JSON.stringify(sinId(op.filas))!==JSON.stringify(sinId(filas)))
    throw Object.assign(new Error('Hay una devolución pendiente de confirmar. Pulsa Actualizar antes de registrar otra.'),{pending:true});
  if(!op){
    if(!filas)return [];
    op={filas:filas.map(fila=>({...fila,id:crypto.randomUUID()}))};
    // Si no se puede guardar la recuperación, no se envía ningún movimiento.
    localStorage.setItem(k,JSON.stringify(op));
  }
  const confirmar=async()=>{
    validar();
    const rows=await sbSelect('transacciones','?select=*&id=in.('+op.filas.map(f=>f.id).join(',')+')');
    validar();
    if(!rows?.length)return null;
    if(rows.length!==op.filas.length||!op.filas.every(body=>rows.some(f=>String(f.id)===body.id&&coincide(f,body))))
      throw new Error('Los movimientos pendientes cambiaron. Revisa la devolución antes de registrar otra.');
    return rows;
  };
  let rechazoInsercion=false;
  try{
    const existentes=await confirmar();
    if(existentes){localStorage.removeItem(k);return existentes;}
    validar();
    let rows;
    try{rows=await sbInsert('transacciones',op.filas);}
    catch(e){rechazoInsercion=e.status>=400&&e.status<500&&![408,409,429].includes(e.status);throw e;}
    validar();
    if(!Array.isArray(rows)||rows.length!==op.filas.length||!op.filas.every(body=>rows.some(f=>String(f.id)===body.id&&coincide(f,body)))){
      const confirmadas=await confirmar();
      if(!confirmadas)throw new Error('No se confirmó el guardado de la devolución.');
      localStorage.removeItem(k);return confirmadas;
    }
    localStorage.removeItem(k);return rows;
  }catch(e){
    // Un rechazo de validación revierte la petición completa en PostgreSQL.
    if(rechazoInsercion){
      validar();localStorage.removeItem(k);throw e;
    }
    throw Object.assign(new Error('La devolución está pendiente de confirmar. Pulsa Actualizar; no la registres otra vez.'),{pending:true});
  }
}

export async function guardarReembolsoConExcedente(filas){
  if(enCurso)throw new Error('Ya se está guardando una devolución.');
  const k=clave();
  const tarea=typeof navigator!=='undefined'&&navigator.locks
    ?navigator.locks.request(k,()=>ejecutar(filas)):ejecutar(filas);
  enCurso=tarea;
  try{return await tarea;}finally{enCurso=null;}
}

export async function recuperarReembolsosPendientes(){
  if(!sessionUserId())return;
  if(enCurso){await enCurso;return;}
  if(leer(clave()))await guardarReembolsoConExcedente(null);
}
