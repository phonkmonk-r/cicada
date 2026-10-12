import { parseUnits } from "viem";

/**
 * A typed decimal amount in base units. Refuses more fraction digits than `decimals`, which viem's parseUnits would
 * round (possibly up, spending more than was typed).
 */
export function parseAmount(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!/^\d*\.?\d+$/.test(trimmed)) throw new Error("Enter an amount");
  if ((trimmed.split(".")[1] ?? "").length > decimals) throw new Error(`Enter at most ${decimals} decimal places`);
  return parseUnits(trimmed, decimals);
}
