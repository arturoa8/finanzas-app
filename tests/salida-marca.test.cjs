// La salida de la cubierta: el nombre viaja al logo del encabezado, el logo
// real se oculta solo durante el viaje y una salida interrumpida lo restaura.
const assert=require('node:assert/strict');
const {modulo}=require('./helpers/app-root.cjs');

function aplazado(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const animaciones=[];
function nodo(id,rect){
  const attrs=new Map(),clases=new Set();
  return {id,hidden:false,inert:false,style:{},textContent:'',offsetHeight:844,hijos:{},
    classList:{add:x=>clases.add(x),remove:(...xs)=>xs.forEach(x=>clases.delete(x)),contains:x=>clases.has(x)},
    setAttribute(k,v){attrs.set(k,String(v));},getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),
    querySelector(s){return this.hijos[s]||null;},getAnimations:()=>[],
    getBoundingClientRect:()=>rect||{left:0,top:0,width:0,height:0},
    animate(frames,opciones){
      const fin=aplazado(),a={elemento:id,frames,opciones,finished:fin.promise,terminar:fin.resolve,cancelada:false,cancel(){this.cancelada=true;}};
      animaciones.push(a);return a;
    }};
}
const marca=nodo('marca',{left:120,top:400,width:230,height:40});
const capa=nodo('capa');
const pantalla=nodo('appStartup');pantalla.hijos={'.startup-brand':marca,'.startup-content':capa};
const logo=nodo('logo',{left:16,top:38,width:115,height:22});
const dash=nodo('p-dash');dash.hijos={'.header .logo':logo};
const nodos={appStartup:pantalla,'p-dash':dash};
for(const id of ['appContent','authGate','startupTitle','startupDetail','startupActions'])nodos[id]=nodo(id);
globalThis.document={getElementById:id=>nodos[id]||null,hidden:false};
globalThis.matchMedia=()=>({matches:false});
globalThis.navigator={userAgent:'Linux'};

(async()=>{
  const startup=await modulo('ui/startup.js');
  startup.prepararInicio();
  const revelado=startup.revelarInicio();
  await new Promise(r=>setTimeout(r,5));
  const [salida,fija,viaje]=animaciones;
  assert.equal(salida.elemento,'appStartup','la cubierta es la que sube');
  assert.equal(fija.elemento,'capa','el contenido se contrarresta para no subir con la cubierta');
  assert.equal(viaje.elemento,'marca','el nombre viaja por su cuenta');
  const y=f=>parseFloat(f.transform.match(/translateY\((-?[\d.]+)px\)/)[1]);
  assert.deepEqual(salida.frames.map((f,i)=>y(f)+y(fija.frames[i])),[0,0,0],'ambos recorridos son opuestos');
  assert.equal(y(salida.frames.at(-1))<-844,true,'la cubierta sale por completo, borde verde incluido');
  assert.equal(viaje.frames.at(-1).transform,`translate(-104px,-362px) scale(${115/230})`,'aterriza en la posición y tamaño del logo');
  assert.equal(logo.style.opacity,'0','el logo real se oculta mientras el nombre viaja');
  assert.equal(nodos.appContent.inert,true,'Inicio queda bloqueado hasta terminar la salida');
  salida.terminar();await revelado;
  assert.equal(pantalla.hidden,true);assert.equal(nodos.appContent.inert,false);
  assert.equal(logo.style.opacity,'','el logo real vuelve exactamente donde aterrizó el nombre');
  assert.ok(fija.cancelada&&viaje.cancelada,'las animaciones de la salida no se quedan aplicadas');

  animaciones.length=0;
  startup.prepararInicio();
  const viejo=startup.revelarInicio();
  await new Promise(r=>setTimeout(r,5));
  assert.equal(logo.style.opacity,'0');
  startup.mostrarAcceso();
  assert.equal(logo.style.opacity,'','cerrar sesión durante la salida restaura el logo');
  animaciones[0].terminar();await viejo;
  assert.equal(nodos.appContent.inert,true,'una salida interrumpida no habilita Inicio');
  console.log('PASS: nombre al logo, cubierta contrarrestada, logo restaurado y salida interrumpible.');
})().catch(e=>{console.error(e);process.exitCode=1;});
