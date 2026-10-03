// Preparación real del inicio. Ninguna duración mínima retrasa los datos.
import {estabilizarVistaInstalada} from './viewport.js';
let slowTimer=null;
let revision=0;
const nodo=id=>document.getElementById(id);

function bloquearContenido(){
  const contenido=nodo('appContent');
  if(contenido){contenido.inert=true;contenido.setAttribute('aria-hidden','true');}
}

export function prepararInicio(){
  revision++;
  clearTimeout(slowTimer);
  bloquearContenido();
  const acceso=nodo('authGate');
  if(acceso){acceso.inert=true;acceso.style.display='none';}
  const pantalla=nodo('appStartup');
  if(!pantalla)return;
  pantalla.getAnimations?.().forEach(a=>a.cancel());
  pantalla.hidden=false;
  pantalla.classList.remove('startup-error');
  pantalla.setAttribute('aria-busy','true');
  nodo('startupTitle').textContent='Preparando tus finanzas';
  nodo('startupDetail').textContent='Cargando movimientos y preparando tu portafolio.';
  nodo('startupActions').hidden=true;
  slowTimer=setTimeout(()=>{
    nodo('startupDetail').textContent='La conexión está tardando un poco. Seguimos cargando tus datos.';
  },7000);
}

export function mostrarAcceso(){
  revision++;
  clearTimeout(slowTimer);
  bloquearContenido();
  const pantalla=nodo('appStartup');
  if(pantalla){pantalla.hidden=true;pantalla.setAttribute('aria-busy','false');}
  const acceso=nodo('authGate');
  if(acceso){acceso.style.display='flex';acceso.inert=false;}
}

export function mostrarErrorInicio(error,{reintentar,cerrarSesion}={}){
  clearTimeout(slowTimer);
  const pantalla=nodo('appStartup');
  if(!pantalla)return;
  bloquearContenido();
  pantalla.hidden=false;
  pantalla.classList.add('startup-error');
  pantalla.setAttribute('aria-busy','false');
  nodo('startupTitle').textContent='No pudimos preparar tu resumen';
  nodo('startupDetail').textContent=error?.pending||error?.incompleto?error.message:'Revisa tu conexión y vuelve a intentarlo. Tus datos siguen guardados.';
  nodo('startupActions').hidden=false;
  nodo('startupRetry').onclick=reintentar;
  nodo('startupSignOut').onclick=cerrarSesion;
}

export async function revelarInicio(){
  clearTimeout(slowTimer);
  const actual=revision;
  const pantalla=nodo('appStartup');
  const contenido=nodo('appContent');
  await estabilizarVistaInstalada();
  if(actual!==revision)return;
  const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if(pantalla&&!reduce&&pantalla.animate){
    // El contenido ya está renderizado; solo se retira su cubierta.
    await pantalla.animate([{opacity:1},{opacity:0}],{duration:220,easing:'ease-out',fill:'forwards'}).finished.catch(()=>{});
  }
  if(actual!==revision)return;
  if(pantalla){pantalla.hidden=true;pantalla.setAttribute('aria-busy','false');}
  if(contenido){contenido.inert=false;contenido.removeAttribute('aria-hidden');}
  if(!reduce){
    // Un único gesto de entrada agrupa el resumen; las filas quedan quietas.
    nodo('p-dash')?.querySelector('.hero2')?.animate?.(
      [{opacity:.65,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],
      {duration:280,easing:'cubic-bezier(.2,.8,.2,1)'}
    );
  }
}
