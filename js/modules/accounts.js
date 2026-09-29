// Cuentas propias: tipo, moneda, archivado y saldos en soles.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {getCardOutstandingTotal} from './cards/cards.js';
import {CREDIT_CARDS} from './cards/config.js';
import {pagoSalidaSoles} from './cards/payments.js';
import {avisosCuenta, fmtCuenta, getCuentaBalanceMoneda, sincronizarCamposMoneda} from './currencies.js';
import {render} from './dashboard.js';
import {conciliando} from './reconciliation.js';
import {abrirConfiguracion} from './settings.js';
import {cargar, efectoResultado, sameAccount, tipoA} from './transactions.js';
import {sbFetch, sbInsert, sbUpdate} from '../services/supabase.js';
import {conciliacion, datos} from '../state.js';
import {toast} from '../ui/toast.js';
import {endOfDay} from '../utils/dates.js';
import {escAttr, escHtml, fmt, norm} from '../utils/formatters.js';

// true cuando la tabla cuentas ya existe en Supabase; si no, la app sigue
// funcionando con las cuentas base de abajo.
export let cuentasMigradas=false;
// Escribir una variable importada no es posible en un modulo ES. Estas dos
// eran las UNICAS de las 58 globales mutables que se modificaban desde otro
// fichero, asi que en vez de mover todo el estado a un objeto central se
// expone un setter en cada dueno: el resto del codigo no cambia.
export function setCuentasMigradas(v){cuentasMigradas=v;}

// Cuentas usadas mientras la tabla cuentas no esté cargada (migración sin
// aplicar o primera carga). Mismo contenido que la semilla del SQL.
const CUENTAS_BASE=[['Plin','billetera','PEN',false,null],['Yape','billetera','PEN',false,null],['IBKR','inversion','USD',false,null]];

export function cuentasApp(){return (datos.cuentas&&datos.cuentas.length)?datos.cuentas:CUENTAS_BASE;}

export function cuentaPorNombre(nombre){return cuentasApp().find(c=>sameAccount(c[0],nombre))||null;}

export function esCuentaInversion(nombre){const c=cuentaPorNombre(nombre);return !!c&&c[1]==='inversion';}

// Una cuenta en dólares que no es de inversión (p. ej. BCP Dólares): el
// dinero que entra ahí sale del perímetro líquido en soles igual que a
// inversión. Neto ajusta esas transferencias; Acumulado suma directamente
// las cuentas en soles (la cuenta USD se ve aparte, en su propia moneda).
export function esCuentaUSDNoInversion(nombre){const c=cuentaPorNombre(nombre);return !!c&&c[2]==='USD'&&c[1]!=='inversion';}

// Fuera del perímetro líquido en soles: inversión o dólares que no son de
// inversión. Un Ingreso/Gasto registrado directo ahí ya vive en otra moneda
// o ya es capital invertido, así que no debe sumarse ni restarse en soles.
export function fueraDePerimetro(nombre){return esCuentaInversion(nombre)||esCuentaUSDNoInversion(nombre);}

function cuentasDisponibles(){
  const cuentas=[...cuentasApp().filter(c=>!c[3]).map(c=>c[0]),...CREDIT_CARDS.map(c=>c.cuenta)];
  return cuentas.map(c=>String(c).trim()).filter((c,i,a)=>c&&a.findIndex(v=>sameAccount(v,c))===i);
}

// Cuentas que ya no están disponibles (archivadas, borradas de la lista o
// escritas a mano antes) pero que sí aparecen en movimientos guardados. Solo
// se usan al editar y al mostrar saldos, para no perder el dato.
export function cuentasLegacy(){
  const disponibles=cuentasDisponibles(),legacy=[];
  (datos.transacciones||[]).forEach(t=>[t[5],t[7]].forEach(v=>{
    const n=String(v||'').trim();
    if(n&&!disponibles.some(d=>sameAccount(d,n))&&!legacy.some(d=>sameAccount(d,n)))legacy.push(n);
  }));
  return legacy;
}

// Aporte neto fuera del perímetro líquido en soles: lo que entra a una
// cuenta de inversión O a una cuenta en dólares que no es de inversión
// (comprar dólares) menos lo que sale de ellas. En ambos casos el dinero
// sigue siendo tuyo, pero ya no es saldo disponible en soles sin convertir.
export function aportesNetosInversion(txs){
  return (txs||[]).reduce((sum,t)=>{
    if(t[3]!=='Transferencia')return sum;
    const m=Number(t[4])||0;
    return sum+(fueraDePerimetro(t[7]||'')?m:0)-(fueraDePerimetro(t[5]||'')?m:0);
  },0);
}

// Las cuentas del formulario son una lista cerrada. En Transferencia e
// Ingreso se excluyen las tarjetas: una tarjeta tiene su propio flujo de
// pagos y nunca recibe dinero directo (un ingreso ahí quedaría invisible en
// Saldos por cuenta y nunca reduciría la deuda). El destino de una
// Transferencia tampoco puede repetir el origen. Al editar, una cuenta que
// ya no está disponible (vacía o de una cuenta vieja) se agrega como opción
// para no perder el dato — salvo que sea justo una tarjeta colada en un
// Ingreso, que no se reinserta.
function opcionesCuenta(valorActual){
  let lista=cuentasDisponibles();
  const sinTarjetas=tipoA==='Transferencia'||tipoA==='Ingreso';
  if(sinTarjetas)lista=lista.filter(c=>!CREDIT_CARDS.some(card=>sameAccount(card.cuenta,c)));
  const esTarjeta=v=>CREDIT_CARDS.some(card=>sameAccount(card.cuenta,v));
  if(valorActual&&!lista.some(c=>sameAccount(c,valorActual))&&!(sinTarjetas&&esTarjeta(valorActual)))lista=[valorActual,...lista];
  return lista;
}

function pintarCuentas(sel,lista,valor,excluir){
  if(!sel)return;
  const opciones=lista.filter(c=>!excluir||!sameAccount(c,excluir));
  sel.innerHTML='<option value="">Sin cuenta</option>'+opciones.map(c=>`<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('')+'<option value="__admin__">Administrar cuentas…</option>';
  sel.value=opciones.find(c=>sameAccount(c,valor))||'';
  sel.dataset.prev=sel.value;
}

// Sin argumentos conserva lo elegido; con '' lo limpia.
export function llenarCuentas(seleccionada,destinoSeleccionado){
  const cue=document.getElementById('iCue'),dst=document.getElementById('iDestino');
  if(!cue||!dst)return;
  const valCue=seleccionada===undefined?cue.value:(seleccionada||'');
  const valDst=destinoSeleccionado===undefined?dst.value:(destinoSeleccionado||'');
  pintarCuentas(cue,opcionesCuenta(valCue),valCue);
  pintarCuentas(dst,opcionesCuenta(valDst),valDst,tipoA==='Transferencia'?cue.value:'');
}

export function cambiarCuentaSelect(sel){
  if(sel&&sel.value==='__admin__'){sel.value=sel.dataset.prev||'';abrirConfiguracion('cuentas');return;}
  if(sel)sel.dataset.prev=sel.value;
  if(tipoA==='Transferencia')llenarCuentas();
  // La moneda de la cuenta decide si hay campos de divisa y qué TC se propone.
  sincronizarCamposMoneda();
}

// Saldo real de una cuenta de efectivo (Plin/Yape): ingresos y gastos hechos
// directo desde ahí, menos los pagos de tarjeta que salieron de esa cuenta
// (los consumos EN la tarjeta no cuentan aquí, porque no salen de la cuenta
// hasta que se paga la tarjeta — eso ya está cubierto por pagos_tarjetas).
function movimientoCuenta(t,cuenta){
  const m=Number(t[4])||0;
  if(t[3]==='Transferencia')return (sameAccount(t[7]||'',cuenta)?m:0)-(sameAccount(t[5]||'',cuenta)?m:0);
  return sameAccount(t[5]||'',cuenta)?efectoResultado(t):0;
}

function getCuentaBalance(cuenta){
  let bal=datos.transacciones.reduce((sum,t)=>sum+movimientoCuenta(t,cuenta),0);
  (datos.pagosTarjetas||[]).forEach(p=>{if(sameAccount(String(p[6]||''),cuenta))bal-=pagoSalidaSoles(p);});
  return Math.round(bal*100)/100;
}

// Cuentas de efectivo (todas menos inversión y tarjetas). Las viejas se siguen
// mostrando mientras tengan movimientos.
export function cuentasSaldos(){
  return [...cuentasDisponibles(),...cuentasLegacy()].filter(c=>!esCuentaInversion(c)&&!CREDIT_CARDS.some(card=>sameAccount(card.cuenta,c)));
}

// Ingresos y gastos sin cuenta: no entran en el saldo de ninguna. Los de
// "Diferencia de cambio" no llevan cuenta a propósito.
function movimientosSinCuenta(){
  let n=0,total=0;
  (datos.transacciones||[]).forEach(t=>{
    if(String(t[5]||'').trim()||t[3]==='Transferencia'||t[2]==='Diferencia de cambio')return;
    n++;total+=efectoResultado(t);
  });
  return{n,total};
}

// Desglose informativo de cuentas activas en soles. Los nombres históricos
// sin moneda configurada no se pueden clasificar de forma fiable.
function cuentasEfectivoSoles(){
  return cuentasApp().filter(c=>!c[3]&&c[2]==='PEN'&&(c[1]==='banco'||c[1]==='billetera'));
}

function totalEfectivoSoles(hasta=endOfDay(new Date())){
  return cuentasEfectivoSoles().reduce((sum,c)=>sum+getCuentaBalanceMoneda(c[0],hasta).saldo,0);
}

function totalPendienteTarjetasGlobal(){
  return CREDIT_CARDS.reduce((sum,card)=>sum+getCardOutstandingTotal(card),0);
}

export function renderSaldoCuentas(){
  const cont=document.getElementById('saldoCuentas'); if(!cont)return;
  const btn=document.getElementById('btnConciliar');
  if(btn){btn.classList.toggle('active-pill',conciliando);btn.setAttribute('aria-pressed',String(conciliando));btn.textContent=conciliando?'Ocultar comparación':'Comparar con banco';}
  // Desglose por cuentas, independiente del cálculo histórico de Acumulado.
  const hasta=endOfDay(new Date()),totalEfectivo=totalEfectivoSoles(hasta),pendienteTarjetas=totalPendienteTarjetasGlobal();
  const incluidas=cuentasEfectivoSoles().map(c=>escHtml(c[0])+' '+fmt(getCuentaBalanceMoneda(c[0],hasta).saldo)).join(' + ');
  const resumen=`<div class="card-stat full" style="border:1px solid var(--border)"><div class="card-stat-lbl">Saldos registrados en cuentas en soles</div><div class="card-stat-val">${fmt(totalEfectivo)}</div><div class="card-stat-sub">${incluidas||'Sin cuentas activas en soles'}. Esta suma de cuentas es independiente de "Acumulado" en Inicio. Deuda pendiente de tarjetas: ${fmt(pendienteTarjetas)}. Las cuentas en dólares, archivadas o sin clasificar se muestran por separado.</div></div>`;
  const efectivo=cuentasSaldos();
  let html=resumen+efectivo.map((c,i)=>{
    const {moneda,saldo}=getCuentaBalanceMoneda(c,hasta),av=avisosCuenta(c);
    const config=cuentaPorNombre(c);
    const fuera=(!config||config[3])?`<div class="card-stat-sub">${config?'Cuenta archivada':'Cuenta sin clasificar'} · fuera de la suma anterior</div>`:'';
    // El costo en soles de los dólares es un dato secundario: el saldo de la
    // cuenta es el nominal en dólares.
    const costo=moneda==='USD'?`<div class="card-stat-sub">costo ${fmt(getCuentaBalance(c))}</div>`:'';
    const avisos=(av.pendientes?`<div class="card-stat-sub">${av.pendientes} transferencia${av.pendientes>1?'s':''} sin importe recibido (${fmt(av.solesPendientes)} enviados): no suman aún</div>`:'')
      +(av.enSoles?`<div class="card-stat-sub">${av.enSoles} movimiento${av.enSoles>1?'s':''} en soles en esta cuenta en dólares: no suman</div>`:'');
    const conc=conciliando?`<input type="number" inputmode="decimal" step="0.01" class="sel" style="margin-top:8px;width:100%" placeholder="Saldo banco" value="${escAttr(conciliacion[c]||'')}" oninput="actualizarDiferenciaBanco(${i},this.value)"><div class="card-stat-sub" id="difBanco${i}"></div>`:'';
    return `<div class="card-stat"><div class="card-stat-lbl">${escHtml(c)}</div><div class="card-stat-val ${saldo>=0?'stat-delta-pos':'stat-delta-neg'}">${fmtCuenta(saldo,moneda)}</div>${fuera}${costo}${avisos}${conc}</div>`;
  }).join('');
  const sin=movimientosSinCuenta();
  if(sin.n)html+=`<div class="card-stat full"><div class="card-stat-lbl">Sin cuenta asignada</div><div class="card-stat-val">${fmt(sin.total)}</div><div class="card-stat-sub">${sin.n} movimiento${sin.n>1?'s':''} sin cuenta: no están en el saldo de ninguna. Edítalos y elígeles una cuenta para que cuadren.</div></div>`;
  // Inversión aparte: aportes netos en soles, no valor de mercado ni efectivo.
  html+=cuentasApp().filter(c=>!c[3]&&c[1]==='inversion').map(c=>{
    const n=c[0],usd=getCuentaBalanceMoneda(n).saldo,av=avisosCuenta(n);
    return `<div class="card-stat full"><div class="card-stat-lbl">${escHtml(n)} · inversión, no es efectivo</div><div class="card-stat-val">${fmt(getCuentaBalance(n))} <small style="color:var(--dim)">aportes netos</small></div>${Math.abs(usd)>=0.005?`<div class="card-stat-sub">${fmtCuenta(usd,'USD')} acreditados</div>`:''}${av.pendientes?`<div class="card-stat-sub">${av.pendientes} aporte${av.pendientes>1?'s':''} sin dólares confirmados (${fmt(av.solesPendientes)})</div>`:''}</div>`;
  }).join('');
  cont.innerHTML=html;
}

const TIPOS_CUENTA={banco:'Banco',billetera:'Billetera',inversion:'Inversión'};

function errorCuentas(e){
 const msg=(e&&e.message)||'';
 if(/renombrar_cuenta/i.test(msg))return 'Falta aplicar el SQL de renombrado de cuentas en Supabase.';
 if(/schema cache|does not exist|relation .*cuentas/i.test(msg))return 'Falta aplicar el SQL de cuentas en Supabase.';
 if(/duplicate key|unique/i.test(msg))return 'Ya tienes una cuenta con ese nombre';
 if(/cuentas_(tipo|moneda|nombre)_check/i.test(msg))return 'Nombre, tipo o moneda no válidos';
 return msg||'Error al guardar la cuenta';
}

export function renderCuentasConfig(){
 const cont=document.getElementById('cuentasLista'); if(!cont)return;
 if(!cuentasMigradas){
  cont.innerHTML='<p class="hint">Todavía no está aplicado el SQL de cuentas en Supabase. Mientras tanto la app usa Plin, Yape e IBKR.</p>';
  return;
 }
 const cuentas=datos.cuentas||[];
 if(!cuentas.length){cont.innerHTML='<p class="hint">Aún no hay cuentas. Agrega la primera abajo.</p>';return;}
 cont.innerHTML=cuentas.map(c=>{
  const archivada=!!c[3];
  return `<div class="cuenta-item ${archivada?'archivada':''}">
   <div><div class="cuenta-item-nombre">${escHtml(c[0])}</div><div class="cuenta-item-meta">${escHtml(TIPOS_CUENTA[c[1]]||c[1])} · ${escHtml(c[2])}${archivada?' · archivada':''}</div></div>
   <div class="cuenta-item-acciones">
    <button class="line-edit-btn" data-cuenta-id="${escAttr(c[4])}" onclick="renombrarCuenta(this.dataset.cuentaId)">Renombrar</button>
    <button class="line-edit-btn" data-cuenta-id="${escAttr(c[4])}" onclick="archivarCuenta(this.dataset.cuentaId,${archivada?'false':'true'})">${archivada?'Desarchivar':'Archivar'}</button>
   </div>
  </div>`;
 }).join('');
}

export async function agregarCuenta(){
 const nombre=document.getElementById('newCuentaNombre').value.trim();
 const tipo=document.getElementById('newCuentaTipo').value;
 const moneda=document.getElementById('newCuentaMoneda').value;
 if(!nombre){toast('Escribe el nombre de la cuenta','error');return;}
 if(norm(nombre)==='__global__'){toast('Ese nombre está reservado','error');return;}
 if(CREDIT_CARDS.some(c=>sameAccount(c.cuenta,nombre))){toast('Ya existe una tarjeta con ese nombre','error');return;}
 if((datos.cuentas||[]).some(c=>sameAccount(c[0],nombre))){toast('Ya tienes una cuenta con ese nombre','error');return;}
 if(!TIPOS_CUENTA[tipo]||!['PEN','USD'].includes(moneda)){toast('Tipo o moneda no válidos','error');return;}
 try{
  const row=await sbInsert('cuentas',{nombre,tipo,moneda});
  datos.cuentas.push([row.nombre,row.tipo,row.moneda,!!row.archivada,row.id]);
  cuentasMigradas=true;
  document.getElementById('newCuentaNombre').value='';
  renderCuentasConfig();render();
  toast('Cuenta agregada','success');
 }catch(e){toast(errorCuentas(e),'error');}
}

// transacciones.cuenta guarda el nombre como texto, sin clave foránea, así que
// el nombre está copiado en cuatro columnas (cuentas.nombre, transacciones.cuenta,
// transacciones.cuenta_destino y pagos_tarjetas.cuenta_origen). Renombrar va por
// RPC para que las cuatro cambien en una sola transacción: con cuatro PATCH
// sueltos, un fallo a medias partiría el historial de la cuenta en dos.
export async function renombrarCuenta(id){
 const cuenta=(datos.cuentas||[]).find(c=>String(c[4])===String(id));
 if(!cuenta)return;
 const nombre=(prompt('Nuevo nombre para "'+cuenta[0]+'"',cuenta[0])||'').trim();
 if(!nombre||nombre===cuenta[0])return;
 // Mismas reglas que el servidor, para avisar antes de la ida y vuelta.
 if(norm(nombre)==='__global__'){toast('Ese nombre está reservado','error');return;}
 if(CREDIT_CARDS.some(c=>sameAccount(c.cuenta,nombre))){toast('Ya existe una tarjeta con ese nombre','error');return;}
 if((datos.cuentas||[]).some(c=>String(c[4])!==String(id)&&sameAccount(c[0],nombre))){toast('Ya tienes una cuenta con ese nombre','error');return;}
 try{
  const filas=await sbFetch('rpc/renombrar_cuenta',{method:'POST',body:JSON.stringify({p_id:id,p_nombre:nombre})});
  const movidos=Number((Array.isArray(filas)?filas[0]:filas||{}).movimientos)||0;
  // Se recarga en vez de parchear en memoria: el nombre vive en transacciones
  // y en pagos de tarjeta, y así los saldos no dependen de replicar la lógica.
  await cargar();
  renderCuentasConfig();
  toast(movidos?`Renombrada · ${movidos} movimiento${movidos===1?'':'s'} actualizado${movidos===1?'':'s'}`:'Cuenta renombrada','success');
 }catch(e){toast(errorCuentas(e),'error');}
}

// Archivar solo la saca de las listas nuevas; los movimientos se conservan.
export async function archivarCuenta(id,archivar){
 const cuenta=(datos.cuentas||[]).find(c=>String(c[4])===String(id));
 if(!cuenta)return;
 try{
  await sbUpdate('cuentas',id,{archivada:!!archivar});
  cuenta[3]=!!archivar;
  renderCuentasConfig();render();
  toast(archivar?'Cuenta archivada':'Cuenta reactivada','success');
 }catch(e){toast(errorCuentas(e),'error');}
}
