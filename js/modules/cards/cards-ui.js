// Pantallas de tarjetas.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cardStats, chipUSD, desgloseLineaPorMoneda, desgloseMonedasCiclo, fmtMonedas, getCardData, getCardOutstandingTotal, usdCiclo} from './cards.js';
import {CREDIT_CARDS, getCardGoalPct, getCreditGoalPct, getCreditLimit, renderCreditLineBlock, renderLineProgress} from './config.js';
import {cardCycleOffset, clearTxCycleOverride, getCardCycle, getCycleKey, getTxCycleOverride, isCardExpenseFor, setTxCycleOverride, txBelongsToCycle, updateCardCycleQuickUI} from './cycles.js';
import {renderPaymentHistory} from './payments.js';
import {getTxRow, sameAccount} from '../transactions.js';
import {datos} from '../../state.js';
import {toast} from '../../ui/toast.js';
import {fmtDateLong, fmtDateShort, pf} from '../../utils/dates.js';
import {cleanName, escHtml, fmt, fmtN, getEmoji} from '../../utils/formatters.js';

export let selectedCardCuenta=null;

let selectedCardTxRow=null;

let cardDetailTab='resumen';

let cardPageTab='resumen';

export function setCardPageTab(tab,btn){
  cardPageTab=tab;
  document.querySelectorAll('#p-card .detail-tab').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderCardsPage();
}

export function abrirCardDetail(cuenta){selectedCardCuenta=cuenta;renderCardDetail();document.getElementById('cardDetailModal').classList.add('active');}

export function cerrarCardDetail(){document.getElementById('cardDetailModal').classList.remove('active');selectedCardCuenta=null;}

// Desglose de la línea por ciclo y moneda: lo que se paga en soles y lo que
// se paga en dólares. Anteriores y Más adelante solo aparecen con saldo.
function renderDesgloseLinea(){
  const d=desgloseLineaPorMoneda(),hay=x=>x.soles>0||x.usd>0;
  const filas=[['Anteriores',d.anteriores,hay(d.anteriores)],['Actual',d.actual,true],['Siguiente',d.siguiente,true],['Más adelante',d.despues,hay(d.despues)]];
  return `<div class="line-breakdown">${filas.filter(f=>f[2]).map(([nombre,monto])=>`<div class="line-breakdown-row"><span>${nombre}:</span><strong>${fmtMonedas(monto)}</strong></div>`).join('')}</div>`;
}

function renderCreditLineSummary(){
  const cont=document.getElementById('cardsLineSummary'); if(!cont)return;
  const used=CREDIT_CARDS.reduce((sum,card)=>sum+getCardOutstandingTotal(card),0);
  const limit=CREDIT_CARDS.reduce((s,card)=>s+getCreditLimit(card),0);
  // Meta total = suma de (limite_i * meta_i / 100) por tarjeta (no aplicar % global al total)
  const goalAmount=CREDIT_CARDS.reduce((s,card)=>s+(getCreditLimit(card)*getCardGoalPct(card)/100),0);
  const effectiveGoalPct=limit>0?(goalAmount/limit)*100:getCreditGoalPct();
  const pct=limit>0?(used/limit)*100:0;
  const remaining=goalAmount-used;
  let cls='ok';
  if(pct>=80)cls='danger';
  else if(used>goalAmount)cls='bad';
  else if(used>=goalAmount*.8)cls='warn';
  const advice=remaining>=0?`Te quedan ${fmt(remaining)} para mantenerte bajo la meta`:`Te pasaste ${fmt(Math.abs(remaining))} sobre la meta recomendada`;
  // Editar tarjetas está en el encabezado de la página.
  cont.innerHTML=`<div class="line-summary-card">
    <div class="line-summary-top">
      <div><div class="line-summary-title">Línea total usada</div><div class="line-summary-main"><span class="used">${fmt(used)}</span> <span class="limit">de ${fmt(limit)}</span></div></div>
    </div>
    ${renderLineProgress(pct,cls)}
    ${renderDesgloseLinea()}
    <div class="line-summary-meta"><span><strong>${pct.toFixed(1)}%</strong> usado · meta ponderada ${effectiveGoalPct.toFixed(1)}% = <strong>${fmt(goalAmount)}</strong></span><span class="line-advice ${cls}">${advice}</span></div>
  </div>`;
}

// Un consumo en dólares se guarda en soles al TC de la compra; se muestran
// ambos importes para reconocerlo.
const montoConsumo=t=>`− ${fmt(t[4])}${t[9]==='USD'&&Number(t[10])>0?chipUSD(Number(t[10])):''}`;

function saldoFavorCiclo(data){
  return{soles:Math.max(0,Number(data.saldoFavor)||0),usd:Math.max(0,Number(data.saldoFavorUSD)||0)};
}

function creditoAplicadoCiclo(data){
  return{soles:Math.max(0,Number(data.creditoAplicadoPEN??data.creditoAplicado)||0),usd:Math.max(0,Number(data.creditoAplicadoUSD)||0)};
}

// Soles y dólares lado a lado: qué se consumió, qué se pagó y cómo quedó cada
// moneda. Al final, el total del ciclo en soles con los dólares al TC de compra.
function renderDesgloseMonedas(d){
  const s=d.soles,u=d.dolares;
  const usdTxt=v=>'US$ '+fmtN(v);
  const saldo=(x,f)=>x.pendiente>0?`<strong class="red">${f(x.pendiente)}</strong><small>pendiente</small>`
    :x.favor>0?`<strong class="green">+${f(x.favor)}</strong><small>a favor</small>`
    :`<strong>${f(0)}</strong><small>al día</small>`;
  const celda=(v,nota='')=>`<span>${v}${nota?`<small>${nota}</small>`:''}</span>`;
  const fila=(nombre,sol,dol)=>`<div class="ccs-row"><span class="ccs-lbl">${nombre}</span>${sol}${u?dol:''}</div>`;
  const aplicado=s.aplicado>0||u?.aplicado>0;
  return `<section class="card-currency-split${u?'':' solo-soles'}" aria-label="Consumos y pagos por moneda">
    <div class="ccs-row ccs-head"><span></span><span>Soles</span>${u?'<span>Dólares</span>':''}</div>
    ${fila('Consumido',celda(fmt(s.consumido)),u&&celda(usdTxt(u.consumido),u.consumido>0?'≈ '+fmt(u.equivalente):''))}
    ${fila('Pagado',celda(fmt(s.pagado)),u&&celda(usdTxt(u.pagado),u.costo>0?'costó '+fmt(u.costo):''))}
    ${aplicado?fila('A favor aplicado',celda(s.aplicado>0?fmt(s.aplicado):'—'),u&&celda(u.aplicado>0?usdTxt(u.aplicado):'—')):''}
    ${fila('Saldo',`<span>${saldo(s,fmt)}</span>`,u&&`<span>${saldo(u,usdTxt)}</span>`)}
    <div class="ccs-total"><span>Total consumido en soles</span><strong>${fmt(d.total)}</strong></div>
    ${u&&u.consumido>0?`<div class="ccs-note">${fmt(s.consumido)} en soles + ${fmt(u.equivalente)} de ${usdTxt(u.consumido)} al tipo de cambio de cada compra</div>`:''}
    ${d.reembolsos>0?`<div class="ccs-note">Incluye compras con devolución por ${fmt(d.reembolsos)}</div>`:''}
  </section>`;
}

function saldoPrincipal(data){
  const favor=saldoFavorCiclo(data),aFavor=data.pendiente<=0&&(favor.soles>0||favor.usd>0);
  return{aFavor,favor,monto:aFavor?(favor.soles>0?`+${fmt(favor.soles)}`:`+US$ ${fmtN(favor.usd)}`):fmt(data.pendiente)};
}

export function renderCardsPage(){
  updateCardCycleQuickUI();
  renderCreditLineSummary();
  const cont=document.getElementById('cardsPage'); if(!cont)return;

  if(cardPageTab==='resumen'){
    cont.innerHTML=CREDIT_CARDS.map(card=>{
      const data=getCardData(card,cardCycleOffset); const {cycle,gastos,total,pagado,pendiente,status}=data;
      const pct=total>0?Math.min((pagado/total)*100,100):0; const usd=usdCiclo(card,data);
      const principal=saldoPrincipal(data),aplicado=creditoAplicadoCiclo(data);
      return `<div class="credit-card" onclick="abrirCardDetail('${card.cuenta.replace(/'/g,"\\'")}')">
        <div class="credit-top"><div><div class="credit-name">${escHtml(card.emoji)} ${escHtml(card.nombre)}</div><div class="credit-sub">${gastos.length} consumo${gastos.length===1?'':'s'} en este ciclo</div></div><div class="credit-amount${principal.aFavor?' green':''}">${principal.monto}${principal.aFavor?'<div class="credit-amount-label">A favor</div>':''}</div></div>
        <div class="credit-info">
          <div class="credit-row"><span>Ciclo</span><span>${fmtDateShort(cycle.start)} – ${fmtDateShort(cycle.end)}</span></div>
          <div class="credit-row"><span>Total facturado</span><span>${fmt(total)}${usd?chipUSD(usd.total,'incl. '):''}</span></div>
          <div class="credit-row"><span>Pagado</span><span>${fmt(pagado)} · ${pct.toFixed(0)}%</span></div>
          ${aplicado.soles>0||aplicado.usd>0?`<div class="credit-row"><span>Saldo a favor aplicado</span><strong class="card-credit-applied">${fmtMonedas(aplicado)}</strong></div>`:''}
          <div class="credit-row"><span>Pendiente</span><span${pendiente>0?' style="color:var(--red)"':''}>${fmt(pendiente)}${usd&&usd.pendiente>0?chipUSD(usd.pendiente,'incl. '):''}</span></div>
          ${data.saldoFavorUSD>0?`<div class="credit-row"><span>A favor en dólares</span><strong style="color:var(--green)">+US$ ${fmtN(data.saldoFavorUSD)}</strong></div>`:''}
          ${data.saldoFavor>0?`<div class="credit-row"><span>A favor en soles</span><strong style="color:var(--green)">+${fmt(data.saldoFavor)}</strong></div>`:''}
          <div class="credit-row"><span>Pagar hasta</span><span>${fmtDateLong(cycle.pay)}</span></div>
          <div class="credit-row"><span>Estado</span><span><span class="status-pill ${status.cls}">${status.text}</span></span></div>
        </div>${renderCreditLineBlock(card,getCardOutstandingTotal(card))}<div class="hint">Ver resumen e historial de pagos</div></div>`;
    }).join('');
    return;
  }

  if(cardPageTab==='consumos'){
    cont.innerHTML=CREDIT_CARDS.map(card=>{
      const data=getCardData(card,cardCycleOffset);
      const txRows=data.gastos.length
        ?data.gastos.map(t=>{
            const em=getEmoji(cleanName(t[2]));
            const override=getTxCycleOverride(card,t);
            const row=String(getTxRow(t)).replace(/'/g,"\\'");
            return `<div class="card-tx-item"><div onclick="abrirCardTxDetail('${card.cuenta.replace(/'/g,"\\'")}','${row}')" style="flex:1;cursor:pointer"><div class="card-tx-desc">${em.e} ${escHtml(t[1]||'Sin descripción')}${override?' <span class="manual-tag">ajustado</span>':''}</div><div class="card-tx-meta">${escHtml(cleanName(t[2]))} · ${fmtDateLong(pf(t[0]))}</div></div><div style="display:flex;align-items:center;gap:6px"><span class="card-tx-amt">${montoConsumo(t)}</span><button class="mini-action" onclick="event.stopPropagation();editarTx('${row}')">Editar</button></div></div>`;
          }).join('')
        :'<div class="empty" style="padding:24px 10px">Sin consumos en este ciclo</div>';
      return `<div class="credit-card" style="cursor:default"><button class="credit-top credit-detail-trigger" type="button" onclick="abrirCardDetail('${card.cuenta.replace(/'/g,"\\'")}')"><span><span class="credit-name">${escHtml(card.emoji)} ${escHtml(card.nombre)}</span><span class="credit-sub">${data.gastos.length} consumo${data.gastos.length===1?'':'s'} · ${fmtDateShort(data.cycle.start)} – ${fmtDateShort(data.cycle.end)}</span></span><span class="credit-amount">${fmt(data.total)}</span></button><div class="card-tx-list">${txRows}</div></div>`;
    }).join('');
    return;
  }

  cont.innerHTML=CREDIT_CARDS.map(card=>{
    const data=getCardData(card,cardCycleOffset); const prev=getCardData(card,cardCycleOffset-1); const st=cardStats(data.gastos,data.total); const topEmoji=getEmoji(st.topCat);
    const delta=data.total-prev.total; const pct=prev.total>0?(delta/prev.total)*100:(data.total>0?100:0);
    const cls=delta<0?'stat-delta-pos':delta>0?'stat-delta-neg':'stat-delta-flat';
    const deltaTxt=`${delta>0?'+':delta<0?'−':''}${fmt(Math.abs(delta))} · ${pct>0?'+':''}${pct.toFixed(0)}%`;
    return `<div class="credit-card" onclick="abrirCardDetail('${card.cuenta.replace(/'/g,"\\'")}')"><div class="credit-top"><div><div class="credit-name">${escHtml(card.emoji)} ${escHtml(card.nombre)}</div><div class="credit-sub">Stats vs ciclo anterior</div></div><div class="credit-amount">${fmt(data.total)}</div></div><div class="card-stat-grid"><div class="card-stat"><div class="card-stat-lbl">Ciclo anterior</div><div class="card-stat-val">${fmt(prev.total)}</div></div><div class="card-stat"><div class="card-stat-lbl">Variación</div><div class="card-stat-val ${cls}">${deltaTxt}</div></div><div class="card-stat"><div class="card-stat-lbl">Consumos</div><div class="card-stat-val">${data.gastos.length}</div></div><div class="card-stat"><div class="card-stat-lbl">Promedio</div><div class="card-stat-val">${fmt(st.avg)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Mayor categoría</div><div class="card-stat-val">${topEmoji.e} ${escHtml(st.topCat)} · ${fmt(st.topCatVal)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Mayor consumo</div><div class="card-stat-val">${st.maxTx?`${escHtml(st.maxTx[1])} · ${fmt(st.maxTx[4])}`:'—'}</div></div></div><div class="hint">Toca para ver estadísticas completas</div></div>`;
  }).join('');
}

export function abrirCardTxDetail(cuenta,row){
  selectedCardCuenta=cuenta;
  selectedCardTxRow=row;
  renderCardTxDetail();
  document.getElementById('cardTxDetailModal').classList.add('active');
}

export function cerrarCardTxDetail(){
  document.getElementById('cardTxDetailModal').classList.remove('active');
  selectedCardTxRow=null;
}

function renderCardTxDetail(){
  const cont=document.getElementById('cardTxDetailContent'); const card=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,selectedCardCuenta));
  if(!cont||!card)return;
  const tx=datos.transacciones.find(x=>String(getTxRow(x))===String(selectedCardTxRow));
  if(!tx){cont.innerHTML='<div class="empty">No encontré este consumo</div>';return;}
  const em=getEmoji(cleanName(tx[2])); const cycle=getCardCycle(card,cardCycleOffset); const override=getTxCycleOverride(card,tx);
  const modo=override?'Manual':'Automático';
  cont.innerHTML=`<div class="card-detail-head"><div class="card-detail-name">${em.e} ${escHtml(tx[1]||'Sin descripción')}</div><div class="card-detail-sub">${escHtml(card.nombre)} · ${fmtDateLong(pf(tx[0]))}</div></div>
    <div class="tx-detail-grid">
      <div class="tx-detail-row"><span>Monto</span><span style="color:var(--red)">− ${fmt(tx[4])}</span></div>
      ${tx[9]==='USD'&&Number(tx[10])>0?`<div class="tx-detail-row"><span>En dólares</span><span>US$ ${fmtN(Number(tx[10]))}${Number(tx[11])>0?' · TC '+Number(tx[11]).toFixed(3):''}</span></div>`:''}
      <div class="tx-detail-row"><span>Categoría</span><span>${cleanName(tx[2])}</span></div>
      <div class="tx-detail-row"><span>Cuenta</span><span>${tx[5]||card.nombre}</span></div>
      <div class="tx-detail-row"><span>Ciclo visible</span><span>${fmtDateShort(cycle.start)} – ${fmtDateShort(cycle.end)}</span></div>
      <div class="tx-detail-row"><span>Asignación</span><span>${modo}</span></div>
    </div>
    <div class="card-tx-title">Mover consumo</div>
    <div class="tx-actions"><button class="mini-action ${!override?'active':''}" onclick="moverConsumoCiclo('${String(getTxRow(tx)).replace(/'/g,"\\'")}','auto');renderCardTxDetail();">Auto</button><button class="mini-action" onclick="moverConsumoCiclo('${String(getTxRow(tx)).replace(/'/g,"\\'")}',-1);cerrarCardTxDetail();">Ciclo ant.</button><button class="mini-action ${override===getCycleKey(cycle)?'active':''}" onclick="moverConsumoCiclo('${String(getTxRow(tx)).replace(/'/g,"\\'")}',0);renderCardTxDetail();">Este ciclo</button><button class="mini-action" onclick="moverConsumoCiclo('${String(getTxRow(tx)).replace(/'/g,"\\'")}',1);cerrarCardTxDetail();">Sig. ciclo</button></div>`;
}

function getManualMovedTxs(card){return (datos.transacciones||[]).filter(t=>isCardExpenseFor(card,t)&&!!getTxCycleOverride(card,t)).sort((a,b)=>pf(b[0])-pf(a[0]));}

function renderManualMovedSection(card,cycle){
  const moved=getManualMovedTxs(card).filter(t=>!txBelongsToCycle(card,t,cycle));
  if(!moved.length)return '';
  return `<div class="manual-section-title">Movidos manualmente fuera de este ciclo</div>`+moved.map(t=>{
    const em=getEmoji(cleanName(t[2])); const row=getTxRow(t); const key=getTxCycleOverride(card,t);
    return `<div class="card-tx-item recovery" onclick="abrirCardTxDetail('${card.cuenta.replace(/'/g,"\\'")}','${String(row).replace(/'/g,"\\'")}')"><div><div class="card-tx-desc">${em.e} ${escHtml(t[1]||'Sin descripción')} <span class="manual-tag">ajustado</span></div><div class="card-tx-meta">${escHtml(cleanName(t[2]))} · ${fmtDateLong(pf(t[0]))} · ciclo ${key}</div></div><div class="card-tx-amt">${montoConsumo(t)}</div></div>`;
  }).join('');
}

export async function moverConsumoCiclo(row,targetOffset){
  const card=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,selectedCardCuenta)); if(!card)return;
  const tx=datos.transacciones.find(x=>String(getTxRow(x))===String(row)); if(!tx)return;
  if(targetOffset==='auto')await clearTxCycleOverride(card,tx);
  else await setTxCycleOverride(card,tx,getCardCycle(card,cardCycleOffset+Number(targetOffset)));
  renderCardsPage(); renderCardDetail(); renderCardTxDetail(); toast('Ciclo actualizado','success');
}

function renderCardTxList(card,gastos,cycle){
  const list=gastos.length?gastos.map(t=>{
    const em=getEmoji(cleanName(t[2])); const override=getTxCycleOverride(card,t); const row=getTxRow(t);
    return `<div class="card-tx-item" onclick="abrirCardTxDetail('${card.cuenta.replace(/'/g,"\\'")}','${String(row).replace(/'/g,"\\'")}')"><div><div class="card-tx-desc">${em.e} ${escHtml(t[1]||'Sin descripción')} ${override?'<span class="manual-tag">ajustado</span>':''}</div><div class="card-tx-meta">${escHtml(cleanName(t[2]))} · ${fmtDateLong(pf(t[0]))}</div></div><div class="card-tx-amt">${montoConsumo(t)}</div></div>`;
  }).join(''):'<div class="empty" style="padding:24px 10px">Sin consumos en este ciclo</div>';
  return list+renderManualMovedSection(card,cycle);
}

export function renderCardDetail(){
  const cont=document.getElementById('cardDetailContent'); const card=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,selectedCardCuenta)); if(!cont||!card)return;
  const data=getCardData(card,cardCycleOffset); const {cycle,gastos,total,pagado,pendiente,status}=data; const st=cardStats(gastos,total);
  const prev=getCardData(card,cardCycleOffset-1); const topEmoji=getEmoji(st.topCat);
  const pct=total>0?Math.min((pagado/total)*100,100):0; const delta=total-prev.total; const pctDelta=prev.total>0?(delta/prev.total)*100:(total>0?100:0);
  const deltaCls=delta<0?'stat-delta-pos':delta>0?'stat-delta-neg':'stat-delta-flat';
  const deltaTxt=`${delta>0?'+':delta<0?'−':''}${fmt(Math.abs(delta))} · ${pctDelta>0?'+':''}${pctDelta.toFixed(0)}%`;
  const head=`<div class="card-detail-head card-account-head"><div class="card-detail-icon" aria-hidden="true">${escHtml(card.emoji)}</div><div class="card-detail-heading"><div class="card-detail-name">${escHtml(card.nombre)}</div><div class="card-detail-sub">${fmtDateShort(cycle.start)} – ${fmtDateShort(cycle.end)}</div></div><span class="status-pill ${status.cls}">${status.text}</span></div>`;
  if(cardPageTab==='consumos'){
    cont.innerHTML=head+`<div class="card-tx-list card-detail-scroll"><div class="card-tx-title">Gastos del ciclo</div>${renderCardTxList(card,gastos,cycle)}</div>${renderPaymentHistory(card,cycle,data)}`; return;
  }
  if(cardPageTab==='stats'){
    const catRows=Object.entries(st.cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="credit-row"><span>${getEmoji(k).e} ${k}</span><span>${fmt(v)}</span></div>`).join('');
    cont.innerHTML=head+`<div class="card-stat-grid"><div class="card-stat"><div class="card-stat-lbl">Este ciclo</div><div class="card-stat-val">${fmt(total)}</div></div><div class="card-stat"><div class="card-stat-lbl">Ciclo anterior</div><div class="card-stat-val">${fmt(prev.total)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Variación</div><div class="card-stat-val ${deltaCls}">${deltaTxt}</div></div><div class="card-stat"><div class="card-stat-lbl">Consumos</div><div class="card-stat-val">${gastos.length}</div></div><div class="card-stat"><div class="card-stat-lbl">Promedio</div><div class="card-stat-val">${fmt(st.avg)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Mayor categoría</div><div class="card-stat-val">${topEmoji.e} ${escHtml(st.topCat)} · ${fmt(st.topCatVal)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Mayor consumo</div><div class="card-stat-val">${st.maxTx?`${escHtml(st.maxTx[1])} · ${fmt(st.maxTx[4])}`:'—'}</div></div></div><div class="credit-card" style="cursor:default;margin-top:12px"><div class="card-tx-title">Categorías</div>${catRows||'<div class="empty" style="padding:16px">Sin datos</div>'}</div>${renderPaymentHistory(card,cycle,data)}`; return;
  }
  const usd=usdCiclo(card,data),desglose=desgloseMonedasCiclo(card,data);
  const principal=saldoPrincipal(data);
  cont.innerHTML=head+`
    <section class="card-detail-balance">
      <div class="card-detail-label">${principal.aFavor?'Saldo a favor del ciclo':'Pendiente del ciclo'}</div>
      <div class="card-detail-amount ${pendiente>0?'red':'green'}">${principal.monto}</div>
      ${principal.aFavor&&principal.favor.soles>0&&principal.favor.usd>0?`<div class="card-detail-currency card-credit-applied">+US$ ${fmtN(principal.favor.usd)}</div>`:usd&&usd.pendiente>0?`<div class="card-detail-currency">${chipUSD(usd.pendiente,'incl. ')}</div>`:''}
      ${principal.aFavor?'<div class="card-detail-credit-note">Se arrastra al siguiente ciclo</div>':`<div class="card-detail-due"><span>Pagar hasta</span><strong>${fmtDateLong(cycle.pay)}</strong></div>`}
    </section>
    ${total>0||data.pagos.length?renderDesgloseMonedas(desglose):''}
    ${total>0?`<div class="card-detail-progress"><div class="bbar"><div class="bfill ${pct>=100?'ok':pct>0?'warn':'over'}" style="width:${pct}%"></div></div><div class="bpct">${pct.toFixed(0)}% pagado</div></div>`:''}
    ${!principal.aFavor&&data.saldoFavorUSD>0&&!(desglose.dolares?.favor>0)?`<div class="card-pen-credit">Saldo a favor en dólares <strong>+US$ ${fmtN(data.saldoFavorUSD)}</strong></div>`:''}
    ${renderPaymentHistory(card,cycle,data)}
    <div class="card-detail-line">${renderCreditLineBlock(card,getCardOutstandingTotal(card))}</div>`;
}
