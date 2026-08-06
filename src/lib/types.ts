/**
 * Tipos compartidos del dominio ComerciApp.
 *
 * Estos tipos representan las entidades principales tal como las consume
 * el frontend (no necesariamente igual al schema de Prisma — son la
 * "vista cliente" de los datos).
 *
 * Centralizarlos acá permite que múltiples vistas (pos, products, sales,
 * cart-storage, etc.) compartan la misma definición sin duplicar.
 */

export interface Product {
  id: string;
  name: string;
  barcode?: string;
  sku?: string;
  salePrice: number;
  costPrice?: number;
  stock: number;
  minStock?: number;
  unit: string;
  active: boolean;
  category?: { id: string; name: string };
  categoryId?: string;
  brand?: string;
  labels?: string;
  allergens?: string;
  ingredients?: string;
  imageUrl?: string;
}

export interface CartItem {
  product: Product;
  qty: number;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  loyaltyPoints?: number;
  loyaltyTier?: string;
  totalSpent?: number;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  isMain: boolean;
  active: boolean;
}

export interface AppliedPromotion {
  promotionId: string;
  promotionName: string;
  type: string;
  discountAmount: number;
  description: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  surcharge: number;
  active: boolean;
  isDefault: boolean;
}
