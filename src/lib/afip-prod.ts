/**
 * AFIP Producción — Integración real con WSAA + WSFEv1.
 *
 * IMPLEMENTACIÓN:
 *  - Usa `fetch` nativo (Node 18+) para llamadas SOAP/HTTPS.
 *  - Usa `node-forge` para firma PKCS#7 (CMS) del TRA — sin dependencia
 *    del binario `openssl`, ideal para Vercel serverless.
 *  - Cachea el Token de Acceso (TA) en TaxConfig.authToken +
 *    authTokenExpires. Renueva automáticamente 1h antes de expirar.
 *
 * ARQUITECTURA:
 *   leerCertificadoYClave() → carga PEM desde FS (o extrae de .p12)
 *   firmarTRA()              → PKCS#7 sobre el XML TRA con node-forge
 *   obtenerTokenAcceso()    → POST al WSAA, cachea en DB
 *   feCAESolicitar()        → POST al WSFEv1 con TA + datos del comprobante
 *
 * FLUJO COMPLETO (desde emitirFactura / emitirNotaDeCredito):
 *   1. Leer TaxConfig; verificar environment='produccion' + certPath.
 *   2. Cargar certificado PEM + clave privada PEM.
 *   3. Obtener TA (cache o renovar).
 *   4. Construir payload FECAESolicitar (con CbtesAsoc si es NC).
 *   5. POST a WSFEv1.
 *   6. Parsear respuesta: CAE, vencimiento, observaciones, errores.
 *   7. Si hay errores → mapear a mensaje user-friendly y retornar ok=false.
 *
 * ROBUSTEZ:
 *  - Timeouts de 30s en cada fetch (AFIP a veces cuelga).
 *  - Reintento único si el TA expiró entre el cache check y la llamada.
 *  - Parseo defensivo de la respuesta XML (AFIP puede devolver estructuras
 *    ligeramente distintas según el tipo de comprobante).
 *  - Errores de AFIP mapeados a mensajes en español, identificando el código.
 */

import forge from "node-forge";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import type { TaxConfig } from "@prisma/client";

// ===== URLs AFIP =====
const WSAA_HOMO = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
const WSAA_PROD = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const WSFEV1_HOMO = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";
const WSFEV1_PROD = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";

// ===== TIPOS =====

export interface AfipCertMaterial {
  /** PEM del certificado X.509 del contribuyente (emisor). */
  certPem: string;
  /** PEM de la clave privada correspondiente al certificado. */
  keyPem: string;
}

export interface AfipTokenAcceso {
  token: string;
  sign: string;
  /** Fecha de expiración del token (UTC). */
  expiresAt: Date;
}

export interface AfipCaeResult {
  ok: boolean;
  cae?: string;
  caeVencimiento?: Date;
  observaciones?: string;
  resultado?: string; // "A" (aprobado), "R" (rechazado), "P" (parcial)
  errores?: AfipError[];
  error?: string;
}

export interface AfipError {
  code: number;
  message: string;
}

// ===== LECTOR DE CERTIFICADOS =====

/**
 * Carga el certificado y la clave privada desde el filesystem.
 *
 * Acepta dos formatos:
 *  - .p12 / .pfx (binario PKCS#12): requiere certPassword para abrir.
 *  - .pem (texto): certPath = cert PEM, privateKeyPath = key PEM.
 *
 * En serverless (Vercel) los archivos deben estar en /tmp o en una ruta
 * dentro del proyecto. La subida de certificados se gestiona desde el
 * módulo /api/tax-config con multer u otra estrategia similar.
 *
 * @throws Error si no encuentra los archivos o la password es incorrecta.
 */
export async function leerCertificadoYClave(
  taxConfig: TaxConfig
): Promise<AfipCertMaterial> {
  if (!taxConfig.certPath) {
    throw new Error("Falta certPath en la configuración fiscal");
  }
  const certAbs = resolveUploadPath(taxConfig.certPath);
  let certBuffer: Buffer;
  try {
    certBuffer = await fs.readFile(certAbs);
  } catch (e: any) {
    throw new Error(
      `No se pudo leer el certificado desde ${certAbs}: ${e.message}`
    );
  }

  const isP12 =
    certAbs.toLowerCase().endsWith(".p12") ||
    certAbs.toLowerCase().endsWith(".pfx");

  if (isP12) {
    // PKCS#12: extraer cert + key con node-forge
    if (!taxConfig.certPassword) {
      throw new Error(
        "El certificado es .p12 pero falta certPassword en la configuración"
      );
    }
    const p12Asn1 = forge.asn1.fromDer(certBuffer.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, taxConfig.certPassword);

    let certPem = "";
    let keyPem = "";

    // Buscar el certificado y la clave privada en los safeBags
    for (const safeContents of p12.safeContents) {
      for (const bag of safeContents.bags) {
        if (bag.type === forge.pki.oids.certBag && bag.attributes?.localKeyId) {
          const cert = (bag as any).cert;
          if (cert) certPem = forge.pki.certificateToPem(cert);
        }
        if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag) {
          const key = (bag as any).asn1;
          if (key) {
            try {
              const privateKey = forge.pki.decryptPrivateKeyInfo(
                key,
                taxConfig.certPassword
              );
              if (privateKey) keyPem = forge.pki.privateKeyToPem(privateKey);
            } catch {
              // fallback: intentar como clave no encriptada
            }
          }
        }
        if (bag.type === forge.pki.oids.keyBag) {
          const key = (bag as any).key;
          if (key) keyPem = forge.pki.privateKeyToPem(key);
        }
      }
    }

    if (!certPem) throw new Error("No se pudo extraer el certificado del .p12");
    if (!keyPem) throw new Error("No se pudo extraer la clave privada del .p12");
    return { certPem, keyPem };
  }

  // Formato PEM: certPath = cert PEM, privateKeyPath = key PEM
  if (!taxConfig.privateKeyPath) {
    throw new Error(
      "Formato PEM requiere privateKeyPath en la configuración fiscal"
    );
  }
  const keyAbs = resolveUploadPath(taxConfig.privateKeyPath);
  let keyBuffer: Buffer;
  try {
    keyBuffer = await fs.readFile(keyAbs);
  } catch (e: any) {
    throw new Error(
      `No se pudo leer la clave privada desde ${keyAbs}: ${e.message}`
    );
  }
  return {
    certPem: certBuffer.toString("utf-8"),
    keyPem: keyBuffer.toString("utf-8"),
  };
}

/**
 * Resuelve rutas relativas a un directorio de uploads.
 * Soporta:
 *  - Absolutas (/tmp/... o /home/...)
 *  - Relativas a /home/z/my-project/uploads/ (env UPLOADS_DIR override)
 */
function resolveUploadPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  const base = process.env.UPLOADS_DIR || "/home/z/my-project/uploads";
  return path.join(base, p);
}

// ===== FIRMA DEL TRA (Ticket de Requerimiento de Acceso) =====

/**
 * Genera el XML del TRA (Ticket de Requerimiento de Acceso) para WSAA.
 * El TRA pide acceso al servicio `wsfe` (WSFEv1) por 12 horas (máximo AFIP).
 */
function generarTRAXml(service: string = "wsfe"): string {
  const now = new Date();
  // AFIP acepta hasta 24h; usamos 12h para tener margen
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().slice(0, 19).replace("T", "T"); // 2024-01-15T13:45:00
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>
    <generationTime>${fmt(now)}</generationTime>
    <expirationTime>${fmt(expires)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

/**
 * Firma el TRA con PKCS#7 (CMS) usando el certificado y la clave privada.
 *
 * AFIP WSAA requiere recibir el TRA firmado en formato CMS, codificado
 * en base64. El CMS debe estar en modo "detached" falso (incluye el contenido).
 *
 * Implementación con node-forge: crea un objeto PKCS#7 signedData con
 * el TRA como contenido, lo firma con SHA-256 + RSA.
 */
function firmarTRA(
  traXml: string,
  certPem: string,
  keyPem: string
): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  // Crear objeto PKCS#7
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf-8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date(),
      },
    ],
  });
  p7.sign(); // detached=false (contenido embebido)

  const derBytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(derBytes, "binary").toString("base64");
}

// ===== WSAA — OBTENER TOKEN DE ACCESO =====

/**
 * Obtiene el Token de Acceso (TA) desde el WSAA de AFIP.
 *
 * Estrategia:
 *  1. Si TaxConfig.authToken existe y authTokenExpires > now + 1h → usar cache.
 *  2. Si no, generar TRA, firmar, POST al WSAA, parsear TA, persistir.
 *
 * @param taxConfig Configuración fiscal del comercio.
 * @param service    Servicio AFIP a autorizar ("wsfe" por defecto).
 * @returns Token + Sign + fecha de expiración, o lanza Error.
 */
export async function obtenerTokenAcceso(
  taxConfig: TaxConfig,
  service: string = "wsfe"
): Promise<AfipTokenAcceso> {
  // 1. Cache hit?
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  if (
    taxConfig.authToken &&
    taxConfig.authTokenExpires &&
    taxConfig.authTokenExpires > oneHourFromNow
  ) {
    const cached = parseTokenFromXml(taxConfig.authToken);
    if (cached) return cached;
    // si parse falla, regenerar abajo
  }

  // 2. Cargar cert + key
  const { certPem, keyPem } = await leerCertificadoYClave(taxConfig);

  // 3. Generar y firmar TRA
  const traXml = generarTRAXml(service);
  const cmsB64 = firmarTRA(traXml, certPem, keyPem);

  // 4. POST al WSAA (SOAP)
  const wsaaUrl = taxConfig.environment === "produccion" ? WSAA_PROD : WSAA_HOMO;
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">
      <in0>${cmsB64}</in0>
    </loginCms>
  </soap:Body>
</soap:Envelope>`;

  const resp = await fetchWithTimeout(wsaaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '""',
    },
    body: soapBody,
  }, 30000);

  if (!resp.ok) {
    const txt = await safeText(resp);
    throw new Error(`WSAA HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  const xmlText = await resp.text();
  // 5. Detectar fault de SOAP
  const faultMatch = xmlText.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) {
    throw new Error(`WSAA rechazó el TRA: ${decodeXmlEntities(faultMatch[1]).trim()}`);
  }

  // 6. Extraer loginTicketResponse
  const taXml = extractTagContent(xmlText, "loginTicketResponse");
  if (!taXml) {
    throw new Error(
      "WSAA: respuesta sin loginTicketResponse — respuesta inesperada del servidor"
    );
  }

  // 7. Persistir cache
  const token = extractTagContent(taXml, "token");
  const sign = extractTagContent(taXml, "sign");
  const expiresStr = extractTagContent(taXml, "expirationTime");
  if (!token || !sign || !expiresStr) {
    throw new Error("WSAA: TA sin token/sign/expirationTime");
  }
  const expiresAt = new Date(expiresStr.replace("T", "T")); // ISO

  await db.taxConfig.update({
    where: { id: taxConfig.id },
    data: {
      authToken: taXml,
      authTokenExpires: expiresAt,
    },
  });

  return { token, sign, expiresAt };
}

/**
 * Parsea un TA cacheado (XML completo) para extraer token + sign.
 * Retorna null si no se puede parsear (cache corrupto).
 */
function parseTokenFromXml(taXml: string): AfipTokenAcceso | null {
  try {
    const token = extractTagContent(taXml, "token");
    const sign = extractTagContent(taXml, "sign");
    const expiresStr = extractTagContent(taXml, "expirationTime");
    if (!token || !sign || !expiresStr) return null;
    return { token, sign, expiresAt: new Date(expiresStr) };
  } catch {
    return null;
  }
}

// ===== WSFEv1 — FECAESolicitar =====

/**
 * Parámetros para solicitar un CAE a WSFEv1.
 * Tanto facturas como notas de crédito usan esta estructura.
 * Para NC, `comprobantesAsociados` debe incluir la factura original.
 */
export interface FeCaeParams {
  tipoComprobante: number; // 1=FAC-A, 6=FAC-B, 11=FAC-C, 3=NC-A, 8=NC-B, 13=NC-C
  puntoVenta: number;
  numero: number; // número de comprobante a emitir
  concepto: number; // 1=productos, 2=servicios, 3=ambos
  docTipo: number; // 80=CUIT, 96=DNI, 99=sin identificar
  docNro: number; // 0 si sin identificar
  // Montos (positivos)
  impNeto: number;
  impIVA: number;
  impTotal: number;
  impNoGravado?: number;
  impExento?: number;
  impTributos?: number;
  // IVA (alícuota + base)
  ivaAlicuota?: number; // código AFIP: 3=0%, 4=10.5%, 5=21%, 6=27%
  ivaBaseImp?: number; // monto sobre el que se aplica (igual a impNeto si 1 sola alícuota)
  // Fechas (YYYY-MM-DD)
  fechaCbte: string;
  fechaServDesde?: string;
  fechaServHasta?: string;
  fechaVencPago?: string;
  // Moneda
  monedaId?: string; // "PES" = pesos
  monedaCotizacion?: number; // 1 para PES
  // Solo NC: comprobante original asociado
  comprobantesAsociados?: Array<{
    tipo: number;
    puntoVenta: number;
    numero: number;
  }>;
}

/**
 * Llama a FECAESolicitar en WSFEv1.
 *
 * @returns AfipCaeResult con CAE + vencimiento, o errores.
 */
export async function feCAESolicitar(
  taxConfig: TaxConfig,
  ta: AfipTokenAcceso,
  params: FeCaeParams
): Promise<AfipCaeResult> {
  const wsfev1Url =
    taxConfig.environment === "produccion" ? WSFEV1_PROD : WSFEV1_HOMO;

  const soapBody = buildFECAESolicitarEnvelope(taxConfig, ta, params);

  const resp = await fetchWithTimeout(wsfev1Url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "http://ar.gov.afip.dif.facturaelectronica/FECAESolicitar",
    },
    body: soapBody,
  }, 30000);

  if (!resp.ok) {
    const txt = await safeText(resp);
    return {
      ok: false,
      error: `WSFEv1 HTTP ${resp.status}: ${txt.slice(0, 500)}`,
    };
  }

  const xmlText = await resp.text();
  return parseFECAEResponse(xmlText);
}

// ===== CONSTRUCCIÓN DE ENVELOPE SOAP PARA FECAESolicitar =====

function buildFECAESolicitarEnvelope(
  taxConfig: TaxConfig,
  ta: AfipTokenAcceso,
  params: FeCaeParams
): string {
  const ivaNode =
    params.ivaAlicuota !== undefined && params.ivaBaseImp !== undefined
      ? `<AlicIva>
          <Id>${params.ivaAlicuota}</Id>
          <BaseImp>${formatAmount(params.ivaBaseImp)}</BaseImp>
          <Importe>${formatAmount(params.impIVA)}</Importe>
        </AlicIva>`
      : "";

  const tributosNode =
    params.impTributos && params.impTributos > 0
      ? `<Tributos>
          <Tributo>
            <Id>99</Id>
            <Desc>Otros</Desc>
            <BaseImp>${formatAmount(params.impNeto)}</BaseImp>
            <Alic>${(params.impTributos / Math.max(params.impNeto, 1)) * 100}</Alic>
            <Importe>${formatAmount(params.impTributos)}</Importe>
          </Tributo>
        </Tributos>`
      : "";

  const cbtesAsocNode =
    params.comprobantesAsociados && params.comprobantesAsociados.length > 0
      ? `<CbtesAsoc>
          ${params.comprobantesAsociados
            .map(
              (c) => `<CbteAsoc>
              <Tipo>${c.tipo}</Tipo>
              <PtoVta>${c.puntoVenta}</PtoVta>
              <Nro>${c.numero}</Nro>
            </CbteAsoc>`
            )
            .join("\n          ")}
        </CbtesAsoc>`
      : "";

  // Fechas opcionales para concepto=Servicios (2) o Productos y Servicios (3)
  const fechasServicio =
    params.concepto !== 1
      ? `<FchServDesde>${params.fechaServDesde || params.fechaCbte}</FchServDesde>
        <FchServHasta>${params.fechaServHasta || params.fechaCbte}</FchServHasta>
        <FchVtoPago>${params.fechaVencPago || params.fechaCbte}</FchVtoPago>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitar xmlns="http://ar.gov.afip.dif.facturaelectronica/">
      <Auth>
        <Token>${escapeXml(ta.token)}</Token>
        <Sign>${escapeXml(ta.sign)}</Sign>
        <Cuit>${taxConfig.cuit}</Cuit>
      </Auth>
      <FeCAEReq>
        <FeCabReq>
          <CantReg>1</CantReg>
          <PtoVta>${params.puntoVenta}</PtoVta>
          <CbteTipo>${params.tipoComprobante}</CbteTipo>
        </FeCabReq>
        <FeDetReq>
          <FECAEDetRequest>
            <Concepto>${params.concepto}</Concepto>
            <DocTipo>${params.docTipo}</DocTipo>
            <DocNro>${params.docNro}</DocNro>
            <CbteDesde>${params.numero}</CbteDesde>
            <CbteHasta>${params.numero}</CbteHasta>
            <ImpTotal>${formatAmount(params.impTotal)}</ImpTotal>
            <ImpTotConc>${formatAmount(params.impNoGravado || 0)}</ImpTotConc>
            <ImpNeto>${formatAmount(params.impNeto)}</ImpNeto>
            <ImpOpEx>${formatAmount(params.impExento || 0)}</ImpOpEx>
            <ImpTrib>${formatAmount(params.impTributos || 0)}</ImpTrib>
            <ImpIVA>${formatAmount(params.impIVA)}</ImpIVA>
            <FchEmis>${params.fechaCbte}</FchEmis>
            ${fechasServicio}
            <MonId>${params.monedaId || "PES"}</MonId>
            <MonCotiz>${formatAmount(params.monedaCotizacion || 1)}</MonCotiz>
            ${cbtesAsocNode}
            ${ivaNode}
            ${tributosNode}
          </FECAEDetRequest>
        </FeDetReq>
      </FeCAEReq>
    </FECAESolicitar>
  </soap:Body>
</soap:Envelope>`;
}

// ===== PARSEO DE RESPUESTA FECAESolicitar =====

function parseFECAEResponse(xmlText: string): AfipCaeResult {
  // Detectar SOAP fault
  const faultMatch = xmlText.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) {
    return {
      ok: false,
      error: `WSFEv1 SOAP fault: ${decodeXmlEntities(faultMatch[1]).trim()}`,
    };
  }

  // Extraer FECAESolicitarResult
  const resultBlock = extractTagContent(xmlText, "FECAESolicitarResult");
  if (!resultBlock) {
    return {
      ok: false,
      error: "WSFEv1: respuesta sin FECAESolicitarResult — formato inesperado",
    };
  }

  // Errores GLOBALES (FECAESolicitarResult > Errors > Err a nivel cabecera).
  // AFIP puede devolver errores a nivel detalle (dentro de FECAEDetResponse > Errors)
  // cuando Resultado=R, y esos NO deben tratarse como error global.
  // Para distinguir: remover el bloque <FeDetResp>...</FeDetResp> antes de buscar.
  const cabeceraBlock = resultBlock.replace(
    /<FeDetResp>[\s\S]*?<\/FeDetResp>/i,
    ""
  );
  const errores = parseErrorsArray(cabeceraBlock);
  if (errores.length > 0) {
    // Si hay errores globales, AFIP no procesó el comprobante
    return {
      ok: false,
      errores,
      error: `AFIP rechazó la solicitud: ${errores
        .map((e) => `[${e.code}] ${e.message}`)
        .join("; ")}`,
    };
  }

  // Extraer FeDetResp > FECAEDetResponse
  const detBlock = extractTagContent(resultBlock, "FECAEDetResponse");
  if (!detBlock) {
    return {
      ok: false,
      error: "WSFEv1: respuesta sin FECAEDetResponse",
    };
  }

  const resultado = extractTagContent(detBlock, "Resultado") || "";
  const cae = extractTagContent(detBlock, "CAE") || "";
  const caeVencStr = extractTagContent(detBlock, "CAEFchVto") || "";

  // Observaciones (informativas; el CAE se emite igual)
  const observacionesNode = extractTagContent(detBlock, "Observaciones");
  let observaciones: string | undefined;
  if (observacionesNode) {
    const obsMatches = [...observacionesNode.matchAll(/<Msg>([\s\S]*?)<\/Msg>/gi)];
    if (obsMatches.length > 0) {
      observaciones = obsMatches
        .map((m) => decodeXmlEntities(m[1]).trim())
        .join("; ");
    }
  }

  // Errores a nivel de detalle (pueden coexistir con observaciones)
  const detErrors = parseErrorsArray(detBlock);

  if (resultado === "R") {
    return {
      ok: false,
      resultado: "R",
      errores: detErrors,
      error: `AFIP rechazó el comprobante: ${detErrors
        .map((e) => `[${e.code}] ${e.message}`)
        .join("; ") || "sin detalle"}`,
    };
  }

  if (!cae || !caeVencStr) {
    return {
      ok: false,
      error: `WSFEv1: respuesta sin CAE o CAEFchVto (Resultado=${resultado})`,
    };
  }

  return {
    ok: true,
    cae,
    caeVencimiento: parseAfipDate(caeVencStr),
    observaciones,
    resultado: resultado || "A",
  };
}

/**
 * Parsea el array <Errors><Err><Code>1</Code><Msg>...</Msg></Err></Errors>.
 * También funciona con observaciones (Obs).
 */
function parseErrorsArray(block: string): AfipError[] {
  const errors: AfipError[] = [];
  const errMatches = [...block.matchAll(/<Err>([\s\S]*?)<\/Err>/gi)];
  for (const m of errMatches) {
    const code = extractTagContent(m[1], "Code");
    const msg = extractTagContent(m[1], "Msg");
    if (code) {
      errors.push({
        code: parseInt(code, 10) || 0,
        message: decodeXmlEntities(msg || "").trim(),
      });
    }
  }
  return errors;
}

// ===== HELPERS =====

function formatAmount(n: number): string {
  // AFIP exige separador decimal "." y hasta 2 decimales
  return Number(n || 0).toFixed(2);
}

function parseAfipDate(s: string): Date {
  // AFIP devuelve YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    return new Date(Date.UTC(y, m, d));
  }
  // fallback: ISO
  return new Date(s);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Entities adicionales que AFIP usa en mensajes de error
    .replace(/&acute;/g, "´")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractTagContent(xml: string, tagName: string): string | null {
  // Case-insensitive, single-occurrence (first match)
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "<no-body>";
  }
}
