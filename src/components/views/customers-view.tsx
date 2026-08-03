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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Users,
  Phone,
  Mail,
  Loader2,
  Wallet,
  ReceiptText,
  ArrowDownCircle,
  ArrowUpCircle,
  Star,
  Award,
  Gift,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_TYPES } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  creditLimit?: number;
  saldo?: number;
  _count?: { sales: number };
  loyaltyPoints?: number;
  loyaltyTier?: string;
  totalSpent?: number;
  totalSales?: number;
}

interface LedgerItem {
  id: string;
  date: string;
  type: "DEBE" | "HABER";
  description: string;
  amount: number;
  user?: string;
  balanceAfter: number;
}

interface AccountState {
  customer: Customer;
  saldo: number;
  creditLimit: number;
  disponible: number;
  movimientos: LedgerItem[];
  totalVentas: number;
  totalPagos: number;
}

const emptyForm = {
  id: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  creditLimit: 0,
};

export function CustomersView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Cuenta corriente
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountData, setAccountData] = useState<AccountState | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("EFECTIVO");
  const [payNotes, setPayNotes] = useState("");
  const [paySaving, setPaySaving] = useState(false);

  // Fidelización - puntos
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsData, setPointsData] = useState<any | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState(0);
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);

  // Programa de fidelización (cargado una vez)
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [custRes, loyRes] = await Promise.all([
        safeFetchArray<Customer>("/api/customers"),
        safeFetchJSON<any>("/api/loyalty"),
      ]);
      setCustomers(custRes);
      const loy = loyRes.data;
      setLoyaltyEnabled(!!loy?.enabled && typeof loy === "object" && !Array.isArray(loy));
    } catch {
      toast.error("No se pudieron cargar los clientes");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(s) ||
        c.phone?.toLowerCase().includes(s) ||
        c.email?.toLowerCase().includes(s)
      );
    });
  }, [customers, search]);

  const saldoTotal = customers.reduce((s, c) => s + (c.saldo || 0), 0);

  function openNew() {
    setForm({ ...emptyForm });
    setFormOpen(true);
  }

  function openEdit(c: Customer) {
    setForm({ ...c, creditLimit: c.creditLimit || 0 });
    setFormOpen(true);
  }

  async function openAccount(c: Customer) {
    setAccountOpen(true);
    setAccountLoading(true);
    setAccountData(null);
    try {
      const res = await fetch(`/api/customers/account?customerId=${c.id}`);
      const data = await res.json();
      setAccountData(data);
    } catch {
      toast.error("Error al cargar cuenta");
    } finally {
      setAccountLoading(false);
    }
  }

  async function openPoints(c: Customer) {
    setPointsOpen(true);
    setPointsLoading(true);
    setPointsData(null);
    setAdjustPoints(0);
    setAdjustNotes("");
    try {
      const res = await fetch(`/api/loyalty/points?customerId=${c.id}`);
      const data = await res.json();
      setPointsData(data);
    } catch {
      toast.error("Error al cargar puntos");
    } finally {
      setPointsLoading(false);
    }
  }

  async function handleAdjustPoints() {
    if (!pointsData?.customer?.id) return;
    if (adjustPoints === 0) {
      toast.error("Indica puntos (positivo o negativo)");
      return;
    }
    setAdjustSaving(true);
    try {
      const res = await fetch("/api/loyalty/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: pointsData.customer.id,
          points: adjustPoints,
          description: adjustNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Puntos ajustados");
      // Recargar
      await openPoints(pointsData.customer);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdjustSaving(false);
    }
  }

  async function handleSave() {
    if (!form.name) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const method = form.id ? "PUT" : "POST";
      const res = await fetch("/api/customers", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(form.id ? "Cliente actualizado" : "Cliente creado");
      setFormOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/customers?id=${deleteId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Cliente eliminado");
      setDeleteId(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handlePayment() {
    if (!accountData) return;
    if (payAmount <= 0) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    setPaySaving(true);
    try {
      const res = await fetch("/api/customers/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: accountData.customer.id,
          amount: payAmount,
          paymentMethod: payMethod,
          notes: payNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Pago registrado");
      setPayOpen(false);
      setPayAmount(0);
      setPayNotes("");
      // Recargar cuenta y lista
      await openAccount(accountData.customer);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPaySaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            {customers.length} clientes · Saldo total en cuentas:{" "}
            <span className={saldoTotal > 0 ? "text-amber-700 font-medium" : ""}>
              {formatCurrency(saldoTotal, symbol)}
            </span>
          </p>
        </div>
        <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" />
          Nuevo cliente
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, teléfono o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
              Cargando clientes...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {search
                  ? "No se encontraron clientes"
                  : "Aún no tenés clientes registrados"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="hidden sm:table-cell">Contacto</TableHead>
                    <TableHead className="text-center">Compras</TableHead>
                    {loyaltyEnabled && (
                      <TableHead className="text-center">Puntos / Tier</TableHead>
                    )}
                    <TableHead className="text-right">Saldo cta.</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const saldo = c.saldo || 0;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <p className="font-medium">{c.name}</p>
                          {c.notes && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {c.notes}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <div className="text-sm space-y-0.5">
                            {c.phone && (
                              <p className="flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {c.phone}
                              </p>
                            )}
                            {c.email && (
                              <p className="flex items-center gap-1 text-muted-foreground">
                                <Mail className="w-3 h-3" />
                                {c.email}
                              </p>
                            )}
                            {!c.phone && !c.email && (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{c._count?.sales || 0}</Badge>
                        </TableCell>
                        {loyaltyEnabled && (
                          <TableCell className="text-center">
                            {c.loyaltyTier && (
                              <Badge
                                variant="outline"
                                className={
                                  c.loyaltyTier === "PLATINO"
                                    ? "bg-gray-100 text-gray-800"
                                    : c.loyaltyTier === "ORO"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : c.loyaltyTier === "PLATA"
                                    ? "bg-slate-100 text-slate-700"
                                    : "bg-amber-50 text-amber-800"
                                }
                              >
                                <Star className="w-3 h-3 mr-1" />
                                {c.loyaltyTier}
                              </Badge>
                            )}
                            <p className="text-xs mt-0.5">
                              {Math.floor(c.loyaltyPoints || 0)} pts
                            </p>
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          {saldo > 0 ? (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                              {formatCurrency(saldo, symbol)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Saldada</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => openAccount(c)}
                          >
                            <Wallet className="w-3.5 h-3.5 mr-1" />
                            Cuenta
                          </Button>
                          {loyaltyEnabled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={() => openPoints(c)}
                            >
                              <Award className="w-3.5 h-3.5 mr-1" />
                              Puntos
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600"
                            onClick={() => setDeleteId(c.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
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

      {/* Diálogo cuenta corriente */}
      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-indigo-600" />
              Cuenta corriente
            </DialogTitle>
            <DialogDescription>
              {accountData?.customer?.name}
              {accountData?.customer?.phone && ` · ${accountData.customer.phone}`}
            </DialogDescription>
          </DialogHeader>

          {accountLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin inline text-indigo-600" />
            </div>
          ) : accountData ? (
            <div className="space-y-4">
              {/* Resumen */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="bg-amber-50 border-amber-200">
                  <CardContent className="p-3">
                    <p className="text-xs text-amber-700">Saldo actual</p>
                    <p className="text-xl font-bold text-amber-800">
                      {formatCurrency(accountData.saldo, symbol)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Límite</p>
                    <p className="text-xl font-bold">
                      {formatCurrency(accountData.creditLimit, symbol)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Disponible</p>
                    <p className="text-xl font-bold text-indigo-700">
                      {formatCurrency(
                        accountData.creditLimit > 0
                          ? Math.max(0, accountData.disponible)
                          : 0,
                        symbol
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setPayAmount(accountData.saldo > 0 ? accountData.saldo : 0);
                    setPayMethod("EFECTIVO");
                    setPayNotes("");
                    setPayOpen(true);
                  }}
                  disabled={accountData.saldo <= 0}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <ArrowDownCircle className="w-4 h-4 mr-2" />
                  Registrar pago
                </Button>
              </div>

              {/* Movimientos */}
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead className="text-right">Debe</TableHead>
                      <TableHead className="text-right">Haber</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountData.movimientos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Sin movimientos
                        </TableCell>
                      </TableRow>
                    ) : (
                      accountData.movimientos.map((m) => (
                        <TableRow key={m.id + m.type}>
                          <TableCell className="text-xs">
                            {formatDateTime(m.date)}
                          </TableCell>
                          <TableCell>
                            {m.type === "DEBE" ? (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                <ArrowUpCircle className="w-3 h-3 mr-1" />
                                Venta
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                                <ArrowDownCircle className="w-3 h-3 mr-1" />
                                Pago
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {m.description}
                            {m.user && (
                              <span className="text-xs text-muted-foreground ml-1">
                                · {m.user}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-red-700">
                            {m.type === "DEBE" ? formatCurrency(m.amount, symbol) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-indigo-700">
                            {m.type === "HABER" ? formatCurrency(m.amount, symbol) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(m.balanceAfter, symbol)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Diálogo registrar pago */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pago de cuenta</DialogTitle>
            <DialogDescription>
              {accountData?.customer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-center justify-between">
              <span className="text-sm text-amber-700">Saldo actual</span>
              <span className="text-lg font-bold text-amber-800">
                {formatCurrency(accountData?.saldo || 0, symbol)}
              </span>
            </div>
            <div className="space-y-2">
              <Label>Monto del pago</Label>
              <Input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value))}
                className="text-lg font-medium"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Método de pago</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_TYPES.filter((t) => t.value !== "CUENTA").map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                rows={2}
                placeholder="Ej: Pago parcial, semana 1..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handlePayment}
              disabled={paySaving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {paySaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Registrar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo editar/crear cliente */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Modificá los datos del cliente"
                : "Completá los datos del nuevo cliente"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="11-1234-5678"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="cliente@email.com"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="creditLimit">
                Límite de cuenta corriente (0 = sin límite)
              </Label>
              <Input
                type="number"
                value={form.creditLimit}
                onChange={(e) =>
                  setForm({ ...form, creditLimit: Number(e.target.value) })
                }
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Monto máximo que el cliente puede deber. 0 = sin límite (no recomendado).
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Información adicional..."
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {form.id ? "Guardar" : "Crear cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo puntos de fidelización */}
      <Dialog open={pointsOpen} onOpenChange={setPointsOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-600" />
              Puntos de fidelización
            </DialogTitle>
            <DialogDescription>
              {pointsData?.customer?.name}
              {pointsData?.customer?.phone && ` · ${pointsData.customer.phone}`}
            </DialogDescription>
          </DialogHeader>

          {pointsLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin inline text-indigo-600" />
            </div>
          ) : pointsData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="bg-indigo-50 border-indigo-200">
                  <CardContent className="p-3">
                    <p className="text-xs text-indigo-700">Puntos actuales</p>
                    <p className="text-xl font-bold text-indigo-800">
                      {Math.floor(pointsData.customer.loyaltyPoints || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Tier</p>
                    <p className="text-xl font-bold">
                      {pointsData.customer.loyaltyTier || "BRONCE"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Compras</p>
                    <p className="text-xl font-bold">
                      {pointsData.customer.totalSales || 0}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">Total gastado</p>
                    <p className="text-base font-bold">
                      {formatCurrency(pointsData.customer.totalSpent || 0, symbol)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Ajuste manual */}
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">Ajuste manual de puntos</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={adjustPoints}
                    onChange={(e) => setAdjustPoints(Number(e.target.value))}
                    placeholder="Ej: 100 o -50"
                    className="w-32"
                  />
                  <Input
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                    placeholder="Motivo (opcional)"
                  />
                  <Button
                    onClick={handleAdjustPoints}
                    disabled={adjustSaving || adjustPoints === 0}
                  >
                    {adjustSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Aplicar"
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Usa valores negativos para restar puntos.
                </p>
              </div>

              {/* Historial */}
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Puntos</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pointsData.pointsLog.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          Sin movimientos
                        </TableCell>
                      </TableRow>
                    ) : (
                      pointsData.pointsLog.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">
                            {formatDateTime(p.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                p.type === "EARN"
                                  ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                  : p.type === "REDEEM"
                                  ? "bg-orange-50 text-orange-700 border-orange-200"
                                  : p.type === "EXPIRE"
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200"
                              }
                            >
                              {p.type === "EARN" && <Gift className="w-3 h-3 mr-1" />}
                              {p.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{p.description}</TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              p.points > 0 ? "text-indigo-700" : "text-red-700"
                            }`}
                          >
                            {p.points > 0 ? "+" : ""}
                            {p.points}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {Math.floor(p.balance)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente será eliminado. Las ventas históricas se conservarán sin
              vincular a un cliente. Si el cliente tiene saldo en cuenta corriente,
              deberás saldarlo primero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
