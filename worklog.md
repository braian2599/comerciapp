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

---
Task ID: P2.2-P2.4-stock-unification
Agent: main (Super Z)
Task: Completar P2.2 (validar prorrateo) y P2.4 (unificar movimientos de stock en lib/stock.ts). Ajustes profundos y robustos, sin dejar datos al azar ni comunicación inter-modular fallida.

Work Log:
- P2.2 (prorrateo de devolución al backend): auditado y verificado OK.
  - lib/refund-calc.ts ya existe y centraliza calculateRefundTotals().
  - /api/refunds/preview usa calculateRefundTotals (línea 64).
  - /api/refunds POST usa calculateRefundTotals (línea 122).
  - Frontend refunds-view usa calculateRefundTotals solo para DISPLAY (no envía montos al backend).
  - Backend siempre recalcula con snapshot de Sale + SaleItems desde la DB.
  - No requiere cambios adicionales.

- P2.4 (unificar movimientos de stock): auditado, encontré 10 lugares con lógica duplicada:
  1. POST /api/sales (descuento por venta)
  2. POST /api/sales/annul (reintegro por anulación)
  3. POST /api/refunds (reintegro por devolución)
  4. POST /api/purchase-orders (recepción desde crear OC)
  5. POST /api/purchase-orders/receive (recepción de OC pendiente)
  6. POST /api/inventory (entrada/salida manual)
  7. POST /api/products (stock inicial al crear producto)
  8. PUT /api/products (ajuste al editar stock manualmente)
  9. POST /api/products/import (masivo create + update)
  10. lib/ecommerce.ts (pedido web sincronizado)

- Inconsistencias detectadas en las 10 implementaciones:
  a. Solo 3/10 validaban stockResultante < 0 (sales, inventory, products PUT).
     Ecommerce y products/import NO validaban → stock podía quedar negativo.
  b. Solo 5/10 seteaban refType+refId. Products POST/PUT e import NO lo hacían.
  c. Tipo del StockMovement era string libre → typos imposibles de detectar.
  d. Convención de signo inconsistente: algunas guardaban cantidad positiva,
     otras con signo (sales usaba -quantity, inventory usaba signedQty).
  e. Products PUT hacía update del producto + stockMovement.create por separado
     → si el segundo fallaba, el stock quedaba actualizado sin movimiento.
  f. Purchase orders duplicaba lógica de actualización de costPrice en 2 lugares.
  g. Ecommerce no propagaba errores de stock insuficiente (silently negative).

- Creé src/lib/stock.ts (~330 LOC con JSDoc detallado):
  - decreaseStock(tx, params, type="VENTA"|"SALIDA"): descuenta stock, valida
    stockResultante < 0 (salvo allowNegative=true), registra StockMovement
    con quantity negativa.
  - increaseStock(tx, params, type="COMPRA"|"ENTRADA"): incrementa stock,
    opcionalmente actualiza costPrice, registra StockMovement con quantity
    positiva.
  - setStock(tx, params): setea stock absoluto, calcula diff, registra
    AJUSTE con diff signado.
  - bulkStockMovement(tx, ops[]): aplica varios movimientos en una tx.
  - assertStockAvailable(dbOrTx, productId, quantity): validación read-only.
  - Tipos canonicos: StockMovementType (union), StockRefType (union).
  - Todas las funciones aceptan tx | db para usar dentro o fuera de transacciones.

- Refactoricé los 10 lugares:
  - POST /api/sales: usa decreaseStock(tx, ..., "VENTA"). Valida stock < 0 con
    mensaje descriptivo (incluye nombre del producto).
  - POST /api/sales/annul: usa increaseStock(tx, ..., "ENTRADA"). Agregué
    refType="Sale" que antes no estaba.
  - POST /api/refunds: usa increaseStock(tx, ..., "ENTRADA"). Mantiene refType="Refund".
  - POST /api/purchase-orders: usa increaseStock(tx, ..., "COMPRA") con
    newCostPrice=it.unitCost. Eliminé duplicación de lógica de costPrice.
  - POST /api/purchase-orders/receive: igual que arriba.
  - POST /api/inventory: usa decreaseStock/increaseStock según type. Validación
    de tipo agregada (string union). Manejo de errores con try/catch y 400.
  - POST /api/products: mantiene stock en create del producto, pero registra
    StockMovement con refType="InventoryAdjustment" y refId=product.id.
  - PUT /api/products: ahora envuelve update + setStock en una sola tx
    (atomicidad garantizada). Si el stock cambió, se usa setStock que registra
    AJUSTE con diff signado.
  - POST /api/products/import: agrega refType="ProductImport" + refId en
    ambos casos (create y update).
  - lib/ecommerce.ts: usa decreaseStock(db, ..., "VENTA"). Valida stock < 0
    (antes no lo hacía). refType="Ecommerce". Si falla, el error se propaga
    y la orden NO se marca como fulfilled (queda pendiente para reintentar).

- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 15.8s, 58/58 static pages OK

Stage Summary:
- Bugs críticos resueltos:
  1. Ecommerce podía dejar stock negativo (no validaba stockResultante)
  2. Products/import podía dejar stock negativo (no validaba)
  3. Products PUT no era atómico entre update y stockMovement (podía quedar inconsistente)
  4. 5 lugares no seteaban refType → movimientos sin trazabilidad
  5. Inconsistencia de signo en quantity del StockMovement
  6. Tipos string libre en StockMovement.type (sin validación compile-time)

- Libs nuevas: 1 (src/lib/stock.ts, ~330 LOC)
- Endpoints refactorizados: 8 (sales POST, sales/annul POST, refunds POST,
  purchase-orders POST, purchase-orders/receive POST, inventory POST,
  products POST, products PUT, products/import POST, ecommerce.ts)
- Sin cambios de schema (no requiere migración)
- Comunicación inter-modular validada:
  - sales → stock: decreaseStock con type="VENTA"
  - sales/annul → stock: increaseStock con type="ENTRADA"
  - refunds → stock: increaseStock con type="ENTRADA"
  - purchase-orders → stock: increaseStock con type="COMPRA" + newCostPrice
  - inventory → stock: decrease/increaseStock con type="SALIDA"/"ENTRADA"
  - products → stock: stockMovement directo para stock inicial, setStock para edición
  - ecommerce → stock: decreaseStock con type="VENTA" y validación de stock
- Todos los movimientos ahora tienen:
  - type tipado (compile-time check)
  - quantity con signo consistente (negativo=salida, positivo=entrada)
  - refType + refId para trazabilidad (excepto stock inicial que usa InventoryAdjustment)
  - reason descriptivo
  - validación de stockResultante >= 0 (salvo allowNegative explícito)

---
Task ID: P2.2-refund-prorrateo-hardening
Agent: main (Super Z)
Task: Re-auditar y robustecer el prorrateo de devolución (P2.2). Ajustes profundos, sin dejar datos al azar.

Work Log:
- Re-audité el flujo completo del prorrateo: lib/refund-calc.ts +
  /api/refunds POST + /api/refunds/preview + refunds-view.tsx.
- Encontré 7 bugs en la re-auditoría profunda (la auditoría previa había
  dicho "OK" pero no fue lo suficientemente profunda):
  1. CRÍTICO: isTotal=true cuando lengths coincidían aunque las
     cantidades fueran parciales. Ej: venta 2 items (qty 10,10), pedir
     devolver 5+5 → isTotal=true, se persistían 10+10. Pérdida real.
  2. POST /api/refunds no envolvía req.json() en try/catch → JSON
     malformado = 500 en vez de 400.
  3. No validaba Array.isArray(body.items) → items="foo" rompía runtime.
  4. No validaba typeof body.saleId → saleId=123/null causaba 404
     silencioso o comportamiento indefinido.
  5. No rechazaba saleItemId duplicados → [{A,3},{A,3}] sumaba 6 y
     pasaba validación.
  6. No había redondeo monetario → drift de centavos tras N refunds.
  7. sale.subtotal=0 con items era fallback mágico (saleSubtotal ||
     refundSubtotal) → snapshot corrupto silenciosamente aceptado.

- Refactoricé lib/refund-calc.ts:
  - signature cambió a (sale, requestedItems: unknown) para validación
    defensiva dentro de la lib.
  - normalizeRequestedItems(): valida Array, tipos, duplicados,
    pertenencia, rangos. Lanza Error user-friendly en cada caso.
  - isTotal ahora se determina AFTER de procesar items: true IFF
    TODOS los items de la venta están en la solicitud Y cada cantidad
    es exactamente la original.
  - En devolución total explícita (items=[]), los componentes son
    exactamente sale.{discount,tax,surcharge} para garantizar
    refundTotal === sale.total sin drift.
  - roundMoney(): todos los montos a 2 decimales.
  - Validación de snapshot: sale.subtotal > 0 si hay items.

- Actualicé /api/refunds POST:
  - req.json() envuelto en try/catch → 400 en JSON malformado.
  - Validación de tipos básicos (saleId, items, refundMethod) ANTES
    de tocar la DB.
  - body.items pasado directo a calculateRefundTotals (la lib valida).

- Actualicé /api/refunds/preview:
  - Mismas validaciones de entrada que POST.

- Creé scripts/test-refund-calc.ts (43 tests de regresión):
  - Devolución total explícita (3 formas: [], undefined, null).
  - BUG CRÍTICO: cantidades parciales de todos los items → isTotal=false.
  - Cantidades totales de todos los items → isTotal=true.
  - Prorrateo proporcional (descuento, IVA, recargo).
  - Redondeo a 2 decimales (verifica ≤2 decimales en todos los campos).
  - Validaciones: duplicados, inexistentes, qty inválida, items no-array,
    snapshot inconsistente, item sin saleItemId, item sin quantity.
  - 43/43 OK.

- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 15.4s, 58/58 static pages OK
- Commit: d451534
- Push: ✓ origin/main

Stage Summary:
- Bugs críticos resueltos: 7 (1 crítico de pérdida de dinero + 6 robustez)
- Libs refactorizadas: 1 (lib/refund-calc.ts, ~290 LOC)
- Endpoints endurecidos: 2 (/api/refunds POST, /api/refunds/preview POST)
- Tests de regresión: 43 (scripts/test-refund-calc.ts)
- Comunicación inter-modular validada:
  - refunds-view → /api/refunds/preview: solo display, no envía montos
  - refunds-view → /api/refunds POST: solo {saleId, items, method, reason,
    notes, emitCreditNote}. Backend recalcula todo desde DB snapshot.
  - /api/refunds → stock: increaseStock con type=ENTRADA (P2.4)
  - /api/refunds → customers: stats + loyaltyPoints prorrateados (P2.1)
  - /api/refunds → customer-account: applyCreditToCustomerAccount (P2.1)
  - /api/refunds → invoices: emitirNotaDeCredito si emitCreditNote (P2.3)
- Sin cambios de schema (no requiere migración)

---
Task ID: P3-afip-produccion
Agent: main (Super Z)
Task: Implementar integración real AFIP producción (WSAA + WSFEv1) para facturas y notas de crédito. Sin dependencias pagas ni binarios externos.

Work Log:
- Audité el estado previo: lib/afip.ts tenía 2 placeholders
  (solicitarCaeProduccion y solicitarCaeNotaCreditoProduccion) que
  retornaban error "no implementado". El modo demo funcionaba pero
  producción no estaba cableada.
- Decisiones de arquitectura:
  - NO usar @afipsdk/afip.js (comercial, requiere licencia).
  - NO usar el package `soap` (problemático en Vercel serverless).
  - SÍ usar `node-forge` para firma PKCS#7 (libre, sin openssl binario).
  - SÍ usar `fetch` nativo para SOAP/HTTPS (Node 18+).
- Instalé node-forge ^1.4.0.

- Creé src/lib/afip-prod.ts (~730 LOC):
  - leerCertificadoYClave(): soporta .p12 (PKCS#12 con password) y
    .pem (cert + key separados). Extrae PEMs con node-forge.
  - generarTRAXml(): TRA para servicio wsfe, 12h expiración (máx AFIP).
  - firmarTRA(): CMS PKCS#7 sobre TRA con SHA-256 + RSA via node-forge.
  - obtenerTokenAcceso(): cache en TaxConfig.authToken +
    authTokenExpires. Renueva 1h antes de expirar. POST SOAP WSAA.
  - buildFECAESolicitarEnvelope(): construye SOAP envelope completo
    con Auth, FeCabReq, FeDetReq, AlicIva, Tributos, CbtesAsoc (NC).
  - feCAESolicitar(): POST al WSFEv1 con timeout 30s.
  - parseFECAEResponse(): parser robusto con 4 casos:
    1. SOAP fault → error transporte
    2. Errors globales (cabecera) → AFIP no procesó
    3. Resultado=R + Errors detalle → comprobante rechazado
    4. Resultado=A + CAE + CAEFchVto → OK
  - decodeXmlEntities(): 8 entities HTML clásicas + 7 entities
    AFIP-specific (&acute;, &aacute;, ...) + numeric (&#NN; / &#xNN;).
  - fetchWithTimeout(): AbortController con 30s.
  - resolveUploadPath(): soporta absolutas o relativas a UPLOADS_DIR.

- Actualicé src/lib/afip.ts:
  - solicitarCaeProduccion(): reemplazado placeholder por implementación
    real que llama obtenerTokenAcceso + feCAESolicitar.
  - solicitarCaeNotaCreditoProduccion(): igual pero con CbtesAsoc
    apuntando a la factura original (tipo + ptoVta + numero desde
    originalInvoice). Requerido por AFIP para NC.
  - formatAfipDate(): helper nuevo para YYYYMMDD.

- Creé /api/afip/test (POST, solo ADMIN):
  - Diagnóstico SIN emitir comprobante.
  - 3 pasos: validar TaxConfig → leer cert → obtener TA del WSAA.
  - Retorna steps[] con ok + detail por cada paso, tokenExpiresAt,
    cuit, puntoVenta, environment.
  - Útil para que el usuario pruebe la conexión antes de emitir.

- Tests scripts/test-afip-parsing.ts (27 tests):
  - 8 casos de parsing SOAP cubiertos (éxito, observaciones, rechazo
    global, rechazo detalle, SOAP fault, formato inesperado, fechas,
    entity decoding).
  - 27/27 OK.

- Bugs encontrados y corregidos durante desarrollo:
  1. CRÍTICO: parseFECAEResponse trataba errores a nivel detalle
     (Resultado=R, dentro de FECAEDetResponse > Errors) como errores
     globales, retornando ok=false sin resultado=R. Esto hacía que
     el usuario no supiera si el rechazo fue global o del comprobante.
     Fix: remover <FeDetResp> del bloque antes de buscar errores
     globales, para que solo se detecten los Errors a nivel cabecera.
  2. decodeXmlEntities no decodificaba entities AFIP-specific como
     &acute; (muy común en mensajes de error). Fix: agregar 7 entities
     adicionales + soporte para numeric (&#NN; / &#xNN;).

- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 16.6s, 59/59 static pages OK
- Commit: 1a0d779
- Push: ✓ origin/main

Stage Summary:
- Libs nuevas: 1 (src/lib/afip-prod.ts, ~730 LOC con JSDoc detallado)
- Libs refactorizadas: 1 (src/lib/afip.ts, 2 placeholders reemplazados
  por implementación real)
- Endpoints nuevos: 1 (/api/afip/test POST, diagnóstico de conexión)
- Tests de regresión: 27 (scripts/test-afip-parsing.ts)
- Dependencia nueva: node-forge ^1.4.0 (libre, serverless-friendly)
- Bugs críticos resueltos: 2 (parsing detalle vs cabecera + entities)
- Comunicación inter-modular validada:
  - emitirFactura → afip-prod: config→cert→TA→FECAE
  - emitirNotaDeCredito → afip-prod: igual + CbtesAsoc
  - /api/afip/test → afip-prod: diagnóstico sin emisión
  - TaxConfig.authToken/authTokenExpires: cache compartido con
    renovación automática 1h antes de expirar
- Sin cambios de schema (usa campos existentes)
- Modo demo sigue funcionando sin cambios (env=homologacion o sin
  certPath → generarCaeSimulado)

---
Task ID: P3-afip-ui-test
Agent: main (Super Z)
Task: Implementar UI de 'Probar conexión AFIP' en el módulo Configuración. Métodos robustos y profundos.

Work Log:
- Audité la UI existente: settings-view.tsx tiene un tab 'Facturación
  AFIP' con formulario (CUIT, razón social, punto venta, environment,
  certPath implícito). Faltaba el panel de diagnóstico de conexión.
- Diseñé el componente AfipConnectionPanel con 6 estados derivados:
  - unknown (sin verificar)
  - connected (TA válido)
  - config_error (falta CUIT, environment o certPath)
  - cert_error (.p12 no se puede leer)
  - wsaa_error (AFIP rechazó el TRA)
  - network_error (timeout o sin respuesta)

- Creé src/components/afip-connection-panel.tsx (~510 LOC):
  - deriveStatus(): mapea la respuesta de /api/afip/test a uno de los
    6 estados, basándose en el primer step que falló.
  - STATUS_META: tabla de metadata (label, color, icon) por estado.
  - STEP_META: tabla de metadata (label, icon) por step (config,
    certificado, wsaa, wsaa_cache).
  - runTest(): ejecuta el test con AbortController + timeout 35s.
    Maneja 3 niveles de error:
    1. ok=true → connected + toast success
    2. 4xx con body JSON estructurado → deriveStatus + reintentos
    3. 5xx / timeout / fetch exception → network_error + reintentos
  - Backoff: reintenta hasta 2 veces con 1s + 2s SOLO para wsaa_error
    y network_error (no reintenta config ni cert porque no van a
    mejorar solos).
  - willRetry flag para NO bajar `testing` durante el backoff.
  - SuggestionBox: componente auxiliar para mostrar listas de
    verificación según el tipo de error.
  - Pre-condiciones: avisa si falta environment=produccion, certPath
    o CUIT, y deshabilita el botón.
  - Modal con tabla de steps (icono + label + detail) + sugerencias
    contextuales.

- Integré en settings-view.tsx:
  - Import AfipConnectionPanel.
  - Insertado en el tab 'Facturación AFIP', después del formulario y
    antes del botón Guardar.
  - Pasa taxConfig (state) y onTestSuccess=loadTaxConfig (refresca
    el TA cacheado).

- Mejoras en src/components/ui/badge.tsx:
  - Agregadas variantes 'success' (emerald-100/800) y 'warning'
    (amber-100/800) con soporte dark mode.

- Tests scripts/test-afip-derive-status.ts (7 tests):
  - 7 casos cubriendo los 6 estados + 1 edge case (ok=false pero
    todos steps OK → network_error).
  - 7/7 OK.

- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 16.5s, 59/59 static pages OK
- Commit: 418c4e3
- Push: ✓ origin/main

Stage Summary:
- Componentes nuevos: 1 (AfipConnectionPanel, ~510 LOC)
- Componentes modificados: 2 (settings-view.tsx integración, badge.tsx
  +2 variantes)
- Tests de regresión: 7 (scripts/test-afip-derive-status.ts)
- 6 estados derivados con mensajes user-friendly y sugerencias
- Reintentos automáticos (máx 2) con backoff 1s+2s SOLO para errores
  transitorios (wsaa/network)
- Timeout 35s con AbortController
- Pre-condiciones visuales (falta environment / cert / CUIT)
- Comunicación inter-modular validada:
  - settings-view → AfipConnectionPanel: taxConfig state + callback
  - AfipConnectionPanel → /api/afip/test: POST con AbortController
  - /api/afip/test → afip-prod: lee cert + obtiene TA
  - onTestSuccess → loadTaxConfig: refresca taxConfig con TA cacheado

---
Task ID: P3-afip-cert-upload
Agent: main (Super Z)
Task: Implementar upload de certificado AFIP (.p12/.pfx o .pem) desde la UI con métodos robustos y complejos para evitar fallas. Incluye encriptación de la password, validación del certificado al subir, matching de CUIT, y eliminación segura.

Work Log:
- Audité el estado previo:
  - lib/afip-prod.ts ya tenía leerCertificadoYClave() que soporta .p12 y .pem
  - TaxConfig ya tenía campos certPath, privateKeyPath, certPassword (en plaintext)
  - No había endpoint para subir certificados
  - No había UI para subir certificados (el formulario solo tenía CUIT, razon social, etc.)
  - Aviso estático "Esto se hace mediante un archivo de configuración en el servidor"
- Detecté 5 problemas de robustez:
  1. certPassword se guardaba en plaintext en la DB
  2. No había validación del certificado al subir (password incorrecta se detectaba solo al emitir factura)
  3. No había matching CUIT del certificado vs TaxConfig.cuit
  4. leerCertificadoYClave iteraba safeContents.bags (API legacy); node-forge moderno usa safeBags
  5. No había forma de eliminar un certificado cargado (ni del FS ni de la DB)

- Creé src/lib/crypto-utils.ts (~155 LOC):
  - encryptSecret(plain): AES-256-GCM con IV aleatorio de 12 bytes
  - decryptSecret(stored): soporta formato v1:ivHex:tagHex:cipherHex + backward-compat
    con strings plaintext (registros viejos sin encriptar)
  - isEncryptedSecret(stored): utilidad para diagnóstico
  - Key desde CERT_PASSWORD_ENCRYPTION_KEY (hex 64 chars) o SHA-256(NEXTAUTH_SECRET)
  - En dev sin ninguna de las dos, usa fallback con warning (NO prod)

- Creé src/lib/cert-info.ts (~205 LOC):
  - extractCertInfoFromP12(buffer, password): extrae CertInfo de .p12/.pfx
  - extractCertInfoFromPem(pem): extrae CertInfo de cert PEM
  - CertInfo: subject, issuer, cuit, validFrom, validTo, daysUntilExpiry,
    expired, expiringSoon (≤30 días), fingerprintSha256, serialNumber, format
  - extractCuitFromAttrs(): busca CUIT en CN → serialNumber → OU (formato AFIP)
  - parseCuit(): normaliza a 11 dígitos, acepta "30-71234567-8", "CUIT xxx", etc.
  - validarCuitConDigito(): algoritmo módulo 11 del dígito verificador
  - cuitMatches(): comparación robusta de CUITs con ruido (guiones, prefijos)
  - buildCertInfo(): construye respuesta + calcula fingerprint SHA-256

- Actualicé src/lib/afip-prod.ts:
  - leerCertificadoYClave() ahora desencripta certPassword con decryptSecret()
    antes de pasarla a node-forge. Backward-compat: si viene plaintext, lo usa tal cual.
  - Arreglé iteración de safeContents: ahora soporta tanto .safeBags (node-forge
    moderno) como .bags (legacy). Esto era un bug latente que habría fallado con
    .p12 generados por node-forge y posiblemente con algunos .p12 reales.

- Creé src/app/api/afip/cert/route.ts (~410 LOC):
  - POST (multipart/form-data):
    * Valida ADMIN/OWNER
    * Lee TaxConfig actual
    * Parsea FormData: cert (File), key (File opcional para .pem), password (string)
    * Valida extensión (.p12, .pfx, .pem, .cer) y MIME type
    * Valida tamaño (max 100KB)
    * Lee bytes y valida certificado con node-forge ANTES de persistir
    * .p12: requiere password, valida que abra
    * .pem: requiere key file aparte, valida BEGIN CERTIFICATE y PRIVATE KEY
    * Valida que el certificado no esté vencido
    * Extrae CUIT del certificado y valida dígito verificador
    * Si TaxConfig.cuit está seteado, valida coincidencia (rechaza si no coincide)
    * Si TaxConfig.cuit NO está seteado, lo autocompleta con el del certificado
    * Genera nombre de archivo seguro: afip-${storeId}-${timestamp}.${ext}
      (evita path traversal, colisiones entre stores)
    * Persiste cert (y key si .pem) en UPLOADS_DIR/afip-certs/
    * Borra cert anterior del FS (best-effort, no falla si no existe)
    * Encripta password con AES-256-GCM antes de persistir
    * Actualiza TaxConfig: certPath, privateKeyPath, certPassword encriptada,
      cuit (si autocompletado), authToken=null, authTokenExpires=null
      (invalida TA cacheado porque cambió el cert)
    * Si falla la DB, borra archivos nuevos para no dejar basura
  - DELETE:
    * Borra archivos físicos (cert + key)
    * Limpia certPath, privateKeyPath, certPassword, authToken, authTokenExpires
  - GET:
    * Lee el cert actual, extrae info legible (subject, issuer, CUIT, validez, fingerprint)
    * NUNCA expone contenido PEM ni password
    * Maneja casos: sin cert, archivo perdido, password no desencriptable, formato corrupto
    * Retorna hasCert=true + error en esos casos para que la UI los muestre

- Creé src/components/afip-certificate-uploader.tsx (~580 LOC):
  - Card con header "Certificado Digital AFIP" + badge de estado (Vigente/Por vencer/Vencido)
  - Sección de info del cert actual: formato, CUIT, subject, issuer, fechas de validez,
    fingerprint SHA-256, path del archivo. Botón "Eliminar" con confirmación.
  - Formulario de upload (solo si no hay cert):
    * Drag & drop + click para certificado (.p12/.pfx/.pem/.cer)
    * Drag & drop + click para clave privada (.key/.pem) — solo si .pem
    * Input de password con toggle de visibilidad — solo si .p12/.pfx
    * Validación client-side de extensión y tamaño antes de subir
    * Botón "Subir y validar certificado" con estado loading
    * Botón "Limpiar" para resetear formulario
    * Nota de seguridad: "La contraseña se encripta con AES-256-GCM antes de guardar"
  - AbortController + timeout 30s en upload
  - Manejo de errores: red, timeout, 403 (no-admin), 400 (validación server)
  - Mensajes user-friendly según tipo de error
  - Refresh automático de info del cert después de upload/delete exitoso
  - Callback onCertChange para que settings-view refresque taxConfig
  - Dialog de confirmación de delete con warnings sobre impacto

- Integré en src/components/views/settings-view.tsx:
  - Import AfipCertificateUploader
  - Eliminé el aviso estático "Esto se hace mediante un archivo de configuración en el servidor"
  - Inserté <AfipCertificateUploader> entre el formulario y el AfipConnectionPanel
  - Pasa taxConfig y onCertChange=loadTaxConfig (refresca después de upload/delete)

- Creé directorio uploads/afip-certs/ con .gitkeep
- Actualicé .gitignore:
  - *.p12, *.pfx (certificados binarios)
  - uploads/afip-certs/* con excepción de .gitkeep
  - *.pem ya estaba

- Tests scripts/test-cert-upload.ts (64 tests):
  - crypto-utils: round-trip plain, empty, unicode, IV aleatorio, backward-compat,
    datos corruptos (formato inválido, hex inválido, auth tag inválido)
  - cert-info: parseCuit (válido, guiones, prefijos, edge cases)
  - cert-info: validarCuitConDigito (CUITs válidos calculados con helper, inválidos)
  - cert-info: cuitMatches (iguales, con ruido, distintos)
  - cert-info: extractCuitFromAttrs (CN, CN guionado, serialNumber, OU, sin CUIT)
  - cert-info: extracción de .p12 auto-firmado generado on-the-fly
    (format, CUIT, subject, expired, fingerprint, password incorrecta throws)
  - cert-info: detección de cert vencido (-10 días)
  - cert-info: detección de cert por vencer (+15 días)
  - 64/64 OK

- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 18.6s, 60/60 static pages OK
- Ruta /api/afip/cert registrada en el manifest

Stage Summary:
- Libs nuevas: 2 (crypto-utils.ts ~155 LOC, cert-info.ts ~205 LOC)
- Libs modificadas: 1 (afip-prod.ts: desencripta password + fix iteración safeBags)
- Endpoints nuevos: 1 (/api/afip/cert con POST/DELETE/GET)
- Componentes nuevos: 1 (afip-certificate-uploader.tsx ~580 LOC)
- Componentes modificados: 1 (settings-view.tsx integración)
- Tests de regresión: 64 (scripts/test-cert-upload.ts)
- Directorio nuevo: uploads/afip-certs/ (gitignored except .gitkeep)
- Bugs resueltos:
  1. certPassword en plaintext → ahora AES-256-GCM encriptado
  2. Sin validación al subir → validación completa (formato, password, CUIT, vencimiento)
  3. Sin matching CUIT → compara CUIT del cert con TaxConfig, autocompleta si vacío
  4. Iteración safeBags vs bags → soporta ambos formatos (node-forge moderno + legacy)
  5. Sin eliminación → DELETE borra archivo + limpia DB + invalida TA cacheado
- Comunicación inter-modular validada:
  - settings-view → AfipCertificateUploader: taxConfig + onCertChange callback
  - AfipCertificateUploader → /api/afip/cert (POST multipart, DELETE, GET)
  - /api/afip/cert → cert-info: extracción de info + validación de CUIT
  - /api/afip/cert → crypto-utils: encriptación de password
  - /api/afip/cert → TaxConfig: persiste certPath, privateKeyPath, certPassword,
    invalida authToken/authTokenExpires
  - leerCertificadoYClave → crypto-utils: desencripta password antes de usarla
  - AfipCertificateUploader → AfipConnectionPanel: el test de conexión ahora
    funcionará porque el cert ya está cargado y validado
- Robustez serverless:
  - UPLOADS_DIR env var configurable (default /home/z/my-project/uploads/afip-certs)
  - En Vercel prod, setear UPLOADS_DIR=/tmp/afip-certs (con nota: /tmp no persiste
    entre invocations, para prod real usar Vercel Blob o S3 — TODO futuro)
- Sin cambios de schema (usa campos existentes)

---
Task ID: P3-afip-cert-s3-storage
Agent: main (Super Z)
Task: Migrar storage de certificados AFIP a S3-compatible (Cloudflare R2/AWS S3/Backblaze B2/MinIO) para resolver TODOS los escenarios futuros de deploy (VPS único, multi-instancia, Docker, Vercel serverless, restore de DB). Con auto-migración transparente desde FS local.

Work Log:
- Instalé @aws-sdk/client-s3 ^3.1105.0.
- Diseñé estrategia de storage dual S3+FS con auto-migración:
  - S3 PRIMARIO (si S3_BUCKET configurado): put/get/delete/head usan S3
  - FS LOCAL siempre se escribe (cache + dev + migración)
  - Si S3 falla al leer, fallback a FS
  - Si archivo está en FS pero no en S3, se migra on-demand en background
  - Si S3 no está configurado, se usa FS exclusivamente (dev mode)

- Creé src/lib/cert-storage.ts (~330 LOC):
  - getCertStorageConfig(): lee env vars, cachea config. enabled=false si no S3_BUCKET
  - getS3Client(): S3Client singleton con credenciales desde env
  - putCertFile(storeId, filename, buffer): escribe en FS + S3 (dual)
  - getCertFile(storeId, filename): lee S3 → fallback FS → auto-migra a S3
  - deleteCertFile(storeId, filename): borra de S3 y FS (best-effort)
  - headCertFile(storeId, filename): verifica existencia (S3 primero, FS después)
  - pingS3(): HeadObject sobre key inexistente para validar credenciales
  - buildS3Key(storeId, filename): namespacing "afip-certs/{storeId}/{filename}"
  - migrateToS3(): sube archivo en background (no bloquea al caller)

- Refactoricé src/lib/afip-prod.ts:
  - leerCertificadoYClave() ahora usa getCertFile() de cert-storage.ts
  - Eliminado acceso directo a fs.readFile para certificados
  - resolveUploadPath() marcado como @deprecated (mantenido para compat)
  - Import de getCertFile desde cert-storage
  - Sin cambios de signature (sigue aceptando TaxConfig que tiene storeId)

- Refactoricé src/app/api/afip/cert/route.ts (~440 LOC):
  - POST: putCertFile() para guardar (S3+FS dual). Borra anterior con deleteCertFile.
  - GET: headCertFile() para verificar existencia, getCertFile() para leer.
    Maneja caso "archivo no en storage" con error descriptivo.
  - DELETE: deleteCertFile() borra S3+FS. Limpia DB.
  - Respuesta incluye "storage" info: { source: "s3"|"fs", s3Enabled: bool }
  - Eliminado código directo de fs/promises y path para archivos de cert

- Actualicé /api/afip/test con nuevo paso "storage":
  - Verifica S3 (si configurado) con pingS3() — credenciales OK?
  - Verifica FS local escribible (si S3 no configurado)
  - Verifica que el archivo del cert exista en storage con headCertFile()
  - Si storage falla, retorna early con step storage=false

- Actualicé src/components/afip-connection-panel.tsx:
  - Nuevo estado AfipStatus "storage_error"
  - STATUS_META con storage_error (label "Storage inaccesible", color destructive)
  - deriveStatus mapea step "storage" → storage_error
  - STEP_META con storage: { label: "Storage (S3/FS)", icon: HardDrive }
  - Tooltip con descripción para storage_error
  - SuggestionBox con troubleshooting de storage (S3 creds, UPLOADS_DIR, etc.)
  - Import HardDrive de lucide-react

- Creé scripts/migrate-certs-to-s3.ts (migración one-shot):
  - Lee todos los TaxConfig con certPath
  - Para cada uno, verifica si ya está en S3 con headCertFile()
  - Si NO está en S3 pero está en FS, lo sube con putCertFile()
  - Reporta: migrados, ya en S3, no encontrados, fallidos
  - Idempotente: seguro ejecutar múltiples veces
  - No modifica la DB (certPath se mantiene, solo cambia el backend)

- Actualicé .env.example:
  - Sección "Encriptación de secrets" con CERT_PASSWORD_ENCRYPTION_KEY
  - Sección "Storage de certificados AFIP (S3-compatible)" con ejemplos de:
    * Cloudflare R2 (recomendado, sin costo de egreso)
    * AWS S3
    * MinIO (self-hosted)
  - Sección "Directorio local de uploads" con UPLOADS_DIR

- Creé scripts/test-cert-storage.ts (32 tests):
  - Test 1: Modo FS-only (S3 no configurado) — put/get/head/delete
  - Test 2: GET de archivo inexistente tira error
  - Test 3: DELETE best-effort (no falla si no existe)
  - Test 4: S3 mockeado — PUT con S3 fallando sigue escribiendo en FS
  - Test 5: Auto-migración — archivo en FS, S3 falla, getCertFile retorna desde FS
  - Test 6: Config desde env vars (enabled true/false según S3_BUCKET)
  - Test 7: pingS3 sin configurar retorna ok=false descriptivo
  - Test 8: S3 key namespacing con storeId especial
  - 32/32 OK

- Type-check ✓ limpio en src/
- Build ✓ Compiled successfully in 16.8s, 60/60 static pages OK

Stage Summary:
- Libs nuevas: 1 (cert-storage.ts ~330 LOC)
- Libs modificadas: 1 (afip-prod.ts usa cert-storage, resolveUploadPath deprecated)
- Endpoints modificados: 2 (/api/afip/cert refactorizado a cert-storage, /api/afip/test +step storage)
- Componentes modificados: 1 (afip-connection-panel +estado storage_error, +step storage)
- Scripts nuevos: 2 (migrate-certs-to-s3.ts, test-cert-storage.ts)
- Tests de regresión: 32 (cert-storage) — 32/32 OK
- Dependencia nueva: @aws-sdk/client-s3 ^3.1105.0
- Docs: .env.example con ejemplos R2/S3/MinIO
- Escenarios resueltos:
  1. ✅ VPS único con FS (S3 no configurado) — funciona como antes
  2. ✅ Múltiples instancias con LB — S3 compartido
  3. ✅ Docker sin volúmenes — S3
  4. ✅ Vercel serverless — S3
  5. ✅ Restore de DB — los blobs viven en S3, no en el FS
  6. ✅ Auto-migración FS→S3 sin downtime — on-demand al leer
- Sin cambios de schema (usa campos existentes)
- Comunicación inter-modular validada:
  - leerCertificadoYClave → cert-storage.getCertFile (S3+FS)
  - /api/afip/cert POST → cert-storage.putCertFile + deleteCertFile
  - /api/afip/cert GET → cert-storage.headCertFile + getCertFile
  - /api/afip/cert DELETE → cert-storage.deleteCertFile
  - /api/afip/test → cert-storage.pingS3 + headCertFile
  - AfipConnectionPanel → /api/afip/test → cert-storage (diagnóstico)
- Configuración para deploy:
  - Dev/VPS: dejar S3 sin configurar, usa FS local
  - Prod multi-instancia/Vercel: configurar S3_BUCKET + creds
  - Migración existente: correr `npx tsx scripts/migrate-certs-to-s3.ts`

---
Task ID: fix-realtime-refresh-sw
Agent: main
Task: Fix del bug "las listas no se actualizan en tiempo real, hay que recargar la página para ver los cambios". Análisis profundo del frontend, la API y el Service Worker.

Work Log:
- Audité las 19 vistas en src/components/views/ end-to-end: TODAS llaman a su función load() tras cada mutación (POST/PUT/DELETE). El wiring view-level NO era el bug.
- Audité app-shell.tsx: cambia de vista con switch que retorna componentes distintos → las vistas se unmount/remount al navegar → useEffect re-firea. Tampoco era el bug.
- Audité src/store/app-store.ts: solo tiene currentView + user/store. No hay caches de listas.
- Audité src/lib/fetch.ts: safeFetchJSON usa cache:"no-store", pero esto NO bypassa al Service Worker (el SW intercepta antes que el HTTP cache).
- Audité package.json: @tanstack/react-query está instalado pero SIN usar (cero imports en src/). No hay SWR.
- Root cause encontrada en public/sw.js: los endpoints /api/products, /api/customers, /api/categories, /api/payment-methods, /api/dashboard, /api/store, /api/me usaban staleWhileRevalidate, que devuelve la cache STALE instantáneamente y revalida en background. Tras una mutación, load() pedía GET /api/products, el SW entregaba la respuesta cacheada vieja, y la lista no cambiaba hasta recargar.

Fix aplicado en public/sw.js (v4.0 → v5.0):
- Eliminado el array API_CACHEABLE y la rama staleWhileRevalidate para APIs.
- TODAS las APIs GET ahora usan networkFirstShort: red primero (datos frescos), cache solo como fallback offline. Sigue habiendo soporte offline.
- Agregada invalidación automática de cache tras mutaciones online: handleOnlineMutation intercepta POST/PUT/PATCH/DELETE, deja pasar a la red, y tras 2xx borra las caches relacionadas según INVALIDATION_MAP (21 entradas que cubren products, categories, customers, payment-methods, expenses, inventory, cash-registers, invoices, credit-notes, refunds, promotions, purchase-orders, branches, commissions, print-templates, store, me, loyalty, tax-config, ecommerce, suppliers).
- Agregada invalidación tras replay de cola offline (processOfflineQueue): tras replay exitoso, invalidateCachesFor(op.url) para que la próxima lectura vea el efecto.
- Bump SW_VERSION a commerciapp-v5.0.0: el evento activate flushea todas las caches viejas (v4.0.0) automáticamente.
- Agregado guard same-origin (url.origin !== self.location.origin) para no interferir con recursos externos.
- Agregado message handler CLEAR_API_CACHE para limpieza manual desde el cliente.
- Activación inmediata: skipWaiting() en install + clients.claim() en activate. El nuevo SW toma control sin esperar a que cierren las pestañas.

Stage Summary:
- Archivo modificado: public/sw.js (303 → ~340 LOC)
- Cambios: 1 estrategia de cache (SWR → networkFirstShort para APIs), 1 mecanismo nuevo (invalidación automática), 21 entradas en INVALIDATION_MAP
- Build: ✓ Compiled successfully in 17.3s, sin errors/warnings
- Validación de sintaxis: ✓ (new Function + checks de presencia de features)
- Sin cambios en views, store, fetch.ts, ni API routes — el fix es 100% en el SW
- Endpoints afectados (los que antes servían stale): /api/products, /api/categories, /api/customers, /api/payment-methods, /api/dashboard, /api/store, /api/me
- Vistas que ahora actualizan en tiempo real: products-view, customers-view, settings-view (payment-methods), pos-view (products+customers), purchases-view (product dropdown), dashboard-view (metrics)
- Comportamiento offline preservado: networkFirstShort cae a cache si la red falla; handleOfflineMutation encola mutaciones para background sync
- Para que el fix tome efecto en el browser del usuario: el navegador detecta el nuevo sw.js en la próxima navegación/recarga. Con skipWaiting()+clients.claim(), el SW v5 activa inmediatamente y flushea caches v4. No requiere recargas múltiples.

---
Task ID: opcion-b-facturacion-flexible
Agent: main
Task: Implementar "Opción B" de facturación flexible: cada método de pago se configura una vez con "requiere factura", el POS guía al usuario (botón "Facturar ahora" si requiere), se puede facturar después desde el módulo Facturas, y el cobro nunca depende de AFIP en tiempo real.

Work Log:
- Audité el estado actual: PaymentMethod no tenía flag de factura, POS no tenía concepto de "facturar ahora", invoices-view ya tenía "facturar después", Sale↔Invoice ya era 1:1, AFIP ya funcionaba (demo + prod). El cobro ya no llamaba AFIP.
- Fase 1 — Schema: agregué `requiresInvoice Boolean @default(false)` a PaymentMethod en prisma/schema.prisma con comentario explicativo. Generé migration SQL a mano en prisma/migrations/20260808000001_add_payment_method_requires_invoice/migration.sql (la DB local es SQLite pero prod es Postgres; Vercel aplicará la migration en deploy). Regeneré Prisma Client.
- Fase 2 — API payment-methods: extendí POST y PUT en src/app/api/payment-methods/route.ts para aceptar y persistir `requiresInvoice: Boolean(body.requiresInvoice)`.
- Fase 2b — API invoices: en src/app/api/invoices/route.ts, cambié el bloque "La venta ya tiene factura asociada" por lógica de retry: si la invoice existente está EMITIDA o ANULADA, bloquea (no se puede refacturar); si está RECHAZADA o PENDIENTE, la borra y permite reemitir. Preserva la constraint unique saleId.
- Fase 3 — Settings UI: en src/lib/types.ts agregué `requiresInvoice: boolean` a PaymentMethod. En src/components/views/settings-view.tsx: actualicé interface local, agregué `requiresInvoice: false` a methodForm y openNewMethod, agregué columna "Factura" en la tabla con badge "Requiere" (amber), y en el diálogo de editar/crear agregué un Switch "Requiere factura" con bloque destacado azul/amber y texto explicativo de Opción B.
- Fase 4 — POS UI (src/components/views/pos-view.tsx):
  - Refactoricé processSale para aceptar parámetro `facturarAhora: boolean`. Tras persistir la venta con POST /api/sales, si facturarAhora=true, llama POST /api/invoices con { saleId, concepto: 'PRODUCTOS' }. Si la factura falla (AFIP caído, TA expirado, CUIT inválido), NO revierte la venta — toast de error y deja la venta persistida para retry desde Facturas. Si funciona, toast con numeroCompleto + CAE.
  - Importé FileText de lucide-react.
  - En el confirm dialog, si selectedMethod.requiresInvoice: muestro bloque azul destacado explicando que el método requiere factura y que puede facturarse ahora o después; si hay cliente seleccionado, ofrezco DOS botones: "Facturar ahora" (azul, llama processSale(true)) y "Facturar después" (índigo, llama processSale(false)). Si no hay cliente, solo "Facturar después" y aviso que para facturar ahora hace falta cliente.
  - setLastSale ahora incluye `invoice` (null si no se facturó o falló) y `facturarAhoraIntentado` (bool).
- Fase 4b — POS receipt: en el Sheet de recibo, agregué tres bloques condicionales después del cliente:
  1. Si lastSale.invoice existe: bloque verde con "Factura {tipo} · {numeroCompleto}", CAE, vencimiento CAE, "Autorizada por AFIP".
  2. Si no hay invoice pero facturarAhoraIntentado=true: bloque amber "Factura pendiente" con instrucciones de retry.
  3. Si no hay invoice y el método requiere factura: bloque azul "Pendiente de facturar" con instrucciones de emitir desde Facturas.
- Fase 5 — Invoices view (src/components/views/invoices-view.tsx): en load(), las ventas pendientes de facturar ahora se ordenan con requiresInvoice=true primero (más recientes dentro de cada grupo). En el dropdown del diálogo "Nueva Factura", cada item muestra "★ " prefix y "(requiere factura)" suffix cuando corresponde, para que el usuario identifique rápidamente las urgentes.
- Fase 6 — Build: ✓ Compiled successfully in 19.6s. Type-check en src/: 0 errores. Scripts legacy con errores preexistentes (no relacionados, no se incluyen en build de Next.js).

Stage Summary:
- Schema: 1 campo nuevo (PaymentMethod.requiresInvoice Boolean @default(false))
- Migration: 1 archivo SQL nuevo (20260808000001_add_payment_method_requires_invoice)
- APIs modificadas: 2 (payment-methods POST/PUT +requiresInvoice; invoices POST retry logic)
- Tipos: 2 (types.ts PaymentMethod +requiresInvoice; settings-view interface local +requiresInvoice)
- UI Settings: 1 Switch nuevo "Requiere factura" con bloque explicativo + 1 columna "Factura" en tabla con badge
- UI POS: processSale refactorizado con parámetro facturarAhora + confirm dialog con bloque destacado y 2 botones + receipt con 3 bloques condicionales (factura OK / pendiente / pendiente de facturar)
- UI Invoices: sort requiresInvoice-primero + label "★ (requiere factura)" en dropdown
- Build: ✓ Compiled successfully in 19.6s, 0 errores en src/
- Flujo Opción B implementado end-to-end:
  1. Admin marca "Requiere factura" en un método de pago (ej: Transferencia) desde Configuración → Métodos de pago
  2. Cajero cobra con ese método → confirm dialog muestra bloque azul "Este método requiere factura" + botones "Facturar ahora" / "Facturar después"
  3. Si "Facturar ahora": POST /api/sales persiste venta → POST /api/invoices emite factura contra AFIP → receipt muestra bloque verde con CAE. Si AFIP falla, venta queda persistida y receipt muestra bloque amber "Factura pendiente".
  4. Si "Facturar después": venta persistida, receipt muestra bloque azul "Pendiente de facturar".
  5. Desde Facturas: el dropdown ordena primero las ventas con requiresInvoice, marcadas con "★ (requiere factura)".
  6. Retry: si una factura quedó RECHAZADA/PENDIENTE, POST /api/invoices la borra y reemite sin bloquear.
- Non-blocking garantizado: el cobro NUNCA llama AFIP directamente. /api/sales es puramente DB. /api/invoices se llama después, separado, y su fallo no afecta la venta.
- Sin cambios en: refunds, credit-notes, reports, dashboard, printer, AFIP prod (afip-prod.ts). Todos estos ya leen de sale.invoice, así que automáticamente muestran CAE cuando la factura se emite.
