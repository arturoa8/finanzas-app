const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();
(async()=>{
  const {pfRendimientoEntrePuntos:comparar,pfRendimientoPortafolio}=await modulo('modules/portfolio/performance.js');
  const cerca=(valor,esperado)=>assert.ok(Math.abs(valor-esperado)<1e-9,valor+' != '+esperado);
  // +10% → +21% significa +10% en ese tramo, no +11 puntos.
  cerca(comparar(10,21),10);
  cerca(comparar(-10,8),20);
  cerca(comparar(25,0),-20);
  cerca(comparar(15,15),0);
  cerca(comparar(0,-100),-100);
  for(const [a,b] of [[-100,0],[-101,0],[0,-101],[NaN,10],[0,Infinity],[null,0]])assert.equal(comparar(a,b),null);
  // Un aporte de US$500 no debe aparecer como 50% de rendimiento.
  const filas=[1000,1100,1650].map((valor,i)=>({fecha_valoracion:'2026-10-0'+(i+1),valor_total:valor,moneda_base:'USD'}));
  const r=pfRendimientoPortafolio(filas,{flujos:[{fecha:'2026-10-03',monto:500}],pendientesFechas:[]});
  assert.equal(r.metodo,'twr');
  cerca(comparar(r.serie[1].valor,r.serie[2].valor),50/1100*100);
  console.log('PASS: intervalos encadenados, pérdidas, mismo punto, base inválida y aporte excluido de la rentabilidad.');
})().catch(e=>{console.error(e);process.exitCode=1;});
