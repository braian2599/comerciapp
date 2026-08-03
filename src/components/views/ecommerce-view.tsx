"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  Globe,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Save,
  Plug,
  ShoppingCart,
  Package,
  TrendingUp,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatDateTime } from "@/lib/constants";
import { Icon } from "@/lib/icons";

interface EcommerceConfig {
  id: string;
  platform: string;
  enabled: boolean;
  apiUrl: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  accessToken: string | null;
  storeExternalId: string | null;
  syncProducts: boolean;
  syncStock: boolean;
  syncPrices: boolean;
  syncOrders: boolean;
  autoFulfill: boolean;
  webhookSecret: string | null;
  lastSyncAt: string | null;
}

interface SyncLog {
  id: string;
  direction: string;
  entity: string;
  entityId: string | null;
  externalId: string | null;
  action: string;
  status: string;
  message: string | null;
  createdAt: string;
}

const PLATFORMS = [
  { value: "TIENDA_NUBE", label: "TiendaNube", icon: "shopping_bag" },
  { value: "WOOCOMMERCE", label: "WooCommerce (WordPress)", icon: "cart" },
  { value: "MERCADOLIBRE", label: "MercadoLibre", icon: "tag" },
  { value: "SHOPIFY", label: "Shopify", icon: "globe" },
];

export function EcommerceView() {
  const { user } = useAppStore();
  const isAdmin = user?.role === "ADMIN";

  const [config, setConfig] = useState<EcommerceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  async function loadConfig() {
    setLoading(true);
    const res = await fetch("/api/ecommerce/config");
    const data = await res.json();
    setConfig(data);
    setLoading(false);
  }

  async function loadLogs() {
    setLoadingLogs(true);
    const res = await fetch("/api/ecommerce/sync?limit=50");
    const data = await res.json();
    setLogs(Array.isArray(data) ? data : []);
    setLoadingLogs(false);
  }

  useEffect(() => {
    loadConfig();
    loadLogs();
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ecommerce/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfig(data);
      toast.success("Configuración guardada");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!config) return;
    setTesting(true);
    try {
      const res = await fetch("/api/ecommerce/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: config.platform,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          apiSecret: config.apiSecret,
          accessToken: config.accessToken,
          storeExternalId: config.storeExternalId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(data.message || "Conexión exitosa");
      } else {
        toast.error(data.message || "Error de conexión");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  }

  async function runSync(direction: string, entity: string) {
    const key = `${direction}-${entity}`;
    setSyncing(key);
    try {
      const res = await fetch("/api/ecommerce/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, entity, onlyDirty: true, limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(
        `Sincronización: ${data.success} OK, ${data.error} error${data.total ? ` de ${data.total}` : ""}`
      );
      loadLogs();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
        Cargando configuración...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">E-commerce</h1>
        <p className="text-sm text-muted-foreground">
          Sincroniza productos, stock, precios y pedidos con tu tienda online
        </p>
      </div>

      <Tabs defaultValue="config" className="w-full">
        <TabsList className="flex w-full flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="config" className="text-xs">Configuración</TabsTrigger>
          <TabsTrigger value="opciones" className="text-xs">Opciones de Sync</TabsTrigger>
          <TabsTrigger value="manual" className="text-xs">Sync Manual</TabsTrigger>
          <TabsTrigger value="historial" className="text-xs">Historial</TabsTrigger>
        </TabsList>

      <TabsContent value="config" className="mt-4">
      {/* CONFIGURACIÓN */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Configuración de plataforma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            <div>
              <Label>Plataforma</Label>
              <Select
                value={config?.platform || "TIENDA_NUBE"}
                onValueChange={(v) => setConfig({ ...config!, platform: v })}
                disabled={!isAdmin}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="inline-flex items-center gap-1.5"><Icon name={p.icon} className="w-3.5 h-3.5" /> {p.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>ID de la tienda (externo)</Label>
              <Input
                value={config?.storeExternalId || ""}
                onChange={(e) => setConfig({ ...config!, storeExternalId: e.target.value })}
                placeholder="Ej: 12345678 (store_id en TiendaNube)"
                disabled={!isAdmin}
              />
            </div>
          </div>

          {(config?.platform === "WOOCOMMERCE" || config?.platform === "SHOPIFY") && (
            <div>
              <Label>URL de la API</Label>
              <Input
                value={config?.apiUrl || ""}
                onChange={(e) => setConfig({ ...config!, apiUrl: e.target.value })}
                placeholder="https://mitienda.com/wp-json/wc/v3"
                disabled={!isAdmin}
              />
            </div>
          )}

          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {(config?.platform === "WOOCOMMERCE" || config?.platform === "SHOPIFY") && (
              <>
                <div>
                  <Label>API Key / Consumer Key</Label>
                  <Input
                    type="password"
                    value={config?.apiKey || ""}
                    onChange={(e) => setConfig({ ...config!, apiKey: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <Label>API Secret / Consumer Secret</Label>
                  <Input
                    type="password"
                    value={config?.apiSecret || ""}
                    onChange={(e) => setConfig({ ...config!, apiSecret: e.target.value })}
                    disabled={!isAdmin}
                  />
                </div>
              </>
            )}
            {(config?.platform === "TIENDA_NUBE" || config?.platform === "MERCADOLIBRE") && (
              <div className="md:col-span-2">
                <Label>Access Token</Label>
                <Input
                  type="password"
                  value={config?.accessToken || ""}
                  onChange={(e) => setConfig({ ...config!, accessToken: e.target.value })}
                  placeholder="Token de acceso OAuth2"
                  disabled={!isAdmin}
                />
              </div>
            )}
          </div>

          <div>
            <Label>Webhook secret (opcional)</Label>
            <Input
              type="password"
              value={config?.webhookSecret || ""}
              onChange={(e) => setConfig({ ...config!, webhookSecret: e.target.value })}
              placeholder="Secreto para validar webhooks entrantes"
              disabled={!isAdmin}
            />
            {config?.webhookSecret && (
              <p className="text-xs text-muted-foreground mt-1">
                URL del webhook: <code>/api/ecommerce/webhook?storeId=TU_STORE_ID&secret=XXX</code>
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="enabled"
              checked={!!config?.enabled}
              onCheckedChange={(v) => setConfig({ ...config!, enabled: v })}
              disabled={!isAdmin}
            />
            <Label htmlFor="enabled" className="font-medium">E-commerce habilitado</Label>
          </div>

          {isAdmin && (
            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Guardar configuración
              </Button>
              <Button variant="outline" onClick={testConnection} disabled={testing}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plug className="w-4 h-4 mr-2" />}
                Probar conexión
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="opciones" className="mt-4">
      {/* OPCIONES DE SYNC */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Opciones de sincronización</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          <SyncOption
            icon={<Package className="w-4 h-4" />}
            label="Productos"
            description="Crear y actualizar productos en la plataforma"
            checked={!!config?.syncProducts}
            onCheck={(v) => setConfig({ ...config!, syncProducts: v })}
            disabled={!isAdmin}
          />
          <SyncOption
            icon={<TrendingUp className="w-4 h-4" />}
            label="Stock"
            description="Sincronizar cantidades disponibles"
            checked={!!config?.syncStock}
            onCheck={(v) => setConfig({ ...config!, syncStock: v })}
            disabled={!isAdmin}
          />
          <SyncOption
            icon={<TrendingUp className="w-4 h-4" />}
            label="Precios"
            description="Mantener precios actualizados"
            checked={!!config?.syncPrices}
            onCheck={(v) => setConfig({ ...config!, syncPrices: v })}
            disabled={!isAdmin}
          />
          <SyncOption
            icon={<ShoppingCart className="w-4 h-4" />}
            label="Pedidos"
            description="Importar pedidos online como ventas locales"
            checked={!!config?.syncOrders}
            onCheck={(v) => setConfig({ ...config!, syncOrders: v })}
            disabled={!isAdmin}
          />
          <SyncOption
            icon={<CheckCircle2 className="w-4 h-4" />}
            label="Auto-fulfill"
            description="Marcar pedidos como enviados al importarlos"
            checked={!!config?.autoFulfill}
            onCheck={(v) => setConfig({ ...config!, autoFulfill: v })}
            disabled={!isAdmin}
          />
          {config?.lastSyncAt && (
            <div className="text-xs text-muted-foreground self-center">
              Última sync: {formatDateTime(config.lastSyncAt)}
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="manual" className="mt-4">
      {/* ACCIONES DE SYNC */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sincronización manual</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => runSync("OUTBOUND", "PRODUCT")}
            disabled={!!syncing || !config?.enabled}
          >
            {syncing === "OUTBOUND-PRODUCT" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            <Package className="w-4 h-4 mr-2" />
            Publicar productos
          </Button>
          <Button
            variant="outline"
            onClick={() => runSync("OUTBOUND", "STOCK")}
            disabled={!!syncing || !config?.enabled}
          >
            {syncing === "OUTBOUND-STOCK" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            <TrendingUp className="w-4 h-4 mr-2" />
            Actualizar stock
          </Button>
          <Button
            variant="outline"
            onClick={() => runSync("OUTBOUND", "PRICE")}
            disabled={!!syncing || !config?.enabled}
          >
            {syncing === "OUTBOUND-PRICE" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            <TrendingUp className="w-4 h-4 mr-2" />
            Actualizar precios
          </Button>
          <Button
            variant="outline"
            onClick={() => runSync("INBOUND", "ORDER")}
            disabled={!!syncing || !config?.enabled}
          >
            {syncing === "INBOUND-ORDER" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            <ShoppingCart className="w-4 h-4 mr-2" />
            Importar pedidos
          </Button>
          <Button variant="ghost" onClick={loadLogs}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refrescar logs
          </Button>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="historial" className="mt-4">
      {/* LOGS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de sincronización</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingLogs ? (
            <div className="p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-indigo-600" />
              Cargando logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No hay operaciones registradas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Dirección</TableHead>
                    <TableHead>Entidad</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>ID Local</TableHead>
                    <TableHead>ID Remoto</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead>Mensaje</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.slice(0, 50).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{formatDateTime(l.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {l.direction === "OUTBOUND" ? "→ Subida" : "← Bajada"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{l.entity}</TableCell>
                      <TableCell className="text-xs">{l.action}</TableCell>
                      <TableCell className="text-xs font-mono">{l.entityId?.slice(-6) || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{l.externalId || "—"}</TableCell>
                      <TableCell className="text-center">
                        {l.status === "SUCCESS" && (
                          <CheckCircle2 className="w-4 h-4 text-indigo-600 inline" />
                        )}
                        {l.status === "ERROR" && (
                          <XCircle className="w-4 h-4 text-red-600 inline" />
                        )}
                        {l.status === "PENDING" && (
                          <Loader2 className="w-4 h-4 text-amber-600 inline" />
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {l.message || "—"}
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
    </div>
  );
}

function SyncOption({
  icon, label, description, checked, onCheck, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start space-x-3 p-3 border rounded-lg">
      <div className="p-2 rounded-md bg-indigo-50 text-indigo-700 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <Label className="font-medium">{label}</Label>
          <Switch checked={checked} onCheckedChange={onCheck} disabled={disabled} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}
