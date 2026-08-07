import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { calculateRefundTotals } from "@/lib/refund-calc";

/**
 * POST /api/refunds/preview
 *
 * Calcula los montos de una devolución SIN persistirla. El frontend lo
 * usa para mostrarle al usuario cuánto se le va a devolver antes de
 * confirmar.
 *
 * Body:
 *   {
 *     saleId: string,
 *     items: [{ saleItemId, quantity }]  // vacío = devolución total
 *   }
 *
 * Respuesta:
 *   200 OK -> { ...RefundTotals, saleId, saleTotal }
 *   400    -> items inválidos
 *   401    -> no auth
 *   404    -> venta no encontrada o no COMPLETADA
 *
 * Nota: este endpoint NO verifica si la venta ya tiene un refund previo
 * (eso lo hace el POST /api/refunds al confirmar). El preview es solo
 * informativo.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const storeId = (session.user as any).storeId;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { saleId, items } = body;
  if (typeof saleId !== "string" || saleId.length === 0) {
    return NextResponse.json(
      { error: "saleId inválido: se esperaba string no vacío" },
      { status: 400 }
    );
  }
  // items puede ser undefined/null (→ total) o array. Cualquier otra cosa
  // es un error de cliente. La validación profunda la hace calculateRefundTotals.
  if (items != null && !Array.isArray(items)) {
    return NextResponse.json(
      { error: `items inválido: se esperaba array, se recibió ${typeof items}` },
      { status: 400 }
    );
  }

  // Cargar venta con items
  const sale = await db.sale.findFirst({
    where: { id: saleId, storeId, status: "COMPLETADA" },
    include: { items: true },
  });
  if (!sale) {
    return NextResponse.json(
      { error: "Venta no encontrada o no está completada" },
      { status: 404 }
    );
  }

  // Calcular
  let calc;
  try {
    calc = calculateRefundTotals(
      {
        id: sale.id,
        subtotal: sale.subtotal,
        discount: sale.discount,
        tax: sale.tax,
        surcharge: sale.surcharge,
        total: sale.total,
        items: sale.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          costPrice: i.costPrice,
          subtotal: i.subtotal,
        })),
      },
      items
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error al calcular montos" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    saleId: sale.id,
    saleTotal: sale.total,
    ...calc,
  });
}
