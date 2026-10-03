// Cambio de pagina y selector de periodo.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderAnalisis} from '../modules/analytics.js';
import {renderCardsPage} from '../modules/cards/cards-ui.js';
import {render} from '../modules/dashboard.js';
import {abrirModalDeuda, renderDeb} from '../modules/debts.js';
import {renderPortafolio} from '../modules/portfolio/portfolio.js';
import {abrirM} from '../modules/transactions.js';
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

export function getMesActivo(){const a=new Date();return new Date(a.getFullYear(),a.getMonth()+mesOffset,1);}

// === MES PICKER ===
export function abrirMesPicker(){
  if(vista==='total'){mesPickerTodo=true;}
  else{
    mesPickerTodo=false;
    const ma=getMesActivo();
    mesPickerYear=ma.getFullYear();
    mesPickerMes=ma.getMonth();
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
    return `<div class="mp-cell ${sel?'selected':''} ${empty?'empty':''}" onclick="seleccionarMesPicker(${i})"><div class="mp-cell-mes">${mc}.</div><div class="mp-cell-val ${valCls}">${valStr||'S/ 0'}</div></div>`;
  }).join('');
}

function setVista(v){vista=v;mesOffset=0;render();}

export function setPg(p,b){
  const saliendoDelPortafolio=document.getElementById('p-ana').classList.contains('active');
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('p-'+p).classList.add('active');
  document.querySelectorAll('.nt').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  if(p==='ana'){
    // Las páginas comparten el scroll del documento: si Portafolio quedó
    // desplazado de una visita anterior, entrar de nuevo debe verse arriba,
    // no donde se quedó. Se reafirma tras la carga async para que el cambio
    // de alto del contenido (spinner → datos) no la vuelva a mover.
    window.scrollTo(0,0);
    renderPortafolio().then(()=>{if(document.getElementById('p-ana').classList.contains('active'))window.scrollTo(0,0);}).catch(()=>{});
  }
  if(p==='card')renderCardsPage();
  if(p==='deb')renderDeb();
  if(p==='bud')renderAnalisis();
  if(p==='dash')render();
  if(p!=='ana'&&saliendoDelPortafolio)stopPfYahoo({preservarConsulta:true});
}

// ── FAB contextual ───────────────────────────────────────────────────────────
export function handleFab(){
  const pg=document.querySelector('.page.active');
  if(pg&&pg.id==='p-deb')abrirModalDeuda();
  else abrirM();
}
