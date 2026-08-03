"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime } from "@/lib/constants";

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
  user: { name: string };
  movements: CashMovement[];
  _count?: { sales: number };
}

export function CashRegisterView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRegister, setOpenRegister] = useState<CashRegister | null>(null);

  // Diálogos
  const [openDlg, setOpenDlg] = useState(false);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [openNotes, setOpenNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const [closeDlg, setCloseDlg] = useState(false);
  const [closingBalance, setClosingBalance] = useState(0);
  const [closeNotes, setCloseNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const [movDlg, setMovDlg] = useState(false);
  const [movType, setMovType] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [movAmount, setMovAmount] = useState(0);
  const [movConcept, setMovConcept] = useState("");
  const [savingMov, setSavingMov] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cash-registers?limit=30");
      const data = await res.json();
      setRegisters(data);
      const open = data.find((r: CashRegister) => r.status === "ABIERTA");
      setOpenRegister(open || null);
    } catch {
      toast.error("Error al cargar cajas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      const res = await fetch("/api/cash-registers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingBalance, notes: openNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Caja abierta");
      setOpenDlg(false);
      setOpeningBalance(0);
      setOpenNotes("");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function closeRegister() {
    if (!openRegister) return;
    setClosing(true);
    try {
      const res = await fetch("/api/cash-registers/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: openRegister.id,
          closingBalance,
          notes: closeNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Caja cerrada. Diferencia: ${formatCurrency(data.difference || 0, symbol)}`
      );
      setCloseDlg(false);
      setClosingBalance(0);
      setCloseNotes("");
      await load();
    } catch (e: any) {
      toast.error(e.message);
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
      const res = await fetch("/api/cash-registers/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cashRegisterId: openRegister.id,
          type: movType,
          amount: movAmount,
          concept: movConcept,
          paymentMethod: "EFECTIVO",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(movType === "INGRESO" ? "Ingreso registrado" : "Egreso registrado");
      setMovDlg(false);
      setMovAmount(0);
      setMovConcept("");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingMov(false);
    }
  }

  if (loading) {
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

      {/* Historial de cajas cerradas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de cajas</CardTitle>
        </CardHeader>
        <CardContent>
          {registers.filter((r) => r.status === "CERRADA").length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay cajas cerradas todavía
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Apertura</TableHead>
                  <TableHead>Cierre</TableHead>
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
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Monto inicial (efectivo)</Label>
              <Input
                type="number"
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
        <AlertDialogContent className="max-w-md">
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
