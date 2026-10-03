const assert=require('node:assert/strict');
const {modulo}=require('./helpers/app-root.cjs');
const contenido={inert:true},cubierta={hidden:false};
globalThis.document={hidden:false,getElementById:id=>id==='appContent'?contenido:cubierta};
const nav={userAgent:'iPhone',standalone:true};
Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true});
globalThis.matchMedia=()=>({matches:false});
const movimientos=[];
globalThis.window={scrollX:0,scrollY:0,scrollTo(p){movimientos.push(p);this.scrollY=p.top;}};
globalThis.requestAnimationFrame=fn=>queueMicrotask(fn);
(async()=>{
  const {estabilizarVistaInstalada}=await modulo('ui/viewport.js');
  await estabilizarVistaInstalada();
  assert.deepEqual(movimientos.map(p=>p.top),[1,0]);
  assert.ok(movimientos.every(p=>p.behavior==='instant'));
  assert.equal(window.scrollY,0,'se conserva la posición inicial');
  for(const variante of ['navegador','escritorio','visible','oculta','desplazada']){
    movimientos.length=0;nav.standalone=variante!=='navegador';
    nav.userAgent=variante==='escritorio'?'Linux':'iPhone';
    contenido.inert=variante!=='visible';document.hidden=variante==='oculta';
    window.scrollY=variante==='desplazada'?120:0;
    await estabilizarVistaInstalada();assert.equal(movimientos.length,0,variante);
  }
  contenido.inert=true;document.hidden=false;window.scrollY=0;
  requestAnimationFrame=fn=>queueMicrotask(()=>{window.scrollY=80;fn();});
  await estabilizarVistaInstalada();
  assert.equal(window.scrollY,80,'no se deshace un desplazamiento ajeno');
  assert.deepEqual(movimientos.map(p=>p.top),[1]);
  console.log('PASS: estabilización limitada al arranque iOS instalado, posición conservada y contenido visible intacto.');
})().catch(e=>{console.error(e);process.exitCode=1;});
