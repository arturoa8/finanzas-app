// Multimoneda: equivalencias, costo del dolar y campos del formulario.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentaPorNombre, cuentasApp, cuentasSaldos, estadoCuentas} from './accounts.js';
import {deudaUSDTotal} from './cards/cards.js';
import {pagoEsUSD, pagoSalidaSoles} from './cards/payments.js';
import {filtrar, render} from './dashboard.js';
import {editando, efectoResultado, sameAccount, seleccionarGastoReembolso, tipoA} from './transactions.js';
import {tcMercado, tcMercadoFecha, tcUsdPen} from '../services/exchange-rate.js';
import {datos} from '../state.js';
import {endOfDay, formatISODate, hoyISO, pf} from '../utils/dates.js';
import {smoothSetText} from '../utils/dom.js';
import {fmt, fmtN} from '../utils/formatters.js';
import {equivalenteSoles} from '../utils/numbers.js';

export function monedaCuenta(nombre){const c=cuentaPorNombre(nombre);return (c&&c[2])||'PEN';}

// Los dólares de IBKR no se gastan: incluirlos falsearía el promedio del
// dinero disponible. Sus aportes son consumo del pozo solo el día que salgan
// de una cuenta en dólares, no cuando salen de Plin o Yape en soles.
function cuentasUSDGastables(){
  return cuentasApp().filter(c=>c[2]==='USD'&&c[1]!=='inversion'&&!c[3]).map(c=>c[0]);
}

// Costo promedio ponderado de los dólares que tienes disponibles, recorriendo
// los movimientos en orden. Promedio móvil: comprar mueve el promedio, gastar
// no (retira coste en la misma proporción, así que el ratio no cambia). Si el
// saldo se agota el pozo se reinicia solo, que es lo correcto: los dólares que
// compres luego no deben arrastrar el costo de los que ya gastaste.
// Devuelve null cuando no hay con qué calcularlo; nunca un número inventado.
// hasta acota el recorrido a una fecha (para valorar un gasto histórico con
// el costo que regía ese día, no con compras que todavía no existían).
// excluirId saca una fila del recorrido: la que se está editando, para que no
// se cuente a sí misma como si ya estuviera guardada.
export function costoPromedioUSD(hasta=null,excluirId=null){
  const cuentas=cuentasUSDGastables();
  if(!cuentas.length)return null;
  const esUSD=n=>cuentas.some(c=>sameAccount(c,n||''));
  let usd=0,pen=0,descuadre=false;
  const entra=(d,soles)=>{if(d>0){usd+=d;pen+=soles;}};
  const sale=d=>{
    if(!(d>0))return;
    if(usd<=0){descuadre=true;return;}
    pen-=d*(pen/usd);usd-=d;
    if(usd<0.005){usd=0;pen=0;}          // agotado: el pozo vuelve a empezar
    else if(usd<0){descuadre=true;}
  };
  // Pagar una tarjeta con dólares propios también los consume.
  const pagosUSD=(datos.pagosTarjetas||[]).filter(p=>pagoEsUSD(p)&&esUSD(p[6])&&(!hasta||pf(p[4])<=hasta)).map(p=>({pago:p,fecha:pf(p[4])}));
  const eventos=[...(datos.transacciones||[])
      .filter(t=>String(t[6])!==String(excluirId)&&(!hasta||pf(t[0])<=hasta))
      .map(t=>({t,fecha:pf(t[0])})),
    ...pagosUSD].sort((a,b)=>a.fecha-b.fecha);
  eventos.forEach(ev=>{
    if(ev.pago){sale(Number(ev.pago[3])||0);return;}
    const t=ev.t,soles=Number(t[4])||0,orig=Number(t[10])||0;
    if(t[3]==='Transferencia'){
      if(esUSD(t[7])&&Number(t[14])>0)entra(Number(t[14]),soles);
      else if(esUSD(t[5]))sale(orig);
    }else if(esUSD(t[5])&&t[9]==='USD'&&orig>0){
      if(t[3]==='Gasto')sale(orig);else entra(orig,soles);
    }
  });
  if(descuadre||usd<0.005||pen<=0)return null;
  return Math.round(pen/usd*1e6)/1e6;
}

// Valoración automática de un Gasto o Ingreso registrado directo en una
// cuenta en dólares: nunca se pregunta el tipo de cambio, se calcula solo.
// Un gasto usa el costo histórico de la cuenta a esa fecha (esos dólares ya
// eran tuyos, comprados antes). Un ingreso externo (sueldo, un pago que te
// hacen en USD) usa la cotización de mercado de ese día: no es dinero que
// haya salido de tu pozo de dólares comprados, así que no debe cargarle el
// costo de compras anteriores ni moverle el promedio.
// Si falta con qué valorarlo no se inventa nada: tc queda null y el mensaje
// explica por qué, para que la persona lo escriba a mano.
export function valoracionAutomaticaUSD(tipoMov,fechaISO,excluirId=null){
  if(tipoMov==='Gasto'){
    const hasta=fechaISO?endOfDay(pf(fechaISO)):null;
    const tc=costoPromedioUSD(hasta,excluirId);
    return tc
      ? {tc,fuente:'costo_promedio',mensaje:'Costo promedio de tus dólares a esa fecha.'}
      : {tc:null,fuente:null,mensaje:'No hay dólares comprados registrados a esta fecha: escribe el tipo de cambio.'};
  }
  // Ingreso. Sin una fuente de cotización histórica por fecha, solo se
  // valora sin preguntar cuando es la de hoy (el mercado que ya se consultó).
  if(fechaISO&&fechaISO===hoyISO()&&tcMercado>0)
    return {tc:tcMercado,fuente:'mercado',mensaje:'Tipo de cambio de mercado de hoy.'};
  return {tc:null,fuente:null,mensaje:'No hay una cotización de mercado guardada para esa fecha: escribe el tipo de cambio.'};
}

// Igual que movimientoCuenta pero en la moneda propia de la cuenta: una cuenta
// en dólares debe enseñar dólares, no los soles con que se compraron.
// movimientoCuenta() se deja intacta: es la que alimenta el perímetro líquido,
// que sigue midiéndose en soles al costo histórico.
export function movimientoCuentaMoneda(t,cuenta){
  const usd=monedaCuenta(cuenta)==='USD';
  if(t[3]==='Transferencia'){
    // Cada lado se cuenta en la moneda de SU cuenta. monto está en soles
    // siempre, así que una cuenta en dólares nunca puede usarlo: usa
    // monto_original al salir y monto_destino al entrar.
    const origenUSD=t[9]==='USD'&&Number(t[10])>0;
    if(sameAccount(t[5]||'',cuenta))
      return usd?(origenUSD?-Number(t[10]):0):-(Number(t[4])||0);
    if(sameAccount(t[7]||'',cuenta)){
      if(Number(t[14])>0)return Number(t[14]);
      // Sin importe de destino confirmado solo se puede deducir cuando ambas
      // cuentas comparten moneda: entra lo mismo que salió. Entre monedas
      // distintas no se inventa nada (ver avisosCuenta).
      if(monedaCuenta(t[5]||'')!==monedaCuenta(cuenta))return 0;
      return usd?(origenUSD?Number(t[10]):0):(Number(t[4])||0);
    }
    return 0;
  }
  if(!sameAccount(t[5]||'',cuenta))return 0;
  if(!usd)return efectoResultado(t);
  // Una cuenta en dólares solo suma lo que está en dólares originales: nunca
  // soles tomados por dólares.
  return t[9]==='USD'&&Number(t[10])>0?(t[3]==='Gasto'?-1:1)*Number(t[10]):0;
}

// Lo que no entra en el saldo de una cuenta y conviene saber para conciliarla.
export function avisosCuenta(cuenta){
  const usd=monedaCuenta(cuenta)==='USD',a={pendientes:0,solesPendientes:0,enSoles:0};
  (datos.transacciones||[]).forEach(t=>{
    if(t[3]==='Transferencia'){
      if(sameAccount(t[7]||'',cuenta)&&!(Number(t[14])>0)&&monedaCuenta(t[5]||'')!==monedaCuenta(cuenta)){a.pendientes++;a.solesPendientes+=Number(t[4])||0;}
      // Salida de una cuenta en dólares sin importe en dólares: no se puede
      // descontar del saldo sin mezclar monedas, así que se avisa.
      else if(usd&&sameAccount(t[5]||'',cuenta)&&!(t[9]==='USD'&&Number(t[10])>0))a.enSoles++;
    }else if(usd&&sameAccount(t[5]||'',cuenta)&&!(t[9]==='USD'&&Number(t[10])>0))a.enSoles++;
  });
  return a;
}

export function getCuentaBalanceMoneda(cuenta,hasta=null){
  const moneda=monedaCuenta(cuenta);
  const enFecha=fecha=>!hasta||pf(fecha)<=hasta;
  let saldo=(datos.transacciones||[]).filter(t=>enFecha(t[0])).reduce((s,t)=>s+movimientoCuentaMoneda(t,cuenta),0);
  // Un pago en soles descuenta de una cuenta en soles lo que pagó. Un pago en
  // dólares descuenta de una cuenta en soles lo que costó, y de una cuenta en
  // dólares los dólares pagados.
  (datos.pagosTarjetas||[]).filter(p=>enFecha(p[4])).forEach(p=>{
    if(!sameAccount(String(p[6]||''),cuenta))return;
    if(moneda==='PEN')saldo-=pagoSalidaSoles(p);
    else if(pagoEsUSD(p))saldo-=Number(p[3])||0;
  });
  return {moneda,saldo:Math.round(saldo*100)/100};
}

export function fmtCuenta(n,moneda){return moneda==='USD'?(n<0?'−':'')+'US$ '+fmtN(Math.abs(n)):fmt(n);}

// Efectivo que hay en tus cuentas, cada moneda por separado y sin convertir.
// Es informativo: el saldo grande de Inicio sigue en soles al costo histórico.
// Quedan fuera las tarjetas (deuda, no efectivo) y las cuentas de inversión.
function efectivoPorMoneda(){
  const r={PEN:0,USD:0};
  cuentasSaldos().forEach(c=>{const {moneda,saldo}=getCuentaBalanceMoneda(c);r[moneda==='USD'?'USD':'PEN']+=saldo;});
  return r;
}

// Vista en dólares del balance de Inicio: el botón US$ cambia el número grande
// a los dólares que hay en tus cuentas y los dos chips a lo ingresado y gastado
// en dólares en el período. No convierte nada; volver a pulsar deja todo como
// estaba.
export let verUSD=false;

export function toggleVistaUSD(){verUSD=!verUSD;render();}

function totalesUSD(tx){
  let i=0,g=0;
  tx.forEach(t=>{
    if(t[9]!=='USD')return;
    const v=Number(t[10])||0;
    if(t[3]==='Ingreso')i+=v;else if(t[3]==='Gasto')g+=v;else if(t[3]==='Reembolso')g-=v;
  });
  return{i,g};
}

export function aplicarVistaUSD(){
  const btn=document.getElementById('btnUsd');
  if(btn){btn.classList.toggle('active-pill',verUSD);btn.setAttribute('aria-pressed',String(verUSD));}
  const cur=document.querySelector('.hero2 .currency');
  if(cur)cur.textContent=verUSD?'US$':'S/';
  if(!verUSD)return;
  const saldo=efectivoPorMoneda().USD,{i,g}=totalesUSD(filtrar());
  smoothSetText(document.getElementById('balAmt'),fmtN(Math.abs(saldo)),Math.abs(saldo));
  const dot=document.getElementById('balDot');
  dot.textContent=saldo>=0?'+':'−';dot.classList.toggle('neg',saldo<0);
  document.getElementById('balLbl').textContent='Dólares en tus cuentas';
  smoothSetText(document.getElementById('kpiOut'),'− US$ '+fmtN(g),g);
  smoothSetText(document.getElementById('kpiIn'),'+ US$ '+fmtN(i),i);
  const nota=document.getElementById('balNota');
  if(nota){nota.textContent='';nota.hidden=true;}
}

// El tipo de cambio que se propone depende de quién hace la conversión. Si
// pagas con dólares tuyos, lo que importa es a cuánto los compraste. Si paga
// una cuenta en soles o una tarjeta, convierte el banco y tu costo promedio no
// tiene nada que ver: ahí la tasa sale del estado de cuenta.
function tcPropuesto(cuenta){
  if(monedaCuenta(cuenta)==='USD'){
    const p=costoPromedioUSD();
    return p?{tc:p,fuente:'costo_promedio',nota:'Costo promedio de tus dólares.'}
            :tcMercado>0?{tc:tcMercado,fuente:'mercado',nota:'Aún no hay compras de dólares registradas: se propone el tipo de cambio de mercado de hoy.'}
            :{tc:null,fuente:'manual',nota:'Aún no hay compras de dólares registradas: escribe el tipo de cambio.'};
  }
  // Con tarjeta o cuenta en soles convierte el banco y aún no se sabe a cuánto:
  // se propone el tipo de cambio de mercado de hoy como estimación. El real
  // queda fijado cuando pagas la tarjeta en dólares.
  if(tcMercado>0)return {tc:tcMercado,fuente:'mercado',
    nota:'Tipo de cambio de mercado'+(tcMercadoFecha&&tcMercadoFecha!==hoyISO()?' del '+formatISODate(tcMercadoFecha):' de hoy')+', como estimación. Al pagar la tarjeta se fija el real.'};
  return {tc:tcUsdPen||null,fuente:'manual',nota:'La conversión la hace el banco: usa la tasa de tu estado de cuenta.'};
}

// ── Campos de moneda del formulario ────────────────────────────────────────
export let tcFuenteActual='manual';
// Escribir una variable importada no es posible en un modulo ES. Estas dos
// eran las UNICAS de las 58 globales mutables que se modificaban desde otro
// fichero, asi que en vez de mover todo el estado a un objeto central se
// expone un setter en cada dueno: el resto del codigo no cambia.
export function setTcFuente(v){tcFuenteActual=v;}

export function elv(id){const e=document.getElementById(id);return e?String(e.value==null?'':e.value).trim():'';}

// En una transferencia la moneda del importe la fija la cuenta de origen: lo
// que sale de una cuenta en dólares son dólares. En el resto la elige el
// selector, que queda bloqueado en US$ si la cuenta ya es en dólares.
export function monedaTx(){
  if(tipoA==='Transferencia')return monedaCuenta(elv('iCue'));
  return elv('iMoneda')==='USD'?'USD':'PEN';
}

// Transferencia entre monedas distintas: el tipo de cambio no se escribe, sale
// de los dos importes. Siempre soles por dólar, se mire desde el lado que se
// mire (S/3.800 -> US$1.000 y US$500 -> S/1.900 dan los dos 3,80).
function tcDerivadoTransferencia(){
  if(tipoA!=='Transferencia')return null;
  const sale=Number(elv('iMon')),entra=Number(elv('iMonDestino'));
  if(!(sale>0)||!(entra>0))return null;
  const mo=monedaCuenta(elv('iCue')),md=monedaCuenta(elv('iDestino'));
  if(mo===md)return null;
  return Math.round((mo==='USD'?entra/sale:sale/entra)*1e8)/1e8;
}

// Muestra u oculta los campos de divisa según el tipo y las cuentas elegidas, y
// propone un tipo de cambio si el campo está vacío. Nunca pisa lo ya escrito:
// al editar un movimiento antiguo se conserva el tipo de cambio con el que se
// guardó, no el promedio de hoy.
export function sincronizarCamposMoneda(){
  const selMon=document.getElementById('iMoneda'),div=document.getElementById('divisaFields');
  if(!selMon||!div)return;
  const incompletas=estadoCuentas==='cargando'||estadoCuentas==='error';
  document.querySelectorAll('#modalBtns button[onclick="guardar()"]').forEach(b=>b.disabled=incompletas);
  const aviso=document.getElementById('accountStatus');if(aviso)aviso.hidden=!incompletas;
  if(incompletas)return;
  const original=editando?datos.transacciones.find(t=>String(t[6])===String(editando)):null;
  const transferencia=tipoA==='Transferencia';
  selMon.hidden=cuentasUSDGastables().length===0&&original?.[9]!=='USD';
  if(selMon.hidden)selMon.value='PEN';
  // Hay dos casos en los que la moneda no se elige sino que se hereda: una
  // transferencia la toma de su cuenta de origen, y una cuenta en dólares solo
  // puede mover dólares (así su saldo nunca mezcla monedas). En ambos se deja
  // visible pero deshabilitada, para que se vea en qué moneda es el importe.
  const heredada=transferencia||monedaCuenta(elv('iCue'))==='USD';
  if(heredada){selMon.value=monedaCuenta(elv('iCue'));selMon.disabled=true;}
  else if(selMon.disabled){selMon.disabled=false;selMon.value='PEN';}
  // También una transferencia que sale de una cuenta en dólares: su importe
  // está en dólares y necesita equivalente en soles como cualquier otro.
  const enDivisa=monedaTx()==='USD';
  div.hidden=!enDivisa;
  const campo=document.getElementById('iTc'),nota=document.getElementById('divisaEquiv');
  const filaTc=document.getElementById('iTcRow');
  const tcOriginal=Number(original?.[11]);
  const historico=original?.[9]==='USD'&&original[3]===tipoA&&Number.isFinite(tcOriginal)&&tcOriginal>0;
  if(campo&&(!enDivisa||!historico))delete campo.dataset.tcHistoricoId;
  if(enDivisa){
    const derivado=tcDerivadoTransferencia();
    if(derivado){
      // Con los dos importes el tipo de cambio es un hecho, no una estimación.
      if(campo){campo.value=derivado;campo.readOnly=true;delete campo.dataset.tcHistoricoId;}
      tcFuenteActual='transferencia';
      if(filaTc)filaTc.hidden=false;
      if(nota)nota.dataset.nota='Sale de los dos importes de esta operación.';
    }else if(historico){
      // La valoración automática es una propuesta para registros nuevos.
      // Editar fecha, descripción o importe no cambia la tasa efectiva de una
      // operación guardada. Se muestra para poder corregirla explícitamente.
      if(campo){
        if(campo.dataset.tcHistoricoId!==String(editando)){
          campo.value=original[11];tcFuenteActual=original[12]||'manual';
          campo.dataset.tcHistoricoId=String(editando);
        }
        campo.readOnly=false;
      }
      if(filaTc)filaTc.hidden=false;
      if(nota)nota.dataset.nota='Tipo de cambio de esta operación; se conserva al editar y puedes corregirlo.';
    }else if(!transferencia){
      // Los registros nuevos se valoran automáticamente. Sin una tasa válida
      // se muestra el campo para escribirla, sin inventar una cotización.
      const auto=valoracionAutomaticaUSD(tipoA,elv('iFec'),editando);
      if(campo)campo.readOnly=true;
      if(auto.tc){
        if(campo)campo.value=auto.tc;
        tcFuenteActual=auto.fuente;
        if(filaTc)filaTc.hidden=true;
      }else{
        if(campo){campo.value='';campo.readOnly=false;}
        tcFuenteActual='manual';
        if(filaTc)filaTc.hidden=false;
      }
      if(nota)nota.dataset.nota=auto.mensaje;
    }else{
      if(campo)campo.readOnly=false;
      if(filaTc)filaTc.hidden=false;
      const p=tcPropuesto(transferencia?elv('iCue'):elv('iCue'));
      if(campo&&!campo.value){if(p.tc)campo.value=p.tc;tcFuenteActual=p.tc?p.fuente:'manual';}
      if(nota)nota.dataset.nota=transferencia
        ? 'Valora en soles los dólares que salen, para el saldo disponible.'
        : p.nota;
    }
  }else if(campo){campo.value='';campo.readOnly=false;if(filaTc)filaTc.hidden=false;}

  const fila=document.getElementById('destinoMontoRow'),notaTr=document.getElementById('transferTc');
  const distinta=transferencia&&!!elv('iDestino')&&monedaCuenta(elv('iDestino'))!==monedaCuenta(elv('iCue'));
  if(fila){
    fila.hidden=!distinta;
    const lbl=document.getElementById('destinoMontoLbl');
    if(lbl&&distinta)lbl.textContent='Entra en '+monedaCuenta(elv('iDestino'));
    const campoD=document.getElementById('iMonDestino');
    if(campoD&&!distinta)campoD.value='';
  }
  if(notaTr)notaTr.hidden=!distinta;
  actualizarEquivalente();
}

export function cambiarMonedaTx(){const c=document.getElementById('iTc');if(c)c.value='';sincronizarCamposMoneda();}

export function tcEditadoAMano(){tcFuenteActual='manual';actualizarEquivalente();}

export function actualizarEquivalente(){
  const div=document.getElementById('divisaFields'),nota=document.getElementById('divisaEquiv');
  if(nota&&div&&!div.hidden){
    const eq=equivalenteSoles(elv('iMon'),elv('iTc'));
    nota.textContent=(eq===null||!(eq>0)?'Escribe el importe y el tipo de cambio.':'= '+fmt(eq)+'.')+' '+(nota.dataset.nota||'');
  }
  const tr=document.getElementById('transferTc');
  if(tr&&!tr.hidden){
    const d=tcDerivadoTransferencia();
    tr.textContent=d
      ? 'Tipo de cambio de esta operación: '+d.toFixed(6)
      : 'Si aún no sabes cuánto llegó, déjalo vacío: queda pendiente de conciliar.';
  }
  if(tipoA==='Reembolso')seleccionarGastoReembolso();
}
