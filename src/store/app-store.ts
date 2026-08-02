"use client";

import { create } from "zustand";

export type ViewKey =
  | "dashboard"
  | "pos"
  | "products"
  | "sales"
  | "customers"
  | "inventory"
  | "purchases"
  | "expenses"
  | "cash"
  | "settings";

interface AppState {
  currentView: ViewKey;
  setView: (v: ViewKey) => void;

  // Datos de tienda y usuario en caché
  user: any | null;
  store: any | null;
  setUserData: (user: any, store: any) => void;
  clear: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: "dashboard",
  setView: (v) => set({ currentView: v }),

  user: null,
  store: null,
  setUserData: (user, store) => set({ user, store }),
  clear: () => set({ user: null, store: null, currentView: "dashboard" }),
}));
