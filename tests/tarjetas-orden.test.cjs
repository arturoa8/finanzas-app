// Orden de las tarjetas: preferencia local que gobierna CREDIT_CARDS.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
const almacen=entornoPrueba();
globalThis.fetch=()=>assert.fail('Ordenar tarjetas no necesita red');

(async()=>{
  const [{datos},orden,{CREDIT_CARDS}]=await Promise.all([modulo('state.js'),modulo('modules/cards/orden.js'),modulo('modules/cards/config.js')]);
  datos.configTarjetas=[['Visa iO',1000,null,'Visa iO','💳',24,12],['Mastercard Platinum',2000,null,'Mastercard Platinum','💳',9,5],['Amex Gold',500,null,'Amex Gold','💳',1,20]];
  const nombres=()=>CREDIT_CARDS.map(c=>c.cuenta);
  const natural=nombres();
  assert.equal(natural.length,3);

  orden.guardarOrdenTarjetas([natural[2],natural[0]]);
  assert.deepEqual(nombres(),[natural[2],natural[0],natural[1]],'las que no están en la lista van al final, en su orden natural');
  orden.guardarOrdenTarjetas(['visa io','  VISA iO ','Fantasma','',null,5]);
  assert.deepEqual(orden.getOrdenTarjetas(),['visa io','fantasma','5'],'se normaliza, sin duplicados ni vacíos');
  assert.equal(nombres()[0],'Visa iO','una entrada de una tarjeta que ya no existe no rompe el orden');

  orden.guardarOrdenTarjetas(['Amex Gold','Visa iO','Mastercard Platinum']);
  orden.renombrarEnOrden('Visa iO','Visa Infinite');
  assert.deepEqual(orden.getOrdenTarjetas(),['amex gold','visa infinite','mastercard platinum'],'renombrar conserva la posición');
  orden.quitarDeOrden('Amex Gold');assert.deepEqual(orden.getOrdenTarjetas(),['visa infinite','mastercard platinum']);

  almacen.set(orden.CARDS_ORDER_KEY,'{json roto');assert.deepEqual(orden.getOrdenTarjetas(),[],'JSON inválido vuelve al orden natural');
  almacen.set(orden.CARDS_ORDER_KEY,JSON.stringify({a:1}));assert.deepEqual(orden.getOrdenTarjetas(),[]);
  orden.guardarOrdenTarjetas([]);assert.equal(almacen.has(orden.CARDS_ORDER_KEY),false,'orden vacío borra la preferencia');

  const real=localStorage.setItem;localStorage.setItem=()=>{throw Error('sin almacenamiento');};
  const r=orden.guardarOrdenTarjetas(['Amex Gold']);
  assert.equal(r.guardado,false);assert.equal(nombres()[0],'Amex Gold','sin almacenamiento el orden vale durante la sesión');
  localStorage.setItem=real;orden.guardarOrdenTarjetas([]);assert.deepEqual(nombres(),natural);
  console.log('PASS: orden de tarjetas: persistencia, normalización, renombrado, baja y fallo de almacenamiento.');
})().catch(e=>{console.error(e);process.exitCode=1;});
