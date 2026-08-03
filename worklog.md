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
