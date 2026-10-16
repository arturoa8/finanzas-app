// Configuración → Notificaciones: activar, probar y desactivar los avisos de
// este dispositivo. La lógica de push vive en services/push.js.

import {activarPush, desactivarPush, enviarPrueba, estadoPush, sincronizarPush} from '../services/push.js';
import {toast} from '../ui/toast.js';

const TEXTOS_PUSH={
  'no-soportado':'Este navegador no admite notificaciones.',
  instalar:'En iPhone las notificaciones solo funcionan con la app instalada. Toca Compartir → Añadir a pantalla de inicio, abre la app desde ese icono y vuelve aquí.',
  denegado:'Las notificaciones están bloqueadas para esta app. Actívalas en los ajustes del dispositivo (iPhone: Ajustes → Notificaciones → Finanzas).',
  inactivo:'Desactivadas en este dispositivo.',
  activo:'Activadas en este dispositivo.'
};
const BOTONES_PUSH={activar:['inactivo'],probar:['activo'],desactivar:['activo']};

let pushOcupado=false,pushSincronizado=false;

export async function renderNotificaciones(){
  const texto=document.getElementById('pushEstado');if(!texto)return;
  let estado;
  try{estado=await estadoPush();}catch(e){estado='no-soportado';}
  texto.textContent=TEXTOS_PUSH[estado];
  for(const [boton,estados] of Object.entries(BOTONES_PUSH)){
    const el=document.getElementById('push'+boton[0].toUpperCase()+boton.slice(1));
    if(el){el.hidden=!estados.includes(estado);el.disabled=pushOcupado;}
  }
  // Un dispositivo ya suscrito se vuelve a registrar una vez por carga: cubre
  // el cambio de cuenta en el mismo teléfono sin pedir nada al usuario.
  if(estado==='activo'&&!pushSincronizado){pushSincronizado=true;sincronizarPush().catch(()=>{pushSincronizado=false;});}
}

async function ejecutarPush(accion,exito){
  if(pushOcupado)return;
  pushOcupado=true;renderNotificaciones();
  try{await accion();toast(exito,'success');}
  catch(e){toast(e.message||'No se pudo completar','error');}
  finally{pushOcupado=false;renderNotificaciones();}
}

export function initializeNotificaciones(){
  // activarPush ya registró el dispositivo: no hace falta sincronizarlo otra vez al repintar.
  document.getElementById('pushActivar')?.addEventListener('click',()=>ejecutarPush(async()=>{await activarPush();pushSincronizado=true;},'Notificaciones activadas'));
  document.getElementById('pushProbar')?.addEventListener('click',()=>ejecutarPush(()=>enviarPrueba(),'Prueba enviada: debería llegarte en unos segundos'));
  document.getElementById('pushDesactivar')?.addEventListener('click',()=>ejecutarPush(()=>desactivarPush(),'Notificaciones desactivadas'));
}
