// El resumen usa obligaciones reales al día, por moneda y con el ledger
// existente. Datos ficticios: no permite consultas a servicios externos.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';entornoPrueba();
const RealDate=Date,ahora=RealDate.parse('2026-10-04T12:00:00-05:00');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[ahora]));}static now(){return ahora;}};
const nodos=new Map();
function el(id){
  if(!nodos.has(id)){const clases=new Set();nodos.set(id,{id,innerHTML:'',textContent:'',value:'',dataset:{},style:{},
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),toggle(x,on){if(on)clases.add(x);else clases.delete(x);}},
    setAttribute(){},querySelector:()=>null,querySelectorAll:()=>[]});}
  return nodos.get(id);
}
document.getElementById=el;document.querySelector=s=>s==='.page.active'?el('p-dash'):null;document.querySelectorAll=()=>[];
globalThis.fetch=async()=>{throw new Error('El resumen no necesita consultas de red');};
(async()=>{
  const [{datos},summary,cards,cycles,{CREDIT_CARDS}]=await Promise.all([modulo('state.js'),modulo('modules/home-summary.js'),modulo('modules/cards/cards.js'),modulo('modules/cards/cycles.js'),modulo('modules/cards/config.js')]);
  const cuenta='Tarjeta demo',t=(id,fecha,monto,tipo='Gasto',origen=null,usd=null)=>[fecha,id,'Compras',tipo,monto,cuenta,id,null,origen,usd===null?null:'USD',usd,usd===null?null:monto/usd];
  Object.assign(datos,{cargados:true,categoriasCargadas:false,configTarjetas:[[cuenta,5000,30,'Tarjeta <demo>','💳',9,5]],ciclosOverride:[],
    transacciones:[t('pen-old','2026-08-20',80),t('pen-now','2026-09-20',100),t('usd-old','2026-08-21',34,'Gasto',null,10),
      t('refund-pen','2026-09-30',15,'Reembolso','pen-old'),t('refund-usd','2026-09-30',6.8,'Reembolso','usd-old',2),t('future-expense','2026-11-01',600)],
    pagosTarjetas:[['pen-credit',cuenta,'2026-08-09',20,'2026-08-01','','Plin','PEN'],
      ['usd-credit',cuenta,'2026-08-09',3,'2026-08-01','','BCP Dólares','USD',10.2,3.4,0],
      ['future-pen',cuenta,'2026-09-09',80,'2026-10-05','','Plin','PEN'],
      ['future-usd',cuenta,'2026-09-09',10,'2026-10-05','','BCP Dólares','USD',34,3.4,34]],
    deudas:[['pagar','Persona A','Préstamo',100,999,'2026-09-01','2026-10-10','les-debo'],
      ['cobrar','Persona B','Préstamo',80,0,'2026-09-01',null,'me-deben'],['saldada','Persona C','Pagada',50,0,null,null,'les-debo']],
    deudasAbonos:[['a1','pagar',25,'2026-10-01'],['a2','cobrar',10,'2026-10-01'],['a3','saldada',50,'2026-10-01']],
    deudasArchivadas:[['archivada','Persona D','Archivada',900,0,null,null,'les-debo']]});
  const card=CREDIT_CARDS.find(c=>c.cuenta===cuenta),fechaHasta=new Date(2026,9,4,23,59,59,999);
  const pendientes=cards.getCardPendingByCycle(card,fechaHasta);
  assert.deepEqual(pendientes.get('2026-09-09'),{soles:45,usd:5},'el ciclo anterior conserva deuda real tras reembolsos y créditos en su propia moneda');
  assert.deepEqual(pendientes.get('2026-10-09'),{soles:100,usd:0});
  assert.equal(pendientes.has('2026-11-09'),false,'una compra futura no entra en el saldo de hoy');
  let r=summary.obtenerResumenInicio();
  assert.deepEqual(r.totales,{soles:145,usd:5},'no presenta US$ 5 como S/ 17 ni suma sus monedas');
  assert.deepEqual([r.proximoPago.soles,r.proximoPago.usd,r.proximoPago.vencimiento.getMonth(),r.proximoPago.vencimiento.getDate(),r.proximoPago.dias],[45,5,9,5,1],
    'el pago real de septiembre vence el 5 de octubre, aunque el ciclo en curso cierre en octubre');
  assert.deepEqual(r.deudas,{pagar:{total:75,cantidad:1},cobrar:{total:70,cantidad:1}},'usa abonos reales, omite saldadas/archivadas y no suma el acumulado cacheado');
  const corteAnterior=summary.obtenerResumenInicio(new Date(2026,8,4));
  assert.deepEqual([corteAnterior.proximoPago.vencimiento.getMonth(),corteAnterior.proximoPago.vencimiento.getDate()],[9,5],
    'usar un corte de otro mes conserva la fecha real del ciclo, sin desplazarla respecto al reloj de la app');
  // Elegir otro mes en Tarjetas no puede desplazar el resumen de hoy.
  cycles.abrirCardCyclePicker();cycles.cambiarAnioCardPicker(-1);cycles.seleccionarCardCycleMes(0);cycles.aplicarCardCyclePicker();
  assert.notEqual(cycles.cardCycleOffset,0);r=summary.obtenerResumenInicio();assert.deepEqual(r.totales,{soles:145,usd:5});assert.equal(r.proximoPago.vencimiento.getDate(),5);
  // Un pago vencido prevalece sobre un pago posterior y se etiqueta como tal.
  datos.transacciones.push(t('overdue','2026-06-20',12));r=summary.obtenerResumenInicio();
  assert.equal(r.proximoPago.dias<0,true);assert.equal(r.proximoPago.soles,12);assert.equal(r.proximoPago.vencimiento.getMonth(),7);
  el('homeSummary').classList.add('expanded');summary.renderHomeSummary();const html=el('homeHighlights').innerHTML;
  assert.match(html,/Pago vencido/);assert.match(html,/Tarjeta &lt;demo&gt;/,'escapa nombres de cuentas en el resumen');
  assert.match(html,/setPg\('card'\)/);assert.match(html,/setPg\('deb'\)/);
  assert.match(html,/setDT\('les-debo',document.getElementById\('dtLesDebo'\)\)/,'Por pagar abre la lista de pagos incluso si Deudas quedó en otra pestaña');
  assert.match(html,/setDT\('me-deben',document.getElementById\('dtMeDeben'\)\)/);
  assert.match(html,/Por pagar/);assert.match(html,/Por cobrar/);
  el('homeSummary').classList.remove('expanded');el('homeHighlights').innerHTML='sin recalcular';summary.renderHomeSummary();
  assert.equal(el('homeHighlights').innerHTML,'sin recalcular','no calcula ni repinta el resumen oculto mientras se usa el historial');
  datos.cargados=false;assert.deepEqual(summary.obtenerResumenInicio(),{cargado:false},'no anuncia tarjetas al día mientras faltan datos');
  datos.categoriasCargadas=true;assert.equal(summary.obtenerResumenInicio().cargado,true,'la primera carga puede pintar antes de que cargados se marque true');
  Object.assign(datos,{transacciones:[],pagosTarjetas:[],deudas:[],deudasAbonos:[]});el('homeSummary').classList.add('expanded');summary.renderHomeSummary();
  assert.match(el('homeHighlights').innerHTML,/Al día/);assert.doesNotMatch(el('homeHighlights').innerHTML,/Próximo pago|Por pagar|Por cobrar/,'no inventa fechas ni deudas sin saldo');
  console.log('PASS: resumen actual por moneda, plazos reales/vencidos, créditos y reembolsos, pagos futuros excluidos, abonos, carga y render solo cuando es visible.');
})().catch(e=>{console.error(e);process.exitCode=1;});
