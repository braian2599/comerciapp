-- =====================================================================
-- Migration: add_payment_method_requires_invoice
-- Date: 2026-08-08
-- Purpose: Opción B — cada método de pago indica si requiere factura.
--   Al cobrar con un método que tiene requiresInvoice=true, el POS ofrece
--   el botón "Facturar ahora". La factura puede emitirse en el momento o
--   después desde el módulo Facturas. El cobro nunca depende de AFIP en
--   tiempo real (la venta se persiste primero, la factura después).
-- =====================================================================

-- AlterTable: agregar columna requiresInvoice a PaymentMethod (default false)
ALTER TABLE "PaymentMethod" ADD COLUMN "requiresInvoice" BOOLEAN NOT NULL DEFAULT false;
