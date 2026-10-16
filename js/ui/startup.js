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

// Deja el fondo de la cubierta y el logo real como antes de una salida interrumpida.
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
  const fondo=pantalla?.querySelector?.('.startup-fondo');
  if(fondo?.animate&&!reduce){
    // Inicio ya está renderizado debajo. El fondo negro de la cubierta sube
    // con su borde verde y se estrecha hasta el ancho del nombre, que viaja
    // por su cuenta al logo del encabezado (va aparte del fondo, no lo arrastra).
    const alto=pantalla.offsetHeight||globalThis.innerHeight||800;
    const ancho=pantalla.offsetWidth||globalThis.innerWidth||390;
    const opciones={duration:480,easing:'cubic-bezier(.76,0,.24,1)',fill:'forwards'};
    const logo=logoInicio();
    const desde=marca?.getBoundingClientRect?.(),hasta=logo?.getBoundingClientRect?.();
    const hayLogo=Boolean(desde?.width&&hasta?.width);
    // El borde llega justo debajo del nombre y ahí se detiene (antes seguía
    // hasta salir de la pantalla, pasando por encima del título). Se mide en
    // pantalla igual que el logo: en Safari offsetHeight no siempre coincide
    // con donde está el borde.
    const caja=fondo.getBoundingClientRect?.();
    const borde=caja?.height>0&&Number.isFinite(caja.bottom)?caja.bottom:alto;
    const final=hayLogo?hasta.top+hasta.height+4-borde:-1.06*alto;
    // Ancho de llegada: el del nombre más una holgura. Antes el borde verde
    // cruzaba toda la pantalla y terminaba en los botones del encabezado.
    const holgura=14;
    const izq=hayLogo?Math.max(0,hasta.left-holgura):0;
    const der=hayLogo?Math.max(0,ancho-(hasta.left+hasta.width+holgura)):0;
    // [fotograma, avance vertical, cuánto se estrechó]
    const pasos=[[0,0,0],[.42,.3,.55],[1,1,1]];
    const marcos=pasos.map(([offset,y,e],i)=>{
      const l=e*izq,r=e*der,radio=i?Math.min((ancho-l-r)/2,.12*alto):0;
      return {offset,transform:`translateY(${y*final}px)`,left:`${l}px`,right:`${r}px`,borderRadius:`0 0 ${radio}px ${radio}px`,opacity:1};
    });
    // Al llegar bajo el nombre el fondo se disuelve y destapa el encabezado.
    // Solo el último fotograma baja la opacidad: el 0,85 la mantiene explícita,
    // si no se interpolaría desde el primero y la cubierta se vería traslúcida.
    if(hayLogo){marcos.splice(2,0,{offset:.85,opacity:1});marcos.at(-1).opacity=0;}
    const salida=fondo.animate(marcos,opciones);
    let viaje;
    if(hayLogo){
      const escala=hasta.width/desde.width;
      logo.style.opacity='0';
      viaje=marca.animate([
        {transform:'translate(0,0) scale(1)'},
        {transform:`translate(${hasta.left-desde.left}px,${hasta.top-desde.top}px) scale(${escala})`}
      ],opciones);
    }
    animacionesSalida=[salida,viaje].filter(Boolean);
    await terminar([salida],opciones.duration+300);
  }
  if(actual!==revision)return;
  if(pantalla){pantalla.hidden=true;pantalla.setAttribute('aria-busy','false');}
  if(contenido){contenido.inert=false;contenido.removeAttribute('aria-hidden');}
  // El nombre aterrizó donde está el logo real: se intercambian sin salto.
  limpiarSalida();
}
