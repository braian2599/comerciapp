# Plan de Desarrollo Comerciapp — Siguientes Pasos

**Fecha**: 2026-08-07
**Base**: Auditoría AUDIT-1 (18 módulos, 56 endpoints, 13.966 LOC en views)

---

## 🎯 Estado actual del sistema

### ✅ Lo que ya funciona bien (14/18 módulos)
- **POS** (hub central, integra 10 módulos, con persistencia robusta)
- **Products** (CRUD + categorías + import + barcode + imágenes)
- **Sales** (lista + anulación con reintegro de stock)
- **Customers** (CRUD + cuenta corriente + loyalty + import)
- **Inventory** (ajustes ENTRADA/SALIDA/AJUSTE)
- **Cash register** (apertura/cierre + movimientos auto desde sales/expenses)
- **Promotions** (CRUD + evaluate en POS)
- **Commissions** (reglas + cálculo auto en sales + batch update)
- **Expenses** (CRUD + suma a dashboard)
- **Purchases** (OC + receive → incrementa stock)
- **Reports** (6 sub-reportes con CSV export)
- **Dashboard** (KPIs + low-stock + ventas por día)
- **Print templates** (CRUD)
- **Branches** (CRUD)
- **Settings** (store + payment methods + AFIP demo + MP + loyalty)

### ⚠️ Lo que funciona parcial (3/18)
- **Invoices**: AFIP en modo demo (CAE simulado)
- **Refunds**: no emite nota de crédito AFIP (TODO backend)
- **Commissions**: filter muerto en línea 639 (cosmético)

### ❌ Lo que está roto (1/18)
- **Ecommerce**: botón "Probar conexión" llama a `/api/ecommerce/test` que **no existe** → 404

---

## 🚨 Prioridad 1 — Bugs críticos (esta semana)

### P1.1 — Fix ecommerce 404
**Archivo**: `src/app/api/ecommerce/test/route.ts` (crear) o `src/components/views/ecommerce-view.tsx:151-181` (eliminar botón)

**Acción recomendada**: Crear el endpoint. Es trivial: hace ping a la plataforma externa (Mercado Libre / WooCommerce / Tienda Nube) con las credenciales configuradas y retorna `{ ok: boolean, message: string }`.

### P1.2 — Migrar 9 llamadas `fetch()` crudas a `safeFetchJSON`
**Archivos**:
- `customers-view.tsx` líneas 200, 217, 235, 265, 285, 304 (6 calls)
- `pos-view.tsx` líneas 672, 715 (2 calls — promotions/evaluate y print)
- `sales-view.tsx` línea 451 (1 call — print)

**Por qué importa**: `safeFetchJSON` normaliza errores HTTP, parsea JSON seguro, maneja 401 (redirect a login). Las llamadas crudas pueden fallar silenciosamente.

---

## 🔧 Prioridad 2 — Robustez inter-modular (2-3 semanas)

### P2.1 — Validar flujo `refunds → customers` (crédito en cuenta corriente)
**Hipótesis a verificar**: Cuando en `/api/refunds` se selecciona método `CREDITO_CUENTA`, ¿se acredita el saldo en `CustomerAccount`?

**Acción**:
1. Leer `src/app/api/refunds/route.ts` completo
2. Verificar si hay `prisma.customerAccount.update({ where: { customerId }, data: { balance: { increment: amount } } })` o equivalente
3. Si falta, agregar la acreditación atómica dentro de la misma transacción que crea el refund
4. Test manual: crear una venta → anular/devolución con CREDITO_CUENTA → verificar saldo en `customers-view`

### P2.2 — Mover cálculo prorrateado de refunds al backend
**Archivo**: `src/components/views/refunds-view.tsx:131-160`

**Problema**: El frontend calcula impuestos/recargos prorrateados sobre el monto devuelto. Es frágil: puede diverger del backend si cambia la fórmula.

**Acción**: Mover el cálculo a `/api/refunds` (backend). El frontend sólo envía `{ saleId, items: [{productId, qty}], reason, method, emitCreditNote }` y el backend retorna `{ refund: {...}, taxBreakdown: {...} }`.

### P2.3 — Implementar nota de crédito AFIP
**Archivo**: `src/app/api/refunds/route.ts:324` (TODO)

**Acción**:
- Si AFIP está habilitado en `tax-config`, llamar a `lib/afip.ts` con tipo comprobante "Nota de Crédito" vinculada a la factura original
- Almacenar CAE + número en `Refund.invoiceNumber` + `Refund.cae`
- Documentar que requiere certificado de producción AFIP

### P2.4 — Unificar manejo de stock movements
**Estado**: Ya está centralizado vía `StockMovement` (Prisma model). Pero los 4 puntos que lo tocan (sales, sales/annul, refunds, purchase-orders/receive, inventory) deberían usar una función compartida.

**Acción**: Crear `src/lib/stock.ts` con:
```ts
export async function decrementStock(
  tx: PrismaTransaction,
  storeId: string,
  productId: string,
  qty: number,
  reason: StockMovementType,
  refId?: string
): Promise<void>
```
Y migrar los 4 callers para usarla. Esto evita que un bug futuro en uno de los puntos genere drift en el stock.

---

## 🚀 Prioridad 3 — Funcionalidad de producción (1-2 meses)

### P3.1 — AFIP producción
**Bloqueador**: Requiere certificado de producción + clave priv. del cliente.

**Acción**:
- Documentar onboarding AFIP en README
- En `settings-view`, agregar tab "AFIP Producción" con upload de certificado (.pem) y CUIT
- En `lib/afip.ts`, soportar entorno `prod` vs `demo` basado en `TaxConfig.afipEnvironment`

### P3.2 — Impresión física real (impresoras térmicas)
**Estado actual**: `print-templates-view` sólo configura plantillas. `/api/print` genera HTML/PDF. No hay conexión a impresora térmica (Epson TM-T20, etc.).

**Acciones opcionales**:
- **Opción A (recomendada)**: WebUSB API en browser → ESC/POS commands directamente a la impresora. Implementar en `src/lib/printer-usb.ts`
- **Opción B**: Servidor local (Express en puerto 8787) que recibe POST y manda a la impresora. Documentar instalación.
- **Opción C**: Usar `window.print()` con plantilla optimizada para 80mm (lo más simple, ya funciona).

### P3.3 — Stock multi-sucursal
**Problema**: El modelo Prisma actual tiene `Product.stock` global por `storeId`. Si hay 2 sucursales, no se puede saber cuánto stock hay en cada una.

**Acción**: Schema migration — agregar modelo:
```prisma
model BranchStock {
  id        String   @id @default(cuid())
  branchId  String
  productId String
  stock     Int
  @@unique([branchId, productId])
}
```
Esto es **grande** — afecta POS, sales, inventory, purchases, reports. No empezar hasta P1 y P2 estar completos.

---

## 🧪 Prioridad 4 — Calidad y tests (continuo)

### P4.1 — Tests E2E del flujo crítico de ventas
**Herramienta**: Playwright (ya viene con Next.js 16)

**Flujos a testear**:
1. Login → POS → agregar 3 productos → cobrar → verificación en sales-view
2. POS con cliente → canjear puntos → cobrar → verificar balance loyalty
3. Anular venta → verificar reintegro de stock
4. Refund parcial → verificar reintegro parcial + saldo cuenta corriente
5. Apertura caja → venta → cierre → arqueo cuadra

### P4.2 — Telemetría de errores en producción
**Herramienta**: Sentry (free tier)

**Acción**: Integrar `@sentry/nextjs`, configurar DSN en Vercel env vars. Capturar errores de API routes + client-side.

### P4.3 — Logging estructurado
**Problema**: `console.log` / `console.warn` dispersos. No hay correlation IDs.

**Acción**: Crear `src/lib/logger.ts` que envuelva console con levels (debug/info/warn/error) + context (storeId, userId, requestId). Usar en todas las API routes.

---

## 🗓️ Roadmap sugerido (8 semanas)

| Semana | Foco | Entregable |
|--------|------|-----------|
| **1** | P1.1 + P1.2 | Ecommerce test endpoint + 9 fetches migrados a safeFetchJSON |
| **2** | P2.1 + P2.2 | Validar refunds→account + mover cálculo prorrateado al backend |
| **3** | P2.3 + P2.4 | Nota de crédito AFIP + unificar stock movements |
| **4** | Tests E2E | Playwright + 5 flujos críticos en CI |
| **5** | P3.1 | AFIP producción (con cliente) + onboarding docs |
| **6** | P3.2 | Impresión térmica (WebUSB o servidor local) |
| **7** | P4.2 + P4.3 | Sentry + logger estructurado |
| **8** | P3.3 (inicio) | Diseño schema multi-sucursal + migración (sin deploy) |

---

## 🔗 Mapa de dependencias inter-modulares

```
                    ┌─────────────┐
                    │  settings   │ ← configura todo
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
        ┌────────────┤    store    ├────────────┐
        │            └─────────────┘            │
        │                                         │
   ┌────▼─────┐                            ┌─────▼────┐
   │ products │◄──────────────────────────►│ inventory│
   └────┬─────┘                            └─────┬────┘
        │                                         ▲
        │                                         │
   ┌────▼─────────────────────────────────────────▼────┐
   │                       pos                          │
   │  (cart → checkout → sale + print + MP + loyalty)   │
   └────┬────────────────────────────────────────────────┘
        │
        ▼
   ┌─────────┐    ┌──────────────┐    ┌──────────────┐
   │  sales  │───►│   refunds   │───►│  customers   │
   └────┬────┘    └──────────────┘    └──────┬───────┘
        │                                    │
        ├──► cash-registers                  │
        ├──► loyalty                         │
        ├──► commissions                     │
        ├──► promotions (usage)              │
        └──► invoices ──► AFIP               │
                                            ▼
                                    ┌──────────────┐
                                    │    account   │
                                    └──────────────┘

   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │  purchases   │───►│   suppliers  │    │   expenses   │
   │ (OC + recv)  │    └──────────────┘    └──────┬───────┘
   └──────┬───────┘                                │
          │                                        │
          └──► stock ◄─────────────────────────────┘
                            ▲
                            │
                  ┌─────────┴─────────┐
                  │    dashboard      │
                  │    reports (×6)   │
                  └───────────────────┘
```

---

## 📋 Próximos pasos inmediatos

1. **Hoy**: Confirmar que el deploy de Vercel funciona con el fix del carrito (commit `cf2f683` ya pusheado)
2. **Mañana**: Iniciar P1.1 (crear `/api/ecommerce/test/route.ts`)
3. **Esta semana**: P1.2 (migrar fetches crudos a safeFetchJSON)
4. **Próxima semana**: P2.1 (auditar flujo refunds → customer account)

¿Querés que arranque con alguna de estas tareas? Especialmente P1.1 y P1.2 son rápidas (menos de 1 hora cada una).
