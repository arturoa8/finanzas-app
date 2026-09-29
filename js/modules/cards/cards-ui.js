// Pantallas de tarjetas.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cardStats, chipUSD, deudaUSDTotal, getCardData, getCardOutstandingTotal, refSolesHoy, usdCiclo} from './cards.js';
import {CREDIT_CARDS, getCardGoalPct, getCreditGoalPct, getCreditLimit, renderCreditLineBlock, renderLineProgress} from './config.js';
import {cardCycleOffset, clearTxCycleOverride, getCardCycle, getCycleKey, getTxCycleOverride, isCardExpenseFor, setTxCycleOverride, txBelongsToCycle, updateCardCycleQuickUI} from './cycles.js';
import {actualizarPagoUSD, renderPaymentForm, renderPaymentHistory} from './payments.js';
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

function bannerDeudaUSD(){
  const total=deudaUSDTotal();
  return total>0?`<div class="line-summary-card" style="margin-bottom:12px"><div class="line-summary-title">Debes en dólares · todas las tarjetas</div><div class="line-summary-main">US$ ${fmtN(total)}${refSolesHoy(total)}</div><p class="hint">Consumos en dólares menos pagos en dólares. Lo que costó en soles se fija al pagar.</p></div>`:'';
}

function renderCreditLineSummary(){
  const cont=document.getElementById('cardsLineSummary'); if(!cont)return;
  const currentItems=CREDIT_CARDS.map(card=>({card,data:getCardData(card,cardCycleOffset)}));
  const nextItems=CREDIT_CARDS.map(card=>({card,data:getCardData(card,cardCycleOffset+1)}));
  const usedCurrent=currentItems.reduce((s,x)=>s+x.data.pendiente,0);
  const usedNext=nextItems.reduce((s,x)=>s+x.data.pendiente,0);
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
  cont.innerHTML=`<div class="line-summary-card">
    <div class="line-summary-top">
      <div><div class="line-summary-title">Línea total usada</div><div class="line-summary-main"><span class="used">${fmt(used)}</span> <span class="limit">de ${fmt(limit)}</span></div></div>
      <button class="line-edit-btn" onclick="abrirLineasCredito()">Editar tarjetas</button>
    </div>
    ${renderLineProgress(pct,cls)}
    <div class="line-summary-breakdown"><span>Actual: <strong>${fmt(usedCurrent)}</strong></span><span>Siguiente: <strong>${fmt(usedNext)}</strong></span></div>
    <div class="line-summary-meta"><span><strong>${pct.toFixed(1)}%</strong> usado · meta ponderada ${effectiveGoalPct.toFixed(1)}% = <strong>${fmt(goalAmount)}</strong></span><span class="line-advice ${cls}">${advice}</span></div>
  </div>`;
}

function renderCardMiniList(gastos,limit=3,card=null){
  if(!gastos.length)return '<div class="empty" style="padding:18px 8px">Sin consumos en este ciclo</div>';
  return `<div class="card-mini-list">${gastos.slice(0,limit).map(t=>{
    const em=getEmoji(cleanName(t[2])); const row=getTxRow(t); const cta=card?card.cuenta:(t[5]||'');
    return `<div class="card-mini-item" onclick="event.stopPropagation();abrirCardTxDetail('${String(cta).replace(/'/g,"\\'")}','${String(row).replace(/'/g,"\\'")}')"><div><div class="card-mini-desc">${em.e} ${escHtml(t[1]||'Sin descripción')}</div><div class="card-mini-meta">${escHtml(cleanName(t[2]))} · ${fmtDateShort(pf(t[0]))}</div></div><div class="card-mini-amt">− ${fmt(t[4])}</div></div>`;
  }).join('')}</div>`;
}

export function renderCardsPage(){
  updateCardCycleQuickUI();
  renderCreditLineSummary();
  const cont=document.getElementById('cardsPage'); if(!cont)return;

  if(cardPageTab==='resumen'){
    cont.innerHTML=bannerDeudaUSD()+CREDIT_CARDS.map(card=>{
      const data=getCardData(card,cardCycleOffset); const {cycle,gastos,total,pagado,pendiente,status}=data;
      const pct=total>0?Math.min((pagado/total)*100,100):0; const usd=usdCiclo(card,data);
      return `<div class="credit-card" onclick="abrirCardDetail('${card.cuenta.replace(/'/g,"\\'")}')">
        <div class="credit-top"><div><div class="credit-name">${escHtml(card.emoji)} ${escHtml(card.nombre)}</div><div class="credit-sub">${gastos.length} consumo${gastos.length===1?'':'s'} en este ciclo</div></div><div class="credit-amount">${fmt(pendiente)}</div></div>
        <div class="credit-info">
          <div class="credit-row"><span>Ciclo</span><span>${fmtDateShort(cycle.start)} – ${fmtDateShort(cycle.end)}</span></div>
          <div class="credit-row"><span>Total facturado</span><span>${fmt(total)}${usd?chipUSD(usd.total):''}</span></div>
          <div class="credit-row"><span>Pagado</span><span>${fmt(pagado)} · ${pct.toFixed(0)}%</span></div>
          <div class="credit-row"><span>Pendiente</span><span style="color:var(--red)">${fmt(pendiente)}${usd&&usd.pendiente>0?chipUSD(usd.pendiente):''}</span></div>
          <div class="credit-row"><span>Pagar hasta</span><span>${fmtDateLong(cycle.pay)}</span></div>
          <div class="credit-row"><span>Estado</span><span><span class="status-pill ${status.cls}">${status.text}</span></span></div>
        </div>${renderCreditLineBlock(card,pendiente)}<div class="hint">Toca para ver pago y resumen</div></div>`;
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
            return `<div class="card-tx-item"><div onclick="abrirCardTxDetail('${card.cuenta.replace(/'/g,"\\'")}','${row}')" style="flex:1;cursor:pointer"><div class="card-tx-desc">${em.e} ${escHtml(t[1]||'Sin descripción')}${override?' <span class="manual-tag">ajustado</span>':''}</div><div class="card-tx-meta">${escHtml(cleanName(t[2]))} · ${fmtDateLong(pf(t[0]))}</div></div><div style="display:flex;align-items:center;gap:6px"><span class="card-tx-amt">− ${fmt(t[4])}</span><button class="mini-action" onclick="event.stopPropagation();editarTx('${row}')">Editar</button></div></div>`;
          }).join('')
        :'<div class="empty" style="padding:24px 10px">Sin consumos en este ciclo</div>';
      return `<div class="credit-card" style="cursor:default"><div class="credit-top"><div><div class="credit-name">${escHtml(card.emoji)} ${escHtml(card.nombre)}</div><div class="credit-sub">${data.gastos.length} consumo${data.gastos.length===1?'':'s'} · ${fmtDateShort(data.cycle.start)} – ${fmtDateShort(data.cycle.end)}</div></div><div class="credit-amount">${fmt(data.total)}</div></div><div class="card-tx-list">${txRows}</div></div>`;
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
    return `<div class="card-tx-item recovery" onclick="abrirCardTxDetail('${card.cuenta.replace(/'/g,"\\'")}','${String(row).replace(/'/g,"\\'")}')"><div><div class="card-tx-desc">${em.e} ${escHtml(t[1]||'Sin descripción')} <span class="manual-tag">ajustado</span></div><div class="card-tx-meta">${escHtml(cleanName(t[2]))} · ${fmtDateLong(pf(t[0]))} · ciclo ${key}</div></div><div class="card-tx-amt">− ${fmt(t[4])}</div></div>`;
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
    return `<div class="card-tx-item" onclick="abrirCardTxDetail('${card.cuenta.replace(/'/g,"\\'")}','${String(row).replace(/'/g,"\\'")}')"><div><div class="card-tx-desc">${em.e} ${escHtml(t[1]||'Sin descripción')} ${override?'<span class="manual-tag">ajustado</span>':''}</div><div class="card-tx-meta">${escHtml(cleanName(t[2]))} · ${fmtDateLong(pf(t[0]))}</div></div><div class="card-tx-amt">− ${fmt(t[4])}</div></div>`;
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
  const head=`<div class="card-detail-head"><div class="card-detail-name">${escHtml(card.emoji)} ${escHtml(card.nombre)}</div><div class="card-detail-sub">${fmtDateShort(cycle.start)} – ${fmtDateShort(cycle.end)} · paga hasta ${fmtDateLong(cycle.pay)}</div></div>`;
  if(cardPageTab==='consumos'){
    cont.innerHTML=head+`<div class="card-tx-list card-detail-scroll"><div class="card-tx-title">Gastos del ciclo</div>${renderCardTxList(card,gastos,cycle)}</div>`; return;
  }
  if(cardPageTab==='stats'){
    const catRows=Object.entries(st.cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="credit-row"><span>${getEmoji(k).e} ${k}</span><span>${fmt(v)}</span></div>`).join('');
    cont.innerHTML=head+`<div class="card-stat-grid"><div class="card-stat"><div class="card-stat-lbl">Este ciclo</div><div class="card-stat-val">${fmt(total)}</div></div><div class="card-stat"><div class="card-stat-lbl">Ciclo anterior</div><div class="card-stat-val">${fmt(prev.total)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Variación</div><div class="card-stat-val ${deltaCls}">${deltaTxt}</div></div><div class="card-stat"><div class="card-stat-lbl">Consumos</div><div class="card-stat-val">${gastos.length}</div></div><div class="card-stat"><div class="card-stat-lbl">Promedio</div><div class="card-stat-val">${fmt(st.avg)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Mayor categoría</div><div class="card-stat-val">${topEmoji.e} ${escHtml(st.topCat)} · ${fmt(st.topCatVal)}</div></div><div class="card-stat full"><div class="card-stat-lbl">Mayor consumo</div><div class="card-stat-val">${st.maxTx?`${escHtml(st.maxTx[1])} · ${fmt(st.maxTx[4])}`:'—'}</div></div></div><div class="credit-card" style="cursor:default;margin-top:12px"><div class="card-tx-title">Categorías</div>${catRows||'<div class="empty" style="padding:16px">Sin datos</div>'}</div>`; return;
  }
  cont.innerHTML=head+`
    <div class="credit-pay-grid"><div class="credit-mini"><div class="credit-mini-lbl">Facturado</div><div class="credit-mini-val red">${fmt(total)}</div></div><div class="credit-mini"><div class="credit-mini-lbl">Pagado</div><div class="credit-mini-val green">${fmt(pagado)}</div></div><div class="credit-mini"><div class="credit-mini-lbl">Pendiente</div><div class="credit-mini-val ${pendiente>0?'red':'green'}">${fmt(pendiente)}</div></div><div class="credit-mini"><div class="credit-mini-lbl">Estado</div><div class="credit-mini-val"><span class="status-pill ${status.cls}">${status.text}</span></div></div></div>
    ${renderCreditLineBlock(card,pendiente)}
    <div class="bbar" style="margin-top:12px"><div class="bfill ${pct>=100?'ok':pct>0?'warn':'over'}" style="width:${pct}%"></div></div><div class="bpct">${pct.toFixed(0)}% pagado</div>
    ${renderPaymentForm(pendiente,card)}
    ${renderPaymentHistory(card,cycle)}`;
  actualizarPagoUSD();
}
