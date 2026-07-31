import { DEFAULT_LABELS, newReading, type Reading } from "./epochs";
import { currentEndpoint, fetchHead } from "./chain";

/**
 * How long a reading is served without going back to the chain. One block time:
 * the page cannot be fresher than this and there is no value in asking faster.
 */
export const FRESH_MS = 12_000;

/**
 * Isolate-local state. There is deliberately no database and no KV binding:
 * every value on the page is a pure function of the block height, so the only
 * thing worth keeping is the last height we were told, and the only thing that
 * costs is the round trip to fetch it.
 *
 * A cold isolate pays one RPC call. A warm one serves from here.
 */
let cached: Reading | null = null;
let cachedAt = 0;
let haveLabels = false;
let lastError: string | null = null;

/**
 * The in-flight refresh, if any. Without this a burst of concurrent requests
 * into one isolate would each start their own RPC call; with it they all await
 * the same one. This is the difference between a spike costing one upstream
 * call per block and one per visitor.
 */
let inFlight: Promise<void> | null = null;

export interface Snapshot {
  /** null only on a cold isolate whose first RPC call failed. */
  reading: Reading | null;
  /** The most recent failure, or null if the last refresh succeeded. */
  error: string | null;
  /** Which RPC endpoint answered, empty before the first success. */
  endpoint: string;
}

/** Drops all memoised state. Tests use this for a clean slate. */
export function resetState(): void {
  cached = null;
  cachedAt = 0;
  haveLabels = false;
  lastError = null;
  inFlight = null;
}

/**
 * The current reading, refreshing from the chain when the memo has aged out.
 *
 * On a refresh failure the last good reading is still returned, marked
 * `live: false` — the same thing the original did when its provider dropped:
 * keep showing the last height you knew rather than blanking the page. Only a
 * cold isolate that has never succeeded returns null, which renders the
 * original's "Loading" state.
 */
export async function getReading(
  urls: readonly string[],
  freshMs: number = FRESH_MS,
): Promise<Snapshot> {
  if (cached && Date.now() - cachedAt < freshMs) {
    return { reading: cached, error: lastError, endpoint: currentEndpoint() };
  }

  // Coalesce concurrent refreshes onto one upstream call.
  if (!inFlight) {
    inFlight = refresh(urls).finally(() => {
      inFlight = null;
    });
  }
  await inFlight;

  return { reading: cached, error: lastError, endpoint: currentEndpoint() };
}

/**
 * Pulls the head block and its epochs in a single batched round trip.
 *
 * The epoch names ride along only until they have been read once. They are
 * owner-settable but in practice fixed, and asking for them every refresh would
 * add a third of the payload forever for data that has never changed. A new
 * isolate re-reads them.
 */
async function refresh(urls: readonly string[]): Promise<void> {
  try {
    const head = await fetchHead(urls, !haveLabels);

    let labels = cached?.labels ?? [...DEFAULT_LABELS];
    if (head.labels) {
      labels = head.labels;
      haveLabels = true;
    }

    cached = newReading(head.block, head.epochs, labels, true);
    cachedAt = Date.now();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ msg: "refresh failed", err: lastError }));
    // Demote the stale reading rather than discarding it, so the page can say
    // the number is not the head instead of presenting it as if it were.
    if (cached) cached = { ...cached, live: false };
  }
}
