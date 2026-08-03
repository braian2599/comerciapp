"use client";

import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import {
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Printer,
  Star,
  CheckCircle2,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";

interface PrintTemplate {
  id: string;
  name: string;
  type: string;
  paperWidth: number;
  charset: string;
  cutPaper: boolean;
  headerLines: string | null;
  footerLines: string | null;
  showLogo: boolean;
  showCustomer: boolean;
  showSeller: boolean;
  showPayment: boolean;
  active: boolean;
  isDefault: boolean;
}

const TEMPLATE_TYPES = [
  { value: "TICKET", label: "Ticket de venta" },
  { value: "COMANDA", label: "Comanda (cocina/barra)" },
  { value: "CIERRE_Z", label: "Cierre de caja (Z)" },
  { value: "ETIQUETA", label: "Etiqueta de precio" },
];

const CHARSETS = [
  { value: "UTF8", label: "UTF-8 (universal)" },
  { value: "CP437", label: "CP437 (impresoras térmicas estándar)" },
  { value: "CP850", label: "CP850 (Europa occidental)" },
];

export function PrintTemplatesView() {
  const { user } = useAppStore();
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<PrintTemplate> | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === "ADMIN";

  async function load() {
    setLoading(true);
    const res = await fetch("/api/print-templates");
    const data = await res.json();
    setTemplates(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const method = editing.id ? "PUT" : "POST";
      const res = await fetch("/api/print-templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(editing.id ? "Plantilla actualizada" : "Plantilla creada");
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar plantilla?")) return;
    try {
      const res = await fetch(`/api/print-templates?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Plantilla eliminada");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function setDefault(id: string) {
    try {
      const res = await fetch("/api/print-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isDefault: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Plantilla por defecto actualizada");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plantillas de impresión</h1>
          <p className="text-sm text-muted-foreground">
            Configura tickets, comandas y cierres de caja para impresoras térmicas
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() =>
              setEditing({
                type: "TICKET",
                paperWidth: 58,
                charset: "UTF8",
                cutPaper: true,
                showSeller: true,
                showPayment: true,
                active: true,
              })
            }
          >
            <Plus className="w-4 h-4 mr-1" />
            Nueva plantilla
          </Button>
        )}
      </div>

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-3 text-xs text-blue-800">
          <strong>Cómo imprimir:</strong> Las plantillas generan comandos ESC/POS que pueden enviarse a través de:
          <ul className="list-disc ml-5 mt-1 space-y-0.5">
            <li><strong>WebUSB</strong> — impresora USB conectada directamente al dispositivo</li>
            <li><strong>Servidor local</strong> — programa auxiliar en la PC que recibe comandos vía WebSocket (puerto 8787)</li>
            <li><strong>Descarga</strong> — genera un archivo .bin para imprimir manualmente</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-emerald-600" />
              Cargando plantillas...
            </div>
          ) : templates.length === 0 ? (
            <div className="p-12 text-center">
              <Printer className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No hay plantillas configuradas. Crea la primera con el botón "Nueva plantilla".
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Charset</TableHead>
                    <TableHead>Corte</TableHead>
                    <TableHead>Mostrar</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {t.name}
                          {t.isDefault && (
                            <Badge className="bg-amber-100 text-amber-700">
                              <Star className="w-3 h-3 mr-1" />
                              Por defecto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {TEMPLATE_TYPES.find((x) => x.value === t.type)?.label || t.type}
                        </Badge>
                      </TableCell>
                      <TableCell>{t.paperWidth}mm</TableCell>
                      <TableCell className="text-xs">{t.charset}</TableCell>
                      <TableCell>
                        {t.cutPaper ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <span className="text-muted-foreground text-xs">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[
                          t.showSeller && "Vendedor",
                          t.showCustomer && "Cliente",
                          t.showPayment && "Pago",
                        ].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.active ? (
                          <Badge className="bg-emerald-100 text-emerald-700">Activa</Badge>
                        ) : (
                          <Badge variant="outline">Inactiva</Badge>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          {!t.isDefault && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setDefault(t.id)}
                              title="Marcar como por defecto"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(t)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          {!t.isDefault && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600"
                              onClick={() => remove(t.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
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

      {/* Modal editar */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar plantilla" : "Nueva plantilla"}
            </DialogTitle>
            <DialogDescription>
              Personaliza el contenido y formato de los comprobantes impresos
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4 py-2">
              <div className="grid gap-3 grid-cols-2">
                <div>
                  <Label>Nombre *</Label>
                  <Input
                    value={editing.name || ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Ej: Ticket 58mm mostrador"
                  />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select
                    value={editing.type || "TICKET"}
                    onValueChange={(v) => setEditing({ ...editing, type: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 grid-cols-3">
                <div>
                  <Label>Ancho de papel</Label>
                  <Select
                    value={String(editing.paperWidth || 58)}
                    onValueChange={(v) => setEditing({ ...editing, paperWidth: Number(v) })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58">58mm (estándar)</SelectItem>
                      <SelectItem value="80">80mm (ancho)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Charset</Label>
                  <Select
                    value={editing.charset || "UTF8"}
                    onValueChange={(v) => setEditing({ ...editing, charset: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHARSETS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <div className="flex items-center space-x-2 pb-2">
                    <Switch
                      id="cutPaper"
                      checked={editing.cutPaper !== false}
                      onCheckedChange={(v) => setEditing({ ...editing, cutPaper: v })}
                    />
                    <Label htmlFor="cutPaper">Corte automático</Label>
                  </div>
                </div>
              </div>

              <div>
                <Label>Encabezado personalizado (opcional)</Label>
                <Textarea
                  value={editing.headerLines || ""}
                  onChange={(e) => setEditing({ ...editing, headerLines: e.target.value })}
                  placeholder={"Línea 1\nLínea 2\nSoporta: {{store.name}}, {{store.cuit}}, {{sale.total}}"}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Variables: {`{{store.name}}, {{store.cuit}}, {{store.address}}, {{sale.total}}, {{sale.number}}`}
                </p>
              </div>

              <div>
                <Label>Pie de página (opcional)</Label>
                <Textarea
                  value={editing.footerLines || ""}
                  onChange={(e) => setEditing({ ...editing, footerLines: e.target.value })}
                  placeholder={"¡Gracias por su compra!\nwww.tutienda.com"}
                  rows={3}
                />
              </div>

              <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="showSeller"
                    checked={!!editing.showSeller}
                    onCheckedChange={(v) => setEditing({ ...editing, showSeller: v })}
                  />
                  <Label htmlFor="showSeller">Vendedor</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="showCustomer"
                    checked={!!editing.showCustomer}
                    onCheckedChange={(v) => setEditing({ ...editing, showCustomer: v })}
                  />
                  <Label htmlFor="showCustomer">Cliente</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="showPayment"
                    checked={!!editing.showPayment}
                    onCheckedChange={(v) => setEditing({ ...editing, showPayment: v })}
                  />
                  <Label htmlFor="showPayment">Pago</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="showLogo"
                    checked={!!editing.showLogo}
                    onCheckedChange={(v) => setEditing({ ...editing, showLogo: v })}
                  />
                  <Label htmlFor="showLogo">Logo</Label>
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="active"
                    checked={editing.active !== false}
                    onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                  />
                  <Label htmlFor="active">Activa</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="isDefault"
                    checked={!!editing.isDefault}
                    onCheckedChange={(v) => setEditing({ ...editing, isDefault: v })}
                  />
                  <Label htmlFor="isDefault">Plantilla por defecto</Label>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editing?.id ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
