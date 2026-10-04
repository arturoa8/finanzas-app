const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();
const fx={innerHTML:''},saldo={innerHTML:''};
document.getElementById=id=>id==='pfResultadoCambio'?fx:null;
const tx=(tipo,monto,fecha='2026-10-01')=>({tipo,fecha,monto,soles:monto*3.3});
(async()=>{
 const {pfModeloRentabilidadCambio:modelo}=await modulo('modules/portfolio/fx-performance.js');
 const {renderPfResultadoCambio:render}=await modulo('modules/portfolio/fx-ui.js');
 const {renderPfSaldoResumen:renderSaldo}=await modulo('modules/portfolio/balance-summary.js');
 const crear=(valor=980,costos=[])=>modelo({row:{valor_total:valor,moneda_base:'USD',fecha_valoracion:'2026-10-02'},tcActual:3.8,
  fl:{flujos:[tx('aporte',1000)],pendientesFechas:[]},co:{costos}});
 render(crear(),{tcActual:3.8,tcFuente:'mercado',tcFecha:'2026-10-03'});
 assert.match(fx.innerHTML,/−S\/\s76.00/);assert.match(fx.innerHTML,/\+S\/\s500.00/);assert.match(fx.innerHTML,/\+S\/\s424.00/);assert.match(fx.innerHTML,/\+12.85%/);assert.match(fx.innerHTML,/Impacto: \+15.15% del capital histórico/);
 render(crear(980,[{fecha:'2026-10-01',soles:10,usd:null}]));
 assert.match(fx.innerHTML,/Costos fuera de IBKR/);assert.match(fx.innerHTML,/−S\/\s10.00/);assert.match(fx.innerHTML,/\+S\/\s414.00/);assert.match(fx.innerHTML,/\+S\/\s500.00/);
 render({totalOk:false,mensaje:'Pendiente',pendientes:[{codigo:'base_pen_pendiente',mensaje:'Confirma el costo',descripcion:'<script>prueba</script>'}]});
 assert.doesNotMatch(fx.innerHTML,/\+S\/\s414.00/);assert.doesNotMatch(fx.innerHTML,/<script>/);assert.match(fx.innerHTML,/&lt;script&gt;/);
 renderSaldo(saldo,{inicial:1000,actual:1120,desde:'2026-10-01',hasta:'2026-10-02',moneda:'USD',fl:{flujos:[{fecha:'2026-10-02',monto:100}],pendientesFechas:[]}});
 assert.match(saldo.innerHTML,/\+US\$ 100.00/);assert.match(saldo.innerHTML,/\+US\$ 20.00/);
 renderSaldo(saldo,{inicial:1000,actual:1120,desde:'2026-10-01',hasta:'2026-10-02',moneda:'USD',fl:{flujos:[],pendientesFechas:['2026-10-02']}});
 assert.match(saldo.innerHTML,/Confirma los importes/);assert.doesNotMatch(saldo.innerHTML,/\+US\$ 120.00/);
 console.log('PASS: interfaz separa inversión, FX y costos, elimina cifras al faltar datos y distingue depósitos de ganancias.');
})().catch(e=>{console.error(e);process.exitCode=1;});
