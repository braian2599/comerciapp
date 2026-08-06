---
Task ID: credit-notes-impl
Agent: main (Super Z)
Task: Implementar Notas de Crédito AFIP (P2.3 del plan de desarrollo) con ajustes profundos y robustos. Asegurar comunicación inter-modular correcta entre refunds, invoices, AFIP, customers y el nuevo módulo credit-notes.

Work Log:
- Audité el módulo `/api/refunds` y `lib/afip.ts` para entender el flujo existente (refund crea CustomerPayment con NOTA_CREDITO como paymentMethod, pero no emitía NC AFIP — había un TODO en línea 291).
- Audité el schema Prisma: `Refund.invoiceId` era un TEXT plano sin FK ni uso. `Invoice` solo modelaba facturas (sin distinción FACTURA/NC/ND). `TaxConfig` solo tenía contadores para facturas.
- Diseñé los cambios de schema:
  - `Invoice.comprobanteSubtipo` (FACTURA | NOTA_CREDITO | NOTA_DEBITO, default FACTURA)
  - `Invoice.relatedInvoiceId` (self-FK a la factura original)
  - `Invoice.refund` (back-relation 1:1 con Refund)
  - `Refund.invoiceId` renombrado a `Refund.creditNoteInvoiceId` con FK real + @unique + index
  - `TaxConfig.lastCreditNoteA/B/C` (contadores independientes para NC, porque AFIP los numera por separado)
  - Indexes: Invoice(storeId, comprobanteSubtipo, fechaEmision), Invoice(relatedInvoiceId), Refund(creditNoteInvoiceId)
- Generé migration SQL manual (`20260807000001_add_credit_notes/migration.sql`) porque el dev DB no está disponible localmente. La migration incluye comentarios detallados sobre backward-compat y decisiones de diseño.
- `npx prisma generate` OK — cliente Prisma regenerado con los nuevos campos.
- Extendí `lib/afip.ts`:
  - `getTipoComprobanteCodeNotaCredito(tipo)` — retorna códigos AFIP 3/8/13/53/21 para NC-A/B/C/M/E
  - `getNextInvoiceNumber(taxConfig, tipo, kind='FACTURA')` — ahora soporta `kind='NOTA_CREDITO'` para usar contadores separados
  - `DatosNotaCredito` interface + `ResultadoNotaCredito` interface
  - `emitirNotaDeCredito(storeId, userId, datos)` — función principal:
    - Valida TaxConfig activo + CUIT válido
    - Valida factura original existente, comprobanteSubtipo='FACTURA', status≠ANULADA, con CAE
    - Valida tipo/concepto coherentes con factura original
    - Genera número de NC (contador independiente)
    - Modo demo: CAE simulado; modo prod: placeholder con TODO detallado para @afipsdk/afip.js
    - Genera QR RG 4291 con tipoComprobante de NC
    - Crea Invoice con comprobanteSubtipo='NOTA_CREDITO', relatedInvoiceId=original.id
    - Actualiza TaxConfig.lastCreditNoteA/B/C
    - Back-link Refund.creditNoteInvoiceId = NC.id (si vino refundId)
  - `solicitarCaeNotaCreditoProduccion()` — placeholder con documentación detallada de los pasos necesarios (WSAA + FECAESolicitar con CbtesAsoc)
- Creé `/api/credit-notes/route.ts`:
  - GET: lista Invoices con comprobanteSubtipo='NOTA_CREDITO', con filtros (from, to, customerId, status, tipo, limit) e includes (relatedInvoice, refund, sale, customer, user)
  - POST: emite NC manual (caso de uso: reintento cuando el refund falló al emitir NC, o NC no vinculada a refund)
- Creé `/api/credit-notes/[id]/route.ts`:
  - GET: detalle completo de una NC (relatedInvoice, refund con items+products, sale, customer, user, taxConfig)
- Actualicé `/api/refunds/route.ts`:
  - POST: acepta `emitCreditNote?: boolean` en body
  - Si true: valida venta tenga factura con CAE
  - Después de crear refund exitosamente, llama `emitirNotaDeCredito()` fuera de la transacción (para no tener locks de DB durante la llamada a AFIP)
  - Si AFIP falla: el refund queda persistido + retorna `_warning` para que el usuario sepa
  - Si AFIP OK: retorna refund + creditNote info (id, numeroCompleto, cae, caeVencimiento, qrData, total)
  - GET: ahora incluye `creditNoteInvoice` y `sale.invoice` para mostrar badges en la tabla
- Actualicé `/api/refunds/[id]/route.ts`: incluye `creditNoteInvoice` y `sale.invoice` en el detalle
- Actualicé `/api/sales/route.ts` GET: incluye `invoice` (id, numeroCompleto, tipo, cae, status, comprobanteSubtipo) — necesario para que refunds-view pueda decidir si mostrar la opción de NC
- Actualicé `refunds-view.tsx`:
  - Importa `Checkbox`, `FileText`, `CheckCircle2`
  - Nuevo state: `emitCreditNote`, `taxConfigExists`
  - useEffect carga `/api/tax-config` para saber si AFIP está activo
  - `openRefundForSale` pre-tilda emitCreditNote si la venta tiene factura y AFIP está activo
  - `submitRefund` envía `emitCreditNote` en body; maneja `_warning` y `creditNote` en respuesta con toasts diferenciados
  - Nueva columna "NC" en la tabla de refunds (muestra número NC si se emitió, "Pendiente" si la venta tiene factura pero no se emitió NC, "—" si no aplica)
  - Bloque en el modal de nueva devolución: checkbox + info sobre qué NC se va a emitir (tipo, factura vinculada, CAE)
  - Avisos contextuales si AFIP no está configurado o la venta no tiene factura
  - Bloque en el modal de detalle: muestra info completa de la NC (número, CAE, fecha, total) o aviso si no se emitió
- Creé `credit-notes-view.tsx` (nuevo módulo):
  - Stats: total NCs, monto total acreditado, NCs hoy
  - Filtros: search (por número/CAE/cliente/factura/refund), status, tipo
  - Tabla con: N° NC, fecha, tipo (NC-A/B/C/M/E), cliente, factura vinculada, refund, estado, total, acciones
  - Modal de detalle: grid de info principal (número, tipo, estado, CAE, vto CAE, total) + botón "Ver QR AFIP" (abre URL AFIP en nueva tab) + sección cliente + sección factura original vinculada + sección refund con items + desglose NC (neto/IVA/exento/no gravado) + datos del emisor (TaxConfig) + observación
- Conecté en navegación:
  - `app-store.ts` ViewKey: agregué `"credit-notes"`
  - `app-shell.tsx`: import `CreditNotesView`, agregué `FileMinus` a imports de lucide, agregué nav item en categoría "Ventas" con roles ADMIN/VENDEDOR/CAJERO, agregué case en `renderView()`
- Validé type-check (`npx tsc --noEmit`) sin errores en src/
- Validé build (`npm run build`) — Compiled successfully in 15.8s, las nuevas rutas `/api/credit-notes` y `/api/credit-notes/[id]` aparecen en el manifest
- Fix crítico durante desarrollo: detecté que `Invoice.saleId` es @unique, así que no puedo asignar el mismo saleId a la NC (la venta ya tiene su factura original con ese saleId). Removí `saleId` del create de la NC. La NC se vincula a la venta INDIRECTAMENTE vía `relatedInvoiceId → Factura.saleId`. Documenté esto con comentarios detallados.

Stage Summary:
- Schema: 4 campos nuevos (Invoice.comprobanteSubtipo, Invoice.relatedInvoiceId, Refund.creditNoteInvoiceId renombrado de invoiceId, TaxConfig.lastCreditNoteA/B/C×3) + 2 FK + 3 indexes + 1 unique constraint
- Migration: `20260807000001_add_credit_notes/migration.sql` lista para aplicar en prod
- Backend: 2 nuevos endpoints (`/api/credit-notes` GET+POST, `/api/credit-notes/[id]` GET) + 1 función core en lib/afip.ts (`emitirNotaDeCredito`) + 3 endpoints actualizados (refunds GET/POST, refunds/[id] GET, sales GET)
- Frontend: 1 nuevo módulo (credit-notes-view.tsx, ~450 LOC) + refunds-view.tsx enriquecido con checkbox de NC + badges en tabla + info en modal detalle
- Navegación: nuevo item "Notas de Crédito" en categoría "Ventas" del sidebar
- Comunicación inter-modular validada:
  - refunds → invoices (NC): al confirmar devolución con emitCreditNote, se crea Invoice con comprobanteSubtipo='NOTA_CREDITO' vinculada a la factura original
  - credit-notes → refunds: GET /api/credit-notes incluye el refund que originó cada NC; POST /api/credit-notes puede linkear a un refund existente
  - credit-notes → invoices: GET detalle incluye la factura original vinculada (relatedInvoice)
  - refunds → customers: ya existía (CustomerPayment con paymentMethod='NOTA_CREDITO'), sigue funcionando igual
  - sales → refunds → credit-notes: la cadena completa venta→devolución→NC está conectada
- Modo demo: CAE simulado (14 dígitos + dígito verificador), vto +10 días, número incremental
- Modo producción: placeholder con TODO detallado (requiere @afipsdk/afip.js + certificado del cliente)
- Build: ✓ Compiled successfully
- Type-check: ✓ sin errores en src/

---
Task ID: P2.1-refunds-customer-account
Agent: main (Super Z)
Task: Robustecer el flujo devoluciones → cuenta corriente cliente (P2.1). Asegurar que no queden datos al azar ni comunicaciones inter-modulares fallidas entre refunds, customer-account, sales y cash-registers.

Work Log:
- Audité el flujo completo de refunds → customer account:
  - Schema: no existe modelo CustomerAccount; el saldo se calcula como Σ(Sale.onCredit=true, status=COMPLETADA, total) − Σ(CustomerPayment.amount). Es un cálculo derivado en runtime.
  - 3 lugares distintos calculaban saldo (customers/account GET, customers GET lista, dashboard) sin compartir lógica.
- Detecté 12 bugs de robustez en el flujo:
  1. Refund de venta fiada en EFECTIVO dejaba deuda fantasma (doble devolución).
  2. refundNumber se generaba FUERA de transacción (race condition).
  3. refundNumber usaba orderBy string desc (bug lexicográfico después de DEV-9999).
  4. StockMovement type="AJUSTE" no distinguía devoluciones de ajustes manuales.
  5. cashMovement solo se registraba si sale.paymentMethod === "EFECTIVO" (rompía si pagó con tarjeta).
  6. customer.totalSpent solo se decrementaba si la venta tenía loyaltyPointsEarned > 0 (programa desactivado → stats erróneas).
  7. customer.totalSales se decrementaba en toda devolución total, incluso de venta fiada (donde la venta sigue existiendo).
  8. CREDITO_CUENTA sin customerId se ignoraba silenciosamente (refund "perdido").
  9. POST /api/customers/account permitía overpayment sin validación (saldos negativos accidentales).
  10. POST /api/sales no validaba creditLimit al fiar (se podía fiar cualquier monto).
  11. POST /api/sales no requería customerId al fiar (venta fiada sin cliente = imposible cobrar después).
  12. Refund de venta fiada total marcaba sale.status="ANULADA" → deuda desaparecía sin registro contable.
- Creé `src/lib/customer-account.ts` (lib nueva, ~290 LOC):
  - `getCustomerBalance(dbOrTx, storeId, customerId)` — cálculo canónico con aggregate (no carga registros a memoria).
  - `assertCreditAvailable(dbOrTx, storeId, customerId, amount)` — valida creditLimit, throws con mensaje user-friendly.
  - `normalizeRefundMethod(sale, requestedMethod, options)` — decide método efectivo considerando si la venta era fiada + forceCashRefundOnCreditSale flag.
  - `getNextRefundNumber(tx, storeId)` — generación atómica dentro de transacción, parsing numérico robusto.
  - `applyCreditToCustomerAccount(tx, params)` — wrapper reutilizable para crear CustomerPayment + CashMovement.
- Refactorizé `POST /api/refunds`:
  - Mover generación refundNumber DENTRO de la transacción.
  - Aplicar normalizeRefundMethod() antes de la tx (resuelve bug #1, #8).
  - Mover actualización de customer.totalSpent/totalSales FUERA del bloque de puntos (resuelve #6, #7).
  - Cambiar StockMovement type a "ENTRADA" (resuelve #4).
  - Registrar cashMovement siempre que se entregue efectivo, sin depender de sale.paymentMethod (resuelve #5).
  - No anular ventas fiadas en devolución total (resuelve #12) — la deuda queda visible hasta que CustomerPayment la compense.
  - Propagar _warning de normalización al frontend.
- Refactorizé `POST /api/sales`:
  - Validar que customerId esté presente si method.type=CUENTA (resuelve #11).
  - Llamar assertCreditAvailable() antes de crear la venta (resuelve #10).
- Refactorizé `POST /api/customers/account`:
  - Validaciones más estrictas (Number.isFinite, separar amountNum).
  - Validar overpayment con flag allowOverpayment (resuelve #9).
  - Usar applyCreditToCustomerAccount() para consistencia con refunds.
  - Devolver _newBalance en respuesta para que el frontend refresque sin GET adicional.
- Actualicé `refunds-view.tsx`:
  - openRefundForSale() pre-selecciona CREDITO_CUENTA si venta era fiada.
  - Warning visual en el modal si venta fiada + método cash elegido.
  - Warning visual si CREDITO_CUENTA + sin cliente.
  - submitRefund maneja _warning con toast (ya existía, mejoré docstring).
- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 14.3s, 58/58 static pages OK

Stage Summary:
- Bugs críticos resueltos: 12 (todos los detectados en el audit)
- Libs nuevas: 1 (src/lib/customer-account.ts, ~290 LOC con JSDoc detallado)
- Endpoints refactorizados: 3 (/api/refunds POST, /api/sales POST, /api/customers/account POST)
- Frontend mejorado: refunds-view.tsx (pre-select + 2 warnings visuales + manejo de _warning)
- Comunicación inter-modular validada:
  - refunds → customer-account: normalizeRefundMethod decide método según contexto de la venta
  - refunds → customers: stats (totalSpent, totalSales, loyaltyPoints) se actualizan SIEMPRE, no solo si ganó puntos
  - refunds → cash-registers: EGRESO se registra siempre que se entrega efectivo
  - refunds → stock: type="ENTRADA" distingue devoluciones de ajustes manuales
  - sales → customers: assertCreditAvailable valida creditLimit ANTES de crear venta fiada
  - customers/account → customers: devuelve _newBalance para evitar race con GET
- Race conditions eliminadas:
  - refundNumber: ahora dentro de transacción (serializable de Postgres)
  - customer.totalSpent: ahora dentro de la misma tx que el refund
  - overpayment: validado con getCustomerBalance antes de aceptar pago
- Sin cambios de schema (no requiere migración nueva)
- Build: ✓ Compiled successfully
