import {esc, fmtMoneda} from '../../utils/formatters.js';

// Cambio de saldo = flujos de capital + resultado. No es un porcentaje de
// rentabilidad: los flujos se registran al cierre y se comparan en USD.
export function renderPfSaldoResumen(el,{inicial,actual,desde,hasta,moneda,fl}){
 if(!el)return;
 const numero=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
 const a=numero(inicial),b=numero(actual);
 if(a===null||b===null||!desde||!hasta){el.innerHTML='';return;}
 const dentro=f=>f.fecha>desde&&f.fecha<=hasta;
 const pendiente=moneda!=='USD'||!fl||fl.pendientesFechas?.some(fecha=>fecha>desde&&fecha<=hasta);
 const aportado=pendiente?null:(fl.flujos||[]).filter(dentro).reduce((s,f)=>s+f.monto,0);
 const resultado=aportado===null?null:Math.round((b-a-aportado)*100)/100;
 const firmado=n=>n===null?'—':(n>0.004?'+':n<-0.004?'−':'')+fmtMoneda(Math.abs(n),moneda);
 const color=n=>n===null?'var(--text)':n>=0?'var(--green)':'var(--red)';
 el.innerHTML='<div class="pf-rend-row pf-saldo-resumen"><div>Saldo actual<strong>'+esc(fmtMoneda(b,moneda))+'</strong></div><div>Aportes / retiros netos<strong>'+esc(firmado(aportado))+'</strong></div><div>Resultado del período<strong style="color:'+color(resultado)+'">'+esc(firmado(resultado))+'</strong></div></div>'+
  '<p class="hint">Saldo inicial: '+esc(fmtMoneda(a,moneda))+'. '+(pendiente?'Confirma los importes de los aportes y retiros para separar el resultado.':'El resultado descuenta los aportes y retiros de este período.')+'</p>';
}
