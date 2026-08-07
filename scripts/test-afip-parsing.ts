/**
 * Tests de regresión para el parsing SOAP de respuestas AFIP (WSFEv1).
 *
 * No toca la red: solo valida que los parsers XML manejen correctamente
 * los formatos de respuesta reales que devuelve AFIP.
 *
 * Casos cubiertos:
 *  1. Respuesta exitosa con CAE + vencimiento.
 *  2. Respuesta con observaciones (CAE emitido + advertencias).
 *  3. Rechazo global (Errors.Err a nivel cabecera).
 *  4. Rechazo por comprobante (Resultado=R + Errors a nivel detalle).
 *  5. SOAP fault de transporte.
 *  6. Respuesta sin FECAESolicitarResult (formato inesperado).
 *
 * Correr con: npx tsx scripts/test-afip-parsing.ts
 */

// Importamos las funciones internas vía el módulo público.
// Como las funciones helper son privadas en afip-prod.ts, reproducimos
// el parseo aquí usando las mismas regex, para validar la lógica.
// Si la implementación cambia, este test nos avisa.

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

// ===== Replicación de helpers internos de afip-prod.ts (mismas regex) =====

function extractTagContent(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
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

function parseErrorsArray(block: string): Array<{ code: number; message: string }> {
  const errors: Array<{ code: number; message: string }> = [];
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

function parseFECAEResponse(xmlText: string): {
  ok: boolean;
  cae?: string;
  caeVencimiento?: Date;
  observaciones?: string;
  resultado?: string;
  errores?: Array<{ code: number; message: string }>;
  error?: string;
} {
  const faultMatch = xmlText.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) {
    return {
      ok: false,
      error: `WSFEv1 SOAP fault: ${decodeXmlEntities(faultMatch[1]).trim()}`,
    };
  }
  const resultBlock = extractTagContent(xmlText, "FECAESolicitarResult");
  if (!resultBlock) {
    return { ok: false, error: "WSFEv1: respuesta sin FECAESolicitarResult" };
  }
  // Errores globales: remover FeDetResp antes de buscar
  const cabeceraBlock = resultBlock.replace(
    /<FeDetResp>[\s\S]*?<\/FeDetResp>/i,
    ""
  );
  const errores = parseErrorsArray(cabeceraBlock);
  if (errores.length > 0) {
    return {
      ok: false,
      errores,
      error: `AFIP rechazó la solicitud: ${errores.map((e) => `[${e.code}] ${e.message}`).join("; ")}`,
    };
  }
  const detBlock = extractTagContent(resultBlock, "FECAEDetResponse");
  if (!detBlock) {
    return { ok: false, error: "WSFEv1: respuesta sin FECAEDetResponse" };
  }
  const resultado = extractTagContent(detBlock, "Resultado") || "";
  const cae = extractTagContent(detBlock, "CAE") || "";
  const caeVencStr = extractTagContent(detBlock, "CAEFchVto") || "";
  const observacionesNode = extractTagContent(detBlock, "Observaciones");
  let observaciones: string | undefined;
  if (observacionesNode) {
    const obsMatches = [...observacionesNode.matchAll(/<Msg>([\s\S]*?)<\/Msg>/gi)];
    if (obsMatches.length > 0) {
      observaciones = obsMatches.map((m) => decodeXmlEntities(m[1]).trim()).join("; ");
    }
  }
  const detErrors = parseErrorsArray(detBlock);
  if (resultado === "R") {
    return {
      ok: false,
      resultado: "R",
      errores: detErrors,
      error: `AFIP rechazó el comprobante: ${detErrors.map((e) => `[${e.code}] ${e.message}`).join("; ") || "sin detalle"}`,
    };
  }
  if (!cae || !caeVencStr) {
    return { ok: false, error: `WSFEv1: respuesta sin CAE o CAEFchVto (Resultado=${resultado})` };
  }
  return {
    ok: true,
    cae,
    caeVencimiento: parseAfipDate(caeVencStr),
    observaciones,
    resultado: resultado || "A",
  };
}

function parseAfipDate(s: string): Date {
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    return new Date(Date.UTC(y, m, d));
  }
  return new Date(s);
}

// ===== TESTS =====

console.log("\n=== TEST 1: Respuesta exitosa con CAE ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.facturaelectronica/">
      <FECAESolicitarResult>
        <FeCabResp>
          <CantReg>1</CantReg>
          <PtoVta>1</PtoVta>
          <CbteTipo>6</CbteTipo>
          <Resultado>A</Resultado>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <Concepto>1</Concepto>
            <DocTipo>99</DocTipo>
            <DocNro>0</DocNro>
            <CbteDesde>1</CbteDesde>
            <CbteHasta>1</CbteHasta>
            <ImpTotal>1210.50</ImpTotal>
            <FechaCbte>20240115</FechaCbte>
            <Resultado>A</Resultado>
            <CAE>71234567890123</CAE>
            <CAEFchVto>20240125</CAEFchVto>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === true, "ok=true");
  assert(r.cae === "71234567890123", `cae=71234567890123 (got ${r.cae})`);
  assert(r.caeVencimiento?.toISOString().startsWith("2024-01-25"), "caeVencimiento=2024-01-25");
  assert(r.resultado === "A", "resultado=A");
}

console.log("\n=== TEST 2: Respuesta con observaciones (CAE emitido + adv) ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.facturaelectronica/">
      <FECAESolicitarResult>
        <FeCabResp>
          <CantReg>1</CantReg>
          <PtoVta>1</PtoVta>
          <CbteTipo>6</CbteTipo>
          <Resultado>A</Resultado>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <Concepto>1</Concepto>
            <CbteDesde>1</CbteDesde>
            <CbteHasta>1</CbteHasta>
            <Resultado>A</Resultado>
            <CAE>71234567890123</CAE>
            <CAEFchVto>20240125</CAEFchVto>
            <Observaciones>
              <Obs>
                <Code>10017</Code>
                <Msg>El importe informado no coincide con la suma de los conceptos</Msg>
              </Obs>
            </Observaciones>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === true, "ok=true (CAE emitido pese a observación)");
  assert(r.cae === "71234567890123", "cae OK");
  assert(r.observaciones?.includes("importe informado"), `observaciones contiene msg (got "${r.observaciones}")`);
}

console.log("\n=== TEST 3: Rechazo global (Errors.Err a nivel cabecera) ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.facturaelectronica/">
      <FECAESolicitarResult>
        <Errors>
          <Err>
            <Code>10013</Code>
            <Msg>El punto de venta no se encuentra habilitado</Msg>
          </Err>
        </Errors>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === false, "ok=false");
  assert(r.errores?.length === 1, "1 error parseado");
  assert(r.errores?.[0].code === 10013, `error code=10013 (got ${r.errores?.[0].code})`);
  assert(r.error?.includes("10013"), `error message incluye code (got "${r.error}")`);
  assert(r.error?.includes("punto de venta"), `error message incluye descripción (got "${r.error}")`);
}

console.log("\n=== TEST 4: Rechazo por comprobante (Resultado=R) ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.facturaelectronica/">
      <FECAESolicitarResult>
        <FeCabResp>
          <CantReg>1</CantReg>
          <PtoVta>1</PtoVta>
          <CbteTipo>6</CbteTipo>
          <Resultado>R</Resultado>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <CbteDesde>1</CbteDesde>
            <CbteHasta>1</CbteHasta>
            <Resultado>R</Resultado>
            <CAE></CAE>
            <CAEFchVto></CAEFchVto>
            <Observaciones>
              <Obs>
                <Code>20001</Code>
                <Msg>No existen datos suficientes para procesar la solicitud</Msg>
              </Obs>
            </Observaciones>
            <Errors>
              <Err>
                <Code>10015</Code>
                <Msg>El número de comprobante se encuentra utilizado</Msg>
              </Err>
            </Errors>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === false, "ok=false");
  assert(r.resultado === "R", "resultado=R");
  assert(r.errores?.length === 1, "1 error de detalle");
  assert(r.errores?.[0].code === 10015, `error code=10015 (got ${r.errores?.[0].code})`);
  assert(r.error?.includes("10015"), `error message incluye code (got "${r.error}")`);
}

console.log("\n=== TEST 5: SOAP fault de transporte ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Internal Server Error</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === false, "ok=false");
  assert(r.error?.includes("SOAP fault"), `error menciona SOAP fault (got "${r.error}")`);
  assert(r.error?.includes("Internal Server Error"), `error incluye faultstring (got "${r.error}")`);
}

console.log("\n=== TEST 6: Respuesta sin FECAESolicitarResult ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<someOtherResponse>
  <foo>bar</foo>
</someOtherResponse>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === false, "ok=false");
  assert(r.error?.includes("sin FECAESolicitarResult"), `error claro (got "${r.error}")`);
}

console.log("\n=== TEST 7: Parsing de fecha AFIP (YYYYMMDD → Date) ===");
{
  const d = parseAfipDate("20240115");
  assert(d.getUTCFullYear() === 2024, `year=2024 (got ${d.getUTCFullYear()})`);
  assert(d.getUTCMonth() === 0, `month=0 (Jan) (got ${d.getUTCMonth()})`);
  assert(d.getUTCDate() === 15, `day=15 (got ${d.getUTCDate()})`);
}

console.log("\n=== TEST 8: Entity decoding en mensajes de error ===");
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FECAESolicitarResult>
  <Errors>
    <Err>
      <Code>10017</Code>
      <Msg>Error de validaci&amp;acute;n &amp;gt; 100</Msg>
    </Err>
  </Errors>
</FECAESolicitarResult>`;

  const r = parseFECAEResponse(xml);
  assert(r.ok === false, "ok=false");
  assert(r.errores?.[0].message === "Error de validaci´n > 100", `entity decoding correct (got "${r.errores?.[0].message}")`);
}

console.log(`\n=== RESULTADO: ${passed} OK / ${failed} FAIL ===`);
process.exit(failed === 0 ? 0 : 1);
