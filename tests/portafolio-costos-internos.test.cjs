const assert=require('node:assert/strict');
const test=require('node:test');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const modulos=Promise.all([modulo('state.js'),modulo('modules/portfolio/capital.js')]);
function fila({id,tipo='Gasto',cuenta='BCP',monto=20,usd=null,destino=null,recibido=null,costo=true}){
  return ['2026-09-01T17:00:00Z',id,'Inversión IBKR',tipo,monto,cuenta,id,destino,null,
    usd===null?null:'USD',usd,usd===null?null:monto/usd,usd===null?null:'manual',
    recibido===null?null:'USD',recibido,costo];
}
async function preparar(archivada=false){
  const [estado,capital]=await modulos;
  estado.datos.cuentas=[['BCP','banco','PEN',false,'bcp'],['BCP Dólares','banco','USD',false,'usd'],
    ['IBKR','inversion','USD',archivada,'ibkr'],['IBKR antigua','inversion','USD',true,'antigua']];
  estado.datos.transacciones=[fila({id:'aporte',tipo:'Transferencia',cuenta:'BCP',monto:3300,destino:'IBKR',recibido:1000,costo:false})];
  return{datos:estado.datos,capital};
}

test('costos externos PEN, USD y ajustes del banco conservan su signo',async()=>{
  const {datos,capital}=await preparar();
  datos.transacciones.push(fila({id:'comision-pen',monto:20}),
    fila({id:'comision-usd',cuenta:'BCP Dólares',monto:40,usd:10}),
    fila({id:'ajuste-banco',tipo:'Ingreso',monto:7}),
    fila({id:'gasto-no-marcado',monto:100,costo:false}));
  const {costos}=capital.pfCostosInversion();
  assert.deepEqual(costos.map(c=>c.id),['comision-pen','comision-usd','ajuste-banco']);
  assert.deepEqual(costos.map(c=>c.soles),[20,40,-7]);
  assert.ok(Math.abs(costos[0].usd-20/3.3)<1e-10);
  assert.equal(costos[1].usd,10);
  assert.ok(Math.abs(costos[2].usd+7/3.3)<1e-10);
  assert.equal(costos.reduce((s,c)=>s+c.soles,0),53);
});

test('comisiones y devoluciones dentro de IBKR no se descuentan de nuevo como costos externos',async()=>{
  const {datos,capital}=await preparar();
  datos.transacciones.push(fila({id:'fee-interno',cuenta:'IBKR',monto:33,usd:10}),
    fila({id:'devolucion-interna',tipo:'Ingreso',cuenta:'IBKR',monto:16.5,usd:5}),
    fila({id:'comision-externa',cuenta:'BCP',monto:10}));
  const {costos}=capital.pfCostosInversion();
  assert.deepEqual(costos.map(c=>c.id),['comision-externa']);
  const m=capital.pfModeloCapital({moneda_base:'USD',fecha_valoracion:'2026-10-03',valor_total:995},
    {flujos:[{fecha:'2026-09-01',monto:1000}],pendientes:0,pendientesFechas:[]},{costos:[]});
  assert.equal(m.ganancia,-5,'el valor oficial ya incluye el costo interno neto');
  assert.equal(m.gananciaNeta,-5,'no se resta una segunda vez');
});

test('cuentas de inversión archivadas mantienen la exclusión de gastos e ingresos internos',async()=>{
  const {datos,capital}=await preparar(true);
  datos.transacciones.push(fila({id:'fee-ibkr-archivada',cuenta:'IBKR',monto:33,usd:10}),
    fila({id:'ajuste-ibkr-archivada',tipo:'Ingreso',cuenta:'IBKR',monto:16.5,usd:5}),
    fila({id:'fee-cuenta-antigua',cuenta:'IBKR antigua',monto:33,usd:10}),
    fila({id:'ajuste-cuenta-antigua',tipo:'Ingreso',cuenta:'IBKR antigua',monto:16.5,usd:5}),
    fila({id:'comision-externa',cuenta:'BCP Dólares',monto:40,usd:10}));
  const {costos}=capital.pfCostosInversion();
  assert.deepEqual(costos.map(c=>c.id),['comision-externa']);
  assert.equal(costos[0].soles,40);assert.equal(costos[0].usd,10);
});
