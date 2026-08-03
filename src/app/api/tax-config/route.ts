import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { validarCuit } from "@/lib/afip";

// GET: obtener configuración fiscal
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const storeId = (session.user as any).storeId;

  const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
  return NextResponse.json(taxConfig);
}

// PUT: actualizar o crear configuración fiscal
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "No auth" }, { status: 401 });
  const u = session.user as any;
  if (u.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const storeId = u.storeId;

  const body = await req.json();

  // Validar CUIT si se informa
  if (body.cuit && !validarCuit(body.cuit)) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  // Validar condición fiscal
  const condicionesValidas = ["MONOTRIBUTO", "RESPONSABLE_INSCRIPTO", "EXENTO"];
  if (body.condicionFiscal && !condicionesValidas.includes(body.condicionFiscal)) {
    return NextResponse.json({ error: "Condición fiscal inválida" }, { status: 400 });
  }

  const existing = await db.taxConfig.findUnique({ where: { storeId } });

  const data: any = {
    cuit: body.cuit?.replace(/\D/g, "") || existing?.cuit || "",
    razonSocial: body.razonSocial || existing?.razonSocial || "",
    direccionFiscal: body.direccionFiscal ?? existing?.direccionFiscal ?? null,
    inicioActividades: body.inicioActividades ? new Date(body.inicioActividades) : existing?.inicioActividades ?? null,
    puntoVenta: body.puntoVenta ?? existing?.puntoVenta ?? 1,
    tipoFactura: body.tipoFactura ?? existing?.tipoFactura ?? "B",
    condicionFiscal: body.condicionFiscal ?? existing?.condicionFiscal ?? "MONOTRIBUTO",
    categoriaMonotributo: body.categoriaMonotributo ?? existing?.categoriaMonotributo ?? null,
    ivaRate: body.ivaRate ?? existing?.ivaRate ?? 21,
    environment: body.environment ?? existing?.environment ?? "homologacion",
    certPath: body.certPath ?? existing?.certPath ?? null,
    privateKeyPath: body.privateKeyPath ?? existing?.privateKeyPath ?? null,
    certPassword: body.certPassword ?? existing?.certPassword ?? null,
    active: body.active ?? existing?.active ?? true,
  };

  let result;
  if (existing) {
    result = await db.taxConfig.update({
      where: { storeId },
      data,
    });
  } else {
    result = await db.taxConfig.create({
      data: { storeId, ...data },
    });
  }

  return NextResponse.json(result);
}
