"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Truck,
  Loader2,
  PackagePlus,
  X,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime } from "@/lib/constants";

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  contactName?: string;
  notes?: string;
  active: boolean;
  _count?: { purchaseOrders: number };
}

interface PurchaseOrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  subtotal: number;
  product: { name: string; unit: string };
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  notes: string | null;
  orderedAt: string;
  receivedAt: string | null;
  supplierName: string;
  supplier?: { name: string };
  user?: { name: string };
  items: PurchaseOrderItem[];
}

interface Product {
  id: string;
  name: string;
  unit: string;
  costPrice: number;
  active?: boolean;
}

const emptySupplier = {
  id: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  contactName: "",
  notes: "",
  active: true,
};

export function PurchasesView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [tab, setTab] = useState("orders");

  // Proveedores
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supSearch, setSupSearch] = useState("");
  const [supFormOpen, setSupFormOpen] = useState(false);
  const [supForm, setSupForm] = useState<any>(emptySupplier);
  const [supSaving, setSupSaving] = useState(false);
  const [deleteSupId, setDeleteSupId] = useState<string | null>(null);

  // Órdenes
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderFilter, setOrderFilter] = useState("all");

  // Nueva OC
  const [ocOpen, setOcOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [ocSupplierId, setOcSupplierId] = useState<string>("");
  const [ocItems, setOcItems] = useState<{ productId: string; quantity: number; unitCost: number }[]>([]);
  const [ocNotes, setOcNotes] = useState("");
  const [ocSaving, setOcSaving] = useState(false);
  const [ocReceiveNow, setOcReceiveNow] = useState(true);

  // Detalle
  const [detailOrder, setDetailOrder] = useState<PurchaseOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  async function loadSuppliers() {
    const res = await fetch("/api/suppliers");
    const data = await res.json();
    setSuppliers(data);
  }

  async function loadOrders() {
    setOrdersLoading(true);
    const res = await fetch("/api/purchase-orders?limit=100");
    const data = await res.json();
    setOrders(data);
    setOrdersLoading(false);
  }

  async function loadProducts() {
    const res = await fetch("/api/products");
    const data = await res.json();
    setProducts(data.filter((p: Product) => p.active));
  }

  useEffect(() => {
    loadSuppliers();
    loadOrders();
  }, []);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (!supSearch) return true;
      const q = supSearch.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.phone?.includes(q) || s.contactName?.toLowerCase().includes(q);
    });
  }, [suppliers, supSearch]);

  const filteredOrders = useMemo(() => {
    if (orderFilter === "all") return orders;
    return orders.filter((o) => o.status === orderFilter);
  }, [orders, orderFilter]);

  async function saveSupplier() {
    if (!supForm.name) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSupSaving(true);
    try {
      const method = supForm.id ? "PUT" : "POST";
      const res = await fetch("/api/suppliers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(supForm.id ? "Proveedor actualizado" : "Proveedor creado");
      setSupFormOpen(false);
      loadSuppliers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSupSaving(false);
    }
  }

  async function deleteSupplier() {
    if (!deleteSupId) return;
    try {
      const res = await fetch(`/api/suppliers?id=${deleteSupId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proveedor eliminado");
      setDeleteSupId(null);
      loadSuppliers();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function openNewOC() {
    setOcSupplierId("");
    setOcItems([]);
    setOcNotes("");
    setOcReceiveNow(true);
    if (products.length === 0) loadProducts();
    setOcOpen(true);
  }

  function addProductToOC(productId: string) {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    if (ocItems.find((i) => i.productId === productId)) {
      toast.error("Ya está en la orden");
      return;
    }
    setOcItems([
      ...ocItems,
      { productId, quantity: 1, unitCost: prod.costPrice },
    ]);
  }

  function updateOCItem(productId: string, field: "quantity" | "unitCost", value: number) {
    setOcItems((prev) =>
      prev.map((i) =>
        i.productId === productId ? { ...i, [field]: Math.max(0, value) } : i
      )
    );
  }

  function removeOCItem(productId: string) {
    setOcItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  const ocTotal = ocItems.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  async function saveOC() {
    if (ocItems.length === 0) {
      toast.error("Agregá al menos 1 producto");
      return;
    }
    setOcSaving(true);
    try {
      const supplier = suppliers.find((s) => s.id === ocSupplierId);
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: ocSupplierId || null,
          supplierName: supplier?.name || "Sin proveedor",
          items: ocItems,
          notes: ocNotes,
          receive: ocReceiveNow,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(ocReceiveNow ? "Orden registrada y mercadería ingresada al stock" : "Orden creada (pendiente de recepción)");
      setOcOpen(false);
      loadOrders();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcSaving(false);
    }
  }

  async function receiveOrder(id: string) {
    try {
      const res = await fetch("/api/purchase-orders/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Orden recibida. Stock actualizado.");
      loadOrders();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de proveedores y órdenes de compra
          </p>
        </div>
        <Button onClick={openNewOC} className="bg-indigo-600 hover:bg-indigo-700">
          <PackagePlus className="w-4 h-4 mr-2" />
          Nueva orden de compra
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orders">Órdenes de compra</TabsTrigger>
          <TabsTrigger value="suppliers">Proveedores</TabsTrigger>
        </TabsList>

        {/* ÓRDENES */}
        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardContent className="p-3 flex flex-wrap gap-2 items-center">
              <Select value={orderFilter} onValueChange={setOrderFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="PENDIENTE">Pendientes</SelectItem>
                  <SelectItem value="RECIBIDA">Recibidas</SelectItem>
                  <SelectItem value="ANULADA">Anuladas</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredOrders.length} órdenes
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {ordersLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
                  Cargando órdenes...
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-12 text-center">
                  <Truck className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No hay órdenes de compra todavía
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>N°</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead className="text-center">Ítems</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-center">Estado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                          <TableCell className="text-xs">
                            {formatDateTime(o.orderedAt)}
                          </TableCell>
                          <TableCell className="text-sm">{o.supplierName}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">{o.items.length}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(o.total, symbol)}
                          </TableCell>
                          <TableCell className="text-center">
                            {o.status === "RECIBIDA" ? (
                              <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100">
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Recibida
                              </Badge>
                            ) : o.status === "PENDIENTE" ? (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                                <Clock className="w-3 h-3 mr-1" /> Pendiente
                              </Badge>
                            ) : (
                              <Badge variant="outline">{o.status}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={() => {
                                setDetailOrder(o);
                                setDetailOpen(true);
                              }}
                            >
                              Ver
                            </Button>
                            {o.status === "PENDIENTE" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-indigo-700"
                                onClick={() => receiveOrder(o.id)}
                              >
                                Recibir
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* PROVEEDORES */}
        <TabsContent value="suppliers" className="space-y-4">
          <Card>
            <CardContent className="p-3 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar proveedor..."
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                onClick={() => {
                  setSupForm({ ...emptySupplier });
                  setSupFormOpen(true);
                }}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4 mr-2" /> Nuevo proveedor
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {filteredSuppliers.length === 0 ? (
                <div className="p-12 text-center">
                  <Truck className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No hay proveedores cargados
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead className="hidden sm:table-cell">Contacto</TableHead>
                        <TableHead className="hidden lg:table-cell">Dirección</TableHead>
                        <TableHead className="text-center">Órdenes</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSuppliers.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>
                            <p className="font-medium">{s.name}</p>
                            {s.contactName && (
                              <p className="text-xs text-muted-foreground">{s.contactName}</p>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">
                            <div>
                              {s.phone && <p>{s.phone}</p>}
                              {s.email && <p className="text-muted-foreground">{s.email}</p>}
                              {!s.phone && !s.email && <span className="text-muted-foreground">—</span>}
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm">
                            {s.address || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">{s._count?.purchaseOrders || 0}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setSupForm({ ...s });
                                setSupFormOpen(true);
                              }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600"
                              onClick={() => setDeleteSupId(s.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Diálogo nueva OC */}
      <Dialog open={ocOpen} onOpenChange={setOcOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva orden de compra</DialogTitle>
            <DialogDescription>
              Registrá la mercadería que comprás a un proveedor. Podés recibirla ahora
              (actualiza stock) o dejarla pendiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select value={ocSupplierId || "none"} onValueChange={(v) => setOcSupplierId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proveedor</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Agregar producto</Label>
              <Select value="" onValueChange={(v) => addProductToOC(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto..." />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {ocItems.length > 0 && (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-24">Cant.</TableHead>
                      <TableHead className="w-32">Costo unit.</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ocItems.map((i) => {
                      const prod = products.find((p) => p.id === i.productId);
                      return (
                        <TableRow key={i.productId}>
                          <TableCell className="text-sm">
                            {prod?.name || "??"}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({prod?.unit || "u"})
                            </span>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={i.quantity}
                              onChange={(e) => updateOCItem(i.productId, "quantity", Number(e.target.value))}
                              className="h-8 px-2"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={i.unitCost}
                              onChange={(e) => updateOCItem(i.productId, "unitCost", Number(e.target.value))}
                              className="h-8 px-2"
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(i.quantity * i.unitCost, symbol)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-600"
                              onClick={() => removeOCItem(i.productId)}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex justify-between items-center p-3 rounded-md bg-indigo-50 border border-indigo-200">
              <span className="text-sm font-medium text-indigo-800">Total orden</span>
              <span className="text-xl font-bold text-indigo-700">
                {formatCurrency(ocTotal, symbol)}
              </span>
            </div>

            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={ocNotes}
                onChange={(e) => setOcNotes(e.target.value)}
                rows={2}
                placeholder="Ej: Remito N°, factura, observaciones..."
              />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={ocReceiveNow}
                onChange={(e) => setOcReceiveNow(e.target.checked)}
                className="w-4 h-4 accent-indigo-600"
              />
              Recibir mercadería ahora (actualiza stock y costo de productos)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOcOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={saveOC}
              disabled={ocSaving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {ocSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {ocReceiveNow ? "Registrar y recibir" : "Crear orden pendiente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo detalle orden */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Orden {detailOrder?.orderNumber}
            </DialogTitle>
            <DialogDescription>
              {detailOrder && formatDateTime(detailOrder.orderedAt)} · {detailOrder?.supplierName}
            </DialogDescription>
          </DialogHeader>
          {detailOrder && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    detailOrder.status === "RECIBIDA"
                      ? "bg-indigo-100 text-indigo-800 hover:bg-indigo-100"
                      : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                  }
                >
                  {detailOrder.status}
                </Badge>
                {detailOrder.receivedAt && (
                  <span className="text-xs text-muted-foreground">
                    Recibida: {formatDateTime(detailOrder.receivedAt)}
                  </span>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailOrder.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="text-sm">{it.product.name}</TableCell>
                      <TableCell className="text-right">{it.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(it.unitCost, symbol)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(it.subtotal, symbol)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-between p-3 rounded-md bg-muted">
                <span className="font-medium">Total</span>
                <span className="font-bold text-indigo-700">
                  {formatCurrency(detailOrder.total, symbol)}
                </span>
              </div>
              {detailOrder.notes && (
                <p className="text-sm text-muted-foreground">
                  <strong>Notas:</strong> {detailOrder.notes}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {detailOrder?.status === "PENDIENTE" && (
              <Button
                className="bg-indigo-600 hover:bg-indigo-700"
                onClick={() => {
                  receiveOrder(detailOrder.id);
                  setDetailOpen(false);
                }}
              >
                <PackagePlus className="w-4 h-4 mr-2" />
                Recibir mercadería
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo editar proveedor */}
      <Dialog open={supFormOpen} onOpenChange={setSupFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{supForm.id ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nombre *</Label>
              <Input value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Contacto</Label>
              <Input value={supForm.contactName} onChange={(e) => setSupForm({ ...supForm, contactName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input value={supForm.address} onChange={(e) => setSupForm({ ...supForm, address: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Notas</Label>
              <Textarea value={supForm.notes} onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupFormOpen(false)}>Cancelar</Button>
            <Button onClick={saveSupplier} disabled={supSaving} className="bg-indigo-600 hover:bg-indigo-700">
              {supSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {supForm.id ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
