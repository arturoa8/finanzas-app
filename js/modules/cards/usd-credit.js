// Crédito en la moneda de la tarjeta. Se guarda con los pagos existentes;
// las notas versionadas distinguen una conversión bancaria de una salida de caja.
export const NOTA_CREDITO_USD='finanzas:tarjeta-usd:v1:';
export const centimosUSD=n=>Math.round((Number(n)||0)*100);
export function notaCreditoUSD(p){
  const nota=p[5];if(typeof nota!=='string'||!nota.startsWith(NOTA_CREDITO_USD))return null;
  try{const v=JSON.parse(nota.slice(NOTA_CREDITO_USD.length));return ['pago','conversion'].includes(v.tipo)?v:null;}catch{return null;}
}
export const serializarCreditoUSD=meta=>NOTA_CREDITO_USD+JSON.stringify(meta);

// Lotes de deuda y de crédito en céntimos. El crédito USD solo cubre USD;
// convertirse a PEN exige un movimiento bancario explícito.
export function calcularCreditoUSD(gastos,pagos){
  const deuda=[],credito=[],porCiclo=new Map(),porTx=new Map(),porPago=new Map(),cambios=[];
  const ciclo=k=>{if(!porCiclo.has(k))porCiclo.set(k,{cubierto:0,usdPagado:0,creditoAplicado:0});return porCiclo.get(k);};
  const parte=(pen,usados,usd)=>!usados?0:usados===usd?pen:Math.round(pen*usados/usd);
  function consumirCredito(usd){
    let falta=usd,costo=0;const origenes=new Set();
    for(const lote of credito){if(!falta)break;const usar=Math.min(falta,lote.usd);if(!usar)continue;
      const pen=parte(lote.pen,usar,lote.usd);lote.usd-=usar;lote.pen-=pen;falta-=usar;costo+=pen;origenes.add(lote.id);}
    return{usado:usd-falta,costo,origenes:[...origenes]};
  }
  function aplicarCreditoPendiente(fecha){
    for(const lote of deuda){if(!lote.usd)continue;const usado=consumirCredito(lote.usd);if(!usado.usado)break;
      const cubierto=parte(lote.pen,usado.usado,lote.usd);lote.usd-=usado.usado;lote.pen-=cubierto;
      const b=ciclo(lote.ciclo);b.cubierto+=cubierto;b.usdPagado+=usado.usado;b.creditoAplicado+=usado.usado;
      const tx=porTx.get(lote.id);if(tx){tx.cubierto+=cubierto;tx.usdPagado+=usado.usado;}
      if(cubierto!==usado.costo)cambios.push({id:lote.id,fecha,monto:(cubierto-usado.costo)/100});
    }
  }
  const eventos=[...gastos.map(t=>({...t,evento:'tx'})),...pagos.map(p=>({...p,evento:'pago'}))]
    .sort((a,b)=>new Date(a.fecha)-new Date(b.fecha)||Number(a.evento==='pago')-Number(b.evento==='pago')||Number(a.meta?.tipo==='conversion')-Number(b.meta?.tipo==='conversion')||String(a.id).localeCompare(String(b.id)));
  for(const e of eventos){
    if(e.evento==='tx'){
      const usd=centimosUSD(e.usd),pen=centimosUSD(e.pen);if(usd<=0)continue;
      if(e.tipo==='Gasto'){
        const usado=consumirCredito(usd),cubierto=parte(pen,usado.usado,usd);
        const b=ciclo(e.ciclo);b.cubierto+=cubierto;b.usdPagado+=usado.usado;b.creditoAplicado+=usado.usado;
        porTx.set(e.id,{ciclo:e.ciclo,cubierto,usdPagado:usado.usado});
        if(cubierto!==usado.costo)cambios.push({id:e.id,fecha:e.fecha,monto:(cubierto-usado.costo)/100});
        if(usado.usado<usd)deuda.push({id:e.id,ciclo:e.ciclo,usd:usd-usado.usado,pen:pen-cubierto});
      }else if(e.tipo==='Reembolso'){
        let falta=usd,restoPen=pen;
        // La parte aún pendiente de la compra se anula primero. Si ya se
        // pagó, la devolución queda en USD y puede cubrir otra compra USD.
        const lotes=deuda.filter(l=>!e.origen||l.id===e.origen);
        for(const lote of lotes){if(!falta)break;const usar=Math.min(falta,lote.usd);if(!usar)continue;
          const quitar=parte(lote.pen,usar,lote.usd),ref=parte(restoPen,usar,falta);lote.usd-=usar;lote.pen-=quitar;falta-=usar;restoPen-=ref;}
        if(falta){
          const original=porTx.get(e.origen);if(original){const b=ciclo(original.ciclo),quitar=Math.min(original.cubierto,restoPen),quitarUSD=Math.min(original.usdPagado,falta);b.cubierto-=quitar;original.cubierto-=quitar;b.usdPagado-=quitarUSD;original.usdPagado-=quitarUSD;}
          credito.push({id:e.id,usd:falta,pen:restoPen});
          aplicarCreditoPendiente(e.fecha);
        }
      }
    }else if(e.meta?.tipo==='conversion'){
      const usd=centimosUSD(e.meta.usd),usado=consumirCredito(usd);
      if(usado.usado!==usd)throw new Error('La conversión supera el crédito en dólares disponible. Revisa el historial.');
    }else if(e.moneda==='USD'){
      const importe=centimosUSD(e.usd),costo=centimosUSD(e.costo),extra=centimosUSD(e.meta?.credito);
      // El recibo fija qué parte fue pago y qué parte crédito. Registrar más
      // tarde una compra de ese día no reescribe el costo del pago original.
      let falta=Math.max(0,importe-extra),cubierto=0;
      const lotes=[...deuda].sort((a,b)=>Number(b.ciclo===e.ciclo)-Number(a.ciclo===e.ciclo));
      for(const lote of lotes){if(!falta)break;const usar=Math.min(falta,lote.usd);if(!usar)continue;
        const pen=parte(lote.pen,usar,lote.usd);lote.usd-=usar;lote.pen-=pen;falta-=usar;
        const b=ciclo(lote.ciclo);b.cubierto+=pen;b.usdPagado+=usar;cubierto+=pen;
        const original=porTx.get(lote.id);if(original){original.cubierto+=pen;original.usdPagado+=usar;}}
      // Los pagos anteriores fijaron su equivalente con el promedio de toda
      // la deuda. Respetar ese importe evita modificar su diferencia de cambio.
      const reconocido=centimosUSD(e.meta?.tipo==='pago'?e.meta.reconocido:e.reconocido);
      if(reconocido>0&&cubierto){
        const diferencia=reconocido-cubierto,restantes=deuda.filter(l=>l.usd>0),total=restantes.reduce((s,l)=>s+l.pen,0);
        let nuevo=total-diferencia,base=total;
        // Mantener el costo promedio reconocido por el pago sin dejar un
        // lote negativo cuando las compras usaron distintos tipos de cambio.
        for(const lote of restantes){const pen=parte(nuevo,lote.pen,base);base-=lote.pen;nuevo-=pen;lote.pen=pen;}
      }
      const aFavor=extra+falta;
      const costoCredito=e.meta&&aFavor===extra?centimosUSD(e.meta.costoCredito):parte(costo,aFavor,importe);
      // El costo original del excedente no se pierde cuando el lote ya se
      // consumió. En unidades de moneda, útil para reponer el pago histórico
      // desde una cuenta USD sin tratar ese crédito como otro retiro PEN.
      porPago.set(String(e.id),{creditoUSD:aFavor/100,costoCreditoPEN:costoCredito/100});
      if(aFavor){credito.push({id:e.id,usd:aFavor,pen:costoCredito});aplicarCreditoPendiente(e.fecha);}
    }
  }
  const pendiente=deuda.reduce((s,l)=>s+l.usd,0),penPendiente=deuda.reduce((s,l)=>s+l.pen,0);
  const favor=credito.reduce((s,l)=>s+l.usd,0),costoFavor=credito.reduce((s,l)=>s+l.pen,0);
  return{usd:pendiente/100,pen:penPendiente/100,saldoFavor:favor/100,costoFavor:costoFavor/100,
    porCiclo,deuda,credito,porTx,porPago,cambios,consumirCredito};
}
