// Ayudas de DOM y gestos globales.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {toast} from '../ui/toast.js';

const textUpdates=new WeakMap();
export function smoothSetText(el,newText,newValue=null){
  if(!el)return;
  clearTimeout(textUpdates.get(el));
  const oldValue=el.dataset.value;
  const newValueStr=newValue===null?newText:String(Number(newValue||0).toFixed(2));
  const aplicar=()=>{el.textContent=newText;el.dataset.value=newValueStr;el.classList.remove('num-changing');textUpdates.delete(el);};
  if(oldValue===newValueStr && el.textContent===newText){el.classList.remove('num-changing');return;}
  // Mientras se prepara el inicio, los importes quedan terminados detrás de
  // la pantalla de entrada. No revelar ceros durante un timeout de texto.
  if(document.getElementById('appContent')?.inert||oldValue===undefined||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){aplicar();return;}
  el.classList.add('num-changing');
  textUpdates.set(el,setTimeout(aplicar,90));
}

function togglePrivacy(btn){const active=document.body.classList.toggle('private');btn.setAttribute('aria-pressed',String(active));btn.setAttribute('aria-label',active?'Mostrar importes del resumen':'Ocultar importes del resumen');toast(active?'Importes ocultos en el resumen':'Importes visibles');}

export function initializeAccessibility(){
 document.getElementById('toast').setAttribute('role','status');
 document.querySelectorAll('.mh-x').forEach(b=>b.setAttribute('aria-label','Cerrar ventana'));
 let lastModal=null,lastFocus=null;
 const syncAccessibility=()=>{
  document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select)').forEach(el=>{el.setAttribute('role','button');el.setAttribute('tabindex','0');});
  document.querySelectorAll('.modal').forEach(m=>{m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');const title=m.querySelector('[id$="Title"],.mc-title-big,.mh-title');if(title&&title.id)m.setAttribute('aria-labelledby',title.id);else m.setAttribute('aria-label','Detalle o edición');});
  const active=[...document.querySelectorAll('.modal.active')].at(-1)||null;
  // Sin overflow:hidden en body ni desplazamientos por foco: en iPhone, cambiar
  // el desplazamiento de la página con scroll hecho deja la barra inferior, el
  // botón + y las ventanas corridos hacia arriba hasta el siguiente gesto.
  if(active!==lastModal){if(active){if(!lastModal)lastFocus=document.activeElement;active.querySelector('input,button,select,textarea,summary,[tabindex="0"]')?.focus({preventScroll:true});}else{lastFocus?.focus({preventScroll:true});lastFocus=null;}lastModal=active;}
 };
 const observer=new MutationObserver(syncAccessibility);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});syncAccessibility();
 // El fondo de una ventana no arrastra la página. Dentro de la ventana el
 // contenido sigue desplazándose y overscroll-behavior evita el encadenado.
 document.addEventListener('touchmove',e=>{if(e.target.classList?.contains('modal')&&e.target.classList.contains('active'))e.preventDefault();},{passive:false});
 document.addEventListener('keydown',e=>{const active=[...document.querySelectorAll('.modal.active')].at(-1);if(e.key==='Escape'&&active){active.querySelector('.mh-x')?.click();return;}if(e.key==='Tab'&&active){const els=[...active.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=els[0],last=els.at(-1);if(e.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first?.focus();}}if(['Enter',' '].includes(e.key)&&e.target.matches('[role="button"][onclick]:not(button):not(a)')){e.preventDefault();e.target.click();}});
}

// El zoom por doble toque lo evita touch-action:manipulation (css/base.css).
// No cancelar touchend en JS: eso descartaba el segundo de dos toques rápidos.
