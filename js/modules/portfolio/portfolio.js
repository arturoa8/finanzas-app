// Portafolio: carga, resumen y grafico.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {filtrarPorPeriodo} from '../analytics.js';
import {renderPfDistribucion} from './allocation.js';
import {renderPfBenchmark} from './benchmark.js';
import {renderPfDiagnostico} from './diagnostics.js';
import {obtenerValorActualPortafolio, pfCierreAnterior, pfFmt} from './hero.js';
import {construirGraficoIntradia, construirSerieSesiones, pfWireChartTooltip, renderPfChart1D, renderPfContribuciones} from './intraday.js';
import {pfFlujos, pfRendimientoEntrePuntos, pfRendimientoPortafolio, pfResumenPosiciones} from './performance.js';
import {pfSetActualizando, renderPfPosiciones} from './portfolio-ui.js';
import {pfAplicarSubvista, pfMostrarSubTabs} from './risk.js';
import {escalaGrafico} from '../settings.js';
import {agruparPintadoPf, limpiarCachePfYahoo, pfComputeBaseId, pfComputeScope, pfConsultarHistoriaYahoo, pfHistoriaYahooEnCache, pfLondonDay, pfValidarCacheYahoo, pfYahoo, precargarPfYahoo, startPfYahoo} from '../../services/market-data.js';
import {sessionUserId} from '../../services/auth.js';
import {sbFetch, sbFetchTodo} from '../../services/supabase.js';
import {toast} from '../../ui/toast.js';
import {diasEntre, fmtDateLong, fmtDateShort, hoyLocal, parseDateOnly} from '../../utils/dates.js';
import {esc, fmtMoneda} from '../../utils/formatters.js';
import {pfNumber} from '../../utils/numbers.js';

// ============ MI PORTAFOLIO (IBKR) ============
export let pfPeriodo='1D';

export let pfHistoricoCache=[];

export let pfPosicionesCache=[];

export let pfSnapshotsHoyCache=[];

export let pfLedgerCache=[];

let pfLoadSequence=0;

export let pfUltimaSyncCache=null;

// La entrada y la precarga comparten datos y consultas. El caché vive solo
// en memoria, pertenece a una cuenta de la app y se renueva tras un minuto.
const PF_DATOS_TTL_MS=60*1000;
let pfCacheUsuario='',pfDatosCarga=null,pfCacheSequence=0;
const PF_PRECARGA_COMPROBACION_MS=30*1000;
let pfPrecargaTimer=null;

export function detenerPrecargaPortafolio(){
  if(pfPrecargaTimer!==null)clearTimeout(pfPrecargaTimer);
  pfPrecargaTimer=null;
}

// Mantener los períodos listos también mientras se usa Inicio. Cada capa
// conserva su cadencia y comparte las consultas pendientes; esta revisión
// no vuelve a pedir la base IBKR ni trabaja con la app en segundo plano.
function pfPrepararGraficos(){
  if(document.hidden||!sessionUserId())return Promise.resolve([]);
  return Promise.allSettled([
    precargarPfYahoo(),
    ...[...PF_PERIODOS_INTRADIA].map(periodo=>pfCargarIntradiaPeriodo(periodo)),
  ]);
}

function pfProgramarPrecarga(){
  detenerPrecargaPortafolio();
  if(document.hidden||!sessionUserId()||!pfHistoricoCache.length||!pfPosicionesCache.length)return;
  const usuario=sessionUserId(),cacheSequence=pfCacheSequence;
  pfPrecargaTimer=setTimeout(()=>{
    pfPrecargaTimer=null;
    if(document.hidden||sessionUserId()!==usuario||pfCacheSequence!==cacheSequence)return;
    pfPrepararGraficos();
    pfProgramarPrecarga();
  },PF_PRECARGA_COMPROBACION_MS);
}

export function limpiarCachePortafolio(){
  detenerPrecargaPortafolio();
  pfLoadSequence++;
  pfCacheSequence++;
  pfCacheUsuario='';pfDatosCarga=null;
  pfHistoricoCache=[];pfPosicionesCache=[];pfLedgerCache=[];
  pfSnapshotsHoyCache=[];pfUltimaSyncCache=null;pfBenchCache=[];
  pfPosHistCache=null;pfPosHistFetchedAt=0;pfPosHistCarga=null;pfIntradiaCarga.clear();
  limpiarCachePfYahoo();
}

function pfPrepararUsuario(){
  const usuario=sessionUserId();
  if(usuario!==pfCacheUsuario){limpiarCachePortafolio();pfCacheUsuario=usuario;}
  return usuario;
}

function pfSolicitudVigente(solicitud){
  return pfDatosCarga===solicitud&&sessionUserId()===solicitud.usuario;
}

function pfCargarDatos({force=false}={}){
  const usuario=pfPrepararUsuario();
  if(!usuario)return null;
  if(pfDatosCarga&&(pfDatosCarga.pendiente||(!force&&Date.now()-pfDatosCarga.fetchedAt<PF_DATOS_TTL_MS)))return pfDatosCarga;
  const snapshotsAlEntrar=new Set(pfSnapshotsHoyCache);
  const solicitud={usuario,pendiente:true,fetchedAt:0};
  pfDatosCarga=solicitud;
  solicitud.auxiliares=Promise.all([
    sbFetch('configuracion_integraciones?select=cuenta_ibkr,token_expira_en&servicio=eq.ibkr_flex&limit=1').catch(()=>null),
    sbFetch('sincronizaciones_portafolio?select=*&order=iniciado_en.desc&limit=1').catch(()=>null),
    sbFetch('sincronizaciones_portafolio?select=estado,finalizado_en,iniciado_en&estado=in.(ok,ok_historico)&order=finalizado_en.desc.nullslast&limit=1').catch(()=>null),
    sbFetchTodo('posiciones_historial?select=fecha_valoracion,precio_mercado&simbolo=eq.'+encodeURIComponent(PF_BENCHMARK.simbolo)+'&order=fecha_valoracion.asc,id.asc').catch(()=>[]),
    sbFetch('reconciliaciones_portafolio?select=*&order=fecha.desc,creado_en.desc&limit=1').catch(()=>[]),
    sbFetchTodo('portafolio_snapshots?select=capturado_en,valor_calculado,fuente_precio&fecha=eq.'+pfIso(new Date())+'&order=capturado_en.asc,id.asc').catch(()=>[]),
  ]);
  solicitud.base=Promise.all([
    sbFetchTodo('portafolio_historial?select=*&order=fecha_valoracion.asc,id.asc'),
    sbFetch('posiciones?select=*&order=valor_mercado_base.desc.nullslast'),
    sbFetchTodo('operaciones_ibkr?select=id,cuenta_ibkr,fecha_hora&order=fecha_hora.desc,id.desc').catch(()=>[]),
  ]).then(([historial,posiciones,ledger])=>{
    if(!pfSolicitudVigente(solicitud))return null;
    const baseAnterior=pfComputeBaseId(),scopeAnterior=pfComputeScope();
    pfHistoricoCache=historial||[];pfPosicionesCache=posiciones||[];pfLedgerCache=ledger||[];
    if(baseAnterior!==pfComputeBaseId()||scopeAnterior!==pfComputeScope()){
      pfBenchCache=[];pfSnapshotsHoyCache=[];pfPosHistCache=null;pfPosHistFetchedAt=0;pfPosHistCarga=null;pfIntradiaCarga.clear();
    }
    pfValidarCacheYahoo();
    solicitud.pendiente=false;solicitud.fetchedAt=Date.now();
    // Una base nueva puede invalidar las tres curvas. Prepararlas aquí
    // evita depender de la pestaña o del período que el usuario seleccione.
    solicitud.graficos=pfPrepararGraficos();
    pfProgramarPrecarga();
    return {historial:pfHistoricoCache,posiciones:pfPosicionesCache,ledger:pfLedgerCache};
  }).catch(e=>{
    if(!pfSolicitudVigente(solicitud))return null;
    pfDatosCarga=null;throw e;
  });
  // Los datos auxiliares pueden tardar más sin retrasar la base ni Yahoo.
  solicitud.completa=Promise.all([solicitud.base,solicitud.auxiliares]).then(([base,extras])=>{
    if(!base||!pfSolicitudVigente(solicitud))return null;
    const [,,lastSuccess,bench,,snapshotsHoy]=extras;
    pfBenchCache=bench||[];
    const nuevosSnapshots=pfSnapshotsHoyCache.filter(s=>!snapshotsAlEntrar.has(s));
    const snapshots=new Map([...snapshotsHoy,...nuevosSnapshots].map(s=>[s.capturado_en,s]));
    pfSnapshotsHoyCache=[...snapshots.values()].sort((a,b)=>a.capturado_en.localeCompare(b.capturado_en));
    pfUltimaSyncCache=lastSuccess?.[0]||null;
    solicitud.extrasAplicados=true;
    return extras;
  }).catch(()=>null);
  return solicitud;
}

// Se invoca después de validar la sesión, durante la transición de acceso.
// Por defecto resuelve la base y continúa preparando las tres curvas.
// El arranque puede esperar también esas curvas, compartiendo los pedidos.
export function precargarPortafolio({esperarGraficos=false}={}){
  const solicitud=pfCargarDatos();
  if(!solicitud)return Promise.resolve(null);
  return solicitud.base.then(async base=>{
    if(!base||!pfSolicitudVigente(solicitud))return null;
    // También revalidar una base reutilizada: la última preparación pudo
    // fallar o sus curvas haber vencido mientras el usuario estaba en Inicio.
    const graficos=pfPrepararGraficos();
    pfProgramarPrecarga();
    if(esperarGraficos)await Promise.allSettled([graficos,solicitud.completa]);
    if(!pfSolicitudVigente(solicitud))return null;
    return base;
  });
}

// Yahoo y la lista de posiciones piden cada uno su dibujo del valor estimado
// y del gráfico. Agrupados, renderPfYahoo los dibuja una sola vez al final.
function pfPintarBase(ultimoHistorial){
  agruparPintadoPf(()=>{
    startPfYahoo();
    renderPfResumen(ultimoHistorial,pfUltimaSyncCache);
    document.getElementById('pfResumenCard').style.display='';
    document.getElementById('pfChartCard').style.display='';
    document.getElementById('pfDistCard').style.display='';
    renderPfDistribucion(ultimoHistorial);
    document.getElementById('pfPosicionesCard').style.display='';
    renderPfPosiciones(pfPosicionesCache);
    pfMostrarSubTabs(true);pfAplicarSubvista();
  });
}

// Carga sin layout shift (Parte A, sección 1-2): si ya había datos en caché
// de esta sesión, se quedan en pantalla tal cual — nada se oculta, nada
// mueve el layout — y solo gira el ícono de refresh mientras se refresca en
// segundo plano. El texto largo "Cargando portafolio…" y el spinner chico
// SOLO existen para la primera carga de la sesión, cuando todavía no hay
// nada que mostrar.
export async function renderPortafolio(opts={}){
  const solicitud=pfCargarDatos(opts);
  if(!solicitud)return;
  const sequence=++pfLoadSequence;
  const estadoEl=document.getElementById('pfEstado');
  const teniaCache=pfHistoricoCache.length>0;
  const actualizando=teniaCache&&solicitud.pendiente;
  if(teniaCache){
    estadoEl.innerHTML='';
    // La primera visita también puede pintar lo que se preparó en Inicio,
    // incluso si toca renovar la base por antigüedad.
    if(actualizando)pfPintarBase(pfHistoricoCache.at(-1));
    if(actualizando)pfSetActualizando(true);
  }else{
    ['pfResumenCard','pfChartCard','pfDistCard','pfPosicionesCard'].forEach(id=>document.getElementById(id).style.display='none');
    estadoEl.innerHTML='<div class="pf-spinner" role="status" aria-label="Cargando"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.8 1 6.4 2.6L21 8" fill="none" stroke="var(--dim)" stroke-width="2.5" stroke-linecap="round"/></svg></div>';
  }

  let ledger;
  try{
    const base=await solicitud.base;
    if(!base)return;
    ledger=base.ledger;
  }catch(e){
    if(sequence!==pfLoadSequence||sessionUserId()!==solicitud.usuario)return;
    if(teniaCache)toast('No se pudo actualizar el portafolio ahora. Se conservan los últimos datos.','error');
    else estadoEl.innerHTML=`<div class="empty">No se pudo conectar con el servidor para cargar tu portafolio.<br>${esc(e.message||'Error de red')}<br><span style="font-size:.68rem">Si tenías datos antes, no se han borrado — vuelve a intentarlo en un momento.</span></div>`;
    return;
  }finally{
    if(actualizando)pfSetActualizando(false);
  }

  if(sequence!==pfLoadSequence||!pfSolicitudVigente(solicitud))return;
  const ultimoHistorial=pfHistoricoCache.length?pfHistoricoCache[pfHistoricoCache.length-1]:null;

  // Coherencia de caché Yahoo/IBKR: invalidar ANTES del primer pintado del
  // día si el día de mercado, el snapshot IBKR base o el scope de posiciones
  // cambiaron desde el último fetch — nunca mezclar generaciones distintas.
  pfValidarCacheYahoo();
  // DIAGNÓSTICO TEMPORAL — ayuda a confirmar de un vistazo si hubo una
  // mezcla de generaciones IBKR/Yahoo al entrar a Portafolio. Quitar cuando
  // ya no haga falta rastrear este tipo de incidente.
  {
    const officialDiag=pfCierreAnterior();
    const diag=obtenerValorActualPortafolio();
    console.group('[Portafolio] Diagnóstico de coherencia de caché');
    console.log('Día frontend:',pfLondonDay());
    console.log('pfYahoo.day:',pfYahoo.day||'(vacío)');
    console.log('IBKR cierre (fecha_valoracion):',officialDiag?officialDiag.fecha_valoracion:'—');
    console.log('Posiciones fecha_datos:',pfPosicionesCache[0]?pfPosicionesCache[0].fecha_datos:'—');
    console.log('Yahoo fetchedAt:',pfYahoo.fetchedAt?new Date(pfYahoo.fetchedAt).toISOString():'—');
    console.log('scope actual:',pfComputeScope());
    console.log('scope Yahoo:',pfYahoo.scope);
    console.log('baseId actual:',pfComputeBaseId());
    console.log('baseId Yahoo:',pfYahoo.baseId);
    console.log('fuente elegida:',diag.fuente);
    console.groupEnd();
  }

  if(!ultimoHistorial){
    ['pfResumenCard','pfChartCard','pfDistCard','pfPosicionesCard'].forEach(id=>document.getElementById(id).style.display='none');
    const [config]=await solicitud.auxiliares;
    if(sequence!==pfLoadSequence||!pfSolicitudVigente(solicitud))return;
    estadoEl.innerHTML=config===null?'<div class="empty">Todavía no hay cierres de IBKR disponibles. Vuelve a actualizar en un momento.</div>':(config&&config[0])
      ? '<div class="empty">Todavía no hay ninguna sincronización exitosa con IBKR.<br>Se mostrará aquí en cuanto corra la primera.</div>'
      : '<div class="empty">La sincronización con IBKR aún no está configurada.</div>';
    return;
  }
  estadoEl.innerHTML='';

  // Lanzar Yahoo antes de pintar: mientras llega el primer precio, el 1D
  // muestra carga en lugar de la línea provisional entre dos cierres.
  // Si los datos auxiliares ya estaban (precarga o visita reciente), este
  // pintado los incluye y no hace falta repetir resumen y gráfico.
  const extrasPintados=solicitud.extrasAplicados===true;
  pfPintarBase(ultimoHistorial);

  const extras=await solicitud.completa;
  if(sequence!==pfLoadSequence||!pfSolicitudVigente(solicitud)||!extras)return;
  const [,sync,,,reconciliacion]=extras;
  const ultimaSync=sync?.[0];
  if(ultimaSync?.estado==='error'&&new Date(ultimaSync.iniciado_en)>new Date(ultimoHistorial.creado_en||0)){
    const dias=diasEntre(hoyLocal(),parseDateOnly(ultimoHistorial.fecha_valoracion));
    estadoEl.innerHTML=`<div class="empty" style="color:var(--yellow);text-align:left;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:12px">⚠️ La última sincronización falló (${esc(fmtDateLong(new Date(ultimaSync.iniciado_en)))}). Mostrando los últimos datos válidos, de hace ${dias} día${dias!==1?'s':''}.</div>`;
  }
  if(!extrasPintados){
    renderPfResumen(ultimoHistorial,pfUltimaSyncCache);
    renderPfChart();
  }
  renderPfDiagnostico(reconciliacion?.[0]||null,ledger||[]);
  pfAplicarSubvista();
}

export function renderPfResumen(row,ultimaSync){
  const moneda=row.moneda_base;
  // pfValorTotal/pfValorRef/pfFrescura los pinta pintarValorPrincipal() (fuente
  // única del "valor actual estimado" con prioridad Yahoo) — acá solo lo que
  // depende exclusivamente del cierre oficial de IBKR.
  document.getElementById('pfMonedaBase').textContent='Efectivo en IBKR '+pfFmt(row.efectivo,moneda)+' · moneda base '+(moneda||'—');
  // Rentabilidad de las posiciones: P&L ÷ costo de las posiciones abiertas. El
  // efectivo está en el valor total pero NO en este cálculo.
  const pnlEl=document.getElementById('pfPnl'),pnlSub=document.getElementById('pfPnlSub');
  const rp=pfResumenPosiciones(row,pfPosicionesCache);
  if(rp.ok&&pfPosicionesCache.length){
    pnlEl.textContent=pfSigned(rp.pnl,moneda)+(rp.pct===null?'':' · '+pfSignedPct(rp.pct));
    pnlEl.style.color=pfColor(rp.pnl);
    pnlSub.textContent='Solo posiciones abiertas · costo '+pfFmt(rp.costo,moneda);
  }else{
    const v=pfNumber(row.pnl_no_realizado);
    pnlEl.textContent=v!==null?pfSigned(v,moneda):'No disponible';pnlEl.style.color=pfColor(v);
    pnlSub.textContent=pfPosicionesCache.length?'Solo posiciones abiertas · porcentaje no disponible: posiciones no comparables con el cierre':'sin posiciones abiertas';
  }
  // Ganancia total, rentabilidades, aportes y costos: los pinta
  // pintarPfCapital() (llamada desde pintarValorPrincipal) con el valor actual.
  const fecha=parseDateOnly(row.fecha_valoracion);
  document.getElementById('pfFechaEfectiva').textContent='Datos al '+fmtDateLong(fecha);
  const ultOkTxt = ultimaSync && ultimaSync.estado!=='error'
    ? `Última sincronización exitosa: ${fmtDateLong(new Date(ultimaSync.finalizado_en||ultimaSync.iniciado_en))}`
    : 'Fecha de la última sincronización exitosa no disponible';
  document.getElementById('pfUltimaSync').textContent=ultOkTxt;
}

export function setPfPeriodo(p,btn){
  pfPeriodo=p;
  // Primera vez en "Desde…": propone el primer día con valor en la cuenta.
  if(p==='DESDE'&&!pfDesde){const f=pfHistoricoCache.find(r=>Number(r.valor_total)>0)||pfHistoricoCache[0];if(f)pfDesde=f.fecha_valoracion;}
  document.querySelectorAll('#pfPeriodoTabs .antb').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderPfChart();
}

// ── Rendimiento: cuánto tengo, cuánto he aportado y cuánto he ganado ────────
// Todo lo de aquí es cálculo puro sobre datos oficiales de IBKR y sobre tus
// transferencias registradas. Yahoo nunca entra en histórico, costos ni aportes.
//
// Aportes = transferencias desde/hacia cuentas de inversión, en dólares. IBKR
// Flex no trae depósitos ni retiros: lo que muevas directo en IBKR sin
// registrarlo aquí no se detecta. Una transferencia de soles sin los dólares
// recibidos confirmados NO se cuenta como importe (se avisa), pero sí cuenta
// como flujo en su fecha, para no vender como rentabilidad un cambio de valor
// causado por un depósito.
//
// Con aportes o retiros en el período, pfRendimientoPortafolio calcula TWR
// (rentabilidad ponderada por tiempo, ver pfRendimientoTWR) en vez de
// rendirse: encadena el rendimiento entre cierres consecutivos del histórico,
// aislando el efecto de cada flujo fechado (pfFlujos). Solo se bloquea si
// algún flujo del período no tiene dólares confirmados (pendientesFechas):
// ahí no hay forma de aislar su efecto y se prefiere el aviso al porcentaje.
export let pfVista='rendimiento',pfDesde='';

export function pfIso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

export function pfSigned(n,moneda){return n===null||n===undefined||!isFinite(n)?'—':(n>0.004?'+':n<-0.004?'−':'')+pfFmt(Math.abs(n),moneda);}

export function pfSignedPct(n){return n===null||n===undefined||!isFinite(n)?'—':(n>0.004?'+':n<-0.004?'−':'')+Math.abs(n).toFixed(2)+'%';}

export function pfColor(n){return n===null||n===undefined||!isFinite(n)||Math.abs(n)<0.005?'var(--dim)':n>0?'var(--green)':'var(--red)';}

export function pfFechaCorta(iso){const d=parseDateOnly(iso);return d?fmtDateShort(d):(iso||'—');}

function pfFechaLarga(iso){const d=parseDateOnly(iso);return d?fmtDateLong(d):(iso||'—');}

// ── Períodos: 1M/3M/6M/Año actual/Todo o "Desde…" ──────────────────────────
// Con "Desde…", si no hay un registro exacto en esa fecha se usa el primero
// disponible después de ella, y siempre se informa cuál fue.
export function pfResolverPeriodo(rows,periodo,desdeISO,campo='fecha_valoracion'){
  if(periodo!=='DESDE'){const filas=filtrarPorPeriodo(rows,periodo,campo);return{ok:true,filas,efectiva:filas.length?filas[0][campo]:null,seleccionada:null,ajustada:false};}
  if(!desdeISO)return{ok:false,filas:[],mensaje:'Elige una fecha de inicio.'};
  const i=rows.findIndex(r=>r[campo]>=desdeISO);
  if(i<0)return{ok:false,filas:[],seleccionada:desdeISO,mensaje:'No hay datos desde '+pfFechaCorta(desdeISO)+(rows.length?' · el último dato es de '+pfFechaCorta(rows[rows.length-1][campo]):'')};
  return{ok:true,filas:rows.slice(i),efectiva:rows[i][campo],seleccionada:desdeISO,ajustada:rows[i][campo]!==desdeISO};
}

export function pfTextoDesde(r,rows,campo='fecha_valoracion'){
  if(!r.ok)return r.mensaje||'';
  const primera=rows.length?rows[0][campo]:null;
  let t='Seleccionado: '+pfFechaCorta(r.seleccionada)+' · Dato utilizado: '+pfFechaCorta(r.efectiva);
  if(primera&&r.seleccionada<primera)t+=' · antes del inicio del histórico disponible ('+pfFechaCorta(primera)+')';
  return t;
}

// ── Comparación con el S&P 500 ──────────────────────────────────────────────
// Comparación numérica del mismo período: cierres oficiales de IBKR del
// portafolio y de un ETF del S&P 500 (CSPX) que está en tu cartera. El lado
// del portafolio reutiliza pfRendimientoPortafolio (simple o TWR si hubo
// flujos); si algún flujo del período no tiene dólares confirmados, tampoco
// aquí se puede aislar su efecto y no se muestra ninguna cifra aproximada.
export const PF_BENCHMARK={simbolo:'CSPX',etiqueta:'S&P 500'};

export let pfBenchCache=[];

// ── Vista del gráfico ───────────────────────────────────────────────────────
export function setPfVista(v){
  pfVista=v;
  const rend=document.getElementById('pfViewRend'),val=document.getElementById('pfViewValor'),titulo=document.getElementById('pfHeroTitulo');
  if(rend)rend.setAttribute('aria-pressed',String(v==='rendimiento'));
  if(val)val.setAttribute('aria-pressed',String(v==='valor'));
  if(titulo)titulo.textContent=v==='rendimiento'?'Rendimiento de Portafolio':'Valor de Portafolio';
  renderPfChart();
}

export function setPfDesde(iso){pfDesde=iso||'';renderPfChart();}

// Etiqueta del período para el número grande debajo del gráfico (sección 8):
// "Hoy" del hero NUNCA cambia con el período — eso lo pinta pintarPfHeroHoy().
const PF_PERIODO_LABEL={'1D':'Rendimiento del día','1S':'Rendimiento 1 semana','1M':'Rendimiento 1 mes','6M':'Rendimiento 6 meses',YTD:'Rendimiento AIF','1A':'Rendimiento 1 año',ALL:'Rendimiento total'};

function pfEtiquetaPeriodo(desde){return PF_PERIODO_LABEL[pfPeriodo]||('Rendimiento desde '+pfFechaCorta(desde));}

// Sección 14: los períodos más largos (1S/1M/6M/AIF/1A/Todo/Desde) también
// deben terminar HOY, no en el último cierre oficial — cuando Yahoo esté
// disponible se agrega un punto sintético de hoy con el valor en vivo
// (misma fuente que el hero: obtenerValorActualPortafolio). Si la fila de
// hoy ya existe en portafolio_historial (cron ya corrió), no se duplica —
// eso mantiene el histórico oficial intacto (sección 15).
// El punto en vivo lleva la fecha de la SESIÓN de su precio, no la de hoy:
// con el mercado cerrado (noche, fin de semana, feriado) Yahoo devuelve el
// precio de la última sesión, que ya tiene su cierre oficial — agregarlo
// como "hoy" solo estiraba una línea plana hasta el final del gráfico.
function pfFilasConVivo(filas){
  if(!filas.length)return filas;
  const v=obtenerValorActualPortafolio();
  if(v.fuente!=='YAHOO')return filas;
  const ultima=filas[filas.length-1],sesion=pfLondonDay(new Date(v.timestamp));
  if(!(sesion>ultima.fecha_valoracion))return filas;
  return [...filas,{...ultima,fecha_valoracion:sesion,valor_total:v.valor,creado_en:new Date().toISOString()}];
}

// Puntos diarios → formato de construirGraficoIntradia ({t,valor}),
// conservando la fecha para el scrubbing.
function pfSeriePorFecha(serie){
  return serie.map(p=>({fecha:p.fecha,t:+parseDateOnly(p.fecha),valor:Number(p.valor)})).sort((a,b)=>a.t-b.t);
}

export function pfEtiquetaFecha(t){return fmtDateShort(new Date(t));}

function pfEtiquetaFechaHora(t){const d=new Date(t);return fmtDateShort(d)+' '+d.toLocaleTimeString('es-PE',{hour:'numeric',minute:'2-digit'});}

// ── 1S / 1M con detalle intradía ────────────────────────────────────────────
// Se preparan en Inicio: las dos historias Yahoo comparten una consulta de
// cantidades por día. La selección del usuario no interviene en la precarga.
const PF_PERIODOS_INTRADIA=new Set(['1S','1M']);
const pfIntradiaCarga=new Map();
const PF_DETALLE_TTL_MS=5*60*1000,PF_DETALLE_REINTENTO_MS=30000;
let pfPosHistCache=null,pfPosHistFetchedAt=0,pfPosHistCarga=null;

function pfCargarPosicionesHistorial(){
  if(pfPosHistCache&&Date.now()-pfPosHistFetchedAt<PF_DETALLE_TTL_MS)return Promise.resolve(pfPosHistCache);
  if(pfPosHistCarga)return pfPosHistCarga;
  const cacheSequence=pfCacheSequence,usuario=sessionUserId(),baseId=pfComputeBaseId(),scope=pfComputeScope();
  const vigente=()=>pfCacheSequence===cacheSequence&&sessionUserId()===usuario&&baseId===pfComputeBaseId()&&scope===pfComputeScope();
  const desde=new Date();desde.setDate(desde.getDate()-45);
  const promesa=sbFetchTodo('posiciones_historial?select=fecha_valoracion,cuenta_ibkr,contract_id,simbolo,cantidad,multiplicador,moneda,moneda_base,fx_rate_a_base,valor_mercado_base,precio_mercado&fecha_valoracion=gte.'+pfIso(desde)+'&order=fecha_valoracion.asc,id.asc')
    .then(pos=>{if(!vigente())return null;pfPosHistCache=pos||[];pfPosHistFetchedAt=Date.now();return pfPosHistCache;})
    .finally(()=>{if(pfPosHistCarga===promesa)pfPosHistCarga=null;});
  pfPosHistCarga=promesa;
  return promesa;
}

function pfCargarIntradiaPeriodo(periodo){
  if(!PF_PERIODOS_INTRADIA.has(periodo)||!sessionUserId()||!pfHistoricoCache.length||!pfPosicionesCache.length)return Promise.resolve(null);
  const previa=pfIntradiaCarga.get(periodo);
  if(previa?.promesa)return previa.promesa;
  if(previa?.error&&Date.now()-previa.fetchedAt<PF_DETALLE_REINTENTO_MS)return Promise.resolve(null);
  if(pfHistoriaYahooEnCache(periodo)&&pfPosHistCache&&Date.now()-pfPosHistFetchedAt<PF_DETALLE_TTL_MS)return Promise.resolve(true);
  const cacheSequence=pfCacheSequence,usuario=sessionUserId(),baseId=pfComputeBaseId(),scope=pfComputeScope();
  const vigente=()=>pfCacheSequence===cacheSequence&&sessionUserId()===usuario&&baseId===pfComputeBaseId()&&scope===pfComputeScope();
  const carga={};
  carga.promesa=Promise.all([pfConsultarHistoriaYahoo(periodo),pfCargarPosicionesHistorial()])
    .then(([,pos])=>{
      if(!vigente()||pos===null)return null;
      pfIntradiaCarga.delete(periodo);
      if(pfPeriodo===periodo&&document.getElementById('p-ana')?.classList.contains('active'))renderPfChart();
      return true;
    }).catch(()=>{
      if(vigente()){
        pfIntradiaCarga.set(periodo,{error:true,fetchedAt:Date.now()});
        if(pfPeriodo===periodo&&document.getElementById('p-ana')?.classList.contains('active'))renderPfChart();
      }
      return null;
    });
  pfIntradiaCarga.set(periodo,carga);
  // Un reintento automático también comunica que está preparando detalle,
  // sin necesitar que el usuario vuelva a pulsar el período.
  if(pfPeriodo===periodo&&document.getElementById('p-ana')?.classList.contains('active'))queueMicrotask(()=>{
    if(vigente()&&pfIntradiaCarga.get(periodo)===carga&&pfPeriodo===periodo&&document.getElementById('p-ana')?.classList.contains('active'))renderPfChart();
  });
  return carga.promesa;
}

function pfIntradiaDelPeriodo(per){
  if(!PF_PERIODOS_INTRADIA.has(pfPeriodo)||!per.filas.length)return null;
  const periodo=pfPeriodo,h=pfHistoriaYahooEnCache(periodo,{aceptarVencido:true});
  // Conservar una historia coherente mientras se renueva; no volver a la
  // curva de cierres solo por haber vencido el plazo de actualización.
  pfCargarIntradiaPeriodo(periodo);
  if(h&&pfPosHistCache){
    const s=construirSerieSesiones(h.quotes,pfPosHistCache,pfHistoricoCache,per.filas[0].fecha_valoracion);
    return s.ok?s:null;
  }
  return null;
}

// Escala de los gráficos del portafolio (todos los períodos y las dos
// vistas). Solo decide qué parte del eje se ve; nunca toca la serie.
// Rango mínimo, para no convertir ruido en una montaña: 0.2 pp en el día y
// 0.5 pp en períodos largos (Rendimiento); 0.2% / 0.5% del valor (Valor).
export function pfOpcionesEscala(serie,{vista,intradia=false}){
  const escala=escalaGrafico();
  if(vista==='rendimiento')return{escala,rangoMinimo:intradia?0.2:0.5};
  const vals=serie.map(p=>Number(p.valor)).filter(Number.isFinite);
  const nivel=vals.length?vals.reduce((a,v)=>a+Math.abs(v),0)/vals.length:0;
  return{escala,rangoMinimo:nivel*(intradia?0.002:0.005)};
}

// Días en que la cuenta todavía no tenía dinero (valor 0 antes del primer
// aporte). IBKR los reporta, pero no son parte de la historia del
// portafolio: con ellos el eje iba de 0 al valor actual y la curva real
// quedaba aplastada arriba. Solo se quitan los del INICIO; un 0 posterior
// (p. ej. un retiro total) sí es un hecho y se mantiene.
function pfSinCerosIniciales(filas){
  const i=filas.findIndex(f=>Number(f.valor_total)>0);
  return i<=0?filas:filas.slice(i);
}

export function renderPfChart(){
  const toggle=document.getElementById('pfDesdeToggle');
  if(toggle)toggle.style.display=pfPeriodo==='DESDE'?'none':'';
  const area=document.getElementById('pfChartArea'),titulo=document.getElementById('pfChartTitulo'),hint=document.getElementById('pfChartHint'),res=document.getElementById('pfRendResumen');
  area.setAttribute('aria-busy','false');
  res.innerHTML='';renderPfBenchmark(null);renderPfContribuciones(null);

  if(pfPeriodo==='1D'){renderPfChart1D(area,titulo,hint,res);return;}

  const panel=document.getElementById('pfDesdePanel'),info=document.getElementById('pfDesdeInfo');
  const per=pfResolverPeriodo(pfHistoricoCache,pfPeriodo,pfDesde);
  if(panel){
    panel.hidden=pfPeriodo!=='DESDE';
    if(pfPeriodo==='DESDE'){
      const inp=document.getElementById('pfDesdeInput'),f=pfHistoricoCache;
      if(inp){if(f.length){inp.min=f[0].fecha_valoracion;inp.max=f[f.length-1].fecha_valoracion;}if(inp.value!==pfDesde)inp.value=pfDesde;}
      info.textContent=pfTextoDesde(per,pfHistoricoCache);
    }
  }
  if(!per.ok){titulo.textContent='';area.innerHTML='<div class="pf-data-note">'+esc(per.mensaje)+'</div>';hint.textContent=pfVista==='valor'?'El valor incluye aportes y retiros. No representa tu rentabilidad.':'';return;}
  // Con detalle intradía, el período arranca en el cierre anterior a la
  // primera sesión mostrada (como el 5D/1M de Yahoo): así el lunes también
  // cuenta, y el % del período coincide con el final de la curva.
  const intradia=pfIntradiaDelPeriodo(per);
  const iBase=intradia?pfHistoricoCache.findIndex(r=>r.fecha_valoracion===intradia.fechaBase):-1;
  const filas=pfFilasConVivo(iBase>=0?pfHistoricoCache.slice(iBase):per.filas);
  const conIntradia=intradia&&iBase>=0;
  if(!conIntradia&&PF_PERIODOS_INTRADIA.has(pfPeriodo)&&pfIntradiaCarga.get(pfPeriodo)?.promesa){
    area.setAttribute('aria-busy','true');titulo.textContent='';hint.textContent='';
    area.innerHTML='<div class="pf-chart-loading" role="status"><span class="pf-chart-loading-dot" aria-hidden="true"></span>Preparando gráfica…</div>';
    return;
  }
  if(pfVista==='rendimiento'){
    const r=pfRendimientoPortafolio(filas,pfFlujos());
    titulo.textContent=r.ok?(pfFechaCorta(r.desde)+' – '+pfFechaCorta(r.hasta)):'';
    if(!r.ok){area.innerHTML='<div class="pf-data-note">'+esc(r.mensaje)+'</div>';hint.textContent='';return;}
    const cifras='<div class="pf-rend-row"><div>Valor inicial<strong>'+esc(fmtMoneda(r.inicial,r.moneda))+'</strong></div><div>Valor actual<strong>'+esc(fmtMoneda(r.actual,r.moneda))+'</strong></div><div>Cambio de valor<strong style="color:'+pfColor(r.cambio)+'">'+esc(pfSigned(r.cambio,r.moneda))+'</strong></div></div>';
    if(r.conFlujos&&r.pct===undefined){
      area.innerHTML='<div class="pf-data-note">Hubo aportes o retiros durante este período ('+r.flujos+') sin dólares confirmados. El cambio de valor no representa rentabilidad.</div>';
      res.innerHTML=cifras;
      hint.textContent='Hay un aporte o retiro sin dólares confirmados en este período: sin ese dato no se puede aislar su efecto para calcular la rentabilidad. Confírmalo en la transferencia, o prueba un período sin ese movimiento.';
    }else{
      // Mismo gráfico que el 1D (tamaño, escala ajustada, colores por tramo
      // y scrubbing); solo cambia el eje X, que muestra fechas.
      const valorPorFecha=new Map(filas.map(f=>[f.fecha_valoracion,Number(f.valor_total)]));
      const fl=pfFlujos();
      let serie,opcX;
      if(conIntradia){
        // Rentabilidad encadenada (TWR): el factor acumulado hasta el cierre
        // anterior a cada sesión × el movimiento dentro de la sesión, medido
        // contra ese cierre. Un aporte del día entra en el cierre, nunca en
        // la curva intradía.
        const factor=new Map(r.serie.map(p=>[p.fecha,1+p.valor/100]));
        // El cierre de partida NO entra como punto: con los puntos
        // equiespaciados quedaba pegado a la primera vela y el hueco de la
        // noche (EE. UU. sigue operando tras el cierre de Londres) se veía
        // como un salto vertical al inicio. Igual que en el 1D, es la línea
        // punteada del 0%.
        serie=intradia.puntos.map(p=>({t:p.t,fecha:p.fecha,abs:p.valor,cierre:p.cierre,valor:p.cierre?(factor.has(p.fecha)?(factor.get(p.fecha)-1)*100:NaN):factor.has(p.fechaBase)?(factor.get(p.fechaBase)*p.valor/p.base-1)*100:NaN}))
          .filter(p=>Number.isFinite(p.valor));
        opcX={etiqueta:pfEtiquetaFechaHora,etiquetaEje:pfEtiquetaFecha};
      }else{
        serie=pfSeriePorFecha(r.serie).map(p=>({...p,abs:valorPorFecha.get(p.fecha)}));
        opcX={etiqueta:pfEtiquetaFecha};
      }
      const grafico=construirGraficoIntradia(serie,{...opcX,xPorIndice:true,aria:'Rendimiento del portafolio en el período',...pfOpcionesEscala(serie,{vista:'rendimiento'})});
      area.innerHTML=grafico.svg;
      // Cambio en dinero hasta el punto tocado SIN contar lo aportado o
      // retirado entre medio: un depósito no es ganancia. En un cierre, los
      // flujos hasta ese día; dentro de una sesión, solo los de días previos
      // (los del día aún no están en la curva intradía).
      const aportadoHasta=p=>fl.flujos.filter(f=>f.fecha>r.desde&&(conIntradia&&!p.cierre?f.fecha<p.fecha:f.fecha<=p.fecha)).reduce((s,f)=>s+f.monto,0);
      pfWireChartTooltip(area,grafico,{comparar:(a,b)=>({
        valorTexto:pfSignedPct(pfRendimientoEntrePuntos(a.valor,b.valor)),
        lineaTexto:a.abs==null||b.abs==null?'—':pfSigned(b.abs-a.abs-aportadoHasta(b)+aportadoHasta(a),r.moneda),
        subTexto:'Rendimiento del intervalo',pctNum:pfRendimientoEntrePuntos(a.valor,b.valor),
      }),describir:p=>{
        const v=p.abs;
        const aportado=aportadoHasta(p);
        return{valorTexto:v!=null?pfFmt(v,r.moneda):'—',gananciaTexto:v==null?'':pfSigned(v-r.inicial-aportado,r.moneda),pctTexto:pfSignedPct(p.valor),pctNum:p.valor,fechaTexto:p.cierre?pfFechaCorta(p.fecha)+' · cierre':null};
      }});
      res.innerHTML='<div class="pf-rend-big">'+esc(pfEtiquetaPeriodo(r.desde))+'<strong style="color:'+pfColor(r.pct)+'">'+esc(pfSignedPct(r.pct))+'</strong></div>'+cifras;
      hint.textContent=r.metodo==='twr'
        ?'Hubo '+r.flujos+' aporte(s) o retiro(s) en el período: rentabilidad ponderada por tiempo (TWR), que aísla su efecto encadenando los cierres oficiales de IBKR entre cada movimiento.'
        :'Sin aportes ni retiros en el período: valor final ÷ valor inicial − 1. Cierres oficiales de IBKR del '+pfFechaCorta(r.desde)+' al '+pfFechaCorta(r.hasta)+'.'
      if(conIntradia)hint.textContent+=' Curva con precios de Yahoo cada '+(pfPeriodo==='1S'?'5':'15')+' min sobre esos cierres; solo sesiones de mercado.';
    }
  }else{
    titulo.textContent='Valor total de la cuenta · incluye aportes y retiros';
    const conValor=pfSinCerosIniciales(filas);
    // Con intradía, el cierre de partida es la línea punteada, no un punto
    // (ver la vista Rendimiento).
    const serie=conIntradia
      ?intradia.puntos.map(p=>({t:p.t,fecha:p.fecha,valor:p.valor,cierre:p.cierre}))
      :pfSeriePorFecha(conValor.map(r=>({fecha:r.fecha_valoracion,valor:Number(r.valor_total)})));
    const inicial=conIntradia?intradia.base:serie[0]?.valor,moneda=filas.at(-1)?.moneda_base;
    const opcX=conIntradia?{etiqueta:pfEtiquetaFechaHora,etiquetaEje:pfEtiquetaFecha}:{etiqueta:pfEtiquetaFecha};
    const grafico=construirGraficoIntradia(serie,{referencia:inicial,...opcX,xPorIndice:true,aria:'Valor total de la cuenta en el período',vacio:'La cuenta aún no tenía valor en este período.',...pfOpcionesEscala(serie,{vista:'valor'})});
    area.innerHTML=grafico.svg;
    // Valor: fecha y valor, sin %: un cambio de valor aquí puede ser un
    // aporte, y mostrarlo como porcentaje lo haría pasar por rentabilidad.
    pfWireChartTooltip(area,grafico,{comparar:(a,b)=>({
      valorTexto:pfSigned(b.valor-a.valor,moneda),lineaTexto:'Cambio de valor entre puntos',
      subTexto:'Incluye aportes y retiros',pctNum:b.valor-a.valor,
    }),describir:p=>({valorTexto:pfFmt(p.valor,moneda),lineaTexto:'Valor de la cuenta · incluye aportes y retiros',pctNum:null,fechaTexto:p.cierre?pfFechaCorta(p.fecha)+' · cierre':null})});
    const recorte=conValor.length<filas.length&&conValor.length?' Se muestra desde el primer día con valor en la cuenta ('+pfFechaCorta(conValor[0].fecha_valoracion)+').':'';
    const truncado=grafico.meta&&grafico.meta.dominio[0]>0?' El eje vertical se ajusta al rango del período y no empieza en 0.':'';
    const detalle=conIntradia?' Precios de Yahoo cada '+(pfPeriodo==='1S'?'5':'15')+' min sobre los cierres oficiales de IBKR; solo sesiones de mercado.':'';
    hint.textContent='El valor incluye aportes y retiros. No representa tu rentabilidad.'+(conIntradia?'':recorte)+truncado+detalle;
  }
  if(!conIntradia&&PF_PERIODOS_INTRADIA.has(pfPeriodo))hint.textContent+=' Detalle intradía no disponible. Mostrando cierres diarios.';
  renderPfBenchmark(filas);
}
