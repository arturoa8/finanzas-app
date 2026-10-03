// Operaciones que requieren pago + ajuste: UUID estables y recuperación por
// usuario. Se conservan las tablas y RLS existentes, sin permisos elevados.
import {sessionUserId} from './auth.js';
import {sbDelete, sbInsert, sbSelect} from './supabase.js';

let operacionTarjetaEnCurso=null;
function clavePagosPendientes(){const id=sessionUserId();if(!id)throw new Error('Inicia sesión para guardar el pago.');return 'finanzas.tarjetas-pendientes.v1.'+id;}
export function pagoTarjetaPendiente(){const raw=localStorage.getItem(clavePagosPendientes());return raw?JSON.parse(raw):null;}
async function filaPagoServidor(tabla,id){const r=await sbSelect(tabla,'?select=*&id=eq.'+encodeURIComponent(id)+'&limit=1');return r?.[0]||null;}
async function asegurarRegistroTarjeta(tabla,body,validar){
  validar();const actual=await filaPagoServidor(tabla,body.id);validar();
  const coincide=r=>Number(r.monto)===Number(body.monto)&&['tarjeta','nota','tipo','moneda','cuenta','cuenta_origen','ajuste_id'].every(k=>!(k in body)||(r[k]??null)===(body[k]??null));
  if(actual){if(!coincide(actual))throw new Error('El registro pendiente cambió. Revisa el historial.');return actual;}
  try{const r=await sbInsert(tabla,body);if(r&&coincide(r))return r;validar();const confirmado=await filaPagoServidor(tabla,body.id);if(confirmado&&coincide(confirmado))return confirmado;throw new Error('No se confirmó el registro de tarjeta.');}catch(e){if(e.status===409){validar();const r=await filaPagoServidor(tabla,body.id);if(r&&coincide(r))return r;}throw e;}
}
export async function ejecutarOperacionTarjeta(op){
  if(operacionTarjetaEnCurso)await operacionTarjetaEnCurso;
  const clave=clavePagosPendientes(),validar=()=>{if(clavePagosPendientes()!==clave)throw new Error('La sesión cambió durante el guardado.');};
  const ejecutar=async()=>{
    validar();const previo=pagoTarjetaPendiente();if(previo&&previo.id!==op.id)throw Object.assign(new Error('Hay un pago pendiente. Pulsa Actualizar antes de registrar otro.'),{pending:true});
    const vigente=previo||op;localStorage.setItem(clave,JSON.stringify(vigente));
    try{
      let result=null;
      if(vigente.tipo==='crear'){
        if(vigente.ajuste)await asegurarRegistroTarjeta('transacciones',vigente.ajuste,validar);
        result=await asegurarRegistroTarjeta('pagos_tarjetas',vigente.pago,validar);
      }else if(vigente.tipo==='eliminar'){
        validar();await sbDelete('pagos_tarjetas',vigente.id);validar();
        if(vigente.ajusteId)await sbDelete('transacciones',vigente.ajusteId);
      }else throw new Error('Operación de tarjeta no reconocida.');
      validar();localStorage.removeItem(clave);return result;
    }catch(e){
      if(vigente.tipo==='crear'&&e.status>=400&&e.status<500&&![408,429].includes(e.status)){
        try{validar();if(!await filaPagoServidor('pagos_tarjetas',vigente.id)){validar();if(vigente.ajuste)await sbDelete('transacciones',vigente.ajuste.id);localStorage.removeItem(clave);throw Object.assign(new Error(e.message),{cancelled:true});}}catch(cancel){if(cancel.cancelled)throw cancel;}
      }
      throw Object.assign(new Error('El movimiento de tarjeta está pendiente de confirmar. Pulsa Actualizar; no lo registres de nuevo.'),{pending:true});
    }
  };
  const tarea=typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request(clave,ejecutar):ejecutar();operacionTarjetaEnCurso=tarea;
  try{return await tarea;}finally{if(operacionTarjetaEnCurso===tarea)operacionTarjetaEnCurso=null;}
}
export async function recuperarPagosTarjetaPendientes(){if(sessionUserId()){const p=pagoTarjetaPendiente();if(p)await ejecutarOperacionTarjeta(p);}}
