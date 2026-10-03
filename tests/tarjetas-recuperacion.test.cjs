const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
const almacen=entornoPrueba();
const sesion=id=>localStorage.setItem('sb_session',JSON.stringify({access_token:'demo',refresh_token:'demo',expires_at:Date.now()+3600000,user_id:id}));
sesion('usuario-demo');
const tablas={transacciones:new Map(),pagos_tarjetas:new Map()};let fallo=null,perderRespuesta=false,pedidos=0,cambiarUsuario=false;
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),method=opts.method||'GET',id=(u.searchParams.get('id')||'').replace(/^eq\./,'');
  const body=opts.body?JSON.parse(opts.body):null;pedidos++;
  if(fallo&&fallo.tabla===tabla&&fallo.method===method){const status=fallo.status||503;fallo=null;return new Response(JSON.stringify({message:'Fallo simulado'}),{status});}
  let rows=[];
  if(method==='GET'){if(tablas[tabla].has(id))rows=[tablas[tabla].get(id)];}
  if(method==='POST'){
    if(tablas[tabla].has(body.id))return new Response('{}',{status:409});
    tablas[tabla].set(body.id,{...body});rows=[body];
    if(cambiarUsuario&&tabla==='transacciones'){cambiarUsuario=false;sesion('otro-usuario');}
    if(perderRespuesta&&tabla==='pagos_tarjetas'){perderRespuesta=false;throw Error('Respuesta perdida');}
  }
  if(method==='DELETE'){tablas[tabla].delete(id);return new Response(null,{status:204});}
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json'}});
};
(async()=>{
  const s=await modulo('services/card-operations.js');
  const crear=id=>({tipo:'crear',id,ajuste:{id:'fx-'+id,monto:0.54,tipo:'Gasto',fecha:'2026-10-02',cuenta:''},pago:{id,monto:6,tarjeta:'Visa demo',nota:'crédito USD',ajuste_id:'fx-'+id}});
  fallo={tabla:'pagos_tarjetas',method:'POST'};
  await assert.rejects(s.ejecutarOperacionTarjeta(crear('p1')),e=>e.pending);
  assert.equal(tablas.transacciones.size,1);assert.equal(tablas.pagos_tarjetas.size,0);
  await assert.rejects(s.ejecutarOperacionTarjeta(crear('otro')),e=>e.pending,'no aceptar otro pago mientras está pendiente');
  await s.recuperarPagosTarjetaPendientes();assert.equal(tablas.pagos_tarjetas.size,1);assert.equal(s.pagoTarjetaPendiente(),null);
  perderRespuesta=true;await assert.rejects(s.ejecutarOperacionTarjeta(crear('p2')),e=>e.pending);
  await s.recuperarPagosTarjetaPendientes();assert.equal(tablas.transacciones.size,2);assert.equal(tablas.pagos_tarjetas.size,2,'respuesta perdida no duplica dinero');
  fallo={tabla:'transacciones',method:'DELETE'};
  await assert.rejects(s.ejecutarOperacionTarjeta({tipo:'eliminar',id:'p1',ajusteId:'fx-p1'}),e=>e.pending);
  assert.equal(tablas.pagos_tarjetas.has('p1'),false);assert.equal(tablas.transacciones.has('fx-p1'),true);
  await s.recuperarPagosTarjetaPendientes();assert.equal(tablas.transacciones.has('fx-p1'),false);
  fallo={tabla:'pagos_tarjetas',method:'POST',status:400};
  await assert.rejects(s.ejecutarOperacionTarjeta(crear('rechazado')),e=>e.cancelled);
  assert.equal(tablas.transacciones.has('fx-rechazado'),false);assert.equal(s.pagoTarjetaPendiente(),null);
  const guardar=localStorage.setItem,antes=pedidos;localStorage.setItem=()=>{throw Error('Storage bloqueado');};
  await assert.rejects(s.ejecutarOperacionTarjeta(crear('sin-storage')));assert.equal(pedidos,antes,'sin recuperación persistida no escribir dinero');localStorage.setItem=guardar;
  cambiarUsuario=true;await assert.rejects(s.ejecutarOperacionTarjeta(crear('cambio-sesion')),e=>e.pending);
  assert.equal(tablas.pagos_tarjetas.has('cambio-sesion'),false);assert.equal(s.pagoTarjetaPendiente(),null);
  assert.ok(almacen.has('finanzas.tarjetas-pendientes.v1.usuario-demo'));
  sesion('usuario-demo');await s.recuperarPagosTarjetaPendientes();assert.equal(tablas.pagos_tarjetas.has('cambio-sesion'),true);
  console.log('PASS: pago y conversión recuperables, sin duplicados, eliminación, rechazo compensado, almacenamiento bloqueado y cambio de sesión.');
})().catch(e=>{console.error(e);process.exitCode=1;});
