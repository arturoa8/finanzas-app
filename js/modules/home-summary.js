// Widgets de Inicio: datos actuales y cálculos ya usados por cada pantalla.
// No dependen del calendario histórico ni hacen consultas adicionales.
import {resumenEfectivoSoles} from './accounts.js';
import {fmtMonedas, getCardOutstandingTotal, getCardPendingByCycle} from './cards/cards.js';
import {CREDIT_CARDS, getCardGoalPct, getCreditLimit} from './cards/config.js';
import {getCardCycle} from './cards/cycles.js';
import {getHomeWidgets} from './home-widgets.js';
import {pfResumenRentabilidadInicio} from './portfolio/hero.js';
import {consumoDe, consumoDelPeriodo, estadoPresupuesto, hoyLima, inicioPeriodo, nombrePeriodo, presupuestosDelPeriodo} from './presupuestos-calculo.js';
import {datos} from '../state.js';
import {endOfDay, fmtDateShort, getDaysDiff, parseDateOnly, pf, toDateInput} from '../utils/dates.js';
import {cleanName, escHtml, fmt, getEmoji} from '../utils/formatters.js';

const centimosResumenInicio=n=>Math.round((Number(n)||0)*100);
const HOME_CLOCK_ICON='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const icono=trazo=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${trazo}</svg>`;
const HOME_WALLET_ICON=icono('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5z"/><circle cx="16" cy="13.5" r="1" fill="currentColor"/>');
const HOME_LINE_ICON=icono('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M7 15h4"/>');
const HOME_RECENT_ICON=icono('<path d="M4 7h16M4 12h16M4 17h10"/>');
const resumenInicioCargado=()=>!!(datos.cargados||datos.categoriasCargadas)&&['transacciones','pagosTarjetas','configTarjetas','deudas','deudasAbonos','presupuestos'].every(k=>Array.isArray(datos[k]));

export function obtenerResumenInicio(ahora=new Date(),{tarjetas=true,deudas:incluirDeudas=true}={}){
  if(!resumenInicioCargado())return {cargado:false};
  const hasta=endOfDay(ahora),referencia=new Date(),totales={soles:0,usd:0},pagos=[],porTarjeta=[];let tarjetasConSaldo=0;
  if(tarjetas)for(const card of CREDIT_CARDS){
    const pendientes=getCardPendingByCycle(card,hasta),detalle={tarjeta:card.nombre,emoji:card.emoji,soles:0,usd:0,vencimiento:null,dias:null};
    if(pendientes.size)tarjetasConSaldo++;
    for(const [key,saldo] of pendientes){
      totales.soles+=centimosResumenInicio(saldo.soles);totales.usd+=centimosResumenInicio(saldo.usd);
      detalle.soles+=centimosResumenInicio(saldo.soles);detalle.usd+=centimosResumenInicio(saldo.usd);
      const cierre=parseDateOnly(key);if(!cierre)continue;
      const offset=(cierre.getFullYear()-referencia.getFullYear())*12+cierre.getMonth()-referencia.getMonth();
      const vencimiento=getCardCycle(card,offset).pay;
      pagos.push({tarjeta:card.nombre,vencimiento,dias:getDaysDiff(ahora,vencimiento),...saldo});
      if(!detalle.vencimiento||vencimiento<detalle.vencimiento){detalle.vencimiento=vencimiento;detalle.dias=getDaysDiff(ahora,vencimiento);}
    }
    detalle.soles/=100;detalle.usd/=100;porTarjeta.push(detalle);
  }
  totales.soles/=100;totales.usd/=100;
  pagos.sort((a,b)=>a.vencimiento-b.vencimiento||a.tarjeta.localeCompare(b.tarjeta,'es'));
  const abonos=new Map();
  if(incluirDeudas)for(const ab of datos.deudasAbonos||[]){
    // El registro de abonos es la fuente de verdad; d[4] no se vuelve a sumar.
    const id=String(ab[1]||''),m=parseFloat(String(ab[2]||'').replace(/[^0-9.\-]/g,''));
    if(Number.isFinite(m)&&m>0)abonos.set(id,(abonos.get(id)||0)+centimosResumenInicio(m));
  }
  const deudas={pagar:{total:0,cantidad:0,proxima:null},cobrar:{total:0,cantidad:0,proxima:null}};
  if(incluirDeudas)for(const d of datos.deudas||[]){
    const tipo=String(d[7]||'').toLowerCase(),grupo=tipo==='les-debo'?deudas.pagar:tipo==='me-deben'?deudas.cobrar:null;
    if(!grupo)continue;
    const pendiente=Math.max(0,centimosResumenInicio(d[3])-(abonos.get(String(d[0]))||0));
    if(pendiente<=0)continue;
    grupo.total+=pendiente;grupo.cantidad++;
    const vencimiento=parseDateOnly(toDateInput(d[6]));
    const candidata={id:String(d[0]),persona:String(d[1]||'Sin nombre'),vencimiento,dias:vencimiento?getDaysDiff(ahora,vencimiento):null};
    if(!grupo.proxima||(vencimiento&&(!grupo.proxima.vencimiento||vencimiento<grupo.proxima.vencimiento)))grupo.proxima=candidata;
  }
  for(const grupo of Object.values(deudas))grupo.total/=100;
  return {cargado:true,totales,tarjetasConSaldo,proximoPago:pagos[0]||null,porTarjeta,deudas};
}

export function obtenerPresupuestoInicio(ahora=new Date()){
  const hoy=hoyLima(+ahora),candidatos=[];
  for(const tipo of ['mensual','semanal']){
    const inicio=inicioPeriodo(tipo,hoy),vigentes=presupuestosDelPeriodo(datos.presupuestos,tipo,inicio);
    if(!vigentes.length)continue;
    const consumo=consumoDelPeriodo(datos.transacciones,tipo,inicio);
    for(const p of vigentes){
      const limite=centimosResumenInicio(p[1]);if(limite<=0)continue;
      const gasto=consumoDe(consumo,p),estado=estadoPresupuesto(gasto.total,limite);
      candidatos.push({id:p[3],nombre:p[4]==='general'?'General':String(p[0]),ambito:p[4],tipo,inicio,
        limite:limite/100,gastado:gasto.total/100,incompletos:gasto.incompletos,...estado,
        disponible:estado.disponible/100,exceso:estado.exceso/100,periodo:nombrePeriodo(tipo,inicio,hoy)});
    }
  }
  // No sumar límites generales y de categorías: se solapan. Se prioriza el
  // general mensual, luego el semanal; sin general, la categoría más usada.
  const elegido=candidatos.find(p=>p.ambito==='general'&&p.tipo==='mensual')
    ||candidatos.find(p=>p.ambito==='general'&&p.tipo==='semanal')
    ||candidatos.sort((a,b)=>b.pct-a.pct||a.nombre.localeCompare(b.nombre,'es'))[0];
  return elegido?{...elegido,excedidos:candidatos.filter(p=>p.estado==='excedido'&&!p.incompletos).length}:null;
}

// tamano: 'normal' ocupa media fila; 'ancho' toda la fila y suma el detalle
// de `extra`. Todo lo que va dentro del botón son <span> (HTML válido).
function renderHomeHighlight({id,icono,titulo,valor,nota,pagina,clase='',accion='',contenido='',tamano='normal',extra=''}){
  return `<button type="button" class="home-highlight" data-widget="${id}" data-size="${tamano}" onclick="${accion||`setPg('${pagina}')`}"><span class="home-highlight-top"><span class="home-highlight-icon" aria-hidden="true">${icono}</span><span class="home-highlight-label">${escHtml(titulo)}</span><span aria-hidden="true">↗</span></span>${contenido||`<strong class="home-highlight-value ${clase}">${escHtml(valor)}</strong>`}${nota?`<span class="home-highlight-note">${escHtml(nota)}</span>`:''}${tamano==='ancho'?extra:''}</button>`;
}

const barraResumen=(pct,excede)=>`<span class="home-highlight-progress${excede?' over':''}"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></span>`;
// Filas de detalle del tamaño ancho: [texto, secundario, valor, clase].
const filasResumen=filas=>`<span class="home-extra">${filas.map(([texto,detalle,valor,clase=''])=>`<span class="home-extra-row"><span class="home-extra-main">${texto}${detalle?`<small>${detalle}</small>`:''}</span>${valor===''?'':`<strong class="${clase}">${valor}</strong>`}</span>`).join('')}</span>`;

function plazoResumenInicio(item){
  if(!item?.vencimiento)return 'Sin fecha de vencimiento';
  return (item.dias<0?'Venció ':item.dias===0?'Vence hoy · ':'Vence ')+fmtDateShort(item.vencimiento);
}

function renderRentabilidadInicio(tamano){
  const r=pfResumenRentabilidadInicio(),pct=n=>Number.isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'%':'—';
  const columnas=[['Diaria',r.diaria],['Total',r.total]].map(([label,n])=>`<span><span class="home-return-label">${label}</span><strong class="home-highlight-value ${Number.isFinite(n)?n<0?'out':'in':''}">${pct(n)}</strong></span>`).join('');
  const fecha=parseDateOnly(r.fecha),nota=r.etiqueta+(fecha?' · '+fmtDateShort(fecha):'')+(r.total!==null?' · total vs. aportes':'');
  return renderHomeHighlight({id:'rentabilidad',icono:'↗',titulo:'Rentabilidad',pagina:'ana',nota,tamano,contenido:`<span class="home-return-grid">${columnas}</span>`});
}

function renderPresupuestoInicio(tamano){
  const p=obtenerPresupuestoInicio();
  if(!p)return renderHomeHighlight({id:'presupuesto',icono:'◎',titulo:'Presupuesto',valor:'Sin límite',nota:'Crea un presupuesto para este período',pagina:'pres',tamano});
  const exceso=p.estado==='excedido',nota=p.nombre+' · '+p.periodo+(p.incompletos?' · datos por completar':' · '+p.pctTexto+'% usado')
    +(p.excedidos?' · '+p.excedidos+' excedido'+(p.excedidos===1?'':'s'):'');
  return renderHomeHighlight({id:'presupuesto',icono:'◎',titulo:exceso&&!p.incompletos?'Presupuesto excedido':'Presupuesto disponible',
    valor:p.incompletos?'—':fmt(exceso?p.exceso:p.disponible),nota,pagina:'pres',clase:exceso?'out':'',tamano,
    extra:p.incompletos?'':barraResumen(p.barra,exceso)+filasResumen([['Gastado','',fmt(p.gastado),exceso?'out':''],['Límite','',fmt(p.limite)]]),
    accion:`setPg('pres');setPresVista('${p.tipo}');irPresPeriodoActual()`});
}

function renderEfectivoInicio(tamano){
  const {total,cuentas}=resumenEfectivoSoles(),visibles=cuentas.slice(0,4),resto=cuentas.length-visibles.length;
  return renderHomeHighlight({id:'efectivo',icono:HOME_WALLET_ICON,titulo:'Efectivo',valor:cuentas.length?fmt(total):'Sin cuentas',
    nota:cuentas.length?cuentas.length+' cuenta'+(cuentas.length===1?'':'s')+' en soles':'Agrega una cuenta en soles en Configuración',
    pagina:'bud',clase:total<0?'out':'',tamano,
    extra:cuentas.length?filasResumen([...visibles.map(c=>[escHtml(c.nombre),'',fmt(c.saldo),c.saldo<0?'out':'']),...(resto>0?[['y '+resto+' más en Estadísticas','','']]:[])]):''});
}

function renderLineaInicio(tamano){
  const used=CREDIT_CARDS.reduce((sum,card)=>sum+getCardOutstandingTotal(card),0);
  const limit=CREDIT_CARDS.reduce((sum,card)=>sum+getCreditLimit(card),0);
  if(!(limit>0))return renderHomeHighlight({id:'linea',icono:HOME_LINE_ICON,titulo:'Línea de crédito',valor:'Sin línea',nota:'Define el límite de tus tarjetas',pagina:'card',tamano});
  const goal=CREDIT_CARDS.reduce((sum,card)=>sum+getCreditLimit(card)*getCardGoalPct(card)/100,0),pct=used/limit*100,sobre=used>goal||pct>=80;
  const resto=goal-used;
  return renderHomeHighlight({id:'linea',icono:HOME_LINE_ICON,titulo:'Línea usada',valor:pct.toFixed(0)+'%',nota:fmt(used)+' de '+fmt(limit),
    pagina:'card',clase:sobre?'out':'',tamano,contenido:`<strong class="home-highlight-value ${sobre?'out':''}">${pct.toFixed(0)}%</strong>${barraResumen(pct,sobre)}`,
    extra:filasResumen([['Meta','',fmt(goal)],[resto>=0?'Te quedan para la meta':'Sobre la meta','',fmt(Math.abs(resto)),resto>=0?'':'out']])});
}

function renderUltimosInicio(){
  const recientes=(datos.transacciones||[]).map((t,i)=>({t,i,f:pf(t[0])})).filter(x=>x.f&&!isNaN(+x.f))
    .sort((a,b)=>b.f-a.f||b.i-a.i).slice(0,3);
  const signo=t=>t[3]==='Ingreso'?['+ ','in']:t[3]==='Transferencia'?['','']:['− ','out'];
  const filas=recientes.map(({t,f})=>{const [s,clase]=signo(t);
    return [getEmoji(cleanName(t[2])).e+' '+escHtml(t[1]||'Sin descripción'),escHtml(cleanName(t[2]))+' · '+fmtDateShort(f),s+fmt(t[4]),clase];});
  return renderHomeHighlight({id:'ultimos',icono:HOME_RECENT_ICON,titulo:'Últimos movimientos',tamano:'ancho',accion:'alternarMovimientosInicio()',nota:filas.length?'':'Aún no hay movimientos',
    contenido:filas.length?filasResumen(filas):'<strong class="home-highlight-value">Sin movimientos</strong>'});
}

export function renderHomeSummary(){
  if(document.querySelector('.page.active')?.id!=='p-dash'||!document.getElementById('homeSummary')?.classList.contains('expanded'))return;
  const el=document.getElementById('homeHighlights');if(!el)return;
  const widgets=getHomeWidgets().filter(w=>w.visible),cargado=resumenInicioCargado();
  if(!widgets.length){el.innerHTML='<button type="button" class="home-widgets-empty" onclick="abrirConfiguracion(\'inicio\')">Personalizar Inicio <span aria-hidden="true">↗</span></button>';return;}
  const tamanos=new Map(widgets.map(w=>[w.id,w.tamano]));
  const resumen=cargado?obtenerResumenInicio(new Date(),{tarjetas:widgets.some(w=>w.id==='tarjetas'),deudas:widgets.some(w=>w.id==='pagar'||w.id==='cobrar')}):null;
  el.innerHTML=widgets.map(({id})=>{
    const tamano=tamanos.get(id)||'normal';
    if(id==='periodo')return '<div class="quick-insight" id="quickInsight" data-widget="periodo" data-size="ancho" aria-live="polite"></div>';
    if(!cargado)return `<span class="home-highlight-note" data-widget="${id}" data-size="${tamano}" role="status">Cargando resumen…</span>`;
    if(id==='rentabilidad')return renderRentabilidadInicio(tamano);
    if(id==='presupuesto')return renderPresupuestoInicio(tamano);
    if(id==='efectivo')return renderEfectivoInicio(tamano);
    if(id==='linea')return renderLineaInicio(tamano);
    if(id==='ultimos')return renderUltimosInicio();
    if(id==='tarjetas'){
      const hay=resumen.tarjetasConSaldo>0,pago=resumen.proximoPago;
      return renderHomeHighlight({id,icono:HOME_CLOCK_ICON,titulo:'Tarjetas por pagar',valor:hay?fmtMonedas(resumen.totales):'Al día',
        nota:pago?pago.tarjeta+' · '+plazoResumenInicio(pago):'Sin consumos pendientes a hoy',pagina:'card',clase:hay?'out':'',tamano,
        extra:resumen.porTarjeta.length?filasResumen(resumen.porTarjeta.map(c=>{const debe=c.soles>0||c.usd>0;
          return [escHtml((c.emoji||'')+' '+c.tarjeta).trim(),debe?escHtml(plazoResumenInicio(c)):'',debe?escHtml(fmtMonedas(c)):'Al día',debe?'out':''];})):''});
    }
    const deuda=resumen.deudas[id];if(!deuda||deuda.total<=0)return '';
    const pagar=id==='pagar',tipo=pagar?'les-debo':'me-deben',boton=pagar?'dtLesDebo':'dtMeDeben';
    return renderHomeHighlight({id,icono:pagar?'↗':'↙',titulo:pagar?'Por pagar':'Por cobrar',valor:fmt(deuda.total),
      nota:deuda.proxima.persona+' · '+plazoResumenInicio(deuda.proxima),pagina:'deb',clase:pagar?'out':'in',tamano,
      extra:filasResumen([[deuda.cantidad+' pendiente'+(deuda.cantidad===1?'':'s'),'','']]),
      accion:`setPg('deb');setDT('${tipo}',document.getElementById('${boton}'))`});
  }).join('');
}
