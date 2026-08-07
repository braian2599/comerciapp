"use client";

import { useEffect, useState, useMemo } from "react";
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
  Search,
  Filter as FilterIcon,
} from "lucide-react";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

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

  // Filtros
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState("all");

  async function load() {
    setLoading(true);
    try {
      const data = await safeFetchArray<Branch>("/api/branches");
      setBranches(data);
    } catch (e: any) {
      toast.error("Error al cargar sucursales", { description: e?.message });
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return branches.filter((b) => {
      if (filterActive === "active" && !b.active) return false;
      if (filterActive === "inactive" && b.active) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.name.toLowerCase().includes(q) &&
          !b.code.toLowerCase().includes(q) &&
          !(b.address || "").toLowerCase().includes(q) &&
          !(b.manager || "").toLowerCase().includes(q) &&
          !(b.phone || "").includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [branches, search, filterActive]);

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
      const { ok, error } = await safeFetchJSON("/api/branches", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) {
        toast.error(error || "Error al guardar");
        return;
      }
      toast.success(editingId ? "Sucursal actualizada" : "Sucursal creada");
      setOpen(false);
      await load();
    } catch (e: any) {
      toast.error("Error de conexión", { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      const { ok, error } = await safeFetchJSON(`/api/branches?id=${id}`, { method: "DELETE" });
      if (!ok) {
        toast.error(error || "Error al eliminar");
        return;
      }
      toast.success("Sucursal eliminada");
      setDeleteId(null);
      await load();
    } catch (e: any) {
      toast.error("Error de conexión", { description: e?.message });
    }
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

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Nombre, código, dirección, encargado..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estado</Label>
            <Select value={filterActive} onValueChange={setFilterActive}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="active">Activas</SelectItem>
                <SelectItem value="inactive">Inactivas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(search || filterActive !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setFilterActive("all");
              }}
            >
              Limpiar
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {filtered.length} / {branches.length}
          </span>
        </CardContent>
      </Card>

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
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FilterIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No hay sucursales que coincidan con los filtros.</p>
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
                {filtered.map((b) => (
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
