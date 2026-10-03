// Preparación real del inicio. Ninguna duración mínima retrasa los datos.
import {estabilizarVistaInstalada} from './viewport.js';
let slowTimer=null;
let revision=0;
let animacionesSalida=[];
const nodo=id=>document.getElementById(id);
const logoInicio=()=>nodo('p-dash')?.querySelector?.('.header .logo');
// Una animación pausada (app en segundo plano) nunca debe retener Inicio.
const terminar=(animaciones,ms)=>Promise.race([
  Promise.all(animaciones.map(a=>a?.finished?.catch(()=>{}))),
  new Promise(resolve=>setTimeout(resolve,ms)),
]);

// Deja la cubierta y el logo real como antes de una salida interrumpida.
function limpiarSalida(){
  animacionesSalida.forEach(a=>a.cancel?.());
  animacionesSalida=[];
  const logo=logoInicio();
  if(logo)logo.style.opacity='';
}

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
  limpiarSalida();
  pantalla.hidden=false;
  pantalla.classList.remove('startup-error','startup-slow');
  pantalla.setAttribute('aria-busy','true');
  nodo('startupTitle').textContent='Mis Finanzas';
  nodo('startupDetail').textContent='';
  nodo('startupActions').hidden=true;
  slowTimer=setTimeout(()=>{
    pantalla.classList.add('startup-slow');
    nodo('startupTitle').textContent='La conexión está tardando';
    nodo('startupDetail').textContent='Seguimos preparando tu inicio.';
  },7000);
}

export function mostrarAcceso(){
  revision++;
  clearTimeout(slowTimer);
  limpiarSalida();
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
  await estabilizarVistaInstalada({vigente:()=>actual===revision});
  if(actual!==revision)return;
  const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const marca=pantalla?.querySelector?.('.startup-brand');
  // Si los datos llegan antes, el nombre termina de aparecer (máx. 0,6 s).
  if(!reduce)await terminar(marca?.getAnimations?.()||[],650);
  if(actual!==revision)return;
  // Si el reloj de animaciones estuvo pausado, se completa antes de medir.
  marca?.getAnimations?.().forEach(a=>{try{a.finish();}catch{}});
  if(pantalla){pantalla.classList.remove('startup-slow');pantalla.setAttribute('aria-busy','false');}
  if(pantalla&&!reduce&&pantalla.animate){
    // Inicio ya está renderizado debajo. La cubierta sube con borde curvo;
    // su contenido se contrarresta para que el nombre no suba con ella y
    // viaje por su cuenta hasta el logo del encabezado.
    const alto=pantalla.offsetHeight||globalThis.innerHeight||800;
    const opciones={duration:480,easing:'cubic-bezier(.76,0,.24,1)',fill:'forwards'};
    const recorrido=[[0,0],[.42,-.32*alto],[1,-1.06*alto]];
    const curvas=['0 0 0 0 / 0 0 0 0','0 0 44% 18% / 0 0 18% 10%','0 0 52% 24% / 0 0 24% 14%'];
    const salida=pantalla.animate(recorrido.map(([offset,y],i)=>({offset,transform:`translateY(${y}px)`,borderRadius:curvas[i]})),opciones);
    const capa=pantalla.querySelector?.('.startup-content');
    const fija=capa?.animate?.(recorrido.map(([offset,y])=>({offset,transform:`translateY(${-y}px)`})),opciones);
    const logo=logoInicio();
    const desde=marca?.getBoundingClientRect?.(),hasta=logo?.getBoundingClientRect?.();
    let viaje;
    if(desde?.width&&hasta?.width){
      const escala=hasta.width/desde.width;
      logo.style.opacity='0';
      viaje=marca.animate([
        {transform:'translate(0,0) scale(1)'},
        {transform:`translate(${hasta.left-desde.left}px,${hasta.top-desde.top}px) scale(${escala})`}
      ],opciones);
    }
    animacionesSalida=[fija,viaje].filter(Boolean);
    await terminar([salida],opciones.duration+300);
  }
  if(actual!==revision)return;
  if(pantalla){pantalla.hidden=true;pantalla.setAttribute('aria-busy','false');}
  if(contenido){contenido.inert=false;contenido.removeAttribute('aria-hidden');}
  // El nombre aterrizó donde está el logo real: se intercambian sin salto.
  limpiarSalida();
}
