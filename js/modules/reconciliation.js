// Comparacion del saldo calculado con el del banco.
// Las comparaciones se conservan por usuario en este navegador.

import {cuentasSaldos, renderSaldoCuentas} from './accounts.js';
import {fmtCuenta, getCuentaBalanceMoneda} from './currencies.js';
import {conciliacion} from '../state.js';
import {endOfDay} from '../utils/dates.js';
import {sessionUserId} from '../services/auth.js';

function claveConciliacion(){const id=sessionUserId();return id?'finanzas.conciliacion.v1.'+id:null;}
function leerConciliaciones(){try{const key=claveConciliacion();return key?JSON.parse(localStorage.getItem(key)||'[]'):[];}catch(e){return[];}}
export function restaurarComparaciones(){
  for(const k of Object.keys(conciliacion))delete conciliacion[k];
  for(const r of leerConciliaciones())conciliacion[r.cuenta]=String(r.banco);
}
export function pintarComparaciones(){
  if(!conciliando)return;
  cuentasSaldos().forEach((c,i)=>{if(conciliacion[c]!==undefined)actualizarDiferenciaBanco(i,conciliacion[c],false);});
}

// Saldos por cuenta: cada cuenta en su moneda y sin convertir. IBKR va aparte
// porque es inversión, no efectivo. La comparación no modifica movimientos.
export let conciliando=false;

export function toggleConciliar(){conciliando=!conciliando;renderSaldoCuentas();}

export function actualizarDiferenciaBanco(i,valor,guardar=true){
  const c=cuentasSaldos()[i];if(!c)return;
  conciliacion[c]=valor;
  const el=document.getElementById('difBanco'+i);if(!el)return;
  const {moneda,saldo}=getCuentaBalanceMoneda(c,endOfDay(new Date())),banco=parseFloat(String(valor).replace(',','.'));
  if(!isFinite(banco)||String(valor).trim()===''){
    el.textContent='';el.className='card-stat-sub';
    if(guardar&&String(valor).trim()==='')try{const key=claveConciliacion();if(key)localStorage.setItem(key,JSON.stringify(leerConciliaciones().filter(r=>r.cuenta!==c)));}catch(e){el.textContent='No se pudo borrar la comparación en este navegador.';}
    return;
  }
  if(guardar){
    try{
      const key=claveConciliacion();
      if(key){const fecha=new Date().toISOString(),dia=fecha.slice(0,10);const prev=leerConciliaciones().filter(r=>!(r.cuenta===c&&r.fecha.slice(0,10)===dia));prev.push({cuenta:c,moneda,banco,saldo,fecha});localStorage.setItem(key,JSON.stringify(prev.slice(-100)));}
    }catch(e){el.textContent='No se pudo guardar la comparación en este navegador.';return;}
  }
  const registro=leerConciliaciones().filter(r=>r.cuenta===c).at(-1);
  const nota=registro?' · guardado el '+new Date(registro.fecha).toLocaleDateString('es-PE')+' en este navegador':'';
  const dif=Math.round((banco-saldo)*100)/100;
  if(Math.abs(dif)<0.005){el.textContent='✓ Cuadra con el banco'+nota;el.className='card-stat-sub stat-delta-pos';return;}
  el.className='card-stat-sub stat-delta-neg';
  el.textContent=(dif>0?'El banco tiene '+fmtCuenta(dif,moneda)+' más: falta registrar un ingreso o sobra un gasto en la app'
                      :'La app tiene '+fmtCuenta(-dif,moneda)+' más: falta registrar un gasto, pago o transferencia')+nota;
}
