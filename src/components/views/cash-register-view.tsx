"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Wallet,
  Lock,
  Unlock,
  Plus,
  Minus,
  Loader2,
  Printer,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calculator,
  Building2,
  Filter as FilterIcon,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

interface CashMovement {
  id: string;
  type: string;
  amount: number;
  concept: string;
  paymentMethod: string | null;
  refType: string | null;
  createdAt: string;
  user: { name: string };
}

interface Branch {
  id: string;
  name: string;
  code: string;
  active?: boolean;
}

interface PaymentMethod {
  id: string;
  name: string;
  type: string; // EFECTIVO, TARJETA_CREDITO, etc.
  active: boolean;
  isDefault: boolean;
}

interface CashRegister {
  id: string;
  openingDate: string;
  closingDate: string | null;
  openingBalance: number;
  closingBalance: number | null;
  expectedBalance: number | null;
  difference: number | null;
  status: string;
  notes: string | null;
  branchId: string | null;
  branch?: { id: string; name: string; code: string } | null;
  user: { name: string };
  movements: CashMovement[];
  _count?: { sales: number };
}

// Métodos de pago disponibles para movimientos manuales.
// Incluye siempre EFECTIVO como fallback, más los configurados por el store.
const FALLBACK_PAYMENT_METHODS = [
  { id: "EFECTIVO", name: "Efectivo", type: "EFECTIVO" },
  { id: "TRANSFERENCIA", name: "Transferencia", type: "TRANSFERENCIA" },
  { id: "TARJETA", name: "Tarjeta", type: "TARJETA" },
];

export function CashRegisterView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRegister, setOpenRegister] = useState<CashRegister | null>(null);

  // Datos auxiliares
  const [branches, setBranches] = useState<Branch[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // Filtros del historial
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Diálogos
  const [openDlg, setOpenDlg] = useState(false);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [openNotes, setOpenNotes] = useState("");
  const [openBranchId, setOpenBranchId] = useState<string>(""); // "" = sin sucursal
  const [creating, setCreating] = useState(false);

  const [closeDlg, setCloseDlg] = useState(false);
  const [closingBalance, setClosingBalance] = useState(0);
  const [closeNotes, setCloseNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const [movDlg, setMovDlg] = useState(false);
  const [movType, setMovType] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [movAmount, setMovAmount] = useState(0);
  const [movConcept, setMovConcept] = useState("");
  const [movPaymentMethod, setMovPaymentMethod] = useState<string>("EFECTIVO");
  const [savingMov, setSavingMov] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterBranch !== "all") params.set("branchId", filterBranch);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);

      const data = await safeFetchArray<CashRegister>(`/api/cash-registers?${params.toString()}`);
      setRegisters(data);
      const open = data.find((r: CashRegister) => r.status === "ABIERTA");
      setOpenRegister(open || null);
    } catch (e: any) {
      toast.error("Error al cargar cajas", { description: e?.message });
      setRegisters([]);
      setOpenRegister(null);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterBranch, filterFrom, filterTo]);

  // Cargar branches y payment methods (una sola vez)
  useEffect(() => {
    async function loadAux() {
      try {
        const [brs, pms] = await Promise.all([
          safeFetchArray<Branch>("/api/branches"),
          safeFetchArray<PaymentMethod>("/api/payment-methods"),
        ]);
        setBranches(brs);
        setPaymentMethods(pms.filter((p) => p.active));
      } catch {
        // No crítico: los selectores tendrán fallbacks
      }
    }
    loadAux();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Lista de opciones de métodos de pago para movimientos manuales.
  // Preferimos los configurados por el store; si no hay, usamos fallback.
  const paymentMethodOptions = useMemo(() => {
    if (paymentMethods.length > 0) {
      return paymentMethods.map((p) => ({
        id: p.name.toUpperCase().replace(/\s+/g, "_"), // "Tarjeta Crédito" → "TARJETA_CREDITO"
        name: p.name,
        type: p.type,
      }));
    }
    return FALLBACK_PAYMENT_METHODS;
  }, [paymentMethods]);

  // Totales del arqueo en vivo
  const arqueo = useMemo(() => {
    if (!openRegister) return null;
    const ventas = openRegister.movements.filter((m) => m.type === "VENTA");
    const ventasEfectivo = ventas
      .filter((m) => m.paymentMethod === "EFECTIVO")
      .reduce((s, m) => s + m.amount, 0);
    const ingresos = openRegister.movements
      .filter((m) => m.type === "INGRESO")
      .reduce((s, m) => s + m.amount, 0);
    const egresos = openRegister.movements
      .filter((m) => m.type === "EGRESO")
      .reduce((s, m) => s + m.amount, 0);
    const pagosCuenta = openRegister.movements
      .filter((m) => m.type === "PAGO_CUENTA")
      .reduce((s, m) => s + m.amount, 0);
    const expected =
      openRegister.openingBalance + ventasEfectivo + ingresos + pagosCuenta - egresos;
    return {
      ventasEfectivo,
      ingresos,
      egresos,
      pagosCuenta,
      expected,
      totalMovimientos: openRegister.movements.length,
    };
  }, [openRegister]);

  async function openNewRegister() {
    setCreating(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/cash-registers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openingBalance,
          notes: openNotes,
          branchId: openBranchId || null,
        }),
      });
      if (!ok) throw new Error(error);
      toast.success("Caja abierta");
      setOpenDlg(false);
      setOpeningBalance(0);
      setOpenNotes("");
      setOpenBranchId("");
      await load();
    } catch (e: any) {
      toast.error("Error al abrir caja", { description: e?.message });
    } finally {
      setCreating(false);
    }
  }

  async function closeRegister() {
    if (!openRegister) return;
    setClosing(true);
    try {
      const { ok, data, error } = await safeFetchJSON<any>("/api/cash-registers/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: openRegister.id,
          closingBalance,
          notes: closeNotes,
        }),
      });
      if (!ok) throw new Error(error);
      toast.success(
        `Caja cerrada. Diferencia: ${formatCurrency(data.difference || 0, symbol)}`
      );
      setCloseDlg(false);
      setClosingBalance(0);
      setCloseNotes("");
      await load();
    } catch (e: any) {
      toast.error("Error al cerrar caja", { description: e?.message });
    } finally {
      setClosing(false);
    }
  }

  async function saveMovement() {
    if (!openRegister) return;
    if (movAmount <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    if (!movConcept.trim()) {
      toast.error("Ingresá un concepto");
      return;
    }
    setSavingMov(true);
    try {
      const { ok, error } = await safeFetchJSON("/api/cash-registers/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashRegisterId: openRegister.id,
          type: movType,
          amount: movAmount,
          concept: movConcept,
          paymentMethod: movPaymentMethod,
        }),
      });
      if (!ok) throw new Error(error);
      toast.success(movType === "INGRESO" ? "Ingreso registrado" : "Egreso registrado");
      setMovDlg(false);
      setMovAmount(0);
      setMovConcept("");
      setMovPaymentMethod("EFECTIVO");
      await load();
    } catch (e: any) {
      toast.error("Error al registrar movimiento", { description: e?.message });
    } finally {
      setSavingMov(false);
    }
  }

  if (loading && registers.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Caja</h1>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
          <p className="text-sm text-muted-foreground">
            Apertura, arqueo y cierre de caja diaria
          </p>
        </div>
        {openRegister ? (
          <Button
            onClick={() => {
              setClosingBalance(arqueo?.expected || 0);
              setCloseNotes("");
              setCloseDlg(true);
            }}
            className="bg-red-600 hover:bg-red-700"
          >
            <Lock className="w-4 h-4 mr-2" />
            Cerrar caja
          </Button>
        ) : (
          <Button
            onClick={() => setOpenDlg(true)}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Unlock className="w-4 h-4 mr-2" />
            Abrir caja
          </Button>
        )}
      </div>

      {/* Caja abierta - panel principal */}
      {openRegister && arqueo && (
        <div className="space-y-4">
          {/* Resumen */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Wallet className="w-3 h-3" /> Apertura
                </div>
                <p className="text-xl font-bold mt-1">
                  {formatCurrency(openRegister.openingBalance, symbol)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(openRegister.openingDate)}
                </p>
                {openRegister.branch && (
                  <p className="text-xs mt-1 inline-flex items-center gap-1 text-indigo-700">
                    <Building2 className="w-3 h-3" />
                    {openRegister.branch.name} ({openRegister.branch.code})
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <TrendingUp className="w-3 h-3 text-indigo-600" /> Ventas efectivo
                </div>
                <p className="text-xl font-bold mt-1 text-indigo-700">
                  +{formatCurrency(arqueo.ventasEfectivo, symbol)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {openRegister._count?.sales || 0} ventas totales
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <TrendingDown className="w-3 h-3 text-red-600" /> Egresos
                </div>
                <p className="text-xl font-bold mt-1 text-red-700">
                  -{formatCurrency(arqueo.egresos, symbol)}
                </p>
                <p className="text-xs text-muted-foreground">
                  +{formatCurrency(arqueo.ingresos + arqueo.pagosCuenta, symbol)} ingresos
                </p>
              </CardContent>
            </Card>
            <Card className="border-indigo-300 bg-indigo-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-indigo-700 text-xs font-medium">
                  <Calculator className="w-3 h-3" /> Balance esperado
                </div>
                <p className="text-2xl font-bold mt-1 text-indigo-700">
                  {formatCurrency(arqueo.expected, symbol)}
                </p>
                <p className="text-xs text-indigo-600">
                  Conteo físico al cerrar
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Movimientos de caja */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Movimientos de caja</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMovType("INGRESO");
                      setMovAmount(0);
                      setMovConcept("");
                      setMovPaymentMethod("EFECTIVO");
                      setMovDlg(true);
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Ingreso
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMovType("EGRESO");
                      setMovAmount(0);
                      setMovConcept("");
                      setMovPaymentMethod("EFECTIVO");
                      setMovDlg(true);
                    }}
                  >
                    <Minus className="w-4 h-4 mr-1" /> Egreso
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {openRegister.movements.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Sin movimientos manuales todavía. Las ventas en efectivo aparecerán automáticamente.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Hora</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Usuario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...openRegister.movements]
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((m) => {
                        const isIngreso = ["VENTA", "INGRESO", "PAGO_CUENTA"].includes(m.type);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(m.createdAt)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  isIngreso
                                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                    : "bg-red-50 text-red-700 border-red-200"
                                }
                              >
                                {m.type === "VENTA" ? "Venta" : m.type === "PAGO_CUENTA" ? "Pago cta." : m.type === "INGRESO" ? "Ingreso" : "Egreso"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{m.concept}</TableCell>
                            <TableCell>
                              {m.paymentMethod ? (
                                <Badge variant="outline" className="text-xs">
                                  {m.paymentMethod}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                isIngreso ? "text-indigo-700" : "text-red-700"
                              }`}
                            >
                              {isIngreso ? "+" : "-"}
                              {formatCurrency(m.amount, symbol)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {m.user?.name || "-"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sin caja abierta */}
      {!openRegister && (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-lg font-medium">No hay caja abierta</p>
            <p className="text-sm text-muted-foreground mb-4">
              Abrí una caja para empezar a registrar ventas en efectivo y movimientos.
            </p>
            <Button
              onClick={() => setOpenDlg(true)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Unlock className="w-4 h-4 mr-2" />
              Abrir caja ahora
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Filtros del historial */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FilterIcon className="w-4 h-4" /> Filtros del historial
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Estado</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="ABIERTA">Abiertas</SelectItem>
                <SelectItem value="CERRADA">Cerradas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sucursal</Label>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="null">Sin sucursal</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          {(filterStatus !== "all" || filterBranch !== "all" || filterFrom || filterTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterStatus("all");
                setFilterBranch("all");
                setFilterFrom("");
                setFilterTo("");
              }}
            >
              Limpiar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Historial de cajas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de cajas</CardTitle>
        </CardHeader>
        <CardContent>
          {registers.filter((r) => r.status === "CERRADA").length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay cajas cerradas con estos filtros
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Apertura</TableHead>
                    <TableHead>Cierre</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead className="text-right">Apertura</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Real</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registers
                    .filter((r) => r.status === "CERRADA")
                    .map((r) => {
                      const diff = r.difference || 0;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">
                            {formatDateTime(r.openingDate)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.closingDate ? formatDateTime(r.closingDate) : "-"}
                          </TableCell>
                          <TableCell>
                            {r.branch ? (
                              <Badge variant="outline" className="text-xs">
                                <Building2 className="w-3 h-3 mr-1" />
                                {r.branch.name}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{r.user?.name || "-"}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.openingBalance, symbol)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.expectedBalance || 0, symbol)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.closingBalance || 0, symbol)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              Math.abs(diff) < 0.01
                                ? "text-muted-foreground"
                                : diff > 0
                                ? "text-indigo-700"
                                : "text-red-700"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}
                            {formatCurrency(diff, symbol)}
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

      {/* Diálogo abrir caja */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir caja</DialogTitle>
            <DialogDescription>
              Registrá el monto inicial en efectivo que hay en la caja al empezar el día.
              Si operás con múltiples sucursales, seleccioná dónde opera esta caja.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Sucursal (opcional)</Label>
              <Select
                value={openBranchId || "none"}
                onValueChange={(v) => setOpenBranchId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin sucursal (caja global)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin sucursal (caja global)</SelectItem>
                  {branches
                    .filter((b) => b.active !== false)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                La sucursal asigna la caja a un punto de venta físico para reportes multi-sucursal.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Monto inicial (efectivo)</Label>
              <Input
                type="number"
                step="1"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(Number(e.target.value))}
                className="text-lg font-medium"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={openNotes}
                onChange={(e) => setOpenNotes(e.target.value)}
                placeholder="Ej: cambio suelto, turnos, observaciones..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDlg(false)}>
              Cancelar
            </Button>
            <Button
              onClick={openNewRegister}
              disabled={creating}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Abrir caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo cerrar caja (arqueo) */}
      <AlertDialog open={closeDlg} onOpenChange={setCloseDlg}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar caja - Arqueo</AlertDialogTitle>
            <AlertDialogDescription>
              Contá el efectivo real en caja y registrá el monto. El sistema calculará la diferencia con el esperado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-indigo-50 border border-indigo-200 rounded-md p-3">
              <p className="text-xs text-indigo-700">Balance esperado según sistema</p>
              <p className="text-2xl font-bold text-indigo-700">
                {formatCurrency(arqueo?.expected || 0, symbol)}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Balance real contado</Label>
              <Input
                type="number"
                step="1"
                value={closingBalance}
                onChange={(e) => setClosingBalance(Number(e.target.value))}
                className="text-lg font-medium"
                autoFocus
              />
            </div>
            {arqueo && (
              <div
                className={`text-sm font-medium p-2 rounded-md ${
                  Math.abs(closingBalance - arqueo.expected) < 0.01
                    ? "bg-muted text-muted-foreground"
                    : closingBalance > arqueo.expected
                    ? "bg-indigo-50 text-indigo-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                Diferencia:{" "}
                {closingBalance - arqueo.expected > 0 ? "+" : ""}
                {formatCurrency(closingBalance - arqueo.expected, symbol)}
              </div>
            )}
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="Explicación de la diferencia, observaciones..."
                rows={2}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                closeRegister();
              }}
              disabled={closing}
              className="bg-red-600 hover:bg-red-700"
            >
              {closing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar cierre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo movimiento manual */}
      <Dialog open={movDlg} onOpenChange={setMovDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {movType === "INGRESO" ? "Registrar ingreso" : "Registrar egreso"}
            </DialogTitle>
            <DialogDescription>
              {movType === "INGRESO"
                ? "Ej: cobro de cuenta corriente, devolución, etc."
                : "Ej: compra de mercadería, pago a proveedor, gasto chico, etc."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Monto</Label>
              <Input
                type="number"
                step="1"
                value={movAmount}
                onChange={(e) => setMovAmount(Number(e.target.value))}
                className="text-lg font-medium"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Concepto</Label>
              <Input
                value={movConcept}
                onChange={(e) => setMovConcept(e.target.value)}
                placeholder={
                  movType === "INGRESO"
                    ? "Ej: Pago de cuenta corriente de Juan"
                    : "Ej: Compra de bolsas, cambio, etc."
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Método de pago</Label>
              <Select
                value={movPaymentMethod}
                onValueChange={setMovPaymentMethod}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethodOptions.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>
                      {pm.name}
                      {pm.type && pm.type !== pm.id && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({pm.type})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                El método se registra como snapshot en el movimiento de caja. Solo EFECTIVO
                se suma al balance esperado de arqueo; los demás métodos quedan registrados
                para auditoría pero no afectan el conteo físico.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovDlg(false)}>
              Cancelar
            </Button>
            <Button
              onClick={saveMovement}
              disabled={savingMov}
              className={
                movType === "INGRESO"
                  ? "bg-indigo-600 hover:bg-indigo-700"
                  : "bg-red-600 hover:bg-red-700"
              }
            >
              {savingMov && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {movType === "INGRESO" ? "Registrar ingreso" : "Registrar egreso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
