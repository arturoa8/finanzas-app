// Movimientos: alta, edicion, borrado y reglas financieras.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentaPorNombre, cuentasApp, llenarCuentas, setCuentasMigradas, setEstadoCuentas, validarCuentasDisponibles} from './accounts.js';
import {recuperarAbonosPendientes} from '../services/debt-operations.js';
import {recuperarPagosTarjetaPendientes} from '../services/card-operations.js';
import {guardarReembolsoConExcedente, recuperarReembolsosPendientes} from '../services/refund-operations.js';
import {CREDIT_CARDS} from './cards/config.js';
import {HISTORIAL_LIMITES_SELECT, filaLimite} from './cards/historial-limites.js';
import {cobradoDeuda, cubiertoPorDeudas, cuerpoDeuda, deudaArchivadaDeGasto, deudaDeGasto, deudasDeGasto, devueltoCentimos, filaDeuda, filaDeudaArchivada, netoCentimos, pendienteDeuda, planCuotas, sumarMeses, textoDeudas} from './por-cobrar.js';
import {filaPago} from './cards/payments.js';
import {filaPresupuesto} from './presupuestos-calculo.js';
import {elv, monedaCuenta, monedaTx, setTcFuente, sincronizarCamposMoneda, tcFuenteActual} from './currencies.js';
import {render} from './dashboard.js';
import {cargarTcMercado} from '../services/exchange-rate.js';
import {sessionUserId} from '../services/auth.js';
import {sbDelete, sbInsert, sbSelect, sbSelectTodo, sbUpdate} from '../services/supabase.js';
import {datos} from '../state.js';
import {getMesActivo, vista} from '../ui/navigation.js';
import {configurarDeshacer, ofrecerDeshacer} from '../ui/deshacer.js';
import {toast} from '../ui/toast.js';
import {guardedOnce, singleFlight} from '../utils/async.js';
import {buildFechaISO, fmtDateShort, pf, toDateInput} from '../utils/dates.js';
import {EMOJIS, cleanName, escAttr, escHtml, fmt, getEmoji, norm} from '../utils/formatters.js';
import {equivalenteSoles} from '../utils/numbers.js';

// Tipo de movimiento elegido en el formulario. Lo escribe setTipo(), aqui mismo.
export let tipoA='Gasto';

export let editando=null;

let editandoFecha=null;

let primeraCarga=true;

// Único sitio donde una fila de Supabase se convierte en el arreglo posicional
// que usa toda la app. Los campos nuevos van al final: los índices 0-8 no se
// mueven nunca, porque están escritos a mano en decenas de sitios.
//   0 fecha · 1 descripción · 2 categoría · 3 tipo · 4 monto (SIEMPRE soles)
//   5 cuenta · 6 id · 7 cuenta_destino · 8 transaccion_origen_id
//   9 moneda_original (null = PEN) · 10 monto_original · 11 tc · 12 tc_fuente
//  13 moneda_destino · 14 monto_destino · 15 es_costo_inversion (costo de
//  fondear la inversión: ver pfCostosInversion) · 16 deuda_id (quién te
//  devolvió esta parte de un gasto por cobrar: ver cobrosDeGasto)
function filaTx(t){
  return [t.fecha,t.descripcion,t.categoria,t.tipo,t.monto,t.cuenta,t.id,
    t.cuenta_destino||null,t.transaccion_origen_id||null,
    t.moneda_original||null,t.monto_original==null?null:Number(t.monto_original),
    t.tc==null?null:Number(t.tc),t.tc_fuente||null,
    t.moneda_destino||null,t.monto_destino==null?null:Number(t.monto_destino),
    t.es_costo_inversion===true,t.deuda_id||null];
}

// silencioso: sin el aviso "Actualizado", cuando quien recarga ya muestra el
// suyo (la barra de Deshacer, por ejemplo).
async function cargar__base({silencioso=false}={}){
  const usuario=sessionUserId();
  const comprobarSesion=()=>{if(sessionUserId()!==usuario){const e=new Error('La sesión cambió durante la carga.');e.sessionChanged=true;throw e;}};
  const b=document.getElementById('refreshBtn');b.classList.add('loading');
  cargarTcMercado();   // sin esperar: solo alimenta el tipo de cambio propuesto
  // Aparte del Promise.all: si la migración de cuentas todavía no está
  // aplicada, cargar() no debe fallar.
  // Un fallo pasajero (sesión que se renueva, red) no debe dejar la app con las
  // cuentas de respaldo: BCP Dólares pasaría a verse como soles y una compra de
  // dólares se guardaría como transferencia común. Se reintenta una vez y, si
  // sigue fallando, se conservan las cuentas ya cargadas y se avisa. Solo la
  // tabla inexistente (migración sin aplicar) se acepta en silencio.
  const pedirCuentas=()=>sbSelect('cuentas','?select=id,nombre,tipo,moneda,archivada&order=nombre.asc');
  const cuentasReq=pedirCuentas().catch(()=>pedirCuentas()).catch(e=>({falla:e}));
  // El historial de líneas solo afecta las estadísticas de uso: si falla (o la
  // migración no está aplicada) se conserva lo que había y la app sigue igual.
  const historialReq=sbSelect('limites_tarjetas_historial',HISTORIAL_LIMITES_SELECT).catch(()=>null);
  try{
    await recuperarAbonosPendientes();
    await recuperarPagosTarjetaPendientes();
    await recuperarReembolsosPendientes();
    comprobarSesion();
    const [tx,cfg,pagos,ciclos,cats,deu,abonos,pres,rec]=await Promise.all([
      sbSelectTodo('transacciones','?select=*&order=fecha.asc,id.asc'),
      sbSelect('config_tarjetas','?select=tarjeta,limite_credito,meta_pct,nombre,emoji,corte_dia,pago_dia'),
      sbSelectTodo('pagos_tarjetas','?select=*&order=fecha.asc,id.asc'),
      sbSelectTodo('ciclos_override','?select=id,tarjeta,tx_id,ciclo_key&order=id.asc'),
      sbSelect('categorias','?select=nombre,color'),
      pedirDeudas(),
      sbSelectTodo('deudas_abonos','?select=id,deuda_id,monto,fecha,nota,tx_id&order=id.asc'),
      // select=* también funciona antes de la migración de presupuestos por
      // período: filaPresupuesto lee las filas en ambos formatos.
      sbSelectTodo('presupuestos','?select=*&order=id.asc'),
      sbSelect('recurrentes','?select=descripcion,categoria,tipo,monto,dia_mes,activo'),
    ]);
    const cuentasRes=await cuentasReq;
    const historialLimites=await historialReq;
    comprobarSesion();
    if(Array.isArray(historialLimites))datos.historialLimites=historialLimites.map(filaLimite);
    datos.transacciones=tx.map(filaTx);
    datos.configTarjetas=cfg.map(c=>[c.tarjeta,c.limite_credito,c.meta_pct,c.nombre,c.emoji,c.corte_dia,c.pago_dia]);
    datos.pagosTarjetas=pagos.map(filaPago);
    datos.ciclosOverride=ciclos.map(c=>[c.id,c.tarjeta,c.tx_id,c.ciclo_key]);
    datos.categorias=cats.map(c=>[c.nombre,c.color]);
    datos.categoriasCargadas=true;
    datos.deudas=deu.filter(d=>!d.archivado).map(filaDeuda);
    datos.deudasArchivadas=deu.filter(d=>d.archivado).map(filaDeudaArchivada);
    datos.deudasAbonos=abonos.map(a=>[a.id,a.deuda_id,a.monto,a.fecha,a.nota,a.tx_id]);
    datos.presupuestos=pres.map(filaPresupuesto);
    datos.recurrentes=rec.map(r=>[r.descripcion,r.categoria,r.tipo,r.monto,r.dia_mes,r.activo]);
    const sinTabla=cuentasRes?.falla&&(['PGRST205','42P01'].includes(cuentasRes.falla.code)||/relation .*cuentas.* does not exist/i.test(cuentasRes.falla.message||''));
    if(cuentasRes&&cuentasRes.falla&&!sinTabla){
      setEstadoCuentas('error');
      // Se mantiene datos.cuentas y cuentasMigradas tal como estaban.
      console.error(cuentasRes.falla);
      toast('No se pudieron cargar tus cuentas. Recarga antes de registrar movimientos en dólares.','error');
    }else{
      setEstadoCuentas(sinTabla?'legacy':'lista');
      const cuentasRows=Array.isArray(cuentasRes)?cuentasRes:null;
      setCuentasMigradas(!!cuentasRows);
      datos.cuentas=(cuentasRows||[]).map(c=>[c.nombre,c.tipo,c.moneda,!!c.archivada,c.id]);
    }
    render();
    datos.cargados=true;
    const advertencia=document.getElementById('dataStatus');
    sincronizarCamposMoneda();
    if(advertencia){advertencia.hidden=!(cuentasRes?.falla&&!sinTabla);advertencia.textContent='La carga de cuentas está incompleta. Pulsa Actualizar antes de guardar.';}
    if(!primeraCarga&&!silencioso&&!(cuentasRes?.falla&&!sinTabla))toast('Actualizado','success');
    primeraCarga=false;
    return {ok:true};
  }
  catch(e){
    if(!e.sessionChanged){console.error(e);const aviso=document.getElementById('dataStatus');if(aviso){aviso.hidden=false;aviso.textContent=e.pending?e.message:'No se pudo completar la actualización. Se muestran los últimos datos cargados.';}toast(e.incompleto||e.pending?e.message:'Error al cargar','error');}
    return {ok:false,error:e};
  }
  finally{b.classList.remove('loading');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const cargar=singleFlight(cargar__base);
configurarDeshacer({alTerminar:()=>cargar({silencioso:true})});

// transaccion_id llega con la migración de gastos por cobrar. Sin ella la
// columna no existe (42703) y las deudas se cargan como antes, sin vínculo.
const COLUMNAS_DEUDA='id,persona,descripcion,monto,abonado,fecha_inicio,fecha_venc,tipo,archivado,motivo_archivo,fecha_archivo';
function pedirDeudas(){
  const pedir=extra=>sbSelectTodo('deudas_resumen','?select='+COLUMNAS_DEUDA+extra+'&order=id.asc');
  return pedir(',transaccion_id').catch(e=>{if(e.code==='42703'||/transaccion_id/.test(e.message||''))return pedir('');throw e;});
}

// Arreglo posicional → cuerpo para Supabase. Deshacer lo usa para volver a
// escribir un movimiento exactamente como estaba (con su mismo id).
export function cuerpoTx(t){
  return {id:t[6],fecha:t[0],descripcion:t[1],categoria:t[2],tipo:t[3],monto:Number(t[4]),cuenta:t[5],
    cuenta_destino:t[7]||null,transaccion_origen_id:t[8]||null,moneda_original:t[9]||null,monto_original:t[10],
    tc:t[11],tc_fuente:t[12]||null,moneda_destino:t[13]||null,monto_destino:t[14],es_costo_inversion:t[15]===true,deuda_id:t[16]||null};
}
const sinIdTx=({id,...resto})=>resto;

function validarTransferencia({origen,destino,monto},cards=CREDIT_CARDS){
  if(!Number.isFinite(monto)||monto<=0)throw new Error('Ingresa un importe mayor que cero');
  if(!origen.trim()||!destino.trim())throw new Error('Indica la cuenta de origen y destino');
  if(sameAccount(origen.trim(),destino.trim()))throw new Error('Elige dos cuentas diferentes');
  if(cards.some(c=>sameAccount(c.cuenta,origen.trim())||sameAccount(c.cuenta,destino.trim())))throw new Error('Para tarjetas de crédito, utiliza la opción de pagos de tarjeta');
}

export function llenarSel(){
  // Renderiza los chips de categoría dentro del modal
  const c=document.getElementById('catChips');
  let cats=[];
  if(datos.categorias&&datos.categorias.length){cats=datos.categorias.map(x=>x[0]).filter(Boolean);}
  if(cats.length===0&&!datos.categoriasCargadas&&!datos.cargados)cats=Object.keys(EMOJIS);
  const anterior=datos.transacciones.find(t=>String(t[6])===String(editando));
  const seleccion=getCatSeleccionada()||(anterior?.[2]||'');
  if(anterior?.[2]&&!cats.some(cat=>norm(cleanName(cat))===norm(cleanName(anterior[2]))))cats.push(anterior[2]);
  // Filtrar según tipo: si es Gasto, mostrar primero las de gasto; si Ingreso, las de ingreso
  const tipos={Gasto:['Comer afuera','Compras','Estudios','Auto','Lujo','Suscripciones','Tecnología','Ocio'],Ingreso:['Salario','Beca','Otros ingresos','Inversiones']};
  const ordenadas=cats.sort((a,b)=>{
    const lista=tipos[tipoA]||[];
    const ai=lista.indexOf(cleanName(a));const bi=lista.indexOf(cleanName(b));
    if(ai>=0&&bi>=0)return ai-bi;
    if(ai>=0)return -1;if(bi>=0)return 1;return 0;
  });
  c.innerHTML=ordenadas.map(cat=>{
    const cn=cleanName(cat);
    const em=getEmoji(cn);
    return `<button type="button" class="cchip${norm(cleanName(seleccion))===norm(cn)?' selected':''}" data-cat="${escAttr(cat)}" onclick="seleccionarCat(this)"><span class="cchip-emoji" style="color:${em.h};background:${em.c}">${em.e}</span>${escHtml(cn)}</button>`;
  }).join('');
}

export function seleccionarCat(el){
  document.querySelectorAll('#catChips .cchip').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
}

function getCatSeleccionada(){
  const sel=document.querySelector('#catChips .cchip.selected');
  return sel?sel.dataset.cat:'';
}

export function abrirM(){
  if(guardandoTx)return;
  editando=null;
  editandoFecha=null;
  document.querySelectorAll('#catChips .cchip').forEach(c=>c.classList.remove('selected'));
  document.getElementById('modalTitle').textContent='Nueva transacción';
  document.getElementById('modalBtns').innerHTML=`<button class="btn btn-s" onclick="cerrarM()">Cancelar</button><button class="btn btn-p" onclick="guardar()">Guardar</button>`;
  const hoy=new Date();
  const yyyy=hoy.getFullYear();const mm=String(hoy.getMonth()+1).padStart(2,'0');const dd=String(hoy.getDate()).padStart(2,'0');
  document.getElementById('iFec').value=yyyy+'-'+mm+'-'+dd;
  document.getElementById('iMon').value='';
  document.getElementById('iDes').value='';
  document.getElementById('iGastoOrigen').value='';
  const mon=document.getElementById('iMoneda');if(mon)mon.value='PEN';
  const tc=document.getElementById('iTc');if(tc)tc.value='';
  const mdest=document.getElementById('iMonDestino');if(mdest)mdest.value='';
  setTcFuente('manual');
  setTipo('Gasto');
  prepararCobro();
  llenarCuentas('','');
  sincronizarCamposMoneda();
  document.getElementById('modal').classList.add('active');
  setTimeout(()=>document.getElementById('iDes').focus(),100);
}

// "Todavía no me lo devuelven" vive en la pestaña Reembolso, no en la de Gasto,
// para no recargar cada consumo. En la pestaña Gasto solo se avisa, si el gasto
// ya tiene una deuda, dónde cambiarla.
function prepararCobro(t=null){
  const caja=document.getElementById('iCobrar');
  if(!caja)return;
  caja.checked=false;caja.disabled=false;
  document.getElementById('iCobrarPersona').value='';
  document.getElementById('iCobrarMonto').value='';
  const activas=t?.[3]==='Gasto'?deudasDeGasto(t[6]):[],archivada=t?.[3]==='Gasto'&&!activas.length?deudaArchivadaDeGasto(t[6]):null;
  const nota=document.getElementById('cobrarNota');
  nota.textContent=activas.length?textoDeudas(activas,pendienteDeudas(activas))+' de este gasto. Se cambia o se quita en la pestaña Reembolso.'
    :archivada?'La deuda de '+(archivada[1]||'esta persona')+' está archivada. Desarchívala en Deudas para cambiarla.':'';
  nota.hidden=!nota.textContent;
  mostrarCobro();aplicarModoCobro();
}

// Al elegir el gasto en la pestaña Reembolso: si ya tiene una deuda activa, el
// interruptor aparece encendido con sus datos; si no, apagado, y lo normal es
// registrar una devolución.
function precargarCobroReembolso(){
  const caja=document.getElementById('iCobrar'),caja2=document.getElementById('cobrarSwitchBox');
  if(!caja||!caja2)return;
  const disponible=tipoA==='Reembolso'&&!editando;
  caja2.hidden=!disponible;
  const id=document.getElementById('iGastoOrigen').value;
  const gasto=disponible&&id?datos.transacciones.find(t=>t[3]==='Gasto'&&String(t[6])===String(id)):null;
  const activas=gasto?deudasDeGasto(id):[],activa=activas[0]||null,archivada=gasto&&!activa?deudaArchivadaDeGasto(id):null;
  caja.checked=!!activa;caja.disabled=!!archivada;
  document.getElementById('iCobrarPersona').value=activas.length===1?activa[1]||'':'';
  // Vacío significa "todo el gasto": si después cambia el importe, la deuda lo sigue.
  const todo=activas.length===1&&Math.round(Number(activa[3])*100)===Math.round(Number(gasto[4])*100);
  document.getElementById('iCobrarMonto').value=activas.length===1&&!todo?activa[3]:'';
  document.getElementById('iCuotasN').value='2';
  document.getElementById('iCuotasFecha').value=gasto?sumarMeses(toDateInput(gasto[0]),1):'';
  // Un gasto ya dividido (entre personas o en cuotas) se edita fila por fila.
  personasCobro=activas.length>1?activas.map(d=>({id:d[0],nombre:d[1]||'',monto:String(d[3])})):[];
  modoCobro='';  // que setModoCobro no lea las filas del gasto anterior
  setModoCobro(activas.length>1?'varias':'una');
  const cobrado=activas.reduce((s,d)=>s+Math.round(cobradoDeuda(d)*100),0)/100;
  const nota=document.getElementById('cobrarNotaReembolso');
  nota.textContent=archivada?'La deuda de '+(archivada[1]||'esta persona')+' está archivada. Desarchívala en Deudas para cambiarla.'
    :cobrado>0?(activas.length>1?'Ya te devolvieron ':(activa[1]||'Esta persona')+' ya te devolvió ')+fmt(cobrado)+'.':'';
  nota.hidden=!nota.textContent;
  const quitar=document.getElementById('cobrarQuitarBtn');
  if(quitar){quitar.hidden=!activa;quitar.textContent=activas.length>1?'Quitar estas deudas':'Quitar esta deuda';}
  llenarDeudaReembolso();
  mostrarCobro();aplicarModoCobro();
}

// Lo que falta cobrar entre varias deudas, en soles.
function pendienteDeudas(deudas){return deudas.reduce((s,d)=>s+Math.round(pendienteDeuda(d)*100),0)/100;}

// Una persona, entre varias o en cuotas. "Entre varias" guarda las filas en
// personasCobro: {id de la deuda si ya existe, nombre, monto}.
let modoCobro='una',personasCobro=[];
const gastoCobro=()=>datos.transacciones.find(t=>t[3]==='Gasto'&&String(t[6])===String(document.getElementById('iGastoOrigen').value))||null;

export function setModoCobro(modo){
  if(modo==='varias'&&modoCobro!=='varias'&&!personasCobro.length){
    // Parte de lo que ya escribiste: esa persona queda como la primera.
    const nombre=document.getElementById('iCobrarPersona').value.trim(),monto=document.getElementById('iCobrarMonto').value;
    const existente=deudaDeGasto(document.getElementById('iGastoOrigen').value);
    personasCobro=[{id:existente?.[0]||null,nombre,monto:nombre?monto:''},{id:null,nombre:'',monto:''}];
  }else if(modoCobro==='varias')leerPersonasCobro();
  modoCobro=modo;
  for(const [m,id] of [['una','cobrarModoUna'],['varias','cobrarModoVarias'],['cuotas','cobrarModoCuotas']]){
    const b=document.getElementById(id);b.classList.toggle('active',m===modo);b.setAttribute('aria-pressed',String(m===modo));
  }
  document.getElementById('cobrarUna').hidden=modo==='varias';
  document.getElementById('cobrarCuotas').hidden=modo!=='cuotas';
  document.getElementById('cobrarVarias').hidden=modo!=='varias';
  if(modo==='varias')renderPersonasCobro();
  if(modo==='cuotas')resumirCuotasCobro();
}

function leerPersonasCobro(){
  personasCobro=personasCobro.map((p,i)=>({...p,
    nombre:document.getElementById('cpNombre-'+i)?.value??p.nombre,monto:document.getElementById('cpMonto-'+i)?.value??p.monto}));
}

function renderPersonasCobro(){
  const lista=document.getElementById('cobrarPersonas');
  lista.innerHTML=personasCobro.map((p,i)=>`<div class="cobrar-persona"><input id="cpNombre-${i}" class="sel" type="text" list="personasDeuda" placeholder="Nombre" autocomplete="off" aria-label="Persona ${i+1}" value="${escAttr(p.nombre||'')}"><input id="cpMonto-${i}" class="sel cp-monto" type="number" step="0.01" min="0" inputmode="decimal" placeholder="S/" aria-label="Cuánto te debe la persona ${i+1}" value="${escAttr(String(p.monto??''))}" oninput="resumirPersonasCobro()"><button type="button" class="cobrar-persona-x" onclick="quitarPersonaCobro(${i})" aria-label="Quitar a la persona ${i+1}"${personasCobro.length<=1?' disabled':''}>✕</button></div>`).join('');
  // El valor se fija también como propiedad: el atributo no basta si el
  // campo ya existía.
  personasCobro.forEach((p,i)=>{
    const n=document.getElementById('cpNombre-'+i),m=document.getElementById('cpMonto-'+i);
    if(n)n.value=p.nombre||'';if(m)m.value=String(p.monto??'');
  });
  resumirPersonasCobro();
}

export function agregarPersonaCobro(){
  leerPersonasCobro();personasCobro.push({id:null,nombre:'',monto:''});renderPersonasCobro();
  setTimeout(()=>document.getElementById('cpNombre-'+(personasCobro.length-1))?.focus(),50);
}

export function quitarPersonaCobro(i){
  leerPersonasCobro();
  if(personasCobro.length<=1)return;
  personasCobro.splice(i,1);renderPersonasCobro();
}

// Reparte el gasto en partes iguales. Si tú también pagas tu parte, te deben
// todas menos una; si no, entre ellos cubren el gasto completo.
export function repartirCobroIgual(){
  leerPersonasCobro();
  const gasto=gastoCobro();
  if(!gasto||!personasCobro.length)return;
  const total=Math.round(Number(gasto[4])*100),yo=document.getElementById('iCobrarYo').checked;
  const partes=personasCobro.length+(yo?1:0),base=Math.floor(total/partes);
  let cada=personasCobro.map(()=>base);
  if(yo){const redondo=Math.round(total/partes);if(redondo*personasCobro.length<=total)cada=cada.map(()=>redondo);}
  else for(let i=0;i<total-base*partes;i++)cada[i]++;
  personasCobro=personasCobro.map((p,i)=>({...p,monto:(cada[i]/100).toFixed(2)}));
  renderPersonasCobro();
}

export function resumirPersonasCobro(){
  const nota=document.getElementById('cobrarTotalVarias'),gasto=gastoCobro();
  if(!nota)return;
  let suma=0;
  personasCobro.forEach((p,i)=>{const n=Number(document.getElementById('cpMonto-'+i)?.value??p.monto);if(Number.isFinite(n)&&n>0)suma+=Math.round(n*100);});
  const total=gasto?Math.round(Number(gasto[4])*100):0;
  nota.textContent=!gasto?'':suma>total?'Entre todos suman '+fmt(suma/100)+': más que el gasto de '+fmt(total/100)+'.'
    :'Te deben '+fmt(suma/100)+' de '+fmt(total/100)+(total>suma?' · tu parte: '+fmt((total-suma)/100):'')+'.';
}

export function resumirCuotasCobro(){
  if(modoCobro!=='cuotas')return;
  const nota=document.getElementById('cobrarCuotasResumen'),gasto=gastoCobro();
  const raw=String(document.getElementById('iCobrarMonto').value).trim(),n=Number(document.getElementById('iCuotasN').value);
  const total=Math.round((raw===''?Number(gasto?.[4]):Number(raw))*100),primera=document.getElementById('iCuotasFecha').value;
  if(!gasto||!(total>0)||!Number.isInteger(n)||n<2||!primera){nota.textContent='';return;}
  const plan=planCuotas(total,n,primera),ultima=plan[n-1].monto,cada=plan[0].monto;
  nota.textContent=n+' cuotas de '+fmt(cada)+(ultima!==cada?' (la última, '+fmt(ultima)+')':'')+', una cada mes desde el '+fmtDateShort(pf(primera)).replace(/\.$/,'')+'.';
}

// "Quién te pagó" en una devolución de un gasto dividido. Sin elegir, la
// devolución cubre las deudas en orden (la cuota más próxima primero).
function llenarDeudaReembolso(){
  const fila=document.getElementById('reembolsoDeudaRow'),sel=document.getElementById('iReembolsoDeuda');
  if(!fila||!sel)return;
  const id=document.getElementById('iGastoOrigen').value;
  const activas=tipoA==='Reembolso'&&!editando&&id?deudasDeGasto(id):[];
  fila.hidden=activas.length<2;
  const previo=sel.value;
  sel.innerHTML=activas.length<2?'':'<option value="">Sin especificar</option>'+activas.map(d=>{
    const cuota=/Cuota \d+\/\d+$/.exec(d[2]||'')?.[0];
    return `<option value="${escAttr(d[0])}">${escHtml((d[1]||'—')+(cuota?' · '+cuota:'')+' · falta '+fmt(pendienteDeuda(d)))}</option>`;
  }).join('');
  sel.value=activas.some(d=>String(d[0])===previo)?previo:'';
}

function deudaElegidaReembolso(){
  const fila=document.getElementById('reembolsoDeudaRow'),id=document.getElementById('iReembolsoDeuda')?.value;
  return fila&&!fila.hidden&&id?(datos.deudas||[]).find(d=>String(d[0])===String(id))||null:null;
}

// Con el interruptor encendido solo se anota quién te debe: fecha, descripción,
// importe y cuenta del formulario sobran y se ocultan.
function aplicarModoCobro(){
  const caja=document.getElementById('iCobrar');
  const activo=tipoA==='Reembolso'&&!editando&&!!caja?.checked;
  document.getElementById('modal').classList.toggle('modo-cobro',activo);
  const etiqueta=document.getElementById('gastoOrigenLbl');
  if(etiqueta)etiqueta.textContent=activo?'Gasto que te deben':'Gasto que te devolvieron';
}

function mostrarCobro(){
  const caja=document.getElementById('iCobrar');
  if(!caja)return;
  document.getElementById('cobrarDetalle').hidden=!caja.checked;
  if(caja.checked){
    // Las personas a las que ya les cobraste algo, para no escribir "Mamá" y
    // "mamá" como si fueran dos.
    const vistas=new Map();
    for(const d of [...(datos.deudas||[]),...(datos.deudasArchivadas||[])]){
      const nombre=String(d[1]||'').trim();
      if(nombre&&String(d[7]).toLowerCase()==='me-deben'&&!vistas.has(norm(nombre)))vistas.set(norm(nombre),nombre);
    }
    document.getElementById('personasDeuda').innerHTML=[...vistas.values()].map(n=>`<option value="${escAttr(n)}"></option>`).join('');
  }
}

export function toggleCobrar(){
  mostrarCobro();aplicarModoCobro();
  const persona=document.getElementById('iCobrarPersona');
  if(document.getElementById('iCobrar').checked&&!persona.value)setTimeout(()=>persona.focus(),50);
}

// Al guardar un gasto la deuda que ya tenía se conserva y sigue al gasto: el
// formulario de Gasto no la crea ni la quita (eso se hace desde Reembolso).
// `total` es el equivalente en soles del gasto.
function leerCobro(total,deudaAntes,anterior){
  if(tipoA!=='Gasto'||!deudaAntes)return null;
  // Dividido entre varias personas o en cuotas: las deudas no siguen al gasto,
  // solo se revisa que sigan cabiendo en él.
  const todas=deudasDeGasto(anterior[6]);
  if(todas.length>1){
    const suma=todas.reduce((s,d)=>s+Math.round(Number(d[3])*100),0);
    if(suma>Math.round(total*100))throw new Error(textoDeudas(todas,suma/100)+': el gasto no puede ser menos');
    return {mantener:true};
  }
  const todo=!!anterior&&Math.round(Number(deudaAntes[3])*100)===Math.round(Number(anterior[4])*100);
  const monto=todo?total:Number(deudaAntes[3]);
  if(Math.round(monto*100)>Math.round(total*100))throw new Error('Lo que te deben no puede superar el gasto');
  if(Math.round(monto*100)<Math.round(cobradoDeuda(deudaAntes)*100))
    throw new Error((deudaAntes[1]||'Esta persona')+' ya te devolvió '+fmt(cobradoDeuda(deudaAntes))+': el gasto no puede ser menos');
  return {persona:deudaAntes[1],monto:Math.round(monto*100)/100,todo};
}

// Lee y valida el interruptor de la pestaña Reembolso antes de escribir nada.
// Devuelve las deudas que debe tener el gasto: [{id si ya existe, persona,
// descripcion, monto, fecha_venc (undefined = no se toca)}]. Sin monto, una
// persona o las cuotas cubren el gasto completo.
function leerCobroPendiente(gasto,activas){
  const total=Number(gasto[4]),totalC=Math.round(total*100);
  let deseadas;
  if(modoCobro==='varias'){
    leerPersonasCobro();
    const filas=personasCobro.filter(p=>p.id||String(p.nombre).trim()||String(p.monto).trim());
    if(!filas.length)throw new Error('Escribe quiénes te lo tienen que devolver');
    deseadas=filas.map(p=>{
      const persona=String(p.nombre).trim(),monto=Number(p.monto);
      if(!persona)throw new Error('Falta el nombre de una persona');
      if(!Number.isFinite(monto)||monto<=0)throw new Error('Escribe cuánto te debe '+persona);
      const antes=activas.find(d=>String(d[0])===String(p.id));
      return {id:p.id||null,persona,descripcion:antes?.[2]||gasto[1],monto:Math.round(monto*100)/100};
    });
  }else{
    const persona=document.getElementById('iCobrarPersona').value.trim();
    if(!persona)throw new Error('Escribe quién te lo tiene que devolver');
    const raw=String(document.getElementById('iCobrarMonto').value).trim();
    const monto=raw===''?total:Number(raw);
    if(!Number.isFinite(monto)||monto<=0)throw new Error('Escribe cuánto te deben o déjalo vacío para todo el gasto');
    if(modoCobro==='cuotas'){
      const n=Number(document.getElementById('iCuotasN').value),primera=document.getElementById('iCuotasFecha').value;
      if(!Number.isInteger(n)||n<2||n>60)throw new Error('Elige entre 2 y 60 cuotas');
      if(!primera)throw new Error('Elige cuándo vence la primera cuota');
      if(Math.round(monto*100)<n)throw new Error('Cada cuota debe ser de al menos S/ 0.01');
      deseadas=planCuotas(Math.round(monto*100),n,primera).map((c,i)=>({id:activas[i]?.[0]||null,persona,
        descripcion:gasto[1]+' · Cuota '+(i+1)+'/'+n,monto:c.monto,fecha_venc:c.venc}));
    }else deseadas=[{id:activas[0]?.[0]||null,persona,descripcion:gasto[1],monto:Math.round(monto*100)/100,todo:raw===''}];
  }
  const suma=deseadas.reduce((s,x)=>s+Math.round(x.monto*100),0);
  if(suma>totalC)throw new Error(deseadas.length>1?'Entre todos te deben '+fmt(suma/100)+': más que el gasto de '+fmt(total):'Lo que te deben no puede superar el gasto');
  // Lo ya devuelto no se puede borrar ni dejar por encima de lo que se debe.
  for(const x of deseadas){
    const antes=x.id?activas.find(d=>String(d[0])===String(x.id)):null;
    if(antes&&Math.round(x.monto*100)<Math.round(cobradoDeuda(antes)*100))
      throw new Error((antes[1]||'Esta persona')+' ya te devolvió '+fmt(cobradoDeuda(antes))+': lo que te debe no puede ser menos');
  }
  const quedan=new Set(deseadas.filter(x=>x.id).map(x=>String(x.id)));
  for(const d of activas)if(!quedan.has(String(d[0]))&&cobradoDeuda(d)>0)
    throw new Error((d[1]||'Esta persona')+' ya te devolvió '+fmt(cobradoDeuda(d))+': no se puede quitar. Archívala en Deudas.');
  return deseadas;
}

// "Quitar esta deuda": el gasto vuelve a contar entero como gasto tuyo. Los
// reembolsos que ya hubieras registrado no se tocan. Se puede deshacer.
async function quitarCobroPendiente__base(){
  const id=document.getElementById('iGastoOrigen').value;
  const deudas=deudasDeGasto(id);
  if(!deudas.length||guardandoTx)return;
  guardandoTx=true;
  const quitadas=[];
  try{
    for(const deuda of deudas){
      await sbDelete('deudas',deuda[0]);quitadas.push(deuda);
      datos.deudas=datos.deudas.filter(d=>d!==deuda);
    }
    cerrarM(true);render();
    ofrecerDeshacer(deudas.length>1?deudas.length+' deudas quitadas':'Deuda de '+(deudas[0][1]||'esta persona')+' quitada',async()=>{for(const d of quitadas)await sbInsert('deudas',cuerpoDeuda(d));});
  }
  catch(e){toast(e.message||'No se pudo quitar la deuda','error');if(quitadas.length)cargar({silencioso:true});}
  finally{guardandoTx=false;}
}
export const quitarCobroPendiente=guardedOnce(quitarCobroPendiente__base);

// Reembolso con el interruptor encendido: no entra dinero, solo se crean,
// cambian o quitan las deudas del gasto elegido.
async function guardarCobroPendiente(){
  const id=document.getElementById('iGastoOrigen').value;
  const gasto=datos.transacciones.find(t=>t[3]==='Gasto'&&String(t[6])===String(id));
  if(!gasto){toast('Selecciona el gasto que te deben','error');return;}
  const activas=deudasDeGasto(id);
  let deseadas;
  try{deseadas=leerCobroPendiente(gasto,activas);}catch(e){toast(e.message,'error');return;}
  guardandoTx=true;
  const usuarioGuardado=sessionUserId();
  const controles=[...document.querySelectorAll('#modal input,#modal select,#modal button')];
  const estados=controles.map(el=>el.disabled);
  controles.forEach(el=>{el.disabled=true;});
  document.getElementById('modal').setAttribute('aria-busy','true');
  const cambios={creadas:[],cambiadas:[],borradas:[]};
  try{
    await sincronizarDeudasGasto(gasto,deseadas,activas,cambios);
    if(sessionUserId()!==usuarioGuardado)throw new Error('La sesión cambió durante el guardado.');
    const actuales=deudasDeGasto(id);
    const mensaje=textoDeudas(actuales,pendienteDeudas(actuales));
    cerrarM(true);render();
    if(!cambios.creadas.length&&!cambios.cambiadas.length&&!cambios.borradas.length){toast(mensaje,'success');return;}
    ofrecerDeshacer(mensaje,()=>deshacerDeudasGasto(cambios));
  }
  catch(e){
    toast(e.message||'Error al guardar','error');
    // Si algo ya se escribió, se relee para no mostrar un estado a medias.
    if(cambios.creadas.length||cambios.cambiadas.length||cambios.borradas.length)cargar({silencioso:true});
  }
  finally{guardandoTx=false;controles.forEach((el,i)=>{el.disabled=estados[i];});document.getElementById('modal').setAttribute('aria-busy','false');}
}

// Deja el gasto con las deudas pedidas. Primero borra y baja montos, después
// sube y crea: así la suma nunca pasa el gasto a mitad de camino (el servidor
// lo rechazaría). Anota en `cambios` lo hecho, para deshacer.
async function sincronizarDeudasGasto(gasto,deseadas,activas,cambios){
  const fecha=toDateInput(gasto[0]);
  const quedan=new Set(deseadas.filter(x=>x.id).map(x=>String(x.id)));
  for(const d of activas.filter(d=>!quedan.has(String(d[0])))){
    await sbDelete('deudas',d[0]);
    datos.deudas=datos.deudas.filter(x=>x!==d);cambios.borradas.push(d);
  }
  const ediciones=deseadas.filter(x=>x.id).map(x=>{
    const antes=activas.find(d=>String(d[0])===String(x.id));
    const body={persona:x.persona,descripcion:x.descripcion,monto:x.monto,fecha_inicio:fecha};
    if(x.fecha_venc!==undefined)body.fecha_venc=x.fecha_venc;
    const igual=antes[1]===body.persona&&antes[2]===body.descripcion&&Math.round(Number(antes[3])*100)===Math.round(body.monto*100)
      &&toDateInput(antes[5])===fecha&&(body.fecha_venc===undefined||(antes[6]?toDateInput(antes[6]):null)===body.fecha_venc);
    return igual?null:{antes,body};
  }).filter(Boolean).sort((a,b)=>(a.body.monto-Number(a.antes[3]))-(b.body.monto-Number(b.antes[3])));
  for(const {antes,body} of ediciones){
    await sbUpdate('deudas',antes[0],body);
    cambios.cambiadas.push({antes,monto:body.monto});
    const i=datos.deudas.indexOf(antes);
    if(i>=0)datos.deudas[i]=[antes[0],body.persona,body.descripcion,body.monto,antes[4],fecha,body.fecha_venc===undefined?antes[6]:body.fecha_venc,antes[7],antes[8]];
  }
  const nuevas=deseadas.filter(x=>!x.id);
  if(nuevas.length){
    const rows=await sbInsert('deudas',nuevas.map(x=>({persona:x.persona,descripcion:x.descripcion,monto:x.monto,fecha_inicio:fecha,
      fecha_venc:x.fecha_venc??null,tipo:'me-deben',transaccion_id:gasto[6]})));
    for(const row of rows){datos.deudas.push(filaDeuda(row));cambios.creadas.push(row.id);}
  }
}

async function deshacerDeudasGasto(cambios){
  for(const id of cambios.creadas)await sbDelete('deudas',id);
  // Al revés que al guardar: primero lo que había subido vuelve a bajar.
  for(const {antes} of [...cambios.cambiadas].sort((a,b)=>(b.monto-Number(b.antes[3]))-(a.monto-Number(a.antes[3])))){
    await sbUpdate('deudas',antes[0],{persona:antes[1],descripcion:antes[2],monto:Number(antes[3]),fecha_inicio:antes[5],fecha_venc:antes[6]||null});
  }
  for(const d of cambios.borradas)await sbInsert('deudas',cuerpoDeuda(d));
}

// Crea, cambia o quita la deuda de un gasto ya guardado. Devuelve cómo estaba
// antes, para deshacer.
async function sincronizarCobro(gasto,cobro,deudaAntes,fecha){
  if((!cobro&&!deudaAntes)||cobro?.mantener)return null;
  if(!cobro){
    await sbDelete('deudas',deudaAntes[0]);
    datos.deudas=datos.deudas.filter(d=>d!==deudaAntes);
    return {antes:deudaAntes,creada:null,borrada:true};
  }
  const body={persona:cobro.persona,descripcion:gasto.descripcion,monto:cobro.todo?Number(gasto.monto):cobro.monto,fecha_inicio:fecha};
  if(deudaAntes){
    const igual=deudaAntes[1]===body.persona&&deudaAntes[2]===body.descripcion&&Math.round(Number(deudaAntes[3])*100)===Math.round(body.monto*100)&&toDateInput(deudaAntes[5])===fecha;
    if(igual)return null;
    await sbUpdate('deudas',deudaAntes[0],body);
    const i=datos.deudas.indexOf(deudaAntes);
    if(i>=0)datos.deudas[i]=[deudaAntes[0],body.persona,body.descripcion,body.monto,deudaAntes[4],fecha,deudaAntes[6],deudaAntes[7],deudaAntes[8]];
    return {antes:deudaAntes,creada:null};
  }
  const row=await sbInsert('deudas',{...body,tipo:'me-deben',transaccion_id:gasto.id});
  datos.deudas.push(filaDeuda(row));
  return {antes:null,creada:row.id};
}

export function editarTx(row){
  if(guardandoTx)return;
  const t=datos.transacciones.find(x=>String(getTxRow(x))===String(row));
  if(!t)return;
  if(t[2]==='Diferencia de cambio'&&!String(t[5]||'').trim()){toast('Es la diferencia de cambio de un pago en dólares. Se quita eliminando ese pago en Tarjetas.');return;}
  editando=String(getTxRow(t));
  editandoFecha=t[0];
  // La edición parte de su categoría original, sin heredar otra operación
  // ni los chips del formulario de presupuestos.
  document.querySelectorAll('#catChips .cchip').forEach(c=>c.classList.remove('selected'));
  document.getElementById('modalTitle').textContent='Editar transacción';
  document.getElementById('modalBtns').innerHTML=`<button class="btn btn-d" onclick="eliminar()">Eliminar</button><button class="btn btn-s" onclick="cerrarM()">Cancelar</button><button class="btn btn-p" onclick="guardar()">Guardar</button>`;
  const f=pf(t[0]);
  const yyyy=f.getFullYear();const mm=String(f.getMonth()+1).padStart(2,'0');const dd=String(f.getDate()).padStart(2,'0');
  document.getElementById('iFec').value=yyyy+'-'+mm+'-'+dd;
  // En divisa se edita el importe original, no el equivalente en soles: ese lo
  // vuelve a derivar el servidor. El tipo de cambio es el que se guardó, nunca
  // el promedio de hoy (decisión: no recalcular movimientos históricos).
  const enDivisa=t[9]==='USD'&&Number(t[10])>0;
  document.getElementById('iMon').value=enDivisa?t[10]:t[4];
  document.getElementById('iDes').value=t[1];
  const mon=document.getElementById('iMoneda');if(mon){mon.value=enDivisa?'USD':'PEN';mon.disabled=false;}
  const campoTc=document.getElementById('iTc');
  if(campoTc){campoTc.value=enDivisa&&t[11]?t[11]:'';delete campoTc.dataset.tcHistoricoId;}
  const mdest=document.getElementById('iMonDestino');if(mdest)mdest.value=Number(t[14])>0?t[14]:'';
  setTcFuente(t[12]||'manual');
  // Sincronizar una sola vez, cuando estén las cuentas de esta fila: el
  // formulario anterior puede tener otra moneda y borrar el TC o el destino.
  setTipo(t[3]||'Gasto',false);
  prepararCobro(t);
  if(t[3]==='Reembolso')llenarGastosReembolso(t[8]||'');
  const matchedCard=CREDIT_CARDS.find(c=>sameAccount(c.cuenta,t[5]||''));
  llenarCuentas(matchedCard?matchedCard.cuenta:(t[5]||''),t[7]||'');
  sincronizarCamposMoneda();
  // Pre-seleccionar categoría
  const cn=cleanName(t[2]);
  document.querySelectorAll('#catChips .cchip').forEach(c=>{
    c.classList.toggle('selected',norm(cleanName(c.dataset.cat))===norm(cn));
  });
  document.getElementById('modal').classList.add('active');
}

export function cerrarM(forzar=false){if(guardandoTx&&!forzar)return;document.getElementById('modal').classList.remove('active','modo-cobro');editando=null;editandoFecha=null;}

export function setTipo(t,sincronizar=true){
  if(guardandoTx)return;
  const original=sincronizar&&t==='Reembolso'&&editando
    ?datos.transacciones.find(x=>String(x[6])===String(editando)&&x[3]==='Gasto'):null;
  if(original){
    // Cambiar a Reembolso desde un consumo inicia una devolución nueva.
    // La compra original sigue existiendo y queda elegida como vínculo.
    editando=null;editandoFecha=null;
    document.getElementById('modalTitle').textContent='Registrar reembolso';
    document.getElementById('modalBtns').innerHTML='<button class="btn btn-s" onclick="cerrarM()">Cancelar</button><button class="btn btn-p" onclick="guardar()">Guardar</button>';
    document.getElementById('iFec').value=toDateInput(new Date());
    document.getElementById('iDes').value='Reembolso · '+original[1];
  }
  tipoA=t;
  document.getElementById('tg').classList.toggle('active',t==='Gasto');
  document.getElementById('ti').classList.toggle('active',t==='Ingreso');
  document.getElementById('tr').classList.toggle('active',t==='Transferencia');
  document.getElementById('tre').classList.toggle('active',t==='Reembolso');
  document.getElementById('refundFields').hidden=t!=='Reembolso';
  if(t==='Reembolso')llenarGastosReembolso(original?String(original[6]):document.getElementById('iGastoOrigen').value);
  document.getElementById('transferFields').hidden=t!=='Transferencia';
  const cobrar=document.getElementById('cobrarFields');if(cobrar)cobrar.hidden=t!=='Gasto';
  document.getElementById('catChips').hidden=t==='Transferencia'||t==='Reembolso';
  document.getElementById('accountLabel').textContent=t==='Transferencia'?'Origen':t==='Reembolso'?'Recibido en':'Cuenta';
  llenarCuentas();
  if(original&&CREDIT_CARDS.some(card=>sameAccount(card.cuenta,original[5]))){
    const efectivo=cuentasApp().filter(c=>!c[3]&&c[1]!=='inversion'&&c[2]==='PEN');
    const preferida=sameAccount(original[5],'Visa iO')?'Yape':'Plin';
    llenarCuentas(efectivo.find(c=>sameAccount(c[0],preferida))?.[0]||efectivo[0]?.[0]||original[5]);
  }
  llenarSel();
  if(sincronizar)sincronizarCamposMoneda();
  if(t==='Reembolso')seleccionarGastoReembolso();
  precargarCobroReembolso();
}

async function eliminar__base(){
  if(guardandoTx)return;
  const t=datos.transacciones.find(x=>String(getTxRow(x))===String(editando));
  const deudas=t?deudasDeGasto(t[6]):[],archivadas=t?(datos.deudasArchivadas||[]).filter(d=>d[10]&&String(d[10])===String(t[6])):[];
  if(!confirm(deudas.length?'¿Eliminar esta transacción? También se quitará lo que te '+(deudas.length>1&&new Set(deudas.map(d=>norm(d[1]))).size>1?'deben esas personas':'debe '+(deudas[0][1]||'esa persona'))+'.':'¿Eliminar esta transacción?'))return;
  // Lo que el borrado arrastra en Supabase (ciclo elegido a mano, deuda por
  // cobrar, vínculo de un abono), para reponerlo si se deshace.
  const copia=t?[...t]:null;
  const ciclos=t?(datos.ciclosOverride||[]).filter(c=>String(c[2])===String(t[6])).map(c=>({id:c[0],tarjeta:c[1],tx_id:c[2],ciclo_key:c[3]})):[];
  const abonos=t?(datos.deudasAbonos||[]).filter(a=>String(a[5])===String(t[6])).map(a=>a[0]):[];
  try{
    await sbDelete('transacciones',editando);
    datos.transacciones=datos.transacciones.filter(x=>String(getTxRow(x))!==String(editando));
    datos.deudas=datos.deudas.filter(d=>!deudas.includes(d));
    datos.deudasArchivadas=datos.deudasArchivadas.filter(d=>!archivadas.includes(d));
    cerrarM();render();
    if(!copia?.[6]){toast('Eliminada','success');return;}
    ofrecerDeshacer(etiquetaTx(copia[3],'eliminad'),async()=>{
      await sbInsert('transacciones',cuerpoTx(copia));
      for(const c of ciclos)await sbInsert('ciclos_override',c);
      for(const d of deudas)await sbInsert('deudas',cuerpoDeuda(d));
      for(const d of archivadas)await sbInsert('deudas',cuerpoDeuda(d,true));
      for(const id of abonos)await sbUpdate('deudas_abonos',id,{tx_id:copia[6]});
    });
  }
  catch(e){toast(e.message||'Error al eliminar','error');}
}

// "Gasto guardado", "Transferencia eliminada"...
function etiquetaTx(tipo,accion){
  const nombre={Gasto:'Gasto',Ingreso:'Ingreso',Transferencia:'Transferencia',Reembolso:'Reembolso'}[tipo]||'Movimiento';
  return nombre+' '+accion+(tipo==='Transferencia'?'a':'o');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const eliminar=guardedOnce(eliminar__base);

// Categoría de una transferencia: la deciden las cuentas, no los chips.
// La categoría histórica 'Inversiones' (ingresos) no se toca.
function categoriaTransferencia(origen,destino){
  const dst=cuentaPorNombre(destino),org=cuentaPorNombre(origen);
  if(dst&&dst[1]==='inversion')return 'Inversión '+dst[0];
  if(org&&org[1]==='inversion')return 'Retiro '+org[0];
  // Cambiar de moneda entre dos cuentas que no son de inversión: compra o
  // venta de dólares, no una transferencia genérica. Entre dos cuentas de la
  // misma moneda (incluido USD → USD) no hay nada que nombrar aparte.
  const mo=monedaCuenta(origen),md=monedaCuenta(destino);
  if(mo==='PEN'&&md==='USD')return 'Compra Dólares';
  if(mo==='USD'&&md==='PEN')return 'Venta de Dólares';
  return 'Transferencias';
}

let guardandoTx=false;

async function guardar__base(){
  if(guardandoTx)return;
  if(tipoA==='Reembolso'&&!editando&&document.getElementById('iCobrar')?.checked)return guardarCobroPendiente();
  try{validarCuentasDisponibles();}catch(e){toast(e.message,'error');return;}
  const m=Number(document.getElementById('iMon').value);
  const d=document.getElementById('iDes').value;
  let c=getCatSeleccionada();
  const origenReembolso=document.getElementById('iGastoOrigen').value;
  const cu=document.getElementById('iCue').value.trim();
  const destino=document.getElementById('iDestino').value.trim();
  if(tipoA==='Transferencia')c=categoriaTransferencia(cu,destino);
  const fec=document.getElementById('iFec').value;
  if(!Number.isFinite(m)||m<=0||!d.trim()||!fec){toast('Completa fecha, monto positivo y descripción','error');return;}
  if(tipoA==='Transferencia'){
    try{validarTransferencia({origen:cu,destino,monto:m});}catch(e){toast(e.message,'error');return;}
    if(editando&&datos.deudasAbonos.some(a=>String(a[5])===String(editando))){toast('Este movimiento está vinculado a un abono de deuda','error');return;}
  }
  let gastoOrigen=null;
  if(tipoA==='Reembolso'){try{gastoOrigen=validarReembolso(origenReembolso,0,cu,fec,editando);c=gastoOrigen[2];}catch(e){toast(e.message,'error');return;}}
  if(!c){toast('Selecciona una categoría','error');return;}
  const[yy,mm,dd]=fec.split('-');
  const fmtHora=(h,min)=>{const ampm=h>=12?'p. m.':'a. m.';return `${h%12||12}:${String(min).padStart(2,'0')} ${ampm}`;};
  const ahoraHora=()=>{const n=new Date();return fmtHora(n.getHours(),n.getMinutes());};
  let timePart=ahoraHora();
  if(editando&&editandoFecha){
    const orig=String(editandoFecha);
    if(orig.includes('T')){
      const od=new Date(orig);
      if(!isNaN(od))timePart=fmtHora(od.getHours(),od.getMinutes());
    } else if(orig.includes(',')){
      const raw=orig.substring(orig.indexOf(',')+1).trim();
      if(raw.includes('p. m.')||raw.includes('a. m.')){
        timePart=raw;
      } else {
        const[hh,mn]=(raw||'').split(':');
        const h=parseInt(hh);if(!isNaN(h))timePart=fmtHora(h,parseInt(mn)||0);
      }
    }
  }
  let fechaISO=buildFechaISO(yy,mm,dd,timePart);
  if(editando&&editandoFecha&&toDateInput(editandoFecha)===fec)fechaISO=editandoFecha;
  // Multimoneda. Los seis campos se mandan siempre, también en null, para que
  // pasar un movimiento de US$ a S/ los limpie en lugar de dejar restos.
  // El equivalente en soles que se manda es solo un punto de partida: lo
  // recalcula el trigger derivar_importes_moneda y se relee de la respuesta.
  // Incluye la transferencia que sale de una cuenta en dólares: su importe es
  // en dólares y su equivalente en soles lo deriva el servidor.
  const enDivisa=monedaTx()==='USD';
  const distintaMoneda=tipoA==='Transferencia'&&!!destino&&monedaCuenta(destino)!==monedaCuenta(cu);
  let equivalente=m,tcUsado=null,montoDestino=null;
  if(enDivisa){
    tcUsado=Number(elv('iTc'));
    if(!Number.isFinite(tcUsado)||tcUsado<=0){toast('Escribe el tipo de cambio','error');return;}
    equivalente=equivalenteSoles(elv('iMon'),elv('iTc'));
    if(!(equivalente>0)){toast('El equivalente en soles queda en cero: revisa el importe o el tipo de cambio','error');return;}
  }
  // El importe que entra es opcional a propósito. En una compra de dólares lo
  // sabes al momento, pero un aporte a IBKR no: los dólares que acreditó el
  // bróker llegan después. Dejarlo vacío deja el movimiento pendiente de
  // conciliar (monto_destino null) en vez de obligar a inventar una cifra.
  if(distintaMoneda&&elv('iMonDestino')){
    montoDestino=Number(elv('iMonDestino'));
    if(!Number.isFinite(montoDestino)||montoDestino<=0){toast('El importe que entra debe ser mayor que cero','error');return;}
  }
  const body={fecha:fechaISO,descripcion:d,categoria:c,tipo:tipoA,monto:equivalente,cuenta:cu,
    moneda_original:enDivisa?'USD':null,
    monto_original:enDivisa?m:null,
    tc:enDivisa?tcUsado:null,
    tc_fuente:enDivisa?tcFuenteActual:(montoDestino?'transferencia':null),
    moneda_destino:montoDestino?monedaCuenta(destino):null,
    monto_destino:montoDestino||null};
  const anterior=datos.transacciones.find(x=>String(getTxRow(x))===String(editando));
  if(tipoA==='Transferencia'||anterior?.[3]==='Transferencia')body.cuenta_destino=tipoA==='Transferencia'?destino:null;
  const idGuardado=editando;
  const deudaAntes=idGuardado&&anterior?.[3]==='Gasto'?deudaDeGasto(idGuardado):null;
  if(deudaAntes&&tipoA!=='Gasto'){toast('Este gasto está por cobrar a '+(deudaAntes[1]||'otra persona')+'. Quita la deuda en Deudas antes de cambiar el tipo.','error');return;}
  let cobro=null;
  try{cobro=leerCobro(equivalente,deudaAntes,anterior);}catch(e){toast(e.message,'error');return;}
  // Copia de la fila antes de guardar: la edición la muta en sitio.
  const copiaAnterior=anterior?[...anterior]:null;
  if(tipoA==='Reembolso'||anterior?.[3]==='Reembolso')body.transaccion_origen_id=tipoA==='Reembolso'?origenReembolso:null;
  let loteReembolso=null;
  // En un gasto dividido, la devolución puede decir quién pagó. Lo que pase de
  // lo que esa persona debía se guarda como ingreso extra.
  const deudaPago=gastoOrigen&&!idGuardado?deudaElegidaReembolso():null;
  if(deudaPago)body.deuda_id=deudaPago[0];
  if(gastoOrigen){
    const pendiente=deudaPago?Math.min(pendienteReembolso(gastoOrigen,idGuardado),pendienteDeuda(deudaPago)):pendienteReembolso(gastoOrigen,idGuardado);
    if(Math.round(equivalente*100)>Math.round(pendiente*100)){
      if(idGuardado){toast('La devolución supera el importe pendiente. Registra el dinero adicional como un nuevo ingreso.','error');return;}
      if(CREDIT_CARDS.some(card=>sameAccount(card.cuenta,cu))){toast('Para el excedente, elige la cuenta donde recibiste el dinero. El pago a la tarjeta se registra en Tarjetas.','error');return;}
      loteReembolso=dividirReembolso(body,pendiente);
    }else{
      try{validarReembolso(origenReembolso,equivalente,cu,fec,idGuardado);}catch(e){toast(e.message,'error');return;}
    }
  }
  guardandoTx=true;
  const usuarioGuardado=sessionUserId();
  const controles=[...document.querySelectorAll('#modal input,#modal select,#modal button')];
  const estados=controles.map(el=>el.disabled);
  controles.forEach(el=>{el.disabled=true;});
  document.getElementById('modal').setAttribute('aria-busy','true');
  try{
    // La deuda se escribe después del movimiento: si falla, el movimiento ya
    // quedó bien y se avisa para volver a marcarlo, sin duplicar dinero.
    let cambioDeuda=null,falloDeuda=null,mensaje,revertir;
    const cobrar=async gasto=>{try{cambioDeuda=await sincronizarCobro(gasto,cobro,deudaAntes,fec);}catch(e){falloDeuda=e;}};
    if(idGuardado){
      // Se relee la fila que devuelve el servidor: el equivalente en soles y el
      // tipo de cambio de una compra los calcula él, no el navegador. Se muta
      // en sitio en lugar de reemplazar el arreglo, porque hay código que
      // conserva la referencia a la fila.
      const row=await sbUpdate('transacciones',idGuardado,body);
      if(sessionUserId()!==usuarioGuardado)throw new Error('La sesión cambió durante el guardado.');
      const t=datos.transacciones.find(x=>String(getTxRow(x))===String(idGuardado));
      const guardada=row&&row.id?row:Object.assign({},body,{id:idGuardado});
      if(t){const n=filaTx(guardada);for(let i=0;i<n.length;i++)t[i]=n[i];}
      await cobrar(guardada);
      mensaje='Cambios guardados';
      revertir=copiaAnterior?.[6]?async()=>{
        const deuda=cambioDeuda;
        if(deuda?.creada)await sbDelete('deudas',deuda.creada);
        await sbUpdate('transacciones',idGuardado,sinIdTx(cuerpoTx(copiaAnterior)));
        if(deuda?.borrada)await sbInsert('deudas',cuerpoDeuda(deuda.antes));
        else if(deuda?.antes){const a=deuda.antes;await sbUpdate('deudas',a[0],{persona:a[1],descripcion:a[2],monto:Number(a[3]),fecha_inicio:a[5]});}
      }:null;
    } else if(loteReembolso){
      const filas=await guardarReembolsoConExcedente(loteReembolso);
      if(sessionUserId()!==usuarioGuardado)throw new Error('La sesión cambió durante el guardado.');
      filas.forEach(row=>{if(!datos.transacciones.some(t=>String(t[6])===String(row.id)))datos.transacciones.push(filaTx(row));});
      mensaje='Reembolso e ingreso adicional guardados';
      revertir=async()=>{for(const row of filas)await sbDelete('transacciones',row.id);};
    } else {
      const row=await sbInsert('transacciones',body);
      if(sessionUserId()!==usuarioGuardado)throw new Error('La sesión cambió durante el guardado.');
      datos.transacciones.push(filaTx(row));
      await cobrar(row);
      mensaje=etiquetaTx(tipoA,'guardad');
      // Borrar el gasto borra en cascada la deuda que se creó con él.
      revertir=async()=>{await sbDelete('transacciones',row.id);};
    }
    const deudaNueva=cambioDeuda?.creada?datos.deudas.find(d=>String(d[0])===String(cambioDeuda.creada)):null;
    if(deudaNueva)mensaje+=' · '+deudaNueva[1]+' te debe '+fmt(deudaNueva[3]);
    cerrarM(true);render();
    if(revertir)ofrecerDeshacer(mensaje,revertir);else toast(mensaje,'success');
    if(falloDeuda)toast('Se guardó el movimiento, pero no lo que te deben: '+(falloDeuda.message||'error')+'. Ábrelo y vuelve a marcarlo.','error');
  }
  catch(e){toast(/cuenta_destino|transaccion_origen_id|transacciones_tipo_check|schema cache/i.test(e.message||'')?'Falta activar movimientos en Supabase. Ejecuta el SQL de transferencias y reembolsos.':(e.message||'Error al guardar'),'error');}
  finally{guardandoTx=false;controles.forEach((el,i)=>{el.disabled=estados[i];});document.getElementById('modal').setAttribute('aria-busy','false');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardar=guardedOnce(guardar__base);

// Gasto efectivo: para un Gasto, el importe original menos todos sus
// reembolsos vinculados (sin importar en qué fecha llegaron). Un Reembolso no
// suma ni resta nada por sí mismo: su efecto ya está plegado en el gasto
// original, así que nunca aparece como un "gasto negativo" independiente en
// el período en que se recibió el dinero.
//
// Un gasto por cobrar (lo pagaste por otra persona) tampoco es tuyo mientras
// la deuda siga activa: se resta lo que te deben o lo ya devuelto, lo mayor.
// gastoNetoHasta sigue el dinero real y no resta lo que aún no llega.
export function gastoNeto(t){
  if(t[3]!=='Gasto')return 0;
  return netoCentimos(Math.round((Number(t[4])||0)*100),devueltoCentimos(t[6]),cubiertoPorDeudas(t[6]))/100;
}

export function gastoNetoHasta(t,hasta){
  if(t[3]!=='Gasto')return 0;
  const reemb=datos.transacciones.filter(x=>x[3]==='Reembolso'&&String(x[8])===String(t[6])&&pf(x[0])<=hasta)
    .reduce((sum,x)=>sum+Math.round(Number(x[4])*100),0)/100;
  return Math.round(((Number(t[4])||0)-reemb)*100)/100;
}

// Movimiento de caja real: a diferencia de gastoNeto (que pliega el
// reembolso en el gasto original para estadísticas), esto es lo que
// efectivamente entra o sale de una cuenta, en su propia fecha.
export function efectoResultado(t){
  if(t[3]==='Ingreso'||t[3]==='Reembolso')return Number(t[4])||0;
  if(t[3]==='Gasto')return -(Number(t[4])||0);
  return 0;
}

// Reembolsos vinculados a un gasto (excluyendo opcionalmente uno, típicamente
// el que se está editando, para no contarlo dos veces).
export function reembolsosDe(id,excluir=null){return datos.transacciones.filter(t=>t[3]==='Reembolso'&&String(t[8])===String(id)&&String(t[6])!==String(excluir));}

// Total reembolsado de un gasto.
export function reembolsado(id,excluir=null){return reembolsosDe(id,excluir).reduce((sum,t)=>sum+Math.round(Number(t[4])*100),0)/100;}

// Importe pendiente de devolver de un gasto.
function pendienteReembolso(t,excluir=null){return Math.max(0,Math.round((Number(t[4])-reembolsado(t[6],excluir))*100)/100);}

// Gasto efectivo de un gasto (alias legible de gastoNeto para este caso).
function gastoEfectivo(t){return gastoNeto(t);}

// Si el reembolso se acreditó a una tarjeta (reduce deuda) o llegó a una
// cuenta de efectivo/banco (aumenta saldo disponible).
function reembolsoEsTarjeta(t){return t[3]==='Reembolso'&&CREDIT_CARDS.some(c=>sameAccount(c.cuenta,t[5]));}

function llenarGastosReembolso(selected=''){
 const select=document.getElementById('iGastoOrigen');
 let candidatos=datos.transacciones.filter(t=>t[3]==='Gasto'&&String(t[6])!==String(editando));
 if(vista==='mes'){
   const ma=getMesActivo();
   candidatos=candidatos.filter(t=>{const f=pf(t[0]);return f.getMonth()===ma.getMonth()&&f.getFullYear()===ma.getFullYear();});
 }
 candidatos=candidatos.filter(t=>pendienteReembolso(t,editando)>0.004||String(t[6])===String(selected));
 // Al editar, el gasto vinculado se ve aunque esté fuera del período o ya
 // haya quedado completamente reembolsado.
 if(selected&&!candidatos.some(t=>String(t[6])===String(selected))){
   const vinculado=datos.transacciones.find(t=>t[3]==='Gasto'&&String(t[6])===String(selected));
   if(vinculado)candidatos=[vinculado,...candidatos];
 }
 candidatos.sort((a,b)=>pf(b[0])-pf(a[0]));
 select.innerHTML=candidatos.length===0
   ? '<option value="">No hay gastos pendientes de reembolso en este período.</option>'
   : '<option value="">Selecciona el gasto original…</option>'+candidatos.map(t=>{const deudas=deudasDeGasto(t[6]),varias=new Set(deudas.map(d=>norm(d[1]))).size>1;return `<option value="${escAttr(t[6])}">${escHtml(fmtDateShort(pf(t[0]))+' · '+t[1]+' · '+fmt(t[4])+' · pendiente '+fmt(pendienteReembolso(t,editando))+' · '+t[5]+(deudas.length?' · por cobrar a '+(varias?deudas.length+' personas':deudas[0][1]):''))}</option>`;}).join('');
 select.value=selected; select.disabled=!!selected&&!!editando&&datos.transacciones.some(t=>String(t[6])===String(editando)&&t[3]==='Reembolso');
 seleccionarGastoReembolso();
}

export function seleccionarGastoReembolso(cambioOrigen=false){
 if(tipoA!=='Reembolso')return;
 if(cambioOrigen===true)precargarCobroReembolso();
 const original=datos.transacciones.find(t=>String(t[6])===document.getElementById('iGastoOrigen').value);
 const deudaPago=original&&!editando?deudaElegidaReembolso():null;
 const pendiente=original?deudaPago?Math.min(pendienteReembolso(original,editando),pendienteDeuda(deudaPago)):pendienteReembolso(original,editando):0;
 let mensaje=original?(deudaPago?'Te debe '+(deudaPago[1]||'esta persona')+': ':'Pendiente de devolver: ')+fmt(pendiente):'Selecciona un gasto para vincular la devolución.';
 const monto=Number(elv('iMon')),tc=Number(elv('iTc'));
 const equivalente=monedaTx()==='USD'?tc>0?equivalenteSoles(elv('iMon'),elv('iTc')):0:monto;
 if(original&&!editando&&Number.isFinite(equivalente)&&equivalente>pendiente){
   const reparto=dividirReembolso({monto:equivalente,moneda_original:monedaTx()==='USD'?'USD':null,monto_original:monto,tc},pendiente);
   const devuelto=reparto.filter(r=>r.tipo==='Reembolso').reduce((s,r)=>s+r.monto,0),adicional=reparto.find(r=>r.tipo==='Ingreso')?.monto||0;
   mensaje=`Se guardará ${fmt(devuelto)} como reembolso y ${fmt(adicional)} como ingreso adicional.`;
 }
 document.getElementById('refundAvailable').textContent=mensaje;
 // Solo propone la cuenta del gasto como punto de partida si todavía no hay
 // ninguna elegida: nunca pisa una cuenta receptora que el usuario ya marcó
 // (p. ej. Yape, para un gasto pagado con otra tarjeta).
 const cue=document.getElementById('iCue');
 if(original&&cue&&!cue.value)llenarCuentas(original[5]||'');
}

function dividirReembolso(body,pendiente){
 const limite=Math.max(0,Math.round(pendiente*100));
 let devuelto=Math.min(limite,Math.round(body.monto*100))/100,nominal=null,extraNominal=null;
 if(body.moneda_original==='USD'){
   const total=Math.round(body.monto_original*100);
   let centimos=Math.min(total,Math.max(0,Math.floor(limite/body.tc)));
   while(centimos>0&&Math.round(equivalenteSoles((centimos/100).toFixed(2),String(body.tc))*100)>limite)centimos--;
   while(centimos<total&&Math.round(equivalenteSoles(((centimos+1)/100).toFixed(2),String(body.tc))*100)<=limite)centimos++;
   nominal=centimos/100;extraNominal=(total-centimos)/100;
   devuelto=equivalenteSoles(nominal.toFixed(2),String(body.tc));
 }
 const ingreso={...body,tipo:'Ingreso',categoria:'Otros ingresos',descripcion:'Excedente de '+(body.descripcion||'reembolso'),
   monto:body.moneda_original==='USD'?equivalenteSoles(extraNominal.toFixed(2),String(body.tc)):Math.round((body.monto-devuelto)*100)/100,
   monto_original:body.moneda_original==='USD'?extraNominal:null,transaccion_origen_id:null,cuenta_destino:null,
   ...(body.deuda_id!==undefined?{deuda_id:null}:{})};
 const refund={...body,tipo:'Reembolso',monto:devuelto,monto_original:body.moneda_original==='USD'?nominal:null,cuenta_destino:null};
 return devuelto>0?[refund,ingreso]:[ingreso];
}

function validarReembolso(id,monto,cuenta,fecha,excluir=null){
 const original=datos.transacciones.find(t=>String(t[6])===String(id)&&t[3]==='Gasto');
 if(!original)throw new Error('Selecciona un gasto original válido');
 if(Math.round(monto*100)+Math.round(reembolsado(id,excluir)*100)>Math.round(Number(original[4])*100))throw new Error('La devolución supera el importe pendiente del gasto');
 if(!cuenta.trim())throw new Error('Indica la cuenta que recibió la devolución');
 if(pf(fecha)<new Date(pf(original[0]).getFullYear(),pf(original[0]).getMonth(),pf(original[0]).getDate()))throw new Error('La devolución no puede ser anterior al gasto');
 return original;
}

export function totales(tx){
  let i=0,g=0;tx.forEach(t=>{const m=parseFloat(t[4])||0;if(t[3]==='Ingreso')i+=m;g+=gastoNeto(t);});
  return{i,g,bal:i-g};
}

export function gastosPorCat(tx){
  const c={};
  tx.forEach(t=>{if(gastoNeto(t)!==0){const k=cleanName(t[2]);c[k]=(c[k]||0)+gastoNeto(t);}});
  return c;
}

export function sameAccount(a,b){return norm(a)===norm(b);}

export function getTxRow(t){return t[6] || `${t[0]}_${t[1]}_${t[4]}_${t[5]}`;}
