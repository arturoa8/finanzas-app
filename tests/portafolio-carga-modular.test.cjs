const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const RealDate=Date,now=RealDate.parse('2026-10-02T10:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const nodos=new Map();
function nodo(id){return {id,style:{},dataset:{},hidden:false,innerHTML:'',textContent:'',value:'',attrs:{},classList:{add(){},remove(){},toggle(){},contains:()=>id==='p-ana'},querySelector:s=>id==='pfDistArea'&&s==='svg'?nodo('svg'):null,querySelectorAll:()=>[],replaceChildren(){},append(){},appendChild(){},addEventListener(){},setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;}};}
document.hidden=false;document.querySelector=()=>null;
document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
document.getElementById=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'demo',expires_at:now+3600000}));
function aplazado(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
const extras=aplazado(),precios=aplazado();let preciosPedidos=0,extrasListos=false,actualizacion=precios,fallarExtras=false;
const historial=['2026-09-30','2026-10-01'].map((fecha,i)=>({id:'h'+i,fecha_valoracion:fecha,cuenta_ibkr:'CUENTA_DEMO',valor_total:1000,efectivo:0,valor_posiciones:1000,pnl_no_realizado:0,moneda_base:'USD'}));
const posiciones=[{id:'p1',cuenta_ibkr:'CUENTA_DEMO',contract_id:1,simbolo:'CSPX',nombre:'Activo de prueba',cantidad:10,precio_mercado:100,valor_mercado_base:1000,costo_promedio:100,multiplicador:1,moneda:'USD',moneda_base:'USD',tipo_activo:'STK',fecha_datos:'2026-10-01',pnl_no_realizado_base:0}];
const quotes=[{status:'ok',account:'CUENTA_DEMO',contract_id:1,ibkr_symbol:'CSPX',currency:'USD',price:104,previous_close:100,price_at:'2026-10-02T09:58:00Z',session_start:'2026-10-02T07:00:00Z',session_end:'2026-10-02T15:30:00Z',intraday:{interval:'2m',points:[{t:now-10800000,price:100},{t:now-7200000,price:102},{t:now-120000,price:104}]}}];
globalThis.fetch=async url=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),historia=u.searchParams.get('historia');let rows=[];
  if(u.pathname.includes('/functions/')){if(!historia)preciosPedidos++;await actualizacion.promise;return Response.json({quotes:historia?quotes.map(q=>({...q,points:q.intraday.points,interval:historia==='1S'?'5m':'15m'})):quotes});}
  if(tabla==='portafolio_historial')rows=historial;
  if(tabla==='posiciones')rows=posiciones;
  if(['configuracion_integraciones','posiciones_historial','reconciliaciones_portafolio','portafolio_snapshots','sincronizaciones_portafolio'].includes(tabla)){await extras.promise;extrasListos=true;if(fallarExtras)throw Error('Fallo auxiliar simulado');}
  if(tabla==='configuracion_integraciones')rows=[{cuenta_ibkr:'CUENTA_DEMO'}];
  if(tabla==='guardar_snapshot_portafolio')rows=[{estado:'omitido'}];
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json','content-range':(rows.length?'0-'+(rows.length-1):'*')+'/'+rows.length}});
};
async function esperar(condicion){for(let i=0;i<100;i++){if(condicion())return;await new Promise(r=>setTimeout(r,2));}throw Error('No llegó el estado esperado.');}
(async()=>{
  const p=await modulo('modules/portfolio/portfolio.js'),m=await modulo('services/market-data.js');
  try{
    const carga=p.renderPortafolio();carga.catch(()=>{});
    await esperar(()=>preciosPedidos===1);
    assert.equal(extrasListos,false,'Yahoo empieza sin esperar comparación ni diagnóstico');
    const area=document.getElementById('pfChartArea');
    assert.equal(document.getElementById('pfChartCard').style.display,'','gráfico visible antes de consultas auxiliares');
    assert.match(area.innerHTML,/Cargando rendimiento/);assert.doesNotMatch(area.innerHTML,/<svg/,'no pintar línea de dos cierres mientras llegan precios');
    assert.equal(area.getAttribute('aria-busy'),'true');
    precios.resolve();await esperar(()=>m.pfYahoo.status==='ok');
    assert.match(area.innerHTML,/<svg/);assert.doesNotMatch(area.innerHTML,/Cargando rendimiento/);assert.equal(area.getAttribute('aria-busy'),'false');
    assert.equal(extrasListos,false,'curva real disponible antes de comparación y diagnóstico');
    extras.resolve();await carga;
    const curva=area.innerHTML;
    await p.renderPortafolio();assert.equal(preciosPedidos,1,'volver a Portafolio reutiliza precios válidos');assert.equal(area.innerHTML,curva,'no sustituir curva válida por línea provisional');
    actualizacion=aplazado();const actualizando=m.refreshPfYahoo({force:true});
    assert.equal(m.pfYahoo.status,'loading');assert.equal(area.innerHTML,curva,'mantener curva real durante actualización de precios');
    actualizacion.resolve();await actualizando;assert.equal(preciosPedidos,2);
    fallarExtras=true;await p.renderPortafolio({force:true});assert.match(area.innerHTML,/<svg/,'una consulta auxiliar fallida no oculta la curva disponible');
    m.pfYahoo.quotes=[];m.pfYahoo.status='error';p.renderPfChart();
    assert.doesNotMatch(area.innerHTML,/Cargando rendimiento/);assert.match(document.getElementById('pfChartTitulo').textContent,/cierres IBKR/,'si Yahoo falla, mostrar cierre real identificado');
    console.log('PASS: curva sin línea provisional, consulta anticipada, caché al regresar y respaldo IBKR tras error.');
  }finally{extras.resolve();precios.resolve();actualizacion.resolve();p.limpiarCachePortafolio();m.stopPfYahoo();}
})().catch(e=>{console.error(e);process.exitCode=1;});
