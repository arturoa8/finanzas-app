// Patrimonio usa el mismo valor actual que Portafolio y se recalcula al llegar
// precios: antes se calculaba una vez y, si Yahoo aún no había respondido, se
// quedaba con el cierre IBKR rezagado. Inicio muestra solo el importe y las
// explicaciones de composición quedan en Estadísticas.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const RealDate=Date,now=RealDate.parse('2026-10-02T10:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const nodos=new Map();
function nodo(id){
  return {id,style:{},dataset:{},hidden:false,textContent:'',innerHTML:'',value:'',attrs:{},
    classList:{add(){},remove(){},toggle(){},contains:()=>false},
    querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){},append(){},appendChild(){},addEventListener(){},
    setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;}};
}
document.hidden=false;document.querySelector=()=>null;document.querySelectorAll=()=>[];
document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
document.getElementById=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
globalThis.window=globalThis;window.scrollTo=()=>{};
const eventos=new EventTarget();
globalThis.addEventListener=eventos.addEventListener.bind(eventos);
globalThis.dispatchEvent=eventos.dispatchEvent.bind(eventos);
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'demo',expires_at:now+3600000}));
localStorage.setItem('tc_mercado',JSON.stringify({tc:3.7,fecha:'2026-10-02'}));
const historial=['2026-09-30','2026-10-01'].map((fecha,i)=>({id:'h'+i,fecha_valoracion:fecha,cuenta_ibkr:'CUENTA_DEMO',valor_total:1000,efectivo:0,valor_posiciones:1000,pnl_no_realizado:0,moneda_base:'USD'}));
const posiciones=[{id:'p1',cuenta_ibkr:'CUENTA_DEMO',contract_id:1,simbolo:'CSPX',nombre:'Activo de prueba',cantidad:10,precio_mercado:100,valor_mercado_base:1000,costo_promedio:100,multiplicador:1,moneda:'USD',moneda_base:'USD',tipo_activo:'STK',fecha_datos:'2026-10-01',pnl_no_realizado_base:0}];
const quotes=[{status:'ok',account:'CUENTA_DEMO',contract_id:1,ibkr_symbol:'CSPX',currency:'USD',price:104,previous_close:100,price_at:'2026-10-02T09:58:00Z',session_start:'2026-10-02T07:00:00Z',session_end:'2026-10-02T15:30:00Z',intraday:{interval:'2m',points:[{t:now-10800000,price:100},{t:now-120000,price:104}]}}];
let liberarYahoo;const yahooListo=new Promise(r=>{liberarYahoo=r;});
globalThis.fetch=async url=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),historia=u.searchParams.get('historia');let rows=[];
  if(u.pathname.includes('/functions/')){await yahooListo;return Response.json({quotes:historia?quotes.map(q=>({...q,points:q.intraday.points,interval:'15m'})):quotes});}
  if(tabla==='portafolio_historial')rows=historial;
  if(tabla==='posiciones')rows=posiciones;
  if(tabla==='configuracion_integraciones')rows=[{cuenta_ibkr:'CUENTA_DEMO'}];
  if(tabla==='guardar_snapshot_portafolio')rows=[{estado:'omitido'}];
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json','content-range':(rows.length?'0-'+(rows.length-1):'*')+'/'+rows.length}});
};
const pausa=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
  const p=await modulo('modules/portfolio/portfolio.js'),m=await modulo('services/market-data.js');
  const dashboard=await modulo('modules/dashboard.js'),{datos}=await modulo('state.js');
  try{
    datos.transacciones=[['2026-09-28','Sueldo','Salario','Ingreso',500,'Plin','t1']];datos.cuentas=[['Plin','billetera','PEN',false,'c1']];
    datos.configTarjetas=[];datos.pagosTarjetas=[];datos.cargados=true;
    await p.precargarPortafolio();
    dashboard.setModoBalance('patrimonio');
    const nota=document.getElementById('balNota');
    assert.equal(dashboard.patrimonio.estado,'loading');
    assert.equal(document.getElementById('balAmt').textContent,'—','el importe conserva un marcador corto mientras carga');
    assert.equal(nota.hidden,false,'la espera se explica en el aviso reservado del resumen');
    assert.equal(nota.textContent,'Cargando patrimonio…');
    assert.equal(nota.getAttribute('role'),'status','el aviso de carga también está disponible para lectores de pantalla');
    assert.equal(document.getElementById('balDot').style.visibility,'hidden','no se muestra un signo positivo sin un importe fiable');
    for(let i=0;i<50&&dashboard.patrimonio.estado==='loading';i++)await pausa();
    assert.equal(dashboard.patrimonio.soles,3700,'sin Yahoo todavía: el cierre IBKR sigue entrando al patrimonio');
    assert.equal(nota.hidden,true,'el desglose no ocupa espacio en Inicio');
    assert.equal(nota.textContent,'','no se muestra + IBKR ni su fuente junto al saldo');
    assert.equal(document.getElementById('balDot').style.visibility,'','el signo regresa al terminar la carga');
    liberarYahoo();
    for(let i=0;i<100&&!dashboard.patrimonio.enVivo;i++)await pausa();
    assert.equal(m.pfYahoo.status,'ok');
    assert.equal(dashboard.patrimonio.soles,3848,'al llegar Yahoo, Patrimonio se actualiza solo (US$ 1,040 × 3.7)');
    assert.equal(nota.hidden,true,'el desglose sigue oculto al llegar precios en vivo');
    assert.equal(nota.textContent,'');
    await new Promise(r=>setTimeout(r,120)); // el importe se anima 90 ms
    assert.equal(document.getElementById('balAmt').dataset.value,(500+3848).toFixed(2),'Neto 500 + IBKR 3,848');
    console.log('PASS: Patrimonio mantiene el cálculo con el cierre y precios en vivo, sin explicaciones debajo del importe en Inicio.');
  }finally{liberarYahoo();p.limpiarCachePortafolio();m.stopPfYahoo();}
})().catch(e=>{console.error(e);process.exitCode=1;});
