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
