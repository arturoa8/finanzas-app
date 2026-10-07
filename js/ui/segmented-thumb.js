// El fondo del selector de Inicio (Este mes · Acumulado · Neto · Patrimonio)
// se desliza a la opción elegida en vez de saltar.
//
// No toca la lógica del selector: setModoBalance sigue marcando .active y
// aquí solo se observa ese cambio. Una sola pieza (.seg-thumb) cubre todo el
// selector y clip-path la recorta a la opción activa; css/dashboard.css anima
// el recorte. Sin este módulo, el fondo de .seg-btn.active se ve como antes.

function enganchar(seg){
  const pieza=document.createElement('span');
  pieza.className='seg-thumb';
  pieza.setAttribute('aria-hidden','true');
  seg.prepend(pieza);
  seg.classList.add('con-thumb');
  let colocada=false;

  const colocar=()=>{
    const b=seg.querySelector('.seg-btn.active');
    // Oculto (otra pestaña): la próxima vez se coloca sin animar.
    if(!b||!pieza.offsetWidth){colocada=false;return;}
    const arriba=b.offsetTop-pieza.offsetTop,izq=b.offsetLeft-pieza.offsetLeft;
    const der=pieza.offsetWidth-izq-b.offsetWidth,abajo=pieza.offsetHeight-arriba-b.offsetHeight;
    const recorte=`inset(${arriba}px ${der}px ${abajo}px ${izq}px round 11px)`;
    if(colocada){pieza.style.clipPath=recorte;return;}
    pieza.style.transition='none';
    pieza.style.clipPath=recorte;
    void pieza.offsetWidth;
    pieza.style.transition='';
    colocada=true;
  };

  new MutationObserver(colocar).observe(seg,{subtree:true,attributes:true,attributeFilter:['class']});
  // Mostrar Inicio de nuevo o girar el teléfono cambia medidas: recolocar sin animar.
  new ResizeObserver(()=>{colocada=false;colocar();}).observe(seg);
  colocar();
}

export function initializeSegmentedThumb(){
  document.querySelectorAll('.mode-seg').forEach(enganchar);
}
