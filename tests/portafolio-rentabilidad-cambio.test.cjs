const assert=require('node:assert/strict');
const test=require('node:test');
const {modulo}=require('./helpers/app-root.cjs');
const modelo=modulo('modules/portfolio/fx-performance.js');
const cuentas=[['Plin','billetera','PEN',false,'p'],['BCP Dólares','banco','USD',false,'b'],
  ['Interbank USD','banco','USD',false,'i'],['IBKR','inversion','USD',false,'ib']];
const row=(valor=980,fecha='2026-10-03')=>({valor_total:valor,moneda_base:'USD',fecha_valoracion:fecha});
let secuencia=0;
const transferencia=(origen,destino,pen,usd,fecha='2026-09-01',fuente='transferencia')=>({
  id:'t'+(++secuencia),fecha,tipo:'Transferencia',cuenta:origen,cuenta_destino:destino,monto:pen,
  moneda_original:origen==='Plin'?null:'USD',monto_original:origen==='Plin'?null:usd,
  moneda_destino:destino==='Plin'?'PEN':'USD',monto_destino:destino==='Plin'?pen:usd,
  tc:pen/usd,tc_fuente:fuente
});
const aporte=(pen=3300,usd=1000,fecha)=>transferencia('Plin','IBKR',pen,usd,fecha);
const compra=(pen,usd,fecha)=>transferencia('Plin','BCP Dólares',pen,usd,fecha);
async function calcular(transacciones,extra={}){
  return(await modelo).pfModeloRentabilidadCambio({row:row(),tcActual:3.8,transacciones,cuentas,...extra});
}
function identidad(m){
  assert.equal(m.atribucionOk,true);
  assert.equal(Math.round((m.resultadoInversionBrutaPEN+m.efectoCambioAportesPEN-m.costosPEN)*100)/100,m.resultadoTotalPEN);
  if(m.ok)assert.equal(Math.round((m.resultadoInversionPEN+m.efectoCambioPEN)*100)/100,m.resultadoTotalPEN);
}

test('pérdida USD compensada por la subida del dólar: atribución aditiva exacta',async()=>{
  const m=await calcular([aporte()]);
  assert.equal(m.ok,true);assert.equal(m.totalOk,true);identidad(m);
  assert.equal(m.capitalPEN,3300);assert.equal(m.resultadoInversionBrutaUSD,-20);
  assert.equal(m.resultadoInversionBrutaPEN,-76);assert.equal(m.efectoCambioAportesPEN,500);
  assert.equal(m.resultadoTotalPEN,424);assert.equal(m.pctTotal,424/3300*100);
  assert.equal(m.pctCambioAportesSobreCapital,500/3300*100);
  assert.equal(m.pctInversionBrutaSobreCapital,-76/3300*100);
});

test('múltiples aportes y retiro PEN conservan cada importe y fecha real',async()=>{
  const tx=[aporte(3300,1000,'2026-09-01'),aporte(1750,500,'2026-09-15'),
    transferencia('IBKR','Plin',740,200,'2026-09-20')];
  const m=await calcular(tx,{row:row(1280)});identidad(m);
  assert.equal(m.aportesUSD,1300);assert.equal(m.aportesPEN,4310);
  assert.equal(m.resultadoInversionBrutaPEN,-76);assert.equal(m.efectoCambioAportesPEN,630);
  assert.equal(m.resultadoTotalPEN,554);assert.equal(m.multiplesFechas,true);
});

test('aportes después de la fecha de valoración no alteran el cierre ni pendientes',async()=>{
  const futuro=aporte(3000,1000,'2026-10-04');futuro.monto_destino=null;
  const m=await calcular([aporte(),futuro]);assert.equal(m.ok,true);assert.equal(m.aportesPEN,3300);assert.equal(m.pendientes.length,0);
});

test('cuenta de inversión archivada conserva aportes y valores',async()=>{
  const archivadas=cuentas.map(c=>c[1]==='inversion'?[c[0],c[1],c[2],true,c[4]]:c);
  const m=await calcular([aporte()],{cuentas:archivadas});identidad(m);assert.equal(m.resultadoTotalPEN,424);
});

test('transferencia entre nombres de inversión distintos requiere conocer el perímetro del snapshot',async()=>{
  const m=await calcular([aporte(),transferencia('IBKR','IBKR antiguo',1700,500,'2026-09-05')],{
    cuentas:[...cuentas,['IBKR antiguo','inversion','USD',true,'otro']],row:row(500)});
  assert.equal(m.totalOk,false);assert.equal(m.aportesUSD,null);assert.equal(m.aportesPEN,null);
  assert.equal(m.resultadoInversionBrutaUSD,null,'el traslado a otra corredora no es una pérdida de inversión');
  assert.ok(m.pendientes.some(p=>p.codigo==='perimetro_inversion_ambiguo'));
  const perimetroConfirmado=await calcular([],{row:row(980),
    fl:{flujos:[{fecha:'2026-09-01',monto:1000,soles:3300}]}});
  assert.equal(perimetroConfirmado.aportesUSD,1000);identidad(perimetroConfirmado);
});

test('aporte USD toma costo de compra anterior y rechaza TC de mercado propuesto en el envío',async()=>{
  const envio=transferencia('BCP Dólares','IBKR',3800,1000,'2026-09-10','mercado');
  const m=await calcular([compra(3300,1000,'2026-09-01'),envio]);identidad(m);
  assert.equal(m.aportesPEN,3300,'la compra original costó 3300, no los 3800 propuestos al enviar');
  assert.equal(m.efectoCambioAportesPEN,500);
});

test('promedio histórico por cuenta incluye consumos, compras y excluye compras posteriores al aporte',async()=>{
  const consumo={id:'g',fecha:'2026-09-02',tipo:'Gasto',cuenta:'BCP Dólares',monto:660,moneda_original:'USD',monto_original:200};
  const m=await calcular([compra(3300,1000,'2026-09-01'),consumo,compra(1600,400,'2026-09-03'),
    transferencia('BCP Dólares','IBKR',2500,500,'2026-09-04','mercado'),compra(5000,1000,'2026-09-05')],{row:row(480)});
  assert.equal(m.aportesPEN,1766.67);assert.equal(m.resultadoTotalPEN,57.33);identidad(m);
});

test('los dólares trasladados entre bancos llevan su base PEN original',async()=>{
  const m=await calcular([compra(3300,1000,'2026-09-01'),
    transferencia('BCP Dólares','Interbank USD',9999,600,'2026-09-02','mercado'),
    transferencia('Interbank USD','IBKR',8888,600,'2026-09-03','mercado')],{row:row(580)});
  assert.equal(m.aportesPEN,1980);assert.equal(m.aportesUSD,600);identidad(m);
});

test('compra en otra cuenta USD no inventa procedencia para BCP',async()=>{
  const otra=transferencia('Plin','Interbank USD',3300,1000,'2026-09-01');
  const m=await calcular([otra,transferencia('BCP Dólares','IBKR',3300,1000,'2026-09-02','costo_promedio')]);
  assert.equal(m.totalOk,false);assert.equal(m.aportesPEN,null);assert.equal(m.efectoCambioAportesPEN,null);
  assert.ok(m.pendientes.some(p=>p.codigo==='base_pen_pendiente'));
});

test('USD sin compras/ingresos históricos no supone un tipo de cambio',async()=>{
  const m=await calcular([transferencia('BCP Dólares','IBKR',3300,1000,'2026-09-02','manual')]);
  assert.equal(m.totalOk,false);assert.equal(m.capitalPEN,null);assert.equal(m.resultadoTotalPEN,null);
  assert.equal(m.resultadoInversionBrutaUSD,-20,'la pérdida USD sí está cuantificada');
});

test('pago de tarjeta consume dólares antes de calcular la base de un aporte posterior',async()=>{
  const m=await calcular([compra(3300,1000,'2026-09-01'),compra(2000,500,'2026-09-03'),
    transferencia('BCP Dólares','IBKR',4000,1000,'2026-09-04','mercado')],{
    pagosTarjetas:[['pago','Visa','ciclo',500,'2026-09-02',null,'BCP Dólares','USD']],row:row(980)});
  assert.equal(m.aportesPEN,3650);identidad(m);
});

test('un pozo agotado no arrastra el costo de dólares ya gastados',async()=>{
  const gasto={id:'g',fecha:'2026-09-02',tipo:'Gasto',cuenta:'BCP Dólares',moneda_original:'USD',monto_original:1000,monto:3300};
  const m=await calcular([compra(3300,1000,'2026-09-01'),gasto,compra(4000,1000,'2026-09-03'),
    transferencia('BCP Dólares','IBKR',3333,1000,'2026-09-04','manual')]);
  assert.equal(m.aportesPEN,4000);assert.equal(m.efectoCambioAportesPEN,-200);identidad(m);
});

test('una salida previa sin saldo registrado no demuestra que los dólares desconocidos se agotaran',async()=>{
  const previo={id:'sin-historia',fecha:'2026-09-01',tipo:'Gasto',cuenta:'BCP Dólares',moneda_original:'USD',monto_original:100,monto:330};
  const m=await calcular([previo,compra(3300,1000,'2026-09-02'),
    transferencia('BCP Dólares','IBKR',3300,1000,'2026-09-03','costo_promedio')]);
  assert.equal(m.totalOk,false);assert.equal(m.aportesPEN,null);assert.equal(m.efectoCambioAportesPEN,null);
});

test('ingreso USD externo con importe PEN registrado constituye una valoración histórica',async()=>{
  const ingreso={id:'i',fecha:'2026-09-01',tipo:'Ingreso',cuenta:'BCP Dólares',moneda_original:'USD',monto_original:1000,monto:3400,tc:3.4,tc_fuente:'manual'};
  const m=await calcular([ingreso,transferencia('BCP Dólares','IBKR',3800,1000,'2026-09-02','mercado')]);
  assert.equal(m.aportesPEN,3400);assert.equal(m.efectoCambioAportesPEN,400);identidad(m);
});

test('costo PEN permite total exacto y tres componentes sin inventar su USD',async()=>{
  const costo={id:'c',fecha:'2026-09-01',tipo:'Gasto',cuenta:'Plin',monto:35,es_costo_inversion:true};
  const m=await calcular([aporte(),costo]);
  assert.equal(m.ok,false);assert.equal(m.atribucionOk,true);assert.equal(m.totalOk,true);identidad(m);
  assert.equal(m.costosUSD,null);assert.equal(m.costosPEN,35);assert.equal(m.capitalPEN,3335);
  assert.equal(m.resultadoTotalPEN,389);assert.equal(m.resultadoInversionBrutaPEN,-76);assert.equal(m.efectoCambioAportesPEN,500);
  assert.equal(m.resultadoInversionUSD,null);assert.equal(m.efectoCambioPEN,null);
});

test('costos USD llevan el costo de compra y las devoluciones de costos restan',async()=>{
  const costo={id:'c',fecha:'2026-09-02',tipo:'Gasto',cuenta:'BCP Dólares',monto:40,moneda_original:'USD',monto_original:10,es_costo_inversion:true};
  const devolucion={id:'d',fecha:'2026-09-02',tipo:'Ingreso',cuenta:'Plin',monto:3,es_costo_inversion:true};
  const m=await calcular([aporte(),compra(330,100,'2026-09-01'),costo,devolucion]);
  assert.equal(m.costosPEN,30,'USD10 costaron PEN33; la devolución PEN3 resta');
  assert.equal(m.resultadoTotalPEN,394);identidad(m);
  const soloUSD=await calcular([aporte(),compra(330,100,'2026-09-01'),costo]);
  assert.equal(soloUSD.costosUSD,10);assert.equal(soloUSD.resultadoInversionUSD,-30);
  assert.equal(soloUSD.costosPEN,33);assert.equal(soloUSD.resultadoTotalPEN,391);identidad(soloUSD);
});

test('retiro USD requiere valoración histórica explícita, nunca promedio externo',async()=>{
  const sinTC=await calcular([aporte(),transferencia('IBKR','BCP Dólares',350,100,'2026-09-20','costo_promedio')],{row:row(880)});
  assert.equal(sinTC.totalOk,false);assert.equal(sinTC.aportesPEN,null);
  const confirmado=await calcular([aporte(),transferencia('IBKR','BCP Dólares',370,100,'2026-09-20','manual')],{row:row(880)});
  assert.equal(confirmado.aportesPEN,2930);assert.equal(confirmado.aportesUSD,900);assert.equal(confirmado.resultadoTotalPEN,414);identidad(confirmado);
});

test('retiro USD a PEN sin soles recibidos confirmados no reutiliza la cotización propuesta',async()=>{
  const retiro=transferencia('IBKR','Plin',370,100,'2026-09-20','mercado');retiro.monto_destino=null;
  const m=await calcular([aporte(),retiro],{row:row(880)});
  assert.equal(m.totalOk,false);assert.equal(m.resultadoTotalPEN,null);assert.equal(m.aportesPEN,null);
  assert.ok(m.pendientes.some(p=>p.codigo==='base_pen_pendiente'));
});

test('aportaciones de dos inversiones independientes no se comparan con el valor de una sola cuenta IBKR',async()=>{
  const segunda=transferencia('Plin','Otra inversión',3500,1000,'2026-09-02');
  const m=await calcular([aporte(),segunda],{cuentas:[...cuentas,['Otra inversión','inversion','USD',true,'o']]});
  assert.equal(m.totalOk,false);assert.equal(m.aportesUSD,null);assert.equal(m.aportesPEN,null);
  assert.ok(m.pendientes.some(p=>p.codigo==='perimetro_inversion_ambiguo'));
  const sinMovimientos=await calcular([aporte()],{cuentas:[...cuentas,['Otra inversión','inversion','USD',true,'o']]});
  assert.equal(sinMovimientos.totalOk,true,'una cuenta sin flujos no crea un conflicto ficticio');
});

test('diferencias nominales en transferencia USD no se disfrazan como resultado cambiario',async()=>{
  const envio=transferencia('BCP Dólares','IBKR',3300,1000,'2026-09-02','manual');envio.monto_destino=990;
  const m=await calcular([compra(3300,1000,'2026-09-01'),envio],{row:row(980)});
  assert.equal(m.aportesUSD,990);assert.equal(m.efectoCambioAportesPEN,null);assert.equal(m.totalOk,false);
  assert.ok(m.pendientes.some(p=>p.codigo==='transferencia_usd_desigual'));
  const entreBancos=transferencia('BCP Dólares','Interbank USD',3300,1000,'2026-09-02');entreBancos.monto_destino=990;
  const viaBanco=await calcular([compra(3300,1000,'2026-09-01'),entreBancos,
    transferencia('Interbank USD','IBKR',3300,990,'2026-09-03')]);
  assert.equal(viaBanco.totalOk,false);assert.equal(viaBanco.aportesPEN,null);
});

test('costos dentro de la inversión ya reflejados en el valor no se descuentan dos veces',async()=>{
  const fee={id:'fee',fecha:'2026-09-02',tipo:'Gasto',cuenta:'IBKR',monto:33,moneda_original:'USD',monto_original:10,tc:3.3,es_costo_inversion:true};
  const m=await calcular([aporte(),fee],{row:row(990)});
  assert.equal(m.costosPEN,0);assert.equal(m.costosUSD,0);assert.equal(m.resultadoInversionBrutaUSD,-10);
  assert.equal(m.resultadoTotalPEN,462);identidad(m);
});

test('aporte no conciliado y números inválidos bloquean las ganancias',async()=>{
  for(const importe of [null,'',NaN,Infinity,-1,0]){
    const t=aporte();t.monto_destino=importe;
    const m=await calcular([t]);assert.equal(m.totalOk,false);assert.equal(m.resultadoTotalPEN,null);
  }
  const sinPen=aporte();sinPen.monto=NaN;assert.equal((await calcular([sinPen])).totalOk,false);
  const sinFecha=aporte();sinFecha.fecha='2026-02-30';assert.equal((await calcular([sinFecha])).totalOk,false);
});

test('TC o valor inválidos y otra moneda base no producen cifras comparables',async()=>{
  for(const tc of [null,'',0,-2,NaN,Infinity,true])assert.equal((await calcular([aporte()],{tcActual:tc})).totalOk,false);
  for(const valor of [null,'',-1,NaN,Infinity])assert.equal((await calcular([aporte()],{row:row(valor)})).totalOk,false);
  assert.equal((await calcular([aporte()],{row:{...row(),moneda_base:'EUR'}})).totalOk,false);
  const cero=await calcular([aporte()],{row:row(0)});assert.equal(cero.totalOk,true);assert.equal(cero.resultadoTotalPEN,-3300);identidad(cero);
});

test('capital neto no positivo conserva resultado pero no porcentaje de rentabilidad',async()=>{
  const m=await calcular([aporte(),transferencia('IBKR','Plin',3800,1000,'2026-09-20')],{row:row(10)});
  assert.equal(m.capitalPEN,-500);assert.equal(m.resultadoTotalPEN,538);
  assert.equal(m.pctTotal,null);assert.equal(m.pctCambioAportesSobreCapital,null);identidad(m);
});

test('entradas explícitas no dan por real la conversión USD estimada de costos PEN',async()=>{
  const m=await calcular([],{fl:{flujos:[{fecha:'2026-09-01',monto:1000,soles:3300}]},co:{costos:[{fecha:'2026-09-01',usd:10,soles:33}]}});
  assert.equal(m.costosUSD,null);assert.equal(m.totalOk,true);assert.equal(m.atribucionOk,true);identidad(m);
  assert.equal(m.resultadoTotalPEN,391);
  const confirmado=await calcular([],{fl:{flujos:[{fecha:'2026-09-01',monto:1000,soles:3300}]},co:{costos:[{fecha:'2026-09-01',usd:10,usdConfirmado:true,soles:33}]}});
  assert.equal(confirmado.ok,true);assert.equal(confirmado.resultadoInversionUSD,-30);identidad(confirmado);
  const futuro=await calcular([],{fl:{flujos:[{fecha:'2026-09-01',monto:1000,soles:3300}],pendientes:1,pendientesFechas:['2026-10-04']}});
  assert.equal(futuro.totalOk,true);
});

test('filas del estado y filas objeto coinciden; ISO con hora usa fecha Lima',async()=>{
  const original=aporte(3300,1000,'2026-10-04T02:00:00Z');
  const fila=[original.fecha,'Aporte','Inversión IBKR','Transferencia',3300,'Plin','fila','IBKR',null,null,null,null,null,'USD',1000,false];
  const objeto=await calcular([original]),array=await calcular([fila]);
  assert.equal(objeto.resultadoTotalPEN,424);assert.equal(array.resultadoTotalPEN,objeto.resultadoTotalPEN);identidad(array);
});

test('cierres de alta precisión mantienen la identidad de los importes mostrados',async()=>{
  const m=await calcular([aporte(16926,5036.24),aporte(3074,914.65)],{row:row(5857.52884),tcActual:3.71});
  identidad(m);assert.equal(m.capitalPEN,20000);assert.equal(m.resultadoTotalPEN,1731.43);
  assert.equal(m.resultadoInversionBrutaUSD,-93.36);assert.equal(m.pctTotal,1731.43/20000*100);
});
