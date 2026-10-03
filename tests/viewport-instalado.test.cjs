const assert=require('node:assert/strict');
const {modulo}=require('./helpers/app-root.cjs');
const contenido={inert:true},cubierta={hidden:false},body={style:{minHeight:''}};
const root={scrollHeight:852,clientHeight:852};
globalThis.document={body,documentElement:root,scrollingElement:root,hidden:false,getElementById:id=>id==='appContent'?contenido:cubierta};
const nav={userAgent:'iPhone',standalone:true};
Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true});
globalThis.matchMedia=()=>({matches:false});
const movimientos=[];
globalThis.window={innerHeight:852,scrollX:0,scrollY:0,scrollTo(p){
  const max=Math.max(root.scrollHeight,parseFloat(body.style.minHeight)||0)-this.innerHeight;
  this.scrollY=Math.max(0,Math.min(p.top,max));movimientos.push({...p,actual:this.scrollY});
}};
const raf=fn=>queueMicrotask(fn);
globalThis.requestAnimationFrame=raf;
(async()=>{
  const {estabilizarVistaInstalada}=await modulo('ui/viewport.js');
  await estabilizarVistaInstalada();
  assert.deepEqual(movimientos.map(p=>p.actual),[1,0],'un resumen sin scroll también debe desplazarse realmente');
  assert.ok(movimientos.every(p=>p.behavior==='instant'));
  assert.equal(window.scrollY,0);assert.equal(body.style.minHeight,'','se restaura el tamaño antes de revelar');
  movimientos.length=0;window.scrollY=-62;
  await estabilizarVistaInstalada();
  assert.equal(window.scrollY,0,'se corrige también el desplazamiento negativo inicial');
  assert.deepEqual(movimientos.map(p=>p.actual),[1,0]);
  for(const variante of ['navegador','escritorio','visible','oculta','desplazada']){
    movimientos.length=0;nav.standalone=variante!=='navegador';
    nav.userAgent=variante==='escritorio'?'Linux':'iPhone';
    contenido.inert=variante!=='visible';document.hidden=variante==='oculta';
    window.scrollY=variante==='desplazada'?120:0;
    await estabilizarVistaInstalada();assert.equal(movimientos.length,0,variante);
  }
  contenido.inert=true;document.hidden=false;window.scrollY=0;
  let cuadro=0;
  requestAnimationFrame=fn=>queueMicrotask(()=>{if(++cuadro===3)window.scrollY=80;fn();});
  await estabilizarVistaInstalada();
  assert.equal(window.scrollY,80,'no se deshace un desplazamiento ajeno');
  assert.deepEqual(movimientos.map(p=>p.top),[1]);assert.equal(body.style.minHeight,'');
  movimientos.length=0;window.scrollY=0;cuadro=0;
  requestAnimationFrame=fn=>queueMicrotask(()=>{cuadro++;fn();});
  await estabilizarVistaInstalada({vigente:()=>cuadro===0});
  assert.equal(movimientos.length,0,'una salida cancelada no reajusta el login posterior');
  requestAnimationFrame=raf;body.style.minHeight='900px';root.scrollHeight=900;
  await estabilizarVistaInstalada();assert.equal(body.style.minHeight,'900px','se conserva una altura previa');
  console.log('PASS: arranque iOS corto y con offset negativo, restauración de altura, cancelación y respeto de lectura/navegador.');
})().catch(e=>{console.error(e);process.exitCode=1;});
