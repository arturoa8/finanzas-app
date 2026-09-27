// Escala vertical y downsampling de los graficos del portafolio. Funciones
// puras: no leen el DOM ni el estado de la app, solo transforman numeros. Las usan
// construirGraficoIntradia (grafico principal, todos los periodos) y
// construirLineChartSVG (modal de posicion), para que ambos escalen igual.
//
// Nada de esto altera datos ni rentabilidades: solo decide que parte del eje
// se ve y que puntos se dibujan.

// Dominio vertical visible.
//  · 'auto': min–max observado + un margen, con un rango minimo para que una
//    serie casi plana no se vea como una montaña (no exagerar ruido).
//  · 'cero': el eje incluye siempre el 0, para ver la magnitud absoluta.
// rangoMinimo va en las mismas unidades que los valores (pp o dinero).
export function dominioY(valores,{modo='auto',rangoMinimo=0,margen=0.08}={}){
  const vs=valores.filter(Number.isFinite);
  if(!vs.length)return[0,1];
  let min=Math.min(...vs),max=Math.max(...vs);
  if(modo==='cero'){min=Math.min(0,min);max=Math.max(0,max);}
  let rango=max-min;
  // Serie plana (o casi): se abre alrededor del centro hasta el rango minimo.
  // Si todo es 0 y no hay minimo, un rango simbolico evita dividir por cero.
  const minimo=Math.max(rangoMinimo,rango>0?0:(Math.abs(max)*0.01||1));
  if(rango<minimo){
    // En 'cero' el 0 se queda como borde y se estira el otro lado; en 'auto'
    // se abre alrededor del centro.
    if(modo==='cero'&&min===0)max=minimo;
    else if(modo==='cero'&&max===0)min=-minimo;
    else{const centro=(min+max)/2;min=centro-minimo/2;max=centro+minimo/2;}
    rango=max-min;
  }
  const pad=rango*margen;
  // En 'cero' el 0 es el borde: sin margen por ese lado.
  const lo=modo==='cero'&&min===0?0:min-pad;
  const hi=modo==='cero'&&max===0?0:max+pad;
  return[lo,hi];
}

// ── Downsampling que conserva la forma: Largest-Triangle-Three-Buckets ────
// Solo se aplica si hay mas puntos que `umbral`. Siempre conserva el primero
// y el ultimo, y en cada tramo el punto que forma el triangulo mas grande con
// sus vecinos: los picos y los valles sobreviven, al contrario que "uno de
// cada N". Devuelve puntos REALES (subconjunto), nunca interpolados.
export function lttb(puntos,umbral=500,xDe=p=>p.t,yDe=p=>p.valor){
  const n=puntos.length;
  if(umbral>=n||umbral<3)return puntos;
  const out=[puntos[0]],tam=(n-2)/(umbral-2);
  let a=0;
  for(let i=0;i<umbral-2;i++){
    const ini=Math.floor((i+1)*tam)+1,fin=Math.min(Math.floor((i+2)*tam)+1,n);
    let mx=0,my=0;const cnt=fin-ini||1;
    for(let j=ini;j<fin;j++){mx+=xDe(puntos[j]);my+=yDe(puntos[j]);}
    mx/=cnt;my/=cnt;
    const r0=Math.floor(i*tam)+1,r1=Math.floor((i+1)*tam)+1;
    const ax=xDe(puntos[a]),ay=yDe(puntos[a]);
    let maxArea=-1,elegido=r0;
    for(let j=r0;j<r1;j++){
      const area=Math.abs((ax-mx)*(yDe(puntos[j])-ay)-(ax-xDe(puntos[j]))*(my-ay));
      if(area>maxArea){maxArea=area;elegido=j;}
    }
    out.push(puntos[elegido]);a=elegido;
  }
  out.push(puntos[n-1]);
  return out;
}
