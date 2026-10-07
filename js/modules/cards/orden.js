// Orden de las tarjetas de crédito: preferencia de este navegador.
// Módulo hoja (solo depende de utilidades) para que config.js pueda ordenar
// sin crear un ciclo con la pantalla de Configuración.
import {norm} from '../../utils/formatters.js';

export const CARDS_ORDER_KEY='finanzas.cards-order.v1';

let ordenVolatil=null;

const limpiar=valor=>{
  const vistos=new Set(),orden=[];
  if(Array.isArray(valor))for(const nombre of valor){
    const clave=norm(String(nombre??''));
    if(!clave||vistos.has(clave))continue;
    vistos.add(clave);orden.push(clave);
  }
  return orden;
};

// Claves normalizadas (norm) de las tarjetas, en el orden elegido.
export function getOrdenTarjetas(){
  if(ordenVolatil)return [...ordenVolatil];
  try{return limpiar(JSON.parse(localStorage.getItem(CARDS_ORDER_KEY)||'null'));}
  catch{return [];}
}

export function guardarOrdenTarjetas(cuentas){
  const orden=limpiar(cuentas);
  try{
    if(orden.length)localStorage.setItem(CARDS_ORDER_KEY,JSON.stringify(orden));
    else localStorage.removeItem(CARDS_ORDER_KEY);
    ordenVolatil=null;
    return {guardado:true,orden};
  }catch{
    ordenVolatil=orden;
    return {guardado:false,orden};
  }
}

// Las tarjetas nuevas o sin posición guardada van al final, en su orden natural.
export function ordenarTarjetas(tarjetas){
  const orden=getOrdenTarjetas();
  if(!orden.length)return tarjetas;
  const posicion=new Map(orden.map((clave,i)=>[clave,i]));
  return tarjetas
    .map((tarjeta,i)=>({tarjeta,i,p:posicion.has(norm(tarjeta.cuenta))?posicion.get(norm(tarjeta.cuenta)):Infinity}))
    .sort((a,b)=>a.p-b.p||a.i-b.i)
    .map(x=>x.tarjeta);
}

// Mantiene la posición cuando una tarjeta cambia de nombre.
export function renombrarEnOrden(anterior,nueva){
  const orden=getOrdenTarjetas(),antes=norm(anterior);
  if(!orden.includes(antes))return;
  guardarOrdenTarjetas(orden.map(clave=>clave===antes?nueva:clave));
}

export function quitarDeOrden(cuenta){
  const orden=getOrdenTarjetas(),clave=norm(cuenta);
  if(orden.includes(clave))guardarOrdenTarjetas(orden.filter(x=>x!==clave));
}
