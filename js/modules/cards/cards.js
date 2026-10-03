// Datos derivados de tarjeta: consumo, deuda y saldo.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {selectedCardCuenta} from './cards-ui.js';
import {CREDIT_CARDS} from './config.js';
import {cardCycleOffset, cardTxCycleKey, getCardCycle, getCycleKey, isCardExpenseFor, normCycleKey, txBelongsToCycle} from './cycles.js';
import {getCardPaymentRecords, getPaymentStatus, pagoEnSoles, pagoEsUSD} from './payments.js';
import {calcularCreditoUSD, notaCreditoUSD} from './usd-credit.js';
import {sameAccount} from '../transactions.js';
import {datos} from '../../state.js';
import {endOfDay, pf} from '../../utils/dates.js';
import {cleanName, fmt, fmtN} from '../../utils/formatters.js';

// Deuda en dólares de una tarjeta y los soles ya reconocidos por ella. Es la
// misma cuenta que hace pagar_tarjeta_usd() en el servidor, para que lo que se
// previsualiza coincida con lo que se guarda.
export function deudaTarjetaUSD(card){
  if(!tarjetaConCreditoUSD(card))return{...deudaTarjetaUSDAnterior(card),saldoFavor:0,costoFavor:0};
  const modelo=modeloCreditoTarjetaUSD(card);
  return{usd:modelo.usd,pen:modelo.pen,saldoFavor:modelo.saldoFavor,costoFavor:modelo.costoFavor};
}

export function modeloCreditoTarjetaUSD(card,hasta=null){
  const gastos=(datos.transacciones||[]).filter(t=>sameAccount(t[5]||'',card.cuenta)&&t[9]==='USD'&&(!hasta||pf(t[0])<=hasta))
    .map(t=>({id:String(t[6]),fecha:t[0],tipo:t[3],usd:Number(t[10]),pen:Number(t[4]),origen:String(t[8]||''),ciclo:cardTxCycleKey(card,t)}));
  const pagos=(datos.pagosTarjetas||[]).filter(p=>sameAccount(p[1],card.cuenta)&&(!hasta||pf(p[4])<=hasta))
    .map(p=>({id:String(p[0]),fecha:p[4],moneda:p[7]||'PEN',usd:Number(p[3]),costo:Number(p[8]),reconocido:Number(p[10]),ciclo:normCycleKey(p[2]),meta:notaCreditoUSD(p)}));
  return calcularCreditoUSD(gastos,pagos);
}

export function tarjetaConCreditoUSD(card){return (datos.pagosTarjetas||[]).some(p=>sameAccount(p[1],card.cuenta)&&notaCreditoUSD(p));}

// Saldo reconocido legacy, útil para la previsualización de pagos existentes.
function deudaTarjetaUSDAnterior(card){
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
  const aplicado=Math.min(usd,d.usd);
  return Math.abs(aplicado-d.usd)<0.005?d.pen:Math.round(aplicado*d.pen/d.usd*100)/100;
}

export function cardStats(gastos,total){
  const cats={}; let maxTx=null;
  gastos.forEach(t=>{const m=parseFloat(t[4])||0;const c=cleanName(t[2]);cats[c]=(cats[c]||0)+m;if(!maxTx||m>(parseFloat(maxTx[4])||0))maxTx=t;});
  const top=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
  return{topCat:top?top[0]:'—',topCatVal:top?top[1]:0,avg:gastos.length?total/gastos.length:0,maxTx,cats};
}

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
  if(tarjetaConCreditoUSD(card)){
    const modelo=modeloCreditoTarjetaUSD(card),b=modelo.porCiclo.get(key);
    const cubierto=(b?.usdPagado||0)/100;
    return{total:c(total),pagado:c(Math.min(cubierto,total)),pendiente:c(Math.max(0,total-reemb-cubierto)),creditoAplicado:(b?.creditoAplicado||0)/100};
  }
  return{total:c(total),pagado:c(Math.min(pagado,total)),pendiente:c(Math.max(0,total-reemb-pagado))};
}

// Parte en dólares que sigue pendiente, por ciclo: los dólares y los soles
// con que cuenta en la línea usada (al TC de cada compra). Esa parte se paga
// en dólares: un pago en soles no la descuenta.
function pendienteUSDPorCiclo(card){
  const porCiclo=new Map();
  const sumar=(key,usd,pen)=>{const x=porCiclo.get(key)||{usd:0,pen:0};x.usd+=usd;x.pen+=pen;porCiclo.set(key,x);};
  if(tarjetaConCreditoUSD(card)){
    for(const l of modeloCreditoTarjetaUSD(card).deuda)if(l.usd>0)sumar(l.ciclo,l.usd/100,l.pen/100);
  }else{
    const gastos=(datos.transacciones||[]).filter(t=>isCardExpenseFor(card,t)&&t[9]==='USD');
    gastos.forEach(t=>sumar(cardTxCycleKey(card,t),Number(t[10])||0,Number(t[4])||0));
    (datos.transacciones||[]).forEach(t=>{
      if(t[3]!=='Reembolso'||t[9]!=='USD'||!sameAccount(t[5]||'',card.cuenta))return;
      const original=gastos.find(g=>String(g[6])===String(t[8]));
      if(original)sumar(cardTxCycleKey(card,original),-(Number(t[10])||0),-(Number(t[4])||0));
    });
    (datos.pagosTarjetas||[]).forEach(p=>{if(sameAccount(p[1],card.cuenta)&&pagoEsUSD(p))sumar(normCycleKey(p[2]),-(Number(p[3])||0),-pagoEnSoles(p));});
  }
  const c=v=>Math.round(Math.max(0,v)*100)/100;
  for(const x of porCiclo.values()){x.usd=c(x.usd);x.pen=x.usd?c(x.pen):0;}
  return porCiclo;
}

export function pendienteUSDEnSoles(card,data){return pendienteUSDPorCiclo(card).get(getCycleKey(data.cycle))?.pen||0;}

// Lo que se paga en soles de un ciclo: el pendiente sin su parte en dólares.
export function pendienteEnSoles(card,data){return Math.max(0,Math.round((data.pendiente-pendienteUSDEnSoles(card,data))*100)/100);}

const sumarMonedas=(a,b)=>({soles:Math.round((a.soles+b.soles)*100)/100,usd:Math.round((a.usd+b.usd)*100)/100});

// Lo que se debe de un ciclo en todas las tarjetas, separado por moneda: en
// soles lo consumido en soles y en dólares lo consumido en dólares.
export function deudaCicloPorMoneda(offset){
  return CREDIT_CARDS.reduce((s,card)=>{
    const data=getCardData(card,offset),usd=pendienteUSDPorCiclo(card).get(getCycleKey(data.cycle));
    return sumarMonedas(s,{soles:Math.max(0,data.pendiente-(usd?.pen||0)),usd:usd?.usd||0});
  },{soles:0,usd:0});
}

// Desglose de la línea total usada por ciclo (respecto del ciclo en curso),
// separado por moneda. Anteriores y más adelante suelen estar en cero.
export function desgloseLineaPorMoneda(){
  const cero={soles:0,usd:0},d={anteriores:cero,actual:cero,siguiente:cero,despues:cero};
  for(const card of CREDIT_CARDS){
    const actual=getCycleKey(getCardCycle(card,0)),siguiente=getCycleKey(getCardCycle(card,1));
    const usd=pendienteUSDPorCiclo(card),{buckets}=cardLedger(card);
    for(const key of new Set([...buckets.keys(),...usd.keys()])){
      const u=usd.get(key)||{usd:0,pen:0},b=buckets.get(key);
      const parte={soles:Math.max(0,(b?.pendiente||0)-u.pen),usd:u.usd};
      const grupo=key<actual?'anteriores':key===actual?'actual':key===siguiente?'siguiente':'despues';
      d[grupo]=sumarMonedas(d[grupo],parte);
    }
  }
  return d;
}

// "S/ 658.96 · US$ 39.15": cada moneda solo si tiene saldo.
export function fmtMonedas({soles,usd}){
  const partes=[];if(soles>0||!(usd>0))partes.push(fmt(soles));if(usd>0)partes.push('US$ '+fmtN(usd));
  return partes.join(' · ');
}

// Con prefijo 'incl. ' indica que el importe en soles ya contiene esos dólares.
export function chipUSD(usd,prefijo=''){return usd>0?` <small style="color:var(--dim)">· ${prefijo}US$ ${fmtN(usd)}</small>`:'';}

function cardLedger(card,hasta=null){
  const buckets=new Map();
  const bucket=key=>{if(!buckets.has(key))buckets.set(key,{total:0,pagado:0,reembolsos:0,creditoAplicado:0});return buckets.get(key);};
  const expenses=datos.transacciones.filter(t=>isCardExpenseFor(card,t)&&(!hasta||pf(t[0])<=hasta));
  expenses.forEach(t=>bucket(cardTxCycleKey(card,t)).total+=Number(t[4]));
  const conCredito=tarjetaConCreditoUSD(card);
  (datos.pagosTarjetas||[]).filter(p=>sameAccount(p[1],card.cuenta)&&(!hasta||pf(p[4])<=hasta)&&(!conCredito||!pagoEsUSD(p))).forEach(p=>bucket(normCycleKey(p[2])).pagado+=pagoEnSoles(p));
  datos.transacciones.filter(t=>t[3]==='Reembolso'&&sameAccount(t[5],card.cuenta)&&pf(t[0])<=(hasta||endOfDay(new Date()))).forEach(t=>{
    const original=expenses.find(g=>String(g[6])===String(t[8]));
    if(original)bucket(cardTxCycleKey(card,original)).reembolsos+=Number(t[4]);
  });
  if(conCredito){
    // La deuda USD se calcula en su propia moneda. Solo la conversión
    // explícita del banco puede crear crédito PEN para consumos en soles.
    const cubiertoUSD=new Map();
    for(const t of expenses.filter(t=>t[9]==='USD')){const key=cardTxCycleKey(card,t);cubiertoUSD.set(key,(cubiertoUSD.get(key)||0)+Number(t[4]));}
    for(const t of datos.transacciones.filter(t=>t[3]==='Reembolso'&&t[9]==='USD'&&sameAccount(t[5],card.cuenta)&&pf(t[0])<=(hasta||endOfDay(new Date())))){
      const original=expenses.find(g=>String(g[6])===String(t[8]));if(original){const key=cardTxCycleKey(card,original);cubiertoUSD.set(key,(cubiertoUSD.get(key)||0)-Number(t[4]));}
    }
    for(const lote of modeloCreditoTarjetaUSD(card,hasta).deuda)cubiertoUSD.set(lote.ciclo,(cubiertoUSD.get(lote.ciclo)||0)-lote.pen/100);
    for(const [key,monto] of cubiertoUSD)bucket(key).pagado+=monto;
  }
  // Los importes son decimales binarios: 89.90+3.50+19.90 da 113.30000000000001
  // y contra 113.30 pagados deja una "deuda" de 1e-14 que marca Vencido. Todo el
  // cálculo se hace con los acumulados ya redondeados a céntimos.
  const cts=v=>Math.round(v*100)/100;
  for(const b of buckets.values()){b.total=cts(b.total);b.pagado=cts(b.pagado);b.reembolsos=cts(b.reembolsos);}
  let favor=0;
  for(const b of buckets.values()){const net=cts(b.total-b.pagado-b.reembolsos);b.pendiente=Math.max(0,net);favor+=Math.max(0,-net);}
  for(const key of [...buckets.keys()].sort()){const b=buckets.get(key);b.creditoAplicado=Math.min(favor,b.pendiente);b.pendiente-=b.creditoAplicado;favor-=b.creditoAplicado;}
  // A céntimos: sin esto, un residuo de 1e-13 hace que un ciclo parezca tener
  // saldo a favor o crédito aplicado y muestre un recuadro de puros ceros.
  const c2=v=>Math.round(v*100)/100;
  for(const b of buckets.values()){b.pendiente=c2(b.pendiente);b.creditoAplicado=c2(b.creditoAplicado);}
  return {buckets,saldoFavor:c2(favor),pendiente:c2([...buckets.values()].reduce((sum,b)=>sum+b.pendiente,0))};
}

export function getCardOutstandingTotal(card,hasta=null){return cardLedger(card,hasta).pendiente;}

export function favorTarjetaEnSoles(card,hasta=null){
  if(!tarjetaConCreditoUSD(card))return 0;
  return Math.round((cardLedger(card,hasta).saldoFavor+modeloCreditoTarjetaUSD(card,hasta).costoFavor)*100)/100;
}

export function getCardData(card,offset=cardCycleOffset){
  const cycle=getCardCycle(card,offset),key=getCycleKey(cycle);
  const gastos=datos.transacciones.filter(t=>isCardExpenseFor(card,t)&&txBelongsToCycle(card,t,cycle)).sort((a,b)=>pf(b[0])-pf(a[0]));
  const ledger=cardLedger(card),b=ledger.buckets.get(key)||{total:0,pagado:0,reembolsos:0,creditoAplicado:0,pendiente:0};
  const {total,reembolsos,creditoAplicado,pendiente}=b,pagado=Math.max(0,Math.min(b.pagado,total));
  const status=getPaymentStatus(total,total-pendiente,cycle.pay);
  if(total>0&&pendiente===0&&(reembolsos>0||creditoAplicado>0)){status.text='Cubierto';status.detail='Incluye devoluciones o saldo a favor';}
  const usd=deudaTarjetaUSD(card);
  return{cycle,gastos,total,pagado,pendiente,status,reembolsos,creditoAplicado,saldoFavor:ledger.saldoFavor,saldoFavorUSD:usd.saldoFavor,costoFavorUSD:usd.costoFavor,pagos:getCardPaymentRecords(card,cycle)};
}

export function getSelectedCardAndData(){const card=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,selectedCardCuenta));return card?{card,data:getCardData(card,cardCycleOffset)}:null;}
