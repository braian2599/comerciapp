import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Importación masiva de productos.
 *
 * Flujo:
 *   1) mode: "preview" → el cliente envía { rows, headers }
 *      El servidor mapea cada fila a un producto, detecta duplicados
 *      (por barcode/sku) y devuelve un array de items con la acción
 *      sugerida: "create" | "update" | "error".
 *   2) mode: "commit"  → el cliente envía { items: [...rows seleccionadas] }
 *      El servidor inserta/actualiza en una transacción y devuelve
 *      estadísticas finales.
 *
 * El cliente decide en el medio qué hacer con los duplicados (gracias a
 * la fase preview).
 */

// ===== Helpers de mapeo =====

// Alias aceptados para cada campo. Sirve para que el CSV/Excel use
// nombres en español sin que el usuario tenga que respetar el nombre
// exacto del campo interno.
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "nombre", "producto", "descripcion_corta"],
  description: ["description", "descripcion", "detalle", "notas"],
  barcode: ["barcode", "codigo_de_barras", "codigo_barras", "codigobarras", "ean", "upc"],
  sku: ["sku", "codigo_interno", "cod_interno", "codigo"],
  category: ["category", "categoria", "rubro"],
  costPrice: ["costprice", "costo", "precio_costo", "precio_de_costo", "preciocosto"],
  salePrice: ["saleprice", "precio", "precio_venta", "precio_de_venta", "precioventa"],
  stock: ["stock", "cantidad", "existencia", "existencias", "inventario"],
  minStock: ["minstock", "stock_minimo", "stockminimo", "minimo"],
  unit: ["unit", "unidad", "umedida", "u_medida"],
  active: ["active", "activo", "habilitado", "estado"],
  brand: ["brand", "marca"],
  labels: ["labels", "etiquetas", "tags"],
  ingredients: ["ingredients", "ingredientes"],
  allergens: ["allergens", "alergenos", "alergenos", "alérgenos"],
  imageUrl: ["imageurl", "imagen", "img", "foto", "image_url", "imagen_url"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, "_");
}

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(norm)) {
        // La primera vez que aparece gana; duplicados se ignoran
        if (!(field in map)) map[field] = idx;
        break;
      }
    }
  });
  return map;
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // Aceptar "1.234,56" (formato AR) y "1234.56" (formato US)
    const cleaned = v
      .replace(/\s/g, "")
      .replace(/\$/g, "")
      .replace(/[^0-9,.\-]/g, "");
    let normalized = cleaned;
    if (cleaned.includes(",") && cleaned.includes(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else if (cleaned.includes(",")) {
      normalized = cleaned.replace(",", ".");
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toBool(v: unknown, fallback = true): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "si", "sí", "activo", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "inactivo", "n"].includes(s)) return false;
  }
  return fallback;
}

const VALID_UNITS = ["UNIDAD", "KG", "LITRO", "METRO", "PACK"];

interface MappedProduct {
  name: string;
  description: string | null;
  barcode: string | null;
  sku: string | null;
  category: string | null;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  unit: string;
  active: boolean;
  brand: string | null;
  labels: string | null;
  ingredients: string | null;
  allergens: string | null;
  imageUrl: string | null;
  _rowIndex: number;
}

function mapRow(
  row: (string | number | null)[],
  headerMap: Record<string, number>,
  rowIndex: number
): MappedProduct {
  const get = (field: string) => {
    const idx = headerMap[field];
    return idx === undefined ? null : row[idx];
  };

  const name = toStr(get("name")) || "";
  const unitRaw = toStr(get("unit")) || "UNIDAD";
  const unit = VALID_UNITS.includes(unitRaw.toUpperCase())
    ? unitRaw.toUpperCase()
    : "UNIDAD";

  return {
    name,
    description: toStr(get("description")),
    barcode: toStr(get("barcode")),
    sku: toStr(get("sku")),
    category: toStr(get("category")),
    costPrice: toNumber(get("costPrice")),
    salePrice: toNumber(get("salePrice")),
    stock: toNumber(get("stock")),
    minStock: toNumber(get("minStock"), 5),
    unit,
    active: toBool(get("active"), true),
    brand: toStr(get("brand")),
    labels: toStr(get("labels")),
    ingredients: toStr(get("ingredients")),
    allergens: toStr(get("allergens")),
    imageUrl: toStr(get("imageUrl")),
    _rowIndex: rowIndex,
  };
}

// ===== Endpoints =====

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "No auth" }, { status: 401 });
  }
  const u = session.user as any;
  if (u.role === "CAJERO") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de la petición inválido (JSON malformado)" },
      { status: 400 }
    );
  }

  const mode: "preview" | "commit" = body.mode === "commit" ? "commit" : "preview";

  // ----- Fase 1: PREVIEW -----
  if (mode === "preview") {
    const headers: string[] = Array.isArray(body.headers) ? body.headers : [];
    const rows: (string | number | null)[][] = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "El archivo no tiene filas para importar" },
        { status: 400 }
      );
    }

    const headerMap = buildHeaderMap(headers);
    if (!("name" in headerMap)) {
      return NextResponse.json(
        {
          error:
            "No se encontró la columna 'name' / 'nombre' en el archivo. Es obligatoria.",
        },
        { status: 400 }
      );
    }

    const mapped: MappedProduct[] = rows.map((r, i) => mapRow(r, headerMap, i + 2));

    // Buscar duplicados por barcode/sku dentro del store
    const barcodes = mapped
      .map((m) => m.barcode)
      .filter((b): b is string => !!b);
    const skus = mapped
      .map((m) => m.sku)
      .filter((s): s is string => !!s);

    const existing = await db.product.findMany({
      where: {
        storeId: u.storeId,
        OR: [
          ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
          ...(skus.length ? [{ sku: { in: skus } }] : []),
        ],
      },
      select: { id: true, name: true, barcode: true, sku: true },
    });

    const byBarcode = new Map(
      existing.filter((e) => e.barcode).map((e) => [e.barcode!, e])
    );
    const bySku = new Map(
      existing.filter((e) => e.sku).map((e) => [e.sku!, e])
    );

    const items = mapped.map((m) => {
      if (!m.name) {
        return {
          action: "error",
          rowIndex: m._rowIndex,
          name: "",
          error: "Falta el nombre (columna obligatoria)",
        };
      }
      if (m.salePrice < 0) {
        return {
          action: "error",
          rowIndex: m._rowIndex,
          name: m.name,
          error: "Precio de venta inválido",
        };
      }
      const matched =
        (m.barcode && byBarcode.get(m.barcode)) ||
        (m.sku && bySku.get(m.sku));
      if (matched) {
        return {
          action: "update",
          rowIndex: m._rowIndex,
          name: m.name,
          existingId: matched.id,
          existingName: matched.name,
          matchBy: m.barcode && byBarcode.has(m.barcode) ? "barcode" : "sku",
          data: m,
        };
      }
      return {
        action: "create",
        rowIndex: m._rowIndex,
        name: m.name,
        data: m,
      };
    });

    const summary = {
      create: items.filter((i) => i.action === "create").length,
      update: items.filter((i) => i.action === "update").length,
      error: items.filter((i) => i.action === "error").length,
    };

    return NextResponse.json({ items, summary });
  }

  // ----- Fase 2: COMMIT -----
  if (mode === "commit") {
    const items: any[] = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json(
        { error: "No hay items para importar" },
        { status: 400 }
      );
    }

    // Pre-cargar categorías del store para resolver por nombre
    const categories = await db.category.findMany({
      where: { storeId: u.storeId },
      select: { id: true, name: true },
    });
    const catByName = new Map(
      categories.map((c) => [c.name.toLowerCase().trim(), c.id])
    );

    // Crear categorías nuevas bajo demanda
    const createdCatNames = new Map<string, string>();

    let created = 0;
    let updated = 0;
    const errors: { rowIndex: number; name: string; error: string }[] = [];

    for (const item of items) {
      const action: string = item.action;
      const data: MappedProduct | undefined = item.data;
      if (!data) {
        errors.push({
          rowIndex: item.rowIndex ?? 0,
          name: item.name ?? "",
          error: "Item sin datos",
        });
        continue;
      }

      try {
        // Resolver categoría
        let categoryId: string | null = null;
        if (data.category) {
          const key = data.category.toLowerCase().trim();
          if (catByName.has(key)) {
            categoryId = catByName.get(key)!;
          } else if (createdCatNames.has(key)) {
            categoryId = createdCatNames.get(key)!;
          } else {
            const cat = await db.category.create({
              data: { name: data.category.trim(), storeId: u.storeId },
            });
            catByName.set(key, cat.id);
            createdCatNames.set(key, cat.id);
            categoryId = cat.id;
          }
        }

        if (action === "create") {
          const product = await db.product.create({
            data: {
              name: data.name,
              description: data.description,
              barcode: data.barcode,
              sku: data.sku,
              categoryId,
              storeId: u.storeId,
              costPrice: Math.max(0, data.costPrice),
              salePrice: Math.max(0, data.salePrice),
              stock: Math.max(0, data.stock),
              minStock: Math.max(0, data.minStock),
              unit: data.unit,
              active: data.active,
              brand: data.brand,
              labels: data.labels,
              ingredients: data.ingredients,
              allergens: data.allergens,
              imageUrl: data.imageUrl,
            },
          });

          if (product.stock > 0) {
            await db.stockMovement.create({
              data: {
                productId: product.id,
                storeId: u.storeId,
                userId: u.id,
                type: "ENTRADA",
                quantity: product.stock,
                reason: "Importación masiva",
              },
            });
          }

          created++;
        } else if (action === "update") {
          const existingId: string | undefined = item.existingId;
          if (!existingId) {
            errors.push({
              rowIndex: data._rowIndex,
              name: data.name,
              error: "Actualización sin ID existente",
            });
            continue;
          }

          const prev = await db.product.findFirst({
            where: { id: existingId, storeId: u.storeId },
            select: { stock: true },
          });
          if (!prev) {
            errors.push({
              rowIndex: data._rowIndex,
              name: data.name,
              error: "Producto existente no encontrado",
            });
            continue;
          }

          const updatedProduct = await db.product.update({
            where: { id: existingId },
            data: {
              name: data.name,
              description: data.description,
              barcode: data.barcode,
              sku: data.sku,
              categoryId,
              costPrice: Math.max(0, data.costPrice),
              salePrice: Math.max(0, data.salePrice),
              stock: Math.max(0, data.stock),
              minStock: Math.max(0, data.minStock),
              unit: data.unit,
              active: data.active,
              brand: data.brand,
              labels: data.labels,
              ingredients: data.ingredients,
              allergens: data.allergens,
              imageUrl: data.imageUrl,
            },
          });

          if (Math.abs(updatedProduct.stock - prev.stock) > 0.001) {
            await db.stockMovement.create({
              data: {
                productId: existingId,
                storeId: u.storeId,
                userId: u.id,
                type: "AJUSTE",
                quantity: updatedProduct.stock - prev.stock,
                reason: "Importación masiva",
              },
            });
          }

          updated++;
        }
      } catch (e: any) {
        const msg =
          e?.message?.includes("Unique constraint")
            ? "Conflicto de código de barras o SKU (duplicado)"
            : e?.message || "Error al guardar";
        errors.push({
          rowIndex: data._rowIndex,
          name: data.name,
          error: msg,
        });
      }
    }

    return NextResponse.json({
      created,
      updated,
      errors,
      total: items.length,
    });
  }

  return NextResponse.json({ error: "Modo inválido" }, { status: 400 });
}
