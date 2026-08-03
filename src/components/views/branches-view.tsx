"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Store as StoreIcon,
  MapPin,
  Phone,
  Star,
} from "lucide-react";

interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  manager?: string | null;
  isMain: boolean;
  active: boolean;
  _count?: { sales: number; cashRegisters: number };
  createdAt: string;
}

const emptyForm = {
  name: "",
  code: "",
  address: "",
  phone: "",
  manager: "",
  isMain: false,
  active: true,
};

export function BranchesView() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/branches");
    const data = await res.json();
    setBranches(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setForm(emptyForm);
    setEditingId(null);
    setOpen(true);
  }

  function openEdit(b: Branch) {
    setForm({
      name: b.name,
      code: b.code,
      address: b.address || "",
      phone: b.phone || "",
      manager: b.manager || "",
      isMain: b.isMain,
      active: b.active,
    });
    setEditingId(b.id);
    setOpen(true);
  }

  async function save() {
    if (!form.name || !form.code) {
      toast.error("Nombre y código son requeridos");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, id: editingId };
      const method = editingId ? "PUT" : "POST";
      const res = await fetch("/api/branches", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Error al guardar");
        return;
      }
      toast.success(editingId ? "Sucursal actualizada" : "Sucursal creada");
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/branches?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Error al eliminar");
      return;
    }
    toast.success("Sucursal eliminada");
    setDeleteId(null);
    await load();
  }

  const totalSales = branches.reduce(
    (sum, b) => sum + (b._count?.sales || 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sucursales</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los puntos de venta físicos de tu comercio
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> Nueva sucursal
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <StoreIcon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sucursales activas</p>
                <p className="text-xl font-bold">
                  {branches.filter((b) => b.active).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <Star className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ventas totales</p>
                <p className="text-xl font-bold">{totalSales}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cajas asignadas</p>
                <p className="text-xl font-bold">
                  {branches.reduce(
                    (sum, b) => sum + (b._count?.cashRegisters || 0),
                    0
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
          ) : branches.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <StoreIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay sucursales. Crea la primera.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Encargado</TableHead>
                  <TableHead>Ventas</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {b.isMain && (
                          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-400" />
                        )}
                        {b.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {b.code}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.address || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.phone || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.manager || "—"}
                    </TableCell>
                    <TableCell>{b._count?.sales || 0}</TableCell>
                    <TableCell>
                      <Badge variant={b.active ? "default" : "secondary"}>
                        {b.active ? "Activa" : "Inactiva"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(b)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {!b.isMain && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(b.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modal alta/edición */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar sucursal" : "Nueva sucursal"}
            </DialogTitle>
            <DialogDescription>
              Registra un nuevo punto de venta físico para tu comercio
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nombre *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Sucursal Centro"
                />
              </div>
              <div>
                <Label>Código *</Label>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm({ ...form, code: e.target.value.toUpperCase() })
                  }
                  placeholder="CEN"
                  maxLength={5}
                  className="font-mono uppercase"
                />
              </div>
            </div>
            <div>
              <Label>Dirección</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Av. San Martín 123"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Teléfono</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="351 123-4567"
                />
              </div>
              <div>
                <Label>Encargado</Label>
                <Input
                  value={form.manager}
                  onChange={(e) => setForm({ ...form, manager: e.target.value })}
                  placeholder="Nombre del encargado"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Sucursal principal</p>
                <p className="text-xs text-muted-foreground">
                  Marca si es la casa central (no se puede eliminar)
                </p>
              </div>
              <Switch
                checked={form.isMain}
                onCheckedChange={(v) => setForm({ ...form, isMain: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Activa</p>
                <p className="text-xs text-muted-foreground">
                  Si está inactiva no aparecerá en el POS
                </p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar sucursal?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Las ventas y cajas asociadas
              conservarán su registro histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove(deleteId)}
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
