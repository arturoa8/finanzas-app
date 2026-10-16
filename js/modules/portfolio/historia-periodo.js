// Qué historia de Yahoo usa cada período del gráfico del portafolio.
//
// 1S y 1M tienen su propia historia (velas de 5 y 15 min). Los demás períodos
// (6M, AIF, 1A, Todo, Desde) usan velas más gruesas según CUÁNTO tiempo abarcan
// de verdad: con 6 semanas de cuenta se ve igual de detallado que el 1M, y a
// medida que la cuenta crece las velas pasan a 30 min y luego a 1 hora, para
// que la curva no se vuelva una nube de puntos. Yahoo solo ofrece velas
// intradía de hasta 60 días (5-30 min) y de hasta 2 años (1 h): pasado eso se
// vuelve a los cierres diarios de IBKR.
//
// Las claves son las que entiende la función cotizaciones-yahoo (?historia=).
export const PF_HISTORIAS=Object.freeze({
  '1S':{dias:7,etiqueta:'5 min'},
  '1M':{dias:30,etiqueta:'15 min'},
  '2M':{dias:58,etiqueta:'30 min'},
  '6M':{dias:180,etiqueta:'1 h'},
  '1A':{dias:365,etiqueta:'1 h'},
  '2A':{dias:728,etiqueta:'1 h'},
});

const ESCALONES=['1M','2M','6M','1A','2A'];

const diasEntreISO=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);

// Clave de historia para un período, o null si no hay detalle intradía
// (1D tiene el suyo; un período de más de 2 años usa los cierres diarios).
// primeraISO: primer día con valor dentro del período; hoyISO: hoy.
export function pfClaveHistoria(periodo,primeraISO,hoyISO){
  if(periodo==='1D')return null;
  if(periodo==='1S'||periodo==='1M')return periodo;
  if(!primeraISO||!hoyISO)return null;
  // +1: la sesión previa al primer día es la base del primer tramo.
  const abarca=diasEntreISO(primeraISO,hoyISO)+1;
  return ESCALONES.find(c=>PF_HISTORIAS[c].dias>=abarca)||null;
}

// Cuántos días de posiciones por fecha hacen falta para valorar cualquier
// período: el de la historia más larga que pueda usarse, más un margen para
// el cierre anterior a la primera sesión.
export function pfDiasPosiciones(claveTodo){
  return Math.max(45,PF_HISTORIAS[claveTodo||'2A'].dias+15);
}
