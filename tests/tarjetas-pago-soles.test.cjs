// Pagar el saldo en soles no toca la parte en dólares del ciclo: esa se paga
// en dólares. Antes, "Pagar saldo completo" registraba todo en soles y la
// tarjeta quedaba "Pagado" mientras seguía "debes US$…". También cubre lo que
// la línea total usada muestra como "Incluye" (dólares y ciclos anteriores).
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-10-02T12:00:00-05:00']));}static now(){return new RealDate('2026-10-02T12:00:00-05:00').getTime();}};
entornoPrueba();
(async()=>{
  const {serializarCreditoUSD}=await modulo('modules/cards/usd-credit.js');
  const {datos}=await modulo('state.js'),cards=await modulo('modules/cards/cards.js'),p=await modulo('modules/cards/payments.js');
  const visa={cuenta:'Visa demo',finDia:24,inicioDia:25,pagoDia:15};
  const mc={cuenta:'MC demo',finDia:24,inicioDia:25,pagoDia:15};
  datos.cuentas=[['Plin','billetera','PEN',false,'c1'],['BCP Dólares','banco','USD',false,'c2']];
  datos.configTarjetas=[['Visa demo',5000,30,'Visa demo','💳',24,15],['MC demo',5000,30,'MC demo','💳',24,15]];
  datos.ciclosOverride=[];datos.pagosTarjetas=[];

  // Tarjeta sin pagos en dólares todavía (modelo anterior).
  datos.transacciones=[
    ['2026-09-10','Ciclo pasado','Compras','Gasto',20,visa.cuenta,'v0'],
    ['2026-09-28','Compra PEN','Compras','Gasto',100,visa.cuenta,'v1'],
    ['2026-09-29','Compra USD','Compras','Gasto',37,visa.cuenta,'v2',null,null,'USD',10,3.7,'mercado'],
  ];
  let data=cards.getCardData(visa,0);
  assert.equal(data.pendiente,137);
  assert.equal(cards.pendienteUSDEnSoles(visa,data),37,'US$10 cuentan como S/37 al TC de la compra');
  assert.equal(cards.pendienteEnSoles(visa,data),100,'en soles se paga solo lo consumido en soles');
  assert.match(p.renderPaymentForm(visa,data),/Pagar saldo en soles \(S\/ 100\.00\)/);
  assert.equal(cards.pendienteCiclosAnteriores(visa),20,'lo del ciclo cerrado se informa aparte');
  assert.deepEqual(cards.deudaUSDTodas(),{usd:10,pen:37});
  assert.equal(cards.getCardOutstandingTotal(visa),157,'la línea usada ya incluye dólares y ciclo anterior');

  datos.pagosTarjetas=[['pp1',visa.cuenta,'2026-10-24',100,'2026-10-01',null,'Plin','PEN']];
  data=cards.getCardData(visa,0);
  assert.equal(data.pendiente,37,'queda solo la parte en dólares');
  assert.equal(cards.pendienteEnSoles(visa,data),0);
  assert.doesNotMatch(p.renderPaymentForm(visa,data),/Pagar saldo/,'sin saldo en soles no se ofrece pagarlo');
  assert.equal(cards.deudaTarjetaUSD(visa).usd,10,'la deuda en dólares sigue para pagarse en dólares');

  // Sin dólares, el botón conserva su nombre de siempre.
  datos.transacciones=datos.transacciones.filter(t=>t[9]!=='USD');datos.pagosTarjetas=[];
  data=cards.getCardData(visa,0);
  assert.match(p.renderPaymentForm(visa,data),/Pagar saldo completo \(S\/ 100\.00\)/);

  // Tarjeta que ya registró un pago en dólares con recibo (modelo de crédito USD).
  datos.transacciones=[
    ['2026-09-10','USD pagada','Compras','Gasto',18.5,mc.cuenta,'m1',null,null,'USD',5,3.7,'mercado'],
    ['2026-09-28','Compra PEN','Compras','Gasto',50,mc.cuenta,'m2'],
    ['2026-09-29','USD nueva','Compras','Gasto',74,mc.cuenta,'m3',null,null,'USD',20,3.7,'mercado'],
  ];
  datos.pagosTarjetas=[['q1',mc.cuenta,'2026-09-24',5,'2026-09-15',serializarCreditoUSD({tipo:'pago',reconocido:18.5,credito:0,costoCredito:0}),'Plin','USD',18.6,3.72,18.5,null,'manual']];
  assert.equal(cards.tarjetaConCreditoUSD(mc),true);
  data=cards.getCardData(mc,0);
  assert.equal(data.pendiente,124);
  assert.equal(cards.pendienteUSDEnSoles(mc,data),74);
  assert.equal(cards.pendienteEnSoles(mc,data),50);
  assert.equal(cards.pendienteCiclosAnteriores(mc),0,'el ciclo pasado quedó pagado en dólares');
  assert.equal(cards.deudaTarjetaUSD(mc).usd,20);
  console.log('PASS: pago en soles sin la parte en dólares, en ambos modelos, y lo que incluye la línea usada.');
})().catch(e=>{console.error(e);process.exitCode=1;});
