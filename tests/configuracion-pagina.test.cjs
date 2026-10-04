// Configuración de página completa con datos y red ficticios.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {entornoPrueba,modulo,appRoot}=require('./helpers/app-root.cjs');
const almacen=entornoPrueba(),nodos=new Map();
const grupos=['settingsInicio','settingsCuentas','settingsCategorias','settingsPreferencias','settingsDatos'];
function el(id){
  if(!nodos.has(id)){
    const clases=new Set(),attrs=new Map();
    nodos.set(id,{id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,open:false,dataset:{},style:{setProperty(k,v){this[k]=v;}},
      classList:{add:x=>clases.add(x),remove:x=>clases.delete(x),contains:x=>clases.has(x),toggle(x,on){if(on??!clases.has(x))clases.add(x);else clases.delete(x);}},
      setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,
      querySelector:()=>null,querySelectorAll:()=>id==='p-settings'?grupos.map(el):[],
      focus(){document.activeElement=this;},scrollIntoView(){this.desplazamientos=(this.desplazamientos||0)+1;}});
  }
  return nodos.get(id);
}
document.getElementById=el;document.documentElement=el('html');document.activeElement=null;
document.querySelector=s=>s==='meta[name="version-app"]'?{content:'2026.10.04.05'}:s==='.page.active'?el('p-settings'):null;
globalThis.window={matchMedia:()=>({matches:true}),scrollTo(){}};globalThis.matchMedia=window.matchMedia;
globalThis.fetch=async(url,opts={})=>{assert.equal(opts.method||'GET','GET','preparar Configuración no escribe datos');return new Response('[]',{headers:{'content-type':'application/json','content-range':'*/0'}});};
almacen.set('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:Date.now()+3600000}));
almacen.set('finanzas.appearance.v1',JSON.stringify({accent:'blue',chartScale:'cero',preferenciaFutura:{enabled:true}}));
el('p-settings').classList.add('active');

(async()=>{
  const [settings,{datos},categorias]=await Promise.all([modulo('modules/settings.js'),modulo('state.js'),modulo('modules/categories.js')]);
  Object.assign(datos,{cargados:true,categorias:[['Compras','#00d68f']],cuentas:[],transacciones:[],presupuestos:[],recurrentes:[]});
  settings.renderConfiguracion();
  assert.equal(el('settingsInicio').open,true);for(const id of grupos.slice(1))assert.equal(el(id).open,false);
  assert.match(el('homeWidgetsConfig').innerHTML,/home-widget-rentabilidad/);assert.equal(el('appAccent').value,'blue');assert.equal(el('appChartScale').value,'cero');
  assert.equal(settings.VERSION_APP,'2026.10.04.05');assert.equal(el('settingsVersion').textContent,'Versión 2026.10.04.05');
  console.log('PASS: Configuración prepara Inicio personalizado y mantiene apariencia y versión.');

  categorias.agregarCategoria();el('categoryName').value='Salud sin guardar';el('categoryColor').value='#123456';el('newCuentaNombre').value='Cuenta en preparación';
  const listaCategorias=el('categoriasLista').innerHTML,listaCuentas=el('cuentasLista').innerHTML;
  settings.abrirConfiguracion('datos');await new Promise(r=>setTimeout(r,75));
  assert.equal(el('settingsDatos').open,true);assert.ok(el('settingsDatos').desplazamientos>0);
  assert.equal(el('categoryForm').hidden,false);assert.equal(el('categoryName').value,'Salud sin guardar');assert.equal(el('categoryColor').value,'#123456');
  assert.equal(el('newCuentaNombre').value,'Cuenta en preparación');assert.equal(el('categoriasLista').innerHTML,listaCategorias);assert.equal(el('cuentasLista').innerHTML,listaCuentas);
  settings.abrirConfiguracion('cuentas');settings.abrirConfiguracion('categorias');await new Promise(r=>setTimeout(r,75));
  assert.equal(el('settingsCuentas').open,true);assert.equal(el('settingsCategorias').open,true);assert.equal(el('categoryForm').hidden,false);
  console.log('PASS: los atajos abren secciones conservando formularios, listas y borradores.');

  almacen.set('finanzas.home-widgets.v1','[{"id":"tarjetas","visible":false}]');
  const widgetsAntes=almacen.get('finanzas.home-widgets.v1');
  el('appAccent').value='violet';el('appChartScale').value='auto';settings.guardarPreferencias();
  assert.deepEqual(JSON.parse(almacen.get('finanzas.appearance.v1')),{accent:'violet',chartScale:'auto',preferenciaFutura:{enabled:true}});
  assert.equal(almacen.get('finanzas.home-widgets.v1'),widgetsAntes);assert.equal(document.documentElement.style['--accent'],'#c4a2ff');
  console.log('PASS: guardar apariencia conserva preferencias futuras y la personalización de Inicio.');

  const indice=fs.readFileSync(path.join(appRoot,'index.html'),'utf8');
  const pagina=indice.slice(indice.indexOf('id="p-settings"'),indice.indexOf('<!-- CREDIT LINE CONFIG MODAL -->'));
  assert.doesNotMatch(indice,/id="settingsModal"/);assert.match(indice,/<div class="page settings-page" id="p-settings">/);
  for(const id of ['settingsBack','settingsTitle','settingsVersion','homeWidgetsConfig','homeWidgetsReset','cuentasLista','newCuentaNombre','newCuentaTipo','newCuentaMoneda',
    'categoriasLista','categoryForm','categoryName','categoryColor','categorySave','categoryDeletePanel','categoryDeleteConfirm','appAccent','appChartScale','tcUsdPen','exportCSV','exportBackup'])assert.ok(pagina.includes('id="'+id+'"'),'se conserva el control '+id);
  for(const explicacion of ['Cómo funcionan las cuentas','Qué ocurre al cambiar una categoría','Cómo se usa el tipo de cambio','Cómo funcionan las escalas','Qué incluyen las descargas','en este navegador'])assert.ok(pagina.includes(explicacion),'se conserva la explicación '+explicacion);
  assert.match(pagina,/onclick="abrirLineasCredito\(\)"/);assert.doesNotMatch(pagina,/cerrarConfiguracion\(\);abrirLineasCredito/);
  console.log('PASS: pantalla completa, retorno, controles y explicaciones preservados; Tarjetas abre sobre Configuración.');
})().catch(e=>{console.error(e);process.exitCode=1;});
