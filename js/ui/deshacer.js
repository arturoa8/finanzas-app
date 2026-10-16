// Deshacer la última acción.
//
// Quien cambia datos registra aquí cómo revertirlo, y la barra inferior ofrece
// "Deshacer" durante unos segundos (o Cmd/Ctrl+Z en computadora). Solo se
// guarda la última acción: una nueva reemplaza a la anterior, como en iOS.
//
// revertir() escribe en Supabase lo que había antes; después se recargan los
// datos completos, porque deshacer puede tocar varias tablas a la vez.
import {toast} from './toast.js';

const DURACION=8000;
let accion=null,timer=null,deshaciendo=false,recargar=null;

// transactions.js entrega cargar() al arrancar: importarlo aquí crearía un
// ciclo entre la interfaz y los módulos de datos.
export function configurarDeshacer({alTerminar}){recargar=alTerminar;}

export function ofrecerDeshacer(mensaje,revertir){
  accion={revertir};
  const barra=document.getElementById('undoBar');
  if(!barra)return;
  document.getElementById('undoMsg').textContent=mensaje;
  barra.hidden=false;
  void barra.offsetWidth;
  barra.classList.add('show');
  programarCierre();
}

function programarCierre(){clearTimeout(timer);timer=setTimeout(cerrarDeshacer,DURACION);}

// Mientras el dedo o el puntero está sobre la barra, no se va.
export function pausarDeshacer(){clearTimeout(timer);}
export function reanudarDeshacer(){if(accion&&!deshaciendo)programarCierre();}

export function cerrarDeshacer(){
  accion=null;clearTimeout(timer);timer=null;
  const barra=document.getElementById('undoBar');
  if(!barra)return;
  barra.classList.remove('show');
  setTimeout(()=>{if(!barra.classList.contains('show'))barra.hidden=true;},300);
}

export function hayDeshacer(){return !!accion;}

export async function deshacer(){
  if(!accion||deshaciendo)return;
  const {revertir}=accion;
  deshaciendo=true;
  const boton=document.getElementById('undoBtn');
  if(boton)boton.disabled=true;
  try{
    await revertir();
    cerrarDeshacer();
    if(recargar)await recargar();
    toast('Listo, se deshizo','success');
  }catch(e){
    cerrarDeshacer();
    console.error(e);
    toast(e.message?'No se pudo deshacer: '+e.message:'No se pudo deshacer','error');
    if(recargar)recargar();
  }finally{
    deshaciendo=false;
    if(boton)boton.disabled=false;
  }
}

export function initializeDeshacer(){
  document.addEventListener('keydown',e=>{
    if(!accion||e.key.toLowerCase()!=='z'||!(e.metaKey||e.ctrlKey)||e.shiftKey||e.altKey)return;
    // En un campo de texto, Cmd+Z deshace lo escrito, no el último guardado.
    const el=document.activeElement;
    if(el&&(el.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))return;
    e.preventDefault();
    deshacer();
  });
}
