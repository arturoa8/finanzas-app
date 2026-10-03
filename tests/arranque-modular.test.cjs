// El inicio solo se revela con datos reales. Se ejercitan los módulos ESM
// completos con red aplazada y un DOM pequeño, sin conectarse a Supabase.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';

const nodos=new Map(),eventosVentana=new Map();
let animaciones=0,reducirMovimiento=true;
function nodo(id){
  const clases=new Set(),attrs=new Map(),eventos=new Map();
  return {id,style:{setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}},dataset:{},hidden:false,inert:false,disabled:false,
    innerHTML:'',textContent:'',value:'',offsetWidth:320,clientWidth:320,scrollHeight:640,
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),toggle(x,force){const next=force??!clases.has(x);if(next)clases.add(x);else clases.delete(x);return next;}},
    setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k),
    querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({x:0,y:0,width:320,height:640,top:0,bottom:640,left:0,right:320}),getClientRects:()=>[{}],
    contains:()=>false,matches:()=>false,closest:()=>null,append(){},appendChild(){},replaceChildren(){},remove(){},scrollIntoView(){},
    focus(){document.activeElement=this;},blur(){if(document.activeElement===this)document.activeElement=null;},
    addEventListener(type,handler){if(!eventos.has(type))eventos.set(type,new Set());eventos.get(type).add(handler);},removeEventListener(type,handler){eventos.get(type)?.delete(handler);},
    async click(){if(this.disabled)return;const e={target:this,currentTarget:this,preventDefault(){}};await Promise.all([this.onclick?.(e),...[...(eventos.get('click')||[])].map(fn=>fn(e))]);},
    animate(){animaciones++;return {finished:Promise.resolve(),cancel(){},finish(){},addEventListener(type,fn){if(type==='finish')queueMicrotask(fn);}};},getAnimations:()=>[],
  };
}
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
document.getElementById=el;
document.body=nodo('body');document.documentElement=nodo('html');document.activeElement=null;document.hidden=false;
document.querySelector=s=>s==='.page.active'?el('p-dash'):null;
document.querySelectorAll=s=>s==='.page'?[el('p-dash'),el('p-ana')]:[];
document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
globalThis.window={matchMedia:()=>({matches:reducirMovimiento,addEventListener(){},removeEventListener(){}}),scrollTo(){},
  addEventListener(type,fn){if(!eventosVentana.has(type))eventosVentana.set(type,new Set());eventosVentana.get(type).add(fn);},removeEventListener(type,fn){eventosVentana.get(type)?.delete(fn);}};
globalThis.matchMedia=window.matchMedia;
globalThis.requestAnimationFrame=window.requestAnimationFrame=fn=>{queueMicrotask(()=>fn(performance.now()));return 1;};
globalThis.cancelAnimationFrame=window.cancelAnimationFrame=()=>{};
globalThis.getComputedStyle=()=>({animationDuration:'0s',transitionDuration:'0s',getPropertyValue:()=>''});
globalThis.location={reload(){}};
el('p-dash').classList.add('active');el('authGate').style.display='flex';
el('authEmail').value='demo@example.test';el('authPassword').value='clave-demo';el('iMoneda').value='PEN';

// Toasts y refrescos de fondo no deben mantener vivo el proceso de prueba.
const timerReal=setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{const timer=timerReal(fn,ms,...args);if(ms>=1000)timer.unref?.();return timer;};
function aplazado(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function esperar(condicion,mensaje){for(let i=0;i<150;i++){if(condicion())return;await new Promise(r=>timerReal(r,2));}throw Error(mensaje||'No llegó el estado esperado.');}
function sesion(id='usuario-demo'){localStorage.setItem('sb_session',JSON.stringify({user_id:id,access_token:'token-'+id,refresh_token:'refresh-'+id,expires_at:Date.now()+3600000}));}
function respuesta(rows,status=200){return new Response(JSON.stringify(rows),{status,headers:{'content-type':'application/json','content-range':(Array.isArray(rows)&&rows.length?'0-'+(rows.length-1):'*')+'/'+(Array.isArray(rows)?rows.length:0)}});}
let red=null;
function configurarRed({fallar=false,bloquearLogin=false,prepararPortafolio=false,id='tx-demo',monto=125.5}={}){
  const estado={core:aplazado(),login:aplazado(),graficos:new Map(['1D','1S','1M','cantidades'].map(periodo=>[periodo,aplazado()])),pedidosGraficos:[],pedidosCore:0,pedidosLogin:0,fallar,id,monto};red=estado;
  const fecha=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const posicion={cuenta_ibkr:'CUENTA_DEMO',contract_id:1,simbolo:'CSPX',cantidad:10,precio_mercado:100,valor_mercado_base:1000,multiplicador:1,moneda:'USD',moneda_base:'USD',fecha_datos:fecha};
  const quote={status:'ok',account:posicion.cuenta_ibkr,contract_id:1,ibkr_symbol:'CSPX',currency:'USD',price:104,previous_close:100,price_at:new Date().toISOString()};
  if(!bloquearLogin)estado.login.resolve();
  globalThis.fetch=async (url,opts={})=>{
    const u=new URL(url),tabla=u.pathname.split('/').at(-1);
    if(u.pathname.includes('/auth/v1/token')){
      estado.pedidosLogin++;await estado.login.promise;
      return respuesta({access_token:'token-login',refresh_token:'refresh-login',expires_in:3600,user:{id:'usuario-demo'}});
    }
    if(u.hostname==='open.er-api.com')return respuesta({result:'success',rates:{PEN:3.75}});
    if(tabla==='transacciones'){
      estado.pedidosCore++;await estado.core.promise;
      if(estado.fallar)return respuesta({message:'Sin conexión de prueba'},503);
      return respuesta([{id:estado.id,fecha:new Date().toISOString(),descripcion:'Ingreso real de prueba',categoria:'Salario',tipo:'Ingreso',monto:estado.monto,cuenta:'Plin'}]);
    }
    if(tabla==='cuentas')return respuesta([{id:'cuenta-demo',nombre:'Plin',tipo:'billetera',moneda:'PEN',archivada:false}]);
    if(tabla==='categorias')return respuesta([{nombre:'Salario',color:'#00d68f'}]);
    if(prepararPortafolio){
      if(tabla==='portafolio_historial')return respuesta([{fecha_valoracion:fecha,cuenta_ibkr:posicion.cuenta_ibkr,valor_total:1000,efectivo:0,valor_posiciones:1000,moneda_base:'USD'}]);
      if(tabla==='posiciones')return respuesta([posicion]);
      const cantidades=tabla==='posiciones_historial'&&(u.searchParams.get('select')||'').includes('cantidad');
      if(tabla==='cotizaciones-yahoo'||cantidades){
        const periodo=cantidades?'cantidades':u.searchParams.get('historia')||'1D';
        estado.pedidosGraficos.push({periodo,signal:opts.signal});await estado.graficos.get(periodo).promise;
        if(cantidades)return respuesta([{...posicion,fecha_valoracion:fecha}]);
        const points=[{t:Date.now()-60000,price:104}];
        return respuesta({quotes:[periodo==='1D'?{...quote,intraday:{interval:'2m',points}}:{...quote,interval:periodo==='1S'?'5m':'15m',points}]});
      }
    }
    if(u.pathname.includes('/functions/'))return respuesta({quotes:[]});
    return respuesta([]);
  };
  return estado;
}
function pendiente(){assert.equal(el('appContent').inert,true,'los controles quedan bloqueados hasta cargar los movimientos');assert.equal(el('appContent').getAttribute('aria-hidden'),'true','el contenido detrás de la preparación no se anuncia');assert.equal(el('authGate').inert,true,'el formulario deja de recibir foco durante la preparación');assert.equal(el('authGate').style.display,'none');assert.equal(el('appStartup').hidden,false,'la preparación sigue visible');}
function listo(){assert.equal(el('appContent').inert,false,'se habilita el contenido cargado');assert.notEqual(el('appContent').getAttribute('aria-hidden'),'true');assert.equal(el('appStartup').hidden,true,'se retira la preparación al quedar listo');}

(async()=>{
  const [auth,startup,tx,state,dom,market,portfolio]=await Promise.all([
    modulo('services/auth.js'),modulo('ui/startup.js'),modulo('modules/transactions.js'),modulo('state.js'),modulo('utils/dom.js'),modulo('services/market-data.js'),modulo('modules/portfolio/portfolio.js'),
  ]);
  const {datos}=state;
  const consoleError=console.error;
  try{
    // Sin sesión se muestra acceso, manteniendo el dashboard fuera del foco.
    await auth.bootAuth();assert.equal(el('appContent').inert,true);assert.equal(el('authGate').inert,false);assert.notEqual(el('authGate').style.display,'none');

    // Dos entradas y Actualizar comparten la misma consulta en curso.
    sesion();let redActual=configurarRed();let termino=false;
    const inicio=auth.bootAuth().then(()=>{termino=true;});const segundoInicio=auth.bootAuth();
    await esperar(()=>redActual.pedidosCore===1,'no empezó la carga inicial');pendiente();assert.equal(termino,false,'bootAuth espera a los datos');
    const carga=tx.cargar(),mismaCarga=tx.cargar();assert.strictEqual(carga,mismaCarga,'Actualizar reutiliza la promesa activa');
    assert.equal(redActual.pedidosCore,1,'no duplicar la carga al entrar o actualizar rápido');
    redActual.core.resolve();const [resultado]=await Promise.all([carga,inicio,segundoInicio]);assert.equal(resultado.ok,true);listo();
    assert.equal(datos.transacciones[0][6],'tx-demo');assert.equal(datos.cargados,true);assert.equal(el('balAmt').textContent,'125.50','el primer saldo ya contiene el importe real');
    assert.match(el('txs').innerHTML,/Ingreso real de prueba/);assert.equal(animaciones,0,'reduced motion evita las animaciones de JavaScript');

    // El resumen abre aunque día, semana y mes sigan pendientes. Todos los
    // pedidos nacen en Inicio y se completan sin tocar Portafolio.
    {
      startup.mostrarAcceso();datos.cargados=false;portfolio.limpiarCachePortafolio();sesion();redActual=configurarRed({prepararPortafolio:true,id:'tx-graficos'});
      let inicioGraficos;
      try{
        inicioGraficos=auth.bootAuth();
        await esperar(()=>redActual.pedidosCore===1&&redActual.pedidosGraficos.length===4,'Inicio debe empezar todos los períodos antes de abrir Portafolio');
        assert.deepEqual(redActual.pedidosGraficos.map(p=>p.periodo).sort(),['1D','1M','1S','cantidades']);
        pendiente();redActual.core.resolve();
        await inicioGraficos;listo();
        assert.equal(datos.transacciones[0][6],'tx-graficos');
        assert.equal(market.pfHistoriaYahooEnCache('1S'),null,'Inicio es usable antes de terminar la semana');
        assert.equal(market.pfHistoriaYahooEnCache('1M'),null,'Inicio es usable antes de terminar el mes');
        assert.ok(redActual.pedidosGraficos.filter(p=>p.signal).every(p=>!p.signal.aborted),'mostrar Inicio no cancela las cotizaciones');
        const fondo=portfolio.precargarPortafolio({esperarGraficos:true});
        for(const gate of redActual.graficos.values())gate.resolve();await fondo;
        assert.equal(redActual.pedidosGraficos.length,4,'la finalización de fondo comparte los pedidos originales');
        assert.ok(market.pfHistoriaYahooEnCache('1S'));assert.ok(market.pfHistoriaYahooEnCache('1M'));listo();
      }finally{redActual.core.resolve();for(const gate of redActual.graficos.values())gate.resolve();await inicioGraficos;portfolio.limpiarCachePortafolio();}
    }

    // Un fallo inicial conserva la preparación y permite recuperar con Reintentar.
    startup.mostrarAcceso();datos.cargados=false;datos.transacciones=[];sesion();redActual=configurarRed({fallar:true});
    console.error=()=>{};
    const fallido=auth.bootAuth();await esperar(()=>redActual.pedidosCore===1);pendiente();redActual.core.resolve();await fallido;
    assert.equal(el('appContent').inert,true,'un error no revela cifras iniciales como si fueran reales');assert.equal(el('appStartup').hidden,false);assert.equal(el('startupActions').hidden,false);assert.match(el('startupTitle').textContent,/cargar|preparar|conexión|inicio/i);
    redActual=configurarRed({id:'tx-reintento',monto:210});const reintento=el('startupRetry').click();await esperar(()=>redActual.pedidosCore===1,'Reintentar debe empezar otra carga');pendiente();redActual.core.resolve();await reintento;await esperar(()=>!el('appContent').inert,'el reintento no reveló la aplicación');listo();assert.equal(datos.transacciones[0][6],'tx-reintento');

    // Cambiar de cuenta durante la red impide aplicar o revelar la respuesta vieja.
    startup.mostrarAcceso();datos.cargados=false;datos.transacciones=[];sesion('usuario-anterior');redActual=configurarRed({id:'tx-usuario-anterior'});
    const cambio=auth.bootAuth();await esperar(()=>redActual.pedidosCore===1);sesion('usuario-nuevo');redActual.core.resolve();await cambio;
    assert.deepEqual(datos.transacciones,[],'no aceptar movimientos del usuario anterior');assert.equal(el('appContent').inert,true,'no revelar el dashboard con una sesión distinta');

    // El login también espera el core y evita dos solicitudes ante doble toque.
    localStorage.removeItem('sb_session');startup.mostrarAcceso();datos.cargados=false;redActual=configurarRed({bloquearLogin:true,id:'tx-login',monto:75});
    const acceso=auth.submitAuth(),dobleAcceso=auth.submitAuth();await esperar(()=>redActual.pedidosLogin===1);redActual.login.resolve();await esperar(()=>redActual.pedidosCore===1);pendiente();
    assert.equal(redActual.pedidosLogin,1,'doble Entrar no duplica autenticación');assert.equal(redActual.pedidosCore,1,'doble Entrar no duplica los movimientos');redActual.core.resolve();await Promise.all([acceso,dobleAcceso]);listo();assert.equal(datos.transacciones[0][6],'tx-login');

    // Un cambio diferido del saldo no puede sobrescribir el importe preparado.
    reducirMovimiento=false;
    const importe=el('numeroPrueba');importe.textContent='0.00';importe.dataset.value='0.00';el('appContent').inert=false;
    dom.smoothSetText(importe,'20.00',20);assert.equal(importe.textContent,'0.00','hay una actualización diferida pendiente');assert.equal(importe.classList.contains('num-changing'),true);
    el('appContent').inert=true;dom.smoothSetText(importe,'30.00',30);
    assert.equal(importe.textContent,'30.00','durante la preparación se escribe el importe final de inmediato');await new Promise(r=>timerReal(r,120));assert.equal(importe.textContent,'30.00','el temporizador previo no restaura una cifra vieja');

    // La salida termina antes de habilitar controles; una salida vieja no
    // puede deshacer una vuelta al login mientras su animación está en curso.
    const pantalla=el('appStartup'),animar=pantalla.animate;
    let salida=aplazado();pantalla.animate=()=>({finished:salida.promise,cancel(){}});
    startup.prepararInicio();const revelado=startup.revelarInicio();assert.equal(el('appContent').inert,true);salida.resolve();await revelado;listo();
    salida=aplazado();startup.prepararInicio();const reveladoViejo=startup.revelarInicio();startup.mostrarAcceso();salida.resolve();await reveladoViejo;
    assert.equal(el('appContent').inert,true,'una salida cancelada no habilita el dashboard');assert.equal(el('authGate').inert,false);assert.notEqual(el('authGate').style.display,'none');pantalla.animate=animar;

    // Un segundo boot durante la salida comparte el inicio que está
    // terminando, sin volver a preparar ni cancelar su animación.
    {
      const salidaBoot=aplazado(),animarOriginal=pantalla.animate,animacionesOriginales=pantalla.getAnimations;
      let salidaEmpezada=false,canceladas=0;
      const animacion={finished:salidaBoot.promise,cancel(){canceladas++;salidaBoot.resolve();}};
      pantalla.animate=()=>{salidaEmpezada=true;return animacion;};
      pantalla.getAnimations=()=>salidaEmpezada?[animacion]:[];
      try{
        startup.mostrarAcceso();datos.cargados=false;sesion();redActual=configurarRed({id:'tx-boot-salida',monto:320});
        const primerBoot=auth.bootAuth();await esperar(()=>redActual.pedidosCore===1);redActual.core.resolve();await esperar(()=>salidaEmpezada,'el primer boot no inició la salida');
        assert.equal(el('appContent').inert,true);const segundoBoot=auth.bootAuth();await Promise.resolve();
        assert.equal(canceladas,0,'el segundo boot no cancela la salida en curso');assert.equal(redActual.pedidosCore,1,'el segundo boot no empieza otra carga');
        salidaBoot.resolve();await Promise.all([primerBoot,segundoBoot]);listo();assert.equal(datos.transacciones[0][6],'tx-boot-salida');
      }finally{salidaBoot.resolve();pantalla.animate=animarOriginal;pantalla.getAnimations=animacionesOriginales;}
    }
    console.log('PASS: Inicio sin esperar curvas, precarga de tres períodos sin cancelarla al revelar, carga compartida, fallo/reintento, sesión, doble login y salida cancelable.');
  }finally{console.error=consoleError;red?.core.resolve();red?.login.resolve();for(const gate of red?.graficos.values()||[])gate.resolve();market.stopPfYahoo();globalThis.setTimeout=timerReal;}
})().catch(e=>{console.error(e);process.exitCode=1;});
