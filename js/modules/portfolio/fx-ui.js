import {esc, fmtMoneda} from '../../utils/formatters.js';

const color=n=>n>=0?'var(--green)':'var(--red)';
const dinero=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':fmtMoneda(Number(n),'PEN');
const firmado=(n,moneda='PEN')=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':(n>0.004?'+':n<-0.004?'−':'')+fmtMoneda(Math.abs(n),moneda);

export function renderPfResultadoCambio(m,{tcActual,tcFuente,tcFecha,valorFecha}={}){
 const el=document.getElementById('pfResultadoCambio');if(!el)return;
 const referencia=tcActual>0?'TC '+(tcFuente==='mercado'?'de referencia':'configurado')+' · S/ '+Number(tcActual).toFixed(4)+' por US$ 1'+(tcFecha?' · '+tcFecha:''):'';
 if(!m?.totalOk){
  const pendiente=m?.pendientes?.find(p=>p.codigo!=='costo_usd_pendiente');
  el.innerHTML='<div class="pf-fx-head"><h3>Resultado en soles</h3><span>Acumulado</span></div><p class="hint">'+esc(pendiente?.mensaje||m?.mensaje||'Confirma el costo histórico de tus aportes y el tipo de cambio para calcular este resultado.')+(pendiente?.descripcion?' '+esc(pendiente.descripcion)+'.':'')+'</p>';
  return;
 }
 const total=m.resultadoTotalPEN,pct=m.pctTotal;
 const atribucion=m.atribucionOk&&Number.isFinite(m.resultadoInversionBrutaPEN)&&Number.isFinite(m.efectoCambioAportesPEN);
 let html='<div class="pf-fx-head"><h3>Resultado en soles</h3><span>Acumulado · estimado</span></div>'+
  '<div class="pf-fx-total" style="color:'+color(total)+'">'+esc(firmado(total))+(Number.isFinite(pct)?'<span>'+esc((pct>=0?'+':'−')+Math.abs(pct).toFixed(2)+'%')+'</span>':'')+'</div>';
 if(atribucion){
  html+='<div class="pf-fx-components"><div><span>Inversión</span><strong style="color:'+color(m.resultadoInversionBrutaPEN)+'">'+esc(firmado(m.resultadoInversionBrutaPEN))+'</strong><small>'+esc(firmado(m.resultadoInversionBrutaUSD,'USD'))+' antes de costos</small></div>'+
   '<div><span>Por tipo de cambio</span><strong style="color:'+color(m.efectoCambioAportesPEN)+'">'+esc(firmado(m.efectoCambioAportesPEN))+'</strong><small>'+esc(Number.isFinite(m.pctCambioAportesSobreCapital)?'Impacto: '+(m.pctCambioAportesSobreCapital>=0?'+':'−')+Math.abs(m.pctCambioAportesSobreCapital).toFixed(2)+'% del capital histórico':'Efecto del dólar sobre tus aportes')+'</small></div>'+
   (m.costosPEN?'<div><span>Costos fuera de IBKR</span><strong style="color:'+color(-m.costosPEN)+'">'+esc(firmado(-m.costosPEN))+'</strong><small>Gastos marcados como costos</small></div>':'')+'</div>';
 }
 html+='<p class="pf-fx-reference">'+esc(referencia)+'</p><details class="pf-fx-detail"><summary>Ver cálculo</summary><dl>'+
  '<div><dt>Valor actual equivalente</dt><dd>'+esc(dinero(m.valorPEN))+'</dd></div>'+
  '<div><dt>Capital histórico neto</dt><dd>'+esc(dinero(m.capitalPEN))+'</dd></div></dl>'+
  '<p>Valor en soles menos capital histórico neto, incluidos los costos marcados. La inversión se convierte al tipo de cambio de referencia y el efecto del dólar compara los aportes con su costo histórico. '+(Number.isFinite(pct)?'El porcentaje es resultado dividido entre capital histórico; es acumulado, sin ponderación por fechas. ':'')+'Valor del portafolio al '+esc(valorFecha||'último dato disponible')+'.</p></details>';
 el.innerHTML=html;
}
