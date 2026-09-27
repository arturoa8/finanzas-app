// Comparacion del saldo calculado con el del banco.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentasSaldos, renderSaldoCuentas} from './accounts.js';
import {fmtCuenta, getCuentaBalanceMoneda} from './currencies.js';
import {conciliacion} from '../state.js';
import {endOfDay} from '../utils/dates.js';

// Saldos por cuenta: cada cuenta en su moneda y sin convertir. IBKR va aparte
// porque es inversión, no efectivo. "Comparar con banco" no guarda nada: sirve
// para ver en qué cuenta está la diferencia contra el saldo real del banco.
export let conciliando=false;

export function toggleConciliar(){conciliando=!conciliando;renderSaldoCuentas();}

export function actualizarDiferenciaBanco(i,valor){
  const c=cuentasSaldos()[i];if(!c)return;
  conciliacion[c]=valor;
  const el=document.getElementById('difBanco'+i);if(!el)return;
  const {moneda,saldo}=getCuentaBalanceMoneda(c,endOfDay(new Date())),banco=parseFloat(String(valor).replace(',','.'));
  if(!isFinite(banco)||String(valor).trim()===''){el.textContent='';el.className='card-stat-sub';return;}
  const dif=Math.round((banco-saldo)*100)/100;
  if(Math.abs(dif)<0.005){el.textContent='✓ Cuadra con el banco';el.className='card-stat-sub stat-delta-pos';return;}
  el.className='card-stat-sub stat-delta-neg';
  el.textContent=dif>0?'El banco tiene '+fmtCuenta(dif,moneda)+' más: falta registrar un ingreso o sobra un gasto en la app'
                      :'La app tiene '+fmtCuenta(-dif,moneda)+' más: falta registrar un gasto, pago o transferencia';
}
