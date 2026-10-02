// sbFetchTodo: Supabase corta en silencio cada respuesta a 1000 filas
// (max_rows). Se comprueba que con miles de filas llegan todas, que el orden
// se conserva, que no depende de que max_rows sea 1000, y que si el total no
// cuadra avisa en vez de devolver datos parciales.
//
// Se evalua el texto real de la funcion con un sbRespuesta simulado: el modulo
// completo arrastra auth.js y el resto de la app.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');

const {appRoot}=require('./helpers/app-root.cjs');
const src=fs.readFileSync(path.join(appRoot,'js','services','supabase.js'),'utf8');
const m=/export async function sbFetchTodo[\s\S]*?\n}\n/.exec(src);
assert.ok(m,'no se encontro sbFetchTodo en supabase.js');

// Servidor simulado: `filas` es la tabla, `maxRows` el tope por respuesta,
// `exponeTotal` si manda Content-Range, `antesDe` muta la tabla entre pedidos.
function servidor({filas,maxRows=1000,exponeTotal=true,antesDe=()=>{}}){
  const pedidos=[];let enCurso=0,maxEnCurso=0;
  const sbRespuesta=async(p,opts={})=>{
    antesDe(pedidos.length,filas);
    pedidos.push(p);
    enCurso++;maxEnCurso=Math.max(maxEnCurso,enCurso);
    await new Promise(r=>setTimeout(r,5));enCurso--;
    const q=new URLSearchParams(p.split('?')[1]);
    const off=Number(q.get('offset')||0),lim=Math.min(Number(q.get('limit')),maxRows);
    const parte=filas.slice(off,off+lim);
    const conteo=((opts.headers||{}).Prefer||'').includes('count=exact');
    const rango=`${parte.length?off+'-'+(off+parte.length-1):'*'}/${conteo?filas.length:'*'}`;
    return{headers:{get:h=>h.toLowerCase()==='content-range'&&exponeTotal?rango:null},json:async()=>parte};
  };
  const ctx=vm.createContext({sbRespuesta});
  vm.runInContext(m[0].replace('export ',''),ctx);
  return{sbFetchTodo:(...a)=>ctx.sbFetchTodo(...a),pedidos,get maxEnCurso(){return maxEnCurso;}};
}
const tabla=n=>Array.from({length:n},(_,i)=>({id:i+1}));

(async()=>{
  // 1. Hoy: menos de 1000 filas → un solo pedido, igual que antes.
  {const s=servidor({filas:tabla(424)});
   const r=await s.sbFetchTodo('transacciones?select=*&order=fecha.asc,id.asc');
   assert.equal(r.length,424);assert.equal(s.pedidos.length,1,'un solo viaje');
   assert.match(s.pedidos[0],/\?select=\*&order=fecha\.asc,id\.asc&limit=1000&offset=0$/);}

  // 2. 2500 filas → tres pedidos, todas, en orden y sin repetir.
  {const s=servidor({filas:tabla(2500)});
   const r=await s.sbFetchTodo('transacciones?select=*');
   assert.equal(r.length,2500);assert.equal(s.pedidos.length,3);
   assert.deepEqual([...r].map(x=>x.id),tabla(2500).map(x=>x.id));}

  // 2b. Las tandas restantes salen a la vez, no una tras otra.
  {const s=servidor({filas:tabla(10000)});
   assert.equal((await s.sbFetchTodo('t?select=*')).length,10000);
   assert.equal(s.maxEnCurso,9,'las 9 tandas restantes en paralelo');}

  // 3. Exactamente 1000 y 2000: no se queda corto ni pide de mas.
  for(const n of [1000,2000]){const s=servidor({filas:tabla(n)});
   assert.equal((await s.sbFetchTodo('t?select=*')).length,n);assert.equal(s.pedidos.length,n/1000);}

  // 4. Si Supabase bajara max_rows a 500, igual llegan todas (manda el total, no el tamaño de tanda).
  {const s=servidor({filas:tabla(2300),maxRows:500});
   assert.equal((await s.sbFetchTodo('t?select=*')).length,2300);}

  // 5. Tabla vacia.
  {const s=servidor({filas:[]});assert.equal((await s.sbFetchTodo("t?select=*")).length,0);}

  // 6. Ruta sin "?": el separador es "?".
  {const s=servidor({filas:tabla(3)});await s.sbFetchTodo('t');assert.match(s.pedidos[0],/^t\?limit=1000&offset=0$/);}

  // 7. Sin Content-Range expuesto: cae a "tanda incompleta" y sigue trayendo todo.
  {const s=servidor({filas:tabla(1500),exponeTotal:false});
   assert.equal((await s.sbFetchTodo('t?select=*')).length,1500);}
  {const s=servidor({filas:tabla(1500),exponeTotal:false,maxRows:500});
   assert.equal((await s.sbFetchTodo('t?select=*')).length,1500,'sin total también recorre el límite real');}
  {const s=servidor({filas:tabla(1500),antesDe:(i,f)=>{if(i===1){f.pop();f.unshift({id:0});}}});
   const r=await s.sbFetchTodo('t?select=*&order=id.asc');assert.equal(new Set(r.map(x=>x.id)).size,1500,'un duplicado obliga a reintentar');}

  // 8. Se borra una fila a mitad de la carga: el reintento lo resuelve.
  {const s=servidor({filas:tabla(1500),antesDe:(i,f)=>{if(i===1)f.pop();}});
   assert.equal((await s.sbFetchTodo('t?select=*')).length,1499);}

  // 9. No cuadra nunca (la tabla cambia en cada viaje): error con aviso, no datos parciales.
  {const s=servidor({filas:tabla(1500),antesDe:(i,f)=>{if(i>=1)f.pop();}});
   await assert.rejects(s.sbFetchTodo('t?select=*'),e=>e.incompleto===true&&/No se cargaron todos tus datos/.test(e.message));}

  console.log('ok');
})().catch(e=>{console.error(e);process.exit(1);});
