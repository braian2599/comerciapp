import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// POST: cerrar caja (arqueo)
// body: { closingBalance: float, notes?: string }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  const storeId = u.storeId;

  const body = await req.json();
  const { id } = body;
  const closingBalance = Number(body.closingBalance);
  const notes = body.notes || null;

  if (!id || isNaN(closingBalance)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const register = await db.cashRegister.findFirst({
    where: { id, storeId, status: "ABIERTA" },
    include: { movements: true, sales: true, branch: { select: { id: true, name: true, code: true } } },
  });
  if (!register) {
    return NextResponse.json({ error: "Caja no encontrada o ya cerrada" }, { status: 404 });
  }

  // Calcular balance esperado:
  // openingBalance + ingresos (VENTA en efectivo, INGRESO, PAGO_CUENTA) - egresos (EGRESO)
  const salesEf = register.sales.filter((s) => s.paymentMethod === "Efectivo" && s.status === "COMPLETADA");
  const ventasEfectivo = salesEf.reduce((s, v) => s + (v.amountPaid || v.total), 0);

  const ingresosManuales = register.movements
    .filter((m) => ["INGRESO", "PAGO_CUENTA"].includes(m.type))
    .reduce((s, m) => s + m.amount, 0);
  const egresosManuales = register.movements
    .filter((m) => m.type === "EGRESO")
    .reduce((s, m) => s + m.amount, 0);

  const expectedBalance =
    register.openingBalance + ventasEfectivo + ingresosManuales - egresosManuales;

  const difference = closingBalance - expectedBalance;

  const updated = await db.cashRegister.update({
    where: { id },
    data: {
      status: "CERRADA",
      closingDate: new Date(),
      closingBalance,
      expectedBalance,
      difference,
      notes: notes ? (register.notes ? `${register.notes}\n---\n${notes}` : notes) : register.notes,
    },
    include: {
      user: { select: { name: true } },
      branch: { select: { id: true, name: true, code: true } },
      movements: true,
    },
  });

  return NextResponse.json(updated);
}
