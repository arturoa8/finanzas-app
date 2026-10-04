// Resultado acumulado en PEN y atribución entre inversión y tipo de cambio.
// Modelo puro: no lee estado global, DOM, cotizaciones ni el TC de hoy por su
// cuenta. Los flujos se cortan en la misma fecha que el valor del portafolio.
//
// V = valor USD, A = aportes USD netos de retiros, C = costos USD reales,
// H = aportes PEN históricos netos de retiros + costos PEN históricos, T = TC.
// inversión = (V - A - C) * T; cambio = (A + C) * T - H;
// total = V * T - H = inversión + cambio. El efecto cruzado de la variación
// del dólar sobre la ganancia USD se asigna a inversión (valorada al TC T).
// Son ganancias / capital desembolsado, nunca TWR, XIRR ni anualización.
//
// Un aporte desde una cuenta USD conserva su costo mediante promedio móvil
// de ESA cuenta: compras PEN→USD, ingresos USD con valoración histórica y
// transferencias USD→USD. No se usa el TC propuesto en una transferencia
// USD→IBKR como prueba de cuánto costaron originalmente esos dólares.
// Sin historia de compra/valoración no se atribuye una ganancia cambiaria.

const nombre=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const numero=v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const positivo=v=>{const n=numero(v);return n!==null&&n>0?n:null;};
const centimos=v=>Math.round((v+Number.EPSILON)*100)/100;

// Lima es UTC−5 todo el año. Mantiene la fecha de los movimientos guardados
// con hora sin depender de la zona horaria del servidor de pruebas.
function fechaMovimiento(v){
  if(v===null||v===undefined||v==='')return null;
  if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)){
    const d=new Date(v+'T12:00:00-05:00');
    return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v?{iso:v,orden:+d}:null;
  }
  let valor=v;
  if(typeof v==='string'&&/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)){
    const [d,m,y]=v.split(',')[0].trim().split('/');
    return fechaMovimiento(y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0'));
  }
  const d=new Date(valor);if(!Number.isFinite(+d))return null;
  return{iso:new Date(+d-5*3600000).toISOString().slice(0,10),orden:+d};
}

function movimiento(t){
  if(Array.isArray(t))return{fecha:t[0],descripcion:t[1],tipo:t[3],pen:t[4],origen:t[5],id:t[6],destino:t[7],moneda:t[9],usd:t[10],tc:t[11],fuente:t[12],monedaDestino:t[13],montoDestino:t[14],costo:t[15]===true};
  return{fecha:t.fecha,descripcion:t.descripcion,tipo:t.tipo,pen:t.monto,origen:t.cuenta,id:t.id,destino:t.cuenta_destino,moneda:t.moneda_original,usd:t.monto_original,tc:t.tc,fuente:t.tc_fuente,monedaDestino:t.moneda_destino,montoDestino:t.monto_destino,costo:t.es_costo_inversion===true};
}

function cuenta(c){return Array.isArray(c)?{nombre:c[0],tipo:c[1],moneda:c[2]}:{nombre:c.nombre,tipo:c.tipo,moneda:c.moneda};}

function basesDesdeMovimientos({transacciones,cuentas,pagosTarjetas,cuentasInversion,hasta}){
  const configs=cuentas.map(cuenta),porNombre=new Map(configs.map(c=>[nombre(c.nombre),c]));
  const inversiones=new Set((cuentasInversion||configs.filter(c=>c.tipo==='inversion').map(c=>c.nombre)).map(nombre));
  const moneda=n=>porNombre.get(nombre(n))?.moneda||(inversiones.has(nombre(n))?'USD':null);
  const esInversion=n=>inversiones.has(nombre(n));
  const esCajaUSD=n=>moneda(n)==='USD'&&!esInversion(n);
  const pozos=new Map(),flujos=[],costos=[],pendientes=[],inversionesTocadas=new Set();
  const pendiente=(codigo,m,mensaje)=>pendientes.push({codigo,id:m.id??null,fecha:fechaMovimiento(m.fecha)?.iso??null,descripcion:String(m.descripcion||''),mensaje});
  const pozo=n=>{const k=nombre(n);if(!pozos.has(k))pozos.set(k,{usd:0,pen:0,desconocido:false});return pozos.get(k);};
  function entrar(n,usd,pen){
    const p=pozo(n);
    if(!(usd>0)){p.desconocido=true;return;}
    if(p.usd<0.0000001&&!p.desconocido)p.pen=0;
    p.usd+=usd;
    p.pen=p.pen!==null&&pen!==null?p.pen+pen:null;
  }
  function salir(n,usd){
    const p=pozo(n);
    if(!(usd>0)){p.desconocido=true;return null;}
    // Una salida mayor que el saldo reconstruido demuestra que falta parte
    // de la historia. Agregar compras después no prueba que ese saldo inicial
    // desconocido se hubiera agotado.
    if(p.usd+0.0000001<usd)p.desconocido=true;
    const suficiente=!p.desconocido&&p.usd+0.0000001>=usd;
    const pen=suficiente&&p.pen!==null&&p.usd>0?usd*p.pen/p.usd:null;
    p.usd=Math.max(0,p.usd-usd);
    if(p.usd<0.0000001&&!p.desconocido){p.usd=0;p.pen=0;}
    else p.pen=pen!==null&&p.pen!==null?p.pen-pen:null;
    return pen;
  }
  const txs=transacciones.map(movimiento);
  const eventos=txs.map((m,i)=>({m,fecha:fechaMovimiento(m.fecha),i}));
  pagosTarjetas.forEach((p,i)=>{
    const pago=Array.isArray(p)?{fecha:p[4],origen:p[6],moneda:p[7],usd:p[3],id:p[0]}:{fecha:p.fecha,origen:p.cuenta_origen,moneda:p.moneda,usd:p.monto,id:p.id};
    if(pago.moneda==='USD'&&esCajaUSD(pago.origen))eventos.push({pago,fecha:fechaMovimiento(pago.fecha),i:txs.length+i});
  });
  eventos.sort((a,b)=>(a.fecha?.orden??-Infinity)-(b.fecha?.orden??-Infinity)||a.i-b.i);
  for(const ev of eventos){
    const m=ev.m||ev.pago;
    if(!ev.fecha){
      if(esInversion(m.origen)||esInversion(m.destino)||m.costo)pendiente('fecha_invalida',m,'Hay un movimiento de inversión sin fecha válida.');
      if(esCajaUSD(m.origen))pozo(m.origen).desconocido=true;
      if(esCajaUSD(m.destino))pozo(m.destino).desconocido=true;
      continue;
    }
    if(ev.fecha.iso>hasta)continue;
    if(ev.pago){salir(m.origen,positivo(m.usd));continue;}
    const pen=positivo(m.pen),usd=m.moneda==='USD'?positivo(m.usd):null;
    const origenMoneda=moneda(m.origen),destinoMoneda=moneda(m.destino);
    if(m.tipo==='Transferencia'){
      const saleInversion=esInversion(m.origen),entraInversion=esInversion(m.destino);
      if((saleInversion&&origenMoneda!=='USD')||(entraInversion&&destinoMoneda!=='USD')){
        pendiente('cuenta_no_usd',m,'Una cuenta de inversión usa una moneda distinta a USD.');continue;
      }
      if(saleInversion)inversionesTocadas.add(nombre(m.origen));
      if(entraInversion)inversionesTocadas.add(nombre(m.destino));
      let baseSalida=null;
      if(esCajaUSD(m.origen))baseSalida=salir(m.origen,usd);
      const recibidoUSD=destinoMoneda==='USD'?(positivo(m.montoDestino)||(origenMoneda==='USD'?usd:null)):null;
      const distintasCantidadesUSD=origenMoneda==='USD'&&destinoMoneda==='USD'&&usd!==null&&recibidoUSD!==null&&Math.abs(usd-recibidoUSD)>0.005;
      if(distintasCantidadesUSD)baseSalida=null; // Falta separar comisión / ajuste de divisa.
      if(esCajaUSD(m.destino)){
        const base=origenMoneda==='PEN'?pen:origenMoneda==='USD'?baseSalida:null;
        // Un retiro USD ya es un flujo valorado a la fecha del retiro. Ese
        // valor histórico explícito constituye la nueva base fuera de IBKR.
        const retiroValido=saleInversion&&!distintasCantidadesUSD&&usd!==null&&pen!==null&&m.fuente==='manual'&&positivo(m.tc)!==null;
        entrar(m.destino,recibidoUSD,retiroValido?pen:base);
      }
      if(entraInversion===saleInversion)continue; // Interna: no cambia capital.
      let importeUSD,importePEN;
      if(entraInversion){
        importeUSD=recibidoUSD;
        importePEN=origenMoneda==='PEN'?pen:origenMoneda==='USD'?baseSalida:null;
      }else{
        importeUSD=usd;
        if(destinoMoneda==='PEN')importePEN=positivo(m.montoDestino);
        else importePEN=!distintasCantidadesUSD&&pen!==null&&m.fuente==='manual'&&positivo(m.tc)!==null?pen:null;
      }
      const signo=entraInversion?1:-1;
      flujos.push({id:m.id,fecha:ev.fecha.iso,monto:importeUSD===null?null:signo*importeUSD,soles:importePEN===null?null:signo*importePEN});
      if(importeUSD===null)pendiente('dolares_pendientes',m,'Falta confirmar los dólares aportados o retirados.');
      if(importePEN===null)pendiente('base_pen_pendiente',m,entraInversion?'Falta el costo histórico de los dólares aportados.':'Falta una valoración histórica en soles del retiro.');
      if(distintasCantidadesUSD)pendiente('transferencia_usd_desigual',m,'Una transferencia USD tiene importes distintos de salida y entrada: falta identificar su comisión o ajuste.');
      continue;
    }
    let baseUSD=null;
    if(esCajaUSD(m.origen)){
      if(m.tipo==='Gasto')baseUSD=salir(m.origen,usd);
      else if(m.tipo==='Ingreso'||m.tipo==='Reembolso')entrar(m.origen,usd,pen);
    }
    if(!m.costo||(m.tipo!=='Gasto'&&m.tipo!=='Ingreso'))continue;
    // Comisiones/devoluciones dentro de la cuenta ya cambian valor_total;
    // restarlas otra vez como desembolso externo duplicaría su efecto.
    if(esInversion(m.origen))continue;
    const signo=m.tipo==='Gasto'?1:-1;
    // Para un costo PEN no existe una cantidad USD real. El aporte cercano
    // sólo sería una estimación; permite calcular totalPEN, no atribuirla.
    const costePEN=esCajaUSD(m.origen)&&m.tipo==='Gasto'?baseUSD:pen;
    const costeUSD=m.moneda==='USD'?usd:null;
    costos.push({id:m.id,fecha:ev.fecha.iso,soles:costePEN===null?null:signo*costePEN,usd:costeUSD===null?null:signo*costeUSD});
    if(costePEN===null)pendiente('costo_pen_pendiente',m,'Falta la valoración histórica en soles de un costo de invertir.');
    if(costeUSD===null)pendiente('costo_usd_pendiente',m,'Un costo en soles no tiene un importe real confirmado en dólares.');
  }
  // Dos nombres, incluso en una transferencia entre inversiones, no prueban
  // que pertenezcan al mismo snapshot IBKR. Ignorar ese traslado podría
  // mostrar como pérdida lo enviado a otra corredora. Las entradas fl/co
  // explícitas quedan reservadas al consumidor que sí conoce el perímetro.
  if(inversionesTocadas.size>1)pendientes.push({codigo:'perimetro_inversion_ambiguo',id:null,fecha:hasta,
    mensaje:'Hay flujos de varias cuentas de inversión; falta vincular cuáles pertenecen al valor de esta cuenta IBKR.'});
  return{flujos,costos,pendientes};
}

// Entradas normalizadas opcionales: fl.flujos[{fecha,monto,soles}] y
// co.costos[{fecha,usd,soles}]. Soles es base histórica, nunca valor actual.
// usdEstimado / solesEstimados o *Confirmado:false impiden atribución exacta.
function basesExplicitas(fl,co,hasta){
  const pendientes=[];
  const dentro=(fila,tipo)=>{
    const fecha=fechaMovimiento(fila.fecha);
    if(!fecha){pendientes.push({codigo:'fecha_invalida',id:fila.id??null,mensaje:'Hay un '+tipo+' sin fecha válida.'});return false;}
    return fecha.iso<=hasta;
  };
  const flujos=(fl.flujos||[]).filter(f=>dentro(f,'flujo')).map(f=>({
    ...f,monto:f.usdEstimado||f.usdConfirmado===false?null:numero(f.monto),
    soles:f.solesEstimados||f.solesConfirmados===false||f.historicoConfirmado===false?null:numero(f.soles)
  }));
  const costos=(co?.costos||[]).filter(c=>dentro(c,'costo')).map(c=>({
    // El modelo legado convierte un costo PEN al TC del aporte cercano. Su
    // número no acredita que se pagara en USD: la procedencia debe ser explícita.
    ...c,usd:c.usdEstimado||c.usdConfirmado!==true?null:numero(c.usd),
    soles:c.solesEstimados||c.solesConfirmados===false||c.historicoConfirmado===false?null:numero(c.soles)
  }));
  const fechas=(fl.pendientesFechas||[]).filter(f=>{const d=fechaMovimiento(f);return!d||d.iso<=hasta;});
  if(fechas.length||(fl.pendientes>0&&!fl.pendientesFechas?.length))pendientes.push({codigo:'flujo_pendiente',mensaje:'Hay aportes o retiros sin importes confirmados.'});
  return{flujos,costos,pendientes};
}

export function pfModeloRentabilidadCambio({row,tcActual,transacciones=[],cuentas=[],pagosTarjetas=[],cuentasInversion,fl,co}={}){
  const base={ok:false,atribucionOk:false,totalOk:false,metodo:'atribucion_capital',pendientes:[],mensaje:'',
    valorUSD:null,valorPEN:null,aportesUSD:null,aportesPEN:null,costosUSD:null,costosPEN:null,
    capitalUSD:null,capitalPEN:null,resultadoInversionUSD:null,resultadoInversionPEN:null,
    resultadoInversionBrutaUSD:null,resultadoInversionBrutaPEN:null,efectoCambioPEN:null,
    efectoCambioAportesPEN:null,resultadoTotalPEN:null,pctTotal:null,pctCambioSobreCapital:null,pctInversionSobreCapital:null,
    pctCambioAportesSobreCapital:null,pctInversionBrutaSobreCapital:null};
  const valor=numero(row?.valor_total),tc=positivo(tcActual),fecha=fechaMovimiento(row?.fecha_valoracion);
  if(!row||row.moneda_base!=='USD')return{...base,mensaje:'La atribución cambiaria requiere un portafolio con moneda base USD.'};
  if(valor===null||valor<0)return{...base,mensaje:'Falta un valor válido del portafolio en dólares.'};
  if(!fecha)return{...base,mensaje:'Falta la fecha de valoración del portafolio.'};
  if(tc===null)return{...base,valorUSD:valor,mensaje:'Falta un tipo de cambio USD/PEN válido.'};
  const historial=fl?basesExplicitas(fl,co,fecha.iso):basesDesdeMovimientos({transacciones,cuentas,pagosTarjetas,cuentasInversion,hasta:fecha.iso});
  const {flujos,costos,pendientes}=historial;
  const bloqueo=pendientes.some(p=>['fecha_invalida','cuenta_no_usd','flujo_pendiente','perimetro_inversion_ambiguo'].includes(p.codigo));
  const sumar=(filas,campo)=>filas.some(f=>numero(f[campo])===null)?null:filas.reduce((s,f)=>s+Number(f[campo]),0);
  const aportesUSD=bloqueo?null:sumar(flujos,'monto'),aportesPEN=bloqueo?null:sumar(flujos,'soles');
  const costosUSD=bloqueo?null:sumar(costos,'usd'),costosPEN=bloqueo?null:sumar(costos,'soles');
  const capitalUSD=aportesUSD!==null&&costosUSD!==null?aportesUSD+costosUSD:null;
  const capitalPEN=aportesPEN!==null&&costosPEN!==null?aportesPEN+costosPEN:null;
  const hayFlujos=flujos.length>0;
  const totalOk=hayFlujos&&capitalPEN!==null&&aportesUSD!==null;
  const exacto=totalOk&&capitalUSD!==null;
  const inversionBrutaUSD=hayFlujos&&aportesUSD!==null?valor-aportesUSD:null;
  const inversionUSD=hayFlujos&&capitalUSD!==null?valor-capitalUSD:null;
  const valorPEN=valor*tc,total=totalOk?centimos(valorPEN-capitalPEN):null;
  const inversionPEN=exacto?centimos(inversionUSD*tc):null;
  const inversionBrutaPEN=inversionBrutaUSD===null?null:centimos(inversionBrutaUSD*tc);
  const atribucionOk=totalOk&&inversionBrutaPEN!==null;
  const cambioAportes=hayFlujos&&aportesUSD!==null&&aportesPEN!==null
    ? totalOk?centimos(total-inversionBrutaPEN+centimos(costosPEN)):centimos(aportesUSD*tc-aportesPEN):null;
  // La resta mantiene que las cantidades mostradas sumen exactamente incluso
  // con cierres IBKR que conservan más de dos decimales.
  const cambio=exacto?centimos(total-inversionPEN):null;
  const denominador=totalOk&&capitalPEN>0?capitalPEN:null;
  return{...base,ok:exacto,atribucionOk,totalOk,fecha:fecha.iso,tcActual:tc,pendientes,
    valorUSD:valor,valorPEN:centimos(valorPEN),
    aportesUSD:aportesUSD===null?null:centimos(aportesUSD),aportesPEN:aportesPEN===null?null:centimos(aportesPEN),
    costosUSD:costosUSD===null?null:centimos(costosUSD),costosPEN:costosPEN===null?null:centimos(costosPEN),
    capitalUSD:capitalUSD===null?null:centimos(capitalUSD),capitalPEN:capitalPEN===null?null:centimos(capitalPEN),
    resultadoInversionUSD:inversionUSD===null?null:centimos(inversionUSD),resultadoInversionPEN:inversionPEN,
    resultadoInversionBrutaUSD:inversionBrutaUSD===null?null:centimos(inversionBrutaUSD),
    resultadoInversionBrutaPEN:inversionBrutaPEN,
    efectoCambioAportesPEN:cambioAportes,
    efectoCambioPEN:cambio,resultadoTotalPEN:total,
    pctTotal:denominador!==null?total/denominador*100:null,
    pctCambioSobreCapital:denominador!==null&&cambio!==null?cambio/denominador*100:null,
    pctInversionSobreCapital:denominador!==null&&inversionPEN!==null?inversionPEN/denominador*100:null,
    pctCambioAportesSobreCapital:denominador!==null&&cambioAportes!==null?cambioAportes/denominador*100:null,
    pctInversionBrutaSobreCapital:denominador!==null&&inversionBrutaPEN!==null?inversionBrutaPEN/denominador*100:null,
    multiplesFechas:new Set([...flujos,...costos].map(f=>f.fecha)).size>1,
    mensaje:exacto?'':!hayFlujos?'No hay aportes registrados para comparar el resultado.':
      totalOk?'El total en soles está confirmado; falta el importe real en dólares de algún costo para separar inversión y cambio.':
      'Falta confirmar algún aporte, retiro o costo histórico para calcular el resultado en soles.'};
}
