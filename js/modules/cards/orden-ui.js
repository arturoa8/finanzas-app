// Configuración → Tarjetas de crédito: elegir en qué orden se muestran.
// El orden se aplica en Tarjetas, Inicio, pagos y formularios porque sale de
// CREDIT_CARDS; aquí solo se edita y se guarda.
import {CREDIT_CARDS} from './config.js';
import {getOrdenTarjetas, guardarOrdenTarjetas} from './orden.js';
import {toast} from '../../ui/toast.js';
import {ICONO_ASA, iconoFlecha, initReorderList} from '../../ui/reorder-drag.js';
import {escHtml} from '../../utils/formatters.js';


export function renderCardsOrdenConfig(){
  const lista=document.getElementById('cardsOrderConfig');
  if(!lista)return;
  const tarjetas=CREDIT_CARDS.map(card=>card);
  const pie=document.getElementById('cardsOrderFooter');
  if(pie)pie.hidden=tarjetas.length<2;
  lista.hidden=tarjetas.length<2;
  const vacio=document.getElementById('cardsOrderEmpty');
  if(vacio)vacio.textContent=tarjetas.length?(tarjetas.length<2?'Con una sola tarjeta no hay nada que ordenar.':''):'Cuando agregues tarjetas podrás elegir su orden aquí.';
  lista.innerHTML=tarjetas.map((card,i)=>`<li class="reorder-item" data-id="${i}">
      <span class="reorder-grip" aria-hidden="true" title="Arrastra para reordenar">${ICONO_ASA}</span>
      <span class="reorder-label">${escHtml(card.emoji)} ${escHtml(card.nombre)}</span>
      <div class="home-widget-order" aria-label="Orden de ${escHtml(card.nombre)}">
        <button type="button" id="card-order-up-${i}" class="home-widget-move" ${i===0?'disabled':''} aria-label="Mover ${escHtml(card.nombre)} hacia arriba" title="Mover arriba" onclick="moverTarjetaOrden(${i},-1)">${iconoFlecha(true)}</button>
        <button type="button" id="card-order-down-${i}" class="home-widget-move" ${i===tarjetas.length-1?'disabled':''} aria-label="Mover ${escHtml(card.nombre)} hacia abajo" title="Mover abajo" onclick="moverTarjetaOrden(${i},1)">${iconoFlecha(false)}</button>
      </div>
    </li>`).join('');
  initReorderList(lista,{alMover:(indice,destino)=>reubicarTarjeta(Number(indice),destino)});
}

function aplicarOrden(cuentas,mensaje,foco){
  const resultado=guardarOrdenTarjetas(cuentas);
  renderCardsOrdenConfig();
  const estado=document.getElementById('cardsOrderStatus');
  if(estado)estado.textContent=mensaje+(resultado.guardado?'':' El cambio se aplica ahora, pero este navegador no permite guardarlo.');
  if(!resultado.guardado)toast('Orden aplicado; este navegador no permite guardarlo','error');
  if(foco){
    let control=document.getElementById(foco);
    if(control?.disabled)control=document.getElementById(foco.replace(/-(?:up|down)-/,'-'+(/-up-/.test(foco)?'down':'up')+'-'));
    control?.focus({preventScroll:true});
  }
  return resultado;
}

function reubicarTarjeta(origen,destino){
  const cuentas=CREDIT_CARDS.map(card=>card.cuenta);
  if(!Number.isInteger(origen)||!Number.isInteger(destino)||origen<0||destino<0||origen>=cuentas.length||destino>=cuentas.length||origen===destino)return;
  const nombre=CREDIT_CARDS.map(card=>card.nombre)[origen];
  const [cuenta]=cuentas.splice(origen,1);
  cuentas.splice(destino,0,cuenta);
  return aplicarOrden(cuentas,`${nombre}: posición ${destino+1} de ${cuentas.length}.`,`card-order-${destino>origen?'down':'up'}-${destino}`);
}

export function moverTarjetaOrden(indice,direccion){
  if(direccion!==-1&&direccion!==1)return;
  return reubicarTarjeta(indice,indice+direccion);
}

export function restaurarOrdenTarjetas(){
  if(!getOrdenTarjetas().length)return;
  return aplicarOrden([],'Las tarjetas vuelven al orden en que las creaste.');
}

// Alta, baja o cambio de nombre desde "Gestionar tarjetas".
globalThis.addEventListener?.('finanzas:tarjetas',renderCardsOrdenConfig);
