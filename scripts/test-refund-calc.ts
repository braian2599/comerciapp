/**
 * Test de regresión para lib/refund-calc.ts
 *
 * Verifica los bugs críticos corregidos en P2.2:
 *  1. isTotal ya NO es true cuando lengths coinciden pero cantidades son parciales.
 *  2. saleItemId duplicado → throw.
 *  3. saleItemId inexistente → throw.
 *  4. quantity inválida (0, negativa, NaN, string) → throw.
 *  5. quantity > original → throw.
 *  6. items no-array → throw.
 *  7. Redondeo a 2 decimales.
 *  8. Prorrateo correcto (parcial = proporción exacta).
 *  9. Devolución total explícita (items=[]) → refundTotal === sale.total.
 * 10. Snapshot inconsistente (subtotal=0 con items) → throw.
 *
 * Correr con: npx tsx scripts/test-refund-calc.ts
 */

import { calculateRefundTotals, SaleForRefund } from "../src/lib/refund-calc";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function assertThrows(fn: () => void, msg: string) {
  try {
    fn();
    console.error(`  ✗ DEBERÍA THROW: ${msg}`);
    failed++;
  } catch (e) {
    console.log(`  ✓ throws: ${msg} — ${(e as Error).message}`);
    passed++;
  }
}

// ---- Fixture: venta con 2 items, descuento, impuesto, recargo ----
const sale: SaleForRefund = {
  id: "sale-1",
  subtotal: 1000, // 2 items × $500 c/u
  discount: 100, // 10%
  tax: 189, // 21% sobre (1000-100) = 900 × 0.21 = 189
  surcharge: 108.9, // 10% sobre (900 + 189) = 1089 × 0.10 = 108.9
  total: 1197.9, // 900 + 189 + 108.9
  items: [
    {
      id: "item-A",
      productId: "prod-1",
      quantity: 10,
      unitPrice: 50,
      costPrice: 30,
      subtotal: 500,
    },
    {
      id: "item-B",
      productId: "prod-2",
      quantity: 5,
      unitPrice: 100,
      costPrice: 70,
      subtotal: 500,
    },
  ],
};

console.log("\n=== TEST 1: Devolución total explícita (items=[]) ===");
{
  const r = calculateRefundTotals(sale, []);
  assert(r.isTotal === true, "isTotal=true");
  assert(r.refundTotal === 1197.9, `refundTotal=sale.total (got ${r.refundTotal})`);
  assert(r.refundDiscount === 100, `refundDiscount=100 (got ${r.refundDiscount})`);
  assert(r.refundTax === 189, `refundTax=189 (got ${r.refundTax})`);
  assert(r.refundSurcharge === 108.9, `refundSurcharge=108.9 (got ${r.refundSurcharge})`);
  assert(r.items.length === 2, "items.length=2");
}

console.log("\n=== TEST 2: Devolución total explícita (items=undefined) ===");
{
  const r = calculateRefundTotals(sale, undefined);
  assert(r.isTotal === true, "isTotal=true");
  assert(r.refundTotal === 1197.9, "refundTotal=sale.total");
}

console.log("\n=== TEST 3: Devolución total explícita (items=null) ===");
{
  const r = calculateRefundTotals(sale, null);
  assert(r.isTotal === true, "isTotal=true");
  assert(r.refundTotal === 1197.9, "refundTotal=sale.total");
}

console.log("\n=== TEST 4 (CRÍTICO): Cantidades parciales de TODOS los items → isTotal=false ===");
{
  // BUG ANTERIOR: length=2 === sale.items.length=2 → isTotal=true (WRONG!)
  // FIX: ahora isTotal=false porque las cantidades (5,3) no son las originales (10,5)
  const r = calculateRefundTotals(sale, [
    { saleItemId: "item-A", quantity: 5 },
    { saleItemId: "item-B", quantity: 3 },
  ]);
  assert(r.isTotal === false, `isTotal=false (got ${r.isTotal}) — BUG CRÍTICO CORREGIDO`);
  // 5×50 + 3×100 = 250 + 300 = 550
  assert(r.refundSubtotal === 550, `refundSubtotal=550 (got ${r.refundSubtotal})`);
  // discount proportion = 100/1000 = 0.1; refundDiscount = 550 × 0.1 = 55
  assert(r.refundDiscount === 55, `refundDiscount=55 (got ${r.refundDiscount})`);
  // refundTaxable = 550 - 55 = 495
  // taxRate = 189/900 = 0.21; refundTax = 495 × 0.21 = 103.95
  assert(r.refundTax === 103.95, `refundTax=103.95 (got ${r.refundTax})`);
  // refundTotal = 495 + 103.95 + (495+103.95) × (108.9/1089) = 598.95 × 0.1 = 59.895
  // → 598.95 + 59.895 = 658.845 → redondeo 658.85 (puede variar por redondeo)
  // Verifiquemos que la proporción sea 55% del total: 1197.9 × 0.55 = 658.845
  assert(Math.abs(r.refundTotal - 658.85) < 0.01, `refundTotal≈658.85 (got ${r.refundTotal})`);
}

console.log("\n=== TEST 5: Cantidades totales de TODOS los items → isTotal=true ===");
{
  const r = calculateRefundTotals(sale, [
    { saleItemId: "item-A", quantity: 10 },
    { saleItemId: "item-B", quantity: 5 },
  ]);
  assert(r.isTotal === true, `isTotal=true (got ${r.isTotal})`);
  assert(r.refundTotal === 1197.9, `refundTotal=sale.total (got ${r.refundTotal})`);
}

console.log("\n=== TEST 6: Devolución parcial de un solo item ===");
{
  const r = calculateRefundTotals(sale, [{ saleItemId: "item-A", quantity: 2 }]);
  assert(r.isTotal === false, "isTotal=false");
  // 2×50 = 100; 10% discount = 10; taxable = 90; 21% tax = 18.9; surcharge = 10% × (90+18.9) = 10.89
  // total = 90 + 18.9 + 10.89 = 119.79
  assert(r.refundSubtotal === 100, `refundSubtotal=100 (got ${r.refundSubtotal})`);
  assert(r.refundDiscount === 10, `refundDiscount=10 (got ${r.refundDiscount})`);
  assert(r.refundTax === 18.9, `refundTax=18.9 (got ${r.refundTax})`);
  assert(Math.abs(r.refundTotal - 119.79) < 0.01, `refundTotal≈119.79 (got ${r.refundTotal})`);
}

console.log("\n=== TEST 7: saleItemId duplicado → throw ===");
assertThrows(
  () => calculateRefundTotals(sale, [
    { saleItemId: "item-A", quantity: 3 },
    { saleItemId: "item-A", quantity: 2 },
  ]),
  "saleItemId duplicado"
);

console.log("\n=== TEST 8: saleItemId inexistente → throw ===");
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-X", quantity: 1 }]),
  "saleItemId inexistente"
);

console.log("\n=== TEST 9: quantity inválida → throw ===");
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-A", quantity: 0 }]),
  "quantity=0"
);
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-A", quantity: -1 }]),
  "quantity=-1"
);
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-A", quantity: NaN }]),
  "quantity=NaN"
);
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-A", quantity: "abc" } as any]),
  "quantity='abc'"
);

console.log("\n=== TEST 10: quantity > original → throw ===");
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-A", quantity: 11 }]),
  "quantity=11 > original=10"
);

console.log("\n=== TEST 11: items no-array → throw ===");
assertThrows(() => calculateRefundTotals(sale, "not-array"), "items=string");
assertThrows(() => calculateRefundTotals(sale, {}), "items=object");
assertThrows(() => calculateRefundTotals(sale, 42), "items=number");

console.log("\n=== TEST 12: Snapshot inconsistente → throw ===");
assertThrows(
  () => calculateRefundTotals({ ...sale, subtotal: 0 }, []),
  "subtotal=0 con items"
);

console.log("\n=== TEST 13: Redondeo a 2 decimales ===");
{
  // Venta con importes que generan drift de redondeo
  const sale2: SaleForRefund = {
    id: "sale-2",
    subtotal: 100, // 3 items × 33.33 c/u aprox
    discount: 0,
    tax: 21,
    surcharge: 0,
    total: 121,
    items: [
      { id: "i1", productId: "p1", quantity: 3, unitPrice: 33.33, costPrice: 10, subtotal: 99.99 },
      { id: "i2", productId: "p2", quantity: 1, unitPrice: 0.01, costPrice: 0, subtotal: 0.01 },
    ],
  };
  const r = calculateRefundTotals(sale2, [{ saleItemId: "i1", quantity: 1 }]);
  // 1×33.33 = 33.33; taxRate = 21/100 = 0.21; refundTax = 33.33×0.21 = 6.9993 → 7.00
  assert(r.refundSubtotal === 33.33, `refundSubtotal=33.33 (got ${r.refundSubtotal})`);
  assert(r.refundTax === 7, `refundTax=7 redondeado (got ${r.refundTax})`);
  // Verificar que NO tenga más de 2 decimales en ningún campo
  const allAmounts = [r.refundSubtotal, r.refundDiscount, r.refundTaxable, r.refundTax, r.refundSurcharge, r.refundTotal];
  for (const a of allAmounts) {
    const decimals = (String(a).split(".")[1] || "").length;
    assert(decimals <= 2, `monto ${a} tiene ≤2 decimales (tiene ${decimals})`);
  }
}

console.log("\n=== TEST 14: Item sin saleItemId → throw ===");
assertThrows(
  () => calculateRefundTotals(sale, [{ quantity: 5 } as any]),
  "item sin saleItemId"
);

console.log("\n=== TEST 15: Item sin quantity → throw ===");
assertThrows(
  () => calculateRefundTotals(sale, [{ saleItemId: "item-A" } as any]),
  "item sin quantity"
);

console.log(`\n=== RESULTADO: ${passed} OK / ${failed} FAIL ===`);
process.exit(failed === 0 ? 0 : 1);
