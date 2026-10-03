// Utilidades de concurrencia.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

// ── Protección contra doble clic ─────────────────────────────────────────────
// Si el usuario toca "Guardar"/"Eliminar" dos veces rápido (común en botones
// táctiles), la segunda llamada se ignora mientras la primera sigue en curso,
// evitando registros o eliminaciones duplicadas.
export function guardedOnce(fn){
  let busy=false;
  return async function(...args){
    if(busy)return;
    busy=true;
    try{ return await fn.apply(this,args); }
    finally{ busy=false; }
  };
}

// Las lecturas sí deben compartir su resultado: una segunda entrada espera
// la carga en curso en vez de confundir un clic ignorado con datos listos.
export function singleFlight(fn){
  let pending=null;
  return function(...args){
    if(!pending)pending=Promise.resolve().then(()=>fn.apply(this,args)).finally(()=>{pending=null;});
    return pending;
  };
}
