// Navegación con datos y DOM ficticios. Nunca abre una conexión real ni
// guarda movimientos, pagos, deudas o presupuestos.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {entornoPrueba,modulo,appRoot}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const timerReal=setTimeout;
const nodos=new Map(),pinturas=new Map(),rafPendientes=[],peticiones=[];
const paginas=['dash','ana','card','bud','pres','deb','settings'];
const principales=['dash','ana','card','bud','more'];
const modales=['modal','modalDeuda','cardPaymentModal','presupuestoModal','creditLineModal','moreModal'];
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
    setAttribute(k,v){attrs.set(k,String(v));if(k==='inert'||k==='hidden')this[k]=true;},getAttribute:k=>attrs.get(k)??null,
    removeAttribute(k){attrs.delete(k);if(k==='inert'||k==='hidden')this[k]=false;},hasAttribute:k=>attrs.has(k),
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
document.querySelectorAll=s=>s==='.page'?paginas.map(p=>el('p-'+p)):s==='.nt'?principales.map(p=>el('nav-'+p)):
  s==='.modal.active'?modales.map(el).filter(m=>m.classList.contains('active')):[];
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
el('homeMovements').inert=true;
el('homeMovements').setAttribute('aria-hidden','true');
el('homeMovements').contains=n=>['searchInp','txs','cats','searchCount'].includes(n?.id);
el('homeSummary').classList.add('expanded');el('homeSummary').setAttribute('aria-hidden','false');
el('homeSummary').contains=n=>['summaryShortcut','quickInsight'].includes(n?.id);
el('modal').contains=n=>['iDesc','iMonto','gestionarCuentas'].includes(n?.id);
el('nav-dash').setAttribute('aria-expanded','false');
el('searchInp').closest=s=>s==='#homeMovements'||s==='.home-movements'?el('homeMovements'):null;
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
function cerrarModales(){for(const id of modales)el(id).classList.remove('active');}
function principalEsperado(p){return ['pres','deb','settings'].includes(p)?'more':p;}
function comprobarPagina(p){
  assert.equal(activa()?.id,'p-'+p);
  assert.equal(paginas.filter(x=>el('p-'+x).classList.contains('active')).length,1,'una sola página visible');
  assert.deepEqual(principales.filter(x=>el('nav-'+x).classList.contains('active')),[principalEsperado(p)],'un solo destino principal activo');
  assert.equal(el('nav-'+principalEsperado(p)).getAttribute('aria-current'),'page','destino seleccionado anunciado');
}
function comprobarPanel(abierto){
  for(const [id,visible] of [['homeMovements',abierto],['homeSummary',!abierto]]){
    assert.equal(el(id).classList.contains('expanded'),visible,id+' sincroniza su expansión');
    assert.equal(el(id).inert,!visible,id+' deshabilita el panel oculto');
    assert.equal(el(id).getAttribute('aria-hidden'),String(!visible),id+' anuncia únicamente el panel visible');
  }
  assert.equal(el('nav-dash').getAttribute('aria-expanded'),String(abierto));
}

(async()=>{
  const [nav,{datos},pres,dashboard,settings]=await Promise.all([modulo('ui/navigation.js'),modulo('state.js'),modulo('modules/presupuestos.js'),modulo('modules/dashboard.js'),modulo('modules/settings.js')]);
  Object.assign(datos,{cargados:true,categoriasCargadas:true,cuentas:[['Plin','billetera','PEN',false,'cuenta-demo']],categorias:[['Compras','#00d68f']],
    transacciones:[],configTarjetas:[['Visa demo',1000,30,'Visa demo','💳',24,15]],pagosTarjetas:[],ciclosOverride:[],
    presupuestos:[],deudas:[],deudasArchivadas:[],deudasAbonos:[],recurrentes:[]});

  // Las superficies principales y las secundarias siguen estando separadas.
  const indice=fs.readFileSync(path.join(appRoot,'index.html'),'utf8');
  const ids=[...indice.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'el historial movido no duplica IDs con Inicio');
  const navIds=[...indice.matchAll(/<button\b[^>]*\bid="(nav-[^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(navIds,['nav-dash','nav-ana','nav-card','nav-bud','nav-more']);
  const seccion=p=>{
    const inicio=indice.indexOf('id="p-'+p+'"');assert.ok(inicio>=0,'existe '+p);
    const despues=indice.slice(inicio).search(/\n<div class="page(?: active)?"/);
    return indice.slice(inicio,despues<0?indice.indexOf('<!-- FAB -->',inicio):inicio+despues);
  };
  assert.doesNotMatch(indice,/id="p-tx"|id="recentTxs"/);
  assert.doesNotMatch(indice,/id="settingsModal"/,'Configuración tiene una página propia');
  assert.match(seccion('settings'),/id="settingsBack"/);
  assert.match(seccion('dash'),/class="[^"]*expanded[^"]*"[^>]*id="homeSummary"/);
  assert.match(seccion('dash'),/id="homeMovements"[^>]*\binert\b/);assert.match(seccion('dash'),/id="txs"/);assert.match(seccion('dash'),/id="cats"/);
  assert.doesNotMatch(seccion('dash'),/id="txUsd"|id="txTipoTodos"|id="txCuenta"/,'el historial no conserva los filtros retirados');
  assert.match(seccion('pres'),/id="presupuestosSeccion"/);assert.doesNotMatch(seccion('bud'),/id="presupuestosSeccion"/);
  assert.match(indice,/<button\b[^>]*id="nav-more"[^>]*aria-controls="moreModal"/);
  const mas=indice.slice(indice.indexOf('id="moreModal"'),indice.indexOf('<!-- Bottom nav'));
  assert.doesNotMatch(mas,/abrirDesdeMas\('bud'\)/,'Estadísticas tiene su acceso principal');

  // Inicio se muestra compacto al entrar; volver a tocarlo revela el historial.
  nav.setPg('card');await pintarPendientes();
  nav.setPg('dash');await pintarPendientes();comprobarPagina('dash');
  comprobarPanel(false);
  nav.setPg('dash');await pintarPendientes();
  comprobarPanel(true);
  nav.mostrarMovimientosInicio();nav.mostrarMovimientosInicio();await pintarPendientes();
  comprobarPanel(true);
  document.activeElement=el('searchInp');nav.alternarMovimientosInicio();await pintarPendientes();
  comprobarPanel(false);
  assert.equal(document.activeElement,el('nav-dash'),'al cerrar el buscador no queda foco dentro del contenido inert');
  nav.setPg('tx');await pintarPendientes();comprobarPagina('dash');
  comprobarPanel(true);
  console.log('PASS: Inicio alterna resumen/historial, sincroniza accesibilidad y conserva el alias de Movimientos.');

  // Abrir/cerrar Más conserva el lugar de lectura del historial desplegado.
  window.scrollY=725;
  nav.abrirMas();
  assert.equal(el('moreModal').classList.contains('active'),true);assert.equal(activa().id,'p-dash');assert.equal(window.scrollY,725);
  assert.equal(el('nav-more').getAttribute('aria-expanded'),'true');
  nav.cerrarMas();
  assert.equal(el('moreModal').classList.contains('active'),false);assert.equal(activa().id,'p-dash');assert.equal(window.scrollY,725);
  assert.equal(el('homeMovements').classList.contains('expanded'),true);
  assert.equal(el('nav-more').getAttribute('aria-expanded'),'false');
  console.log('PASS: Más abre y cierra sin cambiar página ni desplazamiento.');

  // Estadísticas calcula indicadores sin repintar la página Presupuestos.
  const presupuestosAntes=pinturas.get('presupuestosLista')||0;
  nav.setPg('bud');await pintarPendientes();comprobarPagina('bud');
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

  // Cambiar de página conserva el historial, la búsqueda y el lugar de lectura.
  nav.setPg('dash');await pintarPendientes();comprobarPagina('dash');comprobarPanel(true);assert.equal(window.scrollY,725);
  dashboard.toggleSearch();el('searchInp').value='consulta conservada';dashboard.filtrarBusqueda();
  for(const [i,p] of ['card','bud','ana','pres','deb'].entries()){
    const desplazamiento=800+i*100;window.scrollY=desplazamiento;
    nav.setPg(p);comprobarPagina(p);comprobarPanel(true);
    assert.equal(el('searchInp').value,'consulta conservada',p+' no borra la búsqueda');
    assert.equal(el('searchWrap').classList.contains('show'),true,p+' conserva el buscador abierto');
    // Regresar inmediatamente también ejercita la cancelación del trabajo de Portafolio.
    nav.setPg('dash');await pintarPendientes();comprobarPagina('dash');comprobarPanel(true);
    assert.equal(window.scrollY,desplazamiento,p+' restaura el lugar de lectura del historial');
    assert.equal(el('searchInp').value,'consulta conservada');
  }
  document.activeElement=el('searchInp');nav.setPg('dash');await pintarPendientes();comprobarPanel(false);
  assert.equal(el('searchInp').value,'','el cierre explícito limpia la búsqueda');
  assert.equal(el('searchWrap').classList.contains('show'),false);assert.equal(el('searchWrap').inert,true);
  assert.equal(el('searchWrap').getAttribute('aria-hidden'),'true');assert.equal(el('searchWrap').hidden,false,'el buscador permanece disponible para su transición');
  assert.equal(document.activeElement,el('nav-dash'));assert.equal(window.scrollY,0);
  for(const p of ['card','bud','ana','pres','deb']){
    nav.setPg(p);nav.setPg('dash');await pintarPendientes();comprobarPagina('dash');comprobarPanel(false);
    assert.equal(window.scrollY,0,p+' vuelve al resumen que se había elegido');
  }
  document.activeElement=el('summaryShortcut');nav.mostrarMovimientosInicio();await pintarPendientes();comprobarPanel(true);
  assert.equal(document.activeElement,el('nav-dash'),'abrir el historial saca el foco del resumen antes de inert');
  nav.alternarMovimientosInicio();await pintarPendientes();document.activeElement=el('kpiOut');
  nav.mostrarMovimientosInicio();await pintarPendientes();
  assert.equal(document.activeElement,el('kpiOut'),'el balance permanece visible y conserva su foco al abrir el historial');
  console.log('PASS: ambas vistas de Inicio persisten por todas las páginas; historial conserva búsqueda y scroll.');

  // Cada acción flotante abre únicamente su formulario contextual.
  for(const [p,modal,label] of [['dash','modal','Nueva transacción'],['card','cardPaymentModal','Registrar pago'],['deb','modalDeuda','Nueva deuda']]){
    cerrarModales();nav.setPg(p);await pintarPendientes();comprobarPagina(p);
    assert.equal(el('fab').hidden,false);assert.equal(el('fab').getAttribute('aria-label'),label);
    nav.handleFab();assert.equal(el(modal).classList.contains('active'),true);
    for(const otro of ['modal','modalDeuda','cardPaymentModal','presupuestoModal'])if(otro!==modal)assert.equal(el(otro).classList.contains('active'),false,p+' no abre '+otro);
  }
  cerrarModales();
  // Los formularios tienen foco aplazado; terminarlo antes de comprobar el buscador.
  await new Promise(r=>timerReal(r,110));
  console.log('PASS: FAB contextual en Inicio, Tarjetas y Deudas.');

  // Configuración tiene página completa y vuelve al origen sin alternar Inicio.
  nav.mostrarMovimientosInicio();await pintarPendientes();window.scrollY=420;
  nav.abrirMas();nav.abrirConfiguracionDesdeMas();
  await pintarPendientes();comprobarPagina('settings');
  assert.equal(el('moreModal').classList.contains('active'),false);assert.equal(window.scrollY,0);
  assert.equal(el('fab').hidden,true);assert.equal(document.activeElement,el('settingsBack'));comprobarPanel(true);
  nav.handleFab();assert.equal(el('modal').classList.contains('active'),false,'Configuración no abre un formulario desde su FAB');
  settings.cerrarConfiguracion();await pintarPendientes();comprobarPagina('dash');comprobarPanel(true);
  assert.equal(window.scrollY,420);assert.equal(document.activeElement,el('nav-dash'));
  settings.cerrarConfiguracion();await pintarPendientes();comprobarPanel(true);
  assert.equal(window.scrollY,420,'un segundo cierre no alterna Inicio ni desplaza su historial');
  for(const p of ['card','ana','bud','pres','deb']){
    nav.setPg(p);window.scrollY=340;settings.abrirConfiguracion();await pintarPendientes();comprobarPagina('settings');
    // Abrir otra sección desde Configuración no puede reemplazar su origen.
    settings.abrirConfiguracion('cuentas');await pintarPendientes();comprobarPagina('settings');
    settings.cerrarConfiguracion();await pintarPendientes();comprobarPagina(p);assert.equal(window.scrollY,0);
  }
  console.log('PASS: Configuración completa vuelve a cada origen, conserva Inicio y limita su FAB.');

  // Gestionar cuentas desde un formulario conserva sus valores y devuelve el foco.
  nav.setPg('dash');await pintarPendientes();window.scrollY=510;
  el('modal').classList.add('active');el('iDesc').value='Movimiento sin guardar';el('iMonto').value='27.50';el('iDesc').focus();
  settings.abrirConfiguracion('cuentas');await pintarPendientes();comprobarPagina('settings');
  assert.equal(el('modal').classList.contains('active'),false,'el formulario no cubre Configuración');
  assert.equal(el('iDesc').value,'Movimiento sin guardar');assert.equal(el('iMonto').value,'27.50');
  settings.cerrarConfiguracion();await pintarPendientes();comprobarPagina('dash');comprobarPanel(true);
  assert.equal(el('modal').classList.contains('active'),true);assert.equal(document.activeElement,el('iDesc'));
  assert.equal(el('iDesc').value,'Movimiento sin guardar');assert.equal(el('iMonto').value,'27.50');assert.equal(window.scrollY,510);
  cerrarModales();
  console.log('PASS: Configuración desde un formulario conserva borrador, modal y foco sin escribir datos.');

  // Resumen e historial de Inicio comparten el mismo período del calendario.
  cerrarModales();
  const inicioOriginal=nav.getMesActivo();
  datos.transacciones=[
    [String(inicioOriginal.getFullYear()-1)+'-09-01','Gasto septiembre','Compras','Gasto',10,'Plin','septiembre-demo'],
    [String(inicioOriginal.getFullYear()-1)+'-10-01','Gasto octubre','Compras','Gasto',20,'Plin','octubre-demo'],
  ];
  nav.abrirMesPicker('movimientos');nav.cambiarAnioPicker(-1);nav.seleccionarMesPicker(8);nav.aplicarMesPicker();
  assert.equal(nav.getMesActivo().getFullYear(),inicioOriginal.getFullYear()-1);assert.equal(nav.getMesActivo().getMonth(),8);assert.equal(nav.vista,'mes');
  assert.deepEqual(dashboard.filtrarInicio().map(t=>t[6]),['septiembre-demo']);
  assert.deepEqual(dashboard.filtrar().map(t=>t[6]),dashboard.filtrarInicio().map(t=>t[6]),'historial y resumen usan el mismo mes');
  nav.abrirMesPicker('movimientos');nav.seleccionarTodoTiempo();nav.aplicarMesPicker();
  assert.equal(nav.vista,'total');assert.equal(el('chipPeriodoLbl').textContent,'Todo el tiempo');
  assert.deepEqual(dashboard.filtrar().map(t=>t[6]),['septiembre-demo','octubre-demo']);
  assert.deepEqual(dashboard.filtrar().map(t=>t[6]),dashboard.filtrarInicio().map(t=>t[6]));
  console.log('PASS: calendario compartido por el resumen y el historial de Inicio.');

  // Buscar abre el historial incluso si estaba cerrado, sin alternar al repetir.
  nav.alternarMovimientosInicio();await pintarPendientes();assert.equal(el('homeMovements').inert,true);
  dashboard.toggleSearch();await pintarPendientes();await new Promise(r=>timerReal(r,110));
  assert.equal(el('homeMovements').classList.contains('expanded'),true);assert.equal(el('homeMovements').inert,false);
  assert.equal(el('searchWrap').inert,false);assert.equal(el('searchWrap').getAttribute('aria-hidden'),'false');assert.equal(el('searchWrap').hidden,false);
  assert.equal(document.activeElement,el('searchInp'));
  dashboard.toggleSearch();await pintarPendientes();assert.equal(el('homeMovements').classList.contains('expanded'),true);
  const estilos=['dashboard.css','theme.css'].map(f=>fs.readFileSync(path.join(appRoot,'css',f),'utf8')).join('\n');
  assert.match(estilos,/@media\s*\(prefers-reduced-motion:\s*reduce\)/,'se respeta la preferencia de movimiento reducido');
  console.log('PASS: buscar revela el historial sin cerrarlo y se respeta movimiento reducido.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.setTimeout=timerReal;});
