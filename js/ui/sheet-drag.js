// Cerrar una ventana inferior arrastrándola hacia abajo, como en el iPhone.
//
// Solo empieza si el contenido de la hoja está arriba del todo y el primer
// movimiento del dedo es hacia abajo; en cualquier otro caso el dedo desplaza
// el contenido como siempre. Se usan eventos táctiles y no pointer events:
// con pointer events el navegador toma el gesto para desplazar la hoja y
// cancela el puntero antes de que se pueda seguir al dedo.
//
// Al soltar, la animación hereda la velocidad del dedo: se cierra si la hoja
// bajó más de un cuarto de su alto o si el punto donde la llevaría su impulso
// pasa de la mitad; si no, vuelve a su sitio con un resorte. Una hoja que
// está volviendo se puede agarrar de nuevo: el gesto parte de donde está en
// pantalla, no de donde iba. Cerrar es pulsar su botón × (.mh-x), el mismo
// camino que Escape en dom.js, así que cada ventana limpia su estado igual
// que siempre. Sin ×, la hoja vuelve a su sitio.

const DISTANCIA_CIERRE=0.25;   // fracción del alto de la hoja
const VELOCIDAD_CIERRE=0.11;   // px/ms promedio del gesto
const ARRANQUE=4;              // px hacia abajo antes de tomar el gesto
const VENTANA_VELOCIDAD=100;   // ms de movimiento que cuentan para la velocidad al soltar
const DESACELERACION=0.998;    // la misma que el desplazamiento de iOS
const IGNORAR='input,textarea,select,[contenteditable],.chart-svg';

// Hasta dónde llegaría el movimiento por inercia, en px (velocidad en px/ms).
export function proyectar(velocidad,desaceleracion=DESACELERACION){
  return velocidad*desaceleracion/(1-desaceleracion);
}

// Desplazamiento vertical que la hoja muestra ahora mismo, aunque esté animándose.
function desplazamientoActual(hoja){
  const t=getComputedStyle(hoja).transform;
  if(!t||t==='none')return 0;
  try{return new DOMMatrixReadOnly(t).m42||0;}catch(e){return 0;}
}

// Un desplazable interno que no está arriba del todo es del dedo, no de la hoja.
function hayDesplazamientoInterno(el,hoja){
  for(let n=el;n&&n!==hoja;n=n.parentElement){
    if(n.scrollTop>0&&n.scrollHeight>n.clientHeight&&/auto|scroll/.test(getComputedStyle(n).overflowY))return true;
  }
  return false;
}

function engancharHoja(hoja){
  const ventana=hoja.parentElement;
  let g=null,limpiar=0;

  // La transición en línea solo dura lo que dura el vuelo de la hoja.
  const terminarVuelo=()=>{
    clearTimeout(limpiar);
    hoja.style.removeProperty('transition');
    delete hoja.dataset.vuelo;
  };

  hoja.addEventListener('touchstart',e=>{
    g=null;
    if(e.touches.length!==1||!ventana.classList.contains('active')||ventana.classList.contains('centered'))return;
    if(e.target.closest?.(IGNORAR))return;
    // Agarrar la hoja mientras vuelve: se congela donde está y se sigue desde ahí.
    // También cuenta la entrada de la hoja, que es una animación y no
    // una transición: se cancela después de leer dónde está.
    const entrando=(hoja.getAnimations?.()||[]).filter(a=>a.animationName);
    const actual=Math.max(0,desplazamientoActual(hoja));
    // Con la hoja casi asentada el toque es un toque normal, no un agarre.
    const enVuelo=(hoja.dataset.vuelo==='1'||entrando.length>0)&&actual>2;
    const base=enVuelo?actual:0;
    // Una transición en línea ganaría a la regla que apaga la de .arrastrando.
    if(hoja.dataset.vuelo)terminarVuelo();
    if(enVuelo){
      entrando.forEach(a=>a.cancel());
      hoja.style.transition='none';
      hoja.style.transform=`translateY(${base}px)`;
      ventana.classList.add('arrastrando');
    }
    if(!enVuelo&&(hoja.scrollTop>0||hayDesplazamientoInterno(e.target,hoja)))return;
    const t=e.touches[0];
    g={x0:t.clientX,y0:t.clientY,t0:e.timeStamp,base,dy:base,alto:hoja.offsetHeight,arrastrando:enVuelo,muestras:[{y:t.clientY,t:e.timeStamp}]};
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
    g.muestras.push({y:t.clientY,t:e.timeStamp});
    while(g.muestras.length>2&&e.timeStamp-g.muestras[0].t>VENTANA_VELOCIDAD)g.muestras.shift();
    const total=g.base+dy;
    g.dy=total;
    // Por encima del punto de partida, resistencia como en el iPhone.
    const y=total>=0?total:-Math.sqrt(-total);
    hoja.style.transform=`translateY(${y}px)`;
    ventana.style.setProperty('--velo',String(Math.max(0,1-Math.max(total,0)/g.alto)));
  },{passive:false});

  const soltar=e=>{
    const s=g;g=null;
    if(!s?.arrastrando)return;
    // Velocidad del dedo al soltar (px/ms), no el promedio de todo el gesto.
    const primera=s.muestras[0],ultima=s.muestras[s.muestras.length-1];
    const velocidad=Math.max(0,(ultima.y-primera.y)/Math.max(1,ultima.t-primera.t));
    const promedio=s.dy/Math.max(1,e.timeStamp-s.t0);
    const cerrar=e.type==='touchend'&&s.dy>10&&(
      s.dy>s.alto*DISTANCIA_CIERRE||
      promedio>VELOCIDAD_CIERRE||
      s.dy+proyectar(velocidad)>s.alto*0.5
    );
    // Quitar el estilo en línea y la clase a la vez: la transición de .mc
    // parte de donde quedó el dedo. Al cerrar dura lo que tarda el dedo en
    // recorrer lo que falta (entre 160 y 320 ms); al volver, un resorte.
    if(cerrar){
      const falta=Math.max(0,s.alto-s.dy);
      const ms=Math.round(Math.min(320,Math.max(160,falta/Math.max(velocidad,0.9))));
      hoja.style.transition=`transform ${ms}ms cubic-bezier(.2,.6,.4,1)`;
    }else{
      hoja.style.transition='transform .64s var(--resorte)';
      hoja.dataset.vuelo='1';
      limpiar=setTimeout(terminarVuelo,700);
    }
    ventana.classList.remove('arrastrando');
    ventana.style.removeProperty('--velo');
    hoja.style.transform='';
    if(cerrar){
      ventana.querySelector('.mh-x')?.click();
      limpiar=setTimeout(terminarVuelo,400);
    }
  };
  hoja.addEventListener('touchend',soltar);
  hoja.addEventListener('touchcancel',soltar);
}

export function initializeSheetDrag(){
  document.querySelectorAll('.modal>.mc').forEach(engancharHoja);
}
