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
  const [{datos},summary,cards,cycles,{CREDIT_CARDS},budget]=await Promise.all([modulo('state.js'),modulo('modules/home-summary.js'),modulo('modules/cards/cards.js'),modulo('modules/cards/cycles.js'),modulo('modules/cards/config.js'),modulo('modules/presupuestos-calculo.js')]);
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
  assert.deepEqual(Object.fromEntries(Object.entries(r.deudas).map(([k,d])=>[k,{total:d.total,cantidad:d.cantidad}])),
    {pagar:{total:75,cantidad:1},cobrar:{total:70,cantidad:1}},'usa abonos reales, omite saldadas/archivadas y no suma el acumulado cacheado');
  assert.equal(r.deudas.pagar.proxima.persona,'Persona A');assert.equal(r.deudas.pagar.proxima.vencimiento.getDate(),10);
  assert.equal(r.deudas.cobrar.proxima.vencimiento,null,'una deuda sin plazo no inventa vencimiento');
  datos.deudas.push(['urgente','Persona <urgente>','Préstamo',20,0,'2026-09-01','2026-10-06','les-debo']);
  r=summary.obtenerResumenInicio();assert.equal(r.deudas.pagar.proxima.persona,'Persona <urgente>');
  datos.deudasAbonos.push(['a4','urgente',20,'2026-10-04']);r=summary.obtenerResumenInicio();
  assert.equal(r.deudas.pagar.proxima.persona,'Persona A','una deuda saldada deja de ser el próximo pago');
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
  assert.match(html,/Venció/);assert.match(html,/Tarjeta &lt;demo&gt;/,'escapa nombres de cuentas en el resumen');
  assert.equal((html.match(/data-widget="tarjetas"/g)||[]).length,1,'saldo y vencimiento comparten un widget de tarjetas');
  assert.doesNotMatch(html,/Próximo pago|Pago vencido/,'no conserva un segundo widget de próximos pagos');
  assert.deepEqual([...html.matchAll(/data-widget="([^"]+)"/g)].map(m=>m[1]),['rentabilidad','periodo','tarjetas','presupuesto','pagar','cobrar']);
  assert.match(html,/id="quickInsight"/,'el resumen del período se inserta en su posición configurable');
  assert.match(html,/setPg\('card'\)/);assert.match(html,/setPg\('deb'\)/);
  assert.match(html,/setDT\('les-debo',document.getElementById\('dtLesDebo'\)\)/,'Por pagar abre la lista de pagos incluso si Deudas quedó en otra pestaña');
  assert.match(html,/setDT\('me-deben',document.getElementById\('dtMeDeben'\)\)/);
  assert.match(html,/Por pagar/);assert.match(html,/Por cobrar/);
  assert.match(html,/Persona A · Vence/);assert.match(html,/Persona B · Sin fecha de vencimiento/);
  localStorage.setItem('finanzas.home-widgets.v1',JSON.stringify([{id:'presupuesto',visible:true},{id:'periodo',visible:false},{id:'tarjetas',visible:true},{id:'rentabilidad',visible:false},{id:'cobrar',visible:true},{id:'pagar',visible:false}]));
  summary.renderHomeSummary();
  assert.deepEqual([...el('homeHighlights').innerHTML.matchAll(/data-widget="([^"]+)"/g)].map(m=>m[1]),['presupuesto','tarjetas','cobrar'],
    'respeta el orden guardado y oculta también el resumen del período');
  localStorage.setItem('finanzas.home-widgets.v1',JSON.stringify(['rentabilidad','periodo','tarjetas','presupuesto','pagar','cobrar'].map(id=>({id,visible:false}))));
  summary.renderHomeSummary();assert.doesNotMatch(el('homeHighlights').innerHTML,/data-widget=/);
  assert.match(el('homeHighlights').innerHTML,/abrirConfiguracion\('inicio'\)/,'si se ocultó todo queda acceso para volver a personalizar Inicio');
  localStorage.removeItem('finanzas.home-widgets.v1');
  el('homeSummary').classList.remove('expanded');el('homeHighlights').innerHTML='sin recalcular';summary.renderHomeSummary();
  assert.equal(el('homeHighlights').innerHTML,'sin recalcular','no calcula ni repinta el resumen oculto mientras se usa el historial');
  // No suma límites solapados: general mensual, general semanal y categorías
  // comparten consumos. Los reembolsos se descuentan igual que en Presupuestos.
  const p=o=>budget.filaPresupuesto(o),octGasto=(id,monto,cat,tipo='Gasto',origen=null)=>['2026-10-02',id,cat,tipo,monto,'Plin',id,null,origen];
  datos.transacciones.push(octGasto('comida',120,'Comida'),octGasto('refund-comida',50,'Comida','Reembolso','comida'),octGasto('ocio',20,'Ocio'),octGasto('transfer',300,'Otro','Transferencia'));
  datos.presupuestos=[p({id:'regla',ambito:'general',periodo:'mensual',monto_limite:500,inicio:'2026-09-01',recurrente:true}),
    p({id:'general-mes',ambito:'general',periodo:'mensual',monto_limite:200,inicio:'2026-10-01'}),
    p({id:'general-semana',ambito:'general',periodo:'semanal',monto_limite:60,inicio:'2026-09-28'}),
    p({id:'comida',ambito:'categoria',categoria:'Comida',periodo:'mensual',monto_limite:50,inicio:'2026-10-01'}),
    p({id:'ocio',ambito:'categoria',categoria:'Ocio',periodo:'mensual',monto_limite:10,inicio:'2026-10-01'})];
  let pres=summary.obtenerPresupuestoInicio();
  assert.deepEqual([pres.id,pres.limite,pres.gastado,pres.disponible,pres.excedidos],['general-mes',200,90,110,3],
    'el ajuste mensual manda; el disponible no suma categorías ni semanas y el reembolso reduce consumo');
  assert.equal(pres.periodo,'Este mes');
  datos.presupuestos=datos.presupuestos.filter(x=>x[5]!=='mensual'||x[4]!=='general');
  pres=summary.obtenerPresupuestoInicio();assert.deepEqual([pres.id,pres.exceso],['general-semana',30],'sin general mensual se muestra el general semanal vigente');
  datos.presupuestos=datos.presupuestos.filter(x=>x[4]!=='general');
  pres=summary.obtenerPresupuestoInicio();assert.equal(pres.id,'ocio','sin general se escoge la categoría con mayor uso, sin sumar sus límites');
  datos.transacciones.push(['2026-10-03','USD sin cambio','Ocio','Gasto',10,'Plin','incompleto',null,null,'USD',null,null]);
  el('homeSummary').classList.add('expanded');summary.renderHomeSummary();
  const widgetPres=el('homeHighlights').innerHTML.match(/<button[^>]*data-widget="presupuesto"[\s\S]*?<\/button>/)[0];
  assert.match(widgetPres,/datos por completar/);assert.match(widgetPres,/<strong[^>]*>—<\/strong>/,'un consumo USD incompleto no produce disponible falso');
  assert.match(widgetPres,/setPresVista\('mensual'\);irPresPeriodoActual\(\)/,'abre el mismo período actual que describe el widget');
  datos.cargados=false;assert.deepEqual(summary.obtenerResumenInicio(),{cargado:false},'no anuncia tarjetas al día mientras faltan datos');
  datos.categoriasCargadas=true;assert.equal(summary.obtenerResumenInicio().cargado,true,'la primera carga puede pintar antes de que cargados se marque true');
  Object.assign(datos,{transacciones:[],pagosTarjetas:[],deudas:[],deudasAbonos:[],presupuestos:[]});el('homeSummary').classList.add('expanded');summary.renderHomeSummary();
  assert.match(el('homeHighlights').innerHTML,/Al día/);assert.doesNotMatch(el('homeHighlights').innerHTML,/Próximo pago|Por pagar|Por cobrar/,'no inventa fechas ni deudas sin saldo');
  console.log('PASS: widgets actuales por moneda, tarjetas unificadas, fechas/personas de deudas, presupuestos vigentes sin doble suma, orden/visibilidad, carga y render solo cuando es visible.');
})().catch(e=>{console.error(e);process.exitCode=1;});
