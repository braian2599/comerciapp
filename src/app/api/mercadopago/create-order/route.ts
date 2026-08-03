import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { crearOrdenQR } from "@/lib/mercado-pago";

// POST: crear orden de pago QR en Mercado Pago
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const body = await req.json();
  // body: { saleId?, amount, description, externalReference?, payerEmail? }

  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const resultado = await crearOrdenQR({
    storeId,
    saleId: body.saleId,
    amount: Number(body.amount),
    description: body.description || "Pago",
    externalReference: body.externalReference,
    payerEmail: body.payerEmail,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
