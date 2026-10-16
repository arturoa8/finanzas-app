// Service worker de Mis Finanzas: SOLO recibe notificaciones push.
//
// No guarda nada en caché ni intercepta peticiones (no hay evento fetch) a
// propósito: la app se actualiza seguido y un caché aquí dejaría versiones
// viejas en el teléfono. Si algún día se quiere uso sin conexión, es otra
// decisión, no un efecto colateral de las notificaciones.
//
// Formato del push (JSON): {titulo, cuerpo, url, tag}. Todo opcional.
// iOS exige que CADA push muestre una notificación (userVisibleOnly): si el
// mensaje llega vacío o malformado, igual se muestra una genérica; de lo
// contrario Safari cancela la suscripción tras unos pocos pushes silenciosos.

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));

function leerMensaje(event){
  if(!event.data)return {};
  try{const m=event.data.json();return m&&typeof m==='object'?m:{cuerpo:String(m)};}
  catch(e){try{return {cuerpo:event.data.text()};}catch(e2){return {};}}
}

self.addEventListener('push',event=>{
  const m=leerMensaje(event);
  // iOS ya muestra "from Mis Finanzas" bajo el título: repetir el nombre de la
  // app aquí sería ruido. El título de los avisos reales dice qué pasó.
  event.waitUntil(self.registration.showNotification(String(m.titulo||'Nuevo aviso'),{
    body:String(m.cuerpo||'Abre la app para verlo.'),
    icon:'icons/icon-192.png',
    tag:m.tag?String(m.tag):undefined,
    data:{url:typeof m.url==='string'?m.url:'./'}
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const destino=new URL(event.notification.data?.url||'./',self.registration.scope).href;
  event.waitUntil((async()=>{
    const ventanas=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const abierta=ventanas.find(v=>v.url.startsWith(self.registration.scope));
    if(abierta){await abierta.focus();return;}
    await self.clients.openWindow(destino);
  })());
});
