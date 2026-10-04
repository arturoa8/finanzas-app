// Inicio comparte período con el historial desplegable, y los filtros del
// detalle conservan el saldo y los KPI del resumen. DOM y datos
// ficticios: esta prueba no consulta ni modifica ninguna cuenta real.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';entornoPrueba();
const RealDate=Date,ahora=RealDate.parse('2026-10-04T12:00:00-05:00');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[ahora]));}static now(){return ahora;}};
const nodos=new Map();let enfocado=null,opcionesFoco=null;
function el(id){
  if(!nodos.has(id)){
    const clases=new Set(),attrs=new Map();
    nodos.set(id,{id,dataset:{},style:{},textContent:'',innerHTML:'',value:'',hidden:false,
      classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
        toggle(x,force){const on=force??!clases.has(x);if(on)clases.add(x);else clases.delete(x);return on;}},
      setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),
      querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){},append(){},appendChild(){},addEventListener(){},
      contains(n){return id==='searchWrap'&&n?.id==='searchInp';},focus(opciones){enfocado=id;opcionesFoco=opciones;document.activeElement=this;}});
  }
  return nodos.get(id);
}
const paginas=['dash','ana','card','bud','pres','deb'].map(p=>el('p-'+p));
const sinControles=new Set(['txCuenta','txUsd','txTipoTodos','txTipoGastos','txTipoIngresos','txTipoTransferencias']);
document.getElementById=id=>sinControles.has(id)?null:el(id);
document.querySelector=s=>s==='.page.active'?paginas.find(p=>p.classList.contains('active'))||null:s==='.fab'?el('fab'):null;
document.querySelectorAll=s=>s==='.page'?paginas:s==='.nt'?['dash','bud','ana','card','more'].map(p=>el('nav-'+p)):[];
document.createElement=el;document.createElementNS=(_,tag)=>el(tag);
globalThis.window={scrollY:0,scrollTo(){}};globalThis.matchMedia=()=>({matches:true});
globalThis.fetch=async()=>{throw new Error('Esta prueba no permite consultas de red');};
el('p-dash').classList.add('active');el('homeSummary').classList.add('expanded');
el('searchWrap').inert=true;el('searchWrap').setAttribute('aria-hidden','true');el('homeMovements').inert=true;el('homeMovements').setAttribute('aria-hidden','true');
const tx=(id,fecha,tipo,monto,categoria='Compras',cuenta='Plin')=>[fecha,id,categoria,tipo,monto,cuenta,id];
(async()=>{
  const [d,n,c,{datos}]=await Promise.all([modulo('modules/dashboard.js'),modulo('ui/navigation.js'),modulo('modules/currencies.js'),modulo('state.js')]);
  const compraUSD=tx('Compra dólares','2026-10-03','Transferencia',37,'Transferencias');compraUSD[7]='BCP Dólares';compraUSD[13]='USD';compraUSD[14]=10;
  const gastoUSD=tx('Gasto dólares','2026-10-03','Gasto',18.5,'Compras','BCP Dólares');gastoUSD[9]='USD';gastoUSD[10]=5;gastoUSD[11]=3.7;
  const reembolso=tx('Devolución','2026-10-04','Reembolso',10);reembolso[8]='Compra octubre';
  datos.transacciones=[tx('Sueldo septiembre','2026-09-01','Ingreso',1000,'Salario'),tx('Gasto septiembre','2026-09-20','Gasto',60,'Comida','Archivada <demo>'),
    tx('Sueldo octubre','2026-10-01','Ingreso',2000,'Salario'),tx('Compra octubre','2026-10-01','Gasto',50),tx('Alquiler','2026-10-02','Gasto',500,'Casa'),
    compraUSD,gastoUSD,reembolso,tx('Ingreso reciente','2026-10-04','Ingreso',5,'Salario'),tx('Recibo reciente','2026-10-04','Gasto',8,'Casa'),tx('Futuro','2026-10-10','Gasto',900,'Casa')];
  datos.cuentas=[['Plin','billetera','PEN',false,'plin'],['BCP Dólares','banco','USD',false,'usd'],['Archivada <demo>','banco','PEN',true,'vieja']];
  Object.assign(datos,{configTarjetas:[],pagosTarjetas:[],categorias:[],presupuestos:[],recurrentes:[],deudas:[],cargados:true});
  d.render();
  const inicio=()=>[el('balAmt').dataset.value,el('kpiOut').textContent,el('kpiIn').textContent,el('quickInsight').innerHTML];
  const inicial=inicio();
  assert.equal(nodos.has('recentTxs'),false,'el resumen ya no renderiza una vista previa de cinco movimientos');
  assert.equal(el('homeMovements').classList.contains('expanded'),false,'el detalle empieza cerrado');
  assert.equal((el('txs').innerHTML.match(/class="tx"/g)||[]).length,8,'el detalle contiene el historial completo del período');
  d.togglePillTipo('gastos',true);
  assert.equal(el('homeMovements').classList.contains('expanded'),true,'el KPI abre el detalle dentro de Inicio');
  assert.equal(el('homeMovements').inert,false);assert.equal(el('homeMovements').getAttribute('aria-hidden'),'false');
  assert.equal(el('homeSummary').classList.contains('expanded'),false,'el resumen deja paso al historial');
  assert.equal(document.querySelector('.page.active').id,'p-dash');
  assert.ok(d.filtrar().every(t=>t[3]==='Gasto'));assert.deepEqual(inicio(),inicial,'filtrar desde un KPI conserva el resumen');
  assert.match(el('filterPill').innerHTML,/Gastos/,'el filtro del KPI se puede quitar mediante su chip contextual');
  assert.match(el('filterPill').innerHTML,/quitarFiltro\(\)/);d.quitarFiltro();assert.equal(el('filterPill').innerHTML,'');
  d.toggleSearch();assert.equal(el('searchWrap').inert,false);assert.equal(el('searchWrap').getAttribute('aria-hidden'),'false');assert.equal(enfocado,'searchInp');
  assert.equal(opcionesFoco.preventScroll,true,'abrir la búsqueda no salta el scroll');
  assert.equal(el('searchToggle').getAttribute('aria-expanded'),'true');
  el('searchInp').value='Alquiler';d.filtrarBusqueda();assert.equal(d.filtrar().length,1);assert.deepEqual(inicio(),inicial);
  d.toggleSearch();assert.equal(el('searchWrap').inert,true);assert.equal(el('searchWrap').getAttribute('aria-hidden'),'true');assert.equal(el('searchWrap').classList.contains('show'),false);
  assert.equal(enfocado,'searchToggle','al cerrar el buscador devuelve el foco a la lupa');
  assert.equal(el('searchInp').value,'');assert.equal(el('searchToggle').getAttribute('aria-expanded'),'false');
  assert.equal(el('searchCount').textContent,'8 movimientos en este período','ocultar la búsqueda también limpia su filtro y repinta');
  n.abrirMesPicker();n.seleccionarMesPicker(8);n.aplicarMesPicker();
  assert.equal(n.getMesActivo().getMonth(),8,'el calendario de Inicio aplica el mismo período al resumen y al detalle');
  assert.deepEqual(d.filtrar().map(t=>t[6]),['Sueldo septiembre','Gasto septiembre']);
  const septiembre=inicio();assert.notDeepEqual(septiembre,inicial,'el período sí cambia el resumen completo');
  el('searchInp').value='Gasto septiembre';d.filtrarBusqueda();d.filtrarPorCat('Comida');d.togglePillTipo('gastos');
  assert.equal(d.filtrar().length,1);assert.deepEqual(inicio(),septiembre,'buscar y filtrar categoría/tipo no altera el resumen');
  assert.match(el('filterPill').innerHTML,/Gastos/);
  d.filtrarCuentaMovimientos('Archivada <demo>');
  assert.equal(d.filtrar()[0][5],'Archivada <demo>','se puede filtrar una cuenta archivada observada en el historial');
  assert.match(el('filterPill').innerHTML,/Archivada &lt;demo&gt;/,'las etiquetas históricas se escapan');
  const renombrado=datos.transacciones.find(t=>t[6]==='Gasto septiembre');renombrado[5]='Cuenta renombrada';d.render();
  assert.doesNotMatch(el('filterPill').innerHTML,/Archivada &lt;demo&gt;/,'renombrar una cuenta limpia el filtro por su nombre anterior');
  assert.equal(d.filtrar()[0][6],'Gasto septiembre','el movimiento conserva su ID y vuelve a ser visible tras renombrar');
  assert.equal(d.filtrar()[0][5],'Cuenta renombrada');
  el('searchInp').value='';d.filtrarBusqueda();d.quitarFiltro();
  n.abrirMesPicker();n.seleccionarTodoTiempo();n.aplicarMesPicker();const todoTiempo=inicio();d.toggleMovimientosUSD();
  assert.deepEqual(d.filtrar().map(t=>t[6]),['Compra dólares','Gasto dólares'],'USD incluye la compra con dólares en destino y el gasto original USD');
  assert.deepEqual(inicio(),todoTiempo,'filtrar USD en el detalle tampoco cambia el resumen');
  d.filtrarCuentaMovimientos('BCP Dólares');
  assert.equal(d.filtrar().length,2,'el filtro de cuenta incluye origen y destino de transferencias');
  c.toggleVistaUSD();const inicioUSD=inicio();
  el('searchInp').value='Compra dólares';d.filtrarBusqueda();assert.deepEqual(inicio(),inicioUSD,'buscar en el detalle conserva los KPI USD del período compartido');
  c.toggleVistaUSD();
  n.abrirMesPicker();n.seleccionarMesPicker(9);n.aplicarMesPicker();d.togglePillTipo('gastos',true);
  assert.equal(document.querySelector('.page.active').id,'p-dash','el KPI mantiene Inicio activo y abre su panel');
  assert.ok(d.filtrar().length>0&&d.filtrar().every(t=>t[3]==='Gasto'),'el KPI elimina filtros anteriores y muestra los gastos de su período');
  assert.deepEqual(inicio(),inicial);
  d.toggleSearch();assert.equal(el('searchWrap').classList.contains('show'),true,'la lupa muestra el campo desde el primer acceso');
  el('searchInp').value='Alquiler';d.filtrarBusqueda();d.ocultarBusquedaInicio();
  assert.equal(el('searchWrap').inert,true);assert.equal(el('searchInp').value,'');assert.equal(el('searchToggle').getAttribute('aria-expanded'),'false');
  assert.ok(d.filtrar().length>1,'el cierre del detalle puede limpiar la búsqueda sin un render reentrante');
  d.togglePillTipo('todos');reembolso[5]='Yape';reembolso[6]='refund-yape';d.render();
  d.filtrarCuentaMovimientos('Yape');
  assert.equal(d.filtrar().length,1);assert.equal(el('searchCount').textContent,'1 movimiento en este período');
  assert.match(el('txs').innerHTML,/Reembolso · Compras/,'la devolución filtrada muestra su tipo');
  assert.match(el('txs').innerHTML,/class="tdesc">Devolución/,'conserva su descripción');
  assert.match(el('txs').innerHTML,/class="tamt-pill in">.*\+ S\/ 10/,'la devolución independiente muestra importe positivo');
  assert.match(el('txs').innerHTML,/editarTx\('refund-yape'\)/,'editar abre el ID de la devolución y no el gasto original');
  assert.match(el('txs').innerHTML,/class="day-total in">\+ S\/ 10/,'el total del día incluye una devolución independiente como entrada');
  assert.doesNotMatch(el('txs').innerHTML,/Sin transacciones|Compra octubre/);
  d.filtrarCuentaMovimientos(null);
  assert.equal((el('txs').innerHTML.match(/editarTx\('refund-yape'\)/g)||[]).length,1,'con Todas las cuentas la devolución aparece una sola vez');
  assert.match(el('txs').innerHTML,/class="tx-refund-line".*editarTx\('refund-yape'\)/,'cuando el gasto está visible, la devolución vuelve a anidarse');
  assert.match(el('txs').innerHTML,/class="day-total out">− S\/ 3/,'el total del día no vuelve a sumar una devolución ya anidada');
  assert.equal((el('txs').innerHTML.match(/class="tx"/g)||[]).length,8);
  assert.equal(el('searchCount').textContent,'8 movimientos en este período','el contador cuenta filas principales y omite la devolución anidada');
  d.toggleSearch();el('searchInp').value='Devolución';d.filtrarBusqueda();
  assert.equal(el('searchCount').textContent,'1 movimiento encontrado');
  n.setPg('dash');assert.equal(el('homeMovements').classList.contains('expanded'),false,'un segundo toque en Inicio cierra su detalle');
  assert.equal(el('homeMovements').inert,true);assert.equal(el('homeMovements').getAttribute('aria-hidden'),'true');
  assert.equal(el('homeSummary').classList.contains('expanded'),true,'al cerrar el historial regresa el resumen');
  assert.equal(el('searchWrap').inert,true);assert.equal(el('searchCount').textContent,'8 movimientos en este período','cerrar el detalle limpia el buscador sin perder el historial');
  n.setPg('dash');assert.equal(el('homeMovements').classList.contains('expanded'),true,'el siguiente toque vuelve a abrir el historial completo');
  assert.equal((el('txs').innerHTML.match(/class="tx"/g)||[]).length,8);
  assert.equal([...sinControles].some(id=>nodos.has(id)),false,'el render no recrea los controles visuales retirados');
  console.log('PASS: Inicio comparte período con su historial completo desplegable, conserva saldo/KPI al filtrar, alterna la búsqueda y muestra reembolsos sin duplicarlos.');
})().catch(e=>{console.error(e);process.exitCode=1;});
