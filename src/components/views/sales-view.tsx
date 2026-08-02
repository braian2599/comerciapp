"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  Search,
  Receipt,
  Eye,
  Ban,
  Loader2,
  TrendingUp,
  ShoppingBag,
  DollarSign,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import {
  formatCurrency,
  formatDateTime,
  PAYMENT_METHODS,
} from "@/lib/constants";

interface Sale {
  id: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: string;
  status: string;
  notes?: string;
  createdAt: string;
  items: { id: string; quantity: number; unitPrice: number; subtotal: number; product: { name: string; unit: string } }[];
  user: { name: string };
  customer?: { name: string } | null;
}

export function SalesView() {
  const { store, user } = useAppStore();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");
  const [selected, setSelected] = useState<Sale | null>(null);
  const [annulTarget, setAnnulTarget] = useState<Sale | null>(null);
  const [annulling, setAnnulling] = useState(false);

  const symbol = store?.currencySymbol || "$";
  const canAnnul = user?.role !== "CAJERO";

  async function load() {
    setLoading(true);
    const res = await fetch("/api/sales?limit=200");
    const data = await res.json();
    setSales(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return sales.filter((s) => {
      const matchSearch =
        !search ||
        s.id.toLowerCase().includes(search.toLowerCase()) ||
        s.customer?.name.toLowerCase().includes(search.toLowerCase()) ||
        s.user.name.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || s.status === filterStatus;
      const matchMethod = filterMethod === "all" || s.paymentMethod === filterMethod;
      return matchSearch && matchStatus && matchMethod;
    });
  }, [sales, search, filterStatus, filterMethod]);

  const stats = useMemo(() => {
    const completed = filtered.filter((s) => s.status === "COMPLETADA");
    return {
      total: completed.reduce((s, v) => s + v.total, 0),
      count: completed.length,
      avg: completed.length > 0 ? completed.reduce((s, v) => s + v.total, 0) / completed.length : 0,
    };
  }, [filtered]);

  async function handleAnnul() {
    if (!annulTarget) return;
    setAnnulling(true);
    try {
      const res = await fetch("/api/sales/annul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: annulTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Venta anulada. Stock reintegrado.");
      setAnnulTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAnnulling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>
        <p className="text-sm text-muted-foreground">
          Historial de ventas registradas
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-emerald-100 text-emerald-700">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total ventas</p>
              <p className="text-xl font-bold">
                {formatCurrency(stats.total, symbol)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-100 text-blue-700">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transacciones</p>
              <p className="text-xl font-bold">{stats.count}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-amber-100 text-amber-700">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ticket promedio</p>
              <p className="text-xl font-bold">
                {formatCurrency(stats.avg, symbol)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por ID, cliente o vendedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="COMPLETADA">Completadas</SelectItem>
                <SelectItem value="ANULADA">Anuladas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los métodos</SelectItem>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-emerald-600" />
              Cargando ventas...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Receipt className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No se encontraron ventas
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead className="hidden md:table-cell">Fecha</TableHead>
                    <TableHead className="hidden md:table-cell">Cliente</TableHead>
                    <TableHead className="hidden lg:table-cell">Vendedor</TableHead>
                    <TableHead className="hidden sm:table-cell">Pago</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} className={s.status === "ANULADA" ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-xs">
                        #{s.id.slice(-6).toUpperCase()}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {formatDateTime(s.createdAt)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        {s.customer?.name || (
                          <span className="text-muted-foreground">Mostrador</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm">
                        {s.user.name}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {PAYMENT_METHODS.find((m) => m.value === s.paymentMethod)?.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(s.total, symbol)}
                      </TableCell>
                      <TableCell className="text-center">
                        {s.status === "COMPLETADA" ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            Completada
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Anulada</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setSelected(s)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {canAnnul && s.status === "COMPLETADA" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600"
                            onClick={() => setAnnulTarget(s)}
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detalle */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalle de venta</SheetTitle>
            <SheetDescription>
              #{selected?.id.slice(-6).toUpperCase()} ·{" "}
              {selected && formatDateTime(selected.createdAt)}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Vendedor</p>
                  <p className="font-medium">{selected.user.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">
                    {selected.customer?.name || "Mostrador"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Método de pago</p>
                  <p className="font-medium">
                    {PAYMENT_METHODS.find((m) => m.value === selected.paymentMethod)?.label}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estado</p>
                  {selected.status === "COMPLETADA" ? (
                    <Badge className="bg-emerald-100 text-emerald-700">Completada</Badge>
                  ) : (
                    <Badge variant="destructive">Anulada</Badge>
                  )}
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-sm font-medium mb-2">Productos</p>
                <div className="space-y-2">
                  {selected.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex justify-between text-sm p-2 rounded-md bg-muted/50"
                    >
                      <div>
                        <p className="font-medium">{it.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {it.quantity} {it.product.unit === "KG" ? "kg" : "u"} ×{" "}
                          {formatCurrency(it.unitPrice, symbol)}
                        </p>
                      </div>
                      <p className="font-semibold">
                        {formatCurrency(it.subtotal, symbol)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(selected.subtotal, symbol)}</span>
                </div>
                {selected.discount > 0 && (
                  <div className="flex justify-between">
                    <span>Descuento</span>
                    <span>-{formatCurrency(selected.discount, symbol)}</span>
                  </div>
                )}
                {selected.tax > 0 && (
                  <div className="flex justify-between">
                    <span>Impuesto</span>
                    <span>{formatCurrency(selected.tax, symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>Total</span>
                  <span>{formatCurrency(selected.total, symbol)}</span>
                </div>
              </div>

              {selected.notes && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">Notas</p>
                  <p className="text-sm">{selected.notes}</p>
                </div>
              )}
            </div>
          )}
          <SheetFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cerrar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Anular confirm */}
      <AlertDialog
        open={!!annulTarget}
        onOpenChange={(o) => !o && setAnnulTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular venta?</AlertDialogTitle>
            <AlertDialogDescription>
              La venta #{annulTarget?.id.slice(-6).toUpperCase()} se marcará como
              anulada y el stock de los productos será reintegrado. Esta acción no
              se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAnnul}
              disabled={annulling}
              className="bg-red-600 hover:bg-red-700"
            >
              {annulling && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Sí, anular venta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
