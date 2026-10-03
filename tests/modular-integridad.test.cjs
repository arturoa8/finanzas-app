// Integridad de finanzas-modular/: todo import resuelve a un export real y
// el puente (bridge.js) expone exactamente lo que invocan los onclick.
//
// Historia: nacio como prueba de EQUIVALENCIA con v2/propuesta.html (mismo
// CSS byte a byte, mismas definiciones), la garantia del refactor. Desde el
// 2026-09-27 el modular es la version publicada y la que evoluciona (primero
// con los graficos del portafolio), asi que ya no puede ser copia de v2: se
// conservan solo las comprobaciones de cableado, que siguen siendo validas.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const acorn=require(process.env.ACORN_MODULE||'acorn');

const RAIZ=path.join(__dirname,'..');
const {appRoot:MOD}=require('./helpers/app-root.cjs');
const indice=fs.readFileSync(path.join(MOD,'index.html'),'utf8');
const archivos=[];
(function rec(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())rec(p);else if(e.name.endsWith('.js'))archivos.push(p);
}})(path.join(MOD,'js'));
// Definiciones de nivel superior de todos los modulos (una sola vez cada una).
const nuevos={};
for(const f of archivos){
  const ast=acorn.parse(fs.readFileSync(f,'utf8'),{ecmaVersion:2022,sourceType:'module'});
  for(let n of ast.body){
    if(n.type==='ExportNamedDeclaration'&&n.declaration)n=n.declaration;
    const nombres=n.type==='FunctionDeclaration'?[n.id.name]:n.type==='VariableDeclaration'?n.declarations.map(d=>d.id.name):[];
    for(const k of nombres){assert.ok(!(k in nuevos),`"${k}" esta definido dos veces: ${nuevos[k]} y ${path.relative(MOD,f)}`);nuevos[k]=path.relative(MOD,f);}
  }
}

// ── 3. Todo import resuelve a un export real ──────────────────────────────
const exportados=f=>{
  const ast=acorn.parse(fs.readFileSync(f,'utf8'),{ecmaVersion:2022,sourceType:'module'});
  const s=new Set();
  for(const n of ast.body){
    if(n.type!=='ExportNamedDeclaration')continue;
    if(n.declaration){
      if(n.declaration.type==='FunctionDeclaration')s.add(n.declaration.id.name);
      else if(n.declaration.type==='VariableDeclaration')for(const d of n.declaration.declarations)s.add(d.id.name);
    }
    for(const e of n.specifiers||[])s.add(e.exported.name);
  }
  return s;
};
const rotos=[];
for(const f of archivos){
  const ast=acorn.parse(fs.readFileSync(f,'utf8'),{ecmaVersion:2022,sourceType:'module'});
  for(const n of ast.body){
    if(n.type!=='ImportDeclaration')continue;
    const destino=path.resolve(path.dirname(f),n.source.value);
    if(!fs.existsSync(destino)){rotos.push(`${path.relative(MOD,f)} -> ${n.source.value} (no existe)`);continue;}
    const disp=exportados(destino);
    for(const e of n.specifiers)
      if(e.type==='ImportSpecifier'&&!disp.has(e.imported.name))
        rotos.push(`${path.relative(MOD,f)} importa "${e.imported.name}" de ${n.source.value}, que no lo exporta`);
  }
}
assert.deepEqual(rotos,[],'imports que no resuelven');

// ── 4. El puente cubre exactamente los handlers inline del HTML ───────────
const usados=new Set();
for(const m of indice.matchAll(/\bon(?:click|change|input|submit|keyup|keydown|focus|blur)="([^"]*)"/g))
  for(const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g))usados.add(c[1]);
const nativas=new Set(['String','Number','Boolean','confirm','alert','if','closest','replace','stopPropagation','preventDefault','parseInt','parseFloat']);
const puente=fs.readFileSync(path.join(MOD,'js','bridge.js'),'utf8');
const expuestas=new Set((puente.match(/export const expuesto=\{([^}]*)\}/)||[,''])[1].split(',').map(s=>s.trim()).filter(Boolean));
const faltan=[...usados].filter(n=>!nativas.has(n)&&(n in nuevos||n+'__base' in nuevos)&&!expuestas.has(n));
assert.deepEqual(faltan,[],'funciones que el HTML invoca pero el puente no expone');
for(const n of expuestas)assert.ok(n in nuevos||n+'__base' in nuevos,`el puente expone "${n}", que no existe`);

// ── 5. index.html precarga exactamente los modulos que importa app.js ─────
// Un modulo nuevo sin precarga vuelve a encadenar descargas durante la
// cubierta de entrada; uno que ya no se importa se bajaria sin usarse.
const grafo=new Set(),pendientes=[path.join(MOD,'js','app.js')];
while(pendientes.length){
  const f=pendientes.shift();
  if(grafo.has(f))continue;
  grafo.add(f);
  const ast=acorn.parse(fs.readFileSync(f,'utf8'),{ecmaVersion:2022,sourceType:'module'});
  for(const n of ast.body)
    if(n.source&&/^(Import|ExportNamed|ExportAll)Declaration$/.test(n.type))pendientes.push(path.resolve(path.dirname(f),n.source.value));
}
const precargados=[...indice.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)">/g)].map(m=>m[1]);
assert.equal(new Set(precargados).size,precargados.length,'modulepreload repetido en index.html');
assert.deepEqual([...precargados].sort(),[...grafo].map(f=>path.relative(MOD,f).split(path.sep).join('/')).sort(),
  'los modulepreload de index.html no coinciden con los modulos que importa app.js');

console.log(`PASS: ${Object.keys(nuevos).length} definiciones sin duplicar, ${archivos.length} modulos sin imports rotos, `+
 `${expuestas.size} handlers cubiertos por el puente y ${precargados.length} modulos precargados.`);
