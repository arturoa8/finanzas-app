// Lista de posiciones y detalle.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {pfAssetColor} from './allocation.js';
import {pfFmt} from './hero.js';
import {pfPosicionMostrada, pfRendimientoActivo, pfRendimientoPosicion} from './performance.js';
import {pfColor, pfFechaCorta, pfPosicionesCache, pfResolverPeriodo, pfSigned, pfSignedPct, pfTextoDesde, renderPortafolio} from './portfolio.js';
import {pfMarketEstimate, pfQuoteKey, pfYahoo, refreshPfYahoo, renderPfYahoo} from '../../services/market-data.js';
import {sbFetch, sbFetchTodo} from '../../services/supabase.js';
import {construirLineChartSVG} from '../../ui/charts.js';
import {toast} from '../../ui/toast.js';
import {esc, fmtMoneda, fmtN, fmtPct, norm} from '../../utils/formatters.js';
import {pfNumber} from '../../utils/numbers.js';

let pfModalPeriodo='6M';

let pfModalDesde='';

let pfModalHistoricoCache=[];

let pfModalContractId=null;

// Parte superior de la tarjeta: valor y P&L. Con una estimación válida de Yahoo se
// muestra esa y se rotula "Estimado · Yahoo"; si no, el cierre oficial de IBKR.
export function pfPintarPosicion(button,p,est){
  const top=button.querySelector('.pf-pos-top');if(!top)return;
  const m=pfPosicionMostrada(p,est),oficial=pfRendimientoPosicion(p);
  const pnlTxt=m.pnl===null?'No disponible':pfSigned(m.pnl,p.moneda_base)+(m.pct===null?'':' · '+pfSignedPct(m.pct));
  const fuente=m.fuente==='yahoo'
    ?'<span class="pf-est-badge">Estimado · Yahoo</span> '+(est.sesionAbierta?'hace '+Math.max(0,Math.floor(est.age))+' min':'cierre '+esc(new Date(est.time).toLocaleString('es-PE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})))
    :'Cierre IBKR · '+esc(pfFechaCorta(p.fecha_datos)||'sin fecha');
  const cierre=m.fuente==='yahoo'&&oficial.pnl!==null?'<small>Cierre IBKR: '+esc(pfSigned(oficial.pnl,p.moneda_base))+(oficial.pnlPct===null?'':' · '+esc(pfSignedPct(oficial.pnlPct)))+'</small>':'';
  top.innerHTML=`<span class="pf-position-head"><span class="pf-position-symbol"><i class="pf-color-dot" style="background:${pfAssetColor(p.simbolo)}"></i>${esc(p.simbolo)}</span><strong>${esc(pfFmt(m.valor,p.moneda_base))}</strong></span>
    <span class="pf-position-name">${esc(p.nombre||'')}</span>
    <span class="pf-pos-perf"><strong style="color:${pfColor(m.pnl)}">${esc(pnlTxt)}</strong><small>${fuente}</small>${cierre}</span>`;
}

export function renderPfPosiciones(posiciones){
  const cont=document.getElementById('pfPosicionesLista');
  const query=norm(document.getElementById('pfPositionSearch').value);
  const sort=document.getElementById('pfPositionSort').value;
  const visible=(posiciones||[]).filter(p=>norm(p.simbolo+' '+(p.nombre||'')).includes(query)).slice();
  visible.sort(sort==='name'?(a,b)=>String(a.simbolo).localeCompare(String(b.simbolo)):(a,b)=>(pfNumber(b.valor_mercado_base)??-Infinity)-(pfNumber(a.valor_mercado_base)??-Infinity));
  document.getElementById('pfPositionCount').textContent=visible.length+' de '+(posiciones||[]).length+' posiciones';
  cont.replaceChildren();
  if(!visible.length){cont.innerHTML='<div class="empty">'+(query?'No hay posiciones que coincidan con tu búsqueda.':'No hay posiciones abiertas en el último reporte IBKR.')+'</div>';return;}
  visible.forEach(p=>{
    const button=document.createElement('button');button.type='button';button.className='pf-position';button.dataset.positionKey=pfQuoteKey(p);
    const o=pfRendimientoPosicion(p);
    button.innerHTML=`<span class="pf-pos-top"></span>
      <span class="pf-pos-sub">${esc(fmtN(p.cantidad))} acciones · Costo promedio ${esc(pfFmt(p.costo_promedio,p.moneda))}${o.costoTotal===null?'':' · Costo total '+esc(pfFmt(o.costoTotal,p.moneda_base))}<br>Precio IBKR ${esc(pfFmt(p.precio_mercado,p.moneda))}</span>
      ${p.conversion_incompleta?'<span class="pf-data-note">Conversión a moneda base pendiente</span>':''}`;
    pfPintarPosicion(button,p,null);
    button.addEventListener('click',()=>abrirPfPosModal(p.contract_id));cont.append(button);
  });
  renderPfYahoo();
}

async function abrirPfPosModal(contractId){
  const pos=pfPosicionesCache.find(p=>Number(p.contract_id)===Number(contractId));
  document.getElementById('pfPosModalTitle').textContent=pos?pos.simbolo+' · '+(pos.nombre||''):'Posición';
  document.getElementById('pfPosModalBody').innerHTML='<div class="empty">Cargando histórico…</div>';
  document.getElementById('pfPosModal').classList.add('active');
  pfModalPeriodo='6M';pfModalDesde='';
  pfModalContractId=contractId;
  try{
    const hist=await sbFetchTodo(`posiciones_historial?select=*&contract_id=eq.${Number(contractId)}&order=fecha_valoracion.asc,id.asc`);
    if(pfModalContractId!==contractId)return;
    pfModalHistoricoCache=hist||[];
  }catch(e){
    document.getElementById('pfPosModalBody').innerHTML=`<div class="empty">No se pudo cargar el histórico de esta posición.<br>${esc(e.message||'')}</div>`;
    return;
  }
  renderPfPosModalBody(pos);
}

function renderPfPosModalBody(pos){
  const body=document.getElementById('pfPosModalBody');
  let tuPosicion='';
  if(pos){
    const key=pfQuoteKey(pos),q=pfYahoo.quotes.find(x=>String(x.account)+'|'+String(x.contract_id)===key);
    const m=pfPosicionMostrada(pos,pfMarketEstimate(pos,q));
    tuPosicion=`
    <div class="pf-pos-modal-block"><div class="m-lbl">Tu posición</div>
      <div class="pf-rend-big" style="margin-top:4px"><strong style="color:${pfColor(m.pnl)}">${esc(m.pnl===null?'No disponible':pfSigned(m.pnl,pos.moneda_base)+(m.pct===null?'':' · '+pfSignedPct(m.pct)))}</strong>${m.fuente==='yahoo'?'<span class="pf-est-badge" style="margin:4px 0 0">Estimado · Yahoo</span>':'<span>Cierre IBKR · '+esc(pfFechaCorta(pos.fecha_datos)||'sin fecha')+'</span>'}</div>
      <div class="metric-grid" style="margin-top:10px">
        <div class="metric"><div class="m-lbl">Valor de mercado</div><div class="m-val">${esc(fmtMoneda(m.valor,pos.moneda_base))}</div></div>
        <div class="metric"><div class="m-lbl">% del portafolio</div><div class="m-val">${esc(fmtPct(pos.porcentaje_portafolio))}</div></div>
        <div class="metric"><div class="m-lbl">Cantidad</div><div class="m-val">${esc(fmtN(pos.cantidad))}</div></div>
        <div class="metric"><div class="m-lbl">Costo promedio</div><div class="m-val">${esc(fmtMoneda(pos.costo_promedio,pos.moneda))}</div></div>
      </div>
      <p class="hint">Calculado con tu cantidad actual y tu costo promedio.</p></div>`;
  }
  body.innerHTML=`
    ${tuPosicion}
    <div class="s-head" style="margin:14px 0 10px"><div class="s-title">Rendimiento del activo</div></div>
    <div class="an-tabs" id="pfModalPeriodoTabs" style="margin-bottom:10px;flex-wrap:wrap">
      <button class="antb" data-p="1M" onclick="setPfModalPeriodo('1M',this)">1M</button>
      <button class="antb" data-p="3M" onclick="setPfModalPeriodo('3M',this)">3M</button>
      <button class="antb active" data-p="6M" onclick="setPfModalPeriodo('6M',this)">6M</button>
      <button class="antb" data-p="YTD" onclick="setPfModalPeriodo('YTD',this)">Año actual</button>
      <button class="antb" data-p="ALL" onclick="setPfModalPeriodo('ALL',this)">Todo</button>
      <button class="antb" data-p="DESDE" onclick="setPfModalPeriodo('DESDE',this)">Desde…</button>
    </div>
    <div class="pf-desde" id="pfModalDesdePanel" hidden><label>Desde <input type="date" id="pfModalDesdeInput" onchange="setPfModalDesde(this.value)"></label><span class="pf-desde-hasta">Hasta: hoy</span><div class="pf-desde-info" id="pfModalDesdeInfo" role="status"></div></div>
    <div id="pfModalRendActivo"></div>
    <div class="pf-chart-title">Precio del activo · cierre oficial de IBKR</div>
    <div id="pfModalChartArea"></div>
    <p class="hint" id="pfModalHint"></p>
  `;
  renderPfModalChart();
}

export function setPfModalPeriodo(p,btn){
  pfModalPeriodo=p;
  if(p==='DESDE'&&!pfModalDesde&&pfModalHistoricoCache.length)pfModalDesde=pfModalHistoricoCache[0].fecha_valoracion;
  document.querySelectorAll('#pfModalPeriodoTabs .antb').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderPfModalChart();
}

export function setPfModalDesde(iso){pfModalDesde=iso||'';renderPfModalChart();}

// Precio del activo en el período y su cambio. Es el rendimiento del ACTIVO, no
// el de tu inversión: compras adicionales durante el período no lo alteran.
export function renderPfModalChart(){
  const per=pfResolverPeriodo(pfModalHistoricoCache,pfModalPeriodo,pfModalDesde);
  const panel=document.getElementById('pfModalDesdePanel'),area=document.getElementById('pfModalChartArea'),rend=document.getElementById('pfModalRendActivo'),hint=document.getElementById('pfModalHint');
  if(!area)return;
  if(panel){
    panel.hidden=pfModalPeriodo!=='DESDE';
    if(pfModalPeriodo==='DESDE'){
      const inp=document.getElementById('pfModalDesdeInput'),h=pfModalHistoricoCache;
      if(inp){if(h.length){inp.min=h[0].fecha_valoracion;inp.max=h[h.length-1].fecha_valoracion;}if(inp.value!==pfModalDesde)inp.value=pfModalDesde;}
      document.getElementById('pfModalDesdeInfo').textContent=pfTextoDesde(per,pfModalHistoricoCache);
    }
  }
  if(!per.ok){rend.innerHTML='';area.innerHTML='<div class="pf-data-note">'+esc(per.mensaje)+'</div>';hint.textContent='';return;}
  const pos=pfPosicionesCache.find(p=>Number(p.contract_id)===Number(pfModalContractId)),moneda=pos?pos.moneda:'USD';
  const r=pfRendimientoActivo(per.filas);
  if(r){
    rend.innerHTML='<div class="pf-rend-big">Rendimiento del activo · desde '+esc(pfFechaCorta(r.desde))+'<strong style="color:'+pfColor(r.pct)+'">'+esc(pfSignedPct(r.pct))+'</strong></div><div class="pf-rend-row" style="grid-template-columns:1fr 1fr"><div>Precio inicial<strong>'+esc(fmtMoneda(r.inicial,moneda))+'</strong></div><div>Precio '+esc(pfFechaCorta(r.hasta))+'<strong>'+esc(fmtMoneda(r.actual,moneda))+'</strong></div></div>';
    hint.textContent='Es el cambio de precio del activo en el período, con cierres oficiales de IBKR. No es el P&L de tu posición: cambia con tus compras y tu costo promedio.';
  }else{rend.innerHTML='';hint.textContent='';}
  area.innerHTML=construirLineChartSVG(per.filas.map(x=>({fecha:x.fecha_valoracion,valor:x.precio_mercado})),{escala:'detail'});   // un precio no debe arrancar en cero
}

export function cerrarPfPosModal(){pfModalContractId=null;document.getElementById('pfPosModal').classList.remove('active');}

// Refresh unificado (Parte A, sección 3-4, 8-9): un solo botón dispara IBKR
// y Yahoo EN PARALELO — a Yahoo no le importa si IBKR sigue sincronizando.
// pfSetActualizando lleva un contador (no un booleano) porque renderPortafolio()
// también lo usa por su cuenta: así el ícono sigue girando hasta que TODO
// termine, aunque Yahoo responda antes que IBKR.
let pfActualizandoNivel=0;

export function pfSetActualizando(on){
  pfActualizandoNivel=Math.max(0,pfActualizandoNivel+(on?1:-1));
  const btn=document.getElementById('pfRefreshBtn');
  if(!btn)return;
  const activo=pfActualizandoNivel>0;
  btn.classList.toggle('loading',activo);
  btn.disabled=activo;
}

export async function pfRefrescarTodo(btn){
  if(btn&&btn.disabled)return;
  pfSetActualizando(true);
  try{
    // Yahoo e IBKR en paralelo; renderPortafolio() recarga posiciones,
    // cierres y aportes de Supabase y reconstruye hero, Resumen, gráficos,
    // contribuciones y posiciones. Si IBKR trajo otro snapshot, el caché
    // Yahoo se invalida (pfValidarCacheYahoo) y se vuelve a pedir.
    const [rIbkr]=await Promise.all([pfSincronizarIBKR(),refreshPfYahoo({force:true})]);
    if(rIbkr&&!rIbkr.ok)toast(rIbkr.mensaje||'IBKR todavía no disponible','error');
    else if(rIbkr&&rIbkr.mensaje)toast(rIbkr.mensaje,'error');
  }catch(e){
    toast(e.message||'No se pudo actualizar el portafolio','error');
  }
  await renderPortafolio();
  pfSetActualizando(false);
}

// Sincronización IBKR pura, sin tocar el DOM: respeta el cooldown del
// servidor (RPC devuelve estado 'esperar') y nunca lanza dos solicitudes en
// paralelo (pfIbkrSincronizando). Nunca lanza (throw): siempre devuelve
// {ok,mensaje?} para que el llamador decida qué mostrar.
let pfIbkrSincronizando=false;

async function pfSincronizarIBKR(){
  if(pfIbkrSincronizando)return{ok:true,omitido:true};
  pfIbkrSincronizando=true;
  const desde=new Date();
  try{
    const resultados=await sbFetch('rpc/solicitar_sincronizacion_manual',{method:'POST',body:JSON.stringify({})});
    const resultado=Array.isArray(resultados)?resultados[0]:resultados;
    if(resultado&&resultado.estado==='esperar')return{ok:true,mensaje:resultado.mensaje||'Espera un momento antes de volver a sincronizar IBKR.'};
    // Poll hasta que aparezca el resultado de esta corrida (máx. ~2 minutos).
    for(let intento=0;intento<24;intento++){
      await new Promise(r=>setTimeout(r,5000));
      try{
        const filas=await sbFetch('sincronizaciones_portafolio?select=*&order=iniciado_en.desc&limit=1');
        const fila=filas&&filas[0];
        if(fila&&fila.finalizado_en&&new Date(fila.iniciado_en)>=desde){
          if(fila.estado==='error')return{ok:false,mensaje:'IBKR: la sincronización terminó con error ('+(fila.mensaje_error||'sin detalle')+').'};
          return{ok:true};
        }
      }catch(e){/* reintenta en la próxima vuelta */}
    }
    return{ok:true,mensaje:'IBKR sigue sincronizando en el servidor; se actualizará solo cuando termine.'};
  }catch(e){
    return{ok:false,mensaje:'IBKR todavía no disponible: '+(e.message||'error desconocido')};
  }finally{
    pfIbkrSincronizando=false;
  }
}
