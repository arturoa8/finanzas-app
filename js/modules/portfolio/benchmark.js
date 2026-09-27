// Comparacion con el indice.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {pfFlujos, pfRendimientoPortafolio} from './performance.js';
import {PF_BENCHMARK, pfBenchCache, pfFechaCorta, pfSignedPct} from './portfolio.js';
import {esc} from '../../utils/formatters.js';

function pfModeloBenchmark(filas,bench,fl){
  const precios=new Map((bench||[]).filter(b=>Number(b.precio_mercado)>0).map(b=>[b.fecha_valoracion,Number(b.precio_mercado)]));
  if(!precios.size)return{ok:false,mensaje:'No hay historial oficial del '+PF_BENCHMARK.etiqueta+' ('+PF_BENCHMARK.simbolo+') en tu portafolio.'};
  const comunes=filas.filter(r=>Number(r.valor_total)>0&&precios.has(r.fecha_valoracion));
  if(comunes.length<2)return{ok:false,mensaje:'Este período no tiene al menos dos cierres comparables con el '+PF_BENCHMARK.etiqueta+'.'};
  const a=comunes[0],b=comunes[comunes.length-1];
  const rango=filas.filter(r=>r.fecha_valoracion>=a.fecha_valoracion&&r.fecha_valoracion<=b.fecha_valoracion);
  const pr=pfRendimientoPortafolio(rango,fl);
  if(pr.pct===undefined)
    return{ok:false,mensaje:'Hubo aportes o retiros sin dólares confirmados dentro de este período: no se puede aislar su efecto. Confírmalos, o prueba un período más corto.'};
  const port=pr.pct,mkt=(precios.get(b.fecha_valoracion)/precios.get(a.fecha_valoracion)-1)*100;
  return{ok:true,port,mkt,dif:port-mkt,desde:a.fecha_valoracion,hasta:b.fecha_valoracion,metodo:pr.metodo};
}

export function renderPfBenchmark(filas){
  const el=document.getElementById('pfBenchmark');if(!el)return;
  if(!filas){el.innerHTML='';return;}
  const m=pfModeloBenchmark(filas,pfBenchCache,pfFlujos());
  if(!m.ok){el.innerHTML='<div class="pf-bench"><div class="pf-data-note">vs '+esc(PF_BENCHMARK.etiqueta)+': no disponible. '+esc(m.mensaje)+'</div></div>';return;}
  el.innerHTML='<div class="pf-bench"><div class="pf-rend-row" style="margin-top:0"><div>Portafolio<strong>'+esc(pfSignedPct(m.port))+'</strong></div><div>'+esc(PF_BENCHMARK.etiqueta)+'<strong>'+esc(pfSignedPct(m.mkt))+'</strong></div><div>Diferencia<strong>'+(m.dif>0.004?'+':m.dif<-0.004?'−':'')+Math.abs(m.dif).toFixed(2)+' pp</strong></div></div><p class="hint" style="margin-top:8px">Del '+esc(pfFechaCorta(m.desde))+' al '+esc(pfFechaCorta(m.hasta))+' · cierres oficiales de IBKR; el '+esc(PF_BENCHMARK.etiqueta)+' se mide con '+esc(PF_BENCHMARK.simbolo)+' (iShares Core S&amp;P 500). Solo comparación numérica del período.'+(m.metodo==='twr'?' Hubo aportes o retiros en el período: el lado del portafolio es rentabilidad ponderada por tiempo (TWR), no valor final ÷ valor inicial.':'')+'</p></div>';
}
