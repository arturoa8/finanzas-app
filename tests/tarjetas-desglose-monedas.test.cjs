// El detalle de una tarjeta separa soles y dólares: consumido, pagado y saldo
// de cada moneda, y el total del ciclo en soles. Datos ficticios, sin red.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-10-03T12:00:00-05:00']));}static now(){return new RealDate('2026-10-03T12:00:00-05:00').getTime();}};
entornoPrueba();
const nodos=new Map();
function el(id){
  if(!nodos.has(id)){const clases=new Set();nodos.set(id,{id,innerHTML:'',textContent:'',classList:{add:x=>clases.add(x),remove:x=>clases.delete(x),contains:x=>clases.has(x)}});}
  return nodos.get(id);
}
document.getElementById=el;
document.querySelector=()=>null;
globalThis.fetch=()=>{throw new Error('Esta prueba no puede conectarse con Supabase');};

(async()=>{
  const [{datos},ui,cards,{serializarCreditoUSD}]=await Promise.all([
    modulo('state.js'),modulo('modules/cards/cards-ui.js'),modulo('modules/cards/cards.js'),modulo('modules/cards/usd-credit.js'),
  ]);
  const cuenta='Tarjeta demo';
  const g=(f,m,id,usd,tc)=>usd?[f,'Compra USD','Compras','Gasto',m,cuenta,id,null,null,'USD',usd,tc,'mercado']:[f,'Compra','Compras','Gasto',m,cuenta,id];
  Object.assign(datos,{configTarjetas:[[cuenta,1000,30,cuenta,'💳',9,5]],cuentas:[],categorias:[],ciclosOverride:[],
    // Ciclo anterior (10 ago. – 9 set.) solo en soles y pagado exacto.
    // Ciclo actual (10 set. – 9 oct.): S/ 153.48 en soles y US$ 120.42 (S/ 404.11).
    transacciones:[g('2026-08-20',15.9,'a1'),
      g('2026-09-18',53.42,'s1'),g('2026-09-21',384,'u1',114.5,3.35371179),g('2026-09-25',12.9,'s2'),g('2026-09-26',49.5,'s3'),
      g('2026-09-27',27.8,'s4'),g('2026-09-28',3.5,'s5'),g('2026-09-29',5,'s6'),g('2026-09-29',20.11,'u2',5.92,3.397195),g('2026-09-30',1.36,'s7')],
    pagosTarjetas:[
      ['p0',cuenta,'2026-09-09',15.9,'2026-09-05',null,'Plin','PEN'],
      ['p1',cuenta,'2026-10-09',225.68,'2026-10-01','deuda total soles','Plin','PEN'],
      ['p2',cuenta,'2026-10-09',115,'2026-10-02',null,'BCP Dólares','USD',394.61,3.4313913,385.92,null,'manual'],
      ['p3',cuenta,'2026-10-09',6,'2026-10-03',serializarCreditoUSD({tipo:'pago',reconocido:18.19,credito:0.58,costoCredito:1.99}),'BCP Dólares','USD',20.6,3.43333333,20.18,null,'manual'],
    ],
    deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[]});
  const {CREDIT_CARDS}=await modulo('modules/cards/config.js');
  const card=CREDIT_CARDS.find(c=>c.cuenta===cuenta);

  const d=cards.desgloseMonedasCiclo(card,cards.getCardData(card,0));
  assert.deepEqual([d.soles.consumido,d.soles.pagado,d.soles.pendiente,d.soles.favor],[153.48,225.68,0,72.2],'soles: S/ 72.20 pagados de más');
  assert.deepEqual([d.dolares.consumido,d.dolares.equivalente,d.dolares.pagado,d.dolares.costo,d.dolares.pendiente,d.dolares.favor],[120.42,404.11,121,415.21,0,0.58],'dólares por separado, con su equivalente y costo');
  assert.equal(d.total,557.59,'el total en soles suma soles y dólares al TC de cada compra');
  assert.equal(Math.round((d.soles.consumido+d.dolares.equivalente)*100)/100,d.total);

  // La tabla del detalle lo muestra en columnas.
  ui.abrirCardDetail(cuenta);
  const html=el('cardDetailContent').innerHTML;
  assert.match(html,/<span>Soles<\/span><span>Dólares<\/span>/);
  assert.match(html,/Consumido<\/span><span>S\/ 153\.48<\/span><span>US\$ 120\.42<small>≈ S\/ 404\.11<\/small>/);
  assert.match(html,/Pagado<\/span><span>S\/ 225\.68<\/span><span>US\$ 121\.00<small>costó S\/ 415\.21<\/small>/);
  assert.match(html,/\+S\/ 72\.20<\/strong><small>a favor/);
  assert.match(html,/\+US\$ 0\.58<\/strong><small>a favor/);
  assert.match(html,/Total consumido en soles<\/span><strong>S\/ 557\.59/);

  // Un ciclo solo en soles no muestra la columna de dólares.
  const anterior=cards.desgloseMonedasCiclo(card,cards.getCardData(card,-1));
  assert.equal(anterior.dolares,null);
  assert.deepEqual([anterior.soles.consumido,anterior.soles.pagado,anterior.soles.pendiente,anterior.soles.favor],[15.9,15.9,0,0]);
  console.log('PASS: soles, dólares y total en soles por ciclo; saldo a favor por moneda; columna USD solo si hay dólares.');
})().catch(e=>{console.error(e);process.exitCode=1;});
