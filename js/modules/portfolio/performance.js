// Flujos, aportes y rendimiento.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cuentasApp, cuentasLegacy, esCuentaInversion} from '../accounts.js';
import {avisosCuenta, movimientoCuentaMoneda} from '../currencies.js';
import {pfHistoricoCache, pfIso} from './portfolio.js';
import {sameAccount} from '../transactions.js';
import {datos} from '../../state.js';
import {pf} from '../../utils/dates.js';
import {fmt, fmtMoneda} from '../../utils/formatters.js';

// Detectar aportes y retiros mira el HISTÓRICO, no el estado de hoy: se
// incluyen las cuentas de inversión archivadas y las que solo viven en
// movimientos antiguos. Si se filtrara por cuentas activas, archivar IBKR
// dejaría cero flujos y el portafolio mostraría como rentabilidad lo que en
// realidad fueron depósitos. Ante la duda, mejor detectar de más: un flujo
// sobrante solo hace que se muestre el aviso en vez de un porcentaje.
export function cuentasInversionHistoricas(){
  const nombres=cuentasApp().filter(c=>c[1]==='inversion').map(c=>c[0]);
  // Nombres que ya no están en la tabla pero sí en movimientos guardados.
  cuentasLegacy().forEach(n=>{if(esCuentaInversion(n)&&!nombres.some(v=>sameAccount(v,n)))nombres.push(n);});
  return nombres;
}

export function pfFlujos(){
  const cuentas=cuentasInversionHistoricas();
  const flujos=[],pendientesFechas=[];let pendientes=0,solesPendientes=0;
  cuentas.forEach(c=>{const a=avisosCuenta(c);pendientes+=a.pendientes;solesPendientes+=a.solesPendientes;});
  (datos.transacciones||[]).forEach(t=>{
    if(t[3]!=='Transferencia')return;
    cuentas.forEach(c=>{
      const m=movimientoCuentaMoneda(t,c);
      if(m)flujos.push({fecha:pfIso(pf(t[0])),monto:m});
      // Toca la cuenta de inversión pero no se puede cuantificar (falta el
      // importe en dólares, de entrada o de salida). Cuenta igual como flujo
      // del período: preferimos el aviso a un porcentaje que no lo es.
      else if(sameAccount(t[5]||'',c)||sameAccount(t[7]||'',c))pendientesFechas.push(pfIso(pf(t[0])));
    });
  });
  flujos.sort((a,b)=>a.fecha.localeCompare(b.fecha));
  return{flujos,pendientes,solesPendientes,pendientesFechas};
}

function pfAportesHasta(flujos,fecha){return Math.round(flujos.filter(f=>f.fecha<=fecha).reduce((s,f)=>s+f.monto,0)*100)/100;}

// ¿Hubo aportes o retiros después del cierre inicial y hasta el final? El cierre
// del día inicial ya incluye lo movido ese día.
export function pfFlujosEnPeriodo(fl,desde,hasta){
  const dentro=f=>f>desde&&f<=hasta;
  return fl.flujos.filter(f=>dentro(f.fecha)).length+fl.pendientesFechas.filter(dentro).length;
}

// Aportes, ganancia y rentabilidad simple frente a lo aportado, al cierre de `row`.
export function pfModeloGanancia(row,fl){
  if(!row||row.valor_total===null||row.valor_total===undefined)return{ok:false,mensaje:'Sin valor total en el último cierre.'};
  if(row.moneda_base!=='USD')return{ok:false,mensaje:'Los aportes se registran en dólares y el portafolio está en '+(row.moneda_base||'otra moneda')+': no se puede comparar.'};
  if(fl.pendientes>0)return{ok:false,aportes:null,mensaje:fl.pendientes+' aporte'+(fl.pendientes>1?'s':'')+' a IBKR sin dólares recibidos confirmados ('+fmt(fl.solesPendientes)+' enviados). Edita la transferencia y escribe cuántos dólares llegaron para calcular la ganancia.'};
  if(!fl.flujos.length)return{ok:false,aportes:null,mensaje:'No hay aportes registrados: crea una transferencia hacia IBKR en la app para calcular la ganancia.'};
  const aportes=pfAportesHasta(fl.flujos,row.fecha_valoracion),valor=Number(row.valor_total);
  if(!(aportes>0))return{ok:false,aportes,mensaje:'Los aportes netos a esta fecha no son positivos: no se calcula la rentabilidad.'};
  const ganancia=Math.round((valor-aportes)*100)/100;
  // Control de coherencia: el primer valor visible en IBKR debería ser lo primero que aportaste.
  let aviso='';
  const primero=(pfHistoricoCache||[]).find(r=>Number(r.valor_total)>0);
  if(primero){const ap=pfAportesHasta(fl.flujos,primero.fecha_valoracion),v=Number(primero.valor_total);
    if(!(ap>0)||Math.abs(v-ap)>Math.max(1,ap*0.02))aviso='El primer valor que muestra IBKR ('+fmtMoneda(v,'USD')+', '+primero.fecha_valoracion+') no coincide con tus aportes registrados a esa fecha ('+fmtMoneda(ap,'USD')+'). Revisa las transferencias.';}
  return{ok:true,aportes,ganancia,pct:ganancia/aportes*100,aviso};
}

// ── Rendimiento del portafolio en un período ────────────────────────────────
// método 'simple': valor final / valor inicial − 1, válido solo si NO hubo
// aportes ni retiros dentro del período. Con flujos se intenta TWR
// (pfRendimientoTWR); si algún flujo no tiene dólares confirmados, ni TWR
// puede aislarlo y no se calcula ningún porcentaje: solo valor inicial, valor
// actual y cambio absoluto.
function pfRendimientoTWR(validas,fl){
  const desde=validas[0].fecha_valoracion,hasta=validas[validas.length-1].fecha_valoracion;
  if(fl.pendientesFechas.some(f=>f>desde&&f<=hasta))return{ok:false};
  let factor=1;
  const serie=[{fecha:desde,valor:0}];
  for(let i=1;i<validas.length;i++){
    const prev=Number(validas[i-1].valor_total),cur=Number(validas[i].valor_total);
    const d=validas[i-1].fecha_valoracion,h=validas[i].fecha_valoracion;
    const flujo=fl.flujos.filter(f=>f.fecha>d&&f.fecha<=h).reduce((s,f)=>s+f.monto,0);
    if(!(prev>0))return{ok:false};
    factor*=(cur-flujo)/prev;
    serie.push({fecha:h,valor:(factor-1)*100});
  }
  return{ok:true,pct:(factor-1)*100,serie};
}
export function pfRendimientoPortafolio(filas,fl){
  const validas=filas.filter(r=>Number(r.valor_total)>0);
  if(validas.length<2)return{ok:false,mensaje:'Hacen falta al menos dos cierres con valor en el período.'};
  const a=validas[0],b=validas[validas.length-1],inicial=Number(a.valor_total),actual=Number(b.valor_total);
  const base={ok:true,metodo:'simple',desde:a.fecha_valoracion,hasta:b.fecha_valoracion,inicial,actual,cambio:actual-inicial,moneda:b.moneda_base};
  const n=pfFlujosEnPeriodo(fl,a.fecha_valoracion,b.fecha_valoracion);
  if(n>0){
    const twr=pfRendimientoTWR(validas,fl);
    if(twr.ok)return{...base,metodo:'twr',conFlujos:true,flujos:n,pct:twr.pct,serie:twr.serie};
    return{...base,conFlujos:true,flujos:n};
  }
  return{...base,conFlujos:false,pct:(actual/inicial-1)*100,
    serie:validas.map(r=>({fecha:r.fecha_valoracion,valor:(Number(r.valor_total)/inicial-1)*100}))};
}

// ── Posiciones ──────────────────────────────────────────────────────────────
// Costo = cantidad × costo promedio (× multiplicador, × tipo de cambio a la
// moneda base). P&L % = P&L no realizado / costo. Sin datos no se inventa.
export function pfRendimientoPosicion(p){
  const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
  const qty=num(p.cantidad),avg=num(p.costo_promedio),mult=num(p.multiplicador)||1;
  const fx=p.moneda===p.moneda_base?1:(p.conversion_incompleta?null:num(p.fx_rate_a_base));
  const valor=num(p.valor_mercado_base),pnl=num(p.pnl_no_realizado_base);
  const costoTotal=qty!==null&&avg!==null&&fx>0?Math.round(qty*avg*mult*fx*100)/100:null;
  return{valor,pnl,costoTotal,pnlPct:costoTotal>0&&pnl!==null?pnl/costoTotal*100:null};
}

// P&L agregado: solo posiciones (el efectivo no entra en el costo). Se calcula
// solo si todas las posiciones son comparables con el cierre de la cuenta.
export function pfResumenPosiciones(row,posiciones){
  if(!posiciones.length)return{ok:true,costo:0,pnl:0,pct:null};
  let costo=0,pnl=0;
  for(const p of posiciones){
    const r=pfRendimientoPosicion(p);
    const igual=p.moneda_base===row.moneda_base&&p.fecha_datos===row.fecha_valoracion&&p.cuenta_ibkr===row.cuenta_ibkr;
    if(!igual||r.costoTotal===null||r.pnl===null)return{ok:false};
    costo+=r.costoTotal;pnl+=r.pnl;
  }
  return{ok:true,costo:Math.round(costo*100)/100,pnl:Math.round(pnl*100)/100,pct:costo>0?pnl/costo*100:null};
}

// Qué mostrar de una posición: la estimación con Yahoo solo si es válida y
// comparable; si no, el cierre oficial de IBKR.
export function pfPosicionMostrada(p,est){
  const o=pfRendimientoPosicion(p);
  if(est&&est.baseValue!==null&&est.basePnl!==null&&o.costoTotal>0)
    return{fuente:'yahoo',valor:est.baseValue,pnl:est.basePnl,pct:est.basePnl/o.costoTotal*100,costoTotal:o.costoTotal};
  return{fuente:'ibkr',valor:o.valor,pnl:o.pnl,pct:o.pnlPct,costoTotal:o.costoTotal};
}

// Rendimiento del ACTIVO: cambio de precio entre dos fechas. No es el P&L de tu
// posición (puede haber compras a otros precios durante el período).
export function pfRendimientoActivo(filas){
  const v=filas.filter(r=>Number(r.precio_mercado)>0).sort((a,b)=>a.fecha_valoracion.localeCompare(b.fecha_valoracion));
  if(v.length<2)return null;
  const a=v[0],b=v[v.length-1],ini=Number(a.precio_mercado),fin=Number(b.precio_mercado);
  return{desde:a.fecha_valoracion,hasta:b.fecha_valoracion,inicial:ini,actual:fin,pct:(fin/ini-1)*100};
}
