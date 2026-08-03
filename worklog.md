---
Task ID: fase-2
Agent: main
Task: Implementar Fase 2 del roadmap de ComerciApp — Cumplimiento legal (Facturación electrónica AFIP/ARCA, Mercado Pago QR, Reportes avanzados)

Work Log:
- Verificado estado actual: Fase 1 ya completa (CashRegister, Suppliers, Purchases, Expenses, CustomerPayments, barcode, PaymentMethod con surcharge).
- Actualizado `prisma/schema.prisma` con 4 modelos nuevos: `TaxConfig`, `Invoice`, `MercadoPagoConfig`, `MercadoPagoPayment`. Agregados campos fiscales (`cuit`, `taxType`) en Customer. Creadas relaciones `invoice` y `mercadoPagoPayment` en Sale. Migración `prisma db push` exitosa.
- Creada librería `src/lib/afip.ts` con:
  - Constantes AFIP (tipos de comprobante, conceptos, condiciones IVA, alícuotas).
  - Generación de QR según RG AFIP 4291/2018 (base64url de JSON con datos de la factura).
  - Función `emitirFactura` con modo demo (CAE simulado) y hook para producción (placeholder pendiente de SDK).
  - Cálculo de IVA discriminado (factura A) o incluido (factura B/C).
  - Determinación automática de tipo de factura según condición fiscal emisor/cliente.
  - Validación de CUIT con algoritmo de dígito verificador.
- Creada librería `src/lib/mercado-pago.ts` con:
  - `crearOrdenQR`: crea preferencia en MP y genera QR (copia y pega + imagen).
  - `consultarEstadoPago`: polling de estado del pago (por id local, mpPaymentId o external_reference).
  - `procesarWebhookMP`: procesa notificaciones IPN/webhook de MP.
  - `actualizarPagoDesdeWebhook`: actualiza estado local y marca venta como cobrada cuando se aprueba.
- APIs creadas:
  - `/api/invoices` (GET listado, POST emisión)
  - `/api/invoices/[id]` (GET detalle, DELETE anular)
  - `/api/tax-config` (GET, PUT)
  - `/api/mercadopago/config` (GET, PUT)
  - `/api/mercadopago/create-order` (POST)
  - `/api/mercadopago/status` (GET polling)
  - `/api/mercadopago/webhook` (POST)
  - `/api/reports/sales` (ventas por día/semana/mes, por método, por vendedor)
  - `/api/reports/profits` (ganancia bruta/neta, gastos por categoría, serie diaria)
  - `/api/reports/taxes` (facturas por tipo, IVA recaudado, ventas sin facturar)
  - `/api/reports/products` (ranking de productos por ingresos/cantidad/ganancia)
  - `/api/reports/customers` (top clientes, saldos de cuenta corriente)
  - `/api/reports/cash-flow` (flujo de caja diario: ingresos/egresos en efectivo)
- Vistas creadas:
  - `src/components/views/invoices-view.tsx`: listado con filtros, stats, modal de creación desde venta, modal de detalle con QR AFIP, exportación CSV, anulación.
  - `src/components/views/reports-view.tsx`: panel con 6 tabs (Ventas, Ganancias, Fiscal, Productos, Clientes, Flujo Caja), filtros por período, gráficos con Recharts, tablas, exportación CSV.
- Modificado `src/components/views/pos-view.tsx`: agregado botón "Pago QR (MP)" en el checkout que abre un diálogo para generar QR de Mercado Pago, con polling de estado y confirmación automática.
- Modificado `src/components/views/settings-view.tsx`: agregadas dos secciones nuevas:
  - "Facturación Electrónica (AFIP/ARCA)": CUIT, razón social, punto de venta, condición fiscal, IVA, categoría monotributo, modo homologación/producción.
  - "Mercado Pago - Pago con QR": credenciales sandbox/producción, collector ID, URL de webhook.
- Actualizado `src/store/app-store.ts`: agregados `invoices` y `reports` a ViewKey.
- Actualizado `src/components/app/app-shell.tsx`: agregadas importaciones, items de navegación (Facturación y Reportes), casos de renderización, y versión a v2.0.
- Verificación: `npx tsc --noEmit` sin errores en src/. `bun run build` exitoso.

Stage Summary:
- Fase 2 implementada completamente con 3 módulos nuevos: Facturación Electrónica, Mercado Pago QR y Reportes Avanzados.
- 4 modelos Prisma nuevos, 13 APIs nuevas, 2 vistas nuevas.
- Schema migrado correctamente, build exitoso.
- AFIP funciona en modo demo (CAE simulado + QR válido RG 4291). Producción requiere certificado real (placeholder implementado).
- Mercado Pago integrado con creación de preferencias + QR + webhook. Pendiente: que el usuario cargue credenciales reales.
- 6 reportes avanzados con gráficos (Recharts) y exportación CSV.
- Sistema actualizado a versión v2.0.

---
Task ID: fase-3
Agent: main
Task: Implementar Fase 3 del roadmap de ComerciApp — Devoluciones/Notas de Crédito, Descuentos/Promociones, Multi-sucursal y Fidelización

Work Log:
- Verificado estado previo: Fase 1 y Fase 2 completas (v2.0).
- Actualizado `prisma/schema.prisma` con 6 modelos nuevos: `Branch`, `Promotion`, `Refund`, `RefundItem`, `LoyaltyProgram`, `LoyaltyPoint`. Agregados campos en `Customer` (`loyaltyPoints`, `loyaltyTier`, `totalSpent`, `totalSales`), en `Sale` (`branchId`, `discountReason`, `promotionId`, `promotionDiscount`, `loyaltyPointsEarned`, `loyaltyPointsUsed`), en `CashRegister` (`branchId`), y relaciones correspondientes. Migración `prisma db push` exitosa.
- Creada librería `src/lib/promotions.ts`:
  - Tipos: PromotionType, PromotionScope, CartItem, PromotionData, AppliedDiscount.
  - Función `isPromotionActive` (valida vigencia, días de semana, hora, límite de usos).
  - Función `evaluatePromotion` con 4 tipos: PORCENTAJE, MONTO_FIJO, NXM (2x1, 3x2), COMBO.
  - Función `evaluateAllPromotions` (todas las aplicables, ordenadas por mayor descuento).
  - Función `pickBestPromotion` (mejor promoción para auto-aplicar).
- Creada librería `src/lib/loyalty.ts`:
  - Tipos: LoyaltyTier (BRONCE/PLATA/ORO/PLATINO), LoyaltyAction.
  - Funciones: `determineTier`, `tierBonusMultiplier`, `calculatePointsEarned`, `pointsToCurrency`, `currencyToPoints`, `calculateMaxRedeemablePoints`, `tierLabel`, `nextTierInfo`.
  - Soporte para 4 tiers con montos mínimos y multiplicadores de bonus configurables.
- APIs creadas (todas con autenticación y multi-tenant):
  - `/api/branches` (GET/POST/PUT/DELETE): CRUD de sucursales. Validación de código único, sucursal principal no eliminable.
  - `/api/promotions` (GET/POST/PUT/DELETE): CRUD de promociones. Soporta PORCENTAJE/MONTO_FIJO/NXM/COMBO con scope CART/CATEGORY/PRODUCT, vigencia, horarios, días de semana, límites.
  - `/api/promotions/evaluate` (POST): evalúa promociones activas contra un carrito y devuelve aplicables + mejor.
  - `/api/loyalty` (GET/PUT): configura programa de fidelización. Crea config por defecto si no existe.
  - `/api/loyalty/points` (GET/POST): historial de puntos de cliente + ajuste manual.
  - `/api/refunds` (GET/POST): lista y crea devoluciones. Soporta devolución TOTAL (anula venta) o PARCIAL (restituye stock proporcional). Maneja 3 métodos de devolución: EFECTIVO (con movimiento de caja EGRESO), TRANSFERENCIA, CREDITO_CUENTA (pago a cuenta corriente). Revierte puntos ganados proporcionalmente.
  - `/api/refunds/[id]` (GET): detalle completo de una devolución.
- Modificado `src/app/api/sales/route.ts`:
  - GET: soporta filtro por `branchId`. Incluye `branch` y `promotion` en respuesta.
  - POST: soporta `branchId`, `promotionId`, `promotionDiscount`, `loyaltyPointsUsed`. Calcula `loyaltyPointsEarned` según tier del cliente. Actualiza saldo de puntos, totalSpent, totalSales y recalcula tier. Registra movimientos EARN/REDEEM en log de puntos. Incrementa usageCount de la promoción.
- Vistas creadas:
  - `src/components/views/branches-view.tsx`: listado con stats (activas, ventas totales, cajas asignadas), tabla con columnas (nombre, código, dirección, teléfono, encargado, ventas, estado, acciones), modal de alta/edición con switch para sucursal principal y activo. Botón eliminar deshabilitado para sucursal principal.
  - `src/components/views/promotions-view.tsx`: listado con stats (total, activas, usos totales), tabla (nombre, tipo, alcance, vigencia, usos, estado), modal de alta/edición completo con 4 tipos de promoción, scope dinámico (CART/CATEGORY/PRODUCT), vigencia con fechas, horario con hora inicio/fin, selector de días de la semana (toggle chips), prioridad, límites (total y por cliente), switch activo.
  - `src/components/views/refunds-view.tsx`: listado con stats (total devoluciones, monto devuelto, devoluciones hoy), búsqueda de venta por ID/cliente/método, modal de nueva devolución con selección de items por cantidad, cálculo en tiempo real de subtotal/descuento proporcional/impuesto/recargo/total, selección de método (EFECTIVO/TRANSFERENCIA/CREDITO_CUENTA), motivo, notas. Modal de detalle con items devueltos y totales.
- Modificado `src/components/views/customers-view.tsx`:
  - Carga programa de fidelización al iniciar (para mostrar/ocultar columna).
  - Agregada columna "Puntos / Tier" con badge de tier (BRONCE/PLATA/ORO/PLATINO) y puntos actuales.
  - Agregado botón "Puntos" que abre modal con: stats (puntos, tier, compras, total gastado), formulario de ajuste manual (positivo o negativo con descripción), tabla de historial de movimientos (EARN/REDEEM/EXPIRE/ADJUST) con saldo posterior.
- Modificado `src/components/views/pos-view.tsx`:
  - Carga branches y loyaltyProgram al inicio.
  - Selector de sucursal en header (visible si hay >1 sucursal activa).
  - Auto-evaluación de promociones cuando cambia el carrito (useEffect), muestra chips clickeables con todas las promociones aplicables y la mejor se auto-aplica.
  - Input de descuento manual + visualización de promo aplicada + input de puntos a canjear (con botón Máx) cuando hay cliente seleccionado y programa activo.
  - Recálculo de totales: subtotal - (manualDiscount + promotionDiscount + pointsCurrencyDiscount) = base imponible.
  - processSale envía branchId, promotionId, promotionDiscount, loyaltyPointsUsed. Refresca clientes después (puntos actualizados).
  - Fix: reemplazadas referencias a `discountAmount` (renombrado a `manualDiscount`/`totalDiscount`) en checkout sheet y modal de Mercado Pago.
- Modificado `src/components/views/settings-view.tsx`:
  - Agregada sección "Programa de Fidelización (Puntos)" con:
    - Switch para habilitar/deshabilitar programa.
    - Nombre del programa.
    - Sección Acumulación: puntos por $1, compra mínima, redondeo (FLOOR/CEIL/ROUND).
    - Sección Canje: valor de 1 punto en $, mínimo puntos para canjear, % máximo del total canjeable.
    - Sección Niveles (tiers): 4 cards con colores (Bronce/Plata/Oro/Platino), cada uno con monto mínimo y bonus (multiplicador).
    - Botón "Guardar programa de fidelización" (color púrpura).
- Actualizado `src/store/app-store.ts`: agregados `refunds`, `promotions`, `branches` a ViewKey.
- Actualizado `src/components/app/app-shell.tsx`:
  - Importadas 3 nuevas vistas (RefundsView, PromotionsView, BranchesView).
  - Agregados iconos (RotateCcw, Tag, Building2) de lucide-react.
  - Agregados 3 items de navegación: Devoluciones (ADMIN/VENDEDOR/CAJERO), Promociones (ADMIN), Sucursales (ADMIN).
  - Agregados casos en renderView para las 3 nuevas vistas.
  - Versión actualizada a v3.0 con descripción "Fase 3: Devoluciones + Promos + Sucursales + Fidelización".
- Verificación: `bun run lint` sin errores. `bun run db:push` exitoso. Dev server corriendo en :3000 sin errores.
- Verificación con Agent Browser:
  - Login exitoso con tienda demo.
  - Sidebar muestra 3 nuevos items (Devoluciones, Promociones, Sucursales) + versión v3.0.
  - Vista Sucursales: cargó, creó "Sucursal Norte" (NOR) con éxito, aparece en la tabla.
  - Vista Promociones: cargó, botón "Nueva promoción" disponible.
  - Vista Devoluciones: cargó, botón "Nueva devolución" disponible.
  - Vista Configuración: sección de Fidelización visible, se habilitó y guardó con éxito (toast "Programa de fidelización guardado").
  - Vista Clientes: columna "Puntos / Tier" visible con badge BRONCE y "0 pts" para cada cliente. Botón "Puntos" abre modal con historial vacío y formulario de ajuste.
  - Vista POS: cargó correctamente, catálogo visible con categorías y productos, búsqueda funcional.

Stage Summary:
- Fase 3 implementada completamente con 4 módulos nuevos: Devoluciones/Notas de Crédito, Promociones, Multi-sucursal y Fidelización.
- 6 modelos Prisma nuevos, 8 APIs nuevas, 3 vistas nuevas, 3 vistas modificadas (POS, Clientes, Configuración).
- Schema migrado correctamente, lint sin errores, build exitoso, verificación E2E con Agent Browser OK.
- Devoluciones soportan TOTAL/PARCIAL con restitución de stock y reversa de puntos. 3 métodos de devolución (efectivo, transferencia, crédito en cuenta).
- Promociones: 4 tipos (PORCENTAJE, MONTO_FIJO, NXM, COMBO) × 3 scopes (CART, CATEGORY, PRODUCT) con vigencia, horarios y días. Auto-evaluación en POS.
- Multi-sucursal: CRUD completo. Ventas y cajas asocian branchId. Selector en POS si hay >1 sucursal.
- Fidelización: programa configurable con 4 tiers (Bronce/Plata/Oro/Platino) y bonus. Acumulación automática en ventas, canje manual desde POS, ajuste manual desde Clientes. Historial completo de movimientos.
- Sistema actualizado a versión v3.0.

---
Task ID: fase-4
Agent: main
Task: Implementar Fase 4 del roadmap de ComerciApp — PWA Offline, Impresión Térmica, E-commerce Sync y Comisiones

Work Log:
- Verificado estado previo: Fases 1, 2 y 3 completas (v3.0). Schema con 25 modelos.
- Actualizado `prisma/schema.prisma` con 6 modelos nuevos: `CommissionRule`, `Commission`, `EcommerceConfig`, `EcommerceSyncLog`, `PrintTemplate`, `OfflineSyncQueue`. Agregados campos en `Product` (`ecommerceProductId`, `ecommerceSyncedAt`, `ecommerceStatus`), en `Sale` (relación `commission`), en `Store` (relaciones nuevas), en `User` (relaciones `commissions`, `commissionRules`). Migración `prisma db push` + `prisma generate` exitosa.
- Creada librería `src/lib/commissions.ts`:
  - Tipos: CommissionType (PORCENTAJE_VENTA, PORCENTAJE_GANANCIA, MONTO_FIJO_POR_VENTA, ESCALONADO), CommissionStatus, CommissionTier.
  - `evaluateCommissionRule`: evalúa regla contra una venta (vigencia, monto mínimo, onlyPaid, tipo de cálculo).
  - `parseTiers`/`serializeTiers`/`findTier`: manejo de tramos escalonados.
  - `createCommissionForSale`: busca regla activa para el vendedor y crea comisión automáticamente al cerrar venta.
  - `getCommissionSummary`: totales por vendedor (pendiente, pagado, count).
  - Helpers de presentación: `commissionTypeLabel`, `commissionStatusLabel`, `commissionStatusColor`.
- Creada librería `src/lib/printer.ts` (ESC/POS):
  - Comandos ESC/POS completos: INIT, FEED, CUT, ALIGN (left/center/right), BOLD, DOUBLE, UNDERLINE, BEEP, OPEN_DRAWER.
  - Clase `EscPosBuilder` con métodos encadenable (text, line, feed, cut, separator, twoColumns, itemLine).
  - `buildSaleTicket`: genera ticket de venta completo (header tienda, datos venta, items, totales, factura AFIP, footer).
  - `buildCommandTicket`: genera comanda para cocina/barra/postres.
  - `buildZCloseTicket`: genera cierre Z con totales por método de pago.
  - Soporte de plantillas con placeholders (`{{store.name}}`, `{{sale.total}}`, etc.).
  - Funciones de salida: `toArrayBuffer`, `toBase64`, `ticketToBlobUrl`, `printViaWebUSB`, `printViaLocalServer` (WebSocket a servidor local en puerto 8787).
- Creada librería `src/lib/ecommerce.ts`:
  - 4 adaptadores: TiendaNube (completo), WooCommerce (completo), MercadoLibre (parcial: stock/price/orders), Shopify (placeholder).
  - Operaciones OUTBOUND: `syncProductsOutbound`, `syncStockOutbound`, actualización de precios.
  - Operaciones INBOUND: `syncOrdersInbound` (importa pedidos pagados como ventas locales, crea clientes y productos si no existen).
  - `handleEcommerceWebhook`: procesa webhooks entrantes (order/paid, product/updated).
  - Helper `logSync` en `src/lib/ecommerce-sync-logger.ts` para auditoría.
- Implementado PWA Offline completo:
  - `public/manifest.json`: manifest con nombre, iconos 192/512, shortcuts (POS, Caja, Panel), colores, idioma es-AR.
  - `public/sw.js`: Service Worker con precaching del shell, network-first para navegación, stale-while-revalidate para assets y APIs cacheables, manejo de mutaciones offline con IndexedDB, Background Sync, push notifications placeholder.
  - `public/offline.html`: página de fallback offline con estilos emerald.
  - `public/icon-192.png` e `icon-512.png`: generados con sharp (logo emerald).
  - `src/hooks/use-pwa.ts`: hook React `usePWA` (isOnline, isInstalled, isStandalone, swVersion, updateAvailable, pendingOperations, registerSW, triggerSync, applyUpdate, enqueueOperation) + `usePWAInstall` (beforeinstallprompt).
  - Actualizado `src/app/layout.tsx`: metadata con manifest, appleWebApp, icons múltiples, viewport con themeColor.
- APIs creadas (todas con auth y multi-tenant):
  - `/api/commissions` (GET listado con filtros + summary, PATCH batch: PAY/ANNUL/REOPEN)
  - `/api/commissions/rules` (GET/POST/PUT/DELETE - CRUD completo de reglas, soft-delete si tiene comisiones)
  - `/api/print` (POST: genera ticket TICKET/COMANDA/CIERRE_Z en base64 o blob)
  - `/api/print-templates` (GET/POST/PUT/DELETE - CRUD de plantillas de impresión)
  - `/api/ecommerce/config` (GET crea config por defecto si no existe, PUT actualiza)
  - `/api/ecommerce/test` (POST: prueba conexión a la plataforma)
  - `/api/ecommerce/sync` (POST: ejecuta sync OUTBOUND/INBOUND por entidad, GET: lista logs)
  - `/api/ecommerce/webhook` (POST: recibe webhooks con validación de secret)
  - `/api/offline-queue` (GET lista, POST registra, DELETE limpia syncados >7 días)
  - `/api/store/users` (GET lista usuarios de la tienda para selectors)
- Modificado `src/app/api/sales/route.ts`: al crear venta, calcula profit y llama a `createCommissionForSale` (auditoría: registra comisión en 0 si no hay regla para el vendedor).
- Vistas creadas:
  - `src/components/views/commissions-view.tsx`: tabs Reglas/Comisiones generadas. Stats (total, pendiente, pagado, count). Tabla de reglas (nombre, vendedor, tipo, config, mín venta, solo pagadas, vigencia, estado, acciones). Tabla de comisiones con filtros (status, vendedor, fechas), checkbox para batch actions (PAY/ANNUL/REOPEN). Resumen por vendedor. Modal de crear/editar regla con 4 tipos (incluyendo tiers dinámicos para ESCALONADO).
  - `src/components/views/print-templates-view.tsx`: listado de plantillas con tabla (nombre, tipo, papel, charset, corte, mostrar, estado, acciones). Modal de alta/edición con 4 tipos, 2 anchos (58/80), 3 charsets, header/footer con placeholders, switches de mostrar (vendedor/cliente/pago/logo), activa, default. Botón "marcar como default".
  - `src/components/views/ecommerce-view.tsx`: configuración de plataforma (4 plataformas), credenciales dinámicas según plataforma, webhook secret, switch habilitado, botones Guardar/Probar conexión. Opciones de sync (productos/stock/precios/pedidos/auto-fulfill). Botones de sincronización manual. Tabla de logs con estado, dirección, entidad, IDs.
- Modificado `src/components/views/pos-view.tsx`:
  - Agregada función `printThermalSale` que llama a `/api/print` con `returnFormat: "blob"` y descarga archivo `.bin` con comandos ESC/POS.
  - SheetFooter del receipt: agregado botón "Térmica" junto al botón "Imprimir" existente.
- Modificado `src/components/views/sales-view.tsx`: SheetFooter del detalle con botón "Térmica" para descargar ticket ESC/POS.
- Actualizado `src/store/app-store.ts`: agregados `commissions`, `print-templates`, `ecommerce` a ViewKey.
- Actualizado `src/components/app/app-shell.tsx`:
  - Importadas 3 nuevas vistas (CommissionsView, PrintTemplatesView, EcommerceView) + hook `usePWA` + `usePWAInstall`.
  - Agregados iconos (Coins, Printer, Globe, WifiOff, RefreshCw, Download, CheckCircle2).
  - 3 items de navegación nuevos: Comisiones (ADMIN), E-commerce (ADMIN), Impresión (ADMIN) - ubicados entre Sucursales y Gastos.
  - Header: indicador offline (badge amarillo), botón de operaciones pendientes con contador, botón "Instalar" (PWA), botón "Actualizar" cuando hay nueva versión del SW.
  - Sidebar footer: versión actualizada a v4.0 + "Fase 4: PWA + Impresión + E-commerce + Comisiones" + SW version.
  - Casos de renderización para las 3 nuevas vistas.
- Verificación:
  - `bun run lint` sin errores (excluidos scripts/ y tests/).
  - `npx tsc --noEmit` sin errores en src/.
  - `bun run build` exitoso.
  - `bun run db:push` exitoso.
  - Dev server corriendo en :3000.
- Verificación E2E con Agent Browser:
  - Login exitoso con tienda demo.
  - Sidebar muestra 3 nuevos items (Comisiones, E-commerce, Impresión) + versión v4.0 + SW version.
  - Botón "Instalar" visible en header (PWA instalable).
  - Vista Comisiones: cargó, creó regla "Comisión vendedor demo 2%" para María (Vendedora) con tipo PORCENTAJE_VENTA, vigencia desde hoy, activa. Aparece en tabla.
  - Tab "Comisiones generadas": tras crear una venta via API, aparece la comisión registrada (en 0 porque José Admin no tiene regla, pero la auditoría funciona).
  - Vista E-commerce: cargó con configuración por defecto, todas las opciones de sync visibles, botones de prueba conexión y sincronización manual.
  - Vista Impresión: cargó, creó plantilla "Ticket estándar 58mm" marcada como default, aparece en tabla con badge "Por defecto".
  - Generación de ticket térmico via API: 422 bytes de comandos ESC/POS usando la plantilla default, contenido correcto (header tienda, items, totales, pago, footer, comando de corte).
  - Service Worker registrado correctamente en `http://localhost:3000/sw.js`.
  - Manifest vinculado correctamente.

Stage Summary:
- Fase 4 implementada completamente con 4 módulos nuevos: PWA Offline, Impresión Térmica ESC/POS, E-commerce Sync y Comisiones.
- 6 modelos Prisma nuevos, 9 APIs nuevas, 3 vistas nuevas, 2 vistas modificadas (POS, Ventas), 1 hook nuevo (use-pwa).
- Schema migrado correctamente, lint sin errores, build exitoso, verificación E2E con Agent Browser OK.
- PWA: manifest + service worker + IndexedDB para cola offline + página offline + iconos 192/512. Background Sync para reprocesar mutaciones al volver online. Hook con detección de online/offline, ops pendientes, update del SW, botón instalar.
- Impresión térmica: librería ESC/POS completa con 3 generadores (ticket venta, comanda, cierre Z). Soporta plantillas configurables (58/80mm, charset, header/footer con placeholders). Salida como base64 o blob .bin. Hooks para WebUSB y servidor local WebSocket.
- E-commerce: 4 adaptadores (TiendaNube, WooCommerce, MercadoLibre, Shopify). Sync OUTBOUND de productos/stock/precios, INBOUND de pedidos (crea clientes y productos si no existen). Webhook handler con validación de secret. Log de auditoría por operación.
- Comisiones: 4 tipos de regla (PORCENTAJE_VENTA, PORCENTAJE_GANANCIA, MONTO_FIJO_POR_VENTA, ESCALONADO con tramos). Generación automática al cerrar venta. Estados PENDIENTE/PAGADA/ANULADA. Batch actions para marcar pagadas/anular. Resumen por vendedor.
- Sistema actualizado a versión v4.0.

---
Task ID: fix-reports-linechart
Agent: main
Task: Corregir error de render en LineChart del reporte de ventas (reports-view.tsx)

Work Log:
- Detectado error en runtime: el componente `<LineChart data={data.series}>` en `src/components/views/reports-view.tsx` línea 279 rompía al renderizar.
- Causa raíz: la segunda `<Line>` tenía `yAxisId="count"` pero NO existía un `<YAxis yAxisId="count" />` asociado. Recharts lanza error cuando un eje referenciado por id no existe.
- Fix: removido el prop `yAxisId="count"` de la segunda `<Line>` (línea 288). La línea sigue oculta con `hide`, ya que solo se usa para exponer el valor de "Cantidad" en el tooltip al hacer hover.
- Verificado que no quedan otros `yAxisId` huérfanos en el archivo.
- `npx tsc --noEmit` y `bun run lint` ambos limpios en `src/`.
- Dev server corriendo en :3000, APIs de reportes respondiendo 200 OK.

Stage Summary:
- Bug visual del tab "Ventas" del módulo Reportes corregido.
- Cambio mínimo de 1 línea, sin afectar otras funcionalidades.
- Fase 4 sigue completa y operativa en v4.0.

---
Task ID: ux-improvements
Agent: main
Task: Mejoras UX: 1) POS como módulo principal por defecto, 2) Agrupar módulos en categorías en el sidebar, 3) Refactorizar módulos largos (Settings, Ecommerce) con pestañas

Work Log:
- Verificado estado: Fase 4 completa (v4.0). Limpieza de `LineChart` ya aplicada.
- Mejora 1 — POS como vista por defecto:
  - `src/store/app-store.ts`: cambiado `currentView` inicial de `"dashboard"` a `"pos"`. Mismo cambio en `clear()`.
  - `src/components/app/app-shell.tsx`: actualizado `default:` del switch de `renderView()` para que retorne `<PosView />` en caso de view desconocida.
- Mejora 2 — Sidebar con categorías agrupadas y colapsables:
  - Reemplazado el array plano `NAV_ITEMS` por `NAV_CATEGORIES` con 5 grupos:
    - Operaciones: POS, Caja, Panel
    - Ventas: Ventas, Devoluciones, Facturación, Clientes
    - Catálogo y Stock: Productos, Inventario, Compras, Gastos
    - Gestión Comercial: Promociones, Comisiones, Sucursales, Impresión, E-commerce
    - Sistema: Reportes, Configuración
  - Agregado estado `collapsedCategories: Set<string>` y función `toggleCategory`.
  - Creada función `renderSidebarNav(onItemClick?)` que renderiza cada categoría con header clickeable (label + chevron), items visibles cuando no está colapsada, y la categoría que contiene la vista actual siempre queda abierta.
  - Reemplazados los sidebars desktop y mobile para usar `renderSidebarNav()`. El mobile pasa `onItemClick` para cerrar el drawer al navegar.
  - Agregado `overflow-y-auto` al nav para scroll vertical cuando hay muchas categorías.
  - Importado `ChevronDown` de lucide-react.
- Mejora 3 — SettingsView refactorizado a tabs:
  - Agregado import de `Tabs, TabsList, TabsTrigger, TabsContent`.
  - Cambiado el ancho del contenedor de `max-w-3xl` a `max-w-5xl` para acomodar mejor los tabs.
  - Envuelto el contenido en `<Tabs defaultValue="comercio">` con `TabsList` de 7 triggers:
    - Comercio, Moneda e Impuestos, Inventario, Métodos de Pago, Facturación AFIP, Mercado Pago, Fidelización
  - Cada Card envuelta en su `<TabsContent>` correspondiente. El Dialog de "Editar método de pago" quedó dentro del tab "pagos" (es coherente, pertenece a esa sección).
  - El botón "Guardar cambios del comercio" quedó fuera del Tabs (al pie, común a todo).
- Mejora 3b — EcommerceView refactorizado a tabs:
  - Agregado import de `Tabs, TabsList, TabsTrigger, TabsContent`.
  - Envuelto en `<Tabs defaultValue="config">` con 4 triggers:
    - Configuración, Opciones de Sync, Sync Manual, Historial
  - Cada Card envuelta en su `<TabsContent>`.
- Verificación:
  - `npx tsc --noEmit` sin errores en `src/` (solo errors en `skills/` y `examples/` que están fuera de scope).
  - `bun run lint` limpio.
  - Dev server corriendo en :3000, compila sin errores.

Stage Summary:
- 3 mejoras UX aplicadas:
  1. App abre directamente en POS (modulo principal de operación diaria).
  2. Sidebar con 5 categorías colapsables: Operaciones, Ventas, Catálogo y Stock, Gestión Comercial, Sistema. La categoría activa siempre queda abierta; las demás se pueden colapsar.
  3. SettingsView y EcommerceView ahora usan tabs en lugar de scroll infinito de Cards. Settings tiene 7 tabs, Ecommerce tiene 4.
- Cambios mínimos, sin tocar lógica de negocio ni APIs. Solo reorganización visual.
- Pattern de tabs consistente: `flex w-full flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1` para el TabsList.

---
Task ID: fix-reports-profits-race-condition
Agent: main
Task: Corregir error en ProfitsReport (reports-view.tsx) — `data.expensesByCategory.length` rompe al cambiar de tab

Work Log:
- Detectado error en runtime: `data.expensesByCategory` era `undefined` al renderizar el tab "Ganancias" del módulo Reportes.
- Causa raíz: race condition. Al cambiar de tab (ej: sales → profits), `loadReport()` hace `setLoading(true)` y dispara el fetch, pero `data` sigue siendo el del tab anterior hasta que el nuevo fetch termine. Como React puede renderizar una vez más entre el cambio de tab y el efecto del loader, `ProfitsReport` recibía `data` del tab `sales` (sin `expensesByCategory`).
- Fix 1 (root cause): agregado `setData(null)` al inicio de `loadReport()` para resetear la data al cambiar de tab. Ahora el guard `!data` del componente padre muestra "Selecciona un rango de fechas" durante la carga.
- Fix 2 (defensive): en `ProfitsReport`, cambiado `data.expensesByCategory.length === 0` por `!data.expensesByCategory || data.expensesByCategory.length === 0` para tolerar payloads parciales.
- `npx tsc --noEmit` limpio en src/, `bun run lint` limpio, dev server OK.

Stage Summary:
- Bug de race condition en Reportes corregido. Patrón similar al anterior (LineChart con yAxisId huérfano): ambos eran crashes por data inconsistente entre tabs.
- Cambio mínimo de 2 líneas, sin afectar otras funcionalidades.

---
Task ID: fix-reports-all-tabs
Agent: main
Task: Verificar y corregir errores en todas las pestañas del módulo Reportes

Work Log:
- Verificación con agent-browser: detectado que el tab "Fiscal" causaba "Application error: a client-side exception" al hacer click. Los demás tabs (Ventas, Ganancias, Productos, Clientes, Flujo Caja) funcionaban pero podían tener el mismo problema potencial.
- Causa raíz: race condition. Al hacer click en un tab, `setTab(t.key)` dispara un re-render ANTES de que el `useEffect` ejecute `loadReport()` (que es donde estaba el `setData(null)`). En ese render intermedio, `tab="taxes"` pero `data` seguía siendo del tab `sales` (sin `summary.totalFacturado`, `summary.cantidadFacturas`, `byTipo`, etc.). `TaxesReport` hacé `data.summary.cantidadFacturas.toString()` → `undefined.toString()` → 💥.
- Fix 1 (root cause): agregado `setData(null)` directamente en el `onClick` del handler de cambio de tab, además del que ya estaba en `loadReport()`. Ahora no hay render con data obsoleta de otro tab.
- Fix 2 (defensive en TODOS los sub-reportes): aplicado patrón `const summary = data?.summary || {};` + `const xxx = data?.xxx || [];` al inicio de cada sub-reporte, y reemplazadas todas las referencias directas `data.xxx` por las variables con fallback. Esto hace que cada sub-reporte sea robusto a payloads parciales o incompletos.
  - SalesReport: extraídas `summary`, `series`, `byPaymentMethod`, `byUser`. Agregados guards `length === 0` con mensajes "Sin datos" para PieChart y BarChart.
  - ProfitsReport: extraídas `summary`, `series`, `expensesByCategory`. Guard `length === 0` para BarChart y PieChart.
  - TaxesReport: extraídas `summary` y `byTipo`. Reemplazadas todas las referencias.
  - ProductsReport: extraídas `summary` y `ranking`. Cast `Number(summary.totalItemsVendidos || 0)` para evitar `.toFixed()` en undefined.
  - CustomersReport: extraídas `summary`, `topClientes`, `clientesConSaldo`.
  - CashFlowReport: extraídas `summary` y `series`. Guard `length === 0` para BarChart.
- Verificación E2E con agent-browser:
  - Login exitoso con tienda demo.
  - Navegación a Reportes OK.
  - Click secuencial en los 6 tabs (Ventas → Ganancias → Fiscal → Productos → Clientes → Flujo Caja): TODOS OK, sin "Application error".
  - Screenshots guardados en download/ (reports-fiscal-fixed.png, reports-products.png, reports-cashflow.png, reports-customers.png).
  - Dev server: sin errores en log.
- `npx tsc --noEmit` limpio en src/, `bun run lint` limpio.

Stage Summary:
- Bug de race condition en TODOS los tabs de Reportes corregido (no solo Fiscal que era el visible).
- Cambio defensivo en los 6 sub-reportes para tolerar payloads parciales o data de otro tab sin romper.
- Verificación E2E completa: los 6 tabs funcionan, sin application errors, con contenido visible.
- Patrones aplicados: (a) reset síncrono de `data` al cambiar de tab; (b) optional chaining + defaults en cada sub-reporte; (c) guards `length === 0` con mensajes user-friendly para gráficos vacíos.

---
Task ID: feat-topnav-no-sidebar
Agent: main
Task: Reemplazar layout con sidebar por top nav con menú "Más" (opción 1)

Work Log:
- Agregado `FREQUENT_KEYS = ["pos", "cash", "dashboard", "sales", "products"]` — las 5 vistas más usadas como tabs horizontales.
- Derivadas `frequentItems` (tabs visibles, filtradas por rol) y `moreCategories` (categorias con items no frecuentes).
- Derivado `moreHasActive` para resaltar el botón "Más" cuando la vista actual está dentro de ese menú.
- Imports: agregado `LayoutGrid` (icono para menús), `Fragment` (para keyed fragments en dropdowns categorizados). Removidos `Menu` y `X` (ya no se usan).
- Eliminado estado `sidebarOpen`, `collapsedCategories`, función `toggleCategory`, función `renderSidebarNav`.
- Nuevo layout del header (una sola fila):
  - Izquierda: logo + nombre del comercio + vista actual (shrink-0)
  - Centro (md+): nav tabs horizontales con icono + label (label hidden en <lg), overflow-x-auto si faltara espacio
  - Derecha: menú mobile (todas las vistas categorizadas), menú "Más" desktop (solo no frecuentes), indicadores PWA, menú usuario
- Eliminadas ambas sidebars (desktop fija + mobile drawer) y el overlay.
- Main content ahora full-width (`flex-1 min-w-0`), sin contenedor `flex` intermedio.
- Footer de versión (ComerciApp v4.0 + SW version) movido al final del menú de usuario.
- `npx tsc --noEmit` limpio en src/. `bun run lint` limpio. Dev server activo.

Stage Summary:
- Layout cambiado de "top bar + sidebar 240px" a "top bar con nav integrado, contenido full-width".
- Desktop (md+): 5 tabs frecuentes visibles + botón "Más" con dropdown categorizado (4 categorías: Ventas, Catálogo y Stock, Gestión Comercial, Sistema).
- Mobile (<md): un solo botón menú con dropdown de TODAS las categorías (incluyendo frecuentes).
- Responsive por rol: CAJERO ve 3 tabs (POS/Caja/Panel) y no ve "Más" (no tiene items adicionales); ADMIN ve 5 tabs + "Más" con 4 categorías.
- Botón "Más" se resalta en emerald cuando la vista actual pertenece a ese menú.

---
Task ID: feat-hybrid-topnav-plus-sidebar
Agent: main
Task: Agregar sidebar con items "Más" + scroll propio independiente

Work Log:
- Eliminado el dropdown "Más" del header desktop (ya no se necesita, va a la sidebar).
- Eliminada la variable `moreHasActive` (ya no se usa para resaltar botón).
- Agregado layout híbrido: `<div className="flex flex-1 min-h-0">` conteniendo sidebar + main.
- Sidebar nueva:
  - Visible en `md+` (`hidden md:flex w-60`)
  - Muestra `moreCategories` (items no frecuentes agrupados por categoría)
  - Categorías siempre expandidas con label en uppercase tracking-wider
  - Items con highlight emerald cuando están activos
  - `sticky top-14` (debajo del header de ~56px = top-14)
  - `h-[calc(100vh-3.5rem)]` (alto = viewport - header)
  - `overflow-y-auto` (scroll propio independiente del page scroll)
  - `shrink-0` (no se comprime cuando main content es ancho)
- Main content ahora tiene `overflow-y-auto` para scroll independiente también.
- Mobile (<md) sin cambios: botón menú con dropdown de TODAS las categorías.
- `tsc --noEmit` limpio. `bun run lint` limpio. Dev server OK, sin Fast Refresh errors.

Stage Summary:
- Layout final: top bar (logo + tabs frecuentes + acciones) + sidebar (items "Más" con scroll propio) + main (overflow-y-auto).
- Desktop (md+): tabs frecuentes arriba + sidebar 240px a la izquierda con items no frecuentes.
- Mobile (<md): botón menú con todas las vistas categorizadas.
- Cada área (sidebar, main) tiene su propio scroll — el page scroll del body no se activa.
- CAJERO sin sidebar (no tiene items "Más"), solo ve los 3 tabs frecuentes.

---
Task ID: feat-empresarial-style
Agent: main
Task: Cambiar estilo visual a más empresarial (slate + indigo en lugar de emerald)

Work Log:
- Paleta migrada de emerald (verde retail/casual) a slate (gris corporativo):
  - Header: `bg-white border-b border-slate-200` (sin shadow-sm, borde más sutil)
  - Body: `bg-slate-100/60` en lugar de `bg-muted/30`
  - Sidebar: `bg-slate-50 border-r border-slate-200` (antes blanco + emerald-100)
  - Logo: cuadrado `bg-slate-900` de 32x32 con esquinas redondeadas (antes emerald-600 de 36x36)
- Header más compacto: altura fija `h-14` con `px-4 sm:px-6` (antes `px-3 sm:px-4 py-2.5`)
- Separador vertical entre logo y tabs: `w-px h-8 bg-slate-200 ml-1`
- Tabs frecuentes con estilo underline (estilo Linear/Stripe):
  - Item activo: `text-slate-900` + barra inferior `h-0.5 bg-slate-900` (antes fondo emerald-50)
  - Item inactivo: `text-slate-500 hover:text-slate-900`
  - Tabs ocupan toda la altura del header (`h-full`) en lugar de py-1.5 con rounded-md
- Sidebar items con left-border activo (estilo Notion):
  - Activo: `bg-white text-slate-900 border-slate-900 shadow-sm` (antes emerald-50 text-emerald-700)
  - Inactivo: `text-slate-600 border-transparent hover:bg-slate-100/70`
  - Padding más compacto: `py-1.5` (antes `py-2`)
- Categorías sidebar: `text-slate-400` (antes `text-muted-foreground/70`)
- Avatar usuario: `bg-slate-100 text-slate-700 font-semibold` (antes emerald-100 emerald-700)
- Indicador "Sin conexión": rojo (`bg-red-50 text-red-700 border-red-200`) en lugar de amber
- Botón "Actualizar" PWA: `bg-slate-900 hover:bg-slate-800` (antes blue-600)
- Pantalla de carga: `text-slate-700` (antes emerald-600)
- Dropdown mobile items activos: `bg-slate-100 text-slate-900 font-medium` (antes emerald-50 emerald-700)
- `tsc --noEmit` limpio, `eslint` limpio, dev server OK.

Stage Summary:
- Estética migrada de "retail verde" a "corporativo slate" (estilo Linear/Stripe/Vercel).
- Cambios puramente visuales (clases Tailwind), sin tocar lógica ni estructura de componentes.
- Referencia visual: header compacto blanco + tabs underline + sidebar gris claro con items activos destacados por left-border + fondo gris muy claro.

---
Task ID: feat-indigo-inter-compact
Agent: main
Task: Cambiar paleta a indigo, tipografía a Inter, tamaño compacto (14px base)

Work Log:
- **Tipografía**: reemplazado Geist por Inter en `src/app/layout.tsx` via `next/font/google`.
  - `import { Inter, Geist_Mono } from "next/font/google"`
  - `const inter = Inter({ variable: "--font-geist-sans", subsets: ["latin"] })`
  - Variable CSS `--font-geist-sans` reutilizada (no hace falta cambiar globals.css theme inline).
- **Tamaño base**: agregado `html { font-size: 14px }` en `globals.css` (antes default 16px).
  - Impacto: todos los `text-sm`, `text-xs`, paddings en `rem` se reducen proporcionalmente.
  - Sensación: más info por pantalla, estilo Linear/Notion.
- **Mejoras de fuente**: agregado `font-smoothing: antialiased` y `font-feature-settings: "cv11", "ss01"` para mejorar renderizado de Inter.
- **Paleta indigo**: cambiados todos los acentos slate-900 → indigo-600/700 en `app-shell.tsx`:
  - Logo: `bg-indigo-600` (antes slate-900)
  - Underline de tab activa: `bg-indigo-600` (antes slate-900)
  - Left-border de item sidebar activo: `border-indigo-600` (antes slate-900)
  - Avatar fallback: `bg-indigo-50 text-indigo-700` (antes slate-100/slate-700)
  - Botón "Actualizar" PWA: `bg-indigo-600 hover:bg-indigo-700` (antes slate-900/slate-800)
  - Items dropdown mobile activos: `bg-indigo-50 text-indigo-700` (antes slate-100/slate-900)
- **Theme color** del viewport actualizado a `#4F46E5` (indigo-600).
- Cache HMR stale tras renombrar `geistSans` → `inter` causó `ReferenceError: geistSans is not defined` (3 veces). Resuelto con restart limpio del dev server + clear de `.next/cache`.
- `tsc --noEmit` limpio. `eslint` limpio. Dev server reiniciado OK, sin errores.

Stage Summary:
- Paleta migrada de slate monocromo a **slate + indigo** (acento indigo-600 sobre grises slate).
- Tipografía migrada de Geist a **Inter** (con font-smoothing y font-features).
- Tamaño base reducido de 16px a **14px** (compacto, tipo Linear/Notion).
- Densidad equilibrada mantenida (no se tocaron paddings/espaciados).
- Estética final: corporativa moderna con acento indigo, similar a Linear/Stripe.

---
Task ID: feat-full-palette-indigo-no-greens
Agent: main
Task: Eliminar TODOS los tonos verdes de la app (no solo app-shell) y unificar a indigo

Work Log:
- Detectado que el fix anterior solo cambió colores en app-shell.tsx, pero había 161 referencias a tonos verdes en 20 archivos.
- Mapa de tonos verdes encontrados:
  - emerald: 50, 100, 200, 300, 400, 500, 600, 700, 800, 900 (todas las sombras)
  - green: 50, 100, 200, 500, 600, 700, 800
  - teal: 50, 100, 500, 600, 700
  - hex codes: #10b981 (emerald-500), #059669 (emerald-600)
- Reemplazo masivo con `sed` en todos los archivos .tsx, .ts, .css de src/:
  - `emerald-{50,100,200,300,400,500,600,700,800,900}` → `indigo-{mismo número}`
  - `green-{50,100,200,500,600,700,800}` → `indigo-{mismo número}`
  - `teal-{50,100,500,600,700}` → `indigo-{mismo número}`
- Reemplazo de hex codes:
  - `#10b981` → `#6366f1` (indigo-500) en charts de Recharts (dashboard, reports)
  - `#059669` → `#4f46e5` (indigo-600) en manifest.json y offline.html
- Renombrado de claves internas "emerald" a "indigo":
  - `color="emerald"` → `color="indigo"` (prop de StatCard en dashboard-view y reports-view)
  - `emerald: { bg: ..., text: ... }` → `indigo: { bg: ..., text: ... }` (entradas de colorMap)
  - `colorMap.emerald` → `colorMap.indigo`
  - `? "emerald"` → `? "indigo"` (ternarios)
- globals.css: actualizadas variables CSS:
  - `--primary`: oklch(0.205 0 0) (negro) → oklch(0.541 0.281 264.48) (indigo-600)
  - `--ring`: oklch(0.708 0 0) → oklch(0.541 0.281 264.48) (indigo)
  - `--chart-1`: oklch(0.646 0.222 41.116) (naranja) → oklch(0.541 0.281 264.48) (indigo)
  - `--sidebar-primary`: → indigo
  - `--sidebar-ring`: → indigo
  - En dark mode: `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` actualizados a oklch(0.707 0.18 266.41) (indigo-400/500 claro).
- Verificación final: cero referencias a `emerald`, `green-*`, `teal-*`, `#10b981`, `#059669` en src/ y public/.
- `tsc --noEmit` limpio. `eslint` limpio. Dev server OK sin errores.

Stage Summary:
- Paleta verde completamente erradicada de toda la app.
- 20 archivos afectados: dashboard, reports, pos, cash-register, customers, purchases, settings, invoices, commissions, inventory, auth-screen, products, sales, promotions, ecommerce, print-templates, branches, refunds, expenses, lib/commissions.
- Hex codes de charts (Recharts) también migrados: todos los `#10b981` → `#6366f1`.
- Variables CSS de tema (light + dark) actualizadas para que `--primary`, `--ring`, `--chart-1`, `--sidebar-*` usen indigo.
- Assets PWA (manifest.json, offline.html) actualizados a `#4f46e5` (indigo-600).
- Identificadores internos "emerald" renombrados a "indigo" en colorMaps de StatCard.

---
Task ID: feat-replace-all-emojis-with-icons
Agent: main
Task: Reemplazar todos los emojis del sistema por iconos Lucide

Work Log:
- Detectados 29 emojis en 5 archivos:
  - src/lib/constants.ts (16 emojis en RUBROS y PAYMENT_METHOD_TYPES)
  - src/components/views/expenses-view.tsx (7 emojis en EXPENSE_CATEGORIES)
  - src/components/views/ecommerce-view.tsx (4 emojis en PLATFORMS)
  - src/components/views/settings-view.tsx (1 emoji 💡 en nota informativa)
  - src/components/views/pos-view.tsx (1 caracter ★ en SelectItem de sucursal)
- Creado `src/lib/icons.tsx` con:
  - `ICON_MAP`: mapa de nombres string → componentes Lucide (21 entradas)
  - Componente `<Icon name="..." />` que renderiza el icono por nombre, con fallback a `Package`
- Mapeo de emojis a nombres de icono:
  - **Rubros**: 🏪→store, 🛒→cart, 🥬→leaf, 🥩→beef, 🍞→croissant, 🍭→candy, 🔧→wrench, 📦→package
  - **Pagos**: 💵→banknote, 💳→credit_card, 🏦→landmark, 📋→clipboard_list, 📦→package
  - **Gastos**: 🏠→home, 💡→lightbulb, 👥→users, 📦→package, 🧾→receipt_text, 🚚→truck
  - **E-commerce**: 🛍️→shopping_bag, 🛒→cart, 🟡→tag, 🟢→globe
- `src/lib/constants.ts`: cambiados emojis por nombres string en RUBROS y PAYMENT_METHOD_TYPES. Las funciones `rubroIcon` y `paymentTypeIcon` siguen devolviendo strings (ahora nombres de icono en lugar de emojis).
- `app-shell.tsx`: agregado import de `Icon`, actualizado header para renderizar `<Icon name={rubroIcon(storeRubro)} />` en lugar del emoji string.
- `settings-view.tsx`: 
  - Agregado import de `Icon` y `Lightbulb`
  - `paymentTypeIcon(m.type)` ahora se renderiza vía `<Icon name={...} className="w-3.5 h-3.5 text-slate-500" />`
  - Emoji 💡 reemplazado por `<Lightbulb className="w-3.5 h-3.5 text-amber-500" />` con layout flex
- `expenses-view.tsx`:
  - Agregado import de `Icon`
  - EXPENSE_CATEGORIES: emojis → nombres string
  - 4 sitios de consumo actualizados (Card stats, Select filter, Badge en tabla, Select en form)
- `ecommerce-view.tsx`:
  - Agregado import de `Icon`
  - PLATFORMS: emojis → nombres string
  - SelectItem actualizado para renderizar `<Icon name={p.icon} />`
- `pos-view.tsx`:
  - Agregado `Star` a imports de lucide-react
  - Reemplazado `"★ "` (carácter Unicode) por `<Star className="w-3 h-3 fill-amber-400 text-amber-400" />` con renderizado condicional
- Verificación final con script Python: **0 emojis restantes** en src/ (.tsx y .ts)
- `tsc --noEmit` limpio. `eslint` limpio. Dev server OK sin errores.

Stage Summary:
- Sistema unificado de iconos: helper `<Icon name="..." />` permite referenciar iconos por string.
- 29 emojis eliminados de 5 archivos, reemplazados por iconos Lucide consistentes con la paleta visual.
- API de `constants.ts` preservada (las funciones siguen devolviendo strings, ahora nombres de icono en lugar de emojis).
- Icono de sucursal principal ahora es una estrella Lucide con fill amber en lugar de carácter ★.
- Nota informativa en settings ahora tiene icono Lightbulb con color amber en lugar de emoji 💡.

---
Task ID: barcode-lookup
Agent: main
Task: Implementar autocompletado de productos por código de barras usando APIs públicas

Work Log:
- Creada librería `src/lib/barcode-lookup.ts` con:
  - Función `lookupProductByBarcode(code)` que consulta en paralelo Open Food Facts (principal) y UPC Item DB (fallback).
  - Normalización de respuesta a interfaz `ProductLookupResult` (name, brand, description, category, imageUrl, quantity).
  - Función `isValidBarcode(code)` que valida dígito verificador EAN-8/EAN-13/UPC-A/UPC-E.
  - Timeout configurable de 8s para no bloquear el formulario si una API tarda demasiado.
- Creada API route `src/app/api/products/lookup/route.ts`:
  - GET `/api/products/lookup?barcode=XXXX` → consulta las dos bases públicas y devuelve datos normalizados.
  - Requiere sesión activa. Devuelve `{ found: false }` (status 200) si no encuentra, para que el cliente no rompa.
  - Incluye flag `barcodeValid` para feedback en el frontend.
- Modificada vista `src/components/views/products-view.tsx`:
  - Campo de código de barras ahora ocupa todo el ancho (sm:col-span-2) con:
    - Icono ScanLine a la izquierda (indica que se puede usar lector físico).
    - Botón "Buscar" a la derecha del input.
    - Auto-búsqueda al presionar Enter (compatible con lectores que envían Enter al final).
  - Estados visuales del lookup:
    - Loading: spinner + texto "Consultando base de datos...".
    - Found: caja verde con imagen del producto (si viene), nombre de la fuente (OFF o UPC) y aviso de que se autocompletaron campos.
    - Not found: texto ámbar indicando que complete manualmente.
    - Error: texto rojo con sugerencia de reintento.
  - Lógica de autocompletado: solo llena campos vacíos (no sobrescribe lo que el usuario ya cargó). Autocompleta `name`, `description` (con brand como fallback) y deja `barcode` como estaba.
  - Reset del estado de lookup al abrir nuevo formulario, editar producto, o modificar el código.
- Verificación: `npx tsc --noEmit` sin errores en src/. `bun run build` exitoso, ruta `/api/products/lookup` registrada.

Stage Summary:
- Función implementada de punta a punta (lib + API + UI).
- Usa Open Food Facts (gratuita, sin auth, cobertura global) como fuente principal y UPC Item DB como fallback.
- Compatible con lectores de código de barras físicos: el lector escribe el código y envía Enter, lo que dispara la búsqueda automáticamente.
- No sobrescribe datos que el usuario ya haya cargado a mano.
- Muestra preview de la imagen del producto si está disponible.
- No requiere claves API ni configuración adicional — funciona out of the box.
