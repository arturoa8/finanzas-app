// Reordenar una lista arrastrando su asa (.reorder-grip).
//
// Se engancha una sola vez a la lista y delega, así sobrevive a que su
// contenido se vuelva a pintar. Mientras se arrastra, el elemento sigue al
// dedo y los demás se apartan; al soltar se avisa con el id y la posición
// final y quien llama decide cómo guardarla. Los botones de subir y bajar
// siguen siendo la vía accesible: arrastrar es un atajo, no la única forma.
//
// touch-action:none en el asa (ver components.css) hace que el dedo mueva el
// elemento en vez de desplazar la página; el resto de la fila desplaza normal.

// Iconos de la fila reordenable, compartidos por los dos listados.
export const ICONO_ASA='<svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3.5" r="1.4"/><circle cx="10" cy="3.5" r="1.4"/><circle cx="4" cy="9" r="1.4"/><circle cx="10" cy="9" r="1.4"/><circle cx="4" cy="14.5" r="1.4"/><circle cx="10" cy="14.5" r="1.4"/></svg>';
export const iconoFlecha=arriba=>`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${arriba?'M6 15l6-6 6 6':'M6 9l6 6 6-6'}"/></svg>`;

const enganchadas=new WeakSet();

export function initReorderList(lista,{alMover,item='[data-id]',asa='.reorder-grip'}){
  if(!lista||typeof lista.addEventListener!=='function'||enganchadas.has(lista))return;
  enganchadas.add(lista);
  let g=null;

  const limpiar=()=>{
    if(!g)return;
    lista.classList.remove('reordering');
    for(const x of g.items){x.el.classList.remove('dragging');x.el.style.transform='';x.el.style.transition='';}
    g=null;
  };

  lista.addEventListener('pointerdown',e=>{
    const tirador=e.target.closest?.(asa);
    if(!tirador||g||(e.pointerType==='mouse'&&e.button!==0))return;
    const fila=tirador.closest(item);
    if(!fila||!lista.contains(fila))return;
    const items=[...lista.querySelectorAll(item)].map(el=>{const r=el.getBoundingClientRect();return {el,id:el.dataset.id,top:r.top,alto:r.height};});
    const origen=items.findIndex(x=>x.el===fila);
    if(origen<0)return;
    e.preventDefault();
    tirador.setPointerCapture?.(e.pointerId);
    g={id:e.pointerId,tirador,items,origen,destino:origen,y0:e.clientY};
    lista.classList.add('reordering');
    fila.classList.add('dragging');
  });

  lista.addEventListener('pointermove',e=>{
    if(!g||e.pointerId!==g.id)return;
    const {items,origen}=g,mover=items[origen];
    // El elemento arrastrado no sale de la lista.
    const min=items[0].top-mover.top,max=items[items.length-1].top+items[items.length-1].alto-(mover.top+mover.alto);
    const dy=Math.max(min,Math.min(max,e.clientY-g.y0));
    mover.el.style.transform=`translateY(${dy}px)`;
    const centro=mover.top+mover.alto/2+dy;
    let destino=origen;
    items.forEach((x,i)=>{
      if(i<origen&&centro<x.top+x.alto/2)destino=Math.min(destino,i);
      if(i>origen&&centro>x.top+x.alto/2)destino=Math.max(destino,i);
    });
    g.destino=destino;
    items.forEach((x,i)=>{
      if(i===origen)return;
      const desplazar=destino<origen&&i>=destino&&i<origen?mover.alto:destino>origen&&i<=destino&&i>origen?-mover.alto:0;
      x.el.style.transform=desplazar?`translateY(${desplazar}px)`:'';
    });
  });

  const soltar=confirmar=>e=>{
    if(!g||e.pointerId!==g.id)return;
    const {destino,origen,items,tirador}=g;
    tirador.releasePointerCapture?.(e.pointerId);
    const idMovido=items[origen].id;
    limpiar();
    if(confirmar&&destino!==origen)alMover(idMovido,destino);
  };
  lista.addEventListener('pointerup',soltar(true));
  lista.addEventListener('pointercancel',soltar(false));
}
