import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PRODUCT_IMPORT_FIELDS,
  suggestColumnMapping,
  normalizeHeader,
  type ImportField,
} from "@/lib/import-config";

/**
 * Importación masiva de productos.
 *
 * Flujo:
 *   1) mode: "preview" → el cliente envía { headers, rows, columnMapping? }
 *      El servidor mapea cada fila a un producto, detecta duplicados
 *      (por barcode/sku) y devuelve un array de items con la acción
 *      sugerida: "create" | "update" | "error".
 *   2) mode: "commit"  → el cliente envía { items: [...rows seleccionadas] }
 *      El servidor inserta/actualiza en una transacción y devuelve
 *      estadísticas finales.
 *
 * columnMapping (opcional): { fieldKey: columnIndex } explícito del cliente.
 * Si no viene, se auto-detecta con `suggestColumnMapping` (compatibilidad).
 */

// ===== Helpers de parseo =====

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
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

function toUnit(v: unknown, fallback = "UNIDAD"): string {
  const s = toStr(v);
  if (!s) return fallback;
  const up = s.toUpperCase();
  return VALID_UNITS.includes(up) ? up : fallback;
}

// ===== Mapeo de fila usando columnMapping explícito =====

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
  columnMapping: Record<string, number>,
  rowIndex: number
): MappedProduct {
  const get = (field: string) => {
    const idx = columnMapping[field];
    return idx === undefined || idx < 0 ? null : row[idx];
  };

  return {
    name: toStr(get("name")) || "",
    description: toStr(get("description")),
    barcode: toStr(get("barcode")),
    sku: toStr(get("sku")),
    category: toStr(get("category")),
    costPrice: toNumber(get("costPrice"), 0),
    salePrice: toNumber(get("salePrice"), 0),
    stock: toNumber(get("stock"), 0),
    minStock: toNumber(get("minStock"), 5),
    unit: toUnit(get("unit"), "UNIDAD"),
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

    // Resolución del mapeo:
    //   1. Si el cliente envía `columnMapping`, usarlo tal cual.
    //   2. Sino, auto-detectar (fallback para llamadas directas a la API).
    let columnMapping: Record<string, number>;
    if (
      body.columnMapping &&
      typeof body.columnMapping === "object" &&
      !Array.isArray(body.columnMapping)
    ) {
      // Validar que los índices sean números válidos
      columnMapping = {};
      for (const [key, idx] of Object.entries(body.columnMapping)) {
        const numIdx = Number(idx);
        if (Number.isFinite(numIdx) && numIdx >= 0 && numIdx < headers.length) {
          columnMapping[key] = Math.floor(numIdx);
        }
      }
    } else {
      columnMapping = suggestColumnMapping(headers, PRODUCT_IMPORT_FIELDS);
    }

    if (!("name" in columnMapping)) {
      return NextResponse.json(
        {
          error:
            "No se mapeó ninguna columna al campo 'Nombre'. Es obligatorio. Asigná una columna en el paso de mapeo.",
        },
        { status: 400 }
      );
    }

    const mapped: MappedProduct[] = rows.map((r, i) =>
      mapRow(r, columnMapping, i + 2)
    );

    // Buscar duplicados por barcode/sku dentro del store
    const barcodes = mapped.map((m) => m.barcode).filter((b): b is string => !!b);
    const skus = mapped.map((m) => m.sku).filter((s): s is string => !!s);

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

    return NextResponse.json({ items, summary, columnMapping });
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
        // Resolver categoría por nombre (crear si no existe)
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
        const msg = e?.message?.includes("Unique constraint")
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
