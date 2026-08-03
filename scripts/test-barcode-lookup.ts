// Script de prueba para la lógica de construcción de nombre.
// Ejecutar: npx tsx /home/z/my-project/scripts/test-barcode-lookup.ts

import {
  lookupProductByBarcode,
} from "../src/lib/barcode-lookup";

const TEST_CODES = [
  // Playadito 500g (Argentina)
  "7793704000911",
  // Yerba Amanda
  "7792710000090",
  // Coca-Cola 330ml (Europe)
  "5449000000996",
  // Nutella (tiene alérgenos: milk, nuts, soybeans)
  "3017620422003",
  // Nescau 2.0 400g
  "7891000053508",
  // Código inexistente para probar el fallback
  "0000000000000",
];

async function main() {
  for (const code of TEST_CODES) {
    console.log("\n" + "=".repeat(70));
    console.log(`Código: ${code}`);
    console.log("=".repeat(70));
    const result = await lookupProductByBarcode(code);
    if (result.found) {
      console.log(`Fuente:     ${result.source}`);
      console.log(`Nombre:     ${result.name}`);
      console.log(`Marca:      ${result.brand || "—"}`);
      console.log(`Desc:       ${result.description || "—"}`);
      console.log(`Categoría:  ${result.category || "—"}`);
      console.log(`Cantidad:   ${result.quantity || "—"}`);
      console.log(`Imagen:     ${result.imageUrl ? "sí" : "no"}`);
      console.log(`Ingredient: ${result.ingredients ? result.ingredients.substring(0, 80) + (result.ingredients.length > 80 ? "..." : "") : "—"}`);
      console.log(`Etiquetas:  ${result.labels && result.labels.length ? result.labels.join(", ") : "—"}`);
      console.log(`Alérgenos:  ${result.allergens && result.allergens.length ? result.allergens.join(", ") : "—"}`);
    } else {
      console.log(`No encontrado (fuente: ${result.source})`);
    }
  }
}

main().catch(console.error);
