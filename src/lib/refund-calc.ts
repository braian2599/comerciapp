/**
 * Cálculo de montos para devoluciones.
 *
 * ANTECEDENTE:
 *  La lógica de prorrateo de descuento/impuesto/recargo estaba duplicada
 *  entre el backend (/api/refunds) y el frontend (refunds-view.tsx). Eso
 *  es frágil: si cambia la fórmula en un lado, diverge del otro.
 *
 *  Esta función centraliza el cálculo. La usa:
 *   - /api/refunds (POST) para persistir los montos correctos.
 *   - /api/refunds/preview (POST) para devolver al frontend una estimación
 *     antes de confirmar la devolución.
 *
 * FÓRMULA:
 *  - refundSubtotal = Σ(unitPrice × qty) de items a devolver
 *  - discountProportion = sale.discount / sale.subtotal (si subtotal > 0)
 *  - refundDiscount = refundSubtotal × discountProportion
 *  - refundTaxable = refundSubtotal - refundDiscount
 *  - taxRate = sale.tax / (sale.subtotal - sale.discount) [tasa efectiva]
 *  - refundTax = refundTaxable × taxRate
 *  - surchargeRate = sale.surcharge / (sale.subtotal - sale.discount + sale.tax)
 *  - refundSurcharge = (refundTaxable + refundTax) × surchargeRate
 *  - refundTotal = refundTaxable + refundTax + refundSurcharge
 *
 *  Caso especial: devolución total (no se especifican items o todos los
 *  items están completos). En ese caso, refundTotal = sale.total y los
 *  componentes son exactamente sale.discount, sale.tax, sale.surcharge.
 */

export interface SaleForRefund {
  id: string;
  subtotal: number;
  discount: number;
  tax: number;
  surcharge: number;
  total: number;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    costPrice: number;
    subtotal: number;
  }>;
}

export interface RequestedRefundItem {
  saleItemId: string;
  quantity: number;
}

export interface RefundItemComputed {
  saleItemId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  subtotal: number;
}

export interface RefundTotals {
  isTotal: boolean;
  items: RefundItemComputed[];
  refundSubtotal: number;
  refundDiscount: number;
  refundTaxable: number;
  refundTax: number;
  refundSurcharge: number;
  refundTotal: number;
  // Para info/trazabilidad
  discountProportion: number;
  taxRate: number;
  surchargeRate: number;
}

/**
 * Calcula los montos de una devolución.
 *
 * @throws Error si algún item solicitado no pertenece a la venta o si la
 *         cantidad es inválida (<= 0 o > quantity del item original).
 */
export function calculateRefundTotals(
  sale: SaleForRefund,
  requestedItems: RequestedRefundItem[]
): RefundTotals {
  const refundItems: RefundItemComputed[] = [];
  let refundSubtotal = 0;

  const isTotal =
    requestedItems.length === 0 ||
    requestedItems.length === sale.items.length;

  if (isTotal) {
    // Devolución total: todos los items completos
    for (const item of sale.items) {
      refundItems.push({
        saleItemId: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        subtotal: item.subtotal,
      });
      refundSubtotal += item.subtotal;
    }
  } else {
    // Devolución parcial
    for (const req of requestedItems) {
      const saleItem = sale.items.find((i) => i.id === req.saleItemId);
      if (!saleItem) {
        throw new Error(`Item ${req.saleItemId} no pertenece a la venta`);
      }
      const qty = Number(req.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cantidad inválida para item ${saleItem.id}`);
      }
      if (qty > saleItem.quantity) {
        throw new Error(
          `Cantidad ${qty} excede la cantidad vendida (${saleItem.quantity}) para el item ${saleItem.id}`
        );
      }
      refundItems.push({
        saleItemId: saleItem.id,
        productId: saleItem.productId,
        quantity: qty,
        unitPrice: saleItem.unitPrice,
        costPrice: saleItem.costPrice,
        subtotal: saleItem.unitPrice * qty,
      });
      refundSubtotal += saleItem.unitPrice * qty;
    }
  }

  // Prorratear descuento, impuesto, recargo
  const saleSubtotal = sale.subtotal || refundSubtotal;
  const discountProportion = saleSubtotal > 0 ? sale.discount / saleSubtotal : 0;
  const refundDiscount = refundSubtotal * discountProportion;

  const taxableSale = saleSubtotal - sale.discount;
  const refundTaxable = refundSubtotal - refundDiscount;
  const taxRate = taxableSale > 0 ? sale.tax / taxableSale : 0;
  const refundTax = refundTaxable * taxRate;

  const surchargeRate =
    taxableSale + sale.tax > 0
      ? sale.surcharge / (taxableSale + sale.tax)
      : 0;
  const refundSurcharge = (refundTaxable + refundTax) * surchargeRate;
  const refundTotal = refundTaxable + refundTax + refundSurcharge;

  return {
    isTotal,
    items: refundItems,
    refundSubtotal,
    refundDiscount,
    refundTaxable,
    refundTax,
    refundSurcharge,
    refundTotal,
    discountProportion,
    taxRate,
    surchargeRate,
  };
}
