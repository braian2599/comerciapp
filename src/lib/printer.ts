/**
 * Librería de impresión térmica con comandos ESC/POS.
 *
 * Soporta:
 * - Tickets de venta (con o sin factura)
 * - Comandas de cocina / barra
 * - Cierre Z (resumen de caja)
 * - Etiquetas de precio
 *
 * Genera comandos ESC/POS como ArrayBuffer para enviar vía:
 * - WebUSB / WebBluetooth (browser API)
 * - WebSocket a un servidor de impresión local
 * - Descarga de archivo .bin para impresión manual
 *
 * Para ser usado tanto en el servidor (Node) como en el navegador (con polyfill de Buffer).
 */

// ===== CONSTANTES ESC/POS =====
export const ESC = 0x1b;
export const GS = 0x1d;

// Comandos comunes
export const Commands = {
  INIT: new Uint8Array([ESC, 0x40]), // ESC @ — inicializar
  FEED: (n: number) => new Uint8Array([ESC, 0x64, n]), // ESC d n — alimentar n líneas
  FEED_LINES: (n: number) => new Uint8Array([ESC, 0x64, n]),
  CUT: new Uint8Array([GS, 0x56, 0x00]), // GS V 0 — corte completo
  CUT_PARTIAL: new Uint8Array([GS, 0x56, 0x01]), // GS V 1 — corte parcial
  ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0x00]), // ESC a 0
  ALIGN_CENTER: new Uint8Array([ESC, 0x61, 0x01]), // ESC a 1
  ALIGN_RIGHT: new Uint8Array([ESC, 0x61, 0x02]), // ESC a 2
  BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]), // ESC E 1
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]), // ESC E 0
  DOUBLE_ON: new Uint8Array([GS, 0x21, 0x11]), // GS ! 0x11 (doble alto+ancho)
  DOUBLE_OFF: new Uint8Array([GS, 0x21, 0x00]),
  UNDERLINE_ON: new Uint8Array([ESC, 0x2d, 0x01]),
  UNDERLINE_OFF: new Uint8Array([ESC, 0x2d, 0x00]),
  BEEP: new Uint8Array([ESC, 0x42, 0x02]), // beep 2 veces
  OPEN_DRAWER: new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xfa]), // abrir cajón
} as const;

// ===== TIPOS =====
export interface TicketItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  unit?: string;
}

export interface TicketData {
  store: {
    name: string;
    address?: string | null;
    phone?: string | null;
    cuit?: string | null;
    rubro?: string;
  };
  sale: {
    id: string;
    number?: string; // número legible
    createdAt: Date | string;
    items: TicketItem[];
    subtotal: number;
    discount: number;
    discountReason?: string | null;
    tax: number;
    surcharge: number;
    total: number;
    paymentMethod: string;
    onCredit?: boolean;
    amountPaid?: number;
    customerName?: string | null;
    sellerName?: string | null;
    branchName?: string | null;
    loyaltyPointsEarned?: number;
    loyaltyPointsUsed?: number;
  };
  invoice?: {
    type: string; // A, B, C
    number: string;
    cae: string;
    caeExpiration?: string;
    qrCode?: string; // base64 del QR AFIP
  } | null;
  template?: PrintTemplateConfig;
}

export interface PrintTemplateConfig {
  paperWidth: 58 | 80;
  charset: "CP437" | "CP850" | "UTF8";
  cutPaper: boolean;
  headerLines?: string | null;
  footerLines?: string | null;
  showLogo: boolean;
  showCustomer: boolean;
  showSeller: boolean;
  showPayment: boolean;
}

// ===== BUILDER DE BUFFER =====
export class EscPosBuilder {
  private chunks: Uint8Array[] = [];

  constructor(private paperWidth: 58 | 80 = 58) {}

  private push(arr: Uint8Array): this {
    this.chunks.push(arr);
    return this;
  }

  text(str: string): this {
    // Convertir string a bytes (UTF-8 por defecto, ESC/POS soporta Latin1/CP437)
    const bytes = stringToBytes(str);
    this.push(bytes);
    return this;
  }

  line(str: string = ""): this {
    return this.text(str + "\n");
  }

  feed(n: number = 1): this {
    return this.push(Commands.FEED(n));
  }

  cut(): this {
    this.feed(3);
    return this.push(Commands.CUT);
  }

  cutPartial(): this {
    this.feed(3);
    return this.push(Commands.CUT_PARTIAL);
  }

  alignLeft(): this { return this.push(Commands.ALIGN_LEFT); }
  alignCenter(): this { return this.push(Commands.ALIGN_CENTER); }
  alignRight(): this { return this.push(Commands.ALIGN_RIGHT); }
  boldOn(): this { return this.push(Commands.BOLD_ON); }
  boldOff(): this { return this.push(Commands.BOLD_OFF); }
  doubleOn(): this { return this.push(Commands.DOUBLE_ON); }
  doubleOff(): this { return this.push(Commands.DOUBLE_OFF); }
  underlineOn(): this { return this.push(Commands.UNDERLINE_ON); }
  underlineOff(): this { return this.push(Commands.UNDERLINE_OFF); }
  beep(): this { return this.push(Commands.BEEP); }
  openDrawer(): this { return this.push(Commands.OPEN_DRAWER); }

  init(): this { return this.push(Commands.INIT); }

  /** Línea separadora con guiones */
  separator(char: string = "-"): this {
    const count = this.paperWidth === 58 ? 32 : 48;
    return this.line(char.repeat(count));
  }

  /** Dos columnas: texto izquierda + precio derecha, alineadas */
  twoColumns(left: string, right: string): this {
    const total = this.paperWidth === 58 ? 32 : 48;
    const leftBytes = stringLength(left);
    const rightBytes = stringLength(right);
    const gap = Math.max(1, total - leftBytes - rightBytes);
    return this.line(left + " ".repeat(gap) + right);
  }

  /** Tres columnas para items: cantidad+nombre (izquierda) y precio (derecha) */
  itemLine(item: TicketItem): this {
    const total = this.paperWidth === 58 ? 32 : 48;
    const qty = formatQty(item.quantity, item.unit);
    const price = formatMoney(item.unitPrice);
    const sub = formatMoney(item.subtotal);

    // Línea 1: nombre (truncado)
    const name = truncate(item.name, total - qty.length - 1);
    this.line(`${qty} ${name}`);
    // Línea 2: precio unitario + subtotal
    const leftStr = `  ${qty} x ${price}`;
    const rightStr = sub;
    this.twoColumns(leftStr, rightStr);
    return this;
  }

  build(): Uint8Array {
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  toArrayBuffer(): ArrayBuffer {
    const arr = this.build();
    // Copiar a un ArrayBuffer nuevo para evitar SharedArrayBuffer
    const ab = new ArrayBuffer(arr.length);
    const view = new Uint8Array(ab);
    view.set(arr);
    return ab;
  }

  toBase64(): string {
    const arr = this.build();
    return bytesToBase64(arr);
  }
}

// ===== GENERADORES DE TICKET =====
export function buildSaleTicket(data: TicketData): Uint8Array {
  const tpl = data.template || defaultTemplate();
  const builder = new EscPosBuilder(tpl.paperWidth);
  builder.init();

  // Encabezado custom (headerLines del template)
  if (tpl.headerLines) {
    const lines = tpl.headerLines.split("\n").filter((l) => l.trim());
    for (const l of lines) {
      builder.alignCenter().line(replacePlaceholders(l, data));
    }
    builder.feed(1);
  }

  // Datos de la tienda
  builder
    .alignCenter()
    .boldOn()
    .doubleOn()
    .line(data.store.name)
    .doubleOff()
    .boldOff();

  if (data.store.address) builder.alignCenter().line(data.store.address);
  if (data.store.phone) builder.alignCenter().line(`Tel: ${data.store.phone}`);
  if (data.store.cuit) builder.alignCenter().line(`CUIT: ${data.store.cuit}`);

  builder.feed(1);

  // Datos de la venta
  builder.alignLeft();
  const saleNum = data.sale.number || data.sale.id.slice(-8).toUpperCase();
  const dateStr = formatDate(data.sale.createdAt);
  builder.line(`Ticket: #${saleNum}`);
  builder.line(`Fecha: ${dateStr}`);
  if (data.sale.branchName) builder.line(`Sucursal: ${data.sale.branchName}`);
  if (tpl.showSeller && data.sale.sellerName) {
    builder.line(`Vendedor: ${data.sale.sellerName}`);
  }
  if (tpl.showCustomer && data.sale.customerName) {
    builder.line(`Cliente: ${data.sale.customerName}`);
  }

  builder.separator();

  // Items
  builder.alignLeft();
  for (const item of data.sale.items) {
    builder.itemLine(item);
  }

  builder.separator();

  // Totales
  builder.alignRight();
  builder.twoColumns("Subtotal:", formatMoney(data.sale.subtotal));
  if (data.sale.discount > 0) {
    const reason = data.sale.discountReason || "Descuento";
    builder.twoColumns(`${reason}:`, "-" + formatMoney(data.sale.discount));
  }
  if (data.sale.surcharge > 0) {
    builder.twoColumns("Recargo:", "+" + formatMoney(data.sale.surcharge));
  }
  if (data.sale.tax > 0) {
    builder.twoColumns("IVA:", formatMoney(data.sale.tax));
  }
  builder.boldOn();
  builder.twoColumns("TOTAL:", formatMoney(data.sale.total));
  builder.boldOff();

  builder.feed(1);

  // Pago
  if (tpl.showPayment) {
    builder.alignLeft();
    builder.line(`Forma de pago: ${data.sale.paymentMethod}`);
    if (data.sale.onCredit) {
      builder.line(`Cuenta corriente (pagado: ${formatMoney(data.sale.amountPaid || 0)})`);
    }
  }

  // Puntos de fidelización
  if ((data.sale.loyaltyPointsEarned || 0) > 0 || (data.sale.loyaltyPointsUsed || 0) > 0) {
    builder.feed(1);
    builder.alignLeft();
    if (data.sale.loyaltyPointsEarned) {
      builder.line(`Puntos ganados: ${data.sale.loyaltyPointsEarned}`);
    }
    if (data.sale.loyaltyPointsUsed) {
      builder.line(`Puntos usados: ${data.sale.loyaltyPointsUsed}`);
    }
  }

  // Factura AFIP
  if (data.invoice) {
    builder.feed(1);
    builder.separator();
    builder.alignCenter().boldOn();
    builder.line(`Factura ${data.invoice.type} N° ${data.invoice.number}`);
    builder.boldOff();
    builder.line(`CAE: ${data.invoice.cae}`);
    if (data.invoice.caeExpiration) {
      builder.line(`Vto CAE: ${data.invoice.caeExpiration}`);
    }
    if (data.invoice.qrCode) {
      builder.feed(1);
      builder.line("QR AFIP:");
      // Aquí se enviaría el QR al comando GS ( k ... para impresoras que lo soportan
      // Por simplicidad, dejamos el placeholder; el frontend puede renderizar el QR como imagen
    }
  }

  // Footer custom
  if (tpl.footerLines) {
    builder.feed(1);
    const lines = tpl.footerLines.split("\n");
    for (const l of lines) {
      builder.alignCenter().line(replacePlaceholders(l, data));
    }
  } else {
    builder.feed(1);
    builder.alignCenter().line("¡Gracias por su compra!");
  }

  // Corte
  if (tpl.cutPaper) {
    builder.cut();
  } else {
    builder.feed(4);
  }

  return builder.build();
}

export function buildCommandTicket(
  order: {
    store: { name: string };
    sale: {
      id: string;
      number?: string;
      createdAt: Date | string;
      branchName?: string | null;
    };
    items: Array<{
      name: string;
      quantity: number;
      unit?: string;
      notes?: string;
      station: string; // "COCINA", "BARRA", "POSTRES"
    }>;
    station?: string; // estación general de la comanda (si no se especifica, usa la del primer item)
  }
): Uint8Array {
  const builder = new EscPosBuilder(80);
  builder.init();

  const stationName = order.station || order.items[0]?.station || "COMANDA";
  builder.alignCenter().boldOn().doubleOn();
  builder.line(stationName);
  builder.doubleOff().boldOff();
  builder.separator("=");

  builder.alignLeft();
  const num = order.sale.number || order.sale.id.slice(-6).toUpperCase();
  builder.line(`Pedido: #${num}`);
  builder.line(`Hora: ${formatDate(order.sale.createdAt)}`);
  if (order.sale.branchName) builder.line(`Sucursal: ${order.sale.branchName}`);
  builder.feed(1);

  builder.separator();
  for (const item of order.items) {
    builder.boldOn();
    builder.line(`${formatQty(item.quantity, item.unit)}  ${item.name.toUpperCase()}`);
    builder.boldOff();
    if (item.notes) {
      builder.line(`   >> ${item.notes}`);
    }
  }
  builder.separator();

  builder.feed(2);
  builder.beep();
  builder.cut();

  return builder.build();
}

export function buildZCloseTicket(
  data: {
    store: { name: string; address?: string | null; cuit?: string | null };
    cashRegister: { id: string; openedAt: Date | string; closedAt: Date | string; openingBalance: number };
    totals: {
      sales: number;
      salesCount: number;
      cash: number;
      cardCredit: number;
      cardDebit: number;
      transfer: number;
      onCredit: number;
      refunds: number;
      expenses: number;
      expectedCash: number;
      actualCash: number;
      difference: number;
    };
  }
): Uint8Array {
  const builder = new EscPosBuilder(80);
  builder.init();

  builder.alignCenter().boldOn().doubleOn();
  builder.line("CIERRE DE CAJA");
  builder.doubleOff().boldOff();
  builder.line(data.store.name);
  builder.separator("=");

  builder.alignLeft();
  builder.line(`Caja: #${data.cashRegister.id.slice(-6).toUpperCase()}`);
  builder.line(`Apertura: ${formatDate(data.cashRegister.openedAt)}`);
  builder.line(`Cierre: ${formatDate(data.cashRegister.closedAt)}`);
  builder.feed(1);

  builder.separator();
  builder.boldOn();
  builder.line("RESUMEN DE VENTAS");
  builder.boldOff();
  builder.twoColumns("Cantidad:", String(data.totals.salesCount));
  builder.twoColumns("Total:", formatMoney(data.totals.sales));

  builder.feed(1);
  builder.line("Por método de pago:");
  builder.twoColumns("  Efectivo:", formatMoney(data.totals.cash));
  builder.twoColumns("  Tarj. Crédito:", formatMoney(data.totals.cardCredit));
  builder.twoColumns("  Tarj. Débito:", formatMoney(data.totals.cardDebit));
  builder.twoColumns("  Transferencia:", formatMoney(data.totals.transfer));
  builder.twoColumns("  Cuenta Corriente:", formatMoney(data.totals.onCredit));

  builder.feed(1);
  builder.twoColumns("Devoluciones:", "-" + formatMoney(data.totals.refunds));
  builder.twoColumns("Gastos:", "-" + formatMoney(data.totals.expenses));

  builder.separator();
  builder.boldOn();
  builder.twoColumns("Saldo apertura:", formatMoney(data.cashRegister.openingBalance));
  builder.twoColumns("Efectivo esperado:", formatMoney(data.totals.expectedCash));
  builder.twoColumns("Efectivo real:", formatMoney(data.totals.actualCash));
  const diff = data.totals.difference;
  const diffStr = (diff >= 0 ? "+" : "") + formatMoney(diff);
  builder.twoColumns("Diferencia:", diffStr);
  builder.boldOff();

  builder.feed(2);
  builder.cut();
  return builder.build();
}

// ===== HELPERS =====
function defaultTemplate(): PrintTemplateConfig {
  return {
    paperWidth: 58,
    charset: "UTF8",
    cutPaper: true,
    showLogo: false,
    showCustomer: false,
    showSeller: true,
    showPayment: true,
  };
}

function stringToBytes(str: string): Uint8Array {
  // UTF-8 encoding
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

function stringLength(str: string): number {
  // Aproxima el ancho en columnas (1 por char UTF-8 visible)
  // Para CJK se debería contar como 2, pero para POS latino basta con 1
  return [...str].length;
}

function truncate(str: string, max: number): string {
  const chars = [...str];
  if (chars.length <= max) return str;
  return chars.slice(0, max - 1).join("") + "…";
}

export function formatMoney(n: number): string {
  return "$" + n.toFixed(2);
}

function formatQty(qty: number, unit?: string): string {
  const q = Number.isInteger(qty) ? String(qty) : qty.toFixed(3);
  if (!unit || unit === "UNIDAD") return q + "u";
  if (unit === "KG") return q + "kg";
  if (unit === "LITRO") return q + "L";
  if (unit === "METRO") return q + "m";
  if (unit === "PACK") return q + "pack";
  return q + unit.toLowerCase();
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function replacePlaceholders(tpl: string, data: TicketData): string {
  return tpl
    .replace(/\{\{store\.name\}\}/g, data.store.name)
    .replace(/\{\{store\.address\}\}/g, data.store.address || "")
    .replace(/\{\{store\.phone\}\}/g, data.store.phone || "")
    .replace(/\{\{store\.cuit\}\}/g, data.store.cuit || "")
    .replace(/\{\{sale\.total\}\}/g, formatMoney(data.sale.total))
    .replace(/\{\{sale\.id\}\}/g, data.sale.id)
    .replace(/\{\{sale\.number\}\}/g, data.sale.number || "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback
  return Buffer.from(bytes).toString("base64");
}

// ===== CONVERSIÓN A FORMATOS DE SALIDA =====
export function ticketToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function ticketToBlobUrl(bytes: Uint8Array): string {
  if (typeof Blob === "undefined") return "";
  // Copiar a ArrayBuffer para evitar problemas de tipo con Uint8Array.buffer (SharedArrayBuffer)
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: "application/octet-stream" });
  return URL.createObjectURL(blob);
}

/**
 * Intenta imprimir enviando a una impresora USB conectada vía WebUSB.
 * Requiere HTTPS y permiso del usuario. Si no hay impresora, lanza error.
 */
export async function printViaWebUSB(bytes: Uint8Array): Promise<boolean> {
  if (typeof navigator === "undefined" || !("usb" in navigator)) {
    throw new Error("WebUSB no soportado en este navegador");
  }
  // @ts-ignore
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  await device.claimInterface(0);
  await device.transferOut(1, bytes);
  await device.close();
  return true;
}

/**
 * Imprime vía un servidor de impresión local (programa auxiliar en la PC).
 * Conexión WebSocket a localhost:8787.
 */
export async function printViaLocalServer(
  bytes: Uint8Array,
  port: number = 8787,
  printerName?: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "print",
            printer: printerName,
            data: bytesToBase64(bytes),
          })
        );
      };
      ws.onmessage = (e) => {
        try {
          const res = JSON.parse(e.data);
          if (res.ok) resolve(true);
          else reject(new Error(res.error || "Error de impresión"));
        } catch {
          resolve(true);
        }
        ws.close();
      };
      ws.onerror = () => reject(new Error("No se pudo conectar al servidor de impresión local"));
      setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          reject(new Error("Timeout conectando al servidor de impresión"));
        }
      }, 3000);
    } catch (e: any) {
      reject(e);
    }
  });
}
