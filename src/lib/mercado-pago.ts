/**
 * Mercado Pago - Integración con QR de pago
 *
 * Implementación de cobros con QR usando Mercado Pago.
 *
 * Para uso real se necesita:
 *   1. Cuenta de Mercado Pago
 *   2. Crear aplicación en https://www.mercadopago.com.ar/developers/
 *   3. Obtener Access Token y Public Key
 *
 * Endpoints usados:
 *   - POST /checkout/preferences: crea preferencia de pago (con QR)
 *   - GET /v1/payments/{id}: consulta estado de pago
 *   - POST /mp/qr/transactions/{collector_id}: crea orden QR inmediata
 *
 * Documentación: https://www.mercadopago.com.ar/developers/es/docs
 */

import { db } from "@/lib/db";
import { MercadoPagoConfig } from "@prisma/client";

// ===== CONSTANTES =====
const MP_API_BASE = "https://api.mercadopago.com";

// ===== TIPOS =====
export interface CrearOrdenQRParams {
  storeId: string;
  saleId?: string;
  amount: number;
  description: string;
  externalReference?: string;
  payerEmail?: string;
}

export interface CrearOrdenQRResult {
  ok: boolean;
  qrCode?: string;
  qrImageUrl?: string;
  preferenceId?: string;
  paymentId?: string;
  rawResponse?: any;
  error?: string;
}

export interface EstadoPagoMP {
  ok: boolean;
  status?: string;
  statusDetail?: string;
  paymentMethod?: string;
  rawResponse?: any;
  error?: string;
}

// ===== HELPERS =====
function getAccessToken(config: MercadoPagoConfig): string | null {
  if (config.environment === "sandbox") {
    return config.sandboxAccessToken || config.accessToken;
  }
  return config.accessToken || config.sandboxAccessToken;
}

/**
 * Crea una orden de pago con QR en Mercado Pago.
 * Usa el endpoint /checkout/preferences para crear una preferencia,
 * luego genera el QR correspondiente.
 */
export async function crearOrdenQR(
  params: CrearOrdenQRParams
): Promise<CrearOrdenQRResult> {
  try {
    const config = await db.mercadoPagoConfig.findUnique({
      where: { storeId: params.storeId },
    });

    if (!config || !config.active) {
      return {
        ok: false,
        error: "Mercado Pago no está configurado. Configure las credenciales en Configuración.",
      };
    }

    const accessToken = getAccessToken(config);
    if (!accessToken) {
      return {
        ok: false,
        error: "Falta Access Token de Mercado Pago en la configuración.",
      };
    }

    // Crear preferencia de pago
    const preferenceBody = {
      items: [
        {
          id: params.externalReference || params.saleId || `sale-${Date.now()}`,
          title: params.description,
          description: params.description,
          quantity: 1,
          currency_id: "ARS",
          unit_price: Number(params.amount.toFixed(2)),
        },
      ],
      payer: params.payerEmail
        ? { email: params.payerEmail }
        : undefined,
      external_reference: params.externalReference || params.saleId,
      payment_methods: {
        // Aceptamos todos los métodos excepto los que no queremos
        exclusions: [],
      },
      statement_descriptor: config.defaultDescription || "Comercio",
      // Para QR usamos el modo "inmediata" (no marketplace)
      binary_mode: false,
      // Solo QR (no checkout pro)
      operation_type: "regular_payment",
    };

    const prefResponse = await fetch(`${MP_API_BASE}/checkout/preferences`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(preferenceBody),
    });

    if (!prefResponse.ok) {
      const errText = await prefResponse.text();
      return {
        ok: false,
        error: `Error MP (${prefResponse.status}): ${errText}`,
      };
    }

    const prefData = await prefResponse.json();

    // Generar QR code (copia y pega + imagen)
    // Mercado Pago provee init_point que es la URL de pago
    // El QR se genera a partir de esa URL
    const qrCode = prefData.init_point || prefData.sandbox_init_point;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;

    // Registrar el pago en BD (pendiente hasta webhook)
    const mpPayment = await db.mercadoPagoPayment.create({
      data: {
        storeId: params.storeId,
        saleId: params.saleId || null,
        configId: config.id,
        mpPreferenceId: prefData.id,
        qrCode,
        qrImageUrl,
        amount: params.amount,
        status: "PENDIENTE",
        payerEmail: params.payerEmail,
        rawResponse: JSON.stringify(prefData),
      },
    });

    return {
      ok: true,
      qrCode,
      qrImageUrl,
      preferenceId: prefData.id,
      paymentId: mpPayment.id,
      rawResponse: prefData,
    };
  } catch (err: any) {
    console.error("Error creando orden QR MP:", err);
    return { ok: false, error: err.message || "Error interno" };
  }
}

/**
 * Consulta el estado de un pago en Mercado Pago.
 * Útil para polling cuando no se recibió el webhook.
 */
export async function consultarEstadoPago(
  storeId: string,
  mpPaymentId: string
): Promise<EstadoPagoMP> {
  try {
    const config = await db.mercadoPagoConfig.findUnique({
      where: { storeId },
    });
    if (!config) return { ok: false, error: "MP no configurado" };

    const accessToken = getAccessToken(config);
    if (!accessToken) return { ok: false, error: "Sin access token" };

    // Buscar el registro local
    const localPayment = await db.mercadoPagoPayment.findFirst({
      where: { id: mpPaymentId, storeId },
    });
    if (!localPayment) return { ok: false, error: "Pago local no encontrado" };

    // Si no tenemos el payment_id de MP, no podemos consultar
    if (!localPayment.mpPaymentId) {
      // Buscar por external_reference
      const searchUrl = `${MP_API_BASE}/v1/payments/search?external_reference=${localPayment.mpPreferenceId}`;
      const searchResp = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!searchResp.ok) {
        return {
          ok: true,
          status: localPayment.status,
          rawResponse: localPayment.rawResponse ? JSON.parse(localPayment.rawResponse) : null,
        };
      }
      const searchData = await searchResp.json();
      const elements = searchData.results || [];
      if (elements.length === 0) {
        return {
          ok: true,
          status: localPayment.status,
          rawResponse: localPayment.rawResponse ? JSON.parse(localPayment.rawResponse) : null,
        };
      }
      const latest = elements[0];
      await actualizarPagoDesdeWebhook(localPayment.id, latest);

      return {
        ok: true,
        status: latest.status?.toUpperCase() || localPayment.status,
        statusDetail: latest.status_detail,
        paymentMethod: latest.payment_method_id,
        rawResponse: latest,
      };
    }

    // Consultar pago por ID
    const resp = await fetch(`${MP_API_BASE}/v1/payments/${localPayment.mpPaymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      return {
        ok: true,
        status: localPayment.status,
        rawResponse: localPayment.rawResponse ? JSON.parse(localPayment.rawResponse) : null,
      };
    }

    const paymentData = await resp.json();
    await actualizarPagoDesdeWebhook(localPayment.id, paymentData);

    return {
      ok: true,
      status: paymentData.status?.toUpperCase() || localPayment.status,
      statusDetail: paymentData.status_detail,
      paymentMethod: paymentData.payment_method_id,
      rawResponse: paymentData,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Actualiza un pago MP desde los datos de webhook o consulta.
 * Si el pago fue aprobado, marca la venta como cobrada.
 */
export async function actualizarPagoDesdeWebhook(
  mpPaymentLocalId: string,
  paymentData: any
): Promise<void> {
  const status = (paymentData.status || "").toUpperCase();
  const mpPaymentId = String(paymentData.id || "");
  const statusDetail = paymentData.status_detail || "";
  const paymentMethod = paymentData.payment_method_id || "";

  const updateData: any = {
    status,
    statusDetail,
    paymentMethod,
    mpPaymentId,
    rawResponse: JSON.stringify(paymentData),
    updatedAt: new Date(),
  };
  if (status === "APPROVED") {
    updateData.approvedAt = new Date();
  }

  await db.mercadoPagoPayment.update({
    where: { id: mpPaymentLocalId },
    data: updateData,
  });

  // Si fue aprobado y hay venta asociada, marcar venta como cobrada
  if (status === "APPROVED") {
    const mpPayment = await db.mercadoPagoPayment.findUnique({
      where: { id: mpPaymentLocalId },
    });
    if (mpPayment?.saleId) {
      await db.sale.update({
        where: { id: mpPayment.saleId },
        data: {
          mercadoPagoPayment: { connect: { id: mpPayment.id } },
          amountPaid: mpPayment.amount,
          status: "COMPLETADA",
        },
      });
    }
  }
}

/**
 * Procesa webhook de Mercado Pago.
 * MP envía: { type: "payment", data: { id: "123456" } }
 */
export async function procesarWebhookMP(
  storeId: string,
  body: any
): Promise<{ ok: boolean }> {
  try {
    if (body.type !== "payment" || !body.data?.id) {
      // Ignorar otros tipos (plan, subscription, etc.)
      return { ok: true };
    }

    const mpPaymentId = String(body.data.id);
    const config = await db.mercadoPagoConfig.findUnique({
      where: { storeId },
    });
    if (!config) return { ok: false };

    const accessToken = getAccessToken(config);
    if (!accessToken) return { ok: false };

    // Consultar el pago a MP
    const resp = await fetch(`${MP_API_BASE}/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return { ok: false };

    const paymentData = await resp.json();

    // Buscar el pago local por preferenceId o external_reference
    const preferenceId = paymentData.preference_id;
    const externalRef = paymentData.external_reference;

    const localPayment = await db.mercadoPagoPayment.findFirst({
      where: {
        storeId,
        OR: [
          { mpPaymentId },
          { mpPreferenceId: preferenceId },
        ],
      },
    });

    if (!localPayment) {
      // Podría ser un pago no creado por nosotros
      return { ok: true };
    }

    await actualizarPagoDesdeWebhook(localPayment.id, paymentData);
    return { ok: true };
  } catch (err) {
    console.error("Error procesando webhook MP:", err);
    return { ok: false };
  }
}
