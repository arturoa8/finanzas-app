// Portafolio: encabezado (valor principal, variacion del dia, moneda).
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {pfAportesSinReflejar, pfCostosInversion, pfModeloCapital, renderPfCostosEditor} from './capital.js';
import {cuentasInversionHistoricas, pfFlujos, pfRendimientoPortafolio, pfResumenPosiciones} from './performance.js';
import {pfModeloRentabilidadCambio} from './fx-performance.js';
import {renderPfResultadoCambio} from './fx-ui.js';
import {cuentasApp} from '../accounts.js';
import {renderPfPosiciones} from './portfolio-ui.js';
import {pfColor, pfFechaCorta, pfHistoricoCache, pfIso, pfPosicionesCache, pfSigned, pfSignedPct, pfUltimaSyncCache, renderPfChart, renderPfResumen} from './portfolio.js';
import {cargarTcMercado, leerTipoCambio, tcMercado, tcMercadoFecha, tcUsdPen} from '../../services/exchange-rate.js';
import {datos} from '../../state.js';
import {pfComputeBaseId, pfComputeScope, pfLondonDay, pfMarketEstimate, pfOperacionesSinSincronizar, pfQuoteKey, pfSesionQuote, pfYahoo, pfYahooSessionOpen} from '../../services/market-data.js';
import {fmtDateShort, parseDateOnly} from '../../utils/dates.js';
import {fmtMoneda} from '../../utils/formatters.js';
import {pfNumber} from '../../utils/numbers.js';

// El cierre oficial más reciente: línea base de "hoy" y del 1D intradía.
// Cuando el cron ya corrió, esta fila ES el cierre de ayer (última sesión
// cerrada) — la referencia correcta para medir el movimiento de hoy.
export function pfCierreAnterior(){
  const filas=pfHistoricoCache.filter(r=>Number(r.valor_total)>0);
  return filas.length?filas[filas.length-1]:null;
}

// Única fuente de verdad del "valor actual del portafolio" (sección 2 del
// pedido de corrección). IBKR = posiciones/cantidades/costo/efectivo/
// histórico oficial. Yahoo = precio de mercado actual, cuando hay cotización
// válida para TODAS las posiciones. Nadie más decide esto: hero, Resumen,
// 1D y los períodos más largos llaman a esta función en vez de recalcular.
// Pura y barata (no hace red): lee pfYahoo.quotes (ya pedidas por
// refreshPfYahoo), pfPosicionesCache y pfCierreAnterior().
// Delta de UNA posición para un precio dado, frente a su valor oficial IBKR
// — misma fórmula que pfMarketEstimate usa para el precio en vivo (fx del
// precio × cantidad × multiplicador − valor_mercado_base oficial), extraída
// para reutilizarla punto por punto al reconstruir la serie intradía (1D)
// sin duplicar la lógica.
export function pfDeltaPosicion(p,precio){
  const old=pfNumber(p.valor_mercado_base);
  const qty=pfNumber(p.cantidad),mult=pfNumber(p.multiplicador);
  if(old===null||precio===null||precio<=0||qty===null||mult===null)return null;
  const fx=p.moneda===p.moneda_base?1:pfNumber(p.fx_rate_a_base);
  if(fx===null||fx<=0)return null;
  return precio*qty*mult*fx-old;
}

export function obtenerValorActualPortafolio(){
  const official=pfCierreAnterior();
  const r={valor:null,fuente:'IBKR',timestamp:null,completo:false,cierreIbkr:null,diferenciaVsIbkr:null,pnlEstimado:null,cobertura:[]};
  if(!official)return r;
  r.cierreIbkr=Number(official.valor_total);
  r.valor=r.cierreIbkr;
  r.timestamp=official.fecha_valoracion;
  if(!pfPosicionesCache.length){r.diferenciaVsIbkr=0;return r;}

  // Gate de coherencia (regla final, sección 12 del pedido de corrección):
  // Yahoo solo se evalúa por posición si el caché completo pertenece al
  // mismo snapshot IBKR base y scope que se está pintando AHORA, y no hay
  // operaciones del ledger más nuevas que las posiciones cargadas. Si algo
  // no calza, se cae a IBKR de inmediato — nunca se mezcla IBKR nuevo con
  // Yahoo viejo (o viceversa).
  const baseIdActual=pfComputeBaseId();
  const cacheCoherente=pfYahoo.quotes.length>0&&baseIdActual!==null
    &&pfYahoo.scope===pfComputeScope()&&pfYahoo.baseId===baseIdActual;
  const operacionesPendientes=pfOperacionesSinSincronizar();
  // Escenario F: un aporte o retiro registrado DESPUÉS del último cierre
  // oficial todavía no está en el efectivo que trajo IBKR. Valorar con Yahoo
  // esas cantidades/efectivo daría un valor de un snapshot que ya no existe:
  // se queda el cierre IBKR (con el motivo visible) hasta que Flex lo refleje.
  const aportesPendientes=pfAportesSinReflejar(official);
  r.aportesPendientes=aportesPendientes;
  if(!cacheCoherente||operacionesPendientes||aportesPendientes.length){
    const motivo=operacionesPendientes
      ?'hay operaciones nuevas en el ledger que IBKR todavía no reflejó en las posiciones'
      :aportesPendientes.length
      ?'hay '+(aportesPendientes.length===1?'un aporte o retiro registrado':aportesPendientes.length+' aportes o retiros registrados')+' después del cierre IBKR del '+official.fecha_valoracion+' ('+aportesPendientes.join(', ')+') que IBKR todavía no refleja'
      :'las cotizaciones Yahoo en caché no corresponden al día/snapshot/scope actual';
    r.bloqueo=motivo;
    r.diferenciaVsIbkr=0;
    r.cobertura=pfPosicionesCache.map(p=>({simbolo:p.simbolo,ok:false,motivo,precioIbkr:pfNumber(p.precio_mercado),precioYahoo:null,valorIbkr:pfNumber(p.valor_mercado_base),valorYahoo:null}));
    return r;
  }

  const qByKey=new Map(pfYahoo.quotes.map(q=>[String(q.account)+'|'+String(q.contract_id),q]));
  let delta=0,completo=true,ultimoPrecioEn=null;
  pfPosicionesCache.forEach(p=>{
    const q=qByKey.get(pfQuoteKey(p));
    const estimate=pfMarketEstimate(p,q);
    // La hora real del precio (para "último dato HH:MM" fuera de sesión, ver
    // pintarValorPrincipal) es la del quote de Yahoo, NO el instante en que
    // se calculó este estimado — con mercado cerrado esas dos horas pueden
    // diferir por horas, y mostrar "ahora" sería inventar una actualización
    // que no ocurrió.
    if(estimate&&(ultimoPrecioEn===null||estimate.time>ultimoPrecioEn))ultimoPrecioEn=estimate.time;
    const old=pfNumber(p.valor_mercado_base);
    // Motivo exacto si esta posición no puede usar Yahoo (sección 6): se
    // guarda SIEMPRE (aunque ya esté completo=false por otra posición) para
    // que Diagnóstico pueda mostrar la lista entera, no solo la primera falla.
    let motivo=null;
    if(!q)motivo='sin cotización de Yahoo para este contrato';
    else if(q.status==='unmapped')motivo='sin equivalencia Yahoo verificada';
    else if(q.status!=='ok')motivo=q.message||('Yahoo: '+q.status);
    else if(!estimate)motivo='cotización Yahoo no pasó las validaciones (precio/edad/tipo)';
    else if(old===null)motivo='sin valor de mercado IBKR para comparar';
    else if(p.cuenta_ibkr!==official.cuenta_ibkr)motivo='cuenta distinta a la del cierre oficial usado como base';
    else if(p.moneda_base!==official.moneda_base)motivo='moneda base distinta a la del cierre oficial';
    else if(p.fecha_datos!==official.fecha_valoracion)motivo='posición del '+p.fecha_datos+', cierre base del '+official.fecha_valoracion+' — no son el mismo snapshot IBKR';
    r.cobertura.push({simbolo:p.simbolo,ok:!motivo,motivo,precioIbkr:pfNumber(p.precio_mercado),precioYahoo:estimate?estimate.price:null,valorIbkr:old,valorYahoo:estimate&&old!==null?estimate.baseValue:null});
    if(motivo){completo=false;return;}
    delta+=pfDeltaPosicion(p,estimate.price);
  });
  r.completo=completo;
  if(completo){
    r.valor=r.cierreIbkr+delta;
    r.fuente='YAHOO';
    r.timestamp=ultimoPrecioEn?new Date(ultimoPrecioEn).toISOString():new Date().toISOString();
    const rp=pfResumenPosiciones(official,pfPosicionesCache);
    if(rp.ok&&rp.costo>0)r.pnlEstimado=rp.pnl+delta;
  }
  r.diferenciaVsIbkr=r.valor-r.cierreIbkr;
  return r;
}

// Cabecera tipo Yahoo Finance + Resumen + frescura: se llama al cargar y cada
// vez que renderPfYahoo trae cotizaciones nuevas. Nunca recalcula el precio
// acá — todo sale de obtenerValorActualPortafolio().
export function pintarValorPrincipal(){
  const official=pfCierreAnterior();
  const heroEl=document.getElementById('pfHeroValor'),totalEl=document.getElementById('pfValorTotal'),
        refEl=document.getElementById('pfValorRef'),frescura=document.getElementById('pfFrescura'),
        pnlMainEl=document.getElementById('pfPnl'),pnlRefEl=document.getElementById('pfPnlEst');
  if(!official){if(heroEl)heroEl.textContent='—';return;}
  const v=obtenerValorActualPortafolio();
  const usaVivo=v.fuente==='YAHOO';
  const texto=pfFmt(v.valor,official.moneda_base);
  if(heroEl)heroEl.textContent=texto;
  if(totalEl)totalEl.textContent=texto;
  if(refEl)refEl.textContent=usaVivo?'Cierre IBKR: '+pfFmt(v.cierreIbkr,official.moneda_base):'';
  // "Mercado cerrado" (Parte A, sección 5) no es un problema ni algo
  // desactualizado: es simplemente el último precio vigente mientras ninguna
  // posición tenga sesión abierta — se dice así, sin sonar a advertencia.
  // Con el mercado cerrado se muestra la fecha Y hora reales del último precio
  // regular (p. ej. el viernes en un fin de semana), nunca la hora actual.
  if(frescura){
    const mercadoAbierto=usaVivo&&pfYahooSessionOpen();
    const estadoPrecio=usaVivo
    ?(mercadoAbierto
      ?'● Yahoo · en vivo · '+new Date(v.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})
      :'Yahoo · mercado cerrado · último precio regular '+new Date(v.timestamp).toLocaleString('es-PE',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))
    :'IBKR cierre oficial · '+fmtDateShort(parseDateOnly(official.fecha_valoracion))+(v.aportesPendientes&&v.aportesPendientes.length?' · aporte del '+pfFechaCorta(v.aportesPendientes[0])+' aún no reflejado por IBKR':'');
    frescura.textContent=usaVivo&&!mercadoAbierto
      ?'Yahoo · mercado cerrado · '+new Date(v.timestamp).toLocaleString('es-PE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
      :estadoPrecio;
    frescura.title=estadoPrecio;
    frescura.setAttribute('aria-label',estadoPrecio);
  }
  // P&L no realizado (sección 18): con Yahoo completo, el P&L PRINCIPAL pasa
  // a ser el calculado con precios Yahoo (renderPfResumen ya dejó ahí el
  // valor IBKR, que es el que se usa cuando Yahoo no está disponible); el
  // P&L IBKR queda como referencia secundaria, igual que el valor total.
  const rp=pfResumenPosiciones(official,pfPosicionesCache);
  if(usaVivo&&v.pnlEstimado!==null&&pnlMainEl){
    pnlMainEl.textContent=pfSigned(v.pnlEstimado,official.moneda_base)+(rp.ok&&rp.costo>0?' · '+pfSignedPct(v.pnlEstimado/rp.costo*100):'');
    pnlMainEl.style.color=pfColor(v.pnlEstimado);
  }
  if(pnlRefEl)pnlRefEl.textContent=(usaVivo&&v.pnlEstimado!==null)?'Con precios Yahoo · al cierre IBKR: '+(rp.ok?pfSigned(rp.pnl,official.moneda_base):'no disponible'):'Con precios del cierre IBKR';
  pintarPfHeroHoy();
  pintarPfCapital(official,v);
}

// Ganancia total, rentabilidades, aportes, costos y capital desembolsado.
// Usa el MISMO valor actual que el hero (obtenerValorActualPortafolio): con
// Yahoo, el valor en vivo; si no, el cierre IBKR. Los aportes se cuentan hasta
// la fecha de ese valor (con Yahoo no puede haber aportes posteriores al
// cierre IBKR: ese caso ya cae a IBKR por el gate de pfAportesSinReflejar).
function pintarPfCapital(official,v){
  pintarPfCambio(official,v);
  const el=id=>document.getElementById(id);
  const gEl=el('pfGanancia');if(!gEl)return;
  const moneda=official.moneda_base;
  const fecha=v.fuente==='YAHOO'?pfIso(new Date()):official.fecha_valoracion;
  const m=pfModeloCapital({...official,valor_total:v.valor,fecha_valoracion:fecha},pfFlujos(),pfCostosInversion());
  const set=(id,txt,color)=>{const x=el(id);if(!x)return;x.textContent=txt;x.style.color=color||'';};
  const soles=n=>n===null||n===undefined?'':fmtMoneda(n,'PEN');
  if(!m.ok){
    set('pfGanancia','—');set('pfGananciaPct','no disponible');
    set('pfRentInv','—');set('pfRentNeta','—');
    set('pfAportes',m.aportes!==null&&m.aportes!==undefined?pfFmt(m.aportes,moneda):'—');set('pfAportesSub','incompletos');
    set('pfCostos','—');set('pfCostosSub','');set('pfCapital','—');set('pfCapitalSub','');
    set('pfGananciaNota',m.mensaje);
    return;
  }
  const c=pfColor(m.ganancia);
  set('pfGanancia',pfSigned(m.ganancia,moneda),c);
  set('pfGananciaPct','Valor de cuenta vs. aportes netos');
  set('pfRentInv',pfSignedPct(m.pct),c);
  set('pfRentNeta',m.pctNeta===null?'—':pfSignedPct(m.pctNeta),pfColor(m.gananciaNeta));
  set('pfAportes',pfFmt(m.aportes,moneda));
  set('pfAportesSub',m.aportesSoles?soles(m.aportesSoles)+' enviados':'lo que llegó a IBKR');
  set('pfCostos',pfFmt(m.costosUSD,moneda));
  set('pfCostosSub',m.costosPendientes?m.costosPendientes+' sin tipo de cambio':m.nCostos?soles(m.costosSoles)+' · '+m.nCostos+' movimiento'+(m.nCostos>1?'s':''):'ninguno marcado');
  set('pfCapital',pfFmt(m.capital,moneda));
  set('pfCapitalSub',m.aportesSoles?soles(m.aportesSoles+m.costosSoles)+' de tu bolsillo':'aportes + costos');
  const notas=[];
  if(m.aviso)notas.push(m.aviso);
  if(m.costosPendientes)notas.push('Hay '+m.costosPendientes+' costo(s) en soles sin un aporte a IBKR con dólares confirmados para convertirlos: la rentabilidad neta queda pendiente.');
  if(m.multiplesFechas)notas.push('Con aportes en varias fechas, estas dos rentabilidades son ganancia ÷ capital (no ponderadas por tiempo). La rentabilidad ponderada por tiempo está en el gráfico, período "Todo".');
  set('pfGananciaNota',notas.join(' '));
  if(el('pfCostosEditor')&&!el('pfCostosEditor').hidden)renderPfCostosEditor();
}

let pfTcSolicitud=null;
function pintarPfCambio(official,v){
  if(!document.getElementById('pfResultadoCambio'))return;
  const tc=tcMercado>0?tcMercado:tcUsdPen;
  const fecha=v.fuente==='YAHOO'?pfIso(new Date()):official.fecha_valoracion;
  const modelo=pfModeloRentabilidadCambio({row:{...official,valor_total:v.valor,fecha_valoracion:fecha},
    tcActual:tc,transacciones:datos.transacciones,cuentas:cuentasApp(),pagosTarjetas:datos.pagosTarjetas,
    cuentasInversion:cuentasInversionHistoricas()});
  renderPfResultadoCambio(modelo,{tcActual:tc,tcFuente:tcMercado>0?'mercado':'configurado',
    tcFecha:tcMercado>0?tcMercadoFecha:'',valorFecha:v.fuente==='YAHOO'?pfIso(new Date(v.timestamp)):official.fecha_valoracion});
  // El resultado se pinta sin esperar la red. Si aún falta el TC, sólo esta
  // sección se actualiza cuando llega: no redibuja ni anima el gráfico.
  if(!(tc>0)&&!pfTcSolicitud){
    pfTcSolicitud=Promise.allSettled([cargarTcMercado(),leerTipoCambio()]).then(()=>{
      const actual=pfCierreAnterior();
      if(actual&&(tcMercado>0||tcUsdPen>0))pintarPfCambio(actual,obtenerValorActualPortafolio());
    }).finally(()=>{pfTcSolicitud=null;});
  }
}

// ── "Hoy" / 1D: una sola fuente de verdad ──────────────────────────────────
// IBKR aporta la ESTRUCTURA (cantidades, multiplicador, moneda, tipo de cambio
// del cierre, efectivo y el resto de partidas de la cuenta); Yahoo aporta los
// PRECIOS: el actual y el cierre regular de la sesión anterior (previous_close,
// ver cotizaciones-yahoo). Con V = valor_total del último cierre IBKR y
// vm_i = su valor de mercado por posición:
//   base   = V + Σ (cant_i × cierreAnterior_i × mult_i × fx_i − vm_i)
//   actual = V + Σ (cant_i × precio_i         × mult_i × fx_i − vm_i)
// V − Σ vm_i es el efectivo (más cualquier otra partida de la cuenta, p. ej.
// intereses devengados), así que esto es exactamente
// efectivo + Σ(cant × precio × mult × fx), sin perder esas partidas. La base
// ya NO depende de la fecha del último Flex: con IBKR retrasado dos días, el
// 1D sigue midiendo solo la última sesión.
// fuente:
//   'YAHOO'        base y precio de Yahoo, con contribuciones por activo.
//   'IBKR_BASE'    fallback excepcional: Yahoo da el precio actual pero no un
//                  cierre anterior válido para alguna posición (o sesiones
//                  distintas) → base = último cierre IBKR, con el motivo. Nunca
//                  se mezclan bases de Yahoo e IBKR entre posiciones.
//   'IBKR_CIERRES' sin valor Yahoo válido → cambio entre los dos últimos
//                  cierres oficiales, rotulado como tal.
// Hero "Hoy", gráfico 1D, tooltip, contribuciones y diagnóstico leen de acá;
// ninguno recalcula su propia base.
export function pfModeloDia(now=Date.now()){
  const official=pfCierreAnterior();
  const v=obtenerValorActualPortafolio();
  const r={ok:false,fuente:null,base:null,actual:null,cambio:null,pct:null,moneda:official?official.moneda_base:null,sesion:null,contribuciones:[],efectivo:null,motivo:'',v};
  if(!official){r.motivo='Todavía no hay un cierre oficial de IBKR.';return r;}
  const V=Number(official.valor_total);
  const fin=(base,actual)=>{r.base=base;r.actual=actual;r.cambio=actual-base;r.pct=(actual/base-1)*100;r.ok=base>0&&Number.isFinite(actual);return r;};
  if(v.fuente==='YAHOO'){
    const qByKey=new Map(pfYahoo.quotes.map(q=>[String(q.account)+'|'+String(q.contract_id),q]));
    let base=V,valorInicialPos=0;
    const sinCierre=[],sesiones=new Set(),contribuciones=[];
    for(const p of pfPosicionesCache){
      const q=qByKey.get(pfQuoteKey(p)),est=pfMarketEstimate(p,q,now);
      const prev=pfNumber(q&&q.previous_close);
      const dPrev=prev!==null&&prev>0?pfDeltaPosicion(p,prev):null,dAct=est?pfDeltaPosicion(p,est.price):null;
      if(dPrev===null||dAct===null){sinCierre.push(p.simbolo);continue;}
      sesiones.add(pfSesionQuote(q,now));
      base+=dPrev;
      const valorInicial=pfNumber(p.valor_mercado_base)+dPrev;   // cant × cierreAnterior × mult × fx
      valorInicialPos+=valorInicial;
      contribuciones.push({simbolo:p.simbolo,cambio:dAct-dPrev,pctActivo:(est.price/prev-1)*100,precio:est.price,cierreAnterior:prev,valorInicial});
    }
    if(!sinCierre.length&&sesiones.size===1){
      r.fuente='YAHOO';r.sesion=[...sesiones][0];
      // Contribución en puntos porcentuales = cambio en dinero ÷ base del
      // portafolio: suman EXACTAMENTE el rendimiento del día (el efectivo no
      // cambia de valor en la moneda base: aporta 0, pero sí pesa en la base).
      r.contribuciones=contribuciones.map(c=>({...c,peso:base>0?c.valorInicial/base*100:null,pp:base>0?c.cambio/base*100:null}));
      r.efectivo={valor:base-valorInicialPos,peso:base>0?(base-valorInicialPos)/base*100:null,pp:0};
      return fin(base,v.valor);
    }
    r.fuente='IBKR_BASE';
    r.motivo=sinCierre.length
      ?'Yahoo no informó un cierre anterior válido para '+sinCierre.join(', ')+': la base del día es el cierre IBKR del '+pfFechaCorta(official.fecha_valoracion)+'. Si IBKR está retrasado, el cambio puede abarcar más de una sesión.'
      :'Las cotizaciones de Yahoo corresponden a sesiones distintas ('+[...sesiones].sort().join(', ')+'): la base del día es el cierre IBKR del '+pfFechaCorta(official.fecha_valoracion)+'.';
    return fin(V,v.valor);
  }
  const filas=pfHistoricoCache.filter(x=>Number(x.valor_total)>0);
  r.fuente='IBKR_CIERRES';
  r.motivo=v.bloqueo||(v.cobertura.find(c=>!c.ok)||{}).motivo||'sin cotizaciones de Yahoo';
  if(filas.length<2)return r;
  r.sesion=filas[filas.length-1].fecha_valoracion;
  return fin(Number(filas[filas.length-2].valor_total),Number(filas[filas.length-1].valor_total));
}

// Rótulo del cambio del día: "Hoy" solo si la sesión medida es la de hoy.
// Con el mercado aún sin abrir (o en fin de semana) es la última sesión real,
// y sin Yahoo es el cambio entre cierres oficiales: se dice cuál es.
function pfEtiquetaDia(d){
  if(d.fuente==='IBKR_CIERRES')return 'Último cierre IBKR';
  return d.sesion&&d.sesion!==pfLondonDay()?'Última sesión':'Hoy';
}

function pfSubtituloDia(d){
  if(d.fuente==='YAHOO')return d.sesion&&d.sesion!==pfLondonDay()?'Sesión del '+pfFechaCorta(d.sesion)+' · desde el cierre anterior':'Desde el cierre anterior';
  if(d.fuente==='IBKR_BASE')return 'Desde el cierre IBKR del '+pfFechaCorta(pfCierreAnterior()?.fecha_valoracion)+' · base de respaldo';
  return 'Entre los dos últimos cierres oficiales ('+pfFechaCorta(d.sesion)+')';
}

// Lectura del caché para Inicio: las mismas bases que Portafolio, sin red.
// El cambio desde un cierre IBKR de respaldo puede abarcar varios días y no
// se presenta como diario. Entre cierres se aíslan aportes/retiros con TWR.
export function pfResumenRentabilidadInicio(now=Date.now()){
  const d=pfModeloDia(now),official=pfCierreAnterior();
  const r={diaria:null,total:null,fuente:d.fuente,fecha:null,etiqueta:'Sin cierre disponible',motivoDiaria:d.motivo,motivoTotal:''};
  if(!official)return r;
  const fl=pfFlujos(),v=d.v;
  r.fecha=d.sesion||(v.fuente==='YAHOO'?pfIso(new Date(v.timestamp)):official.fecha_valoracion);
  r.etiqueta=d.fuente==='IBKR_BASE'?'Último precio':pfEtiquetaDia(d);
  if(d.ok&&d.fuente==='YAHOO'&&Number.isFinite(d.pct))r.diaria=d.pct;
  else if(d.fuente==='IBKR_CIERRES'){
    const cierres=pfHistoricoCache.filter(row=>Number(row.valor_total)>0).slice(-2);
    const intervalo=pfRendimientoPortafolio(cierres,fl);
    if(intervalo.ok&&Number.isFinite(intervalo.pct))r.diaria=intervalo.pct;
    else r.motivoDiaria=intervalo.mensaje||'Faltan dólares confirmados para aislar los aportes de estos cierres.';
  }
  const fecha=v.fuente==='YAHOO'?pfIso(new Date(now)):official.fecha_valoracion;
  const capital=pfModeloCapital({...official,valor_total:v.valor,fecha_valoracion:fecha},fl,pfCostosInversion());
  if(capital.ok&&Number.isFinite(capital.pct))r.total=capital.pct;
  else r.motivoTotal=capital.mensaje||'Rentabilidad total no disponible.';
  return r;
}

function pintarPfHeroHoy(){
  const hoyEl=document.getElementById('pfHeroHoy'),subEl=document.getElementById('pfHeroHoySub');
  if(!hoyEl)return;
  const d=pfModeloDia();
  if(!d.ok){hoyEl.textContent='';if(subEl)subEl.textContent='';return;}
  hoyEl.textContent=pfEtiquetaDia(d)+' '+pfSigned(d.cambio,d.moneda)+' ('+pfSignedPct(d.pct)+')';
  hoyEl.style.color=pfColor(d.cambio);
  if(subEl)subEl.textContent=pfSubtituloDia(d);
}

// Toggle USD→PEN solo dentro de Portafolio (pedido del usuario): no persiste
// entre sesiones a propósito, es un cambio de vista momentáneo, no una
// preferencia. pfFmt reemplaza a fmtMoneda en las cifras de Portafolio —
// pfSigned (usado en P&L, ganancia, cambio de valor) ya pasa por acá, así
// que las 12 cifras que dependen de pfSigned respetan el toggle sin tocarlas
// una por una. Con el toggle apagado (por defecto) esto es idéntico a
// fmtMoneda: cero cambio de comportamiento salvo que el usuario lo active.
let pfMostrarPEN=false;

export function pfFmt(n,moneda){
  if(pfMostrarPEN&&moneda==='USD'){
    const tc=tcMercado>0?tcMercado:tcUsdPen;
    if(tc>0)return fmtMoneda(n===null||n===undefined?null:Number(n)*tc,'PEN');
  }
  return fmtMoneda(n,moneda);
}

export async function togglePfMoneda(btn){
  pfMostrarPEN=!pfMostrarPEN;
  if(pfMostrarPEN&&!(tcMercado>0)){await cargarTcMercado().catch(()=>{});if(!(tcMercado>0))await leerTipoCambio().catch(()=>{});}
  if(btn){btn.setAttribute('aria-pressed',String(pfMostrarPEN));btn.textContent=pfMostrarPEN?'Ver en dólares (US$)':'Ver equivalencia en soles (S/)';}
  const nota=document.getElementById('pfMonedaNota');if(nota)nota.hidden=!pfMostrarPEN;
  if(!pfHistoricoCache.length)return;
  renderPfResumen(pfHistoricoCache[pfHistoricoCache.length-1],pfUltimaSyncCache);
  pintarValorPrincipal();
  renderPfChart();
  renderPfPosiciones(pfPosicionesCache);
}
