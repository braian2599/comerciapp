import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";
import { DEFAULT_PAYMENT_METHODS } from "@/lib/constants";

// Plantillas por rubro: categorías sugeridas
const RUBRO_CATEGORIES: Record<string, string[]> = {
  TIENDA_BARRIO: [
    "Almacén",
    "Bebidas",
    "Lácteos",
    "Limpieza",
    "Panadería",
    "Golosinas",
    "Fiambres",
    "Verduras",
  ],
  MINIMARKET: [
    "Almacén",
    "Bebidas",
    "Lácteos",
    "Limpieza",
    "Panadería",
    "Golosinas",
    "Fiambres",
    "Higiene",
    "Snacks",
  ],
  VERDULERIA: ["Frutas", "Verduras", "Hierbas", "Frutos secos", "Bolsas"],
  CARNICERIA: ["Vacuno", "Cerdo", "Pollo", "Embutidos", "Achuras", "Elaborados"],
  PANADERIA: ["Panes", "Facturas", "Tortas", "Galletas", "Especiales"],
  KIOSCO: ["Golosinas", "Bebidas", "Snacks", "Cigarrillos", "Revistas", "Lotería"],
  FERRETERIA: [
    "Herramientas",
    "Electricidad",
    "Plomería",
    "Pinturería",
    "Bulonería",
    "Construcción",
  ],
  OTRO: ["General"],
};

const schema = z.object({
  storeName: z.string().min(2),
  rubro: z.string(),
  ownerName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  currency: z.string().default("ARS"),
  currencySymbol: z.string().default("$"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    const exists = await db.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (exists) {
      return NextResponse.json(
        { error: "Ya existe un usuario con ese email" },
        { status: 400 }
      );
    }

    const slug = data.storeName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slugExists = await db.store.findUnique({ where: { slug } });
    const finalSlug = slugExists ? `${slug}-${Date.now().toString(36)}` : slug;

    const passwordHash = await bcrypt.hash(data.password, 10);

    const store = await db.store.create({
      data: {
        name: data.storeName,
        slug: finalSlug,
        rubro: data.rubro,
        currency: data.currency,
        currencySymbol: data.currencySymbol,
        taxEnabled: false,
        taxRate: 0,
        users: {
          create: {
            email: data.email.toLowerCase(),
            passwordHash,
            name: data.ownerName,
            role: "ADMIN",
          },
        },
        categories: {
          create: (RUBRO_CATEGORIES[data.rubro] || RUBRO_CATEGORIES.OTRO).map(
            (name) => ({ name })
          ),
        },
        paymentMethods: {
          create: DEFAULT_PAYMENT_METHODS,
        },
      },
      include: { users: true, categories: true },
    });

    return NextResponse.json({
      ok: true,
      storeId: store.id,
      message: "Tienda y usuario admin creados correctamente",
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e.message || "Error al registrar" },
      { status: 400 }
    );
  }
}
