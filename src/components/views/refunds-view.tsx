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
import { toast } from "sonner";
import {
  Loader2,
  RotateCcw,
  Search,
  Eye,
  AlertTriangle,
  Receipt,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";
import { calculateRefundTotals } from "@/lib/refund-calc";

const REFUND_REASONS = [
  { value: "PRODUCTO_DEFECTUOSO", label: "Producto defectuoso" },
  { value: "NO_CONFORME", label: "Cliente no conforme" },
  { value: "ERROR_VENTA", label: "Error en la venta" },
  { value: "PRODUCTO_VENCIDO", label: "Producto vencido" },
  { value: "OTRO", label: "Otro" },
];

const REFUND_METHODS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "CREDITO_CUENTA", label: "Crédito en cuenta corriente" },
];

export function RefundsView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [refunds, setRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedSale, setSelectedSale] = useState<any | null>(null);
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState("EFECTIVO");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [detailRefund, setDetailRefund] = useState<any | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await safeFetchArray<any>("/api/refunds");
      setRefunds(data);
    } catch (e: any) {
      toast.error("Error al cargar devoluciones", { description: e?.message });
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Buscar ventas por ID parcial o cliente
  async function searchSales() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await safeFetchArray<any>(`/api/sales?status=COMPLETADA&limit=50`);
      const q = searchQuery.toLowerCase().trim();
      // Filtrar: por ID parcial, por nombre de cliente, por método
      const filtered = data.filter((s: any) => {
        if (s.id.toLowerCase().includes(q)) return true;
        if (s.customer?.name?.toLowerCase().includes(q)) return true;
        if (s.paymentMethod?.toLowerCase().includes(q)) return true;
        return false;
      });
      setSearchResults(filtered);
    } catch (e: any) {
      toast.error("Error al buscar ventas", { description: e?.message });
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function openRefundForSale(sale: any) {
    setSelectedSale(sale);
    setReturnItems({});
    setRefundMethod("EFECTIVO");
    setReason("");
    setNotes("");
    setSearchOpen(false);
  }

  // Calcular montos de la devolución usando la función compartida con el backend.
  // Esto evita drift entre lo que ve el usuario y lo que persiste el backend.
  const refundCalc = useMemo(() => {
    if (!selectedSale) return null;
    try {
      const requestedItems = selectedSale.items
        .filter((it: any) => (returnItems[it.id] || 0) > 0)
        .map((it: any) => ({
          saleItemId: it.id,
          quantity: returnItems[it.id],
        }));
      // Si ningún item seleccionado, calcular como devolución total (items vacíos)
      // para mostrar el monto máximo a devolver.
      return calculateRefundTotals(
        {
          id: selectedSale.id,
          subtotal: selectedSale.subtotal,
          discount: selectedSale.discount,
          tax: selectedSale.tax,
          surcharge: selectedSale.surcharge,
          total: selectedSale.total,
          items: selectedSale.items.map((it: any) => ({
            id: it.id,
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            costPrice: it.costPrice,
            subtotal: it.subtotal,
          })),
        },
        requestedItems
      );
    } catch {
      return null;
    }
  }, [selectedSale, returnItems]);

  const refundSubtotal = refundCalc?.refundSubtotal ?? 0;
  const refundDiscount = refundCalc?.refundDiscount ?? 0;
  const refundTax = refundCalc?.refundTax ?? 0;
  const refundSurcharge = refundCalc?.refundSurcharge ?? 0;
  const refundTotal = refundCalc?.refundTotal ?? 0;
  const isTotalRefund = refundCalc?.isTotal ?? false;

  async function submitRefund() {
    if (!selectedSale) return;

    // Si el usuario no seleccionó ningún item, mandar array vacío = devolución total.
    // Si seleccionó items, mandarlos explícitamente.
    const selectedItems = selectedSale.items.filter(
      (it: any) => (returnItems[it.id] || 0) > 0
    );
    const items = isTotalRefund || selectedItems.length === 0
      ? []
      : selectedItems.map((it: any) => ({
          saleItemId: it.id,
          quantity: returnItems[it.id],
        }));

    setSaving(true);
    try {
      const { ok, data, error } = await safeFetchJSON<any>("/api/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleId: selectedSale.id,
          items,
          refundMethod,
          reason,
          notes,
        }),
      });
      if (!ok) {
        toast.error(error || "Error al procesar devolución");
        return;
      }
      toast.success(`Devolución ${data.refundNumber} registrada`);
      setSelectedSale(null);
      await load();
    } catch (e: any) {
      toast.error("Error de conexión", { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  // Estadísticas
  const totalDevuelto = refunds.reduce((sum, r) => sum + r.total, 0);
  const hoy = new Date();
  const devolucionesHoy = refunds.filter(
    (r) => new Date(r.createdAt).toDateString() === hoy.toDateString()
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Devoluciones</h1>
          <p className="text-sm text-muted-foreground">
            Procesa devoluciones y genera notas de crédito
          </p>
        </div>
        <Button onClick={() => setSearchOpen(true)} className="gap-2">
          <RotateCcw className="w-4 h-4" /> Nueva devolución
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total devoluciones</p>
                <p className="text-xl font-bold">{refunds.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center">
                <TrendingDown className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monto devuelto</p>
                <p className="text-xl font-bold">
                  {formatCurrency(totalDevuelto, symbol)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Devoluciones hoy</p>
                <p className="text-xl font-bold">{devolucionesHoy}</p>
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
          ) : refunds.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <RotateCcw className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay devoluciones registradas</p>
              <p className="text-xs mt-1">
                Usa el botón "Nueva devolución" para procesar la primera
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[70vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N°</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Venta origen</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {refunds.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {r.refundNumber}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(r.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.sale?.id?.slice(-6)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.customer?.name || "Consumidor final"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.type === "TOTAL" ? "destructive" : "secondary"}
                        >
                          {r.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline">
                          {REFUND_METHODS.find((m) => m.value === r.refundMethod)
                            ?.label || r.refundMethod}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-red-600">
                        −{formatCurrency(r.total, symbol)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {REFUND_REASONS.find((m) => m.value === r.reason)?.label ||
                          r.reason ||
                          "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDetailRefund(r)}
                        >
                          <Eye className="w-4 h-4" />
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

      {/* Modal búsqueda de venta */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Buscar venta para devolver</DialogTitle>
            <DialogDescription>
              Busca por ID de venta (últimos dígitos), cliente o método de pago
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchSales()}
                placeholder="Ej: a1b2c3 o 'Juan Pérez' o 'EFECTIVO'"
              />
              <Button onClick={searchSales} disabled={searching}>
                {searching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Busca ventas para devolver
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchResults.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">
                          {s.id.slice(-6)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDateTime(s.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.customer?.name || "—"}
                        </TableCell>
                        <TableCell>{formatCurrency(s.total, symbol)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRefundForSale(s)}
                          >
                            Devolver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal detalle de devolución */}
      <Dialog open={!!detailRefund} onOpenChange={(o) => !o && setDetailRefund(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalle de devolución {detailRefund?.refundNumber}</DialogTitle>
          </DialogHeader>
          {detailRefund && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Venta origen</p>
                  <p className="font-mono">{detailRefund.sale?.id?.slice(-8)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fecha</p>
                  <p>{formatDateTime(detailRefund.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p>{detailRefund.customer?.name || "Consumidor final"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Usuario</p>
                  <p>{detailRefund.user?.name}</p>
                </div>
              </div>
              {detailRefund.items?.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead>Cant.</TableHead>
                      <TableHead>P. Unit</TableHead>
                      <TableHead>Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailRefund.items.map((it: any) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.product?.name}</TableCell>
                        <TableCell>{it.quantity}</TableCell>
                        <TableCell>{formatCurrency(it.unitPrice, symbol)}</TableCell>
                        <TableCell>{formatCurrency(it.subtotal, symbol)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="space-y-1 text-sm border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(detailRefund.subtotal, symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento</span>
                  <span>−{formatCurrency(detailRefund.discount, symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Impuesto</span>
                  <span>{formatCurrency(detailRefund.tax, symbol)}</span>
                </div>
                <div className="flex justify-between font-semibold text-base border-t pt-1">
                  <span>Total devuelto</span>
                  <span className="text-red-600">
                    −{formatCurrency(detailRefund.total, symbol)}
                  </span>
                </div>
              </div>
              {detailRefund.notes && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Notas:</p>
                  <p>{detailRefund.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailRefund(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal nueva devolución */}
      <Dialog open={!!selectedSale} onOpenChange={(o) => !o && setSelectedSale(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Procesar devolución</DialogTitle>
            <DialogDescription>
              Venta {selectedSale?.id?.slice(-6)} ·{" "}
              {formatCurrency(selectedSale?.total || 0, symbol)}
            </DialogDescription>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900">
                    Selecciona los items a devolver
                  </p>
                  <p className="text-amber-700 text-xs">
                    Si dejas todas las cantidades en 0 o devuelves todo, se
                    procesará como devolución TOTAL y la venta se anulará.
                  </p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Vendido</TableHead>
                    <TableHead>P. Unit</TableHead>
                    <TableHead>A devolver</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedSale.items.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.product?.name}</TableCell>
                      <TableCell>{it.quantity}</TableCell>
                      <TableCell>{formatCurrency(it.unitPrice, symbol)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={it.quantity}
                          step="0.01"
                          value={returnItems[it.id] || 0}
                          onChange={(e) =>
                            setReturnItems({
                              ...returnItems,
                              [it.id]: Math.min(
                                it.quantity,
                                Math.max(0, parseFloat(e.target.value) || 0)
                              ),
                            })
                          }
                          className="w-24"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Resumen */}
              <div className="rounded-lg border p-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {isTotalRefund ? "Devolución TOTAL" : "Devolución PARCIAL"}
                  </span>
                  <Badge variant={isTotalRefund ? "destructive" : "secondary"}>
                    {isTotalRefund ? "TOTAL" : "PARCIAL"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatCurrency(refundSubtotal, symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Descuento prop.</span>
                  <span>−{formatCurrency(refundDiscount, symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Impuesto prop.</span>
                  <span>{formatCurrency(refundTax, symbol)}</span>
                </div>
                <div className="flex justify-between font-semibold text-base border-t pt-1">
                  <span>Total a devolver</span>
                  <span className="text-red-600">
                    −{formatCurrency(refundTotal, symbol)}
                  </span>
                </div>
              </div>

              {/* Método */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Método de devolución</Label>
                  <Select value={refundMethod} onValueChange={setRefundMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REFUND_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Motivo</Label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {REFUND_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Notas (opcional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Detalle adicional..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedSale(null)}>
              Cancelar
            </Button>
            <Button
              onClick={submitRefund}
              disabled={saving}
              className="bg-red-600 hover:bg-red-700"
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <RotateCcw className="w-4 h-4 mr-2" />
              Confirmar devolución
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
