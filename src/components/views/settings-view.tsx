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
import { Loader2, Save, Store, Plus, Trash2, Pencil, CreditCard, FileText, QrCode, Award, Lightbulb } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { RUBROS, PAYMENT_METHOD_TYPES, paymentTypeLabel, paymentTypeIcon } from "@/lib/constants";
import { Icon } from "@/lib/icons";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AfipConnectionPanel } from "@/components/afip-connection-panel";
import { AfipCertificateUploader } from "@/components/afip-certificate-uploader";

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  surcharge: number;
  active: boolean;
  isDefault: boolean;
  requiresInvoice: boolean;
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
    requiresInvoice: false,
  });
  const [methodSaving, setMethodSaving] = useState(false);

  // Configuración fiscal (AFIP)
  const [taxConfig, setTaxConfig] = useState<any>(null);
  const [taxForm, setTaxForm] = useState<any>({
    cuit: "",
    razonSocial: "",
    direccionFiscal: "",
    puntoVenta: 1,
    tipoFactura: "B",
    condicionFiscal: "MONOTRIBUTO",
    categoriaMonotributo: "",
    ivaRate: 21,
    environment: "homologacion",
    active: true,
  });
  const [taxSaving, setTaxSaving] = useState(false);

  // Mercado Pago
  const [mpConfig, setMpConfig] = useState<any>(null);
  const [mpForm, setMpForm] = useState<any>({
    accessToken: "",
    publicKey: "",
    sandboxAccessToken: "",
    sandboxPublicKey: "",
    environment: "sandbox",
    collectorId: "",
    qrEnabled: true,
    defaultDescription: "",
    active: true,
  });
  const [mpSaving, setMpSaving] = useState(false);

  // Fidelización
  const [loyaltyForm, setLoyaltyForm] = useState<any>({
    enabled: false,
    name: "Programa de Puntos",
    pointsPerWeight: 1,
    roundMode: "FLOOR",
    minPurchase: 0,
    pointsToCurrency: 0.01,
    minRedeemPoints: 0,
    maxRedeemPercent: 100,
    tierBronceMin: 0,
    tierBronceBonus: 0,
    tierPlataMin: 50000,
    tierPlataBonus: 0.2,
    tierOroMin: 200000,
    tierOroBonus: 0.5,
    tierPlatinoMin: 500000,
    tierPlatinoBonus: 1,
  });
  const [loyaltySaving, setLoyaltySaving] = useState(false);

  async function loadMethods() {
    setMethodsLoading(true);
    // Si la API devuelve 401 o un objeto { error }, safeFetchArray devuelve []
    // en lugar de hacer que `methods` termine siendo un objeto y rompa .map.
    const data = await safeFetchArray<PaymentMethod>("/api/payment-methods");
    setMethods(data);
    setMethodsLoading(false);
  }

  async function loadTaxConfig() {
    const { data } = await safeFetchJSON<any>("/api/tax-config");
    setTaxConfig(data);
    if (data && !Array.isArray(data) && typeof data === "object") {
      setTaxForm({
        cuit: data.cuit || "",
        razonSocial: data.razonSocial || "",
        direccionFiscal: data.direccionFiscal || "",
        puntoVenta: data.puntoVenta || 1,
        tipoFactura: data.tipoFactura || "B",
        condicionFiscal: data.condicionFiscal || "MONOTRIBUTO",
        categoriaMonotributo: data.categoriaMonotributo || "",
        ivaRate: data.ivaRate || 21,
        environment: data.environment || "homologacion",
        active: data.active ?? true,
      });
    }
  }

  async function loadMpConfig() {
    const { data } = await safeFetchJSON<any>("/api/mercadopago/config");
    setMpConfig(data);
    if (data && !Array.isArray(data) && typeof data === "object") {
      setMpForm({
        accessToken: data.accessToken && data.accessToken !== "***CONFIGURADO***" ? data.accessToken : "",
        publicKey: data.publicKey || "",
        sandboxAccessToken: data.sandboxAccessToken && data.sandboxAccessToken !== "***CONFIGURADO***" ? data.sandboxAccessToken : "",
        sandboxPublicKey: data.sandboxPublicKey || "",
        environment: data.environment || "sandbox",
        collectorId: data.collectorId || "",
        qrEnabled: data.qrEnabled ?? true,
        defaultDescription: data.defaultDescription || "",
        active: data.active ?? true,
      });
    }
  }

  async function loadLoyaltyConfig() {
    const { data } = await safeFetchJSON<any>("/api/loyalty");
    if (data && !Array.isArray(data) && typeof data === "object") {
      setLoyaltyForm({
        enabled: data.enabled ?? false,
        name: data.name || "Programa de Puntos",
        pointsPerWeight: data.pointsPerWeight ?? 1,
        roundMode: data.roundMode || "FLOOR",
        minPurchase: data.minPurchase ?? 0,
        pointsToCurrency: data.pointsToCurrency ?? 0.01,
        minRedeemPoints: data.minRedeemPoints ?? 0,
        maxRedeemPercent: data.maxRedeemPercent ?? 100,
        tierBronceMin: data.tierBronceMin ?? 0,
        tierBronceBonus: data.tierBronceBonus ?? 0,
        tierPlataMin: data.tierPlataMin ?? 50000,
        tierPlataBonus: data.tierPlataBonus ?? 0.2,
        tierOroMin: data.tierOroMin ?? 200000,
        tierOroBonus: data.tierOroBonus ?? 0.5,
        tierPlatinoMin: data.tierPlatinoMin ?? 500000,
        tierPlatinoBonus: data.tierPlatinoBonus ?? 1,
      });
    }
  }

  useEffect(() => {
    loadMethods();
    loadTaxConfig();
    loadMpConfig();
    loadLoyaltyConfig();
  }, []);

  async function handleSaveTax() {
    setTaxSaving(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/tax-config", {
        method: "PUT",
        body: JSON.stringify(taxForm),
      });
      if (!ok) {
        toast.error(error || "Error guardando configuración fiscal");
        return;
      }
      toast.success("Configuración fiscal guardada");
      loadTaxConfig();
    } catch (e: any) {
      toast.error("Error al guardar", { description: e.message });
    } finally {
      setTaxSaving(false);
    }
  }

  async function handleSaveMp() {
    setMpSaving(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/mercadopago/config", {
        method: "PUT",
        body: JSON.stringify(mpForm),
      });
      if (!ok) {
        toast.error(error || "Error guardando configuración MP");
        return;
      }
      toast.success("Configuración de Mercado Pago guardada");
      loadMpConfig();
    } catch (e: any) {
      toast.error("Error al guardar", { description: e.message });
    } finally {
      setMpSaving(false);
    }
  }

  async function handleSaveLoyalty() {
    setLoyaltySaving(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/loyalty", {
        method: "PUT",
        body: JSON.stringify(loyaltyForm),
      });
      if (!ok) {
        toast.error(error || "Error guardando configuración de fidelización");
        return;
      }
      toast.success("Programa de fidelización guardado");
      loadLoyaltyConfig();
    } catch (e: any) {
      toast.error("Error al guardar", { description: e.message });
    } finally {
      setLoyaltySaving(false);
    }
  }

  function openNewMethod() {
    setMethodForm({
      id: "",
      name: "",
      type: "EFECTIVO",
      surcharge: 0,
      active: true,
      isDefault: methods.length === 0,
      requiresInvoice: false,
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
      const { ok, error } = await safeFetchJSON("/api/payment-methods", {
        method,
        body: JSON.stringify(methodForm),
      });
      if (!ok) throw new Error(error);
      toast.success(methodForm.id ? "Método actualizado" : "Método creado");
      setMethodDialogOpen(false);
      loadMethods();
    } catch (e: any) {
      toast.error("Error al guardar método", { description: e.message });
    } finally {
      setMethodSaving(false);
    }
  }

  async function handleDeleteMethod(id: string, name: string) {
    if (!confirm(`¿Eliminar el método "${name}"?`)) return;
    try {
      const { ok, data, error } = await safeFetchJSON<any>(
        `/api/payment-methods?id=${id}`,
        { method: "DELETE" }
      );
      if (!ok) throw new Error(error);
      if (data?.deactivated) {
        toast.success("Método desactivado (tiene ventas asociadas)");
      } else {
        toast.success("Método eliminado");
      }
      loadMethods();
    } catch (e: any) {
      toast.error("Error al eliminar método", { description: e.message });
    }
  }

  async function handleSave() {
    if (!form.name) {
      toast.error("El nombre del comercio es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/store", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      if (!ok) throw new Error(error);
      toast.success("Configuración guardada");
      // Actualizar store
      setUserData(user, { ...store, ...form });
    } catch (e: any) {
      toast.error("Error al guardar", { description: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Datos de tu comercio y preferencias del sistema
        </p>
      </div>

      <Tabs defaultValue="comercio" className="w-full">
        <TabsList className="flex w-full flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="comercio" className="text-xs">Comercio</TabsTrigger>
          <TabsTrigger value="impuestos" className="text-xs">Moneda e Impuestos</TabsTrigger>
          <TabsTrigger value="inventario" className="text-xs">Inventario</TabsTrigger>
          <TabsTrigger value="pagos" className="text-xs">Métodos de Pago</TabsTrigger>
          <TabsTrigger value="facturacion" className="text-xs">Facturación AFIP</TabsTrigger>
          <TabsTrigger value="mercadopago" className="text-xs">Mercado Pago</TabsTrigger>
          <TabsTrigger value="fidelizacion" className="text-xs">Fidelización</TabsTrigger>
        </TabsList>

      <TabsContent value="comercio" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="w-4 h-4 text-indigo-600" />
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
      </TabsContent>

      <TabsContent value="impuestos" className="mt-4">
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
                step="any"
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
      </TabsContent>

      <TabsContent value="inventario" className="mt-4">
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
      </TabsContent>

      <TabsContent value="pagos" className="mt-4">
      {/* Métodos de Pago */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-indigo-600" />
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
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4 mr-1" />
              Nuevo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {methodsLoading ? (
            <div className="p-6 text-center">
              <Loader2 className="w-4 h-4 animate-spin inline text-indigo-600" />
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
                className="bg-indigo-600 hover:bg-indigo-700"
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
                    <TableHead className="text-center">Factura</TableHead>
                    <TableHead className="text-center">Predeterminado</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.isArray(methods) && methods.map((m) => (
                    <TableRow key={m.id} className={!m.active ? "opacity-50" : ""}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name={paymentTypeIcon(m.type)} className="w-3.5 h-3.5 text-slate-500" />
                          {m.name}
                        </span>
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
                        {m.requiresInvoice ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            Requiere
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {m.isDefault ? (
                          <Badge className="bg-indigo-100 text-indigo-700">
                            Sí
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {m.active ? (
                          <Badge className="bg-indigo-100 text-indigo-700">
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
          <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground flex items-start gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
            <span>El recargo se aplica sobre el subtotal menos descuento más
            impuestos. El método predeterminado es el que aparece seleccionado
            por defecto al cobrar en el POS.</span>
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
                step="any"
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
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <Switch
                id="mRequiresInvoice"
                checked={methodForm.requiresInvoice}
                onCheckedChange={(v) =>
                  setMethodForm({ ...methodForm, requiresInvoice: v })
                }
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="mRequiresInvoice" className="text-amber-900">
                  Requiere factura
                </Label>
                <p className="text-xs text-amber-800">
                  Si está activo, al cobrar con este método el POS ofrecerá
                  facturar la venta (botón “Facturar ahora”). La factura puede
                  emitirse en el momento o después desde el módulo Facturas.
                  El cobro nunca depende de AFIP en tiempo real — la venta se
                  registra primero, la factura después.
                </p>
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
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {methodSaving && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              {methodForm.id ? "Guardar" : "Crear método"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </TabsContent>

      <TabsContent value="facturacion" className="mt-4">
      {/* Configuración Fiscal (AFIP/ARCA) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Facturación Electrónica (AFIP/ARCA)
          </CardTitle>
          <CardDescription>
            Datos para emitir facturas electrónicas con CAE. En modo demo se simula el CAE.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Habilitar facturación electrónica</Label>
              <p className="text-xs text-muted-foreground">
                Activa el módulo de facturación en el sistema
              </p>
            </div>
            <Switch
              checked={taxForm.active}
              onCheckedChange={(v) => setTaxForm({ ...taxForm, active: v })}
            />
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>CUIT (sin guiones)</Label>
              <Input
                value={taxForm.cuit}
                onChange={(e) => setTaxForm({ ...taxForm, cuit: e.target.value.replace(/\D/g, "") })}
                placeholder="30712345678"
                maxLength={11}
              />
            </div>
            <div className="space-y-2">
              <Label>Razón social</Label>
              <Input
                value={taxForm.razonSocial}
                onChange={(e) => setTaxForm({ ...taxForm, razonSocial: e.target.value })}
                placeholder="Mi Comercio SRL"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Dirección fiscal</Label>
            <Input
              value={taxForm.direccionFiscal}
              onChange={(e) => setTaxForm({ ...taxForm, direccionFiscal: e.target.value })}
              placeholder="Av. San Martín 123, CABA"
            />
          </div>

          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Punto de venta</Label>
              <Input
                type="number"
                value={taxForm.puntoVenta}
                onChange={(e) => setTaxForm({ ...taxForm, puntoVenta: Number(e.target.value) })}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>Condición fiscal</Label>
              <Select
                value={taxForm.condicionFiscal}
                onValueChange={(v) => setTaxForm({ ...taxForm, condicionFiscal: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONOTRIBUTO">Monotributo</SelectItem>
                  <SelectItem value="RESPONSABLE_INSCRIPTO">Responsable Inscripto</SelectItem>
                  <SelectItem value="EXENTO">Exento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo factura por defecto</Label>
              <Select
                value={taxForm.tipoFactura}
                onValueChange={(v) => setTaxForm({ ...taxForm, tipoFactura: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>IVA (%)</Label>
              <Select
                value={String(taxForm.ivaRate)}
                onValueChange={(v) => setTaxForm({ ...taxForm, ivaRate: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0%</SelectItem>
                  <SelectItem value="10.5">10.5%</SelectItem>
                  <SelectItem value="21">21%</SelectItem>
                  <SelectItem value="27">27%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Categoría Monotributo</Label>
              <Select
                value={taxForm.categoriaMonotributo || "_ninguna"}
                onValueChange={(v) => setTaxForm({ ...taxForm, categoriaMonotributo: v === "_ninguna" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_ninguna">No aplica</SelectItem>
                  {["A", "B", "C", "D", "E", "F", "G", "H"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Modo AFIP</Label>
              <Select
                value={taxForm.environment}
                onValueChange={(v) => setTaxForm({ ...taxForm, environment: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacion">Homologación (Demo)</SelectItem>
                  <SelectItem value="produccion">Producción</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {taxForm.environment === "homologacion" && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800">
              <strong>Modo Demo:</strong> Las facturas emitidas generan un CAE simulado de 14 dígitos
              y un QR válido según RG AFIP 4291. Para facturación real, cambiá a modo Producción
              y cargá tu certificado.
            </div>
          )}

          {/* Subida de certificado digital */}
          <AfipCertificateUploader
            taxConfig={taxConfig}
            onCertChange={loadTaxConfig}
          />

          {/* Panel de conexión AFIP (solo relevante en producción) */}
          <AfipConnectionPanel
            taxConfig={taxConfig}
            onTestSuccess={loadTaxConfig}
          />

          <div className="flex justify-end">
            <Button onClick={handleSaveTax} disabled={taxSaving} className="bg-blue-600 hover:bg-blue-700">
              {taxSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar configuración fiscal
            </Button>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="mercadopago" className="mt-4">
      {/* Mercado Pago */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <QrCode className="w-4 h-4 text-cyan-600" />
            Mercado Pago - Pago con QR
          </CardTitle>
          <CardDescription>
            Configurá tus credenciales de Mercado Pago para habilitar cobros con QR.
            Obtenelas en mercadopago.com.ar/developers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Habilitar Mercado Pago</Label>
              <p className="text-xs text-muted-foreground">
                Activa la integración con MP
              </p>
            </div>
            <Switch
              checked={mpForm.active}
              onCheckedChange={(v) => setMpForm({ ...mpForm, active: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Habilitar cobros QR</Label>
              <p className="text-xs text-muted-foreground">
                Muestra el botón de QR en el POS
              </p>
            </div>
            <Switch
              checked={mpForm.qrEnabled}
              onCheckedChange={(v) => setMpForm({ ...mpForm, qrEnabled: v })}
            />
          </div>

          <div className="space-y-2">
            <Label>Modo</Label>
            <Select
              value={mpForm.environment}
              onValueChange={(v) => setMpForm({ ...mpForm, environment: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                <SelectItem value="produccion">Producción</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mpForm.environment === "sandbox" ? (
            <div className="space-y-3">
              <div className="bg-cyan-50 border border-cyan-200 rounded-md p-2 text-xs text-cyan-800">
                Credenciales de testing (sandbox). Obtenelas en el panel de desarrolladores de MP.
              </div>
              <div className="space-y-2">
                <Label>Access Token (Sandbox)</Label>
                <Input
                  type="password"
                  value={mpForm.sandboxAccessToken}
                  onChange={(e) => setMpForm({ ...mpForm, sandboxAccessToken: e.target.value })}
                  placeholder="TEST-..."
                />
              </div>
              <div className="space-y-2">
                <Label>Public Key (Sandbox)</Label>
                <Input
                  value={mpForm.sandboxPublicKey}
                  onChange={(e) => setMpForm({ ...mpForm, sandboxPublicKey: e.target.value })}
                  placeholder="APP_USR-..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-indigo-50 border border-indigo-200 rounded-md p-2 text-xs text-indigo-800">
                Credenciales de producción. Usa estas para cobros reales.
              </div>
              <div className="space-y-2">
                <Label>Access Token (Producción)</Label>
                <Input
                  type="password"
                  value={mpForm.accessToken}
                  onChange={(e) => setMpForm({ ...mpForm, accessToken: e.target.value })}
                  placeholder="APP_USR-..."
                />
              </div>
              <div className="space-y-2">
                <Label>Public Key (Producción)</Label>
                <Input
                  value={mpForm.publicKey}
                  onChange={(e) => setMpForm({ ...mpForm, publicKey: e.target.value })}
                  placeholder="APP_USR-..."
                />
              </div>
            </div>
          )}

          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label>Collector ID (opcional)</Label>
              <Input
                value={mpForm.collectorId}
                onChange={(e) => setMpForm({ ...mpForm, collectorId: e.target.value })}
                placeholder="ID del vendedor en MP"
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción en QR</Label>
              <Input
                value={mpForm.defaultDescription}
                onChange={(e) => setMpForm({ ...mpForm, defaultDescription: e.target.value })}
                placeholder="Nombre del comercio"
              />
            </div>
          </div>

          <div className="bg-muted/50 rounded-md p-3 text-xs">
            <p className="font-medium mb-1">URL del Webhook para recibir notificaciones de pago:</p>
            <code className="text-xs break-all">
              {typeof window !== "undefined" ? window.location.origin : "https://tu-dominio.com"}/api/mercadopago/webhook
            </code>
            <p className="mt-1 text-muted-foreground">
              Configurá esta URL en el panel de desarrolladores de Mercado Pago →
              Tu aplicación → Webhooks.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveMp} disabled={mpSaving} className="bg-cyan-600 hover:bg-cyan-700">
              {mpSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar configuración MP
            </Button>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="fidelizacion" className="mt-4">
      {/* Fidelización / Programa de puntos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="w-4 h-4 text-purple-600" />
            Programa de Fidelización (Puntos)
          </CardTitle>
          <CardDescription>
            Configura el programa de puntos para premiar a tus clientes frecuentes.
            Los clientes acumulan puntos con cada compra y pueden canjearlos por descuentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Habilitar programa</Label>
              <p className="text-xs text-muted-foreground">
                Activa el sistema de puntos en el POS y clientes
              </p>
            </div>
            <Switch
              checked={loyaltyForm.enabled}
              onCheckedChange={(v) => setLoyaltyForm({ ...loyaltyForm, enabled: v })}
            />
          </div>

          <div>
            <Label className="text-sm">Nombre del programa</Label>
            <Input
              value={loyaltyForm.name}
              onChange={(e) => setLoyaltyForm({ ...loyaltyForm, name: e.target.value })}
              placeholder="Programa de Puntos"
            />
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">Acumulación de puntos</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Puntos por $1</Label>
                <Input
                  type="number"
                  step="any"
                  value={loyaltyForm.pointsPerWeight}
                  onChange={(e) => setLoyaltyForm({ ...loyaltyForm, pointsPerWeight: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Compra mínima ($)</Label>
                <Input
                  type="number"
                  value={loyaltyForm.minPurchase}
                  onChange={(e) => setLoyaltyForm({ ...loyaltyForm, minPurchase: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Redondeo</Label>
                <Select
                  value={loyaltyForm.roundMode}
                  onValueChange={(v) => setLoyaltyForm({ ...loyaltyForm, roundMode: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLOOR">Hacia abajo</SelectItem>
                    <SelectItem value="CEIL">Hacia arriba</SelectItem>
                    <SelectItem value="ROUND">Más cercano</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ejemplo: con 1 punto/$1, una compra de $1000 genera 1000 puntos.
            </p>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">Canje de puntos</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Valor de 1 punto ($)</Label>
                <Input
                  type="number"
                  step="any"
                  value={loyaltyForm.pointsToCurrency}
                  onChange={(e) => setLoyaltyForm({ ...loyaltyForm, pointsToCurrency: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Mín. puntos para canjear</Label>
                <Input
                  type="number"
                  value={loyaltyForm.minRedeemPoints}
                  onChange={(e) => setLoyaltyForm({ ...loyaltyForm, minRedeemPoints: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">% máx. del total canjeable</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={loyaltyForm.maxRedeemPercent}
                  onChange={(e) => setLoyaltyForm({ ...loyaltyForm, maxRedeemPercent: Number(e.target.value) })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ejemplo: con 0.01 valor, 1000 puntos = $10 de descuento.
            </p>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-medium mb-2">Niveles (tiers) y bonus</p>
            <p className="text-xs text-muted-foreground mb-3">
              Los clientes suben de nivel según el monto acumulado. Cada nivel da un
              multiplicador de puntos.
            </p>
            <div className="space-y-2">
              {[
                { key: "Bronce", tierKey: "tierBronce", color: "bg-amber-50 border-amber-200 text-amber-800" },
                { key: "Plata", tierKey: "tierPlata", color: "bg-slate-50 border-slate-200 text-slate-800" },
                { key: "Oro", tierKey: "tierOro", color: "bg-yellow-50 border-yellow-200 text-yellow-800" },
                { key: "Platino", tierKey: "tierPlatino", color: "bg-gray-100 border-gray-300 text-gray-800" },
              ].map((t) => (
                <div
                  key={t.tierKey}
                  className={`grid grid-cols-2 gap-3 p-3 rounded-lg border ${t.color}`}
                >
                  <div className="flex items-center gap-2 col-span-2">
                    <Badge variant="outline" className={t.color}>{t.key}</Badge>
                  </div>
                  <div>
                    <Label className="text-xs">Monto acumulado mínimo ($)</Label>
                    <Input
                      type="number"
                      value={loyaltyForm[`${t.tierKey}Min`]}
                      onChange={(e) =>
                        setLoyaltyForm({
                          ...loyaltyForm,
                          [`${t.tierKey}Min`]: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Bonus (multiplicador)</Label>
                    <Input
                      type="number"
                      step="any"
                      value={loyaltyForm[`${t.tierKey}Bonus`]}
                      onChange={(e) =>
                        setLoyaltyForm({
                          ...loyaltyForm,
                          [`${t.tierKey}Bonus`]: Number(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs mt-0.5">
                      Ej: 0.2 = +20% puntos
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveLoyalty} disabled={loyaltySaving} className="bg-purple-600 hover:bg-purple-700">
              {loyaltySaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar programa de fidelización
            </Button>
          </div>
        </CardContent>
      </Card>
      </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700"
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
