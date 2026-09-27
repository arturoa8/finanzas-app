// Fechas: parseo, etiquetas y aritmetica de calendario.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

export function pf(f){if(!f)return new Date();if(f instanceof Date)return f;if(typeof f==='string'){if(f.includes('/')){const[d]=f.split(',');const[a,b,c]=d.trim().split('/');return new Date(+c,+b-1,+a);}if(/^\d{4}-\d{2}-\d{2}$/.test(f)){const [y,m,d]=f.split('-').map(Number);return new Date(y,m-1,d);}return new Date(f);}return new Date(f);}

function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}

export function dayLabel(d){
  const hoy=new Date();const ayer=new Date();ayer.setDate(hoy.getDate()-1);const ant=new Date();ant.setDate(hoy.getDate()-2);
  if(sameDay(d,hoy))return'hoy';
  if(sameDay(d,ayer))return'ayer';
  if(sameDay(d,ant))return'anteayer';
  const dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0'),yy=String(d.getFullYear()).slice(-2);
  return dd+'/'+mm+'/'+yy;
}

export function toDateInput(v){
  if(!v)return '';
  try{const d=pf(v);if(isNaN(d.getTime()))return '';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  catch(e){return '';}
}

// Peru es UTC-5 todo el año (sin horario de verano).
export function buildFechaISO(yy,mm,dd,timePart){
  const m=String(timePart).match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i);
  let hh=12,min=0;
  if(m){
    hh=parseInt(m[1],10);min=parseInt(m[2],10);
    const ampm=m[3].toLowerCase();
    if(ampm==='p'&&hh!==12)hh+=12;
    if(ampm==='a'&&hh===12)hh=0;
  }
  return new Date(Date.UTC(+yy,+mm-1,+dd,hh+5,min)).toISOString();
}

export function parseDateOnly(s){
  if(!s)return null;
  const[y,m,d]=String(s).split('-').map(Number);
  if(!y||!m||!d)return null;
  return new Date(y,m-1,d);
}

export function hoyLocal(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate());}

export function diasEntre(a,b){return Math.round((a-b)/86400000);}

export function addMonths(date,months){return new Date(date.getFullYear(),date.getMonth()+months,date.getDate());}

export function fmtDateShort(d){return d.toLocaleDateString('es-PE',{day:'numeric',month:'short'});}

export function fmtDateLong(d){return d.toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric'});}

export function endOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);}

export function getDaysDiff(from,to){
  const a=new Date(from.getFullYear(),from.getMonth(),from.getDate());
  const b=new Date(to.getFullYear(),to.getMonth(),to.getDate());
  return Math.ceil((b-a)/(1000*60*60*24));
}

function txDateParts(t){const d=pf(t[0]);return {day:d.getDate(),month:d.getMonth(),year:d.getFullYear()};}

export function hoyISO(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

export function formatISODate(iso){
  if(!iso)return '—';
  const s=String(iso).slice(0,10);
  const [y,m,d]=s.split('-').map(Number);
  if(!y||!m||!d)return '—';
  return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
}
