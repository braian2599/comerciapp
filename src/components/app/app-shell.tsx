"use client";

import { useEffect, useState, Fragment } from "react";
import { useSession, signOut } from "next-auth/react";
import { useAppStore, ViewKey } from "@/store/app-store";
import { DashboardView } from "@/components/views/dashboard-view";
import { PosView } from "@/components/views/pos-view";
import { ProductsView } from "@/components/views/products-view";
import { SalesView } from "@/components/views/sales-view";
import { CustomersView } from "@/components/views/customers-view";
import { InventoryView } from "@/components/views/inventory-view";
import { PurchasesView } from "@/components/views/purchases-view";
import { ExpensesView } from "@/components/views/expenses-view";
import { CashRegisterView } from "@/components/views/cash-register-view";
import { InvoicesView } from "@/components/views/invoices-view";
import { ReportsView } from "@/components/views/reports-view";
import { RefundsView } from "@/components/views/refunds-view";
import { PromotionsView } from "@/components/views/promotions-view";
import { BranchesView } from "@/components/views/branches-view";
import { CommissionsView } from "@/components/views/commissions-view";
import { PrintTemplatesView } from "@/components/views/print-templates-view";
import { EcommerceView } from "@/components/views/ecommerce-view";
import { SettingsView } from "@/components/views/settings-view";
import { usePWA, usePWAInstall } from "@/hooks/use-pwa";
import { toast } from "sonner";
import { AuthScreen } from "@/components/app/auth-screen";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Receipt,
  Users,
  Warehouse,
  Truck,
  TrendingDown,
  Wallet,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Store,
  RotateCcw,
  Tag,
  Building2,
  Coins,
  Printer,
  Globe,
  WifiOff,
  RefreshCw,
  Download,
  CheckCircle2,
  ChevronDown,
  LayoutGrid,
} from "lucide-react";
import { rubroIcon } from "@/lib/constants";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { safeFetchJSON } from "@/lib/fetch";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ReactNode;
  roles: string[]; // quienes pueden verlo
}

interface NavCategory {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: "operaciones",
    label: "Operaciones",
    items: [
      { key: "pos", label: "Punto de Venta", icon: <ShoppingCart className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
      { key: "cash", label: "Caja", icon: <Wallet className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
      { key: "dashboard", label: "Panel", icon: <LayoutDashboard className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
    ],
  },
  {
    id: "ventas",
    label: "Ventas",
    items: [
      { key: "sales", label: "Ventas", icon: <Receipt className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
      { key: "refunds", label: "Devoluciones", icon: <RotateCcw className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
      { key: "invoices", label: "Facturación", icon: <FileText className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
      { key: "customers", label: "Clientes", icon: <Users className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo y Stock",
    items: [
      { key: "products", label: "Productos", icon: <Package className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
      { key: "inventory", label: "Inventario", icon: <Warehouse className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
      { key: "purchases", label: "Compras", icon: <Truck className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
      { key: "expenses", label: "Gastos", icon: <TrendingDown className="w-4 h-4" />, roles: ["ADMIN"] },
    ],
  },
  {
    id: "gestion",
    label: "Gestión Comercial",
    items: [
      { key: "promotions", label: "Promociones", icon: <Tag className="w-4 h-4" />, roles: ["ADMIN"] },
      { key: "commissions", label: "Comisiones", icon: <Coins className="w-4 h-4" />, roles: ["ADMIN"] },
      { key: "branches", label: "Sucursales", icon: <Building2 className="w-4 h-4" />, roles: ["ADMIN"] },
      { key: "print-templates", label: "Impresión", icon: <Printer className="w-4 h-4" />, roles: ["ADMIN"] },
      { key: "ecommerce", label: "E-commerce", icon: <Globe className="w-4 h-4" />, roles: ["ADMIN"] },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    items: [
      { key: "reports", label: "Reportes", icon: <BarChart3 className="w-4 h-4" />, roles: ["ADMIN"] },
      { key: "settings", label: "Configuración", icon: <Settings className="w-4 h-4" />, roles: ["ADMIN"] },
    ],
  },
];

// Vistas que se muestran como tabs horizontales en el header (las más usadas).
// El resto va al dropdown "Más" categorizado.
const FREQUENT_KEYS: ViewKey[] = ["pos", "cash", "dashboard", "sales", "products"];

export function AppShell() {
  const { data: session, status } = useSession();
  const { currentView, setView, user, store, setUserData } = useAppStore();
  const [fetchAttempted, setFetchAttempted] = useState(false);
  const pwa = usePWA();
  const { canInstall, promptInstall } = usePWAInstall();

  useEffect(() => {
    if (status !== "authenticated" || user) return;
    let cancelled = false;
    safeFetchJSON<any>("/api/me")
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.user) setUserData(data.user, data.store);
        setFetchAttempted(true);
      })
      .catch(() => {
        if (!cancelled) setFetchAttempted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, user, setUserData]);

  const loading =
    status === "loading" ||
    (status === "authenticated" && !user && !fetchAttempted);

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-700">Cargando ComerciApp...</div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <AuthScreen />;
  }

  const role = (session?.user as any)?.role || user?.role || "CAJERO";
  const storeName = store?.name || (session?.user as any)?.storeName || "Comercio";
  const storeRubro = store?.rubro || (session?.user as any)?.storeRubro || "";
  const userName = (session?.user as any)?.name || user?.name || "Usuario";

  // Categorías filtradas por rol, descartando las vacías
  const visibleCategories = NAV_CATEGORIES
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((i) => i.roles.includes(role)),
    }))
    .filter((cat) => cat.items.length > 0);

  // Item actual para mostrar el label en el header
  const currentItem = visibleCategories
    .flatMap((c) => c.items)
    .find((i) => i.key === currentView);

  // Items frecuentes para tabs horizontales (top nav). Se filtran por rol:
  // un CAJERO solo verá POS/Caja/Panel; un ADMIN verá los 5.
  const frequentItems = visibleCategories
    .flatMap((c) => c.items)
    .filter((i) => FREQUENT_KEYS.includes(i.key));

  // Categorías restantes (no frecuentes) para el dropdown "Más"
  const moreCategories = visibleCategories
    .map((c) => ({
      ...c,
      items: c.items.filter((i) => !FREQUENT_KEYS.includes(i.key)),
    }))
    .filter((c) => c.items.length > 0);

  function renderView() {
    switch (currentView) {
      case "dashboard":
        return <DashboardView />;
      case "pos":
        return <PosView />;
      case "cash":
        return <CashRegisterView />;
      case "products":
        return <ProductsView />;
      case "sales":
        return <SalesView />;
      case "invoices":
        return <InvoicesView />;
      case "refunds":
        return <RefundsView />;
      case "promotions":
        return <PromotionsView />;
      case "branches":
        return <BranchesView />;
      case "commissions":
        return <CommissionsView />;
      case "print-templates":
        return <PrintTemplatesView />;
      case "ecommerce":
        return <EcommerceView />;
      case "customers":
        return <CustomersView />;
      case "purchases":
        return <PurchasesView />;
      case "inventory":
        return <InventoryView />;
      case "expenses":
        return <ExpensesView />;
      case "reports":
        return <ReportsView />;
      case "settings":
        return <SettingsView />;
      default:
        return <PosView />;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-100/60">
      {/* Top bar con navegación integrada — estilo empresarial */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3 px-4 sm:px-6 h-14">
          {/* Logo + nombre del comercio + vista actual */}
          <div className="flex items-center gap-2.5 shrink-0 min-w-0">
            <div className="w-8 h-8 rounded-md bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Store className="w-4 h-4" />
            </div>
            <div className="hidden sm:block min-w-0 leading-tight">
              <p className="text-sm font-semibold text-slate-900 truncate">{storeName}</p>
              <p className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                <Icon name={rubroIcon(storeRubro)} className="w-3 h-3 inline" /> {currentItem?.label}
              </p>
            </div>
            <div className="hidden sm:block w-px h-8 bg-slate-200 ml-1" />
          </div>

          {/* Nav tabs horizontales — desktop (md+), estilo underline */}
          <nav className="hidden md:flex items-center gap-1 flex-1 overflow-x-auto min-w-0 h-full">
            {frequentItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={cn(
                  "relative flex items-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-colors h-full",
                  currentView === item.key
                    ? "text-slate-900"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                {item.icon}
                <span className="hidden lg:inline">{item.label}</span>
                {currentView === item.key && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-600 rounded-full" />
                )}
              </button>
            ))}
          </nav>

          {/* Acciones derecha: menús + indicadores + usuario */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Menú completo — mobile (todas las vistas categorizadas) */}
            <div className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 px-2 h-9">
                    <LayoutGrid className="w-4 h-4" />
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 max-h-[70vh] overflow-y-auto">
                  {visibleCategories.map((cat) => (
                    <Fragment key={cat.id}>
                      <DropdownMenuLabel>{cat.label}</DropdownMenuLabel>
                      {cat.items.map((item) => (
                        <DropdownMenuItem
                          key={item.key}
                          onClick={() => setView(item.key)}
                          className={cn(
                            "gap-2 cursor-pointer",
                            currentView === item.key && "bg-indigo-50 text-indigo-700 font-medium"
                          )}
                        >
                          {item.icon}
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Indicador offline */}
            {!pwa.isOnline && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                <WifiOff className="w-3 h-3 mr-1" />
                Sin conexión
              </Badge>
            )}

            {/* Ops pendientes de sync */}
            {pwa.pendingOperations > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const r = await pwa.triggerSync();
                  if (r.remaining === 0) {
                    toast.success("Sincronización completada");
                  } else {
                    toast.info(`Quedan ${r.remaining} operación(es) pendientes`);
                  }
                }}
                className="h-8 gap-1"
                title={`${pwa.pendingOperations} operación(es) pendientes de sincronizar`}
              >
                <RefreshCw className="w-3 h-3" />
                <span className="text-xs">{pwa.pendingOperations}</span>
              </Button>
            )}

            {/* Instalar PWA */}
            {canInstall && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => promptInstall()}
                className="h-8 gap-1"
                title="Instalar ComerciApp como aplicación"
              >
                <Download className="w-3 h-3" />
                <span className="hidden sm:inline text-xs">Instalar</span>
              </Button>
            )}

            {/* Actualización disponible */}
            {pwa.updateAvailable && (
              <Button
                size="sm"
                onClick={pwa.applyUpdate}
                className="h-8 gap-1 bg-indigo-600 hover:bg-indigo-700"
              >
                <CheckCircle2 className="w-3 h-3" />
                <span className="hidden sm:inline text-xs">Actualizar</span>
              </Button>
            )}

            {/* Menú de usuario */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-indigo-50 text-indigo-700 text-xs font-semibold">
                      {userName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium leading-tight">{userName}</p>
                    <p className="text-xs text-muted-foreground">{role}</p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-red-600 focus:text-red-700"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Cerrar sesión
                </DropdownMenuItem>
                {pwa.swVersion && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      ComerciApp v4.0 · SW: {pwa.swVersion}
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Contenido: sidebar (items no frecuentes) + main a ancho completo */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — desktop (md+), con scroll propio independiente del page scroll */}
        {moreCategories.length > 0 && (
          <aside className="hidden md:flex w-60 flex-col bg-slate-50 border-r border-slate-200 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto shrink-0">
            <nav className="flex-1 px-3 py-2">
              {moreCategories.map((cat) => (
                <div key={cat.id} className="mb-2">
                  <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {cat.label}
                  </p>
                  <div className="space-y-0.5">
                    {cat.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setView(item.key)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border-l-2 -ml-px",
                          currentView === item.key
                            ? "bg-white text-slate-900 border-indigo-600 shadow-sm"
                            : "text-slate-600 border-transparent hover:bg-slate-100/70 hover:text-slate-900"
                        )}
                      >
                        {item.icon}
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 lg:p-6 overflow-y-auto">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
