const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();document.hidden=false;

const animaciones=[],cambiosMovimiento=new Set();
const media={matches:false,addEventListener(tipo,fn){if(tipo==='change')cambiosMovimiento.add(fn);},removeEventListener(tipo,fn){if(tipo==='change')cambiosMovimiento.delete(fn);}};
globalThis.matchMedia=()=>media;
function reducirMovimiento(matches){media.matches=matches;for(const fn of [...cambiosMovimiento])fn({matches});}
function elementoSvg(html){
  const listeners=new Map();
  return {html,style:{},
    addEventListener(tipo,fn){if(!listeners.has(tipo))listeners.set(tipo,new Set());listeners.get(tipo).add(fn);},
    removeEventListener(tipo,fn){listeners.get(tipo)?.delete(fn);},
    dispatch(tipo){for(const fn of [...(listeners.get(tipo)||[])])fn({});},
    animate(keyframes,options){
      let resolve,reject;
      const animacion={svg:this,keyframes,options,cancelaciones:0,finished:new Promise((ok,error)=>{resolve=ok;reject=error;}),
        cancel(){this.cancelaciones++;reject(Error('Animación cancelada'));},finish(){resolve();}};
      animaciones.push(animacion);return animacion;
    },
  };
}
function areaGrafico(){
  let html='',svg=null;
  return {get innerHTML(){return html;},set innerHTML(value){html=String(value);svg=html.startsWith('<svg')?elementoSvg(html):null;},querySelector:selector=>selector==='svg'?svg:null};
}
const curva=nombre=>'<svg><path data-serie="'+nombre+'" d="M0 0 L10 20"/></svg>';
const esperarCallbacks=async()=>{await Promise.resolve();await Promise.resolve();};

(async()=>{
  const {pfPrepararTransicionGrafico:preparar,pfPintarGrafico:pintar,pfCancelarTransicionGrafico:cancelar}=await modulo('ui/portfolio-chart-motion.js');
  const area=areaGrafico();
  pintar(area,curva('1D'));
  assert.equal(animaciones.length,0,'la primera carga y los refrescos no añaden una animación');

  preparar(area);pintar(area,'<div role="status">Preparando semana</div>',{esperar:true});
  pintar(area,'<div role="status">Preparando semana</div>',{esperar:true});
  assert.equal(animaciones.length,0,'la transición no empieza sobre un spinner');
  pintar(area,curva('1S'));
  assert.equal(area.innerHTML,curva('1S'),'los datos nuevos se montan antes de cualquier espera');
  assert.equal(animaciones.length,1,'la respuesta asíncrona conserva la transición solicitada');
  const semana=animaciones.at(-1);
  assert.ok(semana.options.duration>200&&semana.options.duration<=300);
  for(const frame of semana.keyframes)assert.deepEqual(Object.keys(frame),['opacity'],'la animación no modifica geometría ni simula puntos financieros');
  assert.ok(semana.keyframes[0].opacity>0&&semana.keyframes.at(-1).opacity===1,'la curva correcta permanece visible durante la transición');
  let gestos=0;
  area.querySelector('svg').addEventListener('pointerdown',()=>gestos++);
  area.querySelector('svg').dispatch('pointerdown');
  assert.equal(gestos,1,'el toque sigue llegando al scrubbing');
  assert.equal(semana.cancelaciones,1,'el toque hace visible la curva al 100%');
  await esperarCallbacks();
  assert.equal(cambiosMovimiento.size,0,'no deja listeners de movimiento reducido después del toque');

  preparar(area);pintar(area,curva('1M'));
  const mes=animaciones.at(-1);
  preparar(area);
  assert.equal(mes.cancelaciones,1,'un cambio rápido cancela el período anterior');
  pintar(area,curva('6M'));
  const seisMeses=animaciones.at(-1);
  await esperarCallbacks();
  preparar(area);
  assert.equal(seisMeses.cancelaciones,1,'la finalización tardía anterior no elimina la transición vigente');
  pintar(area,curva('1A'));
  const anual=animaciones.at(-1),cantidadAntesYahoo=animaciones.length;
  pintar(area,curva('1A-yahoo-actualizado'));
  assert.equal(anual.cancelaciones,1,'un refresco elimina la animación del SVG que reemplaza');
  assert.equal(animaciones.length,cantidadAntesYahoo,'Yahoo no reinicia la transición cada vez que llega un precio');
  assert.equal(area.innerHTML,curva('1A-yahoo-actualizado'));
  await esperarCallbacks();

  preparar(area);pintar(area,'<div>No hay datos desde esa fecha</div>');
  const cantidadAntesError=animaciones.length;
  pintar(area,curva('respaldo-posterior'));
  assert.equal(animaciones.length,cantidadAntesError,'una selección terminada sin curva no anima una actualización posterior');

  reducirMovimiento(true);preparar(area);pintar(area,curva('1D-reducido'));
  assert.equal(animaciones.length,cantidadAntesError,'respeta la preferencia de movimiento reducido');
  assert.equal(area.innerHTML,curva('1D-reducido'));
  reducirMovimiento(false);preparar(area);pintar(area,curva('1S-normal'));
  const cambiaPreferencia=animaciones.at(-1);
  reducirMovimiento(true);
  assert.equal(cambiaPreferencia.cancelaciones,1,'activar movimiento reducido detiene también la transición en curso');
  await esperarCallbacks();
  assert.equal(cambiosMovimiento.size,0);

  reducirMovimiento(false);document.hidden=true;
  preparar(area);const cantidadOculta=animaciones.length;pintar(area,curva('oculta'));
  assert.equal(animaciones.length,cantidadOculta,'una pestaña oculta no consume animaciones');
  document.hidden=false;preparar(area);cancelar(area);pintar(area,curva('otra-sesion'));
  assert.equal(animaciones.length,cantidadOculta,'limpiar la sesión descarta una transición pendiente');
  const otraArea=areaGrafico();
  preparar(area);preparar(otraArea);cancelar();
  pintar(area,curva('sesion-reiniciada'));pintar(otraArea,curva('sesion-reiniciada-2'));
  assert.equal(animaciones.length,cantidadOculta,'limpiar todas las transiciones no necesita consultar el DOM');

  const areaSinApi=areaGrafico();
  Object.defineProperty(areaSinApi,'innerHTML',{set(value){this.html=String(value);this.svg=elementoSvg(this.html);delete this.svg.animate;},get(){return this.html;}});
  areaSinApi.querySelector=()=>areaSinApi.svg;
  preparar(areaSinApi);pintar(areaSinApi,curva('sin-api'));
  assert.equal(areaSinApi.innerHTML,curva('sin-api'),'un navegador sin Web Animations sigue dibujando normalmente');
  assert.equal(animaciones.length,cantidadOculta);
  console.log('PASS: transición de períodos inmediata, carga asíncrona, cambios rápidos, Yahoo, gestos, sesión y movimiento reducido.');
})().catch(error=>{console.error(error);process.exitCode=1;});
