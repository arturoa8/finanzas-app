const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const RealDate=Date;let now=RealDate.parse('2026-10-02T10:00:00Z'),activo=false;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const nodos=new Map();
function nodo(id){return {id,style:{},dataset:{},hidden:false,innerHTML:'',textContent:'',value:'',attrs:{},classList:{add(){},remove(){},toggle(){},contains:()=>id==='p-ana'&&activo},querySelector:s=>id==='pfDistArea'&&s==='svg'?nodo('svg'):null,querySelectorAll:()=>[],replaceChildren(){},append(){},appendChild(){},addEventListener(){},setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;}};}
document.hidden=false;document.querySelector=()=>null;document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
document.getElementById=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
const sesion=id=>localStorage.setItem('sb_session',JSON.stringify({user_id:id,access_token:id,expires_at:now+3600000}));
function aplazado(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
const bases=new Map(),precios=new Map(),auxiliares=new Map(),pedidos=new Map();let falloBase=false;
const cuenta=id=>'CUENTA_'+id;
const historial=id=>['2026-09-30','2026-10-01'].map((fecha,i)=>({id:'h'+i,fecha_valoracion:fecha,cuenta_ibkr:cuenta(id),valor_total:1000,efectivo:0,valor_posiciones:1000,pnl_no_realizado:0,moneda_base:'USD'}));
const posiciones=id=>[{id:'p1',cuenta_ibkr:cuenta(id),contract_id:1,simbolo:'CSPX',nombre:'Activo de prueba',cantidad:10,precio_mercado:100,valor_mercado_base:1000,costo_promedio:100,multiplicador:1,moneda:'USD',moneda_base:'USD',tipo_activo:'STK',fecha_datos:'2026-10-01',pnl_no_realizado_base:0}];
const quotes=id=>[{status:'ok',account:cuenta(id),contract_id:1,ibkr_symbol:'CSPX',currency:'USD',price:104,previous_close:100,price_at:'2026-10-02T09:58:00Z',session_start:'2026-10-02T07:00:00Z',session_end:'2026-10-02T15:30:00Z',intraday:{interval:'2m',points:[{t:now-10800000,price:100},{t:now-120000,price:104}]}}];
const contar=(id,tabla)=>pedidos.get(id+'|'+tabla)||0;
globalThis.fetch=async(url,opts)=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),id=opts.headers.Authorization.slice(7),historia=u.searchParams.get('historia'),tipo=historia?'historia_'+historia:tabla,key=id+'|'+tipo;
  pedidos.set(key,contar(id,tipo)+1);let rows=[];
  if(tabla==='cotizaciones-yahoo'){await precios.get(id)?.promise;return Response.json({quotes:quotes(id)});}
  if(['portafolio_historial','posiciones','operaciones_ibkr'].includes(tabla)){await bases.get(id)?.promise;if(falloBase)throw Error('Base temporalmente inaccesible');}
  if(['configuracion_integraciones','sincronizaciones_portafolio','posiciones_historial','reconciliaciones_portafolio','portafolio_snapshots'].includes(tabla))await auxiliares.get(id)?.promise;
  if(tabla==='portafolio_historial')rows=historial(id);
  if(tabla==='posiciones')rows=posiciones(id);
  if(tabla==='configuracion_integraciones')rows=[{cuenta_ibkr:cuenta(id)}];
  if(tabla==='sincronizaciones_portafolio')rows=[{id:'sync_'+id,estado:'ok',iniciado_en:'2026-10-02T08:00:00Z',finalizado_en:'2026-10-02T08:01:00Z'}];
  if(tabla==='guardar_snapshot_portafolio')rows=[{estado:'omitido'}];
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json','content-range':(rows.length?'0-'+(rows.length-1):'*')+'/'+rows.length}});
};
async function esperar(condicion){for(let i=0;i<100;i++){if(condicion())return;await new Promise(r=>setTimeout(r,2));}throw Error('No llegó el estado esperado.');}
(async()=>{
  const p=await modulo('modules/portfolio/portfolio.js'),m=await modulo('services/market-data.js');
  try{
    sesion('A');bases.set('A',aplazado());precios.set('A',aplazado());
    const primera=p.precargarPortafolio(),segunda=p.precargarPortafolio();
    await esperar(()=>contar('A','posiciones')===1);bases.get('A').resolve();await Promise.all([primera,segunda]);
    await esperar(()=>contar('A','cotizaciones-yahoo')===1);
    assert.equal(nodos.size,1,'la precarga solo comprueba visibilidad y no pinta Portafolio oculto');assert.equal(m.pfYahoo.timer,null);
    assert.equal(contar('A','portafolio_historial'),1);assert.equal(contar('A','operaciones_ibkr'),1);
    activo=true;const entrada=p.renderPortafolio();await esperar(()=>document.getElementById('pfChartArea').innerHTML.includes('Cargando rendimiento'));
    assert.equal(contar('A','posiciones'),1,'entrar reutiliza la base');assert.equal(contar('A','cotizaciones-yahoo'),1,'la entrada comparte Yahoo en curso');
    precios.get('A').resolve();await entrada;await esperar(()=>m.pfYahoo.status==='ok');
    assert.match(document.getElementById('pfChartArea').innerHTML,/<svg/);m.stopPfYahoo();activo=false;
    now+=61000;await p.precargarPortafolio();assert.equal(contar('A','posiciones'),2,'el caché IBKR se renueva tras su TTL');assert.equal(m.pfYahoo.timer,null);
    activo=true;await p.renderPortafolio({force:true});assert.equal(contar('A','posiciones'),3,'la actualización manual ignora el TTL');m.stopPfYahoo();activo=false;

    p.limpiarCachePortafolio();sesion('AUX');auxiliares.set('AUX',aplazado());await p.precargarPortafolio();
    sesion('BASE_LISTA');await p.precargarPortafolio();await esperar(()=>p.pfUltimaSyncCache?.id==='sync_BASE_LISTA');
    auxiliares.get('AUX').resolve();await new Promise(r=>setTimeout(r,5));
    assert.equal(p.pfUltimaSyncCache.id,'sync_BASE_LISTA','los auxiliares tardíos no repueblan la caché de otra sesión');

    p.limpiarCachePortafolio();sesion('VIEJO');bases.set('VIEJO',aplazado());const viejo=p.precargarPortafolio();
    await esperar(()=>contar('VIEJO','posiciones')===1);sesion('NUEVO');await p.precargarPortafolio();
    bases.get('VIEJO').resolve();assert.equal(await viejo,null,'una base de la sesión anterior se descarta');
    assert.equal(p.pfPosicionesCache[0].cuenta_ibkr,'CUENTA_NUEVO');await esperar(()=>m.pfYahoo.status==='ok');assert.equal(m.pfYahoo.quotes[0].account,'CUENTA_NUEVO');

    p.limpiarCachePortafolio();sesion('LENTO');precios.set('LENTO',aplazado());await p.precargarPortafolio();await esperar(()=>contar('LENTO','cotizaciones-yahoo')===1);
    sesion('OTRO');p.limpiarCachePortafolio();await p.precargarPortafolio();await esperar(()=>m.pfYahoo.status==='ok');
    precios.get('LENTO').resolve();await new Promise(r=>setTimeout(r,5));assert.equal(m.pfYahoo.quotes[0].account,'CUENTA_OTRO','un Yahoo anterior no pisa la nueva sesión');assert.equal(m.pfYahoo.timer,null);

    p.limpiarCachePortafolio();sesion('ERROR');falloBase=true;await assert.rejects(p.precargarPortafolio(),/Base temporalmente/);
    falloBase=false;await p.precargarPortafolio();assert.equal(contar('ERROR','posiciones'),2,'una precarga fallida permite reintentar al entrar');
    p.limpiarCachePortafolio();localStorage.removeItem('sb_session');const antes=[...pedidos.values()].reduce((a,b)=>a+b,0);
    assert.equal(await p.precargarPortafolio(),null);assert.equal([...pedidos.values()].reduce((a,b)=>a+b,0),antes,'no consultar datos sin sesión');
    console.log('PASS: precarga compartida, Yahoo oculto sin polling, TTL, refresco manual, errores recuperables y respuestas tardías entre usuarios.');
  }finally{for(const gate of bases.values())gate.resolve();for(const gate of precios.values())gate.resolve();for(const gate of auxiliares.values())gate.resolve();m.stopPfYahoo();}
})().catch(e=>{console.error(e);process.exitCode=1;});
