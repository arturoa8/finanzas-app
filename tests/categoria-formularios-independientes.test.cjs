// Presupuestos y movimientos no comparten la selección de categoría. DOM y
// API ficticios: guardar en esta prueba nunca escribe en Supabase real.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';entornoPrueba();
const nodos=new Map(),chipsPorContenedor=new Map();
const timeoutReal=setTimeout;

function nodo(id){
  const clases=new Set(),atributos=new Map();let contenido='',valor='';
  return {id,dataset:{},style:{},hidden:false,disabled:false,checked:false,textContent:'',offsetWidth:320,
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
      toggle(x,force){const on=force??!clases.has(x);if(on)clases.add(x);else clases.delete(x);return on;}},
    get value(){return valor;},set value(v){valor=String(v??'');},
    get innerHTML(){return contenido;},set innerHTML(v){
      contenido=String(v);
      if(!['catChips','presCategorias'].includes(id))return;
      chipsPorContenedor.set(id,[...contenido.matchAll(/<button\b[^>]*class="cchip([^"]*)"[^>]*data-cat="([^"]*)"/g)].map((m,i)=>{
        const c=nodo(id+'-'+i);c.dataset.cat=m[2];if(m[1].includes('selected'))c.classList.add('selected');return c;
      }));
    },
    setAttribute(k,v){atributos.set(k,String(v));},getAttribute:k=>atributos.get(k)??null,removeAttribute:k=>atributos.delete(k),
    querySelector:()=>null,querySelectorAll:()=>[],focus(){document.activeElement=this;},addEventListener(){},
  };
}
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
const chips=id=>chipsPorContenedor.get(id)||[];
const todos=()=>[...chips('catChips'),...chips('presCategorias')];
document.getElementById=el;document.body=nodo('body');
// El selector genérico queda disponible para reproducir el defecto anterior:
// incluye también los chips del presupuesto cerrado.
document.querySelector=s=>s==='#catChips .cchip.selected'?chips('catChips').find(c=>c.classList.contains('selected'))||null:
  s==='.cchip.selected'?todos().find(c=>c.classList.contains('selected'))||null:null;
document.querySelectorAll=s=>s==='#catChips .cchip'?chips('catChips'):s==='.cchip'?todos():[];
globalThis.matchMedia=()=>({matches:true});globalThis.window={matchMedia};
globalThis.setTimeout=(fn,ms,...a)=>{const t=timeoutReal(fn,ms,...a);if(ms>=1000)t.unref?.();return t;};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:Date.now()+3600000}));

const peticiones=[];
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url);
  assert.equal(u.pathname,'/rest/v1/transacciones','se bloquea cualquier otra API');
  assert.equal(opts.method,'PATCH','sólo se simula editar un movimiento existente');
  const body=JSON.parse(opts.body),id=u.searchParams.get('id').slice(3);
  peticiones.push({id,body});
  return new Response(JSON.stringify([{...body,id}]),{status:200,headers:{'content-type':'application/json'}});
};
const seleccionadas=id=>chips(id).filter(c=>c.classList.contains('selected')).map(c=>c.dataset.cat);

(async()=>{
  const [tx,pres,cuentas,{datos}]=await Promise.all([modulo('modules/transactions.js'),modulo('modules/presupuestos.js'),modulo('modules/accounts.js'),modulo('state.js')]);
  Object.assign(datos,{cargados:true,categoriasCargadas:true,categorias:[['Compras','#00d68f'],['Ocio','#7aa2ff']],
    cuentas:[['Plin','billetera','PEN',false,'plin']],configTarjetas:[],pagosTarjetas:[],ciclosOverride:[],presupuestos:[],recurrentes:[],
    deudas:[],deudasArchivadas:[],deudasAbonos:[],transacciones:[
      ['2026-10-04T12:00:00-05:00','Cine','Ocio','Gasto',20,'Plin','gasto-ocio'],
      ['2026-10-04T13:00:00-05:00','Libro','Compras','Gasto',30,'Plin','gasto-compras'],
    ]});
  cuentas.setEstadoCuentas('lista');cuentas.setCuentasMigradas(true);el('iMoneda').value='PEN';
  pres.abrirNuevoPresupuesto();pres.setPresAmbito('categoria');
  pres.seleccionarPresCategoria(chips('presCategorias').find(c=>c.dataset.cat==='Compras'));pres.cerrarPresupuestoForm();
  assert.deepEqual(seleccionadas('presCategorias'),['Compras']);

  tx.editarTx('gasto-ocio');
  assert.deepEqual(seleccionadas('catChips'),['Ocio'],'la categoría original es única desde que se abre la edición');
  assert.deepEqual(seleccionadas('presCategorias'),['Compras'],'editar un movimiento no cambia el presupuesto cerrado');
  el('iDes').value='Cine corregido';await tx.guardar();
  assert.equal(peticiones.length,1);assert.equal(peticiones[0].body.categoria,'Ocio','corregir la descripción conserva la categoría financiera');
  assert.equal(datos.transacciones[0][2],'Ocio');

  tx.editarTx('gasto-compras');assert.deepEqual(seleccionadas('catChips'),['Compras']);
  tx.editarTx('gasto-ocio');assert.deepEqual(seleccionadas('catChips'),['Ocio'],'una segunda edición no hereda la categoría anterior');
  await new Promise(r=>timeoutReal(r,65));
  assert.deepEqual(seleccionadas('catChips'),['Ocio'],'no quedan callbacks antiguos que añadan otra selección');
  tx.seleccionarCat(chips('catChips').find(c=>c.dataset.cat==='Compras'));
  assert.deepEqual(seleccionadas('catChips'),['Compras']);assert.deepEqual(seleccionadas('presCategorias'),['Compras'],'cambiar categoría sólo afecta al movimiento');
  tx.cerrarM();tx.abrirM();
  assert.deepEqual(seleccionadas('catChips'),[],'una transacción nueva exige su propia selección');
  assert.deepEqual(seleccionadas('presCategorias'),['Compras'],'abrir una transacción no limpia la selección de otro formulario');
  tx.cerrarM();
  console.log('PASS: Presupuestos y movimientos conservan categorías independientes; editar sólo la descripción guarda la categoría original y cada edición tiene una selección única.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.setTimeout=timeoutReal;});
