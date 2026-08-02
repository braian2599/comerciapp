"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Save, Store, Plus, Trash2, Pencil, CreditCard } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { RUBROS, PAYMENT_METHOD_TYPES, paymentTypeLabel, paymentTypeIcon } from "@/lib/constants";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  surcharge: number;
  active: boolean;
  isDefault: boolean;
}

export function SettingsView() {
  const { store, setUserData, user } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: store?.name || "",
    rubro: store?.rubro || "TIENDA_BARRIO",
    currency: store?.currency || "ARS",
    currencySymbol: store?.currencySymbol || "$",
    taxEnabled: store?.taxEnabled || false,
    taxRate: store?.taxRate || 0,
    address: store?.address || "",
    phone: store?.phone || "",
    lowStockThreshold: store?.lowStockThreshold || 5,
  });

  // Métodos de pago
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodDialogOpen, setMethodDialogOpen] = useState(false);
  const [methodForm, setMethodForm] = useState<any>({
    id: "",
    name: "",
    type: "EFECTIVO",
    surcharge: 0,
    active: true,
    isDefault: false,
  });
  const [methodSaving, setMethodSaving] = useState(false);

  async function loadMethods() {
    setMethodsLoading(true);
    const res = await fetch("/api/payment-methods");
    const data = await res.json();
    setMethods(data);
    setMethodsLoading(false);
  }

  useEffect(() => {
    loadMethods();
  }, []);

  function openNewMethod() {
    setMethodForm({
      id: "",
      name: "",
      type: "EFECTIVO",
      surcharge: 0,
      active: true,
      isDefault: methods.length === 0,
    });
    setMethodDialogOpen(true);
  }

  function openEditMethod(m: PaymentMethod) {
    setMethodForm({ ...m });
    setMethodDialogOpen(true);
  }

  function handleTypeChange(type: string) {
    const def = PAYMENT_METHOD_TYPES.find((t) => t.value === type);
    setMethodForm({
      ...methodForm,
      type,
      surcharge: methodForm.id ? methodForm.surcharge : def?.defaultSurcharge || 0,
      name: methodForm.id
        ? methodForm.name
        : def?.label || "",
    });
  }

  async function handleSaveMethod() {
    if (!methodForm.name) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setMethodSaving(true);
    try {
      const method = methodForm.id ? "PUT" : "POST";
      const res = await fetch("/api/payment-methods", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(methodForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(methodForm.id ? "Método actualizado" : "Método creado");
      setMethodDialogOpen(false);
      loadMethods();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setMethodSaving(false);
    }
  }

  async function handleDeleteMethod(id: string, name: string) {
    if (!confirm(`¿Eliminar el método "${name}"?`)) return;
    try {
      const res = await fetch(`/api/payment-methods?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.deactivated) {
        toast.success("Método desactivado (tiene ventas asociadas)");
      } else {
        toast.success("Método eliminado");
      }
      loadMethods();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleSave() {
    if (!form.name) {
      toast.error("El nombre del comercio es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Configuración guardada");
      // Actualizar store
      setUserData(user, { ...store, ...form });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Datos de tu comercio y preferencias del sistema
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="w-4 h-4 text-emerald-600" />
            Datos del comercio
          </CardTitle>
          <CardDescription>
            Esta información aparece en los comprobantes de venta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del comercio *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rubro">Rubro</Label>
              <Select
                value={form.rubro}
                onValueChange={(v) => setForm({ ...form, rubro: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RUBROS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.icon} {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="11-5555-5555"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Moneda e impuestos</CardTitle>
          <CardDescription>
            Configurá la moneda y el impuesto a aplicar en las ventas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Código de moneda</Label>
              <Input
                id="currency"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                placeholder="ARS, USD, MXN..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="symbol">Símbolo</Label>
              <Input
                id="symbol"
                value={form.currencySymbol}
                onChange={(e) =>
                  setForm({ ...form, currencySymbol: e.target.value })
                }
                placeholder="$"
                className="w-20"
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="taxEnabled" className="cursor-pointer">
                Aplicar impuesto en ventas
              </Label>
              <p className="text-xs text-muted-foreground">
                Calcula automáticamente el porcentaje sobre el subtotal
              </p>
            </div>
            <Switch
              id="taxEnabled"
              checked={form.taxEnabled}
              onCheckedChange={(v) => setForm({ ...form, taxEnabled: v })}
            />
          </div>
          {form.taxEnabled && (
            <div className="space-y-2">
              <Label htmlFor="taxRate">Tasa de impuesto (%)</Label>
              <Input
                id="taxRate"
                type="number"
                step="0.01"
                value={form.taxRate}
                onChange={(e) =>
                  setForm({ ...form, taxRate: Number(e.target.value) })
                }
                className="w-32"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inventario</CardTitle>
          <CardDescription>
            Configuración de alertas de stock
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="lowStockThreshold">
              Umbral global de stock bajo (unidades)
            </Label>
            <Input
              id="lowStockThreshold"
              type="number"
              value={form.lowStockThreshold}
              onChange={(e) =>
                setForm({ ...form, lowStockThreshold: Number(e.target.value) })
              }
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Los productos pueden tener su propio mínimo. Este valor se usa como
              referencia al crear nuevos productos.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Métodos de Pago */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                Métodos de pago
              </CardTitle>
              <CardDescription>
                Configurá los medios de cobro y sus recargos (ej: tarjeta de
                crédito +10%)
              </CardDescription>
            </div>
            <Button
              onClick={openNewMethod}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4 mr-1" />
              Nuevo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {methodsLoading ? (
            <div className="p-6 text-center">
              <Loader2 className="w-4 h-4 animate-spin inline text-emerald-600" />
            </div>
          ) : methods.length === 0 ? (
            <div className="p-8 text-center">
              <CreditCard className="w-10 h-10 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                No tenés métodos de pago configurados. El POS los necesita para
                registrar ventas.
              </p>
              <Button
                onClick={openNewMethod}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="w-4 h-4 mr-1" />
                Crear el primero
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Recargo</TableHead>
                    <TableHead className="text-center">Predeterminado</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {methods.map((m) => (
                    <TableRow key={m.id} className={!m.active ? "opacity-50" : ""}>
                      <TableCell className="font-medium">
                        {paymentTypeIcon(m.type)} {m.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {paymentTypeLabel(m.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {m.surcharge > 0 ? (
                          <span className="text-amber-700 font-medium">
                            +{m.surcharge}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {m.isDefault ? (
                          <Badge className="bg-emerald-100 text-emerald-700">
                            Sí
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {m.active ? (
                          <Badge className="bg-emerald-100 text-emerald-700">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditMethod(m)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600"
                          onClick={() => handleDeleteMethod(m.id, m.name)}
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
          <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground">
            💡 El recargo se aplica sobre el subtotal menos descuento más
            impuestos. El método predeterminado es el que aparece seleccionado
            por defecto al cobrar en el POS.
          </div>
        </CardContent>
      </Card>

      {/* Dialog método de pago */}
      <Dialog open={methodDialogOpen} onOpenChange={setMethodDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {methodForm.id ? "Editar método de pago" : "Nuevo método de pago"}
            </DialogTitle>
            <DialogDescription>
              Configurá el nombre, tipo y recargo aplicable al cobrar con este
              método.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={methodForm.type}
                onValueChange={handleTypeChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="methodName">Nombre visible *</Label>
              <Input
                id="methodName"
                placeholder="Ej: Visa Crédito, Mercado Pago..."
                value={methodForm.name}
                onChange={(e) =>
                  setMethodForm({ ...methodForm, name: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Aparece en el POS y en los comprobantes de venta.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="surcharge">Recargo (%)</Label>
              <Input
                id="surcharge"
                type="number"
                step="0.01"
                min="0"
                value={methodForm.surcharge}
                onChange={(e) =>
                  setMethodForm({
                    ...methodForm,
                    surcharge: Number(e.target.value),
                  })
                }
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Ej: 10 para agregar +10% al total (típico de tarjetas de
                crédito). Dejar en 0 si no aplica.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="mActive"
                  checked={methodForm.active}
                  onCheckedChange={(v) =>
                    setMethodForm({ ...methodForm, active: v })
                  }
                />
                <Label htmlFor="mActive">Activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="mDefault"
                  checked={methodForm.isDefault}
                  onCheckedChange={(v) =>
                    setMethodForm({ ...methodForm, isDefault: v })
                  }
                />
                <Label htmlFor="mDefault">Predeterminado</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              onClick={handleSaveMethod}
              disabled={methodSaving}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {methodSaving && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              {methodForm.id ? "Guardar" : "Crear método"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Guardar cambios del comercio
        </Button>
      </div>
    </div>
  );
}
