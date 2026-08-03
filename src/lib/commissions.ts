/**
 * Librería de cálculo y gestión de comisiones para vendedores.
 *
 * Soporta 4 tipos de reglas:
 * - PORCENTAJE_VENTA: porcentaje del total de la venta
 * - PORCENTAJE_GANANCIA: porcentaje de la ganancia bruta (venta - costo)
 * - MONTO_FIJO_POR_VENTA: monto fijo por venta (sin importar el total)
 * - ESCALONADO: porcentaje variable según tramos de la venta (JSON en tiers)
 */

import { db } from "@/lib/db";

// ===== TIPOS =====
export type CommissionType =
  | "PORCENTAJE_VENTA"
  | "PORCENTAJE_GANANCIA"
  | "MONTO_FIJO_POR_VENTA"
  | "ESCALONADO";

export type CommissionStatus = "PENDIENTE" | "PAGADA" | "ANULADA";

export interface CommissionTier {
  min: number;
  max: number | null; // null = sin límite superior
  rate: number; // porcentaje
}

export interface SaleData {
  total: number;
  profit: number; // ganancia bruta (subtotal - costo)
  onCredit: boolean;
  amountPaid: number;
}

export interface CommissionResult {
  applies: boolean;
  ruleId: string | null;
  base: number;
  rate: number;
  amount: number;
  reason?: string;
}

// ===== FUNCIÓN PRINCIPAL: EVALUAR REGLA =====
export function evaluateCommissionRule(
  rule: {
    id: string;
    type: string;
    rate: number;
    tiers: string | null;
    minSaleAmount: number;
    onlyPaid: boolean;
    active: boolean;
    startDate: Date;
    endDate: Date | null;
  },
  sale: SaleData,
  now: Date = new Date()
): CommissionResult {
  // Verificar activo
  if (!rule.active) {
    return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Regla inactiva" };
  }

  // Verificar vigencia
  if (now < rule.startDate) {
    return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Vigencia futura" };
  }
  if (rule.endDate && now > rule.endDate) {
    return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Vigencia expirada" };
  }

  // Verificar monto mínimo
  if (sale.total < rule.minSaleAmount) {
    return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Monto mínimo no alcanzado" };
  }

  // Verificar si solo se aplica a ventas pagadas
  if (rule.onlyPaid && sale.onCredit && sale.amountPaid < sale.total) {
    return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Venta no cobrada" };
  }

  // Calcular según tipo
  switch (rule.type) {
    case "PORCENTAJE_VENTA": {
      const base = sale.total;
      const amount = (base * rule.rate) / 100;
      return { applies: true, ruleId: rule.id, base, rate: rule.rate, amount };
    }
    case "PORCENTAJE_GANANCIA": {
      const base = sale.profit;
      if (base <= 0) {
        return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Sin ganancia" };
      }
      const amount = (base * rule.rate) / 100;
      return { applies: true, ruleId: rule.id, base, rate: rule.rate, amount };
    }
    case "MONTO_FIJO_POR_VENTA": {
      const amount = rule.rate; // aquí rate actúa como monto fijo
      return { applies: true, ruleId: rule.id, base: sale.total, rate: 0, amount };
    }
    case "ESCALONADO": {
      const tiers = parseTiers(rule.tiers);
      if (tiers.length === 0) {
        return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Sin tramos definidos" };
      }
      const tier = findTier(tiers, sale.total);
      if (!tier) {
        return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Sin tramo aplicable" };
      }
      const base = sale.total;
      const amount = (base * tier.rate) / 100;
      return { applies: true, ruleId: rule.id, base, rate: tier.rate, amount };
    }
    default:
      return { applies: false, ruleId: rule.id, base: 0, rate: 0, amount: 0, reason: "Tipo desconocido" };
  }
}

// ===== HELPERS =====
export function parseTiers(tiersJson: string | null | undefined): CommissionTier[] {
  if (!tiersJson) return [];
  try {
    const parsed = JSON.parse(tiersJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) => typeof t.min === "number" && typeof t.rate === "number"
    );
  } catch {
    return [];
  }
}

export function findTier(
  tiers: CommissionTier[],
  amount: number
): CommissionTier | null {
  // Ordenar por min ascendente y encontrar el primer tier cuyo rango contiene el monto
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  for (const t of sorted) {
    const max = t.max === null || t.max === undefined ? Infinity : t.max;
    if (amount >= t.min && amount < max) return t;
  }
  // Si no encaja en ninguno, retornar el último (con min más alto)
  return sorted[sorted.length - 1] || null;
}

export function serializeTiers(tiers: CommissionTier[]): string {
  return JSON.stringify(
    tiers.map((t) => ({ min: t.min, max: t.max ?? null, rate: t.rate }))
  );
}

// ===== FUNCIÓN DE NEGOCIO: CREAR COMISIÓN AL CERRAR VENTA =====
export async function createCommissionForSale(
  saleId: string,
  storeId: string,
  userId: string,
  sale: SaleData
): Promise<{ created: boolean; amount: number; ruleId: string | null }> {
  // Buscar regla activa para el vendedor
  const rule = await db.commissionRule.findFirst({
    where: {
      storeId,
      userId,
      active: true,
      startDate: { lte: new Date() },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!rule) {
    // Sin regla: registrar comisión en 0 para auditoría
    await db.commission.create({
      data: {
        storeId,
        userId,
        saleId,
        ruleId: null,
        saleTotal: sale.total,
        saleProfit: sale.profit,
        base: 0,
        rate: 0,
        amount: 0,
        status: "PENDIENTE",
        notes: "Sin regla de comisión configurada",
      },
    });
    return { created: false, amount: 0, ruleId: null };
  }

  const result = evaluateCommissionRule(rule, sale);
  if (!result.applies) {
    await db.commission.create({
      data: {
        storeId,
        userId,
        saleId,
        ruleId: rule.id,
        saleTotal: sale.total,
        saleProfit: sale.profit,
        base: 0,
        rate: 0,
        amount: 0,
        status: "PENDIENTE",
        notes: result.reason || "Regla no aplicable",
      },
    });
    return { created: false, amount: 0, ruleId: rule.id };
  }

  await db.commission.create({
    data: {
      storeId,
      userId,
      saleId,
      ruleId: rule.id,
      saleTotal: sale.total,
      saleProfit: sale.profit,
      base: result.base,
      rate: result.rate,
      amount: result.amount,
      status: "PENDIENTE",
    },
  });

  return { created: true, amount: result.amount, ruleId: rule.id };
}

// ===== HELPERS DE PRESENTACIÓN =====
export function commissionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    PORCENTAJE_VENTA: "% sobre venta",
    PORCENTAJE_GANANCIA: "% sobre ganancia",
    MONTO_FIJO_POR_VENTA: "Monto fijo por venta",
    ESCALONADO: "Escalonado por tramos",
  };
  return labels[type] || type;
}

export function commissionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDIENTE: "Pendiente",
    PAGADA: "Pagada",
    ANULADA: "Anulada",
  };
  return labels[status] || status;
}

export function commissionStatusColor(status: string): string {
  const colors: Record<string, string> = {
    PENDIENTE: "bg-amber-100 text-amber-700",
    PAGADA: "bg-emerald-100 text-emerald-700",
    ANULADA: "bg-red-100 text-red-700",
  };
  return colors[status] || "bg-gray-100 text-gray-700";
}

// ===== RESUMEN POR VENDEDOR =====
export interface CommissionSummary {
  userId: string;
  userName: string;
  totalAmount: number;
  pendingAmount: number;
  paidAmount: number;
  count: number;
  pendingCount: number;
}

export async function getCommissionSummary(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CommissionSummary[]> {
  const commissions = await db.commission.findMany({
    where: {
      storeId,
      createdAt: { gte: startDate, lte: endDate },
      status: { not: "ANULADA" },
    },
    include: { user: { select: { name: true } } },
  });

  const map = new Map<string, CommissionSummary>();
  for (const c of commissions) {
    const existing = map.get(c.userId) || {
      userId: c.userId,
      userName: c.user.name,
      totalAmount: 0,
      pendingAmount: 0,
      paidAmount: 0,
      count: 0,
      pendingCount: 0,
    };
    existing.totalAmount += c.amount;
    existing.count += 1;
    if (c.status === "PENDIENTE") {
      existing.pendingAmount += c.amount;
      existing.pendingCount += 1;
    } else if (c.status === "PAGADA") {
      existing.paidAmount += c.amount;
    }
    map.set(c.userId, existing);
  }

  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}
