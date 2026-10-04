// Graficos SVG compartidos.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {anPeriodo, getTxAn} from '../modules/analytics.js';
import {escalaGrafico} from '../modules/settings.js';
import {gastoNeto, gastosPorCat} from '../modules/transactions.js';
import {datos} from '../state.js';
import {dominioY} from './chart-scale.js';
import {getMesActivo} from './navigation.js';
import {fmtDateShort, parseDateOnly, pf} from '../utils/dates.js';
import {esc, fmtC, fmtCompacto, getEmoji, mesesC} from '../utils/formatters.js';

let chartTipo='bar';

export function setChart(t,b){
  chartTipo=t;
  const tabs=document.getElementById('statsChartTabs')||b.closest?.('.an-tabs');
  if(tabs){tabs.querySelectorAll('.antb').forEach(x=>x.classList.remove('active'));}
  b.classList.add('active');
  renderChart();
}

export function renderYearMini(){
  const yr=new Date().getFullYear();
  const arr=Array(12).fill(0);
  datos.transacciones.forEach(t=>{const f=pf(t[0]);if(f.getFullYear()===yr){arr[f.getMonth()]+=gastoNeto(t);}});
  const max=Math.max(...arr.map(Math.abs),1);
  document.getElementById('yearMini').innerHTML=arr.map((v,i)=>{
    const h=Math.round(Math.abs(v)/max*30)+4;
    return `<div class="ym"><div class="ym-mes">${mesesC[i]}</div><div style="height:${h}px;background:var(--green);opacity:${v>0?0.7:0.15};border-radius:3px;margin:6px 0"></div><div class="ym-val">${v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0)}</div></div>`;
  }).join('');
}

export function renderChart(){
  const tx=getTxAn();
  const cats=gastosPorCat(tx);
  const arr=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const area=document.getElementById('chartArea');
  const leg=document.getElementById('chartLegend');
  if(arr.length===0){
    area.innerHTML='<div class="empty">Sin datos para mostrar</div>';
    leg.innerHTML='';
    return;
  }
  if(chartTipo==='bar'){renderBarChart(arr,area,leg);}
  else if(chartTipo==='donut'){renderDonut(arr,area,leg);}
  else{renderTrend(area,leg);}
}

function renderBarChart(arr,area,leg){
  const max=Math.max(...arr.map(x=>Math.abs(x[1])),1);
  const w=320,bh=26,gap=8,h=arr.length*(bh+gap);
  const lblW=80;
  const valW=70;
  const barW=w-lblW-valW;
  let svg=`<svg viewBox="0 0 ${w} ${h}" class="chart-svg" style="height:${h}px" preserveAspectRatio="xMidYMid meet">`;
  arr.forEach(([nm,v],i)=>{
    const em=getEmoji(nm);
    const bw=Math.max((Math.abs(v)/max)*barW,2);
    const y=i*(bh+gap);
    svg+=`<text x="0" y="${y+bh/2+5}" fill="#a1a1aa" font-size="11" font-weight="600">${em.e} ${nm.length>10?nm.slice(0,9)+'…':nm}</text>`;
    svg+=`<rect x="${lblW}" y="${y}" width="${barW}" height="${bh}" rx="6" fill="#1f1f23"/>`;
    svg+=`<rect x="${lblW}" y="${y}" width="${bw}" height="${bh}" rx="6" fill="${em.h}" opacity="0.9"/>`;
    svg+=`<text x="${w}" y="${y+bh/2+5}" text-anchor="end" fill="#fafafa" font-size="11" font-weight="700" font-family="Inter Tight">${fmtC(v)}</text>`;
  });
  svg+='</svg>';
  area.innerHTML=svg;
  leg.innerHTML='';
}

function renderDonut(arr,area,leg){
  if(arr.some(x=>x[1]<=0)){renderBarChart(arr,area,leg);leg.textContent='Gasto neto: las devoluciones se descuentan. Se muestran barras cuando hay valores cero o negativos.';return;}
  const total=arr.reduce((s,[,v])=>s+v,0);
  const cx=110,cy=110,r=80,inner=50;
  let svg=`<svg viewBox="0 0 220 220" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;
  let acc=0;
  arr.forEach(([nm,v])=>{
    const em=getEmoji(nm);
    const frac=v/total;
    const a0=acc*Math.PI*2-Math.PI/2;
    const a1=(acc+frac)*Math.PI*2-Math.PI/2;
    const x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0);
    const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
    const xi0=cx+inner*Math.cos(a0),yi0=cy+inner*Math.sin(a0);
    const xi1=cx+inner*Math.cos(a1),yi1=cy+inner*Math.sin(a1);
    const large=frac>0.5?1:0;
    svg+=`<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0} Z" fill="${em.h}" opacity="0.9"/>`;
    acc+=frac;
  });
  svg+=`<text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#a1a1aa" font-size="10" font-weight="600">TOTAL</text>`;
  svg+=`<text x="${cx}" y="${cy+14}" text-anchor="middle" fill="#fafafa" font-size="15" font-weight="800" font-family="Inter Tight">${fmtC(total)}</text>`;
  svg+='</svg>';
  area.innerHTML=svg;
  leg.innerHTML=arr.map(([nm,v])=>{
    const em=getEmoji(nm);
    return `<span class="legend-item"><span class="legend-dot" style="background:${em.h}"></span>${em.e} ${nm} · ${(v/total*100).toFixed(0)}%</span>`;
  }).join('');
}

function renderTrend(area,leg){
  // gastos diarios del período
  const tx=getTxAn();
  let dataPoints=[];
  if(anPeriodo==='mes'){
    const ma=getMesActivo();const dias=new Date(ma.getFullYear(),ma.getMonth()+1,0).getDate();
    const arr=Array(dias).fill(0);
    tx.forEach(t=>{if(gastoNeto(t)!==0){const f=pf(t[0]);arr[f.getDate()-1]+=gastoNeto(t);}});
    dataPoints=arr.map((v,i)=>({l:String(i+1),v}));
  }else{
    const arr=Array(12).fill(0);
    tx.forEach(t=>{if(gastoNeto(t)!==0){const f=pf(t[0]);arr[f.getMonth()]+=gastoNeto(t);}});
    dataPoints=arr.map((v,i)=>({l:mesesC[i],v}));
  }
  const w=320,h=180,padL=30,padR=10,padT=10,padB=24;
  const max=Math.max(...dataPoints.map(p=>p.v),1),min=Math.min(0,...dataPoints.map(p=>p.v));
  const innerW=w-padL-padR;const innerH=h-padT-padB;
  const step=dataPoints.length>1?innerW/(dataPoints.length-1):0;
  let path='';let area2='';
  dataPoints.forEach((p,i)=>{
    const x=padL+i*step;
    const y=padT+innerH-((p.v-min)/(max-min))*innerH;
    path+=(i===0?'M':'L')+x+' '+y+' ';
    if(i===0)area2+='M '+x+' '+(padT+innerH)+' L '+x+' '+y+' ';
    else area2+='L '+x+' '+y+' ';
    if(i===dataPoints.length-1)area2+='L '+x+' '+(padT+innerH)+' Z';
  });
  let svg=`<svg viewBox="0 0 ${w} ${h}" class="chart-svg" preserveAspectRatio="xMidYMid meet">`;
  // grid lines
  for(let i=0;i<=3;i++){
    const yy=padT+innerH*(i/3);
    svg+=`<line x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}" stroke="#1f1f23" stroke-width="1"/>`;
    svg+=`<text x="0" y="${yy+3}" fill="#52525b" font-size="9">${fmtC(max-((max-min)*i/3))}</text>`;
  }
  svg+=`<path d="${area2}" fill="rgba(0,214,143,0.18)"/>`;
  svg+=`<path d="${path}" fill="none" stroke="#00d68f" stroke-width="2" stroke-linejoin="round"/>`;
  // x labels (sample)
  const samples=Math.min(dataPoints.length,8);
  const stride=Math.ceil(dataPoints.length/samples);
  dataPoints.forEach((p,i)=>{
    if(i%stride===0||i===dataPoints.length-1){
      const x=padL+i*step;
      svg+=`<text x="${x}" y="${h-6}" fill="#52525b" font-size="9" text-anchor="middle">${p.l}</text>`;
    }
  });
  svg+='</svg>';
  area.innerHTML=svg;
  leg.innerHTML=`<span class="legend-item"><span class="legend-dot" style="background:#00d68f"></span>Gasto neto ${anPeriodo==='mes'?'diario':'mensual'}</span>`;
}

// Dominio vertical del gráfico de línea (modal de posición). La lógica vive
// en chart-scale.js, compartida con el gráfico principal del portafolio:
// 'detail'/'auto' = rango observado con margen; cualquier otro = desde cero.
function pfChartDomain(values,scale='auto'){
 const vs=values.filter(Number.isFinite);
 const nivel=vs.length?Math.max(...vs.map(Math.abs)):0;
 return dominioY(vs,{modo:scale==='detail'||scale==='auto'?'auto':'cero',rangoMinimo:nivel*0.004});
}

// pfChartX: posición temporal de un punto. Los puntos normales (uno por día)
// se ubican por su `fecha`; el 1D intradía (construirSerieIntradia) manda
// varios puntos con la MISMA fecha pero distinta hora, así que traen su
// propio `t` (epoch ms) — sin esto todos caerían en el mismo x.
function pfChartX(p){return p.t!=null?p.t:+parseDateOnly(p.fecha);}

// En el monolito habia una primera version de esta funcion que el propio
// script sobrescribia al cargar, antes de cualquier llamada. Aqui solo vive
// la que realmente se ejecutaba.
export function construirLineChartSVG(puntos,opts={}){
 const pts=puntos.filter(p=>p.valor!=null&&Number.isFinite(Number(p.valor))&&Number.isFinite(pfChartX(p))).sort((a,b)=>pfChartX(a)-pfChartX(b));
 if(pts.length<2)return '<div class="empty">'+(pts.length?'Histórico disponible desde '+esc(pts[0].etiqueta||pts[0].fecha)+'. Se necesitan al menos dos puntos.':'No hay datos para este período.')+'</div>';
 // Gráfico más protagonista (sección 13): viewBox 4:3 en vez de ~2.7:1 — el
 // CSS (.chart-svg{aspect-ratio:4/3}) tiene que combinar con esto.
 const VB_W=560,VB_H=420,PAD_L=52,PAD_R=20,PAD_T=22,PAD_B=33;
 const baseline=VB_H-PAD_B,innerH=baseline-PAD_T,innerW=(VB_W-PAD_R)-PAD_L;
 const vals=pts.map(p=>Number(p.valor));let [lo,hi]=pfChartDomain(vals,opts.escala||escalaGrafico());if(opts.ganancia){lo=Math.min(lo,0);hi=Math.max(hi,0);if(hi===lo)hi=lo+1;}
 const t0=pfChartX(pts[0]),tn=pfChartX(pts.at(-1)),x=p=>PAD_L+(pfChartX(p)-t0)/(tn-t0||1)*innerW,y=p=>baseline-(Number(p.valor)-lo)/(hi-lo)*innerH;
 const path=pts.map((p,i)=>(i?'L':'M')+x(p).toFixed(2)+' '+y(p).toFixed(2)).join(' ');
 // Color según tendencia (sección 14): verde si sube, rojo si baja — igual
 // que el resto de la app (pfColor), salvo en "ganancia" donde ya se decide
 // por el signo del último valor frente a cero.
 const colorLinea=opts.color||(opts.ganancia?(vals.at(-1)>=0?'var(--green)':'var(--red)'):(vals.at(-1)>=vals[0]?'var(--green)':'var(--red)'));
 let svg=`<svg viewBox="0 0 ${VB_W} ${VB_H}" class="chart-svg" role="img" aria-label="`+(opts.ganancia?'Ganancia frente a los aportes en el período':'Evolución del valor en el período')+'"><title>'+(opts.ganancia?'Ganancia: valor menos aportes netos acumulados':'Evolución del valor; incluye aportes y retiros')+'</title>';
 for(let i=0;i<4;i++){const yy=PAD_T+innerH*(i/3);svg+=`<line x1="${PAD_L}" y1="${yy}" x2="${VB_W-PAD_R}" y2="${yy}" stroke="var(--border)" stroke-dasharray="3 5"/><text x="0" y="${yy+4}" font-size="10">${opts.fmt?opts.fmt(hi-(hi-lo)*i/3):fmtCompacto(hi-(hi-lo)*i/3)}</text>`;}
 if(opts.ganancia){const y0=y({valor:0});svg+=`<line x1="${PAD_L}" y1="${y0.toFixed(2)}" x2="${VB_W-PAD_R}" y2="${y0.toFixed(2)}" stroke="var(--dim)" stroke-width="1"/><text x="${PAD_L-8}" y="${(y0+4).toFixed(2)}" font-size="10" text-anchor="end">0</text><path d="${path}" fill="none" stroke="${colorLinea}" stroke-width="2.5"/>`;}
 else{
   svg+=`<path d="${path} L ${VB_W-PAD_R} ${baseline} L ${PAD_L} ${baseline} Z" fill="${colorLinea}" opacity=".08"/><path d="${path}" fill="none" stroke="${colorLinea}" stroke-width="2.5"/>`;
   // Línea de 0% (sección 12): SOLO si 0 cae dentro del rango ya calculado —
   // nunca se fuerza el dominio a incluirlo (eso volvería a aplanar la
   // gráfica cuando el período entero es claramente positivo o negativo).
   if(opts.zeroLine&&lo<=0&&0<=hi){const y0=y({valor:0});svg+=`<line x1="${PAD_L}" y1="${y0.toFixed(2)}" x2="${VB_W-PAD_R}" y2="${y0.toFixed(2)}" stroke="var(--dim)" stroke-width="1" stroke-dasharray="2 3"/>`;}
 }
 // Varias marcas de hora/fecha (sección 13), no solo los dos extremos — como
 // Yahoo Finance. Se ubican por posición X real (proporcional al tiempo, no
 // por índice), y se de-duplican índices para series cortas (ej. 1D con 3
 // puntos). Nunca se repite la misma etiqueta dos veces seguidas.
 const numEtiquetas=Math.min(5,pts.length);
 const idxs=[...new Set(Array.from({length:numEtiquetas},(_,i)=>Math.round(i*(pts.length-1)/(numEtiquetas-1||1))))];
 let etiquetaAnterior=null;
 idxs.forEach(i=>{
   const p=pts[i],texto=p.etiqueta||fmtDateShort(parseDateOnly(p.fecha));
   if(texto===etiquetaAnterior)return;
   etiquetaAnterior=texto;
   const anchor=i===0?'start':i===pts.length-1?'end':'middle';
   svg+=`<text x="${x(p).toFixed(2)}" y="${baseline+24}" text-anchor="${anchor}" font-size="10">${esc(texto)}</text>`;
 });
 return svg+'</svg>';
}
