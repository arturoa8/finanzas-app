// Ciclos de tarjeta: corte, pertenencia y overrides.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderCardsPage} from './cards-ui.js';
import {getCardData} from './cards.js';
import {CREDIT_CARDS} from './config.js';
import {getTxRow, sameAccount} from '../transactions.js';
import {sbDelete, sbInsert, sbUpdate} from '../../services/supabase.js';
import {datos} from '../../state.js';
import {addMonths, endOfDay, pf} from '../../utils/dates.js';
import {fmt, fmtC, mesesC, norm} from '../../utils/formatters.js';

export let cardCycleOffset=0;

let cardPickerYear=new Date().getFullYear();

let cardPickerMonth=new Date().getMonth();

export function inicioFromFin(finDia){
  const n=parseInt(finDia,10);
  if(!Number.isFinite(n)||n<1) return 1;
  return n>=31?1:n+1;
}

function setCardCycle(offset,btn){
  cardCycleOffset=offset;
  document.querySelectorAll('.card-tab').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderCardsPage();
}

function getCurrentCycleEndMonth(){
  const today=new Date();
  // Mes de cierre mostrado en Tarjetas: para BBVA 10 mar-9 abr y iO 25 mar-24 abr se ve como abril.
  return new Date(today.getFullYear(),today.getMonth(),1);
}

function getSelectedCycleEndMonth(){return addMonths(getCurrentCycleEndMonth(),cardCycleOffset);}

export function getCardCycle(card,offset=cardCycleOffset){
  const base=addMonths(getCurrentCycleEndMonth(),offset);
  const cycleEnd=endOfDay(new Date(base.getFullYear(),base.getMonth(),card.finDia));
  const cycleStart=new Date(base.getFullYear(),base.getMonth()-1,card.inicioDia);
  const payDate=new Date(base.getFullYear(),base.getMonth()+1,card.pagoDia);
  return{start:cycleStart,end:cycleEnd,pay:payDate};
}

export function getCycleKey(cycle){return cycle.end.getFullYear()+'-'+String(cycle.end.getMonth()+1).padStart(2,'0')+'-'+String(cycle.end.getDate()).padStart(2,'0');}

export function getTxCycleOverride(card,t){
  const txId=String(getTxRow(t));
  const row=(datos.ciclosOverride||[]).find(r=>norm(String(r[1]))===norm(card.cuenta)&&String(r[2])===txId);
  return row?String(row[3]):null;
}

export async function setTxCycleOverride(card,t,cycle){
  const txId=String(getTxRow(t));
  const key=getCycleKey(cycle);
  const ex=(datos.ciclosOverride||[]).find(r=>norm(String(r[1]))===norm(card.cuenta)&&String(r[2])===txId);
  if(ex){
    await sbUpdate('ciclos_override',ex[0],{ciclo_key:key});
    ex[3]=key;
  } else {
    const row=await sbInsert('ciclos_override',{tarjeta:card.cuenta,tx_id:txId,ciclo_key:key});
    datos.ciclosOverride.push([row.id,row.tarjeta,row.tx_id,row.ciclo_key]);
  }
}

export async function clearTxCycleOverride(card,t){
  const txId=String(getTxRow(t));
  const ex=(datos.ciclosOverride||[]).find(r=>norm(String(r[1]))===norm(card.cuenta)&&String(r[2])===txId);
  datos.ciclosOverride=datos.ciclosOverride.filter(r=>!(norm(String(r[1]))===norm(card.cuenta)&&String(r[2])===txId));
  if(ex)await sbDelete('ciclos_override',ex[0]);
}

export function txBelongsToCycle(card,t,cycle){
  const override=getTxCycleOverride(card,t);
  if(override)return override===getCycleKey(cycle);
  const fecha=pf(t[0]);
  return fecha>=cycle.start && fecha<=cycle.end;
}

export function abrirCardCyclePicker(){
  const selected=getSelectedCycleEndMonth();
  cardPickerYear=selected.getFullYear();
  cardPickerMonth=selected.getMonth();
  renderCardCyclePickerGrid();
  document.getElementById('cardCyclePicker').classList.add('active');
}

export function cerrarCardCyclePicker(){document.getElementById('cardCyclePicker').classList.remove('active');}

export function cambiarAnioCardPicker(d){cardPickerYear+=d;renderCardCyclePickerGrid();}

export function seleccionarCardCycleActual(){const d=getCurrentCycleEndMonth();cardPickerYear=d.getFullYear();cardPickerMonth=d.getMonth();renderCardCyclePickerGrid();}

export function seleccionarCardCycleMes(m){cardPickerMonth=m;renderCardCyclePickerGrid();}

export function aplicarCardCyclePicker(){
  const current=getCurrentCycleEndMonth();
  cardCycleOffset=(cardPickerYear-current.getFullYear())*12+(cardPickerMonth-current.getMonth());
  cerrarCardCyclePicker();renderCardsPage();
}

function renderCardCyclePickerGrid(){
  document.getElementById('cardPickerAnio').textContent=cardPickerYear;
  document.getElementById('cardPickerGrid').innerHTML=mesesC.map((mc,i)=>{
    const sel=i===cardPickerMonth;
    const total=CREDIT_CARDS.reduce((sum,card)=>{
      const cur=getCurrentCycleEndMonth();
      const off=(cardPickerYear-cur.getFullYear())*12+(i-cur.getMonth());
      return sum+getCardData(card,off).total;
    },0);
    const val=total>0?fmtC(total):'S/ 0';
    return `<div class="mp-cell ${sel?'selected':''}" onclick="seleccionarCardCycleMes(${i})"><div class="mp-cell-mes">${mc}.</div><div class="mp-cell-val out">${val}</div></div>`;
  }).join('');
}

function cardCycleTotal(offset=cardCycleOffset){
  return CREDIT_CARDS.reduce((sum,card)=>sum+getCardData(card,offset).pendiente,0);
}

function cycleMonthLabel(date){return `${mesesC[date.getMonth()]}. ${date.getFullYear()}`;}

function pulseCycleBar(){
  const bar=document.querySelector('.card-cycle-bar');
  if(!bar)return;
  bar.classList.remove('animating');
  void bar.offsetWidth;
  bar.classList.add('animating');
  setTimeout(()=>bar.classList.remove('animating'),320);
}

export function isCardExpenseFor(card,t){return t && t[3]==='Gasto' && (parseFloat(t[4])||0)>0 && sameAccount((t[5]||'').toString().trim(),card.cuenta);}

/* === Pagos por tarjeta: Sheets + estados avanzados === */
export function normCycleKey(v){
  if(v instanceof Date)return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0')+'-'+String(v.getDate()).padStart(2,'0');
  const s=String(v||'').trim();
  if(s.includes('T'))return s.slice(0,10);
  return s;
}

// Total adeudado real de la tarjeta ahora mismo: todo lo gastado hasta hoy
// menos todo lo pagado, sin importar el ciclo (a diferencia de getCardData,
// que es por-ciclo para la pestaña Tarjetas). Usado solo por el Acumulado.
export function cardTxCycleKey(card,t){
  const override=getTxCycleOverride(card,t);if(override)return normCycleKey(override);
  const date=pf(t[0]);
  const offset=(date.getFullYear()-getCurrentCycleEndMonth().getFullYear())*12+date.getMonth()-getCurrentCycleEndMonth().getMonth()+(date.getDate()>card.finDia?1:0);
  return getCycleKey(getCardCycle(card,offset));
}

function goPrevCardCycle(){cardCycleOffset -= 1; renderCardsPage();}

export function goNextCardCycle(){cardCycleOffset += 1; renderCardsPage();}

export function updateCardCycleQuickUI(){
  const selected=getSelectedCycleEndMonth(); const next=addMonths(selected,1); const prev=addMonths(selected,-1);
  const main=document.querySelector('.card-cycle-main'); const side=document.querySelector('.card-cycle-next'); const bar=document.querySelector('.card-cycle-bar'); if(!main||!side||!bar)return;
  const mainTitle=main.querySelector('.card-cycle-title'); const sideTitle=side.querySelector('.card-cycle-title');
  const mainLbl=document.getElementById('chipCardCycleLbl'); const mainAmt=document.getElementById('chipCardCycleAmt'); const sideLbl=document.getElementById('chipNextCycleLbl'); const sideAmt=document.getElementById('chipNextCycleAmt');
  bar.classList.toggle('offset-next',cardCycleOffset>0);
  if(cardCycleOffset>0){
    if(mainTitle)mainTitle.textContent='Ciclo anterior'; if(mainLbl)mainLbl.textContent=cycleMonthLabel(prev); if(mainAmt)mainAmt.textContent=`Anterior: ${fmt(cardCycleTotal(cardCycleOffset-1))}`; main.onclick=()=>goPrevCardCycle(); const a1=main.querySelector('.card-cycle-arrow'); if(a1)a1.textContent='‹';
    if(sideTitle)sideTitle.textContent='Ciclo seleccionado'; if(sideLbl)sideLbl.textContent=`Ciclo ${cycleMonthLabel(selected)}`; if(sideAmt)sideAmt.textContent=`Actual: ${fmt(cardCycleTotal(cardCycleOffset))}`; side.onclick=()=>abrirCardCyclePicker(); const a2=side.querySelector('.card-cycle-arrow'); if(a2)a2.textContent='⌄';
  }else{
    if(mainTitle)mainTitle.textContent='Ciclo seleccionado'; if(mainLbl)mainLbl.textContent=`Ciclo ${cycleMonthLabel(selected)}`; if(mainAmt)mainAmt.textContent=`Actual: ${fmt(cardCycleTotal(cardCycleOffset))}`; main.onclick=()=>abrirCardCyclePicker(); const a1=main.querySelector('.card-cycle-arrow'); if(a1)a1.textContent='⌄';
    if(sideTitle)sideTitle.textContent='Siguiente ciclo'; if(sideLbl)sideLbl.textContent=cycleMonthLabel(next); if(sideAmt)sideAmt.textContent=`Siguiente: ${fmt(cardCycleTotal(cardCycleOffset+1))}`; side.onclick=()=>goNextCardCycle(); const a2=side.querySelector('.card-cycle-arrow'); if(a2)a2.textContent='›';
  }
  pulseCycleBar();
}
