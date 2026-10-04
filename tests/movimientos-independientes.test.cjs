// Inicio y el historial usan períodos y filtros distintos. DOM y datos
// ficticios: esta prueba no consulta ni modifica ninguna cuenta real.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';entornoPrueba();
const RealDate=Date,ahora=RealDate.parse('2026-10-04T12:00:00-05:00');
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[ahora]));}static now(){return ahora;}};
const nodos=new Map();let enfocado=null;
function el(id){
  if(!nodos.has(id)){
    const clases=new Set(),attrs=new Map();
    nodos.set(id,{id,dataset:{},style:{},textContent:'',innerHTML:'',value:'',hidden:false,
      classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
        toggle(x,force){const on=force??!clases.has(x);if(on)clases.add(x);else clases.delete(x);return on;}},
      setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),
      querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){},append(){},appendChild(){},addEventListener(){},focus(){enfocado=id;}});
  }
  return nodos.get(id);
}
const paginas=['dash','tx','ana','card','bud','pres','deb'].map(p=>el('p-'+p));
document.getElementById=el;
document.querySelector=s=>s==='.page.active'?paginas.find(p=>p.classList.contains('active'))||null:s==='.fab'?el('fab'):null;
document.querySelectorAll=s=>s==='.page'?paginas:s==='.nt'?['dash','tx','ana','card','more'].map(p=>el('nav-'+p)):[];
document.createElement=el;document.createElementNS=(_,tag)=>el(tag);
globalThis.window={scrollY:0,scrollTo(){}};globalThis.matchMedia=()=>({matches:true});
globalThis.fetch=async()=>{throw new Error('Esta prueba no permite consultas de red');};
el('p-dash').classList.add('active');el('searchWrap').classList.add('show');
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
  const inicio=()=>[el('balAmt').dataset.value,el('kpiOut').textContent,el('kpiIn').textContent,el('quickInsight').innerHTML,el('recentTxs').innerHTML];
  const inicial=inicio();
  assert.equal((el('recentTxs').innerHTML.match(/class="tx"/g)||[]).length,5,'Inicio limita la vista previa a cinco operaciones');
  assert.doesNotMatch(el('recentTxs').innerHTML,/Futuro|Sueldo septiembre/,'la vista previa excluye futuros y meses fuera del período de Inicio');
  n.setPg('tx');n.abrirMesPicker('movimientos');n.seleccionarMesPicker(8);n.aplicarMesPicker();
  assert.equal(n.getMesActivo().getMonth(),9,'aplicar el calendario de Movimientos no cambia el mes de Inicio');
  assert.deepEqual(d.filtrar().map(t=>t[6]),['Sueldo septiembre','Gasto septiembre']);
  assert.deepEqual(inicio(),inicial,'cambiar el período del historial no altera Inicio');
  el('searchInp').value='Gasto septiembre';d.filtrarBusqueda();d.filtrarPorCat('Comida');d.togglePillTipo('gastos');
  assert.equal(d.filtrar().length,1);assert.deepEqual(inicio(),inicial,'buscar y filtrar categoría/tipo no altera el resumen ni los recientes');
  assert.equal(el('txTipoGastos').getAttribute('aria-pressed'),'true');
  el('txCuenta').value='Archivada <demo>';d.filtrarCuentaMovimientos();
  assert.equal(d.filtrar()[0][5],'Archivada <demo>','se puede filtrar una cuenta archivada observada en el historial');
  assert.match(el('txCuenta').innerHTML,/Archivada &lt;demo&gt;/,'las etiquetas históricas se escapan');
  assert.equal(el('txCuenta').value,'Archivada <demo>','el select conserva su filtro después de repintar');
  const renombrado=datos.transacciones.find(t=>t[6]==='Gasto septiembre');renombrado[5]='Cuenta renombrada';d.render();
  assert.equal(el('txCuenta').value,'','renombrar una cuenta limpia el filtro por su nombre anterior');
  assert.doesNotMatch(el('txCuenta').innerHTML,/Archivada &lt;demo&gt;/,'el dropdown no reinserta el nombre que ya no aparece en los movimientos');
  assert.equal(d.filtrar()[0][6],'Gasto septiembre','el movimiento conserva su ID y vuelve a ser visible tras renombrar');
  assert.equal(d.filtrar()[0][5],'Cuenta renombrada');
  el('searchInp').value='';d.filtrarBusqueda();d.quitarFiltro();d.togglePillTipo('todos');el('txCuenta').value='';d.filtrarCuentaMovimientos();
  d.setPeriodoMovimientos(null);d.toggleMovimientosUSD();
  assert.deepEqual(d.filtrar().map(t=>t[6]),['Compra dólares','Gasto dólares'],'USD incluye la compra con dólares en destino y el gasto original USD');
  assert.deepEqual(inicio(),inicial,'la moneda del historial tampoco cambia Inicio');
  el('txCuenta').value='BCP Dólares';d.filtrarCuentaMovimientos();
  assert.equal(d.filtrar().length,2,'el filtro de cuenta incluye origen y destino de transferencias');
  c.toggleVistaUSD();const inicioUSD=inicio();
  d.setPeriodoMovimientos({anio:2026,mes:8});assert.deepEqual(inicio(),inicioUSD,'los KPI USD de Inicio conservan su propio período');
  c.toggleVistaUSD();
  n.setPg('dash');d.togglePillTipo('gastos');
  assert.equal(document.querySelector('.page.active').id,'p-tx','el KPI de Inicio abre Movimientos');
  assert.deepEqual(d.getPeriodoMovimientos(),{anio:2026,mes:9});
  assert.ok(d.filtrar().length>0&&d.filtrar().every(t=>t[3]==='Gasto'),'el KPI elimina filtros anteriores y muestra los gastos de su período');
  assert.deepEqual(inicio(),inicial);
  n.setPg('dash');d.toggleSearch();assert.equal(document.querySelector('.page.active').id,'p-tx');
  assert.equal(enfocado,'searchInp');assert.equal(el('searchWrap').classList.contains('show'),true,'Buscar abre el historial y mantiene visible el campo desde el primer acceso');
  const copia=d.getPeriodoMovimientos();copia.mes=0;assert.equal(d.getPeriodoMovimientos().mes,9,'el getter no permite mutar el período desde fuera');
  d.togglePillTipo('todos');reembolso[5]='Yape';reembolso[6]='refund-yape';d.render();
  el('txCuenta').value='Yape';d.filtrarCuentaMovimientos();
  assert.equal(d.filtrar().length,1);assert.equal(el('searchCount').textContent,'1 movimiento en este período');
  assert.match(el('txs').innerHTML,/Reembolso · Compras/,'la devolución filtrada muestra su tipo');
  assert.match(el('txs').innerHTML,/class="tdesc">Devolución/,'conserva su descripción');
  assert.match(el('txs').innerHTML,/class="tamt-pill in">.*\+ S\/ 10/,'la devolución independiente muestra importe positivo');
  assert.match(el('txs').innerHTML,/editarTx\('refund-yape'\)/,'editar abre el ID de la devolución y no el gasto original');
  assert.match(el('txs').innerHTML,/class="day-total in">\+ S\/ 10/,'el total del día incluye una devolución independiente como entrada');
  assert.doesNotMatch(el('txs').innerHTML,/Sin transacciones|Compra octubre/);
  el('txCuenta').value='';d.filtrarCuentaMovimientos();
  assert.equal((el('txs').innerHTML.match(/editarTx\('refund-yape'\)/g)||[]).length,1,'con Todas las cuentas la devolución aparece una sola vez');
  assert.match(el('txs').innerHTML,/class="tx-refund-line".*editarTx\('refund-yape'\)/,'cuando el gasto está visible, la devolución vuelve a anidarse');
  assert.match(el('txs').innerHTML,/class="day-total out">− S\/ 3/,'el total del día no vuelve a sumar una devolución ya anidada');
  assert.equal((el('txs').innerHTML.match(/class="tx"/g)||[]).length,8);
  assert.equal(el('searchCount').textContent,'8 movimientos en este período','el contador cuenta filas principales y omite la devolución anidada');
  console.log('PASS: Inicio y Movimientos conservan períodos/monedas separados, filtros históricos, cinco recientes sin futuros, accesos por KPI y búsqueda.');
})().catch(e=>{console.error(e);process.exitCode=1;});
