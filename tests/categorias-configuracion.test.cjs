// CRUD del catálogo contra una API en memoria; no toca datos reales.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo,appRoot}=require('./helpers/app-root.cjs');
const fs=require('node:fs'),path=require('node:path');
entornoPrueba();
const nodos=new Map();
function el(id){
 if(!nodos.has(id))nodos.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,
  classList:{contains:()=>false,add(){},remove(){}},setAttribute(){},querySelectorAll:()=>[],focus(){}});
 return nodos.get(id);
}
document.getElementById=el;
globalThis.window={scrollTo(){},matchMedia:()=>({matches:true})};
const tiempoReal=setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{const t=tiempoReal(fn,ms,...args);if(ms>=1000)t.unref?.();return t;};
const sesion=usuario=>localStorage.setItem('sb_session',JSON.stringify({user_id:usuario,access_token:'token-demo',expires_at:Date.now()+3600000}));
sesion('usuario-demo');
const servidor=new Map([['Comer afuera',{nombre:'Comer afuera',color:'#ffb84d'}],['Ocio',{nombre:'Ocio',color:'#ff6ad4'}]]);
let pedidos=[],fallar=false,vacio=false,retener=null;
globalThis.fetch=async(url,opts={})=>{
 const u=new URL(url),metodo=opts.method||'GET';
 assert.equal(u.pathname,'/rest/v1/categorias','sólo se modifica el catálogo de categorías');
 assert.ok(['POST','PATCH','DELETE'].includes(metodo));
 const body=opts.body?JSON.parse(opts.body):null,nombre=u.searchParams.get('nombre')?.replace(/^eq\./,'');
 pedidos.push({metodo,nombre,body,url,prefer:opts.headers.Prefer});
 if(retener)await retener;
 if(fallar){fallar=false;return new Response(JSON.stringify({message:'Red temporalmente no disponible'}),{status:503});}
 if(vacio){vacio=false;return new Response('[]',{headers:{'content-type':'application/json'}});}
 let row;
 if(metodo==='DELETE'){row=servidor.get(nombre);servidor.delete(nombre);}
 else{row={...(servidor.get(nombre)||{}),...body};if(metodo==='PATCH')servidor.delete(nombre);servidor.set(row.nombre,row);}
 return new Response(JSON.stringify(row?[row]:[]),{headers:{'content-type':'application/json'}});
};
const esperar=async(pred)=>{for(let i=0;i<80;i++){if(pred())return;await new Promise(r=>tiempoReal(r,2));}assert.fail('No comenzó la operación ficticia');};

(async()=>{
 const [{datos},categorias]=await Promise.all([modulo('state.js'),modulo('modules/categories.js')]);
 Object.assign(datos,{cargados:true,categorias:[['Comer afuera','#ffb84d'],['Ocio','#ff6ad4']],
  transacciones:[['2026-10-02','Fridays','Comer afuera','Gasto',47.6,'Visa demo','g-1'],['2026-10-03','Devolución Fridays','Comer afuera','Reembolso',50,'Plin','r-1',null,'g-1']],
  presupuestos:[['Comer afuera',300,'2026-10']],recurrentes:[['Almuerzo','Comer afuera','Gasto',20,1,true]]});
 const historicos=JSON.stringify([datos.transacciones,datos.presupuestos,datos.recurrentes]);
 categorias.renderCategoriasConfig();
 assert.match(el('categoriasLista').innerHTML,/Comer afuera/);
 assert.match(el('categoriasLista').innerHTML,/2 movimientos · 1 presupuesto · 1 recurrente/);

 // Agregar y editar utiliza la PK nombre. Nunca crea cambios financieros.
 categorias.agregarCategoria();assert.equal(el('categoryForm').hidden,false);
 el('categoryName').value='  Salud  ';el('categoryColor').value='#7aa2ff';
 await categorias.guardarCategoria();
 assert.deepEqual(datos.categorias.at(-1),['Salud','#7aa2ff']);
 assert.equal(pedidos.at(-1).metodo,'POST');assert.deepEqual(pedidos.at(-1).body,{nombre:'Salud',color:'#7aa2ff'});
 assert.equal(el('categoryForm').hidden,true);
 categorias.editarCategoria('Comer afuera');
 assert.match(el('categoryEditNote').textContent,/registros existentes conservarán/);
 el('categoryName').value='Restaurantes';el('categoryColor').value='#123456';await categorias.guardarCategoria();
 assert.equal(pedidos.at(-1).metodo,'PATCH');assert.equal(pedidos.at(-1).nombre,'Comer afuera');
 assert.ok(datos.categorias.some(c=>c[0]==='Restaurantes'));
 assert.ok(!datos.categorias.some(c=>c[0]==='Comer afuera'));
 assert.equal(JSON.stringify([datos.transacciones,datos.presupuestos,datos.recurrentes]),historicos,'renombrar no reescribe histórico ni reembolsos');
 categorias.editarCategoria('Restaurantes');el('categoryName').value='Almuerzos';
 const antesPatch=JSON.stringify(datos.categorias);fallar=true;await categorias.guardarCategoria();
 assert.equal(JSON.stringify(datos.categorias),antesPatch);assert.equal(el('categoryForm').hidden,false);
 vacio=true;await categorias.guardarCategoria();assert.equal(JSON.stringify(datos.categorias),antesPatch);assert.match(el('categoryFormError').textContent,/confirmar/);
 categorias.cancelarCategoria();

 // Nombres duplicados normalizados, vacíos y colores no válidos se rechazan.
 categorias.agregarCategoria();
 for(const [nombre,color] of [['salúd','#112233'],['','#112233'],['x'.repeat(61),'#112233'],['Inválido','red'],['Inválido','#123456;display:none']]){
  el('categoryName').value=nombre;el('categoryColor').value=color;const antes=pedidos.length;
  await categorias.guardarCategoria();assert.equal(pedidos.length,antes);assert.equal(el('categoryForm').hidden,false);assert.equal(el('categoryFormError').hidden,false);
 }

 // Fallos y respuestas sin filas no se anuncian como éxito ni borran el editor.
 el('categoryName').value='Viajes';el('categoryColor').value='#abcdef';
 const antes=JSON.stringify(datos.categorias);fallar=true;await categorias.guardarCategoria();
 assert.equal(JSON.stringify(datos.categorias),antes);assert.match(el('categoryFormError').textContent,/Red temporalmente/);
 vacio=true;await categorias.guardarCategoria();
 assert.equal(JSON.stringify(datos.categorias),antes);assert.match(el('categoryFormError').textContent,/confirmar/);
 let liberar;retener=new Promise(r=>{liberar=r;});const numero=pedidos.length,promesa=categorias.guardarCategoria();
 await esperar(()=>pedidos.length===numero+1);await categorias.guardarCategoria();
 categorias.cancelarCategoria();categorias.editarCategoria('Salud');
 assert.equal(pedidos.length,numero+1,'el doble clic envía un solo POST');assert.equal(el('categoryName').value,'Viajes','un guardado activo mantiene su contexto');
 liberar();await promesa;retener=null;assert.ok(datos.categorias.some(c=>c[0]==='Viajes'));assert.equal(el('categoryForm').hidden,true);
 await categorias.guardarCategoria();assert.equal(pedidos.length,numero+1,'un editor ya cerrado no vuelve a escribir');

 // Caracteres HTML se muestran como texto, también en atributos de handlers.
 const nombreEspecial='Papá & "Casa" <script>';
 categorias.agregarCategoria();el('categoryName').value=nombreEspecial;el('categoryColor').value='#AABBCC';await categorias.guardarCategoria();
 assert.match(el('categoriasLista').innerHTML,/Papá &amp; &quot;Casa&quot; &lt;script&gt;/);
 assert.doesNotMatch(el('categoriasLista').innerHTML,/<script>/);
 categorias.editarCategoria(nombreEspecial);el('categoryColor').value='#aabbcc';await categorias.guardarCategoria();
 assert.equal(new URL(pedidos.at(-1).url).searchParams.get('nombre'),'eq.'+nombreEspecial,'el nombre se filtra exactamente y codificado');

 // La confirmación de borrado pide la fila devuelta para detectar RLS sin efecto.
 categorias.eliminarCategoria('Salud');assert.equal(el('categoryDeletePanel').hidden,false);
 assert.match(el('categoryDeleteNote').textContent,/Solo se quitará del catálogo/);
 const antesDelete=JSON.stringify(datos.categorias);vacio=true;await categorias.confirmarEliminarCategoria();
 assert.equal(JSON.stringify(datos.categorias),antesDelete);assert.equal(el('categoryDeletePanel').hidden,false);assert.match(el('categoryDeleteError').textContent,/confirmar/);
 fallar=true;await categorias.confirmarEliminarCategoria();assert.equal(JSON.stringify(datos.categorias),antesDelete);
 retener=new Promise(r=>{liberar=r;});const numDelete=pedidos.length,borrando=categorias.confirmarEliminarCategoria();
 await esperar(()=>pedidos.length===numDelete+1);await categorias.confirmarEliminarCategoria();assert.equal(pedidos.length,numDelete+1);
 liberar();await borrando;retener=null;assert.ok(!datos.categorias.some(c=>c[0]==='Salud'));assert.equal(el('categoryDeletePanel').hidden,true);
 assert.equal(pedidos.at(-1).prefer,'return=representation');
 await categorias.confirmarEliminarCategoria();assert.equal(pedidos.length,numDelete+1);
 categorias.agregarCategoria();el('categoryName').value='Comer afuera';el('categoryColor').value='#ffb84d';await categorias.guardarCategoria();
 categorias.eliminarCategoria('Comer afuera');assert.match(el('categoryDeleteNote').textContent,/2 movimientos · 1 presupuesto · 1 recurrente/);
 await categorias.confirmarEliminarCategoria();
 assert.ok(!datos.categorias.some(c=>c[0]==='Comer afuera'));assert.equal(JSON.stringify([datos.transacciones,datos.presupuestos,datos.recurrentes]),historicos,'eliminar una categoría usada conserva sus registros financieros');

 // Cambiar sesión durante una operación impide mezclar el resultado en memoria.
 categorias.agregarCategoria();el('categoryName').value='Solo usuario anterior';el('categoryColor').value='#112233';
 const catalogoSesion=JSON.stringify(datos.categorias);retener=new Promise(r=>{liberar=r;});const numSesion=pedidos.length,cambio=categorias.guardarCategoria();
 await esperar(()=>pedidos.length===numSesion+1);sesion('otro-usuario');liberar();await cambio;retener=null;
 assert.equal(JSON.stringify(datos.categorias),catalogoSesion);assert.match(el('categoryFormError').textContent,/sesión cambió/);
 await categorias.guardarCategoria();assert.equal(pedidos.length,numSesion+1,'no reutiliza un editor abierto por otra sesión');
 categorias.cancelarCategoria();sesion('usuario-demo');
 categorias.eliminarCategoria('Ocio');retener=new Promise(r=>{liberar=r;});const numCambioDelete=pedidos.length,cambioDelete=categorias.confirmarEliminarCategoria();
 await esperar(()=>pedidos.length===numCambioDelete+1);sesion('otro-usuario');liberar();await cambioDelete;retener=null;
 assert.equal(JSON.stringify(datos.categorias),catalogoSesion);assert.match(el('categoryDeleteError').textContent,/sesión cambió/);
 categorias.cancelarCategoria();sesion('usuario-demo');

 // No se permite crear un catálogo sobre una carga aún incompleta.
 datos.cargados=false;categorias.agregarCategoria();const finalPedidos=pedidos.length;await categorias.guardarCategoria();
 assert.equal(pedidos.length,finalPedidos);assert.equal(JSON.stringify([datos.transacciones,datos.presupuestos,datos.recurrentes]),historicos);
 const html=fs.readFileSync(path.join(appRoot,'index.html'),'utf8');
 assert.match(html,/id="categoriasConfigSection"/);assert.match(html,/onclick="confirmarEliminarCategoria\(\)"/);
 console.log('PASS: catálogo CRUD confirmado, histórico intacto, validación, HTML seguro, errores, doble clic y cambios de sesión.');
})().catch(e=>{console.error(e);process.exitCode=1;});
