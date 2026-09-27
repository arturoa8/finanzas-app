// Portafolio: aportes de capital, su valor en soles y costos de inversion.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {monedaCuenta} from '../currencies.js';
import {pintarValorPrincipal} from './hero.js';
import {cuentasInversionHistoricas, pfFlujos, pfModeloGanancia} from './performance.js';
import {pfFechaCorta, pfHistoricoCache, pfIso} from './portfolio.js';
import {sameAccount} from '../transactions.js';
import {sbUpdate} from '../../services/supabase.js';
import {datos} from '../../state.js';
import {toast} from '../../ui/toast.js';
import {parseDateOnly, pf} from '../../utils/dates.js';
import {esc, fmtMoneda} from '../../utils/formatters.js';

// ── Costos de invertir y capital desembolsado ──────────────────────────────
// Aporte neto = los dólares que LLEGARON a IBKR (pfFlujos). Costos = lo que
// pagaste para que llegaran (comisión del banco, ITF, comisión de IBKR…):
// salió de tu bolsillo pero nunca entró al portafolio. Son gastos normales de
// la app marcados con es_costo_inversion (columna de transacciones, índice 15
// de filaTx) desde Portafolio → Resumen → "Marcar costos". Nada está escrito a
// mano en el código. Un INGRESO marcado (un ajuste o devolución del banco)
// resta. Cada costo pasa a dólares así: si se pagó en dólares, esos dólares;
// si se pagó en soles, con el tipo de cambio implícito del aporte a IBKR más
// cercano en fecha (soles enviados ÷ dólares recibidos), el mismo cambio al
// que se convirtió el dinero al que acompaña. Sin ningún aporte con dólares
// confirmados no se inventa un tipo de cambio: el costo queda pendiente.
function pfAportesConDolares(cuentas=cuentasInversionHistoricas()){
  return (datos.transacciones||[]).filter(t=>t[3]==='Transferencia'&&Number(t[14])>0&&Number(t[4])>0
    &&cuentas.some(c=>sameAccount(t[7]||'',c))&&monedaCuenta(t[5]||'')==='PEN');
}

function pfTcAporteCercano(fechaIso,aportes){
  const f=parseDateOnly(fechaIso);let mejor=null,dist=Infinity;
  aportes.forEach(t=>{const d=Math.abs(pf(t[0])-f);if(d<dist){dist=d;mejor=t;}});
  return mejor?Number(mejor[4])/Number(mejor[14]):null;
}

export function pfCostosInversion(){
  const aportes=pfAportesConDolares();
  const costos=[];
  (datos.transacciones||[]).forEach(t=>{
    if(t[15]!==true||(t[3]!=='Gasto'&&t[3]!=='Ingreso'))return;
    const signo=t[3]==='Gasto'?1:-1,fecha=pfIso(pf(t[0])),soles=signo*(Number(t[4])||0);
    let usd=null;
    if(t[9]==='USD'&&Number(t[10])>0)usd=signo*Number(t[10]);
    else{const tc=pfTcAporteCercano(fecha,aportes);if(tc>0)usd=soles/tc;}
    costos.push({id:t[6],fecha,descripcion:t[1],soles,usd});
  });
  costos.sort((a,b)=>a.fecha.localeCompare(b.fecha));
  return{costos};
}

// Soles que salieron hacia/desde cuentas de inversión (monto siempre en
// soles): solo para mostrar "S/ enviados" junto a los dólares que llegaron.
function pfAportesSolesHasta(fecha,cuentas=cuentasInversionHistoricas()){
  let s=0;
  (datos.transacciones||[]).forEach(t=>{
    if(t[3]!=='Transferencia'||pfIso(pf(t[0]))>fecha)return;
    const entra=cuentas.some(c=>sameAccount(t[7]||'',c)),sale=cuentas.some(c=>sameAccount(t[5]||'',c));
    if(entra&&!sale)s+=Number(t[4])||0;else if(sale&&!entra)s-=Number(t[4])||0;
  });
  return Math.round(s*100)/100;
}

// Flujos de capital fechados, en dólares (aportes y costos). Es la entrada
// que necesitará una rentabilidad ponderada por dinero (XIRR/MWRR) cuando se
// implemente; hoy solo decide si hubo flujos en más de una fecha.
function pfFlujosCapital(fl,co,hasta){
  return[...fl.flujos.map(f=>({fecha:f.fecha,monto:f.monto,tipo:'aporte'})),
    ...co.costos.filter(c=>c.usd!==null).map(c=>({fecha:c.fecha,monto:c.usd,tipo:'costo'}))]
    .filter(f=>!hasta||f.fecha<=hasta).sort((a,b)=>a.fecha.localeCompare(b.fecha));
}

// Rentabilidad de inversión = (valor − aportes netos) ÷ aportes netos.
// Rentabilidad neta         = (valor − capital desembolsado) ÷ capital,
// con capital desembolsado = aportes netos + costos. La diferencia entre las
// dos es exactamente el efecto de los costos. Con un único momento de aporte
// (tu caso) ambas son también la rentabilidad temporal; con varios, son
// ganancia ÷ capital y se avisa (multiplesFechas) — la ponderada por tiempo
// es la del gráfico, y la ponderada por dinero queda preparada en
// pfFlujosCapital.
export function pfModeloCapital(row,fl,co){
  const g=pfModeloGanancia(row,fl);
  if(!g.ok)return g;
  const hasta=row.fecha_valoracion,costos=co.costos.filter(c=>c.fecha<=hasta);
  const costosPendientes=costos.filter(c=>c.usd===null).length;
  const costosUSD=Math.round(costos.reduce((s,c)=>s+(c.usd||0),0)*100)/100;
  const costosSoles=Math.round(costos.reduce((s,c)=>s+c.soles,0)*100)/100;
  const capital=Math.round((g.aportes+costosUSD)*100)/100,valor=Number(row.valor_total);
  const gananciaNeta=Math.round((valor-capital)*100)/100;
  const fechas=new Set(pfFlujosCapital(fl,co,hasta).map(f=>f.fecha));
  return{...g,costosUSD,costosSoles,nCostos:costos.length,costosPendientes,capital,gananciaNeta,
    pctNeta:costosPendientes||!(capital>0)?null:gananciaNeta/capital*100,
    aportesSoles:pfAportesSolesHasta(hasta),multiplesFechas:fechas.size>1};
}

// Escenario F: aportes o retiros registrados después del último cierre IBKR
// (incluye los que aún no tienen dólares confirmados). Fechas ISO, ordenadas.
export function pfAportesSinReflejar(official){
  if(!official)return[];
  try{
    const fl=pfFlujos();
    return[...new Set([...fl.flujos.map(f=>f.fecha),...fl.pendientesFechas].filter(f=>f>official.fecha_valoracion))].sort();
  }catch(e){return[];}
}

// ── Editor de costos (Resumen → "Marcar costos") ───────────────────────────
// Candidatos: gastos e ingresos a ±3 días de una transferencia hacia/desde
// una cuenta de inversión, más los ya marcados. Marcar/desmarcar escribe
// es_costo_inversion en Supabase y recalcula el resumen en el acto.
function pfCandidatosCosto(){
  const cuentas=cuentasInversionHistoricas();
  const fechas=(datos.transacciones||[]).filter(t=>t[3]==='Transferencia'&&cuentas.some(c=>sameAccount(t[5]||'',c)||sameAccount(t[7]||'',c))).map(t=>+pf(t[0]));
  return (datos.transacciones||[]).filter(t=>(t[3]==='Gasto'||t[3]==='Ingreso')&&(t[15]===true||fechas.some(f=>Math.abs(+pf(t[0])-f)<=3*864e5)))
    .sort((a,b)=>pf(b[0])-pf(a[0]));
}

export function togglePfCostosEditor(btn){
  const ed=document.getElementById('pfCostosEditor');if(!ed)return;
  ed.hidden=!ed.hidden;
  if(btn)btn.textContent=ed.hidden?'Marcar costos de invertir':'Listo';
  if(!ed.hidden)renderPfCostosEditor();
}

export function renderPfCostosEditor(){
  const ed=document.getElementById('pfCostosEditor');if(!ed)return;
  const lista=pfCandidatosCosto();
  if(!lista.length){ed.innerHTML='<p class="hint">No hay gastos cerca de tus aportes a IBKR.</p>';return;}
  ed.innerHTML='<p class="hint" style="margin:0 0 6px">Marca lo que pagaste para invertir (comisiones, ITF…). Un ingreso marcado, como un ajuste del banco, resta.</p>'+
    lista.map(t=>{const usd=t[9]==='USD'&&Number(t[10])>0;
      return `<label class="pf-costo-item"><input type="checkbox" ${t[15]===true?'checked':''} onchange="pfMarcarCosto('${esc(String(t[6]))}',this.checked,this)"><span><strong>${esc(t[1]||t[2]||'Movimiento')}</strong><small>${esc(pfFechaCorta(pfIso(pf(t[0]))))} · ${esc(t[5]||'')}${t[3]==='Ingreso'?' · ingreso':''}</small></span><em>${t[3]==='Ingreso'?'−':''}${esc(usd?fmtMoneda(Number(t[10]),'USD'):fmtMoneda(Number(t[4]),'PEN'))}</em></label>`;}).join('');
}

export async function pfMarcarCosto(id,marcado,input){
  const t=(datos.transacciones||[]).find(x=>String(x[6])===String(id));if(!t)return;
  if(input)input.disabled=true;
  try{
    const row=await sbUpdate('transacciones',id,{es_costo_inversion:marcado});
    t[15]=row&&'es_costo_inversion' in row?row.es_costo_inversion===true:marcado;
    if(pfHistoricoCache.length)pintarValorPrincipal();
  }catch(e){
    if(input)input.checked=!marcado;
    toast(/es_costo_inversion|schema cache|column/i.test(e.message||'')?'Falta aplicar en Supabase la migración de costos de inversión.':(e.message||'No se pudo guardar'),'error');
  }finally{if(input)input.disabled=false;}
}
