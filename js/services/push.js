// Notificaciones push (Web Push): soporte del navegador, suscripción de este
// dispositivo y su registro en Supabase. Sin interfaz: eso vive en
// modules/notificaciones.js.
//
// iPhone: Safari solo expone PushManager y Notification cuando la app está
// instalada en la pantalla de inicio (iOS 16.4+). Abierta en una pestaña de
// Safari no existen, y por eso "instalar" es un estado propio y no un error.

import {authHeader} from './auth.js';
import {sbFetch} from './supabase.js';
import {SUPABASE_ANON_KEY, SUPABASE_URL} from './supabase-config.js';

// Clave pública VAPID. La privada vive solo en los secretos de la Edge
// Function (supabase/scripts/generar-vapid.cjs las genera). Cambiarla deja
// sin efecto todas las suscripciones: cada una queda atada a esta clave.
export const VAPID_PUBLIC_KEY='BHZunZgWVOjtHAewmqe11Nl-AhIoc_RA-sPsxntZo-kRLVQV4pAJfdTHtc3JtKWNIa3cwSs_7g7Df7hKddPhoPw';

// applicationServerKey pide los bytes de la clave, no el texto base64url.
export function claveAplicacion(base64url){
  const relleno='='.repeat((4-base64url.length%4)%4);
  const crudo=atob((base64url+relleno).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(crudo,c=>c.charCodeAt(0));
}

export function esIOS(nav){
  return /iPad|iPhone|iPod/.test(nav?.userAgent||'')||(nav?.platform==='MacIntel'&&nav?.maxTouchPoints>1);
}
export function esAppInstalada(entorno=globalThis){
  return entorno.navigator?.standalone===true||entorno.matchMedia?.('(display-mode: standalone)')?.matches===true;
}

// 'disponible' | 'instalar' | 'no-soportado'
export function soportePush(entorno=globalThis){
  const nav=entorno.navigator;
  if(nav&&'serviceWorker' in nav&&'PushManager' in entorno&&'Notification' in entorno)return 'disponible';
  return esIOS(nav)&&!esAppInstalada(entorno)?'instalar':'no-soportado';
}

// 'no-soportado' | 'instalar' | 'denegado' | 'inactivo' | 'activo'
export async function estadoPush(entorno=globalThis){
  const soporte=soportePush(entorno);
  if(soporte!=='disponible')return soporte;
  if(entorno.Notification.permission==='denied')return 'denegado';
  const registro=await entorno.navigator.serviceWorker.getRegistration();
  const suscripcion=await registro?.pushManager.getSubscription();
  return suscripcion&&entorno.Notification.permission==='granted'?'activo':'inactivo';
}

async function suscripcionActual(entorno){
  const registro=await entorno.navigator.serviceWorker.getRegistration();
  return registro?.pushManager.getSubscription()??null;
}

// Guarda (o reasigna a esta cuenta) la suscripción en la base. Idempotente.
export async function registrarSuscripcion(suscripcion,entorno=globalThis){
  const {endpoint,keys}=suscripcion.toJSON();
  if(!endpoint||!keys?.p256dh||!keys?.auth)throw new Error('El navegador entregó una suscripción incompleta');
  await sbFetch('rpc/registrar_push',{method:'POST',body:JSON.stringify({p_endpoint:endpoint,p_p256dh:keys.p256dh,p_auth:keys.auth,p_agente:entorno.navigator?.userAgent||null})});
}

// Debe llamarse DENTRO de un toque del usuario: iOS solo deja pedir el permiso
// ahí, y por eso requestPermission va antes que cualquier otro await.
export async function activarPush(entorno=globalThis){
  const soporte=soportePush(entorno);
  if(soporte==='instalar')throw new Error('Instala la app en tu pantalla de inicio para recibir notificaciones');
  if(soporte!=='disponible')throw new Error('Este navegador no admite notificaciones');
  const permiso=await entorno.Notification.requestPermission();
  if(permiso==='denied')throw new Error('Las notificaciones están bloqueadas: actívalas en los ajustes del dispositivo');
  if(permiso!=='granted')throw new Error('No diste permiso para las notificaciones');
  await entorno.navigator.serviceWorker.register('./sw.js',{scope:'./'});
  const registro=await entorno.navigator.serviceWorker.ready;
  const suscripcion=await registro.pushManager.getSubscription()
    ||await registro.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:claveAplicacion(VAPID_PUBLIC_KEY)});
  await registrarSuscripcion(suscripcion,entorno);
}

export async function desactivarPush(entorno=globalThis){
  const suscripcion=await suscripcionActual(entorno);
  if(!suscripcion)return;
  // Primero la base: si falla, la suscripción sigue viva y coherente con ella.
  await sbFetch(`push_suscripciones?endpoint=eq.${encodeURIComponent(suscripcion.endpoint)}`,{method:'DELETE'});
  await suscripcion.unsubscribe();
}

// Reasegura el registro de un dispositivo que ya estaba suscrito (por ejemplo,
// si cambió de cuenta). No pide permisos ni muestra nada.
export async function sincronizarPush(entorno=globalThis){
  const suscripcion=await suscripcionActual(entorno);
  if(suscripcion)await registrarSuscripcion(suscripcion,entorno);
}

export async function enviarPrueba(){
  const r=await fetch(SUPABASE_URL+'/functions/v1/enviar-prueba-push',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:await authHeader(),'Content-Type':'application/json'},body:'{}'});
  const datos=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(datos.error||('No se pudo enviar la prueba (HTTP '+r.status+')'));
  if(!datos.enviadas)throw new Error(datos.motivo||'No se pudo entregar la prueba a este dispositivo');
  return datos;
}
