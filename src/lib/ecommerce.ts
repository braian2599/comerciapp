/**
 * Librería de sincronización con plataformas de e-commerce.
 *
 * Plataformas soportadas (con adaptadores):
 * - TiendaNube (Argentina/Latam)
 * - WooCommerce (WordPress)
 * - MercadoLibre
 * - Shopify
 *
 * Operaciones:
 * - OUTBOUND: local -> plataforma (productos, stock, precios)
 * - INBOUND: plataforma -> local (pedidos online -> ventas locales)
 *
 * Cada adaptador expone una interfaz común (EcommerceAdapter).
 */

import { db } from "@/lib/db";
import { logSync } from "./ecommerce-sync-logger";

// ===== TIPOS =====
export type Platform = "TIENDA_NUBE" | "WOOCOMMERCE" | "MERCADOLIBRE" | "SHOPIFY";
export type SyncDirection = "OUTBOUND" | "INBOUND";
export type SyncEntity = "PRODUCT" | "STOCK" | "PRICE" | "ORDER" | "CUSTOMER";
export type SyncAction = "CREATE" | "UPDATE" | "DELETE";
export type SyncStatus = "SUCCESS" | "ERROR" | "PENDING";

export interface EcommerceAdapter {
  platform: Platform;
  // Test de conexión
  testConnection(config: AdapterConfig): Promise<{ ok: boolean; message: string }>;
  // Productos
  pushProduct(config: AdapterConfig, product: LocalProduct): Promise<RemoteResult>;
  updateStock(config: AdapterConfig, externalId: string, stock: number): Promise<RemoteResult>;
  updatePrice(config: AdapterConfig, externalId: string, price: number): Promise<RemoteResult>;
  // Pedidos
  fetchOrders(config: AdapterConfig, since: Date): Promise<RemoteOrder[]>;
  markOrderFulfilled(config: AdapterConfig, externalId: string): Promise<RemoteResult>;
}

export interface AdapterConfig {
  apiUrl?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  accessToken?: string | null;
  storeExternalId?: string | null;
}

export interface LocalProduct {
  id: string;
  name: string;
  description?: string | null;
  barcode?: string | null;
  sku?: string | null;
  salePrice: number;
  costPrice: number;
  stock: number;
  active: boolean;
  ecommerceProductId?: string | null;
}

export interface RemoteResult {
  ok: boolean;
  externalId?: string;
  message?: string;
  data?: any;
}

export interface RemoteOrder {
  externalId: string;
  number: string;
  createdAt: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  total: number;
  currency: string;
  items: Array<{
    externalProductId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  shippingAddress?: string;
  notes?: string;
  status: string;
  paymentStatus: string;
}

// ===== FACTORÍA DE ADAPTADORES =====
export function getAdapter(platform: Platform): EcommerceAdapter {
  switch (platform) {
    case "TIENDA_NUBE":
      return tiendaNubeAdapter;
    case "WOOCOMMERCE":
      return wooCommerceAdapter;
    case "MERCADOLIBRE":
      return mercadoLibreAdapter;
    case "SHOPIFY":
      return shopifyAdapter;
    default:
      throw new Error(`Plataforma no soportada: ${platform}`);
  }
}

// ===== ADAPTADOR TIENDA NUBE =====
// Docs: https://api.tiendanube.com/v1/{store_id}/products
const tiendaNubeAdapter: EcommerceAdapter = {
  platform: "TIENDA_NUBE",

  async testConnection(config) {
    if (!config.accessToken || !config.storeExternalId) {
      return { ok: false, message: "Faltan access token o store ID" };
    }
    try {
      const res = await fetch(`https://api.tiendanube.com/v1/${config.storeExternalId}/store`, {
        headers: {
          Authentication: `bearer ${config.accessToken}`,
          "User-Agent": "ComerciApp (comerciapp@example.com)",
        },
      });
      if (!res.ok) {
        return { ok: false, message: `Error ${res.status}: ${await res.text()}` };
      }
      const data = await res.json();
      return { ok: true, message: `Conectado a ${data.name?.es || data.name}` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async pushProduct(config, product) {
    if (!config.accessToken || !config.storeExternalId) {
      return { ok: false, message: "Configuración incompleta" };
    }
    const body = {
      name: { es: product.name },
      description: { es: product.description || "" },
      sku: product.sku || null,
      barcode: product.barcode || null,
      price: product.salePrice,
      compare_at_price: null,
      weight: 0,
      stock: Math.floor(product.stock),
      stock_management: true,
      categories: [],
      variants: [
        {
          price: product.salePrice,
          stock: Math.floor(product.stock),
          sku: product.sku || null,
          barcode: product.barcode || null,
        },
      ],
      images: [],
    };

    try {
      const isUpdate = !!product.ecommerceProductId;
      const url = isUpdate
        ? `https://api.tiendanube.com/v1/${config.storeExternalId}/products/${product.ecommerceProductId}`
        : `https://api.tiendanube.com/v1/${config.storeExternalId}/products`;
      const res = await fetch(url, {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authentication: `bearer ${config.accessToken}`,
          "User-Agent": "ComerciApp",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { ok: false, message: `Error ${res.status}: ${await res.text()}` };
      }
      const data = await res.json();
      return { ok: true, externalId: String(data.id), data };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async updateStock(config, externalId, stock) {
    if (!config.accessToken || !config.storeExternalId) {
      return { ok: false, message: "Configuración incompleta" };
    }
    try {
      // TiendaNube requiere actualizar variantes
      const prodRes = await fetch(
        `https://api.tiendanube.com/v1/${config.storeExternalId}/products/${externalId}`,
        { headers: { Authentication: `bearer ${config.accessToken}` } }
      );
      if (!prodRes.ok) return { ok: false, message: `Producto no encontrado: ${prodRes.status}` };
      const prod = await prodRes.json();
      const variantId = prod.variants?.[0]?.id;
      if (!variantId) return { ok: false, message: "Sin variante" };

      const res = await fetch(
        `https://api.tiendanube.com/v1/${config.storeExternalId}/products/${externalId}/variants/${variantId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authentication: `bearer ${config.accessToken}`,
          },
          body: JSON.stringify({ stock: Math.floor(stock) }),
        }
      );
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async updatePrice(config, externalId, price) {
    if (!config.accessToken || !config.storeExternalId) {
      return { ok: false, message: "Configuración incompleta" };
    }
    try {
      const prodRes = await fetch(
        `https://api.tiendanube.com/v1/${config.storeExternalId}/products/${externalId}`,
        { headers: { Authentication: `bearer ${config.accessToken}` } }
      );
      if (!prodRes.ok) return { ok: false, message: `Producto no encontrado` };
      const prod = await prodRes.json();
      const variantId = prod.variants?.[0]?.id;
      if (!variantId) return { ok: false, message: "Sin variante" };

      const res = await fetch(
        `https://api.tiendanube.com/v1/${config.storeExternalId}/products/${externalId}/variants/${variantId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authentication: `bearer ${config.accessToken}`,
          },
          body: JSON.stringify({ price }),
        }
      );
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async fetchOrders(config, since) {
    if (!config.accessToken || !config.storeExternalId) {
      return [];
    }
    try {
      const url = new URL(`https://api.tiendanube.com/v1/${config.storeExternalId}/orders`);
      url.searchParams.set("created_at_min", since.toISOString().split("T")[0]);
      url.searchParams.set("per_page", "50");
      const res = await fetch(url.toString(), {
        headers: { Authentication: `bearer ${config.accessToken}` },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as any[];
      return data.map(mapTiendaNubeOrder);
    } catch {
      return [];
    }
  },

  async markOrderFulfilled(config, externalId) {
    if (!config.accessToken || !config.storeExternalId) {
      return { ok: false, message: "Configuración incompleta" };
    }
    try {
      const res = await fetch(
        `https://api.tiendanube.com/v1/${config.storeExternalId}/orders/${externalId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authentication: `bearer ${config.accessToken}`,
          },
          body: JSON.stringify({ shipping_status: "fulfilled" }),
        }
      );
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
};

function mapTiendaNubeOrder(o: any): RemoteOrder {
  return {
    externalId: String(o.id),
    number: o.number || String(o.id),
    createdAt: o.created_at,
    customerName: `${o.customer?.name || ""} ${o.customer?.lastname || ""}`.trim() || "Cliente",
    customerEmail: o.customer?.email,
    customerPhone: o.customer?.phone,
    total: parseFloat(o.total) || 0,
    currency: o.currency || "ARS",
    items: (o.products || []).map((p: any) => ({
      externalProductId: String(p.product_id || p.id),
      name: p.name || "Producto",
      quantity: p.quantity || 1,
      unitPrice: parseFloat(p.price) || 0,
      subtotal: parseFloat(p.price) * (p.quantity || 1),
    })),
    shippingAddress: o.shipping_address?.address
      ? `${o.shipping_address.address}, ${o.shipping_address.city} ${o.shipping_address.zipcode}`
      : undefined,
    notes: o.note,
    status: o.status || "open",
    paymentStatus: o.payment_status || "pending",
  };
}

// ===== ADAPTADOR WOOCOMMERCE =====
// Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
const wooCommerceAdapter: EcommerceAdapter = {
  platform: "WOOCOMMERCE",

  async testConnection(config) {
    if (!config.apiUrl || !config.apiKey || !config.apiSecret) {
      return { ok: false, message: "Faltan URL, consumer key o consumer secret" };
    }
    try {
      const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
      const url = `${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/system_status`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, message: "Conectado a WooCommerce" };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async pushProduct(config, product) {
    if (!config.apiUrl || !config.apiKey || !config.apiSecret) {
      return { ok: false, message: "Configuración incompleta" };
    }
    const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
    const body = {
      name: product.name,
      regular_price: String(product.salePrice),
      description: product.description || "",
      sku: product.sku || "",
      stock_quantity: Math.floor(product.stock),
      manage_stock: true,
      status: product.active ? "publish" : "draft",
    };
    try {
      const isUpdate = !!product.ecommerceProductId;
      const url = isUpdate
        ? `${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${product.ecommerceProductId}`
        : `${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/products`;
      const res = await fetch(url, {
        method: isUpdate ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, message: `Error ${res.status}: ${await res.text()}` };
      const data = await res.json();
      return { ok: true, externalId: String(data.id), data };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async updateStock(config, externalId, stock) {
    if (!config.apiUrl || !config.apiKey || !config.apiSecret) {
      return { ok: false, message: "Configuración incompleta" };
    }
    const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
    try {
      const res = await fetch(
        `${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${externalId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({ stock_quantity: Math.floor(stock) }),
        }
      );
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async updatePrice(config, externalId, price) {
    if (!config.apiUrl || !config.apiKey || !config.apiSecret) {
      return { ok: false, message: "Configuración incompleta" };
    }
    const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
    try {
      const res = await fetch(
        `${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${externalId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({ regular_price: String(price) }),
        }
      );
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async fetchOrders(config, since) {
    if (!config.apiUrl || !config.apiKey || !config.apiSecret) return [];
    const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
    try {
      const url = new URL(`${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders`);
      url.searchParams.set("after", since.toISOString());
      url.searchParams.set("per_page", "50");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as any[];
      return data.map(mapWooOrder);
    } catch {
      return [];
    }
  },

  async markOrderFulfilled(config, externalId) {
    if (!config.apiUrl || !config.apiKey || !config.apiSecret) {
      return { ok: false, message: "Configuración incompleta" };
    }
    const auth = btoa(`${config.apiKey}:${config.apiSecret}`);
    try {
      const res = await fetch(
        `${config.apiUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders/${externalId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({ status: "completed" }),
        }
      );
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
};

function mapWooOrder(o: any): RemoteOrder {
  return {
    externalId: String(o.id),
    number: String(o.number || o.id),
    createdAt: o.date_created,
    customerName: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Cliente",
    customerEmail: o.billing?.email,
    customerPhone: o.billing?.phone,
    total: parseFloat(o.total) || 0,
    currency: o.currency || "ARS",
    items: (o.line_items || []).map((p: any) => ({
      externalProductId: String(p.product_id),
      name: p.name,
      quantity: p.quantity,
      unitPrice: parseFloat(p.price) || 0,
      subtotal: parseFloat(p.total) || 0,
    })),
    shippingAddress: o.shipping?.address_1
      ? `${o.shipping.address_1}, ${o.shipping.city} ${o.shipping.postcode}`
      : undefined,
    notes: o.customer_note,
    status: o.status || "processing",
    paymentStatus: o.payment_method || "pending",
  };
}

// ===== ADAPTADOR MERCADOLIBRE (placeholder) =====
const mercadoLibreAdapter: EcommerceAdapter = {
  platform: "MERCADOLIBRE",
  async testConnection(config) {
    if (!config.accessToken) return { ok: false, message: "Falta access token" };
    return { ok: true, message: "MercadoLibre (modo limitado - solo lectura)" };
  },
  async pushProduct(config, product) {
    return { ok: false, message: "MercadoLibre requiere publicación vía ML Publisher (no soportado aún)" };
  },
  async updateStock(config, externalId, stock) {
    if (!config.accessToken) return { ok: false, message: "Sin token" };
    try {
      const res = await fetch(`https://api.mercadolibre.com/items/${externalId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.accessToken}`,
        },
        body: JSON.stringify({ available_quantity: Math.floor(stock) }),
      });
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
  async updatePrice(config, externalId, price) {
    if (!config.accessToken) return { ok: false, message: "Sin token" };
    try {
      const res = await fetch(`https://api.mercadolibre.com/items/${externalId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.accessToken}`,
        },
        body: JSON.stringify({ price }),
      });
      if (!res.ok) return { ok: false, message: `Error ${res.status}` };
      return { ok: true, externalId };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
  async fetchOrders(config, since) {
    if (!config.accessToken || !config.storeExternalId) return [];
    try {
      const url = new URL(`https://api.mercadolibre.com/orders/search`);
      url.searchParams.set("seller", config.storeExternalId);
      url.searchParams.set("order.date.created.from", since.toISOString().split("T")[0] + "T00:00:00.000-00:00");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map(mapMLOrder);
    } catch {
      return [];
    }
  },
  async markOrderFulfilled(config, externalId) {
    return { ok: false, message: "MercadoLibre requiere envío vía ML Shipments (no implementado)" };
  },
};

function mapMLOrder(o: any): RemoteOrder {
  return {
    externalId: String(o.id),
    number: String(o.id),
    createdAt: o.date_created,
    customerName: o.buyer?.nickname || "Comprador ML",
    customerEmail: undefined,
    customerPhone: undefined,
    total: parseFloat(o.total_amount) || 0,
    currency: o.currency_id || "ARS",
    items: (o.order_items || []).map((p: any) => ({
      externalProductId: String(p.item?.id || ""),
      name: p.item?.title || "Producto",
      quantity: p.quantity || 1,
      unitPrice: parseFloat(p.unit_price) || 0,
      subtotal: parseFloat(p.unit_price) * (p.quantity || 1),
    })),
    shippingAddress: undefined,
    notes: undefined,
    status: o.status || "pending",
    paymentStatus: o.status === "paid" ? "paid" : "pending",
  };
}

// ===== ADAPTADOR SHOPIFY (placeholder) =====
const shopifyAdapter: EcommerceAdapter = {
  platform: "SHOPIFY",
  async testConnection(config) {
    if (!config.apiUrl || !config.apiKey) return { ok: false, message: "Faltan datos" };
    return { ok: true, message: "Shopify (modo limitado)" };
  },
  async pushProduct(config, product) {
    return { ok: false, message: "Shopify requiere Admin API (no implementado)" };
  },
  async updateStock() { return { ok: false, message: "No implementado" }; },
  async updatePrice() { return { ok: false, message: "No implementado" }; },
  async fetchOrders() { return []; },
  async markOrderFulfilled() { return { ok: false, message: "No implementado" }; },
};

// ===== SINCRONIZACIÓN OUTBOUND =====
export interface SyncResult {
  total: number;
  success: number;
  error: number;
  logs: Array<{ entity: string; entityId?: string; externalId?: string; status: SyncStatus; message?: string }>;
}

export async function syncProductsOutbound(
  storeId: string,
  opts: { onlyDirty?: boolean; limit?: number } = {}
): Promise<SyncResult> {
  const config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config || !config.enabled) {
    return { total: 0, success: 0, error: 0, logs: [{ entity: "PRODUCT", status: "ERROR", message: "E-commerce no configurado" }] };
  }
  const adapter = getAdapter(config.platform as Platform);
  const adapterCfg: AdapterConfig = {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    accessToken: config.accessToken,
    storeExternalId: config.storeExternalId,
  };

  const where: any = { storeId, active: true };
  if (opts.onlyDirty) {
    where.OR = [
      { ecommerceProductId: null },
      { ecommerceSyncedAt: null },
      { ecommerceStatus: { not: "ACTIVE" } },
    ];
  }
  const products = await db.product.findMany({
    where,
    take: opts.limit || 50,
  });

  const result: SyncResult = { total: products.length, success: 0, error: 0, logs: [] };
  for (const p of products) {
    const localProduct: LocalProduct = {
      id: p.id,
      name: p.name,
      description: p.description,
      barcode: p.barcode,
      sku: p.sku,
      salePrice: p.salePrice,
      costPrice: p.costPrice,
      stock: p.stock,
      active: p.active,
      ecommerceProductId: p.ecommerceProductId,
    };
    const r = await adapter.pushProduct(adapterCfg, localProduct);
    if (r.ok && r.externalId) {
      await db.product.update({
        where: { id: p.id },
        data: {
          ecommerceProductId: r.externalId,
          ecommerceSyncedAt: new Date(),
          ecommerceStatus: "ACTIVE",
        },
      });
      result.success++;
      result.logs.push({ entity: "PRODUCT", entityId: p.id, externalId: r.externalId, status: "SUCCESS" });
      await logSync(storeId, config.id, "OUTBOUND", "PRODUCT", p.id, r.externalId, "UPDATE", "SUCCESS", undefined);
    } else {
      result.error++;
      result.logs.push({ entity: "PRODUCT", entityId: p.id, status: "ERROR", message: r.message });
      await logSync(storeId, config.id, "OUTBOUND", "PRODUCT", p.id, undefined, "UPDATE", "ERROR", r.message);
    }
  }

  await db.ecommerceConfig.update({
    where: { storeId },
    data: { lastSyncAt: new Date() },
  });

  return result;
}

export async function syncStockOutbound(
  storeId: string,
  productIds?: string[]
): Promise<SyncResult> {
  const config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config || !config.enabled || !config.syncStock) {
    return { total: 0, success: 0, error: 0, logs: [] };
  }
  const adapter = getAdapter(config.platform as Platform);
  const adapterCfg: AdapterConfig = {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    accessToken: config.accessToken,
    storeExternalId: config.storeExternalId,
  };

  const where: any = { storeId, ecommerceProductId: { not: null } };
  if (productIds) where.id = { in: productIds };
  const products = await db.product.findMany({ where });

  const result: SyncResult = { total: products.length, success: 0, error: 0, logs: [] };
  for (const p of products) {
    const r = await adapter.updateStock(adapterCfg, p.ecommerceProductId!, p.stock);
    if (r.ok) {
      result.success++;
      result.logs.push({ entity: "STOCK", entityId: p.id, externalId: p.ecommerceProductId || undefined, status: "SUCCESS" });
      await logSync(storeId, config.id, "OUTBOUND", "STOCK", p.id, p.ecommerceProductId || undefined, "UPDATE", "SUCCESS", undefined);
    } else {
      result.error++;
      result.logs.push({ entity: "STOCK", entityId: p.id, status: "ERROR", message: r.message });
      await logSync(storeId, config.id, "OUTBOUND", "STOCK", p.id, p.ecommerceProductId || undefined, "UPDATE", "ERROR", r.message);
    }
  }
  return result;
}

// ===== SINCRONIZACIÓN INBOUND (PEDIDOS) =====
export async function syncOrdersInbound(storeId: string): Promise<SyncResult> {
  const config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config || !config.enabled || !config.syncOrders) {
    return { total: 0, success: 0, error: 0, logs: [] };
  }
  const adapter = getAdapter(config.platform as Platform);
  const adapterCfg: AdapterConfig = {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    accessToken: config.accessToken,
    storeExternalId: config.storeExternalId,
  };

  const since = config.lastSyncAt || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const orders = await adapter.fetchOrders(adapterCfg, since);

  const result: SyncResult = { total: orders.length, success: 0, error: 0, logs: [] };
  for (const o of orders) {
    try {
      // Solo procesar pagados
      if (o.paymentStatus !== "paid" && o.paymentStatus !== "approved") {
        result.logs.push({ entity: "ORDER", externalId: o.externalId, status: "SUCCESS", message: "Skip: no pagado" });
        continue;
      }

      // Mapear items a productos locales (por externalProductId)
      const items: Array<{
        product: { id: string; name: string; costPrice: number; salePrice: number };
        quantity: number;
        unitPrice: number;
        subtotal: number;
      }> = [];
      for (const it of o.items) {
        const localProduct = await db.product.findFirst({
          where: { storeId, ecommerceProductId: it.externalProductId },
        });
        if (!localProduct) {
          // Si no existe, crear un producto placeholder
          const newProd = await db.product.create({
            data: {
              storeId,
              name: it.name,
              salePrice: it.unitPrice,
              costPrice: 0,
              stock: 0,
              active: true,
              ecommerceProductId: it.externalProductId,
              ecommerceSyncedAt: new Date(),
              ecommerceStatus: "ACTIVE",
            },
          });
          items.push({ product: newProd, quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.subtotal });
        } else {
          items.push({
            product: { id: localProduct.id, name: localProduct.name, costPrice: localProduct.costPrice, salePrice: localProduct.salePrice },
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
          });
        }
      }

      // Buscar o crear cliente
      let customer: { id: string; name: string } | null = null;
      if (o.customerEmail) {
        const existing = await db.customer.findFirst({
          where: { storeId, email: o.customerEmail },
        });
        if (existing) {
          customer = { id: existing.id, name: existing.name };
        } else {
          const created = await db.customer.create({
            data: {
              storeId,
              name: o.customerName,
              email: o.customerEmail,
              phone: o.customerPhone,
              address: o.shippingAddress,
              notes: `Cliente importado de e-commerce (pedido ${o.number})`,
            },
          });
          customer = { id: created.id, name: created.name };
        }
      }

      // Buscar usuario admin para asociar la venta
      const adminUser = await db.user.findFirst({
        where: { storeId, role: "ADMIN" },
      });
      if (!adminUser) {
        result.error++;
        result.logs.push({ entity: "ORDER", externalId: o.externalId, status: "ERROR", message: "Sin admin user" });
        continue;
      }

      // Verificar si ya fue importada (por notes con número de pedido)
      const existingSale = await db.sale.findFirst({
        where: { storeId, notes: { contains: `[ECOM-${o.number}]` } },
      });
      if (existingSale) {
        result.logs.push({ entity: "ORDER", externalId: o.externalId, status: "SUCCESS", message: "Ya importado" });
        continue;
      }

      const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
      const sale = await db.sale.create({
        data: {
          storeId,
          userId: adminUser.id,
          customerId: customer?.id,
          subtotal,
          discount: 0,
          tax: 0,
          surcharge: 0,
          total: o.total,
          paymentMethod: "ECOMMERCE",
          amountPaid: o.total,
          status: "COMPLETADA",
          notes: `[ECOM-${o.number}] ${o.notes || ""}`.trim(),
          items: {
            create: items.map((i) => ({
              productId: i.product.id,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              costPrice: i.product.costPrice,
              subtotal: i.subtotal,
            })),
          },
        },
      });

      // Descontar stock
      for (const i of items) {
        await db.product.update({
          where: { id: i.product.id },
          data: { stock: { decrement: i.quantity } },
        });
        await db.stockMovement.create({
          data: {
            productId: i.product.id,
            storeId,
            userId: adminUser.id,
            type: "VENTA",
            quantity: -i.quantity,
            reason: "Pedido e-commerce",
            refType: "Sale",
            refId: sale.id,
          },
        });
      }

      // Marcar como enviado si autoFulfill
      if (config.autoFulfill) {
        await adapter.markOrderFulfilled(adapterCfg, o.externalId);
      }

      result.success++;
      result.logs.push({ entity: "ORDER", externalId: o.externalId, entityId: sale.id, status: "SUCCESS" });
      await logSync(storeId, config.id, "INBOUND", "ORDER", sale.id, o.externalId, "CREATE", "SUCCESS", undefined);
    } catch (e: any) {
      result.error++;
      result.logs.push({ entity: "ORDER", externalId: o.externalId, status: "ERROR", message: e.message });
      await logSync(storeId, config.id, "INBOUND", "ORDER", undefined, o.externalId, "CREATE", "ERROR", e.message);
    }
  }

  await db.ecommerceConfig.update({
    where: { storeId },
    data: { lastSyncAt: new Date() },
  });

  return result;
}

// ===== WEBHOOK HANDLER (INBOUND) =====
export async function handleEcommerceWebhook(
  storeId: string,
  event: string,
  payload: any
): Promise<{ ok: boolean; message?: string }> {
  const config = await db.ecommerceConfig.findUnique({ where: { storeId } });
  if (!config || !config.enabled) {
    return { ok: false, message: "E-commerce no configurado" };
  }

  // Eventos comunes: order/created, order/paid, product/updated
  if (event.includes("order") && (event.includes("paid") || event.includes("created"))) {
    // Forzar sincronización de pedidos
    await syncOrdersInbound(storeId);
    return { ok: true };
  }
  if (event.includes("product") && event.includes("updated")) {
    // Producto actualizado en la plataforma: marcar como dirty para re-sync
    const externalId = payload?.id ? String(payload.id) : null;
    if (externalId) {
      await db.product.updateMany({
        where: { storeId, ecommerceProductId: externalId },
        data: { ecommerceSyncedAt: null },
      });
    }
    return { ok: true };
  }
  return { ok: true, message: "Evento ignorado" };
}
