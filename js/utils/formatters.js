// Formato de importes, texto y emojis de categoria.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

export const meses=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export const mesesC=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export const EMOJIS={
  'Auto':{e:'🚗',c:'rgba(255,107,107,0.18)',h:'#ff6b6b'},
  'Comer afuera':{e:'🍔',c:'rgba(255,184,77,0.18)',h:'#ffb84d'},
  'Compras':{e:'🛍️',c:'rgba(124,106,255,0.18)',h:'#7c6aff'},
  'Estudios':{e:'📚',c:'rgba(255,217,61,0.18)',h:'#ffd93d'},
  'Inversiones':{e:'📈',c:'rgba(0,214,143,0.18)',h:'#00d68f'},
  'Lujo':{e:'💎',c:'rgba(116,209,234,0.22)',h:'#74d1ea'},
  'Suscripciones':{e:'💳',c:'rgba(255,59,107,0.18)',h:'#ff3b6b'},
  'Tecnología':{e:'💻',c:'rgba(167,139,250,0.18)',h:'#a78bfa'},
  'Ocio':{e:'🎮',c:'rgba(255,106,212,0.18)',h:'#ff6ad4'},
  'Salario':{e:'💵',c:'rgba(0,214,143,0.18)',h:'#00d68f'},
  'Beca':{e:'🎓',c:'rgba(106,255,212,0.18)',h:'#6affd4'},
  'Otros ingresos':{e:'💰',c:'rgba(255,217,61,0.18)',h:'#ffd93d'},
  'Transferencias':{e:'↔',c:'rgba(161,161,170,0.18)',h:'#a1a1aa'}
};

// Quita acentos, lowercase, trim — para que "Comer afuéra" matchee con "Comer afuera"
export const norm=s=>(s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export const escHtml=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const EMOJI_NORM={};

export const getEmoji=cat=>{
  if(!cat)return{e:'💼',c:'rgba(161,161,170,0.18)',h:'#a1a1aa'};
  if(EMOJIS[cat])return EMOJIS[cat];
  const f=EMOJI_NORM[norm(cat)];
  if(f)return EMOJIS[f];
  // Misma familia 📈 para 'Inversión <cuenta>' y 'Retiro <cuenta>', sin tocar
  // la categoría histórica 'Inversiones' ni el resto de nombres.
  const n=norm(cat);
  if(n.startsWith('inversion ')||n.startsWith('retiro '))return EMOJIS['Inversiones'];
  if(n==='compra dolares'||n==='venta de dolares')return EMOJIS['Transferencias'];
  return {e:'💼',c:'rgba(161,161,170,0.18)',h:'#a1a1aa'};
};

// Devuelve el nombre limpio (sin tildes raras), p.ej. "Comer afuéra" -> "Comer afuera"
export const cleanName=cat=>{
  if(!cat)return 'Sin categoría';
  if(EMOJIS[cat])return cat;
  const f=EMOJI_NORM[norm(cat)];
  return f||cat;
};

export const fmt=n=>'S/ '+Number(n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});

export const fmtN=n=>Number(n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});

export const fmtC=n=>{const x=Number(n||0);return Math.abs(x)>=1000?'S/ '+(x/1000).toFixed(1)+'k':'S/ '+x.toFixed(0);};

export const fmtD=n=>'S/ '+Number(n||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});

export function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function fmtMoneda(n,moneda){
  if(n===null||n===undefined||!isFinite(n))return '—';
  if(moneda==='USD')return (n<0?'−':'')+'US$ '+Number(Math.abs(n)).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  try{
    return new Intl.NumberFormat('es-PE',{style:'currency',currency:moneda||'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
  }catch(e){
    return (moneda?moneda+' ':'')+Number(n).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
}

export function fmtCompacto(n){const x=Number(n||0);return Math.abs(x)>=1000?(x/1000).toFixed(1)+'k':x.toFixed(0);}

export function fmtPct(n){return n===null||n===undefined||!isFinite(n)?'—':Number(n).toFixed(1)+'%';}

export function escAttr(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

Object.keys(EMOJIS).forEach(k=>{EMOJI_NORM[norm(k)]=k;});
