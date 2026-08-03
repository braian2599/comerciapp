"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
  Users,
  Package,
  Wallet,
  Loader2,
  Download,
  Calendar,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, formatDate } from "@/lib/constants";

type TabKey = "sales" | "profits" | "taxes" | "products" | "customers" | "cashflow";

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export function ReportsView() {
  const { store } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [tab, setTab] = useState<TabKey>("sales");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  // Defaults: últimos 30 días
  useEffect(() => {
    if (!from && !to) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      setFrom(start.toISOString().slice(0, 10));
      setTo(end.toISOString().slice(0, 10));
    }
  }, []);

  async function loadReport() {
    if (!from || !to) return;
    setLoading(true);
    setData(null); // reset para que no se renderice data de otro tab
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/reports/${tab}?${params}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Error cargando reporte");
        return;
      }
      setData(json);
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (from && to) loadReport();
  }, [tab, from, to]);

  function setPeriod(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }

  function exportarCSV() {
    if (!data) return;
    let rows: string[][] = [];
    let filename: string = tab;

    if (tab === "sales" && data.series) {
      rows = [["Período", "Cantidad", "Total", "Descuentos", "Recargos"]];
      data.series.forEach((s: any) => {
        rows.push([s.period, s.count, s.total, s.discount, s.surcharge]);
      });
      filename = "ventas";
    } else if (tab === "profits" && data.series) {
      rows = [["Fecha", "Ventas", "Costo", "Gastos", "Ganancia Bruta", "Ganancia Neta"]];
      data.series.forEach((s: any) => {
        rows.push([s.date, s.ventas, s.costo, s.gastos, s.gananciaBruta, s.gananciaNeta]);
      });
      filename = "ganancias";
    } else if (tab === "products" && data.ranking) {
      rows = [["Producto", "Cantidad", "Ingresos", "Costo", "Ganancia", "Margen %", "Stock Actual"]];
      data.ranking.forEach((p: any) => {
        rows.push([p.productName, p.quantitySold, p.revenue, p.cost, p.profit, p.margin, p.currentStock]);
      });
      filename = "productos";
    } else if (tab === "customers" && data.topClientes) {
      rows = [["Cliente", "Compras", "Cantidad ventas", "Fiado", "Pagado"]];
      data.topClientes.forEach((c: any) => {
        rows.push([c.customerName, c.totalCompras, c.cantidadVentas, c.totalFiado, c.totalPagado]);
      });
      filename = "clientes";
    } else if (tab === "taxes" && data.byTipo) {
      rows = [["Tipo", "Cantidad", "Neto", "IVA", "Total"]];
      data.byTipo.forEach((t: any) => {
        rows.push([t.tipo, t.count, t.netoGravado, t.iva, t.total]);
      });
      filename = "fiscal";
    } else if (tab === "cashflow" && data.series) {
      rows = [["Fecha", "Ventas Efectivo", "Cobros Cuenta", "Ing. Manuales", "Gastos", "Egresos Manuales", "Flujo Neto"]];
      data.series.forEach((s: any) => {
        rows.push([s.date, s.ventasEfectivo, s.cobrosCuenta, s.ingresosManuales, s.gastosEfectivo, s.egresosManuales, s.flujoNeto]);
      });
      filename = "flujo-caja";
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const TABS: { key: TabKey; label: string; icon: any }[] = [
    { key: "sales", label: "Ventas", icon: Receipt },
    { key: "profits", label: "Ganancias", icon: TrendingUp },
    { key: "taxes", label: "Fiscal", icon: BarChart3 },
    { key: "products", label: "Productos", icon: Package },
    { key: "customers", label: "Clientes", icon: Users },
    { key: "cashflow", label: "Flujo Caja", icon: Wallet },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-emerald-600" />
            Reportes
          </h1>
          <p className="text-sm text-muted-foreground">
            Análisis de ventas, ganancias, fiscal, productos y clientes
          </p>
        </div>
        <Button variant="outline" onClick={exportarCSV} disabled={!data}>
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t.key)}
              className={tab === t.key ? "bg-emerald-600 hover:bg-emerald-700" : ""}
            >
              <Icon className="w-4 h-4 mr-1" />
              {t.label}
            </Button>
          );
        })}
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setPeriod(7)}>7 días</Button>
            <Button size="sm" variant="outline" onClick={() => setPeriod(30)}>30 días</Button>
            <Button size="sm" variant="outline" onClick={() => setPeriod(90)}>90 días</Button>
            <Button size="sm" variant="outline" onClick={() => setPeriod(365)}>1 año</Button>
          </div>
        </CardContent>
      </Card>

      {/* Contenido */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Selecciona un rango de fechas</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* VENTAS */}
          {tab === "sales" && <SalesReport data={data} symbol={symbol} />}
          {/* GANANCIAS */}
          {tab === "profits" && <ProfitsReport data={data} symbol={symbol} />}
          {/* FISCAL */}
          {tab === "taxes" && <TaxesReport data={data} symbol={symbol} />}
          {/* PRODUCTOS */}
          {tab === "products" && <ProductsReport data={data} symbol={symbol} />}
          {/* CLIENTES */}
          {tab === "customers" && <CustomersReport data={data} symbol={symbol} />}
          {/* FLUJO CAJA */}
          {tab === "cashflow" && <CashFlowReport data={data} symbol={symbol} />}
        </>
      )}
    </div>
  );
}

// ===== REPORTE DE VENTAS =====
function SalesReport({ data, symbol }: { data: any; symbol: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total ventas" value={formatCurrency(data.summary.totalAmount, symbol)} icon={DollarSign} color="emerald" />
        <StatCard label="Cantidad" value={data.summary.totalSales.toString()} icon={Receipt} color="blue" />
        <StatCard label="Ticket promedio" value={formatCurrency(data.summary.averageTicket, symbol)} icon={TrendingUp} color="purple" />
        <StatCard label="Recargos" value={formatCurrency(data.summary.totalSurcharge, symbol)} icon={TrendingUp} color="amber" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Evolución de ventas</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip
                formatter={(v: any, name: string) => [formatCurrency(v, symbol), name === "total" ? "Total" : name]}
              />
              <Legend />
              <Line type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} name="Total" />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={1} name="Cantidad" hide />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por método de pago</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={data.byPaymentMethod}
                  dataKey="total"
                  nameKey="method"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(e: any) => `${e.method}`}
                >
                  {data.byPaymentMethod.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(v, symbol)} />
              </PieChart>
            </ResponsiveContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byPaymentMethod.map((m: any) => (
                  <TableRow key={m.method}>
                    <TableCell className="font-medium">{m.method}</TableCell>
                    <TableCell className="text-right">{m.count}</TableCell>
                    <TableCell className="text-right">{formatCurrency(m.total, symbol)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por vendedor</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.byUser}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="userName" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: any) => formatCurrency(v, symbol)} />
                <Bar dataKey="total" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byUser.map((u: any) => (
                  <TableRow key={u.userId}>
                    <TableCell className="font-medium">{u.userName}</TableCell>
                    <TableCell className="text-right">{u.count}</TableCell>
                    <TableCell className="text-right">{formatCurrency(u.total, symbol)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ===== REPORTE DE GANANCIAS =====
function ProfitsReport({ data, symbol }: { data: any; symbol: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Ganancia bruta" value={formatCurrency(data.summary.gananciaBruta, symbol)} icon={TrendingUp} color="emerald" />
        <StatCard label="Ganancia neta" value={formatCurrency(data.summary.gananciaNeta, symbol)} icon={DollarSign} color={data.summary.gananciaNeta >= 0 ? "emerald" : "red"} />
        <StatCard label="Margen neto" value={`${data.summary.margenNeto}%`} icon={BarChart3} color="blue" />
        <StatCard label="Total gastos" value={formatCurrency(data.summary.totalGastos, symbol)} icon={TrendingDown} color="red" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Ventas vs Costo vs Gastos</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v: any) => formatCurrency(v, symbol)} />
              <Legend />
              <Bar dataKey="ventas" fill="#10b981" name="Ventas" />
              <Bar dataKey="costo" fill="#ef4444" name="Costo" />
              <Bar dataKey="gastos" fill="#f59e0b" name="Gastos" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Gastos por categoría</CardTitle>
        </CardHeader>
        <CardContent>
          {(!data.expensesByCategory || data.expensesByCategory.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin gastos en el período</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={data.expensesByCategory}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(e: any) => `${e.category}`}
                >
                  {data.expensesByCategory.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(v, symbol)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Total ventas</p>
            <p className="font-bold">{formatCurrency(data.summary.totalVentas, symbol)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total costo</p>
            <p className="font-bold text-red-600">{formatCurrency(data.summary.totalCosto, symbol)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total descuentos</p>
            <p className="font-bold text-amber-600">{formatCurrency(data.summary.totalDescuentos, symbol)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Margen bruto</p>
            <p className="font-bold text-emerald-600">{data.summary.margenBruto}%</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== REPORTE FISCAL =====
function TaxesReport({ data, symbol }: { data: any; symbol: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total facturado" value={formatCurrency(data.summary.totalFacturado, symbol)} icon={Receipt} color="emerald" />
        <StatCard label="IVA recaudado" value={formatCurrency(data.summary.totalIva, symbol)} icon={DollarSign} color="blue" />
        <StatCard label="Facturas emitidas" value={data.summary.cantidadFacturas.toString()} icon={BarChart3} color="purple" />
        <StatCard label="Ventas sin facturar" value={data.summary.ventasSinFactura.toString()} icon={TrendingDown} color="amber" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Facturación por tipo de comprobante</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Neto gravado</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">No gravado</TableHead>
                <TableHead className="text-right">Exento</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byTipo.map((t: any) => (
                <TableRow key={t.tipo}>
                  <TableCell>
                    <Badge variant="outline">Factura {t.tipo}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{t.count}</TableCell>
                  <TableCell className="text-right">{formatCurrency(t.netoGravado, symbol)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(t.iva, symbol)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(t.noGravado, symbol)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(t.exento, symbol)}</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(t.total, symbol)}</TableCell>
                </TableRow>
              ))}
              {data.byTipo.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No hay facturas emitidas en el período
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.summary.ventasSinFactura > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4">
            <p className="text-sm text-amber-900">
              <strong>Atención:</strong> Hay {data.summary.ventasSinFactura} ventas por {formatCurrency(data.summary.montoSinFacturar, symbol)} sin facturar en el período.
              Para cumplimiento fiscal, deberías emitir las facturas correspondientes.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ===== REPORTE DE PRODUCTOS =====
function ProductsReport({ data, symbol }: { data: any; symbol: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Productos vendidos" value={data.summary.totalProductosVendidos.toString()} icon={Package} color="blue" />
        <StatCard label="Items vendidos" value={data.summary.totalItemsVendidos.toFixed(0)} icon={BarChart3} color="purple" />
        <StatCard label="Ingresos totales" value={formatCurrency(data.summary.revenue, symbol)} icon={DollarSign} color="emerald" />
        <StatCard label="Ganancia total" value={formatCurrency(data.summary.profit, symbol)} icon={TrendingUp} color="emerald" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top 10 productos por ingresos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">Ganancia</TableHead>
                <TableHead className="text-right">Margen</TableHead>
                <TableHead className="text-right">Stock actual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ranking.map((p: any, i: number) => (
                <TableRow key={p.productId}>
                  <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.productName}</TableCell>
                  <TableCell className="text-right">{p.quantitySold}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.revenue, symbol)}</TableCell>
                  <TableCell className="text-right text-red-600">{formatCurrency(p.cost, symbol)}</TableCell>
                  <TableCell className="text-right text-emerald-600 font-medium">{formatCurrency(p.profit, symbol)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={p.margin > 30 ? "text-emerald-700" : p.margin > 10 ? "text-amber-700" : "text-red-700"}>
                      {p.margin}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={p.currentStock <= 5 ? "text-red-600 font-medium" : ""}>
                      {p.currentStock}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {data.ranking.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No hay ventas en el período
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== REPORTE DE CLIENTES =====
function CustomersReport({ data, symbol }: { data: any; symbol: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Clientes activos" value={data.summary.clientesActivos.toString()} icon={Users} color="blue" />
        <StatCard label="Con saldo deudor" value={data.summary.clientesConSaldoDeudor.toString()} icon={TrendingDown} color="red" />
        <StatCard label="Total saldo" value={formatCurrency(data.summary.totalSaldoDeudor, symbol)} icon={Wallet} color="amber" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top clientes por compras</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">Fiado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topClientes.map((c: any) => (
                  <TableRow key={c.customerId}>
                    <TableCell className="font-medium">{c.customerName}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.totalCompras, symbol)}</TableCell>
                    <TableCell className="text-right text-red-600">
                      {c.totalFiado > 0 ? formatCurrency(c.totalFiado, symbol) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
                {data.topClientes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      Sin datos en el período
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Saldos de cuenta corriente</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Saldo deudor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.clientesConSaldo.map((c: any) => (
                  <TableRow key={c.customerId}>
                    <TableCell className="font-medium">{c.customerName || c.customerId}</TableCell>
                    <TableCell className="text-right text-red-600 font-bold">
                      {formatCurrency(c.saldo, symbol)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.clientesConSaldo.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No hay clientes con saldo deudor
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ===== REPORTE FLUJO DE CAJA =====
function CashFlowReport({ data, symbol }: { data: any; symbol: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Ingresos efectivo" value={formatCurrency(data.summary.totalIngresosEfectivo, symbol)} icon={TrendingUp} color="emerald" />
        <StatCard label="Egresos efectivo" value={formatCurrency(data.summary.totalEgresosEfectivo, symbol)} icon={TrendingDown} color="red" />
        <StatCard label="Flujo neto efectivo" value={formatCurrency(data.summary.flujoNetoEfectivo, symbol)} icon={Wallet} color={data.summary.flujoNetoEfectivo >= 0 ? "emerald" : "red"} />
        <StatCard label="Ventas fiadas" value={formatCurrency(data.summary.ventasFiadas, symbol)} icon={Receipt} color="amber" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Flujo de caja diario</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v: any) => formatCurrency(v, symbol)} />
              <Legend />
              <Bar dataKey="totalIngresos" fill="#10b981" name="Ingresos" />
              <Bar dataKey="totalEgresos" fill="#ef4444" name="Egresos" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Detalle por día</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Ventas Efectivo</TableHead>
                <TableHead className="text-right">Cobros cuenta</TableHead>
                <TableHead className="text-right">Ing. manuales</TableHead>
                <TableHead className="text-right">Gastos</TableHead>
                <TableHead className="text-right">Egr. manuales</TableHead>
                <TableHead className="text-right">Flujo neto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.series.slice().reverse().map((s: any) => (
                <TableRow key={s.date}>
                  <TableCell>{formatDate(s.date)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{formatCurrency(s.ventasEfectivo, symbol)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{formatCurrency(s.cobrosCuenta, symbol)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{formatCurrency(s.ingresosManuales, symbol)}</TableCell>
                  <TableCell className="text-right text-red-600">{formatCurrency(s.gastosEfectivo, symbol)}</TableCell>
                  <TableCell className="text-right text-red-600">{formatCurrency(s.egresosManuales, symbol)}</TableCell>
                  <TableCell className={`text-right font-bold ${s.flujoNeto >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {formatCurrency(s.flujoNeto, symbol)}
                  </TableCell>
                </TableRow>
              ))}
              {data.series.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Sin movimientos en el período
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== COMPONENTE: STAT CARD =====
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-600 bg-emerald-50",
    blue: "text-blue-600 bg-blue-50",
    red: "text-red-600 bg-red-50",
    amber: "text-amber-600 bg-amber-50",
    purple: "text-purple-600 bg-purple-50",
  };
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center ${colorMap[color] || colorMap.emerald}`}>
            <Icon className="w-4 h-4" />
          </div>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className="text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
