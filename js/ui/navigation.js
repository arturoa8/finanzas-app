// Cambio de pagina y selector de periodo.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderAnalisis} from '../modules/analytics.js';
import {renderCardsPage} from '../modules/cards/cards-ui.js';
import {abrirPagoTarjeta} from '../modules/cards/payments.js';
import {ocultarBusquedaInicio, render} from '../modules/dashboard.js';
import {abrirModalDeuda, renderDeb} from '../modules/debts.js';
import {renderPortafolio} from '../modules/portfolio/portfolio.js';
import {abrirM} from '../modules/transactions.js';
import {abrirConfiguracion, renderConfiguracion} from '../modules/settings.js';
import {abrirNuevoPresupuesto, renderPresupuestos} from '../modules/presupuestos.js';
import {stopPfYahoo} from '../services/market-data.js';
import {datos} from '../state.js';
import {pf} from '../utils/dates.js';
import {mesesC} from '../utils/formatters.js';

// En el monolito las tres viajaban en una sola linea; cada una vive ahora
// con las funciones que la escriben, para no asignar a un import.
export let vista='mes';

export let mesOffset=0;

let mesPickerYear=new Date().getFullYear();

let mesPickerMes=new Date().getMonth();

let mesPickerTodo=false;
let scrollMovimientosInicio=0;
let origenConfiguracion=null;

export function getMesActivo(){const a=new Date();return new Date(a.getFullYear(),a.getMonth()+mesOffset,1);}

// === MES PICKER ===
export function abrirMesPicker(){
  const periodo=vista==='total'?null:{anio:getMesActivo().getFullYear(),mes:getMesActivo().getMonth()};
  if(!periodo){mesPickerTodo=true;}
  else{
    mesPickerTodo=false;
    mesPickerYear=periodo.anio;
    mesPickerMes=periodo.mes;
  }
  renderMesPickerGrid();
  document.getElementById('mesPicker').classList.add('active');
}

export function cerrarMesPicker(){document.getElementById('mesPicker').classList.remove('active');}

export function cambiarAnioPicker(d){mesPickerYear+=d;mesPickerTodo=false;renderMesPickerGrid();}

export function seleccionarTodoTiempo(){mesPickerTodo=!mesPickerTodo;renderMesPickerGrid();}

export function seleccionarMesPicker(m){mesPickerMes=m;mesPickerTodo=false;renderMesPickerGrid();}

export function aplicarMesPicker(){
  if(mesPickerTodo){vista='total';mesOffset=0;}
  else{
    vista='mes';
    const ahora=new Date();
    mesOffset=(mesPickerYear-ahora.getFullYear())*12+(mesPickerMes-ahora.getMonth());
  }
  cerrarMesPicker();
  render();
}

function renderMesPickerGrid(){
  document.getElementById('mpAnio').textContent=mesPickerYear;
  document.getElementById('mpTodos').classList.toggle('active',mesPickerTodo);
  // calcular net por mes para el año seleccionado
  const netos=Array(12).fill(null);
  datos.transacciones.forEach(t=>{
    const f=pf(t[0]);
    if(f.getFullYear()===mesPickerYear){
      const m=parseFloat(t[4])||0;
      const sign=t[3]==='Ingreso'||t[3]==='Reembolso'?1:t[3]==='Gasto'?-1:0;
      netos[f.getMonth()]=(netos[f.getMonth()]||0)+(m*sign);
    }
  });
  document.getElementById('mpGrid').innerHTML=mesesC.map((mc,i)=>{
    const v=netos[i];
    const empty=v===null;
    const sel=!mesPickerTodo&&i===mesPickerMes;
    let valStr='',valCls='';
    if(!empty){
      const abs=Math.abs(v);
      const cstr=abs>=1000?(abs/1000).toFixed(1)+'k':abs.toFixed(0);
      valStr=(v<0?'-S/ ':'S/ ')+cstr;
      valCls=v>=0?'in':'out';
    }
    return `<div class="mp-cell ${sel?'selected':''} ${empty?'mp-cell-no-data':''}" onclick="seleccionarMesPicker(${i})"><div class="mp-cell-mes">${mc}.</div><div class="mp-cell-val ${valCls}">${valStr||'S/ 0'}</div></div>`;
  }).join('');
}

function setVista(v){vista=v;mesOffset=0;render();}

// requestAnimationFrame corre justo antes de pintar; el setTimeout, después.
const despuesDelPintado=fn=>globalThis.requestAnimationFrame?requestAnimationFrame(()=>setTimeout(fn,0)):setTimeout(fn,0);

function cambiarMovimientosInicio(abierto){
  const panel=document.getElementById('homeMovements');
  if(!panel)return;
  const resumen=document.getElementById('homeSummary');
  const boton=document.getElementById('nav-dash');
  const saliendo=abierto?resumen:panel;
  if(saliendo?.contains?.(document.activeElement))boton?.focus({preventScroll:true});
  if(!abierto){
    ocultarBusquedaInicio();
    scrollMovimientosInicio=0;
  }
  panel.inert=!abierto;
  panel.setAttribute('aria-hidden',String(!abierto));
  panel.classList.toggle('expanded',abierto);
  if(resumen){
    resumen.inert=abierto;
    resumen.setAttribute('aria-hidden',String(abierto));
    resumen.classList.toggle('expanded',!abierto);
  }
  boton?.setAttribute('aria-expanded',String(abierto));
}

export function mostrarMovimientosInicio(){
  if(!document.getElementById('p-dash').classList.contains('active'))setPg('dash');
  cambiarMovimientosInicio(true);
}

export function alternarMovimientosInicio(){
  const panel=document.getElementById('homeMovements');
  if(!panel)return;
  const abrir=!panel.classList.contains('expanded');
  cambiarMovimientosInicio(abrir);
  if(!abrir){
    const reducir=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({top:0,behavior:reducir?'auto':'smooth'});
  }
  render();
}

export function setPg(p,b){
  // Los accesos existentes al historial abren el panel integrado de Inicio.
  if(p==='tx'){mostrarMovimientosInicio();render();return;}
  const destino=document.getElementById('p-'+p);
  if(!destino)return;
  const actual=document.querySelector('.page.active');
  if(p==='dash'&&actual?.id==='p-dash'){alternarMovimientosInicio();return;}
  if(p==='settings'){
    if(actual?.id==='p-settings'){renderConfiguracion();return;}
    origenConfiguracion={pagina:actual?.id?.replace(/^p-/, '')||'dash',foco:document.activeElement,
      modales:[...document.querySelectorAll('.modal.active')].filter(x=>x.id!=='moreModal')};
    document.querySelectorAll('.modal.active').forEach(x=>x.classList.remove('active'));
    cerrarMas();
  }else if(actual?.id==='p-settings')origenConfiguracion=null;
  if(actual?.id==='p-dash'&&document.getElementById('homeMovements')?.classList.contains('expanded'))scrollMovimientosInicio=Math.max(0,window.scrollY||0);
  const saliendoDelPortafolio=document.getElementById('p-ana').classList.contains('active');
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  destino.classList.add('active');
  document.querySelectorAll('.nt').forEach(x=>{x.classList.remove('active');x.removeAttribute('aria-current');});
  const nav=document.getElementById('nav-'+(['pres','deb','settings'].includes(p)?'more':p))||b;
  if(nav){nav.classList.add('active');nav.setAttribute('aria-current','page');}
  const fab=document.querySelector('.fab');
  if(fab){fab.hidden=['ana','bud','settings'].includes(p);fab.setAttribute('aria-label',p==='card'?'Registrar pago':p==='deb'?'Nueva deuda':p==='pres'?'Crear presupuesto':'Nueva transacción');}
  const restaurarScroll=()=>{
    if(destino.classList.contains('active'))window.scrollTo(0,p==='dash'&&document.getElementById('homeMovements')?.classList.contains('expanded')?scrollMovimientosInicio:0);
  };
  restaurarScroll();
  if(p==='ana'){
    // Las páginas comparten el scroll del documento: si Portafolio quedó
    // desplazado de una visita anterior, entrar de nuevo debe verse arriba,
    // no donde se quedó. Se reafirma tras la carga async para que el cambio
    // de alto del contenido (spinner → datos) no la vuelva a mover.
    window.scrollTo(0,0);
    // Primero se muestra la pestaña y después se calcula: pintar el
    // portafolio bloquea el hilo y en el iPhone retrasaba el cambio.
    const enPortafolio=()=>document.getElementById('p-ana').classList.contains('active');
    despuesDelPintado(()=>{
      if(!enPortafolio())return;
      renderPortafolio().then(()=>{if(enPortafolio())window.scrollTo(0,0);}).catch(()=>{});
    });
  }
  if(p==='card')renderCardsPage();
  if(p==='deb')renderDeb();
  if(p==='bud')renderAnalisis();
  if(p==='pres')renderPresupuestos();
  if(p==='settings'){
    renderConfiguracion();
    despuesDelPintado(()=>{if(destino.classList.contains('active'))document.getElementById('settingsBack')?.focus({preventScroll:true});});
  }
  if(p==='dash')render();
  if(p!=='ana')despuesDelPintado(restaurarScroll);
  if(p!=='ana'&&saliendoDelPortafolio)stopPfYahoo({preservarConsulta:true});
}

export function volverDesdeConfiguracion(){
  if(!document.getElementById('p-settings')?.classList.contains('active'))return;
  const origen=origenConfiguracion||{pagina:'dash',modales:[]};
  setPg(origen.pagina);
  origen.modales.forEach(x=>x.classList.add('active'));
  despuesDelPintado(()=>{
    if(!document.getElementById('p-'+origen.pagina)?.classList.contains('active'))return;
    const modal=origen.modales.filter(x=>x.classList.contains('active')).at(-1);
    const foco=modal?(origen.foco?.isConnected!==false&&modal.contains(origen.foco)?origen.foco:modal.querySelector('input,button,select,textarea,[tabindex="0"]'))
      :document.getElementById('nav-'+(['pres','deb'].includes(origen.pagina)?'more':origen.pagina));
    foco?.focus({preventScroll:true});
  });
}

export function abrirMas(){
  document.getElementById('moreModal').classList.add('active');
  document.getElementById('nav-more')?.setAttribute('aria-expanded','true');
}

export function cerrarMas(){
  document.getElementById('moreModal').classList.remove('active');
  document.getElementById('nav-more')?.setAttribute('aria-expanded','false');
}

export function abrirDesdeMas(p){cerrarMas();setPg(p);}

export function abrirConfiguracionDesdeMas(){cerrarMas();abrirConfiguracion();}

// ── FAB contextual ───────────────────────────────────────────────────────────
export function handleFab(){
  const pg=document.querySelector('.page.active');
  if(pg&&pg.id==='p-deb')abrirModalDeuda();
  else if(pg&&pg.id==='p-card')abrirPagoTarjeta();
  else if(pg&&pg.id==='p-pres')abrirNuevoPresupuesto();
  else if(pg&&['p-ana','p-bud','p-settings'].includes(pg.id))return;
  else abrirM();
}
