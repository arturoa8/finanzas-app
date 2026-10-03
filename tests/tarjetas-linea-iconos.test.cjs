const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {appRoot,entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-10-03T12:00:00-05:00']));}};
entornoPrueba();
const nodos=new Map();
document.getElementById=id=>{
  if(!nodos.has(id))nodos.set(id,{id,innerHTML:'',textContent:'',classList:{add(){},remove(){},contains(){return false;}}});
  return nodos.get(id);
};
document.querySelector=()=>null;
globalThis.fetch=()=>{throw Error('Los datos de esta prueba son ficticios');};

(async()=>{
  const [{datos},ui,{getEmoji,cleanName},cards]=await Promise.all([
    modulo('state.js'),modulo('modules/cards/cards-ui.js'),modulo('utils/formatters.js'),modulo('modules/cards/cards.js'),
  ]);
  const cuenta='Tarjeta demo';
  const consumo=(fecha,monto,id,usd=null)=>[fecha,'Compra','Compras','Gasto',monto,cuenta,id,null,null,usd===null?null:'USD',usd,usd===null?null:3.5,'mercado'];
  Object.assign(datos,{configTarjetas:[[cuenta,5000,30,cuenta,'💳',24,15]],cuentas:[],categorias:[],ciclosOverride:[],
    transacciones:[consumo('2026-10-01',47.6,'p1'),consumo('2026-10-01',35,'u1',10),
      consumo('2026-11-01',12.54,'p2'),consumo('2026-11-01',7,'u2',2)],
    pagosTarjetas:[],deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[]});
  ui.renderCardsPage();
  const resumen=document.getElementById('cardsLineSummary').innerHTML;
  assert.match(resumen,/<span>Actual:<\/span><strong>S\/ 47\.60 · US\$ 10\.00<\/strong>/);
  assert.match(resumen,/<span>Siguiente:<\/span><strong>S\/ 12\.54 · US\$ 2\.00<\/strong>/);
  assert.equal(cards.fmtMonedas({soles:0,usd:0}),'S/ 0.00');
  assert.equal(cards.fmtMonedas({soles:0,usd:2}),'US$ 2.00');

  // La etiqueta ocupa lo que mide el texto: el importe queda junto a ella.
  const css=fs.readFileSync(path.join(appRoot,'css/cards.css'),'utf8');
  const regla=/\.line-breakdown-row\{([^}]+)\}/.exec(css)?.[1]||'';
  assert.match(regla,/display:flex/);assert.match(regla,/justify-content:flex-start/);
  assert.doesNotMatch(regla,/grid-template-columns|space-between/);

  const compra=getEmoji('Compra Dólares');
  assert.equal(compra.e,'💱');
  assert.notEqual(compra.e,getEmoji('Transferencias').e);
  assert.notEqual(compra.e,getEmoji('Inversión IBKR').e);
  for(const nombre of ['compra dolares',' COMPRA DÓLARES ','Compra Dólares'])assert.deepEqual(getEmoji(nombre),compra);
  assert.equal(cleanName('compra dolares'),'Compra Dólares');
  assert.equal(getEmoji('Venta de Dólares').e,'↔');

  // El color guardado cambia los fondos y gráficos, conservando el icono.
  datos.categorias=[['compra dolares','#123456'],['Comer afuéra','#ABC'],['Personal','#00cc88'],['Inversión IBKR','#dd7722']];
  assert.deepEqual(getEmoji(' COMPRA DÓLARES '),{e:'💱',h:'#123456',c:'rgba(18,52,86,0.18)'});
  assert.deepEqual(getEmoji('Comer afuera'),{e:'🍔',h:'#aabbcc',c:'rgba(170,187,204,0.18)'});
  assert.deepEqual(getEmoji('Personal'),{e:'💼',h:'#00cc88',c:'rgba(0,204,136,0.18)'});
  assert.equal(getEmoji('inversion ibkr').h,'#dd7722');
  for(const color of ['red','#abcd','rgb(0,0,0)','#123456;display:none','']){
    datos.categorias=[['Compra Dólares',color]];
    assert.deepEqual(getEmoji('Compra Dólares'),compra,'un color inválido conserva el estilo predeterminado');
  }
  datos.categorias=[];
  assert.deepEqual(getEmoji('Compra Dólares'),compra);
  console.log('PASS: Actual y Siguiente junto a sus importes PEN/USD, filas a la izquierda, icono de Compra Dólares y colores guardados con validación y nombres normalizados.');
})().catch(e=>{console.error(e);process.exitCode=1;});
