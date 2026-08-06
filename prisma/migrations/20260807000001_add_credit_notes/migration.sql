-- =====================================================================
-- Migration: add_credit_notes
-- Date: 2026-08-07
-- Purpose: Add support for AFIP credit notes (Notas de Crédito)
--
-- Changes:
--   1. TaxConfig: add lastCreditNoteA/B/C counters (separate from invoices
--      because AFIP numbers NCs independently from facturas).
--   2. Invoice: add comprobanteSubtipo (FACTURA | NOTA_CREDITO | NOTA_DEBITO)
--      + relatedInvoiceId (self-FK to the original factura the NC is linked to).
--   3. Refund: rename invoiceId → creditNoteInvoiceId + add FK to Invoice +
--      unique constraint (1:1 — one refund has at most one NC).
--
-- Backward compatibility:
--   - Existing Invoice rows get comprobanteSubtipo='FACTURA' (default).
--   - Existing Refund rows with invoiceId=NULL stay NULL (no NC was ever emitted).
--   - Existing Refund rows with invoiceId=<some-id> were never created (the
--     field was unused in app code), so no data migration is needed.
-- =====================================================================

-- 1. TaxConfig: NC counters
ALTER TABLE "TaxConfig" ADD COLUMN "lastCreditNoteA" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TaxConfig" ADD COLUMN "lastCreditNoteB" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TaxConfig" ADD COLUMN "lastCreditNoteC" INTEGER NOT NULL DEFAULT 0;

-- 2. Invoice: comprobante subtype + self-reference to original factura
ALTER TABLE "Invoice" ADD COLUMN "comprobanteSubtipo" TEXT NOT NULL DEFAULT 'FACTURA';
ALTER TABLE "Invoice" ADD COLUMN "relatedInvoiceId" TEXT;

-- 3. Refund: rename invoiceId → creditNoteInvoiceId + add FK + unique
ALTER TABLE "Refund" RENAME COLUMN "invoiceId" TO "creditNoteInvoiceId";

-- 4. Indexes
CREATE INDEX "Invoice_storeId_comprobanteSubtipo_fechaEmision_idx"
  ON "Invoice"("storeId", "comprobanteSubtipo", "fechaEmision");
CREATE INDEX "Invoice_relatedInvoiceId_idx"
  ON "Invoice"("relatedInvoiceId");
CREATE INDEX "Refund_creditNoteInvoiceId_idx"
  ON "Refund"("creditNoteInvoiceId");

-- 5. Foreign keys
-- Self-FK: Invoice.relatedInvoiceId → Invoice.id (ON DELETE SET NULL so
-- deleting an original factura doesn't cascade to its NCs).
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_relatedInvoiceId_fkey"
  FOREIGN KEY ("relatedInvoiceId") REFERENCES "Invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: Refund.creditNoteInvoiceId → Invoice.id (ON DELETE SET NULL so
-- deleting an NC doesn't cascade to the refund; the refund keeps existing
-- but loses the link).
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_creditNoteInvoiceId_fkey"
  FOREIGN KEY ("creditNoteInvoiceId") REFERENCES "Invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Unique constraint on Refund.creditNoteInvoiceId (1:1 with Invoice.refund)
--    Partial unique index: only enforce uniqueness when the field is NOT NULL
--    (so multiple refunds with NULL creditNoteInvoiceId coexist).
CREATE UNIQUE INDEX "Refund_creditNoteInvoiceId_key"
  ON "Refund"("creditNoteInvoiceId")
  WHERE "creditNoteInvoiceId" IS NOT NULL;
