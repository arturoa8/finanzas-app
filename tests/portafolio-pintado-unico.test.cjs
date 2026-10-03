// Entrar a Portafolio con los datos ya cargados dibuja el gráfico UNA vez,
// y la pestaña se muestra antes de calcularlo. Antes, Yahoo, la lista de
// posiciones, el pintado base y los datos auxiliares lo dibujaban cada uno
// (cuatro veces) dentro del mismo toque, y el iPhone tardaba en cambiar.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const RealDate=Date,now=RealDate.parse('2026-10-02T10:00:00Z');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const nodos=new Map();let dibujos=0;
function nodo(id){
  let html='';
  return {id,style:{},dataset:{},hidden:false,textContent:'',value:'',attrs:{},
    get innerHTML(){return html;},
    set innerHTML(v){html=String(v);if(id==='pfChartArea')dibujos++;},
    classList:{add(){},remove(){},toggle(){},contains:()=>id==='p-ana'},
    querySelector:s=>id==='pfDistArea'&&s==='svg'?nodo('svg'):null,querySelectorAll:()=>[],
    replaceChildren(){},append(){},appendChild(){},addEventListener(){},
    setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;}};
}
document.hidden=false;document.querySelector=()=>null;document.querySelectorAll=()=>[];
document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
document.getElementById=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
globalThis.window=globalThis;window.scrollTo=()=>{};
const cuadros=[];globalThis.requestAnimationFrame=fn=>{cuadros.push(fn);return cuadros.length;};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'demo',expires_at:now+3600000}));
const historial=['2026-09-30','2026-10-01'].map((fecha,i)=>({id:'h'+i,fecha_valoracion:fecha,cuenta_ibkr:'CUENTA_DEMO',valor_total:1000,efectivo:0,valor_posiciones:1000,pnl_no_realizado:0,moneda_base:'USD'}));
const posiciones=[{id:'p1',cuenta_ibkr:'CUENTA_DEMO',contract_id:1,simbolo:'CSPX',nombre:'Activo de prueba',cantidad:10,precio_mercado:100,valor_mercado_base:1000,costo_promedio:100,multiplicador:1,moneda:'USD',moneda_base:'USD',tipo_activo:'STK',fecha_datos:'2026-10-01',pnl_no_realizado_base:0}];
const quotes=[{status:'ok',account:'CUENTA_DEMO',contract_id:1,ibkr_symbol:'CSPX',currency:'USD',price:104,previous_close:100,price_at:'2026-10-02T09:58:00Z',session_start:'2026-10-02T07:00:00Z',session_end:'2026-10-02T15:30:00Z',intraday:{interval:'2m',points:[{t:now-10800000,price:100},{t:now-7200000,price:102},{t:now-120000,price:104}]}}];
globalThis.fetch=async url=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),historia=u.searchParams.get('historia');let rows=[];
  if(u.pathname.includes('/functions/'))return Response.json({quotes:historia?quotes.map(q=>({...q,points:q.intraday.points,interval:historia==='1S'?'5m':'15m'})):quotes});
  if(tabla==='portafolio_historial')rows=historial;
  if(tabla==='posiciones')rows=posiciones;
  if(tabla==='configuracion_integraciones')rows=[{cuenta_ibkr:'CUENTA_DEMO'}];
  if(tabla==='guardar_snapshot_portafolio')rows=[{estado:'omitido'}];
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json','content-range':(rows.length?'0-'+(rows.length-1):'*')+'/'+rows.length}});
};
const pausa=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
  const p=await modulo('modules/portfolio/portfolio.js'),m=await modulo('services/market-data.js');
  try{
    // Primera entrada: precios y datos auxiliares llegan después; se espera
    // a que todo quede listo, como al volver a la pestaña minutos después.
    await p.renderPortafolio();
    for(let i=0;i<50&&m.pfYahoo.status!=='ok';i++)await pausa();
    assert.equal(m.pfYahoo.status,'ok');
    dibujos=0;
    await p.renderPortafolio();
    assert.equal(dibujos,1,'con los datos ya cargados, el gráfico se dibuja una sola vez');
    assert.match(document.getElementById('pfChartArea').innerHTML,/<svg/);
    assert.equal(document.getElementById('pfChartCard').style.display,'','el gráfico queda visible');

    // El cambio de pestaña no espera al cálculo: se dibuja tras el pintado.
    const navegacion=await modulo('ui/navigation.js');
    dibujos=0;
    navegacion.setPg('ana',nodo('nav-ana'));
    assert.equal(dibujos,0,'tocar Portafolio no dibuja dentro del mismo toque');
    assert.equal(cuadros.length,1,'el dibujo espera al siguiente cuadro');
    cuadros.shift()(0);
    for(let i=0;i<50&&!dibujos;i++)await pausa();
    assert.equal(dibujos,1,'después del pintado se dibuja una vez');
    console.log('PASS: un solo dibujo del gráfico al entrar y cambio de pestaña sin esperar al cálculo.');
  }finally{p.limpiarCachePortafolio();m.stopPfYahoo();}
})().catch(e=>{console.error(e);process.exitCode=1;});
