// Analisis: periodos, series y comparaciones.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderSaldoCuentas} from './accounts.js';
import {gastoNeto, gastosPorCat, reembolsado, totales} from './transactions.js';
import {datos} from '../state.js';
import {renderChart, renderYearMini} from '../ui/charts.js';
import {getMesActivo} from '../ui/navigation.js';
import {hoyLocal, parseDateOnly, pf} from '../utils/dates.js';
import {escHtml, fmt, getEmoji, norm} from '../utils/formatters.js';

export let anPeriodo='mes';

export function setAnPeriodo(p,b){
  anPeriodo=p;
  document.querySelectorAll('#p-bud .an-tabs').forEach((tabs,idx)=>{if(idx===0){tabs.querySelectorAll('.antb').forEach(x=>x.classList.remove('active'));}});
  b.classList.add('active');
  document.getElementById('yearCard').style.display=p==='anio'?'block':'none';
  renderAnalisis();
}

export function getTxAn(){
  // según anPeriodo
  if(anPeriodo==='mes'){
    const ma=getMesActivo();
    return datos.transacciones.filter(t=>{const f=pf(t[0]);return f.getMonth()===ma.getMonth()&&f.getFullYear()===ma.getFullYear();});
  }
  // anio: año actual
  const yr=new Date().getFullYear();
  return datos.transacciones.filter(t=>pf(t[0]).getFullYear()===yr);
}

function getTxPrev(){
  if(anPeriodo==='mes'){
    const ma=getMesActivo();const prev=new Date(ma.getFullYear(),ma.getMonth()-1,1);
    return datos.transacciones.filter(t=>{const f=pf(t[0]);return f.getMonth()===prev.getMonth()&&f.getFullYear()===prev.getFullYear();});
  }
  const yr=new Date().getFullYear()-1;
  return datos.transacciones.filter(t=>pf(t[0]).getFullYear()===yr);
}



export function filtrarPorPeriodo(rows,periodo,campoFecha){
  if(periodo==='ALL')return rows;
  const hoy=hoyLocal();
  let desde;
  if(periodo==='YTD')desde=new Date(hoy.getFullYear(),0,1);
  else{
    const dias={'1D':1,'1S':7,'1M':30,'3M':90,'6M':180,'1A':365}[periodo]||180;
    desde=new Date(hoy);desde.setDate(desde.getDate()-dias);
  }
  return rows.filter(r=>{const f=parseDateOnly(r[campoFecha]);return f&&f>=desde;});
}

export function renderAnalisis(){
  const tx=getTxAn();const tot=totales(tx);
  // Tasa de ahorro
  const ahorro=tot.i>0?((tot.bal/tot.i)*100):0;
  const eA=document.getElementById('mAhorro');
  eA.textContent=ahorro.toFixed(0)+'%';
  eA.className='m-val '+(ahorro>=0?'pos':'neg');
  document.getElementById('mAhorroSub').textContent=tot.i>0?fmt(tot.bal)+' de '+fmt(tot.i):'sin ingresos';

  // Desglose del gasto del período (antes estaba en el inicio). gastoNeto()
  // sigue siendo la única fuente del neto; aquí solo se separan sus partes.
  // "reembolsos" son los aplicados a compras de este período (aunque el
  // dinero haya llegado en otro), no lo recibido en este período: así
  // bruto − reembolsos siempre da el mismo neto que ya se muestra.
  const gBruto=tx.filter(t=>t[3]==='Gasto').reduce((s,t)=>s+(Number(t[4])||0),0);
  const gReembolsos=tx.filter(t=>t[3]==='Gasto').reduce((s,t)=>s+reembolsado(t[6]),0);
  document.getElementById('mGastoNeto').textContent=fmt(tot.g);
  document.getElementById('mGastoSub').textContent='bruto '+fmt(gBruto)+' · reembolsos '+fmt(gReembolsos)+' · neto';

  // Promedio diario gastos — excluye 'Estudios' (cuotas de universidad): son
  // montos grandes y puntuales que no representan el gasto diario real, y
  // sesgan tanto el promedio como la proyección de fin de período.
  let dias=1;
  if(anPeriodo==='mes'){
    const ma=getMesActivo();const ahora=new Date();
    if(ma.getMonth()===ahora.getMonth()&&ma.getFullYear()===ahora.getFullYear())dias=ahora.getDate();
    else dias=new Date(ma.getFullYear(),ma.getMonth()+1,0).getDate();
  }else{
    const ahora=new Date();const yr=ahora.getFullYear();
    const start=new Date(yr,0,1);
    dias=Math.floor((ahora-start)/(1000*60*60*24))+1;
  }
  const gSinEstudios=tx.filter(t=>norm(t[2])!=='estudios').reduce((s,t)=>s+gastoNeto(t),0);
  const prom=dias>0?gSinEstudios/dias:0;
  document.getElementById('mProm').textContent=fmt(prom);
  document.getElementById('mPromSub').textContent='gasto promedio en '+dias+' día'+(dias>1?'s':'')+' (sin Estudios)';

  // Proyección de fin de período (mes o año), con el mismo promedio sin Estudios
  let diasTotalesPeriodo;
  if(anPeriodo==='mes'){
    const ma=getMesActivo();
    diasTotalesPeriodo=new Date(ma.getFullYear(),ma.getMonth()+1,0).getDate();
  }else{
    const yr=new Date().getFullYear();
    diasTotalesPeriodo=Math.round((new Date(yr,11,31)-new Date(yr,0,1))/(1000*60*60*24))+1;
  }
  const proyeccion=Math.max(0,prom)*diasTotalesPeriodo;
  document.getElementById('mProy').textContent=fmt(proyeccion);
  document.getElementById('mProySub').textContent=`a este ritmo, ~${fmt(proyeccion)} en gastos ${anPeriodo==='mes'?'este mes':'este año'} (sin Estudios)`;

  renderSaldoCuentas();

  // Categoría más cara
  const cats=gastosPorCat(tx);
  const ord=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  if(ord.length>0){
    const[nm,val]=ord[0];const em=getEmoji(nm);
    document.getElementById('mTop').innerHTML=`<span style="font-size:1.4rem;margin-right:6px">${em.e}</span>${escHtml(nm)}`;
    document.getElementById('mTopSub').textContent=fmt(val)+' • '+(tot.g>0?(val/tot.g*100).toFixed(0):0)+'% del gasto total';
  }else{
    document.getElementById('mTop').textContent='—';
    document.getElementById('mTopSub').textContent='Sin gastos';
  }

  // Comparativa período anterior
  const prevTx=getTxPrev();const prev=totales(prevTx);
  const deltaG=tot.g-prev.g;
  const pctG=prev.g>0?(deltaG/prev.g*100):(tot.g>0?100:0);
  const eC=document.getElementById('mCmp');
  const sign=deltaG>=0?'+':'−';
  eC.textContent=sign+fmt(Math.abs(deltaG));
  eC.className='m-val '+(deltaG<=0?'pos':'neg'); // si gasto bajó es bueno
  document.getElementById('mCmpDet').textContent=`${(pctG>=0?'+':'')}${pctG.toFixed(0)}% vs ${anPeriodo==='mes'?'mes':'año'} anterior · ${fmt(prev.g)}`;

  // Vista anual
  if(anPeriodo==='anio'){renderYearMini();}

  renderChart();
}
