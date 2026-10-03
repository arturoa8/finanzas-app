import {datos} from '../state.js';
import {validarCuentasDisponibles} from './accounts.js';
import {abonoPendiente} from '../services/debt-operations.js';
import {pagoTarjetaPendiente} from '../services/card-operations.js';
import {toast} from '../ui/toast.js';
import {hoyISO} from '../utils/dates.js';

export function celdaCSV(value){
  let text=String(value??'');
  if(typeof value!=='number'&&/^[\s]*[=+@\-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function movimientosCSV(rows){
  const encabezados=['Fecha','Descripción','Categoría','Tipo','Monto en soles','Cuenta','ID','Cuenta destino','Gasto original ID','Moneda original','Monto original','Tipo de cambio','Fuente del cambio','Moneda destino','Monto recibido','Costo de inversión'];
  return '\uFEFF'+[encabezados,...rows.map(t=>encabezados.map((_,i)=>{const v=t[i];return [4,10,11,14].includes(i)&&v!=null?Number(v):v;}))].map(row=>row.map(celdaCSV).join(';')).join('\r\n');
}
function descargarArchivo(nombre,contenido,tipo){
  const url=URL.createObjectURL(new Blob([contenido],{type:tipo}));
  const a=document.createElement('a');a.href=url;a.download=nombre;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function validarRespaldo(){validarCuentasDisponibles();if(!datos.cargados)throw new Error('Actualiza los datos antes de descargar.');if(abonoPendiente()||pagoTarjetaPendiente())throw new Error('Confirma el movimiento pendiente antes de descargar: pulsa Actualizar.');}
export function exportarMovimientosCSV(){
  try{validarRespaldo();descargarArchivo('movimientos-'+hoyISO()+'.csv',movimientosCSV(datos.transacciones),'text/csv;charset=utf-8');toast('Descarga de movimientos preparada','success');}catch(e){toast(e.message,'error');}
}
export function descargarRespaldo(){
  try{
    validarRespaldo();const copia={version:1,fecha:new Date().toISOString(),datos:{}};
    for(const k of ['transacciones','categorias','presupuestos','recurrentes','deudas','deudasArchivadas','deudasAbonos','pagosTarjetas','ciclosOverride','configTarjetas','cuentas'])copia.datos[k]=datos[k]||[];
    descargarArchivo('finanzas-respaldo-'+hoyISO()+'.json',JSON.stringify(copia,null,2),'application/json');toast('Respaldo preparado para descargar','success');
  }catch(e){toast(e.message,'error');}
}
