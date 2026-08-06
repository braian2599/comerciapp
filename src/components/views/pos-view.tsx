"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Barcode,
  Loader2,
  CheckCircle2,
  Printer,
  X,
  QrCode,
  Star,
  Clock,
  Hash,
  AlertTriangle,
  Zap,
  ChevronDown,
  Package,
  User,
  AlertCircle,
  Check,
  Save,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, unitLabel } from "@/lib/constants";
import { calculateMaxRedeemablePoints, pointsToCurrency } from "@/lib/loyalty";
import { safeFetchJSON } from "@/lib/fetch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePersistentCart } from "@/hooks/use-persistent-cart";
import type {
  Product,
  CartItem,
  Customer,
  Branch,
  AppliedPromotion,
  PaymentMethod,
} from "@/lib/types";

// ─── Sub-componentes de fila (memoizados fuera del render principal) ──────────

function ProductRow({
  product,
  isSelected,
  onAdd,
  symbol,
  compact = false,
}: {
  product: Product;
  isSelected?: boolean;
  onAdd: () => void;
  symbol: string;
  compact?: boolean;
}) {
  const labels = product.labels
    ? product.labels.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const allergens = product.allergens
    ? product.allergens.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const outOfStock = product.stock <= 0;
  const lowStock = product.stock > 0 && product.stock <= 5;

  return (
    <button
      onClick={onAdd}
      disabled={outOfStock}
      className={`w-full text-left flex items-center gap-2.5 p-2 rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        isSelected
          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300"
          : "border-transparent hover:border-indigo-200 hover:bg-muted/50"
      }`}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          className={`rounded object-cover bg-muted shrink-0 ${compact ? "w-9 h-9" : "w-11 h-11"}`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className={`rounded bg-muted flex items-center justify-center shrink-0 ${compact ? "w-9 h-9" : "w-11 h-11"}`}>
          <Package className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-tight">{product.name}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
          <span className="font-semibold text-indigo-700">
            {formatCurrency(product.salePrice, symbol)}
          </span>
          {product.brand && <span>· {product.brand}</span>}
          {product.category?.name && <span>· {product.category.name}</span>}
        </div>
        {(labels.length > 0 || allergens.length > 0) && !compact && (
          <div className="flex flex-wrap gap-0.5 mt-1">
            {labels.slice(0, 2).map((l) => (
              <span
                key={`l-${l}`}
                className="text-[9px] py-0 px-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"
              >
                {l}
              </span>
            ))}
            {allergens.slice(0, 1).map((a) => (
              <span
                key={`a-${a}`}
                className="text-[9px] py-0 px-1 rounded bg-red-50 text-red-700 border border-red-200"
              >
                ⚠ {a}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <span
          className={`text-[11px] font-medium block ${
            outOfStock ? "text-red-600" : lowStock ? "text-amber-600" : "text-muted-foreground"
          }`}
        >
          {outOfStock
            ? "Sin stock"
            : `${product.stock} ${product.unit === "KG" ? "kg" : "u"}`}
        </span>
        <span className="text-[10px] text-indigo-600 hidden sm:inline">+ agregar</span>
      </div>
    </button>
  );
}

function CartRow({
  item,
  symbol,
  onUpdateQty,
  onSetQty,
  onRemove,
}: {
  item: CartItem;
  symbol: string;
  onUpdateQty: (delta: number) => void;
  onSetQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const { product, qty } = item;
  const labels = product.labels
    ? product.labels.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const allergens = product.allergens
    ? product.allergens.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const lowStock = qty >= product.stock;

  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-background border border-border/60 hover:border-indigo-200 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-tight">{product.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatCurrency(product.salePrice, symbol)} ·{" "}
          {product.unit === "KG" ? "kg" : "u"}
          {product.brand && ` · ${product.brand}`}
        </p>
        {(labels.length > 0 || allergens.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {labels.slice(0, 2).map((l) => (
              <Badge
                key={`l-${l}`}
                variant="outline"
                className="text-[9px] py-0 px-1 h-4 bg-indigo-50 text-indigo-700 border-indigo-200"
              >
                {l}
              </Badge>
            ))}
            {allergens.slice(0, 1).map((a) => (
              <Badge
                key={`a-${a}`}
                variant="outline"
                className="text-[9px] py-0 px-1 h-4 bg-red-50 text-red-700 border-red-200"
              >
                ⚠ {a}
              </Badge>
            ))}
          </div>
        )}
        {lowStock && product.stock > 0 && (
          <p className="text-[10px] text-amber-600 mt-0.5">
            Stock máx: {product.stock}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <p className="text-sm font-semibold">
          {formatCurrency(product.salePrice * qty, symbol)}
        </p>
        <div className="flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={() => onUpdateQty(-1)}
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Input
            type="number"
            value={qty}
            onChange={(e) => onSetQty(Number(e.target.value))}
            className="h-6 w-10 text-center text-xs px-0"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={() => onUpdateQty(1)}
          >
            <Plus className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-red-600 hover:text-red-700"
            onClick={onRemove}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PosView() {
  const { store, user } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [loyaltyProgram, setLoyaltyProgram] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Búsqueda y filtrado
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Carrito y checkout
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [discount, setDiscount] = useState(0);
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Recientes
  const [recentProductIds, setRecentProductIds] = useState<string[]>([]);

  // Resultados de venta
  const [lastSale, setLastSale] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // ─── Persistencia del carrito (IndexedDB) ───────────────────────────────────
  // El hook restaura el carrito guardado al montar y auto-guarda cambios.
  // reconcileInfo se usa para mostrar un modal al usuario informando qué
  // productos fueron ajustados (stock/precio cambiado) o quitados (ya no existen).
  const [reconcileModalOpen, setReconcileModalOpen] = useState(false);
  const cartPersistence = usePersistentCart({
    storeId: store?.id,
    userId: user?.id,
    cart,
    customerId,
    discount,
    paymentMethodId,
    notes,
    branchId,
    products,
    onRestore: (data) => {
      setCart(data.items);
      setCustomerId(data.customerId);
      setDiscount(data.discount);
      setPaymentMethodId(data.paymentMethodId);
      setNotes(data.notes);
      if (data.branchId) setBranchId(data.branchId);
    },
  });

  // Mostrar modal de reconciliación cuando hay info y terminó de restaurar
  useEffect(() => {
    if (cartPersistence.reconcileInfo && !cartPersistence.isRestoring) {
      const info = cartPersistence.reconcileInfo;
      if (info.removedCount > 0 || info.adjustedCount > 0) {
        setReconcileModalOpen(true);
      }
    }
  }, [cartPersistence.reconcileInfo, cartPersistence.isRestoring]);

  // Mercado Pago QR
  const [mpConfig, setMpConfig] = useState<any>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrData, setQrData] = useState<any>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrPolling, setQrPolling] = useState(false);

  // Promociones
  const [appliedPromotion, setAppliedPromotion] = useState<AppliedPromotion | null>(null);
  const [availablePromotions, setAvailablePromotions] = useState<AppliedPromotion[]>([]);

  // Puntos de fidelización
  const [pointsToRedeem, setPointsToRedeem] = useState(0);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);

  const symbol = store?.currencySymbol || "$";
  const taxEnabled = store?.taxEnabled;
  const taxRate = store?.taxRate || 0;
  const isCajero = user?.role === "CAJERO";

  // ─── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      safeFetchJSON<Product[]>("/api/products"),
      safeFetchJSON<Category[]>("/api/categories"),
      safeFetchJSON<Customer[]>("/api/customers"),
      safeFetchJSON<PaymentMethod[]>("/api/payment-methods"),
      safeFetchJSON<any>("/api/mercadopago/config"),
      safeFetchJSON<Branch[]>("/api/branches"),
      safeFetchJSON<any>("/api/loyalty"),
    ])
      .then(([pRes, cRes, custRes, pmRes, mpRes, brsRes, loyRes]) => {
        const p = Array.isArray(pRes.data) ? pRes.data : [];
        const c = Array.isArray(cRes.data) ? cRes.data : [];
        const cust = Array.isArray(custRes.data) ? custRes.data : [];
        const pm = Array.isArray(pmRes.data) ? pmRes.data : [];
        const brs = Array.isArray(brsRes.data) ? brsRes.data : [];
        setProducts(p.filter((x: Product) => x.active));
        setCategories(c);
        setCustomers(cust);
        const activePM = pm.filter((m: PaymentMethod) => m.active);
        setPaymentMethods(activePM);
        const def = activePM.find((m) => m.isDefault) || activePM[0];
        if (def) setPaymentMethodId(def.id);
        setMpConfig(mpRes.data);
        setBranches(brs);
        const main = brs.find((b: Branch) => b.isMain && b.active);
        if (main) setBranchId(main.id);
        setLoyaltyProgram(loyRes.data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("No se pudieron cargar los datos del POS");
        setLoading(false);
      });
  }, []);

  // ─── Debounce de búsqueda (200ms) ───────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setSelectedIndex(0);
    }, 180);
    return () => clearTimeout(t);
  }, [search]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // ─── Filtrado (usa debouncedSearch) ──────────────────────────────────────────
  const filtered = useMemo(() => {
    const term = debouncedSearch.toLowerCase();
    return products.filter((p) => {
      const matchSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term) ||
        p.brand?.toLowerCase().includes(term);
      const matchCat = filterCat === "all" || p.categoryId === filterCat;
      return matchSearch && matchCat;
    });
  }, [products, debouncedSearch, filterCat]);

  // Cap results for performance — show max 24, indicate there are more
  const MAX_DISPLAY = 24;
  const displayResults = useMemo(
    () => filtered.slice(0, MAX_DISPLAY),
    [filtered]
  );
  const hasMore = filtered.length > MAX_DISPLAY;

  // Productos recientes (derivado de recentProductIds)
  const recentProducts = useMemo(() => {
    return recentProductIds
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is Product => Boolean(p))
      .slice(0, 10);
  }, [recentProductIds, products]);

  // ¿Está en modo búsqueda? (hay texto o filtro de categoría activo)
  const isSearching = debouncedSearch.length > 0 || filterCat !== "all";

  // ─── Carrito: agregar / editar / eliminar ───────────────────────────────────
  const addToCart = useCallback((product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) {
          toast.error(`Stock máximo alcanzado para ${product.name}`);
          return prev;
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i
        );
      }
      if (product.stock <= 0) {
        toast.error(`${product.name} sin stock`);
        return prev;
      }
      return [...prev, { product, qty: 1 }];
    });
    // Track recientes
    setRecentProductIds((prev) => {
      const next = [product.id, ...prev.filter((id) => id !== product.id)];
      return next.slice(0, 12);
    });
  }, []);

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product.id !== productId) return i;
          const nextQty = i.qty + delta;
          if (nextQty > i.product.stock) {
            toast.error(
              `Solo hay ${i.product.stock} ${unitLabel(i.product.unit).toLowerCase()}s disponibles`
            );
            return i;
          }
          return { ...i, qty: nextQty };
        })
        .filter((i) => i.qty > 0)
    );
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product.id === productId
            ? { ...i, qty: Math.max(0, Math.min(qty, i.product.stock)) }
            : i
        )
        .filter((i) => i.qty > 0)
    );
  }

  function removeItem(productId: string) {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  }

  function clearCart() {
    setCart([]);
    setCustomerId("");
    setDiscount(0);
    setNotes("");
    setAppliedPromotion(null);
    setPointsToRedeem(0);
    setShowAdvanced(false);
    // Limpiar el draft persistido (la venta se completó o el usuario vació el carrito)
    cartPersistence.clearPersisted();
  }

  // ─── Navegación por teclado en resultados ───────────────────────────────────
  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, displayResults.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setSearch("");
      return;
    }
    if (e.key === "Enter") {
      const term = search.trim();
      if (!term && filterCat === "all") return;

      // 1. Match exacto por barcode o SKU (scanner)
      const exact = products.find(
        (p) =>
          p.barcode === term ||
          (p.sku && p.sku.toLowerCase() === term.toLowerCase())
      );
      if (exact) {
        addToCart(exact);
        setSearch("");
        return;
      }
      // 2. Si solo hay 1 resultado, agregarlo
      if (displayResults.length === 1) {
        addToCart(displayResults[0]);
        setSearch("");
        return;
      }
      // 3. Si hay selección activa, agregar el seleccionado
      if (displayResults[selectedIndex]) {
        addToCart(displayResults[selectedIndex]);
        // No limpiamos search para permitir seguir agregando del mismo filtro
      }
    }
  }

  // ─── Atajos globales ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // No interferir si está en un input/select/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

      if (e.key === "F2") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === "F9" && cart.length > 0 && !inField) {
        e.preventDefault();
        setConfirmOpen(true);
      }
      if (e.key === "F4" && !inField) {
        e.preventDefault();
        setShowAdvanced((s) => !s);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length]);

  // ─── Cálculos de totales ────────────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + i.product.salePrice * i.qty, 0);

  const promotionDiscount = appliedPromotion?.discountAmount || 0;
  const maxRedeemablePoints =
    selectedCustomer && loyaltyProgram?.enabled
      ? calculateMaxRedeemablePoints(
          selectedCustomer.loyaltyPoints || 0,
          subtotal - promotionDiscount,
          {
            ...loyaltyProgram,
            enabled: true,
            roundMode: loyaltyProgram.roundMode as any,
          }
        )
      : 0;
  const effectivePointsToRedeem = Math.min(pointsToRedeem, maxRedeemablePoints);
  const pointsCurrencyDiscount =
    effectivePointsToRedeem > 0 && loyaltyProgram?.enabled
      ? pointsToCurrency(effectivePointsToRedeem, {
          ...loyaltyProgram,
          enabled: true,
          roundMode: loyaltyProgram.roundMode as any,
        })
      : 0;

  const manualDiscount = Math.min(discount, subtotal);
  const totalDiscount = manualDiscount + promotionDiscount + pointsCurrencyDiscount;
  const taxable = Math.max(0, subtotal - totalDiscount);
  const taxAmount = taxEnabled ? taxable * (taxRate / 100) : 0;
  const selectedMethod = paymentMethods.find((m) => m.id === paymentMethodId);
  const surchargeRate = selectedMethod?.surcharge || 0;
  const surchargeAmount = (taxable + taxAmount) * (surchargeRate / 100);
  const total = taxable + taxAmount + surchargeAmount;

  const cartItemCount = cart.reduce((s, i) => s + i.qty, 0);
  const canCheckout =
    cart.length > 0 &&
    !!paymentMethodId &&
    !(selectedMethod?.type === "CUENTA" && !customerId);

  // ─── Evaluación de promociones ───────────────────────────────────────────────
  useEffect(() => {
    if (cart.length === 0) {
      setAvailablePromotions([]);
      setAppliedPromotion(null);
      return;
    }
    let cancelled = false;
    fetch("/api/promotions/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((i) => ({
          productId: i.product.id,
          categoryId: i.product.categoryId || null,
          name: i.product.name,
          quantity: i.qty,
          unitPrice: i.product.salePrice,
        })),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setAvailablePromotions(data.applicable || []);
        if (data.best && !appliedPromotion) {
          setAppliedPromotion(data.best);
        } else if (!data.best) {
          setAppliedPromotion(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cart]);

  useEffect(() => {
    setPointsToRedeem(0);
  }, [customerId]);

  // ─── Impresión térmica ──────────────────────────────────────────────────────
  async function printThermalSale() {
    if (!lastSale?.id) return;
    try {
      const printRes = await safeFetchJSON<any>("/api/print", {
        method: "POST",
        body: JSON.stringify({ type: "TICKET", saleId: lastSale.id }),
      });
      if (!printRes.ok) throw new Error(printRes.error);

      const blobRes = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "TICKET",
          saleId: lastSale.id,
          returnFormat: "blob",
        }),
      });
      if (!blobRes.ok) {
        throw new Error("No se pudo generar el archivo del ticket");
      }
      const blob = await blobRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ticket-${lastSale.id.slice(-6)}.bin`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Ticket generado (archivo .bin)");
    } catch (e: any) {
      toast.error("Error al imprimir", { description: e.message });
    }
  }

  // ─── Procesar venta ──────────────────────────────────────────────────────────
  async function processSale() {
    if (cart.length === 0) {
      toast.error("El carrito está vacío");
      return;
    }
    if (!paymentMethodId) {
      toast.error("Seleccioná un método de pago");
      return;
    }
    if (selectedMethod?.type === "CUENTA" && !customerId) {
      toast.error("Para cuenta corriente tenés que seleccionar un cliente");
      return;
    }
    setProcessing(true);
    try {
      const saleRes = await safeFetchJSON<any>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((i) => ({
            productId: i.product.id,
            quantity: i.qty,
          })),
          customerId: customerId || null,
          discount: manualDiscount,
          paymentMethodId,
          notes,
          taxRate: taxEnabled ? taxRate : 0,
          branchId: branchId || null,
          promotionId: appliedPromotion?.promotionId || null,
          promotionDiscount: appliedPromotion?.discountAmount || 0,
          loyaltyPointsUsed: effectivePointsToRedeem || 0,
        }),
      });
      if (!saleRes.ok || !saleRes.data) {
        throw new Error(saleRes.error || "No se pudo registrar la venta");
      }
      const data = saleRes.data;
      toast.success("Venta registrada!");
      setLastSale({
        ...data,
        items: cart,
        customer: customers.find((c) => c.id === customerId),
        paymentMethod: selectedMethod,
        discount: totalDiscount,
        tax: taxAmount,
        surcharge: surchargeAmount,
        total,
        subtotal,
        appliedPromotion,
        pointsUsed: effectivePointsToRedeem,
        pointsEarned: data.loyaltyPointsEarned || 0,
      });
      setConfirmOpen(false);
      setReceiptOpen(true);
      clearCart();
      try {
        const [refreshedRes, refreshedCustRes] = await Promise.all([
          safeFetchJSON<Product[]>("/api/products"),
          safeFetchJSON<Customer[]>("/api/customers"),
        ]);
        const refreshed = Array.isArray(refreshedRes.data) ? refreshedRes.data : [];
        setProducts(refreshed.filter((x: Product) => x.active));
        if (Array.isArray(refreshedCustRes.data)) {
          setCustomers(refreshedCustRes.data);
        }
      } catch {
        // best-effort
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-[calc(100vh-6.5rem)] flex flex-col gap-3">
      {/* Header compacto */}
      <div className="flex items-end justify-between flex-wrap gap-2 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Punto de Venta</h1>
          <p className="text-xs text-muted-foreground">
            Buscá, agregá al carrito y cobrá — todo en una pantalla
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Indicador de carrito guardado automáticamente */}
          {cart.length > 0 && (
            <span
              className={`hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-opacity ${
                cartPersistence.isSaved
                  ? "opacity-100 text-emerald-700 bg-emerald-50 border-emerald-200"
                  : "opacity-50 text-muted-foreground bg-muted/50 border-transparent"
              }`}
              title={
                cartPersistence.isSaved
                  ? "Carrito guardado localmente. Se recuperará si recargás la página."
                  : "Guardando cambios…"
              }
            >
              {cartPersistence.isSaved ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>Guardado</span>
                </>
              ) : (
                <>
                  <Save className="w-3 h-3 animate-pulse" />
                  <span>Guardando…</span>
                </>
              )}
            </span>
          )}
          <div className="hidden md:flex items-center gap-1.5 text-[10px] text-muted-foreground mr-2">
            <kbd className="px-1.5 py-0.5 bg-muted rounded border">F2</kbd> buscar
            <kbd className="px-1.5 py-0.5 bg-muted rounded border">F4</kbd> opciones
            <kbd className="px-1.5 py-0.5 bg-muted rounded border">F9</kbd> cobrar
          </div>
          {branches.length > 1 && (
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches
                  .filter((b) => b.active)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="inline-flex items-center gap-1.5">
                        {b.isMain && (
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        )}
                        {b.name} ({b.code})
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Grid principal: 2/5 productos + 3/5 carrito/checkout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-3 min-h-0">
        {/* ════════════════════════════════════════════════════════════════════════
            COLUMNA IZQUIERDA — Productos (2/5 = 40%)                            */}
        <Card className="lg:col-span-2 flex flex-col min-h-0 overflow-hidden">
          {/* Barra de búsqueda + categorías — sticky top */}
          <div className="p-3 border-b shrink-0 space-y-2 bg-card">
            <div className="relative">
              <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Escribí para buscar o escaneá un código…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9 pr-9 h-11 text-base"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {/* Chips de categoría — scroll horizontal */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                onClick={() => setFilterCat("all")}
                className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                  filterCat === "all"
                    ? "bg-indigo-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Todos
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFilterCat(c.id)}
                  className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                    filterCat === c.id
                      ? "bg-indigo-600 text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Área de resultados — scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
                <p className="text-xs text-muted-foreground mt-2">
                  Cargando productos…
                </p>
              </div>
            ) : isSearching ? (
              // ─── Modo búsqueda: mostrar resultados filtrados ───
              <div className="p-1">
                {displayResults.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No se encontraron productos</p>
                    <p className="text-xs mt-1">
                      Probá con otro término o cambiá de categoría
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="px-2 py-1 text-[11px] text-muted-foreground flex items-center justify-between">
                      <span>
                        {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
                      </span>
                      {hasMore && (
                        <span className="text-amber-600">
                          Mostrando primeros {MAX_DISPLAY}
                        </span>
                      )}
                    </div>
                    {displayResults.map((p, idx) => (
                      <ProductRow
                        key={p.id}
                        product={p}
                        isSelected={idx === selectedIndex}
                        onAdd={() => addToCart(p)}
                        symbol={symbol}
                      />
                    ))}
                  </>
                )}
              </div>
            ) : (
              // ─── Modo default: recientes + toggle "ver todos" ───
              <div className="p-2 space-y-3">
                {recentProducts.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-medium text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>PRODUCTOS RECIENTES</span>
                    </div>
                    <div className="space-y-0.5">
                      {recentProducts.map((p) => (
                        <ProductRow
                          key={`r-${p.id}`}
                          product={p}
                          onAdd={() => addToCart(p)}
                          symbol={symbol}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between px-1 py-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <Hash className="w-3 h-3" />
                      <span>CATÁLOGO COMPLETO</span>
                      <span className="text-muted-foreground/60 normal-case font-normal">
                        ({products.length})
                      </span>
                    </div>
                    <button
                      onClick={() => setShowAllProducts((s) => !s)}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      {showAllProducts ? "Ocultar" : "Ver todos"}
                    </button>
                  </div>
                  {showAllProducts && (
                    <div className="space-y-0.5 max-h-[50vh]">
                      {products.slice(0, 60).map((p) => (
                        <ProductRow
                          key={`a-${p.id}`}
                          product={p}
                          onAdd={() => addToCart(p)}
                          symbol={symbol}
                          compact
                        />
                      ))}
                      {products.length > 60 && (
                        <p className="text-[11px] text-center text-muted-foreground p-2">
                          Escribí arriba para encontrar los demás ({products.length - 60} más)
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {recentProducts.length === 0 && !showAllProducts && (
                  <div className="p-6 text-center text-muted-foreground">
                    <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-medium">Empezá a vender</p>
                    <p className="text-xs mt-1">
                      Escribí un nombre, escaneá un código o presioná “Ver todos”
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer — hint de teclado */}
          <div className="p-1.5 border-t bg-muted/30 shrink-0 flex items-center justify-center text-[10px] text-muted-foreground gap-2">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background rounded border">↑↓</kbd> navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background rounded border">Enter</kbd> agregar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-background rounded border">Esc</kbd> limpiar
            </span>
          </div>
        </Card>

        {/* ════════════════════════════════════════════════════════════════════════
            COLUMNA DERECHA — Carrito + Checkout inline (3/5 = 60%)              */}
        <Card className="lg:col-span-3 flex flex-col min-h-0 overflow-hidden">
          {/* Header del carrito */}
          <div className="p-3 border-b shrink-0 flex items-center justify-between bg-card">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              <span className="font-semibold text-sm">Carrito</span>
              <Badge variant="secondary">{cart.length}</Badge>
              {cartItemCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  · {cartItemCount} {cartItemCount === 1 ? "unidad" : "unidades"}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCart}
                className="text-red-600 hover:text-red-700 h-7 text-xs"
              >
                <Trash2 className="w-3 h-3 mr-1" /> Vaciar
              </Button>
            )}
          </div>

          {/* Items del carrito — scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5">
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8 text-center">
                <div>
                  <ShoppingCart className="w-12 h-12 mx-auto opacity-20 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">
                    Carrito vacío
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                    Buscá productos en el panel izquierdo y agregalos aquí. Todo el
                    cierre de venta sucede en esta misma pantalla.
                  </p>
                </div>
              </div>
            ) : (
              cart.map((i) => (
                <CartRow
                  key={i.product.id}
                  item={i}
                  symbol={symbol}
                  onUpdateQty={(delta) => updateQty(i.product.id, delta)}
                  onSetQty={(qty) => setQty(i.product.id, qty)}
                  onRemove={() => removeItem(i.product.id)}
                />
              ))
            )}
          </div>

          {/* Panel de checkout — abajo, inline (NO Sheet) */}
          {cart.length > 0 && (
            <div className="border-t shrink-0 bg-muted/20 flex flex-col max-h-[55vh]">
              {/* Opciones scrollables */}
              <div className="overflow-y-auto flex-1">
                <div className="p-3 space-y-2.5">
                  {/* Cliente + Método de pago en fila */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="w-3 h-3" /> Cliente
                        {selectedMethod?.type === "CUENTA" && (
                          <span className="text-red-600">*</span>
                        )}
                      </Label>
                      <Select
                        value={customerId || "none"}
                        onValueChange={(v) =>
                          setCustomerId(v === "none" ? "" : v)
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Mostrador" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Cliente mostrador</SelectItem>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} {c.phone && `(${c.phone})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Método de pago
                      </Label>
                      <Select
                        value={paymentMethodId}
                        onValueChange={setPaymentMethodId}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                              {m.surcharge > 0 && ` (+${m.surcharge}%)`}
                              {m.isDefault && " · predet."}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Warning cuenta corriente */}
                  {selectedMethod?.type === "CUENTA" && !customerId && (
                    <div className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 p-2 rounded border border-red-200">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Para cuenta corriente tenés que seleccionar un cliente.
                    </div>
                  )}
                  {selectedMethod?.type === "CUENTA" && customerId && (
                    <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                      Esta venta se registrará en la <strong>cuenta corriente</strong>{" "}
                      del cliente. El saldo se salda desde Clientes → Cuenta.
                    </div>
                  )}

                  {/* Promociones disponibles */}
                  {availablePromotions.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Promociones</p>
                      <div className="flex flex-wrap gap-1">
                        {availablePromotions.map((p) => (
                          <button
                            key={p.promotionId}
                            onClick={() =>
                              setAppliedPromotion(
                                appliedPromotion?.promotionId === p.promotionId
                                  ? null
                                  : p
                              )
                            }
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                              appliedPromotion?.promotionId === p.promotionId
                                ? "bg-indigo-600 text-white border-indigo-600"
                                : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                            }`}
                          >
                            {p.promotionName} · −
                            {formatCurrency(p.discountAmount, symbol)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Puntos de fidelización */}
                  {loyaltyProgram?.enabled && selectedCustomer && (
                    <div className="rounded-md border border-purple-200 bg-purple-50 p-2 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-purple-700">
                          Puntos ({selectedCustomer.loyaltyTier || "BRONCE"})
                        </span>
                        <span className="font-medium text-purple-800">
                          {Math.floor(selectedCustomer.loyaltyPoints || 0)} pts
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={maxRedeemablePoints}
                          value={pointsToRedeem || ""}
                          onChange={(e) =>
                            setPointsToRedeem(
                              Math.min(
                                maxRedeemablePoints,
                                Math.max(0, Number(e.target.value) || 0)
                              )
                            )
                          }
                          placeholder="0"
                          className="h-7 w-24 text-right"
                        />
                        <span className="text-xs text-purple-700">
                          = −{formatCurrency(pointsCurrencyDiscount, symbol)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 ml-auto"
                          onClick={() => setPointsToRedeem(maxRedeemablePoints)}
                        >
                          Máx
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Descuento, notas y QR — colapsable */}
                  <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs h-8 text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 mr-1 transition-transform ${
                            showAdvanced ? "rotate-180" : ""
                          }`}
                        />
                        Descuento, notas y pago QR
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Descuento ({symbol})
                          </Label>
                          <Input
                            type="number"
                            value={discount || ""}
                            placeholder="0"
                            onChange={(e) =>
                              setDiscount(Number(e.target.value))
                            }
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Notas
                          </Label>
                          <Input
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Ej: entrega parcial"
                            className="h-8"
                          />
                        </div>
                      </div>
                      {mpConfig?.active && mpConfig?.qrEnabled && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setQrDialogOpen(true)}
                        >
                          <QrCode className="w-3.5 h-3.5 mr-1" /> Pago con QR
                          (Mercado Pago)
                        </Button>
                      )}
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Totales */}
                  <div className="space-y-1 pt-2 border-t">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(subtotal, symbol)}</span>
                    </div>
                    {promotionDiscount > 0 && (
                      <div className="flex justify-between text-xs text-indigo-700">
                        <span>Promo aplicada</span>
                        <span>−{formatCurrency(promotionDiscount, symbol)}</span>
                      </div>
                    )}
                    {manualDiscount > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Descuento manual
                        </span>
                        <span>−{formatCurrency(manualDiscount, symbol)}</span>
                      </div>
                    )}
                    {pointsCurrencyDiscount > 0 && (
                      <div className="flex justify-between text-xs text-purple-700">
                        <span>Puntos canjeados</span>
                        <span>−{formatCurrency(pointsCurrencyDiscount, symbol)}</span>
                      </div>
                    )}
                    {taxEnabled && taxRate > 0 && taxAmount > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Impuesto ({taxRate}%)
                        </span>
                        <span>{formatCurrency(taxAmount, symbol)}</span>
                      </div>
                    )}
                    {surchargeAmount > 0 && (
                      <div className="flex justify-between text-xs text-amber-700">
                        <span>
                          Recargo {selectedMethod?.name} ({surchargeRate}%)
                        </span>
                        <span>+{formatCurrency(surchargeAmount, symbol)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Total + botón cobrar — siempre visible */}
              <div className="p-3 border-t bg-card shrink-0">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Total
                  </span>
                  <span className="text-2xl font-bold text-indigo-700">
                    {formatCurrency(total, symbol)}
                  </span>
                </div>
                <Button
                  className="w-full h-12 text-base bg-indigo-600 hover:bg-indigo-700"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canCheckout}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Cobrar {formatCurrency(total, symbol)}
                </Button>
                {!canCheckout && cart.length > 0 && (
                  <p className="text-[11px] text-amber-600 text-center mt-1">
                    {selectedMethod?.type === "CUENTA" && !customerId
                      ? "Seleccioná un cliente para cuenta corriente"
                      : "Seleccioná un método de pago"}
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ─── Dialog de confirmación (compacto, NO Sheet) ──────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              Confirmar venta
            </DialogTitle>
            <DialogDescription>
              Revisá el detalle y confirmá la venta
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(subtotal, symbol)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span>−{formatCurrency(totalDiscount, symbol)}</span>
                </div>
              )}
              {taxAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Impuesto ({taxRate}%)
                  </span>
                  <span>{formatCurrency(taxAmount, symbol)}</span>
                </div>
              )}
              {surchargeAmount > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>Recargo ({selectedMethod?.name})</span>
                  <span>+{formatCurrency(surchargeAmount, symbol)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1.5 border-t">
                <span>Total</span>
                <span className="text-indigo-700">
                  {formatCurrency(total, symbol)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Método de pago</p>
                <p className="font-medium">{selectedMethod?.name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="font-medium">
                  {selectedCustomer?.name || "Mostrador"}
                </p>
              </div>
            </div>

            {selectedMethod?.type === "CUENTA" && customerId && (
              <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                Esta venta se registrará en cuenta corriente. El cliente podrá
                saldarla después.
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmOpen(false)}
              disabled={processing}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              onClick={processSale}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Confirmar venta
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog de Pago QR Mercado Pago ───────────────────────────────────── */}
      <Dialog
        open={qrDialogOpen}
        onOpenChange={(v) => {
          setQrDialogOpen(v);
          if (!v) {
            setQrData(null);
            setQrPolling(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-blue-600" />
              Pago con QR — Mercado Pago
            </DialogTitle>
            <DialogDescription>
              Generá un código QR para que el cliente pague escaneando con su app.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <p className="text-xs text-muted-foreground">Total a cobrar</p>
              <p className="text-2xl font-bold text-indigo-700">
                {formatCurrency(total, symbol)}
              </p>
            </div>

            {!qrData && (
              <Button
                onClick={async () => {
                  setQrLoading(true);
                  try {
                    const saleResponse = await safeFetchJSON<any>("/api/sales", {
                      method: "POST",
                      body: JSON.stringify({
                        items: cart.map((i) => ({
                          productId: i.product.id,
                          quantity: i.qty,
                        })),
                        customerId: customerId || null,
                        discount: manualDiscount,
                        paymentMethodId,
                        notes,
                        taxRate: taxEnabled ? taxRate : 0,
                        branchId: branchId || null,
                        promotionId: appliedPromotion?.promotionId || null,
                        promotionDiscount:
                          appliedPromotion?.discountAmount || 0,
                        loyaltyPointsUsed: effectivePointsToRedeem || 0,
                      }),
                    });
                    if (!saleResponse.ok || !saleResponse.data) {
                      throw new Error(
                        saleResponse.error || "No se pudo crear la venta"
                      );
                    }
                    const saleData = saleResponse.data;

                    const qrResponse = await safeFetchJSON<any>(
                      "/api/mercadopago/create-order",
                      {
                        method: "POST",
                        body: JSON.stringify({
                          saleId: saleData.id,
                          amount: total,
                          description: `Compra ${store?.name || ""} #${saleData.id
                            .slice(-6)
                            .toUpperCase()}`,
                          externalReference: saleData.id,
                        }),
                      }
                    );
                    if (!qrResponse.ok || !qrResponse.data) {
                      throw new Error(
                        qrResponse.error || "No se pudo generar el QR"
                      );
                    }
                    setQrData({ ...qrResponse.data, saleId: saleData.id });
                  } catch (e: any) {
                    toast.error("Error al generar QR", {
                      description: e.message,
                    });
                  } finally {
                    setQrLoading(false);
                  }
                }}
                disabled={qrLoading || cart.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {qrLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <QrCode className="w-4 h-4 mr-2" />
                )}
                Generar QR de pago
              </Button>
            )}

            {qrData && (
              <>
                <div className="flex flex-col items-center gap-2">
                  {qrData.qrImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrData.qrImageUrl}
                      alt="QR de pago"
                      className="w-64 h-64 border rounded-lg"
                    />
                  )}
                  <p className="text-xs text-muted-foreground text-center">
                    Pedile al cliente que escanee este QR con su app de Mercado Pago
                  </p>
                  {qrData.qrCode && (
                    <details className="w-full">
                      <summary className="text-xs cursor-pointer text-muted-foreground">
                        Ver código copia y pega
                      </summary>
                      <Input
                        readOnly
                        value={qrData.qrCode}
                        className="mt-1 text-xs font-mono"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                    </details>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={qrPolling}
                    onClick={async () => {
                      setQrPolling(true);
                      try {
                        const statusRes = await safeFetchJSON<any>(
                          `/api/mercadopago/status?id=${qrData.paymentId}`
                        );
                        if (!statusRes.ok || !statusRes.data) {
                          throw new Error(
                            statusRes.error ||
                              "No se pudo consultar el estado del pago"
                          );
                        }
                        const data = statusRes.data;
                        if (data.status === "APPROVED") {
                          toast.success("Pago aprobado!");
                          setLastSale({
                            id: qrData.saleId,
                            createdAt: new Date().toISOString(),
                            items: cart,
                            customer: customers.find((c) => c.id === customerId),
                            paymentMethod: { name: "Mercado Pago QR" },
                            discount: totalDiscount,
                            tax: taxAmount,
                            surcharge: surchargeAmount,
                            total,
                            subtotal,
                            appliedPromotion,
                            pointsUsed: effectivePointsToRedeem,
                          });
                          setQrDialogOpen(false);
                          setReceiptOpen(true);
                          clearCart();
                          setQrData(null);
                          try {
                            const refreshedRes = await safeFetchJSON<Product[]>(
                              "/api/products"
                            );
                            const refreshed = Array.isArray(refreshedRes.data)
                              ? refreshedRes.data
                              : [];
                            setProducts(refreshed.filter((x: Product) => x.active));
                          } catch {
                            // best-effort
                          }
                        } else if (
                          data.status === "REJECTED" ||
                          data.status === "CANCELLED"
                        ) {
                          toast.error(`Pago ${data.status.toLowerCase()}`);
                        } else {
                          toast.info(`Estado: ${data.status || "PENDIENTE"}`);
                        }
                      } catch (e: any) {
                        toast.error("Error al consultar el pago", {
                          description: e.message,
                        });
                      } finally {
                        setQrPolling(false);
                      }
                    }}
                  >
                    {qrPolling ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    )}
                    Verificar pago
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQrData(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  El pago se confirma automáticamente cuando se acredite. También
                  podés verificar manualmente.
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Sheet de recibo (post-venta) ─────────────────────────────────────── */}
      <Sheet open={receiptOpen} onOpenChange={setReceiptOpen}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <SheetTitle>¡Venta registrada!</SheetTitle>
                <SheetDescription>
                  Comprobante #{lastSale?.id?.slice(-6).toUpperCase()}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {lastSale && (
            <div className="py-4 space-y-3">
              <div className="text-center pb-3 border-b">
                <p className="font-semibold">{store?.name}</p>
                {store?.address && (
                  <p className="text-xs text-muted-foreground">{store.address}</p>
                )}
                {store?.phone && (
                  <p className="text-xs text-muted-foreground">
                    Tel: {store.phone}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(lastSale.createdAt).toLocaleString("es-AR")}
                </p>
              </div>

              {lastSale.customer && (
                <p className="text-sm">
                  Cliente: <strong>{lastSale.customer.name}</strong>
                </p>
              )}

              <div className="space-y-1">
                {lastSale.items.map((i: CartItem) => (
                  <div
                    key={i.product.id}
                    className="flex justify-between text-sm"
                  >
                    <span>
                      {i.qty} x {i.product.name}
                    </span>
                    <span>
                      {formatCurrency(i.product.salePrice * i.qty, symbol)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t pt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(lastSale.subtotal, symbol)}</span>
                </div>
                {lastSale.discount > 0 && (
                  <div className="flex justify-between">
                    <span>Descuento</span>
                    <span>-{formatCurrency(lastSale.discount, symbol)}</span>
                  </div>
                )}
                {lastSale.tax > 0 && (
                  <div className="flex justify-between">
                    <span>Impuesto</span>
                    <span>{formatCurrency(lastSale.tax, symbol)}</span>
                  </div>
                )}
                {lastSale.surcharge > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>
                      Recargo {lastSale.paymentMethod?.name}
                      {lastSale.paymentMethod?.surcharge
                        ? ` (${lastSale.paymentMethod.surcharge}%)`
                        : ""}
                    </span>
                    <span>+{formatCurrency(lastSale.surcharge, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>TOTAL</span>
                  <span>{formatCurrency(lastSale.total, symbol)}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Pagado con: {lastSale.paymentMethod?.name || "—"}
                </p>
              </div>
            </div>
          )}

          <SheetFooter className="flex-col gap-2">
            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={printThermalSale}
                title="Genera un archivo .bin con comandos ESC/POS para impresora térmica"
              >
                <Printer className="w-4 h-4 mr-2" />
                Térmica
              </Button>
            </div>
            <Button
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              onClick={() => setReceiptOpen(false)}
            >
              Nueva venta
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ════════════════════════════════════════════════════════════════════════
          MODAL DE RECONCILIACIÓN DE CARRITO
          Se muestra cuando se recuperó un carrito guardado pero algunos
          productos ya no existen o cambiaron de stock/precio desde que se guardó. */}
      <Dialog open={reconcileModalOpen} onOpenChange={setReconcileModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Carrito recuperado con cambios
            </DialogTitle>
            <DialogDescription>
              Detectamos que tenías una venta en curso guardada del{" "}
              {cartPersistence.reconcileInfo
                ? new Date(
                    cartPersistence.reconcileInfo.items[0]?.product?.id
                      ? Date.now()
                      : Date.now()
                  ).toLocaleString("es-AR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : ""}
              . Algunos productos cambiaron desde entonces y los ajustamos
              automáticamente:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {cartPersistence.reconcileInfo?.removedCount &&
            cartPersistence.reconcileInfo.removedCount > 0 ? (
              <div className="rounded-md bg-red-50 border border-red-200 p-3">
                <p className="text-sm font-medium text-red-800 mb-1">
                  {cartPersistence.reconcileInfo.removedCount} producto
                  {cartPersistence.reconcileInfo.removedCount === 1
                    ? " quitado"
                    : " quitados"}
                </p>
                <p className="text-xs text-red-700">
                  {cartPersistence.reconcileInfo.removedProductNames
                    .slice(0, 5)
                    .join(", ")}
                  {cartPersistence.reconcileInfo.removedProductNames.length >
                    5 && "…"}
                </p>
              </div>
            ) : null}
            {cartPersistence.reconcileInfo?.adjustedCount &&
            cartPersistence.reconcileInfo.adjustedCount > 0 ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
                <p className="text-sm font-medium text-amber-800">
                  {cartPersistence.reconcileInfo.adjustedCount} producto
                  {cartPersistence.reconcileInfo.adjustedCount === 1
                    ? " ajustado"
                    : " ajustados"}
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Cambió el precio o el stock disponible desde tu última sesión.
                  Las cantidades fueron limitadas al stock actual.
                </p>
              </div>
            ) : null}
            <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-sm font-medium text-emerald-800">
                Carrito restaurado:{" "}
                {cartPersistence.reconcileInfo?.items.length || 0} productos
                listos para cobrar
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                cartPersistence.discardPersisted();
                clearCart();
                setReconcileModalOpen(false);
              }}
            >
              Descartar y empezar de cero
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={() => setReconcileModalOpen(false)}
            >
              Continuar con este carrito
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
