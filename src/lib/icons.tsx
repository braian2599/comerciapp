"use client";

import {
  Store,
  ShoppingCart,
  Leaf,
  Beef,
  Croissant,
  Candy,
  Wrench,
  Package,
  Banknote,
  CreditCard,
  Landmark,
  ClipboardList,
  Home,
  Lightbulb,
  Users,
  ReceiptText,
  Truck,
  ShoppingBag,
  Tag,
  Globe,
  Star,
  type LucideProps,
} from "lucide-react";

/**
 * Mapa central de nombres de icono → componente Lucide.
 * Permite referenciar iconos por string (en constantes, configs, DB)
 * y renderizarlos con el helper <Icon name="..." />.
 */
export const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  // Rubros
  store: Store,
  cart: ShoppingCart,
  leaf: Leaf,
  beef: Beef,
  croissant: Croissant,
  candy: Candy,
  wrench: Wrench,
  package: Package,
  // Pagos
  banknote: Banknote,
  credit_card: CreditCard,
  landmark: Landmark,
  clipboard_list: ClipboardList,
  // Gastos
  home: Home,
  lightbulb: Lightbulb,
  users: Users,
  receipt_text: ReceiptText,
  truck: Truck,
  // E-commerce
  shopping_bag: ShoppingBag,
  tag: Tag,
  globe: Globe,
  // Misc
  star: Star,
};

export interface IconProps extends LucideProps {
  name: string;
}

/**
 * Renderiza un icono Lucide por nombre.
 * Si el nombre no existe en ICON_MAP, renderiza Package como fallback.
 */
export function Icon({ name, ...props }: IconProps) {
  const Cmp = ICON_MAP[name] || Package;
  return <Cmp {...props} />;
}
