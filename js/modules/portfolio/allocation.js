// Distribucion por activo.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {pfPosicionesCache} from './portfolio.js';
import {esc, fmtMoneda, fmtPct} from '../../utils/formatters.js';
import {pfNumber} from '../../utils/numbers.js';

export function pfAssetColor(symbol){
  const palette=['#7aa2ff','#b79aff','#ffb84d','#00d68f','#ff7c9c','#67cbd4','#d2bd92','#a1a1aa'];
  let hash=0;for(const char of String(symbol))hash=(hash*31+char.charCodeAt(0))>>>0;
  return palette[hash%palette.length];
}

function pfDistributionModel(row,positions){
  const total=pfNumber(row.valor_total),parts=[],warnings=[];
  let comparable=true;
  for(const p of positions){
    const value=pfNumber(p.valor_mercado_base);
    const same=p.moneda_base===row.moneda_base&&p.fecha_datos===row.fecha_valoracion&&p.cuenta_ibkr===row.cuenta_ibkr;
    if(!same||p.conversion_incompleta||value===null){comparable=false;warnings.push('Hay posiciones con fecha, moneda o valoración no comparable con el cierre de cuenta.');}
    parts.push({name:p.simbolo||'Activo',value:same&&!p.conversion_incompleta?value:null,color:pfAssetColor(p.simbolo),contractId:p.contract_id});
  }
  const cash=pfNumber(row.efectivo);
  parts.push({name:'Efectivo',value:cash,color:'#a1a1aa',contractId:null});
  if(cash===null){comparable=false;warnings.push('El efectivo no está disponible.');}
  if(total===null||total<=0){comparable=false;warnings.push('El valor total debe ser positivo para calcular proporciones.');}
  if(!positions.length&&pfNumber(row.valor_posiciones)!==0){comparable=false;warnings.push('Falta el detalle de las posiciones para este cierre.');}
  if(parts.some(p=>p.value!==null&&p.value<0)){comparable=false;warnings.push('Hay saldos negativos: se muestran los importes sin un gráfico circular.');}
  let remainder=0;
  if(comparable){
    const sum=parts.reduce((s,p)=>s+p.value,0);remainder=total-sum;
    if(remainder<-.01){comparable=false;warnings.push('Los componentes superan el total oficial. Revisa las fechas y la conciliación.');}
    else if(remainder>.01)parts.push({name:'Otros / ajustes IBKR',value:remainder,color:'#64646f',contractId:null});
  }
  const denominator=parts.reduce((s,p)=>s+(p.value||0),0);
  return {total,parts,comparable,denominator,warnings:[...new Set(warnings)]};
}

export function renderPfDistribucion(row){
  const area=document.getElementById('pfDistArea'),leg=document.getElementById('pfDistLegend');
  const model=pfDistributionModel(row,pfPosicionesCache),currency=row.moneda_base;
  leg.replaceChildren();
  if(!model.comparable){
    area.innerHTML='<div class="pf-data-note">'+model.warnings.map(esc).join('<br>')+'</div>';
  }else{
    let offset=0;
    area.innerHTML='<svg class="pf-donut" viewBox="0 0 240 240" role="group" aria-label="Distribución por activo al cierre de IBKR"><circle cx="120" cy="120" r="88" fill="none" stroke="var(--border)" stroke-width="30"/></svg><div class="pf-donut-caption" aria-live="polite"><span id="pfSliceName">Total oficial</span><strong id="pfSliceValue"></strong><span id="pfSlicePercent">100% del portafolio</span></div>';
    document.getElementById('pfSliceValue').textContent=fmtMoneda(model.total,currency);
    const svg=area.querySelector('svg');
    model.parts.forEach((part,index)=>{
      if(!(part.value>0))return;
      const fraction=part.value/model.denominator*100;
      const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
      Object.entries({cx:120,cy:120,r:88,fill:'none',stroke:part.color,'stroke-width':30,pathLength:100,'stroke-dasharray':fraction+' '+(100-fraction),'stroke-dashoffset':-offset,transform:'rotate(-90 120 120)',tabindex:0,role:'button','aria-label':part.name+', '+fmtPct(part.value/model.total*100)+', '+fmtMoneda(part.value,currency),'data-slice':index}).forEach(([k,v])=>circle.setAttribute(k,String(v)));
      const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=circle.getAttribute('aria-label');circle.append(title);
      circle.addEventListener('click',()=>selectPart(index));circle.addEventListener('focus',()=>selectPart(index));
      circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectPart(index);}});
      svg.append(circle);offset+=fraction;
    });
  }
  function selectPart(index){
    if(!model.comparable)return;
    const part=model.parts[index];
    document.getElementById('pfSliceName').textContent=part.name;
    document.getElementById('pfSliceValue').textContent=fmtMoneda(part.value,currency);
    document.getElementById('pfSlicePercent').textContent=fmtPct(part.value/model.total*100)+' del portafolio';
    area.querySelectorAll('[data-slice]').forEach(el=>{el.style.opacity=Number(el.dataset.slice)===index?'1':'.3';});
    leg.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.slice)===index)));
  }
  model.parts.forEach((part,index)=>{
    const button=document.createElement('button');button.type='button';button.className='pf-allocation-row';button.dataset.slice=index;
    button.setAttribute('aria-pressed','false');button.disabled=!model.comparable;
    button.innerHTML='<span class="pf-color-dot" style="background:'+part.color+'"></span><span class="pf-allocation-name">'+esc(part.name)+'</span><span class="pf-allocation-value">'+esc(fmtMoneda(part.value,currency))+'</span><strong>'+esc(model.comparable?fmtPct(part.value/model.total*100):'—')+'</strong>';
    button.addEventListener('click',()=>selectPart(index));leg.append(button);
  });
}
