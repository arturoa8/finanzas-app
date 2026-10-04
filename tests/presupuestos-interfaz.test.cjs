// Página Presupuestos con DOM y API ficticios: ninguna
// petición de esta prueba puede leer o cambiar datos reales.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {entornoPrueba,modulo,appRoot}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date,realTimeout=setTimeout;
const ahora=RealDate.parse('2026-10-03T12:00:00-05:00');   // sábado
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[ahora]));}static now(){return ahora;}};
entornoPrueba();
const nodos=new Map();
function nodo(id){
  const clases=new Set(),atributos=new Map();
  return {id,dataset:{},style:{},hidden:false,disabled:false,checked:false,value:'',textContent:'',innerHTML:'',offsetWidth:320,
    classList:{add(...x){x.forEach(c=>clases.add(c));},remove(...x){x.forEach(c=>clases.delete(c));},contains:c=>clases.has(c),
      toggle(c,f){const on=f??!clases.has(c);if(on)clases.add(c);else clases.delete(c);return on;}},
    setAttribute(k,v){atributos.set(k,String(v));},getAttribute:k=>atributos.get(k)??null,removeAttribute:k=>atributos.delete(k),
    querySelectorAll:()=>(CONTROLES[id]||[]).map(el),querySelector:()=>null,focus(){},addEventListener(){}};
}
const CONTROLES={presupuestoModal:['presGuardar','presMonto','presInicio','presRepetir','presAlcancePeriodo','presAlcanceSiguientes'],presEliminarModal:['presEliminarBtn0','presEliminarBtn1']};
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
document.getElementById=el;document.querySelector=()=>null;document.body=nodo('body');
globalThis.window={matchMedia:()=>({matches:true})};globalThis.matchMedia=globalThis.window.matchMedia;
globalThis.setTimeout=(fn,ms,...a)=>{const t=realTimeout(fn,ms,...a);if(ms>=1000)t.unref?.();return t;};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:ahora+3600000}));

let pedidos=[],respuesta=null,retener=null;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url);
  assert.ok(['/rest/v1/rpc/guardar_presupuesto','/rest/v1/rpc/eliminar_presupuesto'].includes(u.pathname),'solo las funciones de presupuestos: '+u.pathname);
  assert.equal(opts.method,'POST');
  pedidos.push({ruta:u.pathname.split('/').pop(),cuerpo:JSON.parse(opts.body)});
  if(retener)await retener;
  const r=typeof respuesta==='function'?respuesta():respuesta;
  return r instanceof Response?r:json(r);
};

const fila=(o)=>({categoria:null,mes:null,fin:null,recurrente:false,...o,serie_id:o.serie_id||o.id});
const gasto=(fecha,cat,monto,id)=>[fecha,cat,cat,'Gasto',monto,'Yape',id||cat+fecha,null,null,null,null,null,null,null,null,false];

(async()=>{
  const [ui,c,{datos}]=await Promise.all([modulo('modules/presupuestos.js'),modulo('modules/presupuestos-calculo.js'),modulo('state.js')]);
  const html=()=>el('presupuestosLista').innerHTML;
  const tarjetas=()=>html().split('<article').slice(1);
  function preparar(presupuestos=[],transacciones=[]){
    pedidos=[];respuesta=null;retener=null;
    ui.cerrarPresupuestoForm();ui.cerrarEliminarPresupuesto();
    Object.assign(datos,{cargados:true,transacciones,categorias:[['Comer afuéra','#ffd93d'],['Compras','#7c6aff'],['Auto','#ff6a8a'],['Ocio','#ff6ad4']],
      presupuestos:presupuestos.map(fila).map(c.filaPresupuesto),pagosTarjetas:[]});
    ui.irPresPeriodoActual();
  }
  const SEMANA=[
    fila({id:'gen',ambito:'general',periodo:'semanal',inicio:'2026-09-07',recurrente:true,monto_limite:400}),
    fila({id:'comer',ambito:'categoria',categoria:'Comer afuera',periodo:'semanal',inicio:'2026-09-28',recurrente:true,monto_limite:100}),
    fila({id:'compras',ambito:'categoria',categoria:'Compras',periodo:'semanal',inicio:'2026-09-28',fin:'2026-10-05',monto_limite:100}),
    fila({id:'auto',ambito:'categoria',categoria:'Auto',periodo:'semanal',inicio:'2026-09-28',recurrente:true,monto_limite:50}),
    fila({id:'ocio',ambito:'categoria',categoria:'Ocio',periodo:'semanal',inicio:'2026-09-14',fin:'2026-09-28',recurrente:true,monto_limite:80,serie_id:'ocio'}),
    fila({id:'ocio2',ambito:'categoria',categoria:'Ocio',periodo:'semanal',inicio:'2026-09-28',recurrente:true,monto_limite:50,serie_id:'ocio'}),
  ];
  const GASTOS=[gasto('2026-09-29T13:00:00-05:00','Comer afuéra',60),gasto('2026-09-30T13:00:00-05:00','Compras',85),gasto('2026-10-01T13:00:00-05:00','Auto',50),
    gasto('2026-10-02T13:00:00-05:00','Ocio',62.5),gasto('2026-09-22T13:00:00-05:00','Ocio',30),
    ['2026-10-02T13:00:00-05:00','Compra de dólares','Compra Dólares','Transferencia',3750,'Plin','tr-1','BCP Dólares',null,null,null,null,null,null,null,false]];
  const casos=[
    ['Sin datos cargados no muestra importes provisionales',()=>{
      preparar();datos.cargados=false;ui.renderPresupuestos();assert.match(html(),/cuando terminen de cargar/);assert.equal(el('presGastado').textContent,'');
    }],
    ['Sin presupuestos: explicación breve y un botón, sin tarjetas vacías',()=>{
      preparar([],GASTOS);ui.setPresVista('mensual');
      assert.match(html(),/Aún no tienes presupuestos/);assert.match(html(),/Crear tu primer presupuesto/);assert.equal(tarjetas().length,0);
      assert.equal(el('presPeriodoNombre').textContent,'Este mes');assert.equal(el('presPeriodoFechas').textContent,'1 – 31 oct 2026');
      assert.equal(el('presGastado').textContent,'Gasto neto: S/ 112.50','solo los gastos de octubre; la compra de dólares no es gasto');
    }],
    ['Tarjetas: general primero, importes, disponible, porcentaje y estados con texto',()=>{
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');
      assert.equal(el('presPeriodoNombre').textContent,'Esta semana');assert.equal(el('presPeriodoFechas').textContent,'28 sep – 4 oct 2026');
      assert.equal(el('presTabSemana').getAttribute('aria-selected'),'true');
      const t=tarjetas();assert.equal(t.length,5,'un presupuesto por ámbito');
      assert.match(t[0],/Presupuesto general/);assert.match(t[0],/S\/ 257\.50<\/strong> de S\/ 400\.00/);assert.match(t[0],/Quedan S\/ 142\.50/);assert.match(t[0],/64 % utilizado/);
      assert.match(t[1],/Ocio/,'después, por porcentaje usado');assert.match(t[1],/Te excediste S\/ 12\.50/);assert.match(t[1],/125 % utilizado/);assert.match(t[1],/width:100\.00%/,'la barra termina en 100 %');
      assert.match(t[2],/Auto/);assert.match(t[2],/Límite alcanzado/);assert.match(t[2],/100 % utilizado/);
      assert.match(t[3],/Compras/);assert.match(t[3],/⚠ Cerca del límite/);assert.match(t[3],/Quedan S\/ 15\.00/);assert.match(t[3],/Sin repetición/);
      const comer=t[4];assert.match(comer,/🍔/);assert.match(comer,/Comer afuera/);assert.match(comer,/Esta semana · Se repite cada semana/);
      assert.match(comer,/S\/ 60\.00<\/strong> de S\/ 100\.00/);assert.match(comer,/Quedan S\/ 40\.00/);assert.match(comer,/60 % utilizado/);assert.doesNotMatch(comer,/Cerca del límite/);
      assert.match(comer,/role="progressbar"[^>]*aria-valuenow="60"/);assert.match(comer,/onclick="editarPresupuesto/);assert.match(comer,/onclick="eliminarPresupuesto/);
    }],
    ['Períodos anteriores con el límite que les correspondía',()=>{
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');ui.moverPresPeriodo(-1);
      assert.equal(el('presPeriodoNombre').textContent,'Semana anterior');assert.equal(el('presPeriodoFechas').textContent,'21 – 27 sep 2026');
      assert.equal(el('presActual').hidden,false);assert.equal(el('presActual').textContent,'Ir a esta semana');
      const ocio=tarjetas().find(t=>/Ocio/.test(t));assert.match(ocio,/S\/ 30\.00<\/strong> de S\/ 80\.00/,'la versión anterior valía S/ 80');
      assert.ok(!tarjetas().some(t=>/Comer afuera/.test(t)),'aún no existía');
      ui.irPresPeriodoActual();assert.equal(el('presActual').hidden,true);
      ui.setPresVista('mensual');assert.match(html(),/No hay presupuestos mensuales para este mes/);ui.moverPresPeriodo(3);assert.equal(el('presPeriodoFechas').textContent,'1 – 31 ene 2027');
    }],
    ['Validación del formulario sin perder lo escrito',async()=>{
      preparar([],GASTOS);ui.abrirNuevoPresupuesto();
      assert.equal(el('presupuestoModal').classList.contains('active'),true);assert.equal(el('presFormTitle').textContent,'Crear presupuesto');
      for(const [monto,error] of [['','mayor que cero'],['-3','mayor que cero'],['0','mayor que cero'],['10.555','dos decimales'],['abc','mayor que cero']]){
        el('presMonto').value=monto;await ui.guardarPresupuesto();assert.match(el('presFormError').textContent,new RegExp(error));assert.equal(el('presMonto').value,monto);
      }
      ui.setPresAmbito('categoria');assert.equal(el('presCategoriaCampo').hidden,false);
      assert.equal((el('presCategorias').innerHTML.match(/class="cchip[ "]/g)||[]).length,4);
      el('presMonto').value='100';await ui.guardarPresupuesto();assert.match(el('presFormError').textContent,/Elige una categoría/);
      assert.equal(pedidos.length,0,'nada se envía con datos inválidos');
    }],
    ['Crear un semanal por categoría: una sola petición aunque se pulse dos veces',async()=>{
      preparar([],GASTOS);ui.setPresVista('semanal');ui.abrirNuevoPresupuesto();
      assert.equal(el('presRepetirTexto').textContent,'Repetir cada semana');
      ui.setPresAmbito('categoria');ui.seleccionarPresCategoria({dataset:{cat:'Comer afuéra'}});
      assert.match(el('presInicio').innerHTML,/28 sep – 4 oct 2026 · esta semana/);assert.equal(el('presInicio').value,'2026-09-28');
      el('presMonto').value='100';el('presRepetir').checked=true;
      let liberar;retener=new Promise(r=>liberar=r);
      respuesta=[fila({id:'nuevo',ambito:'categoria',categoria:'Comer afuéra',periodo:'semanal',inicio:'2026-09-28',recurrente:true,monto_limite:'100.00'})];
      const uno=ui.guardarPresupuesto();await new Promise(r=>realTimeout(r,5));
      assert.equal(el('presGuardar').textContent,'Guardando…');assert.equal(el('presGuardar').disabled,true);
      const dos=ui.guardarPresupuesto();liberar();await Promise.all([uno,dos]);
      assert.equal(pedidos.length,1);
      assert.deepEqual(pedidos[0],{ruta:'guardar_presupuesto',cuerpo:{p_id:null,p_ambito:'categoria',p_categoria:'Comer afuéra',p_periodo:'semanal',p_inicio:'2026-09-28',p_monto:100,p_recurrente:true,p_alcance:'crear'}});
      assert.equal(el('presupuestoModal').classList.contains('active'),false);assert.equal(el('presGuardar').disabled,false);
      assert.equal(datos.presupuestos.length,1,'la copia local se reemplaza con la respuesta, sin recargar todo');
      assert.match(html(),/S\/ 60\.00<\/strong> de S\/ 100\.00/);
    }],
    ['Un error conserva el formulario y permite reintentar',async()=>{
      preparar([],GASTOS);ui.abrirNuevoPresupuesto();el('presMonto').value='1500';
      respuesta=json({message:'No se pudo conectar con el servidor de prueba'},503);
      await ui.guardarPresupuesto();
      assert.equal(el('presupuestoModal').classList.contains('active'),true);assert.equal(el('presMonto').value,'1500');
      assert.match(el('presFormError').textContent,/servidor de prueba/);assert.equal(el('presGuardar').disabled,false);assert.equal(el('presGuardar').textContent,'Guardar');
      respuesta=[fila({id:'g',ambito:'general',periodo:'mensual',inicio:'2026-10-01',recurrente:true,monto_limite:1500})];
      await ui.guardarPresupuesto();assert.equal(pedidos.length,2);assert.equal(el('presupuestoModal').classList.contains('active'),false);
    }],
    ['Duplicado: avisa y abre el existente para editarlo con el importe escrito',async()=>{
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');ui.abrirNuevoPresupuesto();
      ui.setPresAmbito('categoria');ui.seleccionarPresCategoria({dataset:{cat:'Comer afuéra'}});el('presMonto').value='120';
      await ui.guardarPresupuesto();
      assert.equal(pedidos.length,0);assert.equal(el('presDuplicado').hidden,false);
      assert.match(el('presDuplicadoTexto').textContent,/Ya tienes un presupuesto semanal para Comer afuera en esta semana \(28 sep – 4 oct 2026\)/);
      ui.editarPresupuestoExistente();
      assert.equal(el('presFormTitle').textContent,'Editar presupuesto');assert.equal(el('presMonto').value,'120');assert.equal(el('presAlcanceCampo').hidden,false);
    }],
    ['Editar uno que se repite exige elegir a qué períodos aplica',async()=>{
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');ui.editarPresupuesto('comer');
      assert.match(el('presFormResumen').innerHTML,/Comer afuera/);assert.match(el('presFormResumen').innerHTML,/Semanal · Esta semana · 28 sep – 4 oct 2026/);
      assert.equal(el('presFormCampos').hidden,true,'ámbito y período no se cambian al editar');assert.equal(el('presMonto').value,'100.00');
      el('presMonto').value='90';await ui.guardarPresupuesto();assert.match(el('presFormError').textContent,/solo a este período o también a los siguientes/);assert.equal(pedidos.length,0);
      ui.setPresAlcance('periodo');assert.equal(el('presRepetirCampo').hidden,true);assert.match(el('presAlcanceNota').textContent,/conservan el límite/);
      respuesta=[];await ui.guardarPresupuesto();
      assert.deepEqual(pedidos[0].cuerpo,{p_id:'comer',p_ambito:'categoria',p_categoria:'Comer afuera',p_periodo:'semanal',p_inicio:'2026-09-28',p_monto:90,p_recurrente:false,p_alcance:'periodo'});
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');ui.moverPresPeriodo(1);ui.editarPresupuesto('comer');ui.setPresAlcance('siguientes');
      assert.equal(el('presRepetirCampo').hidden,false);assert.match(el('presAlcanceNota').textContent,/anteriores conservan su límite/);
      el('presMonto').value='110';respuesta=[];await ui.guardarPresupuesto();
      assert.deepEqual(pedidos[0].cuerpo,{p_id:'comer',p_ambito:'categoria',p_categoria:'Comer afuera',p_periodo:'semanal',p_inicio:'2026-10-05',p_monto:110,p_recurrente:true,p_alcance:'siguientes'},'desde el período que se está viendo');
    }],
    ['Eliminar identifica el período o detiene la repetición conservando el historial',async()=>{
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');
      ui.eliminarPresupuesto('compras');
      assert.match(el('presEliminarTexto').textContent,/Se eliminará el presupuesto de Compras de Esta semana \(28 sep – 4 oct 2026\)\. Los demás períodos no cambian\./);
      assert.match(el('presEliminarAcciones').innerHTML,/confirmarEliminarPresupuesto\('periodo'/);
      respuesta=SEMANA.filter(f=>f.id!=='compras');await ui.confirmarEliminarPresupuesto('periodo','presEliminarBtn0');
      assert.deepEqual(pedidos[0],{ruta:'eliminar_presupuesto',cuerpo:{p_id:'compras',p_inicio:'2026-09-28',p_alcance:'periodo'}});
      assert.equal(el('presEliminarModal').classList.contains('active'),false);assert.ok(!tarjetas().some(t=>/Compras/.test(t)));
      ui.eliminarPresupuesto('gen');
      assert.match(el('presEliminarTexto').textContent,/Presupuesto general dejará de repetirse desde Esta semana \(28 sep – 4 oct 2026\)\. Los períodos anteriores conservan su límite\./);
      assert.match(el('presEliminarAcciones').innerHTML,/confirmarEliminarPresupuesto\('siguientes'/);assert.doesNotMatch(el('presEliminarAcciones').innerHTML,/'periodo'/);
      ui.cerrarEliminarPresupuesto();
      preparar([...SEMANA,fila({id:'ajuste',ambito:'categoria',categoria:'Comer afuera',periodo:'semanal',inicio:'2026-09-28',monto_limite:70,serie_id:'comer'})],GASTOS);ui.setPresVista('semanal');
      assert.match(tarjetas().find(t=>/Comer afuera/.test(t)),/de S\/ 70\.00[\s\S]*Ajustado solo para este período/);
      ui.eliminarPresupuesto('ajuste');
      assert.match(el('presEliminarTexto').textContent,/ajuste de S\/ 70\.00 sobre el presupuesto que se repite \(S\/ 100\.00\)/);
      assert.match(el('presEliminarAcciones').innerHTML,/Quitar el ajuste/);assert.match(el('presEliminarAcciones').innerHTML,/Dejar de repetir desde aquí/);
    }],
    ['Gastos y reembolsos nuevos se reflejan al volver a pintar, sin consultas',()=>{
      preparar(SEMANA,GASTOS);ui.setPresVista('semanal');
      datos.transacciones.push(['2026-10-03T10:00:00-05:00','Devolución','Comer afuéra','Reembolso',60,'Yape','re-1',null,'Comer afuéra2026-09-29T13:00:00-05:00',null,null,null,null,null,null,false]);
      ui.renderPresupuestos();
      assert.match(tarjetas().find(t=>/Comer afuera/.test(t)),/S\/ 0\.00<\/strong> de S\/ 100\.00/);assert.equal(pedidos.length,0);
    }],
    ['Presupuestos tiene una página independiente de Estadísticas',()=>{
      const analisis=fs.readFileSync(path.join(appRoot,'js/modules/analytics.js'),'utf8');
      assert.doesNotMatch(analisis,/renderPresupuestos|setEstadisticasVista|statsPanelPresupuestos/,'Estadísticas no pinta ni contiene la vista de presupuestos');
      const inicio=fs.readFileSync(path.join(appRoot,'js/modules/dashboard.js'),'utf8');
      assert.match(inicio,/if\(pagina==='p-pres'\)renderPresupuestos\(\);/,'se actualiza al volver a pintar la página de Presupuestos');
      assert.match(inicio,/if\(pagina==='p-bud'\)renderAnalisis\(\);/,'Estadísticas sigue actualizando su propio resumen');
      const indice=fs.readFileSync(path.join(appRoot,'index.html'),'utf8');
      const paginas=[...indice.matchAll(/<div class="page" id="([^"]+)"/g)];
      const contenidoPagina=id=>{const i=paginas.findIndex(p=>p[1]===id);assert.ok(i>=0,'existe '+id);return indice.slice(paginas[i].index,paginas[i+1]?.index??indice.length);};
      assert.match(contenidoPagina('p-pres'),/id="presupuestosSeccion"/,'la sección vive en su página propia');
      assert.doesNotMatch(contenidoPagina('p-bud'),/id="presupuestosSeccion"|statsViewTabs|statsPanelPresupuestos/,'Estadísticas sólo contiene su resumen');
    }],
  ];
  let fallos=0;
  for(const [nombre,fn] of casos){try{await fn();console.log('PASS: '+nombre+'.');}catch(e){fallos++;console.error('FAIL: '+nombre+'\n'+e.stack);}}
  assert.equal(fallos,0,'todos los escenarios de la interfaz deben pasar');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.Date=RealDate;globalThis.setTimeout=realTimeout;});
