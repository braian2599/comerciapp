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
