// Bloques de Inicio: cuáles se ven, en qué orden y de qué tamaño.
// Preferencias de este navegador.
import {toast} from '../ui/toast.js';
import {ICONO_ASA, iconoFlecha, initReorderList} from '../ui/reorder-drag.js';
import {escHtml} from '../utils/formatters.js';

export const HOME_WIDGETS_KEY='finanzas.home-widgets.v1';
// tamanos: los que admite el bloque; tamano: el de partida; visible: si
// aparece sin que nadie lo haya pedido. Los bloques nuevos nacen ocultos para
// que una actualización no cambie el Inicio de quien ya lo tenía a su gusto.
export const HOME_WIDGET_CATALOG=Object.freeze([
  {id:'rentabilidad',nombre:'Rentabilidad',descripcion:'Diaria y total en porcentajes.',tamanos:['normal','ancho'],tamano:'ancho',visible:true},
  {id:'periodo',nombre:'Resumen del período',descripcion:'Ingresos y gastos del período elegido.',tamanos:['ancho'],tamano:'ancho',visible:true},
  {id:'tarjetas',nombre:'Tarjetas',descripcion:'Saldo y próxima fecha de pago.',tamanos:['normal','ancho'],tamano:'normal',visible:true},
  {id:'presupuesto',nombre:'Presupuesto',descripcion:'Disponible o exceso del período.',tamanos:['normal','ancho'],tamano:'normal',visible:true},
  {id:'pagar',nombre:'Por pagar',descripcion:'Pendiente y próximo vencimiento.',tamanos:['normal','ancho'],tamano:'normal',visible:true},
  {id:'cobrar',nombre:'Por cobrar',descripcion:'Pendiente y próximo cobro.',tamanos:['normal','ancho'],tamano:'normal',visible:true},
  {id:'efectivo',nombre:'Efectivo',descripcion:'Saldo de tus cuentas en soles.',tamanos:['normal','ancho'],tamano:'normal',visible:false},
  {id:'linea',nombre:'Línea de crédito',descripcion:'Cuánto de tu línea llevas usada.',tamanos:['normal','ancho'],tamano:'normal',visible:false},
  {id:'ultimos',nombre:'Últimos movimientos',descripcion:'Los tres más recientes.',tamanos:['ancho'],tamano:'ancho',visible:false},
].map(widget=>Object.freeze(widget)));
export const HOME_WIDGET_SIZE_LABELS=Object.freeze({normal:'Compacto',ancho:'Ancho'});

const SIZE_ICON={
  normal:'<svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="1" y="1" width="9" height="12" rx="2.5"/><rect x="12" y="1" width="9" height="12" rx="2.5" opacity=".35"/></svg>',
  ancho:'<svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="1" y="1" width="20" height="12" rx="2.5"/></svg>',
};

let preferenciaVolatil=null;
const copiar=widgets=>widgets.map(({id,visible,tamano})=>({id,visible,tamano}));
const definicion=id=>HOME_WIDGET_CATALOG.find(item=>item.id===id);

export function normalizarHomeWidgets(valor){
  const vistos=new Set(),widgets=[];
  if(Array.isArray(valor))for(const widget of valor){
    const base=widget&&typeof widget==='object'?definicion(widget.id):null;
    if(!base||vistos.has(widget.id))continue;
    vistos.add(widget.id);
    widgets.push({id:widget.id,visible:typeof widget.visible==='boolean'?widget.visible:base.visible,
      tamano:base.tamanos.includes(widget.tamano)?widget.tamano:base.tamano});
  }
  for(const base of HOME_WIDGET_CATALOG)if(!vistos.has(base.id))widgets.push({id:base.id,visible:base.visible,tamano:base.tamano});
  return widgets;
}

export function getHomeWidgets(){
  if(preferenciaVolatil)return copiar(preferenciaVolatil);
  try{return normalizarHomeWidgets(JSON.parse(localStorage.getItem(HOME_WIDGETS_KEY)||'null'));}
  catch{return normalizarHomeWidgets(null);}
}

export function guardarHomeWidgets(valor){
  const widgets=normalizarHomeWidgets(valor);
  try{
    localStorage.setItem(HOME_WIDGETS_KEY,JSON.stringify(widgets));
    preferenciaVolatil=null;
    return {guardado:true,widgets:copiar(widgets)};
  }catch{
    preferenciaVolatil=widgets;
    return {guardado:false,widgets:copiar(widgets)};
  }
}

// Esquema de cómo quedará Inicio: dos columnas, cada bloque con su ancho.
function renderVistaPrevia(widgets){
  const vista=document.getElementById('homeWidgetsPreview');
  if(!vista)return;
  const visibles=widgets.filter(widget=>widget.visible);
  vista.innerHTML=visibles.length
    ?visibles.map(({id,tamano})=>`<span class="home-preview-tile" data-size="${tamano}">${escHtml(definicion(id).nombre)}</span>`).join('')
    :'<span class="home-preview-empty">Inicio sin bloques</span>';
}

export function renderHomeWidgetsConfig(){
  const lista=document.getElementById('homeWidgetsConfig');
  if(!lista)return;
  const widgets=getHomeWidgets();
  lista.innerHTML=widgets.map((widget,i)=>{
    const {nombre,descripcion,tamanos}=definicion(widget.id);
    const tamano=tamanos.length>1
      ?`<div class="home-widget-size" role="group" aria-label="Tamaño de ${escHtml(nombre)}">${tamanos.map(t=>`<button type="button" id="home-widget-size-${widget.id}-${t}" class="home-widget-size-btn" aria-pressed="${widget.tamano===t}" ${widget.visible?'':'disabled'} onclick="cambiarTamanoWidgetInicio('${widget.id}','${t}')">${SIZE_ICON[t]}<span>${HOME_WIDGET_SIZE_LABELS[t]}</span></button>`).join('')}</div>`
      :'';
    return `<li class="home-widget-setting${widget.visible?'':' is-off'}" data-widget="${widget.id}" data-id="${widget.id}">
      <span class="reorder-grip" aria-hidden="true" title="Arrastra para reordenar">${ICONO_ASA}</span>
      <label class="home-widget-toggle" for="home-widget-${widget.id}">
        <input type="checkbox" id="home-widget-${widget.id}" ${widget.visible?'checked':''} onchange="cambiarVisibilidadWidgetInicio('${widget.id}',this.checked)">
        <span><strong>${escHtml(nombre)}</strong><small>${escHtml(descripcion)}</small></span>
      </label>
      <div class="home-widget-order" aria-label="Orden de ${escHtml(nombre)}">
        <button type="button" id="home-widget-up-${widget.id}" class="home-widget-move" ${i===0?'disabled':''} aria-label="Mover ${escHtml(nombre)} hacia arriba" title="Mover arriba" onclick="moverWidgetInicio('${widget.id}',-1)">${iconoFlecha(true)}</button>
        <button type="button" id="home-widget-down-${widget.id}" class="home-widget-move" ${i===widgets.length-1?'disabled':''} aria-label="Mover ${escHtml(nombre)} hacia abajo" title="Mover abajo" onclick="moverWidgetInicio('${widget.id}',1)">${iconoFlecha(false)}</button>
      </div>
      ${tamano}
    </li>`;
  }).join('');
  renderVistaPrevia(widgets);
  initReorderList(lista,{alMover:moverWidgetInicioA});
}

function aplicarWidgets(widgets,mensaje,foco){
  const resultado=guardarHomeWidgets(widgets);
  renderHomeWidgetsConfig();
  const estado=document.getElementById('homeWidgetsStatus');
  if(estado)estado.textContent=mensaje+(resultado.guardado?'':' El cambio se aplica ahora, pero este navegador no permite guardarlo.');
  if(!resultado.guardado)toast('Preferencia aplicada; este navegador no permite guardarla','error');
  if(foco){
    let control=document.getElementById(foco);
    if(control?.disabled)control=document.getElementById('home-widget-'+foco.replace(/^home-widget-(?:up|down)-/,''));
    control?.focus({preventScroll:true});
  }
  return resultado;
}

export function cambiarVisibilidadWidgetInicio(id,visible){
  if(typeof visible!=='boolean')return;
  const widgets=getHomeWidgets(),widget=widgets.find(item=>item.id===id);
  if(!widget||widget.visible===visible)return;
  widget.visible=visible;
  return aplicarWidgets(widgets,definicion(id).nombre+(visible?' se mostrará en Inicio.':' se ocultará de Inicio.'),'home-widget-'+id);
}

export function cambiarTamanoWidgetInicio(id,tamano){
  const base=definicion(id);
  if(!base||!base.tamanos.includes(tamano))return;
  const widgets=getHomeWidgets(),widget=widgets.find(item=>item.id===id);
  if(!widget||widget.tamano===tamano)return;
  widget.tamano=tamano;
  return aplicarWidgets(widgets,`${base.nombre}: tamaño ${HOME_WIDGET_SIZE_LABELS[tamano].toLowerCase()}.`,`home-widget-size-${id}-${tamano}`);
}

function reubicar(id,destino,foco){
  const widgets=getHomeWidgets(),posicion=widgets.findIndex(widget=>widget.id===id);
  if(posicion<0||!Number.isInteger(destino)||destino<0||destino>=widgets.length||destino===posicion)return;
  const [widget]=widgets.splice(posicion,1);
  widgets.splice(destino,0,widget);
  return aplicarWidgets(widgets,`${definicion(id).nombre}: posición ${destino+1} de ${widgets.length}.`,foco);
}

export function moverWidgetInicio(id,direccion){
  if(direccion!==-1&&direccion!==1)return;
  const posicion=getHomeWidgets().findIndex(widget=>widget.id===id);
  return reubicar(id,posicion+direccion,`home-widget-${direccion<0?'up':'down'}-${id}`);
}

// Destino absoluto, para arrastrar.
export function moverWidgetInicioA(id,destino){return reubicar(id,destino,'home-widget-'+id);}

export function restaurarWidgetsInicio(){
  return aplicarWidgets(normalizarHomeWidgets(null),'Se restauraron el orden, el tamaño y la visibilidad de Inicio.');
}
