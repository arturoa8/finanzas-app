// Resumen de obligaciones actuales. No usa el calendario ni el ciclo elegido
// en otras pantallas, y no hace consultas adicionales a la base o al mercado.
import {fmtMonedas, getCardPendingByCycle} from './cards/cards.js';
import {CREDIT_CARDS} from './cards/config.js';
import {getCardCycle} from './cards/cycles.js';
import {datos} from '../state.js';
import {endOfDay, fmtDateLong, getDaysDiff, parseDateOnly} from '../utils/dates.js';
import {escHtml, fmt} from '../utils/formatters.js';

const centimosResumenInicio=n=>Math.round((Number(n)||0)*100);

export function obtenerResumenInicio(ahora=new Date()){
  if(!(datos.cargados||datos.categoriasCargadas)||!['transacciones','pagosTarjetas','configTarjetas','deudas','deudasAbonos'].every(k=>Array.isArray(datos[k])))return {cargado:false};
  const hasta=endOfDay(ahora),referencia=new Date(),totales={soles:0,usd:0},pagos=[];let tarjetasConSaldo=0;
  for(const card of CREDIT_CARDS){
    const pendientes=getCardPendingByCycle(card,hasta);
    if(pendientes.size)tarjetasConSaldo++;
    for(const [key,saldo] of pendientes){
      totales.soles+=centimosResumenInicio(saldo.soles);totales.usd+=centimosResumenInicio(saldo.usd);
      const cierre=parseDateOnly(key);if(!cierre)continue;
      const offset=(cierre.getFullYear()-referencia.getFullYear())*12+cierre.getMonth()-referencia.getMonth();
      const vencimiento=getCardCycle(card,offset).pay;
      pagos.push({tarjeta:card.nombre,vencimiento,dias:getDaysDiff(ahora,vencimiento),...saldo});
    }
  }
  totales.soles/=100;totales.usd/=100;
  pagos.sort((a,b)=>a.vencimiento-b.vencimiento||a.tarjeta.localeCompare(b.tarjeta,'es'));
  const abonos=new Map();
  for(const ab of datos.deudasAbonos||[]){
    // El registro de abonos es la fuente de verdad; d[4] no se vuelve a sumar.
    const id=String(ab[1]||''),m=parseFloat(String(ab[2]||'').replace(/[^0-9.\-]/g,''));
    if(Number.isFinite(m)&&m>0)abonos.set(id,(abonos.get(id)||0)+centimosResumenInicio(m));
  }
  const deudas={pagar:{total:0,cantidad:0},cobrar:{total:0,cantidad:0}};
  for(const d of datos.deudas||[]){
    const tipo=String(d[7]||'').toLowerCase(),grupo=tipo==='les-debo'?deudas.pagar:tipo==='me-deben'?deudas.cobrar:null;
    if(!grupo)continue;
    const pendiente=Math.max(0,centimosResumenInicio(d[3])-(abonos.get(String(d[0]))||0));
    if(pendiente>0){grupo.total+=pendiente;grupo.cantidad++;}
  }
  for(const grupo of Object.values(deudas))grupo.total/=100;
  return {cargado:true,totales,tarjetasConSaldo,proximoPago:pagos[0]||null,deudas};
}

function renderHomeHighlight({icono,titulo,valor,nota,pagina,clase='',accion=''}){
  return `<button type="button" class="home-highlight" onclick="${accion||`setPg('${pagina}')`}"><span class="home-highlight-top"><span class="home-highlight-icon" aria-hidden="true">${icono}</span><span class="home-highlight-label">${titulo}</span><span aria-hidden="true">↗</span></span><strong class="home-highlight-value ${clase}">${escHtml(valor)}</strong><span class="home-highlight-note">${escHtml(nota)}</span></button>`;
}

export function renderHomeSummary(){
  if(document.querySelector('.page.active')?.id!=='p-dash'||!document.getElementById('homeSummary')?.classList.contains('expanded'))return;
  const el=document.getElementById('homeHighlights');if(!el)return;
  const resumen=obtenerResumenInicio();
  if(!resumen.cargado){el.innerHTML='<p class="home-highlight-note" role="status">Cargando tus pendientes…</p>';return;}
  const hayTarjetas=resumen.tarjetasConSaldo>0,filas=[renderHomeHighlight({icono:'💳',titulo:'Tarjetas pendientes',
    valor:hayTarjetas?fmtMonedas(resumen.totales):'Al día',nota:hayTarjetas?'Saldos a hoy · cada moneda por separado':'No tienes consumos pendientes a hoy',pagina:'card',clase:hayTarjetas?'out':''})];
  const pago=resumen.proximoPago;
  if(pago)filas.push(renderHomeHighlight({icono:'◷',titulo:pago.dias<0?'Pago vencido':pago.dias===0?'Pago de hoy':'Próximo pago',valor:fmtMonedas(pago),
    nota:pago.tarjeta+' · '+(pago.dias<0?'Venció el ':pago.dias===0?'Vence hoy, ':'Pagar hasta el ')+fmtDateLong(pago.vencimiento),pagina:'card',clase:pago.dias<0?'out':''}));
  for(const [key,titulo,icono,clase] of [['pagar','Por pagar','↗','out'],['cobrar','Por cobrar','↙','in']]){
    const deuda=resumen.deudas[key];if(deuda.total<=0)continue;
    const tipo=key==='pagar'?'les-debo':'me-deben',boton=key==='pagar'?'dtLesDebo':'dtMeDeben';
    filas.push(renderHomeHighlight({icono,titulo,valor:fmt(deuda.total),nota:deuda.cantidad+' deuda'+(deuda.cantidad===1?'':'s')+' pendiente'+(deuda.cantidad===1?'':'s')+' · abonos descontados',pagina:'deb',clase,
      accion:`setPg('deb');setDT('${tipo}',document.getElementById('${boton}'))`}));
  }
  el.innerHTML=filas.join('');
}
