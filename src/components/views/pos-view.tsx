"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, unitLabel } from "@/lib/constants";
import { calculateMaxRedeemablePoints, pointsToCurrency } from "@/lib/loyalty";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Product {
  id: string;
  name: string;
  barcode?: string;
  sku?: string;
  salePrice: number;
  stock: number;
  unit: string;
  active: boolean;
  category?: { id: string; name: string };
  categoryId?: string;
}

interface CartItem {
  product: Product;
  qty: number;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  loyaltyPoints?: number;
  loyaltyTier?: string;
  totalSpent?: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
  isMain: boolean;
  active: boolean;
}

interface AppliedPromotion {
  promotionId: string;
  promotionName: string;
  type: string;
  discountAmount: number;
  description: string;
}

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  surcharge: number;
  active: boolean;
  isDefault: boolean;
}

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
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [discount, setDiscount] = useState(0);
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
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

  const symbol = store?.currencySymbol || "$";
  const taxEnabled = store?.taxEnabled;
  const taxRate = store?.taxRate || 0;
  const isCajero = user?.role === "CAJERO";

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/customers").then((r) => r.json()),
      fetch("/api/payment-methods").then((r) => r.json()),
      fetch("/api/mercadopago/config").then((r) => r.json()),
      fetch("/api/branches").then((r) => r.json()),
      fetch("/api/loyalty").then((r) => r.json()),
    ]).then(([p, c, cust, pm, mp, brs, loy]) => {
      setProducts(p.filter((x: Product) => x.active));
      setCategories(c);
      setCustomers(cust);
      const activePM = (pm as PaymentMethod[]).filter((m) => m.active);
      setPaymentMethods(activePM);
      const def = activePM.find((m) => m.isDefault) || activePM[0];
      if (def) setPaymentMethodId(def.id);
      setMpConfig(mp);
      setBranches(brs || []);
      // Seleccionar sucursal principal por defecto
      const main = (brs as Branch[])?.find((b) => b.isMain && b.active);
      if (main) setBranchId(main.id);
      setLoyaltyProgram(loy);
      setLoading(false);
    });
  }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.barcode?.includes(search);
      const matchCat = filterCat === "all" || p.categoryId === filterCat;
      return matchSearch && matchCat;
    });
  }, [products, search, filterCat]);

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
  }, []);

  // Atajo: Enter en el buscador
  // 1. Si el texto matchea exacto el barcode/SKU de un producto, lo agrega directo (scanner)
  // 2. Si solo hay 1 resultado filtrado, lo agrega
  function handleSearchEnter(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const term = search.trim();
    if (!term) return;
    // Match exacto por barcode o SKU
    const exact = products.find(
      (p) => p.barcode === term || (p.sku && p.sku.toLowerCase() === term.toLowerCase())
    );
    if (exact) {
      addToCart(exact);
      setSearch("");
      return;
    }
    // Un solo resultado filtrado → agregar
    if (filtered.length === 1) {
      addToCart(filtered[0]);
      setSearch("");
    }
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product.id !== productId) return i;
          const nextQty = i.qty + delta;
          if (nextQty > i.product.stock) {
            toast.error(`Solo hay ${i.product.stock} ${unitLabel(i.product.unit).toLowerCase()}s disponibles`);
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
  }

  const subtotal = cart.reduce((s, i) => s + i.product.salePrice * i.qty, 0);

  // Promoción aplicada (descuento automático)
  const promotionDiscount = appliedPromotion?.discountAmount || 0;
  // Puntos a canjear (validar máximo permitido)
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

  // Evaluar promociones disponibles (al cambiar carrito)
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
        // Auto-aplicar la mejor
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

  // Resetear puntos a canjear si cambia el cliente
  useEffect(() => {
    setPointsToRedeem(0);
  }, [customerId]);

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
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
      setCheckoutOpen(false);
      setReceiptOpen(true);
      clearCart();
      setAppliedPromotion(null);
      setPointsToRedeem(0);
      // Refrescar stock
      const refreshed = await fetch("/api/products").then((r) => r.json());
      setProducts(refreshed.filter((x: Product) => x.active));
      // Refrescar clientes (puntos actualizados)
      const refreshedCust = await fetch("/api/customers").then((r) => r.json());
      setCustomers(refreshedCust);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4 h-full">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Punto de Venta</h1>
          <p className="text-sm text-muted-foreground">
            Buscá productos, agregalos al carrito y registrá la venta
          </p>
        </div>
        {branches.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Sucursal:</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-48 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches
                  .filter((b) => b.active)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.isMain ? "★ " : ""}{b.name} ({b.code})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Productos - 3 cols */}
        <div className="lg:col-span-3 space-y-3">
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="relative">
                <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Escanear código o buscar producto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchEnter}
                  className="pl-9 h-11 text-base"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <Button
                  variant={filterCat === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterCat("all")}
                  className={
                    filterCat === "all" ? "bg-emerald-600 hover:bg-emerald-700" : ""
                  }
                >
                  Todos
                </Button>
                {categories.map((c) => (
                  <Button
                    key={c.id}
                    variant={filterCat === c.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilterCat(c.id)}
                    className={
                      filterCat === c.id ? "bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap" : "whitespace-nowrap"
                    }
                  >
                    {c.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-600" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto pr-1">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  disabled={p.stock <= 0}
                  className="group text-left p-3 rounded-lg border border-emerald-100 bg-white hover:border-emerald-400 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="text-sm font-medium line-clamp-2 min-h-[2.5rem]">
                    {p.name}
                  </p>
                  <p className="text-sm font-bold text-emerald-700 mt-1">
                    {formatCurrency(p.salePrice, symbol)}
                  </p>
                  <p
                    className={`text-xs mt-0.5 ${
                      p.stock <= 0
                        ? "text-red-600"
                        : p.stock <= 5
                        ? "text-amber-600"
                        : "text-muted-foreground"
                    }`}
                  >
                    {p.stock <= 0
                      ? "Sin stock"
                      : `${p.stock} ${p.unit === "KG" ? "kg" : "u"}`}
                  </p>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full p-8 text-center text-muted-foreground">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No se encontraron productos</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Carrito - 2 cols */}
        <div className="lg:col-span-2">
          <Card className="sticky top-20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" />
                  Carrito ({cart.length})
                </CardTitle>
                {cart.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearCart}>
                    Vaciar
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <ShoppingCart className="w-10 h-10 mx-auto opacity-30 mb-2" />
                  <p className="text-sm">Agregá productos al carrito</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  {cart.map((i) => (
                    <div
                      key={i.product.id}
                      className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{i.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(i.product.salePrice, symbol)} ·{" "}
                          {i.product.unit === "KG" ? "kg" : "u"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateQty(i.product.id, -1)}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <Input
                          type="number"
                          value={i.qty}
                          onChange={(e) =>
                            setQty(i.product.id, Number(e.target.value))
                          }
                          className="h-7 w-12 text-center px-1"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateQty(i.product.id, 1)}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-600"
                          onClick={() => removeItem(i.product.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-sm font-semibold w-20 text-right">
                        {formatCurrency(i.product.salePrice * i.qty, symbol)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {cart.length > 0 && (
                <div className="space-y-2 pt-3 border-t">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(subtotal, symbol)}</span>
                  </div>
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
                                ? "bg-emerald-600 text-white border-emerald-600"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            }`}
                          >
                            {p.promotionName} · −{formatCurrency(p.discountAmount, symbol)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {promotionDiscount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700">
                      <span>Promo aplicada</span>
                      <span>−{formatCurrency(promotionDiscount, symbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-muted-foreground">Descuento manual</span>
                    <Input
                      type="number"
                      value={discount || ""}
                      placeholder="0"
                      onChange={(e) => setDiscount(Number(e.target.value))}
                      className="h-7 w-24 text-right"
                    />
                  </div>
                  {/* Puntos de fidelización */}
                  {loyaltyProgram?.enabled && selectedCustomer && (
                    <div className="rounded-md border border-purple-200 bg-purple-50 p-2 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-purple-700">
                          Puntos disponibles ({selectedCustomer.loyaltyTier || "BRONCE"})
                        </span>
                        <span className="font-medium text-purple-800">
                          {Math.floor(selectedCustomer.loyaltyPoints || 0)}
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
                  {taxEnabled && taxRate > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Impuesto ({taxRate}%)
                      </span>
                      <span>{formatCurrency(taxAmount, symbol)}</span>
                    </div>
                  )}
                  {surchargeAmount > 0 && (
                    <div className="flex justify-between text-sm text-amber-700">
                      <span>
                        Recargo {selectedMethod?.name} ({surchargeRate}%)
                      </span>
                      <span>+{formatCurrency(surchargeAmount, symbol)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>Total</span>
                    <span className="text-emerald-700">
                      {formatCurrency(total, symbol)}
                    </span>
                  </div>

                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 h-11 text-base"
                    onClick={() => setCheckoutOpen(true)}
                  >
                    Cobrar {formatCurrency(total, symbol)}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Checkout sheet */}
      <Sheet open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Confirmar venta</SheetTitle>
            <SheetDescription>
              Revisá los detalles y registrá la venta
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cliente {selectedMethod?.type === "CUENTA" && "*"}</Label>
              <Select
                value={customerId || "none"}
                onValueChange={(v) =>
                  setCustomerId(v === "none" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Cliente mostrador" />
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
              {selectedMethod?.type === "CUENTA" && !customerId && (
                <p className="text-xs text-red-600">
                  Para vender en cuenta corriente tenés que seleccionar un cliente.
                </p>
              )}
              {selectedMethod?.type === "CUENTA" && customerId && (
                <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                  Esta venta se registrará en la <strong>cuenta corriente</strong> de
                  este cliente. El saldo se podrá saldar desde Clientes → Cuenta.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Método de pago</Label>
                {mpConfig?.active && mpConfig?.qrEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQrDialogOpen(true)}
                    className="text-xs h-7"
                  >
                    <QrCode className="w-3 h-3 mr-1" />
                    Pago QR (MP)
                  </Button>
                )}
              </div>
              <Select
                value={paymentMethodId}
                onValueChange={setPaymentMethodId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar método..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                      {m.surcharge > 0 && ` (+${m.surcharge}%)`}
                      {m.isDefault && " · predeterminado"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {paymentMethods.length === 0 && (
                <p className="text-xs text-amber-600">
                  No hay métodos de pago configurados. Pedile al admin que los
                  cargue en Configuración.
                </p>
              )}
            </div>

            {/* Dialog de Pago QR Mercado Pago */}
            <Dialog open={qrDialogOpen} onOpenChange={(v) => {
              setQrDialogOpen(v);
              if (!v) {
                setQrData(null);
                setQrPolling(false);
              }
            }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-blue-600" />
                    Pago con QR - Mercado Pago
                  </DialogTitle>
                  <DialogDescription>
                    Generá un código QR para que el cliente pague escaneando con su app.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2">
                  <div className="bg-muted/50 rounded-md p-3 text-center">
                    <p className="text-xs text-muted-foreground">Total a cobrar</p>
                    <p className="text-2xl font-bold text-emerald-700">
                      {formatCurrency(total, symbol)}
                    </p>
                  </div>

                  {!qrData && (
                    <Button
                      onClick={async () => {
                        setQrLoading(true);
                        try {
                          // 1. Crear la venta primero (sin cobrar todavía)
                          const saleRes = await fetch("/api/sales", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
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
                          const saleData = await saleRes.json();
                          if (!saleRes.ok) throw new Error(saleData.error);

                          // 2. Crear orden QR en Mercado Pago
                          const qrRes = await fetch("/api/mercadopago/create-order", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              saleId: saleData.id,
                              amount: total,
                              description: `Compra ${store?.name || ""} #${saleData.id.slice(-6).toUpperCase()}`,
                              externalReference: saleData.id,
                            }),
                          });
                          const qrJson = await qrRes.json();
                          if (!qrRes.ok) throw new Error(qrJson.error);
                          setQrData({ ...qrJson, saleId: saleData.id });
                        } catch (e: any) {
                          toast.error(e.message);
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
                              const res = await fetch(`/api/mercadopago/status?id=${qrData.paymentId}`);
                              const data = await res.json();
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
                                setCheckoutOpen(false);
                                setReceiptOpen(true);
                                clearCart();
                                setQrData(null);
                                const refreshed = await fetch("/api/products").then((r) => r.json());
                                setProducts(refreshed.filter((x: Product) => x.active));
                              } else if (data.status === "REJECTED" || data.status === "CANCELLED") {
                                toast.error(`Pago ${data.status.toLowerCase()}`);
                              } else {
                                toast.info(`Estado: ${data.status || "PENDIENTE"}`);
                              }
                            } catch (e: any) {
                              toast.error(e.message);
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
                        El pago se confirma automáticamente cuando se acredite.
                        También podés verificar manualmente.
                      </p>
                    </>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Entrega parcial, pedido especial..."
              />
            </div>

            <div className="p-3 rounded-md bg-muted/50 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(subtotal, symbol)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span>-{formatCurrency(totalDiscount, symbol)}</span>
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
                  <span>
                    Recargo {selectedMethod?.name} ({surchargeRate}%)
                  </span>
                  <span>+{formatCurrency(surchargeAmount, symbol)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1 border-t">
                <span>Total</span>
                <span className="text-emerald-700">
                  {formatCurrency(total, symbol)}
                </span>
              </div>
            </div>
          </div>

          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setCheckoutOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={processSale}
              disabled={processing}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Confirmar venta
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Receipt sheet */}
      <Sheet open={receiptOpen} onOpenChange={setReceiptOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
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
                  <p className="text-xs text-muted-foreground">Tel: {store.phone}</p>
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
                  <div key={i.product.id} className="flex justify-between text-sm">
                    <span>
                      {i.qty} x {i.product.name}
                    </span>
                    <span>{formatCurrency(i.product.salePrice * i.qty, symbol)}</span>
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

          <SheetFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.print()}
            >
              <Printer className="w-4 h-4 mr-2" />
              Imprimir
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setReceiptOpen(false)}
            >
              Nueva venta
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
