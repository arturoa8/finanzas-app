// Orden y visibilidad del resumen de Inicio: preferencias de este navegador.
import {toast} from '../ui/toast.js';
import {escHtml} from '../utils/formatters.js';

export const HOME_WIDGETS_KEY='finanzas.home-widgets.v1';
export const HOME_WIDGET_CATALOG=Object.freeze([
  {id:'rentabilidad',nombre:'Rentabilidad',descripcion:'Diaria y total en porcentajes.'},
  {id:'periodo',nombre:'Resumen del período',descripcion:'Ingresos y gastos del período elegido.'},
  {id:'tarjetas',nombre:'Tarjetas',descripcion:'Saldo y próxima fecha de pago.'},
  {id:'presupuesto',nombre:'Presupuesto',descripcion:'Disponible o exceso del período.'},
  {id:'pagar',nombre:'Por pagar',descripcion:'Pendiente y próximo vencimiento.'},
  {id:'cobrar',nombre:'Por cobrar',descripcion:'Pendiente y próximo cobro.'},
].map(widget=>Object.freeze(widget)));

let preferenciaVolatil=null;
const copiar=widgets=>widgets.map(({id,visible})=>({id,visible}));

export function normalizarHomeWidgets(valor){
  const catalogo=new Set(HOME_WIDGET_CATALOG.map(widget=>widget.id)),vistos=new Set(),widgets=[];
  if(Array.isArray(valor))for(const widget of valor){
    if(!widget||typeof widget!=='object'||!catalogo.has(widget.id)||vistos.has(widget.id))continue;
    vistos.add(widget.id);
    widgets.push({id:widget.id,visible:typeof widget.visible==='boolean'?widget.visible:true});
  }
  for(const widget of HOME_WIDGET_CATALOG)if(!vistos.has(widget.id))widgets.push({id:widget.id,visible:true});
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

export function renderHomeWidgetsConfig(){
  const lista=document.getElementById('homeWidgetsConfig');
  if(!lista)return;
  const widgets=getHomeWidgets();
  lista.innerHTML=widgets.map((widget,i)=>{
    const {nombre,descripcion}=HOME_WIDGET_CATALOG.find(item=>item.id===widget.id);
    return `<li class="home-widget-setting" data-widget="${widget.id}">
      <span class="home-widget-position" aria-hidden="true">${i+1}</span>
      <label class="home-widget-toggle" for="home-widget-${widget.id}">
        <input type="checkbox" id="home-widget-${widget.id}" ${widget.visible?'checked':''} onchange="cambiarVisibilidadWidgetInicio('${widget.id}',this.checked)">
        <span><strong>${escHtml(nombre)}</strong><small>${escHtml(descripcion)}</small></span>
      </label>
      <div class="home-widget-order" aria-label="Orden de ${escHtml(nombre)}">
        <button type="button" id="home-widget-up-${widget.id}" class="home-widget-move" ${i===0?'disabled':''} aria-label="Mover ${escHtml(nombre)} hacia arriba" title="Mover arriba" onclick="moverWidgetInicio('${widget.id}',-1)">↑</button>
        <button type="button" id="home-widget-down-${widget.id}" class="home-widget-move" ${i===widgets.length-1?'disabled':''} aria-label="Mover ${escHtml(nombre)} hacia abajo" title="Mover abajo" onclick="moverWidgetInicio('${widget.id}',1)">↓</button>
      </div>
    </li>`;
  }).join('');
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
  const nombre=HOME_WIDGET_CATALOG.find(item=>item.id===id).nombre;
  return aplicarWidgets(widgets,nombre+(visible?' se mostrará en Inicio.':' se ocultará de Inicio.'),'home-widget-'+id);
}

export function moverWidgetInicio(id,direccion){
  if(direccion!==-1&&direccion!==1)return;
  const widgets=getHomeWidgets(),posicion=widgets.findIndex(widget=>widget.id===id),destino=posicion+direccion;
  if(posicion<0||destino<0||destino>=widgets.length)return;
  [widgets[posicion],widgets[destino]]=[widgets[destino],widgets[posicion]];
  const nombre=HOME_WIDGET_CATALOG.find(item=>item.id===id).nombre;
  return aplicarWidgets(widgets,`${nombre}: posición ${destino+1} de ${widgets.length}.`,`home-widget-${direccion<0?'up':'down'}-${id}`);
}

export function restaurarWidgetsInicio(){
  return aplicarWidgets(normalizarHomeWidgets(null),'Se restauraron el orden y la visibilidad de Inicio.');
}
