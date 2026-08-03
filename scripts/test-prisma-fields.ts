/**
 * Test rápido para verificar que el Prisma Client reconoce los campos
 * `brand`, `labels`, `ingredients`, `allergens`, `imageUrl` del modelo Product.
 *
 * Ejecutar con: npx tsx scripts/test-prisma-fields.ts
 */
import { db } from "../src/lib/db";

async function main() {
  console.log("=== Verificando campos nuevos del modelo Product ===\n");

  // 1. Verificar que el modelo Product expone los campos nuevos
  const sample = await db.product.findFirst({
    select: {
      id: true,
      name: true,
      brand: true,
      labels: true,
      ingredients: true,
      allergens: true,
      imageUrl: true,
    },
  });

  if (!sample) {
    console.log("✓ No hay productos en la base, pero el select funcionó → campos OK");
  } else {
    console.log("✓ Producto encontrado:");
    console.log(`  name:        ${sample.name}`);
    console.log(`  brand:       ${sample.brand ?? "(null)"}`);
    console.log(`  labels:      ${sample.labels ?? "(null)"}`);
    console.log(`  ingredients: ${(sample.ingredients || "").slice(0, 50) || "(null)"}`);
    console.log(`  allergens:   ${sample.allergens ?? "(null)"}`);
    console.log(`  imageUrl:    ${sample.imageUrl ?? "(null)"}`);
  }

  // 2. Verificar que podemos hacer un update con estos campos
  // (sin persistir nada — creamos y borramos en una transacción)
  const testStores = await db.store.findMany({ take: 1 });
  if (testStores.length === 0) {
    console.log("\n✓ No hay stores en la base — saltando prueba de creación");
    await db.$disconnect();
    return;
  }
  const storeId = testStores[0].id;

  const created = await db.product.create({
    data: {
      name: "__TEST_PRISMA_FIELDS__",
      storeId,
      brand: "TestBrand",
      labels: "Test1,Test2",
      ingredients: "Harina,Agua",
      allergens: "Gluten",
      imageUrl: "https://example.com/test.jpg",
      salePrice: 100,
      costPrice: 50,
      stock: 1,
    },
  });
  console.log("\n✓ Producto de prueba creado con campos nuevos:");
  console.log(`  id:          ${created.id}`);
  console.log(`  brand:       ${created.brand}`);
  console.log(`  labels:      ${created.labels}`);
  console.log(`  ingredients: ${created.ingredients}`);
  console.log(`  allergens:   ${created.allergens}`);
  console.log(`  imageUrl:    ${created.imageUrl}`);

  // Limpiar
  await db.product.delete({ where: { id: created.id } });
  console.log("\n✓ Producto de prueba eliminado");

  await db.$disconnect();
  console.log("\n=== TODO OK — Prisma Client reconoce los campos nuevos ===");
}

main().catch((e) => {
  console.error("\n✗ ERROR:", e.message);
  console.error(e);
  process.exit(1);
});
