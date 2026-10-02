const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
const almacen=entornoPrueba();
localStorage.setItem('sb_session',JSON.stringify({access_token:'demo',refresh_token:'demo',expires_at:Date.now()+3600000,user_id:'user-demo'}));
const tablas={transacciones:new Map(),deudas_abonos:new Map()};let fallo=null,perderRespuesta=false,pedidos=[],cambiarUsuario=false;
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),method=opts.method||'GET',id=(u.searchParams.get('id')||'').replace(/^eq\./,'');
  const body=opts.body?JSON.parse(opts.body):null;pedidos.push({tabla,method,id});
  if(fallo&&fallo.tabla===tabla&&fallo.method===method){const status=fallo.status||503;fallo=null;return new Response(JSON.stringify({message:'Fallo simulado'}),{status,headers:{'content-type':'application/json'}});}
  let rows=[];
  if(method==='GET'){if(tablas[tabla].has(id))rows=[tablas[tabla].get(id)];}
  if(method==='POST'){if(tablas[tabla].has(body.id))return new Response(JSON.stringify({message:'UUID duplicado'}),{status:409});tablas[tabla].set(body.id,{...body});rows=[body];if(cambiarUsuario&&tabla==='transacciones'){cambiarUsuario=false;localStorage.setItem('sb_session',JSON.stringify({user_id:'otro-usuario',access_token:'demo',expires_at:Date.now()+3600000}));}if(perderRespuesta&&tabla==='deudas_abonos'){perderRespuesta=false;throw Error('Respuesta perdida');}}
  if(method==='PATCH'){const r=tablas[tabla].get(id);if(r){Object.assign(r,body);rows=[r];}}
  if(method==='DELETE'){tablas[tabla].delete(id);return new Response(null,{status:204});}
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json'}});
};
(async()=>{
  const s=await modulo('services/debt-operations.js');
  const crear=(id,monto=50)=>({tipo:'crear',id,tx:{id:'tx-'+id,monto,fecha:'2026-10-01',tipo:'Ingreso',descripcion:'Prueba',categoria:'Otros ingresos',cuenta:''},abono:{id,deuda_id:'deuda-demo',monto,fecha:'2026-10-01',nota:'',tx_id:'tx-'+id}});
  const op=crear('abono-1');fallo={tabla:'deudas_abonos',method:'POST'};
  await assert.rejects(s.ejecutarAbono(op),e=>e.pending===true);
  assert.equal(tablas.transacciones.size,1);assert.equal(tablas.deudas_abonos.size,0);assert.equal(s.abonoPendiente().id,op.id);
  await s.recuperarAbonosPendientes();assert.equal(tablas.transacciones.size,1);assert.equal(tablas.deudas_abonos.size,1);assert.equal(s.abonoPendiente(),null);
  perderRespuesta=true;await assert.rejects(s.ejecutarAbono(crear('abono-2')),e=>e.pending===true);
  await s.recuperarAbonosPendientes();assert.equal(tablas.transacciones.size,2);assert.equal(tablas.deudas_abonos.size,2,'respuesta perdida no duplica');
  fallo={tabla:'transacciones',method:'PATCH'};await assert.rejects(s.ejecutarAbono({tipo:'editar',id:'abono-1',txId:'tx-abono-1',patch:{monto:70,fecha:'2026-10-02',nota:'Editado'}}),e=>e.pending);
  await s.recuperarAbonosPendientes();assert.equal(tablas.transacciones.get('tx-abono-1').monto,70);assert.equal(tablas.deudas_abonos.get('abono-1').monto,70);
  fallo={tabla:'transacciones',method:'DELETE'};await assert.rejects(s.ejecutarAbono({tipo:'eliminar',id:'abono-1',txId:'tx-abono-1'}),e=>e.pending);
  await s.recuperarAbonosPendientes();assert.equal(tablas.transacciones.size,1);assert.equal(tablas.deudas_abonos.size,1);
  fallo={tabla:'deudas_abonos',method:'POST',status:400};await assert.rejects(s.ejecutarAbono(crear('abono-rechazado')),e=>e.cancelled);
  assert.equal(tablas.transacciones.has('tx-abono-rechazado'),false);assert.equal(s.abonoPendiente(),null);
  const original=localStorage.setItem;localStorage.setItem=()=>{throw Error('almacenamiento bloqueado');};const antes=pedidos.length;
  await assert.rejects(s.ejecutarAbono(crear('sin-storage')));assert.equal(pedidos.length,antes,'sin diario persistente no se escribe al servidor');localStorage.setItem=original;
  assert.ok(![...almacen.keys()].some(k=>k.includes('abonos-pendientes')));
  const session=localStorage.getItem('sb_session');cambiarUsuario=true;
  await assert.rejects(s.ejecutarAbono(crear('cambio-sesion')),e=>e.pending);
  assert.equal(tablas.deudas_abonos.has('cambio-sesion'),false,'no continuar escrituras con otro usuario');
  assert.ok(almacen.has('finanzas.abonos-pendientes.v1.user-demo'));assert.equal(s.abonoPendiente(),null);
  localStorage.setItem('sb_session',session);await s.recuperarAbonosPendientes();assert.equal(tablas.deudas_abonos.has('cambio-sesion'),true);
  console.log('PASS: create/edit/delete recuperables, respuesta perdida, rechazo compensado, storage bloqueado y cambio de usuario.');
})().catch(e=>{console.error(e);process.exitCode=1;});
