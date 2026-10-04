# Finanzas Modular

Aplicación de finanzas personales publicada en https://arturoa8.github.io/finanzas-app/.

## Versión 2026.10.04.01

- El calendario conserva el tamaño de sus celdas en los meses sin movimientos y mantiene «Aplicar» visible al desplazarse dentro del modal.
- Estadísticas separa «Resumen» y «Presupuestos» en pestañas, con navegación mediante teclado.
- Configuración agrupa cuentas, categorías, preferencias y datos en secciones desplegables; las explicaciones extensas se consultan bajo demanda.
- Patrimonio conserva el tamaño de la tarjeta mientras carga los valores.

## Versión 2026.10.03.16

- Presupuestos en Estadísticas: general o por categoría, mensuales (mes calendario) o semanales (lunes a domingo), con repetición. Cada tarjeta muestra gastado, límite, porcentaje real, disponible o exceso, y avisa desde el 80 %.
- El consumo es el gasto neto de reembolsos en la fecha del consumo, en hora de Lima. Pagos de tarjeta, transferencias, compras de dólares, aportes a IBKR e ingresos no lo consumen; el excedente de un reembolso no amplía el límite.
- Editar uno que se repite distingue entre "solo este período" y "este período y los siguientes"; dejar de repetirlo conserva los límites de los períodos anteriores. Los presupuestos se guardan en Supabase y se comparten entre dispositivos.

## Versión 2026.10.03.1

- Inicio prepara movimientos y portafolio en paralelo. Precarga las curvas de 1 día, 1 semana y 1 mes antes de abrir esa pestaña.
- La preparación se retira al terminar; si las cotizaciones tardan más de ocho segundos, permite usar Inicio y continúa descargándolas en segundo plano.
- Los períodos se mantienen preparados mientras la app está visible. Las consultas simultáneas se comparten y se conserva la última curva válida durante una actualización.
- Un gráfico pendiente muestra su estado de carga; no presenta cierres diarios provisionales como si fueran la curva intradía final.
- Mitigación del desplazamiento inicial en iPhone instalado: antes de retirar la cubierta se desplaza un píxel y vuelve al origen para actualizar la vista de WebKit. Conserva las áreas seguras nativas y no interviene mientras se usa la aplicación. Pendiente de confirmar en el iPhone afectado.

## Versión 2026.10.02

- Descarga de movimientos CSV y respaldo JSON desde Configuración.
- Explicación de Período, Acumulado, Neto y Patrimonio en Configuración → Balances.
- Comparaciones con el banco guardadas por usuario en este navegador, con fecha.
- Bloqueo del formulario de movimientos cuando la carga de cuentas falla, conservando los campos en dólares.
- Renovación compartida de la sesión para cargas simultáneas.
- Abonos con UUID estable y registro de recuperación local antes de escribir. Crear, editar y eliminar se recuperan al pulsar Actualizar o abrir de nuevo la aplicación. Un aviso persiste mientras falta confirmar la operación.
- Portafolio muestra carga durante la primera consulta intradía, inicia los precios antes de las consultas auxiliares y conserva la curva válida al volver a la pestaña.
- Fechas de corte y pago ajustadas al último día del mes, incluidos febrero y años bisiestos.
- Paginación que continúa cuando la API reduce el tamaño de respuesta y detecta filas repetidas.

El registro de abonos evita duplicados al reintentar desde el mismo navegador. La API sigue haciendo escrituras en dos tablas; no sustituye una transacción PostgreSQL. Si una operación queda pendiente, hay que recuperarla en ese navegador antes de registrar otra. Esta versión no aplica migraciones ni modifica las políticas de Supabase.

El respaldo JSON contiene los datos financieros de las tablas principales ya cargadas; no incluye contraseña, sesión, historial IBKR, cotizaciones ni comparaciones guardadas en el navegador. La aplicación todavía no ofrece importar este respaldo.

## Pruebas

Con Node.js 22 o posterior:

```sh
npm ci --ignore-scripts
npm test
```

Las pruebas usan datos sintéticos y no se conectan a Supabase. Verifican los módulos publicados y se ejecutan en GitHub Actions.

## Restaurar la versión anterior

La rama `codex/respaldo-20261002` conserva el commit `6c54f4dfa0b647426d758216684e0265091ad7a3`. La restauración se hace con un nuevo commit que reponga el árbol anterior en `main`, conservando el historial y activando una nueva publicación de Pages. No requiere borrar datos ni cambiar la base de datos.
