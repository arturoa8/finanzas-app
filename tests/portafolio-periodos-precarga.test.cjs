const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();process.env.TZ='America/Lima';
const RealDate=Date;let now=RealDate.parse('2026-10-02T10:00:00Z'),activo=false,pintados=0;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
// Solo el mantenimiento de 30 s usa este reloj: las promesas aplazadas y
// los timeouts de red siguen siendo reales. Cada avance ejecuta un tick,
// sin convertir las consultas en una ráfaga por el salto del reloj.
const setTimeoutReal=setTimeout,clearTimeoutReal=clearTimeout,ticksMantenimiento=new Map();
globalThis.setTimeout=(callback,delay,...args)=>{
  if(delay!==30000)return setTimeoutReal(callback,delay,...args);
  const timer={};ticksMantenimiento.set(timer,()=>callback(...args));return timer;
};
globalThis.clearTimeout=timer=>{if(!ticksMantenimiento.delete(timer))clearTimeoutReal(timer);};
const nodos=new Map();
function nodo(id){
  const el={id,style:{},dataset:{},hidden:false,value:'',attrs:{},classList:{add(){},remove(){},toggle(){},contains:()=>id==='p-ana'&&activo},querySelector:s=>id==='pfDistArea'&&s==='svg'?nodo('svg'):null,querySelectorAll:()=>[],replaceChildren(){},append(){},appendChild(){},addEventListener(){},setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;}};
  for(const key of ['innerHTML','textContent']){let value='';Object.defineProperty(el,key,{get:()=>value,set:v=>{value=String(v);pintados++;}});}
  return el;
}
document.hidden=false;document.querySelector=()=>null;document.createElement=tag=>nodo(tag);document.createElementNS=(_,tag)=>nodo(tag);
document.getElementById=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
const sesion=id=>localStorage.setItem('sb_session',JSON.stringify({user_id:id,access_token:id,expires_at:now+3600000}));
function aplazado(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
const gates=new Map(),versiones=new Map(),historiasNoDisponibles=new Set(),preciosSinVelas=new Set(),fallosTransitorios=new Set(),pedidos=[];
function aplazar(id,tipo){const gate=aplazado();gates.set(id+'|'+tipo,gate);return gate;}
const contar=(id,tipo)=>pedidos.filter(p=>p.id===id&&p.tipo===tipo).length;
const cuenta=id=>'CUENTA_'+id;
const fechas=['2026-08-31','2026-09-01','2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01'];
const posicion=(id,version)=>({id:'p1',cuenta_ibkr:cuenta(id),contract_id:version+1,simbolo:version?'ACTIVO_NUEVO':'CSPX',nombre:'Activo de prueba',cantidad:10,precio_mercado:100,valor_mercado_base:1000,costo_promedio:100,multiplicador:1,moneda:'USD',moneda_base:'USD',tipo_activo:'STK',fecha_datos:'2026-10-01',pnl_no_realizado_base:0});
const historial=id=>fechas.map((fecha,i)=>({id:'h'+i,fecha_valoracion:fecha,cuenta_ibkr:cuenta(id),valor_total:1000,efectivo:0,valor_posiciones:1000,pnl_no_realizado:0,moneda_base:'USD'}));
function quote(id,version,historia){
  const p=posicion(id,version),q={status:'ok',account:cuenta(id),contract_id:p.contract_id,ibkr_symbol:p.simbolo,currency:'USD',price:104,previous_close:100,price_at:new RealDate(now-120000).toISOString(),session_start:'2026-10-02T07:00:00Z',session_end:'2026-10-02T15:30:00Z'};
  const points=(historia?['2026-09-01','2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02']:['2026-10-02']).flatMap(fecha=>[{t:RealDate.parse(fecha+'T07:00:00Z'),price:100},{t:RealDate.parse(fecha+'T09:58:00Z'),price:104}]);
  if(!historia&&preciosSinVelas.has(id))return{...q,intraday:{interval:'2m',points:[]}};
  return historia?{...q,points,interval:historia==='1S'?'5m':'15m'}:{...q,intraday:{interval:'2m',points}};
}
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),tabla=u.pathname.split('/').at(-1),id=opts.headers.Authorization.slice(7),version=versiones.get(id)||0;
  const historia=u.searchParams.get('historia'),detalle=tabla==='posiciones_historial'&&(u.searchParams.get('select')||'').includes('cantidad');
  const tipo=historia?'historia_'+historia:detalle?'posiciones_detalle':tabla;
  pedidos.push({id,tipo,version,signal:opts.signal,url:u});
  let rows=[];
  if(tabla==='cotizaciones-yahoo')rows={quotes:[historiasNoDisponibles.has(id+'|'+historia)?{status:'unavailable',account:cuenta(id),contract_id:version+1,ibkr_symbol:posicion(id,version).simbolo}:quote(id,version,historia)]};
  if(tabla==='portafolio_historial')rows=historial(id);
  if(tabla==='posiciones')rows=[posicion(id,version)];
  if(detalle)rows=fechas.map((fecha,i)=>({...posicion(id,version),id:'ph'+i,fecha_valoracion:fecha}));
  if(tabla==='configuracion_integraciones')rows=[{cuenta_ibkr:cuenta(id)}];
  if(tabla==='guardar_snapshot_portafolio')rows=[{estado:'omitido'}];
  await gates.get(id+'|'+tipo)?.promise;
  if(fallosTransitorios.has(id+'|'+tipo))throw Error('Fallo transitorio de prueba');
  if(tabla==='cotizaciones-yahoo')return Response.json(rows);
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json','content-range':(rows.length?'0-'+(rows.length-1):'*')+'/'+rows.length}});
};
async function esperar(condicion,mensaje='No llegó el estado esperado.'){
  for(let i=0;i<150;i++){if(condicion())return;await new Promise(r=>setTimeout(r,2));}
  throw Error(mensaje);
}
const tick=()=>new Promise(r=>setTimeout(r,5));
const graficosPedidos=id=>contar(id,'cotizaciones-yahoo')===1&&contar(id,'historia_1S')===1&&contar(id,'historia_1M')===1&&contar(id,'posiciones_detalle')===1;
function curvaLista(){
  const area=document.getElementById('pfChartArea');
  assert.match(area.innerHTML,/<svg/,'el período muestra su curva al cambiar');
  assert.doesNotMatch(area.innerHTML,/Cargando (detalle|rendimiento)/,'no mostrar la primera descarga después de la precarga');
  assert.equal(area.getAttribute('aria-busy'),'false');
}
function curvaPreparando(periodo){
  const area=document.getElementById('pfChartArea');
  assert.equal(area.getAttribute('aria-busy'),'true',periodo+': indica que todavía prepara los puntos');
  assert.match(area.innerHTML,/role="status"/,periodo+': muestra preparación accesible');
  assert.doesNotMatch(area.innerHTML,/role="img"|class="chart-svg"/,periodo+': no dibuja primero una curva provisional de cierres');
}
async function avanzarMantenimiento(ms=30001){
  now+=ms;
  const callbacks=[...ticksMantenimiento.values()];ticksMantenimiento.clear();
  for(const callback of callbacks)callback();
  await tick();
}
(async()=>{
  const p=await modulo('modules/portfolio/portfolio.js'),m=await modulo('services/market-data.js');
  try{
    sesion('A');
    const diario=aplazar('A','cotizaciones-yahoo'),semana=aplazar('A','historia_1S'),mes=aplazar('A','historia_1M'),cantidades=aplazar('A','posiciones_detalle');
    let graficosListos=false;
    const primera=p.precargarPortafolio(),segunda=p.precargarPortafolio(),completa=p.precargarPortafolio({esperarGraficos:true}).then(()=>{graficosListos=true;});
    await Promise.all([primera,segunda]);
    await esperar(()=>graficosPedidos('A'),'Inicio debe lanzar precios diarios, historia 1S/1M y cantidades antes de abrir Portafolio.');
    assert.equal(contar('A','posiciones'),1,'las precargas concurrentes comparten la base IBKR');
    assert.equal(p.pfPeriodo,'1D','precargar no cambia la selección de período');
    assert.equal(graficosListos,false,'la opción de arranque espera los gráficos aunque la base ya esté lista');
    assert.equal(pintados,0,'precargar en Inicio no pinta Portafolio oculto');
    assert.ok([...nodos.keys()].every(id=>id==='p-ana'),'solo se consulta la visibilidad de Portafolio');
    assert.equal(m.pfYahoo.timer,null,'la precarga no inicia polling oculto');

    activo=true;await p.renderPortafolio();curvaPreparando('1D');
    p.setPfPeriodo('1S');curvaPreparando('1S');
    p.setPfPeriodo('1M');curvaPreparando('1M');
    p.setPfPeriodo('1D');curvaPreparando('1D');
    assert.ok(graficosPedidos('A'),'abrir las tres curvas se une a las consultas ya iniciadas en Inicio');
    activo=false;m.stopPfYahoo({preservarConsulta:true});
    const pintadosAntesDiario=pintados;
    diario.resolve();await esperar(()=>m.pfYahoo.status==='ok');
    assert.equal(graficosListos,false,'Yahoo diario no basta para considerar listos los períodos');
    assert.equal(pintados,pintadosAntesDiario,'terminar el día no pinta Portafolio después de salir');assert.equal(m.pfYahoo.timer,null);
    activo=true;await p.renderPortafolio();curvaLista();
    assert.ok(graficosPedidos('A'),'entrar comparte las historias todavía pendientes');
    p.setPfPeriodo('1S');await tick();
    curvaPreparando('1S');
    assert.equal(contar('A','historia_1S'),1,'abrir semana se une a su historia en curso');
    assert.equal(contar('A','posiciones_detalle'),1,'semana y mes comparten una descarga de cantidades');

    activo=false;m.stopPfYahoo();const pintadosAlSalir=pintados;
    for(const pedido of pedidos.filter(x=>x.id==='A'&&x.tipo.startsWith('historia_')))assert.equal(pedido.signal.aborted,false,'salir de Portafolio conserva la historia compartida con Inicio');
    semana.resolve();mes.resolve();cantidades.resolve();await completa;
    await esperar(()=>m.pfHistoriaYahooEnCache('1S')&&m.pfHistoriaYahooEnCache('1M'));
    await tick();assert.equal(pintados,pintadosAlSalir,'una historia tardía no vuelve a pintar la pestaña oculta');
    assert.equal(graficosListos,true);assert.equal(p.pfPeriodo,'1S');assert.equal(m.pfYahoo.timer,null);

    activo=true;await p.renderPortafolio();curvaLista();
    assert.match(document.getElementById('pfChartHint').textContent,/Yahoo cada 5 min/,'semana usa velas precargadas y cantidades históricas');
    p.setPfPeriodo('1M');curvaLista();
    assert.match(document.getElementById('pfChartHint').textContent,/Yahoo cada 15 min/,'mes también dispone de detalle intradía desde Inicio');
    assert.ok(graficosPedidos('A'),'entrar y cambiar períodos no disparan una primera descarga');
    m.stopPfYahoo();activo=false;

    const historiaAnterior=m.pfHistoriaYahooEnCache('1S');
    now+=5*60*1000+1;sesion('A');
    const baseRenovada=aplazar('A','posiciones'),diarioRenovado=aplazar('A','cotizaciones-yahoo'),semanaRenovada=aplazar('A','historia_1S'),mesRenovado=aplazar('A','historia_1M'),cantidadesRenovadas=aplazar('A','posiciones_detalle');
    const renovacion=p.precargarPortafolio({esperarGraficos:true});await esperar(()=>contar('A','posiciones')===2);
    document.getElementById('pfChartArea').innerHTML='';
    for(const id of ['pfResumenCard','pfChartCard','pfDistCard','pfPosicionesCard'])document.getElementById(id).style.display='none';
    activo=true;const entradaRenovacion=p.renderPortafolio();
    curvaLista();
    for(const id of ['pfResumenCard','pfChartCard','pfDistCard','pfPosicionesCard'])assert.equal(document.getElementById(id).style.display,'','la base precargada se pinta antes de terminar su actualización');
    p.setPfPeriodo('1S');curvaLista();
    await esperar(()=>contar('A','historia_1S')===2&&contar('A','historia_1M')===2);
    assert.equal(m.pfHistoriaYahooEnCache('1S'),null,'la historia vencida no se presenta como fresca');
    assert.equal(m.pfHistoriaYahooEnCache('1S',{aceptarVencido:true}).quotes,historiaAnterior.quotes,'la historia coherente conserva su curva mientras se renueva');
    assert.match(document.getElementById('pfChartHint').textContent,/Yahoo cada 5 min/,'la revalidación mantiene detalle intradía en pantalla');
    p.setPfPeriodo('1D');curvaLista();
    assert.equal(m.pfYahoo.status,'loading','el día se está actualizando en segundo plano');
    assert.ok(m.pfYahoo.quotes.length,'el día conserva los puntos coherentes durante su revalidación');
    baseRenovada.resolve();diarioRenovado.resolve();semanaRenovada.resolve();mesRenovado.resolve();cantidadesRenovadas.resolve();await Promise.all([renovacion,entradaRenovacion]);
    m.stopPfYahoo();activo=false;
    assert.equal(contar('A','historia_1S'),2,'la semana se renueva al vencer sus 5 minutos');
    assert.equal(contar('A','historia_1M'),2,'el mes se renueva al vencer sus 5 minutos');
    assert.equal(contar('A','posiciones_detalle'),2,'las cantidades vencidas se actualizan una sola vez para ambos períodos');
    assert.equal(m.pfYahoo.timer,null);

    p.setPfPeriodo('1D');versiones.set('A',1);now+=61000;sesion('A');
    const diariosAntes=contar('A','cotizaciones-yahoo');
    const diarioOtroScope=aplazar('A','cotizaciones-yahoo'),semanaOtroScope=aplazar('A','historia_1S'),mesOtroScope=aplazar('A','historia_1M'),cantidadesOtroScope=aplazar('A','posiciones_detalle');
    activo=true;
    const otroScope=p.renderPortafolio({force:true});
    await esperar(()=>contar('A','cotizaciones-yahoo')===diariosAntes+1&&contar('A','historia_1S')===3&&contar('A','historia_1M')===3,'Aplicar una nueva base IBKR debe preparar día, semana y mes antes de seleccionarlos.');
    curvaPreparando('1D');
    assert.equal(m.pfHistoriaYahooEnCache('1S',{aceptarVencido:true}),null,'un cambio de contratos no reasigna las cotizaciones anteriores al scope nuevo');
    assert.equal(m.pfHistoriaYahooEnCache('1M',{aceptarVencido:true}),null,'la historia de otra base no se muestra durante la nueva descarga');
    p.setPfPeriodo('1S');curvaPreparando('1S');p.setPfPeriodo('1M');curvaPreparando('1M');
    diarioOtroScope.resolve();semanaOtroScope.resolve();mesOtroScope.resolve();cantidadesOtroScope.resolve();await otroScope;
    await esperar(()=>m.pfHistoriaYahooEnCache('1S')&&m.pfHistoriaYahooEnCache('1M'));
    curvaLista();m.stopPfYahoo();activo=false;
    assert.equal(contar('A','historia_1S'),3,'un cambio de contratos invalida la historia aunque siga dentro del TTL');
    assert.equal(contar('A','historia_1M'),3);
    assert.equal(contar('A','posiciones_detalle'),3);
    assert.equal(m.pfHistoriaYahooEnCache('1S').quotes[0].ibkr_symbol,'ACTIVO_NUEVO');

    p.limpiarCachePortafolio();sesion('RECUPERAR');await p.precargarPortafolio({esperarGraficos:true});
    const ultimaSemanaValida=m.pfHistoriaYahooEnCache('1S');
    now+=5*60*1000+1;sesion('RECUPERAR');historiasNoDisponibles.add('RECUPERAR|1S');
    await p.precargarPortafolio({esperarGraficos:true});
    assert.equal(contar('RECUPERAR','historia_1S'),2);
    assert.equal(m.pfHistoriaYahooEnCache('1S'),null,'una respuesta 200 sin historia utilizable no crea un caché fresco');
    assert.equal(m.pfHistoriaYahooEnCache('1S',{aceptarVencido:true}).quotes,ultimaSemanaValida.quotes,'una respuesta unavailable conserva la última historia coherente');
    activo=true;await p.renderPortafolio();p.setPfPeriodo('1S');curvaLista();
    assert.match(document.getElementById('pfChartHint').textContent,/Yahoo cada 5 min/,'el fallo temporal conserva la curva válida en pantalla');
    m.stopPfYahoo();activo=false;
    await p.precargarPortafolio({esperarGraficos:true});assert.equal(contar('RECUPERAR','historia_1S'),2,'el fallo no dispara una ráfaga inmediata de reintentos');
    now+=30001;sesion('RECUPERAR');historiasNoDisponibles.delete('RECUPERAR|1S');
    await p.precargarPortafolio({esperarGraficos:true});
    assert.equal(contar('RECUPERAR','historia_1S'),3,'el detalle se puede recuperar después de 30 segundos');
    assert.ok(m.pfHistoriaYahooEnCache('1S'),'el reintento exitoso vuelve a dejar la historia lista');
    assert.equal(contar('RECUPERAR','historia_1M'),2,'reintentar semana reutiliza el mes todavía válido');

    p.limpiarCachePortafolio();sesion('FALLO_VISIBLE');historiasNoDisponibles.add('FALLO_VISIBLE|1S');
    const semanaFallida=aplazar('FALLO_VISIBLE','historia_1S');
    await p.precargarPortafolio();await esperar(()=>graficosPedidos('FALLO_VISIBLE'));
    activo=true;await p.renderPortafolio();p.setPfPeriodo('1S');curvaPreparando('semana antes del fallo');
    semanaFallida.resolve();await esperar(()=>document.getElementById('pfChartArea').getAttribute('aria-busy')==='false');
    assert.match(document.getElementById('pfChartHint').textContent,/Detalle intradía no disponible.*cierres diarios/,'un fallo confirmado identifica el respaldo y no deja preparación infinita');
    historiasNoDisponibles.delete('FALLO_VISIBLE|1S');const semanaRecuperada=aplazar('FALLO_VISIBLE','historia_1S');
    await avanzarMantenimiento();await esperar(()=>contar('FALLO_VISIBLE','historia_1S')===2);
    curvaPreparando('reintento de semana sin otro clic');
    semanaRecuperada.resolve();await esperar(()=>m.pfHistoriaYahooEnCache('1S'));
    curvaLista();assert.match(document.getElementById('pfChartHint').textContent,/Yahoo cada 5 min/,'la curva visible se recupera por el mantenimiento, sin nueva selección');
    m.stopPfYahoo();activo=false;

    p.limpiarCachePortafolio();sesion('AUTOMATICO');
    for(const tipo of ['cotizaciones-yahoo','historia_1S','historia_1M'])fallosTransitorios.add('AUTOMATICO|'+tipo);
    await p.precargarPortafolio({esperarGraficos:true});
    assert.equal(m.pfYahoo.status,'error');
    assert.equal(m.pfHistoriaYahooEnCache('1S'),null);assert.equal(m.pfHistoriaYahooEnCache('1M'),null);
    const pintadosAntesReintento=pintados;
    for(const tipo of ['cotizaciones-yahoo','historia_1S','historia_1M'])fallosTransitorios.delete('AUTOMATICO|'+tipo);
    assert.equal(ticksMantenimiento.size,1,'Inicio mantiene un único tick de preparación');
    await avanzarMantenimiento();
    await esperar(()=>m.pfYahoo.status==='ok'&&m.pfHistoriaYahooEnCache('1S')&&m.pfHistoriaYahooEnCache('1M'),'Los tres errores se recuperan desde Inicio sin seleccionar un período.');
    for(const tipo of ['cotizaciones-yahoo','historia_1S','historia_1M'])assert.equal(contar('AUTOMATICO',tipo),2,'reintenta '+tipo+' sin abrir Portafolio');
    assert.equal(contar('AUTOMATICO','posiciones'),1,'el mantenimiento no repite la descarga de IBKR cada 30 s');
    assert.equal(pintados,pintadosAntesReintento,'el reintento no pinta Portafolio oculto');assert.equal(m.pfYahoo.timer,null);
    assert.equal(ticksMantenimiento.size,1);
    document.hidden=true;const pedidosAntesOcultar=pedidos.length;
    await avanzarMantenimiento(5*60*1000+1);
    assert.equal(pedidos.length,pedidosAntesOcultar,'ocultar la app detiene la consulta periódica de las tres curvas');
    assert.equal(ticksMantenimiento.size,0,'oculta no vuelve a programar el mantenimiento');
    document.hidden=false;sesion('AUTOMATICO');await p.precargarPortafolio({esperarGraficos:true});
    assert.equal(contar('AUTOMATICO','historia_1S'),3,'volver a primer plano renueva semana vencida sin clic');
    assert.equal(contar('AUTOMATICO','historia_1M'),3,'volver a primer plano renueva mes vencido sin clic');
    assert.equal(ticksMantenimiento.size,1,'reactivar la app restablece un único mantenimiento');

    p.limpiarCachePortafolio();sesion('SOLO_PRECIO');preciosSinVelas.add('SOLO_PRECIO');
    await p.precargarPortafolio({esperarGraficos:true});
    assert.equal(m.pfYahoo.status,'ok');assert.equal(m.pfYahoo.quotes.length,1,'puede haber un precio sin velas intradía');
    activo=true;await p.renderPortafolio();p.setPfPeriodo('1D');
    assert.equal(document.getElementById('pfChartArea').getAttribute('aria-busy'),'false','la ausencia de velas ya confirmada no queda cargando indefinidamente');
    now+=2*60*1000+1;sesion('SOLO_PRECIO');preciosSinVelas.delete('SOLO_PRECIO');
    const diaConVelas=aplazar('SOLO_PRECIO','cotizaciones-yahoo');
    const cargarVelas=p.precargarPortafolio({esperarGraficos:true});
    await esperar(()=>contar('SOLO_PRECIO','cotizaciones-yahoo')===2&&m.pfYahoo.status==='loading');
    p.setPfPeriodo('1D');curvaPreparando('1D con precio anterior sin puntos');
    diaConVelas.resolve();await cargarVelas;curvaLista();
    assert.doesNotMatch(document.getElementById('pfChartHint').textContent,/Sin serie intradía|dos últimos cierres/,'las velas recibidas reemplazan el respaldo de cierres por una curva real');
    const ultimoDiaValido=m.pfYahoo.quotes;
    now+=2*60*1000+1;sesion('SOLO_PRECIO');historiasNoDisponibles.add('SOLO_PRECIO|null');
    await p.precargarPortafolio({esperarGraficos:true});
    assert.equal(m.pfYahoo.status,'error','HTTP 200 con todos los precios unavailable permite reintentar el día');
    assert.equal(m.pfYahoo.quotes,ultimoDiaValido,'el día conserva sus puntos coherentes si Yahoo no responde con datos');
    p.setPfPeriodo('1D');curvaLista();
    m.stopPfYahoo();activo=false;
    historiasNoDisponibles.delete('SOLO_PRECIO|null');await avanzarMantenimiento();
    await esperar(()=>m.pfYahoo.status==='ok');
    assert.equal(contar('SOLO_PRECIO','cotizaciones-yahoo'),4,'el día también se recupera desde Inicio sin volver a seleccionarlo');

    p.limpiarCachePortafolio();sesion('VIEJO');
    const viejoSemana=aplazar('VIEJO','historia_1S'),viejoMes=aplazar('VIEJO','historia_1M'),viejasCantidades=aplazar('VIEJO','posiciones_detalle');
    const viejo=p.precargarPortafolio({esperarGraficos:true});await esperar(()=>graficosPedidos('VIEJO'));
    sesion('NUEVO');await p.precargarPortafolio({esperarGraficos:true});
    viejoSemana.resolve();viejoMes.resolve();viejasCantidades.resolve();await viejo;await tick();
    for(const periodo of ['1S','1M']){
      const cache=m.pfHistoriaYahooEnCache(periodo);
      assert.equal(cache.usuario,'NUEVO','las respuestas antiguas no repueblan la caché de otro usuario');
      assert.equal(cache.quotes[0].account,'CUENTA_NUEVO');
    }
    activo=true;await p.renderPortafolio();p.setPfPeriodo('1S');curvaLista();
    assert.match(document.getElementById('pfChartHint').textContent,/Yahoo cada 5 min/,'las cantidades tardías de otra sesión no sustituyen las vigentes');
    assert.equal(contar('NUEVO','posiciones_detalle'),1);m.stopPfYahoo();activo=false;

    p.limpiarCachePortafolio();sesion('SALIR');
    const salirSemana=aplazar('SALIR','historia_1S'),salirMes=aplazar('SALIR','historia_1M'),salirCantidades=aplazar('SALIR','posiciones_detalle');
    const salida=p.precargarPortafolio({esperarGraficos:true});await esperar(()=>graficosPedidos('SALIR'));
    localStorage.removeItem('sb_session');p.limpiarCachePortafolio();
    salirSemana.resolve();salirMes.resolve();salirCantidades.resolve();await salida;await tick();
    assert.equal(m.pfHistoriaYahooEnCache('1S'),null);assert.equal(m.pfHistoriaYahooEnCache('1M'),null);
    assert.equal(p.pfPosicionesCache.length,0,'cerrar sesión descarta datos y respuestas en curso');
    const antes=pedidos.length;assert.equal(await p.precargarPortafolio({esperarGraficos:true}),null);assert.equal(pedidos.length,antes,'sin sesión no precarga datos privados');
    console.log('PASS: día/semana/mes se preparan sin clic tras nueva base, no pintan curvas provisionales, conservan detalle válido y se recuperan con mantenimiento visible; TTL y aislamiento de usuarios/logout.');
  }finally{for(const gate of gates.values())gate.resolve();p.limpiarCachePortafolio();m.stopPfYahoo();}
})().catch(e=>{console.error(e);process.exitCode=1;});
