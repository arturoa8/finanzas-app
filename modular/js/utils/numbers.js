// Aritmetica exacta de importes.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

// Redondeo a céntimos igual que Postgres: half away from zero.
// No se usa Math.round porque 1.005*100 en binario es 100.49999999999999, y
// daría 1.00 donde el servidor da 1.01. Trabajando con enteros grandes el
// resultado es exacto, así que lo que se previsualiza coincide siempre con lo
// que el servidor termina guardando. Se lee el texto, no el float.
function aEntero(valor,decimales){
  const m=/^(-?)(\d*)(?:[.,](\d*))?$/.exec(String(valor==null?'':valor).trim());
  if(!m||(!m[2]&&!m[3]))return null;
  let n=BigInt((m[2]||'0')+(m[3]||'').slice(0,decimales).padEnd(decimales,'0'));
  const sobrante=(m[3]||'').slice(decimales);
  if(sobrante&&sobrante[0]>='5')n+=1n;
  return (m[1]==='-'?-1n:1n)*n;
}

export function equivalenteSoles(montoOriginal,tc){
  const mo=aEntero(montoOriginal,2),t=aEntero(tc,8);
  if(mo===null||t===null)return null;
  const p=mo*t,neg=p<0n,abs=neg?-p:p;
  const centimos=(abs+50000000n)/100000000n;
  return Number(neg?-centimos:centimos)/100;
}

// La distribución usa exclusivamente las valoraciones oficiales de IBKR.
export function pfNumber(value){return value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);}
