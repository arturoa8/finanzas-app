// Presupuestos: períodos en America/Lima, límite vigente y consumo neto.
// Funciones puras sobre los datos ya cargados. Las usan la vista
// (presupuestos.js) y las pruebas, sin consultas por tarjeta.

import {mesesC, norm} from '../utils/formatters.js';

// Perú no tiene horario de verano: Lima es UTC−5 todo el año.
const LIMA_MS=5*3600000;
const DIA_MS=86400000;

// Único sitio donde una fila de Supabase se convierte en el arreglo que usa
// la app, como filaTx. 0-2 conservan el formato anterior (categoría, límite,
// mes), que también leen categories.js y el respaldo.
//   0 categoria (null si es general) · 1 monto_limite · 2 mes (anterior)
//   3 id · 4 ambito · 5 periodo · 6 inicio · 7 fin (exclusivo)
//   8 recurrente · 9 serie_id
// Una fila sin las columnas nuevas (antes de la migración) es el presupuesto
// mensual de esa categoría para ese mes, igual que la migración la interpreta.
export function filaPresupuesto(p){
  const mes=p.mes?String(p.mes).slice(0,10):null;
  const periodo=p.periodo||'mensual';
  const inicio=p.inicio?String(p.inicio).slice(0,10):mes?mes.slice(0,8)+'01':null;
  const recurrente=p.recurrente===true;
  const fin=p.fin?String(p.fin).slice(0,10):(!recurrente&&inicio?siguientePeriodo(periodo,inicio):null);
  return [p.categoria??null,Number(p.monto_limite),mes,p.id,p.ambito||(p.categoria?'categoria':'general'),
    periodo,inicio,fin,recurrente,p.serie_id||p.id];
}

// ── Fechas como texto AAAA-MM-DD ───────────────────────────────────────────
const aUTC=iso=>{const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d);};
const deUTC=ms=>new Date(ms).toISOString().slice(0,10);
const dos=n=>String(n).padStart(2,'0');

// Día calendario en Lima de un movimiento, sin depender de la zona horaria
// del dispositivo. Una fecha sin hora ya es un día calendario.
export function fechaLima(valor){
  if(valor===null||valor===undefined||valor==='')return null;
  if(typeof valor==='string'){
    const s=valor.trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    // Formato heredado de Sheets: "dd/mm/aaaa, hh:mm" en hora de Lima.
    const dmy=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if(dmy)return dmy[3]+'-'+dos(dmy[2])+'-'+dos(dmy[1]);
  }
  const ms=valor instanceof Date?valor.getTime():Date.parse(valor);
  return Number.isFinite(ms)?deUTC(ms-LIMA_MS):null;
}

export const hoyLima=(ahora=Date.now())=>deUTC(ahora-LIMA_MS);

// Mes calendario o semana de lunes a domingo.
export function inicioPeriodo(tipo,iso){
  if(tipo==='mensual')return iso.slice(0,8)+'01';
  const ms=aUTC(iso),dia=new Date(ms).getUTCDay();
  return deUTC(ms-((dia+6)%7)*DIA_MS);
}

export function moverPeriodo(tipo,inicio,n){
  if(tipo==='semanal')return deUTC(aUTC(inicio)+7*n*DIA_MS);
  const [y,m]=inicio.split('-').map(Number),total=y*12+(m-1)+n;
  return Math.floor(total/12)+'-'+dos(total%12+1)+'-01';
}

export const siguientePeriodo=(tipo,inicio)=>moverPeriodo(tipo,inicio,1);

// Último día del período (inclusive).
export const ultimoDia=(tipo,inicio)=>deUTC(aUTC(siguientePeriodo(tipo,inicio))-DIA_MS);

const partes=iso=>{const [y,m,d]=iso.split('-').map(Number);return {y,m,d};};
const corto=iso=>{const p=partes(iso);return p.d+' '+mesesC[p.m-1].toLowerCase();};

// "1 – 31 oct 2026" · "5 – 11 oct 2026" · "28 sep – 4 oct 2026" · "29 dic 2025 – 4 ene 2026"
export function rangoPeriodo(tipo,inicio){
  const fin=ultimoDia(tipo,inicio),a=partes(inicio),b=partes(fin);
  if(tipo==='mensual'||(a.m===b.m&&a.y===b.y))return a.d+' – '+b.d+' '+mesesC[b.m-1].toLowerCase()+' '+b.y;
  return (a.y===b.y?corto(inicio):corto(inicio)+' '+a.y)+' – '+corto(fin)+' '+b.y;
}

const NOMBRES_MES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// "Este mes", "Mes anterior", "Octubre 2026" · "Esta semana", "Semana del 22 sep".
// Con hoy=null, siempre el nombre absoluto.
export function nombrePeriodo(tipo,inicio,hoy=hoyLima()){
  const actual=hoy?inicioPeriodo(tipo,hoy):null,p=partes(inicio);
  if(tipo==='mensual'){
    if(inicio===actual)return 'Este mes';
    if(actual&&inicio===moverPeriodo(tipo,actual,-1))return 'Mes anterior';
    if(actual&&inicio===moverPeriodo(tipo,actual,1))return 'Próximo mes';
    const n=NOMBRES_MES[p.m-1];return n[0].toUpperCase()+n.slice(1)+' '+p.y;
  }
  if(inicio===actual)return 'Esta semana';
  if(actual&&inicio===moverPeriodo(tipo,actual,-1))return 'Semana anterior';
  if(actual&&inicio===moverPeriodo(tipo,actual,1))return 'Próxima semana';
  return 'Semana del '+corto(inicio)+(!hoy||p.y!==partes(hoy).y?' '+p.y:'');
}

// ── Límite vigente ─────────────────────────────────────────────────────────
// Igual que presupuesto_clave() en Supabase: "Comer afuéra" y "comer  afuera"
// son la misma categoría.
export const claveCategoria=c=>norm(c).replace(/\s+/g,' ');
export const claveAmbito=(ambito,categoria)=>ambito==='general'?'general':'categoria:'+claveCategoria(categoria);

const cubre=(p,inicio)=>p[6]<=inicio&&(!p[7]||p[7]>inicio);

// El de un solo período manda sobre el que se repite (ajuste de ese período).
export function presupuestoVigente(filas,ambito,categoria,tipo,inicio){
  const clave=claveAmbito(ambito,categoria);
  const propias=(filas||[]).filter(p=>p[5]===tipo&&p[6]&&claveAmbito(p[4],p[0])===clave&&cubre(p,inicio));
  return propias.find(p=>!p[8])||propias.find(p=>p[8])||null;
}

// Todos los presupuestos que rigen en un período, uno por ámbito.
export function presupuestosDelPeriodo(filas,tipo,inicio){
  const vistos=new Map();
  for(const p of filas||[]){
    if(p[5]!==tipo||!p[6]||!cubre(p,inicio))continue;
    const clave=claveAmbito(p[4],p[0]),actual=vistos.get(clave);
    if(!actual||(actual[8]&&!p[8]))vistos.set(clave,p);
  }
  return [...vistos.values()];
}

// Repetición de la serie que también cubre este período, si el vigente es un
// ajuste puntual sobre ella.
export function reglaDeSerie(filas,p,inicio){
  return (filas||[]).find(x=>x[8]&&x[9]===p[9]&&cubre(x,inicio))||null;
}

// ── Consumo ────────────────────────────────────────────────────────────────
const aCentimos=n=>Math.round(Number(n)*100);

// Equivalente en soles registrado en el movimiento. En dólares solo vale si
// trae importe original y tipo de cambio: no se inventa una conversión.
export function solesRegistrados(t){
  const m=Number(t[4]);
  if(!Number.isFinite(m)||m<=0)return null;
  if(t[9]==='USD'&&!(Number(t[10])>0&&Number(t[11])>0))return null;
  return aCentimos(m);
}

// Consumo neto de un período en céntimos, en una sola pasada.
// - Solo cuentan los Gasto, en el día del consumo (también con tarjeta). Los
//   pagos de tarjeta viven en pagos_tarjetas y no son movimientos; las
//   transferencias (compra de dólares, aportes a IBKR) y los ingresos no
//   consumen ni amplían el presupuesto.
// - Cada reembolso se resta del gasto original, en su período y categoría,
//   aunque llegue después: es la misma regla que gastoNeto(). El ingreso
//   adicional de un reembolso con excedente es un Ingreso y no cuenta.
// - Un gasto nunca resta por debajo de cero.
export function consumoDelPeriodo(transacciones,tipo,inicio){
  const hasta=siguientePeriodo(tipo,inicio);
  const reembolsos=new Map(),reembolsoInvalido=new Set();
  for(const t of transacciones||[]){
    if(t[3]!=='Reembolso'||!t[8])continue;
    const c=solesRegistrados(t),id=String(t[8]);
    if(c===null){reembolsoInvalido.add(id);continue;}
    reembolsos.set(id,(reembolsos.get(id)||0)+c);
  }
  const res={total:0,incompletos:0,gastos:0,porCategoria:new Map()};
  const sumar=(clave,c,incompleto)=>{
    const b=res.porCategoria.get(clave)||{total:0,incompletos:0,gastos:0};
    b.total+=c;b.gastos++;if(incompleto)b.incompletos++;res.porCategoria.set(clave,b);
  };
  for(const t of transacciones||[]){
    if(t[3]!=='Gasto')continue;
    const dia=fechaLima(t[0]);
    if(!dia||dia<inicio||dia>=hasta)continue;
    const bruto=solesRegistrados(t),id=String(t[6]);
    const incompleto=bruto===null||reembolsoInvalido.has(id);
    const neto=bruto===null?0:Math.max(0,bruto-(reembolsos.get(id)||0));
    res.total+=neto;res.gastos++;if(incompleto)res.incompletos++;
    sumar(claveCategoria(t[2]),neto,incompleto);
  }
  return res;
}

export function consumoDe(consumo,p){
  if(p[4]==='general')return {total:consumo.total,incompletos:consumo.incompletos};
  const b=consumo.porCategoria.get(claveCategoria(p[0]));
  return {total:b?b.total:0,incompletos:b?b.incompletos:0};
}

// Estado de un presupuesto con importes en céntimos. La barra se detiene en
// 100; el porcentaje y el excedente son los reales.
export function estadoPresupuesto(gastado,limite){
  const pct=limite>0?gastado*100/limite:0;
  let estado='normal';
  if(gastado>limite)estado='excedido';
  else if(gastado===limite)estado='alcanzado';
  else if(gastado*5>=limite*4)estado='cerca';
  let pctTexto;
  if(estado==='alcanzado')pctTexto='100';
  else if(estado!=='excedido')pctTexto=String(Math.floor(pct));
  else if(pct>=101)pctTexto=String(Math.floor(pct));
  else{const uno=Math.floor(pct*10)/10;pctTexto=uno>100?uno.toFixed(1):'más de 100';}
  return {estado,pct,pctTexto,barra:Math.min(100,pct),disponible:Math.max(0,limite-gastado),exceso:Math.max(0,gastado-limite)};
}
