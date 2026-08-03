// ============================================================
// FIDELIZACIÓN - Cálculo de puntos y niveles
// ============================================================

export type LoyaltyTier = "BRONCE" | "PLATA" | "ORO" | "PLATINO";
export type LoyaltyAction = "EARN" | "REDEEM" | "EXPIRE" | "ADJUST";

export interface LoyaltyProgramConfig {
  enabled: boolean;
  pointsPerWeight: number;
  roundMode: "FLOOR" | "CEIL" | "ROUND";
  minPurchase: number;
  pointsToCurrency: number; // 1 punto = X pesos
  minRedeemPoints: number;
  maxRedeemPercent: number;
  tierBronceMin: number;
  tierBronceBonus: number;
  tierPlataMin: number;
  tierPlataBonus: number;
  tierOroMin: number;
  tierOroBonus: number;
  tierPlatinoMin: number;
  tierPlatinoBonus: number;
}

/**
 * Determina el tier del cliente según su monto acumulado de compra.
 */
export function determineTier(totalSpent: number, cfg: LoyaltyProgramConfig): LoyaltyTier {
  if (totalSpent >= cfg.tierPlatinoMin) return "PLATINO";
  if (totalSpent >= cfg.tierOroMin) return "ORO";
  if (totalSpent >= cfg.tierPlataMin) return "PLATA";
  return "BRONCE";
}

/**
 * Devuelve el multiplicador de bonus del tier.
 */
export function tierBonusMultiplier(tier: LoyaltyTier, cfg: LoyaltyProgramConfig): number {
  switch (tier) {
    case "PLATINO":
      return 1 + cfg.tierPlatinoBonus;
    case "ORO":
      return 1 + cfg.tierOroBonus;
    case "PLATA":
      return 1 + cfg.tierPlataBonus;
    default:
      return 1 + cfg.tierBronceBonus;
  }
}

/**
 * Calcula los puntos a ganar por una compra.
 */
export function calculatePointsEarned(
  amount: number,
  tier: LoyaltyTier,
  cfg: LoyaltyProgramConfig
): number {
  if (!cfg.enabled) return 0;
  if (cfg.minPurchase > 0 && amount < cfg.minPurchase) return 0;

  const bonus = tierBonusMultiplier(tier, cfg);
  const rawPoints = amount * cfg.pointsPerWeight * bonus;

  switch (cfg.roundMode) {
    case "FLOOR":
      return Math.floor(rawPoints);
    case "CEIL":
      return Math.ceil(rawPoints);
    case "ROUND":
      return Math.round(rawPoints);
    default:
      return Math.floor(rawPoints);
  }
}

/**
 * Calcula cuánto descuento en pesos equivale a cierta cantidad de puntos.
 */
export function pointsToCurrency(points: number, cfg: LoyaltyProgramConfig): number {
  return Math.round(points * cfg.pointsToCurrency * 100) / 100;
}

/**
 * Calcula cuántos puntos se necesitan para cubrir un monto en pesos.
 */
export function currencyToPoints(amount: number, cfg: LoyaltyProgramConfig): number {
  if (cfg.pointsToCurrency <= 0) return Infinity;
  return Math.ceil(amount / cfg.pointsToCurrency);
}

/**
 * Calcula el máximo de puntos que un cliente puede canjear en una compra.
 * Respeta:
 * - El saldo disponible del cliente
 * - El % máximo del total canjeable
 * - El mínimo de puntos requerido para canjear
 */
export function calculateMaxRedeemablePoints(
  customerPoints: number,
  cartTotal: number,
  cfg: LoyaltyProgramConfig
): number {
  if (!cfg.enabled) return 0;
  if (customerPoints < cfg.minRedeemPoints) return 0;

  // Máximo por % del total
  const maxByPercent = (cartTotal * cfg.maxRedeemPercent) / 100;
  const maxPointsByValue = maxByPercent / cfg.pointsToCurrency;

  return Math.min(customerPoints, maxPointsByValue);
}

/**
 * Devuelve un label legible del tier con su beneficio.
 */
export function tierLabel(tier: LoyaltyTier, cfg: LoyaltyProgramConfig): string {
  const bonus = tierBonusMultiplier(tier, cfg) - 1;
  const pct = Math.round(bonus * 100);
  const names: Record<LoyaltyTier, string> = {
    BRONCE: "Bronce",
    PLATA: "Plata",
    ORO: "Oro",
    PLATINO: "Platino",
  };
  return pct > 0 ? `${names[tier]} (+${pct}% pts)` : names[tier];
}

/**
 * Próximo tier y cuánto falta para alcanzarlo.
 */
export function nextTierInfo(
  currentTier: LoyaltyTier,
  totalSpent: number,
  cfg: LoyaltyProgramConfig
): { nextTier: LoyaltyTier | null; missing: number } | null {
  const tiers: LoyaltyTier[] = ["BRONCE", "PLATA", "ORO", "PLATINO"];
  const currentIndex = tiers.indexOf(currentTier);
  if (currentIndex === tiers.length - 1) return null;

  const next = tiers[currentIndex + 1];
  const mins: Record<LoyaltyTier, number> = {
    BRONCE: cfg.tierBronceMin,
    PLATA: cfg.tierPlataMin,
    ORO: cfg.tierOroMin,
    PLATINO: cfg.tierPlatinoMin,
  };

  return {
    nextTier: next,
    missing: Math.max(0, mins[next] - totalSpent),
  };
}
