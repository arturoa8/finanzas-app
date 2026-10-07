// Lineas de credito, limites y metas.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderCardDetail, renderCardsPage} from './cards-ui.js';
import {inicioFromFin} from './cycles.js';
import {ordenarTarjetas, quitarDeOrden, renombrarEnOrden} from './orden.js';
import {sbDelete, sbInsert, sbUpdate} from '../../services/supabase.js';
import {datos} from '../../state.js';
import {toast} from '../../ui/toast.js';
import {guardedOnce} from '../../utils/async.js';
import {escAttr, escHtml, fmt, norm} from '../../utils/formatters.js';

// Defaults legacy: se usan si ConfigTarjetas no tiene día de corte/pago
// para alguna cuenta conocida. Permite migración suave del primer load.
const LEGACY_CARD_DEFAULTS=[
  {nombre:'Mastercard Platinum',emoji:'💳',cuenta:'Mastercard Platinum',finDia:9,pagoDia:5},
  {nombre:'Visa iO',emoji:'💳',cuenta:'Visa iO',finDia:24,pagoDia:12}
];

function getCreditCards(){
  const rows=(datos.configTarjetas||[]).filter(r=>{
    const k=String(r&&r[0]||'').trim();
    return k && k!=='__global__';
  });
  const byCuenta={};
  rows.forEach(r=>{
    const cuenta=String(r[0]).trim();
    const limite=parseFloat(r[1])||0;
    const metaRaw=parseFloat(r[2]);
    const meta=Number.isFinite(metaRaw)&&metaRaw>0?metaRaw:null;
    const nombre=String(r[3]||'').trim()||cuenta;
    const emoji=String(r[4]||'').trim()||'💳';
    const finDia=parseInt(r[5],10);
    const pagoDia=parseInt(r[6],10);
    const legacy=LEGACY_CARD_DEFAULTS.find(c=>norm(c.cuenta)===norm(cuenta));
    const finOk=Number.isFinite(finDia)&&finDia>=1&&finDia<=31;
    const pagoOk=Number.isFinite(pagoDia)&&pagoDia>=1&&pagoDia<=31;
    const fin=finOk?finDia:(legacy?legacy.finDia:9);
    const pago=pagoOk?pagoDia:(legacy?legacy.pagoDia:5);
    byCuenta[norm(cuenta)]={
      cuenta,nombre,emoji,
      finDia:fin,
      inicioDia:inicioFromFin(fin),
      pagoDia:pago,
      limite,
      metaPct:meta,
      _hasFullConfig:finOk&&pagoOk
    };
  });
  // Incluir defaults legacy si no estaban en la hoja
  LEGACY_CARD_DEFAULTS.forEach(d=>{
    if(!byCuenta[norm(d.cuenta)]){
      byCuenta[norm(d.cuenta)]={
        cuenta:d.cuenta,nombre:d.nombre,emoji:d.emoji,
        finDia:d.finDia,
        inicioDia:inicioFromFin(d.finDia),
        pagoDia:d.pagoDia,
        limite:0,
        metaPct:null,
        _hasFullConfig:false
      };
    }
  });
  return ordenarTarjetas(Object.values(byCuenta));
}

// Proxy con .map/.forEach/.find/.reduce/.length que delega a getCreditCards()
export const CREDIT_CARDS={
  get length(){return getCreditCards().length;},
  map(fn){return getCreditCards().map(fn);},
  forEach(fn){return getCreditCards().forEach(fn);},
  find(fn){return getCreditCards().find(fn);},
  some(fn){return getCreditCards().some(fn);},
  filter(fn){return getCreditCards().filter(fn);},
  reduce(fn,init){return getCreditCards().reduce(fn,init);},
  [Symbol.iterator](){return getCreditCards()[Symbol.iterator]();}
};

export function getCreditLimit(card){
  const row=(datos.configTarjetas||[]).find(r=>norm(String(r[0]))===norm(card.cuenta));
  if(row){const n=parseFloat(row[1]);if(Number.isFinite(n)&&n>0)return n;}
  return 0;
}

async function setCreditLimit(card,value){
  const n=Math.max(0,parseFloat(value)||0);
  const row=(datos.configTarjetas||[]).find(r=>norm(String(r[0]))===norm(card.cuenta));
  if(row){
    await sbUpdate('config_tarjetas',card.cuenta,{limite_credito:n},'tarjeta');
    row[1]=n;
  } else {
    const r=await sbInsert('config_tarjetas',{tarjeta:card.cuenta,limite_credito:n,meta_pct:30});
    datos.configTarjetas.push([r.tarjeta,r.limite_credito,r.meta_pct,r.nombre,r.emoji,r.corte_dia,r.pago_dia]);
  }
}

export function getCreditGoalPct(){
  const row=(datos.configTarjetas||[]).find(r=>String(r[0])==='__global__');
  if(row){const n=parseFloat(row[2]);if(Number.isFinite(n)&&n>0)return n;}
  return 30;
}

async function setCreditGoalPct(value){
  const n=Math.max(1,Math.min(100,parseFloat(value)||30));
  const row=(datos.configTarjetas||[]).find(r=>String(r[0])==='__global__');
  if(row){
    await sbUpdate('config_tarjetas','__global__',{meta_pct:n},'tarjeta');
    row[2]=n;
  } else {
    const r=await sbInsert('config_tarjetas',{tarjeta:'__global__',limite_credito:0,meta_pct:n});
    datos.configTarjetas.push([r.tarjeta,r.limite_credito,r.meta_pct,r.nombre,r.emoji,r.corte_dia,r.pago_dia]);
  }
}

function getLineState(used,limit,goalPct=getCreditGoalPct()){
  const pct=limit>0?(used/limit)*100:0;
  const goalAmount=limit*(goalPct/100);
  const remaining=goalAmount-used;
  let cls='ok',label='Óptimo';
  if(pct>=80){cls='danger';label='Muy alto';}
  else if(used>goalAmount){cls='bad';label='Sobre meta';}
  else if(used>=goalAmount*.8){cls='warn';label='Cerca de meta';}
  return{pct,goalAmount,remaining,cls,label};
}

export function renderLineProgress(pct,cls){
  return `<div class="line-progress"><div class="line-fill ${cls}" style="width:${Math.min(pct,100)}%"></div></div>`;
}

export function getCardGoalPct(card){
  if(card && Number.isFinite(card.metaPct) && card.metaPct>0) return card.metaPct;
  return getCreditGoalPct();
}

export function renderCreditLineBlock(card,used){
  const limit=getCreditLimit(card); const goal=getCardGoalPct(card); const st=getLineState(used,limit,goal);
  const advice=st.remaining>=0?`Te quedan ${fmt(st.remaining)}`:`Te pasaste ${fmt(Math.abs(st.remaining))}`;
  return `<div class="credit-line-block">
    <div class="credit-line-title"><span>Línea usada</span><span>${fmt(used)} de ${fmt(limit)}</span></div>
    ${renderLineProgress(st.pct,st.cls)}
    <div class="credit-line-sub"><span>${st.pct.toFixed(1)}% usado · meta ${goal}% (${fmt(st.goalAmount)})</span><span class="line-advice ${st.cls}">${advice}</span></div>
  </div>`;
}

export function abrirLineasCredito(){
  renderLineasCreditoConfig();
  document.getElementById('creditLineModal').classList.add('active');
}

export function cerrarLineasCredito(){document.getElementById('creditLineModal').classList.remove('active');}

// Avisa a Configuración (lista de orden) sin importarla: evita un ciclo.
const avisarTarjetas=()=>globalThis.dispatchEvent?.(new Event('finanzas:tarjetas'));

function renderLineasCreditoConfig(){
  const cont=document.getElementById('creditLineConfig'); if(!cont)return;
  const goal=getCreditGoalPct();
  const cards=getCreditCards();
  const cardItems=cards.map((card,i)=>`
    <div class="line-config-item" data-card-idx="${i}" data-old-cuenta="${escAttr(card.cuenta)}">
      <div class="line-config-name" style="display:flex;align-items:center;gap:8px;justify-content:space-between">
        <span>${escHtml(card.emoji)} ${escHtml(card.nombre)}</span>
        <button class="line-edit-btn" style="background:#ff3b6b1a;border-color:#ff3b6b66;color:var(--red)" onclick="eliminarTarjeta(this.closest('.line-config-item').dataset.oldCuenta)">Eliminar</button>
      </div>
      <div class="line-config-row" style="grid-template-columns:80px 1fr;margin-top:8px">
        <div class="line-field"><label>Emoji</label><input class="cardEmojiInput" type="text" maxlength="4" value="${escAttr(card.emoji)}"></div>
        <div class="line-field"><label>Nombre</label><input class="cardNameInput" type="text" value="${escAttr(card.nombre)}"></div>
      </div>
      <div class="line-config-row" style="grid-template-columns:1fr 1fr;margin-top:8px">
        <div class="line-field"><label>Día corte</label><input class="cardCorteInput" type="number" min="1" max="31" inputmode="numeric" value="${card.finDia}"></div>
        <div class="line-field"><label>Día pago</label><input class="cardPagoInput" type="number" min="1" max="31" inputmode="numeric" value="${card.pagoDia}"></div>
      </div>
      <div class="line-config-row" style="grid-template-columns:1fr 1fr;margin-top:8px">
        <div class="line-field"><label>Línea</label><input class="cardLimitInput" type="number" inputmode="decimal" step="0.01" value="${card.limite}"></div>
        <div class="line-field"><label>Meta % (esta tarjeta)</label><input class="cardMetaInput" type="number" inputmode="decimal" step="1" min="1" max="100" value="${Number.isFinite(card.metaPct)&&card.metaPct>0?card.metaPct:''}" placeholder="usa global (${goal}%)"></div>
      </div>
      <button class="btn btn-p" style="margin-top:10px" onclick="guardarTarjetaInline(${i})">Guardar tarjeta</button>
    </div>`).join('');
  cont.innerHTML=`
    <div class="line-config-grid">
      <div class="line-config-item">
        <div class="line-config-name">Meta % global</div>
        <div class="line-config-row" style="grid-template-columns:1fr auto;margin-top:8px">
          <div class="line-field"><label>Meta %</label><input id="creditGoalPctInput" type="number" inputmode="decimal" step="1" min="1" max="100" value="${goal}"></div>
          <button class="btn btn-p" style="align-self:end" onclick="guardarMetaPct()">Guardar meta</button>
        </div>
      </div>
      ${cardItems || '<div class="empty" style="padding:18px 8px">Aún no tienes tarjetas. Agrega la primera abajo.</div>'}
      <div class="line-config-item" style="border:1px dashed var(--border)">
        <div class="line-config-name">Nueva tarjeta</div>
        ${cards.some(c=>norm(c.cuenta)===norm('Visa Clásica BCP Qore'))?'':'<button class="line-edit-btn" onclick="prepararVisaQore()">Completar Visa Clásica BCP Qore · S/ 3.700</button>'}
        <div class="line-config-row" style="grid-template-columns:80px 1fr;margin-top:8px">
          <div class="line-field"><label>Emoji</label><input id="newCardEmoji" type="text" maxlength="4" value="💳"></div>
          <div class="line-field"><label>Nombre</label><input id="newCardName" type="text" placeholder="Ej. Visa Gold"></div>
        </div>
        <div class="line-config-row" style="grid-template-columns:1fr 1fr;margin-top:8px">
          <div class="line-field"><label>Día corte</label><input id="newCardCorte" type="number" min="1" max="31" inputmode="numeric"></div>
          <div class="line-field"><label>Día pago</label><input id="newCardPago" type="number" min="1" max="31" inputmode="numeric"></div>
        </div>
        <div class="line-config-row" style="grid-template-columns:1fr 1fr;margin-top:8px">
          <div class="line-field"><label>Línea</label><input id="newCardLimit" type="number" inputmode="decimal" step="0.01" value="0"></div>
          <div class="line-field"><label>Meta % (opcional)</label><input id="newCardMeta" type="number" inputmode="decimal" step="1" min="1" max="100" placeholder="usa global (${goal}%)"></div>
        </div>
        <button class="btn btn-p" style="margin-top:10px" onclick="agregarTarjeta()">Agregar tarjeta</button>
      </div>
    </div>`;
}

async function guardarMetaPct__base(){
  const v=parseFloat(document.getElementById('creditGoalPctInput').value);
  if(!Number.isFinite(v)||v<=0){toast('Meta inválida','error');return;}
  await setCreditGoalPct(v);
  renderCardsPage(); renderCardDetail(); toast('Meta actualizada','success');
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarMetaPct=guardedOnce(guardarMetaPct__base);

async function guardarTarjetaInline__base(i){
  const item=document.querySelector(`.line-config-item[data-card-idx="${i}"]`); if(!item)return;
  const oldCuenta=item.getAttribute('data-old-cuenta')||'';
  const nombre=item.querySelector('.cardNameInput').value.trim();
  const emoji=item.querySelector('.cardEmojiInput').value.trim()||'💳';
  const corteDia=parseInt(item.querySelector('.cardCorteInput').value,10);
  const pagoDia=parseInt(item.querySelector('.cardPagoInput').value,10);
  const limite=Number(item.querySelector('.cardLimitInput').value);
  const metaRaw=item.querySelector('.cardMetaInput').value.trim();
  const metaPct=metaRaw===''?null:parseFloat(metaRaw);
  if(!nombre){toast('Nombre requerido','error');return;}
  if(!Number.isFinite(limite)||limite<0){toast('La línea debe ser un importe positivo o cero','error');return;}
  if(!Number.isFinite(corteDia)||corteDia<1||corteDia>31){toast('Día de corte 1-31','error');return;}
  if(!Number.isFinite(pagoDia)||pagoDia<1||pagoDia>31){toast('Día de pago 1-31','error');return;}
  if(metaPct!==null && (!Number.isFinite(metaPct)||metaPct<=0||metaPct>100)){toast('Meta % 1-100','error');return;}
  try{
    await saveCardConfig({cuenta:nombre,nombre,emoji,corteDia,pagoDia,limiteCredito:limite,metaPct,oldCuenta});
    renderLineasCreditoConfig(); renderCardsPage(); renderCardDetail(); avisarTarjetas(); toast('Tarjeta guardada','success');
  }catch(e){toast(e.message||'Error al guardar','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const guardarTarjetaInline=guardedOnce(guardarTarjetaInline__base);

export function prepararVisaQore(){
 const master=getCreditCards().find(c=>norm(c.cuenta).includes('mastercard'));
 if(!master){toast('Configura primero los días de la Mastercard','error');return;}
 document.getElementById('newCardName').value='Visa Clásica BCP Qore';
 document.getElementById('newCardCorte').value=master.finDia;
 document.getElementById('newCardPago').value=master.pagoDia;
 document.getElementById('newCardLimit').value=3700;
 document.getElementById('newCardName').focus();
}

async function agregarTarjeta__base(){
  const nombre=document.getElementById('newCardName').value.trim();
  const emoji=document.getElementById('newCardEmoji').value.trim()||'💳';
  const corteDia=parseInt(document.getElementById('newCardCorte').value,10);
  const pagoDia=parseInt(document.getElementById('newCardPago').value,10);
  const limite=Number(document.getElementById('newCardLimit').value);
  const metaRaw=document.getElementById('newCardMeta').value.trim();
  const metaPct=metaRaw===''?null:parseFloat(metaRaw);
  if(!nombre){toast('Nombre requerido','error');return;}
  if(!Number.isFinite(limite)||limite<0){toast('La línea debe ser un importe positivo o cero','error');return;}
  if(!Number.isFinite(corteDia)||corteDia<1||corteDia>31){toast('Día de corte 1-31','error');return;}
  if(!Number.isFinite(pagoDia)||pagoDia<1||pagoDia>31){toast('Día de pago 1-31','error');return;}
  if(metaPct!==null && (!Number.isFinite(metaPct)||metaPct<=0||metaPct>100)){toast('Meta % 1-100','error');return;}
  if(getCreditCards().some(c=>norm(c.cuenta)===norm(nombre))){toast('Ya existe una tarjeta con ese nombre','error');return;}
  try{
    await saveCardConfig({cuenta:nombre,nombre,emoji,corteDia,pagoDia,limiteCredito:limite,metaPct});
    renderLineasCreditoConfig(); renderCardsPage(); renderCardDetail(); avisarTarjetas(); toast('Tarjeta agregada','success');
  }catch(e){toast(e.message||'Error al agregar','error');}
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const agregarTarjeta=guardedOnce(agregarTarjeta__base);

async function eliminarTarjeta__base(cuenta){
  if(!confirm(`¿Eliminar la tarjeta "${cuenta}"? Las transacciones permanecerán en el historial.`))return;
  try{
    await sbDelete('config_tarjetas',cuenta,'tarjeta');
    datos.configTarjetas=datos.configTarjetas.filter(r=>norm(String(r[0]))!==norm(cuenta));
    quitarDeOrden(cuenta);
    renderLineasCreditoConfig(); renderCardsPage(); renderCardDetail(); avisarTarjetas(); toast('Tarjeta eliminada','success');
  }catch(e){
    const msg=/foreign key|violat/i.test(e.message||'')?'No se puede eliminar: tiene pagos o ajustes de ciclo registrados':(e.message||'Error al eliminar');
    toast(msg,'error');
  }
}
// Se envuelve en el punto de definicion, no al exponerla, para que las
// llamadas internas queden igual de protegidas que en el monolito.
export const eliminarTarjeta=guardedOnce(eliminarTarjeta__base);

async function saveCardConfig({cuenta,nombre,emoji,corteDia,pagoDia,limiteCredito,metaPct,oldCuenta}){
  // metaPct: null/'' = usar global; número = meta individual de esta tarjeta.
  const body={tarjeta:cuenta,nombre,emoji,corte_dia:corteDia,pago_dia:pagoDia,limite_credito:limiteCredito,
    meta_pct:(metaPct===undefined||metaPct===null||metaPct==='')?null:metaPct};
  let row;
  if(oldCuenta){
    row=await sbUpdate('config_tarjetas',oldCuenta,body,'tarjeta');
    const cfg=datos.configTarjetas.find(r=>norm(String(r[0]))===norm(oldCuenta));
    if(cfg){cfg[0]=row.tarjeta;cfg[1]=row.limite_credito;cfg[2]=row.meta_pct;cfg[3]=row.nombre;cfg[4]=row.emoji;cfg[5]=row.corte_dia;cfg[6]=row.pago_dia;}
    if(norm(oldCuenta)!==norm(cuenta)){
      renombrarEnOrden(oldCuenta,cuenta);
      // Postgres ya propaga el rename a pagos_tarjetas/ciclos_override vía ON UPDATE CASCADE;
      // replicamos el mismo efecto en el estado local para no tener que recargar todo.
      datos.pagosTarjetas.forEach(r=>{if(norm(String(r[1]))===norm(oldCuenta))r[1]=cuenta;});
      datos.ciclosOverride.forEach(r=>{if(norm(String(r[1]))===norm(oldCuenta))r[1]=cuenta;});
      // Las transacciones históricas conservan el nombre de cuenta viejo (igual que el comportamiento original).
    }
  } else {
    row=await sbInsert('config_tarjetas',body);
    datos.configTarjetas.push([row.tarjeta,row.limite_credito,row.meta_pct,row.nombre,row.emoji,row.corte_dia,row.pago_dia]);
  }
  return row;
}
