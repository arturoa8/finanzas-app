// La interfaz usa los saldos calculados con datos ficticios; no registra
// pagos ni se conecta con la base de datos para aplicar un excedente.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-10-03T12:00:00-05:00']));}};
entornoPrueba();
const nodos=new Map();
function el(id){
  if(!nodos.has(id)){
    const clases=new Set();
    nodos.set(id,{id,innerHTML:'',textContent:'',classList:{add:x=>clases.add(x),remove:x=>clases.delete(x),contains:x=>clases.has(x)}});
  }
  return nodos.get(id);
}
document.getElementById=el;
document.querySelector=()=>null;
globalThis.fetch=()=>{throw new Error('Esta prueba visual no puede conectarse con Supabase');};

(async()=>{
  const [{datos},ui,ciclos,{serializarCreditoUSD}]=await Promise.all([
    modulo('state.js'),modulo('modules/cards/cards-ui.js'),modulo('modules/cards/cycles.js'),modulo('modules/cards/usd-credit.js'),
  ]);
  const cuenta='Tarjeta demo';
  Object.assign(datos,{configTarjetas:[[cuenta,5000,30,cuenta,'💳',24,15]],cuentas:[],categorias:[],ciclosOverride:[],
    transacciones:[['2026-09-01','Compra anterior','Compras','Gasto',100,cuenta,'g1']],
    pagosTarjetas:[['p1',cuenta,'2026-09-24',120,'2026-09-10','Pago con excedente','Plin','PEN']],
    deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[]});

  // El ciclo sin consumos muestra el crédito como saldo principal.
  ui.renderCardsPage();ui.abrirCardDetail(cuenta);
  let detalle=el('cardDetailContent').innerHTML;
  assert.match(detalle,/Saldo a favor del ciclo/);
  assert.match(detalle,/card-detail-amount green[^>]*>\+S\/ 20\.00/);
  assert.doesNotMatch(detalle,/Pendiente del ciclo|0% pagado/);
  assert.match(el('cardsPage').innerHTML,/credit-amount green[^>]*>\+S\/ 20\.00/);

  // Un consumo usa el crédito y aparece como pagado sin otro movimiento.
  datos.transacciones.push(['2026-10-01','Compra siguiente','Compras','Gasto',8,cuenta,'g2']);
  const pagosAntes=JSON.stringify(datos.pagosTarjetas);
  ui.renderCardsPage();ui.renderCardDetail();detalle=el('cardDetailContent').innerHTML;
  assert.match(detalle,/card-detail-amount green[^>]*>\+S\/ 12\.00/);
  assert.match(detalle,/Pagado<\/div><div class="credit-mini-val green">S\/ 8\.00/);
  assert.match(detalle,/100% pagado/);
  assert.match(detalle,/Saldo a favor aplicado/);
  const credito=/class="pay-item pay-item-credit"[^>]*>([\s\S]*?)<\/article>/.exec(detalle)?.[1];
  assert.ok(credito,'el historial incluye la aplicación calculada del crédito');
  assert.doesNotMatch(credito,/editarPagoTarjeta|eliminarPagoTarjeta|pay-item-actions/);
  assert.equal(JSON.stringify(datos.pagosTarjetas),pagosAntes,'el crédito aplicado no crea un pago bancario ficticio');

  // Los consumos futuros no cambian el saldo histórico del ciclo visible.
  datos.transacciones.push(['2026-11-01','Compra posterior','Compras','Gasto',5,cuenta,'g3']);
  ui.renderCardDetail();
  assert.match(el('cardDetailContent').innerHTML,/card-detail-amount green[^>]*>\+S\/ 12\.00/);

  // La misma vista reconoce el favor en USD sin mostrarlo como PEN.
  datos.transacciones=[['2026-09-10','Compra USD','Compras','Gasto',18.43,cuenta,'u1',null,null,'USD',5.42,3.4,'mercado']];
  datos.pagosTarjetas=[['u2',cuenta,'2026-09-24',6,'2026-09-15',serializarCreditoUSD({tipo:'pago',reconocido:18.43,credito:0.58,costoCredito:2.03}),'BCP Dólares','USD',21,3.5,20.46,null,'manual']];
  ui.renderCardsPage();ui.renderCardDetail();detalle=el('cardDetailContent').innerHTML;
  assert.match(detalle,/Saldo a favor del ciclo/);
  assert.match(detalle,/card-detail-amount green[^>]*>\+US\$ 0\.58/);
  assert.doesNotMatch(detalle,/Saldo a favor en soles/);
  datos.transacciones.push(['2026-10-01','Compra cubierta USD','Compras','Gasto',1.08,cuenta,'u3',null,null,'USD',0.3,3.6,'mercado']);
  ui.renderCardDetail();detalle=el('cardDetailContent').innerHTML;
  assert.match(detalle,/card-detail-amount green[^>]*>\+US\$ 0\.28/);
  assert.match(detalle,/Saldo a favor aplicado/);
  assert.match(detalle,/US\$ 0\.30 de saldo a favor/);
  assert.match(detalle,/100% pagado/);
  assert.equal(datos.pagosTarjetas.length,1);
  console.log('PASS: el ciclo vacío muestra favor PEN/USD; los consumos aplican crédito como pagado, conservan los saldos por ciclo y no crean pagos ficticios.');
})().catch(e=>{console.error(e);process.exitCode=1;});
