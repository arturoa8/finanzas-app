const fs=require('node:fs'),path=require('node:path');
const project=path.join(__dirname,'../..');
const appRoot=process.env.FINANZAS_APP_DIR||(fs.existsSync(path.join(project,'finanzas-modular'))?path.join(project,'finanzas-modular'):project);
function entornoPrueba(){
  const almacen=new Map();
  globalThis.document={getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  globalThis.localStorage={getItem:k=>almacen.get(k)||null,setItem:(k,v)=>almacen.set(k,String(v)),removeItem:k=>almacen.delete(k)};
  return almacen;
}
const modulo=p=>import(require('node:url').pathToFileURL(path.join(appRoot,'js',p)).href);
module.exports={appRoot,entornoPrueba,modulo};
