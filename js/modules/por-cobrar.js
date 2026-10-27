// Gastos por cobrar: un consumo que pagaste por otra persona (tu mamá compró
// con tu tarjeta o con tu cuenta) y que te tiene que devolver.
//
// Es una deuda "me-deben" con el id del gasto en d[8]. Lo que ya te devolvió
// son los Reembolso de ese gasto, no abonos: así una devolución registrada
// desde Deudas o desde el formulario de movimientos cuenta igual.
//
// Un gasto puede tener varias deudas: dividido entre varias personas (la van
// que te devuelven ocho) o en cuotas. Cada devolución dice de quién es en
// t[16] (deuda_id); las que no lo dicen se reparten en orden entre las deudas
// del gasto, así que con una sola deuda todo cuenta como siempre.
//
// Mientras la deuda está activa, el gasto no es tuyo: el gasto efectivo resta
// lo que te deben además de lo ya devuelto. Al archivarla (pagó o no pagó),
// solo se resta lo devuelto y el resto vuelve a contar como gasto tuyo.
import {datos} from '../state.js';
import {fmt} from '../utils/formatters.js';

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

// Deudas activas de un gasto, en el orden en que se cobran. La primera sirve
// donde basta saber si el gasto está por cobrar.
export function deudasDeGasto(id){
  if(id==null||id==='')return [];
  return ordenCobro((datos.deudas||[]).filter(d=>d[8]&&String(d[8])===String(id)));
}
export function deudaDeGasto(id){return deudasDeGasto(id)[0]||null;}

// Archivadas guardan el vínculo en d[10] (8 y 9 son motivo y fecha).
export function deudaArchivadaDeGasto(id){
  if(id==null||id==='')return null;
  return (datos.deudasArchivadas||[]).find(d=>d[10]&&String(d[10])===String(id))||null;
}

export function gastoDeDeuda(d){
  const id=gastoIdDeuda(d);
  return id?(datos.transacciones||[]).find(t=>t[3]==='Gasto'&&String(t[6])===String(id))||null:null;
}

// Una fila activa guarda el gasto en d[8]; una archivada (11 campos), en d[10].
const gastoIdDeuda=d=>d?(d.length>=11?d[10]:d[8])||null:null;

// Primero lo que vence antes (las cuotas), luego lo más antiguo; empates en
// el orden de carga.
const fechaOrden=f=>f?String(f).slice(0,10):'9999-99-99';
function ordenCobro(deudas){
  return deudas.map((d,i)=>({d,i})).sort((a,b)=>fechaOrden(a.d[6]).localeCompare(fechaOrden(b.d[6]))
    ||fechaOrden(a.d[5]).localeCompare(fechaOrden(b.d[5]))||a.i-b.i).map(x=>x.d);
}

// Céntimos cobrados de cada deuda de un gasto (activas y archivadas). Una
// devolución con persona va a su deuda; las demás cubren las deudas en orden.
// `excluir` deja fuera una devolución: la que se está editando.
export function cobrosDeGasto(id,excluir=null){
  if(id==null||id==='')return new Map();
  const lista=ordenCobro([...(datos.deudas||[]),...(datos.deudasArchivadas||[])].filter(d=>String(gastoIdDeuda(d))===String(id)));
  const cobros=new Map(lista.map(d=>[String(d[0]),0]));
  let libre=0;
  for(const t of datos.transacciones||[]){
    if(t[3]!=='Reembolso'||String(t[8])!==String(id)||(excluir!=null&&String(t[6])===String(excluir)))continue;
    const deuda=t[16]==null?null:String(t[16]);
    if(deuda&&cobros.has(deuda))cobros.set(deuda,cobros.get(deuda)+centimosDeuda(t[4]));
    else libre+=centimosDeuda(t[4]);
  }
  for(const d of lista){
    const k=String(d[0]),usa=Math.min(libre,Math.max(0,centimosDeuda(d[3])-cobros.get(k)));
    cobros.set(k,cobros.get(k)+usa);libre-=usa;
  }
  return cobros;
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

// Lo que ya devolvió y lo que falta, en soles. Sirve para activas y archivadas.
function cobradoCentimos(d){return !gastoIdDeuda(d)?0:Math.min(centimosDeuda(d[3]),cobrosDeGasto(gastoIdDeuda(d)).get(String(d[0]))||0);}
export function cobradoDeuda(d){return cobradoCentimos(d)/100;}
export function pendienteDeuda(d){return Math.max(0,centimosDeuda(d[3])-cobradoCentimos(d))/100;}

// Lo que te deben de un gasto entre todas sus deudas activas, en céntimos.
function porCobrarCentimos(id){
  const deudas=deudasDeGasto(id);if(!deudas.length)return 0;
  const cobros=cobrosDeGasto(id);
  return deudas.reduce((s,d)=>s+Math.max(0,centimosDeuda(d[3])-(cobros.get(String(d[0]))||0)),0);
}

// Parte de un gasto que todavía te deben. Nunca más de lo que queda del gasto
// después de sus devoluciones.
export function porCobrarDeGasto(t){
  if(t[3]!=='Gasto'||!deudaDeGasto(t[6]))return 0;
  return Math.max(0,Math.min(porCobrarCentimos(t[6]),centimosDeuda(t[4])-devueltoCentimos(t[6])))/100;
}

// Céntimos de un gasto que cubren sus deudas activas para netoCentimos(): lo
// devuelto más lo que falta cobrar. Con una sola deuda equivale a su monto (o
// a lo devuelto, si es mayor). Cero si el gasto no está por cobrar.
export function cubiertoPorDeudas(id){
  return deudaDeGasto(id)?devueltoCentimos(id)+porCobrarCentimos(id):0;
}

// id del gasto → céntimos que cubren sus deudas activas, para los cálculos de
// una sola pasada (presupuestos).
export function deudasPorGasto(){
  const mapa=new Map();
  for(const d of datos.deudas||[])if(d[8]&&!mapa.has(String(d[8])))mapa.set(String(d[8]),cubiertoPorDeudas(d[8]));
  return mapa;
}

// "Mamá te debe S/ 50.00 en 3 cuotas" o "8 personas te deben S/ 533.36".
export function textoDeudas(deudas,monto){
  const personas=new Set(deudas.map(d=>String(d[1]||'').trim().toLowerCase()));
  if(personas.size>1)return deudas.length+' personas te deben '+fmt(monto);
  return (deudas[0]?.[1]||'Alguien')+' te debe '+fmt(monto)+(deudas.length>1?' en '+deudas.length+' cuotas':'');
}

// Fecha 'AAAA-MM-DD' k meses después. Un 31 cae en el último día del mes
// corto (31 ene → 28 feb), no en el mes siguiente.
export function sumarMeses(iso,k){
  const [y,m,d]=String(iso).slice(0,10).split('-').map(Number);
  const f=new Date(y,m-1+k,1),ultimo=new Date(f.getFullYear(),f.getMonth()+1,0).getDate();
  return f.getFullYear()+'-'+String(f.getMonth()+1).padStart(2,'0')+'-'+String(Math.min(d,ultimo)).padStart(2,'0');
}

// Cuotas iguales en céntimos, una por mes desde la primera fecha. Lo que no
// se divide exacto va en la última: 100 en 3 → 33.33, 33.33, 33.34.
export function planCuotas(totalCentimos,n,primera){
  const base=Math.floor(totalCentimos/n);
  return Array.from({length:n},(_,i)=>({monto:(i===n-1?totalCentimos-base*(n-1):base)/100,venc:sumarMeses(primera,i)}));
}
