import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { DEFAULT_PAYMENT_METHODS } from "@/lib/constants";

// Crea una tienda de demostración con datos precargados
export async function POST() {
  try {
    const email = "admin@demo.com";
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      // Si la tienda existe pero no tiene métodos de pago, agregarlos
      const store = await db.store.findFirst({
        where: { users: { some: { email } } },
        include: { paymentMethods: true },
      });
      if (store && store.paymentMethods.length === 0) {
        await db.paymentMethod.createMany({
          data: DEFAULT_PAYMENT_METHODS.map((m) => ({
            ...m,
            storeId: store.id,
          })),
        });
        return NextResponse.json({
          ok: true,
          message: "Métodos de pago por defecto agregados a la tienda demo existente",
          credentials: { email, password: "demo123" },
        });
      }
      return NextResponse.json({
        ok: true,
        message: "La tienda demo ya existe",
        credentials: { email, password: "demo123" },
      });
    }

    const passwordHash = await bcrypt.hash("demo123", 10);

    // Crear tienda
    const store = await db.store.create({
      data: {
        name: "Almacén Don José (Demo)",
        slug: "almacen-don-jose-demo",
        rubro: "TIENDA_BARRIO",
        currency: "ARS",
        currencySymbol: "$",
        taxEnabled: false,
        taxRate: 0,
        address: "Av. San Martín 1234",
        phone: "11-5555-5555",
        lowStockThreshold: 5,
        users: {
          create: [
            {
              email,
              passwordHash,
              name: "José (Admin Demo)",
              role: "ADMIN",
            },
            {
              email: "vendedor@demo.com",
              passwordHash: await bcrypt.hash("demo123", 10),
              name: "María (Vendedora)",
              role: "VENDEDOR",
            },
            {
              email: "cajero@demo.com",
              passwordHash: await bcrypt.hash("demo123", 10),
              name: "Pedro (Cajero)",
              role: "CAJERO",
            },
          ],
        },
        categories: {
          create: [
            { name: "Almacén" },
            { name: "Bebidas" },
            { name: "Lácteos" },
            { name: "Limpieza" },
            { name: "Panadería" },
            { name: "Golosinas" },
            { name: "Fiambres" },
            { name: "Verduras" },
          ],
        },
        paymentMethods: {
          create: DEFAULT_PAYMENT_METHODS,
        },
      },
      include: { users: true, categories: true, paymentMethods: true },
    });

    const categoryMap: Record<string, string> = {};
    for (const c of store.categories) categoryMap[c.name] = c.id;

    const adminUser = store.users.find((u) => u.role === "ADMIN")!;

    // Productos de ejemplo
    const productsData = [
      // Almacén
      { name: "Arroz 1kg", barcode: "7790000001", costPrice: 850, salePrice: 1200, stock: 25, category: "Almacén", unit: "UNIDAD" },
      { name: "Fideos 500g", barcode: "7790000002", costPrice: 700, salePrice: 950, stock: 40, category: "Almacén", unit: "UNIDAD" },
      { name: "Aceite 1L", barcode: "7790000003", costPrice: 1800, salePrice: 2400, stock: 18, category: "Almacén", unit: "UNIDAD" },
      { name: "Azúcar 1kg", barcode: "7790000004", costPrice: 900, salePrice: 1300, stock: 30, category: "Almacén", unit: "UNIDAD" },
      { name: "Harina 1kg", barcode: "7790000005", costPrice: 750, salePrice: 1100, stock: 4, category: "Almacén", unit: "UNIDAD" },
      { name: "Sal Fina 500g", barcode: "7790000006", costPrice: 300, salePrice: 500, stock: 35, category: "Almacén", unit: "UNIDAD" },
      { name: "Café 100g", barcode: "7790000007", costPrice: 1500, salePrice: 2200, stock: 12, category: "Almacén", unit: "UNIDAD" },
      { name: "Yerba 500g", barcode: "7790000008", costPrice: 1100, salePrice: 1600, stock: 22, category: "Almacén", unit: "UNIDAD" },

      // Bebidas
      { name: "Coca Cola 1.5L", barcode: "7790000010", costPrice: 1200, salePrice: 1800, stock: 28, category: "Bebidas", unit: "UNIDAD" },
      { name: "Agua 1.5L", barcode: "7790000011", costPrice: 500, salePrice: 850, stock: 45, category: "Bebidas", unit: "UNIDAD" },
      { name: "Cerveza Quilmes 1L", barcode: "7790000012", costPrice: 1300, salePrice: 1900, stock: 36, category: "Bebidas", unit: "UNIDAD" },
      { name: "Jugo 1L", barcode: "7790000013", costPrice: 900, salePrice: 1400, stock: 20, category: "Bebidas", unit: "UNIDAD" },
      { name: "Soda 1L", barcode: "7790000014", costPrice: 600, salePrice: 1000, stock: 3, category: "Bebidas", unit: "UNIDAD" },

      // Lácteos
      { name: "Leche 1L Entera", barcode: "7790000020", costPrice: 800, salePrice: 1150, stock: 30, category: "Lácteos", unit: "UNIDAD" },
      { name: "Queso Cremoso x Kg", barcode: "7790000021", costPrice: 4500, salePrice: 6500, stock: 8, category: "Lácteos", unit: "KG" },
      { name: "Manteca 100g", barcode: "7790000022", costPrice: 700, salePrice: 1050, stock: 15, category: "Lácteos", unit: "UNIDAD" },
      { name: "Yogur 1L", barcode: "7790000023", costPrice: 950, salePrice: 1350, stock: 12, category: "Lácteos", unit: "UNIDAD" },

      // Limpieza
      { name: "Lavandina 1L", barcode: "7790000030", costPrice: 350, salePrice: 600, stock: 25, category: "Limpieza", unit: "UNIDAD" },
      { name: "Detergente 500ml", barcode: "7790000031", costPrice: 600, salePrice: 950, stock: 18, category: "Limpieza", unit: "UNIDAD" },
      { name: "Jabón en Polvo 1kg", barcode: "7790000032", costPrice: 1800, salePrice: 2500, stock: 10, category: "Limpieza", unit: "UNIDAD" },

      // Panadería
      { name: "Pan Francés x Kg", barcode: "7790000040", costPrice: 1200, salePrice: 2000, stock: 15, category: "Panadería", unit: "KG" },
      { name: "Facturas surtidas x un.", barcode: "7790000041", costPrice: 120, salePrice: 250, stock: 50, category: "Panadería", unit: "UNIDAD" },
      { name: "Pan Lactal", barcode: "7790000042", costPrice: 800, salePrice: 1200, stock: 8, category: "Panadería", unit: "UNIDAD" },

      // Golosinas
      { name: "Alfajor Tatin", barcode: "7790000050", costPrice: 400, salePrice: 700, stock: 60, category: "Golosinas", unit: "UNIDAD" },
      { name: "Chicle Masticar", barcode: "7790000051", costPrice: 200, salePrice: 400, stock: 80, category: "Golosinas", unit: "UNIDAD" },
      { name: "Chocolate Aguila 100g", barcode: "7790000052", costPrice: 800, salePrice: 1300, stock: 20, category: "Golosinas", unit: "UNIDAD" },

      // Fiambres
      { name: "Jamón Cocido x Kg", barcode: "7790000060", costPrice: 5000, salePrice: 7500, stock: 6, category: "Fiambres", unit: "KG" },
      { name: "Queso de Máquina x Kg", barcode: "7790000061", costPrice: 5500, salePrice: 8000, stock: 5, category: "Fiambres", unit: "KG" },
      { name: "Salame x Kg", barcode: "7790000062", costPrice: 6000, salePrice: 8500, stock: 4, category: "Fiambres", unit: "KG" },

      // Verduras
      { name: "Papa x Kg", barcode: "7790000070", costPrice: 400, salePrice: 700, stock: 50, category: "Verduras", unit: "KG" },
      { name: "Cebolla x Kg", barcode: "7790000071", costPrice: 500, salePrice: 800, stock: 30, category: "Verduras", unit: "KG" },
      { name: "Tomate x Kg", barcode: "7790000072", costPrice: 900, salePrice: 1500, stock: 18, category: "Verduras", unit: "KG" },
      { name: "Banana x Kg", barcode: "7790000073", costPrice: 800, salePrice: 1300, stock: 22, category: "Verduras", unit: "KG" },
    ];

    for (const p of productsData) {
      await db.product.create({
        data: {
          name: p.name,
          barcode: p.barcode,
          costPrice: p.costPrice,
          salePrice: p.salePrice,
          stock: p.stock,
          minStock: 5,
          unit: p.unit,
          storeId: store.id,
          categoryId: categoryMap[p.category],
        },
      });
    }

    // Crear algunos clientes de ejemplo
    const customersData = [
      { name: "Cliente Mostrador", phone: null },
      { name: "Ana García", phone: "11-1234-5678" },
      { name: "Carlos López", phone: "11-8765-4321" },
      { name: "Marta Suárez", phone: "11-2222-3333" },
    ];
    for (const c of customersData) {
      await db.customer.create({
        data: { name: c.name, phone: c.phone, storeId: store.id },
      });
    }

    // Crear algunas ventas de los últimos 7 días
    const products = await db.product.findMany({
      where: { storeId: store.id },
    });
    const customers = await db.customer.findMany({
      where: { storeId: store.id },
    });
    const cajero = store.users.find((u) => u.role === "CAJERO")!;
    const vendedor = store.users.find((u) => u.role === "VENDEDOR")!;

    const now = new Date();
    for (let day = 6; day >= 0; day--) {
      const ventasDelDia = Math.floor(Math.random() * 5) + 2; // 2-6 ventas por día
      for (let v = 0; v < ventasDelDia; v++) {
        const itemsCount = Math.floor(Math.random() * 4) + 1;
        const items: any[] = [];
        let subtotal = 0;
        for (let i = 0; i < itemsCount; i++) {
          const prod = products[Math.floor(Math.random() * products.length)];
          const qty = Math.floor(Math.random() * 3) + 1;
          const lineSub = prod.salePrice * qty;
          items.push({
            productId: prod.id,
            quantity: qty,
            unitPrice: prod.salePrice,
            costPrice: prod.costPrice,
            subtotal: lineSub,
          });
          subtotal += lineSub;
        }
        const discount = Math.random() > 0.7 ? subtotal * 0.05 : 0;
        const method = store.paymentMethods[Math.floor(Math.random() * store.paymentMethods.length)];
        const surcharge = (subtotal - discount) * (method.surcharge / 100);
        const total = subtotal - discount + surcharge;
        const cust = Math.random() > 0.5 ? customers[Math.floor(Math.random() * customers.length)] : null;
        const usr = Math.random() > 0.5 ? cajero : vendedor;
        const saleDate = new Date(now);
        saleDate.setDate(saleDate.getDate() - day);
        saleDate.setHours(9 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60));

        const sale = await db.sale.create({
          data: {
            storeId: store.id,
            userId: usr.id,
            customerId: cust?.id,
            subtotal,
            discount,
            tax: 0,
            surcharge,
            total,
            paymentMethod: method.name,
            paymentMethodId: method.id,
            status: "COMPLETADA",
            createdAt: saleDate,
            items: { create: items },
          },
        });

        // Crear movimientos de stock por la venta
        for (const item of items) {
          await db.stockMovement.create({
            data: {
              productId: item.productId,
              storeId: store.id,
              userId: usr.id,
              type: "VENTA",
              quantity: -item.quantity,
              reason: `Venta ${sale.id.slice(-6)}`,
              createdAt: saleDate,
            },
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Tienda demo creada con datos de ejemplo",
      credentials: { email, password: "demo123" },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
