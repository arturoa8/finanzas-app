// El cambio de período solo anima la aparición del SVG correcto. Los datos,
// la escala y los gestos se actualizan inmediatamente, sin valores intermedios.
const pfMovimientosGrafico=new WeakMap();
const pfMovimientosActivos=new Set();

function pfEstadoMovimiento(area){
  let estado=pfMovimientosGrafico.get(area);
  if(!estado){estado={pendiente:false,cancelar:null};pfMovimientosGrafico.set(area,estado);}
  return estado;
}

export function pfPrepararTransicionGrafico(area){
  if(!area)return;
  const estado=pfEstadoMovimiento(area);
  estado.cancelar?.();
  estado.pendiente=true;
  pfMovimientosActivos.add(estado);
}

export function pfCancelarTransicionGrafico(area){
  // Sin área, limpia la sesión sin consultar ni modificar el DOM oculto.
  const estados=area?[pfMovimientosGrafico.get(area)]:[...pfMovimientosActivos];
  for(const estado of estados){
    if(!estado)continue;
    estado.pendiente=false;
    estado.cancelar?.();
    pfMovimientosActivos.delete(estado);
  }
}

export function pfPintarGrafico(area,html,{esperar=false}={}){
  const estado=pfEstadoMovimiento(area);
  estado.cancelar?.();
  // Una respuesta de Yahoo reutiliza este pintado, pero no inicia otra
  // animación: solo la selección del usuario prepara una transición.
  area.innerHTML=html;
  const svg=area.querySelector('svg');
  if(!svg){if(!esperar){estado.pendiente=false;pfMovimientosActivos.delete(estado);}return;}
  const animar=estado.pendiente;
  estado.pendiente=false;
  const media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  if(!animar||document.hidden||media?.matches||typeof svg.animate!=='function'){pfMovimientosActivos.delete(estado);return;}

  let animacion;
  try{animacion=svg.animate([{opacity:.45},{opacity:1}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'});}
  catch{pfMovimientosActivos.delete(estado);return;}
  const limpiar=()=>{
    svg.removeEventListener('pointerdown',cancelar);
    media?.removeEventListener?.('change',reducirMovimiento);
    if(estado.cancelar===cancelar){
      estado.cancelar=null;
      if(!estado.pendiente)pfMovimientosActivos.delete(estado);
    }
  };
  const cancelar=()=>{animacion.cancel();limpiar();};
  const reducirMovimiento=evento=>{if(evento.matches)cancelar();};
  estado.cancelar=cancelar;
  // Un toque muestra enseguida la curva al 100% y conserva los listeners
  // de scrubbing. No se bloquean punteros ni se transforma su geometría.
  svg.addEventListener('pointerdown',cancelar,{once:true});
  media?.addEventListener?.('change',reducirMovimiento);
  animacion.finished?.then(limpiar,limpiar);
}
