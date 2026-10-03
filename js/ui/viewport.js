// WebKit puede conservar el desplazamiento de su vista nativa al abrir una
// app instalada (por ejemplo, después de cambiar la barra de una llamada).
// Repetimos el pequeño desplazamiento que fuerza su actualización, detrás
// de la cubierta inicial. No sustituimos env(safe-area-inset-*) por píxeles.
export async function estabilizarVistaInstalada(){
  const nav=globalThis.navigator;
  const ios=/iPad|iPhone|iPod/.test(nav?.userAgent||'')||
    (nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);
  const instalada=nav?.standalone===true||globalThis.matchMedia?.('(display-mode: standalone)').matches;
  if(!ios||!instalada||document.hidden||!globalThis.requestAnimationFrame)return;
  const contenido=document.getElementById('appContent');
  const cubierta=document.getElementById('appStartup');
  // Solo durante el arranque bloqueado, nunca mientras se lee o edita.
  if(!contenido?.inert||!cubierta||cubierta.hidden)return;
  const x=window.scrollX||0,y=window.scrollY||0;
  if(y!==0)return;
  const cuadro=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  window.scrollTo({left:x,top:1,behavior:'instant'});
  await cuadro();
  // No deshacer un desplazamiento ajeno ocurrido durante la espera.
  if(Math.abs((window.scrollY||0)-1)<=1){
    window.scrollTo({left:x,top:y,behavior:'instant'});
  }
  await cuadro();
}
