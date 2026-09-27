// Escalas y ejes de los graficos del portafolio. Funciones puras: no leen el
// DOM ni el estado de la app, solo transforman numeros. Las usan
// construirGraficoIntradia (grafico principal, todos los periodos) y
// construirLineChartSVG (modal de posicion), para que ambos escalen igual.
//
// Nada de esto altera datos ni rentabilidades: solo decide que parte del eje
// se ve y donde van las marcas.

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

// Paso "bonito" (1, 2, 2.5 o 5 × 10^k) para unas `objetivo` divisiones.
export function pasoBonito(rango,objetivo=4){
  if(!(rango>0))return 1;
  const bruto=rango/objetivo,exp=Math.floor(Math.log10(bruto)),base=10**exp,f=bruto/base;
  const m=f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10;
  return m*base;
}

// Marcas del eje Y: multiplos del paso bonito que caen dentro de [lo,hi].
// Entre 4 y 6 niveles (se prueba un objetivo menor si salen de mas). Los
// valores se redondean al paso para no arrastrar errores de coma flotante.
export function ticksY(lo,hi){
  if(!(hi>lo))return{paso:1,ticks:[lo]};
  // Se prefieren 4–5 niveles; luego 3 con un paso más redondo (2%, 3%, 4%
  // antes que seis niveles de 0.5%), y 6 como último recurso. Ej.:
  // 5,810–5,975 → 5,850 · 5,900 · 5,950 (25 daría 7 niveles).
  const candidatos=[3,4,5,6,7,8].map(objetivo=>{
    const paso=pasoBonito(hi-lo,objetivo),dec=decimalesDePaso(paso);
    const ticks=[];
    for(let v=Math.ceil(lo/paso)*paso;v<=hi+paso*1e-9;v+=paso)ticks.push(+v.toFixed(dec));
    return{paso,ticks};
  });
  return candidatos.find(c=>c.ticks.length>=4&&c.ticks.length<=5)
    ||candidatos.find(c=>c.ticks.length===3)
    ||candidatos.find(c=>c.ticks.length===6)
    ||candidatos.reduce((a,b)=>Math.abs(b.ticks.length-5)<Math.abs(a.ticks.length-5)?b:a);
}

export function decimalesDePaso(paso){
  if(!(paso>0))return 0;
  // 2.5 necesita un decimal; 0.25, dos; 50 o 1, ninguno.
  for(let d=0;d<=6;d++)if(Math.abs(Math.round(paso*10**d)-paso*10**d)<1e-7)return d;
  return 6;
}

// Texto de una marca del eje Y. unidad '%' → "+2%", "0%", "−1.5%"; si no,
// importe con separador de miles y el prefijo de moneda que se pase.
export function textoTickY(v,paso,{unidad='',prefijo=''}={}){
  const dec=decimalesDePaso(paso);
  const abs=Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  if(unidad==='%'){const s=Math.abs(v)<paso*1e-6?'':v>0?'+':'−';return s+abs+'%';}
  return(v<0?'−':'')+prefijo+abs;
}

// ── Eje X por calendario ────────────────────────────────────────────────────
// Marcas en fronteras reales de tiempo (horas en punto, medianoche, primero
// de mes, año nuevo), no en posiciones de indice: asi 1S muestra dias, 1M
// fechas repartidas, 6M/AIF/1A meses y Todo meses o años segun la longitud.
const H=3600e3,D=24*H;

// Mismo idioma que el resto de fechas de la app (es-PE: "set", no "sep").
function mesCorto(d){return d.toLocaleDateString('es-PE',{month:'short'}).replace('.','').toLowerCase();}

// soloFechas: la serie es de cierres diarios (nunca marcas de hora, aunque
// solo abarque dos días, como el 1D de respaldo con dos cierres IBKR).
export function ticksTiempo(t0,tn,maximo=5,{soloFechas=false}={}){
  const span=tn-t0;
  if(!(span>0))return[];
  const dentro=t=>t>=t0&&t<=tn;
  const elegir=(pasos,generar)=>{
    for(const p of pasos){const ts=generar(p);if(ts.length<=maximo&&ts.length>=2)return ts;}
    return generar(pasos[pasos.length-1]).slice(0,maximo);
  };
  if(span<=2*D&&!soloFechas){
    return elegir([1,2,3,4,6,12],h=>{
      const out=[],d=new Date(t0);d.setMinutes(0,0,0);if(+d<t0)d.setHours(d.getHours()+1);
      while(+d<=tn){if(d.getHours()%h===0)out.push({t:+d,texto:d.toLocaleTimeString('es-PE',{hour:'numeric'})});d.setHours(d.getHours()+1);}
      return out;
    });
  }
  const diaTexto=d=>d.getDate()+' '+mesCorto(d);
  if(span<=75*D){
    return elegir([1,2,3,7,14],n=>{
      const out=[],d=new Date(t0);d.setHours(0,0,0,0);if(+d<t0)d.setDate(d.getDate()+1);
      // Paso semanal: anclado en lunes para que las fechas sean comparables.
      if(n>=7)while(d.getDay()!==1)d.setDate(d.getDate()+1);
      while(+d<=tn){out.push({t:+d,texto:diaTexto(d)});d.setDate(d.getDate()+n);}
      return out;
    });
  }
  const variosAnios=new Date(t0).getFullYear()!==new Date(tn).getFullYear();
  if(span<=3*366*D){
    return elegir([1,2,3,6],n=>{
      const out=[],d=new Date(t0);d.setHours(0,0,0,0);d.setDate(1);if(+d<t0)d.setMonth(d.getMonth()+1);
      while(d.getMonth()%n!==0)d.setMonth(d.getMonth()+1);
      while(+d<=tn){
        const texto=variosAnios&&(d.getMonth()===0||!out.length)?mesCorto(d)+' '+String(d.getFullYear()).slice(2):mesCorto(d);
        out.push({t:+d,texto});d.setMonth(d.getMonth()+n);
      }
      return out;
    });
  }
  return elegir([1,2,5,10],n=>{
    const out=[],d=new Date(new Date(t0).getFullYear(),0,1);if(+d<t0)d.setFullYear(d.getFullYear()+1);
    while(d.getFullYear()%n!==0)d.setFullYear(d.getFullYear()+1);
    while(+d<=tn){out.push({t:+d,texto:String(d.getFullYear())});d.setFullYear(d.getFullYear()+n);}
    return out;
  }).filter(x=>dentro(x.t));
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
