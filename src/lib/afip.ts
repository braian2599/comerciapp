/**
 * AFIP / ARCA - Facturación Electrónica
 *
 * Implementación de facturación electrónica para AFIP/ARCA (Argentina).
 *
 * NOTA IMPORTANTE:
 * Esta implementación funciona en modo DEMO/SIMULACIÓN por defecto.
 * Para producción se requiere:
 *   1. Certificado digital (.p12 / .pem) emitido por AFIP
 *   2. Servicio web de AFIP habilitado (wsfev1)
 *   3. Autenticación WSAA (WebService de Autenticación y Autorización)
 *   4. Punto de venta habilitado en AFIP
 *
 * En modo demo, se genera un CAE simulado y un número de factura incremental.
 * El QR se genera según la RG AFIP 4291/2018.
 */

import { db } from "@/lib/db";
import { TaxConfig, Invoice } from "@prisma/client";
import {
  obtenerTokenAcceso,
  feCAESolicitar,
  type FeCaeParams,
} from "@/lib/afip-prod";

// ===== CONSTANTES =====
export const AFIP_TIPOS_COMPROBANTE = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  FACTURA_M: 51,
  NOTA_DEBITO_M: 52,
  NOTA_CREDITO_M: 53,
  FACTURA_E: 19,
  NOTA_DEBITO_E: 20,
  NOTA_CREDITO_E: 21,
} as const;

export const AFIP_CONCEPTOS = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

export const AFIP_CONDICION_IVA_CLIENTE = {
  CONSUMIDOR_FINAL: 5,
  RESPONSABLE_INSCRIPTO: 1,
  MONOTRIBUTO: 6,
  EXENTO: 4,
} as const;

export const AFIP_TIPO_DOCUMENTO = {
  DNI: 96,
  CUIT: 80,
  CUIL: 86,
  SIN_IDENTIFICAR: 99,
} as const;

export const AFIP_ALICUOTAS_IVA = {
  CERO: 0,        // 0%
  DIEZ_COMA_CINCO: 4, // 10.5%
  VEINTIUNO: 5,   // 21%
  VEINTISIETE: 6, // 27%
} as const;

// URLs de los servicios AFIP
const AFIP_WSAA_HOMO = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const AFIP_WSAA_PROD = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const AFIP_WSFEV1_HOMO = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";
const AFIP_WSFEV1_PROD = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";

// ===== TIPOS =====
export interface DatosFactura {
  tipo: "A" | "B" | "C" | "M" | "E";
  concepto: "PRODUCTOS" | "SERVICIOS" | "PRODUCTOS_Y_SERVICIOS";
  fecha: Date;
  // Cliente
  clienteNombre: string;
  clienteCuit?: string | null;
  clienteCondicionIva: string; // CONSUMIDOR_FINAL, MONOTRIBUTO, RESPONSABLE_INSCRIPTO, EXENTO
  // Montos
  netoGravado: number;
  ivaRate: number; // 0, 10.5, 21, 27
  ivaAmount: number;
  noGravado?: number;
  exento?: number;
  total: number;
  // Asociaciones
  saleId?: string;
  customerId?: string | null;
}

export interface ResultadoFactura {
  ok: boolean;
  invoice?: Invoice;
  cae?: string;
  caeVencimiento?: Date;
  numero?: number;
  numeroCompleto?: string;
  qrData?: string;
  error?: string;
  observaciones?: string;
}

// ===== HELPERS =====
export function getTipoComprobanteCode(tipo: string): number {
  switch (tipo) {
    case "A": return AFIP_TIPOS_COMPROBANTE.FACTURA_A;
    case "B": return AFIP_TIPOS_COMPROBANTE.FACTURA_B;
    case "C": return AFIP_TIPOS_COMPROBANTE.FACTURA_C;
    case "M": return AFIP_TIPOS_COMPROBANTE.FACTURA_M;
    case "E": return AFIP_TIPOS_COMPROBANTE.FACTURA_E;
    default: return AFIP_TIPOS_COMPROBANTE.FACTURA_B;
  }
}

/**
 * Devuelve el código AFIP de Nota de Crédito para la letra dada.
 * NC-A=3, NC-B=8, NC-C=13, NC-M=53, NC-E=21.
 */
export function getTipoComprobanteCodeNotaCredito(tipo: string): number {
  switch (tipo) {
    case "A": return AFIP_TIPOS_COMPROBANTE.NOTA_CREDITO_A;
    case "B": return AFIP_TIPOS_COMPROBANTE.NOTA_CREDITO_B;
    case "C": return AFIP_TIPOS_COMPROBANTE.NOTA_CREDITO_C;
    case "M": return AFIP_TIPOS_COMPROBANTE.NOTA_CREDITO_M;
    case "E": return AFIP_TIPOS_COMPROBANTE.NOTA_CREDITO_E;
    default: return AFIP_TIPOS_COMPROBANTE.NOTA_CREDITO_B;
  }
}

/**
 * Calcula el próximo número de factura según el tipo.
 * `kind` distingue entre facturas y notas de crédito (AFIP los numera
 * de forma independiente dentro del mismo punto de venta).
 */
export function getNextInvoiceNumber(
  taxConfig: TaxConfig,
  tipo: string,
  kind: "FACTURA" | "NOTA_CREDITO" = "FACTURA"
): number {
  if (kind === "NOTA_CREDITO") {
    switch (tipo) {
      case "A": return taxConfig.lastCreditNoteA + 1;
      case "B": return taxConfig.lastCreditNoteB + 1;
      case "C": return taxConfig.lastCreditNoteC + 1;
      default: return taxConfig.lastCreditNoteB + 1;
    }
  }
  switch (tipo) {
    case "A": return taxConfig.lastInvoiceA + 1;
    case "B": return taxConfig.lastInvoiceB + 1;
    case "C": return taxConfig.lastInvoiceC + 1;
    default: return taxConfig.lastInvoiceB + 1;
  }
}

/**
 * Valida formato de CUIT (sin guiones, 11 dígitos)
 */
export function validarCuit(cuit: string): boolean {
  const clean = cuit.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  // Algoritmo de validación de CUIT
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean[i]) * multipliers[i];
  }
  const resto = sum % 11;
  const checkDigit = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return checkDigit === parseInt(clean[10]);
}

export function getAlicuotaIvaCode(rate: number): number {
  if (rate === 0) return AFIP_ALICUOTAS_IVA.CERO;
  if (rate === 10.5) return AFIP_ALICUOTAS_IVA.DIEZ_COMA_CINCO;
  if (rate === 21) return AFIP_ALICUOTAS_IVA.VEINTIUNO;
  if (rate === 27) return AFIP_ALICUOTAS_IVA.VEINTISIETE;
  return AFIP_ALICUOTAS_IVA.VEINTIUNO;
}

export function getTipoDocCliente(cuit?: string | null): number {
  if (!cuit || cuit.trim() === "") return AFIP_TIPO_DOCUMENTO.SIN_IDENTIFICAR;
  return AFIP_TIPO_DOCUMENTO.CUIT;
}

export function formatNumeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

// ===== GENERACIÓN DE QR (RG AFIP 4291/2018) =====
/**
 * Genera los datos del QR de factura electrónica según RG AFIP 4291/2018.
 *
 * El QR debe contener la siguiente URL base64-encoded:
 * https://www.afip.gob.ar/fe/qr/?p=<base64>
 *
 * Donde <base64> es el JSON siguiente codificado en base64url:
 * {
 *   "ver": 1,
 *   "fecha": "2024-01-15",
 *   "cuit": "30712345678",
 *   "ptoVta": 1,
 *   "tipoCmp": 6,
 *   "nroCmp": 1,
 *   "importe": 1210.50,
 *   "moneda": "ARS",
 *   "ctz": 1,
 *   "tipoDocRec": 99,
 *   "nroDocRec": 0,
 *   "tipoCodAut": "E",
 *   "codAut": 71234567890123
 * }
 */
export function generarQrData(params: {
  cuitEmisor: string;
  fecha: Date;
  puntoVenta: number;
  tipoComprobante: number;
  numero: number;
  importe: number;
  moneda?: string;
  cotizacion?: number;
  tipoDocReceptor: number;
  nroDocReceptor: number;
  cae: string;
}): string {
  const fechaStr = params.fecha.toISOString().slice(0, 10); // YYYY-MM-DD

  const payload = {
    ver: 1,
    fecha: fechaStr,
    cuit: params.cuitEmisor.replace(/\D/g, ""),
    ptoVta: params.puntoVenta,
    tipoCmp: params.tipoComprobante,
    nroCmp: params.numero,
    importe: Number(params.importe.toFixed(2)),
    moneda: params.moneda || "ARS",
    ctz: params.cotizacion || 1,
    tipoDocRec: params.tipoDocReceptor,
    nroDocRec: params.nroDocReceptor,
    tipoCodAut: "E", // E = CAE
    codAut: params.cae,
  };

  const jsonStr = JSON.stringify(payload);
  // base64url encoding
  const base64 = Buffer.from(jsonStr, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

// ===== SIMULACIÓN DE CAE =====
/**
 * Genera un CAE simulado (14 dígitos) para modo demo.
 * En producción, este valor viene de AFIP WSFEv1.
 */
function generarCaeSimulado(): string {
  // 14 dígitos: 11 dígitos base + dígito verificador
  let cae = "";
  for (let i = 0; i < 13; i++) {
    cae += Math.floor(Math.random() * 10).toString();
  }
  // Dígito verificador simple
  let sum = 0;
  for (let i = 0; i < cae.length; i++) {
    sum += parseInt(cae[i]) * (i + 2);
  }
  cae += (sum % 10).toString();
  return cae;
}

// ===== FUNCIÓN PRINCIPAL: EMITIR FACTURA =====
/**
 * Emite una factura electrónica ante AFIP/ARCA.
 *
 * En modo demo (sin certificado o environment=homologacion sin acceso real):
 * - Genera CAE simulado
 * - Incrementa numeración localmente
 * - Genera QR según RG 4291
 *
 * En modo producción:
 * - Requiere certificado y clave privada
 * - Se autentica con WSAA
 * - Llama a FECAESolicitar de WSFEv1
 */
export async function emitirFactura(
  storeId: string,
  userId: string,
  datos: DatosFactura
): Promise<ResultadoFactura> {
  try {
    // 1. Validar configuración fiscal
    const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
    if (!taxConfig || !taxConfig.active) {
      return {
        ok: false,
        error: "No hay configuración fiscal activa. Configure AFIP en Configuración.",
      };
    }

    if (!taxConfig.cuit || !validarCuit(taxConfig.cuit)) {
      return { ok: false, error: "CUIT del emisor inválido en configuración fiscal." };
    }

    // 2. Validar cliente para facturas A
    if (datos.tipo === "A" && (!datos.clienteCuit || !validarCuit(datos.clienteCuit))) {
      return {
        ok: false,
        error: "Para factura A se requiere CUIT válido del cliente.",
      };
    }

    // 3. Generar número de factura
    const numero = getNextInvoiceNumber(taxConfig, datos.tipo);
    const numeroCompleto = formatNumeroComprobante(taxConfig.puntoVenta, numero);
    const tipoComprobanteCode = getTipoComprobanteCode(datos.tipo);

    // 4. Solicitar CAE a AFIP
    let cae: string;
    let caeVencimiento: Date;
    let observaciones: string | undefined;
    let resultado: string;

    if (taxConfig.environment === "produccion" && taxConfig.certPath) {
      // MODO PRODUCCIÓN: llamar a AFIP WSFEv1
      const afipResult = await solicitarCaeProduccion({
        taxConfig,
        tipoComprobante: tipoComprobanteCode,
        puntoVenta: taxConfig.puntoVenta,
        numero,
        datos,
      });
      if (!afipResult.ok) {
        return { ok: false, error: afipResult.error };
      }
      cae = afipResult.cae!;
      caeVencimiento = afipResult.caeVencimiento!;
      observaciones = afipResult.observaciones;
      resultado = afipResult.resultado || "A";
    } else {
      // MODO DEMO: simular CAE
      cae = generarCaeSimulado();
      caeVencimiento = new Date();
      caeVencimiento.setDate(caeVencimiento.getDate() + 10); // 10 días
      resultado = "A";
    }

    // 5. Generar datos del QR
    const tipoDocRec = getTipoDocCliente(datos.clienteCuit);
    const nroDocRec = tipoDocRec === AFIP_TIPO_DOCUMENTO.SIN_IDENTIFICAR
      ? 0
      : parseInt((datos.clienteCuit || "0").replace(/\D/g, "")) || 0;

    const qrData = generarQrData({
      cuitEmisor: taxConfig.cuit,
      fecha: datos.fecha,
      puntoVenta: taxConfig.puntoVenta,
      tipoComprobante: tipoComprobanteCode,
      numero,
      importe: datos.total,
      tipoDocReceptor: tipoDocRec,
      nroDocReceptor: nroDocRec,
      cae,
    });

    // 6. Crear registro en BD
    const invoice = await db.invoice.create({
      data: {
        storeId,
        userId,
        saleId: datos.saleId || null,
        customerId: datos.customerId || null,
        taxConfigId: taxConfig.id,
        tipo: datos.tipo,
        puntoVenta: taxConfig.puntoVenta,
        numero,
        numeroCompleto,
        fechaEmision: datos.fecha,
        concepto: datos.concepto,
        netoGravado: datos.netoGravado,
        ivaRate: datos.ivaRate,
        ivaAmount: datos.ivaAmount,
        noGravado: datos.noGravado || 0,
        exento: datos.exento || 0,
        total: datos.total,
        customerName: datos.clienteNombre || "Consumidor Final",
        customerCuit: datos.clienteCuit || null,
        customerTaxType: datos.clienteCondicionIva,
        cae,
        caeVencimiento,
        qrData,
        status: resultado === "A" ? "EMITIDA" : resultado === "R" ? "RECHAZADA" : "PENDIENTE",
        observation: observaciones,
        resultado,
      },
    });

    // 7. Actualizar numeración en TaxConfig
    const updateData: any = {};
    if (datos.tipo === "A") updateData.lastInvoiceA = numero;
    else if (datos.tipo === "B") updateData.lastInvoiceB = numero;
    else if (datos.tipo === "C") updateData.lastInvoiceC = numero;

    await db.taxConfig.update({
      where: { id: taxConfig.id },
      data: updateData,
    });

    // 8. Vincular con la venta si existe
    if (datos.saleId) {
      await db.sale.update({
        where: { id: datos.saleId },
        data: { invoice: { connect: { id: invoice.id } } },
      });
    }

    return {
      ok: true,
      invoice,
      cae,
      caeVencimiento,
      numero,
      numeroCompleto,
      qrData,
      observaciones,
    };
  } catch (err: any) {
    console.error("Error emitiendo factura:", err);
    return { ok: false, error: err.message || "Error interno al emitir factura" };
  }
}

// ===== NOTA DE CRÉDITO ELECTRÓNICA =====
/**
 * Datos necesarios para emitir una Nota de Crédito electrónica vinculada
 * a una factura original.
 *
 * En AFIP, una NC debe referenciar a la factura que está anulando/ajustando
 * mediante un comprobante asociado (CbtesAsoc). Por eso requerimos el
 * `originalInvoiceId` que apunta al Invoice (factura) en nuestra BD.
 */
export interface DatosNotaCredito {
  // Factura original a la que se vincula esta NC
  originalInvoiceId: string;
  // Letra de la NC (debe coincidir con la factura original: A, B, C, M, E)
  tipo: "A" | "B" | "C" | "M" | "E";
  concepto: "PRODUCTOS" | "SERVICIOS" | "PRODUCTOS_Y_SERVICIOS";
  fecha: Date;
  // Cliente (snapshot de la factura original; AFIP exige el mismo receptor)
  clienteNombre: string;
  clienteCuit?: string | null;
  clienteCondicionIva: string;
  // Montos (positivos — la NC "anula" un monto de la factura original)
  netoGravado: number;
  ivaRate: number;
  ivaAmount: number;
  noGravado?: number;
  exento?: number;
  total: number;
  // Opcional: cliente para vincular en BD
  customerId?: string | null;
  // Opcional: refund que originó esta NC (para back-link Invoice.refund)
  refundId?: string;
  // Motivo de la NC (texto libre, se guarda en observation)
  motivo?: string;
}

export interface ResultadoNotaCredito extends ResultadoFactura {
  // La NC recién creada
  creditNote?: Invoice;
  // La factura original a la que se vinculó
  originalInvoice?: Invoice;
}

/**
 * Emite una Nota de Crédito electrónica vinculada a una factura.
 *
 * Reglas de negocio:
 *  - La factura original debe existir, estar EMITIDA (no ANULADA) y tener CAE.
 *  - La letra y concepto de la NC deben coincidir con los de la factura original.
 *  - El cliente de la NC es el mismo que el de la factura original (snapshot).
 *  - La NC obtiene su propio número (contador independiente en TaxConfig).
 *  - En modo demo: CAE simulado.
 *  - En modo producción: WSFEv1 con CbtesAsoc apuntando a la factura original.
 *
 * El Invoice creado queda con:
 *   comprobanteSubtipo = 'NOTA_CREDITO'
 *   relatedInvoiceId   = <id de la factura original>
 *   refundId           = <refundId si vino en DatosNotaCredito>  (se linkea más abajo)
 *
 * NOTA: NO se setea `saleId` en la NC porque Invoice.saleId es @unique
 *       y la venta ya tiene su factura original. La NC se vincula a la
 *       venta indirectamente vía relatedInvoiceId → Factura.saleId.
 *
 * NOTA: el back-link Invoice.refund → Refund se hace escribiendo
 *       Refund.creditNoteInvoiceId = invoice.id desde el caller,
 *       porque la relación 1:1 vive del lado del Refund.
 */
export async function emitirNotaDeCredito(
  storeId: string,
  userId: string,
  datos: DatosNotaCredito
): Promise<ResultadoNotaCredito> {
  try {
    // 1. Validar configuración fiscal
    const taxConfig = await db.taxConfig.findUnique({ where: { storeId } });
    if (!taxConfig || !taxConfig.active) {
      return {
        ok: false,
        error: "No hay configuración fiscal activa. Configure AFIP en Configuración.",
      };
    }
    if (!taxConfig.cuit || !validarCuit(taxConfig.cuit)) {
      return { ok: false, error: "CUIT del emisor inválido en configuración fiscal." };
    }

    // 2. Cargar factura original y validar
    const originalInvoice = await db.invoice.findFirst({
      where: { id: datos.originalInvoiceId, storeId },
    });
    if (!originalInvoice) {
      return { ok: false, error: "Factura original no encontrada." };
    }
    if (originalInvoice.comprobanteSubtipo !== "FACTURA") {
      return {
        ok: false,
        error: `El comprobante ${originalInvoice.numeroCompleto} no es una factura (es ${originalInvoice.comprobanteSubtipo}).`,
      };
    }
    if (originalInvoice.status === "ANULADA") {
      return {
        ok: false,
        error: `La factura ${originalInvoice.numeroCompleto} ya está anulada; no se puede emitir NC sobre una factura anulada.`,
      };
    }
    if (!originalInvoice.cae) {
      return {
        ok: false,
        error: `La factura ${originalInvoice.numeroCompleto} no tiene CAE; no se puede emitir NC sobre una factura sin CAE.`,
      };
    }

    // 3. Validar coherencia de letra y concepto con la factura original
    if (datos.tipo !== originalInvoice.tipo) {
      return {
        ok: false,
        error: `La NC debe ser tipo ${originalInvoice.tipo} para coincidir con la factura original.`,
      };
    }

    // 4. Para NC-A se requiere CUIT del cliente
    if (datos.tipo === "A" && (!datos.clienteCuit || !validarCuit(datos.clienteCuit))) {
      return {
        ok: false,
        error: "Para nota de crédito A se requiere CUIT válido del cliente.",
      };
    }

    // 5. Generar número de NC (contador independiente)
    const numero = getNextInvoiceNumber(taxConfig, datos.tipo, "NOTA_CREDITO");
    const numeroCompleto = formatNumeroComprobante(taxConfig.puntoVenta, numero);
    const tipoComprobanteCode = getTipoComprobanteCodeNotaCredito(datos.tipo);

    // 6. Solicitar CAE a AFIP
    let cae: string;
    let caeVencimiento: Date;
    let observaciones: string | undefined;
    let resultado: string;

    if (taxConfig.environment === "produccion" && taxConfig.certPath) {
      const afipResult = await solicitarCaeNotaCreditoProduccion({
        taxConfig,
        tipoComprobante: tipoComprobanteCode,
        puntoVenta: taxConfig.puntoVenta,
        numero,
        datos,
        originalInvoice,
      });
      if (!afipResult.ok) {
        return { ok: false, error: afipResult.error };
      }
      cae = afipResult.cae!;
      caeVencimiento = afipResult.caeVencimiento!;
      observaciones = afipResult.observaciones;
      resultado = afipResult.resultado || "A";
    } else {
      // MODO DEMO: simular CAE
      cae = generarCaeSimulado();
      caeVencimiento = new Date();
      caeVencimiento.setDate(caeVencimiento.getDate() + 10);
      resultado = "A";
    }

    // 7. Generar QR (RG 4291 — mismo formato que factura, pero con tipoCmp de NC)
    const tipoDocRec = getTipoDocCliente(datos.clienteCuit);
    const nroDocRec =
      tipoDocRec === AFIP_TIPO_DOCUMENTO.SIN_IDENTIFICAR
        ? 0
        : parseInt((datos.clienteCuit || "0").replace(/\D/g, "")) || 0;

    const qrData = generarQrData({
      cuitEmisor: taxConfig.cuit,
      fecha: datos.fecha,
      puntoVenta: taxConfig.puntoVenta,
      tipoComprobante: tipoComprobanteCode,
      numero,
      importe: datos.total,
      tipoDocReceptor: tipoDocRec,
      nroDocReceptor: nroDocRec,
      cae,
    });

    // 8. Crear Invoice con comprobanteSubtipo='NOTA_CREDITO'
    //
    // NOTA sobre saleId: NO seteamos saleId en la NC, porque Invoice.saleId
    // tiene @unique y la venta ya tiene su factura original linkeada a saleId.
    // La NC se vincula a la venta INDIRECTAMENTE vía:
    //   NC.relatedInvoiceId → Factura.id → Factura.saleId → Sale.id
    //   NC.refund → Refund.saleId → Sale.id
    // Esto evita la violación de unique constraint.
    const creditNote = await db.invoice.create({
      data: {
        storeId,
        userId,
        // saleId intencionalmente omitido (ver comentario arriba)
        customerId: datos.customerId || originalInvoice.customerId || null,
        taxConfigId: taxConfig.id,
        comprobanteSubtipo: "NOTA_CREDITO",
        relatedInvoiceId: originalInvoice.id,
        tipo: datos.tipo,
        puntoVenta: taxConfig.puntoVenta,
        numero,
        numeroCompleto,
        fechaEmision: datos.fecha,
        concepto: datos.concepto,
        netoGravado: datos.netoGravado,
        ivaRate: datos.ivaRate,
        ivaAmount: datos.ivaAmount,
        noGravado: datos.noGravado || 0,
        exento: datos.exento || 0,
        total: datos.total,
        customerName: datos.clienteNombre || "Consumidor Final",
        customerCuit: datos.clienteCuit || null,
        customerTaxType: datos.clienteCondicionIva,
        cae,
        caeVencimiento,
        qrData,
        status: resultado === "A" ? "EMITIDA" : resultado === "R" ? "RECHAZADA" : "PENDIENTE",
        observation: observaciones || datos.motivo || null,
        resultado,
      },
    });

    // 9. Actualizar contador de NC en TaxConfig
    const updateData: any = {};
    if (datos.tipo === "A") updateData.lastCreditNoteA = numero;
    else if (datos.tipo === "B") updateData.lastCreditNoteB = numero;
    else if (datos.tipo === "C") updateData.lastCreditNoteC = numero;

    await db.taxConfig.update({
      where: { id: taxConfig.id },
      data: updateData,
    });

    // 10. Vincular Refund → NC (back-link 1:1)
    if (datos.refundId) {
      await db.refund.update({
        where: { id: datos.refundId },
        data: { creditNoteInvoiceId: creditNote.id },
      });
    }

    return {
      ok: true,
      invoice: creditNote,
      creditNote,
      originalInvoice,
      cae,
      caeVencimiento,
      numero,
      numeroCompleto,
      qrData,
      observaciones,
    };
  } catch (err: any) {
    console.error("Error emitiendo nota de crédito:", err);
    return { ok: false, error: err.message || "Error interno al emitir nota de crédito" };
  }
}

/**
 * Producción: solicita CAE de NC a AFIP WSFEv1.
 * A diferencia de la factura, una NC debe incluir el array `CbtesAsoc`
 * apuntando a la factura original (tipo + ptoVta + nro).
 *
 * Implementación: delega a lib/afip-prod.ts (WSAA + WSFEv1 con fetch + node-forge).
 */
async function solicitarCaeNotaCreditoProduccion(params: {
  taxConfig: TaxConfig;
  tipoComprobante: number;
  puntoVenta: number;
  numero: number;
  datos: DatosNotaCredito;
  originalInvoice: Invoice;
}): Promise<{
  ok: boolean;
  cae?: string;
  caeVencimiento?: Date;
  observaciones?: string;
  resultado?: string;
  error?: string;
}> {
  try {
    // 1. Obtener TA (token de acceso WSAA). Cache en TaxConfig.authToken.
    const ta = await obtenerTokenAcceso(params.taxConfig, "wsfe");

    // 2. Mapear concepto literal → código AFIP
    const conceptoCode =
      params.datos.concepto === "PRODUCTOS"
        ? 1
        : params.datos.concepto === "SERVICIOS"
          ? 2
          : 3;

    // 3. Mapear tipo de documento del receptor (snapshot de la factura original)
    const docTipo = params.datos.clienteCuit
      ? 80 // CUIT
      : 99; // sin identificar
    const docNro = params.datos.clienteCuit
      ? parseInt(params.datos.clienteCuit.replace(/\D/g, ""), 10) || 0
      : 0;

    // 4. Construir payload FECAESolicitar con CbtesAsoc apuntando a la
    //    factura original. AFIP exige tipo + ptoVta + número de la fac original.
    const feParams: FeCaeParams = {
      tipoComprobante: params.tipoComprobante, // 3=NC-A, 8=NC-B, 13=NC-C
      puntoVenta: params.puntoVenta,
      numero: params.numero,
      concepto: conceptoCode,
      docTipo,
      docNro,
      impNeto: params.datos.netoGravado,
      impIVA: params.datos.ivaAmount,
      impTotal: params.datos.total,
      impNoGravado: params.datos.noGravado || 0,
      impExento: params.datos.exento || 0,
      ivaAlicuota: getAlicuotaIvaCode(params.datos.ivaRate),
      ivaBaseImp: params.datos.netoGravado,
      fechaCbte: formatAfipDate(params.datos.fecha),
      comprobantesAsociados: [
        {
          tipo: getTipoComprobanteCode(params.originalInvoice.tipo),
          puntoVenta: params.originalInvoice.puntoVenta,
          numero: params.originalInvoice.numero,
        },
      ],
    };

    // 5. Llamar a WSFEv1
    const result = await feCAESolicitar(params.taxConfig, ta, feParams);
    return result;
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ||
        "Error inesperado al contactar AFIP para emitir nota de crédito",
    };
  }
}


// ===== PRODUCCIÓN: SOLICITAR CAE A AFIP WSFEv1 =====
/**
 * Implementación real de solicitud de CAE a AFIP para facturas.
 * Delega a lib/afip-prod.ts (WSAA + WSFEv1 con fetch + node-forge).
 *
 * Requiere:
 *   - TaxConfig.environment = 'produccion'
 *   - TaxConfig.certPath (archivo .p12 con password o .pem)
 *   - TaxConfig.privateKeyPath (solo si certPath es .pem)
 *   - Punto de venta habilitado en AFIP
 */
async function solicitarCaeProduccion(params: {
  taxConfig: TaxConfig;
  tipoComprobante: number;
  puntoVenta: number;
  numero: number;
  datos: DatosFactura;
}): Promise<{
  ok: boolean;
  cae?: string;
  caeVencimiento?: Date;
  observaciones?: string;
  resultado?: string;
  error?: string;
}> {
  try {
    // 1. Obtener TA (token de acceso WSAA). Cache en TaxConfig.authToken.
    const ta = await obtenerTokenAcceso(params.taxConfig, "wsfe");

    // 2. Mapear concepto literal → código AFIP
    const conceptoCode =
      params.datos.concepto === "PRODUCTOS"
        ? 1
        : params.datos.concepto === "SERVICIOS"
          ? 2
          : 3;

    // 3. Mapear tipo de documento del receptor
    const docTipo = params.datos.clienteCuit ? 80 : 99;
    const docNro = params.datos.clienteCuit
      ? parseInt(params.datos.clienteCuit.replace(/\D/g, ""), 10) || 0
      : 0;

    // 4. Construir payload FECAESolicitar (sin CbtesAsoc — es factura original)
    const feParams: FeCaeParams = {
      tipoComprobante: params.tipoComprobante,
      puntoVenta: params.puntoVenta,
      numero: params.numero,
      concepto: conceptoCode,
      docTipo,
      docNro,
      impNeto: params.datos.netoGravado,
      impIVA: params.datos.ivaAmount,
      impTotal: params.datos.total,
      impNoGravado: params.datos.noGravado || 0,
      impExento: params.datos.exento || 0,
      ivaAlicuota: getAlicuotaIvaCode(params.datos.ivaRate),
      ivaBaseImp: params.datos.netoGravado,
      fechaCbte: formatAfipDate(params.datos.fecha),
    };

    // 5. Llamar a WSFEv1
    const result = await feCAESolicitar(params.taxConfig, ta, feParams);
    return result;
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ||
        "Error inesperado al contactar AFIP para emitir factura",
    };
  }
}

/**
 * Formatea una Date como YYYYMMDD (formato esperado por AFIP FchEmis).
 */
function formatAfipDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// ===== ANULACIÓN DE FACTURA =====
/**
 * Anula una factura electrónica (nota de crédito o RechazarComprobante).
 * En modo demo, solo marca como ANULADA en BD.
 */
export async function anularFactura(
  invoiceId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: { taxConfig: true },
    });
    if (!invoice) return { ok: false, error: "Factura no encontrada" };
    if (invoice.status === "ANULADA") return { ok: false, error: "La factura ya está anulada" };

    // TODO: En producción, llamar a FECAESolicitar con tipo=nota de crédito
    // Por ahora, solo marcamos como anulada
    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "ANULADA",
        anulatedAt: new Date(),
        anulatedBy: userId,
      },
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ===== UTILIDADES DE CÁLCULO =====
/**
 * Calcula los montos de IVA según el tipo de factura y condición del cliente.
 * - Factura A: discriminate IVA (neto + iva)
 * - Factura B/C: IVA incluido en el total (no se discrimina)
 */
export function calcularIva(
  total: number,
  ivaRate: number,
  tipoFactura: string
): { netoGravado: number; ivaAmount: number; total: number } {
  if (tipoFactura === "A") {
    // Discriminar IVA
    const neto = total / (1 + ivaRate / 100);
    const iva = total - neto;
    return {
      netoGravado: Number(neto.toFixed(2)),
      ivaAmount: Number(iva.toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  } else {
    // Factura B/C: IVA incluido
    // El neto es el total sin discriminar (para AFIP)
    const neto = total / (1 + ivaRate / 100);
    return {
      netoGravado: Number(neto.toFixed(2)),
      ivaAmount: Number((total - neto).toFixed(2)),
      total: Number(total.toFixed(2)),
    };
  }
}

/**
 * Determina el tipo de factura según la condición del cliente y del emisor.
 * - Emisor Monotributo: solo factura C
 * - Emisor Responsable Inscripto:
 *   - Cliente RI: factura A
 *   - Cliente CF/Mono: factura B
 */
export function determinarTipoFactura(
  condicionEmisor: string,
  condicionCliente: string
): "A" | "B" | "C" {
  if (condicionEmisor === "MONOTRIBUTO") return "C";
  if (condicionEmisor === "RESPONSABLE_INSCRIPTO") {
    if (condicionCliente === "RESPONSABLE_INSCRIPTO") return "A";
    return "B";
  }
  return "C";
}
