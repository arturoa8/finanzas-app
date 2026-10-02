const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();
const aviso={textContent:'',className:''};document.getElementById=()=>aviso;
const sesion=id=>localStorage.setItem('sb_session',JSON.stringify({user_id:id,access_token:'demo',expires_at:Date.now()+3600000}));
(async()=>{
  const {datos,conciliacion}=await modulo('state.js');
  datos.cuentas=[['Banco demo','banco','PEN',false,'c1']];
  datos.transacciones=[['2026-01-01','Ingreso','Otros ingresos','Ingreso',100,'Banco demo','t1']];
  const c=await modulo('modules/reconciliation.js'),a=await modulo('modules/accounts.js');
  a.setEstadoCuentas('error');assert.throws(()=>a.validarCuentasDisponibles(),/Actualizar/);
  a.setEstadoCuentas('lista');a.validarCuentasDisponibles();
  sesion('usuario-a');c.actualizarDiferenciaBanco(0,'100');assert.match(aviso.textContent,/Cuadra con el banco/);
  c.restaurarComparaciones();assert.equal(conciliacion['Banco demo'],'100');
  sesion('usuario-b');c.restaurarComparaciones();assert.equal(conciliacion['Banco demo'],undefined,'comparaciones separadas por usuario');
  sesion('usuario-a');c.restaurarComparaciones();assert.equal(conciliacion['Banco demo'],'100');
  c.actualizarDiferenciaBanco(0,'');c.restaurarComparaciones();assert.equal(conciliacion['Banco demo'],undefined,'borrar saldo elimina la comparación guardada');
  console.log('PASS: cuentas bloqueadas si fallan y comparación persistente, borrable y separada por usuario.');
})().catch(e=>{console.error(e);process.exitCode=1;});
