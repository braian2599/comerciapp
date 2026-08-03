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
  TrendingDown,
  Calendar,
  Receipt,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDate } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export const EXPENSE_CATEGORIES = [
  { value: "ALQUILER", label: "Alquiler", icon: "home" },
  { value: "SERVICIOS", label: "Servicios (luz, agua, gas)", icon: "lightbulb" },
  { value: "SUELDOS", label: "Sueldos", icon: "users" },
  { value: "INSUMOS", label: "Insumos", icon: "package" },
  { value: "IMPUESTOS", label: "Impuestos", icon: "receipt_text" },
  { value: "TRANSPORTE", label: "Transporte", icon: "truck" },
  { value: "OTROS", label: "Otros", icon: "package" },
];

export function ExpensesView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [expenses, setExpenses] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [porCategoria, setPorCategoria] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [filterCat, setFilterCat] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "OTROS",
    description: "",
    amount: 0,
    paymentMethod: "EFECTIVO",
    date: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCat !== "all") params.set("category", filterCat);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    const res = await fetch(`/api/expenses?${params.toString()}`);
    const data = await res.json();
    setExpenses(data.expenses || []);
    setTotal(data.total || 0);
    setPorCategoria(data.porCategoria || {});
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [filterCat, filterFrom, filterTo]);

  async function save() {
    if (!form.description || form.amount <= 0) {
      toast.error("Completá descripción y monto");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Gasto registrado");
      setOpen(false);
      setForm({
        category: "OTROS",
        description: "",
        amount: 0,
        paymentMethod: "EFECTIVO",
        date: new Date().toISOString().slice(0, 10),
      });
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
      const res = await fetch(`/api/expenses?id=${deleteId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Gasto eliminado");
      setDeleteId(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gastos</h1>
          <p className="text-sm text-muted-foreground">
            Registrá los egresos del negocio para calcular la ganancia neta real
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="bg-red-600 hover:bg-red-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nuevo gasto
        </Button>
      </div>

      {/* Resumen por categoría */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-3">
            <p className="text-xs text-red-700">Total gastos (período)</p>
            <p className="text-xl font-bold text-red-700">
              {formatCurrency(total, symbol)}
            </p>
          </CardContent>
        </Card>
        {EXPENSE_CATEGORIES.slice(0, 3).map((cat) => (
          <Card key={cat.value}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Icon name={cat.icon} className="w-3 h-3" /> {cat.label}
              </p>
              <p className="text-lg font-bold">
                {formatCurrency(porCategoria[cat.value] || 0, symbol)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Categoría</Label>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="inline-flex items-center gap-1.5"><Icon name={c.icon} className="w-3.5 h-3.5" /> {c.label}</span>
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
          {(filterCat !== "all" || filterFrom || filterTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterCat("all");
                setFilterFrom("");
                setFilterTo("");
              }}
            >
              Limpiar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
              Cargando gastos...
            </div>
          ) : expenses.length === 0 ? (
            <div className="p-12 text-center">
              <TrendingDown className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No hay gastos registrados en este período
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Fecha</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-center">Pago</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => {
                    const cat = EXPENSE_CATEGORIES.find((c) => c.value === e.category);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">
                          {formatDate(e.date)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="inline-flex items-center gap-1">
                            <Icon name={cat?.icon || 'package'} className="w-3 h-3" /> {cat?.label || e.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{e.description}</TableCell>
                        <TableCell className="text-center text-xs">
                          {e.paymentMethod}
                        </TableCell>
                        <TableCell className="text-right font-medium text-red-700">
                          -{formatCurrency(e.amount, symbol)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.user?.name || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600"
                            onClick={() => setDeleteId(e.id)}
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

      {/* Diálogo nuevo gasto */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar gasto</DialogTitle>
            <DialogDescription>
              Los gastos en efectivo se descontarán automáticamente de la caja abierta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="inline-flex items-center gap-1.5"><Icon name={c.icon} className="w-3.5 h-3.5" /> {c.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descripción *</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ej: Pago de alquiler mensual"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Monto *</Label>
                <Input
                  type="number"
                  value={form.amount || ""}
                  onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                  className="text-lg font-medium"
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Método de pago</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={(v) => setForm({ ...form, paymentMethod: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                  <SelectItem value="TARJETA">Tarjeta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-red-600 hover:bg-red-700"
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Registrar gasto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar gasto?</AlertDialogTitle>
            <AlertDialogDescription>
              El gasto será eliminado. Si fue pago en efectivo y hay caja abierta,
              el movimiento de caja también se eliminará.
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
