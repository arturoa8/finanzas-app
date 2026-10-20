// Deudas y abonos.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentasApp} from './accounts.js';
import {CREDIT_CARDS} from './cards/config.js';
import {render} from './dashboard.js';
import {archivarFila, cobradoDeuda, desarchivarFila, devueltoCentimos, filaDeuda, gastoDeDeuda, pendienteDeuda} from './por-cobrar.js';
import {cargar, cuerpoTx, editarTx, getTxRow, sameAccount} from './transactions.js';
import {sbDelete, sbInsert, sbUpdate} from '../services/supabase.js';
import {abonoPendiente, ejecutarAbono} from '../services/debt-operations.js';
import {guardarReembolsoConExcedente} from '../services/refund-operations.js';
import {datos} from '../state.js';
import {ofrecerDeshacer} from '../ui/deshacer.js';
import {toast} from '../ui/toast.js';
import {guardedOnce} from '../utils/async.js';
import {buildFechaISO, fmtDateShort, pf, toDateInput} from '../utils/dates.js';
import {escAttr, escHtml, fmtC, fmtD} from '../utils/formatters.js';

// Pestana activa de deudas. La escribe setDT(), aqui mismo.
export let dT='me-deben';

let editandoDeuda=null,abonosDeudaId=null,archivarDeudaId=null,deudaTipoModal='me-deben';

let editandoAbonoId=null,historialDeudaId=null;
let solicitudAbonoId=null,solicitudAbonoTxId=null;
function avisarErrorAbono(e){
  const mensaje=e.message||'No se pudo guardar el abono';toast(mensaje,'error');
  if(e.pending){const aviso=document.getElementById('dataStatus');if(aviso){aviso.hidden=false;aviso.textContent=mensaje;}}
}

export function renderDeb(){
  const l=document.getElementById('debs');
  if(dT==='archivadas'){renderDebArchivadas(l);return;}
  const activas=(datos.deudas||[]).filter(d=>(d[7]||'').toString().toLowerCase()===dT);
  if(activas.length===0){l.innerHTML='<div class="empty">Nada por aquí</div>';return;}
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
  const esMeDeben=dT==='me-deben';
  const hoy=new Date();
  l.innerHTML=activas.map(d=>{
    const id=String(d[0]);
    const monto=parseFloat(d[3])||0;
    // Un gasto por cobrar se salda con reembolsos del gasto, no con abonos.
    const gasto=d[8]?gastoDeDeuda(d):null;
    const abonado=d[8]?cobradoDeuda(d):(datos.deudasAbonos||[]).filter(ab=>_abDeudaId(ab)===id).reduce((s,ab)=>s+_abMonto(ab),0);
    const pendiente=Math.max(0,monto-abonado);
    const pct=monto>0?Math.min(100,Math.round(abonado/monto*100)):0;
    const fiVal=toDateInput(d[5]);const fvVal=toDateInput(d[6]);
    const fvDate=fvVal?pf(fvVal):null;
    const vencida=fvDate&&fvDate<hoy&&pendiente>0;
    const cls=esMeDeben?'in':'out';const signo=esMeDeben?'+':'−';
    const diasVenc=fvDate?Math.ceil((fvDate-hoy)/(1000*60*60*24)):null;
    const warnVenc=fvDate&&diasVenc<=7&&diasVenc>=0&&pendiente>0;
    return `<div class="dcard${vencida?' vencida':''}">
      <div class="dcard-top">
        <div class="dcard-info">
          <div class="dcard-person">${escHtml(d[1]||'?')}</div>
          <div class="dcard-desc">${escHtml(d[2]||'')}</div>
          ${gasto?`<div class="dcard-origen">Pagaste ${fmtD(gasto[4])} con ${escHtml(gasto[5]||'—')} · ${fmtDateShort(pf(gasto[0]))}</div>`:''}
          ${vencida?'<div class="dcard-venc-warn">⚠ Vencida</div>':''}
          ${warnVenc?`<div class="dcard-venc-warn" style="color:var(--yellow)">⚡ Vence en ${diasVenc} día${diasVenc!==1?'s':''}</div>`:''}
        </div>
        <div class="dcard-right">
          <div class="dcard-amt ${cls}">${signo}${fmtD(pendiente)}</div>
          ${abonado>0?`<div class="dcard-subamt">de ${fmtD(monto)}</div>`:''}
        </div>
      </div>
      ${abonado>0?`<div class="dcard-prog">
        <div class="dcard-progbar"><div class="dcard-progfill ${cls}" style="width:${pct}%"></div></div>
        <div class="dcard-progmeta"><span>${d[8]?'Cobrado':'Abonado'} ${fmtD(abonado)}</span><span>${pct}%</span></div>
      </div>`:''}
      <div class="dcard-dates">
        <div class="dcard-date">
          <div class="dcard-date-lbl">DESDE</div>
          <input type="date" value="${fiVal}" onchange="editarFechaDeuda('${id}','inicio',this.value)">
        </div>
        <div class="dcard-date">
          <div class="dcard-date-lbl">VENCE</div>
          <input type="date" value="${fvVal}" onchange="editarFechaDeuda('${id}','venc',this.value)">
        </div>
      </div>
      <div class="dcard-actions">
        <button class="dcard-btn primary" onclick="abrirModalAbono('${id}')">${d[8]?'Cobrar':'Abonar'}</button>
        <button class="dcard-btn" onclick="abrirHistorialAbonos('${id}')">Historial</button>
        <button class="dcard-btn" onclick="${gasto?`editarGastoDeDeuda('${id}')`:`abrirModalDeudaEdit('${id}')`}">✎ Editar</button>
        <button class="dcard-btn danger" onclick="abrirModalArchivar('${id}')">Archivar</button>
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
    const logAb=d[10]?Math.min(Math.round(monto*100),devueltoCentimos(d[10]))/100:calcAbonadoFromLog(d[0]);
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
  document.getElementById('deudaModalBtns').innerHTML='<button class="btn btn-s" onclick="cerrarModalDeuda()">Cancelar</button><button class="btn btn-p" onclick="guardarDeuda()">Guardar</button>';
  document.getElementById('modalDeuda').classList.add('active');
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
  abonosDeudaId=id;
  const operacionPendiente=abonoPendiente();
  solicitudAbonoId=operacionPendiente?.tipo==='crear'&&String(operacionPendiente.abono.deuda_id)===String(id)?operacionPendiente.id:crypto.randomUUID();
  solicitudAbonoTxId=operacionPendiente?.id===solicitudAbonoId?operacionPendiente.tx?.id:crypto.randomUUID();
  const monto=parseFloat(d[3])||0;
  const vinculada=!!d[8];
  const abonado=vinculada?cobradoDeuda(d):calcAbonadoFromLog(id);
  const pendiente=Math.max(0,monto-abonado);
  const esMeDeben=(d[7]||'').toString().toLowerCase()==='me-deben';
  document.getElementById('abonoTitle').textContent=vinculada?'Cobrar a '+(d[1]||''):(esMeDeben?'Cobro recibido':'Pago realizado')+' — '+(d[1]||'');
  document.getElementById('abonoPendienteLbl').textContent=vinculada
    ?'Te debe '+fmtD(pendiente)+' de '+fmtD(monto)+'. Se registra como reembolso del gasto; si te pagó de más, el resto queda como ingreso.'
    :'Pendiente: '+fmtC(pendiente)+' de '+fmtC(monto);
  document.getElementById('abonoFecha').value=toDateInput(new Date());
  document.getElementById('abonoMonto').value='';
  document.getElementById('abonoMonto').placeholder=vinculada?'Monto que te devolvió':'Monto a abonar';
  document.getElementById('abonoNota').value='';
  document.getElementById('abonoCuentaRow').hidden=!vinculada;
  if(vinculada)llenarCuentaCobro(gastoDeDeuda(d));
  document.getElementById('abonoGuardarBtn').textContent=vinculada?'Cobrar':'Abonar';
  document.getElementById('abonoTodoBtn').textContent=vinculada?'Todo':'Pagar todo';
  if(operacionPendiente?.id===solicitudAbonoId){document.getElementById('abonoMonto').value=operacionPendiente.abono.monto;document.getElementById('abonoFecha').value=toDateInput(operacionPendiente.abono.fecha);document.getElementById('abonoNota').value=operacionPendiente.abono.nota||'';}
  document.getElementById('modalAbono').classList.add('active');
}

export function cerrarModalAbono(){document.getElementById('modalAbono').classList.remove('active');abonosDeudaId=null;}

export function abonarTodo(){
  if(!abonosDeudaId)return;
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(abonosDeudaId));
  if(!d)return;
  const monto=parseFloat(d[3])||0;
  const abonado=d[8]?cobradoDeuda(d):calcAbonadoFromLog(abonosDeudaId);
  document.getElementById('abonoMonto').value=Math.max(0,monto-abonado).toFixed(2);
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
async function guardarAbono__base(){
  if(!abonosDeudaId)return;
  const monto=Number(document.getElementById('abonoMonto').value);
  if(!Number.isFinite(monto)||monto<=0){toast('Ingresa un monto válido','error');return;}
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(abonosDeudaId));
  const fecha=document.getElementById('abonoFecha').value;
  if(!fecha){toast('Completa la fecha del abono','error');return;}
  const nota=document.getElementById('abonoNota').value.trim();
  const tipo=(d&&d[7]||'').toString().toLowerCase();
  if(d?.[8])return cobrarGasto(d,monto,fecha,nota);
  try{
    const tx=tipo==='me-deben'?{id:solicitudAbonoTxId,fecha,descripcion:d?d[1]:'',categoria:'Inversiones',tipo:'Ingreso',monto,cuenta:''}:null;
    const id=solicitudAbonoId;
    await ejecutarAbono({tipo:'crear',id,tx,abono:{id,deuda_id:abonosDeudaId,monto,fecha,nota,tx_id:tx?.id||null}});
    cerrarModalAbono();await cargar({silencioso:true});
    ofrecerDeshacer('Pago registrado',()=>ejecutarAbono({tipo:'eliminar',id,txId:tx?.id||null}));
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
  const pendiente=pendienteDeuda(d);
  const centimos=Math.round(monto*100),devuelto=Math.min(centimos,Math.round(pendiente*100)),exceso=centimos-devuelto;
  const cuenta=document.getElementById('abonoCuenta').value;
  if(!cuenta){toast('Elige dónde recibiste el dinero','error');return;}
  if(exceso>0&&CREDIT_CARDS.some(card=>sameAccount(card.cuenta,cuenta))){toast('Te debe '+fmtD(pendiente)+'. Para lo que te pagó de más, elige la cuenta donde recibiste el dinero: el pago a la tarjeta se registra en Tarjetas.','error');return;}
  if(pf(fecha)<new Date(pf(gasto[0]).getFullYear(),pf(gasto[0]).getMonth(),pf(gasto[0]).getDate())){toast('El cobro no puede ser anterior al gasto','error');return;}
  const ahora=new Date(),hora=`${ahora.getHours()%12||12}:${String(ahora.getMinutes()).padStart(2,'0')} ${ahora.getHours()>=12?'p. m.':'a. m.'}`;
  const [yy,mm,dd]=fecha.split('-');
  const comun={fecha:buildFechaISO(yy,mm,dd,hora),cuenta,cuenta_destino:null,moneda_original:null,monto_original:null,tc:null,tc_fuente:null,moneda_destino:null,monto_destino:null};
  const descripcion='Devolución de '+(d[1]||'')+(nota?' · '+nota:'');
  const filas=[];
  if(devuelto>0)filas.push({...comun,descripcion,categoria:gasto[2],tipo:'Reembolso',monto:devuelto/100,transaccion_origen_id:gasto[6]});
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
          <div style="font-size:0.75rem;color:var(--dim)">${fDisp}${nota?' · '+escHtml(nota):''}</div>
        </div>
        ${abonoId?`<div style="display:flex;gap:6px;"><button class="dcard-btn" onclick="abrirEditAbono('${abonoId}')">✎</button><button class="dcard-btn danger" onclick="eliminarAbono('${abonoId}')">✕</button></div>`:''}
      </div>
    </div>`;
  }).join('');
}

// Los cobros de un gasto son sus reembolsos: se editan como cualquier
// movimiento y se borran con la opción de deshacer.
function renderHistorialCobros(lista,deuda){
  const cobros=(datos.transacciones||[]).filter(t=>t[3]==='Reembolso'&&String(t[8])===String(deuda[8])).sort((a,b)=>pf(b[0])-pf(a[0]));
  if(cobros.length===0){lista.innerHTML='<div class="empty" style="padding:20px 0">Todavía no te devolvió nada</div>';return;}
  lista.innerHTML=cobros.map(t=>{
    const id=escAttr(String(t[6]));
    return `<div class="dcard" style="margin-bottom:8px;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <div style="font-weight:700;color:var(--green)">${fmtD(t[4])}</div>
          <div style="font-size:0.75rem;color:var(--dim)">${pf(t[0]).toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'})} · en ${escHtml(t[5]||'—')}</div>
        </div>
        <div style="display:flex;gap:6px;"><button class="dcard-btn" onclick="editarCobro('${id}')" aria-label="Editar cobro">✎</button><button class="dcard-btn danger" onclick="eliminarCobro('${id}')" aria-label="Eliminar cobro">✕</button></div>
      </div>
    </div>`;
  }).join('');
}

export function editarCobro(txId){
  cerrarHistorialAbonos();
  editarTx(txId);
}

async function eliminarCobro__base(txId){
  const t=(datos.transacciones||[]).find(x=>String(x[6])===String(txId));
  if(!t)return;
  const copia=[...t];
  try{
    await sbDelete('transacciones',txId);
    await cargar({silencioso:true});
    render();
    if(historialDeudaId)renderHistorialAbonos();
    ofrecerDeshacer('Cobro eliminado',()=>sbInsert('transacciones',cuerpoTx(copia)));
  }catch(e){toast(e.message||'No se pudo eliminar el cobro','error');}
}
export const eliminarCobro=guardedOnce(eliminarCobro__base);

export function abrirEditAbono(abonoId){
  const ab=(datos.deudasAbonos||[]).find(x=>_abId(x)===String(abonoId));
  if(!ab)return;
  editandoAbonoId=abonoId;
  document.getElementById('editAbonoMonto').value=_abMonto(ab);
  document.getElementById('editAbonoFecha').value=toDateInput(_abFecha(ab));
  document.getElementById('editAbonoNota').value=_abNota(ab);
  // Cierra el historial para evitar conflicto de z-index entre modales
  document.getElementById('modalHistorialAbonos').classList.remove('active');
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
    await ejecutarAbono({tipo:'editar',id,txId,patch:{monto,fecha,nota}});
    await cargar({silencioso:true});
    cerrarEditAbono();
    render();
    if(historialDeudaId)renderHistorialAbonos();
    if(antes)ofrecerDeshacer('Abono actualizado',()=>ejecutarAbono({tipo:'editar',id,txId,patch:antes}));
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
    await ejecutarAbono({tipo:'eliminar',id:abonoId,txId});
    await cargar({silencioso:true});
    render();
    if(historialDeudaId)renderHistorialAbonos();
    if(copia)ofrecerDeshacer('Abono eliminado',()=>ejecutarAbono(copia));
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
