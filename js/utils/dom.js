// Ayudas de DOM y gestos globales.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {toast} from '../ui/toast.js';

export function smoothSetText(el,newText,newValue=null){
  if(!el)return;
  const oldValue=el.dataset.value;
  const newValueStr=newValue===null?newText:String(Number(newValue||0).toFixed(2));
  if(oldValue===newValueStr && el.textContent===newText)return;
  el.classList.add('num-changing');
  setTimeout(()=>{
    el.textContent=newText;
    el.dataset.value=newValueStr;
    el.classList.remove('num-changing');
  },90);
}

let lastTouchEnd=0;

function togglePrivacy(btn){const active=document.body.classList.toggle('private');btn.setAttribute('aria-pressed',String(active));btn.setAttribute('aria-label',active?'Mostrar importes del resumen':'Ocultar importes del resumen');toast(active?'Importes ocultos en el resumen':'Importes visibles');}

export function initializeAccessibility(){
 document.getElementById('toast').setAttribute('role','status');
 document.querySelectorAll('.mh-x').forEach(b=>b.setAttribute('aria-label','Cerrar ventana'));
 let lastModal=null,lastFocus=null;
 const syncAccessibility=()=>{
  document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select)').forEach(el=>{el.setAttribute('role','button');el.setAttribute('tabindex','0');});
  document.querySelectorAll('.modal').forEach(m=>{m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');const title=m.querySelector('[id$="Title"],.mc-title-big,.mh-title');if(title&&title.id)m.setAttribute('aria-labelledby',title.id);else m.setAttribute('aria-label','Detalle o edición');});
  const active=[...document.querySelectorAll('.modal.active')].at(-1)||null;
  if(active!==lastModal){if(active){if(!lastModal)lastFocus=document.activeElement;active.querySelector('input,button,select,textarea,[tabindex="0"]')?.focus();}else{lastFocus?.focus();lastFocus=null;}lastModal=active;document.body.style.overflow=active?'hidden':'';}
 };
 const observer=new MutationObserver(syncAccessibility);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});syncAccessibility();
 document.addEventListener('keydown',e=>{const active=[...document.querySelectorAll('.modal.active')].at(-1);if(e.key==='Escape'&&active){active.querySelector('.mh-x')?.click();return;}if(e.key==='Tab'&&active){const els=[...active.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=els[0],last=els.at(-1);if(e.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first?.focus();}}if(['Enter',' '].includes(e.key)&&e.target.matches('[role="button"][onclick]:not(button):not(a)')){e.preventDefault();e.target.click();}});
}

// Bloquear doble-toque para evitar zoom
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});

document.addEventListener('touchend',e=>{const now=Date.now();if(now-lastTouchEnd<=300)e.preventDefault();lastTouchEnd=now;},{passive:false});
