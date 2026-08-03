import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Importación masiva de clientes.
 *
 * Mismo flujo que /api/products/import:
 *   1) mode: "preview" → mapea + detecta duplicados por cuit/email/phone
 *   2) mode: "commit"  → inserta/actualiza
 */

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "nombre", "razon_social", "razonsocial", "cliente"],
  phone: ["phone", "telefono", "tel", "celular", "movil", "móvil"],
  email: ["email", "correo", "mail", "e_mail"],
  address: ["address", "direccion", "domicilio", "dir"],
  cuit: ["cuit", "cuil", "dni", "documento"],
  taxType: ["taxtype", "tax_type", "condicion_fiscal", "condicionfiscal", "tipo_fiscal"],
  creditLimit: ["creditlimit", "credit_limit", "limite_credito", "limitecredito", "limite"],
  notes: ["notes", "notas", "observaciones", "obs"],
};

const VALID_TAX_TYPES = [
  "CONSUMIDOR_FINAL",
  "MONOTRIBUTO",
  "RESPONSABLE_INSCRIPTO",
  "EXENTO",
];

// Aliases comunes para tipos fiscales en español
const TAX_TYPE_ALIASES: Record<string, string> = {
  "consumidor_final": "CONSUMIDOR_FINAL",
  "consumidor final": "CONSUMIDOR_FINAL",
  "cf": "CONSUMIDOR_FINAL",
  "monotributo": "MONOTRIBUTO",
  "mono": "MONOTRIBUTO",
  "mt": "MONOTRIBUTO",
  "responsable_inscripto": "RESPONSABLE_INSCRIPTO",
  "responsable inscripto": "RESPONSABLE_INSCRIPTO",
  "ri": "RESPONSABLE_INSCRIPTO",
  "responsable": "RESPONSABLE_INSCRIPTO",
  "exento": "EXENTO",
  "exenta": "EXENTO",
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

function normalizeCuit(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  // Quitar guiones, puntos, espacios
  return s.replace(/[^0-9]/g, "");
}

function normalizeTaxType(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  // Caso directo (ya viene en formato interno)
  if (VALID_TAX_TYPES.includes(s.toUpperCase())) return s.toUpperCase();
  // Caso alias
  if (TAX_TYPE_ALIASES[lower]) return TAX_TYPE_ALIASES[lower];
  if (TAX_TYPE_ALIASES[lower.replace(/\s+/g, "_")]) return TAX_TYPE_ALIASES[lower.replace(/\s+/g, "_")];
  return null;
}

interface MappedCustomer {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  cuit: string | null;
  taxType: string | null;
  creditLimit: number;
  notes: string | null;
  _rowIndex: number;
}

function mapRow(
  row: (string | number | null)[],
  headerMap: Record<string, number>,
  rowIndex: number
): MappedCustomer {
  const get = (field: string) => {
    const idx = headerMap[field];
    return idx === undefined ? null : row[idx];
  };

  return {
    name: toStr(get("name")) || "",
    phone: toStr(get("phone")),
    email: toStr(get("email")),
    address: toStr(get("address")),
    cuit: normalizeCuit(get("cuit")),
    taxType: normalizeTaxType(get("taxType")),
    creditLimit: toNumber(get("creditLimit"), 0),
    notes: toStr(get("notes")),
    _rowIndex: rowIndex,
  };
}

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

    const mapped: MappedCustomer[] = rows.map((r, i) => mapRow(r, headerMap, i + 2));

    // Buscar duplicados por cuit/email/phone dentro del store
    const cuits = mapped.map((m) => m.cuit).filter((c): c is string => !!c);
    const emails = mapped.map((m) => m.email).filter((e): e is string => !!e);
    const phones = mapped.map((m) => m.phone).filter((p): p is string => !!p);

    const existing = await db.customer.findMany({
      where: {
        storeId: u.storeId,
        OR: [
          ...(cuits.length ? [{ cuit: { in: cuits } }] : []),
          ...(emails.length ? [{ email: { in: emails } }] : []),
          ...(phones.length ? [{ phone: { in: phones } }] : []),
        ],
      },
      select: { id: true, name: true, cuit: true, email: true, phone: true },
    });

    const byCuit = new Map(
      existing.filter((e) => e.cuit).map((e) => [e.cuit!, e])
    );
    const byEmail = new Map(
      existing.filter((e) => e.email).map((e) => [e.email!, e])
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
      // Prioridad: cuit > email > phone
      const matchedByCuit = m.cuit && byCuit.get(m.cuit);
      const matchedByEmail = m.email && byEmail.get(m.email);
      const matchedByPhone = m.phone && byPhone.get(m.phone);
      const matched = matchedByCuit || matchedByEmail || matchedByPhone;
      const matchBy = matchedByCuit
        ? "cuit"
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

    let created = 0;
    let updated = 0;
    const errors: { rowIndex: number; name: string; error: string }[] = [];

    for (const item of items) {
      const action: string = item.action;
      const data: MappedCustomer | undefined = item.data;
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
          await db.customer.create({
            data: {
              name: data.name,
              phone: data.phone,
              email: data.email,
              address: data.address,
              cuit: data.cuit,
              taxType: data.taxType,
              creditLimit: Math.max(0, data.creditLimit),
              notes: data.notes,
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

          const exists = await db.customer.findFirst({
            where: { id: existingId, storeId: u.storeId },
            select: { id: true },
          });
          if (!exists) {
            errors.push({
              rowIndex: data._rowIndex,
              name: data.name,
              error: "Cliente existente no encontrado",
            });
            continue;
          }

          await db.customer.update({
            where: { id: existingId },
            data: {
              name: data.name,
              phone: data.phone,
              email: data.email,
              address: data.address,
              cuit: data.cuit,
              taxType: data.taxType,
              creditLimit: Math.max(0, data.creditLimit),
              notes: data.notes,
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
