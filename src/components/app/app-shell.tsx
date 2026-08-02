"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useAppStore, ViewKey } from "@/store/app-store";
import { DashboardView } from "@/components/views/dashboard-view";
import { PosView } from "@/components/views/pos-view";
import { ProductsView } from "@/components/views/products-view";
import { SalesView } from "@/components/views/sales-view";
import { CustomersView } from "@/components/views/customers-view";
import { InventoryView } from "@/components/views/inventory-view";
import { SettingsView } from "@/components/views/settings-view";
import { AuthScreen } from "@/components/app/auth-screen";
import { Button } from "@/components/ui/button";
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
  Settings,
  LogOut,
  Store,
  Menu,
  X,
} from "lucide-react";
import { rubroIcon } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ReactNode;
  roles: string[]; // quienes pueden verlo
}

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Panel", icon: <LayoutDashboard className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
  { key: "pos", label: "Punto de Venta", icon: <ShoppingCart className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
  { key: "products", label: "Productos", icon: <Package className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
  { key: "sales", label: "Ventas", icon: <Receipt className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR", "CAJERO"] },
  { key: "customers", label: "Clientes", icon: <Users className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
  { key: "inventory", label: "Inventario", icon: <Warehouse className="w-4 h-4" />, roles: ["ADMIN", "VENDEDOR"] },
  { key: "settings", label: "Configuración", icon: <Settings className="w-4 h-4" />, roles: ["ADMIN"] },
];

export function AppShell() {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { currentView, setView, user, store, setUserData } = useAppStore();
  const [fetchAttempted, setFetchAttempted] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || user) return;
    let cancelled = false;
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.user) setUserData(data.user, data.store);
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
        <div className="animate-pulse text-emerald-600">Cargando ComerciApp...</div>
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

  const items = NAV_ITEMS.filter((i) => i.roles.includes(role));
  const currentItem = items.find((i) => i.key === currentView) || items[0];

  function renderView() {
    switch (currentView) {
      case "dashboard":
        return <DashboardView />;
      case "pos":
        return <PosView />;
      case "products":
        return <ProductsView />;
      case "sales":
        return <SalesView />;
      case "customers":
        return <CustomersView />;
      case "inventory":
        return <InventoryView />;
      case "settings":
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-emerald-100 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                <Store className="w-5 h-5" />
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold leading-tight">{storeName}</p>
                <p className="text-xs text-muted-foreground">
                  {rubroIcon(storeRubro)} {currentItem?.label}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs">
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar - desktop */}
        <aside className="hidden lg:flex w-60 flex-col bg-white border-r border-emerald-100">
          <nav className="flex-1 p-3 space-y-1">
            {items.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  currentView === item.key
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-emerald-100 text-xs text-muted-foreground">
            <p>ComerciApp v1.0</p>
            <p>MVP para tiendas de barrio</p>
          </div>
        </aside>

        {/* Sidebar - mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={cn(
            "fixed top-0 left-0 bottom-0 w-64 bg-white border-r border-emerald-100 z-50 lg:hidden transform transition-transform",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="p-4 border-b border-emerald-100 flex items-center justify-between">
            <p className="font-semibold">{storeName}</p>
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </Button>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {items.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setView(item.key);
                  setSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  currentView === item.key
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 lg:p-6">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
