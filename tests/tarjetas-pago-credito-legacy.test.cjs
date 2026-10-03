// Un crédito USD legado ya consumido exige guardar el costo reconocido
// por el modelo actual. La API y toda la recarga existen sólo en memoria.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';
const RealDate=Date,realTimeout=setTimeout;
const ahora=RealDate.parse('2026-10-03T12:00:00-05:00');
globalThis.Date=class extends RealDate{
  constructor(...a){super(...(a.length?a:[ahora]));}
  static now(){return ahora;}
};
entornoPrueba();

const nodos=new Map();
const decode=s=>String(s).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
function el(id){
  if(!nodos.has(id)){
    const clases=new Set(),atributos=new Map();let contenido='',valor='';
    nodos.set(id,{id,dataset:{},style:{},hidden:false,disabled:false,textContent:'',offsetWidth:320,
      classList:{add(...xs){xs.forEach(x=>clases.add(x));},remove(...xs){xs.forEach(x=>clases.delete(x));},contains:x=>clases.has(x),
        toggle(x,force){const activo=force??!clases.has(x);if(activo)clases.add(x);else clases.delete(x);return activo;}},
      get value(){return valor;},set value(v){valor=String(v??'');},
      get innerHTML(){return contenido;},set innerHTML(v){
        contenido=String(v);
        for(const m of contenido.matchAll(/<input\b([^>]*\bid="([^"]+)"[^>]*)>/g))el(m[2]).value=decode(/\bvalue="([^"]*)"/.exec(m[1])?.[1]||'');
        for(const m of contenido.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
          const opts=[...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
          const opcion=opts.find(o=>/\bselected\b/.test(o[1]))||opts[0];
          el(m[1]).value=opcion?decode(/\bvalue="([^"]*)"/.exec(opcion[1])?.[1]??opcion[2]):'';
        }
      },
      setAttribute(k,v){atributos.set(k,String(v));},getAttribute:k=>atributos.get(k)??null,removeAttribute:k=>atributos.delete(k),
      querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},focus(){},
    });
  }
  return nodos.get(id);
}
document.getElementById=el;
document.querySelector=s=>s==='.page.active'?el('p-card'):null;
document.querySelectorAll=()=>[];
document.body=el('body');
globalThis.window={scrollTo(){},matchMedia:()=>({matches:true})};
globalThis.matchMedia=window.matchMedia;
globalThis.setTimeout=(fn,ms,...a)=>{const t=realTimeout(fn,ms,...a);if(ms>=1000)t.unref?.();return t;};
localStorage.setItem('sb_session',JSON.stringify({user_id:'usuario-demo',access_token:'token-demo',expires_at:ahora+3600000}));
localStorage.setItem('tc_mercado',JSON.stringify({tc:3.9,fecha:'2026-10-03'}));

const cuenta='Visa demo';
const tx=(id,fecha,tipo,usd,pen,origen=null)=>({id,fecha,descripcion:id,categoria:'Compras',tipo,monto:pen,cuenta,
  moneda_original:'USD',monto_original:usd,tc:pen/usd,tc_fuente:'manual',transaccion_origen_id:origen});
const tablas={
  transacciones:[tx('g1','2026-09-10','Gasto',10,35),tx('r1','2026-09-20','Reembolso',1,3.5,'g1'),tx('g2','2026-09-28','Gasto',2,7.4)],
  pagos_tarjetas:[{id:'p1',tarjeta:cuenta,ciclo_key:'2026-09-24',monto:10,fecha:'2026-09-15',nota:null,cuenta_origen:'Plin',
    moneda:'USD',monto_origen:35,tc:3.5,equivalente:35}],
  cuentas:[{id:'pen',nombre:'Plin',tipo:'billetera',moneda:'PEN',archivada:false},{id:'usd',nombre:'BCP Dólares',tipo:'banco',moneda:'USD',archivada:false}],
  config_tarjetas:[{tarjeta:cuenta,limite_credito:5000,meta_pct:30,nombre:cuenta,emoji:'💳',corte_dia:24,pago_dia:15}],
  categorias:[{nombre:'Compras',color:'#00d68f'}],ciclos_override:[],deudas_resumen:[],deudas_abonos:[],presupuestos:[],recurrentes:[],
};
const pedidos=[];
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url),method=opts.method||'GET',tabla=u.pathname.slice('/rest/v1/'.length);
  const body=opts.body?JSON.parse(opts.body):null;
  pedidos.push({tabla,method,body});
  assert.ok(u.pathname.startsWith('/rest/v1/'),'toda lectura usa la API ficticia');
  assert.ok(!tabla.startsWith('rpc/'),'el pago con crédito previo no puede usar el cálculo del RPC legado');
  assert.ok(Object.hasOwn(tablas,tabla),'tabla ficticia conocida: '+tabla);
  let rows;
  if(method==='GET'){
    const id=(u.searchParams.get('id')||'').replace(/^eq\./,'');
    rows=id?tablas[tabla].filter(r=>r.id===id):tablas[tabla].slice(Number(u.searchParams.get('offset')||0),
      Number(u.searchParams.get('offset')||0)+Number(u.searchParams.get('limit')||1000));
  }else{
    assert.equal(method,'POST','este caso sólo crea el ajuste y el pago');
    assert.ok(['transacciones','pagos_tarjetas'].includes(tabla));
    assert.ok(body.id);assert.ok(!tablas[tabla].some(r=>r.id===body.id));
    tablas[tabla].push({...body});rows=[body];
  }
  return new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json','content-range':`0-${Math.max(0,rows.length-1)}/${tablas[tabla].length}`}});
};

(async()=>{
  const [{datos},pagos,cards,nav,cuentas,{notaCreditoUSD}]=await Promise.all([
    modulo('state.js'),modulo('modules/cards/payments.js'),modulo('modules/cards/cards.js'),
    modulo('ui/navigation.js'),modulo('modules/accounts.js'),modulo('modules/cards/usd-credit.js'),
  ]);
  Object.assign(datos,{cuentas:tablas.cuentas.map(c=>[c.nombre,c.tipo,c.moneda,c.archivada,c.id]),
    configTarjetas:[[cuenta,5000,30,cuenta,'💳',24,15]],categorias:[['Compras','#00d68f']],ciclosOverride:[],
    transacciones:tablas.transacciones.map(t=>[t.fecha,t.descripcion,t.categoria,t.tipo,t.monto,t.cuenta,t.id,null,t.transaccion_origen_id||null,'USD',t.monto_original,t.tc,'manual']),
    pagosTarjetas:tablas.pagos_tarjetas.map(pagos.filaPago),deudas:[],deudasArchivadas:[],deudasAbonos:[],presupuestos:[],recurrentes:[],cargados:true});
  cuentas.setEstadoCuentas('lista');cuentas.setCuentasMigradas(true);
  const card={cuenta,finDia:24,inicioDia:25,pagoDia:15},modelo=cards.modeloCreditoTarjetaUSD(card);
  assert.equal(cards.tarjetaConCreditoUSD(card),false,'el pago antiguo no tiene metadatos versionados');
  assert.equal(modelo.saldoFavor,0,'el crédito de la devolución ya se consumió');
  assert.ok(modelo.credito.length>0,'el historial conserva el crédito consumido');
  assert.equal(modelo.usd,1);assert.equal(modelo.pen,3.7);

  nav.handleFab();
  assert.equal(el('cardPaymentModal').classList.contains('active'),true);
  assert.equal(el('cardUsdCuenta').value,'BCP Dólares','el formulario empieza con la cuenta preferida');
  el('cardUsdCuenta').value='Plin';el('cardUsdMonto').value='1';el('cardUsdSoles').value='3.90';el('cardUsdFecha').value='2026-10-03';
  pagos.actualizarPagoUSD();
  assert.match(el('cardUsdPreview').textContent,/0\.20.*más/);
  await pagos.guardarPagoTarjetaUSD();

  assert.equal(pedidos.some(p=>p.tabla.startsWith('rpc/')),false);
  const nuevos=pedidos.filter(p=>p.method==='POST');
  assert.deepEqual(nuevos.map(p=>p.tabla),['transacciones','pagos_tarjetas']);
  const ajuste=nuevos[0].body,pago=nuevos[1].body;
  assert.equal(ajuste.tipo,'Gasto');assert.equal(ajuste.categoria,'Diferencia de cambio');assert.equal(ajuste.monto,0.2);
  assert.equal(pago.monto,1);assert.equal(pago.monto_origen,3.9);assert.equal(pago.equivalente,3.7);assert.equal(pago.ajuste_id,ajuste.id);
  const meta=notaCreditoUSD(pagos.filaPago(pago));
  assert.equal(meta.tipo,'pago');assert.equal(meta.reconocido,3.7);assert.equal(meta.credito,0);assert.equal(meta.costoCredito,0);
  assert.equal(datos.pagosTarjetas.length,2,'la recarga confirma el recibo guardado');
  assert.equal(cards.deudaTarjetaUSD(card).usd,0);assert.equal(cards.deudaTarjetaUSD(card).pen,0);
  assert.equal(el('dataStatus').hidden,true,'la recarga se completa sin errores');
  assert.equal(el('cardPaymentModal').classList.contains('active'),false);
  assert.match(el('toast').textContent,/Pago en dólares registrado/);
  console.log('PASS: crédito USD legado consumido guarda recibo reconocido S/3.70 y ajuste S/0.20 mediante operación recuperable, sin RPC antiguo.');
})().catch(e=>{console.error(e);process.exitCode=1;});
