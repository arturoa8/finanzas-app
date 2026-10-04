// Navegación con datos y DOM ficticios. Nunca abre una conexión real ni
// guarda movimientos, pagos, deudas o presupuestos.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {entornoPrueba,modulo,appRoot}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const timerReal=setTimeout;
const nodos=new Map(),pinturas=new Map(),rafPendientes=[],peticiones=[];
const paginas=['dash','tx','ana','card','bud','pres','deb'];
const principales=['dash','tx','ana','card','more'];
const eventosDocumento=new Map();

function nodo(id){
  const clases=new Set(),attrs=new Map();let html='',texto='',valor='';
  return {id,style:{setProperty(k,v){this[k]=v;}},dataset:{},hidden:false,disabled:false,inert:false,checked:false,scrollTop:0,
    offsetWidth:390,clientWidth:390,scrollHeight:3000,
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
      toggle(x,force){const on=force??!clases.has(x);if(on)clases.add(x);else clases.delete(x);return on;}},
    get innerHTML(){return html;},set innerHTML(v){html=String(v);pinturas.set(id,(pinturas.get(id)||0)+1);
      if(/^\s*<option\b/.test(html)){
        const opts=[...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
        const elegida=opts.find(o=>/\bselected\b/.test(o[1]))||opts[0];
        valor=elegida?(/\bvalue="([^"]*)"/.exec(elegida[1])?.[1]??elegida[2]):'';
      }
    },
    get textContent(){return texto;},set textContent(v){texto=String(v);pinturas.set(id,(pinturas.get(id)||0)+1);},
    get value(){return valor;},set value(v){valor=String(v??'');},
    setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k),
    querySelector:()=>null,querySelectorAll:()=>[],getClientRects:()=>[{}],closest:()=>null,contains:()=>false,
    getBoundingClientRect:()=>({top:0,bottom:640,left:0,right:390,width:390,height:640}),
    focus(){document.activeElement=this;},blur(){if(document.activeElement===this)document.activeElement=null;},
    addEventListener(){},removeEventListener(){},append(){},appendChild(){},replaceChildren(){},scrollIntoView(){},
  };
}
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
const activa=()=>paginas.map(p=>el('p-'+p)).find(p=>p.classList.contains('active'));
document.getElementById=el;
document.body=nodo('body');document.documentElement=nodo('html');document.activeElement=null;document.hidden=false;
document.querySelector=s=>s==='.page.active'?activa():s==='.fab'?el('fab'):s.startsWith('.nt[data-page=')?
  principales.map(p=>el('nav-'+p)).find(b=>s.includes('"'+b.dataset.page+'"')||s.includes("'"+b.dataset.page+"'"))||null:null;
document.querySelectorAll=s=>s==='.page'?paginas.map(p=>el('p-'+p)):s==='.nt'?principales.map(p=>el('nav-'+p)):[];
document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
document.addEventListener=(tipo,fn)=>{if(!eventosDocumento.has(tipo))eventosDocumento.set(tipo,[]);eventosDocumento.get(tipo).push(fn);};
globalThis.window={innerHeight:844,scrollX:0,scrollY:0,
  scrollTo(x,y){this.scrollY=typeof x==='object'?x.top:y;},
  matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),addEventListener(){},removeEventListener(){}};
globalThis.matchMedia=window.matchMedia;
globalThis.requestAnimationFrame=window.requestAnimationFrame=fn=>{rafPendientes.push(fn);return rafPendientes.length;};
globalThis.cancelAnimationFrame=window.cancelAnimationFrame=()=>{};
globalThis.setTimeout=(fn,ms,...a)=>{const t=timerReal(fn,ms,...a);if(ms>=1000)t.unref?.();return t;};
globalThis.fetch=async(url,opts={})=>{
  assert.equal(opts.method||'GET','GET','navegar y abrir formularios no escribe datos');
  peticiones.push(String(url));
  return new Response('[]',{status:200,headers:{'content-type':'application/json','content-range':'*/0'}});
};
for(const p of principales){el('nav-'+p).dataset.page=p;el('nav-'+p).classList.add('nt');}
el('p-dash').classList.add('active');el('nav-dash').classList.add('active');
el('iMoneda').value='PEN';
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:Date.now()+3600000}));

async function pintarPendientes(){
  for(let i=0;i<5;i++){
    const lote=rafPendientes.splice(0);lote.forEach(fn=>fn(performance.now()));
    await new Promise(r=>timerReal(r,2));
    if(!rafPendientes.length)return;
  }
  assert.fail('La navegación no termina de restaurar el desplazamiento');
}
function cerrarModales(){for(const id of ['modal','modalDeuda','cardPaymentModal','presupuestoModal','settingsModal','moreModal'])el(id).classList.remove('active');}
function principalEsperado(p){return ['bud','pres','deb'].includes(p)?'more':p;}
function comprobarPagina(p){
  assert.equal(activa()?.id,'p-'+p);
  assert.equal(paginas.filter(x=>el('p-'+x).classList.contains('active')).length,1,'una sola página visible');
  assert.deepEqual(principales.filter(x=>el('nav-'+x).classList.contains('active')),[principalEsperado(p)],'un solo destino principal activo');
  assert.equal(el('nav-'+principalEsperado(p)).getAttribute('aria-current'),'page','destino seleccionado anunciado');
}

(async()=>{
  const [nav,{datos},pres,dashboard]=await Promise.all([modulo('ui/navigation.js'),modulo('state.js'),modulo('modules/presupuestos.js'),modulo('modules/dashboard.js')]);
  Object.assign(datos,{cargados:true,categoriasCargadas:true,cuentas:[['Plin','billetera','PEN',false,'cuenta-demo']],categorias:[['Compras','#00d68f']],
    transacciones:[],configTarjetas:[['Visa demo',1000,30,'Visa demo','💳',24,15]],pagosTarjetas:[],ciclosOverride:[],
    presupuestos:[],deudas:[],deudasArchivadas:[],deudasAbonos:[],recurrentes:[]});

  // Las superficies principales y las secundarias siguen estando separadas.
  const indice=fs.readFileSync(path.join(appRoot,'index.html'),'utf8');
  const ids=[...indice.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'el historial movido no duplica IDs con Inicio');
  const navIds=[...indice.matchAll(/<button\b[^>]*\bid="(nav-[^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(navIds,['nav-dash','nav-tx','nav-ana','nav-card','nav-more']);
  const seccion=p=>{
    const inicio=indice.indexOf('id="p-'+p+'"');assert.ok(inicio>=0,'existe '+p);
    const despues=indice.slice(inicio).search(/\n<div class="page(?: active)?"/);
    return indice.slice(inicio,despues<0?indice.indexOf('<!-- FAB -->',inicio):inicio+despues);
  };
  assert.match(seccion('tx'),/id="txs"/);assert.doesNotMatch(seccion('dash'),/id="txs"/);
  assert.match(seccion('pres'),/id="presupuestosSeccion"/);assert.doesNotMatch(seccion('bud'),/id="presupuestosSeccion"/);
  assert.match(indice,/<button\b[^>]*id="nav-more"[^>]*aria-controls="moreModal"/);

  // Abrir/cerrar Más conserva el lugar de lectura de Movimientos.
  nav.setPg('tx');await pintarPendientes();comprobarPagina('tx');
  window.scrollY=725;
  nav.abrirMas();
  assert.equal(el('moreModal').classList.contains('active'),true);assert.equal(activa().id,'p-tx');assert.equal(window.scrollY,725);
  assert.equal(el('nav-more').getAttribute('aria-expanded'),'true');
  nav.cerrarMas();
  assert.equal(el('moreModal').classList.contains('active'),false);assert.equal(activa().id,'p-tx');assert.equal(window.scrollY,725);
  assert.equal(el('nav-more').getAttribute('aria-expanded'),'false');
  console.log('PASS: Más abre y cierra sin cambiar página ni desplazamiento.');

  // Estadísticas calcula indicadores sin repintar la página Presupuestos.
  const presupuestosAntes=pinturas.get('presupuestosLista')||0;
  nav.abrirMas();nav.abrirDesdeMas('bud');await pintarPendientes();comprobarPagina('bud');
  assert.equal(el('moreModal').classList.contains('active'),false);assert.equal(window.scrollY,0);
  assert.equal(pinturas.get('presupuestosLista')||0,presupuestosAntes,'Estadísticas no calcula presupuestos ocultos');
  assert.ok((pinturas.get('mAhorro')||0)>0,'se actualiza el resumen estadístico');
  assert.equal(el('fab').hidden,true,'Estadísticas no ofrece crear transacciones desde su FAB');
  const indicadoresAntes=pinturas.get('mAhorro');
  nav.abrirMas();nav.abrirDesdeMas('pres');await pintarPendientes();comprobarPagina('pres');
  assert.ok((pinturas.get('presupuestosLista')||0)>presupuestosAntes);assert.equal(pinturas.get('mAhorro'),indicadoresAntes,'Presupuestos no repinta Estadísticas');
  assert.equal(el('fab').hidden,false);assert.equal(el('fab').getAttribute('aria-label'),'Crear presupuesto');
  nav.handleFab();assert.equal(el('presupuestoModal').classList.contains('active'),true);assert.equal(el('modal').classList.contains('active'),false);
  pres.cerrarPresupuestoForm();
  console.log('PASS: Estadísticas y Presupuestos independientes; FAB crea presupuesto.');

  // Volver desde una secundaria restaura Movimientos tras el nuevo pintado.
  nav.setPg('tx');await pintarPendientes();comprobarPagina('tx');assert.equal(window.scrollY,725);
  window.scrollY=1080;nav.setPg('dash');await pintarPendientes();comprobarPagina('dash');assert.equal(window.scrollY,0);
  nav.setPg('tx');await pintarPendientes();comprobarPagina('tx');assert.equal(window.scrollY,1080);
  // Navegación inmediata cancela restauraciones viejas de Portafolio.
  nav.setPg('ana');assert.equal(el('fab').hidden,true);
  nav.setPg('tx');await pintarPendientes();comprobarPagina('tx');assert.equal(window.scrollY,1080,'Portafolio no reinicia el scroll después de volver');
  console.log('PASS: Movimientos conserva scroll y una carga anterior no lo sobrescribe.');

  // Cada acción flotante abre únicamente su formulario contextual.
  for(const [p,modal,label] of [['dash','modal','Nueva transacción'],['tx','modal','Nueva transacción'],['card','cardPaymentModal','Registrar pago'],['deb','modalDeuda','Nueva deuda']]){
    cerrarModales();nav.setPg(p);await pintarPendientes();comprobarPagina(p);
    assert.equal(el('fab').hidden,false);assert.equal(el('fab').getAttribute('aria-label'),label);
    nav.handleFab();assert.equal(el(modal).classList.contains('active'),true);
    for(const otro of ['modal','modalDeuda','cardPaymentModal','presupuestoModal'])if(otro!==modal)assert.equal(el(otro).classList.contains('active'),false,p+' no abre '+otro);
  }
  cerrarModales();
  console.log('PASS: FAB contextual en Inicio, Movimientos, Tarjetas y Deudas.');

  // Configuración se abre como modal desde Más, sin cambiar el destino activo.
  nav.setPg('tx');await pintarPendientes();window.scrollY=420;
  nav.abrirMas();nav.abrirConfiguracionDesdeMas();
  assert.equal(el('moreModal').classList.contains('active'),false);assert.equal(el('settingsModal').classList.contains('active'),true);
  assert.equal(activa().id,'p-tx');assert.equal(window.scrollY,420);
  console.log('PASS: Configuración desde Más conserva la página y no escribe datos.');

  // El mismo calendario edita únicamente el período desde el que se abrió.
  cerrarModales();
  const inicioOriginal=nav.getMesActivo(),movimientosOriginal=dashboard.getPeriodoMovimientos();
  nav.abrirMesPicker('movimientos');nav.cambiarAnioPicker(-1);nav.seleccionarMesPicker(8);nav.aplicarMesPicker();
  assert.deepEqual(dashboard.getPeriodoMovimientos(),{anio:movimientosOriginal.anio-1,mes:8});
  assert.equal(nav.getMesActivo().getTime(),inicioOriginal.getTime(),'cambiar Movimientos conserva el resumen de Inicio');
  assert.equal(nav.vista,'mes');
  const movimientosElegidos=dashboard.getPeriodoMovimientos();
  nav.abrirMesPicker();nav.cambiarAnioPicker(-2);nav.seleccionarMesPicker(2);nav.aplicarMesPicker();
  assert.equal(nav.getMesActivo().getFullYear(),inicioOriginal.getFullYear()-2);assert.equal(nav.getMesActivo().getMonth(),2);
  assert.deepEqual(dashboard.getPeriodoMovimientos(),movimientosElegidos,'cambiar Inicio conserva el período del historial');
  const inicioElegido=nav.getMesActivo().getTime();
  nav.abrirMesPicker('movimientos');nav.seleccionarTodoTiempo();nav.aplicarMesPicker();
  assert.equal(dashboard.getPeriodoMovimientos(),null);assert.equal(nav.vista,'mes');assert.equal(nav.getMesActivo().getTime(),inicioElegido);
  dashboard.setPeriodoMovimientos(movimientosOriginal);
  nav.abrirMesPicker();nav.seleccionarTodoTiempo();nav.aplicarMesPicker();
  assert.equal(nav.vista,'total');assert.deepEqual(dashboard.getPeriodoMovimientos(),movimientosOriginal);
  console.log('PASS: calendarios de Inicio y Movimientos independientes, incluidos todos los períodos.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.setTimeout=timerReal;});
