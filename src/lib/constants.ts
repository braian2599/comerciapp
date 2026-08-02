export const RUBROS: { value: string; label: string; icon: string }[] = [
  { value: "TIENDA_BARRIO", label: "Tienda de barrio / Almacén", icon: "🏪" },
  { value: "MINIMARKET", label: "Minimarket", icon: "🛒" },
  { value: "VERDULERIA", label: "Verdulería", icon: "🥬" },
  { value: "CARNICERIA", label: "Carnicería", icon: "🥩" },
  { value: "PANADERIA", label: "Panadería", icon: "🍞" },
  { value: "KIOSCO", label: "Kiosco", icon: "🍭" },
  { value: "FERRETERIA", label: "Ferretería", icon: "🔧" },
  { value: "OTRO", label: "Otro", icon: "📦" },
];

export const UNITS = [
  { value: "UNIDAD", label: "Unidad" },
  { value: "KG", label: "Kilogramo" },
  { value: "LITRO", label: "Litro" },
  { value: "METRO", label: "Metro" },
  { value: "PACK", label: "Pack" },
];

export const PAYMENT_METHODS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "CUENTA", label: "Cuenta corriente" },
];

// Tipos de método de pago configurables por tienda
export const PAYMENT_METHOD_TYPES = [
  { value: "EFECTIVO", label: "Efectivo", icon: "💵", defaultSurcharge: 0 },
  { value: "TARJETA_DEBITO", label: "Tarjeta de débito", icon: "💳", defaultSurcharge: 0 },
  { value: "TARJETA_CREDITO", label: "Tarjeta de crédito", icon: "💳", defaultSurcharge: 10 },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: "🏦", defaultSurcharge: 0 },
  { value: "CUENTA", label: "Cuenta corriente", icon: "📋", defaultSurcharge: 0 },
  { value: "OTRO", label: "Otro", icon: "📦", defaultSurcharge: 0 },
];

export function paymentTypeLabel(value: string) {
  return PAYMENT_METHOD_TYPES.find((t) => t.value === value)?.label || value;
}

export function paymentTypeIcon(value: string) {
  return PAYMENT_METHOD_TYPES.find((t) => t.value === value)?.icon || "📦";
}

// Métodos por defecto que se crean al registrar una nueva tienda
export const DEFAULT_PAYMENT_METHODS = [
  { name: "Efectivo", type: "EFECTIVO", surcharge: 0, isDefault: true },
  { name: "Tarjeta de Débito", type: "TARJETA_DEBITO", surcharge: 0, isDefault: false },
  { name: "Tarjeta de Crédito", type: "TARJETA_CREDITO", surcharge: 10, isDefault: false },
  { name: "Transferencia", type: "TRANSFERENCIA", surcharge: 0, isDefault: false },
  { name: "Cuenta Corriente", type: "CUENTA", surcharge: 0, isDefault: false },
];

export function formatCurrency(amount: number, symbol: string = "$") {
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${symbol} ${formatted}`;
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function rubroLabel(value: string) {
  return RUBROS.find((r) => r.value === value)?.label || value;
}

export function rubroIcon(value: string) {
  return RUBROS.find((r) => r.value === value)?.icon || "📦";
}

export function unitLabel(value: string) {
  return UNITS.find((u) => u.value === value)?.label || value;
}
