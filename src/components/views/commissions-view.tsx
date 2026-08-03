"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  DollarSign,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  TrendingUp,
  Coins,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/constants";
import {
  commissionTypeLabel,
  commissionStatusLabel,
  commissionStatusColor,
  type CommissionTier,
} from "@/lib/commissions";

interface CommissionRule {
  id: string;
  userId: string;
  name: string;
  type: string;
  rate: number;
  tiers: string | null;
  tiersParsed: CommissionTier[];
  minSaleAmount: number;
  onlyPaid: boolean;
  active: boolean;
  startDate: string;
  endDate: string | null;
  user: { id: string; name: string; role: string };
}

interface Commission {
  id: string;
  userId: string;
  saleId: string;
  ruleId: string | null;
  saleTotal: number;
  saleProfit: number;
  base: number;
  rate: number;
  amount: number;
  status: string;
  notes: string | null;
  createdAt: string;
  user: { id: string; name: string; role: string };
  sale: {
    id: string;
    total: number;
    paymentMethod: string;
    createdAt: string;
    customer: { name: string } | null;
  };
  rule: { id: string; name: string; type: string } | null;
  ruleTypeLabel: string | null;
}

interface CommissionSummary {
  userId: string;
  userName: string;
  totalAmount: number;
  pendingAmount: number;
  paidAmount: number;
  count: number;
  pendingCount: number;
}

export function CommissionsView() {
  const { store, user } = useAppStore();
  const symbol = store?.currencySymbol || "$";
  const [tab, setTab] = useState("rules");

  // Rules state
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [editingRule, setEditingRule] = useState<Partial<CommissionRule> | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  // Commissions state
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [summary, setSummary] = useState<CommissionSummary[]>([]);
  const [loadingComms, setLoadingComms] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterUser, setFilterUser] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<string | null>(null);

  async function loadRules() {
    setLoadingRules(true);
    const [r, u] = await Promise.all([
      fetch("/api/commissions/rules").then((r) => r.json()),
      fetch("/api/store/users").then((r) => r.json()).catch(() => []),
    ]);
    setRules(r || []);
    setUsers(Array.isArray(u) ? u : []);
    setLoadingRules(false);
  }

  async function loadCommissions() {
    setLoadingComms(true);
    const params = new URLSearchParams();
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterUser !== "all") params.set("userId", filterUser);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    const [comms, sum] = await Promise.all([
      fetch(`/api/commissions?${params}`).then((r) => r.json()),
      fetch(`/api/commissions?summary=true&${params}`).then((r) => r.json()),
    ]);
    setCommissions(Array.isArray(comms) ? comms : []);
    setSummary(Array.isArray(sum) ? sum : []);
    setLoadingComms(false);
  }

  useEffect(() => {
    loadRules();
  }, []);

  useEffect(() => {
    if (tab === "commissions") loadCommissions();
  }, [tab, filterStatus, filterUser, from, to]);

  // Calcular totales globales
  const totals = useMemo(() => {
    return summary.reduce(
      (acc, s) => ({
        total: acc.total + s.totalAmount,
        pending: acc.pending + s.pendingAmount,
        paid: acc.paid + s.paidAmount,
        count: acc.count + s.count,
      }),
      { total: 0, pending: 0, paid: 0, count: 0 }
    );
  }, [summary]);

  async function saveRule() {
    if (!editingRule) return;
    setSavingRule(true);
    try {
      const method = editingRule.id ? "PUT" : "POST";
      const res = await fetch("/api/commissions/rules", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRule),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(editingRule.id ? "Regla actualizada" : "Regla creada");
      setEditingRule(null);
      loadRules();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteRule(id: string) {
    if (!confirm("¿Eliminar regla? Las comisiones ya generadas se conservan.")) return;
    try {
      const res = await fetch(`/api/commissions/rules?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Regla eliminada");
      loadRules();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function applyBatch() {
    if (!batchAction || selected.length === 0) return;
    try {
      const res = await fetch("/api/commissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, action: batchAction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${selected.length} comisión(es) actualizada(s)`);
      setSelected([]);
      setBatchAction(null);
      loadCommissions();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Comisiones</h1>
        <p className="text-sm text-muted-foreground">
          Configura reglas de comisión por vendedor y gestiona pagos
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Total acumulado</p>
              <Coins className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-xl font-bold">{formatCurrency(totals.total, symbol)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Pendiente</p>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-xl font-bold text-amber-700">{formatCurrency(totals.pending, symbol)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Pagado</p>
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-xl font-bold text-indigo-700">{formatCurrency(totals.paid, symbol)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Comisiones</p>
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xl font-bold">{totals.count}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rules">Reglas</TabsTrigger>
          <TabsTrigger value="commissions">Comisiones generadas</TabsTrigger>
        </TabsList>

        {/* TAB: REGLAS */}
        <TabsContent value="rules" className="space-y-3">
          <Card>
            <CardContent className="p-3 flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                Define cómo se calcula la comisión de cada vendedor
              </p>
              {isAdmin && (
                <Button
                  onClick={() =>
                    setEditingRule({
                      type: "PORCENTAJE_VENTA",
                      rate: 2,
                      onlyPaid: true,
                      active: true,
                      tiersParsed: [{ min: 0, max: null, rate: 2 }],
                    })
                  }
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Nueva regla
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {loadingRules ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
                  Cargando reglas...
                </div>
              ) : rules.length === 0 ? (
                <div className="p-12 text-center">
                  <Percent className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No hay reglas de comisión configuradas
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Vendedor</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Configuración</TableHead>
                        <TableHead>Mín. venta</TableHead>
                        <TableHead>Solo pagadas</TableHead>
                        <TableHead>Vigencia</TableHead>
                        <TableHead className="text-center">Estado</TableHead>
                        {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell>{r.user.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{commissionTypeLabel(r.type)}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.type === "PORCENTAJE_VENTA" && `${r.rate}% sobre venta`}
                            {r.type === "PORCENTAJE_GANANCIA" && `${r.rate}% sobre ganancia`}
                            {r.type === "MONTO_FIJO_POR_VENTA" && `${formatCurrency(r.rate, symbol)} fijo`}
                            {r.type === "ESCALONADO" &&
                              `${(r.tiersParsed || []).length} tramos`}
                          </TableCell>
                          <TableCell>{formatCurrency(r.minSaleAmount, symbol)}</TableCell>
                          <TableCell>
                            {r.onlyPaid ? (
                              <Badge className="bg-indigo-100 text-indigo-700">Sí</Badge>
                            ) : (
                              <Badge variant="outline">No</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(r.startDate)} - {r.endDate ? formatDate(r.endDate) : "∞"}
                          </TableCell>
                          <TableCell className="text-center">
                            {r.active ? (
                              <Badge className="bg-indigo-100 text-indigo-700">Activa</Badge>
                            ) : (
                              <Badge variant="outline">Inactiva</Badge>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  setEditingRule({
                                    ...r,
                                    tiersParsed: r.tiersParsed || [],
                                  })
                                }
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-600"
                                onClick={() => deleteRule(r.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: COMISIONES */}
        <TabsContent value="commissions" className="space-y-3">
          <Card>
            <CardContent className="p-3">
              <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="PENDIENTE">Pendientes</SelectItem>
                    <SelectItem value="PAGADA">Pagadas</SelectItem>
                    <SelectItem value="ANULADA">Anuladas</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger><SelectValue placeholder="Vendedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* Resumen por vendedor */}
          {summary.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Resumen por vendedor</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendedor</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Pendiente</TableHead>
                        <TableHead className="text-right">Pagado</TableHead>
                        <TableHead className="text-center">Comisiones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.map((s) => (
                        <TableRow key={s.userId}>
                          <TableCell className="font-medium">{s.userName}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(s.totalAmount, symbol)}
                          </TableCell>
                          <TableCell className="text-right text-amber-700">
                            {formatCurrency(s.pendingAmount, symbol)}
                          </TableCell>
                          <TableCell className="text-right text-indigo-700">
                            {formatCurrency(s.paidAmount, symbol)}
                          </TableCell>
                          <TableCell className="text-center">{s.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Batch actions */}
          {isAdmin && selected.length > 0 && (
            <Card>
              <CardContent className="p-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{selected.length} seleccionada(s)</span>
                <Select value={batchAction || ""} onValueChange={setBatchAction}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Acción..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PAY">Marcar pagada</SelectItem>
                    <SelectItem value="ANNUL">Anular</SelectItem>
                    <SelectItem value="REOPEN">Reabrir</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={applyBatch} disabled={!batchAction}>Aplicar</Button>
                <Button variant="ghost" onClick={() => setSelected([])}>Cancelar</Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              {loadingComms ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
                  Cargando comisiones...
                </div>
              ) : commissions.length === 0 ? (
                <div className="p-12 text-center">
                  <Coins className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">No hay comisiones en este período</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isAdmin && (
                          <TableHead className="w-8">
                            <input
                              type="checkbox"
                              checked={selected.length === commissions.filter(c => c.status === "PENDIENTE").length && commissions.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelected(commissions.filter(c => c.status === "PENDIENTE").map(c => c.id));
                                } else {
                                  setSelected([]);
                                }
                              }}
                            />
                          </TableHead>
                        )}
                        <TableHead>Fecha</TableHead>
                        <TableHead>Vendedor</TableHead>
                        <TableHead>Venta</TableHead>
                        <TableHead className="text-right">Total venta</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">Tasa</TableHead>
                        <TableHead className="text-right">Comisión</TableHead>
                        <TableHead className="text-center">Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissions.map((c) => (
                        <TableRow key={c.id}>
                          {isAdmin && (
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selected.includes(c.id)}
                                disabled={c.status !== "PENDIENTE"}
                                onChange={(e) => {
                                  if (e.target.checked) setSelected([...selected, c.id]);
                                  else setSelected(selected.filter((s) => s !== c.id));
                                }}
                              />
                            </TableCell>
                          )}
                          <TableCell className="text-sm">{formatDateTime(c.createdAt)}</TableCell>
                          <TableCell className="font-medium">{c.user.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            #{c.saleId.slice(-6).toUpperCase()}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(c.saleTotal, symbol)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatCurrency(c.base, symbol)}
                          </TableCell>
                          <TableCell className="text-right">{c.rate}%</TableCell>
                          <TableCell className="text-right font-bold text-indigo-700">
                            {formatCurrency(c.amount, symbol)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className={commissionStatusColor(c.status)}>
                              {commissionStatusLabel(c.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal editar/crear regla */}
      <Dialog open={!!editingRule} onOpenChange={(o) => !o && setEditingRule(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRule?.id ? "Editar regla de comisión" : "Nueva regla de comisión"}
            </DialogTitle>
            <DialogDescription>
              Define cómo se calcula la comisión de un vendedor
            </DialogDescription>
          </DialogHeader>

          {editingRule && (
            <div className="space-y-4 py-2">
              <div className="grid gap-3 grid-cols-2">
                <div>
                  <Label>Nombre *</Label>
                  <Input
                    value={editingRule.name || ""}
                    onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                    placeholder="Ej: Comisión vendedor mes julio"
                  />
                </div>
                <div>
                  <Label>Vendedor *</Label>
                  <Select
                    value={editingRule.userId || ""}
                    onValueChange={(v) => setEditingRule({ ...editingRule, userId: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                    <SelectContent>
                      {users
                        .filter((u) => u.role !== "CAJERO" || true) // todos pueden tener comisión
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({u.role})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Tipo de cálculo *</Label>
                <Select
                  value={editingRule.type || "PORCENTAJE_VENTA"}
                  onValueChange={(v) => setEditingRule({ ...editingRule, type: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PORCENTAJE_VENTA">% sobre el total de la venta</SelectItem>
                    <SelectItem value="PORCENTAJE_GANANCIA">% sobre la ganancia</SelectItem>
                    <SelectItem value="MONTO_FIJO_POR_VENTA">Monto fijo por venta</SelectItem>
                    <SelectItem value="ESCALONADO">Escalonado por tramos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editingRule.type !== "ESCALONADO" && (
                <div>
                  <Label>
                    {editingRule.type === "MONTO_FIJO_POR_VENTA"
                      ? "Monto fijo ($)"
                      : "Tasa (%)"}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingRule.rate ?? 0}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, rate: Number(e.target.value) })
                    }
                  />
                </div>
              )}

              {editingRule.type === "ESCALONADO" && (
                <div className="space-y-2">
                  <Label>Tramos (rango de venta → tasa %)</Label>
                  <div className="space-y-2">
                    {(editingRule.tiersParsed || []).map((t, idx) => (
                      <div key={idx} className="flex gap-2 items-end">
                        <div>
                          <Label className="text-xs">Mín. ($)</Label>
                          <Input
                            type="number"
                            value={t.min}
                            onChange={(e) => {
                              const tiers = [...(editingRule.tiersParsed || [])];
                              tiers[idx] = { ...t, min: Number(e.target.value) };
                              setEditingRule({ ...editingRule, tiersParsed: tiers });
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Máx. ($)</Label>
                          <Input
                            type="number"
                            placeholder="vacío = sin tope"
                            value={t.max ?? ""}
                            onChange={(e) => {
                              const tiers = [...(editingRule.tiersParsed || [])];
                              tiers[idx] = {
                                ...t,
                                max: e.target.value ? Number(e.target.value) : null,
                              };
                              setEditingRule({ ...editingRule, tiersParsed: tiers });
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Tasa (%)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={t.rate}
                            onChange={(e) => {
                              const tiers = [...(editingRule.tiersParsed || [])];
                              tiers[idx] = { ...t, rate: Number(e.target.value) };
                              setEditingRule({ ...editingRule, tiersParsed: tiers });
                            }}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            const tiers = (editingRule.tiersParsed || []).filter((_, i) => i !== idx);
                            setEditingRule({ ...editingRule, tiersParsed: tiers });
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const tiers = [...(editingRule.tiersParsed || [])];
                        const lastMax = tiers.length > 0 ? tiers[tiers.length - 1].max : 0;
                        tiers.push({ min: lastMax || 0, max: null, rate: 0 });
                        setEditingRule({ ...editingRule, tiersParsed: tiers });
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Agregar tramo
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <Label>Monto mínimo de venta ($)</Label>
                  <Input
                    type="number"
                    value={editingRule.minSaleAmount ?? 0}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, minSaleAmount: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="flex items-end">
                  <div className="flex items-center space-x-2 pb-2">
                    <Switch
                      id="onlyPaid"
                      checked={editingRule.onlyPaid !== false}
                      onCheckedChange={(v) => setEditingRule({ ...editingRule, onlyPaid: v })}
                    />
                    <Label htmlFor="onlyPaid">Solo ventas cobradas (no fiado)</Label>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div>
                  <Label>Inicio</Label>
                  <Input
                    type="date"
                    value={editingRule.startDate ? editingRule.startDate.split("T")[0] : ""}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, startDate: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Fin (vacío = sin fin)</Label>
                  <Input
                    type="date"
                    value={editingRule.endDate ? editingRule.endDate.split("T")[0] : ""}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, endDate: e.target.value || null })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="active"
                  checked={editingRule.active !== false}
                  onCheckedChange={(v) => setEditingRule({ ...editingRule, active: v })}
                />
                <Label htmlFor="active">Regla activa</Label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRule(null)}>
              Cancelar
            </Button>
            <Button onClick={saveRule} disabled={savingRule}>
              {savingRule && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editingRule?.id ? "Guardar cambios" : "Crear regla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
