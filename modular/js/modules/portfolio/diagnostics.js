// Portafolio: tarjeta de diagnostico (reconciliacion IBKR, serie 1D y Yahoo).
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {obtenerValorActualPortafolio} from './hero.js';
import {pfUltimoDiag1D} from './intraday.js';
import {pfFechaCorta, pfHistoricoCache, pfPosicionesCache} from './portfolio.js';
import {pfComputeBaseId, pfIntervaloIntradia, pfLondonDay, pfYahoo} from '../../services/market-data.js';
import {fmtDateLong} from '../../utils/dates.js';
import {esc, fmtMoneda} from '../../utils/formatters.js';
import {pfNumber} from '../../utils/numbers.js';

// ── Diagnóstico (sección 11): última reconciliación calculado (ledger) vs
// oficial (IBKR) y tamaño del ledger de operaciones. Si todavía no hay
// ninguna reconciliación (p.ej. la Flex Query no trae Trades/CashTransactions
// aún) la card no se muestra: no tiene sentido diagnosticar sin datos.
export function togglePfDiag(){
  const body=document.getElementById('pfDiagBody'),toggle=document.getElementById('pfDiagToggle');
  const abierto=body.style.display!=='none';
  body.style.display=abierto?'none':'';
  toggle.textContent=abierto?'Mostrar ▾':'Ocultar ▴';
}

export function renderPfDiagnostico(recon,ledger){
  const card=document.getElementById('pfDiagCard');
  if(!pfHistoricoCache.length){card.style.display='none';return;}
  card.style.display='';
  const resumen=document.getElementById('pfDiagResumen'),tabla=document.getElementById('pfDiagTabla'),moneda='USD';
  const ultimaOp=ledger.length?fmtDateLong(new Date(ledger[0].fecha_hora)):'sin operaciones importadas';
  // Fuente de posiciones/histórico y cobertura Yahoo (secciones 2 y 16 del
  // pedido): esto vivía antes en una franja arriba de todo y en la card
  // "Estimación de mercado" — se movió acá, información técnica secundaria.
  const campos=[['Fuente de posiciones e histórico','IBKR · Cierre oficial (Flex)']];
  if(recon)campos.push(
    ['Estado reconciliación', recon.estado==='cuadrado'?'✓ Cuadrado':'⚠️ Diferencia'],
    ['Fecha reconciliada', pfFechaCorta(recon.fecha)],
    ['Portafolio calculado (ledger)', fmtMoneda(recon.valor_calculado,moneda)],
    ['IBKR (oficial)', fmtMoneda(recon.valor_ibkr,moneda)],
    ['Diferencia', fmtMoneda(recon.diferencia_absoluta,moneda)+(recon.diferencia_pct!==null?' · '+recon.diferencia_pct.toFixed(3)+'%':'')],
    ['Operaciones en el ledger', ledger.length+' · última: '+esc(ultimaOp)],
  );
  // La cobertura Yahoo detallada (por símbolo, con motivo) vive aparte en
  // renderPfDiagnosticoYahoo() → #pfDiagYahoo, no acá.
  resumen.innerHTML=campos.map(([k,v])=>`<div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join('');

  if(!recon){tabla.innerHTML='';return;}
  const filasDiff=(recon.detalle||[]).filter(f=>{
    const va=pfNumber(f.valor_app),vi=pfNumber(f.valor_ibkr);
    return va===null||vi===null||Math.abs(va-vi)>=0.10;
  });
  if(recon.estado==='cuadrado'||!filasDiff.length){tabla.innerHTML='';return;}
  tabla.innerHTML='<p class="hint" style="margin-bottom:6px">Posiciones con diferencia ≥ $0.10 entre lo calculado desde el ledger y el cierre oficial de IBKR:</p>'+
    '<table style="width:100%;font-size:12px;border-collapse:collapse">'+
    '<thead><tr><th style="text-align:left">Símbolo</th><th>Cant. app</th><th>Cant. IBKR</th><th>Valor app</th><th>Valor IBKR</th></tr></thead><tbody>'+
    filasDiff.map(f=>`<tr><td>${esc(f.simbolo||'—')}</td><td style="text-align:right">${f.cantidad_app??'—'}</td><td style="text-align:right">${f.cantidad_ibkr??'—'}</td><td style="text-align:right">${f.valor_app!==null&&f.valor_app!==undefined?fmtMoneda(f.valor_app,moneda):'—'}</td><td style="text-align:right">${f.valor_ibkr!==null&&f.valor_ibkr!==undefined?fmtMoneda(f.valor_ibkr,moneda):'—'}</td></tr>`).join('')+
    '</tbody></table>';
}

// Diagnóstico Serie 1D (sección 25 del pedido de 1D): fuente real usada,
// cobertura por posición, cuántos puntos trajo Yahoo vs. cuántos se
// pudieron usar, y que el último punto coincida con el hero (debe dar
// diferencia $0.00 porque ambos salen de obtenerValorActualPortafolio()).
export function renderPfDiagnostico1D(s){
  const el=document.getElementById('pfDiag1D');
  if(!el)return;
  const tl=pfUltimoDiag1D;
  const v=obtenerValorActualPortafolio();
  const heroValor=v.fuente==='YAHOO'?v.valor:v.cierreIbkr;
  const fuenteTxt={YAHOO:'Yahoo intradía',YAHOO_PARCIAL:'Yahoo intradía (parcial)',SNAPSHOTS:'portfolio_snapshots',MINIMO:'cierre anterior + valor actual',IBKR:'dos últimos cierres IBKR',SIN_DATOS:'sin datos'}[s.fuente]||s.fuente;
  const d=s.dia||{};
  const baseTxt={YAHOO:'Yahoo · cierre regular anterior',IBKR_BASE:'IBKR · cierre oficial (respaldo)',IBKR_CIERRES:'IBKR · penúltimo cierre'}[d.fuente]||'—';
  const primero=s.serie[0],ultimo=s.serie[s.serie.length-1];
  const hora=t=>t?new Date(t).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}):'—';
  const iv=pfIntervaloIntradia();
  const filas=[['Fuente',fuenteTxt],['Base del día',baseTxt],['Valor base',fmtMoneda(s.base,s.moneda)],['Sesión medida',d.sesion?pfFechaCorta(d.sesion):'—']];
  if(d.motivo)filas.push(['Motivo',d.motivo]);
  (d.contribuciones||[]).forEach(c=>filas.push([c.simbolo+' cierre anterior → precio',c.cierreAnterior+' → '+c.precio]));
  filas.push(['Intervalo solicitado','2 min'],['Intervalo efectivo',iv.etiqueta]);
  if(iv.fallback&&iv.motivo)filas.push(['Motivo del fallback',iv.motivo]);
  if(tl)filas.push(
    ['Puntos recibidos',String(tl.recibidos)],
    ['Puntos usados',String(tl.usados||s.serie.length)],
    ['Cobertura',tl.cobertura.filter(c=>c.ok).length+' / '+tl.cobertura.length+' posiciones'],
  );
  filas.push(
    ['Primer dato',hora(primero&&primero.t)],
    ['Último dato',hora(ultimo&&ultimo.t)],
    ['Valor último',fmtMoneda(s.actual,s.moneda)],
    ['Hero',fmtMoneda(heroValor,s.moneda)],
    ['Diferencia',fmtMoneda(Math.abs(s.actual-heroValor),s.moneda)],
    ['Fallback',s.notaFallback||'ninguno'],
  );
  el.innerHTML='<div class="s-sub" style="font-weight:700;margin-bottom:8px">Serie 1D</div>'+
    filas.map(([k,val])=>`<div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(k)}</span><strong>${esc(val)}</strong></div>`).join('');
}

// Diagnóstico Yahoo (sección 6 del pedido de corrección): por qué
// pfYahoo no está "ganando" — nunca en la tarjeta principal, solo acá, para
// poder ver el motivo exacto en vez de seguir ajustando a ciegas.
export function renderPfDiagnosticoYahoo(){
  const el=document.getElementById('pfDiagYahoo');
  if(!el||!pfPosicionesCache.length)return;
  const v=obtenerValorActualPortafolio();
  const filas=v.cobertura.map(c=>
    `<div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(c.simbolo)}</span><strong style="color:${c.ok?'var(--green)':'var(--red)'}">${c.ok?'✓':'✗'}</strong></div>`+
    (c.ok?'':`<div class="hint" style="margin:-2px 0 4px">${esc(c.motivo||'')}</div>`)
  ).join('');
  const okCount=v.cobertura.filter(c=>c.ok).length;
  const motivo=v.cobertura.find(c=>!c.ok);
  // Coherencia de caché (sección 10 del pedido de corrección): permite ver
  // de un vistazo si Yahoo está "ganando" con datos del mismo día/snapshot
  // que las posiciones actuales, sin adivinar por qué no.
  const coherencia=[
    ['Día frontend',pfLondonDay()],
    ['Día caché Yahoo',pfYahoo.day||'—'],
    ['Base IBKR actual',pfComputeBaseId()||'—'],
    ['Base IBKR caché Yahoo',pfYahoo.baseId||'—'],
    ['Último fetch Yahoo',pfYahoo.fetchedAt?new Date(pfYahoo.fetchedAt).toLocaleString('es-PE',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'—'],
  ];
  const coherenciaHtml='<div class="s-sub" style="font-weight:700;margin-bottom:8px">Coherencia de caché</div>'+
    coherencia.map(([k,val])=>`<div style="display:flex;justify-content:space-between;gap:12px"><span>${esc(k)}</span><strong>${esc(String(val))}</strong></div>`).join('')+
    '<div style="margin-bottom:10px"></div>';
  el.innerHTML=coherenciaHtml+'<div class="s-sub" style="font-weight:700;margin-bottom:8px">Yahoo</div>'+filas+
    `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:8px"><span>Cobertura</span><strong>${okCount} / ${v.cobertura.length}</strong></div>`+
    `<div style="display:flex;justify-content:space-between;gap:12px"><span>Valor en vivo</span><strong>${v.fuente==='YAHOO'?fmtMoneda(v.valor,'USD'):'No disponible'}</strong></div>`+
    (v.fuente!=='YAHOO'&&motivo?`<p class="hint" style="margin-top:6px">Motivo: ${esc(motivo.motivo||'')} (${esc(motivo.simbolo)})</p>`:'');
}
