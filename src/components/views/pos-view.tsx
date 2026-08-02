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
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, PAYMENT_METHODS, unitLabel } from "@/lib/constants";

interface Product {
  id: string;
  name: string;
  barcode?: string;
  salePrice: number;
  stock: number;
  unit: string;
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
}

export function PosView() {
  const { store, user } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("EFECTIVO");
  const [notes, setNotes] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const symbol = store?.currencySymbol || "$";
  const taxEnabled = store?.taxEnabled;
  const taxRate = store?.taxRate || 0;
  const isCajero = user?.role === "CAJERO";

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/customers").then((r) => r.json()),
    ]).then(([p, c, cust]) => {
      setProducts(p.filter((x: Product) => x.active));
      setCategories(c);
      setCustomers(cust);
      setLoading(false);
    });
  }, []);

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

  // Atajo: Enter en el buscador si solo hay 1 resultado
  function handleSearchEnter(e: React.KeyboardEvent) {
    if (e.key === "Enter" && filtered.length === 1) {
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
  const discountAmount = Math.min(discount, subtotal);
  const taxable = subtotal - discountAmount;
  const taxAmount = taxEnabled ? taxable * (taxRate / 100) : 0;
  const total = taxable + taxAmount;

  async function processSale() {
    if (cart.length === 0) {
      toast.error("El carrito está vacío");
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
          discount: discountAmount,
          paymentMethod,
          notes,
          taxRate: taxEnabled ? taxRate : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Venta registrada!");
      setLastSale({
        ...data,
        items: cart,
        customer: customers.find((c) => c.id === customerId),
        paymentMethod,
        discount: discountAmount,
        tax: taxAmount,
        total,
        subtotal,
      });
      setCheckoutOpen(false);
      setReceiptOpen(true);
      clearCart();
      // Refrescar stock
      const refreshed = await fetch("/api/products").then((r) => r.json());
      setProducts(refreshed.filter((x: Product) => x.active));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4 h-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Punto de Venta</h1>
        <p className="text-sm text-muted-foreground">
          Buscá productos, agregalos al carrito y registrá la venta
        </p>
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
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-muted-foreground">Descuento</span>
                    <Input
                      type="number"
                      value={discount || ""}
                      placeholder="0"
                      onChange={(e) => setDiscount(Number(e.target.value))}
                      className="h-7 w-24 text-right"
                    />
                  </div>
                  {taxEnabled && taxRate > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Impuesto ({taxRate}%)
                      </span>
                      <span>{formatCurrency(taxAmount, symbol)}</span>
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
              <Label>Cliente (opcional)</Label>
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
            </div>

            <div className="space-y-2">
              <Label>Método de pago</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
              {discountAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span>-{formatCurrency(discountAmount, symbol)}</span>
                </div>
              )}
              {taxAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Impuesto</span>
                  <span>{formatCurrency(taxAmount, symbol)}</span>
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
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>TOTAL</span>
                  <span>{formatCurrency(lastSale.total, symbol)}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Pagado con:{" "}
                  {PAYMENT_METHODS.find((m) => m.value === lastSale.paymentMethod)?.label}
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
