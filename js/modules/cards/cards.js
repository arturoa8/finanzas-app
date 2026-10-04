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

// Deuda y crédito en dólares, con el costo reconocido por los recibos. Se
// reutiliza el modelo de pagos USD para incluir también el arrastre legacy.
export function deudaTarjetaUSD(card){
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
  let total=0,reemb=0;
  data.gastos.forEach(t=>{if(t[9]==='USD')total+=Number(t[10])||0;});
  if(!(total>0))return null;
  const ids=new Set(data.gastos.filter(t=>t[9]==='USD').map(t=>String(t[6])));
  (datos.transacciones||[]).forEach(t=>{if(t[3]==='Reembolso'&&t[9]==='USD'&&sameAccount(t[5]||'',card.cuenta)&&ids.has(String(t[8])))reemb+=Number(t[10])||0;});
  const c=v=>Math.round(v*100)/100;
  // El mismo modelo reconoce también excedentes de pagos USD anteriores,
  // conservando el equivalente histórico guardado en cada recibo.
  const modelo=modeloCreditoTarjetaUSD(card),b=modelo.porCiclo.get(key);
  const cubierto=(b?.usdPagado||0)/100;
  return{total:c(total),pagado:c(Math.min(cubierto,total)),pendiente:c(Math.max(0,total-reemb-cubierto)),creditoAplicado:(b?.creditoAplicado||0)/100};
}

// Parte en dólares que sigue pendiente, por ciclo: los dólares y los soles
// con que cuenta en la línea usada (al TC de cada compra). Esa parte se paga
// en dólares: un pago en soles no la descuenta.
function pendienteUSDPorCiclo(card,hasta=null){
  const porCiclo=new Map();
  const sumar=(key,usd,pen)=>{const x=porCiclo.get(key)||{usd:0,pen:0};x.usd+=usd;x.pen+=pen;porCiclo.set(key,x);};
  for(const l of modeloCreditoTarjetaUSD(card,hasta).deuda)if(l.usd>0)sumar(l.ciclo,l.usd/100,l.pen/100);
  const c=v=>Math.round(Math.max(0,v)*100)/100;
  for(const x of porCiclo.values()){x.usd=c(x.usd);x.pen=x.usd?c(x.pen):0;}
  return porCiclo;
}

// Un ciclo separado por moneda: lo consumido, pagado y el saldo en soles y en
// dólares, más el total en soles (los dólares al TC de cada compra).
export function desgloseMonedasCiclo(card,data){
  const c=v=>Math.round((Number(v)||0)*100)/100;
  const enUSD=t=>t[9]==='USD'&&Number(t[10])>0;
  const pagosUSD=data.pagos.filter(p=>p.moneda==='USD'&&p.meta?.tipo!=='conversion');
  const porPago=modeloCreditoTarjetaUSD(card).porPago;
  const usd=usdCiclo(card,data);
  const soles={
    consumido:c(data.gastos.filter(t=>!enUSD(t)).reduce((s,t)=>s+Number(t[4]),0)),
    pagado:c(data.pagos.filter(p=>p.moneda!=='USD').reduce((s,p)=>s+p.amount,0)),
    aplicado:c(data.creditoAplicado),
    pendiente:pendienteEnSoles(card,data),
    favor:c(data.saldoFavor),
  };
  const dolares={
    consumido:c(data.gastos.filter(enUSD).reduce((s,t)=>s+Number(t[10]),0)),
    equivalente:c(data.gastos.filter(enUSD).reduce((s,t)=>s+Number(t[4]),0)),
    pagado:c(pagosUSD.reduce((s,p)=>s+p.usd,0)),
    costo:c(pagosUSD.reduce((s,p)=>s+(Number(p.soles)||0),0)),
    aplicado:c(data.creditoAplicadoUSD),
    pendiente:usd?.pendiente||0,
    // Excedente que dejaron los pagos en dólares de este ciclo.
    favor:c(pagosUSD.reduce((s,p)=>s+(porPago.get(p.id)?.creditoUSD||0),0)),
  };
  const hayUSD=dolares.consumido>0||dolares.pagado>0||dolares.aplicado>0;
  return{soles,dolares:hayUSD?dolares:null,total:c(data.total),reembolsos:c(data.reembolsos)};
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

function cardLedger(card,hasta=null,cicloVisible=null){
  // Separar las monedas evita que el excedente de un pago PEN cubra por
  // accidente el equivalente contable de una compra que sigue debiendo USD.
  // Se opera en céntimos para no producir deudas ni créditos microscópicos.
  const centimos=v=>Math.round((Number(v)||0)*100),buckets=new Map();
  const bucket=key=>{if(!buckets.has(key))buckets.set(key,{total:0,totalPEN:0,pagadoPEN:0,reembolsos:0,reembolsosPEN:0,creditoAplicado:0,saldoFavor:0});return buckets.get(key);};
  const expenses=(datos.transacciones||[]).filter(t=>isCardExpenseFor(card,t)&&(!hasta||pf(t[0])<=hasta));
  expenses.forEach(t=>{const b=bucket(cardTxCycleKey(card,t)),m=centimos(t[4]);b.total+=m;if(t[9]!=='USD')b.totalPEN+=m;});
  (datos.pagosTarjetas||[]).filter(p=>sameAccount(p[1],card.cuenta)&&!pagoEsUSD(p)&&(!hasta||pf(p[4])<=hasta)).forEach(p=>bucket(normCycleKey(p[2])).pagadoPEN+=centimos(pagoEnSoles(p)));
  (datos.transacciones||[]).filter(t=>t[3]==='Reembolso'&&sameAccount(t[5],card.cuenta)&&pf(t[0])<=(hasta||endOfDay(new Date()))).forEach(t=>{
    const original=expenses.find(g=>String(g[6])===String(t[8]));
    if(original){const b=bucket(cardTxCycleKey(card,original)),m=centimos(t[4]);b.reembolsos+=m;if(original[9]!=='USD')b.reembolsosPEN+=m;}
  });
  const usd=pendienteUSDPorCiclo(card,hasta);
  for(const key of usd.keys())bucket(key);
  // Incluir un ciclo vacío deja visible el saldo que viene del anterior.
  if(cicloVisible)bucket(cicloVisible);
  let favor=0;
  for(const key of [...buckets.keys()].sort()){
    const b=buckets.get(key),netPEN=b.totalPEN-b.reembolsosPEN-b.pagadoPEN;
    b.creditoAplicado=Math.min(favor,Math.max(0,netPEN));
    favor-=b.creditoAplicado;
    favor+=Math.max(0,-netPEN);
    b.saldoFavor=favor;
    const pendienteUSD=centimos(usd.get(key)?.pen);
    const pagadoUSD=b.total-b.totalPEN-(b.reembolsos-b.reembolsosPEN)-pendienteUSD;
    b.pagadoDirectoPEN=Math.max(0,Math.min(b.pagadoPEN,Math.max(0,b.totalPEN-b.reembolsosPEN)));
    b.pagado=Math.min(b.total,b.pagadoDirectoPEN+b.creditoAplicado+Math.max(0,pagadoUSD));
    b.pendiente=Math.max(0,netPEN-b.creditoAplicado)+pendienteUSD;
  }
  const pendiente=[...buckets.values()].reduce((sum,b)=>sum+b.pendiente,0);
  for(const b of buckets.values())for(const campo of Object.keys(b))b[campo]/=100;
  return{buckets,saldoFavor:favor/100,pendiente:pendiente/100};
}

export function getCardOutstandingTotal(card,hasta=null){return cardLedger(card,hasta).pendiente;}

export function favorTarjetaEnSoles(card,hasta=null){
  const costoUSD=modeloCreditoTarjetaUSD(card,hasta).costoFavor;
  return Math.round((cardLedger(card,hasta).saldoFavor+costoUSD)*100)/100;
}

export function getCardData(card,offset=cardCycleOffset){
  const cycle=getCardCycle(card,offset),key=getCycleKey(cycle);
  const gastos=datos.transacciones.filter(t=>isCardExpenseFor(card,t)&&txBelongsToCycle(card,t,cycle)).sort((a,b)=>pf(b[0])-pf(a[0]));
  const ledger=cardLedger(card,null,key),b=ledger.buckets.get(key);
  const {total,reembolsos,creditoAplicado,pendiente,pagado,pagadoDirectoPEN,saldoFavor}=b;
  const status=getPaymentStatus(total,total-pendiente,cycle.pay);
  if(total>0&&pendiente===0&&(reembolsos>0||creditoAplicado>0)){status.text='Cubierto';status.detail='Incluye devoluciones o saldo a favor';}
  // Deuda y pagos conservan las aplicaciones del modelo bancario completo.
  // El favor USD es la foto por fecha al terminar el ciclo; filtrar pagos
  // por su ciclo asignado puede excluir el origen de una conversión válida.
  const usd=modeloCreditoTarjetaUSD(card,cycle.end),creditoAplicadoUSD=(modeloCreditoTarjetaUSD(card).porCiclo.get(key)?.creditoAplicado||0)/100;
  if(total===0&&(saldoFavor>0||usd.saldoFavor>0)){status.text='A favor';status.detail='Disponible para próximos consumos';status.cls='status-ok';}
  return{cycle,gastos,total,pagado,pagadoDirectoPEN,pendiente,status,reembolsos,creditoAplicado,creditoAplicadoUSD,saldoFavor,saldoFavorTotal:ledger.saldoFavor,saldoFavorUSD:usd.saldoFavor,costoFavorUSD:usd.costoFavor,pagos:getCardPaymentRecords(card,cycle)};
}

export function getSelectedCardAndData(){const card=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,selectedCardCuenta));return card?{card,data:getCardData(card,cardCycleOffset)}:null;}
