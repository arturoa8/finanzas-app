// Preferencias y configuracion.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {renderCuentasConfig} from './accounts.js';
import {renderPfModalChart} from './portfolio/portfolio-ui.js';
import {pfHistoricoCache, renderPfChart} from './portfolio/portfolio.js';
import {leerTipoCambio, tcUsdPen} from '../services/exchange-rate.js';
import {toast} from '../ui/toast.js';

const APP_PREFS_KEY='finanzas.appearance.v1';

// Versión publicada. Se muestra en Configuración para saber si el iPhone ya
// usa la última. index.html repite el número en <meta name="version-app">
// (modular-integridad.test.cjs exige que coincidan): si el teléfono guardó
// una página de otra versión que estos módulos, se avisa en vez de ocultarlo.
export const VERSION_APP='2026.10.03.9';

function pintarVersion(){
  const el=document.getElementById('settingsVersion');if(!el)return;
  const pagina=document.querySelector('meta[name="version-app"]')?.content;
  el.textContent='Versión '+VERSION_APP+(pagina&&pagina!==VERSION_APP?' · página '+pagina+': cierra y vuelve a abrir la app para completar la actualización':'');
}

function leerPreferencias(){try{return JSON.parse(localStorage.getItem(APP_PREFS_KEY))||{};}catch(e){return {};}}

export let appPreferences=leerPreferencias();

// Escala vertical de los gráficos del portafolio: 'auto' (rango observado,
// recomendada y por defecto) o 'cero' (siempre desde 0). Las versiones
// anteriores guardaban 'overview'/'detail', que solo afectaban al gráfico de
// una posición; se leen como 'auto' para que nadie quede con la escala plana
// sin haberla elegido con el nuevo significado.
export function escalaGrafico(){return appPreferences.chartScale==='cero'?'cero':'auto';}

export function aplicarPreferencias(){
 const colors={green:'#00d68f',blue:'#7aa2ff',violet:'#c4a2ff'};
 document.documentElement.style.setProperty('--accent',colors[appPreferences.accent]||colors.green);
}

export function abrirConfiguracion(seccion){
 document.getElementById('appAccent').value=appPreferences.accent||'green';
 document.getElementById('appChartScale').value=escalaGrafico();
 const tcEl=document.getElementById('tcUsdPen');
 if(tcEl){
  if(tcUsdPen>0)tcEl.value=tcUsdPen;
  // Si aún no se leyó de la base, completarlo sin pisar lo que se esté escribiendo.
  leerTipoCambio().then(()=>{if(tcUsdPen>0&&document.activeElement!==tcEl&&!tcEl.value)tcEl.value=tcUsdPen;});
 }
 renderCuentasConfig();
 pintarVersion();
 document.getElementById('settingsModal').classList.add('active');
 if(seccion==='cuentas'){
  const s=document.getElementById('cuentasConfigSection');
  if(s)setTimeout(()=>s.scrollIntoView({block:'start',behavior:'smooth'}),60);
 }
}

export function cerrarConfiguracion(){document.getElementById('settingsModal').classList.remove('active');}

export function guardarPreferencias(){
 appPreferences={accent:document.getElementById('appAccent').value,chartScale:document.getElementById('appChartScale').value};
 aplicarPreferencias();
 try{localStorage.setItem(APP_PREFS_KEY,JSON.stringify(appPreferences));}catch(e){toast('Preferencia aplicada; este navegador no permite guardarla','error');}
 if(pfHistoricoCache.length)renderPfChart();
 if(document.getElementById('pfPosModal').classList.contains('active'))renderPfModalChart();
}
