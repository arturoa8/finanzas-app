// Historial de la línea de cada tarjeta y % de uso por ciclo.
//
// config_tarjetas solo guarda la línea de hoy. Si el banco la sube de 1000 a
// 2000, calcular el uso de los ciclos pasados con 2000 lo hace ver menor de lo
// que fue. Aquí cada ciclo se mide contra la línea que regía en su corte, y el
// uso es la "línea usada" de ese día: la misma cifra que muestra Tarjetas
// (deuda pendiente en todos los ciclos), vista a la fecha de corte.

import {getCardOutstandingTotal} from './cards.js';
import {renderCardDetail, renderCardsPage} from './cards-ui.js';
import {CREDIT_CARDS, getCardGoalPct, getCreditLimit, getLineState, renderLineasCreditoConfig} from './config.js';
import {getCardCycle, isCardExpenseFor} from './cycles.js';
import {sbDelete, sbInsert, sbSelect, sbUpdate} from '../../services/supabase.js';
import {datos} from '../../state.js';
import {toast} from '../../ui/toast.js';
import {guardedOnce} from '../../utils/async.js';
import {pf} from '../../utils/dates.js';
import {escAttr, fmt, mesesC, norm} from '../../utils/formatters.js';

export const HISTORIAL_LIMITES_SELECT='?select=id,tarjeta,limite,vigente_desde&order=vigente_desde.asc,id.asc';

// Fila de la base → arreglo posicional, como el resto de datos: [id, tarjeta, límite, desde].
export const filaLimite=r=>[r.id,r.tarjeta,Number(r.limite),String(r.vigente_desde).slice(0,10)];

const diaLargo=iso=>{const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'});};
const diaISO=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

// Historial de una tarjeta, del más antiguo al más reciente.
export function historialDe(card){
  return (datos.historialLimites||[]).filter(r=>norm(String(r[1]))===norm(card.cuenta)).sort((a,b)=>a[3]<b[3]?-1:a[3]>b[3]?1:0);
}

// Línea vigente en una fecha. Antes de la primera fila (o sin historial, si la
// migración aún no está aplicada) se usa la línea más antigua que se conoce y
// el resultado se marca como estimado.
export function limiteEnFecha(card,fecha){
  const h=historialDe(card);
  if(!h.length)return{limite:getCreditLimit(card),estimado:true,desde:null};
  const dia=diaISO(fecha);
  let vigente=null;
  for(const r of h)if(r[3]<=dia)vigente=r;
  return vigente?{limite:vigente[2],estimado:false,desde:vigente[3]}:{limite:h[0][2],estimado:true,desde:h[0][3]};
}

// Últimos ciclos de la tarjeta, del más reciente al más antiguo, con su % de
// uso al corte. El ciclo abierto usa la cifra de hoy. No se listan ciclos
// anteriores al primer consumo de la tarjeta.
export function usoLineaPorCiclo(card,cantidad=6,ahora=new Date()){
  const primero=(datos.transacciones||[]).filter(t=>isCardExpenseFor(card,t)).reduce((m,t)=>{const f=pf(t[0]);return !m||f<m?f:m;},null);
  if(!primero)return[];
  const filas=[];
  for(let offset=1;offset>=-36&&filas.length<cantidad;offset--){
    const cycle=getCardCycle(card,offset);
    if(cycle.start>ahora)continue;
    if(cycle.end<primero)break;
    const abierto=cycle.end>ahora,corte=abierto?ahora:cycle.end;
    const usado=getCardOutstandingTotal(card,abierto?null:cycle.end);
    const l=limiteEnFecha(card,corte);
    filas.push({cycle,abierto,usado,limite:l.limite,estimado:l.estimado,desde:l.desde,pct:l.limite>0?usado/l.limite*100:null});
  }
  return filas;
}

export function resumenUsoLinea(filas){
  const con=filas.filter(f=>f.pct!==null);
  if(!con.length)return null;
  return{promedio:con.reduce((s,f)=>s+f.pct,0)/con.length,maximo:Math.max(...con.map(f=>f.pct)),ciclos:con.length};
}

const etiquetaCiclo=f=>f.abierto?'En curso':`${mesesC[f.cycle.end.getMonth()]}. ${f.cycle.end.getFullYear()}`;
const pctTxt=p=>p===null?'—':p.toFixed(p>=10?0:1)+'%';

// Para la pestaña de estadísticas de la página de tarjetas: una línea.
export function resumenUsoLineaTexto(card){
  const filas=usoLineaPorCiclo(card),r=resumenUsoLinea(filas);
  if(!r)return'Sin consumos todavía';
  const a=filas[0];
  return`${pctTxt(a.pct)} ${a.abierto?'hoy':'al último corte'} · prom. ${pctTxt(r.promedio)} · máx. ${pctTxt(r.maximo)}`;
}

// Detalle de la tarjeta: barra por ciclo con la línea que regía entonces.
export function renderUsoLineaCiclos(card){
  const filas=usoLineaPorCiclo(card),r=resumenUsoLinea(filas),goal=getCardGoalPct(card);
  const titulo='<div class="card-tx-title">Uso de la línea por ciclo</div>';
  if(!r)return`<div class="credit-card" style="cursor:default;margin-top:12px">${titulo}<div class="empty" style="padding:16px">Sin datos</div></div>`;
  const items=filas.map(f=>{
    const cls=f.pct===null?'ok':getLineState(f.usado,f.limite,goal).cls;
    return`<div class="uso-linea-row"><div class="uso-linea-top"><span>${etiquetaCiclo(f)}</span><strong>${f.estimado?'~':''}${pctTxt(f.pct)}</strong></div>
      <div class="line-progress"><div class="line-fill ${cls}" style="width:${Math.min(f.pct||0,100)}%"></div></div>
      <div class="uso-linea-sub">${fmt(f.usado)} de ${fmt(f.limite)}${f.estimado?' · línea estimada':''}</div></div>`;
  }).join('');
  const hayEstimado=filas.some(f=>f.estimado);
  return`<div class="credit-card" style="cursor:default;margin-top:12px">${titulo}
    <div class="uso-linea-resumen"><span>Promedio <strong>${pctTxt(r.promedio)}</strong></span><span>Máximo <strong>${pctTxt(r.maximo)}</strong></span></div>
    ${items}
    <div class="hint">Línea usada al corte de cada ciclo contra la línea que tenías entonces.${hayEstimado?' Los ciclos con “~” son anteriores al primer registro: se calculan con la línea más antigua guardada. Agrega las líneas anteriores en Líneas de crédito.':''}</div></div>`;
}

// Editor dentro de Líneas de crédito: lista del historial y alta de una línea anterior.
export function renderHistorialLimitesConfig(card){
  const h=historialDe(card),hoy=diaISO(new Date());
  if(!h.length)return'';
  const filas=h.map((r,i)=>{
    const actual=i===h.length-1;
    return`<div class="limite-hist-row"><span>Desde ${diaLargo(r[3])}</span><strong>${fmt(r[2])}</strong>${actual?'<small>actual</small>':`<button class="line-edit-btn" type="button" onclick="quitarLimiteHistorial('${escAttr(r[0])}')">Quitar</button>`}</div>`;
  }).reverse().join('');
  return`<div class="limite-hist">
    <div class="line-config-name" style="font-size:.8rem">Historial de la línea</div>
    ${filas}
    <div class="line-config-row" style="grid-template-columns:1fr 1fr;margin-top:8px">
      <div class="line-field"><label>Línea anterior</label><input class="limiteHistMonto" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="1000"></div>
      <div class="line-field"><label>Desde el</label><input class="limiteHistDesde" type="date" max="${hoy}"></div>
    </div>
    <button class="line-edit-btn" type="button" style="margin-top:10px" onclick="agregarLimiteHistorial(this)">Agregar al historial</button>
  </div>`;
}

export async function recargarHistorialLimites(){
  const filas=await sbSelect('limites_tarjetas_historial',HISTORIAL_LIMITES_SELECT);
  datos.historialLimites=filas.map(filaLimite);
}

// El navegador entrega el día del <input type="date">; se acepta solo uno que no sea futuro.
export function validarLimiteHistorial(monto,desde,hoy=diaISO(new Date())){
  const n=Number(monto);
  if(!Number.isFinite(n)||n<=0)return{error:'La línea debe ser mayor que cero'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(desde||''))return{error:'Elige desde qué día regía esa línea'};
  if(desde>hoy)return{error:'La fecha no puede ser futura'};
  return{limite:Math.round(n*100)/100,desde};
}

const repintar=()=>{renderLineasCreditoConfig();renderCardsPage();renderCardDetail();};

async function agregarLimiteHistorial__base(boton){
  const item=boton?.closest?.('.line-config-item'); if(!item)return;
  const cuenta=item.getAttribute('data-old-cuenta')||'';
  const card=CREDIT_CARDS.find(c=>norm(c.cuenta)===norm(cuenta)); if(!card)return;
  const v=validarLimiteHistorial(item.querySelector('.limiteHistMonto').value,item.querySelector('.limiteHistDesde').value);
  if(v.error){toast(v.error,'error');return;}
  const h=historialDe(card);
  if(h.length&&v.desde>=h[h.length-1][3]){toast('Para la línea actual usa el campo Línea de arriba','error');return;}
  try{
    const existente=h.find(r=>r[3]===v.desde);
    if(existente)await sbUpdate('limites_tarjetas_historial',existente[0],{limite:v.limite});
    else await sbInsert('limites_tarjetas_historial',{tarjeta:card.cuenta,limite:v.limite,vigente_desde:v.desde});
    await recargarHistorialLimites();
    repintar();toast('Línea anterior guardada','success');
  }catch(e){toast(e.message||'No se pudo guardar','error');}
}
export const agregarLimiteHistorial=guardedOnce(agregarLimiteHistorial__base);

async function quitarLimiteHistorial__base(id){
  if(!confirm('¿Quitar esta línea del historial? Los ciclos de esas fechas se calcularán con la línea anterior más cercana.'))return;
  try{
    await sbDelete('limites_tarjetas_historial',id);
    await recargarHistorialLimites();
    repintar();toast('Línea quitada del historial','success');
  }catch(e){toast(e.message||'No se pudo quitar','error');}
}
export const quitarLimiteHistorial=guardedOnce(quitarLimiteHistorial__base);
