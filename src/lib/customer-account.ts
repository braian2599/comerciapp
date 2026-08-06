/**
 * lib/customer-account.ts
 *
 * Funciones centralizadas para la cuenta corriente del cliente.
 *
 * ANTECEDENTE (P2.1 - robustez refunds → customer account):
 *  El "saldo" de cuenta corriente del cliente se calculaba en runtime en
 *  3 lugares distintos (customers/account GET, customers GET lista,
 *  dashboard), cada uno con su propia implementación. Si una rama cambiaba
 *  (ej: agregar soporte para NC que reduce saldo automáticamente), las otras
 *  divergían.
 *
 *  Además, el flujo de devoluciones tenía bugs:
 *   - Refund de venta FIADA en EFECTIVO dejaba deuda fantasma en cuenta.
 *   - CustomerPayment sin validación de customerId cuando refundMethod=CREDITO_CUENTA.
 *   - `customer.totalSpent` solo se decrementaba si la venta había ganado puntos.
 *   - No había validación de `creditLimit` al fiar.
 *   - `refundNumber` se generaba fuera de transacción (race condition).
 *
 *  Esta lib expone:
 *   - getCustomerBalance(txOrDb, storeId, customerId): calcula saldo con la
 *     fórmula canónica (Σventas fiadas - Σpagos).
 *   - assertCreditAvailable(txOrDb, storeId, customerId, amount): valida
 *     que el cliente tenga crédito disponible antes de fiar.
 *   - normalizeRefundMethod(sale, requestedMethod): decide el método
 *     efectivo considerando si la venta original era fiada.
 *   - getNextRefundNumber(tx, storeId): genera número legible dentro de tx.
 *   - applyCreditToCustomerAccount(tx, ...): wrapper para CustomerPayment + cash movement.
 *
 *  Todas las funciones que tocan DB aceptan `tx | db` (PrismaTransactionClient)
 *  para poder usarse dentro o fuera de transacciones según el caller.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

// Prisma transaction client type (compatible con db y tx)
type DbOrTx = Prisma.TransactionClient | PrismaClient;

/**
 * Calcula el saldo de cuenta corriente de un cliente.
 *
 * Fórmula: saldo = Σ(Sale.onCredit=true, status=COMPLETADA, total) - Σ(CustomerPayment.amount)
 *
 * saldo > 0  → el cliente DEBE (deuda pendiente)
 * saldo < 0  → el cliente tiene CRÉDITO A FAVOR (pagos adelantados / NC)
 * saldo = 0  → cuenta saldada
 *
 * NOTA: Las ventas ANULADAS no se consideran (porque la reversión se hace
 *       vía CustomerPayment=NOTA_CREDITO, no anulando la Sale). Si en el
 *       futuro se introduce Sale.status='ANULADA' que sí reduce debe,
 *       hay que revisar este filtro.
 *
 * @param dbOrTx   cliente Prisma o transacción
 * @param storeId  tienda (multi-tenant)
 * @param customerId  cliente
 * @returns saldo (positivo = deuda del cliente)
 */
export async function getCustomerBalance(
  dbOrTx: DbOrTx,
  storeId: string,
  customerId: string
): Promise<number> {
  // Usamos aggregate para evitar traer todos los registros a memoria.
  // En tablas grandes esto es O(log n) en vez de O(n).
  const [creditSalesAgg, paymentsAgg] = await Promise.all([
    dbOrTx.sale.aggregate({
      _sum: { total: true },
      where: {
        storeId,
        customerId,
        onCredit: true,
        status: "COMPLETADA",
      },
    }),
    dbOrTx.customerPayment.aggregate({
      _sum: { amount: true },
      where: { storeId, customerId },
    }),
  ]);

  const debe = creditSalesAgg._sum.total ?? 0;
  const haber = paymentsAgg._sum.amount ?? 0;
  // Redondear a 2 decimales para evitar drift por float arithmetic
  return Math.round((debe - haber) * 100) / 100;
}

/**
 * Valida que el cliente pueda fiar un monto adicional.
 *
 * Reglas:
 *   - Si creditLimit = 0 → sin límite (cliente ilimitado, ej: mayorista confiable)
 *   - Si creditLimit > 0 → saldoActual + amountNuevo <= creditLimit
 *
 * @throws Error con mensaje user-friendly si excede el límite.
 */
export async function assertCreditAvailable(
  dbOrTx: DbOrTx,
  storeId: string,
  customerId: string,
  amount: number
): Promise<void> {
  const customer = await dbOrTx.customer.findFirst({
    where: { id: customerId, storeId },
    select: { name: true, creditLimit: true },
  });
  if (!customer) {
    throw new Error("Cliente no encontrado");
  }
  if (!customer.creditLimit || customer.creditLimit <= 0) {
    // Sin límite → siempre permitido
    return;
  }
  const currentBalance = await getCustomerBalance(dbOrTx, storeId, customerId);
  const newBalance = currentBalance + amount;
  if (newBalance > customer.creditLimit) {
    throw new Error(
      `Crédito insuficiente para ${customer.name}. ` +
        `Saldo actual: $${currentBalance.toFixed(2)}, ` +
        `límite: $${customer.creditLimit.toFixed(2)}, ` +
        `monto a fiar: $${amount.toFixed(2)}. ` +
        `Excede en $${(newBalance - customer.creditLimit).toFixed(2)}.`
    );
  }
}

/**
 * Métodos de devolución normalizados.
 * - EFECTIVO: se entrega efectivo al cliente (registra egreso de caja).
 * - TRANSFERENCIA: se transfiere al cliente (no toca caja física).
 * - CREDITO_CUENTA: se acredita en la cuenta corriente del cliente (CustomerPayment).
 */
export type RefundMethod = "EFECTIVO" | "TRANSFERENCIA" | "CREDITO_CUENTA";

/**
 * Normaliza el método de devolución considerando el contexto de la venta.
 *
 * Reglas de negocio:
 *  1. Si la venta original fue FIADA (onCredit=true):
 *     - Si el cliente pidió EFECTIVO o TRANSFERENCIA, requiere confirmación
 *       explícita vía `forceCashRefundOnCreditSale=true` (porque estaríamos
 *       dando dinero al cliente mientras la deuda de la venta fiada sigue
 *       activa — el comercio pierde dos veces).
 *     - Si no hay confirmación, se ignora el método pedido y se aplica
 *       CREDITO_CUENTA automáticamente (que es lo correcto: reduce la deuda).
 *
 *  2. Si refundMethod=CREDITO_CUENTA pero la venta no tenía cliente:
 *     - No hay cuenta a la cual acreditar → se cae a EFECTIVO con warning.
 *
 *  3. Cualquier valor no reconocido → default EFECTIVO.
 *
 * @returns { method, warning? } — warning describe si se cambió el método.
 */
export function normalizeRefundMethod(
  sale: { onCredit: boolean; customerId: string | null; paymentMethod: string },
  requestedMethod: string | undefined,
  options: { forceCashRefundOnCreditSale?: boolean } = {}
): { method: RefundMethod; warning?: string } {
  const requested = (requestedMethod as RefundMethod) || "EFECTIVO";

  // Regla 2: CREDITO_CUENTA sin cliente no tiene sentido
  if (requested === "CREDITO_CUENTA" && !sale.customerId) {
    return {
      method: "EFECTIVO",
      warning:
        "Se solicitó crédito en cuenta corriente pero la venta no tiene cliente asociado. " +
        "Se cambió automáticamente a EFECTIVO.",
    };
  }

  // Regla 1: venta fiada + método cash sin confirmación
  if (
    sale.onCredit &&
    (requested === "EFECTIVO" || requested === "TRANSFERENCIA") &&
    !options.forceCashRefundOnCreditSale
  ) {
    return {
      method: "CREDITO_CUENTA",
      warning:
        "La venta original fue fiada (cuenta corriente). " +
        "Para evitar doble devolución (deuda activa + entrega de dinero), " +
        "se cambió automáticamente a CREDITO_CUENTA. " +
        "Si realmente querés entregar dinero al cliente, confirmá la devolución " +
        "con forceCashRefundOnCreditSale=true.",
    };
  }

  // Default feliz
  if (
    requested === "EFECTIVO" ||
    requested === "TRANSFERENCIA" ||
    requested === "CREDITO_CUENTA"
  ) {
    return { method: requested };
  }

  // Valor no reconocido
  return {
    method: "EFECTIVO",
    warning: `Método de devolución "${requestedMethod}" no reconocido, se usó EFECTIVO.`,
  };
}

/**
 * Genera el siguiente número legible de devolución (DEV-NNNN) DENTRO de una transacción.
 *
 * ANTECEDENTE: Antes esto se hacía FUERA de la transacción, lo que causaba
 * race conditions: dos usuarios podían leer "último = DEV-0004" al mismo
 * tiempo y ambos generaban DEV-0005. No hay UNIQUE constraint en refundNumber,
 * así que ambos insertaban y quedaban duplicados.
 *
 * Ahora: esto debe llamarse DENTRO de db.$transaction(async (tx) => {...}).
 * La transacción serializable de Postgres garantiza que dos tx concurrentes
 * no lean el mismo último número.
 *
 * IMPORTANTE: El padding es de 4 dígitos para mantener formato. Si se supera
 * DEV-9999 se extiende automáticamente a 5 dígitos.
 *
 * TODO futuro: agregar schema `Store.refundCounter Int @default(0)` y usar
 * `tx.store.update({ data: { refundCounter: { increment: 1 } } })` que es
 * atómico y no depende de string parsing.
 */
export async function getNextRefundNumber(
  tx: Prisma.TransactionClient,
  storeId: string
): Promise<string> {
  // Traer todos los refund numbers (no debería ser muchos por tienda).
  // Hacer parsing numérico para evitar el bug de orden lexicográfico:
  // "DEV-9" > "DEV-10" como string, pero 9 < 10 como número.
  const refunds = await tx.refund.findMany({
    where: { storeId },
    select: { refundNumber: true },
  });

  let maxNum = 0;
  for (const r of refunds) {
    const m = r.refundNumber?.match(/^DEV-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }

  const next = maxNum + 1;
  // Pad dinámico: mínimo 4 dígitos, se extiende si supera 9999
  const padLength = Math.max(4, String(next).length);
  return `DEV-${String(next).padStart(padLength, "0")}`;
}

/**
 * Aplica un crédito a la cuenta corriente de un cliente (crea CustomerPayment
 * + opcionalmente CashMovement si fue efectivo).
 *
 * Uso típico: desde /api/refunds cuando refundMethod=CREDITO_CUENTA, o desde
 * /api/customers/account cuando se registra un pago manual.
 *
 * @param tx               transacción Prisma activa
 * @param params           ver tipo
 * @returns CustomerPayment creado
 */
export async function applyCreditToCustomerAccount(
  tx: Prisma.TransactionClient,
  params: {
    storeId: string;
    customerId: string;
    userId: string;
    amount: number;
    paymentMethod: string; // EFECTIVO | TRANSFERENCIA | TARJETA | NOTA_CREDITO | ...
    cashRegisterId?: string | null;
    notes?: string | null;
    refType?: string | null; // "Refund" | "CustomerPayment" | ...
    refId?: string | null;
    /**
     * Si true y paymentMethod=EFECTIVO y hay cashRegisterId,
     * crea también un CashMovement tipo PAGO_CUENTA (ingreso de caja).
     * Default: true.
     */
    registerCashMovement?: boolean;
  }
) {
  const {
    storeId,
    customerId,
    userId,
    amount,
    paymentMethod,
    cashRegisterId,
    notes,
    refType,
    refId,
    registerCashMovement = true,
  } = params;

  if (amount <= 0) {
    throw new Error("El monto del crédito debe ser mayor a cero");
  }

  const customer = await tx.customer.findFirst({
    where: { id: customerId, storeId },
    select: { id: true, name: true },
  });
  if (!customer) {
    throw new Error("Cliente no encontrado");
  }

  const payment = await tx.customerPayment.create({
    data: {
      storeId,
      customerId,
      userId,
      amount,
      paymentMethod,
      cashRegisterId: cashRegisterId || null,
      notes,
    },
  });

  if (
    registerCashMovement &&
    cashRegisterId &&
    paymentMethod === "EFECTIVO"
  ) {
    await tx.cashMovement.create({
      data: {
        cashRegisterId,
        storeId,
        userId,
        type: "PAGO_CUENTA",
        amount,
        concept: `Pago cta. ${customer.name}${refType === "Refund" ? " (devolución)" : ""}`,
        paymentMethod: "EFECTIVO",
        refType: refType || "CustomerPayment",
        refId: refId || payment.id,
      },
    });
  }

  return payment;
}
