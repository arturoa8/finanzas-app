// Widgets de Inicio: datos actuales y cálculos ya usados por cada pantalla.
// No dependen del calendario histórico ni hacen consultas adicionales.
import {fmtMonedas, getCardPendingByCycle} from './cards/cards.js';
import {CREDIT_CARDS} from './cards/config.js';
import {getCardCycle} from './cards/cycles.js';
import {getHomeWidgets} from './home-widgets.js';
import {pfResumenRentabilidadInicio} from './portfolio/hero.js';
import {consumoDe, consumoDelPeriodo, estadoPresupuesto, hoyLima, inicioPeriodo, nombrePeriodo, presupuestosDelPeriodo} from './presupuestos-calculo.js';
import {datos} from '../state.js';
import {endOfDay, fmtDateShort, getDaysDiff, parseDateOnly, toDateInput} from '../utils/dates.js';
import {escHtml, fmt} from '../utils/formatters.js';

const centimosResumenInicio=n=>Math.round((Number(n)||0)*100);
const HOME_CLOCK_ICON='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const resumenInicioCargado=()=>!!(datos.cargados||datos.categoriasCargadas)&&['transacciones','pagosTarjetas','configTarjetas','deudas','deudasAbonos','presupuestos'].every(k=>Array.isArray(datos[k]));

export function obtenerResumenInicio(ahora=new Date(),{tarjetas=true,deudas:incluirDeudas=true}={}){
  if(!resumenInicioCargado())return {cargado:false};
  const hasta=endOfDay(ahora),referencia=new Date(),totales={soles:0,usd:0},pagos=[];let tarjetasConSaldo=0;
  if(tarjetas)for(const card of CREDIT_CARDS){
    const pendientes=getCardPendingByCycle(card,hasta);
    if(pendientes.size)tarjetasConSaldo++;
    for(const [key,saldo] of pendientes){
      totales.soles+=centimosResumenInicio(saldo.soles);totales.usd+=centimosResumenInicio(saldo.usd);
      const cierre=parseDateOnly(key);if(!cierre)continue;
      const offset=(cierre.getFullYear()-referencia.getFullYear())*12+cierre.getMonth()-referencia.getMonth();
      const vencimiento=getCardCycle(card,offset).pay;
      pagos.push({tarjeta:card.nombre,vencimiento,dias:getDaysDiff(ahora,vencimiento),...saldo});
    }
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
  return {cargado:true,totales,tarjetasConSaldo,proximoPago:pagos[0]||null,deudas};
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

function renderHomeHighlight({id,icono,titulo,valor,nota,pagina,clase='',accion='',contenido=''}){
  return `<button type="button" class="home-highlight" data-widget="${id}" onclick="${accion||`setPg('${pagina}')`}"><span class="home-highlight-top"><span class="home-highlight-icon" aria-hidden="true">${icono}</span><span class="home-highlight-label">${escHtml(titulo)}</span><span aria-hidden="true">↗</span></span>${contenido||`<strong class="home-highlight-value ${clase}">${escHtml(valor)}</strong>`}<span class="home-highlight-note">${escHtml(nota)}</span></button>`;
}

function plazoResumenInicio(item){
  if(!item?.vencimiento)return 'Sin fecha de vencimiento';
  return (item.dias<0?'Venció ':item.dias===0?'Vence hoy · ':'Vence ')+fmtDateShort(item.vencimiento);
}

function renderRentabilidadInicio(){
  const r=pfResumenRentabilidadInicio(),pct=n=>Number.isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'%':'—';
  const columnas=[['Diaria',r.diaria],['Total',r.total]].map(([label,n])=>`<span><span class="home-return-label">${label}</span><strong class="home-highlight-value ${Number.isFinite(n)?n<0?'out':'in':''}">${pct(n)}</strong></span>`).join('');
  const fecha=parseDateOnly(r.fecha),nota=r.etiqueta+(fecha?' · '+fmtDateShort(fecha):'')+(r.total!==null?' · total vs. aportes':'');
  return renderHomeHighlight({id:'rentabilidad',icono:'↗',titulo:'Rentabilidad',pagina:'ana',nota,contenido:`<span class="home-return-grid">${columnas}</span>`});
}

function renderPresupuestoInicio(){
  const p=obtenerPresupuestoInicio();
  if(!p)return renderHomeHighlight({id:'presupuesto',icono:'◎',titulo:'Presupuesto',valor:'Sin límite',nota:'Crea un presupuesto para este período',pagina:'pres'});
  const exceso=p.estado==='excedido',nota=p.nombre+' · '+p.periodo+(p.incompletos?' · datos por completar':' · '+p.pctTexto+'% usado')
    +(p.excedidos?' · '+p.excedidos+' excedido'+(p.excedidos===1?'':'s'):'');
  return renderHomeHighlight({id:'presupuesto',icono:'◎',titulo:exceso&&!p.incompletos?'Presupuesto excedido':'Presupuesto disponible',
    valor:p.incompletos?'—':fmt(exceso?p.exceso:p.disponible),nota,pagina:'pres',clase:exceso?'out':'',
    accion:`setPg('pres');setPresVista('${p.tipo}');irPresPeriodoActual()`});
}

export function renderHomeSummary(){
  if(document.querySelector('.page.active')?.id!=='p-dash'||!document.getElementById('homeSummary')?.classList.contains('expanded'))return;
  const el=document.getElementById('homeHighlights');if(!el)return;
  const widgets=getHomeWidgets().filter(w=>w.visible),cargado=resumenInicioCargado();
  if(!widgets.length){el.innerHTML='<button type="button" class="home-widgets-empty" onclick="abrirConfiguracion(\'inicio\')">Personalizar Inicio <span aria-hidden="true">↗</span></button>';return;}
  const resumen=cargado?obtenerResumenInicio(new Date(),{tarjetas:widgets.some(w=>w.id==='tarjetas'),deudas:widgets.some(w=>w.id==='pagar'||w.id==='cobrar')}):null;
  el.innerHTML=widgets.map(({id})=>{
    if(id==='periodo')return '<div class="quick-insight" id="quickInsight" data-widget="periodo" aria-live="polite"></div>';
    if(!cargado)return `<span class="home-highlight-note" data-widget="${id}" role="status">Cargando resumen…</span>`;
    if(id==='rentabilidad')return renderRentabilidadInicio();
    if(id==='presupuesto')return renderPresupuestoInicio();
    if(id==='tarjetas'){
      const hay=resumen.tarjetasConSaldo>0,pago=resumen.proximoPago;
      return renderHomeHighlight({id,icono:HOME_CLOCK_ICON,titulo:'Tarjetas por pagar',valor:hay?fmtMonedas(resumen.totales):'Al día',
        nota:pago?pago.tarjeta+' · '+plazoResumenInicio(pago):'Sin consumos pendientes a hoy',pagina:'card',clase:hay?'out':''});
    }
    const deuda=resumen.deudas[id];if(!deuda||deuda.total<=0)return '';
    const pagar=id==='pagar',tipo=pagar?'les-debo':'me-deben',boton=pagar?'dtLesDebo':'dtMeDeben';
    return renderHomeHighlight({id,icono:pagar?'↗':'↙',titulo:pagar?'Por pagar':'Por cobrar',valor:fmt(deuda.total),
      nota:deuda.proxima.persona+' · '+plazoResumenInicio(deuda.proxima),pagina:'deb',clase:pagar?'out':'in',
      accion:`setPg('deb');setDT('${tipo}',document.getElementById('${boton}'))`});
  }).join('');
}
