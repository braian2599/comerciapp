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
 *
 * ROBUSTEZ (P2.2 hardening):
 *  - isTotal ahora se determina AFTER de procesar los items, verificando
 *    que TODOS los items de la venta estén en la solicitud Y que cada
 *    cantidad pedida sea igual a la cantidad original vendida.
 *    Antes: isTotal = (length === sale.items.length) — falso positivo
 *    cuando el usuario pedía cantidades parciales de todos los items.
 *  - requestedItems debe ser un Array. Se rechazan entradas no-array.
 *  - Se rechazan saleItemId duplicados (ambigüedad de intención).
 *  - Se validan tipos de quantity (Number.isFinite, > 0, <= original).
 *  - Todos los montos se redondean a 2 decimales (moneda ARS).
 *  - sale.subtotal=0 con items es tratado como error (no fallback mágico).
 */

/** Decimales usados para redondeo monetario. ARS usa 2. */
const MONEY_DECIMALS = 2;

function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** MONEY_DECIMALS) / 10 ** MONEY_DECIMALS;
}

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
 * Normaliza y valida la entrada de items solicitados.
 * - Acepta undefined/null/[] como "devolución total explícita".
 * - Rechaza cualquier cosa que no sea Array.
 * - Coacciona quantity a Number y valida que sea finito y > 0.
 * - Rechaza saleItemId duplicados.
 * - Rechaza saleItemId que no exista en sale.items.
 *
 * @returns Array normalizado de { saleItemId, quantity }
 * @throws Error con mensaje user-friendly si la entrada es inválida.
 */
function normalizeRequestedItems(
  sale: SaleForRefund,
  requestedItems: unknown
): RequestedRefundItem[] {
  // undefined/null/[] → devolución total explícita (array vacío)
  if (requestedItems == null) return [];

  if (!Array.isArray(requestedItems)) {
    throw new Error(
      `Formato de items inválido: se esperaba un array, se recibió ${typeof requestedItems}`
    );
  }

  const seen = new Set<string>();
  const normalized: RequestedRefundItem[] = [];

  for (let i = 0; i < requestedItems.length; i++) {
    const raw = requestedItems[i];
    if (!raw || typeof raw !== "object") {
      throw new Error(`Item #${i + 1}: formato inválido (se esperaba objeto)`);
    }
    const r = raw as { saleItemId?: unknown; quantity?: unknown };
    const saleItemId = r.saleItemId;
    if (typeof saleItemId !== "string" || saleItemId.length === 0) {
      throw new Error(
        `Item #${i + 1}: saleItemId inválido (se esperaba string no vacío)`
      );
    }
    const qtyNum = Number(r.quantity);
    if (!Number.isFinite(qtyNum)) {
      throw new Error(
        `Item #${i + 1} (${saleItemId}): quantity inválida (se recibió "${String(r.quantity)}")`
      );
    }
    if (qtyNum <= 0) {
      throw new Error(
        `Item #${i + 1} (${saleItemId}): quantity debe ser > 0 (se recibió ${qtyNum})`
      );
    }

    // Validar pertenencia a la venta
    const saleItem = sale.items.find((it) => it.id === saleItemId);
    if (!saleItem) {
      throw new Error(
        `Item ${saleItemId} no pertenece a la venta ${sale.id}`
      );
    }

    // Validar cantidad ≤ original vendida
    if (qtyNum > saleItem.quantity) {
      throw new Error(
        `Cantidad ${qtyNum} excede la vendida (${saleItem.quantity}) para el item ${saleItemId}`
      );
    }

    // Rechazar duplicados (frontend nunca debería mandarlos, pero si lo
    // hace, es ambiguo: ¿sumar? ¿tomar el último? Mejor fallar explícito).
    if (seen.has(saleItemId)) {
      throw new Error(
        `Item ${saleItemId} aparece más de una vez en la solicitud — combine las cantidades en una sola entrada`
      );
    }
    seen.add(saleItemId);

    normalized.push({ saleItemId, quantity: qtyNum });
  }

  return normalized;
}

/**
 * Calcula los montos de una devolución.
 *
 * @throws Error con mensaje user-friendly si:
 *   - requestedItems no es array
 *   - algún saleItemId no pertenece a la venta
 *   - algún saleItemId está duplicado
 *   - alguna quantity es inválida (<= 0, NaN, > original)
 *   - sale.subtotal <= 0 pero hay items (inconsistencia)
 */
export function calculateRefundTotals(
  sale: SaleForRefund,
  requestedItems: unknown
): RefundTotals {
  // Validar consistencia mínima de la venta
  if (!sale || !Array.isArray(sale.items)) {
    throw new Error("Venta inválida: falta lista de items");
  }
  if (sale.items.length === 0) {
    throw new Error("La venta no tiene items — no se puede devolver");
  }

  // Sanitizar números de la venta (pueden venir como strings desde DB)
  const saleSubtotal = Number(sale.subtotal) || 0;
  const saleDiscount = Number(sale.discount) || 0;
  const saleTax = Number(sale.tax) || 0;
  const saleSurcharge = Number(sale.surcharge) || 0;
  const saleTotal = Number(sale.total) || 0;

  // Validar que si hay items, el subtotal sea coherente (no necesariamente
  // igual a Σ items × price porque puede haber redondeo, pero > 0).
  // Si sale.subtotal === 0 con items, es un snapshot corrupto.
  if (saleSubtotal <= 0 && sale.items.length > 0) {
    throw new Error(
      `La venta ${sale.id} tiene subtotal 0 pero ${sale.items.length} items — snapshot inconsistente, no se puede calcular prorrateo`
    );
  }

  // Normalizar y validar entrada
  const normalizedItems = normalizeRequestedItems(sale, requestedItems);

  // ---------- Caso 1: devolución total explícita (requestedItems vacío) ----------
  if (normalizedItems.length === 0) {
    const refundItems: RefundItemComputed[] = sale.items.map((item) => ({
      saleItemId: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      subtotal: item.subtotal,
    }));
    const refundSubtotal = sale.items.reduce((s, it) => s + it.subtotal, 0);

    // En devolución total, los componentes son exactamente los de la venta.
    // Esto garantiza refundTotal === sale.total (sin drift de redondeo).
    return {
      isTotal: true,
      items: refundItems,
      refundSubtotal: roundMoney(refundSubtotal),
      refundDiscount: roundMoney(saleDiscount),
      refundTaxable: roundMoney(refundSubtotal - saleDiscount),
      refundTax: roundMoney(saleTax),
      refundSurcharge: roundMoney(saleSurcharge),
      refundTotal: roundMoney(saleTotal),
      discountProportion: saleSubtotal > 0 ? saleDiscount / saleSubtotal : 0,
      taxRate: saleSubtotal - saleDiscount > 0 ? saleTax / (saleSubtotal - saleDiscount) : 0,
      surchargeRate:
        saleSubtotal - saleDiscount + saleTax > 0
          ? saleSurcharge / (saleSubtotal - saleDiscount + saleTax)
          : 0,
    };
  }

  // ---------- Caso 2: devolución parcial ----------
  // Procesar cada item solicitado usando el snapshot de la venta.
  const refundItems: RefundItemComputed[] = [];
  let refundSubtotalRaw = 0;
  const requestedById = new Map<string, number>();
  for (const req of normalizedItems) {
    requestedById.set(req.saleItemId, req.quantity);
    const saleItem = sale.items.find((it) => it.id === req.saleItemId)!; // existe, validado arriba
    const itemSubtotal = saleItem.unitPrice * req.quantity;
    refundItems.push({
      saleItemId: saleItem.id,
      productId: saleItem.productId,
      quantity: req.quantity,
      unitPrice: saleItem.unitPrice,
      costPrice: saleItem.costPrice,
      subtotal: itemSubtotal,
    });
    refundSubtotalRaw += itemSubtotal;
  }

  // Prorratear descuento/impuesto/recargo sobre el subtotal devuelto
  const discountProportion = saleSubtotal > 0 ? saleDiscount / saleSubtotal : 0;
  const refundDiscount = refundSubtotalRaw * discountProportion;

  const taxableSale = saleSubtotal - saleDiscount;
  const refundTaxable = refundSubtotalRaw - refundDiscount;
  const taxRate = taxableSale > 0 ? saleTax / taxableSale : 0;
  const refundTax = refundTaxable * taxRate;

  const surchargeRate =
    taxableSale + saleTax > 0 ? saleSurcharge / (taxableSale + saleTax) : 0;
  const refundSurcharge = (refundTaxable + refundTax) * surchargeRate;
  const refundTotal = refundTaxable + refundTax + refundSurcharge;

  // ---------- Determinar isTotal AFTER de procesar ----------
  // isTotal es true si y solo si:
  //   - se solicitó TODOS los items de la venta, Y
  //   - para cada uno, la cantidad solicitada es EXACTAMENTE igual a la vendida.
  // Esto evita el bug anterior donde length === sale.items.length
  // implicaba isTotal=true aunque las cantidades fueran parciales.
  let isTotal = false;
  if (normalizedItems.length === sale.items.length) {
    isTotal = sale.items.every((si) => {
      const requestedQty = requestedById.get(si.id);
      return requestedQty !== undefined && requestedQty === si.quantity;
    });
  }

  return {
    isTotal,
    items: refundItems,
    refundSubtotal: roundMoney(refundSubtotalRaw),
    refundDiscount: roundMoney(refundDiscount),
    refundTaxable: roundMoney(refundTaxable),
    refundTax: roundMoney(refundTax),
    refundSurcharge: roundMoney(refundSurcharge),
    refundTotal: roundMoney(refundTotal),
    discountProportion,
    taxRate,
    surchargeRate,
  };
}
