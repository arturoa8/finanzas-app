// Arranque de la aplicacion.
//
// Reproduce, en el mismo orden, lo que el monolito ejecutaba al final de su
// <script>: aplicar preferencias, enganchar los eventos de ciclo de vida de
// Yahoo, preparar accesibilidad y pedir sesion.
//
// bridge.js se importa el primero para que las funciones esten en window antes
// de que el usuario pueda tocar nada.
import './bridge.js';
import {aplicarPreferencias} from './modules/settings.js';
import {bootAuth} from './services/auth.js';
import {pfYahoo, renderPfYahoo, startPfYahoo, stopPfYahoo} from './services/market-data.js';
import {guardedOnce} from './utils/async.js';
import {initializeAccessibility} from './utils/dom.js';
import {initializeSheetDrag} from './ui/sheet-drag.js';
import {initializeSegmentedThumb} from './ui/segmented-thumb.js';
import {exportarMovimientosCSV, descargarRespaldo} from './modules/backup.js';
import {detenerPrecargaPortafolio, limpiarCachePortafolio, precargarPortafolio} from './modules/portfolio/portfolio.js';

[
  'guardar','eliminar','guardarDeuda','guardarAbono','confirmarArchivar',
  'confirmarDesarchivar','guardarEditAbono','eliminarAbono','editarFechaDeuda',
  'guardarPagoTarjeta','guardarPagoTarjetaUSD','pagarSaldoCompleto','limpiarPagoTarjeta',
  'guardarEditPago','confirmarEliminarPago','eliminarPagoTarjeta',
  'guardarTarjetaInline','agregarTarjeta','eliminarTarjeta','guardarMetaPct',
  'cargar'
].forEach(name=>{ window[name]=guardedOnce(window[name]); });
aplicarPreferencias();
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){detenerPrecargaPortafolio();stopPfYahoo();}
  else{precargarPortafolio().catch(()=>{});startPfYahoo();}
});
window.addEventListener('pagehide',()=>{detenerPrecargaPortafolio();stopPfYahoo();});
window.addEventListener('storage',e=>{if(e.key==='sb_session'){
  // Un cambio de cuenta en otra pestaña requiere preparar el estado desde
  // cero. La renovación normal del token de la misma cuenta no recarga.
  try{
    const antes=JSON.parse(e.oldValue||'null'),ahora=JSON.parse(e.newValue||'null');
    if(antes?.user_id&&antes.user_id===ahora?.user_id)return;
  }catch{}
  stopPfYahoo();limpiarCachePortafolio();pfYahoo.quotes=[];pfYahoo.lastAttempt=0;pfYahoo.scope='';renderPfYahoo();location.reload();
}});
initializeAccessibility();
initializeSheetDrag();
initializeSegmentedThumb();
document.getElementById('exportCSV')?.addEventListener('click',exportarMovimientosCSV);
document.getElementById('exportBackup')?.addEventListener('click',descargarRespaldo);
bootAuth();
