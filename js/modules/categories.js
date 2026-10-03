// El catálogo puede cambiar sin reescribir movimientos históricos.
// La categoría de cada movimiento, presupuesto y recurrente es texto libre.
import {sessionUserId} from '../services/auth.js';
import {sbFetch, sbInsert, sbUpdate} from '../services/supabase.js';
import {datos} from '../state.js';
import {toast} from '../ui/toast.js';
import {esc, escAttr, escHtml, getEmoji, norm} from '../utils/formatters.js';
import {render} from './dashboard.js';

const COLOR_DEFAULT='#00d68f';
let editor=null,eliminacion=null,ocupado=false;

function colorValido(color){return /^#[0-9a-f]{6}$/i.test(String(color||''));}
function colorCategoria(categoria){return colorValido(categoria?.[1])?categoria[1]:getEmoji(categoria?.[0]).h;}
function categoriaPorNombre(nombre){return (datos.categorias||[]).find(c=>c[0]===nombre);}

function usoCategoria(nombre){
 const movimientos=(datos.transacciones||[]).filter(t=>t[2]===nombre).length;
 const presupuestos=(datos.presupuestos||[]).filter(p=>p[0]===nombre).length;
 const recurrentes=(datos.recurrentes||[]).filter(r=>r[1]===nombre).length;
 return {movimientos,presupuestos,recurrentes};
}

function resumenUso(nombre){
 const u=usoCategoria(nombre),partes=[];
 if(u.movimientos)partes.push(u.movimientos+' movimiento'+(u.movimientos===1?'':'s'));
 if(u.presupuestos)partes.push(u.presupuestos+' presupuesto'+(u.presupuestos===1?'':'s'));
 if(u.recurrentes)partes.push(u.recurrentes+' recurrente'+(u.recurrentes===1?'':'s'));
 return partes.length?partes.join(' · '):'Sin registros asociados';
}

function errorCategoria(error){
 const mensaje=error?.message||'';
 if(error?.code==='23505'||/duplicate key|unique/i.test(mensaje))return 'Ya existe una categoría con ese nombre.';
 return mensaje||'No se pudo guardar la categoría. Vuelve a intentar.';
}

function mostrarError(mensaje){
 const id=eliminacion?'categoryDeleteError':'categoryFormError',el=document.getElementById(id);
 if(el){el.textContent=mensaje;el.hidden=!mensaje;}
}

function marcarOcupado(valor){
 ocupado=valor;
 const section=document.getElementById('categoriasConfigSection');
 if(section){section.setAttribute('aria-busy',String(valor));section.querySelectorAll('button,input').forEach(el=>{el.disabled=valor;});}
 const guardar=document.getElementById('categorySave');if(guardar)guardar.textContent=valor?'Guardando…':'Guardar categoría';
 const eliminar=document.getElementById('categoryDeleteConfirm');if(eliminar)eliminar.textContent=valor?'Eliminando…':'Eliminar categoría';
}

function sesionDisponible(usuario){
 if(!usuario||sessionUserId()!==usuario)throw new Error('La sesión cambió. Cierra la configuración y vuelve a abrirla.');
 if(!datos.cargados)throw new Error('Espera a que carguen tus datos antes de cambiar categorías.');
}

function refrescarVistasCategorias(){
 // El cambio de color se ve enseguida en Inicio/Estadísticas. render()
 // también vuelve a poblar los chips del formulario con el catálogo actual.
 if(document.querySelector?.('.page.active'))render();
}

export function renderCategoriasConfig(){
 const lista=document.getElementById('categoriasLista');if(!lista)return;
 if(ocupado)return;
 if(!datos.cargados){lista.innerHTML='<p class="hint">Las categorías estarán disponibles cuando termine la carga de tus datos.</p>';return;}
 const categorias=datos.categorias||[];
 lista.innerHTML=categorias.length?categorias.map(c=>`<div class="category-config-item">
   <span class="category-config-icon" style="--category-color:${escAttr(colorCategoria(c))}" aria-hidden="true">${getEmoji(c[0]).e}</span>
   <div class="category-config-info"><strong>${escHtml(c[0])}</strong><span>${escHtml(resumenUso(c[0]))}</span></div>
   <div class="category-config-actions"><button type="button" class="line-edit-btn" data-category-name="${esc(c[0])}" onclick="editarCategoria(this.dataset.categoryName)">Editar</button><button type="button" class="line-edit-btn category-delete-action" data-category-name="${esc(c[0])}" onclick="eliminarCategoria(this.dataset.categoryName)" aria-label="Eliminar ${esc(c[0])}">Eliminar</button></div>
  </div>`).join(''):'<p class="hint">Aún no tienes categorías. Agrega la primera.</p>';
 const agregar=document.getElementById('categoryAdd');if(agregar)agregar.disabled=false;
}

function abrirEditor(nombre=null){
 if(ocupado)return;
 const usuario=sessionUserId();
 try{sesionDisponible(usuario);}catch(e){toast(e.message,'error');return;}
 const categoria=nombre===null?null:categoriaPorNombre(nombre);
 if(nombre!==null&&!categoria){toast('La categoría ya no está disponible.','error');return;}
 eliminacion=null;editor={nombre,usuario};
 const eliminar=document.getElementById('categoryDeletePanel');if(eliminar)eliminar.hidden=true;
 const panel=document.getElementById('categoryForm');if(panel)panel.hidden=false;
 const titulo=document.getElementById('categoryFormTitle');if(titulo)titulo.textContent=categoria?'Editar categoría':'Nueva categoría';
 const input=document.getElementById('categoryName');if(input){input.value=categoria?.[0]||'';input.focus();}
 const color=document.getElementById('categoryColor');if(color)color.value=categoria?colorCategoria(categoria):COLOR_DEFAULT;
 const nota=document.getElementById('categoryEditNote');if(nota)nota.textContent=categoria?'El nombre nuevo se usará en nuevos movimientos. Los registros existentes conservarán su categoría original.':'Elige un nombre para identificar tus nuevos movimientos.';
 mostrarError('');
}

export function agregarCategoria(){abrirEditor();}
export function editarCategoria(nombre){abrirEditor(nombre);}

export function cancelarCategoria(){
 if(ocupado)return;
 editor=null;eliminacion=null;
 const formulario=document.getElementById('categoryForm');if(formulario)formulario.hidden=true;
 const panel=document.getElementById('categoryDeletePanel');if(panel)panel.hidden=true;
}

export async function guardarCategoria(){
 if(ocupado||!editor)return;
 const contexto=editor,nombre=String(document.getElementById('categoryName')?.value||'').trim().replace(/\s+/g,' '),color=document.getElementById('categoryColor')?.value;
 try{
  sesionDisponible(contexto.usuario);
  if(!nombre||nombre.length>60||/[\u0000-\u001f\u007f]/.test(nombre))throw new Error('Escribe un nombre de 1 a 60 caracteres.');
  if(!colorValido(color))throw new Error('Elige un color válido.');
  if((datos.categorias||[]).some(c=>c[0]!==contexto.nombre&&norm(c[0])===norm(nombre)))throw new Error('Ya existe una categoría con ese nombre.');
  if(contexto.nombre!==null&&!categoriaPorNombre(contexto.nombre))throw new Error('La categoría ya no está disponible. Vuelve a abrir la configuración.');
  mostrarError('');marcarOcupado(true);
  const fila=contexto.nombre===null?await sbInsert('categorias',{nombre,color}):await sbUpdate('categorias',contexto.nombre,{nombre,color},'nombre');
  sesionDisponible(contexto.usuario);
  if(!fila||fila.nombre!==nombre||!colorValido(fila.color)||fila.color.toLowerCase()!==color.toLowerCase())throw new Error('No se pudo confirmar el cambio de categoría. Vuelve a intentar.');
  if(contexto.nombre===null)datos.categorias.push([fila.nombre,fila.color]);
  else{const indice=datos.categorias.findIndex(c=>c[0]===contexto.nombre);if(indice>=0)datos.categorias[indice]=[fila.nombre,fila.color];}
  editor=null;const panel=document.getElementById('categoryForm');if(panel)panel.hidden=true;
  toast(contexto.nombre===null?'Categoría agregada':'Categoría actualizada','success');
  refrescarVistasCategorias();
 }catch(e){if(editor===contexto)mostrarError(errorCategoria(e));}
 finally{marcarOcupado(false);renderCategoriasConfig();}
}

export function eliminarCategoria(nombre){
 if(ocupado)return;
 const usuario=sessionUserId();
 try{sesionDisponible(usuario);}catch(e){toast(e.message,'error');return;}
 if(!categoriaPorNombre(nombre)){toast('La categoría ya no está disponible.','error');return;}
 editor=null;eliminacion={nombre,usuario};
 const formulario=document.getElementById('categoryForm');if(formulario)formulario.hidden=true;
 const panel=document.getElementById('categoryDeletePanel');if(panel)panel.hidden=false;
 const titulo=document.getElementById('categoryDeleteName');if(titulo)titulo.textContent=nombre;
 const nota=document.getElementById('categoryDeleteNote');if(nota)nota.textContent=resumenUso(nombre)+'. Solo se quitará del catálogo: tus movimientos, presupuestos y recurrentes se conservan con su nombre actual.';
 mostrarError('');
}

export async function confirmarEliminarCategoria(){
 if(ocupado||!eliminacion)return;
 const contexto=eliminacion;
 try{
  sesionDisponible(contexto.usuario);
  if(!categoriaPorNombre(contexto.nombre))throw new Error('La categoría ya no está disponible. Vuelve a abrir la configuración.');
  mostrarError('');marcarOcupado(true);
  // Pedir la fila eliminada permite detectar un DELETE sin efecto (por RLS
  // o un catálogo que cambió en otra pestaña) antes de quitarla de memoria.
  const filas=await sbFetch('categorias?nombre=eq.'+encodeURIComponent(contexto.nombre),{method:'DELETE',headers:{Prefer:'return=representation'}});
  sesionDisponible(contexto.usuario);
  if(!Array.isArray(filas)||filas.length!==1||filas[0]?.nombre!==contexto.nombre)throw new Error('No se pudo confirmar la eliminación. Vuelve a intentar.');
  datos.categorias=datos.categorias.filter(c=>c[0]!==contexto.nombre);
  eliminacion=null;const panel=document.getElementById('categoryDeletePanel');if(panel)panel.hidden=true;
  toast('Categoría eliminada del catálogo','success');
  refrescarVistasCategorias();
 }catch(e){if(eliminacion===contexto)mostrarError(errorCategoria(e));}
 finally{marcarOcupado(false);renderCategoriasConfig();}
}
