import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  SUPPLIER_IMPORT_FIELDS,
  suggestColumnMapping,
} from "@/lib/import-config";

/**
 * Importación masiva de proveedores.
 *
 * Mismo flujo que /api/products/import y /api/customers/import:
 *   1) mode: "preview" → mapea + detecta duplicados por nombre/email/phone
 *   2) mode: "commit"  → inserta/actualiza
 *
 * columnMapping (opcional): { fieldKey: columnIndex } explícito del cliente.
 */

// ===== Helpers de parseo =====

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

interface MappedSupplier {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  _rowIndex: number;
}

function toBool(v: unknown, fallback = true): boolean {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase().trim();
  if (["true", "1", "si", "sí", "yes", "y", "activo", "activa", "verdadero"].includes(s)) return true;
  if (["false", "0", "no", "n", "inactivo", "inactiva", "falso"].includes(s)) return false;
  return fallback;
}

function mapRow(
  row: (string | number | null)[],
  columnMapping: Record<string, number>,
  rowIndex: number
): MappedSupplier {
  const get = (field: string) => {
    const idx = columnMapping[field];
    return idx === undefined || idx < 0 ? null : row[idx];
  };

  return {
    name: toStr(get("name")) || "",
    contactName: toStr(get("contactName")),
    phone: toStr(get("phone")),
    email: toStr(get("email")),
    address: toStr(get("address")),
    notes: toStr(get("notes")),
    active: toBool(get("active"), true),
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

    // Resolver mapeo: explícito del cliente o auto-detección (fallback)
    let columnMapping: Record<string, number>;
    if (
      body.columnMapping &&
      typeof body.columnMapping === "object" &&
      !Array.isArray(body.columnMapping)
    ) {
      columnMapping = {};
      for (const [key, idx] of Object.entries(body.columnMapping)) {
        const numIdx = Number(idx);
        if (Number.isFinite(numIdx) && numIdx >= 0 && numIdx < headers.length) {
          columnMapping[key] = Math.floor(numIdx);
        }
      }
    } else {
      columnMapping = suggestColumnMapping(headers, SUPPLIER_IMPORT_FIELDS);
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

    const mapped: MappedSupplier[] = rows.map((r, i) =>
      mapRow(r, columnMapping, i + 2)
    );

    // Buscar duplicados por nombre/email/phone dentro del store
    const names = mapped.map((m) => m.name).filter((n): n is string => !!n);
    const emails = mapped.map((m) => m.email).filter((e): e is string => !!e);
    const phones = mapped.map((m) => m.phone).filter((p): p is string => !!p);

    const existing = await db.supplier.findMany({
      where: {
        storeId: u.storeId,
        OR: [
          ...(names.length ? [{ name: { in: names } }] : []),
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(phones.length ? [{ phone: { in: phones } }] : []),
        ],
      },
      select: { id: true, name: true, email: true, phone: true },
    });

    const byName = new Map(
      existing.filter((e) => e.name).map((e) => [e.name.toLowerCase().trim(), e])
    );
    const byEmail = new Map(
      existing.filter((e) => e.email).map((e) => [e.email!.toLowerCase().trim(), e])
    );
    const byPhone = new Map(
      existing.filter((e) => e.phone).map((e) => [e.phone!, e])
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
      const matchedByName = byName.get(m.name.toLowerCase().trim());
      const matchedByEmail = m.email && byEmail.get(m.email.toLowerCase().trim());
      const matchedByPhone = m.phone && byPhone.get(m.phone);
      const matched = matchedByName || matchedByEmail || matchedByPhone;
      const matchBy = matchedByName
        ? "name"
        : matchedByEmail
        ? "email"
        : matchedByPhone
        ? "phone"
        : null;

      if (matched) {
        return {
          action: "update",
          rowIndex: m._rowIndex,
          name: m.name,
          existingId: matched.id,
          existingName: matched.name,
          matchBy,
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

    let created = 0;
    let updated = 0;
    const errors: { rowIndex: number; name: string; error: string }[] = [];

    for (const item of items) {
      const action: string = item.action;
      const data: MappedSupplier | undefined = item.data;
      if (!data) {
        errors.push({
          rowIndex: item.rowIndex ?? 0,
          name: item.name ?? "",
          error: "Item sin datos",
        });
        continue;
      }

      try {
        if (action === "create") {
          await db.supplier.create({
            data: {
              name: data.name,
              contactName: data.contactName,
              phone: data.phone,
              email: data.email,
              address: data.address,
              notes: data.notes,
              active: data.active,
              storeId: u.storeId,
            },
          });
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

          const exists = await db.supplier.findFirst({
            where: { id: existingId, storeId: u.storeId },
            select: { id: true },
          });
          if (!exists) {
            errors.push({
              rowIndex: data._rowIndex,
              name: data.name,
              error: "Proveedor existente no encontrado",
            });
            continue;
          }

          await db.supplier.update({
            where: { id: existingId },
            data: {
              name: data.name,
              contactName: data.contactName,
              phone: data.phone,
              email: data.email,
              address: data.address,
              notes: data.notes,
              active: data.active,
            },
          });
          updated++;
        }
      } catch (e: any) {
        const msg = e?.message || "Error al guardar";
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
