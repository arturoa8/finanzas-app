// Un pago excedente se arrastra hacia ciclos siguientes, en su propia
// moneda. Aplicarlo no crea otro pago guardado ni otra salida del banco.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date;
globalThis.Date=class extends RealDate{
  constructor(...a){super(...(a.length?a:['2026-10-03T12:00:00-05:00']));}
  static now(){return new RealDate('2026-10-03T12:00:00-05:00').getTime();}
};
entornoPrueba();
(async()=>{
  const {datos}=await modulo('state.js'),cards=await modulo('modules/cards/cards.js');
  const {getCuentaBalanceMoneda}=await modulo('modules/currencies.js');
  const {serializarCreditoUSD}=await modulo('modules/cards/usd-credit.js');
  const card={cuenta:'Visa demo',finDia:24,inicioDia:25,pagoDia:15};
  const tx=(date,amount,id,type='Gasto',origin=null,usd=null)=>[date,id,'Compras',type,amount,card.cuenta,id,null,origin,usd===null?null:'USD',usd,usd===null?null:amount/usd];
  const pago=(date,key,amount,id)=>[id,card.cuenta,key,amount,date,'','Plin','PEN'];
  datos.cuentas=[['Plin','billetera','PEN',false,'c1'],['BCP Dólares','banco','USD',false,'c2']];
  datos.configTarjetas=[['Visa demo',5000,30,'Visa demo','💳',24,15]];
  datos.ciclosOverride=[];

  // Orden de carga inverso y dos ciclos vacíos: el saldo tiene que conservarse
  // en el ciclo seleccionado aunque ya existan consumos posteriores cargados.
  datos.transacciones=[tx('2026-12-01',40,'dec'),tx('2026-11-01',10,'nov'),tx('2026-09-10',60,'sep')];
  datos.pagosTarjetas=[pago('2026-09-15','2026-09-24',85,'p1')];
  const filasAntes=JSON.stringify(datos.pagosTarjetas);
  let d=cards.getCardData(card,-1);
  assert.equal(d.pendiente,0);assert.equal(d.pagado,60);assert.equal(d.saldoFavor,25);
  assert.equal(d.saldoFavorTotal,0,'el saldo histórico no se confunde con el restante global');
  d=cards.getCardData(card,0);
  assert.equal(d.total,0);assert.equal(d.saldoFavor,25);assert.equal(d.status.text,'A favor');
  d=cards.getCardData(card,1);
  assert.equal(d.pagadoDirectoPEN,0);assert.equal(d.creditoAplicado,10);assert.equal(d.pagado,10);
  assert.equal(d.pendiente,0);assert.equal(d.saldoFavor,15);assert.equal(d.pagos.length,0);
  d=cards.getCardData(card,2);
  assert.equal(d.creditoAplicado,15);assert.equal(d.pagado,15);assert.equal(d.pendiente,25);
  assert.equal(d.saldoFavor,0);assert.equal(cards.getCardOutstandingTotal(card),25);
  assert.equal(JSON.stringify(datos.pagosTarjetas),filasAntes,'no se crean pagos virtuales en los datos');
  assert.equal(getCuentaBalanceMoneda('Plin').saldo,-85,'el arrastre no vuelve a descontar el banco');

  // Sin consumos posteriores el crédito sigue disponible y sí descuenta
  // Acumulado como dinero entregado a la tarjeta, una sola vez.
  datos.transacciones=[tx('2026-09-10',60,'sep')];
  assert.equal(cards.getCardData(card,0).saldoFavor,25);
  assert.equal(cards.getCardData(card,1).saldoFavor,25);
  assert.equal(cards.favorTarjetaEnSoles(card),25);
  assert.equal(cards.getCardOutstandingTotal(card),0);
  const efectoAcumulado=-60+cards.getCardOutstandingTotal(card)-cards.favorTarjetaEnSoles(card);
  assert.equal(efectoAcumulado,getCuentaBalanceMoneda('Plin').saldo,'se reconoce el pago real de S/85, no S/110');

  // El excedente de un ciclo futuro no puede pagar deudas de ciclos pasados.
  datos.transacciones=[tx('2026-08-10',60,'old'),tx('2026-09-10',10,'sep'),tx('2026-10-01',50,'oct')];
  datos.pagosTarjetas=[pago('2026-09-15','2026-09-24',80,'p2')];
  d=cards.getCardData(card,-2);
  assert.equal(d.pendiente,60);assert.equal(d.creditoAplicado,0);assert.equal(d.saldoFavor,0);
  d=cards.getCardData(card,0);
  assert.equal(d.pagado,50);assert.equal(d.creditoAplicado,50);assert.equal(d.saldoFavor,20);
  assert.equal(cards.getCardOutstandingTotal(card),60);
  assert.equal(cards.favorTarjetaEnSoles(card),20);

  // Pagos nuevos y arrastre se suman solo hasta cubrir el consumo neto.
  datos.transacciones=[tx('2026-09-10',60,'sep'),tx('2026-10-01',100,'oct')];
  datos.pagosTarjetas=[pago('2026-09-15','2026-09-24',85,'p3'),pago('2026-10-02','2026-10-24',20,'p4')];
  d=cards.getCardData(card,0);
  assert.equal(d.pagadoDirectoPEN,20);assert.equal(d.creditoAplicado,25);assert.equal(d.pagado,45);
  assert.equal(d.pendiente,55);assert.equal(getCuentaBalanceMoneda('Plin').saldo,-105);
  // Editar/eliminar el pago original recalcula todo el arrastre sin guardar otro.
  datos.pagosTarjetas[0][3]=70;
  assert.equal(cards.getCardData(card,0).creditoAplicado,10);
  datos.pagosTarjetas.shift();
  assert.equal(cards.getCardData(card,0).creditoAplicado,0);

  // Una devolución de una compra pagada también crea saldo PEN disponible.
  datos.transacciones=[tx('2026-09-10',100,'sep'),tx('2026-09-20',30,'refund','Reembolso','sep'),tx('2026-10-01',20,'oct')];
  datos.pagosTarjetas=[pago('2026-09-15','2026-09-24',100,'p5')];
  d=cards.getCardData(card,0);
  assert.equal(d.pagado,20);assert.equal(d.creditoAplicado,20);assert.equal(d.saldoFavor,10);
  assert.equal(getCuentaBalanceMoneda('Plin').saldo,-100,'devolver en tarjeta no inventa efectivo en banco');

  // Los céntimos no dejan residuos al consumir el excedente por completo.
  datos.transacciones=[tx('2026-09-10',0.10,'sep'),tx('2026-10-01',0.20,'oct')];
  datos.pagosTarjetas=[pago('2026-09-15','2026-09-24',0.30,'p6')];
  d=cards.getCardData(card,0);
  assert.equal(d.pagado,0.20);assert.equal(d.creditoAplicado,0.20);assert.equal(d.pendiente,0);assert.equal(d.saldoFavor,0);

  // Aun con pagos antiguos sin metadata, PEN no cubre USD ni los convierte.
  datos.transacciones=[tx('2026-09-10',50,'pen'),tx('2026-09-11',37,'usd','Gasto',null,10),tx('2026-10-01',10,'next-pen')];
  datos.pagosTarjetas=[pago('2026-09-15','2026-09-24',70,'p7')];
  d=cards.getCardData(card,-1);
  assert.equal(d.pendiente,37);assert.equal(d.saldoFavor,20);assert.equal(cards.deudaTarjetaUSD(card).usd,10);
  d=cards.getCardData(card,0);
  assert.equal(d.pagado,10);assert.equal(d.creditoAplicado,10);assert.equal(d.saldoFavor,10);
  assert.equal(cards.getCardOutstandingTotal(card),37);
  assert.deepEqual(cards.deudaCicloPorMoneda(-1),{soles:0,usd:10});

  // Excedente USD legacy: se aplica a USD del siguiente ciclo, conserva su
  // valoración y no cubre consumos PEN. El ciclo vacío muestra el favor.
  datos.transacciones=[tx('2026-09-10',18.5,'usd-old','Gasto',null,5),tx('2026-11-01',3.6,'usd-next','Gasto',null,1),tx('2026-11-02',10,'pen-next')];
  datos.pagosTarjetas=[['legacy',card.cuenta,'2026-09-24',6,'2026-09-15','','BCP Dólares','USD',21.6,3.6,18.5]];
  assert.equal(cards.tarjetaConCreditoUSD(card),false,'se preserva la identificación de los recibos nuevos');
  d=cards.getCardData(card,0);
  assert.equal(d.total,0);assert.equal(d.saldoFavor,0);assert.equal(d.saldoFavorUSD,1);assert.equal(d.status.text,'A favor');
  d=cards.getCardData(card,1);
  assert.equal(d.creditoAplicadoUSD,1);assert.equal(d.saldoFavorUSD,0);assert.equal(d.pendiente,10);
  assert.equal(d.pagado,3.6);assert.equal(cards.deudaTarjetaUSD(card).usd,0);
  assert.deepEqual(cards.modeloCreditoTarjetaUSD(card).porPago.get('legacy'),{creditoUSD:1,costoCreditoPEN:3.6},
    'el excedente legacy conserva su costo original aun después de consumirse');
  assert.equal(getCuentaBalanceMoneda('BCP Dólares').saldo,-6,'solo salió el pago USD real');
  datos.transacciones.pop();datos.transacciones.pop();
  assert.equal(cards.favorTarjetaEnSoles(card),3.6,'USD a favor conserva el costo del pago');
  // Los pagos legacy que usaron el promedio conservan exactamente el total
  // reconocido, aunque los lotes procedan de ciclos con diferente TC.
  datos.transacciones=[tx('2026-09-10',340,'usd-a','Gasto',null,100),tx('2026-09-26',175,'usd-b','Gasto',null,50)];
  datos.pagosTarjetas=[['avg',card.cuenta,'2026-09-24',60,'2026-09-27','','Plin','USD',210,3.5,206]];
  assert.equal(cards.deudaTarjetaUSD(card).usd,90);assert.equal(cards.deudaTarjetaUSD(card).pen,309);
  assert.equal(cards.getCardOutstandingTotal(card),309);assert.equal(cards.getCardData(card).saldoFavor,0);

  // USD nuevo usa el mismo arrastre, con sus ajustes históricos existentes.
  datos.transacciones=[tx('2026-09-10',18.43,'g1','Gasto',null,5.42),tx('2026-11-01',1.08,'g2','Gasto',null,0.30)];
  datos.pagosTarjetas=[['receipt',card.cuenta,'2026-09-24',6,'2026-09-15',serializarCreditoUSD({tipo:'pago',reconocido:18.43,credito:0.58,costoCredito:2.03}),'Plin','USD',21,3.5,20.46]];
  d=cards.getCardData(card,0);
  assert.equal(d.saldoFavorUSD,0.58);assert.equal(d.costoFavorUSD,2.03);
  d=cards.getCardData(card,1);
  assert.equal(d.creditoAplicadoUSD,0.30);assert.equal(d.saldoFavorUSD,0.28);assert.equal(d.pagado,1.08);assert.equal(d.pendiente,0);
  assert.equal(d.costoFavorUSD,0.98);
  assert.deepEqual(cards.modeloCreditoTarjetaUSD(card).porPago.get('receipt'),{creditoUSD:0.58,costoCreditoPEN:2.03},
    'el recibo versionado conserva su costo original sin reescribir la valoración');
  assert.equal(cards.getCardData(card,-1).saldoFavorUSD,0.58,'el consumo siguiente no reescribe el favor del ciclo anterior');

  // Acumulado por fecha excluye pagos y compras posteriores al corte.
  const corte=new Date('2026-09-14T23:59:59-05:00');
  assert.equal(cards.getCardOutstandingTotal(card,corte),18.43);assert.equal(cards.favorTarjetaEnSoles(card,corte),0);

  // La fecha bancaria y el ciclo elegido pueden ser distintos. Una
  // conversión histórica mantiene su pago origen aunque esté en otro ciclo:
  // no debe lanzar un error ni inventar crédito por filtrar la dependencia.
  datos.transacciones=[];
  datos.pagosTarjetas=[
    ['origin',card.cuenta,'2026-10-24',1,'2026-09-15',serializarCreditoUSD({tipo:'pago',reconocido:0,credito:1,costoCredito:3.5}),'Plin','USD',3.5,3.5,3.5],
    ['conversion',card.cuenta,'2026-09-24',3.6,'2026-09-20',serializarCreditoUSD({tipo:'conversion',usd:1,tc:3.6,costo:3.5,origenes:['origin']}),null,'PEN'],
  ];
  d=cards.getCardData(card,-1);
  assert.equal(d.saldoFavorUSD,0);assert.equal(d.saldoFavor,3.6);
  assert.equal(cards.getCardData(card,0).saldoFavorUSD,0);
  assert.equal(cards.favorTarjetaEnSoles(card),3.6);
  assert.equal(getCuentaBalanceMoneda('Plin').saldo,-3.5,'la conversión mantiene una única salida bancaria');
  datos.pagosTarjetas[1]=['conversion-anterior',card.cuenta,'2026-11-24',1.44,'2026-09-18',serializarCreditoUSD({tipo:'conversion',usd:0.40,tc:3.6,costo:1.40,origenes:['origin']}),null,'PEN'];
  datos.pagosTarjetas.push(['conversion-resto',card.cuenta,'2026-09-24',2.16,'2026-09-20',serializarCreditoUSD({tipo:'conversion',usd:0.60,tc:3.6,costo:2.10,origenes:['origin']}),null,'PEN']);
  d=cards.getCardData(card,-1);
  assert.equal(d.saldoFavorUSD,0,'una conversión anterior asignada al futuro también consumió crédito USD');
  assert.equal(d.saldoFavor,2.16);assert.equal(cards.favorTarjetaEnSoles(card),3.6);
  console.log('PASS: excedentes por ciclo, ciclos vacíos, pago aplicado, historial real, edición, céntimos, banco y separación PEN/USD legacy/nueva.');
})().catch(e=>{console.error(e);process.exitCode=1;});
