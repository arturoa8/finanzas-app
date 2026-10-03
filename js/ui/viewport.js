// Corrección acotada al arranque de WebKit instalado. La cubierta oculta el
// reajuste y las áreas seguras siguen siendo las que entrega el navegador.
export async function estabilizarVistaInstalada({vigente=()=>true}={}){
  const nav=globalThis.navigator;
  const ios=/iPad|iPhone|iPod/.test(nav?.userAgent||'')||
    (nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);
  const instalada=nav?.standalone===true||globalThis.matchMedia?.('(display-mode: standalone)').matches;
  if(!ios||!instalada||document.hidden||!globalThis.requestAnimationFrame)return;
  const contenido=document.getElementById('appContent');
  const cubierta=document.getElementById('appStartup');
  const puedeAjustar=()=>vigente()&&!document.hidden&&contenido?.inert&&cubierta&&!cubierta.hidden;
  if(!puedeAjustar())return;
  const cuadro=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  // Esperar a que WebKit haya pintado el documento y su área segura.
  await cuadro();await cuadro();
  if(!puedeAjustar())return;
  const x=window.scrollX||0,y=window.scrollY||0;
  if(y>0)return; // No sustituir una posición de lectura restaurada.
  const raiz=document.scrollingElement||document.documentElement;
  const cuerpo=document.body;
  const alto=window.innerHeight||document.documentElement.clientHeight;
  const minimoAnterior=cuerpo.style.minHeight;
  const necesitaRecorrido=alto>0&&raiz.scrollHeight-alto<2;
  // Con un resumen corto, scrollTo(1) no se mueve: crear recorrido temporal
  // hace efectivo el reajuste. Se retira antes de descubrir el contenido.
  if(necesitaRecorrido)cuerpo.style.minHeight=(alto+2)+'px';
  try{
    // También normaliza el offset negativo que puede dejar la apertura.
    window.scrollTo({left:x,top:1,behavior:'instant'});
    await cuadro();
    if(Math.abs((window.scrollY||0)-1)<=1){
      window.scrollTo({left:x,top:0,behavior:'instant'});
    }
    await cuadro();
  }finally{
    if(necesitaRecorrido)cuerpo.style.minHeight=minimoAnterior;
  }
}
