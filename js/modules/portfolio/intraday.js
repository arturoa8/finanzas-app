// Portafolio: grafico del dia (1D) con la serie intradia de Yahoo.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {pfAssetColor} from './allocation.js';
import {renderPfBenchmark} from './benchmark.js';
import {renderPfDiagnostico1D} from './diagnostics.js';
import {obtenerValorActualPortafolio, pfCierreAnterior, pfDeltaPosicion, pfFmt, pfModeloDia, pintarValorPrincipal} from './hero.js';
import {pfFlujos, pfModeloGanancia} from './performance.js';
import {pfColor, pfEtiquetaFecha, pfFechaCorta, pfHistoricoCache, pfOpcionesEscala, pfPosicionesCache, pfSigned, pfSignedPct, pfSnapshotsHoyCache, pfVista} from './portfolio.js';
import {pfLondonDay, pfMarketEstimate, pfQuoteKey, pfYahoo, pfYahooSessionOpen} from '../../services/market-data.js';
import {dominioY, lttb} from '../../ui/chart-scale.js';
import {parseDateOnly} from '../../utils/dates.js';
import {esc} from '../../utils/formatters.js';

// ── 1D: serie intradía real de Yahoo ────────────────────────────────────────
// portfolio_value(t) = cierreIbkr + Σ pfDeltaPosicion(posición, precio(t)) —
// la MISMA fórmula que obtenerValorActualPortafolio(), aplicada a cada
// timestamp de la serie 5m de Yahoo en vez de solo al precio en vivo. Nunca
// toca cantidades/costo/efectivo/histórico IBKR: Yahoo solo aporta precio.
function pfLondonDayDe(t){return pfLondonDay(new Date(t));}

// Timeline común: unión de los timestamps de la SESIÓN DE MERCADO MÁS
// RECIENTE (día de Londres) presente en los datos de cada posición — no del
// "día de hoy" por reloj. Fuera del horario de Londres (p.ej. de madrugada,
// antes de que abra la sesión del día en curso) el reloj ya marca un día
// nuevo pero Yahoo todavía no tiene ningún punto de ese día: exigir que
// coincidiera con "hoy" descartaba la última sesión real completa (llena de
// horas de mercado abierto) y cada posición caía a "sin datos", lo que
// terminaba mostrando el fallback de snapshots — una curva plana repitiendo
// el último precio en horas donde ningún mercado estaba abierto. En cada
// punto de la timeline, cada posición aporta su precio más reciente <= t
// (forward-fill SOLO dentro de esa sesión); si una posición todavía no tiene
// ningún precio a esa altura, ese timestamp no es utilizable para ella
// (nunca se inventa un precio, ni se arrastra el cierre de la sesión previa).
function construirTimelineIntradia(sesionForzada=null){
  const anterior=pfCierreAnterior();
  const r={ok:false,puntos:[],cobertura:[],recibidos:0,usados:0,fuente:null,notaFallback:'',sesion:null};
  if(!anterior||!(Number(anterior.valor_total)>0)||!pfPosicionesCache.length)return r;
  const base=Number(anterior.valor_total);
  const qByKey=new Map(pfYahoo.quotes.map(q=>[String(q.account)+'|'+String(q.contract_id),q]));
  const crudosPorPosicion=pfPosicionesCache.map(p=>{
    const q=qByKey.get(pfQuoteKey(p));
    const crudos=(q&&q.status==='ok'&&q.intraday&&Array.isArray(q.intraday.points))?q.intraday.points:[];
    r.recibidos+=crudos.length;
    return{p,q,crudos};
  });
  // La sesión la fija pfModeloDia (la misma de la base del día) cuando se
  // conoce; si no, la más reciente presente en los datos.
  let sesion=sesionForzada;
  if(!sesion)crudosPorPosicion.forEach(({crudos})=>crudos.forEach(pt=>{const d=pfLondonDayDe(pt.t);if(!sesion||d>sesion)sesion=d;}));
  if(!sesion)return r;
  r.sesion=sesion;
  const series=crudosPorPosicion.map(({p,q,crudos})=>({p,q,puntos:crudos.filter(pt=>pfLondonDayDe(pt.t)===sesion).sort((a,b)=>a.t-b.t)}));
  r.cobertura=series.map(s=>({simbolo:s.p.simbolo,ok:s.puntos.length>0,puntos:s.puntos.length}));
  const conDatos=series.filter(s=>s.puntos.length>0),faltantes=series.filter(s=>!s.puntos.length);
  if(!conDatos.length)return r;
  // Una posición sin velas en la sesión (p. ej. un ETF poco líquido que aún
  // no operó hoy) no se excluye del valor — eso desplazaba toda la curva —:
  // aporta su precio vigente validado (pfMarketEstimate) como constante.
  // Si ni eso existe, la serie queda marcada como parcial.
  let deltaFijo=0;const sinPrecio=[];
  faltantes.forEach(f=>{const est=pfMarketEstimate(f.p,f.q),d=est?pfDeltaPosicion(f.p,est.price):null;if(d===null)sinPrecio.push(f.p.simbolo);else deltaFijo+=d;});

  const tsSet=new Set();
  conDatos.forEach(s=>s.puntos.forEach(pt=>tsSet.add(pt.t)));
  const timeline=[...tsSet].sort((a,b)=>a-b);
  r.usados=timeline.length;

  const puntos=[];
  for(const t of timeline){
    let deltaTotal=deltaFijo,completos=0;
    for(const s of conDatos){
      let precio=null;
      for(let i=s.puntos.length-1;i>=0;i--){if(s.puntos[i].t<=t){precio=s.puntos[i].price;break;}}
      if(precio===null)continue;
      const d=pfDeltaPosicion(s.p,precio);
      if(d===null)continue;
      deltaTotal+=d;completos++;
    }
    if(completos===conDatos.length)puntos.push({t,valor:base+deltaTotal});
  }
  r.puntos=puntos;
  r.ok=puntos.length>0;
  r.fuente=sinPrecio.length?'YAHOO_PARCIAL':'YAHOO';
  if(faltantes.length)r.notaFallback=sinPrecio.length
    ?'Serie incompleta: '+sinPrecio.join(', ')+' sin datos de esa sesión.'
    :faltantes.map(f=>f.p.simbolo).join(', ')+' sin operaciones en la sesión: se usa su último precio.';
  return r;
}

// Fin de la sesión regular `sesion` según Yahoo (el mayor session_end de las
// cotizaciones de ese día). null si no se conoce.
function pfFinSesion(sesion){
  const fines=pfYahoo.quotes.filter(q=>q.status==='ok'&&q.session_end&&pfLondonDay(new Date(q.session_end))===sesion).map(q=>Date.parse(q.session_end)).filter(Number.isFinite);
  return fines.length?Math.max(...fines):null;
}

// Orquesta la cascada de fallback (A→D) y reconcilia el último punto con
// obtenerValorActualPortafolio() — así el hero y el final del gráfico NUNCA
// pueden divergir, comparten la misma función y el mismo valor.
export let pfUltimoDiag1D=null;

function construirSerieIntradia(){
  const anterior=pfCierreAnterior();
  if(!anterior||!(Number(anterior.valor_total)>0))return{ok:false,mensaje:'Todavía no hay un cierre oficial de referencia para calcular el día.'};
  const moneda=anterior.moneda_base;
  const dia=pfModeloDia(),v=dia.v;
  // Sin valor Yahoo: el "día" es el cambio entre los dos últimos cierres
  // IBKR, igual que el hero. Nunca una curva de Yahoo contra una base IBKR.
  if(dia.fuente==='IBKR_CIERRES'){
    pfUltimoDiag1D=null;
    if(!dia.ok)return{ok:false,mensaje:'Sin cotizaciones de Yahoo válidas y con un solo cierre oficial: todavía no hay un día que mostrar.',dia};
    const filas=pfHistoricoCache.filter(r=>Number(r.valor_total)>0),a=filas[filas.length-2],b=filas[filas.length-1];
    const puntos=[{t:+parseDateOnly(a.fecha_valoracion),valor:dia.base},{t:+parseDateOnly(b.fecha_valoracion),valor:dia.actual}];
    return{ok:true,serie:puntos.map(p=>({t:p.t,valor:pfVista==='rendimiento'?(p.valor/dia.base-1)*100:p.valor})),moneda,base:dia.base,actual:dia.actual,
      notaFallback:'Sin cotizaciones de Yahoo utilizables ('+dia.motivo+'): se muestra el cambio entre los dos últimos cierres oficiales de IBKR.',fuente:'IBKR',sesion:null,dia,etiquetaX:pfEtiquetaFecha};
  }
  const base=dia.base;
  const tl=construirTimelineIntradia(dia.fuente==='YAHOO'?dia.sesion:null);
  pfUltimoDiag1D=tl;
  let puntos=[],fuente='SIN_DATOS',notaFallback=dia.fuente==='IBKR_BASE'?dia.motivo:'';
  const nota=t=>{notaFallback=notaFallback?notaFallback+' '+t:t;};
  if(tl.ok){
    puntos=tl.puntos.map(p=>({t:p.t,valor:p.valor}));fuente=tl.fuente;if(tl.notaFallback)nota(tl.notaFallback);
  }
  else if(pfSnapshotsHoyCache.length&&!dia.sesion){
    // C) fallback: portfolio_snapshots (curva calculada guardada durante la
    // sesión). Solo cuando no se sabe de qué sesión es la base (IBKR_BASE):
    // con base Yahoo, los snapshots podrían ser de otro snapshot IBKR.
    puntos=pfSnapshotsHoyCache
      .map(sn=>({t:Date.parse(sn.capturado_en),valor:Number(sn.valor_calculado)}))
      .filter(p=>p.valor>0&&Number.isFinite(p.t));
    fuente='SNAPSHOTS';
    nota('Sin serie intradía de Yahoo todavía — usando estimaciones guardadas durante la sesión.');
  }

  // El último punto ES el valor del hero (misma fuente: v.valor).
  //  · Sesión abierta: se agrega "ahora" con el valor en vivo.
  //  · Mercado cerrado (escenario D): la curva termina en el último precio
  //    regular, a la hora de cierre de la sesión — nunca se estira hasta la
  //    hora actual. Si Yahoo publica el cierre oficial (subasta) después de
  //    la última vela, ese precio reemplaza el valor del último punto.
  if(puntos.length){
    const ultimo=puntos[puntos.length-1];
    if(pfYahooSessionOpen()){
      const yaEsIgual=Math.abs(ultimo.valor-v.valor)<0.005&&(Date.now()-ultimo.t)<5*60*1000;
      if(!yaEsIgual)puntos.push({t:Date.now(),valor:v.valor});
    }else if(Math.abs(ultimo.valor-v.valor)>=0.005){
      const finSesion=pfFinSesion(tl.sesion),precioEn=Date.parse(v.timestamp);
      const tFin=Math.max(ultimo.t,Math.min(finSesion??ultimo.t,Number.isFinite(precioEn)?precioEn:ultimo.t));
      if(tFin>ultimo.t)puntos.push({t:tFin,valor:v.valor});else ultimo.valor=v.valor;
    }
  }

  // D) último recurso — sin serie real: cierre anterior + valor actual, sin
  // inventar nada intermedio (dos puntos, rotulado).
  if(puntos.length<2){
    const fin=pfFinSesion(tl.sesion||dia.sesion);
    const tFin=pfYahooSessionOpen()?Date.now():Math.min(fin??Date.now(),Date.now());
    const inicio=pfYahoo.quotes.map(q=>Date.parse(q.session_start)).filter(t=>Number.isFinite(t)&&t<tFin);
    puntos=[{t:inicio.length?Math.min(...inicio):tFin-60*60*1000,valor:base},{t:tFin,valor:v.valor}];
    fuente='MINIMO';
    nota('Sin serie intradía de Yahoo: solo el cierre anterior y el precio actual.');
  }

  puntos.sort((a,b)=>a.t-b.t);
  const actual=puntos[puntos.length-1].valor;
  const serie=puntos.map(p=>({t:p.t,valor:pfVista==='rendimiento'?(p.valor/base-1)*100:p.valor}));
  return{ok:true,serie,moneda,base,actual,notaFallback,fuente,sesion:tl.sesion||dia.sesion,dia};
}

// ── 1S / 1M: intradía de varias sesiones ────────────────────────────────────
// Cada sesión d se valora exactamente como el 1D: el cierre oficial de IBKR
// anterior a d más Σ pfDeltaPosicion(posición de ESE cierre, precio Yahoo(t)).
// Así se usan las cantidades que realmente tenías ese día (posiciones_historial)
// y un aporte o una compra nunca se mezclan con el movimiento de precios.
//  · Cada posición aporta su último precio <= t dentro de la sesión; un
//    instante en que alguna aún no cotizó no se usa (no se inventa nada).
//  · Una posición sin velas en la sesión (poco líquida o sin equivalencia
//    Yahoo) aporta su precio oficial de cierre de ese día como constante.
//  · Una sesión que no se puede reconstruir (sin posiciones al cierre
//    anterior, p. ej. el día de la primera compra, o sin velas) entra solo
//    con su cierre oficial: un punto real, nunca una curva inventada.
export function construirSerieSesiones(quotes,posHist,historial,desdeISO){
  const qByKey=new Map(quotes.map(q=>[String(q.account)+'|'+String(q.contract_id),q]));
  const cierres=historial.filter(r=>Number(r.valor_total)>0);
  const posPorFecha=new Map();
  posHist.forEach(p=>{if(!posPorFecha.has(p.fecha_valoracion))posPorFecha.set(p.fecha_valoracion,[]);posPorFecha.get(p.fecha_valoracion).push(p);});
  // Velas por posición y por sesión (día de Londres).
  const velas=new Map();
  quotes.forEach(q=>{const k=String(q.account)+'|'+String(q.contract_id),m=new Map();
    q.points.forEach(pt=>{const d=pfLondonDayDe(pt.t);if(!m.has(d))m.set(d,[]);m.get(d).push(pt);});
    m.forEach(v=>v.sort((a,b)=>a.t-b.t));velas.set(k,m);});
  const sesiones=[...new Set([...velas.values()].flatMap(m=>[...m.keys()]))].filter(d=>d>=desdeISO).sort();
  const puntos=[];let omitidas=0;
  for(const d of sesiones){
    let base=null;for(let i=cierres.length-1;i>=0;i--)if(cierres[i].fecha_valoracion<d){base=cierres[i];break;}
    const filas=base?posPorFecha.get(base.fecha_valoracion)||[]:[];
    const cierreDia=cierres.find(r=>r.fecha_valoracion===d);
    // Punto de cierre oficial (cierre:true): en la vista Rendimiento se toma
    // el TWR de ese cierre tal cual; su hora es la del cierre de Londres.
    const soloCierre=()=>{omitidas++;if(cierreDia&&base)puntos.push({t:pfCierreLondres(d),valor:Number(cierreDia.valor_total),fecha:d,base:Number(base.valor_total),fechaBase:base.fecha_valoracion,cierre:true});};
    if(!base||!filas.length){soloCierre();continue;}
    const C=Number(base.valor_total),oficialDia=new Map((posPorFecha.get(d)||[]).map(p=>[pfQuoteKey(p),p]));
    let deltaFijo=0,rota=false;const conVelas=[];
    filas.forEach(p=>{
      const pts=(velas.get(pfQuoteKey(p))||new Map()).get(d)||[];
      if(pts.length){conVelas.push({p,pts});return;}
      const o=oficialDia.get(pfQuoteKey(p));
      const dlt=o?pfDeltaPosicion(p,Number(o.precio_mercado)):0;
      if(dlt===null)rota=true;else deltaFijo+=dlt;
    });
    if(rota||!conVelas.length){soloCierre();continue;}
    const timeline=[...new Set(conVelas.flatMap(s=>s.pts.map(pt=>pt.t)))].sort((a,b)=>a-b);
    for(const t of timeline){
      let delta=deltaFijo,completos=0;
      for(const s of conVelas){
        let precio=null;
        for(let i=s.pts.length-1;i>=0;i--){if(s.pts[i].t<=t){precio=s.pts[i].price;break;}}
        if(precio===null)break;
        const dlt=pfDeltaPosicion(s.p,precio);if(dlt===null)break;
        delta+=dlt;completos++;
      }
      if(completos===conVelas.length)puntos.push({t,valor:C+delta,fecha:d,base:C,fechaBase:base.fecha_valoracion});
    }
  }
  return{ok:puntos.length>1,puntos,omitidas,fechaBase:puntos[0]?.fechaBase??null,base:puntos[0]?.base??null};
}

// 16:30 de Londres del día `iso` (cierre regular de la LSE), en epoch ms.
function pfCierreLondres(iso){
  const utc=Date.parse(iso+'T16:30:00Z');
  const hLondres=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'numeric',hourCycle:'h23'}).format(new Date(utc)));
  return utc-(hLondres-16)*3600e3;
}

// Segmenta una serie en tramos contiguos por encima/debajo de una
// referencia (por defecto 0 — la vista de valor absoluto pasa el primer
// punto), insertando un punto sintético (solo para dibujar, nunca se toca
// `validos`) en el cruce exacto, interpolado linealmente entre los dos
// puntos reales que lo rodean. El punto de cruce cierra un tramo y abre el
// siguiente (extremo compartido) para que la línea no tenga huecos.
function pfSegmentarPorSigno(validos,ref=0){
  if(validos.length<2)return[validos];
  const conCruces=[validos[0]];
  for(let i=1;i<validos.length;i++){
    const a=validos[i-1],b=validos[i];
    if((a.valor>=ref)!==(b.valor>=ref)){
      const fa=Math.abs(a.valor-ref),fb=Math.abs(b.valor-ref),frac=(fa+fb)>0?fa/(fa+fb):0.5;
      conCruces.push({t:a.t+(b.t-a.t)*frac,valor:ref,cruce:true});
    }
    conCruces.push(b);
  }
  const tramos=[];
  let actual=[conCruces[0]];
  for(let i=1;i<conCruces.length;i++){
    actual.push(conCruces[i]);
    if(conCruces[i].cruce){tramos.push(actual);actual=[conCruces[i]];}
  }
  tramos.push(actual);
  return tramos;
}

function pfColorTramo(tramo,fallback,ref=0){
  const p=tramo.find(p=>p.valor!==ref);
  return p?(p.valor>=ref?'var(--green)':'var(--red)'):fallback;
}

// Un punto por instante: si llegan dos con el mismo t (p. ej. el cierre de hoy
// y el punto en vivo de la misma fecha), gana el último. Nunca se promedian.
function pfSinDuplicados(puntos){
  const porT=new Map();
  puntos.forEach(p=>porT.set(p.t,p));
  return[...porT.values()].sort((a,b)=>a.t-b.t);
}

// Gráfico de línea de TODOS los períodos del portafolio (1D por hora; 1S…Todo
// y Desde por fecha). Devuelve el SVG y el mapeo x(t)/y(valor) para el tooltip.
//  opts.escala        'auto' (rango observado + margen) o 'cero' (incluye 0).
//  opts.rangoMinimo   rango vertical mínimo, en unidades de la serie: evita
//                     que una variación insignificante parezca enorme.
//  opts.referencia    valor de partida (0% o el primer valor): colorea tramos.
//  opts.etiqueta      texto del pill del tooltip (hora o fecha del punto).
//  opts.etiquetaEje   texto de las marcas del eje X (por defecto, opts.etiqueta).
//  opts.xPorIndice    puntos equiespaciados: sin huecos de mercado cerrado.
export function construirGraficoIntradia(puntos,opts={}){
  const validos=pfSinDuplicados(puntos.filter(p=>p.valor!=null&&Number.isFinite(Number(p.valor))&&Number.isFinite(p.t)));
  if(validos.length<2)return{svg:'<div class="empty">'+esc(opts.vacio||'No hay suficientes datos de hoy para graficar.')+'</div>',meta:null};
  // Con muchísimos puntos solo se DIBUJA un subconjunto que conserva picos y
  // valles (LTTB); el tooltip sigue recorriendo todos los puntos reales.
  const dibujo=lttb(validos,1000);
  const vals=validos.map(p=>p.valor);
  const [yMin,yMax]=dominioY(vals,{modo:opts.escala==='cero'?'cero':'auto',rangoMinimo:opts.rangoMinimo||0});
  // Composición tipo Yahoo Finance: 560×330 (≈1.7:1) y casi sin padding
  // lateral: no hay etiquetas numéricas en el eje Y (se leen tocando el
  // gráfico), así que ese espacio se le devuelve a la curva.
  const VB_W=560,VB_H=330,PAD_L=10,PAD_R=8,PAD_T=14,PAD_B=26;
  const baseline=VB_H-PAD_B,innerH=baseline-PAD_T,innerW=(VB_W-PAD_R)-PAD_L;
  const denom=(yMax-yMin)||1;
  const t0=validos[0].t,tn=validos[validos.length-1].t,tden=(tn-t0)||1;
  // xPorIndice: los puntos van equiespaciados (como Yahoo en 5D/1M), así las
  // noches, los fines de semana y los feriados no ocupan espacio ni dibujan
  // un tramo plano. Un instante intermedio (cruce de la referencia) se ubica
  // interpolando entre los dos puntos reales que lo rodean.
  const tiempos=validos.map(p=>p.t),nIdx=(validos.length-1)||1;
  const indiceDe=t=>{
    if(t<=tiempos[0])return 0;if(t>=tiempos[tiempos.length-1])return tiempos.length-1;
    let lo=0,hi=tiempos.length-1;
    while(hi-lo>1){const m=(lo+hi)>>1;if(tiempos[m]<=t)lo=m;else hi=m;}
    return lo+(t-tiempos[lo])/((tiempos[hi]-tiempos[lo])||1);
  };
  const x=opts.xPorIndice?(t=>PAD_L+indiceDe(t)/nIdx*innerW):(t=>PAD_L+(t-t0)/tden*innerW);
  const y=v=>baseline-(v-yMin)/denom*innerH;
  const color=opts.color||(vals[vals.length-1]>=vals[0]?'var(--green)':'var(--red)');
  const etiqueta=opts.etiqueta||(t=>new Date(t).toLocaleTimeString('es-PE',{hour:'numeric',minute:'2-digit'}));
  let svg=`<svg viewBox="0 0 ${VB_W} ${VB_H}" class="chart-svg" style="aspect-ratio:${VB_W}/${VB_H}" role="img" aria-label="${esc(opts.aria||'Rendimiento intradía del portafolio')}">`;
  // Grid horizontal extremadamente sutil: sin números — el valor exacto se
  // lee tocando el gráfico (hero + pill de fecha u hora).
  for(let i=1;i<3;i++){const yy=PAD_T+innerH*(i/3);
    svg+=`<line x1="${PAD_L}" y1="${yy}" x2="${VB_W-PAD_R}" y2="${yy}" stroke="var(--border)" opacity=".15"/>`;}
  // Referencia (dónde arrancó el gráfico): 0% en rendimiento, o el primer
  // valor en la vista de valor. Cada tramo se pinta del color de su signo
  // respecto a ella; la línea punteada se recorta al borde si queda fuera.
  const ref=opts.referencia??0;
  const tramos=pfSegmentarPorSigno(dibujo,ref);
  const yRefClamp=Math.min(baseline,Math.max(PAD_T,y(ref)));
  tramos.forEach(tramo=>{
    if(tramo.length<2)return;
    const c=pfColorTramo(tramo,color,ref);
    const d=tramo.map((p,i)=>(i?'L':'M')+x(p.t).toFixed(2)+' '+y(p.valor).toFixed(2)).join(' ');
    svg+=`<path d="${d} L ${x(tramo[tramo.length-1].t).toFixed(2)} ${yRefClamp.toFixed(2)} L ${x(tramo[0].t).toFixed(2)} ${yRefClamp.toFixed(2)} Z" fill="${c}" opacity=".08"/>`;
  });
  tramos.forEach(tramo=>{
    if(tramo.length<2)return;
    const c=pfColorTramo(tramo,color,ref);
    const d=tramo.map((p,i)=>(i?'L':'M')+x(p.t).toFixed(2)+' '+y(p.valor).toFixed(2)).join(' ');
    svg+=`<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  svg+=`<line x1="${PAD_L}" y1="${yRefClamp.toFixed(2)}" x2="${VB_W-PAD_R}" y2="${yRefClamp.toFixed(2)}" stroke="var(--dim)" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>`;
  // Eje X: ~4 marcas (hora en el 1D, fecha en el resto), no más — la exacta
  // aparece en el pill vertical mientras se hace scrubbing.
  const numEtiquetas=Math.min(4,validos.length);
  const idxs=[...new Set(Array.from({length:numEtiquetas},(_,i)=>Math.round(i*(validos.length-1)/(numEtiquetas-1||1))))];
  let etiquetaAnterior=null;
  idxs.forEach(i=>{const p=validos[i],anchor=i===0?'start':i===validos.length-1?'end':'middle',texto=(opts.etiquetaEje||etiqueta)(p.t);
    if(texto===etiquetaAnterior)return;etiquetaAnterior=texto;
    svg+=`<text x="${x(p.t).toFixed(2)}" y="${baseline+18}" text-anchor="${anchor}" font-size="10">${esc(texto)}</text>`;});
  svg+=`<g id="pfIntraTip" style="display:none;pointer-events:none"><line id="pfIntraTipLine" x1="0" y1="${PAD_T}" x2="0" y2="${baseline}" stroke="var(--dim)" stroke-width="1"/><circle id="pfIntraTipDot" r="4" fill="${color}" stroke="var(--bg)" stroke-width="1.5"/></g>`;
  svg+='</svg>';
  return{svg,x,y,meta:{VB_W,VB_H,PAD_L,baseline,puntos:validos,etiqueta,dominio:[yMin,yMax]}};
}

// Scrubbing tipo Yahoo Finance (secciones 2-8, 18-23 del pedido): el HERO de
// arriba (pfHeroValor/pfHeroHoy/pfFrescura) pasa a mostrar el punto tocado
// — el gráfico en sí solo aporta la guía visual (línea + punto + hora), ya
// no repite valor/% en una caja flotante (eso ahora vive arriba, sección 5).
// Un solo listener por SVG, Pointer Events (mouse y dedo). Lo usan todos
// los períodos. Nunca recalcula el portafolio ni toca pfYahoo/Supabase/snapshots
// (secciones 19-21): usa directamente los puntos ya construidos por
// construirSerieIntradia y solo escribe texto en el DOM — instantáneo,
// pensado para que se sienta fluido en un teléfono.
export function pfWireChartTooltip(container,grafico,opts){
  if(!grafico.meta)return;
  const svgEl=container.querySelector('svg');
  if(!svgEl)return;
  // pan-y (no "none"): el navegador conserva el scroll vertical de la
  // página; el arrastre horizontal lo captura este listener (sección 6).
  svgEl.style.touchAction='pan-y';
  const tipG=svgEl.querySelector('#pfIntraTip'),tipLine=svgEl.querySelector('#pfIntraTipLine'),tipDot=svgEl.querySelector('#pfIntraTipDot');
  let label=container.querySelector('.pf-intraday-tooltip');
  if(!label){label=document.createElement('div');label.className='pf-intraday-tooltip';container.appendChild(label);}
  label.style.display='none';
  const {puntos,VB_W,etiqueta}=grafico.meta;
  const heroValorEl=document.getElementById('pfHeroValor'),heroHoyEl=document.getElementById('pfHeroHoy'),frescuraEl=document.getElementById('pfFrescura');
  function puntoDesdeEvento(evt){
    const rect=svgEl.getBoundingClientRect();
    const fracX=(evt.clientX-rect.left)/rect.width;
    const vbX=Math.min(Math.max(fracX,0),1)*VB_W;
    let mejor=puntos[0],mejorDist=Infinity;
    puntos.forEach(p=>{const d=Math.abs(grafico.x(p.t)-vbX);if(d<mejorDist){mejorDist=d;mejor=p;}});
    return mejor;
  }
  function mostrar(evt){
    const p=puntoDesdeEvento(evt),xPix=grafico.x(p.t),yPix=grafico.y(p.valor);
    const d=opts.describir(p);
    const color=pfColor(d.pctNum);
    tipLine.setAttribute('x1',xPix);tipLine.setAttribute('x2',xPix);
    tipDot.setAttribute('cx',xPix);tipDot.setAttribute('cy',yPix);
    tipDot.setAttribute('fill',color);
    tipG.style.display='';
    const hora=d.fechaTexto||etiqueta(p.t);
    label.textContent=hora;
    label.style.display='block';
    label.style.left=Math.min(Math.max((xPix/VB_W)*100,10),90)+'%';
    // Hero temporal (secciones 2-3, 14, 18): reemplaza valor/rendimiento/hora
    // mientras se arrastra. evt.preventDefault evita seleccionar texto.
    if(heroValorEl)heroValorEl.textContent=d.valorTexto;
    // lineaTexto: la vista Valor no muestra un %, que ahí mezclaría aportes
    // con rentabilidad; describe el punto con su propio texto.
    if(heroHoyEl){heroHoyEl.textContent=d.lineaTexto!=null?d.lineaTexto:d.gananciaTexto?d.gananciaTexto+' ('+d.pctTexto+')':d.pctTexto;heroHoyEl.style.color=color;}
    if(frescuraEl)frescuraEl.textContent=hora;
    if(evt.cancelable)evt.preventDefault();
  }
  function ocultar(){
    tipG.style.display='none';label.style.display='none';
    // Sección 4: se restaura con las mismas funciones que pintan el hero
    // normal — nunca se duplica el cálculo acá, y nunca se escribe nada
    // fuera del DOM (sección 19: pfYahoo/Supabase quedan intactos).
    pintarValorPrincipal();
  }
  svgEl.addEventListener('pointerdown',mostrar);
  svgEl.addEventListener('pointermove',evt=>{if(evt.buttons||evt.pointerType==='touch')mostrar(evt);});
  svgEl.addEventListener('pointerup',ocultar);
  svgEl.addEventListener('pointercancel',ocultar);
  svgEl.addEventListener('pointerleave',ocultar);
}

// ── Contribución por activo al rendimiento del día ─────────────────────────
// No es el % del activo: es cuánto movió AL PORTAFOLIO, pesando su tamaño.
// Sale de pfModeloDia (mismos precios, misma base que el hero): contribución
// en pp = cambio en dinero del activo ÷ base del portafolio. Así la suma de
// contribuciones (más el efectivo, que aporta 0) es exactamente el % del día.
// Solo con base Yahoo: con una base IBKR de respaldo no hay cierre anterior
// por activo y no se inventa un reparto.
let pfContribVerTodos=false;

function pfSignedPP(n){return n===null||n===undefined||!isFinite(n)?'—':(n>0.004?'+':n<-0.004?'−':'')+Math.abs(n).toFixed(2)+' pp';}

export function renderPfContribuciones(d){
  const el=document.getElementById('pfContrib');if(!el)return;
  if(!d||!d.ok||d.fuente!=='YAHOO'||!d.contribuciones.length){
    el.innerHTML=d&&d.ok&&d.fuente==='IBKR_BASE'?'<div class="pf-contrib"><p class="pf-contrib-foot">Contribución por activo no disponible: falta el cierre anterior de Yahoo de alguna posición.</p></div>':'';
    return;
  }
  const fila=c=>`<div class="pf-contrib-row"><span><i class="pf-color-dot" style="background:${pfAssetColor(c.simbolo)}"></i>${esc(c.simbolo)}</span><span class="v" style="color:${pfColor(c.cambio)}">${esc(pfSigned(c.cambio,d.moneda))} · ${esc(pfSignedPct(c.pctActivo))} · ${esc(pfSignedPP(c.pp))}</span></div>`;
  const orden=[...d.contribuciones].sort((a,b)=>b.pp-a.pp);
  let cuerpo;
  if(pfContribVerTodos){
    cuerpo=orden.map(fila).join('')+
      `<div class="pf-contrib-row"><span><i class="pf-color-dot" style="background:var(--dim)"></i>Efectivo</span><span class="v" style="color:var(--dim)">${esc(pfFmt(d.efectivo.valor,d.moneda))} · no cambia · 0.00 pp</span></div>`;
  }else{
    const suben=orden.filter(c=>c.cambio>=0.005).slice(0,3),bajan=orden.filter(c=>c.cambio<=-0.005).reverse().slice(0,3);
    cuerpo=(suben.length?'<div class="pf-contrib-grupo">Suben</div>'+suben.map(fila).join(''):'')+
      (bajan.length?'<div class="pf-contrib-grupo">Bajan</div>'+bajan.map(fila).join(''):'')+
      (!suben.length&&!bajan.length?'<p class="pf-contrib-foot">Ningún activo se movió en la sesión.</p>':'');
  }
  const suma=d.contribuciones.reduce((s,c)=>s+c.pp,0);
  el.innerHTML='<div class="pf-contrib"><div class="pf-contrib-head"><strong>Principales contribuidores</strong><span>Cambio en US$ · % del activo · aporte al portafolio (pp)</span></div>'+cuerpo+
    `<p class="pf-contrib-foot">Suma de contribuciones ${esc(pfSignedPP(suma))} = rendimiento del día ${esc(pfSignedPct(d.pct))}. Aporte = cambio del activo ÷ valor del portafolio al cierre anterior${d.efectivo.peso!==null?' (el efectivo pesa '+d.efectivo.peso.toFixed(1)+'% y aporta 0)':''}.</p>`+
    `<button type="button" class="pf-contrib-btn" onclick="pfContribVerTodos=!pfContribVerTodos;renderPfContribuciones(pfModeloDia())">${pfContribVerTodos?'Ver principales':'Ver todos ('+d.contribuciones.length+' + efectivo)'}</button></div>`;
}

export function renderPfChart1D(area,titulo,hint,res){
  // Un fallback de dos cierres no es la curva intradía que está llegando.
  // Con una cotización válida en caché, mantener la curva durante el refresh.
  if(pfPosicionesCache.length&&['idle','loading'].includes(pfYahoo.status)&&obtenerValorActualPortafolio().fuente!=='YAHOO'){
    area.setAttribute('aria-busy','true');titulo.textContent='';hint.textContent='';res.innerHTML='';
    area.innerHTML='<div class="pf-chart-loading" role="status"><span class="pf-chart-loading-dot" aria-hidden="true"></span>Cargando rendimiento…</div>';
    renderPfContribuciones(null);return;
  }
  area.setAttribute('aria-busy','false');
  const s=construirSerieIntradia();
  if(!s.ok){titulo.textContent='';area.innerHTML='<div class="pf-data-note">'+esc(s.mensaje)+'</div>';hint.textContent='';res.innerHTML='';renderPfContribuciones(null);return;}
  const colorLinea=(s.actual-s.base)>=0?'var(--green)':'var(--red)';
  titulo.textContent=s.dia.fuente==='IBKR_CIERRES'?'Últimos cierres IBKR':(s.sesion&&s.sesion!==pfLondonDay())?'Última sesión · '+pfFechaCorta(s.sesion):'Hoy';
  const opcX=s.etiquetaX?{etiqueta:s.etiquetaX}:{};
  if(pfVista==='rendimiento'){
    // Referencia 0% = "dónde estaba el rendimiento al inicio" (siempre 0,
    // por definición). El coloreado por tramos y la línea punteada viven en
    // construirGraficoIntradia (referencia por defecto).
    const grafico=construirGraficoIntradia(s.serie,{color:colorLinea,...opcX,...pfOpcionesEscala(s.serie,{vista:'rendimiento',intradia:true})});
    area.innerHTML=grafico.svg;
    pfWireChartTooltip(area,grafico,{describir:p=>{
      const valorAbs=s.base*(1+p.valor/100),ganancia=valorAbs-s.base;
      return{valorTexto:pfFmt(valorAbs,s.moneda),gananciaTexto:pfSigned(ganancia,s.moneda),pctTexto:pfSignedPct(p.valor),pctNum:p.valor};
    }});
  }else{
    // En valor absoluto la referencia es el primer punto mostrado (el valor
    // con el que arrancó ESTE gráfico), no 0 — un portafolio nunca cruza $0.
    // (con base Yahoo es el cierre anterior, no la primera vela)
    const grafico=construirGraficoIntradia(s.serie,{color:colorLinea,referencia:s.base,...opcX,...pfOpcionesEscala(s.serie,{vista:'valor',intradia:true})});
    area.innerHTML=grafico.svg;
    pfWireChartTooltip(area,grafico,{describir:p=>{
      const pctNum=(p.valor/s.base-1)*100,ganancia=p.valor-s.base;
      return{valorTexto:pfFmt(p.valor,s.moneda),gananciaTexto:pfSigned(ganancia,s.moneda),pctTexto:pfSignedPct(pctNum),pctNum};
    }});
  }
  // Sección 21: sin párrafo técnico en la vista principal — el detalle
  // (fuente, cobertura, fallback, puntos usados) vive en Diagnóstico.
  hint.textContent=s.notaFallback||'';
  // Secciones 15-17: debajo del 1D NO se repite "Hoy" — eso ya está arriba,
  // en el hero (y durante el scrubbing). Acá va el rendimiento TOTAL desde
  // que empezaste a invertir, con la misma metodología que la card Resumen
  // (pfModeloGanancia), usando el valor actual (Yahoo en vivo si está
  // disponible — s.actual es exactamente lo que muestra el hero, nunca se
  // recalcula aparte) en vez de solo el último cierre oficial.
  const official=pfCierreAnterior();
  const g=official?pfModeloGanancia({...official,valor_total:s.actual},pfFlujos()):{ok:false,mensaje:''};
  // Referencia fija (pedido del usuario): con las etiquetas del eje Y fuera
  // y la escala ajustada al rango del día, el valor de "antes de la
  // apertura" (el cierre de ayer, base del 0%) ya no se aprecia en el
  // gráfico salvo tocando justo el primer punto — se deja como cifra fija.
  const cifras='<div class="pf-rend-row" style="grid-template-columns:1fr 1fr"><div>'+(s.dia.fuente==='YAHOO'?'Cierre anterior':'Cierre IBKR base')+'<strong>'+esc(pfFmt(s.base,s.moneda))+'</strong></div><div>'+(s.dia.fuente==='IBKR_CIERRES'?'Último cierre':pfYahooSessionOpen()?'Ahora':'Al cierre')+'<strong style="color:'+pfColor(s.actual-s.base)+'">'+esc(pfFmt(s.actual,s.moneda))+'</strong></div></div>';
  res.innerHTML=cifras+(g.ok
    ?'<div class="pf-rend-big">Rendimiento total<strong style="color:'+pfColor(g.pct)+'">'+esc(pfSignedPct(g.pct))+'</strong></div><div class="pf-rend-row" style="grid-template-columns:1fr 1fr"><div>Ganancia total<strong style="color:'+pfColor(g.ganancia)+'">'+esc(pfSigned(g.ganancia,s.moneda))+'</strong></div><div>Aportes netos<strong>'+esc(pfFmt(g.aportes,s.moneda))+'</strong></div></div>'
    :(g.mensaje?'<p class="hint">'+esc(g.mensaje)+'</p>':''));
  renderPfContribuciones(s.dia);
  renderPfDiagnostico1D(s);
  renderPfBenchmark(null);
}
