// Presupuestos en Estadísticas: tarjetas del período, formulario y borrado.
// Los cálculos viven en presupuestos-calculo.js. Guardar y eliminar pasan por
// dos funciones de Supabase que hacen cada cambio en una sola transacción y
// devuelven todos los presupuestos: se reemplaza la copia local sin recargar.

import {sessionUserId} from '../services/auth.js';
import {sbFetch} from '../services/supabase.js';
import {datos} from '../state.js';
import {toast} from '../ui/toast.js';
import {cleanName, escAttr, escHtml, fmt, getEmoji} from '../utils/formatters.js';
import {claveAmbito, claveCategoria, consumoDe, consumoDelPeriodo, estadoPresupuesto, filaPresupuesto, hoyLima, inicioPeriodo, moverPeriodo, nombrePeriodo, presupuestoVigente, presupuestosDelPeriodo, rangoPeriodo, reglaDeSerie} from './presupuestos-calculo.js';

const PRES_VISTA_KEY='finanzas.presupuestos.vista.v1';
// Solo la pestaña elegida se recuerda en el dispositivo. Los presupuestos se
// leen siempre de Supabase.
let presVista=(()=>{try{return localStorage.getItem(PRES_VISTA_KEY)==='semanal'?'semanal':'mensual';}catch{return 'mensual';}})();
const presInicio={mensual:null,semanal:null};
let presForm=null,presBorrado=null,presGuardando=false;

const elPres=id=>document.getElementById(id);
const inicioVista=tipo=>presInicio[tipo]||inicioPeriodo(tipo,hoyLima());
const unidad=tipo=>tipo==='semanal'?'semana':'mes';
const nombrePresupuesto=p=>p[4]==='general'?'Presupuesto general':cleanName(p[0]);
const iconoPresupuesto=p=>p[4]==='general'?{e:'🎯',h:'var(--accent)',c:'rgba(0,214,143,0.14)'}:getEmoji(cleanName(p[0]));
const filasPres=()=>datos.presupuestos||[];

export function setPresVista(tipo){
  presVista=tipo==='semanal'?'semanal':'mensual';
  try{localStorage.setItem(PRES_VISTA_KEY,presVista);}catch{}
  renderPresupuestos();
}

export function moverPresPeriodo(n){
  const destino=moverPeriodo(presVista,inicioVista(presVista),n);
  presInicio[presVista]=destino===inicioPeriodo(presVista,hoyLima())?null:destino;
  renderPresupuestos();
}

export function irPresPeriodoActual(){presInicio[presVista]=null;renderPresupuestos();}

function textoRepeticion(p,inicio){
  if(p[8])return 'Se repite cada '+unidad(p[5]);
  if(reglaDeSerie(filasPres(),p,inicio))return 'Ajustado solo para este período';
  return 'Sin repetición';
}

function tarjetaPresupuesto({p,consumo,estado},inicio,hoy){
  const nombre=nombrePresupuesto(p),icono=iconoPresupuesto(p),limite=Math.round(p[1]*100);
  const pie=estado.estado==='excedido'?'Te excediste '+fmt(estado.exceso/100)
    :estado.estado==='alcanzado'?'Límite alcanzado'
    :'Quedan '+fmt(estado.disponible/100);
  const aviso=estado.estado==='cerca'?'<span class="pres-chip">⚠ Cerca del límite</span>':'';
  const barra=estado.estado==='normal'?'ok':estado.estado==='excedido'?'over':'warn';
  const incompleto=consumo.incompletos?`<p class="pres-incompleto">Cálculo incompleto: ${consumo.incompletos} gasto${consumo.incompletos===1?'':'s'} sin un equivalente en soles válido.</p>`:'';
  const pct=estado.pctTexto+' % utilizado';
  return `<article class="bitem pres-item pres-${estado.estado}" aria-label="${escAttr(nombre+': '+fmt(consumo.total/100)+' de '+fmt(limite/100)+', '+pct)}">
    <div class="pres-item-top">
      <span class="pres-icon" style="color:${icono.h};background:${icono.c}" aria-hidden="true">${icono.e}</span>
      <div class="pres-item-title"><strong>${escHtml(nombre)}</strong><span>${escHtml(nombrePeriodo(p[5],inicio,hoy)+' · '+textoRepeticion(p,inicio))}</span></div>
    </div>
    <div class="pres-amounts"><span><strong>${fmt(consumo.total/100)}</strong> de ${fmt(limite/100)}</span><span class="pres-pct">${pct}</span></div>
    <div class="bbar pres-bar" role="progressbar" aria-label="${escAttr('Uso de '+nombre)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(estado.barra)}" aria-valuetext="${escAttr(pct)}"><div class="bfill ${barra}" style="width:${estado.barra.toFixed(2)}%"></div></div>
    <div class="pres-foot"><div class="pres-estado"><span class="pres-left">${pie}</span>${aviso}</div><div class="pres-item-actions"><button type="button" class="line-edit-btn" data-pres-id="${escAttr(p[3])}" onclick="editarPresupuesto(this.dataset.presId)" aria-label="${escAttr('Editar '+nombre)}">Editar</button><button type="button" class="line-edit-btn pres-delete" data-pres-id="${escAttr(p[3])}" onclick="eliminarPresupuesto(this.dataset.presId)" aria-label="${escAttr('Eliminar '+nombre)}">Eliminar</button></div></div>${incompleto}
  </article>`;
}

export function renderPresupuestos(){
  const lista=elPres('presupuestosLista');if(!lista)return;
  const tipo=presVista,inicio=inicioVista(tipo),hoy=hoyLima(),actual=inicioPeriodo(tipo,hoy);
  for(const [id,t] of [['presTabMes','mensual'],['presTabSemana','semanal']]){
    const b=elPres(id);if(!b)continue;b.classList.toggle('active',tipo===t);b.setAttribute('aria-selected',String(tipo===t));
  }
  const nombre=elPres('presPeriodoNombre');if(nombre)nombre.textContent=nombrePeriodo(tipo,inicio,hoy);
  const fechas=elPres('presPeriodoFechas');if(fechas)fechas.textContent=rangoPeriodo(tipo,inicio);
  const volver=elPres('presActual');if(volver){volver.hidden=inicio===actual;volver.textContent=tipo==='semanal'?'Ir a esta semana':'Ir a este mes';}
  const gastado=elPres('presGastado');
  if(!datos.cargados){
    if(gastado)gastado.textContent='';
    lista.innerHTML='<p class="hint">Tus presupuestos aparecerán cuando terminen de cargar tus datos.</p>';return;
  }
  const consumo=consumoDelPeriodo(datos.transacciones,tipo,inicio);
  if(gastado)gastado.textContent='Gasto neto: '+fmt(consumo.total/100)+(consumo.incompletos?' · cálculo incompleto':'');
  if(!filasPres().length){
    lista.innerHTML=`<div class="pres-empty"><p><strong>Aún no tienes presupuestos.</strong> Pon un límite de gasto mensual o semanal, general o para una categoría, y mira cuánto te queda.</p><button type="button" class="btn btn-p" onclick="abrirNuevoPresupuesto()">Crear tu primer presupuesto</button></div>`;
    return;
  }
  const vigentes=presupuestosDelPeriodo(filasPres(),tipo,inicio).map(p=>{
    const c=consumoDe(consumo,p);return {p,consumo:c,estado:estadoPresupuesto(c.total,Math.round(p[1]*100))};
  }).sort((a,b)=>(a.p[4]==='general'?0:1)-(b.p[4]==='general'?0:1)||b.estado.pct-a.estado.pct||nombrePresupuesto(a.p).localeCompare(nombrePresupuesto(b.p),'es'));
  if(!vigentes.length){
    lista.innerHTML=`<p class="pres-empty-line">No hay presupuestos ${tipo==='semanal'?'semanales':'mensuales'} para ${tipo==='semanal'?'esta semana':'este mes'}.</p>`;
    return;
  }
  lista.innerHTML=vigentes.map(v=>tarjetaPresupuesto(v,inicio,hoy)).join('');
}

// ── Formulario ─────────────────────────────────────────────────────────────
function sesionPresupuestos(usuario){
  if(!usuario||sessionUserId()!==usuario)throw new Error('La sesión cambió. Cierra el formulario y vuelve a abrirlo.');
  if(!datos.cargados)throw new Error('Espera a que carguen tus datos.');
}

function errorPresForm(mensaje){const e=elPres('presFormError');if(e){e.textContent=mensaje||'';e.hidden=!mensaje;}}

function marcarPresGuardando(valor,boton,texto){
  presGuardando=valor;
  const hoja=elPres(boton==='presGuardar'?'presupuestoModal':'presEliminarModal');
  hoja?.setAttribute('aria-busy',String(valor));
  hoja?.querySelectorAll('button,input,select').forEach(x=>{
    if(valor){x.dataset.presDisabled=x.disabled?'1':'';x.disabled=true;}
    else{x.disabled=x.dataset.presDisabled==='1';delete x.dataset.presDisabled;}
  });
  const b=elPres(boton);if(b&&texto)b.textContent=texto;
}

// Opciones del período de inicio alrededor del período que se está viendo.
function llenarInicios(tipo,elegido){
  const select=elPres('presInicio');if(!select)return;
  const hoy=hoyLima(),actual=inicioPeriodo(tipo,hoy),[antes,despues]=tipo==='semanal'?[12,52]:[12,24];
  const base=elegido<actual?elegido:actual,opciones=[];
  for(let i=-antes;i<=despues;i++)opciones.push(moverPeriodo(tipo,base,i));
  if(!opciones.includes(elegido))opciones.push(elegido);
  opciones.sort();
  select.innerHTML=opciones.map(o=>{
    const etiqueta=tipo==='semanal'?rangoPeriodo(tipo,o):nombrePeriodo(tipo,o,null);
    const marca=o===actual?(tipo==='semanal'?' · esta semana':' · este mes'):'';
    return `<option value="${o}">${escHtml(etiqueta+marca)}</option>`;
  }).join('');
  select.value=elegido;
}

function llenarCategoriasPres(){
  const c=elPres('presCategorias');if(!c||!presForm)return;
  const vistas=new Set(),cats=[];
  for(const [nombre] of datos.categorias||[]){
    if(!nombre)continue;const k=claveCategoria(nombre);if(vistas.has(k))continue;vistas.add(k);cats.push(nombre);
  }
  c.innerHTML=cats.length?cats.map(cat=>{
    const em=getEmoji(cleanName(cat)),sel=presForm.categoria&&claveCategoria(presForm.categoria)===claveCategoria(cat);
    return `<button type="button" class="cchip${sel?' selected':''}" data-cat="${escAttr(cat)}" aria-pressed="${sel?'true':'false'}" onclick="seleccionarPresCategoria(this)"><span class="cchip-emoji" style="color:${em.h};background:${em.c}">${em.e}</span>${escHtml(cleanName(cat))}</button>`;
  }).join(''):'<p class="hint">Agrega categorías en Configuración para crear presupuestos por categoría.</p>';
}

function pintarFormPresupuesto(){
  const f=presForm;if(!f)return;
  const crear=f.modo==='crear';
  elPres('presFormTitle').textContent=crear?'Crear presupuesto':'Editar presupuesto';
  elPres('presFormCampos').hidden=!crear;
  const resumen=elPres('presFormResumen');resumen.hidden=crear;
  if(!crear){
    const p=f.fila;
    resumen.innerHTML=`<strong>${escHtml(nombrePresupuesto(p))}</strong><span>${escHtml((p[5]==='semanal'?'Semanal':'Mensual')+' · '+nombrePeriodo(p[5],f.inicio)+' · '+rangoPeriodo(p[5],f.inicio))}</span>`;
  }
  for(const [id,v] of [['presAmbGeneral','general'],['presAmbCategoria','categoria']]){const b=elPres(id);b.classList.toggle('active',f.ambito===v);b.setAttribute('aria-pressed',String(f.ambito===v));}
  for(const [id,v] of [['presPerMensual','mensual'],['presPerSemanal','semanal']]){const b=elPres(id);b.classList.toggle('active',f.tipo===v);b.setAttribute('aria-pressed',String(f.tipo===v));}
  elPres('presCategoriaCampo').hidden=!crear||f.ambito!=='categoria';
  if(crear&&f.ambito==='categoria')llenarCategoriasPres();
  elPres('presInicioCampo').hidden=!crear;
  if(crear)llenarInicios(f.tipo,f.inicio);
  const conAlcance=!crear&&f.conSerie;
  elPres('presAlcanceCampo').hidden=!conAlcance;
  for(const [id,v] of [['presAlcancePeriodo','periodo'],['presAlcanceSiguientes','siguientes']]){const r=elPres(id);if(r)r.checked=f.alcance===v;}
  const repetir=crear||!f.conSerie||f.alcance==='siguientes';
  elPres('presRepetirCampo').hidden=!repetir;
  elPres('presRepetirTexto').textContent='Repetir cada '+unidad(f.tipo);
  elPres('presRepetir').checked=f.repetir;
  const nota=elPres('presAlcanceNota');
  if(nota){
    const despues=!crear&&filasPres().some(x=>x[9]===f.fila[9]&&!x[8]&&x[6]>f.inicio);
    nota.textContent=f.alcance==='siguientes'?'Los períodos anteriores conservan su límite.'+(despues?' Se reemplazan los ajustes de períodos posteriores.':'')
      :f.alcance==='periodo'?'Los demás períodos conservan el límite que se repite.':'';
  }
}

function abrirFormPresupuesto(estado){
  presForm=estado;errorPresForm('');
  const dup=elPres('presDuplicado');if(dup)dup.hidden=true;
  elPres('presMonto').value=estado.monto??'';
  pintarFormPresupuesto();
  elPres('presupuestoModal').classList.add('active');
  setTimeout(()=>elPres('presMonto')?.focus(),100);
}

export function abrirNuevoPresupuesto(){
  if(presGuardando)return;
  const usuario=sessionUserId();
  try{sesionPresupuestos(usuario);}catch(e){toast(e.message,'error');return;}
  abrirFormPresupuesto({modo:'crear',usuario,ambito:'general',categoria:'',tipo:presVista,inicio:inicioVista(presVista),repetir:true});
}

function estadoEdicion(fila,inicio,usuario,monto){
  const serie=fila[8]||!!reglaDeSerie(filasPres(),fila,inicio);
  return {modo:'editar',usuario,fila,id:fila[3],ambito:fila[4],categoria:fila[0]||'',tipo:fila[5],inicio,
    conSerie:serie,alcance:null,repetir:serie?true:fila[8],monto:monto??Number(fila[1]).toFixed(2)};
}

export function editarPresupuesto(id){
  if(presGuardando)return;
  const usuario=sessionUserId();
  try{sesionPresupuestos(usuario);}catch(e){toast(e.message,'error');return;}
  const fila=filasPres().find(p=>String(p[3])===String(id));
  if(!fila){toast('Este presupuesto ya no está disponible.','error');return;}
  abrirFormPresupuesto(estadoEdicion(fila,inicioVista(fila[5]),usuario));
}

export function cerrarPresupuestoForm(){
  if(presGuardando)return;
  elPres('presupuestoModal').classList.remove('active');presForm=null;
}

export function setPresAmbito(ambito){if(!presForm||presGuardando||presForm.modo!=='crear')return;presForm.ambito=ambito;pintarFormPresupuesto();}
export function setPresTipo(tipo){
  if(!presForm||presGuardando||presForm.modo!=='crear'||presForm.tipo===tipo)return;
  presForm.tipo=tipo;presForm.inicio=tipo===presVista?inicioVista(tipo):inicioPeriodo(tipo,hoyLima());pintarFormPresupuesto();
}
export function seleccionarPresCategoria(boton){if(!presForm||presGuardando)return;presForm.categoria=boton.dataset.cat;llenarCategoriasPres();}
export function cambiarPresInicio(){if(presForm)presForm.inicio=elPres('presInicio').value;}
export function cambiarPresRepetir(){if(presForm)presForm.repetir=elPres('presRepetir').checked;}
export function setPresAlcance(alcance){if(!presForm||presGuardando)return;presForm.alcance=alcance;errorPresForm('');pintarFormPresupuesto();}

// Límite en céntimos, o un mensaje si no es válido.
export function leerLimitePresupuesto(texto){
  const s=String(texto??'').trim().replace(/\s/g,'');
  const normal=s.includes(',')&&!s.includes('.')?s.replace(',','.'):s;
  if(!/^\d+(\.\d+)?$/.test(normal))return {error:'Escribe un límite en soles mayor que cero.'};
  if(/\.\d{3,}$/.test(normal))return {error:'Usa como máximo dos decimales.'};
  const c=Math.round(Number(normal)*100);
  if(!(c>0))return {error:'Escribe un límite en soles mayor que cero.'};
  if(c>=1000000000000)return {error:'El límite es demasiado alto.'};
  return {centimos:c};
}

// Presupuesto que ya ocupa el mismo ámbito y tipo de período.
function conflictoPresupuesto(f){
  const filas=filasPres(),clave=claveAmbito(f.ambito,f.categoria);
  return presupuestoVigente(filas,f.ambito,f.categoria,f.tipo,f.inicio)
    ||(f.repetir?filas.filter(p=>p[8]&&p[5]===f.tipo&&claveAmbito(p[4],p[0])===clave&&(!p[7]||p[7]>f.inicio)).sort((a,b)=>a[6]<b[6]?-1:1)[0]:null)
    ||null;
}

function mostrarDuplicado(fila){
  const caja=elPres('presDuplicado');if(!caja||!presForm)return;
  presForm.duplicado=fila;
  const desde=fila[6]>presForm.inicio?fila[6]:presForm.inicio;
  elPres('presDuplicadoTexto').textContent=`Ya tienes un presupuesto ${fila[5]==='semanal'?'semanal':'mensual'} ${fila[4]==='general'?'general':'para '+cleanName(fila[0])} en ${nombrePeriodo(fila[5],desde).toLowerCase()} (${rangoPeriodo(fila[5],desde)}). Puedes editarlo con el importe que escribiste.`;
  caja.hidden=false;
}

export function editarPresupuestoExistente(){
  const f=presForm;if(!f?.duplicado||presGuardando)return;
  const fila=filasPres().find(p=>p[3]===f.duplicado[3]);if(!fila){errorPresForm('Ese presupuesto ya no está disponible. Actualiza e inténtalo de nuevo.');return;}
  const inicio=fila[6]>f.inicio?fila[6]:f.inicio;
  presVista=fila[5];presInicio[fila[5]]=inicio===inicioPeriodo(fila[5],hoyLima())?null:inicio;
  renderPresupuestos();
  abrirFormPresupuesto(estadoEdicion(fila,inicio,f.usuario,elPres('presMonto').value));
}

function mensajeErrorPresupuesto(e,verbo='guardar'){
  const m=e?.message||'';
  if(e?.code==='PGRST202'||/guardar_presupuesto|eliminar_presupuesto|schema cache/i.test(m))return 'Los presupuestos todavía no están disponibles. Inténtalo más tarde.';
  if(e instanceof TypeError||/Failed to fetch|NetworkError|Load failed/i.test(m))return 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  if(/violates|constraint|syntax|null value/i.test(m))return 'No se pudo '+verbo+' el presupuesto. Revisa los datos e inténtalo de nuevo.';
  return m||'No se pudo '+verbo+' el presupuesto. Inténtalo de nuevo.';
}

export async function guardarPresupuesto(){
  const f=presForm;if(presGuardando||!f)return;
  errorPresForm('');const dup=elPres('presDuplicado');if(dup)dup.hidden=true;
  try{sesionPresupuestos(f.usuario);}catch(e){errorPresForm(e.message);return;}
  const limite=leerLimitePresupuesto(elPres('presMonto').value);
  if(limite.error){errorPresForm(limite.error);return;}
  if(f.modo==='crear'){
    f.inicio=elPres('presInicio').value||f.inicio;f.repetir=elPres('presRepetir').checked;
    if(f.ambito==='categoria'&&!f.categoria){errorPresForm('Elige una categoría.');return;}
    const otro=conflictoPresupuesto(f);
    if(otro){mostrarDuplicado(otro);return;}
  }else{
    if(f.conSerie&&!f.alcance){errorPresForm('Elige si el cambio aplica solo a este período o también a los siguientes.');return;}
    f.repetir=elPres('presRepetir').checked;
  }
  const alcance=f.modo==='crear'?'crear':f.conSerie?f.alcance:'siguientes';
  const cuerpo={p_id:f.modo==='crear'?null:f.id,p_ambito:f.ambito,p_categoria:f.ambito==='categoria'?f.categoria:null,p_periodo:f.tipo,
    p_inicio:f.inicio,p_monto:limite.centimos/100,p_recurrente:alcance==='periodo'?false:!!f.repetir,p_alcance:alcance};
  marcarPresGuardando(true,'presGuardar','Guardando…');
  try{
    const filas=await sbFetch('rpc/guardar_presupuesto',{method:'POST',body:JSON.stringify(cuerpo)});
    sesionPresupuestos(f.usuario);
    if(!Array.isArray(filas))throw new Error('No se pudo confirmar el guardado. Actualiza para revisarlo.');
    datos.presupuestos=filas.map(filaPresupuesto);
    if(f.modo==='crear'){presVista=f.tipo;presInicio[f.tipo]=f.inicio===inicioPeriodo(f.tipo,hoyLima())?null:f.inicio;try{localStorage.setItem(PRES_VISTA_KEY,presVista);}catch{}}
    marcarPresGuardando(false,'presGuardar','Guardar');
    cerrarPresupuestoForm();renderPresupuestos();
    toast(f.modo==='crear'?'Presupuesto creado':'Presupuesto actualizado','success');
  }catch(e){
    if(presForm===f){
      const otro=e?.code==='23505'?filasPres().find(p=>String(p[3])===String(e.details||'')):null;
      if(otro&&f.modo==='crear')mostrarDuplicado(otro);
      else errorPresForm(e?.code==='23505'?'Ya tienes un presupuesto equivalente para ese período. Actualiza y edita el existente.':mensajeErrorPresupuesto(e));
    }
  }finally{if(presGuardando)marcarPresGuardando(false,'presGuardar','Guardar');}
}

// ── Eliminar ───────────────────────────────────────────────────────────────
export function eliminarPresupuesto(id){
  if(presGuardando)return;
  const usuario=sessionUserId();
  try{sesionPresupuestos(usuario);}catch(e){toast(e.message,'error');return;}
  const fila=filasPres().find(p=>String(p[3])===String(id));
  if(!fila){toast('Este presupuesto ya no está disponible.','error');return;}
  const inicio=inicioVista(fila[5]),regla=fila[8]?fila:reglaDeSerie(filasPres(),fila,inicio);
  const nombre=nombrePresupuesto(fila),periodo=nombrePeriodo(fila[5],inicio)+' ('+rangoPeriodo(fila[5],inicio)+')';
  const historial=filasPres().some(x=>x[9]===fila[9]&&x[6]<inicio);
  const ajustes=filasPres().some(x=>x[9]===fila[9]&&!x[8]&&x[6]>inicio);
  let texto,acciones;
  if(!regla){
    texto=`Se eliminará ${nombre==='Presupuesto general'?'el presupuesto general':'el presupuesto de '+nombre} de ${periodo}. Los demás períodos no cambian.`;
    acciones=[['periodo','Eliminar este período','btn-d']];
  }else if(regla===fila){
    texto=historial
      ?`${nombre} dejará de repetirse desde ${periodo}. Los períodos anteriores conservan su límite.`
      :`Se eliminará ${nombre==='Presupuesto general'?'el presupuesto general':'el presupuesto de '+nombre}, que se repite desde ${periodo}.`;
    if(ajustes)texto+=' También se quitarán los ajustes de períodos posteriores.';
    acciones=[['siguientes',historial?'Dejar de repetir desde aquí':'Eliminar presupuesto','btn-d']];
  }else{
    texto=`${periodo} tiene un ajuste de ${fmt(fila[1])} sobre el presupuesto que se repite (${fmt(regla[1])}). Puedes quitar solo el ajuste o dejar de repetirlo desde este período; los anteriores conservan su límite.`;
    acciones=[['periodo','Quitar el ajuste','btn-s'],['siguientes','Dejar de repetir desde aquí','btn-d']];
  }
  presBorrado={id:fila[3],inicio,usuario};
  elPres('presEliminarTitle').textContent='Eliminar '+(nombre==='Presupuesto general'?'presupuesto general':nombre);
  elPres('presEliminarTexto').textContent=texto;
  const error=elPres('presEliminarError');if(error){error.hidden=true;error.textContent='';}
  elPres('presEliminarAcciones').innerHTML='<button type="button" class="btn btn-s" onclick="cerrarEliminarPresupuesto()">Cancelar</button>'+
    acciones.map(([alcance,etiqueta,clase],i)=>`<button type="button" class="btn ${clase}" id="presEliminarBtn${i}" onclick="confirmarEliminarPresupuesto('${alcance}',this.id)">${etiqueta}</button>`).join('');
  elPres('presEliminarModal').classList.add('active');
}

export function cerrarEliminarPresupuesto(){
  if(presGuardando)return;
  elPres('presEliminarModal').classList.remove('active');presBorrado=null;
}

export async function confirmarEliminarPresupuesto(alcance,boton){
  const b=presBorrado;if(presGuardando||!b)return;
  const error=elPres('presEliminarError');
  try{sesionPresupuestos(b.usuario);}catch(e){if(error){error.textContent=e.message;error.hidden=false;}return;}
  const etiqueta=elPres(boton)?.textContent;
  marcarPresGuardando(true,boton,'Eliminando…');
  try{
    const filas=await sbFetch('rpc/eliminar_presupuesto',{method:'POST',body:JSON.stringify({p_id:b.id,p_inicio:b.inicio,p_alcance:alcance})});
    sesionPresupuestos(b.usuario);
    if(!Array.isArray(filas))throw new Error('No se pudo confirmar la eliminación. Actualiza para revisarlo.');
    datos.presupuestos=filas.map(filaPresupuesto);
    marcarPresGuardando(false,boton,etiqueta);
    cerrarEliminarPresupuesto();renderPresupuestos();
    toast(alcance==='periodo'?'Presupuesto eliminado de este período':'Presupuesto eliminado desde este período','success');
  }catch(e){
    if(presBorrado===b&&error){error.textContent=mensajeErrorPresupuesto(e,'eliminar');error.hidden=false;}
  }finally{if(presGuardando)marcarPresGuardando(false,boton,etiqueta);}
}
