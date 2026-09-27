// Portafolio: pestana de riesgo y metricas (volatilidad, beta, Sharpe, concentracion).
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {filtrarPorPeriodo} from '../analytics.js';
import {pfFlujos} from './performance.js';
import {PF_BENCHMARK, pfBenchCache, pfColor, pfHistoricoCache, pfPosicionesCache, pfSignedPct} from './portfolio.js';
import {esc} from '../../utils/formatters.js';
import {pfNumber} from '../../utils/numbers.js';

// ── Subvista: Rendimiento | Riesgo y métricas ───────────────────────────────
let pfSubvista='rendimiento';

export function pfMostrarSubTabs(mostrar){
  const el=document.getElementById('pfSubTabs');
  if(el)el.style.display=mostrar?'':'none';
}

export function pfAplicarSubvista(){
  const esRend=pfSubvista==='rendimiento';
  ['pfChartCard','pfResumenCard','pfPosicionesCard','pfDistCard','pfDiagCard'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display=esRend?'':'none';
  });
  const riesgo=document.getElementById('pfRiesgoCard');
  if(riesgo)riesgo.style.display=esRend?'none':'';
  if(!esRend)renderPfRiesgo();
}

export function setPfSubvista(v,btn){
  pfSubvista=v;
  document.getElementById('pfSubRend')?.setAttribute('aria-pressed',String(v==='rendimiento'));
  document.getElementById('pfSubRiesgo')?.setAttribute('aria-pressed',String(v==='riesgo'));
  document.querySelectorAll('#pfSubTabs .antb').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  pfAplicarSubvista();
}

// ── Riesgo y métricas ────────────────────────────────────────────────────
// Todo esto trabaja sobre RETORNOS DIARIOS de cierres oficiales de IBKR
// (portafolio_historial) y del histórico del benchmark — nunca intradía de
// Yahoo (sección 32 del pedido: las estadísticas necesitan una serie
// consistente día a día, no minuto a minuto). Sección 33 — crítico: cada
// retorno diario aísla los flujos confirmados del día exactamente igual que
// pfRendimientoTWR, para que un aporte o retiro nunca se cuente como si
// fuera rentabilidad. Si un día tiene un flujo SIN dólares confirmados, ese
// día se omite entero (nunca se inventa un retorno).
const PF_MIN_OBSERVACIONES=20;

const PF_DIAS_TRADING_ANUAL=252;

// Tasa libre de riesgo (sección 17): todavía no hay una fuente automática —
// constante explícita y visible (nunca silenciosa: se muestra junto a
// Sharpe/Sortino de dónde sale) hasta que se conecte una fuente real.
const PF_TASA_LIBRE_RIESGO_ANUAL=0.045;

function pfRetornosDiarios(filas){
  const validas=(filas||[]).filter(r=>Number(r.valor_total)>0).sort((a,b)=>a.fecha_valoracion.localeCompare(b.fecha_valoracion));
  if(validas.length<2)return[];
  const fl=pfFlujos(),retornos=[];
  for(let i=1;i<validas.length;i++){
    const prev=Number(validas[i-1].valor_total),cur=Number(validas[i].valor_total);
    const d=validas[i-1].fecha_valoracion,h=validas[i].fecha_valoracion;
    if(!(prev>0))continue;
    if(fl.pendientesFechas.some(f=>f>d&&f<=h))continue;
    const flujo=fl.flujos.filter(f=>f.fecha>d&&f.fecha<=h).reduce((s,f)=>s+f.monto,0);
    retornos.push({fecha:h,retorno:(cur-flujo)/prev-1});
  }
  return retornos;
}

function pfRetornosBenchmark(bench){
  const filas=(bench||[]).filter(b=>Number(b.precio_mercado)>0).sort((a,b)=>a.fecha_valoracion.localeCompare(b.fecha_valoracion));
  const retornos=[];
  for(let i=1;i<filas.length;i++){
    const prev=Number(filas[i-1].precio_mercado),cur=Number(filas[i].precio_mercado);
    if(prev>0)retornos.push({fecha:filas[i].fecha_valoracion,retorno:cur/prev-1});
  }
  return retornos;
}

// Alinea dos series de retornos por fecha exacta (sección 14): nunca se
// compara el retorno de un día con el de otro.
function pfAlinearRetornos(a,b){
  const mapB=new Map(b.map(x=>[x.fecha,x.retorno])),out=[];
  a.forEach(x=>{if(mapB.has(x.fecha))out.push({fecha:x.fecha,rp:x.retorno,rb:mapB.get(x.fecha)});});
  return out;
}

function pfMedia(arr){return arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:0;}

function pfVarianza(arr){if(arr.length<2)return 0;const m=pfMedia(arr);return arr.reduce((s,v)=>s+(v-m)*(v-m),0)/(arr.length-1);}

function pfDesvio(arr){return Math.sqrt(pfVarianza(arr));}

function pfCovarianza(a,b){
  if(a.length!==b.length||a.length<2)return 0;
  const ma=pfMedia(a),mb=pfMedia(b);let s=0;
  for(let i=0;i<a.length;i++)s+=(a[i]-ma)*(b[i]-mb);
  return s/(a.length-1);
}

// Calcula TODAS las métricas de una vez para un período (sección 13: mismo
// rango para todas). Nunca devuelve un número engañoso sin datos: por
// debajo de PF_MIN_OBSERVACIONES cada grupo queda marcado como insuficiente
// y el render muestra "Histórico insuficiente" en vez de inventar un 0.
function pfCalcularRiesgo(periodo){
  const filas=filtrarPorPeriodo(pfHistoricoCache,periodo,'fecha_valoracion');
  const retornosP=pfRetornosDiarios(filas);
  const retornosB=pfRetornosBenchmark(filtrarPorPeriodo(pfBenchCache,periodo,'fecha_valoracion'));
  const alineados=pfAlinearRetornos(retornosP,retornosB);
  const rp=retornosP.map(x=>x.retorno),rAlinP=alineados.map(a=>a.rp),rAlinB=alineados.map(a=>a.rb);
  const r={periodo,n:rp.length,nAlin:alineados.length,suficiente:rp.length>=PF_MIN_OBSERVACIONES,suficienteBench:alineados.length>=PF_MIN_OBSERVACIONES};
  if(r.suficiente){
    r.volatilidad=pfDesvio(rp)*Math.sqrt(PF_DIAS_TRADING_ANUAL)*100;
    const rfDiaria=PF_TASA_LIBRE_RIESGO_ANUAL/PF_DIAS_TRADING_ANUAL;
    const excesos=rp.map(x=>x-rfDiaria),volExceso=pfDesvio(excesos);
    r.sharpe=volExceso>0?pfMedia(excesos)/volExceso*Math.sqrt(PF_DIAS_TRADING_ANUAL):null;
    const negativos=excesos.filter(x=>x<0);
    const downside=negativos.length?Math.sqrt(negativos.reduce((s,v)=>s+v*v,0)/excesos.length):0;
    r.sortino=downside>0?pfMedia(excesos)/downside*Math.sqrt(PF_DIAS_TRADING_ANUAL):null;
    let acumulado=1,pico=1,maxDD=0;
    rp.forEach(x=>{acumulado*=(1+x);pico=Math.max(pico,acumulado);maxDD=Math.min(maxDD,acumulado/pico-1);});
    r.maxDrawdown=maxDD*100;
    r.drawdownActual=(acumulado/pico-1)*100;
    const ordenados=[...rp].sort((a,b)=>a-b);
    const idx=Math.max(0,Math.floor(ordenados.length*0.05)-1);
    r.var95=ordenados[idx]*100;
    r.cvar95=pfMedia(ordenados.slice(0,idx+1))*100;
  }
  if(r.suficienteBench){
    const varB=pfVarianza(rAlinB),desvP=pfDesvio(rAlinP),desvB=pfDesvio(rAlinB);
    r.beta=varB>0?pfCovarianza(rAlinP,rAlinB)/varB:null;
    r.correlacion=(desvP>0&&desvB>0)?pfCovarianza(rAlinP,rAlinB)/(desvP*desvB):null;
    const diffs=alineados.map(a=>a.rp-a.rb),desvDif=pfDesvio(diffs);
    r.trackingError=desvDif*Math.sqrt(PF_DIAS_TRADING_ANUAL)*100;
    r.informationRatio=desvDif>0?pfMedia(diffs)/desvDif*Math.sqrt(PF_DIAS_TRADING_ANUAL):null;
    if(r.beta!==null){
      const rfDiaria=PF_TASA_LIBRE_RIESGO_ANUAL/PF_DIAS_TRADING_ANUAL;
      r.alpha=(pfMedia(rAlinP)-rfDiaria-r.beta*(pfMedia(rAlinB)-rfDiaria))*PF_DIAS_TRADING_ANUAL*100;
    }
  }
  return r;
}

// Concentración: no depende del período elegido ni de retornos — es sobre
// las posiciones actuales (cierre oficial más reciente).
function pfCalcularConcentracion(){
  const items=(pfPosicionesCache||[]).map(p=>({simbolo:p.simbolo,valor:pfNumber(p.valor_mercado_base)})).filter(x=>x.valor!==null&&x.valor>0);
  const total=items.reduce((s,x)=>s+x.valor,0);
  if(!items.length||!(total>0))return null;
  items.sort((a,b)=>b.valor-a.valor);
  const pesos=items.map(x=>x.valor/total),hhi=pesos.reduce((s,w)=>s+w*w,0);
  return{mayor:pesos[0]*100,mayorSimbolo:items[0].simbolo,top3:pesos.slice(0,3).reduce((s,w)=>s+w,0)*100,hhi,nEfectivo:hhi>0?1/hhi:null,numPosiciones:items.length};
}

function pfInterpretarBeta(b){
  if(b===null)return'';
  if(b<0.8)return'Ha sido sensiblemente menos sensible al '+PF_BENCHMARK.etiqueta+' que un movimiento uno a uno.';
  if(b>1.2)return'Ha tendido a amplificar los movimientos del '+PF_BENCHMARK.etiqueta+'.';
  return'Ha mostrado una sensibilidad parecida al '+PF_BENCHMARK.etiqueta+'.';
}

// Tarjeta de métrica (sección 28): nombre, valor, interpretación corta (1-2
// frases), período/observaciones/benchmark abajo. Sección 31 — MUY
// IMPORTANTE: el color NUNCA es un juicio de "bueno/malo" (un Beta bajo o
// un Sharpe alto no se pintan verde); solo se colorea cuando el número es
// en sí mismo una ganancia/pérdida con signo (Alpha, Max Drawdown, VaR…),
// igual que el resto de la app — el resto queda en el color neutral.
function pfMetricCard(label,valor,interpretacion,footer,color){
  return '<div class="pf-riesgo-metric"><div class="m-lbl">'+esc(label)+'</div><div class="m-val"'+(color?' style="color:'+color+'"':'')+'>'+esc(valor)+'</div>'+
    (interpretacion?'<p>'+esc(interpretacion)+'</p>':'')+(footer?'<div class="pf-riesgo-foot">'+esc(footer)+'</div>':'')+'</div>';
}

function pfMetricNA(label,motivo){
  return '<div class="pf-riesgo-metric"><div class="m-lbl">'+esc(label)+'</div><div class="m-val" style="color:var(--dim)">No disponible</div><p>'+esc(motivo)+'</p></div>';
}

function renderPfRiesgo(){
  const body=document.getElementById('pfRiesgoBody');
  if(!body||!pfHistoricoCache.length)return;
  const r=pfCalcularRiesgo(pfRiesgoPeriodo);
  const periodoTxt={'3M':'3 meses','6M':'6 meses','1A':'1 año',ALL:'todo el histórico'}[pfRiesgoPeriodo]||pfRiesgoPeriodo;
  const footRiesgo=r.n+' sesiones · '+periodoTxt;
  const footBench=r.nAlin+' sesiones comunes · vs '+PF_BENCHMARK.etiqueta+' · '+periodoTxt;
  const rfTxt=' · Rf anual '+(PF_TASA_LIBRE_RIESGO_ANUAL*100).toFixed(2)+'% (referencia manual)';
  let html='';
  html+='<div class="pf-riesgo-grupo"><div class="pf-riesgo-grupo-titulo">Riesgo</div><div class="pf-riesgo-grid">';
  if(r.suficiente){
    html+=pfMetricCard('Volatilidad anualizada',r.volatilidad.toFixed(1)+'%','Una aproximación de cuánto han variado tus retornos diarios, llevada a términos anuales.',footRiesgo);
    html+=pfMetricCard('Max Drawdown',pfSignedPct(r.maxDrawdown),'Mayor caída desde un máximo previo hasta el mínimo posterior, dentro del período.',footRiesgo,pfColor(r.maxDrawdown));
    html+=pfMetricCard('Drawdown actual',pfSignedPct(r.drawdownActual),'Qué tan lejos está hoy del máximo alcanzado en el período.',footRiesgo,pfColor(r.drawdownActual));
    html+=pfMetricCard('VaR histórico 95%',pfSignedPct(r.var95),'En el 95% de los días del período, la pérdida diaria no superó aproximadamente esto. Es histórico, no una pérdida máxima garantizada.',footRiesgo,pfColor(r.var95));
    html+=pfMetricCard('Expected Shortfall 95%',pfSignedPct(r.cvar95),'Pérdida diaria promedio observada en el 5% de peores días del período.',footRiesgo,pfColor(r.cvar95));
  }else{
    html+=pfMetricNA('Volatilidad, Drawdown, VaR, CVaR','Histórico insuficiente: hacen falta al menos '+PF_MIN_OBSERVACIONES+' retornos diarios comparables ('+r.n+' disponibles en este período).');
  }
  html+='</div></div>';
  html+='<div class="pf-riesgo-grupo"><div class="pf-riesgo-grupo-titulo">Retorno ajustado por riesgo</div><div class="pf-riesgo-grid">';
  if(r.suficiente){
    html+=pfMetricCard('Sharpe',r.sharpe===null?'—':r.sharpe.toFixed(2),'Retorno excedente obtenido por unidad de volatilidad asumida.',footRiesgo+rfTxt);
    html+=pfMetricCard('Sortino',r.sortino===null?'—':r.sortino.toFixed(2),'Igual que el Sharpe, pero solo penaliza la volatilidad de los días negativos.',footRiesgo+rfTxt);
  }else{
    html+=pfMetricNA('Sharpe, Sortino','Histórico insuficiente: hacen falta al menos '+PF_MIN_OBSERVACIONES+' retornos diarios ('+r.n+' disponibles).');
  }
  html+='</div></div>';
  html+='<div class="pf-riesgo-grupo"><div class="pf-riesgo-grupo-titulo">Benchmark · '+esc(PF_BENCHMARK.etiqueta)+'</div><div class="pf-riesgo-grid">';
  if(r.suficienteBench){
    html+=pfMetricCard('Beta',r.beta===null?'—':r.beta.toFixed(2),pfInterpretarBeta(r.beta),footBench);
    html+=pfMetricCard('Correlación',r.correlacion===null?'—':r.correlacion.toFixed(2),'Qué tan relacionados estuvieron tus movimientos diarios con los del benchmark en el período. No implica causalidad.',footBench);
    html+=pfMetricCard('Tracking Error',r.trackingError.toFixed(1)+'%','Cuánto se separó tu rentabilidad diaria de la del benchmark.',footBench);
    html+=pfMetricCard('Information Ratio',r.informationRatio===null?'—':r.informationRatio.toFixed(2),'Exceso de retorno frente al benchmark, relativizado por qué tan variable fue ese exceso.',footBench);
    html+=pfMetricCard('Alpha',r.alpha===undefined?'—':pfSignedPct(r.alpha)+' anual','Exceso de retorno estimado no explicado por tu exposición al benchmark — estimación histórica.',footBench,r.alpha===undefined?undefined:pfColor(r.alpha));
  }else{
    html+=pfMetricNA('Beta, Correlación, Tracking Error, Information Ratio, Alpha','Histórico insuficiente comparable con '+PF_BENCHMARK.etiqueta+': hacen falta al menos '+PF_MIN_OBSERVACIONES+' sesiones comunes ('+r.nAlin+' disponibles).');
  }
  html+='</div></div>';
  const c=pfCalcularConcentracion();
  html+='<div class="pf-riesgo-grupo"><div class="pf-riesgo-grupo-titulo">Concentración</div><div class="pf-riesgo-grid">';
  if(c){
    html+=pfMetricCard('Mayor posición',c.mayor.toFixed(0)+'%',esc(c.mayorSimbolo)+' representa '+c.mayor.toFixed(0)+'% del portafolio.','cierre oficial de IBKR');
    html+=pfMetricCard('Top 3',c.top3.toFixed(0)+'%','Las tres posiciones principales concentran '+c.top3.toFixed(0)+'% del portafolio.','cierre oficial de IBKR');
    html+=pfMetricCard('HHI',c.hhi.toFixed(2),'Índice de concentración (suma de cada peso al cuadrado): más cerca de 1 es más concentrado, más cerca de 0 es más repartido.','cierre oficial de IBKR');
    html+=pfMetricCard('Nº efectivo de posiciones',c.nEfectivo===null?'—':c.nEfectivo.toFixed(1),'Aunque tienes '+c.numPosiciones+' posiciones, por concentración el portafolio se comporta aproximadamente como '+(c.nEfectivo===null?'—':c.nEfectivo.toFixed(1))+' posiciones igualmente ponderadas.','cierre oficial de IBKR');
  }else{
    html+=pfMetricNA('Concentración','Sin posiciones abiertas con valor de mercado.');
  }
  html+='</div></div>';
  html+='<p class="hint">Los gráficos de evolución (drawdown, volatilidad y beta en el tiempo) y el detalle al tocar cada tarjeta todavía no están — quedan para una siguiente vuelta.</p>';
  body.innerHTML=html;
}

let pfRiesgoPeriodo='1A';

export function setPfRiesgoPeriodo(p,btn){
  pfRiesgoPeriodo=p;
  document.querySelectorAll('#pfRiesgoPeriodoTabs .antb').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderPfRiesgo();
}
