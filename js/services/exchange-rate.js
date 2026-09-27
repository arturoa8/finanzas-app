// Tipo de cambio configurado y de mercado.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cargarPatrimonio, patrimonio} from '../modules/dashboard.js';
import {sbFetch, sbSelect} from './supabase.js';
import {toast} from '../ui/toast.js';
import {hoyISO} from '../utils/dates.js';

export let tcUsdPen=null;

// Tipo de cambio de mercado (referencia, no el de tu banco). Una consulta por
// día como mucho: se guarda en el navegador y, si falla la red, se usa el último
// que hubo. Si no hay ninguno, el formulario cae al tipo de cambio de
// Configuración y, si tampoco existe, se escribe a mano.
export let tcMercado=null,tcMercadoFecha='';

export async function cargarTcMercado(){
  const hoy=hoyISO();
  try{
    const c=JSON.parse(localStorage.getItem('tc_mercado')||'null');
    if(c&&c.tc>0){tcMercado=c.tc;tcMercadoFecha=c.fecha;if(c.fecha===hoy)return;}
  }catch(e){}
  try{
    const r=await fetch('https://open.er-api.com/v6/latest/USD',{signal:typeof AbortSignal!=='undefined'&&AbortSignal.timeout?AbortSignal.timeout(6000):undefined});
    const j=await r.json(),v=Number(j&&j.rates&&j.rates.PEN);
    // Cota de cordura: un dato absurdo es peor que ninguno.
    if(j&&j.result==='success'&&v>1&&v<10){
      tcMercado=Math.round(v*1e6)/1e6;tcMercadoFecha=hoy;
      try{localStorage.setItem('tc_mercado',JSON.stringify({tc:tcMercado,fecha:hoy}));}catch(e){}
    }
  }catch(e){}
}

// ── Patrimonio y tipo de cambio ──────────────────────────────────────────
export async function leerTipoCambio(){
 try{
  const rows=await sbSelect('ajustes_app','?select=clave,valor&clave=eq.tc_usd_pen');
  tcUsdPen=rows&&rows[0]&&Number(rows[0].valor)>0?Number(rows[0].valor):null;
  return {ok:true,valor:tcUsdPen};
 }catch(e){tcUsdPen=null;return {ok:false,valor:null};}
}

export async function guardarTipoCambio(){
 const v=Number(document.getElementById('tcUsdPen').value);
 if(!Number.isFinite(v)||v<=0){toast('Escribe un tipo de cambio mayor que cero','error');return;}
 try{
  await sbFetch('ajustes_app',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({clave:'tc_usd_pen',valor:v,actualizado_en:new Date().toISOString()})});
  tcUsdPen=v;
  toast('Tipo de cambio guardado','success');
  if(patrimonio.estado!=='idle')await cargarPatrimonio(true);
 }catch(e){toast(/schema cache|does not exist|relation/i.test(e.message||'')?'Falta aplicar el SQL de ajustes en Supabase.':(e.message||'Error al guardar el tipo de cambio'),'error');}
}
