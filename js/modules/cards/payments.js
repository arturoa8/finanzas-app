// Pagos de tarjeta, en soles y en dolares.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentasApp} from '../accounts.js';
import {renderCardDetail, renderCardsPage} from './cards-ui.js';
import {deudaTarjetaUSD, equivalenteReconocido, getSelectedCardAndData} from './cards.js';
import {getCycleKey, normCycleKey} from './cycles.js';
import {costoPromedioUSD, elv, getCuentaBalanceMoneda, monedaCuenta} from '../currencies.js';
import {renderBal} from '../dashboard.js';
import {cargar, sameAccount} from '../transactions.js';
import {tcMercado} from '../../services/exchange-rate.js';
import {sbDelete, sbFetch, sbInsert, sbUpdate} from '../../services/supabase.js';
import {datos} from '../../state.js';
import {toast} from '../../ui/toast.js';
import {guardedOnce} from '../../utils/async.js';
import {formatISODate, getDaysDiff, hoyISO} from '../../utils/dates.js';
import {escAttr, escHtml, fmt, fmtN, norm} from '../../utils/formatters.js';

// Pagos de tarjeta en dólares (ver filaPago): posición 7 = moneda del pago.
export function pagoEsUSD(p){return p[7]==='USD';}

// Soles que un pago descuenta de la deuda en soles de su ciclo.
export function pagoEnSoles(p){return pagoEsUSD(p)?(Number(p[10])||0):(Number(p[3])||0);}

// Soles que un pago saca de la cuenta de origen.
export function pagoSalidaSoles(p){return pagoEsUSD(p)?(Number(p[8])||0):(Number(p[3])||0);}

// ── Pagos de tarjeta en dólares ────────────────────────────────────────────
// Posiciones 0-6 no se mueven. Un pago en soles deja 7 en 'PEN' y el resto en
// null. En un pago en USD: 3 son los dólares, 8 los soles que costó, 9 el TC
// real, 10 los soles que ya se habían reconocido como gasto por esos dólares.
export function filaPago(p){
  return [p.id,p.tarjeta,p.ciclo_key,p.monto,p.fecha,p.nota,p.cuenta_origen,
    p.moneda||'PEN',p.monto_origen!=null?Number(p.monto_origen):null,p.tc!=null?Number(p.tc):null,
    p.equivalente!=null?Number(p.equivalente):null,p.ajuste_id||null,p.tc_fuente||null];
}

export function getCardPaymentRecords(card,cycle){
  const key=getCycleKey(cycle);
  return (datos.pagosTarjetas||[])
    .filter(r=>norm(String(r[1]))===norm(card.cuenta)&&normCycleKey(r[2])===key)
    .map(r=>({id:String(r[0]),amount:Math.max(0,pagoEnSoles(r)),date:normCycleKey(r[4]),note:String(r[5]||''),cuentaOrigen:r[6]||null,moneda:r[7]||'PEN',usd:Number(r[3])||0,soles:r[8],tc:r[9]}));
}

function getCardPayment(card,cycle){return getCardPaymentRecords(card,cycle).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);}

// Cuenta de la que normalmente sale el pago de cada tarjeta (editable por pago).
function defaultCuentaOrigen(card){
  if(sameAccount(card.cuenta,'Visa iO'))return 'Yape';
  return 'Plin';
}

async function addCardPaymentRecord(card,cycle,amount,date,note,cuentaOrigen){
  const n=Math.max(0,parseFloat(amount)||0); if(!n)return false;
  const key=getCycleKey(cycle);
  const row=await sbInsert('pagos_tarjetas',{tarjeta:card.cuenta,ciclo_key:key,monto:n,fecha:date||hoyISO(),nota:note||null,cuenta_origen:cuentaOrigen||defaultCuentaOrigen(card)});
  datos.pagosTarjetas.push([row.id,row.tarjeta,row.ciclo_key,row.monto,row.fecha,row.nota,row.cuenta_origen]);
  return true;
}

async function updateCardPaymentRecord(card,cycle,id,amount,date,note){
  const n=Math.max(0,parseFloat(amount)||0);
  await sbUpdate('pagos_tarjetas',id,{monto:n,fecha:date||hoyISO(),nota:note||null});
  const row=datos.pagosTarjetas.find(r=>String(r[0])===String(id));
  if(row){row[3]=n;row[4]=date||row[4];row[5]=note||'';}
}

async function deleteCardPaymentRecord(card,cycle,id){
  const fila=datos.pagosTarjetas.find(r=>String(r[0])===String(id));
  if(fila&&pagoEsUSD(fila)){
    await sbFetch('rpc/eliminar_pago_tarjeta_usd',{method:'POST',body:JSON.stringify({p_id:id})});
    await cargar();
    return;
  }
  await sbDelete('pagos_tarjetas',id);
  datos.pagosTarjetas=datos.pagosTarjetas.filter(r=>String(r[0])!==String(id));
}

export function getPaymentStatus(total,pagado,payDate){
  const pendiente=Math.max(Math.round((total-pagado)*100)/100,0);const days=getDaysDiff(new Date(),payDate);
  if(total<=0)return{text:'Sin pagar',detail:'Sin consumos',cls:'status-ok'};
  if(pendiente<=0)return{text:'Pagado',detail:'Saldo cubierto',cls:'status-ok'};
  if(days<0)return{text:'Vencido',detail:`Venció hace ${Math.abs(days)} día${Math.abs(days)===1?'':'s'}`,cls:'status-bad'};
  if(pagado>0)return{text:'Pago parcial',detail:`Pendiente ${fmt(pendiente)}`,cls:days<=3?'status-warn':'status-ok'};
  if(days<=3)return{text:'Vence pronto',detail:`Faltan ${days} día${days===1?'':'s'}`,cls:'status-warn'};
  return{text:'Sin pagar',detail:`Faltan ${days} día${days===1?'':'s'}`,cls:'status-bad'};
}

async function guardarPagoTarjeta__base(){
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  const amount=document.getElementById('cardPayAmount')?.value;
  const date=document.getElementById('cardPayDate')?.value||hoyISO();
  const note=document.getElementById('cardPayNote')?.value||'';
  const cuenta=document.getElementById('cardPayCuenta')?.value||defaultCuentaOrigen(ctx.card);
  if(!await addCardPaymentRecord(ctx.card,ctx.data.cycle,amount,date,note,cuenta)){toast('Ingresa un monto válido','error');return;}
  renderBal(); renderCardsPage(); renderCardDetail(); toast('Pago agregado','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarPagoTarjeta=guardedOnce(guardarPagoTarjeta__base);

async function pagarSaldoCompleto__base(){
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  if(ctx.data.pendiente<=0){toast('No hay saldo pendiente','success');return;}
  const cuenta=document.getElementById('cardPayCuenta')?.value||defaultCuentaOrigen(ctx.card);
  await addCardPaymentRecord(ctx.card,ctx.data.cycle,ctx.data.pendiente,hoyISO(),'Pago de saldo completo',cuenta);
  renderBal(); renderCardsPage(); renderCardDetail(); toast('Saldo completo registrado','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const pagarSaldoCompleto=guardedOnce(pagarSaldoCompleto__base);

async function limpiarPagoTarjeta__base(){
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  if(!confirm('¿Eliminar todo el historial de pagos de este ciclo?'))return;
  const key=getCycleKey(ctx.data.cycle);
  try{
    // Los pagos en dólares se borran por su función para llevarse su diferencia de cambio.
    const enUSD=datos.pagosTarjetas.filter(r=>norm(String(r[1]))===norm(ctx.card.cuenta)&&normCycleKey(r[2])===key&&pagoEsUSD(r));
    for(const r of enUSD)await sbFetch('rpc/eliminar_pago_tarjeta_usd',{method:'POST',body:JSON.stringify({p_id:r[0]})});
    await sbFetch(`pagos_tarjetas?tarjeta=eq.${encodeURIComponent(ctx.card.cuenta)}&ciclo_key=eq.${key}`,{method:'DELETE'});
    datos.pagosTarjetas=datos.pagosTarjetas.filter(r=>!(norm(String(r[1]))===norm(ctx.card.cuenta)&&normCycleKey(r[2])===key));
    renderBal(); renderCardsPage(); renderCardDetail(); toast('Pagos reiniciados','success');
  }catch(e){toast('Error al reiniciar pagos','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const limpiarPagoTarjeta=guardedOnce(limpiarPagoTarjeta__base);

let editandoPagoId=null;

export function editarPagoTarjeta(id){
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  const p=getCardPaymentRecords(ctx.card,ctx.data.cycle).find(x=>x.id===id); if(!p)return;
  editandoPagoId=id;
  document.getElementById('payEditTitle').textContent='Editar pago';
  document.getElementById('payEditDate').value=p.date||hoyISO();
  document.getElementById('payEditAmount').value=p.amount.toFixed(2);
  document.getElementById('payEditNote').value=p.note||'';
  document.getElementById('payEditModal').classList.add('active');
}

export function cerrarEditPago(){
  document.getElementById('payEditModal').classList.remove('active');
  editandoPagoId=null;
}

async function guardarEditPago__base(){
  if(!editandoPagoId)return;
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  const amount=String(document.getElementById('payEditAmount').value).replace(/[^0-9.]/g,'').trim();
  const date=document.getElementById('payEditDate').value||hoyISO();
  const note=document.getElementById('payEditNote').value||'';
  if(!amount||parseFloat(amount)<=0){toast('Ingresa un monto válido','error');return;}
  await updateCardPaymentRecord(ctx.card,ctx.data.cycle,editandoPagoId,amount,date,note);
  cerrarEditPago(); renderBal(); renderCardsPage(); renderCardDetail(); toast('Pago editado','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarEditPago=guardedOnce(guardarEditPago__base);

async function confirmarEliminarPago__base(){
  if(!editandoPagoId)return;
  if(!confirm('¿Eliminar este pago?'))return;
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  await deleteCardPaymentRecord(ctx.card,ctx.data.cycle,editandoPagoId);
  cerrarEditPago(); renderBal(); renderCardsPage(); renderCardDetail(); toast('Pago eliminado','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const confirmarEliminarPago=guardedOnce(confirmarEliminarPago__base);

async function eliminarPagoTarjeta__base(id){
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  if(!confirm('¿Eliminar este pago?'))return;
  await deleteCardPaymentRecord(ctx.card,ctx.data.cycle,id);
  renderBal(); renderCardsPage(); renderCardDetail(); toast('Pago eliminado','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const eliminarPagoTarjeta=guardedOnce(eliminarPagoTarjeta__base);

export function renderPaymentHistory(card,cycle){
  const pagos=getCardPaymentRecords(card,cycle).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(!pagos.length)return '<div class="pay-history"><div class="pay-history-title">Historial de pagos</div><div class="empty" style="padding:18px 8px">Aún no registras pagos para este ciclo</div></div>';
  return `<div class="pay-history"><div class="pay-history-title">Historial de pagos</div>${pagos.map(p=>`<div class="pay-item"><div class="pay-item-main"><div class="pay-item-date">${formatISODate(p.date)}</div><div class="pay-item-note">${p.moneda==='USD'?escHtml('Pago en dólares · costó '+fmt(p.soles)+' · TC '+Number(p.tc).toFixed(4)+(p.cuentaOrigen?' · desde '+p.cuentaOrigen:'')):escHtml(p.note||'Sin nota')}</div><div class="pay-item-actions">${p.moneda==='USD'?'':`<button class="pay-small-btn" onclick="editarPagoTarjeta('${p.id}')">Editar</button>`}<button class="pay-small-btn danger" onclick="eliminarPagoTarjeta('${p.id}')">Eliminar</button></div></div><div class="pay-item-amt">+ ${p.moneda==='USD'?'US$ '+fmtN(p.usd):fmt(p.amount)}</div></div>`).join('')}</div>`;
}

export function renderPaymentForm(pendiente,card){
  // Cualquier cuenta de efectivo en soles puede pagar la tarjeta. La habitual
  // va preseleccionada si aún existe con ese nombre (puede haberse renombrado).
  const def=defaultCuentaOrigen(card);
  const cuentas=cuentasApp().filter(c=>!c[3]&&c[1]!=='inversion'&&c[2]==='PEN').map(c=>c[0]);
  const elegida=cuentas.find(c=>sameAccount(c,def))||cuentas[0];
  const opts=cuentas.map(c=>`<option value="${escAttr(c)}"${c===elegida?' selected':''}>${escHtml(c)}</option>`).join('');
  return `<div class="pay-form-grid"><div class="pay-form-fields"><div class="pay-field"><label>Monto</label><input id="cardPayAmount" type="number" inputmode="decimal" step="0.01" placeholder="0.00"></div><div class="pay-field"><label>Fecha</label><input id="cardPayDate" type="date" value="${hoyISO()}"></div><div class="pay-field"><label>Desde</label><select id="cardPayCuenta" class="sel">${opts}</select></div><div class="pay-field pay-note"><label>Nota opcional</label><input id="cardPayNote" type="text" placeholder="Ej. pago desde BBVA"></div></div><button class="btn btn-p" onclick="guardarPagoTarjeta()">Agregar</button></div><div class="pay-quick-row"><button class="btn btn-s" onclick="pagarSaldoCompleto()">Pagar saldo completo (${fmt(pendiente)})</button><button class="btn btn-s" onclick="limpiarPagoTarjeta()">Reiniciar pagos</button></div>${renderPagoUSD(card)}`;
}

// ── Pagar la tarjeta en dólares ────────────────────────────────────────────
// Aquí se fija el costo real: pones cuántos soles costó (o pagas con dólares
// tuyos y cuenta su costo promedio) y de ahí sale el tipo de cambio verdadero.
// Lo que difiera de lo que se había reconocido al gastar queda como "Diferencia
// de cambio" en la fecha del pago; ningún mes anterior se reescribe.
function renderPagoUSD(card){
  const d=deudaTarjetaUSD(card);
  if(!(d.usd>0))return '';
  const def=defaultCuentaOrigen(card);
  const cuentas=cuentasApp().filter(c=>!c[3]&&c[1]!=='inversion').map(c=>c[0]);
  const opts=cuentas.map(c=>`<option value="${escAttr(c)}"${sameAccount(c,def)?' selected':''}>${escHtml(c)} · ${monedaCuenta(c)}</option>`).join('');
  const sug=tcMercado>0?(Math.round(d.usd*tcMercado*100)/100).toFixed(2):'';
  return `<div class="pay-usd" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border)"><div class="pay-history-title">Pagar en dólares · debes US$ ${fmtN(d.usd)}</div><div class="pay-form-grid"><div class="pay-form-fields"><div class="pay-field"><label>Dólares a pagar</label><input id="cardUsdMonto" type="number" inputmode="decimal" step="0.01" value="${d.usd.toFixed(2)}" oninput="actualizarPagoUSD()"></div><div class="pay-field"><label>Desde</label><select id="cardUsdCuenta" class="sel" onchange="actualizarPagoUSD()">${opts}</select></div><div class="pay-field" id="cardUsdSolesRow"><label>Soles que costó</label><input id="cardUsdSoles" type="number" inputmode="decimal" step="0.01" value="${sug}" placeholder="0.00" oninput="actualizarPagoUSD()"></div><div class="pay-field"><label>Fecha</label><input id="cardUsdFecha" type="date" value="${hoyISO()}"></div></div><button class="btn btn-p" onclick="guardarPagoTarjetaUSD()">Pagar US$</button></div><div class="hint" id="cardUsdPreview" style="margin-top:10px"></div></div>`;
}

// Costo en soles de un pago en dólares y su diferencia de cambio. Misma cuenta
// que hace el servidor con el promedio de la deuda pendiente.
function costoPagoUSD(card,usd,cuenta,solesTexto){
  const d=deudaTarjetaUSD(card);
  if(!(usd>0))return{ok:false,mensaje:'Escribe cuántos dólares pagas.'};
  if(usd>d.usd+0.004)return{ok:false,mensaje:'Supera lo que debes: US$ '+fmtN(d.usd)+'.'};
  if(!cuenta)return{ok:false,mensaje:'Elige la cuenta de la que sale el pago.'};
  let soles,fuente;
  if(monedaCuenta(cuenta)==='USD'){
    const cp=costoPromedioUSD(),saldo=getCuentaBalanceMoneda(cuenta).saldo;
    if(!cp)return{ok:false,mensaje:'Aún no hay compras de dólares registradas para calcular su costo. Registra primero la compra.'};
    if(usd>saldo+0.004)return{ok:false,mensaje:'No alcanza el saldo de esa cuenta: tiene US$ '+fmtN(saldo)+'.'};
    soles=Math.round(usd*cp*100)/100;fuente='costo_promedio';
  }else{
    soles=Math.round(Number(solesTexto)*100)/100;fuente='manual';
    if(!(soles>0))return{ok:false,mensaje:'Escribe cuántos soles costó este pago.'};
  }
  const eq=equivalenteReconocido(card,usd),dif=Math.round((soles-eq)*100)/100,tc=soles/usd;
  const txt=Math.abs(dif)<0.005?'Sin diferencia de cambio.':dif>0?'Diferencia de cambio: costó '+fmt(dif)+' más de lo estimado.':'Diferencia de cambio: costó '+fmt(-dif)+' menos de lo estimado.';
  return{ok:true,soles,fuente,tc,eq,dif,mensaje:'TC real: '+tc.toFixed(6)+' · costó '+fmt(soles)+' · estaba reconocido '+fmt(eq)+'. '+txt};
}

export function actualizarPagoUSD(){
  const ctx=getSelectedCardAndData(),prev=document.getElementById('cardUsdPreview');
  if(!ctx||!prev)return;
  const cuenta=elv('cardUsdCuenta'),fila=document.getElementById('cardUsdSolesRow');
  if(fila)fila.hidden=monedaCuenta(cuenta)==='USD';
  prev.textContent=costoPagoUSD(ctx.card,Number(elv('cardUsdMonto')),cuenta,elv('cardUsdSoles')).mensaje;
}

async function guardarPagoTarjetaUSD__base(){
  const ctx=getSelectedCardAndData(); if(!ctx)return;
  const usd=Math.round(Number(elv('cardUsdMonto'))*100)/100,cuenta=elv('cardUsdCuenta'),fecha=elv('cardUsdFecha')||hoyISO();
  const r=costoPagoUSD(ctx.card,usd,cuenta,elv('cardUsdSoles'));
  if(!r.ok){toast(r.mensaje,'error');return;}
  try{
    await sbFetch('rpc/pagar_tarjeta_usd',{method:'POST',body:JSON.stringify({p_tarjeta:ctx.card.cuenta,p_ciclo:getCycleKey(ctx.data.cycle),p_monto_usd:usd,p_fecha:fecha+'T12:00:00Z',p_nota:null,p_cuenta_origen:cuenta,p_monto_origen:r.soles,p_tc_fuente:r.fuente})});
  }catch(e){
    toast(/pagar_tarjeta_usd|schema cache|Could not find/i.test(e.message||'')?'Falta activar los pagos en dólares en Supabase. Ejecuta el SQL de tarjetas en dólares.':(e.message||'No se pudo registrar el pago'),'error');
    return;
  }
  await cargar(); renderBal(); renderCardsPage(); renderCardDetail(); toast('Pago en dólares registrado','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarPagoTarjetaUSD=guardedOnce(guardarPagoTarjetaUSD__base);
