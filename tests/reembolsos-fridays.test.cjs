// Aceptación del reembolso desde un gasto. API y DOM ficticios: ninguna
// petición de esta prueba puede leer o cambiar los movimientos del usuario.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date,realTimeout=setTimeout;
const ahora=RealDate.parse('2026-10-03T12:00:00-05:00');
globalThis.Date=class extends RealDate{
  constructor(...args){super(...(args.length?args:[ahora]));}
  static now(){return ahora;}
};
const almacen=entornoPrueba();
const nodos=new Map();let chips=[];
function nodo(id){
  const clases=new Set(),atributos=new Map();let contenido='',valor='';
  return {id,dataset:{},style:{},hidden:false,disabled:false,readOnly:false,inert:false,textContent:'',offsetWidth:320,
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
      toggle(x,force){const activo=force??!clases.has(x);if(activo)clases.add(x);else clases.delete(x);return activo;}},
    get value(){return valor;},set value(v){
      const nuevo=String(v??'');
      // Un SELECT nativo no conserva un valor cuya OPTION no existe aún.
      // Es indispensable para detectar el prefilling antes de llenar el menú.
      valor=id==='iGastoOrigen'&&!([...contenido.matchAll(/<option\b[^>]*value="([^"]*)"/g)].some(m=>m[1]===nuevo))?'':nuevo;
    },
    get innerHTML(){return contenido;},set innerHTML(v){
      contenido=String(v);
      if(id==='iGastoOrigen')valor=[...contenido.matchAll(/<option\b[^>]*value="([^"]*)"/g)][0]?.[1]||'';
      if(id==='catChips')chips=[...contenido.matchAll(/data-cat="([^"]*)"/g)].map((m,i)=>{const c=nodo('chip-'+i);c.dataset.cat=m[1];return c;});
    },
    setAttribute(k,v){atributos.set(k,String(v));},getAttribute:k=>atributos.get(k)??null,removeAttribute:k=>atributos.delete(k),
    querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},focus(){},
  };
}
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
document.getElementById=el;
document.querySelector=s=>s==='#catChips .cchip.selected'?chips.find(c=>c.classList.contains('selected'))||null:null;
document.querySelectorAll=s=>s==='#catChips .cchip'?chips:[];document.body=nodo('body');
globalThis.matchMedia=()=>({matches:true});globalThis.window={matchMedia};
globalThis.setTimeout=(fn,ms,...args)=>{const timer=realTimeout(fn,ms,...args);if(ms>=1000)timer.unref?.();return timer;};
const sesion=()=>localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:ahora+3600000}));
sesion();
let peticiones=[],servidor=new Map(),falla=null,retener=null,equivalente=(a,b)=>Math.round(Number(a)*Number(b)*100)/100;
const cent=n=>Math.round(Number(n)*100);
function cuerpoDe(t){return {fecha:t[0],descripcion:t[1],categoria:t[2],tipo:t[3],monto:t[4],cuenta:t[5],id:t[6],
  cuenta_destino:t[7]||null,transaccion_origen_id:t[8]||null,moneda_original:t[9]||null,monto_original:t[10]??null,tc:t[11]??null,
  tc_fuente:t[12]||null,moneda_destino:t[13]||null,monto_destino:t[14]??null};}
const json=(rows,status=200)=>new Response(JSON.stringify(rows),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),method=opts.method||'GET';
  assert.equal(u.pathname,'/rest/v1/transacciones','la prueba bloquea cualquier otra API');
  if(method==='GET'){
    if(falla==='confirmacion-403'){falla=null;return json({message:'Lectura temporalmente rechazada'},403);}
    const pred=u.searchParams.get('id')||'';
    const ids=pred.startsWith('eq.')?[pred.slice(3)]:pred.startsWith('in.(')?pred.slice(4,-1).split(','):[];
    return json([...servidor.values()].filter(r=>!ids.length||ids.includes(r.id)));
  }
  assert.ok(['POST','PATCH'].includes(method),'no debe borrar el gasto original');
  const body=JSON.parse(opts.body);peticiones.push({method,body});
  if(Array.isArray(body))body.forEach(r=>assert.deepEqual(Object.keys(r).sort(),Object.keys(body[0]).sort(),'PostgREST exige las mismas columnas en todas las filas del lote'));
  if(retener)await retener;
  if(falla==='antes'){falla=null;return json({message:'Error de validación ficticio'},400);}
  const entries=(Array.isArray(body)?body:[body]).map((r,i)=>({...r,id:r.id||(method==='PATCH'?u.searchParams.get('id').replace(/^eq\./,''):'nuevo-'+peticiones.length+'-'+i)}));
  if(method==='POST'&&entries.some(r=>servidor.has(r.id)))return json({message:'Registro duplicado'},409);
  // Simula una transacción de servidor: se valida el lote completo antes de
  // insertar cualquiera de las filas. Conserva el límite real de reembolso.
  for(const r of entries){
    if(r.moneda_original==='USD')r.monto=equivalente(r.monto_original,r.tc);
    if(r.tipo==='Reembolso'){
      const original=servidor.get(r.transaccion_origen_id);
      assert.ok(original&&original.tipo==='Gasto','vincula una devolución a un gasto existente');
      assert.equal(r.categoria,original.categoria,'hereda la categoría del gasto');
      const usado=[...servidor.values()].filter(x=>x.tipo==='Reembolso'&&x.transaccion_origen_id===original.id&&x.id!==r.id).reduce((s,x)=>s+cent(x.monto),0);
      if(usado+cent(r.monto)>cent(original.monto))return json({message:'La devolución supera el importe pendiente del gasto.'},400);
    }
  }
  entries.forEach(r=>servidor.set(r.id,{...(servidor.get(r.id)||{}),...r}));
  if(falla==='despues'){falla=null;throw new TypeError('Respuesta perdida después del guardado');}
  return json(entries);
};
const gasto=({id='fridays',monto=47.60,fecha='2026-10-02T19:00:00-05:00',usd=null,tc=null}={})=>
  [fecha,'Fridays','Comer afuera','Gasto',monto,'Mastercard Platinum',id,null,null,usd===null?null:'USD',usd,tc,usd===null?null:'manual',null,null,false];
const reembolso=(monto=10,id='previo')=>['2026-10-03T09:00:00-05:00','Devolución previa','Comer afuera','Reembolso',monto,'Yape',id,null,'fridays',null,null,null,null,null,null,false];

(async()=>{
  const [tx,cuentas,{datos},cards,monedas,numeros,operaciones]=await Promise.all([modulo('modules/transactions.js'),modulo('modules/accounts.js'),modulo('state.js'),modulo('modules/cards/cards.js'),modulo('modules/currencies.js'),modulo('utils/numbers.js'),modulo('services/refund-operations.js')]);
  equivalente=numeros.equivalenteSoles;
  function preparar(filas=[gasto()]){
    tx.cerrarM();nodos.clear();chips=[];peticiones=[];servidor=new Map(filas.map(t=>[t[6],cuerpoDe(t)]));falla=null;retener=null;
    for(const key of [...almacen.keys()])if(key!=='sb_session')localStorage.removeItem(key);sesion();
    Object.assign(datos,{transacciones:filas,cuentas:[['Yape','billetera','PEN',false,'yape'],['Plin','billetera','PEN',false,'plin'],['BCP Dólares','banco','USD',false,'bcp']],
      categorias:[['Comer afuera','#00d68f'],['Otros ingresos','#00d68f']],configTarjetas:[['Mastercard Platinum',6800,30,'Mastercard Platinum','💳',9,5]],
      pagosTarjetas:[],ciclosOverride:[],deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[],cargados:true});
    cuentas.setEstadoCuentas('lista');cuentas.setCuentasMigradas(true);el('iMoneda').value='PEN';
  }
  async function desdeGasto(id='fridays'){
    tx.editarTx(id);await new Promise(r=>realTimeout(r,65));tx.setTipo('Reembolso');
    assert.equal(tx.editando,null,'Reembolso desde Gasto crea una devolución nueva');
    assert.equal(el('iGastoOrigen').value,id,'el gasto pulsado se selecciona automáticamente');
    assert.match(el('iGastoOrigen').innerHTML,/Fridays/,'Fridays aparece en el selector aunque era la fila editada');
    el('iCue').value='Yape';el('iFec').value='2026-10-03';el('iDes').value='Reembolso Fridays';
  }
  function assertOriginal(antes){assert.deepEqual(datos.transacciones.find(t=>t[6]===antes[6]),antes,'el gasto original no cambia');assert.deepEqual(servidor.get(antes[6]),cuerpoDe(antes),'el servidor conserva el gasto original');}
  function revisarSplit(reemb,extra){
    const nuevos=datos.transacciones.filter(t=>t[6]!=='fridays'&&t[6]!=='previo');
    assert.equal(nuevos.length,extra>0?2:1);const dev=nuevos.find(t=>t[3]==='Reembolso');
    assert.equal(dev[4],reemb);assert.equal(dev[8],'fridays');assert.equal(dev[2],'Comer afuera');assert.equal(dev[5],'Yape');
    if(extra>0){const ingreso=nuevos.find(t=>t[3]==='Ingreso');assert.equal(ingreso[4],extra);assert.equal(ingreso[5],'Yape');assert.equal(ingreso[8],null,'el extra es ingreso, sin vinculación de reembolso incompatible con SQL');}
    assert.equal(peticiones.length,1,'una sola escritura para toda la devolución');
    assert.equal(peticiones[0].method,'POST','no edita el consumo de tarjeta');
    if(extra>0){assert.ok(Array.isArray(peticiones[0].body),'refund e ingreso se insertan como lote atómico');assert.equal(peticiones[0].body.length,2);}
  }
  const casos=[
    ['El selector rechaza IDs hasta que existe su opción',async()=>{
      preparar();el('iGastoOrigen').value='fridays';assert.equal(el('iGastoOrigen').value,'','el DOM ficticio reproduce un SELECT nativo vacío');
      el('iGastoOrigen').innerHTML='<option value="">Selecciona…</option><option value="fridays">Fridays</option>';el('iGastoOrigen').value='fridays';assert.equal(el('iGastoOrigen').value,'fridays');
    }],
    ['Fridays S/47.60: recibe S/50 y registra S/2.40 como ingreso',async()=>{
      preparar();const antes=datos.transacciones[0].slice();await desdeGasto();el('iMon').value='50';tx.seleccionarGastoReembolso();
      assert.match(el('refundAvailable').textContent,/S\/\s*47\.60 como reembolso y S\/\s*2\.40 como ingreso adicional/,'el reparto mostrado coincide con el reparto que se guardará');
      await tx.guardar();
      revisarSplit(47.60,2.40);assertOriginal(antes);assert.equal(tx.gastoNeto(datos.transacciones[0]),0);
      const llego=datos.transacciones.filter(t=>t[5]==='Yape').reduce((s,t)=>s+tx.efectoResultado(t),0);assert.equal(llego,50,'Yape recibe los S/50 completos una vez');
      assert.equal(cards.getCardOutstandingTotal({cuenta:'Mastercard Platinum',finDia:9,pagoDia:5}),47.60,'la tarjeta todavía debe pagarse: el reembolso recibido en Yape no la paga');
    }],
    ['Reembolso exacto no inventa ingreso extra',async()=>{
      preparar();await desdeGasto();el('iMon').value='47.60';await tx.guardar();revisarSplit(47.60,0);
    }],
    ['El botón + admite S/50 vinculados a Fridays',async()=>{
      preparar();tx.abrirM();tx.setTipo('Reembolso');el('iGastoOrigen').value='fridays';tx.seleccionarGastoReembolso();
      el('iCue').value='Yape';el('iFec').value='2026-10-03';el('iDes').value='Devolución papá';el('iMon').value='50';await tx.guardar();revisarSplit(47.60,2.40);
    }],
    ['Un reembolso anterior reduce el resto y aumenta el ingreso extra',async()=>{
      preparar([gasto(),reembolso()]);await desdeGasto();el('iMon').value='50';await tx.guardar();revisarSplit(37.60,12.40);assert.equal(tx.gastoNeto(datos.transacciones[0]),0);
    }],
    ['El gasto elegido fuera del mes activo sigue disponible',async()=>{
      preparar([gasto({fecha:'2026-09-25T19:00:00-05:00'})]);await desdeGasto();assert.match(el('iGastoOrigen').innerHTML,/Fridays/);
    }],
    ['Doble clic envía un solo lote',async()=>{
      preparar();await desdeGasto();el('iMon').value='50';let liberar;retener=new Promise(r=>liberar=r);
      const uno=tx.guardar();await new Promise(r=>realTimeout(r,5));const dos=tx.guardar();liberar();await Promise.all([uno,dos]);retener=null;revisarSplit(47.60,2.40);
    }],
    ['Fallo antes de guardar no deja ingreso o reembolso parcial',async()=>{
      preparar();await desdeGasto();el('iMon').value='50';falla='antes';await tx.guardar();assert.equal(servidor.size,1);assert.equal(datos.transacciones.length,1);assert.equal(el('modal').classList.contains('active'),true);
      peticiones=[];await tx.guardar();revisarSplit(47.60,2.40);
    }],
    ['Respuesta perdida permite confirmar sin duplicar los dos registros',async()=>{
      preparar();await desdeGasto();el('iMon').value='50';falla='despues';await tx.guardar();assert.equal(servidor.size,3,'la operación atómica llegó al servidor');
      const ids=[...servidor.keys()].sort();await tx.guardar();assert.deepEqual([...servidor.keys()].sort(),ids,'un segundo Guardar no agrega un segundo reembolso o ingreso');assert.equal(datos.transacciones.length,3,'la respuesta confirmada se incorpora una sola vez');
    }],
    ['Un error de lectura no borra la recuperación de una escritura ya enviada',async()=>{
      preparar();await desdeGasto();el('iMon').value='50';falla='despues';await tx.guardar();
      const ids=[...servidor.keys()].sort();falla='confirmacion-403';await tx.guardar();
      assert.ok([...almacen.keys()].some(k=>k.startsWith('finanzas.reembolsos-pendientes.')),'preserva los UUID de recuperación aunque la lectura rechace la petición');
      await tx.guardar();assert.deepEqual([...servidor.keys()].sort(),ids,'el reintento posterior confirma los registros existentes');assert.equal(peticiones.length,1,'no vuelve a escribir con UUID nuevos');assert.equal(datos.transacciones.length,3);
    }],
    ['Actualizar recupera una respuesta perdida sin volver a escribir',async()=>{
      preparar();await desdeGasto();el('iMon').value='50';falla='despues';await tx.guardar();const ids=[...servidor.keys()].sort();
      await operaciones.recuperarReembolsosPendientes();assert.deepEqual([...servidor.keys()].sort(),ids);assert.equal(peticiones.length,1);
      assert.ok(![...almacen.keys()].some(k=>k.startsWith('finanzas.reembolsos-pendientes.')),'la operación confirmada se retira de la recuperación');
    }],
    ['Cambiar de usuario durante el guardado no incorpora dinero en su sesión',async()=>{
      preparar();await desdeGasto();el('iMon').value='50';let liberar;retener=new Promise(r=>liberar=r);const guardando=tx.guardar();await new Promise(r=>realTimeout(r,5));
      localStorage.setItem('sb_session',JSON.stringify({user_id:'otra-persona',access_token:'otro-token',expires_at:ahora+3600000}));datos.transacciones=[];liberar();await guardando;retener=null;
      assert.equal(datos.transacciones.length,0,'las filas del usuario anterior no se agregan a los datos de otra sesión');
      assert.ok(almacen.has('finanzas.reembolsos-pendientes.v1.usuario-demo'),'conserva la operación bajo su usuario original');
      sesion();await operaciones.recuperarReembolsosPendientes();assert.equal(peticiones.length,1,'confirmar la sesión original no vuelve a insertar');
    }],
    ['Editar un reembolso mantiene su gasto y usa PATCH',async()=>{
      preparar([gasto(),reembolso()]);tx.editarTx('previo');await new Promise(r=>realTimeout(r,65));assert.equal(tx.editando,'previo');assert.equal(el('iGastoOrigen').value,'fridays');
      el('iDes').value='Descripción corregida';await tx.guardar();assert.equal(peticiones.length,1);assert.equal(peticiones[0].method,'PATCH');assert.equal(peticiones[0].body.transaccion_origen_id,'fridays');assert.equal(datos.transacciones.length,2);assert.equal(datos.transacciones[1][4],10);
    }],
    ['Extra recibido en una tarjeta no se guarda como ingreso invisible',async()=>{
      preparar();await desdeGasto();el('iCue').value='Mastercard Platinum';el('iMon').value='50';await tx.guardar();assert.equal(peticiones.length,0,'hay que elegir la cuenta donde se recibió el dinero extra');assert.equal(datos.transacciones.length,1);
    }],
    ['USD: compara el equivalente PEN y conserva los nominales del lote',async()=>{
      preparar();const antes=datos.transacciones[0].slice();await desdeGasto();el('iCue').value='BCP Dólares';el('iMoneda').value='USD';el('iTc').value='3.71';monedas.setTcFuente('manual');el('iMon').value='13';await tx.guardar();
      assert.equal(peticiones.length,1);assert.ok(Array.isArray(peticiones[0].body));assert.equal(peticiones[0].body.length,2);
      const dev=datos.transacciones.find(t=>t[3]==='Reembolso'),extra=datos.transacciones.find(t=>t[3]==='Ingreso');
      assert.equal(dev[4],47.60,'el reembolso nunca pasa el cap en soles');assert.equal(dev[10],12.83,'el reembolso en dólares se limita a céntimos completos');assert.equal(extra[10],0.17);
      assert.equal(cent(dev[10])+cent(extra[10]),1300,'los nominales USD suman todo lo recibido');
      assert.equal(monedas.getCuentaBalanceMoneda('BCP Dólares').saldo,13,'el saldo USD recibe exactamente los 13 dólares');assertOriginal(antes);
    }],
    ['USD: un céntimo de dólar no puede sobrepasar un céntimo pendiente PEN',async()=>{
      preparar([gasto({monto:0.01})]);await desdeGasto();el('iCue').value='BCP Dólares';el('iMoneda').value='USD';el('iTc').value='4';monedas.setTcFuente('manual');el('iMon').value='0.02';await tx.guardar();
      assert.equal(datos.transacciones.filter(t=>t[3]==='Reembolso').length,0,'no se crea una devolución cero ni una que supere S/0.01');
      const ingreso=datos.transacciones.find(t=>t[3]==='Ingreso');assert.ok(ingreso);assert.equal(ingreso[10],0.02);assert.equal(monedas.getCuentaBalanceMoneda('BCP Dólares').saldo,0.02);assert.equal(tx.gastoNeto(datos.transacciones[0]),0.01);
    }],
    ['USD: aplica hasta el límite real después del redondeo del servidor',async()=>{
      preparar([gasto({monto:1.03})]);await desdeGasto();el('iCue').value='BCP Dólares';el('iMoneda').value='USD';el('iTc').value='3.33333333';monedas.setTcFuente('manual');el('iMon').value='0.32';await tx.guardar();
      const dev=datos.transacciones.find(t=>t[3]==='Reembolso'),extra=datos.transacciones.find(t=>t[3]==='Ingreso');
      assert.equal(dev[10],0.31,'US$0.31 equivalen legalmente a S/1.03 tras redondear');assert.equal(dev[4],1.03);assert.equal(extra[10],0.01);assert.equal(tx.gastoNeto(datos.transacciones[0]),0);assert.equal(monedas.getCuentaBalanceMoneda('BCP Dólares').saldo,0.32);
    }],
    ['Editar un reembolso con exceso no crea ingresos silenciosos',async()=>{
      preparar([gasto(),reembolso()]);tx.editarTx('previo');await new Promise(r=>realTimeout(r,65));el('iMon').value='50';await tx.guardar();assert.equal(peticiones.length,0);assert.equal(datos.transacciones.length,2);assert.equal(datos.transacciones[1][4],10);
    }],
    ['Una nueva transacción no hereda el gasto del reembolso anterior',async()=>{
      preparar();await desdeGasto();tx.cerrarM();tx.abrirM();tx.setTipo('Reembolso');assert.equal(el('iGastoOrigen').value,'');
    }],
  ];
  let fallos=0;for(const [nombre,ejecutar]of casos){try{await ejecutar();console.log('PASS: '+nombre+'.');}catch(e){fallos++;console.error('FAIL: '+nombre+'\n'+e.stack);}}
  assert.equal(fallos,0,'todos los escenarios de reembolso deben pasar');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{globalThis.Date=RealDate;globalThis.setTimeout=realTimeout;});
