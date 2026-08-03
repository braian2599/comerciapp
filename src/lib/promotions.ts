// ============================================================
// MOTOR DE PROMOCIONES / DESCUENTOS
// ============================================================
// Evalúa promociones activas contra un carrito de compra
// y retorna el descuento aplicable + explicación.

export type PromotionType = "PORCENTAJE" | "MONTO_FIJO" | "NXM" | "COMBO";
export type PromotionScope = "CART" | "CATEGORY" | "PRODUCT";

export interface CartItem {
  productId: string;
  categoryId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number; // precio de venta
  costPrice?: number;
}

export interface PromotionData {
  id: string;
  name: string;
  type: PromotionType;
  value: number;
  buyQuantity: number;
  getQuantity: number;
  scope: PromotionScope;
  categoryId?: string | null;
  productId?: string | null;
  minPurchase: number;
  maxDiscount?: number | null;
  startDate: Date;
  endDate?: Date | null;
  daysOfWeek?: string | null;
  startHour?: number | null;
  endHour?: number | null;
  active: boolean;
  priority: number;
  usageLimit?: number | null;
  usageCount: number;
  perCustomerLimit?: number | null;
}

export interface AppliedDiscount {
  promotionId: string;
  promotionName: string;
  type: PromotionType;
  discountAmount: number; // monto descontado en $
  description: string; // explicación legible
  affectedItems: { productId: string; name: string; quantity: number; saving: number }[];
}

/**
 * Verifica si una promoción está vigente en este momento.
 */
export function isPromotionActive(promo: PromotionData, now: Date = new Date()): boolean {
  if (!promo.active) return false;

  // Fechas
  if (promo.startDate > now) return false;
  if (promo.endDate && promo.endDate < now) return false;

  // Día de la semana (0 = domingo)
  if (promo.daysOfWeek) {
    const allowed = promo.daysOfWeek.split(",").map((d) => parseInt(d.trim(), 10));
    if (!allowed.includes(now.getDay())) return false;
  }

  // Hora del día
  if (promo.startHour !== null && promo.startHour !== undefined) {
    const hour = now.getHours();
    if (promo.endHour !== null && promo.endHour !== undefined) {
      // Rango normal (start < end): 9 a 18
      if (promo.startHour < promo.endHour) {
        if (hour < promo.startHour || hour >= promo.endHour) return false;
      } else {
        // Rango cruzando medianoche (start > end): 22 a 4
        if (hour < promo.startHour && hour >= promo.endHour) return false;
      }
    } else if (hour < promo.startHour) {
      return false;
    }
  }

  // Límite de usos
  if (promo.usageLimit !== null && promo.usageLimit !== undefined) {
    if (promo.usageCount >= promo.usageLimit) return false;
  }

  return true;
}

/**
 * Filtra items que aplican a la promoción según su scope.
 */
function getItemsInScope(promo: PromotionData, items: CartItem[]): CartItem[] {
  if (promo.scope === "CART") return items;
  if (promo.scope === "CATEGORY" && promo.categoryId) {
    return items.filter((i) => i.categoryId === promo.categoryId);
  }
  if (promo.scope === "PRODUCT" && promo.productId) {
    return items.filter((i) => i.productId === promo.productId);
  }
  return [];
}

/**
 * Calcula el descuento de una promoción sobre un carrito.
 * Devuelve null si la promoción no aplica o no produce descuento.
 */
export function evaluatePromotion(
  promo: PromotionData,
  items: CartItem[]
): AppliedDiscount | null {
  if (!isPromotionActive(promo)) return null;

  const scopedItems = getItemsInScope(promo, items);
  if (scopedItems.length === 0) return null;

  const scopedSubtotal = scopedItems.reduce(
    (sum, i) => sum + i.unitPrice * i.quantity,
    0
  );

  // Subtotal total del carrito (para validar minPurchase)
  const cartSubtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  if (promo.minPurchase > 0 && cartSubtotal < promo.minPurchase) return null;

  let discountAmount = 0;
  let description = "";
  const affectedItems: AppliedDiscount["affectedItems"] = [];

  switch (promo.type) {
    case "PORCENTAJE": {
      // Descuento porcentaje sobre el monto en scope
      discountAmount = (scopedSubtotal * promo.value) / 100;
      if (promo.maxDiscount !== null && promo.maxDiscount !== undefined) {
        discountAmount = Math.min(discountAmount, promo.maxDiscount);
      }
      description = `${promo.value}% OFF sobre ${scopedItems.length} producto(s)`;
      // Repartir el ahorro proporcionalmente
      for (const item of scopedItems) {
        const proportion = (item.unitPrice * item.quantity) / scopedSubtotal;
        const saving = discountAmount * proportion;
        affectedItems.push({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          saving,
        });
      }
      break;
    }

    case "MONTO_FIJO": {
      // Descuento fijo (no puede superar el monto en scope)
      discountAmount = Math.min(promo.value, scopedSubtotal);
      if (promo.maxDiscount !== null && promo.maxDiscount !== undefined) {
        discountAmount = Math.min(discountAmount, promo.maxDiscount);
      }
      description = `$${promo.value} OFF sobre el monto en scope`;
      for (const item of scopedItems) {
        const proportion = (item.unitPrice * item.quantity) / scopedSubtotal;
        affectedItems.push({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          saving: discountAmount * proportion,
        });
      }
      break;
    }

    case "NXM": {
      // Lleva N, paga M (ej: 2x1 -> buy=1, get=1; 3x2 -> buy=2, get=1)
      //promo.buyQuantity = cantidad que paga
      //promo.getQuantity = cantidad que se lleva gratis
      // Promoción se aplica por unidad de producto (por item)
      if (promo.buyQuantity <= 0) return null;
      const groupSize = promo.buyQuantity + promo.getQuantity;
      if (groupSize <= 0) return null;

      for (const item of scopedItems) {
        const totalQty = item.quantity;
        const freeGroups = Math.floor(totalQty / groupSize);
        const freeUnits = freeGroups * promo.getQuantity;
        if (freeUnits > 0) {
          const saving = freeUnits * item.unitPrice;
          discountAmount += saving;
          affectedItems.push({
            productId: item.productId,
            name: item.name,
            quantity: freeUnits,
            saving,
          });
        }
      }
      if (discountAmount <= 0) return null;
      description = `Llevá ${promo.buyQuantity + promo.getQuantity}, pagá ${promo.buyQuantity}`;
      break;
    }

    case "COMBO": {
      // Por ahora tratado igual que PORCENTAJE pero con descripción de combo
      discountAmount = (scopedSubtotal * promo.value) / 100;
      if (promo.maxDiscount !== null && promo.maxDiscount !== undefined) {
        discountAmount = Math.min(discountAmount, promo.maxDiscount);
      }
      description = `Combo: ${promo.value}% OFF en productos seleccionados`;
      for (const item of scopedItems) {
        const proportion = (item.unitPrice * item.quantity) / scopedSubtotal;
        affectedItems.push({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          saving: discountAmount * proportion,
        });
      }
      break;
    }

    default:
      return null;
  }

  if (discountAmount <= 0) return null;

  return {
    promotionId: promo.id,
    promotionName: promo.name,
    type: promo.type,
    discountAmount: Math.round(discountAmount * 100) / 100,
    description,
    affectedItems,
  };
}

/**
 * Evalúa todas las promociones activas contra un carrito.
 * Estrategia: mejor descuento (no acumula por tipo, evita colisiones).
 * Devuelve todas las promociones aplicables para que el usuario elija,
 * o la mejor combinación no conflictiva.
 */
export function evaluateAllPromotions(
  promotions: PromotionData[],
  items: CartItem[]
): AppliedDiscount[] {
  const results: AppliedDiscount[] = [];

  for (const promo of promotions) {
    const result = evaluatePromotion(promo, items);
    if (result) results.push(result);
  }

  // Ordenar por mayor descuento primero
  return results.sort((a, b) => b.discountAmount - a.discountAmount);
}

/**
 * Selecciona la mejor promoción para auto-aplicar (la de mayor descuento).
 */
export function pickBestPromotion(
  promotions: PromotionData[],
  items: CartItem[]
): AppliedDiscount | null {
  const results = evaluateAllPromotions(promotions, items);
  return results.length > 0 ? results[0] : null;
}
