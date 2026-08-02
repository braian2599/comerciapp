"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingBag,
  TicketPercent,
  AlertTriangle,
  Package,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useAppStore } from "@/store/app-store";
import { formatCurrency } from "@/lib/constants";

interface DashboardData {
  totalVentas: number;
  numVentas: number;
  ticketPromedio: number;
  ganancia: number;
  variacion: number;
  variacionTicket: number;
  ventasPorDia: { date: string; total: number; count: number }[];
  topProductos: { name: string; qty: number; total: number }[];
  productosBajoStock: any[];
  ventasPorMetodo: Record<string, number>;
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#8b5cf6"];

const CARD_COLORS: Record<string, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-100", text: "text-emerald-700" },
  blue: { bg: "bg-blue-100", text: "text-blue-700" },
  amber: { bg: "bg-amber-100", text: "text-amber-700" },
  purple: { bg: "bg-purple-100", text: "text-purple-700" },
};

export function DashboardView() {
  const { store, setView } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadedDays, setLoadedDays] = useState<number | null>(null);
  const [days, setDays] = useState(7);
  const symbol = store?.currencySymbol || "$";
  const loading = loadedDays !== days;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoadedDays(days);
      })
      .catch(() => {
        // dejar loading pero no crashear
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const cards = [
    {
      label: `Ventas últimos ${days} días`,
      value: formatCurrency(data.totalVentas, symbol),
      icon: <DollarSign className="w-4 h-4" />,
      delta: data.variacion,
      deltaLabel: "vs período anterior",
      color: "emerald",
    },
    {
      label: "Transacciones",
      value: String(data.numVentas),
      icon: <ShoppingBag className="w-4 h-4" />,
      color: "blue",
    },
    {
      label: "Ticket promedio",
      value: formatCurrency(data.ticketPromedio, symbol),
      icon: <TicketPercent className="w-4 h-4" />,
      delta: data.variacionTicket,
      deltaLabel: "vs período anterior",
      color: "amber",
    },
    {
      label: "Ganancia estimada",
      value: formatCurrency(data.ganancia, symbol),
      icon: <TrendingUp className="w-4 h-4" />,
      color: "purple",
    },
  ];

  const chartData = data.ventasPorDia.map((v) => ({
    ...v,
    date: new Date(v.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
  }));

  const topData = data.topProductos.map((p) => ({
    name: p.name.length > 15 ? p.name.slice(0, 12) + "..." : p.name,
    ...p,
  }));

  const methodData = Object.entries(data.ventasPorMetodo).map(([k, v]) => ({
    name: k,
    value: v,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Panel</h1>
          <p className="text-sm text-muted-foreground">
            Resumen de las ventas de tu comercio
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(d)}
              className={days === d ? "bg-emerald-600 hover:bg-emerald-700" : ""}
            >
              {d} días
            </Button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {c.label}
                </p>
                <div className={`p-1.5 rounded-md ${CARD_COLORS[c.color].bg} ${CARD_COLORS[c.color].text}`}>
                  {c.icon}
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight">{c.value}</p>
              {c.delta !== undefined && (
                <div className="flex items-center gap-1 mt-1 text-xs">
                  {c.delta >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-600" />
                  )}
                  <span
                    className={
                      c.delta >= 0 ? "text-emerald-600" : "text-red-600"
                    }
                  >
                    {Math.abs(c.delta).toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground">{c.deltaLabel}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        {/* Ventas por día - 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Ventas por día</CardTitle>
            <CardDescription>Ingresos diarios del período seleccionado</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ventasGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => `${symbol} ${v}`} />
                <Tooltip
                  formatter={(v: any) => formatCurrency(v, symbol)}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#ventasGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Métodos de pago */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métodos de pago</CardTitle>
            <CardDescription>Distribución de cobros</CardDescription>
          </CardHeader>
          <CardContent>
            {methodData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Sin datos suficientes
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={methodData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry) => `${entry.name}`}
                    labelLine={false}
                  >
                    {methodData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(v, symbol)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top productos + Alertas de stock */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 5 productos vendidos</CardTitle>
            <CardDescription>Por cantidad de unidades</CardDescription>
          </CardHeader>
          <CardContent>
            {topData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Sin ventas en el período
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip
                    formatter={(v: any, n: any) =>
                      n === "qty" ? `${v} u.` : formatCurrency(v, symbol)
                    }
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                  />
                  <Bar dataKey="qty" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Stock bajo
                </CardTitle>
                <CardDescription>Productos que requieren reposición</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("inventory")}
                className="text-emerald-700"
              >
                Ver inventario
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {data.productosBajoStock.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Package className="w-10 h-10 text-emerald-500 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Todo el stock está OK
                </p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {data.productosBajoStock.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-md bg-amber-50 border border-amber-100"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.category?.name || "Sin categoría"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-amber-700">
                        {p.stock} {p.unit === "KG" ? "kg" : "u."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        mín: {p.minStock}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
