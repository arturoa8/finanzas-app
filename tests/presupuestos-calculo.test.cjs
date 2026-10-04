// Cálculo de presupuestos con datos ficticios. Sin red ni Supabase.
// La zona horaria del proceso es Tokio a propósito: los períodos deben
// calcularse en America/Lima aunque el dispositivo esté en otra zona.
process.env.TZ='Asia/Tokyo';
const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();

// Arreglo posicional de transacciones (ver filaTx en transactions.js).
let n=0;
const tx=(fecha,tipo,categoria,monto,extra={})=>{
  const t=[fecha,extra.desc||categoria,categoria,tipo,monto,extra.cuenta||'Yape',extra.id||'tx-'+(++n),
    extra.destino||null,extra.origen||null,extra.moneda||null,extra.montoOriginal??null,extra.tc??null,extra.tc?'manual':null,null,null,extra.costo===true];
  return t;
};
const gasto=(fecha,categoria,monto,extra)=>tx(fecha,'Gasto',categoria,monto,extra);

(async()=>{
  const [c,{datos},transacciones]=await Promise.all([modulo('modules/presupuestos-calculo.js'),modulo('state.js'),modulo('modules/transactions.js')]);
  const consumo=(filas,tipo,inicio)=>c.consumoDelPeriodo(filas,tipo,inicio);
  const casos=[
    ['Día calendario en Lima, sin depender de la zona del dispositivo',()=>{
      assert.equal(c.fechaLima('2026-10-01T04:59:00Z'),'2026-09-30','23:59 en Lima sigue siendo septiembre');
      assert.equal(c.fechaLima('2026-10-01T05:00:00Z'),'2026-10-01');
      assert.equal(c.fechaLima('2026-10-01T00:30:00-05:00'),'2026-10-01');
      assert.equal(c.fechaLima('2026-10-01'),'2026-10-01');
      assert.equal(c.fechaLima('02/10/2026, 11:40 p. m.'),'2026-10-02','formato heredado de Sheets');
      assert.equal(c.fechaLima('no es fecha'),null);
      assert.equal(c.hoyLima(Date.parse('2026-10-04T03:00:00Z')),'2026-10-03','hoy en Lima a las 22:00 del 3');
    }],
    ['Semanas de lunes a domingo y meses calendario, también al cambiar de año',()=>{
      assert.equal(c.inicioPeriodo('semanal','2026-10-04'),'2026-09-28','domingo pertenece a la semana del lunes anterior');
      assert.equal(c.inicioPeriodo('semanal','2026-09-28'),'2026-09-28');
      assert.equal(c.inicioPeriodo('semanal','2026-01-01'),'2025-12-29','la primera semana de 2026 empieza en 2025');
      assert.equal(c.inicioPeriodo('mensual','2026-10-31'),'2026-10-01');
      assert.equal(c.moverPeriodo('mensual','2026-12-01',1),'2027-01-01');
      assert.equal(c.moverPeriodo('mensual','2026-01-01',-1),'2025-12-01');
      assert.equal(c.moverPeriodo('mensual','2026-01-01',-13),'2024-12-01');
      assert.equal(c.moverPeriodo('semanal','2025-12-29',1),'2026-01-05');
      assert.equal(c.ultimoDia('mensual','2028-02-01'),'2028-02-29','febrero bisiesto');
      assert.equal(c.rangoPeriodo('semanal','2026-09-28'),'28 sep – 4 oct 2026');
      assert.equal(c.rangoPeriodo('semanal','2025-12-29'),'29 dic 2025 – 4 ene 2026');
      assert.equal(c.rangoPeriodo('mensual','2026-10-01'),'1 – 31 oct 2026');
      assert.equal(c.rangoPeriodo('semanal','2026-10-05'),'5 – 11 oct 2026');
      assert.equal(c.nombrePeriodo('semanal','2026-09-28','2026-10-03'),'Esta semana');
      assert.equal(c.nombrePeriodo('semanal','2026-09-21','2026-10-03'),'Semana anterior');
      assert.equal(c.nombrePeriodo('mensual','2026-10-01','2026-10-03'),'Este mes');
      assert.equal(c.nombrePeriodo('mensual','2026-07-01','2026-10-03'),'Julio 2026');
      assert.equal(c.nombrePeriodo('mensual','2026-10-01',null),'Octubre 2026');
    }],
    ['Gastos dentro y fuera de cada período, en el borde de medianoche de Lima',()=>{
      const filas=[gasto('2026-10-01T04:59:00Z','Compras',10),gasto('2026-10-01T05:00:00Z','Compras',20),
        gasto('2026-10-31T23:00:00-05:00','Compras',30),gasto('2026-11-01T05:00:00Z','Compras',40)];
      assert.equal(consumo(filas,'mensual','2026-09-01').total,1000);
      assert.equal(consumo(filas,'mensual','2026-10-01').total,5000);
      assert.equal(consumo(filas,'mensual','2026-11-01').total,4000);
    }],
    ['Una semana que cruza meses y años tiene su propio consumo',()=>{
      const filas=[gasto('2026-09-27T12:00:00-05:00','Ocio',5),gasto('2026-09-29T12:00:00-05:00','Ocio',12.5),gasto('2026-10-03T12:00:00-05:00','Ocio',7.25),gasto('2026-10-05T00:00:00-05:00','Ocio',100),
        gasto('2025-12-30T12:00:00-05:00','Ocio',8),gasto('2026-01-02T12:00:00-05:00','Ocio',9)];
      assert.equal(consumo(filas,'semanal','2026-09-28').total,1975,'lunes 28 sep a domingo 4 oct');
      assert.equal(consumo(filas,'mensual','2026-09-01').total,1750);
      assert.equal(consumo(filas,'mensual','2026-10-01').total,10725);
      assert.equal(consumo(filas,'semanal','2025-12-29').total,1700,'la semana del 29 dic 2025 incluye el 2 de enero');
      assert.equal(consumo(filas,'mensual','2026-01-01').total,900);
    }],
    ['Gastos con tarjeta en la fecha del consumo; su pago no es un gasto nuevo',()=>{
      const compra=gasto('2026-09-30T20:00:00-05:00','Compras',300,{cuenta:'Visa Bfree'});
      Object.assign(datos,{transacciones:[compra],pagosTarjetas:[['Visa Bfree','2026-10-05',300,'2026-10-20T12:00:00-05:00',null,'Plin','p-1']]});
      assert.equal(consumo(datos.transacciones,'mensual','2026-09-01').total,30000,'cuenta en septiembre, cuando se compró');
      assert.equal(consumo(datos.transacciones,'mensual','2026-10-01').total,0,'pagar la tarjeta en octubre no consume presupuesto');
    }],
    ['Reembolsos parciales, completos y recibidos en otro período',()=>{
      const parcial=gasto('2026-09-10T12:00:00-05:00','Compras',100,{id:'parcial'}),completo=gasto('2026-09-11T12:00:00-05:00','Compras',80,{id:'completo'});
      const filas=[parcial,completo,
        tx('2026-09-12T12:00:00-05:00','Reembolso','Compras',30,{origen:'parcial'}),
        tx('2026-10-02T12:00:00-05:00','Reembolso','Compras',80,{origen:'completo'})];
      const sep=consumo(filas,'mensual','2026-09-01');
      assert.equal(sep.total,7000,'100−30 y 80−80: el reembolso de octubre libera septiembre');
      assert.equal(sep.porCategoria.get('compras').total,7000);
      assert.equal(consumo(filas,'mensual','2026-10-01').total,0,'el reembolso no es un gasto negativo en octubre');
      assert.equal(consumo(filas,'semanal','2026-09-28').total,0);
    }],
    ['Fridays: gasto S/47.60, recibe S/50 → consumo neto S/0 y los S/2.40 no amplían el límite',()=>{
      const fridays=gasto('2026-10-02T19:00:00-05:00','Comer afuera',47.60,{id:'fridays',cuenta:'Mastercard Platinum',desc:'Fridays'});
      const otro=gasto('2026-10-02T21:00:00-05:00','Comer afuera',20);
      // Lo que guarda la app (reembolsos-fridays.test.cjs): reembolso por lo
      // pendiente y el resto como ingreso sin vínculo.
      const filas=[fridays,otro,tx('2026-10-03T09:00:00-05:00','Reembolso','Comer afuera',47.60,{origen:'fridays'}),
        tx('2026-10-03T09:00:00-05:00','Ingreso','Otros ingresos',2.40,{desc:'Excedente de Reembolso Fridays'})];
      const r=consumo(filas,'semanal','2026-09-28');
      assert.equal(r.porCategoria.get('comer afuera').total,2000,'Fridays queda en 0; solo cuenta el otro gasto');
      assert.equal(r.total,2000,'S/20.00, no S/17.60: el excedente no descuenta otros gastos');
      const limite=c.estadoPresupuesto(r.porCategoria.get('comer afuera').total,10000);
      assert.equal(limite.disponible,8000,'quedan S/80.00 de S/100.00');
    }],
    ['Gastos en dólares con el equivalente histórico; sin equivalente, cálculo incompleto',()=>{
      const usd=gasto('2026-10-01T12:00:00-05:00','Suscripciones',37.50,{moneda:'USD',montoOriginal:10,tc:3.75,id:'netflix'});
      const sinTc=gasto('2026-10-02T12:00:00-05:00','Suscripciones',38,{moneda:'USD',montoOriginal:10,tc:null});
      const filas=[usd,tx('2026-10-05T12:00:00-05:00','Reembolso','Suscripciones',18.75,{origen:'netflix',moneda:'USD',montoOriginal:5,tc:3.75})];
      let r=consumo(filas,'mensual','2026-10-01');
      assert.equal(r.total,1875,'US$10 a 3.75 menos US$5 a 3.75, en soles registrados');
      assert.equal(r.incompletos,0);
      r=consumo([...filas,sinTc],'mensual','2026-10-01');
      assert.equal(r.total,1875,'no se inventa la conversión del gasto sin tipo de cambio');
      assert.equal(r.incompletos,1);
      assert.equal(r.porCategoria.get('suscripciones').incompletos,1);
    }],
    ['Transferencias, compra de dólares, aportes a IBKR e ingresos no consumen presupuesto',()=>{
      const filas=[
        tx('2026-10-01T12:00:00-05:00','Transferencia','Compra Dólares',3750,{destino:'BCP Dólares'}),
        tx('2026-10-01T12:00:00-05:00','Transferencia','Inversión IBKR',2000,{destino:'IBKR'}),
        tx('2026-10-01T12:00:00-05:00','Transferencia','Transferencias',50,{destino:'Plin'}),
        tx('2026-10-01T12:00:00-05:00','Ingreso','Salario',5000),
        gasto('2026-10-02T12:00:00-05:00','Comer afuera',35),
        gasto('2026-10-03T12:00:00-05:00','Inversiones',4.5,{costo:true,desc:'Comisión de la transferencia al bróker'}),
        gasto('2026-10-03T12:00:00-05:00','Diferencia de cambio',1.2,{cuenta:''})];
      const r=consumo(filas,'mensual','2026-10-01');
      assert.equal(r.total,4070,'solo los registrados como Gasto: 35 + 4.50 + 1.20');
      assert.equal(r.gastos,3);
    }],
    ['General y por categoría observan los mismos gastos sin sumarse',()=>{
      const filas=[gasto('2026-09-29T12:00:00-05:00','Comer afuera',60),gasto('2026-10-01T12:00:00-05:00','Comer afuéra',25),gasto('2026-10-02T12:00:00-05:00','Auto',90)];
      const presupuestos=[c.filaPresupuesto({id:'g',ambito:'general',categoria:null,periodo:'mensual',inicio:'2026-10-01',recurrente:true,monto_limite:1000,serie_id:'g'}),
        c.filaPresupuesto({id:'w',ambito:'categoria',categoria:'Comer afuera',periodo:'semanal',inicio:'2026-09-28',recurrente:true,monto_limite:100,serie_id:'w'})];
      const mes=consumo(filas,'mensual','2026-10-01'),semana=consumo(filas,'semanal','2026-09-28');
      const general=c.presupuestoVigente(presupuestos,'general',null,'mensual','2026-10-01'),comer=c.presupuestoVigente(presupuestos,'categoria','comer afuéra','semanal','2026-09-28');
      assert.equal(c.consumoDe(mes,general).total,11500,'el mes cuenta 25 + 90; el 29 sep es de septiembre');
      assert.equal(c.consumoDe(semana,comer).total,8500,'"Comer afuéra" es la misma categoría');
      assert.equal(semana.total,17500,'el total de la semana es la suma de gastos, no general + categoría');
      assert.equal(c.presupuestosDelPeriodo(presupuestos,'mensual','2026-10-01').length,1,'el semanal no aparece en la vista mensual');
    }],
    ['Repetición y ajustes: cada período usa el límite que le correspondía',()=>{
      const filas=[
        {id:'v1',ambito:'general',periodo:'mensual',inicio:'2026-09-01',fin:'2026-11-01',recurrente:true,monto_limite:2000,serie_id:'s'},
        {id:'ajuste',ambito:'general',periodo:'mensual',inicio:'2026-10-01',fin:'2026-11-01',recurrente:false,monto_limite:1500,serie_id:'s'},
        {id:'v2',ambito:'general',periodo:'mensual',inicio:'2026-11-01',fin:null,recurrente:true,monto_limite:1800,serie_id:'s'},
        {id:'sem',ambito:'categoria',categoria:'Ocio',periodo:'semanal',inicio:'2026-09-28',fin:'2026-10-19',recurrente:true,monto_limite:50,serie_id:'sem'},
      ].map(c.filaPresupuesto);
      const limite=(tipo,inicio,ambito='general',cat=null)=>c.presupuestoVigente(filas,ambito,cat,tipo,inicio)?.[1]??null;
      assert.equal(limite('mensual','2026-08-01'),null,'antes de empezar no hay límite');
      assert.equal(limite('mensual','2026-09-01'),2000);
      assert.equal(limite('mensual','2026-10-01'),1500,'el ajuste de un período manda');
      assert.equal(limite('mensual','2026-11-01'),1800,'"este período y los siguientes" no cambia septiembre ni octubre');
      assert.equal(limite('mensual','2027-06-01'),1800,'se renueva sin fecha de término');
      assert.equal(limite('semanal','2026-10-12','categoria','ocio'),50);
      assert.equal(limite('semanal','2026-10-19','categoria','ocio'),null,'dejó de repetirse desde el 19 oct');
      assert.equal(c.reglaDeSerie(filas,c.presupuestoVigente(filas,'general',null,'mensual','2026-10-01'),'2026-10-01')[3],'v1');
      assert.equal(c.presupuestosDelPeriodo(filas,'mensual','2026-10-01')[0][3],'ajuste');
    }],
    ['Los presupuestos guardados con el formato anterior se conservan',()=>{
      const viejo=c.filaPresupuesto({id:'viejo',categoria:'Comer afuera',monto_limite:'300.00',mes:'2026-08-15'});
      assert.deepEqual(viejo,['Comer afuera',300,'2026-08-15','viejo','categoria','mensual','2026-08-01','2026-09-01',false,'viejo']);
      assert.equal(c.presupuestoVigente([viejo],'categoria','Comer afuera','mensual','2026-08-01')[1],300);
      assert.equal(c.presupuestoVigente([viejo],'categoria','Comer afuera','mensual','2026-09-01'),null,'un presupuesto de un mes no se repite');
      const migrado=c.filaPresupuesto({id:'m',categoria:'Compras',monto_limite:500,mes:'2026-09-01',ambito:'categoria',periodo:'mensual',inicio:'2026-09-01',fin:'2026-10-01',recurrente:false,serie_id:'m'});
      assert.deepEqual(migrado.slice(0,3),['Compras',500,'2026-09-01'],'índices 0-2 iguales que antes para categorías y respaldo');
    }],
    ['Estados por porcentaje real, con la barra limitada a 100',()=>{
      const e=(g,l)=>c.estadoPresupuesto(g,l);
      assert.deepEqual([e(6000,10000).estado,e(6000,10000).pctTexto,e(6000,10000).disponible],['normal','60',4000]);
      assert.equal(e(7999,10000).estado,'normal');
      assert.equal(e(8000,10000).estado,'cerca','desde el 80 %');
      assert.deepEqual([e(9999,10000).estado,e(9999,10000).pctTexto],['cerca','99'],'99.99 % no se redondea a 100');
      assert.deepEqual([e(10000,10000).estado,e(10000,10000).pctTexto,e(10000,10000).disponible],['alcanzado','100',0]);
      const sobre=e(12550,10000);
      assert.deepEqual([sobre.estado,sobre.pctTexto,sobre.exceso,sobre.barra],['excedido','125',2550,100]);
      assert.equal(e(10020,10000).pctTexto,'100.2');
      assert.equal(e(1000001,1000000).pctTexto,'más de 100','un céntimo de exceso no se muestra como 100 %');
    }],
    ['Importes con precisión de céntimos',()=>{
      const filas=[gasto('2026-10-01','Compras',0.1),gasto('2026-10-01','Compras',0.2),gasto('2026-10-02','Compras',33.33),gasto('2026-10-02','Compras',33.33),gasto('2026-10-02','Compras',33.33)];
      const r=consumo(filas,'mensual','2026-10-01');
      assert.equal(r.total,10029,'0.10 + 0.20 + 3 × 33.33 = 100.29 exactos');
      assert.equal(c.estadoPresupuesto(9999,10000).estado,'cerca');
    }],
    ['El consumo coincide con gastoNeto() de la app en cada gasto',()=>{
      const filas=[gasto('2026-10-01','Compras',100,{id:'a'}),gasto('2026-10-02','Comer afuera',47.6,{id:'b'}),gasto('2026-10-03','Auto',12.34,{id:'c'}),
        tx('2026-10-04','Reembolso','Compras',30.01,{origen:'a'}),tx('2026-10-05','Reembolso','Comer afuera',47.6,{origen:'b'}),tx('2026-11-05','Reembolso','Auto',2.34,{origen:'c'})];
      datos.transacciones=filas;
      for(const t of filas.filter(t=>t[3]==='Gasto')){
        const propio=consumo([t,...filas.filter(x=>x[3]==='Reembolso')],'mensual','2026-10-01').total;
        assert.equal(propio,Math.round(transacciones.gastoNeto(t)*100),'misma regla que Estadísticas para '+t[6]);
      }
    }],
  ];
  let fallos=0;
  for(const [nombre,fn] of casos){try{fn();console.log('PASS: '+nombre+'.');}catch(e){fallos++;console.error('FAIL: '+nombre+'\n'+e.stack);}}
  assert.equal(fallos,0,'todas las reglas de presupuestos deben cumplirse');
})().catch(e=>{console.error(e);process.exitCode=1;});
