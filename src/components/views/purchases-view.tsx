"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Upload,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";
import { ImportDialog } from "@/components/import-dialog";
import { SUPPLIER_IMPORT_FIELDS } from "@/lib/import-config";

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
  const [supImportOpen, setSupImportOpen] = useState(false);

  // Órdenes
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderSupplierFilter, setOrderSupplierFilter] = useState("all");
  const [orderFromFilter, setOrderFromFilter] = useState("");
  const [orderToFilter, setOrderToFilter] = useState("");

  // Nueva OC
  const [ocOpen, setOcOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [ocSupplierId, setOcSupplierId] = useState<string>("");
  const [ocItems, setOcItems] = useState<{ productId: string; quantity: number; unitCost: number }[]>([]);
  const [ocNotes, setOcNotes] = useState("");
  const [ocSaving, setOcSaving] = useState(false);
  const [ocReceiveNow, setOcReceiveNow] = useState(true);
  // Modo edición: si está seteado, el diálogo de OC opera en modo PUT
  const [ocEditingId, setOcEditingId] = useState<string | null>(null);

  // Detalle
  const [detailOrder, setDetailOrder] = useState<PurchaseOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Anular
  const [annulOrder, setAnnulOrder] = useState<PurchaseOrder | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [annulLoading, setAnnulLoading] = useState(false);

  async function loadSuppliers() {
    try {
      const data = await safeFetchArray<Supplier>("/api/suppliers");
      setSuppliers(data);
    } catch (e: any) {
      toast.error("Error al cargar proveedores", { description: e?.message });
      setSuppliers([]);
    }
  }

  async function loadOrders() {
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (orderFilter !== "all") params.set("status", orderFilter);
      if (orderSupplierFilter !== "all") params.set("supplierId", orderSupplierFilter);
      if (orderFromFilter) params.set("from", orderFromFilter);
      if (orderToFilter) params.set("to", orderToFilter);
      const data = await safeFetchArray<PurchaseOrder>(`/api/purchase-orders?${params.toString()}`);
      setOrders(data);
    } catch (e: any) {
      toast.error("Error al cargar órdenes", { description: e?.message });
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function loadProducts() {
    try {
      const data = await safeFetchArray<Product>("/api/products");
      setProducts(data.filter((p: Product) => p.active));
    } catch (e: any) {
      toast.error("Error al cargar productos", { description: e?.message });
      setProducts([]);
    }
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderFilter, orderSupplierFilter, orderFromFilter, orderToFilter]);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (!supSearch) return true;
      const q = supSearch.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.phone?.includes(q) || s.contactName?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q);
    });
  }, [suppliers, supSearch]);

  const filteredOrders = useMemo(() => {
    // Los filtros de status, supplier y fecha se aplican en el backend,
    // pero mantenemos este memo por si llegara a haber diferencias (race conditions).
    return orders;
  }, [orders]);

  async function saveSupplier() {
    if (!supForm.name) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSupSaving(true);
    try {
      const method = supForm.id ? "PUT" : "POST";
      const { ok, error } = await safeFetchJSON("/api/suppliers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supForm),
      });
      if (!ok) throw new Error(error);
      toast.success(supForm.id ? "Proveedor actualizado" : "Proveedor creado");
      setSupFormOpen(false);
      loadSuppliers();
    } catch (e: any) {
      toast.error("Error al guardar proveedor", { description: e?.message });
    } finally {
      setSupSaving(false);
    }
  }

  async function deleteSupplier() {
    if (!deleteSupId) return;
    try {
      const { ok, error } = await safeFetchJSON(`/api/suppliers?id=${deleteSupId}`, { method: "DELETE" });
      if (!ok) throw new Error(error);
      toast.success("Proveedor eliminado");
      setDeleteSupId(null);
      loadSuppliers();
    } catch (e: any) {
      toast.error("Error al eliminar proveedor", { description: e?.message });
    }
  }

  function openNewOC() {
    setOcSupplierId("");
    setOcItems([]);
    setOcNotes("");
    setOcReceiveNow(true);
    setOcEditingId(null);
    if (products.length === 0) loadProducts();
    setOcOpen(true);
  }

  function openEditOC(o: PurchaseOrder) {
    setOcEditingId(o.id);
    setOcSupplierId(o.supplier && (o.supplier as any).id ? (o.supplier as any).id : "");
    // Cargar items del detailOrder (si está abierto) o del row directamente
    const source = (detailOrder && detailOrder.id === o.id ? detailOrder : o);
    setOcItems(
      source.items.map((it: PurchaseOrderItem) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitCost: it.unitCost,
      }))
    );
    setOcNotes(o.notes || "");
    // En edición no se puede cambiar el flag de recepción (la orden ya está decidida)
    setOcReceiveNow(false);
    if (products.length === 0) loadProducts();
    setDetailOpen(false);
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
      const isEdit = !!ocEditingId;
      const { ok, error, data } = await safeFetchJSON<any>("/api/purchase-orders", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? {
                id: ocEditingId,
                supplierId: ocSupplierId || null,
                supplierName: supplier?.name || "Sin proveedor",
                items: ocItems,
                notes: ocNotes,
              }
            : {
                supplierId: ocSupplierId || null,
                supplierName: supplier?.name || "Sin proveedor",
                items: ocItems,
                notes: ocNotes,
                receive: ocReceiveNow,
              }
        ),
      });
      if (!ok) throw new Error(error);
      if (data?._warning) {
        toast.warning(data._warning, { duration: 8000 });
      }
      toast.success(isEdit ? "Orden actualizada" : ocReceiveNow ? "Orden registrada y mercadería ingresada al stock" : "Orden creada (pendiente de recepción)");
      setOcOpen(false);
      setOcEditingId(null);
      loadOrders();
    } catch (e: any) {
      toast.error("Error al guardar orden", { description: e?.message });
    } finally {
      setOcSaving(false);
    }
  }

  async function annulOC() {
    if (!annulOrder) return;
    setAnnulLoading(true);
    try {
      const { ok, error, data } = await safeFetchJSON<any>("/api/purchase-orders/annul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: annulOrder.id,
          reason: annulReason || undefined,
        }),
      });
      if (!ok) throw new Error(error);
      if (data?._warning) {
        toast.warning(data._warning, { duration: 10000 });
      }
      toast.success("Orden anulada");
      setAnnulOrder(null);
      setAnnulReason("");
      setDetailOpen(false);
      loadOrders();
    } catch (e: any) {
      toast.error("Error al anular orden", { description: e?.message });
    } finally {
      setAnnulLoading(false);
    }
  }

  async function receiveOrder(id: string) {
    try {
      const { ok, error } = await safeFetchJSON("/api/purchase-orders/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!ok) throw new Error(error);
      toast.success("Orden recibida. Stock actualizado.");
      loadOrders();
    } catch (e: any) {
      toast.error("Error al recibir orden", { description: e?.message });
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
            <CardContent className="p-3 flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Estado</Label>
                <Select value={orderFilter} onValueChange={setOrderFilter}>
                  <SelectTrigger className="w-36 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="PENDIENTE">Pendientes</SelectItem>
                    <SelectItem value="RECIBIDA">Recibidas</SelectItem>
                    <SelectItem value="ANULADA">Anuladas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Proveedor</Label>
                <Select value={orderSupplierFilter} onValueChange={setOrderSupplierFilter}>
                  <SelectTrigger className="w-44 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Desde</Label>
                <Input
                  type="date"
                  value={orderFromFilter}
                  onChange={(e) => setOrderFromFilter(e.target.value)}
                  className="h-9 w-40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hasta</Label>
                <Input
                  type="date"
                  value={orderToFilter}
                  onChange={(e) => setOrderToFilter(e.target.value)}
                  className="h-9 w-40"
                />
              </div>
              {(orderFilter !== "all" || orderSupplierFilter !== "all" || orderFromFilter || orderToFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOrderFilter("all");
                    setOrderSupplierFilter("all");
                    setOrderFromFilter("");
                    setOrderToFilter("");
                  }}
                >
                  Limpiar
                </Button>
              )}
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
                        <TableRow key={o.id} className={o.status === "ANULADA" ? "opacity-50" : ""}>
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
                            ) : o.status === "ANULADA" ? (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                <Ban className="w-3 h-3 mr-1" /> Anulada
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
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openEditOC(o)}
                                  title="Editar"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-indigo-700"
                                  onClick={() => receiveOrder(o.id)}
                                >
                                  Recibir
                                </Button>
                              </>
                            )}
                            {o.status !== "ANULADA" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-600"
                                onClick={() => {
                                  setAnnulOrder(o);
                                  setAnnulReason("");
                                }}
                                title="Anular"
                              >
                                <Ban className="w-3.5 h-3.5" />
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
              <Button
                variant="outline"
                onClick={() => setSupImportOpen(true)}
              >
                <Upload className="w-4 h-4 mr-2" /> Importar
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
                        <TableHead className="text-center">Estado</TableHead>
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
                          <TableCell className="text-center">
                            {s.active ? (
                              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Activo</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-muted text-muted-foreground">Inactivo</Badge>
                            )}
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

      {/* Diálogo nueva/editar OC */}
      <Dialog open={ocOpen} onOpenChange={setOcOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {ocEditingId ? `Editar orden de compra` : "Nueva orden de compra"}
            </DialogTitle>
            <DialogDescription>
              {ocEditingId
                ? "Modificá los items o las notas de la orden pendiente. El total se recalcula automáticamente."
                : "Registrá la mercadería que comprás a un proveedor. Podés recibirla ahora (actualiza stock) o dejarla pendiente."}
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
                disabled={!!ocEditingId}
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
              {ocEditingId
                ? "Guardar cambios"
                : ocReceiveNow
                ? "Registrar y recibir"
                : "Crear orden pendiente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo detalle orden */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
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
                      : detailOrder.status === "ANULADA"
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                  }
                >
                  {detailOrder.status === "RECIBIDA" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {detailOrder.status === "PENDIENTE" && <Clock className="w-3 h-3 mr-1" />}
                  {detailOrder.status === "ANULADA" && <Ban className="w-3 h-3 mr-1" />}
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
              <>
                <Button
                  variant="outline"
                  onClick={() => openEditOC(detailOrder)}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Editar
                </Button>
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
              </>
            )}
            {detailOrder && detailOrder.status !== "ANULADA" && (
              <Button
                variant="outline"
                className="text-red-700 border-red-200 hover:bg-red-50"
                onClick={() => {
                  setAnnulOrder(detailOrder);
                  setAnnulReason("");
                }}
              >
                <Ban className="w-4 h-4 mr-2" />
                Anular
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDetailOpen(false)}>
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
            <div className="sm:col-span-2 flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="cursor-pointer">Activo</Label>
                <p className="text-xs text-muted-foreground">
                  Los proveedores inactivos no aparecen en el selector de órdenes de compra ni en el de productos.
                </p>
              </div>
              <Switch
                checked={supForm.active}
                onCheckedChange={(v) => setSupForm({ ...supForm, active: v })}
              />
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

      {/* Dialog de importación masiva de proveedores */}
      <ImportDialog
        open={supImportOpen}
        onOpenChange={setSupImportOpen}
        endpoint="/api/suppliers/import"
        fields={SUPPLIER_IMPORT_FIELDS}
        templateHeaders={["Nombre", "Contacto", "Teléfono", "Email", "Dirección", "Activo", "Notas"]}
        templateName="plantilla_proveedores.csv"
        entityLabel="proveedor"
        entityLabelPlural="proveedores"
        onImported={loadSuppliers}
      />

      {/* Diálogo confirmar anulación */}
      <AlertDialog open={!!annulOrder} onOpenChange={(o) => !o && setAnnulOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular orden {annulOrder?.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Vas a anular la orden de compra. Esta acción se puede hacer en órdenes
                  pendientes o ya recibidas.
                </p>
                {annulOrder?.status === "RECIBIDA" && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-2 text-xs text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                    <strong>Atención:</strong> Esta orden ya fue recibida y su stock ingresó
                    al inventario. Al anularla, se descontará el stock de cada producto.
                    Si alguno ya se vendió y queda negativo, deberás hacer un ajuste manual
                    en Inventario.
                  </div>
                )}
                {annulOrder?.status === "PENDIENTE" && (
                  <p className="text-xs text-muted-foreground">
                    Como la orden estaba pendiente, no se modifica el stock.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={annulReason}
              onChange={(e) => setAnnulReason(e.target.value)}
              placeholder="Ej: error de carga, proveedor canceló, etc."
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                annulOC();
              }}
              disabled={annulLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {annulLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Anular orden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
