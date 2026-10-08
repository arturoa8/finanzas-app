const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {appRoot,modulo}=require('./helpers/app-root.cjs');

const leer=f=>fs.readFileSync(path.join(appRoot,f),'utf8');
const apple=leer('css/apple.css');
const indice=leer('index.html');

const luminancia=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2];};
const contraste=(a,b)=>{const x=luminancia(a),y=luminancia(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

(async()=>{
  // La capa de movimiento va última: solo añade o afina lo anterior.
  const hojas=[...indice.matchAll(/<link rel="stylesheet" href="\.\/css\/([^"]+)">/g)].map(m=>m[1]);
  assert.equal(hojas[hojas.length-1],'apple.css','apple.css es la última hoja de estilo');

  // El texto secundario cumple WCAG AA (4,5:1) sobre las superficies de tarjeta.
  const muted=/--muted:(#[0-9a-f]{6})/i.exec(apple)[1];
  for(const fondo of ['#000000','#111113','#18181b'])assert.ok(contraste(muted,fondo)>=4.5,`--muted ${muted} sobre ${fondo}`);

  // Las tres preferencias de accesibilidad tienen su propia rama.
  for(const m of ['prefers-reduced-motion','prefers-reduced-transparency','prefers-contrast'])
    assert.match(apple,new RegExp('@media\\(\\s*'+m),m);
  // Movimiento reducido conserva un fundido, no deja el cambio sin respuesta.
  assert.match(apple,/transition-property:opacity/,'movimiento reducido mantiene fundidos');

  // Los resortes son curvas linear() con respaldo para Safari antiguo.
  assert.match(apple,/@supports \(transition-timing-function:linear\(0,1\)\)/);
  assert.match(apple,/--resorte:cubic-bezier/,'hay curva de respaldo');
  // Una animación con fill-mode both taparía el transform en línea del gesto.
  assert.doesNotMatch(apple.replace(/\/\*[\s\S]*?\*\//g,''),/\.mc[^{]*\{[^}]*animation:[^;}]*\bboth\b/,'las hojas no usan fill-mode both');

  // La inercia usa la misma desaceleración que el desplazamiento de iOS.
  const {proyectar}=await modulo('ui/sheet-drag.js');
  assert.ok(Math.abs(proyectar(0.5)-249.5)<0.01,'0,5 px/ms proyecta ~250 px');
  assert.equal(proyectar(0),0);
  console.log('apple-design: OK');
})().catch(e=>{console.error(e);process.exit(1);});
