// Regresión de la edición en dólares: se ejercita editarTx → guardar con los
// módulos actuales y una API ficticia. Nunca se conecta a Supabase ni a mercado.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date,realTimeout=setTimeout;
const ahora=RealDate.parse('2026-10-03T12:00:00-05:00');
globalThis.Date=class extends RealDate{
  constructor(...args){super(...(args.length?args:[ahora]));}
  static now(){return ahora;}
};
entornoPrueba();

const nodos=new Map();let chips=[];
function nodo(id){
  const clases=new Set(),atributos=new Map();let contenido='',valor='';
  return {id,dataset:{},style:{},hidden:false,disabled:false,readOnly:false,inert:false,textContent:'',offsetWidth:320,
    classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
      toggle(x,force){const activo=force??!clases.has(x);if(activo)clases.add(x);else clases.delete(x);return activo;}},
    get value(){return valor;},set value(v){valor=String(v??'');},
    get innerHTML(){return contenido;},set innerHTML(v){
      contenido=String(v);
      if(id==='catChips')chips=[...contenido.matchAll(/data-cat="([^"]*)"/g)].map((m,i)=>{
        const c=nodo('chip-'+i);c.dataset.cat=m[1];return c;
      });
    },
    setAttribute(k,v){atributos.set(k,String(v));},getAttribute:k=>atributos.get(k)??null,removeAttribute:k=>atributos.delete(k),
    querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},focus(){},
  };
}
const el=id=>{if(!nodos.has(id))nodos.set(id,nodo(id));return nodos.get(id);};
document.getElementById=el;
document.querySelector=s=>s==='.cchip.selected'?chips.find(c=>c.classList.contains('selected'))||null:null;
document.querySelectorAll=s=>s==='.cchip'?chips:[];
document.body=nodo('body');
globalThis.matchMedia=()=>({matches:true});
globalThis.window={matchMedia};
globalThis.setTimeout=(fn,ms,...args)=>{
  const timer=realTimeout(fn,ms,...args);if(ms>=1000)timer.unref?.();return timer;
};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:ahora+3600000}));

let peticiones=[];
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),method=opts.method||'GET';
  assert.equal(u.pathname,'/rest/v1/transacciones','cualquier otra petición queda bloqueada por la API ficticia');
  assert.ok(['PATCH','POST'].includes(method),'la prueba solo permite guardar en su API ficticia');
  const body=JSON.parse(opts.body),id=method==='PATCH'?u.searchParams.get('id').replace(/^eq\./,''):'tx-nueva';
  peticiones.push({method,id,body});
  return new Response(JSON.stringify([{...body,id}]),{status:200,headers:{'content-type':'application/json'}});
};

const compra=(tc=3.5)=>['2026-09-01T12:00:00-05:00','Compra dólares','Compra Dólares','Transferencia',1000*tc,'Plin','compra',
  'BCP Dólares',null,null,null,null,'transferencia','USD',1000,false];
const movimiento=({id='histórico',tipo='Gasto',cuenta='BCP Dólares',tc=3.7,fuente='manual',destino=null,montoDestino=null}={})=>
  ['2026-09-12T14:30:00-05:00','Descripción original',tipo==='Ingreso'?'Salario':tipo==='Transferencia'?'Venta de Dólares':'Compras',
    tipo,100*tc,cuenta,id,destino,null,'USD',100,tc,fuente,montoDestino?'PEN':null,montoDestino,false];

(async()=>{
  const [tx,monedas,cuentas,{datos},cambio]=await Promise.all([
    modulo('modules/transactions.js'),modulo('modules/currencies.js'),modulo('modules/accounts.js'),modulo('state.js'),modulo('services/exchange-rate.js'),
  ]);
  function preparar(filas){
    tx.cerrarM();nodos.clear();chips=[];peticiones=[];
    Object.assign(datos,{transacciones:filas,cuentas:[['Plin','billetera','PEN',false,'pen'],['BCP Dólares','banco','USD',false,'usd']],
      categorias:[['Compras','#00d68f'],['Salario','#00d68f'],['Ocio','#00d68f']],configTarjetas:[],pagosTarjetas:[],ciclosOverride:[],
      deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[],cargados:true});
    cuentas.setEstadoCuentas('lista');cuentas.setCuentasMigradas(true);el('iMoneda').value='PEN';
  }
  async function abrirEdicion(t){
    tx.editarTx(t[6]);
    // La categoría histórica se selecciona en el timeout real del formulario.
    await new Promise(r=>realTimeout(r,65));
    assert.equal(el('iMoneda').value,'USD','abrir la edición conserva la moneda original');
    assert.equal(Number(el('iMon').value),100,'abrir la edición conserva el nominal en dólares');
    assert.equal(Number(el('iTc').value),t[11],'abrir la edición conserva el TC guardado');
  }
  async function guardarDescripcion(t){
    const antes=t.slice();
    monedas.sincronizarCamposMoneda();monedas.sincronizarCamposMoneda();
    el('iDes').value='Descripción corregida';
    await tx.guardar();
    assert.equal(peticiones.length,1,'la corrección se guarda una sola vez');
    const p=peticiones[0];
    assert.equal(p.method,'PATCH','editar usa el registro existente');assert.equal(p.id,antes[6]);
    assert.equal(p.body.descripcion,'Descripción corregida');
    assert.equal(p.body.fecha,antes[0],'corregir la descripción conserva la fecha y hora');
    assert.equal(p.body.monto,antes[4],'el equivalente en soles no se recalcula con otra tasa');
    assert.equal(p.body.moneda_original,'USD');assert.equal(p.body.monto_original,antes[10]);
    assert.equal(p.body.tc,antes[11],'se envía el TC histórico');assert.equal(p.body.tc_fuente,antes[12],'se conserva su procedencia');
    for(const i of [0,2,3,4,5,6,9,10,11,12])assert.equal(t[i],antes[i],'la respuesta conserva el dato financiero del índice '+i);
    assert.equal(t[1],'Descripción corregida');
    return p.body;
  }

  const casos=[
    ['gasto USD con TC manual distinto del promedio',async()=>{
      const t=movimiento();preparar([compra(),t]);
      assert.equal(monedas.costoPromedioUSD(null,t[6]),3.5);
      await abrirEdicion(t);await guardarDescripcion(t);
      assert.equal(t[4],370,'US$100 sigue representando S/370, aunque el promedio sea 3.5');
    }],
    ['ingreso histórico sin cotización disponible',async()=>{
      const t=movimiento({tipo:'Ingreso',tc:3.72,fuente:'mercado'});preparar([t]);
      assert.equal(monedas.valoracionAutomaticaUSD('Ingreso','2026-09-12',t[6]).tc,null,'la fecha pasada no tiene cotización nueva');
      await abrirEdicion(t);await guardarDescripcion(t);
    }],
    ['costo promedio guardado aunque cambien las compras históricas',async()=>{
      const entrada=compra(),t=movimiento({fuente:'costo_promedio'});preparar([entrada,t]);
      await abrirEdicion(t);
      entrada[4]=3900;
      assert.equal(monedas.costoPromedioUSD(null,t[6]),3.9,'el historial ahora produciría un costo diferente');
      await guardarDescripcion(t);assert.equal(t[4],370);
    }],
    ['transferencia USD a PEN sin alterar los dos importes',async()=>{
      const t=movimiento({tipo:'Transferencia',fuente:'transferencia',destino:'Plin',montoDestino:370});preparar([compra(),t]);
      await abrirEdicion(t);const body=await guardarDescripcion(t);
      assert.equal(body.cuenta_destino,'Plin');assert.equal(body.moneda_destino,'PEN');assert.equal(body.monto_destino,370);
      assert.equal(t[7],'Plin');assert.equal(t[13],'PEN');assert.equal(t[14],370);
    }],
    ['transferencia USD pendiente conserva el TC y permite corregirlo',async()=>{
      const t=movimiento({tipo:'Transferencia',destino:'Plin'});preparar([compra(),t]);
      await abrirEdicion(t);const original=await guardarDescripcion(t);
      assert.equal(original.cuenta_destino,'Plin');assert.equal(original.monto_destino,null);
      peticiones=[];await abrirEdicion(t);
      assert.equal(el('iTc').readOnly,false,'sin importe recibido se puede corregir la tasa manual');
      el('iTc').value='3.85';monedas.tcEditadoAMano();
      monedas.sincronizarCamposMoneda();monedas.sincronizarCamposMoneda();
      assert.equal(Number(el('iTc').value),3.85,'la sincronización no restaura la tasa anterior');
      await tx.guardar();assert.equal(peticiones.length,1);const body=peticiones[0].body;
      assert.equal(body.tc,3.85);assert.equal(body.tc_fuente,'manual');assert.equal(body.monto,385);
      assert.equal(body.cuenta_destino,'Plin');assert.equal(body.monto_destino,null);
    }],
    ['edición USD después de usar otra cuenta en dólares',async()=>{
      const t=movimiento({cuenta:'Plin'});preparar([compra(),t]);
      tx.abrirM();el('iCue').value='BCP Dólares';cuentas.cambiarCuentaSelect(el('iCue'));
      assert.equal(el('iMoneda').disabled,true,'el formulario anterior hereda USD de su cuenta');
      await abrirEdicion(t);
      assert.equal(el('iCue').value,'Plin');assert.equal(el('iMoneda').disabled,false,'la edición restaura el selector de su propia cuenta');
      await guardarDescripcion(t);
    }],
    ['edición USD de una cuenta archivada sin otras cuentas USD activas',async()=>{
      const t=movimiento();preparar([compra(),t]);datos.cuentas[1][3]=true;
      assert.equal(monedas.costoPromedioUSD(),null,'no hay cuentas USD activas de donde proponer un costo');
      await abrirEdicion(t);assert.equal(el('iMoneda').hidden,false,'la moneda histórica permanece visible');
      await guardarDescripcion(t);
    }],
    ['corregir solo la categoría conserva el TC histórico',async()=>{
      const t=movimiento({fuente:'mercado'});preparar([compra(),t]);await abrirEdicion(t);
      tx.seleccionarCat(chips.find(c=>c.dataset.cat==='Ocio'));monedas.sincronizarCamposMoneda();await tx.guardar();
      assert.equal(peticiones.length,1);const {method,body}=peticiones[0];assert.equal(method,'PATCH');
      assert.equal(body.descripcion,'Descripción original');assert.equal(body.categoria,'Ocio');
      assert.equal(body.tc,3.7);assert.equal(body.tc_fuente,'mercado');assert.equal(body.monto,370);
      assert.equal(t[2],'Ocio');assert.equal(t[11],3.7);assert.equal(t[4],370);
    }],
    ['corregir el TC histórico explícitamente conserva la tasa escrita',async()=>{
      const t=movimiento({fuente:'costo_promedio'});preparar([compra(),t]);await abrirEdicion(t);
      assert.equal(el('iTc').readOnly,false,'el TC histórico se puede corregir explícitamente');
      el('iTc').value='3.95';monedas.tcEditadoAMano();
      monedas.sincronizarCamposMoneda();monedas.sincronizarCamposMoneda();
      assert.equal(Number(el('iTc').value),3.95,'sincronizar no pisa la corrección manual');
      assert.equal(monedas.tcFuenteActual,'manual');
      el('iDes').value='Tasa corregida';await tx.guardar();
      assert.equal(peticiones.length,1);const {method,body}=peticiones[0];assert.equal(method,'PATCH');
      assert.equal(body.tc,3.95);assert.equal(body.tc_fuente,'manual');assert.equal(body.monto,395);
      assert.equal(t[11],3.95);assert.equal(t[12],'manual');assert.equal(t[4],395);
    }],
    ['cambiar fecha e importe USD conserva el TC efectivo',async()=>{
      const t=movimiento({fuente:'costo_promedio'});preparar([compra(),t]);await abrirEdicion(t);
      el('iFec').value='2026-08-15';el('iMon').value='150';el('iDes').value='Fecha e importe corregidos';
      assert.equal(monedas.valoracionAutomaticaUSD('Gasto','2026-08-15',t[6]).tc,null,'la fecha corregida no tiene compras para revalorar');
      monedas.sincronizarCamposMoneda();await tx.guardar();
      assert.equal(peticiones.length,1);const {method,body}=peticiones[0];assert.equal(method,'PATCH');
      assert.match(body.fecha,/^2026-08-15T/);assert.equal(body.monto_original,150);
      assert.equal(body.tc,3.7);assert.equal(body.tc_fuente,'costo_promedio');assert.equal(body.monto,555);
      assert.equal(t[11],3.7);assert.equal(t[10],150);assert.equal(t[4],555);
    }],
    ['cambiar moneda y volver a USD recupera la valoración histórica',async()=>{
      const t=movimiento({cuenta:'Plin'});preparar([compra(),t]);await abrirEdicion(t);
      el('iMoneda').value='PEN';monedas.cambiarMonedaTx();
      assert.equal(el('iTc').value,'','cambiar a soles limpia el TC de dólares');
      el('iMoneda').value='USD';monedas.cambiarMonedaTx();
      assert.equal(Number(el('iTc').value),3.7,'volver a la moneda original recupera la tasa histórica');
      el('iDes').value='Moneda corregida';await tx.guardar();
      assert.equal(peticiones.length,1);const {method,body}=peticiones[0];assert.equal(method,'PATCH');
      assert.equal(body.tc,3.7);assert.equal(body.tc_fuente,'manual');assert.equal(body.monto,370);
      assert.equal(t[11],3.7);assert.equal(t[4],370);
    }],
    ['gasto nuevo USD conserva la valoración automática por costo',async()=>{
      preparar([compra()]);tx.abrirM();el('iCue').value='BCP Dólares';cuentas.cambiarCuentaSelect(el('iCue'));
      el('iMon').value='100';el('iDes').value='Gasto nuevo';tx.seleccionarCat(chips.find(c=>c.dataset.cat==='Compras'));
      monedas.sincronizarCamposMoneda();await tx.guardar();
      assert.equal(peticiones.length,1);const {method,body}=peticiones[0];assert.equal(method,'POST');
      assert.equal(body.monto,350);assert.equal(body.tc,3.5);assert.equal(body.tc_fuente,'costo_promedio');
      assert.equal(body.moneda_original,'USD');assert.equal(body.monto_original,100);
      assert.equal(datos.transacciones.at(-1)[4],350);
    }],
    ['ingreso nuevo de hoy conserva la valoración automática de mercado',async()=>{
      preparar([]);localStorage.setItem('tc_mercado',JSON.stringify({tc:3.8,fecha:'2026-10-03'}));await cambio.cargarTcMercado();
      tx.abrirM();tx.setTipo('Ingreso');el('iCue').value='BCP Dólares';cuentas.cambiarCuentaSelect(el('iCue'));
      el('iMon').value='100';el('iDes').value='Ingreso nuevo';tx.seleccionarCat(chips.find(c=>c.dataset.cat==='Salario'));
      monedas.sincronizarCamposMoneda();await tx.guardar();
      assert.equal(peticiones.length,1);const {method,body}=peticiones[0];assert.equal(method,'POST');
      assert.equal(body.monto,380);assert.equal(body.tc,3.8);assert.equal(body.tc_fuente,'mercado');
      assert.equal(body.moneda_original,'USD');assert.equal(body.monto_original,100);
    }],
  ];
  let fallos=0;
  for(const [nombre,ejecutar] of casos){
    try{await ejecutar();console.log('PASS: '+nombre+'.');}
    catch(e){fallos++;console.error('FAIL: '+nombre+'\n'+e.stack);}
  }
  assert.equal(fallos,0,'todos los escenarios de edición histórica y creación deben pasar');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  globalThis.Date=RealDate;globalThis.setTimeout=realTimeout;
});
