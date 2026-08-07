"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  FileText,
  Loader2,
  Search,
  Trash2,
  Plus,
  QrCode,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDate } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

export function InvoicesView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [invoices, setInvoices] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTipo, setFilterTipo] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [taxConfig, setTaxConfig] = useState<any>(null);

  // Dialogs
  const [openCreate, setOpenCreate] = useState(false);
  const [openDetail, setOpenDetail] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [createForm, setCreateForm] = useState({
    saleId: "",
    tipo: "",
    concepto: "PRODUCTOS",
  });
  const [creating, setCreating] = useState(false);
  const [anularId, setAnularId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [inv, sal, tax] = await Promise.all([
        safeFetchArray<any>("/api/invoices?limit=200"),
        safeFetchArray<any>("/api/sales?limit=200"),
        safeFetchJSON<any>("/api/tax-config"),
      ]);
      setInvoices(inv);
      // Solo ventas sin factura y completadas.
      // Opción B: ordenamos para que aparezcan primero las ventas cuyo
      // método de pago tiene requiresInvoice=true (son las que el usuario
      // marcó como "requiere factura" pero todavía no facturó).
      const pending = sal
        .filter((s: any) => !s.invoice && s.status === "COMPLETADA")
        .sort((a: any, b: any) => {
          const aReq = a.paymentMethodRef?.requiresInvoice ? 1 : 0;
          const bReq = b.paymentMethodRef?.requiresInvoice ? 1 : 0;
          if (aReq !== bReq) return bReq - aReq; // requiresInvoice primero
          // dentro del mismo grupo, más recientes primero
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      setSales(pending);
      if (tax.ok && tax.data && !Array.isArray(tax.data) && typeof tax.data === "object") {
        setTaxConfig(tax.data);
      }
    } catch (err) {
      toast.error("Error cargando facturas");
      setInvoices([]);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = invoices.filter((inv) => {
    if (filterTipo !== "all" && inv.tipo !== filterTipo) return false;
    if (filterStatus !== "all" && inv.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !inv.numeroCompleto?.toLowerCase().includes(s) &&
        !inv.customerName?.toLowerCase().includes(s) &&
        !inv.cae?.toLowerCase().includes(s)
      ) {
        return false;
      }
    }
    return true;
  });

  const totalFacturado = filtered
    .filter((i) => i.status === "EMITIDA")
    .reduce((s, i) => s + i.total, 0);
  const totalIva = filtered
    .filter((i) => i.status === "EMITIDA")
    .reduce((s, i) => s + i.ivaAmount, 0);

  async function handleCreate() {
    if (!createForm.saleId) {
      toast.error("Selecciona una venta");
      return;
    }
    setCreating(true);
    try {
      const body: any = { saleId: createForm.saleId };
      if (createForm.tipo) body.tipo = createForm.tipo;
      body.concepto = createForm.concepto;
      const { ok, data, error } = await safeFetchJSON<any>("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!ok) {
        toast.error(error || "Error emitiendo factura");
        return;
      }
      toast.success(`Factura ${data.numeroCompleto} emitida. CAE: ${data.cae}`);
      setOpenCreate(false);
      setCreateForm({ saleId: "", tipo: "", concepto: "PRODUCTOS" });
      load();
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  async function handleAnular() {
    if (!anularId) return;
    try {
      const { ok, error } = await safeFetchJSON(`/api/invoices/${anularId}`, { method: "DELETE" });
      if (!ok) {
        toast.error(error || "Error anulando");
        return;
      }
      toast.success("Factura anulada");
      setAnularId(null);
      load();
    } catch (err) {
      toast.error("Error de conexión");
    }
  }

  async function openDetailModal(inv: any) {
    try {
      const { ok, data, error } = await safeFetchJSON<any>(`/api/invoices/${inv.id}`);
      if (!ok) {
        toast.error(error || "Error cargando detalle");
        return;
      }
      setSelectedInvoice(data);
      setOpenDetail(true);
    } catch {
      toast.error("Error cargando detalle");
    }
  }

  function exportarCSV() {
    const rows = [
      ["Número", "Tipo", "Fecha", "Cliente", "CUIT", "Neto", "IVA", "Total", "CAE", "Venc.CAE", "Estado"],
      ...filtered.map((i) => [
        i.numeroCompleto,
        i.tipo,
        formatDate(i.fechaEmision),
        i.customerName,
        i.customerCuit || "",
        i.netoGravado.toFixed(2),
        i.ivaAmount.toFixed(2),
        i.total.toFixed(2),
        i.cae || "",
        i.caeVencimiento ? formatDate(i.caeVencimiento) : "",
        i.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600" />
            Facturación Electrónica
          </h1>
          <p className="text-sm text-muted-foreground">
            Emisión de facturas AFIP/ARCA con CAE y QR RG 4291
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportarCSV} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
          <Button onClick={() => setOpenCreate(true)} disabled={!taxConfig?.active}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva Factura
          </Button>
        </div>
      </div>

      {!taxConfig?.active && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">Configuración fiscal pendiente</p>
              <p className="text-amber-700">
                Para emitir facturas electrónicas, configurá tus datos de AFIP en Configuración → Facturación.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total facturado</p>
            <p className="text-xl font-bold text-indigo-700">
              {formatCurrency(totalFacturado, symbol)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">IVA recaudado</p>
            <p className="text-xl font-bold text-blue-700">
              {formatCurrency(totalIva, symbol)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Facturas emitidas</p>
            <p className="text-xl font-bold">
              {filtered.filter((i) => i.status === "EMITIDA").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Ventas sin facturar</p>
            <p className="text-xl font-bold text-amber-600">{sales.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Número, cliente, CAE..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={filterTipo} onValueChange={setFilterTipo}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="EMITIDA">Emitida</SelectItem>
                <SelectItem value="ANULADA">Anulada</SelectItem>
                <SelectItem value="RECHAZADA">Rechazada</SelectItem>
                <SelectItem value="PENDIENTE">Pendiente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No hay facturas para mostrar</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>CAE</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetailModal(inv)}
                  >
                    <TableCell className="font-mono font-medium">{inv.numeroCompleto}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.tipo}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(inv.fechaEmision)}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{inv.customerName}</TableCell>
                    <TableCell className="text-right">{formatCurrency(inv.netoGravado, symbol)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(inv.ivaAmount, symbol)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(inv.total, symbol)}</TableCell>
                    <TableCell className="font-mono text-xs">{inv.cae || "-"}</TableCell>
                    <TableCell>
                      {inv.status === "EMITIDA" && (
                        <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Emitida
                        </Badge>
                      )}
                      {inv.status === "ANULADA" && (
                        <Badge variant="destructive">Anulada</Badge>
                      )}
                      {inv.status === "RECHAZADA" && (
                        <Badge variant="destructive">Rechazada</Badge>
                      )}
                      {inv.status === "PENDIENTE" && (
                        <Badge variant="secondary">Pendiente</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.status === "EMITIDA" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAnularId(inv.id);
                          }}
                          title="Anular"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modal Crear */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir Factura Electrónica</DialogTitle>
            <DialogDescription>
              Selecciona una venta para emitir su factura ante AFIP/ARCA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Venta a facturar</Label>
              <Select
                value={createForm.saleId}
                onValueChange={(v) => setCreateForm({ ...createForm, saleId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar venta..." />
                </SelectTrigger>
                <SelectContent>
                  {sales.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No hay ventas pendientes de facturar
                    </SelectItem>
                  ) : (
                    sales.slice(0, 50).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.paymentMethodRef?.requiresInvoice ? "★ " : ""}
                        {formatDate(s.createdAt)} - {s.customer?.name || "Consumidor Final"} - {formatCurrency(s.total, symbol)}
                        {s.paymentMethodRef?.requiresInvoice ? " (requiere factura)" : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo de factura</Label>
                <Select
                  value={createForm.tipo || "_auto"}
                  onValueChange={(v) => setCreateForm({ ...createForm, tipo: v === "_auto" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_auto">Automático</SelectItem>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                    <SelectItem value="C">C</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Automático según condición fiscal del cliente
                </p>
              </div>
              <div>
                <Label>Concepto</Label>
                <Select
                  value={createForm.concepto}
                  onValueChange={(v) => setCreateForm({ ...createForm, concepto: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRODUCTOS">Productos</SelectItem>
                    <SelectItem value="SERVICIOS">Servicios</SelectItem>
                    <SelectItem value="PRODUCTOS_Y_SERVICIOS">Productos y Servicios</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {taxConfig && (
              <div className="bg-muted/50 rounded-md p-3 text-xs space-y-1">
                <p><strong>Emisor:</strong> {taxConfig.razonSocial} - CUIT {taxConfig.cuit}</p>
                <p><strong>Condición:</strong> {taxConfig.condicionFiscal} - Punto venta {taxConfig.puntoVenta}</p>
                <p><strong>IVA:</strong> {taxConfig.ivaRate}% - Modo: {taxConfig.environment}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating || !createForm.saleId}>
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Emitiendo...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" /> Emitir Factura
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalle */}
      <Dialog open={openDetail} onOpenChange={setOpenDetail}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalle de Factura</DialogTitle>
            <DialogDescription>
              {selectedInvoice?.numeroCompleto} - {selectedInvoice?.tipo}
            </DialogDescription>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {/* Encabezado */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Fecha emisión</p>
                  <p className="font-medium">{formatDate(selectedInvoice.fechaEmision)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Concepto</p>
                  <p className="font-medium">{selectedInvoice.concepto}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedInvoice.customerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CUIT Cliente</p>
                  <p className="font-medium">{selectedInvoice.customerCuit || "Sin identificar (CF)"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Condición IVA</p>
                  <p className="font-medium">{selectedInvoice.customerTaxType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <p>
                    {selectedInvoice.status === "EMITIDA" && (
                      <Badge className="bg-indigo-100 text-indigo-700">Emitida</Badge>
                    )}
                    {selectedInvoice.status === "ANULADA" && (
                      <Badge variant="destructive">Anulada</Badge>
                    )}
                    {selectedInvoice.status === "RECHAZADA" && (
                      <Badge variant="destructive">Rechazada</Badge>
                    )}
                    {selectedInvoice.status === "PENDIENTE" && (
                      <Badge variant="secondary">Pendiente</Badge>
                    )}
                  </p>
                </div>
              </div>

              {/* Datos AFIP */}
              {selectedInvoice.cae && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-md p-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-indigo-700">CAE</p>
                    <p className="font-mono font-bold text-indigo-900">{selectedInvoice.cae}</p>
                  </div>
                  <div>
                    <p className="text-xs text-indigo-700">Vencimiento CAE</p>
                    <p className="font-medium text-indigo-900">
                      {selectedInvoice.caeVencimiento ? formatDate(selectedInvoice.caeVencimiento) : "-"}
                    </p>
                  </div>
                </div>
              )}

              {/* Items */}
              {selectedInvoice.sale?.items && (
                <div>
                  <p className="text-sm font-medium mb-2">Items facturados</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cant.</TableHead>
                        <TableHead className="text-right">P. Unit.</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedInvoice.sale.items.map((it: any) => (
                        <TableRow key={it.id}>
                          <TableCell>{it.product?.name || "N/A"}</TableCell>
                          <TableCell className="text-right">{it.quantity}</TableCell>
                          <TableCell className="text-right">{formatCurrency(it.unitPrice, symbol)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(it.subtotal, symbol)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Totales */}
              <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Neto gravado:</span>
                  <span className="font-medium">{formatCurrency(selectedInvoice.netoGravado, symbol)}</span>
                </div>
                {selectedInvoice.ivaAmount > 0 && (
                  <div className="flex justify-between">
                    <span>IVA ({selectedInvoice.ivaRate}%):</span>
                    <span className="font-medium">{formatCurrency(selectedInvoice.ivaAmount, symbol)}</span>
                  </div>
                )}
                {selectedInvoice.noGravado > 0 && (
                  <div className="flex justify-between">
                    <span>No gravado:</span>
                    <span className="font-medium">{formatCurrency(selectedInvoice.noGravado, symbol)}</span>
                  </div>
                )}
                {selectedInvoice.exento > 0 && (
                  <div className="flex justify-between">
                    <span>Exento:</span>
                    <span className="font-medium">{formatCurrency(selectedInvoice.exento, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold pt-1 border-t">
                  <span>Total:</span>
                  <span>{formatCurrency(selectedInvoice.total, symbol)}</span>
                </div>
              </div>

              {/* QR */}
              {selectedInvoice.qrData && (
                <div className="flex flex-col items-center gap-2 py-2 border-t">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <QrCode className="w-4 h-4" /> QR AFIP RG 4291
                  </p>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(selectedInvoice.qrData)}`}
                    alt="QR Factura"
                    className="w-44 h-44 border rounded"
                  />
                  <p className="text-xs text-muted-foreground text-center max-w-md">
                    Escanear para validar la factura en AFIP
                  </p>
                </div>
              )}

              {selectedInvoice.observation && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-2 text-xs text-amber-800">
                  <strong>Observaciones AFIP:</strong> {selectedInvoice.observation}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDetail(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar anulación */}
      <AlertDialog open={!!anularId} onOpenChange={(v) => !v && setAnularId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular factura?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción marca la factura como ANULADA. Para cumplir con AFIP deberás emitir
              una nota de crédito. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAnular}
              className="bg-red-600 hover:bg-red-700"
            >
              Sí, anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
