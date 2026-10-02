import { describe, expect, it } from "vitest";
import {
  centsToInput,
  computeDocument,
  computeLine,
  divRound,
  formatMoney,
  parseMoney,
  toHundredths,
} from "@/lib/money";

describe("divRound", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(7, 3)).toBe(2);
    expect(divRound(-7, 3)).toBe(-2);
  });
});

describe("toHundredths", () => {
  it("parses without float error", () => {
    expect(toHundredths("2.5")).toBe(250);
    expect(toHundredths(0.1 + 0.2)).toBe(30);
    expect(toHundredths("1.005")).toBe(101);
    expect(toHundredths("3")).toBe(300);
    expect(toHundredths({ toString: () => "12.34" })).toBe(1234);
  });
  it("rejects garbage", () => {
    expect(() => toHundredths("abc")).toThrow();
  });
});

describe("computeLine", () => {
  it("multiplies quantity by unit price in integer math", () => {
    expect(computeLine({ quantity: "2.5", unitPriceCents: 1999 }).netCents).toBe(4998); // 4997.5 → 4998
    expect(computeLine({ quantity: 3, unitPriceCents: 3333 }).netCents).toBe(9999);
  });
  it("applies percent and fixed discounts, never below zero", () => {
    expect(computeLine({ quantity: 1, unitPriceCents: 10000, discountType: "PERCENT", discountValue: 1500 }).netCents).toBe(8500);
    expect(computeLine({ quantity: 1, unitPriceCents: 10000, discountType: "FIXED", discountValue: 2500 }).netCents).toBe(7500);
    expect(computeLine({ quantity: 1, unitPriceCents: 1000, discountType: "FIXED", discountValue: 99999 }).netCents).toBe(0);
  });
  it("computes cost", () => {
    expect(computeLine({ quantity: 2, unitPriceCents: 1000, unitCostCents: 400 }).costCents).toBe(800);
  });
});

describe("computeDocument", () => {
  const lines = [
    { quantity: 1, unitPriceCents: 100000, taxable: true }, // equipment
    { quantity: 4, unitPriceCents: 12500, taxable: false }, // labor, non-taxable
  ];

  it("computes subtotal, tax, total, deposit and balance", () => {
    const t = computeDocument({
      lines,
      taxRateBp: 825,
      depositType: "PERCENT",
      depositValue: 5000,
      amountPaidCents: 20000,
    });
    expect(t.subtotalCents).toBe(150000);
    expect(t.taxableCents).toBe(100000);
    expect(t.taxCents).toBe(8250);
    expect(t.totalCents).toBe(158250);
    expect(t.depositCents).toBe(79125);
    expect(t.balanceCents).toBe(138250);
  });

  it("allocates a global discount proportionally to taxable lines", () => {
    const t = computeDocument({ lines, taxRateBp: 1000, discountType: "PERCENT", discountValue: 1000 });
    expect(t.discountCents).toBe(15000);
    // taxable share of discount = 15000 * 100000/150000 = 10000
    expect(t.taxableCents).toBe(90000);
    expect(t.taxCents).toBe(9000);
    expect(t.totalCents).toBe(150000 - 15000 + 9000);
  });

  it("caps fixed document discount at the subtotal", () => {
    const t = computeDocument({ lines, taxRateBp: 0, discountType: "FIXED", discountValue: 9_999_999 });
    expect(t.totalCents).toBe(0);
    expect(t.discountCents).toBe(150000);
  });

  it("never lets deposit exceed total", () => {
    const t = computeDocument({ lines, taxRateBp: 0, depositType: "FIXED", depositValue: 9_999_999 });
    expect(t.depositCents).toBe(t.totalCents);
  });

  it("handles empty documents", () => {
    const t = computeDocument({ lines: [], taxRateBp: 825 });
    expect(t.totalCents).toBe(0);
    expect(t.balanceCents).toBe(0);
  });

  it("always yields integers", () => {
    const t = computeDocument({
      lines: [{ quantity: "3.33", unitPriceCents: 1999 }, { quantity: "0.07", unitPriceCents: 12345, discountType: "PERCENT", discountValue: 333 }],
      taxRateBp: 733,
      discountType: "PERCENT",
      discountValue: 777,
    });
    for (const v of [t.subtotalCents, t.discountCents, t.taxCents, t.totalCents]) expect(Number.isInteger(v)).toBe(true);
    expect(t.totalCents).toBe(t.subtotalCents - t.discountCents + t.taxCents);
  });

  it("rejects out-of-range tax rates", () => {
    expect(() => computeDocument({ lines, taxRateBp: 10001 })).toThrow();
  });

  it("computes margin from costs", () => {
    const t = computeDocument({ lines: [{ quantity: 2, unitPriceCents: 5000, unitCostCents: 3000 }], taxRateBp: 0 });
    expect(t.marginCents).toBe(4000);
  });
});

describe("formatting", () => {
  it("formats and parses", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-500)).toBe("-$5.00");
    expect(parseMoney("$1,234.5")).toBe(123450);
    expect(parseMoney("0.07")).toBe(7);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(centsToInput(123450)).toBe("1234.50");
  });
});
