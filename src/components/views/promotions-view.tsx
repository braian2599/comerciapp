"use client";

import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Tag,
  Percent,
  Gift,
  TrendingUp,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/constants";
import { useAppStore } from "@/store/app-store";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

interface Promotion {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  value: number;
  buyQuantity: number;
  getQuantity: number;
  scope: string;
  categoryId?: string | null;
  productId?: string | null;
  minPurchase: number;
  maxDiscount?: number | null;
  startDate: string;
  endDate?: string | null;
  daysOfWeek?: string | null;
  startHour?: number | null;
  endHour?: number | null;
  active: boolean;
  priority: number;
  usageLimit?: number | null;
  usageCount: number;
  perCustomerLimit?: number | null;
  category?: { id: string; name: string } | null;
  product?: { id: string; name: string } | null;
}

const PROMO_TYPES = [
  { value: "PORCENTAJE", label: "Porcentaje", description: "Ej: 10% OFF en el carrito" },
  { value: "MONTO_FIJO", label: "Monto fijo", description: "Ej: $50 OFF" },
  { value: "NXM", label: "NxM (Llevá N, pagá M)", description: "Ej: 2x1, 3x2" },
  { value: "COMBO", label: "Combo", description: "Combo con descuento %" },
];

const SCOPES = [
  { value: "CART", label: "Todo el carrito" },
  { value: "CATEGORY", label: "Categoría específica" },
  { value: "PRODUCT", label: "Producto específico" },
];

const WEEKDAYS = [
  { value: "0", label: "Dom" },
  { value: "1", label: "Lun" },
  { value: "2", label: "Mar" },
  { value: "3", label: "Mié" },
  { value: "4", label: "Jue" },
  { value: "5", label: "Vie" },
  { value: "6", label: "Sáb" },
];

const emptyForm = {
  name: "",
  description: "",
  type: "PORCENTAJE",
  value: 0,
  buyQuantity: 0,
  getQuantity: 0,
  scope: "CART",
  categoryId: "",
  productId: "",
  minPurchase: 0,
  maxDiscount: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  daysOfWeek: "",
  startHour: "",
  endHour: "",
  active: true,
  priority: 0,
  usageLimit: "",
  perCustomerLimit: "",
};

export function PromotionsView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [proms, cats, prods] = await Promise.all([
        safeFetchArray<Promotion>("/api/promotions"),
        safeFetchArray<any>("/api/categories"),
        safeFetchArray<any>("/api/products?limit=500"),
      ]);
      setPromotions(proms);
      setCategories(cats);
      setProducts(prods);
    } catch (e: any) {
      toast.error("Error al cargar promociones", { description: e?.message });
      setPromotions([]);
      setCategories([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setForm(emptyForm);
    setEditingId(null);
    setOpen(true);
  }

  function openEdit(p: Promotion) {
    setForm({
      name: p.name,
      description: p.description || "",
      type: p.type,
      value: p.value,
      buyQuantity: p.buyQuantity,
      getQuantity: p.getQuantity,
      scope: p.scope,
      categoryId: p.categoryId || "",
      productId: p.productId || "",
      minPurchase: p.minPurchase,
      maxDiscount: p.maxDiscount || "",
      startDate: new Date(p.startDate).toISOString().slice(0, 10),
      endDate: p.endDate ? new Date(p.endDate).toISOString().slice(0, 10) : "",
      daysOfWeek: p.daysOfWeek || "",
      startHour: p.startHour !== null && p.startHour !== undefined ? String(p.startHour) : "",
      endHour: p.endHour !== null && p.endHour !== undefined ? String(p.endHour) : "",
      active: p.active,
      priority: p.priority,
      usageLimit: p.usageLimit !== null && p.usageLimit !== undefined ? String(p.usageLimit) : "",
      perCustomerLimit: p.perCustomerLimit !== null && p.perCustomerLimit !== undefined ? String(p.perCustomerLimit) : "",
    });
    setEditingId(p.id);
    setOpen(true);
  }

  async function save() {
    if (!form.name) {
      toast.error("El nombre es requerido");
      return;
    }
    if (form.scope === "CATEGORY" && !form.categoryId) {
      toast.error("Selecciona una categoría");
      return;
    }
    if (form.scope === "PRODUCT" && !form.productId) {
      toast.error("Selecciona un producto");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, id: editingId };
      const method = editingId ? "PUT" : "POST";
      const { ok, error } = await safeFetchJSON("/api/promotions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) {
        toast.error(error || "Error");
        return;
      }
      toast.success(editingId ? "Promoción actualizada" : "Promoción creada");
      setOpen(false);
      await load();
    } catch (e: any) {
      toast.error("Error de conexión", { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      const { ok, error } = await safeFetchJSON(`/api/promotions?id=${id}`, { method: "DELETE" });
      if (!ok) {
        toast.error(error || "Error");
        return;
      }
      toast.success("Promoción eliminada");
      setDeleteId(null);
      await load();
    } catch (e: any) {
      toast.error("Error de conexión", { description: e?.message });
    }
  }

  // Toggle día de la semana
  function toggleDay(day: string) {
    const current = form.daysOfWeek
      ? form.daysOfWeek.split(",").map((d: string) => d.trim())
      : [];
    const next = current.includes(day)
      ? current.filter((d: string) => d !== day)
      : [...current, day];
    setForm({ ...form, daysOfWeek: next.join(",") });
  }

  const activeCount = promotions.filter((p) => p.active).length;
  const totalUsages = promotions.reduce((sum, p) => sum + p.usageCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Promociones</h1>
          <p className="text-sm text-muted-foreground">
            Crea descuentos, 2x1 y ofertas por tiempo limitado
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> Nueva promoción
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-xl font-bold">{promotions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Activas</p>
                <p className="text-xl font-bold">{activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                <Gift className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Usos totales</p>
                <p className="text-xl font-bold">{totalUsages}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : promotions.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay promociones. Crea la primera.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[70vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Alcance</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead>Usos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promotions.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{p.name}</p>
                          {p.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {p.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {p.type === "PORCENTAJE" && <Percent className="w-3 h-3" />}
                          {p.type === "NXM"
                            ? `${p.buyQuantity + p.getQuantity}x${p.buyQuantity}`
                            : p.type === "PORCENTAJE"
                            ? `${p.value}%`
                            : p.type === "MONTO_FIJO"
                            ? `${symbol}${p.value}`
                            : p.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.scope === "CART" && "Carrito"}
                        {p.scope === "CATEGORY" && p.category?.name}
                        {p.scope === "PRODUCT" && p.product?.name}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>Desde {formatDate(p.startDate)}</div>
                        {p.endDate && <div>Hasta {formatDate(p.endDate)}</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.usageCount}
                        {p.usageLimit ? ` / ${p.usageLimit}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.active ? "default" : "secondary"}>
                          {p.active ? "Activa" : "Pausada"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(p.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal alta/edición */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar promoción" : "Nueva promoción"}
            </DialogTitle>
            <DialogDescription>
              Configura los detalles de la promoción o descuento
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="2x1 en gaseosas"
              />
            </div>
            <div>
              <Label>Descripción</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Promoción válida los lunes..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({ ...form, type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMO_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alcance</Label>
                <Select
                  value={form.scope}
                  onValueChange={(v) => setForm({ ...form, scope: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Parámetros según tipo */}
            {form.type === "PORCENTAJE" || form.type === "COMBO" ? (
              <div>
                <Label>Porcentaje de descuento (%)</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="10"
                />
              </div>
            ) : form.type === "MONTO_FIJO" ? (
              <div>
                <Label>Monto de descuento ({symbol})</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder="50"
                />
              </div>
            ) : form.type === "NXM" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cantidad que paga</Label>
                  <Input
                    type="number"
                    value={form.buyQuantity}
                    onChange={(e) =>
                      setForm({ ...form, buyQuantity: e.target.value })
                    }
                    placeholder="1 (para 2x1)"
                  />
                </div>
                <div>
                  <Label>Cantidad gratis</Label>
                  <Input
                    type="number"
                    value={form.getQuantity}
                    onChange={(e) =>
                      setForm({ ...form, getQuantity: e.target.value })
                    }
                    placeholder="1 (para 2x1)"
                  />
                </div>
              </div>
            ) : null}

            {/* Categoría o producto si scope lo indica */}
            {form.scope === "CATEGORY" && (
              <div>
                <Label>Categoría</Label>
                <Select
                  value={form.categoryId}
                  onValueChange={(v) => setForm({ ...form, categoryId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.scope === "PRODUCT" && (
              <div>
                <Label>Producto</Label>
                <Select
                  value={form.productId}
                  onValueChange={(v) => setForm({ ...form, productId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} - {formatCurrency(p.salePrice, symbol)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Compra mínima ({symbol})</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.minPurchase}
                  onChange={(e) =>
                    setForm({ ...form, minPurchase: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Descuento máximo ({symbol})</Label>
                <Input
                  type="number"
                  step="any"
                  value={form.maxDiscount}
                  onChange={(e) =>
                    setForm({ ...form, maxDiscount: e.target.value })
                  }
                  placeholder="Sin tope"
                />
              </div>
            </div>

            {/* Vigencia */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fecha inicio</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Fecha fin (opcional)</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>

            {/* Horario */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Hora inicio (0-23)</Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={form.startHour}
                  onChange={(e) =>
                    setForm({ ...form, startHour: e.target.value })
                  }
                  placeholder="Cualquier hora"
                />
              </div>
              <div>
                <Label>Hora fin (0-23)</Label>
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={form.endHour}
                  onChange={(e) => setForm({ ...form, endHour: e.target.value })}
                  placeholder="Cualquier hora"
                />
              </div>
            </div>

            {/* Días de la semana */}
            <div>
              <Label>Días de la semana</Label>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((d) => {
                  const selected = form.daysOfWeek
                    ?.split(",")
                    .map((x: string) => x.trim())
                    .includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-muted-foreground border-gray-200 hover:bg-muted"
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sin selección = todos los días
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Prioridad</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Límite total</Label>
                <Input
                  type="number"
                  value={form.usageLimit}
                  onChange={(e) =>
                    setForm({ ...form, usageLimit: e.target.value })
                  }
                  placeholder="Ilimitado"
                />
              </div>
              <div>
                <Label>Límite/cliente</Label>
                <Input
                  type="number"
                  value={form.perCustomerLimit}
                  onChange={(e) =>
                    setForm({ ...form, perCustomerLimit: e.target.value })
                  }
                  placeholder="Ilimitado"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Activa</p>
                <p className="text-xs text-muted-foreground">
                  Si está pausada no se evaluará en el POS
                </p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar promoción?</AlertDialogTitle>
            <AlertDialogDescription>
              Las ventas que la usaron conservarán su descuento registrado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
