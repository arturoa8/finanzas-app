// Rentabilidad de Inicio sobre los mismos cachés y modelos de Portafolio.
// Importes ficticios; esta lectura no permite consultas de red.
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';entornoPrueba();
const RealDate=Date;let reloj=RealDate.parse('2026-10-04T12:00:00-05:00');
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[reloj]));}static now(){return reloj;}};
let consultas=0,activa='p-dash',expandido=true;
const highlights={innerHTML:''};
document.querySelector=s=>s==='.page.active'?{id:activa}:null;
document.getElementById=id=>id==='homeSummary'?{classList:{contains:()=>expandido}}:id==='homeHighlights'?highlights:null;
globalThis.fetch=async()=>{consultas++;throw new Error('El resumen solo lee datos en caché');};

(async()=>{
  const [{datos},hero,pf,market,summary]=await Promise.all([modulo('state.js'),modulo('modules/portfolio/hero.js'),modulo('modules/portfolio/portfolio.js'),modulo('services/market-data.js'),modulo('modules/home-summary.js')]);
  Object.assign(datos,{cargados:true,transacciones:[],pagosTarjetas:[],configTarjetas:[],deudas:[],deudasAbonos:[],presupuestos:[],
    cuentas:[['Plin','billetera','PEN',false,'plin'],['IBKR','inversion','USD',false,'ibkr']]});
  const cierre=(fecha,valor)=>({fecha_valoracion:fecha,valor_total:valor,moneda_base:'USD',cuenta_ibkr:'U1'});
  const aporte=(id,fecha,usd)=>[fecha,id,'Inversión','Transferencia',usd*3.5,'Plin',id,'IBKR',null,null,null,null,null,usd===null?null:'USD',usd];
  const fijarCierres=(...rows)=>{pf.pfHistoricoCache.splice(0,pf.pfHistoricoCache.length,...rows);pf.pfPosicionesCache.length=0;pf.pfLedgerCache.length=0;market.pfYahoo.quotes=[];};
  const cerca=(a,b,nota)=>assert.ok(Math.abs(a-b)<1e-9,nota+': '+a+' vs '+b);

  let r=hero.pfResumenRentabilidadInicio();
  assert.deepEqual([r.diaria,r.total],[null,null],'sin cierres no inventa porcentajes');
  fijarCierres(cierre('2026-10-02',110));r=hero.pfResumenRentabilidadInicio();
  assert.deepEqual([r.diaria,r.total],[null,null],'un solo cierre sin aportes tampoco ofrece retorno');

  datos.transacciones=[aporte('inicial','2026-09-29',100),['2026-09-30','Comisión','Inversión','Gasto',17.5,'Plin','costo',null,null,'USD',5,3.5,null,null,null,true]];
  fijarCierres(cierre('2026-10-01',100),cierre('2026-10-02',110));r=hero.pfResumenRentabilidadInicio();
  cerca(r.diaria,10,'rendimiento del último cierre');cerca(r.total,10,'total mide inversión vs. aportes, igual que Resumen, sin sustituirlo por el neto de costos');
  assert.equal(r.etiqueta,'Último cierre IBKR');assert.equal(r.fecha,'2026-10-02');

  datos.transacciones=[aporte('inicial','2026-09-29',100),aporte('nuevo','2026-10-02',50)];
  fijarCierres(cierre('2026-10-01',100),cierre('2026-10-02',160));r=hero.pfResumenRentabilidadInicio();
  cerca(r.diaria,10,'los US$ 50 aportados no son una ganancia diaria del 60%');
  cerca(r.total,100*10/150,'la ganancia total se compara con US$ 150 de aportes');
  datos.transacciones[1]=aporte('sin-confirmar','2026-10-02',null);datos.transacciones[1][4]=175;
  r=hero.pfResumenRentabilidadInicio();assert.deepEqual([r.diaria,r.total],[null,null],'sin dólares confirmados no puede aislar un aporte de la rentabilidad');

  // Domingo: se mide la sesión real del viernes con su cierre anterior,
  // aunque el cierre oficial IBKR tenga otro valor base.
  datos.transacciones=[aporte('inicial','2026-09-29',100)];
  fijarCierres(cierre('2026-10-01',100),cierre('2026-10-02',100));
  const posicion={cuenta_ibkr:'U1',contract_id:'1',simbolo:'DEMO',cantidad:1,precio_mercado:100,valor_mercado_base:100,costo_promedio:100,
    multiplicador:1,moneda:'USD',moneda_base:'USD',tipo_activo:'STK',fecha_datos:'2026-10-02',pnl_no_realizado_base:0};
  pf.pfPosicionesCache.push(posicion);
  const q={status:'ok',account:'U1',contract_id:'1',ibkr_symbol:'DEMO',currency:'USD',price:110,previous_close:105,
    price_at:'2026-10-02T15:36:00Z',session_start:'2026-10-02T07:00:00Z',session_end:'2026-10-02T15:30:00Z'};
  Object.assign(market.pfYahoo,{quotes:[q],scope:market.pfComputeScope(),baseId:market.pfComputeBaseId()});
  r=hero.pfResumenRentabilidadInicio();
  assert.equal(r.fuente,'YAHOO');assert.equal(r.etiqueta,'Última sesión');assert.equal(r.fecha,'2026-10-02');
  cerca(r.diaria,(110/105-1)*100,'diaria usa el cierre regular anterior, no el valor base de IBKR');cerca(r.total,10,'total utiliza el mismo valor Yahoo coherente que Portafolio');
  q.previous_close=null;r=hero.pfResumenRentabilidadInicio();
  assert.equal(r.fuente,'IBKR_BASE');assert.equal(r.diaria,null,'el cambio desde un cierre IBKR de respaldo no se presenta como diario');cerca(r.total,10,'un valor actual válido todavía permite el total');
  q.previous_close=105;datos.transacciones.push(aporte('no-reflejado','2026-10-03',50));
  r=hero.pfResumenRentabilidadInicio();
  assert.equal(hero.obtenerValorActualPortafolio().fuente,'IBKR','un aporte posterior bloquea la valoración Yahoo hasta reflejarse en posiciones');
  cerca(r.total,0,'el total vuelve al cierre y a los aportes de esa fecha, sin mezclar efectivo nuevo con posiciones anteriores');
  datos.transacciones=[aporte('inicial','2026-09-29',100)];

  localStorage.setItem('finanzas.home-widgets.v1',JSON.stringify([{id:'rentabilidad',visible:true},...['periodo','tarjetas','presupuesto','pagar','cobrar'].map(id=>({id,visible:false}))]));
  summary.renderHomeSummary();
  assert.match(highlights.innerHTML,/Diaria/);assert.match(highlights.innerHTML,/Total/);assert.match(highlights.innerHTML,/\+4\.76%/);assert.match(highlights.innerHTML,/\+10\.00%/);
  assert.match(highlights.innerHTML,/Última sesión · 2 oct/);assert.doesNotMatch(highlights.innerHTML,/S\/|US\$|\$110|\$100/,'rentabilidad muestra porcentajes, sin importes monetarios');
  assert.match(highlights.innerHTML,/setPg\('ana'\)/);

  // El historial ocultó el resumen: ni siquiera debe leer transacciones.
  const movimientos=datos.transacciones;
  Object.defineProperty(datos,'transacciones',{configurable:true,get(){throw new Error('Recalcular resumen oculto');}});
  expandido=false;highlights.innerHTML='conservado';summary.renderHomeSummary();assert.equal(highlights.innerHTML,'conservado');
  expandido=true;activa='p-card';summary.renderHomeSummary();assert.equal(highlights.innerHTML,'conservado','fuera de Inicio también se evita calcular');
  Object.defineProperty(datos,'transacciones',{configurable:true,writable:true,value:movimientos});
  assert.equal(consultas,0,'leer o renderizar los porcentajes no dispara consultas');
  console.log('PASS: rentabilidad de Inicio solo %, última sesión real, TWR ajustado por aportes, total vs. aportes, respaldos incompletos, caché y guard de visibilidad.');
})().catch(error=>{console.error(error);process.exitCode=1;});
