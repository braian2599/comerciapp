import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { consultarEstadoPago } from "@/lib/mercado-pago";

// GET: consultar estado de un pago MP por ID local
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;
  const url = new URL(req.url);
  const mpPaymentLocalId = url.searchParams.get("id");

  if (!mpPaymentLocalId) {
    return NextResponse.json({ error: "Falta parámetro id" }, { status: 400 });
  }

  const resultado = await consultarEstadoPago(storeId, mpPaymentLocalId);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
