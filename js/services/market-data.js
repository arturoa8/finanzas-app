// Yahoo Finance: solo estimacion de mercado actual.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderPfDiagnosticoYahoo} from '../modules/portfolio/diagnostics.js';
import {obtenerValorActualPortafolio, pfCierreAnterior, pfFmt, pintarValorPrincipal} from '../modules/portfolio/hero.js';
import {pfPintarPosicion} from '../modules/portfolio/portfolio-ui.js';
import {pfHistoricoCache, pfLedgerCache, pfPeriodo, pfPosicionesCache, pfSnapshotsHoyCache, renderPfChart} from '../modules/portfolio/portfolio.js';
import {authHeader, getSession, sessionUserId} from './auth.js';
import {SUPABASE_ANON_KEY, SUPABASE_URL} from './supabase-config.js';
import {sbFetch} from './supabase.js';
import {pfNumber} from '../utils/numbers.js';

// Capa Yahoo separada: nunca muta posiciones ni históricos IBKR.
// valorEnVivo/pnlEstimado/completo/momento: única fuente de verdad del
// "valor actual estimado" — los calcula renderPfYahoo() y los leen sin
// recalcular pintarValorPrincipal(), pintarPfHeroHoy() y construirSerieIntradia().
export const pfYahoo = {quotes:[],timer:null,controller:null,promise:null,requestId:0,lastAttempt:0,day:'',message:'',status:'idle',scope:'',usuario:null,valorEnVivo:null,pnlEstimado:null,completo:false,momento:null,baseId:null,fetchedAt:null};
let pfYahooCacheSequence=0;

// Refresco automático de Yahoo (IBKR/Flex NO entra en estos ciclos: es la
// estructura, y se actualiza solo por su cron o con el botón Actualizar).
//  · Sesión regular abierta + app activa → cada 2 min. El mantenimiento
//    de Portafolio también revisa esta cadencia mientras se usa Inicio.
//  · Mercado cerrado → sin refresco periódico de precios: una consulta al
//    abrir la próxima sesión conocida (session_start de Yahoo). Si todavía
//    no se conoce (tarde/fin de semana), una comprobación cada 30 min solo
//    para detectar la apertura; el servidor la responde desde su caché.
//  · App en segundo plano → se detiene; al volver se refresca en el acto
//    solo si los datos quedaron viejos (pfYahooDatosViejos).
const PF_YAHOO_ABIERTO_MS=2*60*1000;

const PF_YAHOO_CHEQUEO_CERRADO_MS=30*60*1000;

const PF_YAHOO_MIN_ENTRE_CONSULTAS_MS=20*1000;


export function pfLondonDay(date=new Date()) {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const part=t=>parts.find(p=>p.type===t).value;return part('year')+'-'+part('month')+'-'+part('day');}

function pfYahooVisible(){return !document.hidden&&!!document.getElementById('p-ana')?.classList.contains('active')&&getSession()!==null;}

export function pfQuoteKey(p){return String(p.cuenta_ibkr)+'|'+String(p.contract_id);}

export function pfComputeScope(){return pfPosicionesCache.map(p=>pfQuoteKey(p)+'|'+p.simbolo+'|'+p.moneda).sort().join(';');}

function pfSimpleHash(str){let h=0;for(let i=0;i<str.length;i++){h=(h*31+str.charCodeAt(i))|0;}return (h>>>0).toString(36);}

// Identificador del snapshot IBKR base (versionado de datos, sección 2 y 5
// del pedido de corrección): cuenta + fecha del cierre oficial + fecha de
// datos de las posiciones + hash de contract_id:cantidad. Cambia si IBKR
// trae un cierre nuevo O si cambian las cantidades, aunque los símbolos
// sigan siendo los mismos — el `scope` (solo símbolos) no detectaba esto.
export function pfComputeBaseId(){
  const official=pfCierreAnterior();
  if(!official)return null;
  const posDeCuenta=pfPosicionesCache.filter(p=>p.cuenta_ibkr===official.cuenta_ibkr);
  if(!posDeCuenta.length)return null;
  const fechaDatos=[...new Set(posDeCuenta.map(p=>p.fecha_datos))].sort().at(-1)||'';
  const detalle=posDeCuenta.map(p=>pfQuoteKey(p)+':'+p.cantidad).sort().join(';');
  return official.cuenta_ibkr+'|'+official.fecha_valoracion+'|'+fechaDatos+'|'+pfSimpleHash(detalle);
}

// Operaciones del ledger posteriores al snapshot de posiciones vigente
// (sección 8 del pedido): si existen, las cantidades en pfPosicionesCache
// pueden estar desactualizadas (compra/venta de hoy que IBKR aún no
// reflejó). No se reconstruyen cantidades desde el ledger acá — eso ya lo
// hace calcular_posiciones_desde_ledger()/reconciliar_portafolio() por
// separado — esto solo marca la valoración Yahoo como no confiable hasta
// que la próxima sync IBKR absorba esas operaciones.
export function pfOperacionesSinSincronizar(){
  const official=pfCierreAnterior();
  if(!official)return false;
  const posDeCuenta=pfPosicionesCache.filter(p=>p.cuenta_ibkr===official.cuenta_ibkr);
  if(!posDeCuenta.length)return false;
  const fechaDatos=[...new Set(posDeCuenta.map(p=>p.fecha_datos))].sort().at(-1);
  if(!fechaDatos)return false;
  return pfLedgerCache.some(op=>op.cuenta_ibkr===official.cuenta_ibkr&&new Date(op.fecha_hora).toISOString().slice(0,10)>fechaDatos);
}

// Cadena de prioridad de precio de mercado (sección 3): por ahora solo Yahoo
// y el cierre cacheado de IBKR están implementados — IBKR realtime/delayed
// necesitaría un proceso propio siempre encendido (IB Gateway/TWS o Client
// Portal Web API con OAuth), incompatible con este stack serverless, y queda
// fuera de esta etapa. Envuelve pfMarketEstimate en vez de reimplementarlo.
function resolverPrecioActual(p,q){
  const estimate=pfMarketEstimate(p,q);
  if(estimate)return{precio:estimate.price,fuente:'YAHOO',timestamp:new Date(estimate.time).toISOString()};
  const cerrado=pfNumber(p.precio_mercado);
  return cerrado===null?null:{precio:cerrado,fuente:'CACHED',timestamp:null};
}

export function pfMarketEstimate(p,q,now=Date.now()){
  if(!q||q.status!=='ok'||q.account!==p.cuenta_ibkr||String(q.contract_id)!==String(p.contract_id)||q.ibkr_symbol!==p.simbolo||q.currency!==p.moneda)return null;
  const price=pfNumber(q.price),qty=pfNumber(p.cantidad),mult=pfNumber(p.multiplicador),cost=pfNumber(p.costo_promedio);
  const time=Date.parse(q.price_at),age=(now-time)/60000;
  // CAUSA RAÍZ encontrada al diagnosticar por qué Yahoo nunca ganaba: fuera
  // de sesión (mercado cerrado, p.ej. LSE cerrado durante la tarde/noche en
  // Perú) el último cierre de Yahoo puede tener horas de "edad" sin dejar de
  // ser el precio VIGENTE — un mercado cerrado no tiene precio más nuevo que
  // ese. Rechazarlo por edad>60min hacía complete=false casi todo el día. El
  // límite de 60 min ahora solo aplica con el mercado ABIERTO (ahí sí
  // indicaría un fallo real de actualización); fuera de sesión se usa un
  // techo de cordura amplio (5 días) para no aceptar datos realmente rotos.
  const sesionAbierta=!!(q.session_start&&q.session_end&&now>=Date.parse(q.session_start)&&now<Date.parse(q.session_end));
  const vencido=sesionAbierta?age>60:age>7200;
  if(price===null||price<=0||qty===null||mult!==1||p.tipo_activo!=='STK'||!Number.isFinite(time)||age< -1||vencido||pfLondonDay(new Date(time))<p.fecha_datos)return null;
  const fx=p.moneda===p.moneda_base?1:pfNumber(p.fx_rate_a_base);
  const value=price*qty*mult,pnl=cost===null?null:(price-cost)*qty*mult;
  return {price,value,pnl,baseValue:fx!==null&&fx>0?value*fx:null,basePnl:fx!==null&&fx>0&&pnl!==null?pnl*fx:null,age,time,usesClosingFx:p.moneda!==p.moneda_base,sesionAbierta};
}

// Día (Londres) de la sesión que representa una cotización: el de su última
// vela intradía; sin velas, el de la sesión en curso si ya empezó (el activo
// todavía no operó hoy); si no, el de su último precio. Todas las posiciones
// deben compartirlo para que su cierre anterior sea el mismo día.
export function pfSesionQuote(q,now=Date.now()){
  const pts=q&&q.intraday&&Array.isArray(q.intraday.points)?q.intraday.points:[];
  if(pts.length)return pfLondonDay(new Date(Math.max(...pts.map(p=>p.t))));
  const inicio=Date.parse(q&&q.session_start);
  if(Number.isFinite(inicio)&&inicio<=now)return pfLondonDay(new Date(inicio));
  return pfLondonDay(new Date(Date.parse(q&&q.price_at)||now));
}

export function pfYahooSessionOpen(now=Date.now()){
  // No deducir festivos: usar la sesión concreta informada por Yahoo.
  return pfYahoo.quotes.some(q=>q.status==='ok'&&Date.parse(q.session_start)<=now&&now<Date.parse(q.session_end));
}

// Diagnóstico del intervalo intradía (sección 25 del pedido): cada posición
// puede haber caído a 5m por separado en el edge function (ver
// cotizaciones-yahoo), así que se resume: "2 min" si TODAS lo consiguieron,
// o se lista qué intervalos hay si alguna cayó a 5m — nunca se finge 2 min.
export function pfIntervaloIntradia(){
  const conDatos=pfYahoo.quotes.filter(q=>q.status==='ok'&&q.intraday);
  if(!conDatos.length)return{etiqueta:'—',fallback:false,motivo:null};
  const intervalos=[...new Set(conDatos.map(q=>q.intraday.interval))].sort();
  const fallback=intervalos.some(i=>i!=='2m');
  const motivo=conDatos.find(q=>q.intraday.fallback)?.intraday.fallback||null;
  const nombre=i=>i==='2m'?'2 min':i==='5m'?'5 min':i;
  return{etiqueta:intervalos.map(nombre).join(' / ')+(fallback?' · fallback':''),fallback,motivo};
}

export function stopPfYahoo({preservarConsulta=false}={}){
  if(pfYahoo.timer)clearTimeout(pfYahoo.timer);pfYahoo.timer=null;
  // Cambiar de sección detiene el refresco visible, pero la descarga del
  // día sigue preparando Portafolio. Ocultar la app o cerrar sesión sí la
  // aborta mediante el comportamiento predeterminado.
  if(preservarConsulta)return;
  if(pfYahoo.controller){pfYahoo.controller.abort();pfYahoo.controller=null;pfYahoo.promise=null;pfYahoo.lastAttempt=0;pfYahoo.status='idle';}
  pfYahoo.requestId++;
}

export function limpiarCachePfYahoo(){
  stopPfYahoo();
  pfYahooCacheSequence++;
  Object.assign(pfYahoo,{quotes:[],promise:null,lastAttempt:0,day:'',message:'',status:'idle',scope:'',usuario:null,valorEnVivo:null,pnlEstimado:null,completo:false,momento:null,baseId:null,fetchedAt:null});
  pfHistoriaYahoo.clear();pfUltimoSnapshotIntento=0;
}

function pfYahooProximaApertura(now=Date.now()){
  const s=pfYahoo.quotes.map(q=>Date.parse(q.session_start)).filter(t=>Number.isFinite(t)&&t>now);
  return s.length?Math.min(...s):null;
}

// ¿Hace falta consultar Yahoo YA? (al entrar a Portafolio o al volver a la app)
function pfYahooDatosViejos(now=Date.now()){
  if(!pfYahoo.fetchedAt||!pfYahoo.quotes.length||pfYahoo.status==='error')return true;
  if(pfYahoo.day!==pfLondonDay(new Date(now)))return true;
  const edad=now-pfYahoo.fetchedAt;
  if(pfYahooSessionOpen(now))return edad>=PF_YAHOO_ABIERTO_MS-5000;
  // Cerrado: solo si una sesión empezó desde el último dato (abrió mientras
  // la app estaba en segundo plano) o, sin apertura conocida, pasaron 30 min.
  if(pfYahoo.quotes.some(q=>{const s=Date.parse(q.session_start);return s>pfYahoo.fetchedAt&&s<=now;}))return true;
  return pfYahooProximaApertura(now)===null&&edad>=PF_YAHOO_CHEQUEO_CERRADO_MS;
}

// Cuánto esperar hasta la próxima consulta automática.
function pfYahooEsperaMs(now=Date.now()){
  if(pfYahoo.status==='error'||!pfYahoo.fetchedAt)return PF_YAHOO_ABIERTO_MS;
  if(pfYahooSessionOpen(now))return Math.max(5000,pfYahoo.fetchedAt+PF_YAHOO_ABIERTO_MS-now);
  const apertura=pfYahooProximaApertura(now);
  if(apertura!==null)return apertura-now+30*1000;
  return Math.max(5000,pfYahoo.fetchedAt+PF_YAHOO_CHEQUEO_CERRADO_MS-now);
}

function pfProgramarYahoo(){
  if(pfYahoo.timer)clearTimeout(pfYahoo.timer);pfYahoo.timer=null;
  if(!pfYahooVisible())return;
  pfYahoo.timer=setTimeout(()=>{pfYahoo.timer=null;if(pfYahooVisible())refreshPfYahoo();else stopPfYahoo();},Math.min(pfYahooEsperaMs(),2147483647));
}

// Coherencia de caché Yahoo (corrección de fondo): una estimación Yahoo solo
// es válida si sus quotes son del mismo día de mercado, del mismo scope de
// posiciones y del mismo snapshot IBKR base que lo que se está por pintar.
// Si algo cambió desde el último fetch, se descarta el caché ANTES de
// pintar. Se llama desde renderPortafolio() antes del primer pintado del
// día, y desde startPfYahoo() para el caso de pestaña reactivada.
export function pfValidarCacheYahoo(){
  const usuario=sessionUserId();
  if(pfYahoo.usuario!==usuario)limpiarCachePfYahoo();
  const scopeActual=pfComputeScope(),baseIdActual=pfComputeBaseId(),diaEsperado=pfLondonDay();
  const coherente=pfYahoo.quotes.length>0&&baseIdActual!==null
    &&pfYahoo.day===diaEsperado&&pfYahoo.scope===scopeActual&&pfYahoo.baseId===baseIdActual;
  const cambioBase=pfYahoo.scope!==scopeActual||pfYahoo.baseId!==baseIdActual||(pfYahoo.day&&pfYahoo.day!==diaEsperado);
  if(!coherente&&(pfYahoo.quotes.length||(pfYahoo.controller&&cambioBase))){
    stopPfYahoo();
    pfYahoo.quotes=[];pfYahoo.lastAttempt=0;pfYahoo.status='idle';pfYahoo.message='';
  }
  pfYahoo.scope=scopeActual;pfYahoo.baseId=baseIdActual;pfYahoo.usuario=usuario;
  return coherente;
}

export function startPfYahoo(){
  if(!pfYahooVisible())return;
  pfValidarCacheYahoo();
  renderPfYahoo();
  if(pfYahooDatosViejos())refreshPfYahoo();else pfProgramarYahoo();
}

// Consulta anticipada que el mantenimiento reutiliza desde Inicio. No
// pinta la página oculta ni instala el timer de la vista Portafolio.
export function precargarPfYahoo(){
  if(document.hidden||!sessionUserId())return Promise.resolve();
  pfValidarCacheYahoo();
  return pfYahooDatosViejos()?refreshPfYahoo({background:true}):Promise.resolve();
}

// force:true lo usa solo el botón Actualizar (pfRefrescarTodo): salta el
// anti-ráfaga. Si ya hay una consulta en curso, se devuelve ESA misma promesa
// (nunca dos pedidos simultáneos). Al terminar, reprograma la siguiente.
export function refreshPfYahoo(opts={}){
  const force=!!opts.force,background=!!opts.background;
  if(background?!sessionUserId():!pfYahooVisible())return Promise.resolve();
  if(pfYahoo.promise)return pfYahoo.promise;
  if(!force&&pfYahoo.lastAttempt&&Date.now()-pfYahoo.lastAttempt<PF_YAHOO_MIN_ENTRE_CONSULTAS_MS){pfProgramarYahoo();return Promise.resolve();}
  if(!pfPosicionesCache.length){pfYahoo.quotes=[];pfYahoo.status='empty';if(pfYahooVisible())renderPfYahoo();return Promise.resolve();}
  const prom=pfConsultarYahoo();
  pfYahoo.promise=prom;
  prom.finally(()=>{if(pfYahoo.promise===prom)pfYahoo.promise=null;});
  return prom;
}

async function pfConsultarYahoo(){
  const controller=new AbortController(),id=++pfYahoo.requestId;
  const usuario=sessionUserId(),scope=pfComputeScope(),baseId=pfComputeBaseId();
  const vigente=()=>id===pfYahoo.requestId&&usuario===sessionUserId()&&scope===pfComputeScope()&&baseId===pfComputeBaseId();
  pfYahoo.controller=controller;pfYahoo.lastAttempt=Date.now();pfYahoo.status='loading';pfYahoo.message='Consultando precios de mercado…';if(pfYahooVisible())renderPfYahoo();
  const timeout=setTimeout(()=>controller.abort(),35000);
  try{
    const authorization=await authHeader();if(controller.signal.aborted||!vigente())return;
    const r=await fetch(SUPABASE_URL+'/functions/v1/cotizaciones-yahoo',{method:'GET',headers:{apikey:SUPABASE_ANON_KEY,Authorization:authorization},signal:controller.signal});
    if(!r.ok)throw new Error(r.status===404?'La consulta Yahoo está preparada, pero falta desplegarla en Supabase.':r.status===401?'Inicia sesión nuevamente para consultar Yahoo.':'Yahoo no está disponible en este momento.');
    const data=await r.json();if(!Array.isArray(data.quotes))throw new Error('Respuesta de cotizaciones inválida.');
    if(!vigente())return;
    // Solo asociar contratos existentes; ignorar cualquier símbolo extra del servidor.
    const known=new Map(pfPosicionesCache.map(p=>[pfQuoteKey(p),p]));
    const quotes=data.quotes.filter(q=>{const p=known.get(String(q.account)+'|'+String(q.contract_id));return p&&q.ibkr_symbol===p.simbolo;});
    // Un HTTP 200 con todos los activos unavailable también necesita un
    // reintento. Conservar las últimas cotizaciones coherentes hasta lograrlo.
    if(!quotes.some(q=>q.status==='ok'&&pfNumber(q.price)>0))throw new Error('No hay cotizaciones de mercado disponibles por ahora.');
    pfYahoo.quotes=quotes;
    pfYahoo.day=pfLondonDay();pfYahoo.status='ok';pfYahoo.message='';pfYahoo.fetchedAt=Date.now();
  }catch(e){if(vigente()){pfYahoo.status='error';pfYahoo.message=controller.signal.aborted?'La consulta tardó demasiado. Se conserva el cierre IBKR.':e.message;}}
  finally{clearTimeout(timeout);if(id===pfYahoo.requestId){pfYahoo.controller=null;if(vigente()&&pfYahooVisible())renderPfYahoo();pfProgramarYahoo();
    // Inicio (Patrimonio) usa el mismo valor actual: avisarle de precios nuevos.
    if(vigente())globalThis.dispatchEvent?.(new Event('finanzas:portafolio'));}}
}

// ── Historia intradía de varios días (1S / 1M) ─────────────────────────────
// Velas reales de Yahoo de las últimas sesiones, preparadas desde Inicio.
// Caché de 5 min por período y por conjunto de posiciones; nunca pisa
// pfYahoo (el 1D y el valor en vivo siguen su propio ciclo).
const pfHistoriaYahoo=new Map();
const PF_HISTORIA_TTL_MS=5*60*1000;

export function pfHistoriaYahooEnCache(periodo,{aceptarVencido=false}={}){
  const c=pfHistoriaYahoo.get(periodo);
  return c?.quotes&&c.usuario===sessionUserId()&&c.scope===pfComputeScope()&&c.baseId===pfComputeBaseId()&&(aceptarVencido||Date.now()-c.fetchedAt<PF_HISTORIA_TTL_MS)?c:null;
}

export async function pfConsultarHistoriaYahoo(periodo){
  const enCache=pfHistoriaYahooEnCache(periodo);if(enCache)return enCache;
  const usuario=sessionUserId(),scope=pfComputeScope(),baseId=pfComputeBaseId(),cacheSequence=pfYahooCacheSequence;
  const previa=pfHistoriaYahoo.get(periodo);if(previa?.promesa&&previa.usuario===usuario&&previa.scope===scope&&previa.baseId===baseId)return previa.promesa;
  const anteriorCoherente=previa?.quotes&&previa.usuario===usuario&&previa.scope===scope&&previa.baseId===baseId;
  const vigente=()=>usuario===sessionUserId()&&scope===pfComputeScope()&&baseId===pfComputeBaseId()&&cacheSequence===pfYahooCacheSequence;
  const promesa=(async()=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);
    try{
      const authorization=await authHeader();
      const r=await fetch(SUPABASE_URL+'/functions/v1/cotizaciones-yahoo?historia='+encodeURIComponent(periodo),{method:'GET',headers:{apikey:SUPABASE_ANON_KEY,Authorization:authorization},signal:controller.signal});
      if(!r.ok)throw new Error('Historia intradía no disponible');
      const data=await r.json();if(!Array.isArray(data.quotes))throw new Error('Respuesta de historia inválida');
      if(!vigente())throw new Error('La sesión o el portafolio cambió durante la consulta.');
      // Solo contratos que existen en la cartera (igual que pfConsultarYahoo).
      const known=new Map(pfPosicionesCache.map(p=>[pfQuoteKey(p),p]));
      const quotes=data.quotes.filter(q=>{const p=known.get(String(q.account)+'|'+String(q.contract_id));return p&&q.ibkr_symbol===p.simbolo&&q.status==='ok'&&Array.isArray(q.points)&&q.points.length>0;});
      if(!quotes.length)throw new Error('Historia intradía no disponible');
      const valor={periodo,quotes,usuario,scope,baseId,fetchedAt:Date.now()};
      pfHistoriaYahoo.set(periodo,valor);
      return valor;
    }catch(e){if(pfHistoriaYahoo.get(periodo)?.promesa===promesa){if(anteriorCoherente&&vigente())pfHistoriaYahoo.set(periodo,previa);else pfHistoriaYahoo.delete(periodo);}throw e;}
    finally{clearTimeout(timeout);}
  })();
  pfHistoriaYahoo.set(periodo,{...(anteriorCoherente&&vigente()?previa:{}),usuario,scope,baseId,promesa});
  return promesa;
}

// Al entrar a Portafolio, Yahoo, la lista de posiciones y el pintado base
// pedían cada uno el valor estimado y el gráfico: hasta cuatro dibujos
// seguidos antes de mostrar la pestaña. Dentro de un grupo se dibuja una
// sola vez, al final.
let pfPintadoAgrupado=0;
export function agruparPintadoPf(pintar){
  pfPintadoAgrupado++;
  try{pintar();}
  finally{pfPintadoAgrupado--;}
  if(!pfPintadoAgrupado)renderPfYahoo();
}

export function renderPfYahoo(){
  if(pfPintadoAgrupado||!pfHistoricoCache.length)return;
  const qByKey=new Map(pfYahoo.quotes.map(q=>[String(q.account)+'|'+String(q.contract_id),q]));
  // Todo el cálculo vive en obtenerValorActualPortafolio() — acá solo se
  // guarda lo que hace falta para el diagnóstico y se dispara el pintado.
  const v=obtenerValorActualPortafolio();
  pfYahoo.cobertura=v.cobertura;
  pfYahoo.statusMsg=pfYahoo.message||(pfYahooSessionOpen()?'Mercado abierto · Yahoo se actualiza cada 2 min':'Mercado cerrado · sin actualización periódica hasta que abra');

  pintarValorPrincipal();
  if(v.fuente==='YAHOO')guardarSnapshotCalculado(v.valor,v.pnlEstimado);
  renderPfChart();
  renderPfDiagnosticoYahoo();

  document.querySelectorAll('#pfPosicionesLista .pf-position').forEach(button=>{
    const p=pfPosicionesCache.find(p=>pfQuoteKey(p)===button.dataset.positionKey);if(!p)return;
    let block=button.querySelector('.pf-market-position');if(!block){block=document.createElement('span');block.className='pf-market-position';button.append(block);}
    const q=qByKey.get(pfQuoteKey(p)),estimate=pfMarketEstimate(p,q);
    pfPintarPosicion(button,p,estimate);
    block.replaceChildren();const label=document.createElement('span');label.className='pf-market-label';label.textContent='YAHOO · PRECIO CON RETRASO';block.append(label);
    if(!q||q.status!=='ok'){const note=document.createElement('span');note.textContent=q?.status==='unmapped'?'Equivalencia Yahoo pendiente de verificar.':pfYahoo.status==='loading'?'Consultando…':'Sin cotización disponible. Cierre IBKR conservado.';block.append(note);return;}
    const t=Date.parse(q.price_at),price=pfNumber(q.price);
    if(!Number.isFinite(t)||price===null){const note=document.createElement('span');note.textContent='Cotización inválida; cierre IBKR conservado.';block.append(note);return;}
    const quoteLine=document.createElement('strong');quoteLine.textContent=pfFmt(price,q.currency);block.append(quoteLine);
    const stamp=document.createElement('span');stamp.textContent=(pfYahooSessionOpen()?'Dato del ':'Último precio regular · ')+new Date(t).toLocaleString('es-PE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})+(pfYahooSessionOpen()?' · hace '+Math.max(0,Math.floor((Date.now()-t)/60000))+' min':'');block.append(stamp);
    const totals=document.createElement('span');totals.textContent=estimate?'Valor estimado '+pfFmt(estimate.value,p.moneda)+' · P&L estimado '+pfFmt(estimate.pnl,p.moneda):'Dato antiguo o no comparable: no se usa en la estimación.';block.append(totals);
  });
}

// Snapshot calculado (sección 9): guarda el valor estimado con Yahoo cuando
// es completo y comparable. Throttle propio de 10 min (más corto que el
// throttle de 15 min del servidor, así que en el caso normal es el servidor
// el que decide "omitido" — este solo evita golpear la RPC en cada repintado
// de 60s de startPfYahoo cuando Yahoo no ha cambiado). Nunca toca
// portafolio_historial ni el histórico oficial de IBKR.
let pfUltimoSnapshotIntento=0;

async function guardarSnapshotCalculado(valorCalculado,pnlEstimado){
  if(Date.now()-pfUltimoSnapshotIntento<10*60*1000)return;
  const official=pfCierreAnterior();
  if(!official)return;
  const usuario=sessionUserId(),baseId=pfComputeBaseId(),cacheSequence=pfYahooCacheSequence;
  pfUltimoSnapshotIntento=Date.now();
  try{
    const r=await sbFetch('rpc/guardar_snapshot_portafolio',{method:'POST',body:JSON.stringify({
      p_cuenta_ibkr:official.cuenta_ibkr,
      p_valor_calculado:valorCalculado,
      p_efectivo:pfNumber(official.efectivo),
      p_valor_invertido:valorCalculado-(pfNumber(official.efectivo)||0),
      p_pnl:pnlEstimado,
      p_fuente_precio:'YAHOO',
    })});
    const resultado=Array.isArray(r)?r[0]:r;
    if(resultado&&resultado.estado==='ok'&&usuario===sessionUserId()&&baseId===pfComputeBaseId()&&cacheSequence===pfYahooCacheSequence){
      // Alimenta el 1D en vivo sin volver a pedirlo a Supabase. Esto es
      // SOLO la curva intradía calculada (sección 15): nunca se toca
      // portafolio_historial, que sigue siendo 100% el cierre oficial IBKR.
      pfSnapshotsHoyCache.push({capturado_en:new Date().toISOString(),valor_calculado:valorCalculado,fuente_precio:'YAHOO'});
      if(pfPeriodo==='1D')renderPfChart();
    }
  }catch(e){/* silencioso: es una curva auxiliar, nunca debe interrumpir la UI */}
}
