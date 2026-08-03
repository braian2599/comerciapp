"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
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
  Search,
  Pencil,
  Trash2,
  Package,
  Loader2,
  Tag,
  ScanLine,
  CheckCircle2,
  ImageOff,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  X,
} from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { formatCurrency, UNITS } from "@/lib/constants";
import { safeFetchJSON, safeFetchArray } from "@/lib/fetch";

interface Product {
  id: string;
  name: string;
  description?: string;
  barcode?: string;
  sku?: string;
  categoryId?: string;
  category?: { id: string; name: string };
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  unit: string;
  active: boolean;
  brand?: string;
  labels?: string;
  ingredients?: string;
  allergens?: string;
  imageUrl?: string;
}

interface Category {
  id: string;
  name: string;
  _count?: { products: number };
}

const emptyForm = {
  id: "",
  name: "",
  description: "",
  barcode: "",
  sku: "",
  categoryId: "",
  costPrice: 0,
  salePrice: 0,
  stock: 0,
  minStock: 5,
  unit: "UNIDAD",
  active: true,
  brand: "",
  labels: "",
  ingredients: "",
  allergens: "",
  imageUrl: "",
};

export function ProductsView() {
  const { store } = useAppStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterStock, setFilterStock] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  // Lookup por código de barras
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<
    | {
        status: "idle" | "loading" | "found" | "notfound" | "error";
        source?: string;
        imageUrl?: string;
        labels?: string[];
        allergens?: string[];
      }
    | null
  >(null);
  // Sección colapsable de datos adicionales
  const [showExtraFields, setShowExtraFields] = useState(false);
  // Etiquetas y alérgenos editados como chips
  const [labelChips, setLabelChips] = useState<string[]>([]);
  const [allergenChips, setAllergenChips] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [allergenInput, setAllergenInput] = useState("");

  async function handleBarcodeLookup() {
    const code = (form.barcode || "").trim();
    if (!code) {
      toast.error("Ingresá un código de barras primero");
      return;
    }
    setLookupLoading(true);
    setLookupResult({ status: "loading" });
    try {
      const { ok, data, error } = await safeFetchJSON<any>(
        `/api/products/lookup?barcode=${encodeURIComponent(code)}`
      );
      if (!ok || !data) {
        throw new Error(error || "No se pudo consultar la base de productos");
      }
      if (data.found) {
        // Solo autocompletamos campos que el usuario aún no llenó.
        setForm((prev: any) => ({
          ...prev,
          name: prev.name || data.name || "",
          description: prev.description || data.description || data.brand || "",
          barcode: prev.barcode || code,
          brand: prev.brand || data.brand || "",
          ingredients: prev.ingredients || data.ingredients || "",
          imageUrl: prev.imageUrl || data.imageUrl || "",
        }));
        // Merge de etiquetas y alérgenos (sin duplicar)
        if (Array.isArray(data.labels) && data.labels.length > 0) {
          setLabelChips((prev) =>
            Array.from(new Set([...prev, ...data.labels])).slice(0, 15)
          );
          setShowExtraFields(true);
        }
        if (Array.isArray(data.allergens) && data.allergens.length > 0) {
          setAllergenChips((prev) =>
            Array.from(new Set([...prev, ...data.allergens])).slice(0, 15)
          );
          setShowExtraFields(true);
        }
        setLookupResult({
          status: "found",
          source: data.source,
          imageUrl: data.imageUrl,
          labels: data.labels,
          allergens: data.allergens,
        });
        const sourceLabel =
          data.source === "openfoodfacts" ? "Open Food Facts" : "UPC Item DB";
        toast.success(`Producto encontrado en ${sourceLabel}`, {
          description: data.name,
        });
      } else {
        setLookupResult({ status: "notfound" });
        toast.info("No se encontró el código en las bases de datos públicas", {
          description: "Completá los datos manualmente",
        });
      }
    } catch (e: any) {
      setLookupResult({ status: "error" });
      toast.error("No se pudo consultar la base de productos");
    } finally {
      setLookupLoading(false);
    }
  }

  function resetLookup() {
    setLookupResult(null);
  }

  const symbol = store?.currencySymbol || "$";

  async function load() {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        safeFetchArray<Product>("/api/products"),
        safeFetchArray<Category>("/api/categories"),
      ]);
      setProducts(p);
      setCategories(c);
    } catch {
      toast.error("No se pudieron cargar los productos");
      setProducts([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.barcode?.includes(search) ||
        p.sku?.toLowerCase().includes(search.toLowerCase());
      const matchCat =
        filterCat === "all" || p.categoryId === filterCat;
      const matchStock =
        filterStock === "all" ||
        (filterStock === "low" && p.stock <= p.minStock) ||
        (filterStock === "out" && p.stock <= 0) ||
        (filterStock === "ok" && p.stock > p.minStock);
      return matchSearch && matchCat && matchStock;
    });
  }, [products, search, filterCat, filterStock]);

  function openNew() {
    setForm({ ...emptyForm });
    resetLookup();
    setLabelChips([]);
    setAllergenChips([]);
    setShowExtraFields(false);
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setForm({
      ...p,
      costPrice: p.costPrice,
      salePrice: p.salePrice,
      stock: p.stock,
      minStock: p.minStock,
      adjustReason: "",
    });
    resetLookup();
    setLabelChips(p.labels ? p.labels.split(",").map((s) => s.trim()).filter(Boolean) : []);
    setAllergenChips(p.allergens ? p.allergens.split(",").map((s) => s.trim()).filter(Boolean) : []);
    setShowExtraFields(
      !!(p.brand || p.ingredients || p.labels || p.allergens || p.imageUrl)
    );
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.salePrice) {
      toast.error("Nombre y precio de venta son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const method = form.id ? "PUT" : "POST";
      const payload = {
        ...form,
        labels: labelChips.join(","),
        allergens: allergenChips.join(","),
      };
      const { ok, error } = await safeFetchJSON("/api/products", {
        method,
        body: JSON.stringify(payload),
      });
      if (!ok) throw new Error(error);
      toast.success(form.id ? "Producto actualizado" : "Producto creado");
      setFormOpen(false);
      load();
    } catch (e: any) {
      const msg = e?.message || "No se pudo guardar el producto";
      toast.error("Error al guardar el producto", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const { ok, error } = await safeFetchJSON(
        `/api/products?id=${deleteId}`,
        { method: "DELETE" }
      );
      if (!ok) throw new Error(error);
      toast.success("Producto desactivado");
      setDeleteId(null);
      load();
    } catch (e: any) {
      toast.error("Error al eliminar", { description: e.message });
    }
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) return;
    try {
      const { ok, error } = await safeFetchJSON("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCatName }),
      });
      if (!ok) throw new Error(error);
      toast.success("Categoría creada");
      setNewCatName("");
      setCatDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error("Error al crear categoría", { description: e.message });
    }
  }

  async function handleDeleteCategory(id: string, name: string) {
    if (!confirm(`¿Eliminar la categoría "${name}"? Los productos quedarán sin categoría.`)) return;
    try {
      const { ok, error } = await safeFetchJSON(`/api/categories?id=${id}`, {
        method: "DELETE",
      });
      if (!ok) throw new Error(error);
      toast.success("Categoría eliminada");
      load();
    } catch (e: any) {
      toast.error("Error al eliminar categoría", { description: e.message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} productos · {categories.length} categorías
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Tag className="w-4 h-4 mr-2" />
                Categorías
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gestionar categorías</DialogTitle>
                <DialogDescription>
                  Agregá o eliminá categorías para organizar tus productos
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input
                  placeholder="Nueva categoría..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                />
                <Button onClick={handleAddCategory} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1 mt-2">
                {categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Sin categorías
                  </p>
                ) : (
                  categories.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    >
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c._count?.products || 0} productos
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-600"
                        onClick={() => handleDeleteCategory(c.id, c.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            Nuevo producto
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, código o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger>
                <SelectValue placeholder="Todas las categorías" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStock} onValueChange={setFilterStock}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el stock</SelectItem>
                <SelectItem value="ok">Stock OK</SelectItem>
                <SelectItem value="low">Stock bajo</SelectItem>
                <SelectItem value="out">Sin stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Cargando productos...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {search || filterCat !== "all" || filterStock !== "all"
                  ? "No se encontraron productos con esos filtros"
                  : "Aún no tenés productos. Creá el primero!"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="hidden md:table-cell">Categoría</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id} className={!p.active ? "opacity-50" : ""}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{p.name}</p>
                          {(p.barcode || p.sku) && (
                            <p className="text-xs text-muted-foreground">
                              {p.barcode && `Cód: ${p.barcode}`}
                              {p.barcode && p.sku && " · "}
                              {p.sku && `SKU: ${p.sku}`}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {p.category ? (
                          <Badge variant="outline">{p.category.name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(p.costPrice, symbol)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(p.salePrice, symbol)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            p.stock <= 0
                              ? "text-red-600 font-medium"
                              : p.stock <= p.minStock
                              ? "text-amber-600 font-medium"
                              : "text-indigo-700"
                          }
                        >
                          {p.stock} {p.unit === "KG" ? "kg" : "u"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {p.active ? (
                          <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600"
                          onClick={() => setDeleteId(p.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-4xl w-[95vw] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar producto" : "Nuevo producto"}</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Modificá los datos del producto. Si cambiás el stock, se registrará un ajuste."
                : "Completá los datos del nuevo producto."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="barcode">Código de barras</Label>
                <span className="text-xs text-muted-foreground">
                  Escaneá con lector o escribí y presioná Enter
                </span>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="barcode"
                    placeholder="Ej: 7790895005231"
                    value={form.barcode}
                    onChange={(e) => {
                      setForm({ ...form, barcode: e.target.value });
                      if (lookupResult) resetLookup();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !lookupLoading) {
                        e.preventDefault();
                        handleBarcodeLookup();
                      }
                    }}
                    className="pl-9"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleBarcodeLookup}
                  disabled={lookupLoading || !form.barcode}
                  title="Buscar datos del producto por código"
                >
                  {lookupLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4 mr-2" />
                  )}
                  Buscar
                </Button>
              </div>
              {/* Estado del lookup */}
              {lookupResult?.status === "loading" && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Consultando base de datos de productos...
                </p>
              )}
              {lookupResult?.status === "found" && (
                <div className="flex items-start gap-3 p-3 rounded-md bg-emerald-50 border border-emerald-200">
                  {lookupResult.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lookupResult.imageUrl}
                      alt="Producto"
                      className="w-14 h-14 rounded-md object-cover border bg-white"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center">
                      <ImageOff className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-emerald-800 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Encontrado en{" "}
                      {lookupResult.source === "openfoodfacts"
                        ? "Open Food Facts"
                        : "UPC Item DB"}
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Se autocompletaron nombre y descripción. Revisá precios y stock.
                    </p>
                  </div>
                </div>
              )}
              {lookupResult?.status === "notfound" && (
                <p className="text-xs text-amber-600">
                  No se encontró en bases públicas. Completá los datos manualmente.
                </p>
              )}
              {lookupResult?.status === "error" && (
                <p className="text-xs text-red-600">
                  Error al consultar. Verificá tu conexión e intentá nuevamente.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <Select
                value={form.categoryId || "none"}
                onValueChange={(v) =>
                  setForm({ ...form, categoryId: v === "none" ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin categoría</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unidad</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => setForm({ ...form, unit: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="costPrice">Precio de costo</Label>
              <Input
                id="costPrice"
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) =>
                  setForm({ ...form, costPrice: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="salePrice">Precio de venta *</Label>
              <Input
                id="salePrice"
                type="number"
                step="0.01"
                value={form.salePrice}
                onChange={(e) =>
                  setForm({ ...form, salePrice: Number(e.target.value) })
                }
              />
              {form.costPrice > 0 && form.salePrice > 0 && (
                <p className="text-xs text-muted-foreground">
                  Margen:{" "}
                  {(
                    ((form.salePrice - form.costPrice) / form.costPrice) *
                    100
                  ).toFixed(1)}
                  %
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock">
                {form.id ? "Stock (ajuste)" : "Stock inicial"}
              </Label>
              <Input
                id="stock"
                type="number"
                step="0.01"
                value={form.stock}
                onChange={(e) =>
                  setForm({ ...form, stock: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minStock">Stock mínimo</Label>
              <Input
                id="minStock"
                type="number"
                step="0.01"
                value={form.minStock}
                onChange={(e) =>
                  setForm({ ...form, minStock: Number(e.target.value) })
                }
              />
            </div>
            {form.id && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="adjustReason">Motivo del ajuste (opcional)</Label>
                <Input
                  id="adjustReason"
                  placeholder="Ej: Recuento de inventario"
                  value={form.adjustReason}
                  onChange={(e) =>
                    setForm({ ...form, adjustReason: e.target.value })
                  }
                />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="active"
                checked={form.active}
                onCheckedChange={(v) => setForm({ ...form, active: v })}
              />
              <Label htmlFor="active">Producto activo (visible en POS)</Label>
            </div>

            {/* Sección colapsable: datos adicionales */}
            <div className="sm:col-span-2 border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowExtraFields((v) => !v)}
                className="w-full flex items-center justify-between p-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {showExtraFields ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  Datos adicionales del producto
                </span>
                <span className="text-xs text-muted-foreground">
                  {(labelChips.length > 0 ||
                    allergenChips.length > 0 ||
                    form.brand ||
                    form.ingredients) && (
                    <Badge variant="secondary" className="ml-1">
                      Autocompletado
                    </Badge>
                  )}
                </span>
              </button>
              {showExtraFields && (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 p-4">
                  {/* Marca */}
                  <div className="space-y-2">
                    <Label htmlFor="brand">Marca</Label>
                    <Input
                      id="brand"
                      placeholder="Ej: LIEBIG, Coca-Cola, Amanda"
                      value={form.brand || ""}
                      onChange={(e) =>
                        setForm({ ...form, brand: e.target.value })
                      }
                    />
                  </div>

                  {/* Imagen (URL) */}
                  <div className="space-y-2">
                    <Label htmlFor="imageUrl">Imagen del producto (URL)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="imageUrl"
                        placeholder="https://..."
                        value={form.imageUrl || ""}
                        onChange={(e) =>
                          setForm({ ...form, imageUrl: e.target.value })
                        }
                      />
                      {form.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={form.imageUrl}
                          alt=""
                          className="w-10 h-10 rounded border object-cover bg-white"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Etiquetas (chips editables) */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Etiquetas</Label>
                    <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 rounded-md border bg-background">
                      {labelChips.length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          Sin etiquetas. Ej: Sin TACC, Vegano, Orgánico...
                        </span>
                      )}
                      {labelChips.map((label) => (
                        <Badge
                          key={label}
                          variant="secondary"
                          className="gap-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                        >
                          {label}
                          <button
                            type="button"
                            onClick={() =>
                              setLabelChips((prev) =>
                                prev.filter((l) => l !== label)
                              )
                            }
                            className="ml-1 hover:bg-indigo-200 rounded-full p-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <Input
                      placeholder="Escribí una etiqueta y presioná Enter..."
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && labelInput.trim()) {
                          e.preventDefault();
                          const v = labelInput.trim();
                          if (!labelChips.includes(v)) {
                            setLabelChips((prev) => [...prev, v].slice(0, 15));
                          }
                          setLabelInput("");
                        }
                      }}
                    />
                  </div>

                  {/* Alérgenos (chips editables con advertencia) */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      Alérgenos
                    </Label>
                    <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 rounded-md border bg-background">
                      {allergenChips.length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          Sin alérgenos declarados. Ej: Leche, Gluten, Soja...
                        </span>
                      )}
                      {allergenChips.map((a) => (
                        <Badge
                          key={a}
                          className="gap-1 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                        >
                          {a}
                          <button
                            type="button"
                            onClick={() =>
                              setAllergenChips((prev) =>
                                prev.filter((x) => x !== a)
                              )
                            }
                            className="ml-1 hover:bg-red-200 rounded-full p-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <Input
                      placeholder="Escribí un alérgeno y presioná Enter..."
                      value={allergenInput}
                      onChange={(e) => setAllergenInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && allergenInput.trim()) {
                          e.preventDefault();
                          const v = allergenInput.trim();
                          if (!allergenChips.includes(v)) {
                            setAllergenChips((prev) =>
                              [...prev, v].slice(0, 15)
                            );
                          }
                          setAllergenInput("");
                        }
                      }}
                    />
                  </div>

                  {/* Ingredientes */}
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ingredients">Ingredientes</Label>
                    <Textarea
                      id="ingredients"
                      placeholder="Lista de ingredientes completa..."
                      value={form.ingredients || ""}
                      onChange={(e) =>
                        setForm({ ...form, ingredients: e.target.value })
                      }
                      rows={3}
                      className="text-xs"
                    />
                  </div>
                </div>
              )}
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
              {form.id ? "Guardar cambios" : "Crear producto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar producto?</AlertDialogTitle>
            <AlertDialogDescription>
              El producto se marcará como inactivo y no aparecerá en el POS.
              Las ventas históricas se conservan. Podés reactivarlo cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
