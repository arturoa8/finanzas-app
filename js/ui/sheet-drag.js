// Cerrar una ventana inferior arrastrándola hacia abajo, como en el iPhone.
//
// Solo empieza si el contenido de la hoja está arriba del todo y el primer
// movimiento del dedo es hacia abajo; en cualquier otro caso el dedo desplaza
// el contenido como siempre. Se usan eventos táctiles y no pointer events:
// con pointer events el navegador toma el gesto para desplazar la hoja y
// cancela el puntero antes de que se pueda seguir al dedo.
//
// Al soltar, se cierra si la hoja bajó más de un cuarto de su alto o si el
// gesto fue rápido; si no, vuelve a su sitio. Cerrar es pulsar su botón ×
// (.mh-x), el mismo camino que Escape en dom.js, así que cada ventana limpia
// su estado igual que siempre. Sin ×, la hoja vuelve a su sitio.

const DISTANCIA_CIERRE=0.25;   // fracción del alto de la hoja
const VELOCIDAD_CIERRE=0.11;   // px/ms promedio del gesto
const ARRANQUE=4;              // px hacia abajo antes de tomar el gesto
const IGNORAR='input,textarea,select,[contenteditable],.chart-svg';

// Un desplazable interno que no está arriba del todo es del dedo, no de la hoja.
function hayDesplazamientoInterno(el,hoja){
  for(let n=el;n&&n!==hoja;n=n.parentElement){
    if(n.scrollTop>0&&n.scrollHeight>n.clientHeight&&/auto|scroll/.test(getComputedStyle(n).overflowY))return true;
  }
  return false;
}

function engancharHoja(hoja){
  const ventana=hoja.parentElement;
  let g=null;

  hoja.addEventListener('touchstart',e=>{
    g=null;
    if(e.touches.length!==1||!ventana.classList.contains('active')||ventana.classList.contains('centered'))return;
    if(hoja.scrollTop>0||e.target.closest?.(IGNORAR)||hayDesplazamientoInterno(e.target,hoja))return;
    const t=e.touches[0];
    g={x0:t.clientX,y0:t.clientY,t0:e.timeStamp,dy:0,alto:hoja.offsetHeight,arrastrando:false};
  },{passive:true});

  hoja.addEventListener('touchmove',e=>{
    if(!g)return;
    const t=e.touches[0],dx=t.clientX-g.x0,dy=t.clientY-g.y0;
    if(!g.arrastrando){
      // Hacia arriba o de costado es desplazamiento normal: soltar el gesto.
      if(dy<0||Math.abs(dx)>Math.abs(dy)){g=null;return;}
      // Hacia abajo con la hoja arriba no hay nada que desplazar: retener el
      // gesto desde el primer evento para que iOS no lo tome como rebote.
      if(e.cancelable)e.preventDefault();
      if(dy<ARRANQUE)return;
      g.arrastrando=true;ventana.classList.add('arrastrando');
    }
    if(e.cancelable)e.preventDefault();
    g.dy=dy;
    // Por encima del punto de partida, resistencia como en el iPhone.
    const y=dy>=0?dy:-Math.sqrt(-dy);
    hoja.style.transform=`translateY(${y}px)`;
    ventana.style.setProperty('--velo',String(Math.max(0,1-Math.max(dy,0)/g.alto)));
  },{passive:false});

  const soltar=e=>{
    const s=g;g=null;
    if(!s?.arrastrando)return;
    const velocidad=s.dy/Math.max(1,e.timeStamp-s.t0);
    const cerrar=e.type==='touchend'&&(s.dy>s.alto*DISTANCIA_CIERRE||(s.dy>10&&velocidad>VELOCIDAD_CIERRE));
    // Quitar el estilo en línea y la clase a la vez: la transición de .mc
    // parte de donde quedó el dedo, hacia su sitio o hacia abajo al cerrar.
    ventana.classList.remove('arrastrando');
    ventana.style.removeProperty('--velo');
    hoja.style.transform='';
    if(cerrar)ventana.querySelector('.mh-x')?.click();
  };
  hoja.addEventListener('touchend',soltar);
  hoja.addEventListener('touchcancel',soltar);
}

export function initializeSheetDrag(){
  document.querySelectorAll('.modal>.mc').forEach(engancharHoja);
}
