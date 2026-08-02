"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Save, Store } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { RUBROS } from "@/lib/constants";

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
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
