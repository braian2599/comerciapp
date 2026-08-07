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
  FileText,
  Search,
  Eye,
  AlertTriangle,
  TrendingDown,
  Calendar,
  RefreshCw,
  Link2,
  QrCode,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

const NC_STATUS_LABELS: Record<string, string> = {
  EMITIDA: "Emitida",
  ANULADA: "Anulada",
  RECHAZADA: "Rechazada",
  PENDIENTE: "Pendiente",
};

const NC_STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  EMITIDA: "default",
  ANULADA: "secondary",
  RECHAZADA: "destructive",
  PENDIENTE: "outline",
};

export function CreditNotesView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";

  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filtros
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterTipo, setFilterTipo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  // Stats
  const totalMontoNC = useMemo(
    () =>
      creditNotes
        .filter((c) => c.status === "EMITIDA")
        .reduce((sum, c) => sum + c.total, 0),
    [creditNotes]
  );
  const hoy = new Date();
  const ncHoy = creditNotes.filter(
    (c) => new Date(c.fechaEmision).toDateString() === hoy.toDateString()
  ).length;

  async function load() {
    setLoading(true);
    try {
      // Construir query params para filtros server-side
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterTipo) params.set("tipo", filterTipo);
      const qs = params.toString();
      const url = `/api/credit-notes${qs ? `?${qs}` : ""}`;
      const data = await safeFetchArray<any>(url);
      setCreditNotes(data);
    } catch (e: any) {
      toast.error("Error al cargar notas de crédito", { description: e?.message });
      setCreditNotes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filterStatus, filterTipo]);

  // Filtrado client-side por término (numeroCompleto, cliente, CAE)
  const filteredNotes = useMemo(() => {
    if (!searchTerm.trim()) return creditNotes;
    const q = searchTerm.toLowerCase().trim();
    return creditNotes.filter((c) => {
      if (c.numeroCompleto?.toLowerCase().includes(q)) return true;
      if (c.cae?.toLowerCase().includes(q)) return true;
      if (c.customerName?.toLowerCase().includes(q)) return true;
      if (c.customer?.name?.toLowerCase().includes(q)) return true;
      if (c.refund?.refundNumber?.toLowerCase().includes(q)) return true;
      if (c.relatedInvoice?.numeroCompleto?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [creditNotes, searchTerm]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const { ok, data, error } = await safeFetchJSON<any>(`/api/credit-notes/${id}`);
      if (!ok) {
        toast.error(error || "Error al cargar detalle");
        setDetailOpen(false);
        return;
      }
      setDetailData(data);
    } catch (e: any) {
      toast.error("Error de conexión", { description: e?.message });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  function openQrInNewTab(qrData: string) {
    if (!qrData) {
      toast.error("Esta NC no tiene datos de QR");
      return;
    }
    window.open(qrData, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notas de Crédito</h1>
          <p className="text-sm text-muted-foreground">
            Notas de crédito electrónicas emitidas (AFIP/ARCA)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Actualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total NCs emitidas</p>
                <p className="text-xl font-bold">{creditNotes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
                <TrendingDown className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monto total acreditado</p>
                <p className="text-xl font-bold">
                  {formatCurrency(totalMontoNC, symbol)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">NCs hoy</p>
                <p className="text-xl font-bold">{ncHoy}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Buscar por N°, CAE, cliente, factura…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-sm"
            />
            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v === "ALL" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los estados</SelectItem>
                <SelectItem value="EMITIDA">Emitida</SelectItem>
                <SelectItem value="ANULADA">Anulada</SelectItem>
                <SelectItem value="RECHAZADA">Rechazada</SelectItem>
                <SelectItem value="PENDIENTE">Pendiente</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filterTipo}
              onValueChange={(v) => setFilterTipo(v === "ALL" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos los tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos los tipos</SelectItem>
                <SelectItem value="A">NC-A</SelectItem>
                <SelectItem value="B">NC-B</SelectItem>
                <SelectItem value="C">NC-C</SelectItem>
                <SelectItem value="M">NC-M</SelectItem>
                <SelectItem value="E">NC-E</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>
                {creditNotes.length === 0
                  ? "No hay notas de crédito emitidas"
                  : "No se encontraron NCs con esos filtros"}
              </p>
              <p className="text-xs mt-1">
                Las NCs se generan automáticamente al procesar una devolución
                con la opción "Emitir nota de crédito AFIP" activada.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° NC</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Factura vinculada</TableHead>
                    <TableHead>Refund</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredNotes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {c.numeroCompleto}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(c.fechaEmision)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          NC-{c.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.customer?.name || c.customerName || "Consumidor final"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.relatedInvoice ? (
                          <span className="inline-flex items-center gap-1">
                            <Link2 className="w-3 h-3 text-muted-foreground" />
                            {c.relatedInvoice.numeroCompleto}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.refund ? (
                          c.refund.refundNumber
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={NC_STATUS_VARIANTS[c.status] || "outline"}>
                          {NC_STATUS_LABELS[c.status] || c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-red-600">
                        −{formatCurrency(c.total, symbol)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDetail(c.id)}
                          title="Ver detalle"
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

      {/* Modal detalle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600" />
              Nota de crédito {detailData?.numeroCompleto}
            </DialogTitle>
            <DialogDescription>
              {detailData && `Emitida el ${formatDateTime(detailData.fechaEmision)}`}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin inline text-indigo-600" />
            </div>
          ) : detailData ? (
            <div className="space-y-4">
              {/* Grid de info principal */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card className="bg-indigo-50 border-indigo-200">
                  <CardContent className="p-3">
                    <p className="text-xs text-indigo-700">Número</p>
                    <p className="font-mono font-bold text-indigo-900">
                      {detailData.numeroCompleto}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Tipo</p>
                    <p className="font-bold">
                      NC-{detailData.tipo} · {detailData.concepto}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Estado</p>
                    <Badge variant={NC_STATUS_VARIANTS[detailData.status] || "outline"}>
                      {NC_STATUS_LABELS[detailData.status] || detailData.status}
                    </Badge>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">CAE</p>
                    <p className="font-mono text-sm">{detailData.cae || "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Vto. CAE</p>
                    <p className="text-sm">
                      {detailData.caeVencimiento
                        ? formatDateTime(detailData.caeVencimiento)
                        : "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Total NC</p>
                    <p className="font-bold text-red-600">
                      −{formatCurrency(detailData.total, symbol)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Botón QR */}
              {detailData.qrData && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openQrInNewTab(detailData.qrData)}
                  className="gap-2"
                >
                  <QrCode className="w-4 h-4" />
                  Ver QR AFIP (RG 4291)
                </Button>
              )}

              {/* Cliente */}
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p className="text-xs text-muted-foreground font-medium">Cliente</p>
                <p className="font-medium">{detailData.customerName}</p>
                {detailData.customerCuit && (
                  <p className="text-xs text-muted-foreground">
                    CUIT: <span className="font-mono">{detailData.customerCuit}</span> ·{" "}
                    {detailData.customerTaxType}
                  </p>
                )}
                {detailData.customer?.phone && (
                  <p className="text-xs text-muted-foreground">
                    Tel: {detailData.customer.phone}
                  </p>
                )}
              </div>

              {/* Factura original vinculada */}
              {detailData.relatedInvoice && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-1 text-sm">
                  <p className="text-xs text-indigo-700 font-medium flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" />
                    Factura original vinculada
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-indigo-800">
                    <div>
                      <span className="text-indigo-600">Comprobante:</span>{" "}
                      <span className="font-mono">
                        {detailData.relatedInvoice.numeroCompleto}
                      </span>
                    </div>
                    <div>
                      <span className="text-indigo-600">Tipo:</span>{" "}
                      Factura {detailData.relatedInvoice.tipo}
                    </div>
                    <div>
                      <span className="text-indigo-600">Fecha:</span>{" "}
                      {formatDateTime(detailData.relatedInvoice.fechaEmision)}
                    </div>
                    <div>
                      <span className="text-indigo-600">Total:</span>{" "}
                      {formatCurrency(detailData.relatedInvoice.total, symbol)}
                    </div>
                    <div>
                      <span className="text-indigo-600">CAE factura:</span>{" "}
                      <span className="font-mono">
                        {detailData.relatedInvoice.cae}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Refund que originó esta NC */}
              {detailData.refund && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-sm">
                  <p className="text-xs text-amber-700 font-medium">
                    Devolución que originó esta NC
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-amber-800">
                    <div>
                      <span className="text-amber-600">N° devolución:</span>{" "}
                      <span className="font-mono">
                        {detailData.refund.refundNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-amber-600">Tipo:</span>{" "}
                      {detailData.refund.type}
                    </div>
                    <div>
                      <span className="text-amber-600">Total refund:</span>{" "}
                      {formatCurrency(detailData.refund.total, symbol)}
                    </div>
                    <div>
                      <span className="text-amber-600">Fecha:</span>{" "}
                      {formatDateTime(detailData.refund.createdAt)}
                    </div>
                    {detailData.refund.reason && (
                      <div className="col-span-2">
                        <span className="text-amber-600">Motivo:</span>{" "}
                        {detailData.refund.reason}
                      </div>
                    )}
                    {detailData.refund.notes && (
                      <div className="col-span-2">
                        <span className="text-amber-600">Notas:</span>{" "}
                        {detailData.refund.notes}
                      </div>
                    )}
                  </div>

                  {detailData.refund.items?.length > 0 && (
                    <Table className="mt-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Producto</TableHead>
                          <TableHead>Cant.</TableHead>
                          <TableHead>P. Unit</TableHead>
                          <TableHead>Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailData.refund.items.map((it: any) => (
                          <TableRow key={it.id}>
                            <TableCell>{it.product?.name}</TableCell>
                            <TableCell>{it.quantity}</TableCell>
                            <TableCell>
                              {formatCurrency(it.unitPrice, symbol)}
                            </TableCell>
                            <TableCell>
                              {formatCurrency(it.subtotal, symbol)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}

              {/* Totales NC */}
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p className="text-xs text-muted-foreground font-medium">
                  Desglose NC
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Neto gravado</span>
                  <span>{formatCurrency(detailData.netoGravado, symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    IVA ({detailData.ivaRate}%)
                  </span>
                  <span>{formatCurrency(detailData.ivaAmount, symbol)}</span>
                </div>
                {detailData.noGravado > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">No gravado</span>
                    <span>{formatCurrency(detailData.noGravado, symbol)}</span>
                  </div>
                )}
                {detailData.exento > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exento</span>
                    <span>{formatCurrency(detailData.exento, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-base border-t pt-1">
                  <span>Total NC</span>
                  <span className="text-red-600">
                    −{formatCurrency(detailData.total, symbol)}
                  </span>
                </div>
              </div>

              {/* Datos del emisor */}
              {detailData.taxConfig && (
                <div className="rounded-lg border p-3 space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Emisor</p>
                  <p>
                    {detailData.taxConfig.razonSocial} · CUIT{" "}
                    <span className="font-mono">{detailData.taxConfig.cuit}</span>
                  </p>
                  <p>
                    Punto de venta: {detailData.puntoVenta} ·{" "}
                    {detailData.taxConfig.condicionFiscal}
                  </p>
                  {detailData.taxConfig.direccionFiscal && (
                    <p>{detailData.taxConfig.direccionFiscal}</p>
                  )}
                </div>
              )}

              {/* Observación */}
              {detailData.observation && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Observación:</p>
                  <p>{detailData.observation}</p>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
