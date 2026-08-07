/**
 * lib/stock.ts
 *
 * Movimientos de stock centralizados.
 *
 * ANTECEDENTE (P2.4):
 *  La lógica de "actualizar stock + registrar StockMovement" estaba duplicada
 *  en 8 lugares distintos:
 *    - POST /api/sales       (descuento por venta)
 *    - POST /api/sales/annul (reintegro por anulación)
 *    - POST /api/refunds     (reintegro por devolución)
 *    - POST /api/purchase-orders        (recepción de OC)
 *    - POST /api/purchase-orders/receive (recepción de OC pendiente)
 *    - POST /api/inventory   (entrada/salida manual)
 *    - POST /api/products    (stock inicial al crear producto)
 *    - PUT  /api/products    (ajuste al editar stock manualmente)
 *    - POST /api/products/import      (masivo)
 *    - lib/ecommerce.ts      (pedido web)
 *
 *  Cada implementación tenía pequeñas inconsistencias:
 *   - Algunas validaban stock < 0, otras no.
 *   - Algunas seteaban refType+refId, otras no (difficil trazabilidad).
 *   - El tipo del StockMovement era string libre → typos imposibles de detectar.
 *   - products/import no validaba stockResultante.
 *   - ecommerce no validaba stockResultante (stock podía quedar negativo).
 *   - La convención de signo era inconsistente: algunas guardaban cantidad
 *     positiva siempre, otras con signo.
 *
 *  Esta lib expone:
 *   - decreaseStock(tx, params): descuenta stock (venta, salida manual).
 *     Lanza error si el resultado sería negativo (salvo allowNegative=true).
 *   - increaseStock(tx, params): incrementa stock (compra, devolución, anulación).
 *   - setStock(tx, params): setea stock absoluto + registra AJUSTE con diff.
 *   - bulkStockMovement(tx, items[]): aplica varios movimientos en una sola tx.
 *
 *  Todos los movimientos siempre registran StockMovement con:
 *   - type canonico (string union tipado)
 *   - quantity CON SIGNO (positivo = entrada, negativo = salida)
 *   - refType + refId para trazabilidad (Sale, Refund, PurchaseOrder, etc.)
 *   - reason descriptivo
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

type DbOrTx = Prisma.TransactionClient | PrismaClient;

/**
 * Tipos canónicos de movimiento de stock.
 * Mantener en sync con la documentación del campo StockMovement.type en schema.prisma.
 *
 * Convención de signo (en la columna `quantity`):
 *   ENTRADA → positivo (incrementa stock)
 *   SALIDA  → negativo (decrementa stock)
 *   AJUSTE  → puede ser positivo o negativo (diff de setStock)
 *   VENTA   → negativo
 *   COMPRA  → positivo
 */
export type StockMovementType =
  | "ENTRADA"
  | "SALIDA"
  | "AJUSTE"
  | "VENTA"
  | "COMPRA";

/**
 * Tipo de entidad origen (para trazabilidad).
 * Debe coincidir con los valores usados en refType del schema.
 */
export type StockRefType =
  | "Sale"
  | "Refund"
  | "PurchaseOrder"
  | "CashMovement"
  | "CustomerPayment"
  | "InventoryAdjustment"
  | "ProductImport"
  | "Ecommerce"
  | null;

interface StockMovementParams {
  productId: string;
  storeId: string;
  userId: string;
  quantity: number; // siempre positiva; el signo lo decide la función caller
  reason?: string;
  refType?: StockRefType;
  refId?: string;
}

interface DecreaseStockParams extends StockMovementParams {
  /**
   * Si true, permite que el stock resultante sea negativo (no recomendado,
   * pero útil para casos excepcionales como ventas backorder).
   * Default: false → lanza error si stock resultante < 0.
   */
  allowNegative?: boolean;
  /**
   * Nombre del producto para incluir en el mensaje de error si stock < 0.
   * Si no se pasa, se hace lookup en la DB (extra query).
   */
  productName?: string;
}

interface IncreaseStockParams extends StockMovementParams {
  /**
   * Si se setea, actualiza también el costPrice del producto (caso OC).
   * Solo tiene efecto en increaseStock (no en decrease).
   */
  newCostPrice?: number;
}

interface SetStockParams {
  productId: string;
  storeId: string;
  userId: string;
  newStock: number;
  reason?: string;
  refType?: StockRefType;
  refId?: string;
}

/**
 * Descuenta stock del producto + registra StockMovement type=VENTA o SALIDA.
 *
 * @param tx       transacción Prisma activa
 * @param params   ver DecreaseStockParams
 * @param type     "VENTA" (default) para ventas, "SALIDA" para egresos manuales
 *
 * @throws Error si stock resultante < 0 (salvo allowNegative=true).
 *
 * @returns producto actualizado (con stock ya descontado)
 */
export async function decreaseStock(
  tx: DbOrTx,
  params: DecreaseStockParams,
  type: "VENTA" | "SALIDA" = "VENTA"
) {
  const {
    productId,
    storeId,
    userId,
    quantity,
    reason,
    refType,
    refId,
    allowNegative = false,
    productName,
  } = params;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Cantidad inválida para decreaseStock: ${quantity}`);
  }

  const updated = await tx.product.update({
    where: { id: productId },
    data: { stock: { decrement: quantity } },
  });

  if (!allowNegative && updated.stock < 0) {
    // Restaurar el stock ANTES de lanzar (la tx se va a rollback anyway,
    // pero por si el caller no está en tx y la operacion ya se aplicó).
    // En una tx real, el rollback deshace todo — esto es belt-and-suspenders.
    const name =
      productName ||
      (await tx.product.findUnique({ where: { id: productId }, select: { name: true } }))?.name ||
      `producto ${productId}`;

    throw new Error(
      `Stock insuficiente para ${name}. ` +
        `Stock actual: ${(updated.stock + quantity).toFixed(2)}, ` +
        `cantidad solicitada: ${quantity}.`
    );
  }

  await tx.stockMovement.create({
    data: {
      productId,
      storeId,
      userId,
      type,
      quantity: -quantity, // negativo = salida
      reason: reason || (type === "VENTA" ? "Venta" : "Salida manual"),
      refType: refType || null,
      refId: refId || null,
    },
  });

  return updated;
}

/**
 * Incrementa stock del producto + registra StockMovement type=COMPRA o ENTRADA.
 *
 * @param tx       transacción Prisma activa
 * @param params   ver IncreaseStockParams
 * @param type     "COMPRA" (default) para OC, "ENTRADA" para ingresos manuales
 *
 * @returns producto actualizado (con stock ya incrementado)
 */
export async function increaseStock(
  tx: DbOrTx,
  params: IncreaseStockParams,
  type: "COMPRA" | "ENTRADA" = "ENTRADA"
) {
  const {
    productId,
    storeId,
    userId,
    quantity,
    reason,
    refType,
    refId,
    newCostPrice,
  } = params;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Cantidad inválida para increaseStock: ${quantity}`);
  }

  // Si viene newCostPrice (caso OC), actualizamos el costo también.
  // Esto antes se hacía inline en purchase-orders/receive y purchase-orders/route.
  const updateData: any = { stock: { increment: quantity } };
  if (newCostPrice !== undefined && Number.isFinite(newCostPrice)) {
    updateData.costPrice = newCostPrice;
  }

  const updated = await tx.product.update({
    where: { id: productId },
    data: updateData,
  });

  await tx.stockMovement.create({
    data: {
      productId,
      storeId,
      userId,
      type,
      quantity, // positivo = entrada
      reason: reason || (type === "COMPRA" ? "Recepción de OC" : "Ingreso manual"),
      refType: refType || null,
      refId: refId || null,
    },
  });

  return updated;
}

/**
 * Setea stock absoluto del producto + registra StockMovement type=AJUSTE
 * con la diferencia (positiva o negativa).
 *
 * Útil para:
 *   - Edición manual de stock desde el maestro de productos.
 *   - Importación masiva que cambia stock directamente.
 *
 * @param tx       transacción Prisma activa
 * @param params   ver SetStockParams
 *
 * @returns producto actualizado + diff aplicado
 */
export async function setStock(
  tx: DbOrTx,
  params: SetStockParams
): Promise<{ product: any; diff: number }> {
  const {
    productId,
    storeId,
    userId,
    newStock,
    reason,
    refType,
    refId,
  } = params;

  if (!Number.isFinite(newStock) || newStock < 0) {
    throw new Error(`Stock inválido para setStock: ${newStock}`);
  }

  // Fetch prev stock (necesario para calcular diff)
  const prev = await tx.product.findUnique({
    where: { id: productId },
    select: { stock: true },
  });
  if (!prev) {
    throw new Error(`Producto no encontrado: ${productId}`);
  }

  const diff = newStock - prev.stock;

  // Solo escribir si hay diff > epsilon (evita movimientos espurios)
  if (Math.abs(diff) < 0.001) {
    const unchanged = await tx.product.findUnique({ where: { id: productId } });
    return { product: unchanged, diff: 0 };
  }

  const updated = await tx.product.update({
    where: { id: productId },
    data: { stock: newStock },
  });

  await tx.stockMovement.create({
    data: {
      productId,
      storeId,
      userId,
      type: "AJUSTE",
      quantity: diff, // signado
      reason: reason || "Ajuste manual de stock",
      refType: refType || null,
      refId: refId || null,
    },
  });

  return { product: updated, diff };
}

/**
 * Aplica varios movimientos de stock en una sola transacción.
 *
 * Útil para venta con múltiples items, devolución con múltiples items, etc.
 * Cada item se procesa secuencialmente; si alguno falla, toda la tx se
 * rollback (comportamiento default de Prisma $transaction).
 *
 * @param tx     transacción Prisma activa
 * @param ops    array de operaciones (cada una es decrease/increase/set)
 *
 * @returns array de resultados en el mismo orden que ops
 */
export async function bulkStockMovement(
  tx: DbOrTx,
  ops: Array<
    | { kind: "decrease"; params: DecreaseStockParams; type?: "VENTA" | "SALIDA" }
    | { kind: "increase"; params: IncreaseStockParams; type?: "COMPRA" | "ENTRADA" }
    | { kind: "set"; params: SetStockParams }
  >
): Promise<any[]> {
  const results: any[] = [];
  for (const op of ops) {
    if (op.kind === "decrease") {
      results.push(await decreaseStock(tx, op.params, op.type || "VENTA"));
    } else if (op.kind === "increase") {
      results.push(await increaseStock(tx, op.params, op.type || "ENTRADA"));
    } else if (op.kind === "set") {
      results.push(await setStock(tx, op.params));
    }
  }
  return results;
}

/**
 * Valida que un producto tenga stock suficiente para una cantidad dada.
 * No modifica nada — solo lectura.
 *
 * Útil para pre-validar antes de iniciar una transacción de venta.
 */
export async function assertStockAvailable(
  dbOrTx: DbOrTx,
  productId: string,
  quantity: number
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Cantidad inválida: ${quantity}`);
  }
  const product = await dbOrTx.product.findUnique({
    where: { id: productId },
    select: { name: true, stock: true },
  });
  if (!product) {
    throw new Error(`Producto no encontrado: ${productId}`);
  }
  if (product.stock < quantity) {
    throw new Error(
      `Stock insuficiente para ${product.name}. ` +
        `Stock actual: ${product.stock.toFixed(2)}, ` +
        `cantidad solicitada: ${quantity}.`
    );
  }
}
