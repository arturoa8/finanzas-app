// Portafolio: carga, resumen y grafico.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {filtrarPorPeriodo} from '../analytics.js';
import {renderPfDistribucion} from './allocation.js';
import {renderPfBenchmark} from './benchmark.js';
import {renderPfDiagnostico, renderPfDiagnosticoYahoo} from './diagnostics.js';
import {obtenerValorActualPortafolio, pfCierreAnterior, pfFmt, pfMonedaVisible, pintarValorPrincipal} from './hero.js';
import {construirGraficoIntradia, pfWireChartTooltip, renderPfChart1D, renderPfContribuciones} from './intraday.js';
import {pfFlujos, pfRendimientoPortafolio, pfResumenPosiciones} from './performance.js';
import {pfSetActualizando, renderPfPosiciones} from './portfolio-ui.js';
import {pfAplicarSubvista, pfMostrarSubTabs} from './risk.js';
import {escalaGrafico} from '../settings.js';
import {pfComputeBaseId, pfComputeScope, pfLondonDay, pfValidarCacheYahoo, pfYahoo, startPfYahoo} from '../../services/market-data.js';
import {sbFetch} from '../../services/supabase.js';
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

// Carga sin layout shift (Parte A, sección 1-2): si ya había datos en caché
// de esta sesión, se quedan en pantalla tal cual — nada se oculta, nada
// mueve el layout — y solo gira el ícono de refresh mientras se refresca en
// segundo plano. El texto largo "Cargando portafolio…" y el spinner chico
// SOLO existen para la primera carga de la sesión, cuando todavía no hay
// nada que mostrar.
export async function renderPortafolio(){
  const sequence=++pfLoadSequence;
  const estadoEl=document.getElementById('pfEstado');
  const teniaCache=pfHistoricoCache.length>0;
  if(teniaCache){
    estadoEl.innerHTML='';
    pfSetActualizando(true);
  }else{
    ['pfResumenCard','pfChartCard','pfDistCard','pfPosicionesCard'].forEach(id=>document.getElementById(id).style.display='none');
    estadoEl.innerHTML='<div class="pf-spinner" role="status" aria-label="Cargando"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.8 1 6.4 2.6L21 8" fill="none" stroke="var(--dim)" stroke-width="2.5" stroke-linecap="round"/></svg></div>';
  }

  let config,sync,historial,posiciones,lastSuccess,bench,reconciliacion,ledger,snapshotsHoy;
  try{
    [config,sync,historial,posiciones,lastSuccess,bench,reconciliacion,ledger,snapshotsHoy]=await Promise.all([
      sbFetch('configuracion_integraciones?select=cuenta_ibkr,token_expira_en&servicio=eq.ibkr_flex&limit=1'),
      sbFetch('sincronizaciones_portafolio?select=*&order=iniciado_en.desc&limit=1'),
      sbFetch('portafolio_historial?select=*&order=fecha_valoracion.asc'),
      sbFetch('posiciones?select=*&order=valor_mercado_base.desc.nullslast'),
      sbFetch('sincronizaciones_portafolio?select=estado,finalizado_en,iniciado_en&estado=in.(ok,ok_historico)&order=finalizado_en.desc.nullslast&limit=1'),
      // Referencia para "vs S&P 500": cierres oficiales de IBKR de un ETF del S&P 500
      // que ya está en la cartera. Si falla, solo se pierde la comparación.
      sbFetch('posiciones_historial?select=fecha_valoracion,precio_mercado&simbolo=eq.'+encodeURIComponent(PF_BENCHMARK.simbolo)+'&order=fecha_valoracion.asc').catch(()=>[]),
      // Diagnóstico (sección 11): última reconciliación calculado-vs-IBKR y
      // tamaño del ledger. Si falla, el diagnóstico simplemente no se muestra.
      sbFetch('reconciliaciones_portafolio?select=*&order=fecha.desc,creado_en.desc&limit=1').catch(()=>[]),
      sbFetch('operaciones_ibkr?select=id,fecha_hora&order=fecha_hora.desc').catch(()=>[]),
      // 1D: snapshots calculados de hoy (ver construirSerieIntradia). Si falla,
      // el 1D cae al mensaje de "sin cotizaciones todavía", no rompe el resto.
      sbFetch('portafolio_snapshots?select=capturado_en,valor_calculado,fuente_precio&fecha=eq.'+pfIso(new Date())+'&order=capturado_en.asc').catch(()=>[]),
    ]);
  }catch(e){
    if(sequence!==pfLoadSequence)return;
    pfSetActualizando(false);
    if(teniaCache)toast('No se pudo actualizar el portafolio ahora. Se conservan los últimos datos.','error');
    else estadoEl.innerHTML=`<div class="empty">No se pudo conectar con el servidor para cargar tu portafolio.<br>${esc(e.message||'Error de red')}<br><span style="font-size:.68rem">Si tenías datos antes, no se han borrado — vuelve a intentarlo en un momento.</span></div>`;
    return;
  }

  if(sequence!==pfLoadSequence)return;
  pfSetActualizando(false);
  pfHistoricoCache=historial||[];
  pfPosicionesCache=posiciones||[];
  pfBenchCache=bench||[];
  pfSnapshotsHoyCache=snapshotsHoy||[];
  pfLedgerCache=ledger||[];
  const ultimoHistorial=pfHistoricoCache.length?pfHistoricoCache[pfHistoricoCache.length-1]:null;
  const ultimaSync=(sync&&sync[0])||null;
  pfUltimaSyncCache=(lastSuccess&&lastSuccess[0])||null;

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
    estadoEl.innerHTML=(config&&config[0])
      ? '<div class="empty">Todavía no hay ninguna sincronización exitosa con IBKR.<br>Se mostrará aquí en cuanto corra la primera.</div>'
      : '<div class="empty">La sincronización con IBKR aún no está configurada.</div>';
    return;
  }
  estadoEl.innerHTML='';

  // Aviso de datos desactualizados: la última fila de sincronizaciones_portafolio
  // es más nueva que el último histórico válido y terminó en error.
  if(ultimaSync && ultimaSync.estado==='error' && ultimoHistorial &&
     new Date(ultimaSync.iniciado_en) > new Date(ultimoHistorial.creado_en||0)){
    const dias=diasEntre(hoyLocal(),parseDateOnly(ultimoHistorial.fecha_valoracion));
    estadoEl.innerHTML=`<div class="empty" style="color:var(--yellow);text-align:left;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:12px">
      ⚠️ La última sincronización falló (${esc(fmtDateLong(new Date(ultimaSync.iniciado_en)))}). Mostrando los últimos datos válidos, de hace ${dias} día${dias!==1?'s':''}.
    </div>`;
  }

  renderPfResumen(ultimoHistorial, (lastSuccess&&lastSuccess[0])||null);
  document.getElementById('pfResumenCard').style.display='';

  document.getElementById('pfChartCard').style.display='';
  pintarValorPrincipal();
  renderPfChart();

  document.getElementById('pfDistCard').style.display='';
  renderPfDistribucion(ultimoHistorial);

  document.getElementById('pfPosicionesCard').style.display='';
  renderPfPosiciones(pfPosicionesCache);

  renderPfDiagnostico((reconciliacion&&reconciliacion[0])||null, ledger||[]);
  renderPfDiagnosticoYahoo();
  pfMostrarSubTabs(true);
  pfAplicarSubvista();
  startPfYahoo();
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
function pfFilasConVivo(filas){
  if(!filas.length)return filas;
  const v=obtenerValorActualPortafolio();
  if(v.fuente!=='YAHOO')return filas;
  const ultima=filas[filas.length-1],hoyIso=pfIso(new Date());
  if(ultima.fecha_valoracion>=hoyIso)return filas;
  return [...filas,{...ultima,fecha_valoracion:hoyIso,valor_total:v.valor,creado_en:new Date().toISOString()}];
}

// Puntos diarios → formato de construirGraficoIntradia ({t,valor}),
// conservando la fecha para el scrubbing.
function pfSeriePorFecha(serie){
  return serie.map(p=>({fecha:p.fecha,t:+parseDateOnly(p.fecha),valor:Number(p.valor)})).sort((a,b)=>a.t-b.t);
}

export function pfEtiquetaFecha(t){return fmtDateShort(new Date(t));}

// Escala de los gráficos del portafolio (todos los períodos y las dos
// vistas). Solo decide qué parte del eje se ve; nunca toca la serie.
// Rango mínimo, para no convertir ruido en una montaña: 0.2 pp en el día y
// 0.5 pp en períodos largos (Rendimiento); 0.2% / 0.5% del valor (Valor).
export function pfOpcionesEscala(serie,{vista,moneda,intradia=false}){
  const escala=escalaGrafico();
  if(vista==='rendimiento')return{escala,rangoMinimo:intradia?0.2:0.5,eje:{unidad:'%'}};
  const vals=serie.map(p=>Number(p.valor)).filter(Number.isFinite);
  const nivel=vals.length?vals.reduce((a,v)=>a+Math.abs(v),0)/vals.length:0;
  return{escala,rangoMinimo:nivel*(intradia?0.002:0.005),eje:{factor:pfMonedaVisible(moneda).factor}};
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
  const filas=pfFilasConVivo(per.filas);
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
      const serie=pfSeriePorFecha(r.serie);
      const grafico=construirGraficoIntradia(serie,{etiqueta:pfEtiquetaFecha,ejeX:'fecha',aria:'Rendimiento del portafolio en el período',...pfOpcionesEscala(serie,{vista:'rendimiento',moneda:r.moneda})});
      area.innerHTML=grafico.svg;
      // Cambio en dinero hasta el punto tocado SIN contar lo aportado o
      // retirado entre medio: un depósito no es ganancia. Mismo criterio de
      // fechas que el TWR (flujos después del cierre inicial y hasta el punto).
      const fl=pfFlujos();
      pfWireChartTooltip(area,grafico,{describir:p=>{
        const v=valorPorFecha.get(p.fecha);
        const aportado=fl.flujos.filter(f=>f.fecha>r.desde&&f.fecha<=p.fecha).reduce((s,f)=>s+f.monto,0);
        return{valorTexto:v!=null?pfFmt(v,r.moneda):'—',gananciaTexto:v==null?'':pfSigned(v-r.inicial-aportado,r.moneda),pctTexto:pfSignedPct(p.valor),pctNum:p.valor};
      }});
      res.innerHTML='<div class="pf-rend-big">'+esc(pfEtiquetaPeriodo(r.desde))+'<strong style="color:'+pfColor(r.pct)+'">'+esc(pfSignedPct(r.pct))+'</strong></div>'+cifras;
      hint.textContent=r.metodo==='twr'
        ?'Hubo '+r.flujos+' aporte(s) o retiro(s) en el período: rentabilidad ponderada por tiempo (TWR), que aísla su efecto encadenando los cierres oficiales de IBKR entre cada movimiento.'
        :'Sin aportes ni retiros en el período: valor final ÷ valor inicial − 1. Cierres oficiales de IBKR del '+pfFechaCorta(r.desde)+' al '+pfFechaCorta(r.hasta)+'.';
    }
  }else{
    titulo.textContent='Valor total de la cuenta · incluye aportes y retiros';
    const conValor=pfSinCerosIniciales(filas);
    const serie=pfSeriePorFecha(conValor.map(r=>({fecha:r.fecha_valoracion,valor:Number(r.valor_total)})));
    const inicial=serie[0]?.valor,moneda=filas.at(-1)?.moneda_base;
    const grafico=construirGraficoIntradia(serie,{referencia:inicial,etiqueta:pfEtiquetaFecha,ejeX:'fecha',aria:'Valor total de la cuenta en el período',vacio:'La cuenta aún no tenía valor en este período.',...pfOpcionesEscala(serie,{vista:'valor',moneda})});
    area.innerHTML=grafico.svg;
    // Valor: fecha y valor, sin %: un cambio de valor aquí puede ser un
    // aporte, y mostrarlo como porcentaje lo haría pasar por rentabilidad.
    pfWireChartTooltip(area,grafico,{describir:p=>({valorTexto:pfFmt(p.valor,moneda),lineaTexto:'Valor de la cuenta · incluye aportes y retiros',pctNum:null})});
    const recorte=conValor.length<filas.length&&conValor.length?' Se muestra desde el primer día con valor en la cuenta ('+pfFechaCorta(conValor[0].fecha_valoracion)+').':'';
    const truncado=grafico.meta&&grafico.meta.dominio[0]>0?' El eje vertical se ajusta al rango del período y no empieza en 0.':'';
    hint.textContent='El valor incluye aportes y retiros. No representa tu rentabilidad.'+recorte+truncado;
  }
  renderPfBenchmark(filas);
}
