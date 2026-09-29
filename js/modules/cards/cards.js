// Datos derivados de tarjeta: consumo, deuda y saldo.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {selectedCardCuenta} from './cards-ui.js';
import {CREDIT_CARDS} from './config.js';
import {cardCycleOffset, cardTxCycleKey, getCardCycle, getCycleKey, isCardExpenseFor, normCycleKey, txBelongsToCycle} from './cycles.js';
import {getCardPaymentRecords, getPaymentStatus, pagoEnSoles, pagoEsUSD} from './payments.js';
import {sameAccount} from '../transactions.js';
import {tcMercado} from '../../services/exchange-rate.js';
import {datos} from '../../state.js';
import {endOfDay, pf} from '../../utils/dates.js';
import {cleanName, fmt, fmtN} from '../../utils/formatters.js';

// Deuda en dólares de una tarjeta y los soles ya reconocidos por ella. Es la
// misma cuenta que hace pagar_tarjeta_usd() en el servidor, para que lo que se
// previsualiza coincida con lo que se guarda.
export function deudaTarjetaUSD(card){
  let usd=0,pen=0;
  (datos.transacciones||[]).forEach(t=>{
    if(!sameAccount(t[5]||'',card.cuenta)||t[9]!=='USD')return;
    const o=Number(t[10])||0,m=Number(t[4])||0;
    if(t[3]==='Gasto'){usd+=o;pen+=m;}else if(t[3]==='Reembolso'){usd-=o;pen-=m;}
  });
  (datos.pagosTarjetas||[]).forEach(p=>{
    if(sameAccount(p[1],card.cuenta)&&pagoEsUSD(p)){usd-=Number(p[3])||0;pen-=Number(p[10])||0;}
  });
  usd=Math.round(usd*100)/100;pen=Math.round(pen*100)/100;
  return{usd:usd>0.004?usd:0,pen:usd>0.004?pen:0};
}

export function deudaUSDTotal(){return CREDIT_CARDS.reduce((s,c)=>s+deudaTarjetaUSD(c).usd,0);}

// Soles que ya estaban reconocidos por `usd` dólares de la deuda de una tarjeta.
// Al saldar todo se toma el resto exacto, igual que el servidor.
export function equivalenteReconocido(card,usd){
  const d=deudaTarjetaUSD(card);
  if(!(d.usd>0)||!(usd>0))return null;
  return Math.abs(usd-d.usd)<0.005?d.pen:Math.round(usd*d.pen/d.usd*100)/100;
}

export function cardStats(gastos,total){
  const cats={}; let maxTx=null;
  gastos.forEach(t=>{const m=parseFloat(t[4])||0;const c=cleanName(t[2]);cats[c]=(cats[c]||0)+m;if(!maxTx||m>(parseFloat(maxTx[4])||0))maxTx=t;});
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
  return{topCat:top?top[0]:'—',topCatVal:top?top[1]:0,avg:gastos.length?total/gastos.length:0,maxTx,cats};
}

// Deuda en dólares. Se muestra en dólares; el equivalente en soles de hoy es solo
// una referencia con el tipo de cambio de mercado y no se suma a nada.
export function refSolesHoy(usd){return tcMercado>0?' <small style="color:var(--dim)">≈ '+fmt(usd*tcMercado)+' hoy</small>':'';}

// Dólares de UN ciclo: consumos menos devoluciones y pagos en dólares de ese
// ciclo. Se muestran junto al importe en soles, sin fila aparte. Devuelve null
// si el ciclo no tiene consumos en dólares.
export function usdCiclo(card,data){
  const key=getCycleKey(data.cycle);
  let total=0,reemb=0,pagado=0;
  data.gastos.forEach(t=>{if(t[9]==='USD')total+=Number(t[10])||0;});
  if(!(total>0))return null;
  const ids=new Set(data.gastos.filter(t=>t[9]==='USD').map(t=>String(t[6])));
  (datos.transacciones||[]).forEach(t=>{if(t[3]==='Reembolso'&&t[9]==='USD'&&sameAccount(t[5]||'',card.cuenta)&&ids.has(String(t[8])))reemb+=Number(t[10])||0;});
  (datos.pagosTarjetas||[]).forEach(p=>{if(sameAccount(p[1],card.cuenta)&&pagoEsUSD(p)&&normCycleKey(p[2])===key)pagado+=Number(p[3])||0;});
  const c=v=>Math.round(v*100)/100;
  return{total:c(total),pagado:c(Math.min(pagado,total)),pendiente:c(Math.max(0,total-reemb-pagado))};
}

export function chipUSD(usd){return usd>0?` <small style="color:var(--dim)">· US$ ${fmtN(usd)}</small>`:'';}

function cardLedger(card,hasta=null){
  const buckets=new Map();
  const bucket=key=>{if(!buckets.has(key))buckets.set(key,{total:0,pagado:0,reembolsos:0,creditoAplicado:0});return buckets.get(key);};
  const expenses=datos.transacciones.filter(t=>isCardExpenseFor(card,t)&&(!hasta||pf(t[0])<=hasta));
  expenses.forEach(t=>bucket(cardTxCycleKey(card,t)).total+=Number(t[4]));
  (datos.pagosTarjetas||[]).filter(p=>sameAccount(p[1],card.cuenta)&&(!hasta||pf(p[4])<=hasta)).forEach(p=>bucket(normCycleKey(p[2])).pagado+=pagoEnSoles(p));
  datos.transacciones.filter(t=>t[3]==='Reembolso'&&sameAccount(t[5],card.cuenta)&&pf(t[0])<=(hasta||endOfDay(new Date()))).forEach(t=>{
    const original=expenses.find(g=>String(g[6])===String(t[8]));
    if(original)bucket(cardTxCycleKey(card,original)).reembolsos+=Number(t[4]);
  });
  let favor=0;
  for(const b of buckets.values()){const net=b.total-b.pagado-b.reembolsos;b.pendiente=Math.max(0,net);favor+=Math.max(0,-net);}
  for(const key of [...buckets.keys()].sort()){const b=buckets.get(key);b.creditoAplicado=Math.min(favor,b.pendiente);b.pendiente-=b.creditoAplicado;favor-=b.creditoAplicado;}
  // A céntimos: sin esto, un residuo de 1e-13 hace que un ciclo parezca tener
  // saldo a favor o crédito aplicado y muestre un recuadro de puros ceros.
  const c2=v=>Math.round(v*100)/100;
  for(const b of buckets.values()){b.pendiente=c2(b.pendiente);b.creditoAplicado=c2(b.creditoAplicado);}
  return {buckets,saldoFavor:c2(favor),pendiente:c2([...buckets.values()].reduce((sum,b)=>sum+b.pendiente,0))};
}

export function getCardOutstandingTotal(card,hasta=null){return cardLedger(card,hasta).pendiente;}

export function getCardData(card,offset=cardCycleOffset){
  const cycle=getCardCycle(card,offset),key=getCycleKey(cycle);
  const gastos=datos.transacciones.filter(t=>isCardExpenseFor(card,t)&&txBelongsToCycle(card,t,cycle)).sort((a,b)=>pf(b[0])-pf(a[0]));
  const ledger=cardLedger(card),b=ledger.buckets.get(key)||{total:0,pagado:0,reembolsos:0,creditoAplicado:0,pendiente:0};
  const {total,reembolsos,creditoAplicado,pendiente}=b,pagado=Math.min(b.pagado,total);
  const status=getPaymentStatus(total,total-pendiente,cycle.pay);
  if(total>0&&pendiente===0&&(reembolsos>0||creditoAplicado>0)){status.text='Cubierto';status.detail='Incluye devoluciones o saldo a favor';}
  return{cycle,gastos,total,pagado,pendiente,status,reembolsos,creditoAplicado,saldoFavor:ledger.saldoFavor,pagos:getCardPaymentRecords(card,cycle)};
}

export function getSelectedCardAndData(){const card=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,selectedCardCuenta));return card?{card,data:getCardData(card,cardCycleOffset)}:null;}
