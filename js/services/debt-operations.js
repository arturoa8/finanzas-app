// Registro de operaciones pendientes, separado por usuario. Los UUID se fijan
// ANTES de escribir: una respuesta perdida se consulta y se reintenta con los
// mismos ids, sin duplicar ingresos. Se recupera antes de recargar los saldos.
// La API actual no ofrece transacciones entre tablas; si no puede completarse
// se conserva el registro pendiente y se muestra un aviso persistente.
import {sessionUserId} from './auth.js';
import {sbDelete, sbInsert, sbSelect, sbUpdate} from './supabase.js';

let abonoEnCurso=null;
function claveAbonosPendientes(){const id=sessionUserId();if(!id)throw new Error('Inicia sesión para registrar un abono.');return 'finanzas.abonos-pendientes.v1.'+id;}
export function abonoPendiente(){const raw=localStorage.getItem(claveAbonosPendientes());if(!raw)return null;return JSON.parse(raw);}
async function filaAbonoServidor(tabla,id){const rows=await sbSelect(tabla,'?select=*&id=eq.'+encodeURIComponent(id)+'&limit=1');return rows?.[0]||null;}
async function asegurarFilaAbono(tabla,body,validarSesion){
  validarSesion();
  const actual=await filaAbonoServidor(tabla,body.id);
  validarSesion();
  if(actual){
    if(Number(actual.monto)!==Number(body.monto)||(body.tx_id&&actual.tx_id!==body.tx_id))throw new Error('El registro pendiente cambió en otro dispositivo. Revisa el historial.');
    return actual;
  }
  try{return await sbInsert(tabla,body);}catch(e){
    // Otro dispositivo puede haber completado el mismo UUID o haberse perdido
    // la respuesta a un INSERT que el servidor sí aceptó.
    if(e.status===409){const row=await filaAbonoServidor(tabla,body.id);if(row&&Number(row.monto)===Number(body.monto)&&(!body.tx_id||row.tx_id===body.tx_id))return row;}
    throw e;
  }
}
async function completarAbono(op,validarSesion){
  validarSesion();
  if(op.tipo==='crear'){
    if(op.tx)await asegurarFilaAbono('transacciones',op.tx,validarSesion);
    return await asegurarFilaAbono('deudas_abonos',op.abono,validarSesion);
  }
  if(op.tipo==='editar'){
    const row=await sbUpdate('deudas_abonos',op.id,op.patch);
    if(!row)throw new Error('El abono ya no existe. Actualiza el historial.');
    validarSesion();
    if(op.txId){const tx=await sbUpdate('transacciones',op.txId,{monto:op.patch.monto,fecha:op.patch.fecha});if(!tx)throw new Error('No se encontró el movimiento vinculado.');}
    return row;
  }
  if(op.tipo==='eliminar'){
    await sbDelete('deudas_abonos',op.id);
    validarSesion();
    if(op.txId)await sbDelete('transacciones',op.txId);
    return null;
  }
  throw new Error('Operación pendiente no reconocida.');
}
async function bajoBloqueoAbono(fn){
  if(abonoEnCurso)await abonoEnCurso;
  const clave=claveAbonosPendientes();
  const ejecutar=async()=>fn(clave);
  const task=typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request(clave,ejecutar):ejecutar();
  abonoEnCurso=task;
  try{return await task;}finally{if(abonoEnCurso===task)abonoEnCurso=null;}
}
export async function ejecutarAbono(op){
  return bajoBloqueoAbono(async(clave)=>{
    const validarSesion=()=>{if(claveAbonosPendientes()!==clave)throw new Error('La sesión cambió durante el guardado.');};
    validarSesion();
    const pendiente=abonoPendiente();
    if(pendiente&&pendiente.id!==op.id)throw Object.assign(new Error('Hay un abono pendiente de confirmar. Pulsa Actualizar antes de registrar otro.'),{pending:true});
    const vigente=pendiente||op;
    localStorage.setItem(clave,JSON.stringify(vigente));
    try{
      const result=await completarAbono(vigente,validarSesion);
      validarSesion();
      localStorage.removeItem(clave);
      return result;
    }catch(e){
      // Un rechazo definitivo al crear el abono permite deshacer el ingreso,
      // siempre comprobando que el abono no llegó a existir.
      if(vigente.tipo==='crear'&&e.status>=400&&e.status<500&&e.status!==408&&e.status!==429){
        try{validarSesion();if(!await filaAbonoServidor('deudas_abonos',vigente.id)){validarSesion();if(vigente.tx)await sbDelete('transacciones',vigente.tx.id);localStorage.removeItem(clave);throw Object.assign(new Error(e.message),{cancelled:true});}}catch(cancel){if(cancel.cancelled)throw cancel;}
      }
      const error=new Error('El abono está pendiente de confirmar. Revisa tu conexión y pulsa Actualizar; no lo registres de nuevo.');error.pending=true;throw error;
    }
  });
}
export async function recuperarAbonosPendientes(){
  if(!sessionUserId())return;
  const pendiente=abonoPendiente();if(pendiente)await ejecutarAbono(pendiente);
}
