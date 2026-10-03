// El FAB de Tarjetas registra un pago en su propio modal. Las escrituras de
// esta prueba van a una API en memoria: nunca se conectan a Supabase real.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date,realTimeout=setTimeout;
const ahora=RealDate.parse('2026-10-03T12:00:00-05:00');
globalThis.Date=class extends RealDate{
  constructor(...a){super(...(a.length?a:[ahora]));}
  static now(){return ahora;}
};
entornoPrueba();

const nodos=new Map();
const decode=s=>String(s).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function nodo(id){
  const clases=new Set(),atributos=new Map();let contenido='',valor='';
  return {id,dataset:{},style:{},hidden:false,disabled:false,textContent:'',offsetWidth:320,
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
      toggle(x,force){const activo=force??!clases.has(x);if(activo)clases.add(x);else clases.delete(x);return activo;}},
    get value(){return valor;},set value(v){valor=String(v??'');},
    get innerHTML(){return contenido;},set innerHTML(v){
      contenido=String(v);
      if(/^\s*<option\b/.test(contenido)){
        const opts=[...contenido.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
        const opcion=opts.find(o=>/\bselected\b/.test(o[1]))||opts[0];
        valor=opcion?decode(/\bvalue="([^"]*)"/.exec(opcion[1])?.[1]??opcion[2]):'';
      }
      for(const m of contenido.matchAll(/<input\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const input=el(m[2]);input.value=decode(/\bvalue="([^"]*)"/.exec(m[1])?.[1]||'');
      }
      for(const m of contenido.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
        const opts=[...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
        const opcion=opts.find(o=>/\bselected\b/.test(o[1]))||opts[0];
        el(m[1]).value=opcion?decode(/\bvalue="([^"]*)"/.exec(opcion[1])?.[1]??opcion[2]):'';
      }
    },
    setAttribute(k,v){atributos.set(k,String(v));},getAttribute:k=>atributos.get(k)??null,removeAttribute:k=>atributos.delete(k),
    querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},focus(){},
  };
}
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
let pagina='p-card';
document.getElementById=el;
document.querySelector=s=>s==='.page.active'?el(pagina):null;
document.querySelectorAll=()=>[];
document.body=nodo('body');
globalThis.window={scrollTo(){},matchMedia:()=>({matches:true})};
globalThis.matchMedia=window.matchMedia;
globalThis.confirm=()=>true;
globalThis.setTimeout=(fn,ms,...a)=>{const t=realTimeout(fn,ms,...a);if(ms>=1000)t.unref?.();return t;};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:ahora+3600000}));

let pedidos=[],fallar=false,respuestaVacia=false,retener=null;
const servidor=new Map();
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),method=opts.method||'GET';
  assert.equal(u.pathname,'/rest/v1/pagos_tarjetas','el flujo PEN no puede crear una transacción ni llamar otra API');
  assert.ok(['POST','PATCH'].includes(method),'la API ficticia sólo permite registrar o editar pagos');
  const body=JSON.parse(opts.body),id=method==='PATCH'?u.searchParams.get('id').replace(/^eq\./,''):'pago-'+(pedidos.length+1);
  pedidos.push({method,id,body});
  if(retener)await retener;
  if(fallar){fallar=false;return new Response(JSON.stringify({message:'Fallo de red simulado'}),{status:503});}
  if(respuestaVacia){respuestaVacia=false;return new Response('[]',{status:200,headers:{'content-type':'application/json'}});}
  const row={...(servidor.get(id)||{}),...body,id};servidor.set(id,row);
  return new Response(JSON.stringify([row]),{status:200,headers:{'content-type':'application/json'}});
};
const esperar=async(pred)=>{
  for(let i=0;i<80;i++){if(pred())return;await new Promise(r=>realTimeout(r,2));}
  assert.fail('La operación ficticia no alcanzó el estado esperado');
};

(async()=>{
  const [{datos},pagos,ui,nav,cuentas,ciclos]=await Promise.all([
    modulo('state.js'),modulo('modules/cards/payments.js'),modulo('modules/cards/cards-ui.js'),
    modulo('ui/navigation.js'),modulo('modules/accounts.js'),modulo('modules/cards/cycles.js'),
  ]);
  Object.assign(datos,{cuentas:[['Plin','billetera','PEN',false,'pen'],['Yape','billetera','PEN',false,'yape'],
    ['BCP Dólares','banco','USD',false,'usd'],['Archivada','banco','PEN',true,'archivada'],['IBKR','inversion','USD',false,'ibkr']],
    configTarjetas:[['Visa demo',5000,30,'Visa demo','💳',24,15],['MC demo',5000,30,'MC demo','💳',24,15]],
    categorias:[['Compras','#00d68f']],ciclosOverride:[],pagosTarjetas:[],deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[],
    transacciones:[['2026-10-01','Compra PEN','Compras','Gasto',100,'Visa demo','g1'],
      ['2026-10-01','Compra USD','Compras','Gasto',37,'Visa demo','g2',null,null,'USD',10,3.7,'mercado'],
      ['2026-10-01','Compra MC','Compras','Gasto',50,'MC demo','g3']],cargados:true});
  cuentas.setEstadoCuentas('lista');cuentas.setCuentasMigradas(true);

  // La acción contextual abre pagos sin abrir el formulario de transacciones.
  nav.handleFab();
  assert.equal(el('cardPaymentModal').classList.contains('active'),true);
  assert.equal(el('modal').classList.contains('active'),false);
  assert.match(el('cardPaymentContent').innerHTML,/cardPayTarjeta/);
  assert.match(el('cardPaymentContent').innerHTML,/Visa demo/);
  assert.match(el('cardPaymentContent').innerHTML,/MC demo/);
  pagos.seleccionarTarjetaPago('MC demo');
  assert.equal(el('cardPayTarjeta').value,'MC demo');
  assert.equal(el('cardDetailModal').classList.contains('active'),false,'elegir tarjeta no abre su detalle');
  assert.doesNotMatch(el('cardPaymentContent').innerHTML,/<option[^>]*value="Archivada"/);
  assert.doesNotMatch(el('cardPaymentContent').innerHTML,/<option[^>]*value="IBKR"/);

  // Abrir/cerrar otro detalle no cambia la tarjeta elegida ni el ciclo del pago.
  const cicloOriginal=ciclos.getCycleKey(ciclos.getCardCycle({finDia:24,inicioDia:25,pagoDia:15},ciclos.cardCycleOffset));
  ui.abrirCardDetail('Visa demo');
  assert.doesNotMatch(el('cardDetailContent').innerHTML,/cardPayAmount|guardarPagoTarjeta\(/,'el detalle no ofrece registrar un pago');
  assert.match(el('cardDetailContent').innerHTML,/Historial de pagos/);
  ui.cerrarCardDetail();ciclos.goNextCardCycle();
  el('cardPayAmount').value='25.50';el('cardPayDate').value='2026-10-03';el('cardPayNote').value='Pago de prueba';el('cardPayCuenta').value='Yape';
  await pagos.guardarPagoTarjeta();
  assert.equal(pedidos.length,1);
  assert.equal(pedidos[0].method,'POST');
  assert.equal(pedidos[0].body.tarjeta,'MC demo');
  assert.equal(pedidos[0].body.ciclo_key,cicloOriginal,'el ciclo abierto se conserva aunque la página cambie después');
  assert.equal(pedidos[0].body.monto,25.5);assert.equal(pedidos[0].body.cuenta_origen,'Yape');
  assert.equal(pedidos[0].body.fecha,'2026-10-03');assert.equal(pedidos[0].body.nota,'Pago de prueba');
  assert.equal(datos.pagosTarjetas.length,1);assert.equal(datos.transacciones.length,3);
  assert.equal(el('cardPaymentModal').classList.contains('active'),false,'sólo cierra después de confirmar el pago');

  // Validar antes de escribir: monto, fecha, moneda y cuenta disponible.
  pagos.abrirPagoTarjeta();pagos.seleccionarTarjetaPago('MC demo');
  const completar=()=>{el('cardPayAmount').value='10';el('cardPayDate').value='2026-10-03';el('cardPayCuenta').value='Plin';};
  for(const [id,value] of [['cardPayAmount','0'],['cardPayAmount','-1'],['cardPayAmount','Infinity'],['cardPayDate','fecha inválida'],
    ['cardPayCuenta',''],['cardPayCuenta','BCP Dólares'],['cardPayCuenta','Archivada'],['cardPayCuenta','IBKR']]){
    completar();el(id).value=value;const antes=pedidos.length;await pagos.guardarPagoTarjeta();
    assert.equal(pedidos.length,antes,'el campo '+id+' inválido no escribe');
    assert.equal(el('cardPaymentModal').classList.contains('active'),true);
  }
  completar();cuentas.setEstadoCuentas('error');await pagos.guardarPagoTarjeta();assert.equal(pedidos.length,1);cuentas.setEstadoCuentas('lista');

  // Una falla mantiene el formulario y los datos; se puede volver a intentar.
  completar();fallar=true;const antesFallo=JSON.stringify(datos.pagosTarjetas);await pagos.guardarPagoTarjeta();
  assert.equal(JSON.stringify(datos.pagosTarjetas),antesFallo);assert.equal(el('cardPaymentModal').classList.contains('active'),true);
  assert.match(el('toast').textContent,/Fallo de red simulado/);
  let liberar;retener=new Promise(r=>{liberar=r;});const guardando=pagos.guardarPagoTarjeta();
  await esperar(()=>pedidos.length===3);await pagos.guardarPagoTarjeta();assert.equal(pedidos.length,3,'dos clics envían un solo POST');
  liberar();await guardando;retener=null;
  assert.equal(datos.pagosTarjetas.length,2);assert.equal(el('cardPaymentModal').classList.contains('active'),false);

  // Editar un pago existente usa PATCH, conserva su ID/ciclo y permite origen.
  ciclos.abrirCardCyclePicker();ciclos.seleccionarCardCycleActual();ciclos.aplicarCardCyclePicker();
  ui.abrirCardDetail('MC demo');const original=datos.pagosTarjetas[0].slice();
  const historial=pagos.renderPaymentHistory({cuenta:'MC demo'},ciclos.getCardCycle({finDia:24,inicioDia:25,pagoDia:15},0));
  assert.match(historial,/editarPagoTarjeta/);
  pagos.editarPagoTarjeta(String(original[0]));
  assert.equal(el('payEditModal').classList.contains('active'),true);assert.equal(el('payEditCuenta').value,'Yape');
  el('payEditAmount').value='20.25';el('payEditDate').value='2026-10-02';el('payEditNote').value='Nota corregida';el('payEditCuenta').value='Plin';
  await pagos.guardarEditPago();const edicion=pedidos.at(-1);
  assert.equal(edicion.method,'PATCH');assert.equal(edicion.id,String(original[0]));
  assert.equal(edicion.body.monto,20.25);assert.equal(edicion.body.fecha,'2026-10-02');assert.equal(edicion.body.nota,'Nota corregida');assert.equal(edicion.body.cuenta_origen,'Plin');
  const editado=datos.pagosTarjetas.find(p=>p[0]===original[0]);
  assert.equal(editado[1],original[1]);assert.equal(editado[2],original[2]);assert.equal(editado[3],20.25);assert.equal(editado[6],'Plin');
  assert.equal(datos.pagosTarjetas.length,2);assert.equal(el('payEditModal').classList.contains('active'),false);
  pagos.editarPagoTarjeta(String(original[0]));el('payEditAmount').value='99';fallar=true;
  const antesEditar=JSON.stringify(datos.pagosTarjetas);await pagos.guardarEditPago();
  assert.equal(JSON.stringify(datos.pagosTarjetas),antesEditar);assert.equal(el('payEditModal').classList.contains('active'),true);
  respuestaVacia=true;await pagos.guardarEditPago();
  assert.equal(JSON.stringify(datos.pagosTarjetas),antesEditar,'un PATCH sin fila confirmada no altera el historial');
  assert.equal(el('payEditModal').classList.contains('active'),true,'una respuesta vacía no se anuncia como edición correcta');
  assert.match(el('toast').textContent,/confirm|guardar|editar/i);
  pagos.cerrarEditPago();ui.cerrarCardDetail();

  // Corregir una nota de un pago histórico no sustituye su origen archivado.
  editado[6]='Archivada';servidor.get(String(editado[0])).cuenta_origen='Archivada';
  datos.cuentas.push(['Otra archivada','banco','PEN',true,'archivada-2']);
  ui.abrirCardDetail('MC demo');pagos.editarPagoTarjeta(String(editado[0]));
  assert.equal(el('payEditCuenta').value,'Archivada','el origen histórico sigue seleccionado');
  el('payEditNote').value='Nota del pago histórico';await pagos.guardarEditPago();
  assert.equal(pedidos.at(-1).body.cuenta_origen,'Archivada');assert.equal(editado[6],'Archivada');
  assert.equal(el('payEditModal').classList.contains('active'),false);
  pagos.editarPagoTarjeta(String(editado[0]));
  for(const origen of ['Otra archivada','BCP Dólares','IBKR']){
    el('payEditCuenta').value=origen;const antes=pedidos.length;await pagos.guardarEditPago();
    assert.equal(pedidos.length,antes,'un origen nuevo debe ser una cuenta activa en soles');
    assert.equal(editado[6],'Archivada');assert.equal(el('payEditModal').classList.contains('active'),true);
  }
  el('payEditCuenta').value='Plin';await pagos.guardarEditPago();
  assert.equal(editado[6],'Plin','sí se puede escoger explícitamente otro origen activo');
  assert.equal(pedidos.at(-1).body.cuenta_origen,'Plin');

  // Un pago legado sin origen no empieza a descontar una cuenta al editar la nota.
  editado[6]=null;servidor.get(String(editado[0])).cuenta_origen=null;
  pagos.editarPagoTarjeta(String(editado[0]));assert.equal(el('payEditCuenta').value,'');
  assert.match(el('payEditCuenta').innerHTML,/Sin cuenta registrada/);
  el('payEditNote').value='Nota del pago sin origen';await pagos.guardarEditPago();
  assert.equal(pedidos.at(-1).body.cuenta_origen,null,'la edición conserva el origen no registrado');
  assert.equal(editado[6],null);assert.equal(el('payEditModal').classList.contains('active'),false);

  // Durante un PATCH no se puede cerrar, abrir otro pago ni eliminar el actual.
  const otro=['pago-otro','MC demo',editado[2],5,'2026-10-03','Otro pago','Plin'];datos.pagosTarjetas.push(otro);
  pagos.editarPagoTarjeta(String(editado[0]));el('payEditNote').value='Cambio pendiente';
  let liberarEdicion;retener=new Promise(r=>{liberarEdicion=r;});const pedidosAntes=pedidos.length;
  const editando=pagos.guardarEditPago();await esperar(()=>pedidos.length===pedidosAntes+1);
  assert.equal(el('payEditModal').getAttribute('aria-busy'),'true');
  pagos.cerrarEditPago();assert.equal(el('payEditModal').classList.contains('active'),true);
  pagos.editarPagoTarjeta('pago-otro');assert.equal(el('payEditNote').value,'Cambio pendiente','otro pago no reemplaza el editor activo');
  let confirmaciones=0;globalThis.confirm=()=>{confirmaciones++;return true;};await pagos.confirmarEliminarPago();globalThis.confirm=()=>true;
  assert.equal(confirmaciones,0,'eliminar se bloquea antes de pedir confirmación');
  await pagos.guardarEditPago();assert.equal(pedidos.length,pedidosAntes+1,'no se dispara otro PATCH');
  liberarEdicion();await editando;retener=null;
  assert.equal(editado[5],'Cambio pendiente');assert.equal(otro[5],'Otro pago');
  assert.equal(el('payEditModal').classList.contains('active'),false);assert.equal(el('payEditModal').getAttribute('aria-busy'),'false');
  datos.pagosTarjetas=datos.pagosTarjetas.filter(p=>p!==otro);ui.cerrarCardDetail();

  // USD mantiene campos y preview; PEN y USD siguen siendo importes distintos.
  pagos.abrirPagoTarjeta();pagos.seleccionarTarjetaPago('Visa demo');
  assert.match(el('cardPaymentContent').innerHTML,/cardUsdMonto/);
  el('cardUsdMonto').value='10';el('cardUsdCuenta').value='Plin';el('cardUsdSoles').value='38';el('cardUsdFecha').value='2026-10-03';
  pagos.actualizarPagoUSD();
  assert.equal(el('cardUsdSolesRow').hidden,false);assert.match(el('cardUsdPreview').textContent,/38\.00/);
  el('cardUsdCuenta').value='BCP Dólares';pagos.actualizarPagoUSD();
  assert.equal(el('cardUsdSolesRow').hidden,true);assert.match(el('cardUsdPreview').textContent,/compras de dólares/);
  pagos.cerrarPagoTarjeta();assert.equal(el('cardPaymentModal').classList.contains('active'),false);
  pagina='p-dash';nav.handleFab();assert.equal(el('modal').classList.contains('active'),true,'Inicio conserva Nueva transacción');
  assert.equal(el('cardPaymentModal').classList.contains('active'),false);
  console.log('PASS: FAB contextual, selector/ciclo propio, pago PEN y edición con origen, validación, error/reintento, doble clic y preview USD.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.Date=RealDate;globalThis.setTimeout=realTimeout;});
