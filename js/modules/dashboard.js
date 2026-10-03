// Inicio: balance, categorias, lista y filtros.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {aportesNetosInversion, esCuentaInversion, esCuentaUSDNoInversion, fueraDePerimetro} from './accounts.js';
import {renderAnalisis} from './analytics.js';
import {renderCardsPage} from './cards/cards-ui.js';
import {favorTarjetaEnSoles, getCardOutstandingTotal, modeloCreditoTarjetaUSD, tarjetaConCreditoUSD} from './cards/cards.js';
import {CREDIT_CARDS} from './cards/config.js';
import {pagoEnSoles, pagoEsUSD} from './cards/payments.js';
import {notaCreditoUSD} from './cards/usd-credit.js';
import {aplicarVistaUSD, monedaCuenta, verUSD} from './currencies.js';
import {renderDeb} from './debts.js';
import {obtenerValorActualPortafolio, pfCierreAnterior} from './portfolio/hero.js';
import {pfHistoricoCache} from './portfolio/portfolio.js';
import {gastoNeto, gastoNetoHasta, getTxRow, llenarSel, reembolsosDe} from './transactions.js';
import {cargarTcMercado, leerTipoCambio, tcMercado, tcUsdPen} from '../services/exchange-rate.js';
import {sbFetch} from '../services/supabase.js';
import {datos} from '../state.js';
import {abrirMesPicker, getMesActivo, vista} from '../ui/navigation.js';
import {dayLabel, fmtDateShort, parseDateOnly, pf} from '../utils/dates.js';
import {smoothSetText} from '../utils/dom.js';
import {cleanName, esc, escHtml, fmt, fmtC, fmtMoneda, fmtN, getEmoji, meses, norm} from '../utils/formatters.js';

let filtroCategoria=null;

let filtroTipo='todos';

 // 'todos' | 'gastos' | 'ingresos'
let busqueda='';

// 'periodo' | 'acumulado' | 'neto' | 'patrimonio'. acumuladoMode y netaMode
// se derivan de aquí para no cambiar renderBal ni el resto de consumidores.
let modoBalance='periodo';

// Patrimonio: se carga solo al elegir el modo, sin depender de Análisis.
// estado: idle | loading | ok | sin_datos | sin_tc | error
export let patrimonio={estado:'idle',soles:null,valorBase:null,moneda:null,fechaCorta:'',detalle:'',mensaje:'',enVivo:false};
// Último cierre leído directo de la base, solo mientras el portafolio no
// terminó de precargarse.
let cierreDirecto=null;

// Precios nuevos de Yahoo o una base nueva del portafolio cambian el valor.
globalThis.addEventListener?.('finanzas:portafolio',()=>{if(modoBalance==='patrimonio'&&patrimonio.estado!=='idle'&&patrimonio.estado!=='loading')renderBal();});

let acumuladoMode=false;

let netaMode=false;

export function filtrar(){
  let tx=datos.transacciones;
  if(vista==='mes'){
    const ma=getMesActivo();
    const m=ma.getMonth(),y=ma.getFullYear();
    tx=tx.filter(t=>{const f=pf(t[0]);return f.getMonth()===m&&f.getFullYear()===y;});
  }
  if(filtroCategoria){tx=tx.filter(t=>norm(t[2])===norm(filtroCategoria));}
  if(filtroTipo==='gastos')tx=tx.filter(t=>gastoNeto(t)!==0);
  else if(filtroTipo==='ingresos')tx=tx.filter(t=>t[3]==='Ingreso');
  else if(filtroTipo==='transferencias')tx=tx.filter(t=>t[3]==='Transferencia');
  if(busqueda)tx=tx.filter(t=>norm([t[1],t[2],t[3],t[5],t[7],t[4]].join(' ')).includes(norm(busqueda)));
  return tx;
}

// Cuerpo original de render(). El envoltorio de mas abajo lo llama y le
// anade el resumen y las etiquetas del hero; en el monolito eso se hacia
// reasignando window.render al final del script.
export function renderBase(){
  actualizarChips();
  renderBal();
  renderCat();
  renderTx();
  // Las otras páginas se pintan al abrirlas. Sus cálculos recorren el
  // historial completo y no deben retrasar el primer resumen de Inicio.
  const pagina=document.querySelector('.page.active')?.id;
  if(pagina==='p-card')renderCardsPage();
  if(pagina==='p-deb')renderDeb();
  llenarSel();
  renderFilterPill();
  if(pagina==='p-bud')renderAnalisis();
}

function renderFilterPill(){
  const c=document.getElementById('filterPill');
  if(filtroCategoria){
    const em=getEmoji(filtroCategoria);
    c.innerHTML=`<div class="chip active-cat" style="margin-bottom:14px" onclick="quitarFiltro()">${em.e} ${escHtml(cleanName(filtroCategoria))} <span style="font-weight:700;margin-left:4px">
✕
</span></div>`;
  }else c.innerHTML='';
}

export function quitarFiltro(){filtroCategoria=null;render();}

function actualizarChips(){
  if(vista==='mes'){
    const ma=getMesActivo();
    const ahora=new Date();
    let lbl;
    if(ma.getFullYear()===ahora.getFullYear()&&ma.getMonth()===ahora.getMonth())lbl='Este mes';
    else lbl=meses[ma.getMonth()]+' '+ma.getFullYear();
    document.getElementById('chipPeriodoLbl').textContent=lbl;
  }else{
    document.getElementById('chipPeriodoLbl').textContent='Todo el tiempo';
  }
  // Selector segmentado: un solo modo activo a la vez
  [['periodo','segPeriodo'],['acumulado','segAcumulado'],['neto','segNeto'],['patrimonio','segPatrimonio']].forEach(([modo,id])=>{
    const b=document.getElementById(id); if(!b)return;
    b.classList.toggle('active',modoBalance===modo);
    b.setAttribute('aria-selected',String(modoBalance===modo));
  });
  // KPI pills active state
  const out=document.getElementById('kpiOut'),inn=document.getElementById('kpiIn');
  out.classList.toggle('active-pill',filtroTipo==='gastos');
  inn.classList.toggle('active-pill',filtroTipo==='ingresos');
}

// === KPI PILLS COMO FILTROS ===
export function togglePillTipo(t){
  filtroTipo=filtroTipo===t?'todos':t;
  render();
}

// === MODO DEL SALDO: período / acumulado / neto / patrimonio ===
export function setModoBalance(modo){
  // Tocar "Este mes" estando ya en ese modo abre el selector de período.
  if(modo==='periodo'&&modoBalance==='periodo'){abrirMesPicker();return;}
  modoBalance=modo;
  acumuladoMode=modo==='acumulado';
  netaMode=modo==='neto'||modo==='patrimonio';
  if(modo==='patrimonio')cargarPatrimonio();
  render();
}

function toggleAcumulado(){setModoBalance(modoBalance==='acumulado'?'periodo':'acumulado');}

function toggleNeta(){setModoBalance(modoBalance==='neto'?'periodo':'neto');}

// Una selección hecha solo de transferencias (p. ej. al tocar la categoría
// "Inversión IBKR") no es ingreso ni gasto: el balance daría 0. En ese caso se
// muestra cuánto dinero se movió, sin sumarlo a nada.
function seleccionSoloTransferencias(){
  if(modoBalance!=='periodo')return false;
  const rows=filtrar();
  return rows.length>0&&rows.every(t=>t[3]==='Transferencia');
}

export function renderBal(){
  const hoy = new Date(); hoy.setHours(23,59,59,999);
  let txBalance;
  if(netaMode){
    txBalance = datos.transacciones; // pasado + futuro sin filtro
  } else if(acumuladoMode){
    txBalance = datos.transacciones.filter(t=>{ try{return pf(t[0])<=hoy;}catch(e){return true;} });
  } else {
    txBalance = filtrar();
  }
  const txPeriodo = filtrar();
  const pagosDesdeUSD=acumuladoMode?(datos.pagosTarjetas||[]).filter(p=>
    pagoEsUSD(p)&&esCuentaUSDNoInversion(p[6]||'')&&pf(p[4])<=hoy):[];
  const ajustesDePagosUSD=new Set(pagosDesdeUSD.map(p=>String(p[11]||'')).filter(Boolean));

  let iBal = 0, gBal = 0;
  txBalance.forEach(t=>{
    // La diferencia de cambio de un pago desde dólares propios tampoco
    // salió de una cuenta en soles; sí permanece en Neto.
    if(acumuladoMode&&ajustesDePagosUSD.has(String(t[6])))return;
    // Un Ingreso o Gasto ya registrado directo en IBKR o en una cuenta USD
    // que no es de inversión vive fuera del perímetro en soles: contarlo acá
    // duplicaría el ajuste que aportesNetosInversion hace para transferencias.
    if(fueraDePerimetro(t[5]||''))return;
    const m = parseFloat(t[4]) || 0;
    if(t[3] === 'Ingreso') iBal += m;
    gBal += acumuladoMode?gastoNetoHasta(t,hoy):gastoNeto(t);
  });

  let iPeriodo = 0, gPeriodo = 0;
  txPeriodo.forEach(t=>{
    if(fueraDePerimetro(t[5]||''))return;
    const m = parseFloat(t[4]) || 0;
    if(t[3] === 'Ingreso') iPeriodo += m;
    gPeriodo += gastoNeto(t);
  });

  // Al usar crédito USD comprado antes, reconocer su costo histórico. La
  // diferencia frente al gasto estimado pertenece a la fecha de consumo.
  const idsBalance=new Set(txBalance.map(t=>String(t[6]))),idsPeriodo=new Set(txPeriodo.map(t=>String(t[6])));
  for(const card of CREDIT_CARDS){
    if(!tarjetaConCreditoUSD(card))continue;
    for(const ajuste of modeloCreditoTarjetaUSD(card).cambios){
      if(idsBalance.has(ajuste.id)){if(ajuste.monto>0)iBal+=ajuste.monto;else gBal-=ajuste.monto;}
      if(idsPeriodo.has(ajuste.id)){if(ajuste.monto>0)iPeriodo+=ajuste.monto;else gPeriodo-=ajuste.monto;}
    }
  }

  let balance = iBal - gBal;

  // Las transferencias a IBKR o a cuentas USD sacan soles del perímetro.
  if(acumuladoMode||netaMode)balance-=aportesNetosInversion(txBalance);

  if(acumuladoMode){
    // Cancela el gasto devengado en tarjeta hasta que se pague en soles.
    balance+=CREDIT_CARDS.reduce((sum,card)=>sum+getCardOutstandingTotal(card,hoy),0);
    // Si se pagó desde dólares ya comprados, no hubo otra salida de soles.
    // El pago redujo la deuda anterior; se repone solo su equivalente
    // reconocido. Su ajuste de cambio se excluyó arriba por la misma razón.
    balance+=pagosDesdeUSD.reduce((sum,p)=>sum+pagoEnSoles(p)+(Number(notaCreditoUSD(p)?.costoCredito)||0),0);
    // El crédito a favor pertenece a la tarjeta; aún no es efectivo en banco.
    balance-=CREDIT_CARDS.reduce((sum,card)=>sum+favorTarjetaEnSoles(card,hoy),0);
  }

  // Patrimonio = Neto + valor del portafolio en soles. El valor_total de
  // IBKR ya incluye su efectivo, así que no se suma nada aparte.
  let textoAlterno=null;
  const nota=document.getElementById('balNota');
  if(nota){
    if(modoBalance==='patrimonio'){
      if(patrimonio.estado!=='idle'&&patrimonio.estado!=='loading'&&patrimonio.estado!=='error')patrimonio=calcularPatrimonio();
      if(patrimonio.estado==='ok'){
        balance+=patrimonio.soles;
        // Una sola línea: el detalle (dólares × TC) cambiaba el alto de Inicio.
        nota.textContent='+ IBKR '+fmt(patrimonio.soles)+' · '+(patrimonio.enVivo?'Yahoo en vivo':'cierre '+patrimonio.fechaCorta);
      }else{
        textoAlterno='—';
        nota.textContent=patrimonio.mensaje||'Cargando el valor de IBKR…';
      }
      nota.hidden=false;
    }else{nota.hidden=true;nota.textContent='';}
  }

  balance=Math.round(balance*100)/100;
  const soloTransf=seleccionSoloTransferencias();
  if(soloTransf)balance=txPeriodo.reduce((s,t)=>s+(parseFloat(t[4])||0),0);
  const kpiRow=document.getElementById('kpiRow');
  if(kpiRow)kpiRow.style.display=soloTransf?'none':'';

  smoothSetText(document.getElementById('balAmt'), textoAlterno||fmtN(Math.abs(balance)), textoAlterno?null:Math.abs(balance));
  const dot=document.getElementById('balDot');
  dot.textContent = textoAlterno ? '+' : soloTransf ? '↔' : (balance >= 0 ? '+' : '−');
  dot.classList.toggle('neg', !textoAlterno && !soloTransf && balance < 0);
  if(dot.style)dot.style.visibility = textoAlterno ? 'hidden' : '';

  document.getElementById('balLbl').textContent = soloTransf ? 'Transferido'
    : modoBalance==='patrimonio'
    ? 'Patrimonio'
    : netaMode ? 'Total neto'
    : acumuladoMode ? 'Efectivo hasta hoy' : 'Total';

  smoothSetText(document.getElementById('kpiOut'), '− ' + fmt(gPeriodo), gPeriodo);
  smoothSetText(document.getElementById('kpiIn'), '+ ' + fmt(iPeriodo), iPeriodo);
  aplicarVistaUSD();
}

function renderCat(){
  const tx=vista==='mes'?datos.transacciones.filter(t=>{const f=pf(t[0]);const ma=getMesActivo();return f.getMonth()===ma.getMonth()&&f.getFullYear()===ma.getFullYear();}):datos.transacciones;
  const g=document.getElementById('cats');
  const t={},c={};
  // Los reembolsos no se cuentan aparte: su efecto ya está plegado en el
  // gasto original vía gastoNeto, así que la compra sigue siendo un solo
  // movimiento (no dos) y su categoría refleja el gasto efectivo.
  tx.filter(x=>x[3]!=='Transferencia'&&x[3]!=='Reembolso').forEach(x=>{const k=cleanName(x[2]);const m=x[3]==='Gasto'?-gastoNeto(x):(parseFloat(x[4])||0);t[k]=(t[k]||0)+m;c[k]=(c[k]||0)+1;});
  // Transferencias aparte: se muestran para poder filtrarlas, pero no entran
  // en ningún total ni llevan signo o color de ingreso o gasto.
  const tr={},trc={};
  tx.filter(x=>x[3]==='Transferencia').forEach(x=>{const k=cleanName(x[2]);trc[k]=(trc[k]||0)+1;tr[k]=(tr[k]||0)+(parseFloat(x[4])||0);});
  const cs=Object.entries(t).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const trs=Object.entries(tr).sort((a,b)=>b[1]-a[1]);
  if(cs.length===0&&trs.length===0){g.innerHTML='<div class="empty" style="grid-column:1/-1">Sin movimientos este período</div>';return;}
  const tarjeta=(k,contenido)=>{
    const em=getEmoji(k);
    const sel=norm(filtroCategoria)===norm(k)?'selected':'';
    return `<div class="ccard ${sel}" data-category="${esc(k)}" onclick="filtrarPorCat(this.dataset.category)" style="--cc-bg:${em.c}"><div class="cemoji" style="background:${em.c}">${em.e}</div><div class="cinfo"><div class="cname">${esc(k)}</div>${contenido}</div></div>`;
  };
  g.innerHTML=cs.slice(0,8).map(([k,m])=>tarjeta(k,`<div class="camt ${m>=0?'in':'out'}">${m>=0?'+':'-'}${fmtC(Math.abs(m))}</div><div class="ccnt">${c[k]} mov${c[k]>1?'s':''}</div>`))
    .concat(trs.map(([k,m])=>tarjeta(k,`<div class="camt neutral">${fmtC(m)}</div><div class="ccnt">${trc[k]} mov${trc[k]>1?'s':''} · no suma</div>`)))
    .join('');
}

export function filtrarPorCat(k){filtroCategoria=norm(filtroCategoria)===norm(k)?null:k;render();}

// Una fila de reembolso, anidada debajo de su gasto original. Su click no
// debe abrir el gasto: edita o elimina solo esta devolución. La cuenta
// receptora sí se nombra: "Reembolso a Yape" deja claro adónde llegó el
// dinero sin abrir el gasto (que además puede estar en otra cuenta).
function filaReembolsoAnidada(r){
  const rowId=getTxRow(r);
  return `<div class="tx-refund-line" onclick="event.stopPropagation();editarTx('${escHtml(String(rowId).replace(/'/g,"\\'"))}')">↳ Reembolso a ${escHtml(r[5]||'—')}: +${fmt(Number(r[4])||0)} <span class="tx-refund-date">· ${fmtDateShort(pf(r[0]))}</span></div>`;
}

function filaTxPrincipal(t){
  const c=cleanName(t[2]);
  const em=getEmoji(c);
  const i=t[3]==='Ingreso',transfer=t[3]==='Transferencia';
  const m=parseFloat(t[4])||0;
  // En divisa el importe que se ve primero es el que pagaste; el
  // equivalente en soles y el tipo de cambio van en la segunda línea.
  const enDivisa=t[9]==='USD'&&Number(t[10])>0;
  // Compra o venta de dólares (no un aporte/retiro de inversión): dos
  // efectos reales de una sola operación, cada uno en su propia moneda. No
  // hay un "tipo de cambio" que enseñar aparte, los dos importes ya son el
  // hecho. Un aporte o retiro de inversión conserva su forma de siempre.
  const dual=transfer&&Number(t[14])>0&&!esCuentaInversion(t[5]||'')&&!esCuentaInversion(t[7]||'')
    &&monedaCuenta(t[5]||'')!==monedaCuenta(t[7]||'');
  const cambio=!dual&&transfer&&Number(t[14])>0
    ? `${fmt(m)} → ${fmtMoneda(Number(t[14]),t[13]||'USD')}`
    : !dual&&enDivisa?`${fmt(m)} · TC ${Number(t[11]).toFixed(6)}`:'';
  const base=transfer?`${t[5]} → ${t[7]||'Sin destino'}${t[1]?' · '+t[1]:''}`:t[1]||'?';
  const d=cambio?`${base} · ${cambio}`:base;
  // Un gasto con reembolsos vinculados muestra además lo pagado, el gasto
  // efectivo y cada devolución debajo, en vez de aparecer como filas sueltas.
  const reembolsos=t[3]==='Gasto'?reembolsosDe(t[6]):[];
  const extra=reembolsos.length>0
    ? `<div class="tx-refund-sub">Pagaste ${fmt(m)} con ${escHtml(t[5]||'—')}</div><div class="tx-refund-sub tx-refund-net">Gasto efectivo: ${fmt(gastoNeto(t))}</div>`
    : '';
  const importe=enDivisa?fmtMoneda(Number(t[10]),'USD'):fmt(reembolsos.length>0?gastoNeto(t):m);
  const row=getTxRow(t);
  const nested=reembolsos.slice().sort((a,b)=>pf(a[0])-pf(b[0])).map(filaReembolsoAnidada).join('');
  const pill=dual
    ? `<div class="tamt-pill transfer dual"><span class="pdot"></span><span class="leg-out">− ${enDivisa?fmtMoneda(Number(t[10]),'USD'):fmt(m)}</span><span class="leg-in">+ ${fmtMoneda(Number(t[14]),t[13]||monedaCuenta(t[7]||''))}</span></div>`
    : `<div class="tamt-pill ${transfer?'transfer':i?'in':'out'}"><span class="pdot"></span>${transfer?'↔':i?'+':'−'} ${importe}</div>`;
  return `<div class="tx" onclick="editarTx('${escHtml(String(row).replace(/'/g,"\\'"))}')"><div class="ti" style="background:${em.c}">${em.e}</div><div><div class="tcat">${escHtml(c||'—')}</div><div class="tdesc">${escHtml(d)}</div>${extra}</div>${pill}</div>${nested}`;
}

function renderTx(){
  // Los reembolsos no se listan como filas propias: aparecen anidados bajo
  // su gasto original (filaTxPrincipal), dondequiera que ese gasto caiga.
  const tx=filtrar().filter(t=>t[3]!=='Reembolso');const l=document.getElementById('txs');
  if(tx.length===0){l.innerHTML='<div class="empty">Sin transacciones</div>';return;}
  const o=[...tx].sort((a,b)=>pf(b[0])-pf(a[0]));
  // Agrupar por día
  const groups={};
  const order=[];
  o.forEach(t=>{
    const f=pf(t[0]);
    const key=f.getFullYear()+'-'+f.getMonth()+'-'+f.getDate();
    if(!groups[key]){groups[key]={date:f,items:[],in:0,out:0};order.push(key);}
    const m=parseFloat(t[4])||0;
    if(t[3]==='Ingreso')groups[key].in+=m;groups[key].out+=gastoNeto(t);
    groups[key].items.push(t);
  });
  l.innerHTML=order.map(key=>{
    const g=groups[key];
    const net=g.in-g.out;
    const totalCls=net>=0?'in':'out';
    const totalSign=net>=0?'+':'−';
    const items=g.items.map(filaTxPrincipal).join('');
    return `<div class="day-group"><div class="day-head"><span class="day-label">${dayLabel(g.date)}</span><span class="day-total ${totalCls}">${totalSign} ${fmt(Math.abs(net))}</span></div>${items}</div>`;
  }).join('');
}


function renderRec(){
  const l=document.getElementById('recs');
  if(!datos.recurrentes||datos.recurrentes.length===0){l.innerHTML='<div class="empty">Sin recurrentes<br><span style="font-size:0.7rem">Añádelas en la pestaña Recurrentes del Sheet</span></div>';return;}
  l.innerHTML=datos.recurrentes.filter(r=>r[5]!==false&&r[5]!=='No').map(r=>{
    const i=r[2]==='Ingreso';
    return `<div class="ritem"><div><div class="rdesc">${escHtml(r[0])}</div><div class="rmeta">${escHtml(cleanName(r[1]))} • Día ${r[4]}</div></div><div class="ramt ${i?'in':''}">${i?'+':'−'}${fmtC(r[3])}</div></div>`;
  }).join('');
}

export function toggleSearch(){
  const w=document.getElementById('searchWrap');
  w.classList.toggle('show');
  if(w.classList.contains('show')){document.getElementById('searchInp').focus();}
  else{document.getElementById('searchInp').value='';busqueda='';render();}
}

export function filtrarBusqueda(){busqueda=document.getElementById('searchInp').value;render();}

// Valor de IBKR en soles para Patrimonio. Con el portafolio ya cargado (se
// precarga al abrir la app) es EXACTAMENTE el valor actual de Portafolio:
// Yahoo cuando cuadra con el cierre IBKR (mismo snapshot, sin operaciones ni
// aportes pendientes) y, si no, el cierre oficial. Se recalcula en cada
// pintado: antes se calculaba una vez y, si Yahoo aún no había respondido,
// Patrimonio se quedaba con el cierre rezagado.
function calcularPatrimonio(){
  let row,valor,enVivo=false;
  if(pfHistoricoCache.length){
    const v=obtenerValorActualPortafolio();
    row=pfCierreAnterior();valor=v.valor;enVivo=v.fuente==='YAHOO';
  }else{row=cierreDirecto;valor=row?Number(row.valor_total):NaN;}
  if(!row||!Number.isFinite(valor))
    return{estado:'sin_datos',soles:null,valorBase:null,moneda:null,fechaCorta:'',detalle:'',enVivo:false,mensaje:'Todavía no hay un cierre de IBKR que sumar.'};
  const f=parseDateOnly(row.fecha_valoracion);
  const fechaCorta=f?String(f.getDate()).padStart(2,'0')+'/'+String(f.getMonth()+1).padStart(2,'0'):'';
  const moneda=row.moneda_base||'USD';
  // Tipo de cambio de mercado de hoy; el de Configuración solo sin red.
  const tc=moneda==='PEN'?1:tcMercado>0?tcMercado:tcUsdPen;
  if(!(tc>0))
    return{estado:'sin_tc',soles:null,valorBase:valor,moneda,fechaCorta,detalle:'',enVivo,mensaje:'Falta el tipo de cambio: configúralo en Configuración.'};
  return{estado:'ok',soles:valor*tc,valorBase:valor,moneda,fechaCorta,detalle:moneda==='PEN'?'':fmtMoneda(valor,moneda)+' × '+tc,enVivo,mensaje:''};
}

// Prepara lo que Patrimonio necesita: el tipo de cambio y, si el portafolio
// todavía no está precargado, el último cierre de IBKR. Si algo falla, el
// modo muestra '—' con el motivo, sin romper la pantalla.
export async function cargarPatrimonio(forzar){
 if(patrimonio.estado==='loading')return;
 if(patrimonio.estado!=='idle'&&patrimonio.estado!=='error'&&!forzar){if(modoBalance==='patrimonio')renderBal();return;}
 patrimonio={...patrimonio,estado:'loading',mensaje:'Cargando el valor de IBKR…'};
 try{
  const cierre=pfHistoricoCache.length?null:sbFetch('portafolio_historial?select=fecha_valoracion,moneda_base,valor_total&order=fecha_valoracion.desc&limit=1');
  await Promise.all([leerTipoCambio(),cargarTcMercado()]);
  if(cierre)cierreDirecto=((await cierre)||[])[0]||null;
  patrimonio=calcularPatrimonio();
 }catch(e){
  patrimonio={estado:'error',soles:null,valorBase:null,moneda:null,fechaCorta:'',detalle:'',enVivo:false,mensaje:'No se pudo cargar el valor de IBKR. Vuelve a intentarlo.'};
 }
 if(modoBalance==='patrimonio')renderBal();
}

export function render(){renderBase();const rows=filtrar(),income=rows.filter(t=>t[3]==='Ingreso').reduce((s,t)=>s+Number(t[4]),0),expense=rows.reduce((s,t)=>s+gastoNeto(t),0);const soloTr=seleccionSoloTransferencias();const title=soloTr?'Transferencias del período':income>0?'Tu período, de un vistazo':'Movimientos del período';const detail=soloTr?'Movimiento entre tus cuentas: no cuenta como ingreso ni como gasto.':income>0?`Gasto neto equivalente al ${Math.round(expense/income*100)}% de los ingresos registrados. Los filtros también afectan este resumen.`:'No hay ingresos en la selección actual. Revisa los filtros o registra un ingreso para comparar.';document.getElementById('quickInsight').innerHTML='<span class="symbol" aria-hidden="true">↗</span><div><strong>'+title+'</strong><p>'+detail+'</p></div>';document.getElementById('searchCount').textContent=rows.length+' movimiento'+(rows.length===1?'':'s')+(busqueda?(rows.length===1?' encontrado':' encontrados'):' en este período');document.getElementById('balLbl').textContent=verUSD?'Dólares en tus cuentas':soloTr?'Transferido en la selección':modoBalance==='patrimonio'?'Patrimonio estimado':netaMode?'Balance de todos los registros':acumuladoMode?'Efectivo hasta hoy':(busqueda||filtroCategoria||filtroTipo!=='todos')?'Balance de la selección':'Balance del período';}
