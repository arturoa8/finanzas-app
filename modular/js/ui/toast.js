// Avisos efimeros.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

let toastTimer=null;

// TOAST robusto: limpia timer previo, tap-to-dismiss, expira siempre
export function toast(m,t){
  const e=document.getElementById('toast');

  if(toastTimer){
    clearTimeout(toastTimer);
    toastTimer=null;
  }

  e.textContent=m;
  e.className='toast '+(t||'');

  // Fuerza reinicio de animación
  void e.offsetWidth;

  e.classList.add('show');

  toastTimer=setTimeout(()=>{
    ocultarToast();
  },2200);
}

export function ocultarToast(){
  const e=document.getElementById('toast');

  e.classList.remove('show');

  if(toastTimer){
    clearTimeout(toastTimer);
    toastTimer=null;
  }

  // Limpia el texto cuando ya terminó la animación
  setTimeout(()=>{
    if(!e.classList.contains('show')){
      e.textContent='';
      e.className='toast';
    }
  },300);
}
