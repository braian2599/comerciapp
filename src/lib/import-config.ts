/**
 * Configuración compartida para importación masiva.
 *
 * Define los campos disponibles para cada entidad (productos, clientes),
 * sus alias (para auto-detección de columnas) y metadatos para la UI.
 *
 * Lo usan:
 *   - `import-dialog.tsx` (cliente): para mostrar la lista de campos a mapear
 *     y para sugerir el mapeo automático a partir de los headers del archivo.
 *   - `/api/products/import/route.ts` y `/api/customers/import/route.ts`:
 *     como fallback si el cliente no envía `columnMapping` explícito
 *     (compatibilidad con llamadas directas a la API).
 *
 * NUNCA mover los alias al cliente sin mantenerlos acá también: la API
 * puede ser usada por scripts externos que no manden mapeo.
 */

export interface ImportField {
  /** Nombre interno del campo (ej: "salePrice"). */
  key: string;
  /** Etiqueta humana (ej: "Precio de venta"). */
  label: string;
  /** Si el campo es obligatorio para que la fila sea válida. */
  required?: boolean;
  /** Alias aceptados para auto-detección (lowercase, sin espacios). */
  aliases: string[];
  /** Tipo de dato para parseo y validación. */
  type: "text" | "number" | "boolean" | "unit" | "taxType";
  /** Descripción corta para tooltip/ayuda. */
  hint?: string;
  /** Valor por defecto si la columna no está mapeada o la celda está vacía. */
  defaultValue?: any;
}

// ─── Productos ────────────────────────────────────────────────────────────────

export const PRODUCT_IMPORT_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Nombre",
    required: true,
    type: "text",
    aliases: ["name", "nombre", "producto", "descripcion_corta", "articulo", "item", "denominacion"],
    hint: "Nombre del producto (obligatorio)",
  },
  {
    key: "barcode",
    label: "Código de barras",
    type: "text",
    aliases: ["barcode", "codigo_de_barras", "codigo_barras", "codigobarras", "ean", "upc"],
    hint: "EAN/UPC para escanear en POS",
  },
  {
    key: "sku",
    label: "Código interno (SKU)",
    type: "text",
    aliases: ["sku", "codigo_interno", "cod_interno", "codigo"],
  },
  {
    key: "category",
    label: "Categoría",
    type: "text",
    aliases: ["category", "categoria", "rubro"],
    hint: "Se crea la categoría si no existe",
  },
  {
    key: "costPrice",
    label: "Precio de costo",
    type: "number",
    aliases: ["costprice", "costo", "precio_costo", "precio_de_costo", "preciocosto"],
    defaultValue: 0,
  },
  {
    key: "salePrice",
    label: "Precio de venta",
    type: "number",
    aliases: ["saleprice", "precio", "precio_venta", "precio_de_venta", "precioventa"],
    defaultValue: 0,
    hint: "Opcional: si no lo mapeás, se calcula automáticamente desde el precio de costo",
  },
  {
    key: "stock",
    label: "Stock actual",
    type: "number",
    aliases: ["stock", "cantidad", "existencia", "existencias", "inventario"],
    defaultValue: 0,
  },
  {
    key: "minStock",
    label: "Stock mínimo",
    type: "number",
    aliases: ["minstock", "stock_minimo", "stockminimo", "minimo"],
    defaultValue: 5,
  },
  {
    key: "unit",
    label: "Unidad de medida",
    type: "unit",
    aliases: ["unit", "unidad", "umedida", "u_medida"],
    defaultValue: "UNIDAD",
    hint: "UNIDAD, KG, LITRO, METRO o PACK",
  },
  {
    key: "active",
    label: "Activo",
    type: "boolean",
    aliases: ["active", "activo", "habilitado", "estado"],
    defaultValue: true,
  },
  {
    key: "brand",
    label: "Marca",
    type: "text",
    aliases: ["brand", "marca"],
  },
  {
    key: "supplier",
    label: "Proveedor",
    type: "text",
    aliases: ["supplier", "proveedor", "provider", "razon_social_proveedor"],
    hint: "Se crea el proveedor si no existe (match por nombre)",
  },
  {
    key: "description",
    label: "Descripción",
    type: "text",
    aliases: ["description", "descripcion", "detalle", "notas"],
  },
  {
    key: "labels",
    label: "Etiquetas",
    type: "text",
    aliases: ["labels", "etiquetas", "tags"],
    hint: "Separadas por coma",
  },
  {
    key: "ingredients",
    label: "Ingredientes",
    type: "text",
    aliases: ["ingredients", "ingredientes"],
  },
  {
    key: "allergens",
    label: "Alérgenos",
    type: "text",
    aliases: ["allergens", "alergenos", "alérgenos"],
  },
  {
    key: "imageUrl",
    label: "URL de imagen",
    type: "text",
    aliases: ["imageurl", "imagen", "img", "foto", "image_url", "imagen_url"],
  },
];

// ─── Clientes ─────────────────────────────────────────────────────────────────

export const CUSTOMER_IMPORT_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Nombre / Razón social",
    required: true,
    type: "text",
    aliases: ["name", "nombre", "razon_social", "razonsocial", "cliente"],
  },
  {
    key: "phone",
    label: "Teléfono",
    type: "text",
    aliases: ["phone", "telefono", "tel", "celular", "movil", "móvil"],
  },
  {
    key: "email",
    label: "Email",
    type: "text",
    aliases: ["email", "correo", "mail", "e_mail"],
  },
  {
    key: "address",
    label: "Dirección",
    type: "text",
    aliases: ["address", "direccion", "domicilio", "dir"],
  },
  {
    key: "city",
    label: "Localidad",
    type: "text",
    aliases: ["city", "localidad", "ciudad", "poblacion", "municipio", "partido"],
  },
  {
    key: "cuit",
    label: "CUIT/CUIL",
    type: "text",
    aliases: ["cuit", "cuil", "dni", "documento"],
  },
  {
    key: "taxType",
    label: "Condición fiscal",
    type: "taxType",
    aliases: ["taxtype", "tax_type", "condicion_fiscal", "condicionfiscal", "tipo_fiscal"],
    hint: "CONSUMIDOR_FINAL, MONOTRIBUTO, RESPONSABLE_INSCRIPTO o EXENTO",
  },
  {
    key: "creditLimit",
    label: "Límite de crédito",
    type: "number",
    aliases: ["creditlimit", "credit_limit", "limite_credito", "limitecredito", "limite"],
    defaultValue: 0,
  },
  {
    key: "notes",
    label: "Notas",
    type: "text",
    aliases: ["notes", "notas", "observaciones", "obs"],
  },
];

// ─── Proveedores ──────────────────────────────────────────────────────────────

export const SUPPLIER_IMPORT_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Nombre / Razón social",
    required: true,
    type: "text",
    aliases: ["name", "nombre", "razon_social", "razonsocial", "proveedor", "provider"],
    hint: "Nombre del proveedor (obligatorio)",
  },
  {
    key: "contactName",
    label: "Contacto",
    type: "text",
    aliases: ["contactname", "contact_name", "contacto", "persona_contacto"],
  },
  {
    key: "phone",
    label: "Teléfono",
    type: "text",
    aliases: ["phone", "telefono", "tel", "celular", "movil"],
  },
  {
    key: "email",
    label: "Email",
    type: "text",
    aliases: ["email", "correo", "mail", "e_mail"],
  },
  {
    key: "address",
    label: "Dirección",
    type: "text",
    aliases: ["address", "direccion", "domicilio", "dir"],
  },
  {
    key: "notes",
    label: "Notas",
    type: "text",
    aliases: ["notes", "notas", "observaciones", "obs"],
  },
];

// ─── Helpers de auto-detección (compartidos cliente/servidor) ─────────────────

/**
 * Normaliza un header para comparación: lowercase, sin espacios extra,
 * guiones bajos en lugar de espacios.
 */
export function normalizeHeader(h: string): string {
  return String(h || "")
    .toLowerCase()
    .trim()
    // Quitar acentos/diacríticos: "Código" → "codigo", "Categoría" → "categoria"
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

/**
 * Dado un array de headers del archivo y la lista de campos disponibles,
 * devuelve un mapeo sugerido `{ fieldKey: columnIndex }`.
 *
 * Reglas:
 *   - La primera coincidencia (por alias) gana.
 *   - Headers sin match se ignoran (el usuario puede mapearlos manualmente).
 *   - Solo se incluyen en el resultado los campos que matchearon.
 */
export function suggestColumnMapping(
  headers: string[],
  fields: ImportField[]
): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    if (!norm) return;
    for (const field of fields) {
      if (field.key in map) continue; // ya mapeado
      if (field.aliases.includes(norm)) {
        map[field.key] = idx;
        break;
      }
    }
  });
  return map;
}

/**
 * Devuelve los campos válidos para una entidad dada.
 */
export function getImportFields(entity: "product" | "customer" | "supplier"): ImportField[] {
  if (entity === "product") return PRODUCT_IMPORT_FIELDS;
  if (entity === "customer") return CUSTOMER_IMPORT_FIELDS;
  return SUPPLIER_IMPORT_FIELDS;
}
