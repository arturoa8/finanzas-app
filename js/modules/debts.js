// Deudas y abonos.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {render} from './dashboard.js';
import {getTxRow} from './transactions.js';
import {sbDelete, sbInsert, sbUpdate} from '../services/supabase.js';
import {abonoPendiente, ejecutarAbono} from '../services/debt-operations.js';
import {cargar} from './transactions.js';
import {datos} from '../state.js';
import {toast} from '../ui/toast.js';
import {guardedOnce} from '../utils/async.js';
import {pf, toDateInput} from '../utils/dates.js';
import {escHtml, fmtC, fmtD} from '../utils/formatters.js';

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
    const abonado=(datos.deudasAbonos||[]).filter(ab=>_abDeudaId(ab)===id).reduce((s,ab)=>s+_abMonto(ab),0);
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
        <div class="dcard-progmeta"><span>Abonado ${fmtD(abonado)}</span><span>${pct}%</span></div>
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
        <button class="dcard-btn primary" onclick="abrirModalAbono('${id}')">Abonar</button>
        <button class="dcard-btn" onclick="abrirHistorialAbonos('${id}')">Historial</button>
        <button class="dcard-btn" onclick="abrirModalDeudaEdit('${id}')">✎ Editar</button>
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
    const logAb=calcAbonadoFromLog(d[0]);
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
      await sbUpdate('deudas',editandoDeuda,body);
      const d=datos.deudas.find(x=>String(x[0])===String(editandoDeuda));
      if(d){d[1]=persona;d[2]=desc;d[3]=parseFloat(monto);d[5]=fechaInicio;d[6]=fechaVenc||null;d[7]=deudaTipoModal;}
      toast('Deuda actualizada','success');
    } else {
      const row=await sbInsert('deudas',body);
      datos.deudas.push([row.id,row.persona,row.descripcion,row.monto,0,row.fecha_inicio,row.fecha_venc,row.tipo]);
      toast('Deuda registrada','success');
    }
    cerrarModalDeuda();render();
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
  const abonado=calcAbonadoFromLog(id);
  const pendiente=Math.max(0,monto-abonado);
  const esMeDeben=(d[7]||'').toString().toLowerCase()==='me-deben';
  document.getElementById('abonoTitle').textContent=(esMeDeben?'Cobro recibido':'Pago realizado')+' — '+escHtml(d[1]||'');
  document.getElementById('abonoPendienteLbl').textContent='Pendiente: '+fmtC(pendiente)+' de '+fmtC(monto);
  document.getElementById('abonoFecha').value=toDateInput(new Date());
  document.getElementById('abonoMonto').value='';
  document.getElementById('abonoNota').value='';
  if(operacionPendiente?.id===solicitudAbonoId){document.getElementById('abonoMonto').value=operacionPendiente.abono.monto;document.getElementById('abonoFecha').value=toDateInput(operacionPendiente.abono.fecha);document.getElementById('abonoNota').value=operacionPendiente.abono.nota||'';}
  document.getElementById('modalAbono').classList.add('active');
}

export function cerrarModalAbono(){document.getElementById('modalAbono').classList.remove('active');abonosDeudaId=null;}

export function abonarTodo(){
  if(!abonosDeudaId)return;
  const d=(datos.deudas||[]).find(x=>String(x[0])===String(abonosDeudaId));
  if(!d)return;
  const monto=parseFloat(d[3])||0;
  const abonado=calcAbonadoFromLog(abonosDeudaId);
  document.getElementById('abonoMonto').value=Math.max(0,monto-abonado).toFixed(2);
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
  try{
    const tx=tipo==='me-deben'?{id:solicitudAbonoTxId,fecha,descripcion:d?d[1]:'',categoria:'Inversiones',tipo:'Ingreso',monto,cuenta:''}:null;
    await ejecutarAbono({tipo:'crear',id:solicitudAbonoId,tx,abono:{id:solicitudAbonoId,deuda_id:abonosDeudaId,monto,fecha,nota,tx_id:tx?.id||null}});
    cerrarModalAbono();await cargar();toast('Pago registrado','success');
  }catch(e){avisarErrorAbono(e);}
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
    await sbUpdate('deudas',archivarDeudaId,{archivado:true,motivo_archivo:motivo,fecha_archivo:fechaArchivo});
    const idx=datos.deudas.findIndex(x=>String(x[0])===String(archivarDeudaId));
    if(idx>=0){
      const d=datos.deudas.splice(idx,1)[0];
      datos.deudasArchivadas.push([...d,motivo,fechaArchivo]);
    }
    toast('Deuda archivada','success');cerrarModalArchivar();render();
  }catch(e){toast('Error al archivar','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const confirmarArchivar=guardedOnce(confirmarArchivar__base);

async function confirmarDesarchivar__base(id){
  try{
    await sbUpdate('deudas',id,{archivado:false,motivo_archivo:null,fecha_archivo:null});
    const idx=datos.deudasArchivadas.findIndex(x=>String(x[0])===String(id));
    if(idx>=0){
      const d=datos.deudasArchivadas.splice(idx,1)[0];
      datos.deudas.push(d.slice(0,8));
    }
    toast('Deuda restaurada','success');render();
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
  document.getElementById('historialAbonosTitle').textContent='Abonos — '+(d?escHtml(d[1]||''):'');
  renderHistorialAbonos();
  document.getElementById('modalHistorialAbonos').classList.add('active');
}

export function cerrarHistorialAbonos(){
  document.getElementById('modalHistorialAbonos').classList.remove('active');
  historialDeudaId=null;
}

function renderHistorialAbonos(){
  const lista=document.getElementById('historialAbonosList');
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
    const ab=datos.deudasAbonos.find(x=>_abId(x)===String(editandoAbonoId));
    await ejecutarAbono({tipo:'editar',id:editandoAbonoId,txId:ab?_abTxId(ab):null,patch:{monto,fecha,nota}});
    await cargar();
    toast('Abono actualizado','success');
    cerrarEditAbono();
    render();
    if(historialDeudaId)renderHistorialAbonos();
  }catch(e){avisarErrorAbono(e);}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarEditAbono=guardedOnce(guardarEditAbono__base);

async function eliminarAbono__base(abonoId){
  try{
    const ab=datos.deudasAbonos.find(x=>_abId(x)===String(abonoId));
    const txId=ab?_abTxId(ab):null;
    await ejecutarAbono({tipo:'eliminar',id:abonoId,txId});
    await cargar();
    toast('Abono eliminado','success');
    render();
    if(historialDeudaId)renderHistorialAbonos();
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
  try{
    await sbUpdate('deudas',id,patch);
    if(campo==='inicio') d[5]=valor; else d[6]=valor;
    toast('Fecha guardada','success');
  }catch(e){toast('Error al guardar fecha','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const editarFechaDeuda=guardedOnce(editarFechaDeuda__base);
