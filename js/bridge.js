// Puente hacia los handlers inline del HTML.
//
// Un modulo ES no crea variables globales, asi que las 103 funciones que se
// invocan desde atributos onclick/onchange dejarian de existir para el
// navegador. Se exponen aqui, en un unico sitio y de forma explicita, en vez
// de repartir addEventListener por treinta modulos: el HTML no se toca y
// migrar a listeners se puede hacer despues, pantalla por pantalla.
//
// OJO: no basta con mirar index.html. La mayoria de estos handlers los genera
// el propio JS dentro de template literals (renderCuentasConfig,
// renderCardTxList, renderHistorialAbonos...). La lista se obtiene escaneando
// el HTML *y* todos los modulos; tests/modular-equivalencia.test.cjs repite ese
// escaneo y falla si alguna se queda fuera.
import {agregarCuenta, archivarCuenta, cambiarCuentaSelect, renombrarCuenta} from './modules/accounts.js';
import {setAnPeriodo} from './modules/analytics.js';
import {agregarCategoria, cancelarCategoria, confirmarEliminarCategoria, editarCategoria, eliminarCategoria, guardarCategoria} from './modules/categories.js';
import {abrirCardDetail, abrirCardTxDetail, cerrarCardDetail, cerrarCardTxDetail, moverConsumoCiclo, setCardPageTab} from './modules/cards/cards-ui.js';
import {abrirLineasCredito, agregarTarjeta, cerrarLineasCredito, eliminarTarjeta, guardarMetaPct, guardarTarjetaInline, prepararVisaQore} from './modules/cards/config.js';
import {abrirCardCyclePicker, aplicarCardCyclePicker, cambiarAnioCardPicker, cerrarCardCyclePicker, goNextCardCycle, seleccionarCardCycleActual, seleccionarCardCycleMes} from './modules/cards/cycles.js';
import {abrirPagoTarjeta, cerrarPagoTarjeta, completarMontoPagoTarjeta, seleccionarTarjetaPago, setMonedaPagoTarjeta, actualizarConversionCreditoUSD, actualizarPagoUSD, cerrarEditPago, confirmarEliminarPago, editarPagoTarjeta, eliminarPagoTarjeta, guardarConversionCreditoUSD, guardarEditPago, guardarPagoTarjeta, guardarPagoTarjetaUSD, limpiarPagoTarjeta, pagarSaldoCompleto} from './modules/cards/payments.js';
import {actualizarEquivalente, cambiarMonedaTx, sincronizarCamposMoneda, tcEditadoAMano, toggleVistaUSD} from './modules/currencies.js';
import {filtrarBusqueda, filtrarCuentaMovimientos, filtrarPorCat, quitarFiltro, setModoBalance, toggleMovimientosUSD, togglePillTipo, toggleSearch} from './modules/dashboard.js';
import {abonarTodo, abrirEditAbono, abrirHistorialAbonos, abrirModalAbono, abrirModalArchivar, abrirModalDeuda, abrirModalDeudaEdit, cerrarEditAbono, cerrarHistorialAbonos, cerrarModalAbono, cerrarModalArchivar, cerrarModalDeuda, confirmarArchivar, confirmarDesarchivar, editarFechaDeuda, eliminarAbono, guardarAbono, guardarDeuda, guardarEditAbono, setDT, setDeudaTipo} from './modules/debts.js';
import {pfMarcarCosto, togglePfCostosEditor} from './modules/portfolio/capital.js';
import {togglePfDiag} from './modules/portfolio/diagnostics.js';
import {pfModeloDia, togglePfMoneda} from './modules/portfolio/hero.js';
import {renderPfContribuciones} from './modules/portfolio/intraday.js';
import {cerrarPfPosModal, pfRefrescarTodo, renderPfPosiciones, setPfModalDesde, setPfModalPeriodo} from './modules/portfolio/portfolio-ui.js';
import {setPfDesde, setPfPeriodo, setPfVista} from './modules/portfolio/portfolio.js';
import {setPfRiesgoPeriodo, setPfSubvista} from './modules/portfolio/risk.js';
import {abrirNuevoPresupuesto, cambiarPresInicio, cambiarPresRepetir, cerrarEliminarPresupuesto, cerrarPresupuestoForm, confirmarEliminarPresupuesto, editarPresupuesto, editarPresupuestoExistente, eliminarPresupuesto, guardarPresupuesto, irPresPeriodoActual, moverPresPeriodo, seleccionarPresCategoria, setPresAlcance, setPresAmbito, setPresTipo, setPresVista} from './modules/presupuestos.js';
import {actualizarDiferenciaBanco, toggleConciliar} from './modules/reconciliation.js';
import {abrirConfiguracion, cerrarConfiguracion, guardarPreferencias} from './modules/settings.js';
import {cargar, cerrarM, editarTx, eliminar, getTxRow, guardar, seleccionarCat, seleccionarGastoReembolso, setTipo} from './modules/transactions.js';
import {signOut, submitAuth, toggleAuthMode} from './services/auth.js';
import {guardarTipoCambio} from './services/exchange-rate.js';
import {setChart} from './ui/charts.js';
import {abrirConfiguracionDesdeMas, abrirDesdeMas, abrirMas, abrirMesPicker, alternarMovimientosInicio, aplicarMesPicker, cambiarAnioPicker, cerrarMas, cerrarMesPicker, handleFab, seleccionarMesPicker, seleccionarTodoTiempo, setPg} from './ui/navigation.js';
import {ocultarToast} from './ui/toast.js';
import {esc, escHtml} from './utils/formatters.js';

export const expuesto={alternarMovimientosInicio, abrirConfiguracionDesdeMas, abrirDesdeMas, abrirMas, abrirMesPicker, cerrarMas, abrirNuevoPresupuesto, cambiarPresInicio, cambiarPresRepetir, cerrarEliminarPresupuesto, cerrarPresupuestoForm, confirmarEliminarPresupuesto, editarPresupuesto, editarPresupuestoExistente, eliminarPresupuesto, guardarPresupuesto, irPresPeriodoActual, moverPresPeriodo, seleccionarPresCategoria, setPresAlcance, setPresAmbito, setPresTipo, setPresVista, agregarCategoria, cancelarCategoria, confirmarEliminarCategoria, editarCategoria, eliminarCategoria, guardarCategoria, abrirPagoTarjeta, cerrarPagoTarjeta, completarMontoPagoTarjeta, seleccionarTarjetaPago, setMonedaPagoTarjeta, actualizarConversionCreditoUSD,guardarConversionCreditoUSD,abonarTodo, abrirCardCyclePicker, abrirCardDetail, abrirCardTxDetail, abrirConfiguracion, abrirEditAbono, abrirHistorialAbonos, abrirLineasCredito, abrirModalAbono, abrirModalArchivar, abrirModalDeuda, abrirModalDeudaEdit, actualizarDiferenciaBanco, actualizarEquivalente, actualizarPagoUSD, agregarCuenta, agregarTarjeta, aplicarCardCyclePicker, aplicarMesPicker, archivarCuenta, cambiarAnioCardPicker, cambiarAnioPicker, cambiarCuentaSelect, cambiarMonedaTx, cargar, cerrarCardCyclePicker, cerrarCardDetail, cerrarCardTxDetail, cerrarConfiguracion, cerrarEditAbono, cerrarEditPago, cerrarHistorialAbonos, cerrarLineasCredito, cerrarM, cerrarMesPicker, cerrarModalAbono, cerrarModalArchivar, cerrarModalDeuda, cerrarPfPosModal, confirmarArchivar, confirmarDesarchivar, confirmarEliminarPago, editarFechaDeuda, editarPagoTarjeta, editarTx, eliminar, eliminarAbono, eliminarPagoTarjeta, eliminarTarjeta, esc, escHtml, filtrarBusqueda, filtrarCuentaMovimientos, filtrarPorCat, getTxRow, goNextCardCycle, guardar, guardarAbono, guardarDeuda, guardarEditAbono, guardarEditPago, guardarMetaPct, guardarPagoTarjeta, guardarPagoTarjetaUSD, guardarPreferencias, guardarTarjetaInline, guardarTipoCambio, handleFab, limpiarPagoTarjeta, moverConsumoCiclo, ocultarToast, pagarSaldoCompleto, pfMarcarCosto, pfModeloDia, pfRefrescarTodo, prepararVisaQore, quitarFiltro, renderPfContribuciones, renderPfPosiciones, renombrarCuenta, seleccionarCardCycleActual, seleccionarCardCycleMes, seleccionarCat, seleccionarGastoReembolso, seleccionarMesPicker, seleccionarTodoTiempo, setAnPeriodo, setCardPageTab, setChart, setDT, setDeudaTipo, setModoBalance, setPfDesde, setPfModalDesde, setPfModalPeriodo, setPfPeriodo, setPfRiesgoPeriodo, setPfSubvista, setPfVista, setPg, setTipo, signOut, sincronizarCamposMoneda, submitAuth, tcEditadoAMano, toggleAuthMode, toggleConciliar, togglePfCostosEditor, togglePfDiag, togglePfMoneda, toggleMovimientosUSD, togglePillTipo, toggleSearch, toggleVistaUSD};
for(const [nombre,fn] of Object.entries(expuesto)) window[nombre]=fn;
