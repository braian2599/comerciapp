"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Warehouse,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  Package,
  Loader2,
  Plus,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatDateTime } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

interface Movement {
  id: string;
  type: string;
  quantity: number;
  reason?: string;
  createdAt: string;
  product: { name: string; unit: string };
  user: { name: string };
}

interface Product {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
  active: boolean;
  category?: { id: string; name: string };
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  ENTRADA: { label: "Entrada", color: "bg-indigo-100 text-indigo-700", icon: ArrowDownToLine },
  SALIDA: { label: "Salida", color: "bg-red-100 text-red-700", icon: ArrowUpFromLine },
  AJUSTE: { label: "Ajuste", color: "bg-amber-100 text-amber-700", icon: Plus },
  VENTA: { label: "Venta", color: "bg-blue-100 text-blue-700", icon: Package },
};

export function InventoryView() {
  const { store, user } = useAppStore();
  const [movements, setMovements] = useState<Movement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"movements" | "alerts">("movements");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    productId: "",
    type: "ENTRADA",
    quantity: 1,
    reason: "",
  });

  const canManage = user?.role !== "CAJERO";

  async function load() {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        safeFetchArray<Movement>("/api/inventory?limit=100"),
        safeFetchArray<Product>("/api/products"),
      ]);
      setMovements(m);
      setProducts(p);
    } catch {
      toast.error("No se pudo cargar el inventario");
      setMovements([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const lowStockProducts = useMemo(
    () =>
      products
        .filter((p) => p.active && p.stock <= p.minStock)
        .sort((a, b) => a.stock - b.stock),
    [products]
  );

  async function handleAdjust() {
    if (!adjustForm.productId || !adjustForm.quantity) {
      toast.error("Completá producto y cantidad");
      return;
    }
    setSaving(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/inventory", {
        method: "POST",
        body: JSON.stringify(adjustForm),
      });
      if (!ok) throw new Error(error);
      toast.success("Movimiento registrado");
      setAdjustOpen(false);
      setAdjustForm({ productId: "", type: "ENTRADA", quantity: 1, reason: "" });
      load();
    } catch (e: any) {
      toast.error("Error al registrar movimiento", { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Movimientos de stock y alertas de reposición
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => setAdjustOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Registrar movimiento
          </Button>
        )}
      </div>

      {/* Tabs: movimientos / alertas */}
      <div className="flex gap-2">
        <Button
          variant={tab === "movements" ? "default" : "outline"}
          onClick={() => setTab("movements")}
          className={tab === "movements" ? "bg-indigo-600 hover:bg-indigo-700" : ""}
        >
          <Warehouse className="w-4 h-4 mr-2" />
          Movimientos ({movements.length})
        </Button>
        <Button
          variant={tab === "alerts" ? "default" : "outline"}
          onClick={() => setTab("alerts")}
          className={
            tab === "alerts"
              ? "bg-amber-600 hover:bg-amber-700"
              : lowStockProducts.length > 0
              ? "border-amber-300 text-amber-700"
              : ""
          }
        >
          <AlertTriangle className="w-4 h-4 mr-2" />
          Alertas ({lowStockProducts.length})
        </Button>
      </div>

      {tab === "movements" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos movimientos</CardTitle>
            <CardDescription>
              Entradas, salidas, ajustes y ventas que afectaron el stock
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
                Cargando movimientos...
              </div>
            ) : movements.length === 0 ? (
              <div className="p-12 text-center">
                <Warehouse className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No hay movimientos registrados
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="hidden md:table-cell">Motivo</TableHead>
                      <TableHead className="hidden lg:table-cell">Usuario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => {
                      const cfg = TYPE_CONFIG[m.type] || TYPE_CONFIG.AJUSTE;
                      const Icon = cfg.icon;
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-sm">
                            {formatDateTime(m.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge className={cfg.color}>
                              <Icon className="w-3 h-3 mr-1" />
                              {cfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{m.product.name}</TableCell>
                          <TableCell
                            className={`text-right font-semibold ${
                              m.quantity > 0 ? "text-indigo-700" : "text-red-700"
                            }`}
                          >
                            {m.quantity > 0 ? "+" : ""}
                            {m.quantity} {m.product.unit === "KG" ? "kg" : "u"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {m.reason || "—"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm">
                            {m.user.name}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Productos con stock bajo
            </CardTitle>
            <CardDescription>
              Productos activos cuyo stock es menor o igual al mínimo definido
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
              </div>
            ) : lowStockProducts.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-10 h-10 mx-auto text-indigo-500 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Todo el stock está OK. Nada que reponer.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="hidden sm:table-cell">Categoría</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Mínimo</TableHead>
                      <TableHead className="text-center">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStockProducts.map((p) => {
                      const out = p.stock <= 0;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {p.category ? (
                              <Badge variant="outline">{p.category.name}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold ${
                              out ? "text-red-600" : "text-amber-600"
                            }`}
                          >
                            {p.stock} {p.unit === "KG" ? "kg" : "u"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {p.minStock}
                          </TableCell>
                          <TableCell className="text-center">
                            {out ? (
                              <Badge variant="destructive">Sin stock</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700">
                                Stock bajo
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog de ajuste manual */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar movimiento de stock</DialogTitle>
            <DialogDescription>
              Agregá entradas o salidas manuales. El stock se actualizará automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Producto *</Label>
              <Select
                value={adjustForm.productId}
                onValueChange={(v) => setAdjustForm({ ...adjustForm, productId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {products
                    .filter((p) => p.active)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} (stock: {p.stock})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={adjustForm.type}
                  onValueChange={(v) => setAdjustForm({ ...adjustForm, type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTRADA">Entrada (+ stock)</SelectItem>
                    <SelectItem value="SALIDA">Salida (- stock)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjustForm.quantity}
                  onChange={(e) =>
                    setAdjustForm({ ...adjustForm, quantity: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
              <Textarea
                rows={2}
                placeholder="Ej: Compra a proveedor, merma, rotura..."
                value={adjustForm.reason}
                onChange={(e) =>
                  setAdjustForm({ ...adjustForm, reason: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              onClick={handleAdjust}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Registrar movimiento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
