// El saldo aplicado en una tarjeta no es otra salida de efectivo. Se prueba
// el render real de Acumulado y los saldos bancarios con datos ficticios.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date,ahora=RealDate.parse('2026-10-03T12:00:00-05:00');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[ahora]));}static now(){return ahora;}};
entornoPrueba();
const nodos=new Map();
function nodo(id){return{id,style:{},dataset:{},hidden:false,textContent:'',innerHTML:'',value:'',attrs:{},
  classList:{add(){},remove(){},toggle(){},contains:()=>false},querySelector:()=>null,querySelectorAll:()=>[],
  setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;},addEventListener(){}};}
document.querySelector=()=>null;document.querySelectorAll=()=>[];
document.getElementById=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
globalThis.window=globalThis;window.scrollTo=()=>{};
globalThis.matchMedia=()=>({matches:true}); // importes sin esperar animaciones
globalThis.fetch=async()=>{throw new Error('La prueba no debe consultar servicios reales.');};

(async()=>{
  const {datos}=await modulo('state.js'),dashboard=await modulo('modules/dashboard.js');
  const cards=await modulo('modules/cards/cards.js'),payments=await modulo('modules/cards/payments.js');
  const currencies=await modulo('modules/currencies.js'),{serializarCreditoUSD}=await modulo('modules/cards/usd-credit.js');
  const card={cuenta:'Visa demo',nombre:'Visa demo',finDia:24,pagoDia:15};
  datos.cuentas=[['Plin','billetera','PEN',false,'c1'],['BCP Dólares','banco','USD',false,'c2']];
  datos.configTarjetas=[[card.cuenta,5000,30,card.nombre,'💳',24,15]];
  datos.ciclosOverride=[];datos.cargados=true;
  const ingreso=['2026-09-01','Ingreso demo','Salario','Ingreso',1000,'Plin','ingreso'];
  const gasto=(id,fecha,pen,usd=null)=>[fecha,id,'Compras','Gasto',pen,card.cuenta,id,null,null,usd===null?'PEN':'USD',usd,usd===null?null:pen/usd];
  const refund=(id,fecha,pen,origen,usd=null)=>[fecha,id,'Compras','Reembolso',pen,card.cuenta,id,null,origen,usd===null?'PEN':'USD',usd,usd===null?null:pen/usd];
  const credito=(origen='Plin')=>['pago',card.cuenta,'2026-09-24',12,'2026-09-15',serializarCreditoUSD({tipo:'pago',reconocido:35,credito:2,costoCredito:7}),origen,'USD',42,3.5,42];
  function saldoEsperado(saldo,mensaje){
    dashboard.renderBal();
    assert.equal(Number(document.getElementById('balAmt').dataset.value),Math.abs(saldo),mensaje);
    assert.equal(document.getElementById('balDot').textContent,saldo<0?'−':'+');
    assert.equal(document.getElementById('balLbl').textContent,'Efectivo hasta hoy');
  }

  // PEN: S/120 pagados sobre S/100 dejan S/20. Consumir esos S/20 en
  // el ciclo siguiente cambia la tarjeta, sin volver a restarlos de Plin.
  datos.transacciones=[ingreso,gasto('pen1','2026-09-10',100)];
  datos.pagosTarjetas=[['pago',card.cuenta,'2026-09-24',120,'2026-09-15',null,'Plin','PEN']];
  dashboard.setModoBalance('acumulado');
  saldoEsperado(880,'el excedente PEN ya salió una vez del banco');
  assert.equal(cards.getCardData(card).saldoFavor,20);
  datos.transacciones.push(gasto('pen2','2026-09-28',30));
  saldoEsperado(880,'aplicar PEN a consumos siguientes no vuelve a sacar efectivo');
  assert.equal(cards.getCardData(card).pagado,20);
  assert.equal(cards.getCardData(card).creditoAplicado,20);
  assert.equal(cards.getCardData(card).pendiente,10);
  assert.equal(currencies.getCuentaBalanceMoneda('Plin').saldo,880);
  assert.equal(datos.pagosTarjetas.length,1,'no se crean pagos bancarios ficticios');

  // USD legacy: una devolución de una compra ya pagada crea crédito;
  // usarlo a otro tipo de cambio reconoce su costo histórico en Acumulado.
  datos.transacciones=[ingreso,gasto('usd1','2026-09-10',35,10)];
  datos.pagosTarjetas=[['pago',card.cuenta,'2026-09-24',10,'2026-09-15',null,'Plin','USD',35,3.5,35]];
  saldoEsperado(965,'pago USD anterior desde PEN conserva el costo real');
  datos.transacciones.push(refund('r1','2026-09-20',3.5,'usd1',1));
  saldoEsperado(965,'una devolución a la tarjeta no deposita dinero en Plin');
  assert.equal(cards.deudaTarjetaUSD(card).saldoFavor,1);
  datos.transacciones.push(gasto('usd2','2026-09-28',3.7,1));
  assert.equal(cards.tarjetaConCreditoUSD(card),false,'se cubre también un pago sin nota versionada');
  assert.deepEqual(cards.modeloCreditoTarjetaUSD(card).cambios.map(x=>x.monto),[0.2]);
  saldoEsperado(965,'el crédito USD legacy mantiene el costo histórico al consumirse');
  assert.equal(cards.getCardData(card).creditoAplicadoUSD,1);
  assert.equal(currencies.getCuentaBalanceMoneda('Plin').saldo,965);

  // Tras consumir crédito legacy, el recibo del pago siguiente usa el
  // equivalente de la deuda que aún queda y no el agregado anterior.
  datos.transacciones[3][4]=7.4;datos.transacciones[3][10]=2;
  assert.equal(cards.deudaTarjetaUSD(card).usd,1);
  assert.equal(cards.deudaTarjetaUSD(card).pen,3.7);
  assert.ok(cards.modeloCreditoTarjetaUSD(card).credito.length>0,'se conserva la historia del crédito ya consumido');
  const siguientePago=payments.costoPagoUSD(card,1,'Plin','3.90','2026-10-03');
  assert.equal(siguientePago.ok,true);assert.equal(siguientePago.eq,3.7);assert.equal(siguientePago.dif,0.2);
  saldoEsperado(965,'un consumo mayor cubierto parcialmente por crédito no cambia aún el efectivo');

  // Sobrepago USD desde una cuenta PEN: el costo del crédito sigue fuera
  // del banco tanto antes como después de aplicarlo a una nueva compra.
  datos.transacciones=[ingreso,gasto('usd1','2026-09-10',35,10)];datos.pagosTarjetas=[credito()];
  saldoEsperado(958,'US$12 costaron S/42 y el crédito USD no es efectivo bancario');
  assert.equal(cards.getCardData(card).saldoFavorUSD,2);
  assert.equal(cards.favorTarjetaEnSoles(card),7);
  datos.transacciones.push(gasto('usd2','2026-09-28',3.9,1));
  saldoEsperado(958,'usar la mitad del crédito USD no cambia el efectivo restante');
  assert.equal(cards.getCardData(card).saldoFavorUSD,1);
  assert.equal(cards.getCardData(card).creditoAplicadoUSD,1);
  assert.equal(currencies.getCuentaBalanceMoneda('Plin').saldo,958);
  assert.equal(payments.pagoSalidaSoles(datos.pagosTarjetas[0]),42);

  // Dólares propios: S/70 ya salieron de Plin al comprar US$20. Pagar
  // US$12 desde BCP Dólares deja US$8 y no causa otra salida de soles.
  const compraUSD=['2026-09-05','Compra USD','Cambio','Transferencia',70,'Plin','compra-usd','BCP Dólares',null,'PEN',null,null,null,'USD',20];
  datos.transacciones=[ingreso,compraUSD,gasto('usd1','2026-09-10',35,10)];datos.pagosTarjetas=[credito('BCP Dólares')];
  saldoEsperado(930,'pagar con dólares propios no vuelve a descontar soles');
  assert.equal(currencies.getCuentaBalanceMoneda('BCP Dólares').saldo,8);
  datos.transacciones.push(gasto('usd2','2026-09-28',3.9,1));
  saldoEsperado(930,'consumir crédito adquirido con BCP Dólares no toca Plin ni BCP');
  assert.equal(currencies.getCuentaBalanceMoneda('Plin').saldo,930);
  assert.equal(currencies.getCuentaBalanceMoneda('BCP Dólares').saldo,8);
  assert.equal(datos.pagosTarjetas.length,1);

  // El crédito de un pago legacy desde dólares propios se valora con su
  // costo original, incluso cuando ya se usó una parte en otro ciclo.
  datos.pagosTarjetas[0][5]=null;
  datos.pagosTarjetas[0][10]=35; // equivalente cubierto sin recibo versionado
  saldoEsperado(930,'el sobrepago USD legacy tampoco descuenta otra vez soles');
  assert.equal(cards.deudaTarjetaUSD(card).saldoFavor,1);
  assert.equal(cards.favorTarjetaEnSoles(card),3.5);
  assert.equal(currencies.getCuentaBalanceMoneda('BCP Dólares').saldo,8);
  datos.transacciones.pop();
  saldoEsperado(930,'el crédito legacy completo sigue fuera del perímetro bancario en soles');
  assert.equal(cards.favorTarjetaEnSoles(card),7);
  console.log('PASS: Acumulado real conserva el efectivo con arrastre PEN, crédito USD legacy/refund, sobrepago USD desde PEN y pago desde BCP Dólares.');
})().catch(e=>{console.error(e);process.exitCode=1;});
