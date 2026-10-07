// Personalización de Inicio con almacenamiento y DOM en memoria.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
const almacen=entornoPrueba(),nodos=new Map(),timerReal=setTimeout;
globalThis.setTimeout=(fn,ms,...a)=>{const t=timerReal(fn,ms,...a);if(ms>=1000)t.unref?.();return t;};
function el(id){
  if(!nodos.has(id)){
    const clases=new Set();let html='';
    nodos.set(id,{id,disabled:false,checked:false,textContent:'',
      classList:{add:x=>clases.add(x),remove:x=>clases.delete(x),contains:x=>clases.has(x)},
      focus(){document.activeElement=this;},
      get innerHTML(){return html;},set innerHTML(v){
        html=String(v);
        for(const entrada of html.matchAll(/<(input|button)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
          const control=el(entrada[3]);control.checked=/\bchecked\b/.test(entrada[2]);control.disabled=/\bdisabled\b/.test(entrada[2]);
        }
      }});
  }
  return nodos.get(id);
}
document.getElementById=el;
globalThis.fetch=()=>assert.fail('Personalizar Inicio no necesita red');

(async()=>{
  const w=await modulo('modules/home-widgets.js');
  const orden=['rentabilidad','periodo','tarjetas','presupuesto','pagar','cobrar','efectivo','linea','ultimos'];
  const ancho=new Set(['rentabilidad','periodo','ultimos']),nuevos=new Set(['efectivo','linea','ultimos']);
  const defecto=orden.map(id=>({id,visible:!nuevos.has(id),tamano:ancho.has(id)?'ancho':'normal'}));
  assert.deepEqual(w.getHomeWidgets(),defecto);
  almacen.set(w.HOME_WIDGETS_KEY,'{json incompleto');assert.deepEqual(w.getHomeWidgets(),defecto);
  almacen.set(w.HOME_WIDGETS_KEY,JSON.stringify({widgets:[]}));assert.deepEqual(w.getHomeWidgets(),defecto);
  almacen.set(w.HOME_WIDGETS_KEY,JSON.stringify([{id:'desconocido',visible:false},{id:'presupuesto',visible:false},null,
    {id:'presupuesto',visible:true},{id:'cobrar',visible:'false'}]));
  assert.deepEqual(w.getHomeWidgets(),[{id:'presupuesto',visible:false,tamano:'normal'},{id:'cobrar',visible:true,tamano:'normal'},...defecto.filter(x=>!['presupuesto','cobrar'].includes(x.id))]);
  const copia=w.getHomeWidgets();copia[0].visible=true;copia.reverse();assert.equal(w.getHomeWidgets()[0].visible,false);
  console.log('PASS: valores iniciales, JSON inválido, IDs desconocidos/duplicados y lecturas sin mutar la preferencia.');

  const apariencia=JSON.stringify({accent:'blue',chartScale:'cero',preferenciaFutura:true});almacen.set('finanzas.appearance.v1',apariencia);
  w.restaurarWidgetsInicio();w.renderHomeWidgetsConfig();
  assert.equal((el('homeWidgetsConfig').innerHTML.match(/type="checkbox"/g)||[]).length,9);
  assert.equal(el('home-widget-up-rentabilidad').disabled,true);assert.equal(el('home-widget-down-ultimos').disabled,true);
  assert.match(el('homeWidgetsConfig').innerHTML,/aria-label="Mover Presupuesto hacia arriba"/);
  w.cambiarVisibilidadWidgetInicio('presupuesto',false);
  assert.equal(w.getHomeWidgets().find(x=>x.id==='presupuesto').visible,false);assert.equal(document.activeElement.id,'home-widget-presupuesto');
  w.moverWidgetInicio('tarjetas',-1);w.moverWidgetInicio('tarjetas',-1);
  assert.equal(w.getHomeWidgets()[0].id,'tarjetas');assert.equal(document.activeElement.id,'home-widget-tarjetas','un botón deshabilitado devuelve foco al control del mismo bloque');
  const guardado=almacen.get(w.HOME_WIDGETS_KEY);
  w.moverWidgetInicio('tarjetas',-1);w.moverWidgetInicio('ultimos',1);w.moverWidgetInicio('desconocido',1);w.cambiarVisibilidadWidgetInicio('desconocido',true);
  assert.equal(almacen.get(w.HOME_WIDGETS_KEY),guardado,'operaciones fuera de límites no cambian el orden');
  assert.equal(almacen.get('finanzas.appearance.v1'),apariencia,'el orden no altera apariencia ni futuras preferencias');
  for(const {id} of w.getHomeWidgets())w.cambiarVisibilidadWidgetInicio(id,false);
  assert.ok(w.getHomeWidgets().every(x=>!x.visible),'se puede elegir no mostrar ninguno');
  w.restaurarWidgetsInicio();assert.deepEqual(w.getHomeWidgets(),defecto);assert.match(el('homeWidgetsStatus').textContent,/restauraron/);
  almacen.set(w.HOME_WIDGETS_KEY,JSON.stringify([{id:'periodo',visible:true,tamano:'normal'},{id:'presupuesto',tamano:'enorme'},{id:'linea',tamano:'ancho',visible:true}]));
  const leidos=w.getHomeWidgets();
  assert.equal(leidos.find(x=>x.id==='periodo').tamano,'ancho','un bloque de un solo tamaño ignora el que no admite');
  assert.equal(leidos.find(x=>x.id==='presupuesto').tamano,'normal','un tamaño desconocido vuelve al de partida');
  assert.equal(leidos.find(x=>x.id==='linea').tamano,'ancho');assert.equal(leidos.find(x=>x.id==='efectivo').visible,false,'los bloques nuevos nacen ocultos');
  w.restaurarWidgetsInicio();
  w.cambiarTamanoWidgetInicio('presupuesto','ancho');
  assert.equal(w.getHomeWidgets().find(x=>x.id==='presupuesto').tamano,'ancho');assert.equal(document.activeElement.id,'home-widget-size-presupuesto-ancho');
  assert.match(el('homeWidgetsPreview').innerHTML,/data-size="ancho">Presupuesto/);
  const guardadoTam=almacen.get(w.HOME_WIDGETS_KEY);
  w.cambiarTamanoWidgetInicio('periodo','normal');w.cambiarTamanoWidgetInicio('presupuesto','ancho');w.cambiarTamanoWidgetInicio('desconocido','ancho');
  assert.equal(almacen.get(w.HOME_WIDGETS_KEY),guardadoTam,'tamaños no admitidos o repetidos no cambian nada');
  assert.doesNotMatch(el('homeWidgetsConfig').innerHTML,/home-widget-size-periodo/,'un bloque de un solo tamaño no ofrece elegir');
  w.cambiarVisibilidadWidgetInicio('presupuesto',false);assert.equal(el('home-widget-size-presupuesto-normal').disabled,true,'oculto no se redimensiona');
  w.restaurarWidgetsInicio();
  w.moverWidgetInicioA('cobrar',0);assert.deepEqual(w.getHomeWidgets().map(x=>x.id).slice(0,3),['cobrar','rentabilidad','periodo'],'arrastrar a una posición absoluta');
  const antes=almacen.get(w.HOME_WIDGETS_KEY);w.moverWidgetInicioA('cobrar',0);w.moverWidgetInicioA('cobrar',99);w.moverWidgetInicioA('cobrar',-1);w.moverWidgetInicioA('cobrar',1.5);
  assert.equal(almacen.get(w.HOME_WIDGETS_KEY),antes);
  w.restaurarWidgetsInicio();
  console.log('PASS: tamaños, bloques nuevos ocultos, posición absoluta y vista previa.');

  console.log('PASS: ocultar, ordenar, límites, foco accesible, restauración e independencia de Apariencia.');

  const guardarReal=localStorage.setItem;localStorage.setItem=()=>{throw Error('Almacenamiento no disponible');};
  const temporal=w.cambiarVisibilidadWidgetInicio('periodo',false);
  assert.equal(temporal.guardado,false);assert.equal(w.getHomeWidgets().find(x=>x.id==='periodo').visible,false);
  assert.match(el('homeWidgetsStatus').textContent,/no permite guardarlo/);
  localStorage.setItem=guardarReal;w.restaurarWidgetsInicio();assert.deepEqual(w.getHomeWidgets(),defecto);
  console.log('PASS: fallo al guardar conserva la selección durante esta sesión y comunica el resultado real.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.setTimeout=timerReal;});
