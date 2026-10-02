const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
process.env.TZ='America/Lima';const RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-10-02T12:00:00-05:00']));}};
entornoPrueba();
(async()=>{
  const c=await modulo('modules/cards/cycles.js');
  const card={finDia:31,inicioDia:1,pagoDia:31,cuenta:'Tarjeta demo'};
  const feb=c.getCardCycle(card,-8),mar=c.getCardCycle(card,-7);
  assert.equal(c.getCycleKey(feb),'2026-02-28');assert.equal(feb.start.getMonth(),1);assert.equal(feb.start.getDate(),1);
  assert.equal(mar.start.getMonth(),2);assert.equal(mar.start.getDate(),1);assert.equal(mar.pay.getMonth(),3);assert.equal(mar.pay.getDate(),30);
  assert.equal(c.getCycleKey(c.getCardCycle(card,-32)),'2024-02-29');
  assert.equal(c.cardTxCycleKey(card,['2026-02-28']),'2026-02-28');assert.equal(c.cardTxCycleKey(card,['2026-03-01']),'2026-03-31');
  console.log('PASS: febrero, año bisiesto, ciclos contiguos y pago 31 en un mes de 30 días.');
})().catch(e=>{console.error(e);process.exitCode=1;});
