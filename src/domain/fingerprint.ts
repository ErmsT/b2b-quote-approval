import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { CommercialTerms } from "./calc.js";

/**
 * Deterministic SHA-256 of the normalized commercial terms.
 * Item order does not matter; quote name and notes are not part of the terms.
 */
export function termsFingerprint(terms: CommercialTerms): string {
  const items = terms.items
    .map((i) => JSON.stringify([i.description.trim(), i.quantity, i.unitPriceCents, i.unitCostCents]))
    .sort();
  const normalized = JSON.stringify({ v: 1, discountBps: terms.discountBps, items });
  return bytesToHex(sha256(utf8ToBytes(normalized)));
}
