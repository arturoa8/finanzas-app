// Deudas y abonos.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentasApp} from './accounts.js';
import {CREDIT_CARDS} from './cards/config.js';
import {render} from './dashboard.js';
import {archivarFila, cobradoDeuda, cobrosDeGasto, deudasDeGasto, desarchivarFila, devueltoCentimos, filaDeuda, gastoDeDeuda, pendienteDeuda, planCuotas, sumarMeses} from './por-cobrar.js';
import {cargar, cuerpoTx, editarTx, getTxRow, sameAccount} from './transactions.js';
import {sbDelete, sbInsert, sbUpdate} from '../services/supabase.js';
import {abonoPendiente, ejecutarAbono} from '../services/debt-operations.js';
import {guardarReembolsoConExcedente} from '../services/refund-operations.js';
import {datos} from '../state.js';
import {ofrecerDeshacer} from '../ui/deshacer.js';
import {toast} from '../ui/toast.js';
import {guardedOnce} from '../utils/async.js';
import {buildFechaISO, fmtDateShort, pf, toDateInput} from '../utils/dates.js';
import {escAttr, escHtml, fmtC, fmtD, norm} from '../utils/formatters.js';

// Pestana activa de deudas. La escribe setDT(), aqui mismo.
export let dT='me-deben';

let editandoDeuda=null,abonosDeudaId=null,archivarDeudaId=null,deudaTipoModal='me-deben';

let editandoAbonoId=null,historialDeudaId=null;
let solicitudAbonoId=null,solicitudAbonoTxId=null;
// Cobro de un gasto por cobrar que se está corrigiendo (id del Reembolso).
let editandoCobroId=null;
const cent=n=>Math.round((Number(n)||0)*100);
function avisarErrorAbono(e){
  const mensaje=e.message||'No se pudo guardar el abono';toast(mensaje,'error');
  if(e.pending){const aviso=document.getElementById('dataStatus');if(aviso){aviso.hidden=false;aviso.textContent=mensaje;}}
}

// Texto del estado de una deuda según su vencimiento: "Venció hace 3 días",
// "Vence hoy", "Vence en 5 días". `dias` cuenta desde el comienzo de hoy.
function estadoVencimiento(dias){
  const dd=n=>n+' día'+(n===1?'':'s');
  if(dias<0)return {tono:'vencida',texto:'Venció hace '+dd(-dias)};
  if(dias===0)return {tono:'pronto',texto:'Vence hoy'};
  if(dias===1)return {tono:'pronto',texto:'Vence mañana'};
  return {tono:dias<=7?'pronto':'',texto:'Vence en '+dd(dias)};
}

const fechaCorta=iso=>fmtDateShort(pf(iso)).replace(/\.$/,'');

// Resumen de la pestaña: cuánto es en total y qué pide atención. Explica en una
// frase qué significa la pestaña, para quien no la recuerda.
function resumenDeudas(esMeDeben,filas){
  const total=filas.reduce((s,f)=>s+f.pendiente,0);
  const vencidas=filas.filter(f=>f.vencida).length;
  const pronto=filas.filter(f=>f.warnVenc).length;
  const avisos=[];
  if(vencidas)avisos.push(`<span class="dresumen-aviso vencida">${vencidas} vencida${vencidas===1?'':'s'}</span>`);
  if(pronto)avisos.push(`<span class="dresumen-aviso pronto">${pronto} por vencer</span>`);
  return `<div class="dresumen ${esMeDeben?'in':'out'}">
    <div class="dresumen-lbl">${esMeDeben?'Te deben en total':'Debes en total'}</div>
    <div class="dresumen-amt">${fmtD(total)}</div>
    <div class="dresumen-meta"><span>${filas.length} deuda${filas.length===1?'':'s'}</span>${avisos.join('')}</div>
    <p class="dresumen-ayuda">${esMeDeben?'Dinero que prestaste o pagaste por otros y todavía no te devuelven.':'Dinero que tú le debes a otras personas.'}</p>
  </div>`;
}

export function renderDeb(){
  const l=document.getElementById('debs');
  if(dT==='archivadas'){renderDebArchivadas(l);return;}
  const esMeDeben=dT==='me-deben';
  const activas=(datos.deudas||[]).filter(d=>(d[7]||'').toString().toLowerCase()===dT);
  if(activas.length===0){
    l.innerHTML=`<div class="empty empty-deudas"><strong>${esMeDeben?'Nadie te debe nada':'No le debes nada a nadie'}</strong><span>${esMeDeben?'Cuando prestes dinero o pagues algo por otra persona, anótalo aquí para no olvidarte de cobrarlo.':'Si alguien te presta dinero o paga algo por ti, anótalo aquí para saber cuánto devolver.'}</span><button type="button" class="btn btn-p" onclick="abrirModalDeuda()">Registrar una deuda</button></div>`;
    return;
  }
  activas.sort((a,b)=>{
    const fa=a[6]?pf(toDateInput(a[6])):null;
    const fb=b[6]?pf(toDateInput(b[6])):null;
    if(!fa&&!fb){
      // ambas sin vencimiento: ordenar por FechaInicio ascendente
      const ia=a[5]?pf(toDateInput(a[5])):null;
      const ib=b[5]?pf(toDateInput(b[5])):null;
      if(!ia&&!ib)return 0;if(!ia)return 1;if(!ib)return -1;return ia-ib;
    }
    if(!fa)return 1;if(!fb)return -1;
    const diff=fa-fb;
    if(diff!==0)return diff;
    // misma FechaVenc: ordenar por FechaInicio ascendente (el más antiguo primero)
    const ia=a[5]?pf(toDateInput(a[5])):null;
    const ib=b[5]?pf(toDateInput(b[5])):null;
    if(!ia&&!ib)return 0;if(!ia)return 1;if(!ib)return -1;return ia-ib;
  });
  const ahora=new Date();
  const hoy=new Date(ahora.getFullYear(),ahora.getMonth(),ahora.getDate());
  const filas=activas.map(d=>{
    const id=String(d[0]);
    const monto=parseFloat(d[3])||0;
    const abonado=d[8]?cobradoDeuda(d):(datos.deudasAbonos||[]).filter(ab=>_abDeudaId(ab)===id).reduce((s,ab)=>s+_abMonto(ab),0);
    const pendiente=Math.max(0,monto-abonado);
    const fvVal=toDateInput(d[6]);
    const fvDate=fvVal?pf(fvVal):null;
    const dias=fvDate?Math.round((fvDate-hoy)/86400000):null;
    return {d,id,monto,abonado,pendiente,fiVal:toDateInput(d[5]),fvVal,dias,
      vencida:dias!==null&&dias<0&&pendiente>0,warnVenc:dias!==null&&dias>=0&&dias<=7&&pendiente>0};
  });
  l.innerHTML=resumenDeudas(esMeDeben,filas)+filas.map(({d,id,monto,abonado,pendiente,fiVal,fvVal,dias,vencida,warnVenc})=>{
    // Un gasto por cobrar se salda con reembolsos del gasto, no con abonos.
    const gasto=d[8]?gastoDeDeuda(d):null;
    // Gasto dividido entre varias personas: cuántas son (las cuotas ya lo dicen
    // en la descripción).
    const companeras=gasto?deudasDeGasto(d[8]):[];
    const entre=new Set(companeras.map(x=>norm(x[1]))).size>1?' · entre '+companeras.length:'';
    const pct=monto>0?Math.min(100,Math.round(abonado/monto*100)):0;
    const cls=esMeDeben?'in':'out';
    const estado=dias!==null&&pendiente>0?estadoVencimiento(dias):null;
    const lblFalta=esMeDeben?'Falta cobrar':'Falta pagar';
    const frase=esMeDeben?(d[8]?'Ya te devolvieron ':'Ya te pagaron '):'Ya pagaste ';
    return `<div class="dcard${vencida?' vencida':''}">
      <div class="dcard-top">
        <div class="dcard-info">
          <div class="dcard-person">${escHtml(d[1]||'?')}</div>
          <div class="dcard-desc">${escHtml(d[2]||'')}</div>
          ${gasto?`<div class="dcard-origen">Pagaste ${fmtD(gasto[4])} con ${escHtml(gasto[5]||'—')} · ${fmtDateShort(pf(gasto[0]))}${entre}</div>`:''}
        </div>
        <div class="dcard-right">
          <div class="dcard-amt-lbl">${lblFalta}</div>
          <div class="dcard-amt ${cls}">${fmtD(pendiente)}</div>
        </div>
      </div>
      ${abonado>0?`<div class="dcard-prog">
        <div class="dcard-progbar"><div class="dcard-progfill ${cls}" style="width:${pct}%"></div></div>
        <div class="dcard-progmeta"><span>${frase}${fmtD(abonado)} de ${fmtD(monto)}</span><span>${pct}%</span></div>
      </div>`:''}
      <div class="dcard-fechas">
        <label class="dcard-fecha${estado?' '+estado.tono:''}">
          <span class="dcard-fecha-txt"><b>${estado?(estado.tono==='vencida'?'⚠ ':'')+estado.texto:(fvVal?'Vence':'Sin fecha límite')}</b>${fvVal?' · '+fechaCorta(fvVal):''}</span>
          ${fvVal?'':'<span class="dcard-fecha-add">Poner fecha</span>'}
          <input type="date" value="${fvVal}" aria-label="Fecha límite" onclick="try{this.showPicker()}catch(e){}" onchange="editarFechaDeuda('${id}','venc',this.value)">
        </label>
        <label class="dcard-fecha dcard-fecha-inicio">
          <span class="dcard-fecha-txt">Desde ${fiVal?fechaCorta(fiVal):'—'}</span>
          <input type="date" value="${fiVal}" aria-label="Fecha de inicio" onclick="try{this.showPicker()}catch(e){}" onchange="editarFechaDeuda('${id}','inicio',this.value)">
        </label>
      </div>
      <div class="dcard-actions">
        <button class="dcard-btn primary" onclick="abrirModalAbono('${id}')">${esMeDeben?'Cobrar':'Registrar pago'}</button>
        <button class="dcard-link" onclick="abrirHistorialAbonos('${id}')">Historial</button>
        <button class="dcard-link" onclick="${gasto?`editarGastoDeDeuda('${id}')`:`abrirModalDeudaEdit('${id}')`}">Editar</button>
        <button class="dcard-link" onclick="abrirModalArchivar('${id}')">Archivar</button>
      </div>
    </div>`;
  }).join('');
}

function renderDebArchivadas(l){
  const arch=datos.deudasArchivadas||[];
  if(arch.length===0){l.innerHTML='<div class="empty">Sin deudas archivadas</div>';return;}
  l.innerHTML=[...arch].reverse().map(d=>{
    const esMeDeben=(d[7]||'').toString().toLowerCase()==='me-deben';
    const monto=parseFloat(d[3])||0;
    const logAb=d[10]?cobradoDeuda(d):calcAbonadoFromLog(d[0]);
    const abonado=logAb>0?logAb:(parseFloat(d[4])||0);
    const motivo=(d[8]||'').toString().toLowerCase();
    const isPagado=motivo.includes('pagado')||motivo.includes('saldada');
    const cls=esMeDeben?'in':'out';const signo=esMeDeben?'+':'−';
    const faDisp=d[9]?pf(d[9]).toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'}):'';
    return `<div class="dcard" style="opacity:0.75;">
      <div class="dcard-top">
        <div class="dcard-info">
          <div class="dcard-person">${escHtml(d[1]||'?')}
            <span class="dcard-badge ${esMeDeben?'medeben':'lesdebo'}">${esMeDeben?'Me debían':'Les debía'}</span>
            <span class="dcard-badge ${isPagado?'pagado':'nopago'}">${isPagado?'Saldada':'No pagó'}</span>
          </div>
          <div class="dcard-desc">${escHtml(d[2]||'')}</div>
          ${faDisp?`<div class="dcard-desc">Archivada ${faDisp}</div>`:''}
        </div>
        <div class="dcard-right">
          <div class="dcard-amt ${cls}">${signo}${fmtD(monto)}</div>
          ${abonado>0&&abonado<monto?`<div class="dcard-subamt">Abonado ${fmtD(abonado)}</div>`:''}
        </div>
      </div>
      <div class="dcard-actions">
        <button class="dcard-btn" onclick="confirmarDesarchivar('${escHtml(String(d[0]))}')">Desarchivar</button>
      </div>
    </div>`;
  }).join('');
}

export function setDT(t,b){dT=t;document.querySelectorAll('.dt').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderDeb();}

// ── Modal deuda ──────────────────────────────────────────────────────────────
export function abrirModalDeuda(){
  editandoDeuda=null;
  document.getElementById('deudaModalTitle').textContent='Nueva deuda';
  document.getElementById('dPersona').value='';
  document.getElementById('dDesc').value='';
  document.getElementById('dMonto').value='';
  document.getElementById('dFechaInicio').value=toDateInput(new Date());
  document.getElementById('dFechaVenc').value='';
  setDeudaTipo(dT==='les-debo'?'les-debo':'me-deben');
  prepararCuotasDeuda(true);
  document.getElementById('deudaModalBtns').innerHTML='<button class="btn btn-s" onclick="cerrarModalDeuda()">Cancelar</button><button class="btn btn-p" onclick="guardarDeuda()">Guardar</button>';
  document.getElementById('modalDeuda').classList.add('active');
}

export function abrirModalDeudaEdit(id){
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(id));
  if(!d)return;
  editandoDeuda=id;
  document.getElementById('deudaModalTitle').textContent='Editar deuda';
  document.getElementById('dPersona').value=d[1]||'';
  document.getElementById('dDesc').value=d[2]||'';
  document.getElementById('dMonto').value=d[3]||'';
  document.getElementById('dFechaInicio').value=toDateInput(d[5]);
  document.getElementById('dFechaVenc').value=toDateInput(d[6]);
  setDeudaTipo(d[7]||'me-deben');
  prepararCuotasDeuda(false);
  document.getElementById('deudaModalBtns').innerHTML='<button class="btn btn-s" onclick="cerrarModalDeuda()">Cancelar</button><button class="btn btn-p" onclick="guardarDeuda()">Guardar</button>';
  document.getElementById('modalDeuda').classList.add('active');
}

// "En cuotas" solo al crear: una deuda ya guardada se edita sola.
function prepararCuotasDeuda(nueva){
  document.getElementById('dCuotasBox').hidden=!nueva;
  document.getElementById('dCuotas').checked=false;
  document.getElementById('dCuotasN').value='2';
  toggleCuotasDeuda();
}

export function toggleCuotasDeuda(){
  document.getElementById('dCuotasDetalle').hidden=!document.getElementById('dCuotas').checked;
  resumirCuotasDeuda();
}

// La primera cuota vence en la fecha de Vence; sin ella, un mes después de Desde.
function primeraCuota(){
  const venc=document.getElementById('dFechaVenc').value,inicio=document.getElementById('dFechaInicio').value;
  return venc||(inicio?sumarMeses(inicio,1):'');
}

export function resumirCuotasDeuda(){
  const nota=document.getElementById('dCuotasResumen');
  const total=Math.round(Number(String(document.getElementById('dMonto').value).replace(/[^0-9.]/g,''))*100);
  const n=Number(document.getElementById('dCuotasN').value),primera=primeraCuota();
  if(!document.getElementById('dCuotas').checked||!(total>=n)||!Number.isInteger(n)||n<2||!primera){nota.textContent='';return;}
  const plan=planCuotas(total,n,primera),cada=plan[0].monto,ultima=plan[n-1].monto;
  nota.textContent=n+' cuotas de '+fmtD(cada)+(ultima!==cada?' (la última, '+fmtD(ultima)+')':'')+'. La primera vence el '+fmtDateShort(pf(primera)).replace(/\.$/,'')+'; las demás, cada mes.';
}

export function cerrarModalDeuda(){document.getElementById('modalDeuda').classList.remove('active');editandoDeuda=null;}

export function setDeudaTipo(t){
  deudaTipoModal=t;
  document.getElementById('dTipoMeDeben').classList.toggle('active',t==='me-deben');
  document.getElementById('dTipoLesDebo').classList.toggle('active',t==='les-debo');
}

async function guardarDeuda__base(){
  const persona=document.getElementById('dPersona').value.trim();
  const desc=document.getElementById('dDesc').value.trim();
  const monto=String(document.getElementById('dMonto').value).replace(/[^0-9.]/g,'').trim();
  if(!persona){toast('Escribe el nombre de la persona o entidad','error');return;}
  if(!monto||parseFloat(monto)<=0){toast('Ingresa un monto válido','error');return;}
  const fechaInicio=document.getElementById('dFechaInicio').value;
  const fechaVenc=document.getElementById('dFechaVenc').value;
  const body={persona,descripcion:desc,monto:parseFloat(monto),fecha_inicio:fechaInicio,fecha_venc:fechaVenc||null,tipo:deudaTipoModal};
  if(!editandoDeuda&&document.getElementById('dCuotas').checked)return guardarDeudaEnCuotas(body);
  try{
    if(editandoDeuda){
      const id=editandoDeuda;
      const d=datos.deudas.find(x=>String(x[0])===String(id));
      const antes=d?{persona:d[1],descripcion:d[2],monto:Number(d[3]),fecha_inicio:d[5],fecha_venc:d[6]||null,tipo:d[7]}:null;
      await sbUpdate('deudas',id,body);
      if(d){d[1]=persona;d[2]=desc;d[3]=parseFloat(monto);d[5]=fechaInicio;d[6]=fechaVenc||null;d[7]=deudaTipoModal;}
      cerrarModalDeuda();render();
      if(antes)ofrecerDeshacer('Deuda actualizada',()=>sbUpdate('deudas',id,antes));else toast('Deuda actualizada','success');
    } else {
      const row=await sbInsert('deudas',body);
      datos.deudas.push(filaDeuda(row));
      cerrarModalDeuda();render();
      ofrecerDeshacer('Deuda registrada',()=>sbDelete('deudas',row.id));
    }
  }catch(e){toast('Error al guardar','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarDeuda=guardedOnce(guardarDeuda__base);

// Una deuda por cuota, "Descripción · Cuota 1/6", con vencimientos mensuales.
// Cada cuota se cobra y se archiva por separado, como ya hacías a mano.
async function guardarDeudaEnCuotas(body){
  const n=Number(document.getElementById('dCuotasN').value),primera=primeraCuota();
  if(!Number.isInteger(n)||n<2||n>60){toast('Elige entre 2 y 60 cuotas','error');return;}
  if(!body.fecha_inicio&&!primera){toast('Elige la fecha de la primera cuota','error');return;}
  const total=Math.round(body.monto*100);
  if(total<n){toast('Cada cuota debe ser de al menos S/ 0.01','error');return;}
  const filas=planCuotas(total,n,primera).map((c,i)=>({...body,monto:c.monto,fecha_venc:c.venc,
    descripcion:(body.descripcion?body.descripcion+' · ':'')+'Cuota '+(i+1)+'/'+n}));
  try{
    const rows=await sbInsert('deudas',filas);
    for(const row of rows)datos.deudas.push(filaDeuda(row));
    cerrarModalDeuda();render();
    ofrecerDeshacer(n+' cuotas registradas',async()=>{for(const row of rows)await sbDelete('deudas',row.id);});
  }catch(e){toast('Error al guardar','error');}
}

// ── Modal abono ──────────────────────────────────────────────────────────────
// Calcula abonado siempre desde DeudasAbonos (fuente de verdad), nunca desde d[4]
function calcAbonadoFromLog(deudaId){
  return (datos.deudasAbonos||[])
    .filter(ab=>_abDeudaId(ab)===String(deudaId))
    .reduce((s,ab)=>s+_abMonto(ab),0);
}

export function abrirModalAbono(id){
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(id));
  if(!d)return;
  abonosDeudaId=id;editandoCobroId=null;
  const operacionPendiente=abonoPendiente();
  solicitudAbonoId=operacionPendiente?.tipo==='crear'&&String(operacionPendiente.abono.deuda_id)===String(id)?operacionPendiente.id:crypto.randomUUID();
  solicitudAbonoTxId=(operacionPendiente?.id===solicitudAbonoId?operacionPendiente.tx?.id:null)||crypto.randomUUID();
  const monto=parseFloat(d[3])||0;
  const vinculada=!!d[8];
  const abonado=vinculada?cobradoDeuda(d):calcAbonadoFromLog(id);
  const pendiente=Math.max(0,monto-abonado);
  const esMeDeben=(d[7]||'').toString().toLowerCase()==='me-deben';
  document.getElementById('abonoTitle').textContent=vinculada?'Cobrar a '+(d[1]||''):(esMeDeben?'Cobro recibido':'Pago realizado')+' — '+(d[1]||'');
  document.getElementById('abonoPendienteLbl').textContent=vinculada
    ?'Te debe '+fmtD(pendiente)+' de '+fmtD(monto)+'. Se registra como reembolso del gasto; si te pagó de más, el resto queda como ingreso.'
    :'Pendiente: '+fmtC(pendiente)+' de '+fmtC(monto)+(esMeDeben?'. Si te paga de más, lo que sobra queda como ingreso extra.':'');
  document.getElementById('abonoFecha').value=toDateInput(new Date());
  document.getElementById('abonoMonto').value='';
  document.getElementById('abonoMonto').placeholder=vinculada?'Monto que te devolvió':'Monto a abonar';
  document.getElementById('abonoExcedente').hidden=true;
  document.getElementById('abonoNota').value='';
  // Gasto por cobrar y "Me deben": dónde llegó el dinero. "Les debo": el pago
  // puede anotarse como gasto (apagado por defecto, porque sueles registrar ese
  // gasto aparte en Movimientos y así no se cuenta dos veces).
  const esLesDebo=!vinculada&&!esMeDeben;
  document.getElementById('abonoGastoBox').hidden=!esLesDebo;
  document.getElementById('abonoGasto').checked=false;
  document.getElementById('abonoCuentaLbl').textContent=esLesDebo?'Pagado desde':'Recibido en';
  if(vinculada)llenarCuentaCobro(gastoDeDeuda(d));
  else{llenarCuentaAbono(esMeDeben?'Ingreso':'Gasto');llenarCategoriaAbono();}
  const pendienteTx=operacionPendiente?.id===solicitudAbonoId?operacionPendiente.tx:null;
  if(pendienteTx){
    if(esLesDebo)document.getElementById('abonoGasto').checked=true;
    document.getElementById('abonoCuenta').value=pendienteTx.cuenta||document.getElementById('abonoCuenta').value;
    if(esLesDebo)document.getElementById('abonoCat').value=pendienteTx.categoria||'';
  }
  mostrarCamposAbono(vinculada||esMeDeben);
  document.getElementById('abonoGuardarBtn').textContent=vinculada?'Cobrar':'Abonar';
  document.getElementById('abonoTodoBtn').textContent=vinculada?'Todo':'Pagar todo';
  if(operacionPendiente?.id===solicitudAbonoId){document.getElementById('abonoMonto').value=operacionPendiente.abono.monto;document.getElementById('abonoFecha').value=toDateInput(operacionPendiente.abono.fecha);document.getElementById('abonoNota').value=operacionPendiente.abono.nota||'';}
  document.getElementById('modalAbono').classList.add('active');
}

function mostrarCamposAbono(conCuenta){
  const gasto=!document.getElementById('abonoGastoBox').hidden&&document.getElementById('abonoGasto').checked;
  document.getElementById('abonoCuentaRow').hidden=!(conCuenta||gasto);
  document.getElementById('abonoCatRow').hidden=!gasto;
}

export function toggleAbonoGasto(){mostrarCamposAbono(false);}

// Cuentas en soles de efectivo para un abono sin gasto vinculado. Por defecto,
// la cuenta del último abono del mismo tipo que llevó movimiento.
function llenarCuentaAbono(tipoTx){
  const sel=document.getElementById('abonoCuenta');
  const efectivo=cuentasApp().filter(c=>!c[3]&&c[1]!=='inversion'&&c[2]==='PEN').map(c=>c[0]);
  sel.innerHTML=efectivo.map(c=>`<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('');
  const vinculados=new Set((datos.deudasAbonos||[]).map(_abTxId).filter(Boolean).map(String));
  const ultima=(datos.transacciones||[]).filter(t=>t[3]===tipoTx&&vinculados.has(String(t[6]))&&efectivo.some(c=>sameAccount(c,t[5])))
    .sort((a,b)=>pf(b[0])-pf(a[0]))[0];
  sel.value=ultima?efectivo.find(c=>sameAccount(c,ultima[5])):(efectivo[0]||'');
}

// Categorías de gasto para el pago de una deuda que tienes.
function llenarCategoriaAbono(){
  const ingresos=new Set(['salario','beca','otros ingresos','inversiones']);
  const cats=(datos.categorias||[]).map(c=>c[0]).filter(c=>c&&!ingresos.has(String(c).trim().toLowerCase()));
  document.getElementById('abonoCat').innerHTML='<option value="">Elige la categoría…</option>'+cats.map(c=>`<option value="${escAttr(c)}">${escHtml(c)}</option>`).join('');
}

// Lo que te deben ahora mismo en la deuda abierta, en soles.
function pendienteAbono(d){
  const monto=parseFloat(d[3])||0;
  return d[8]?pendienteDeuda(d):Math.max(0,Math.round((monto-calcAbonadoFromLog(d[0]))*100)/100);
}

// Al escribir el monto: si te pagan más de lo que te deben, avisa cuánto
// quedará como ingreso extra. Solo en "Me deben".
export function avisarExcedenteAbono(){
  const aviso=document.getElementById('abonoExcedente');
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(abonosDeudaId));
  const monto=Number(document.getElementById('abonoMonto').value);
  const cobro=editandoCobroId?(datos.transacciones||[]).find(t=>String(t[6])===editandoCobroId):null;
  const limite=cobro&&d?debiaAntesDeCobro(d,cobro):d?Math.round(pendienteAbono(d)*100):0;
  const exceso=d&&(d[7]||'').toString().toLowerCase()==='me-deben'&&Number.isFinite(monto)?Math.round(monto*100)-limite:0;
  aviso.hidden=!(exceso>0);
  aviso.textContent=exceso>0?fmtD(exceso/100)+' de más se guardará como ingreso extra.':'';
}

export function cerrarModalAbono(){
  document.getElementById('modalAbono').classList.remove('active');abonosDeudaId=null;
  // Al corregir un cobro se vuelve al historial de donde se abrió.
  if(editandoCobroId){editandoCobroId=null;if(historialDeudaId){renderHistorialAbonos();document.getElementById('modalHistorialAbonos').classList.add('active');}}
}

export function abonarTodo(){
  if(!abonosDeudaId)return;
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(abonosDeudaId));
  if(!d)return;
  const cobro=editandoCobroId?(datos.transacciones||[]).find(t=>String(t[6])===editandoCobroId):null;
  if(cobro){document.getElementById('abonoMonto').value=(debiaAntesDeCobro(d,cobro)/100).toFixed(2);avisarExcedenteAbono();return;}
  const monto=parseFloat(d[3])||0;
  const abonado=d[8]?cobradoDeuda(d):calcAbonadoFromLog(abonosDeudaId);
  document.getElementById('abonoMonto').value=Math.max(0,monto-abonado).toFixed(2);
  avisarExcedenteAbono();
}

// Dónde llegó lo que te devolvieron: tus cuentas en soles (no de inversión).
// Si el gasto fue con tarjeta, también la tarjeta misma, por si te pagaron
// directo a ella; así baja su deuda. Por defecto, la cuenta del gasto si no es
// tarjeta, y si lo es, Yape o Plin, como en el formulario de reembolsos.
function llenarCuentaCobro(gasto){
  const sel=document.getElementById('abonoCuenta');
  const efectivo=cuentasApp().filter(c=>!c[3]&&c[1]!=='inversion'&&c[2]==='PEN').map(c=>c[0]);
  const tarjeta=gasto?CREDIT_CARDS.find(card=>sameAccount(card.cuenta,gasto[5])):null;
  const opciones=[...efectivo];
  if(tarjeta)opciones.push(tarjeta.cuenta);
  else if(gasto?.[5]&&!opciones.some(c=>sameAccount(c,gasto[5]))&&gasto[9]!=='USD')opciones.unshift(gasto[5]);
  sel.innerHTML=opciones.map(c=>`<option value="${escAttr(c)}">${escHtml(tarjeta&&c===tarjeta.cuenta?c+' (directo a la tarjeta)':c)}</option>`).join('');
  const preferida=tarjeta?(efectivo.find(c=>sameAccount(c,sameAccount(tarjeta.cuenta,'Visa iO')?'Yape':'Plin'))||efectivo[0]):opciones.find(c=>sameAccount(c,gasto?.[5]||''));
  sel.value=preferida||opciones[0]||'';
}

export function editarGastoDeDeuda(id){
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(id));
  const gasto=d?gastoDeDeuda(d):null;
  if(!gasto){toast('No encuentro el gasto de esta deuda. Pulsa Actualizar.','error');return;}
  editarTx(getTxRow(gasto));
}

// Nota: replica una regla que antes vivía solo en Apps Script — un abono a una
// deuda 'me-deben' crea también una transacción espejo (Ingreso, Inversiones),
// vinculada vía deudas_abonos.tx_id para poder editarla/borrarla en conjunto.
// Ahora va a la cuenta donde llegó el dinero (antes quedaba sin cuenta). En
// 'les-debo', si se pide, el pago crea un Gasto en la cuenta de donde salió.
async function guardarAbono__base(){
  if(!abonosDeudaId)return;
  const monto=Number(document.getElementById('abonoMonto').value);
  if(!Number.isFinite(monto)||monto<=0){toast('Ingresa un monto válido','error');return;}
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(abonosDeudaId));
  const fecha=document.getElementById('abonoFecha').value;
  if(!fecha){toast('Completa la fecha del abono','error');return;}
  const nota=document.getElementById('abonoNota').value.trim();
  const tipo=(d&&d[7]||'').toString().toLowerCase();
  if(editandoCobroId)return guardarCobroEditado(d,monto,fecha,nota);
  if(d?.[8])return cobrarGasto(d,monto,fecha,nota);
  const cuenta=document.getElementById('abonoCuenta').value;
  let tx=null,abonado=monto,extra=0;
  if(tipo==='me-deben'){
    if(!cuenta){toast('Elige dónde recibiste el dinero','error');return;}
    // Si te pagan de más, el abono es lo que debían y lo demás un ingreso
    // extra en la misma cuenta, igual que en los gastos por cobrar.
    const pendiente=Math.round(pendienteAbono(d)*100);
    if(pendiente<=0){toast('Esta deuda ya está pagada. Archívala como saldada.','error');return;}
    if(Math.round(monto*100)>pendiente){abonado=pendiente/100;extra=(Math.round(monto*100)-pendiente)/100;}
    tx={id:solicitudAbonoTxId,fecha,descripcion:d?d[1]:'',categoria:'Inversiones',tipo:'Ingreso',monto:abonado,cuenta};
  }else if(document.getElementById('abonoGasto').checked){
    const categoria=document.getElementById('abonoCat').value;
    if(!cuenta){toast('Elige de qué cuenta salió el pago','error');return;}
    if(!categoria){toast('Elige la categoría del gasto','error');return;}
    tx={id:solicitudAbonoTxId,fecha,descripcion:d?(d[1]||'')+(d[2]?' · '+d[2]:''):'',categoria,tipo:'Gasto',monto,cuenta};
  }
  try{
    const id=solicitudAbonoId;
    await ejecutarAbono({tipo:'crear',id,tx,abono:{id,deuda_id:abonosDeudaId,monto:abonado,fecha,nota,tx_id:tx?.id||null}});
    let ingresoExtra=null;
    if(extra>0){
      try{ingresoExtra=await sbInsert('transacciones',{fecha,descripcion:'Excedente de '+(d?.[1]||'pago')+(nota?' · '+nota:''),categoria:'Otros ingresos',tipo:'Ingreso',monto:extra,cuenta});}
      catch(e){toast('Se guardó el pago, pero no los '+fmtD(extra)+' de más. Regístralos como ingreso.','error');}
    }
    cerrarModalAbono();await cargar({silencioso:true});
    ofrecerDeshacer('Pago registrado'+(ingresoExtra?' · '+fmtD(extra)+' de más como ingreso':''),async()=>{
      if(ingresoExtra)await sbDelete('transacciones',ingresoExtra.id);
      await ejecutarAbono({tipo:'eliminar',id,txId:tx?.id||null});
    });
  }catch(e){avisarErrorAbono(e);}
}

// Cobro de un gasto por cobrar: un Reembolso del gasto en la cuenta donde
// llegó el dinero. Baja la deuda y, si llegó a la tarjeta, también su saldo.
// Si te pagan más de lo que debían (debía 20 y paga 25), lo que sobra se guarda
// como un Ingreso aparte en la misma cuenta, igual que el excedente de un
// reembolso normal: el reembolso nunca supera el gasto.
async function cobrarGasto(d,monto,fecha,nota){
  const gasto=gastoDeDeuda(d);
  if(!gasto){toast('No encuentro el gasto de esta deuda. Pulsa Actualizar.','error');return;}
  // Lo que debe esta persona, sin pasar lo que queda del gasto por devolver.
  const pendiente=Math.min(pendienteDeuda(d),Math.max(0,Math.round(Number(gasto[4])*100)-devueltoCentimos(gasto[6]))/100);
  const centimos=Math.round(monto*100),devuelto=Math.min(centimos,Math.round(pendiente*100)),exceso=centimos-devuelto;
  const cuenta=document.getElementById('abonoCuenta').value;
  if(!cuenta){toast('Elige dónde recibiste el dinero','error');return;}
  if(exceso>0&&CREDIT_CARDS.some(card=>sameAccount(card.cuenta,cuenta))){toast('Te debe '+fmtD(pendiente)+'. Para lo que te pagó de más, elige la cuenta donde recibiste el dinero: el pago a la tarjeta se registra en Tarjetas.','error');return;}
  if(pf(fecha)<new Date(pf(gasto[0]).getFullYear(),pf(gasto[0]).getMonth(),pf(gasto[0]).getDate())){toast('El cobro no puede ser anterior al gasto','error');return;}
  const ahora=new Date(),hora=`${ahora.getHours()%12||12}:${String(ahora.getMinutes()).padStart(2,'0')} ${ahora.getHours()>=12?'p. m.':'a. m.'}`;
  const [yy,mm,dd]=fecha.split('-');
  const comun={fecha:buildFechaISO(yy,mm,dd,hora),cuenta,cuenta_destino:null,moneda_original:null,monto_original:null,tc:null,tc_fuente:null,moneda_destino:null,monto_destino:null,deuda_id:null};
  const descripcion='Devolución de '+(d[1]||'')+(nota?' · '+nota:'');
  const filas=[];
  // El reembolso dice de quién es: en un gasto dividido, cada persona baja solo su parte.
  if(devuelto>0)filas.push({...comun,descripcion,categoria:gasto[2],tipo:'Reembolso',monto:devuelto/100,transaccion_origen_id:gasto[6],deuda_id:d[0]});
  if(exceso>0)filas.push({...comun,descripcion:'Excedente de '+descripcion,categoria:'Otros ingresos',tipo:'Ingreso',monto:exceso/100,transaccion_origen_id:null});
  try{
    const guardadas=exceso>0?await guardarReembolsoConExcedente(filas):[await sbInsert('transacciones',filas[0])];
    cerrarModalAbono();await cargar({silencioso:true});
    const resta=pendienteDeuda(d),sobra=exceso>0?' · '+fmtD(exceso/100)+' de más como ingreso':'';
    ofrecerDeshacer((resta>0?'Cobro registrado · falta '+fmtD(resta):'Cobrado completo · '+(d[1]||'')+' ya no te debe')+sobra,async()=>{for(const row of guardadas)await sbDelete('transacciones',row.id);});
  }catch(e){toast(e.message||'No se pudo registrar el cobro','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarAbono=guardedOnce(guardarAbono__base);

// ── Modal archivar ───────────────────────────────────────────────────────────
export function abrirModalArchivar(id){archivarDeudaId=id;document.getElementById('modalArchivar').classList.add('active');}

export function cerrarModalArchivar(){document.getElementById('modalArchivar').classList.remove('active');archivarDeudaId=null;}

async function confirmarArchivar__base(motivo){
  if(!archivarDeudaId)return;
  const fechaArchivo=new Date().toISOString();
  try{
    const id=archivarDeudaId;
    await sbUpdate('deudas',id,{archivado:true,motivo_archivo:motivo,fecha_archivo:fechaArchivo});
    const idx=datos.deudas.findIndex(x=>String(x[0])===String(id));
    if(idx>=0){
      const d=datos.deudas.splice(idx,1)[0];
      datos.deudasArchivadas.push(archivarFila(d,motivo,fechaArchivo));
    }
    cerrarModalArchivar();render();
    ofrecerDeshacer('Deuda archivada',()=>sbUpdate('deudas',id,{archivado:false,motivo_archivo:null,fecha_archivo:null}));
  }catch(e){toast('Error al archivar','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const confirmarArchivar=guardedOnce(confirmarArchivar__base);

async function confirmarDesarchivar__base(id){
  try{
    const antes=datos.deudasArchivadas.find(x=>String(x[0])===String(id));
    await sbUpdate('deudas',id,{archivado:false,motivo_archivo:null,fecha_archivo:null});
    const idx=datos.deudasArchivadas.findIndex(x=>String(x[0])===String(id));
    if(idx>=0){
      const d=datos.deudasArchivadas.splice(idx,1)[0];
      datos.deudas.push(desarchivarFila(d));
    }
    render();
    if(antes)ofrecerDeshacer('Deuda restaurada',()=>sbUpdate('deudas',id,{archivado:true,motivo_archivo:antes[8]??null,fecha_archivo:antes[9]??null}));
    else toast('Deuda restaurada','success');
  }catch(e){toast('Error al restaurar','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const confirmarDesarchivar=guardedOnce(confirmarDesarchivar__base);

// ── Historial de abonos ──────────────────────────────────────────────────────
// Formato nuevo: [AbonoID('A...'), DeudaID('D...'), Monto, Fecha, Nota]
// Formato viejo: [DeudaID('D...'), Monto, Fecha, Nota]
function _abIsNew(ab){return true;}

 // Supabase: todo abono siempre trae id real (uuid)
function _abId(ab){return _abIsNew(ab)?String(ab[0]):null;}

function _abEffectiveId(ab){
  if(_abIsNew(ab))return String(ab[0]);
  return 'L|'+ab[0]+'|'+(ab[1]||'')+'|'+(ab[2]||'');
}

function _abDeudaId(ab){return _abIsNew(ab)?String(ab[1]||''):String(ab[0]||'');}

// Solo cuenta como monto un número finito y > 0. Esto evita que un valor tipo "D1747…"
// (cuando la hoja quedó desalineada) se interprete como monto y rompa el total abonado.
function _abMonto(ab){
  const raw=_abIsNew(ab)?ab[2]:ab[1];
  const n=parseFloat(String(raw||'').replace(/[^0-9.\-]/g,''));
  return Number.isFinite(n)&&n>0?n:0;
}

function _abFecha(ab){return _abIsNew(ab)?(ab[3]||''):(ab[2]||'');}

function _abNota(ab){return _abIsNew(ab)?(ab[4]||''):(ab[3]||'');}

function _abTxId(ab){return ab[5]||null;}

export function abrirHistorialAbonos(id){
  historialDeudaId=id;
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(id));
  document.getElementById('historialAbonosTitle').textContent=(d?.[8]?'Cobros — ':'Abonos — ')+(d?d[1]||'':'');
  renderHistorialAbonos();
  document.getElementById('modalHistorialAbonos').classList.add('active');
}

export function cerrarHistorialAbonos(){
  document.getElementById('modalHistorialAbonos').classList.remove('active');
  historialDeudaId=null;
}

function renderHistorialAbonos(){
  const lista=document.getElementById('historialAbonosList');
  const deuda=(datos.deudas||[]).find(x=>String(x[0])===String(historialDeudaId));
  if(deuda?.[8]){renderHistorialCobros(lista,deuda);return;}
  const abs=(datos.deudasAbonos||[]).filter(ab=>_abDeudaId(ab)===String(historialDeudaId));
  if(abs.length===0){lista.innerHTML='<div class="empty" style="padding:20px 0">Sin abonos registrados</div>';return;}
  lista.innerHTML=[...abs].reverse().map(ab=>{
    const abonoId=_abId(ab);
    const fDisp=_abFecha(ab)?pf(_abFecha(ab)).toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'}):'—';
    const nota=_abNota(ab);
    return `<div class="dcard" style="margin-bottom:8px;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <div style="font-weight:700;color:var(--green)">${fmtD(_abMonto(ab))}</div>
          <div style="font-size:0.75rem;color:var(--dim)">${fDisp}${nota?' · '+escHtml(nota):''}${(()=>{const x=abonoConExtra(ab)?.extra;return x?' · +'+fmtD(x[4])+' de más como ingreso':'';})()}</div>
        </div>
        ${abonoId?`<div style="display:flex;gap:6px;"><button class="dcard-btn" onclick="abrirEditAbono('${abonoId}')">✎</button><button class="dcard-btn danger" onclick="eliminarAbono('${abonoId}')">✕</button></div>`:''}
      </div>
    </div>`;
  }).join('');
}

// Los cobros de un gasto son sus reembolsos: se editan como cualquier
// movimiento y se borran con la opción de deshacer.
function renderHistorialCobros(lista,deuda){
  // En un gasto dividido, solo los cobros de esta persona y los que no dicen
  // de quién son (esos se marcan).
  const dividido=deudasDeGasto(deuda[8]).length>1;
  const cobros=(datos.transacciones||[]).filter(t=>t[3]==='Reembolso'&&String(t[8])===String(deuda[8])&&(!t[16]||String(t[16])===String(deuda[0])))
    .sort((a,b)=>pf(b[0])-pf(a[0]));
  if(cobros.length===0){lista.innerHTML='<div class="empty" style="padding:20px 0">Todavía no te devolvió nada</div>';return;}
  lista.innerHTML=cobros.map(t=>{
    const id=escAttr(String(t[6]));
    return `<div class="dcard" style="margin-bottom:8px;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <div style="font-weight:700;color:var(--green)">${fmtD(t[4])}</div>
          <div style="font-size:0.75rem;color:var(--dim)">${pf(t[0]).toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'})} · en ${escHtml(t[5]||'—')}${dividido&&!t[16]?' · sin persona':''}${(()=>{const x=excedenteDeCobro(t);return x?' · +'+fmtD(x[4])+' de más como ingreso':'';})()}</div>
        </div>
        <div style="display:flex;gap:6px;"><button class="dcard-btn" onclick="editarCobro('${id}')" aria-label="Editar cobro">✎</button><button class="dcard-btn danger" onclick="eliminarCobro('${id}')" aria-label="Eliminar cobro">✕</button></div>
      </div>
    </div>`;
  }).join('');
}

// El ingreso extra que se guardó junto con un cobro: mismo momento, misma
// cuenta y "Excedente de <descripción del cobro>". Ninguna columna los une.
function excedenteDeCobro(t){
  const momento=pf(t[0]).getTime();
  return (datos.transacciones||[]).find(x=>x[3]==='Ingreso'&&x[2]==='Otros ingresos'&&sameAccount(x[5],t[5])
    &&pf(x[0]).getTime()===momento&&x[1]==='Excedente de '+t[1])||null;
}

// Lo que la persona debía antes de este cobro, en céntimos: su deuda menos lo
// demás que ya pagó, sin pasar lo que queda del gasto por devolver.
function debiaAntesDeCobro(d,t){
  const gasto=gastoDeDeuda(d);
  if(!gasto)return 0;
  const otros=Math.min(cent(d[3]),cobrosDeGasto(d[8],t[6]).get(String(d[0]))||0);
  const restoGasto=cent(gasto[4])-(devueltoCentimos(gasto[6])-cent(t[4]));
  return Math.max(0,Math.min(cent(d[3])-otros,restoGasto));
}

// "9:05 p. m.", la hora de un movimiento, para conservarla al cambiar la fecha.
function horaDe(f){const d=pf(f);return `${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'p. m.':'a. m.'}`;}

// Corregir un cobro: la misma ventana de Cobrar, con lo que se registró. Se
// escribe lo que la persona pagó en total; si pasa lo que debía, lo demás
// queda como ingreso extra, igual que al cobrar.
export function editarCobro(txId){
  const t=(datos.transacciones||[]).find(x=>String(x[6])===String(txId));
  const d=t?(datos.deudas||[]).find(x=>String(x[0])===String(t[16]||historialDeudaId)):null;
  if(!t||!d||!d[8]){cerrarHistorialAbonos();editarTx(txId);return;}
  const extra=excedenteDeCobro(t),base='Devolución de '+(d[1]||'');
  abonosDeudaId=String(d[0]);editandoCobroId=String(txId);
  document.getElementById('modalHistorialAbonos').classList.remove('active');
  document.getElementById('abonoTitle').textContent='Corregir cobro — '+(d[1]||'');
  document.getElementById('abonoPendienteLbl').textContent='Debía '+fmtD(debiaAntesDeCobro(d,t)/100)+'. Escribe lo que te pagó en total; si es más, lo que sobra queda como ingreso extra.';
  document.getElementById('abonoFecha').value=toDateInput(t[0]);
  document.getElementById('abonoMonto').value=((cent(t[4])+(extra?cent(extra[4]):0))/100).toFixed(2);
  document.getElementById('abonoNota').value=String(t[1]).startsWith(base+' · ')?String(t[1]).slice(base.length+3):'';
  document.getElementById('abonoGastoBox').hidden=true;
  document.getElementById('abonoGasto').checked=false;
  document.getElementById('abonoCuentaLbl').textContent='Recibido en';
  llenarCuentaCobro(gastoDeDeuda(d));
  const sel=document.getElementById('abonoCuenta');
  if(![...(sel.options||[])].some(o=>sameAccount(o.value,t[5]))&&sel.options)sel.insertAdjacentHTML?.('afterbegin',`<option value="${escAttr(t[5])}">${escHtml(t[5])}</option>`);
  sel.value=t[5];
  mostrarCamposAbono(true);
  document.getElementById('abonoGuardarBtn').textContent='Guardar';
  document.getElementById('abonoTodoBtn').textContent='Lo que debía';
  avisarExcedenteAbono();
  document.getElementById('modalAbono').classList.add('active');
}

async function guardarCobroEditado(d,monto,fecha,nota){
  const t=(datos.transacciones||[]).find(x=>String(x[6])===editandoCobroId);
  const gasto=d?gastoDeDeuda(d):null;
  if(!t||!gasto){toast('No encuentro este cobro. Pulsa Actualizar.','error');return;}
  const cuenta=document.getElementById('abonoCuenta').value;
  if(!cuenta){toast('Elige dónde recibiste el dinero','error');return;}
  const debia=debiaAntesDeCobro(d,t),centimos=Math.round(monto*100),devuelto=Math.min(centimos,debia),exceso=centimos-devuelto;
  if(devuelto<=0){toast((d[1]||'Esta persona')+' ya no debía nada sin este cobro. Si sobra, elimínalo.','error');return;}
  if(exceso>0&&CREDIT_CARDS.some(card=>sameAccount(card.cuenta,cuenta))){toast('Debía '+fmtD(debia/100)+'. Para lo que te pagó de más, elige la cuenta donde recibiste el dinero.','error');return;}
  if(pf(fecha)<new Date(pf(gasto[0]).getFullYear(),pf(gasto[0]).getMonth(),pf(gasto[0]).getDate())){toast('El cobro no puede ser anterior al gasto','error');return;}
  const [yy,mm,dd]=fecha.split('-');
  const momento=toDateInput(t[0])===fecha?t[0]:buildFechaISO(yy,mm,dd,horaDe(t[0]));
  const descripcion='Devolución de '+(d[1]||'')+(nota?' · '+nota:'');
  const antes={fecha:t[0],cuenta:t[5],descripcion:t[1],monto:Number(t[4])};
  const extraAntes=excedenteDeCobro(t),copiaExtra=extraAntes?[...extraAntes]:null;
  const extraNuevo=exceso>0?{fecha:momento,cuenta,descripcion:'Excedente de '+descripcion,monto:exceso/100}:null;
  let extraCreado=null;
  try{
    await sbUpdate('transacciones',t[6],{fecha:momento,cuenta,descripcion,monto:devuelto/100});
    if(extraAntes&&extraNuevo)await sbUpdate('transacciones',extraAntes[6],extraNuevo);
    else if(extraAntes)await sbDelete('transacciones',extraAntes[6]);
    else if(extraNuevo)extraCreado=await sbInsert('transacciones',{...extraNuevo,categoria:'Otros ingresos',tipo:'Ingreso',cuenta_destino:null,transaccion_origen_id:null,deuda_id:null});
    editandoCobroId=null;cerrarModalAbono();
    await cargar({silencioso:true});
    if(historialDeudaId){renderHistorialAbonos();document.getElementById('modalHistorialAbonos').classList.add('active');}
    ofrecerDeshacer('Cobro corregido'+(exceso>0?' · '+fmtD(exceso/100)+' de más como ingreso':''),async()=>{
      if(extraCreado)await sbDelete('transacciones',extraCreado.id);
      await sbUpdate('transacciones',t[6],antes);
      if(copiaExtra&&extraNuevo)await sbUpdate('transacciones',copiaExtra[6],{fecha:copiaExtra[0],cuenta:copiaExtra[5],descripcion:copiaExtra[1],monto:Number(copiaExtra[4])});
      else if(copiaExtra)await sbInsert('transacciones',cuerpoTx(copiaExtra));
    });
  }catch(e){toast(e.message||'No se pudo corregir el cobro','error');cargar({silencioso:true});}
}

async function eliminarCobro__base(txId){
  const t=(datos.transacciones||[]).find(x=>String(x[6])===String(txId));
  if(!t)return;
  // Su ingreso extra, si lo tuvo, se va con él y vuelve con él.
  const copia=[...t],extra=excedenteDeCobro(t),copiaExtra=extra?[...extra]:null;
  try{
    if(extra)await sbDelete('transacciones',extra[6]);
    await sbDelete('transacciones',txId);
    await cargar({silencioso:true});
    render();
    if(historialDeudaId)renderHistorialAbonos();
    ofrecerDeshacer('Cobro eliminado',async()=>{await sbInsert('transacciones',cuerpoTx(copia));if(copiaExtra)await sbInsert('transacciones',cuerpoTx(copiaExtra));});
  }catch(e){toast(e.message||'No se pudo eliminar el cobro','error');}
}
export const eliminarCobro=guardedOnce(eliminarCobro__base);

// Abono de una deuda "Me deben" con su ingreso espejo: lo que pedía la deuda
// antes de este abono, en céntimos, y el ingreso extra que se guardó con él
// (misma cuenta y fecha que el espejo, "Excedente de …").
function deudaDeAbono(ab){return (datos.deudas||[]).find(d=>String(d[0])===_abDeudaId(ab))||null;}
function espejoDeAbono(ab){const id=_abTxId(ab);return id?(datos.transacciones||[]).find(t=>String(t[6])===String(id))||null:null;}
function debiaAntesDeAbono(d,ab){return Math.max(0,cent(d[3])-(cent(calcAbonadoFromLog(d[0]))-cent(_abMonto(ab))));}
function excedenteDeAbono(tx){
  const momento=pf(tx[0]).getTime();
  return (datos.transacciones||[]).find(x=>x[3]==='Ingreso'&&x[2]==='Otros ingresos'&&String(x[6])!==String(tx[6])&&sameAccount(x[5],tx[5])
    &&pf(x[0]).getTime()===momento&&String(x[1]).startsWith('Excedente de '))||null;
}
function abonoConExtra(ab){
  const d=deudaDeAbono(ab),tx=espejoDeAbono(ab);
  return d&&tx&&String(d[7]).toLowerCase()==='me-deben'?{d,tx,extra:excedenteDeAbono(tx)}:null;
}

export function avisarExcedenteEditAbono(){
  const aviso=document.getElementById('editAbonoExcedente');
  const ab=(datos.deudasAbonos||[]).find(x=>_abId(x)===String(editandoAbonoId));
  const info=ab?abonoConExtra(ab):null,monto=Number(document.getElementById('editAbonoMonto').value);
  const exceso=info&&Number.isFinite(monto)?Math.round(monto*100)-debiaAntesDeAbono(info.d,ab):0;
  aviso.hidden=!(exceso>0);
  aviso.textContent=exceso>0?fmtD(exceso/100)+' de más se guardará como ingreso extra.':'';
}

export function abrirEditAbono(abonoId){
  const ab=(datos.deudasAbonos||[]).find(x=>_abId(x)===String(abonoId));
  if(!ab)return;
  editandoAbonoId=abonoId;
  // Se muestra lo que te pagó en total: el abono más su ingreso extra.
  const info=abonoConExtra(ab);
  document.getElementById('editAbonoMonto').value=info?.extra?((cent(_abMonto(ab))+cent(info.extra[4]))/100).toFixed(2):_abMonto(ab);
  document.getElementById('editAbonoFecha').value=toDateInput(_abFecha(ab));
  document.getElementById('editAbonoNota').value=_abNota(ab);
  // Cierra el historial para evitar conflicto de z-index entre modales
  document.getElementById('modalHistorialAbonos').classList.remove('active');
  avisarExcedenteEditAbono();
  document.getElementById('modalEditAbono').classList.add('active');
}

export function cerrarEditAbono(){
  document.getElementById('modalEditAbono').classList.remove('active');
  editandoAbonoId=null;
  // Reabre el historial si venía de ahí
  if(historialDeudaId) document.getElementById('modalHistorialAbonos').classList.add('active');
}

async function guardarEditAbono__base(){
  if(!editandoAbonoId)return;
  const monto=Number(document.getElementById('editAbonoMonto').value);
  if(!Number.isFinite(monto)||monto<=0){toast('Monto inválido','error');return;}
  const fecha=document.getElementById('editAbonoFecha').value;
  if(!fecha){toast('Completa la fecha del abono','error');return;}
  const nota=document.getElementById('editAbonoNota').value.trim();
  try{
    const id=editandoAbonoId;
    const ab=datos.deudasAbonos.find(x=>_abId(x)===String(id));
    const txId=ab?_abTxId(ab):null;
    const antes=ab?{monto:_abMonto(ab),fecha:_abFecha(ab),nota:_abNota(ab)}:null;
    // "Me deben": si pasa lo que debía, el abono es lo que debía y lo demás
    // queda como ingreso extra en la cuenta de su ingreso espejo.
    const info=ab?abonoConExtra(ab):null;
    let abonado=monto,exceso=0;
    if(info){
      const debia=debiaAntesDeAbono(info.d,ab);
      if(Math.round(monto*100)>debia){
        if(debia<=0){toast('Esta deuda ya estaba pagada sin este abono.','error');return;}
        abonado=debia/100;exceso=Math.round(monto*100)-debia;
      }
    }
    const copiaExtra=info?.extra?[...info.extra]:null;
    await ejecutarAbono({tipo:'editar',id,txId,patch:{monto:abonado,fecha,nota}});
    let extraCreado=null;
    if(info){
      const extraNuevo=exceso>0?{fecha,cuenta:info.tx[5],descripcion:'Excedente de '+(info.d[1]||'pago')+(nota?' · '+nota:''),monto:exceso/100}:null;
      try{
        if(copiaExtra&&extraNuevo)await sbUpdate('transacciones',copiaExtra[6],extraNuevo);
        else if(copiaExtra)await sbDelete('transacciones',copiaExtra[6]);
        else if(extraNuevo)extraCreado=await sbInsert('transacciones',{...extraNuevo,categoria:'Otros ingresos',tipo:'Ingreso'});
      }catch(e){toast('Se guardó el abono, pero no el ingreso extra. Revísalo en Movimientos.','error');}
    }
    await cargar({silencioso:true});
    cerrarEditAbono();
    render();
    if(historialDeudaId)renderHistorialAbonos();
    if(antes)ofrecerDeshacer('Abono actualizado'+(exceso>0?' · '+fmtD(exceso/100)+' de más como ingreso':''),async()=>{
      if(extraCreado)await sbDelete('transacciones',extraCreado.id);
      await ejecutarAbono({tipo:'editar',id,txId,patch:antes});
      if(copiaExtra&&exceso>0)await sbUpdate('transacciones',copiaExtra[6],{fecha:copiaExtra[0],cuenta:copiaExtra[5],descripcion:copiaExtra[1],monto:Number(copiaExtra[4])});
      else if(copiaExtra)await sbInsert('transacciones',cuerpoTx(copiaExtra));
    });
    else toast('Abono actualizado','success');
  }catch(e){avisarErrorAbono(e);}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarEditAbono=guardedOnce(guardarEditAbono__base);

async function eliminarAbono__base(abonoId){
  try{
    const ab=datos.deudasAbonos.find(x=>_abId(x)===String(abonoId));
    const txId=ab?_abTxId(ab):null;
    // El abono y su ingreso espejo se reponen con sus mismos ids.
    const tx=txId?datos.transacciones.find(t=>String(t[6])===String(txId)):null;
    const copia=ab?{tipo:'crear',id:String(abonoId),tx:tx?cuerpoTx(tx):null,abono:{id:String(abonoId),deuda_id:_abDeudaId(ab),monto:_abMonto(ab),fecha:_abFecha(ab),nota:_abNota(ab),tx_id:tx?txId:null}}:null;
    // Su ingreso extra, si lo tuvo, se va con él y vuelve con él.
    const extra=ab?abonoConExtra(ab)?.extra:null,copiaExtra=extra?[...extra]:null;
    await ejecutarAbono({tipo:'eliminar',id:abonoId,txId});
    if(extra)await sbDelete('transacciones',extra[6]).catch(()=>toast('Se eliminó el abono, pero no su ingreso extra. Bórralo en Movimientos.','error'));
    await cargar({silencioso:true});
    render();
    if(historialDeudaId)renderHistorialAbonos();
    if(copia)ofrecerDeshacer('Abono eliminado',async()=>{await ejecutarAbono(copia);if(copiaExtra)await sbInsert('transacciones',cuerpoTx(copiaExtra));});
    else toast('Abono eliminado','success');
  }catch(e){avisarErrorAbono(e);}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const eliminarAbono=guardedOnce(eliminarAbono__base);

// ── Edición inline de fechas ─────────────────────────────────────────────────
async function editarFechaDeuda__base(id,campo,valor){
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(id));
  if(!d)return;
  const patch=campo==='inicio'?{fecha_inicio:valor}:{fecha_venc:valor};
  const antes=campo==='inicio'?{fecha_inicio:d[5]}:{fecha_venc:d[6]||null};
  try{
    await sbUpdate('deudas',id,patch);
    if(campo==='inicio') d[5]=valor; else d[6]=valor;
    ofrecerDeshacer('Fecha guardada',()=>sbUpdate('deudas',id,antes));
  }catch(e){toast('Error al guardar fecha','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const editarFechaDeuda=guardedOnce(editarFechaDeuda__base);
