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
import {exportarMovimientosCSV, descargarRespaldo} from './modules/backup.js';

[
  'guardar','eliminar','guardarDeuda','guardarAbono','confirmarArchivar',
  'confirmarDesarchivar','guardarEditAbono','eliminarAbono','editarFechaDeuda',
  'guardarPagoTarjeta','guardarPagoTarjetaUSD','pagarSaldoCompleto','limpiarPagoTarjeta',
  'guardarEditPago','confirmarEliminarPago','eliminarPagoTarjeta',
  'guardarTarjetaInline','agregarTarjeta','eliminarTarjeta','guardarMetaPct',
  'cargar'
].forEach(name=>{ window[name]=guardedOnce(window[name]); });
aplicarPreferencias();
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPfYahoo();else startPfYahoo();});
window.addEventListener('pagehide',stopPfYahoo);
window.addEventListener('storage',e=>{if(e.key==='sb_session'){stopPfYahoo();pfYahoo.quotes=[];pfYahoo.lastAttempt=0;pfYahoo.scope='';renderPfYahoo();}});
initializeAccessibility();
document.getElementById('exportCSV')?.addEventListener('click',exportarMovimientosCSV);
document.getElementById('exportBackup')?.addEventListener('click',descargarRespaldo);
bootAuth();
