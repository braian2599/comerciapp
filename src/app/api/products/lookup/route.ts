import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { lookupProductByBarcode, isValidBarcode } from "@/lib/barcode-lookup";

/**
 * GET /api/products/lookup?barcode=XXXXXXXXXXXX
 *
 * Consulta bases de datos públicas (Open Food Facts + UPC Item DB)
 * y devuelve los datos del producto si lo encuentra.
 *
 * Requiere sesión activa (cualquier rol puede consultar — útil desde POS).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const barcode = (searchParams.get("barcode") || "").trim();

  if (!barcode) {
    return NextResponse.json(
      { error: "Código de barras requerido", found: false },
      { status: 400 }
    );
  }

  // Validación opcional: si el formato no es válido, respondemos rápido
  // sin gastar una llamada externa. Avisamos al cliente pero igualmente
  // intentamos el lookup para soportar códigos personalizados.
  const valid = isValidBarcode(barcode);

  try {
    const result = await lookupProductByBarcode(barcode);
    return NextResponse.json({ ...result, barcodeValid: valid });
  } catch (e: any) {
    console.error("[products/lookup] error:", e);
    return NextResponse.json(
      {
        found: false,
        source: "none",
        barcode,
        barcodeValid: valid,
        error: "No se pudo consultar la base de datos de productos",
      },
      { status: 200 } // 200 para que el cliente no rompa — simplemente no encontró
    );
  }
}
