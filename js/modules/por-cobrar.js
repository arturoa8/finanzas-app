// Gastos por cobrar: un consumo que pagaste por otra persona (tu mamá compró
// con tu tarjeta o con tu cuenta) y que te tiene que devolver.
//
// Es una deuda "me-deben" con el id del gasto en d[8]. Lo que ya te devolvió
// son los Reembolso de ese gasto, no abonos: así una devolución registrada
// desde Deudas o desde el formulario de movimientos cuenta igual.
//
// Mientras la deuda está activa, el gasto no es tuyo: el gasto efectivo resta
// lo que te deben además de lo ya devuelto. Al archivarla (pagó o no pagó),
// solo se resta lo devuelto y el resto vuelve a contar como gasto tuyo.
import {datos} from '../state.js';

const centimosDeuda=n=>Math.round((Number(n)||0)*100);

// Único sitio donde una fila de deudas_resumen se convierte en arreglo. El
// vínculo con el gasto va al final para no mover los índices de siempre:
//   activa:    0 id · 1 persona · 2 descripción · 3 monto · 4 abonado
//              5 desde · 6 vence · 7 tipo · 8 gasto por cobrar
//   archivada: 0-7 igual · 8 motivo · 9 fecha de archivo · 10 gasto
export const filaDeuda=d=>[d.id,d.persona,d.descripcion,d.monto,d.abonado??0,d.fecha_inicio,d.fecha_venc,d.tipo,d.transaccion_id||null];
export const filaDeudaArchivada=d=>[d.id,d.persona,d.descripcion,d.monto,d.abonado??0,d.fecha_inicio,d.fecha_venc,d.tipo,d.motivo_archivo,d.fecha_archivo,d.transaccion_id||null];
export const archivarFila=(d,motivo,fecha)=>[...d.slice(0,8),motivo,fecha,d[8]??null];
export const desarchivarFila=d=>[...d.slice(0,8),d[10]??null];

// Cuerpo para volver a insertar una deuda tal como estaba (deshacer un borrado).
export function cuerpoDeuda(d,archivada=false){
  return {id:d[0],persona:d[1],descripcion:d[2],monto:Number(d[3]),fecha_inicio:d[5],fecha_venc:d[6]||null,tipo:d[7],
    archivado:archivada,motivo_archivo:archivada?d[8]:null,fecha_archivo:archivada?d[9]:null,
    transaccion_id:(archivada?d[10]:d[8])||null};
}

export function deudaDeGasto(id){
  if(id==null||id==='')return null;
  return (datos.deudas||[]).find(d=>d[8]&&String(d[8])===String(id))||null;
}

// Archivadas guardan el vínculo en d[10] (8 y 9 son motivo y fecha).
export function deudaArchivadaDeGasto(id){
  if(id==null||id==='')return null;
  return (datos.deudasArchivadas||[]).find(d=>d[10]&&String(d[10])===String(id))||null;
}

export function gastoDeDeuda(d){
  return d?.[8]?(datos.transacciones||[]).find(t=>t[3]==='Gasto'&&String(t[6])===String(d[8]))||null:null;
}

// Gasto efectivo en céntimos: el bruto menos lo que ya te devolvieron o, si es
// mayor, lo que todavía te deben. gastoNeto() y los presupuestos usan esta regla.
export function netoCentimos(bruto,devuelto,deuda=0){return Math.max(0,bruto-Math.max(devuelto,Math.min(deuda,bruto)));}

// Devoluciones de un gasto, en céntimos.
export function devueltoCentimos(id){
  let total=0;
  for(const t of datos.transacciones||[])if(t[3]==='Reembolso'&&String(t[8])===String(id))total+=centimosDeuda(t[4]);
  return total;
}

// Lo que ya devolvió y lo que falta, en soles.
export function cobradoDeuda(d){return Math.min(centimosDeuda(d[3]),devueltoCentimos(d[8]))/100;}
export function pendienteDeuda(d){return Math.max(0,centimosDeuda(d[3])-devueltoCentimos(d[8]))/100;}

// Parte de un gasto que todavía te deben. Nunca más de lo que queda del gasto
// después de sus devoluciones.
export function porCobrarDeGasto(t){
  if(t[3]!=='Gasto')return 0;
  const d=deudaDeGasto(t[6]);if(!d)return 0;
  const devuelto=devueltoCentimos(t[6]);
  return Math.max(0,Math.min(centimosDeuda(d[3]),centimosDeuda(t[4]))-devuelto)/100;
}

// id del gasto → céntimos que cubre su deuda activa, para los cálculos de una
// sola pasada (presupuestos). El gasto efectivo es bruto − máx(deuda, devuelto).
export function deudasPorGasto(){
  const mapa=new Map();
  for(const d of datos.deudas||[])if(d[8])mapa.set(String(d[8]),centimosDeuda(d[3]));
  return mapa;
}
