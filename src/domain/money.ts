// Money is integer cents; discounts are integer basis points (1 bp = 0.01%).
// Floats appear only in display formatting.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}

/** Formats a fraction (0.333…) as a percentage with a fixed number of decimals ("33.3%"). */
export function formatPercent(fraction: number, decimals: number): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Formats basis points as a percentage with up to 2 decimals (1500 → "15%", 1501 → "15.01%"). */
export function formatBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** Applies a discount to an amount, rounding half up to the nearest cent. */
export function applyDiscount(cents: number, discountBps: number): number {
  return Math.round((cents * (10_000 - discountBps)) / 10_000);
}
