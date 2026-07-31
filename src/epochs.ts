/**
 * The Epochs system: twelve concentric epochs, each 11^n Ethereum blocks long.
 *
 * Everything here is a pure function of a block height. That is the whole
 * reason this app needs no database — given one number from the chain, every
 * value on the page is derivable.
 */

/** The number of concentric epochs the contract tracks: 11^0 through 11^11. */
export const COUNT = 12;

/**
 * The ballpark seconds-per-block the original site used to turn epoch lengths
 * into earth-time. Pre-Merge Ethereum averaged ~13.5s; the Merge fixed slots at
 * 12s, but this stays 13.5 because the printed table is part of what is being
 * reproduced, not a live measurement.
 */
export const BLOCK_TIME = 13.5;

/**
 * The twelve epoch names as set on mainnet. The contract exposes
 * getEpochLabels() and the owner can change them, so these are only the
 * fallback for a cold start with no RPC — the live names win.
 */
export const DEFAULT_LABELS: readonly string[] = [
  "Block",
  "Form",
  "Structure",
  "Bloom",
  "Episode",
  "Phase",
  "Season",
  "Revolution",
  "Aepoch",
  "Aera",
  "Arche",
  "Aeon",
];

/**
 * 11^i for i in [0,12). 11^11 is 285,311,670,611 — comfortably inside
 * Number.MAX_SAFE_INTEGER, so the whole ladder is exact integer arithmetic
 * without BigInt.
 */
export const POW11: readonly number[] = (() => {
  const p: number[] = [1];
  for (let i = 1; i < COUNT; i++) p.push(p[i - 1]! * 11);
  return p;
})();

/**
 * The twelve epoch values for a block, mirroring the contract's
 * getEpochs(uint256) exactly:
 *
 *     epochs[i] = ((blockNumber / 11**i) % 11) + 1
 *
 * Every value is 1-indexed, so each epoch cycles 1..11. The app reads the live
 * values from the contract and uses this for the milestone table and as the
 * consistency guard; a test pins the two together against captured returns.
 */
export function compute(block: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push((Math.floor(block / POW11[i]!) % 11) + 1);
  }
  return out;
}

/** One epoch name paired with its current value and ladder index. */
export interface LabelledEpoch {
  label: string;
  value: number;
  index: number;
}

/** One rendered moment: a block height and its epochs, carrying the labels. */
export interface Reading {
  block: number;
  epochs: number[];
  labels: string[];
  /** false when the RPC failed and this is the last value we knew. */
  live: boolean;
  /** Aeon first, matching the diagram's reversed row order. */
  rows: LabelledEpoch[];
}

export function newReading(
  block: number,
  epochs: number[],
  labels: readonly string[],
  live: boolean,
): Reading {
  const rows: LabelledEpoch[] = [];
  // The diagram draws Object.values(epochs).reverse() — Aeon at the top,
  // Block at the bottom.
  for (let i = COUNT - 1; i >= 0; i--) {
    rows.push({ label: labels[i] ?? "", value: epochs[i] ?? 0, index: i });
  }
  return { block, epochs, labels: [...labels], live, rows };
}

/** The epoch value at one index; the page asks for specific rungs by position. */
export function at(r: Reading, i: number): number {
  return i < 0 || i >= COUNT ? 0 : (r.epochs[i] ?? 0);
}

/** The epoch name at one index. */
export function labelAt(r: Reading, i: number): string {
  return i < 0 || i >= COUNT ? "" : (r.labels[i] ?? "");
}

/** One line of the "The System" table. */
export interface SystemRow {
  label: string;
  prevLabel: string;
  exp: number;
  blocks: number;
  time: string;
}

/**
 * The original's derivation: each epoch is eleven of the one below it, and its
 * earth-time is 11^n blocks at BLOCK_TIME seconds.
 */
export function systemTable(labels: readonly string[]): SystemRow[] {
  const rows: SystemRow[] = [];
  for (let i = 0; i < COUNT; i++) {
    const blocks = POW11[i]!;
    if (i === 0) {
      // The base unit is stated, not derived.
      rows.push({
        label: labels[i] ?? "",
        prevLabel: "",
        exp: i,
        blocks,
        time: `${BLOCK_TIME} seconds`,
      });
      continue;
    }
    rows.push({
      label: labels[i] ?? "",
      prevLabel: `11 ${labels[i - 1] ?? ""}s`,
      exp: i,
      blocks,
      time: humanDuration(blocks),
    });
  }
  return rows;
}

/**
 * How long n blocks take in earth-time, reproducing the original's date-fns
 * pipeline:
 *
 *     formatDuration(intervalToDuration({start: 0, end: 1000 * n * 13.5}),
 *                    {format: ["years","months","weeks","days","hours","minutes"]})
 *
 * intervalToDuration is calendar-aware and measures from the Unix epoch, so
 * "1 year" here means the real 1970→1971, not 365 days. It never emits a weeks
 * field, so listing weeks in the format was a no-op — years, months, days,
 * hours, minutes is the effective set. Zero components are dropped.
 */
export function humanDuration(blocks: number): string {
  // n * 13.5 seconds in milliseconds — exact, because 13.5s is 13500ms.
  const ms = blocks * 13500;

  let start = new Date(0);
  const end = new Date(ms);

  const years = fullYears(start, end);
  start = addYears(start, years);
  const months = fullMonths(start, end);
  start = addMonths(start, months);

  let rest = end.getTime() - start.getTime();
  const days = Math.floor(rest / 86_400_000);
  rest -= days * 86_400_000;
  const hours = Math.floor(rest / 3_600_000);
  rest -= hours * 3_600_000;
  const minutes = Math.floor(rest / 60_000);

  const parts: string[] = [];
  for (const [n, name] of [
    [years, "year"],
    [months, "month"],
    [days, "day"],
    [hours, "hour"],
    [minutes, "minute"],
  ] as const) {
    if (n === 0) continue; // date-fns formatDuration omits zero components
    parts.push(n === 1 ? `1 ${name}` : `${n} ${name}s`);
  }
  return parts.length === 0 ? "0 minutes" : parts.join(" ");
}

/**
 * Whole calendar years from a to b (date-fns differenceInYears): the count of
 * times a's anniversary has passed. JS Date normalises month/day overflow the
 * same way Go's AddDate does, so this matches the Go implementation exactly.
 */
function fullYears(a: Date, b: Date): number {
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (y > 0 && addYears(a, y).getTime() > b.getTime()) y--;
  return y;
}

/** Whole calendar months from a to b (differenceInMonths). */
function fullMonths(a: Date, b: Date): number {
  let m =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    b.getUTCMonth() -
    a.getUTCMonth();
  if (m > 0 && addMonths(a, m).getTime() > b.getTime()) m--;
  return m;
}

function addYears(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + n);
  return out;
}

/** An integer the way toLocaleString("en") renders it. */
export function commas(n: number): string {
  return n.toLocaleString("en-US");
}
