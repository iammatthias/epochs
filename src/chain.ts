import { COUNT, compute } from "./epochs";

/**
 * The canonical Epochs deployment on Ethereum mainnet, controlled by
 * AspectsDAO. Its interface is tiny and entirely read-only:
 *
 *     currentEpochs()            view  -> uint256[12]
 *     getEpochs(uint256)         pure  -> uint256[12]
 *     getEpochLabels()           view  -> string[12]
 *     owner()                    view  -> address
 *
 * The address this rebuild was originally pointed at — 0xc522…1606 — is the
 * deployer wallet, not the contract: its nonce-0 CREATE produced this address.
 */
export const CONTRACT = "0xde9f0c369Ef3692B4bF9D40803A9029a3722B9c4";

/** Function selectors: the first four bytes of keccak256 over each signature. */
const SEL_GET_EPOCHS = "f665a206"; // getEpochs(uint256)
const SEL_CURRENT_EPOCHS = "728b15b6"; // currentEpochs() — reads block.number itself
const SEL_GET_EPOCH_LABELS = "32e394e0"; // getEpochLabels()

/**
 * Public mainnet JSON-RPC endpoints, tried in order. Set EPOCHS_RPC_URL
 * (comma-separated) to point at your own provider — public endpoints
 * rate-limit and come and go.
 */
export const DEFAULT_RPCS: readonly string[] = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.rpc.blxrbdn.com",
  "https://1rpc.io/eth",
  "https://eth.drpc.org",
];

/**
 * Bounds a single endpoint attempt. Deliberately shorter than a whole refresh:
 * with failover, a hung endpoint would otherwise consume the entire budget
 * before the next one is tried.
 */
const ATTEMPT_TIMEOUT_MS = 4_000;

/**
 * How long the client sticks with a working endpoint before trying the
 * configured order from the top again. Without stickiness an unreachable first
 * choice burns a failed attempt on every refresh; without the recheck it would
 * never notice that choice coming back.
 */
const ENDPOINT_RECHECK_MS = 10 * 60_000;

/**
 * The sticky endpoint choice. Module scope means it is per-isolate, which is
 * the right granularity on Workers: an isolate serving a stream of requests
 * reuses the endpoint that answered, and a new isolate starts from the
 * configured order.
 */
let pinnedUrl = "";
let pinnedAt = 0;

/** The endpoint currently in use, empty before the first successful call. */
export function currentEndpoint(): string {
  return pinnedUrl;
}

/** Resets the sticky choice. Tests use this to get a clean slate. */
export function resetEndpoint(): void {
  pinnedUrl = "";
  pinnedAt = 0;
}

/** One consistent look at the chain. */
export interface Head {
  block: number;
  epochs: number[];
  labels?: string[];
  endpoint: string;
}

interface BatchItem {
  method: string;
  params?: unknown[];
}

/**
 * Fetches the current block and its epochs in a single JSON-RPC batch,
 * optionally including the epoch names.
 *
 * Batching matters: the naive form is three sequential round trips (height,
 * then epochs at that height, then labels), which on a public endpoint is most
 * of a second of latency for data that could have arrived together.
 *
 * currentEpochs() is used rather than getEpochs(n) precisely because it reads
 * block.number on-chain, so it needs no argument and can ride along in the same
 * batch as eth_blockNumber instead of waiting for its answer.
 */
export async function fetchHead(
  urls: readonly string[],
  withLabels: boolean,
): Promise<Head> {
  const items: BatchItem[] = [
    { method: "eth_blockNumber" },
    {
      method: "eth_call",
      params: [{ to: CONTRACT, data: "0x" + SEL_CURRENT_EPOCHS }, "latest"],
    },
  ];
  if (withLabels) {
    items.push({
      method: "eth_call",
      params: [{ to: CONTRACT, data: "0x" + SEL_GET_EPOCH_LABELS }, "latest"],
    });
  }

  const { results, endpoint } = await callBatch(urls, items);

  const block = parseHexQuantity(asString(results[0], "eth_blockNumber"));
  let epochs = decodeEpochs(hexToBytes(asString(results[1], "currentEpochs")));

  // eth_blockNumber and eth_call are separate sub-requests, so a provider that
  // fans them across backends — or a block landing mid-batch — can answer them
  // one height apart. The local computation is provably the same function the
  // contract runs (a test pins them together), so when they disagree,
  // recomputing from the height we are about to display keeps the page
  // self-consistent instead of showing a block whose epochs belong to its
  // neighbour.
  //
  // Logged rather than done silently: the page's whole claim is that its
  // numbers come from the contract, so the one case where they are substituted
  // should be visible instead of having to be inferred.
  const local = compute(block);
  if (!sameEpochs(local, epochs)) {
    console.log(
      JSON.stringify({
        msg: "epochs recomputed for block consistency",
        block,
        from_contract: epochs,
        displayed: local,
      }),
    );
    epochs = local;
  }

  const head: Head = { block, epochs, endpoint };

  if (withLabels) {
    try {
      head.labels = decodeLabels(
        hexToBytes(asString(results[2], "getEpochLabels")),
      );
    } catch {
      // Names change approximately never; a failure here is not worth
      // discarding a good height and epoch reading over.
    }
  }
  return head;
}

/**
 * Calls getEpochs(blockNumber) on-chain for an arbitrary height. The live page
 * does not use this — fetchHead covers the current block in one batched round
 * trip — but it is the direct expression of the contract's interface and the
 * path a test uses to check the local computation against the deployment.
 */
export async function fetchEpochsAt(
  urls: readonly string[],
  block: number,
): Promise<number[]> {
  const arg = block.toString(16).padStart(64, "0");
  const { results } = await callBatch(urls, [
    {
      method: "eth_call",
      params: [{ to: CONTRACT, data: "0x" + SEL_GET_EPOCHS + arg }, "latest"],
    },
  ]);
  return decodeEpochs(hexToBytes(asString(results[0], "getEpochs")));
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Sends items as a single JSON-RPC batch and returns their results in the order
 * given. Endpoints are tried in turn until one answers with a complete,
 * error-free batch.
 *
 * The spec does not require a server to preserve request order in the response
 * array, so results are matched by id rather than position.
 */
async function callBatch(
  urls: readonly string[],
  items: BatchItem[],
): Promise<{ results: unknown[]; endpoint: string }> {
  const batch = items.map((it, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: it.method,
    params: it.params ?? [],
  }));
  const body = JSON.stringify(batch);

  let lastErr: Error | null = null;
  for (const url of endpointOrder(urls)) {
    try {
      const raw = await post(url, body);
      const responses = JSON.parse(raw) as RpcResponse[];
      if (!Array.isArray(responses)) {
        throw new Error(`${url}: batch response was not an array`);
      }

      const out = new Array<unknown>(items.length);
      for (const resp of responses) {
        const idx = (resp.id ?? 0) - 1;
        if (idx < 0 || idx >= items.length) continue;
        if (resp.error) {
          throw new Error(
            `${url}: ${items[idx]!.method}: rpc ${resp.error.code}: ${resp.error.message}`,
          );
        }
        out[idx] = resp.result;
      }

      // A provider that silently drops a sub-request must not look like a
      // success with a zero value.
      for (let i = 0; i < out.length; i++) {
        if (out[i] === undefined || out[i] === null) {
          throw new Error(`${url}: no result for ${items[i]!.method}`);
        }
      }

      pin(url, lastErr);
      return { results: out, endpoint: url };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("no rpc endpoints configured");
}

/**
 * The endpoints to try, preferring the one that last answered. The preference
 * expires after ENDPOINT_RECHECK_MS so a configured first choice that was down
 * gets another look.
 */
function endpointOrder(urls: readonly string[]): string[] {
  let current = pinnedUrl;
  if (current && Date.now() - pinnedAt > ENDPOINT_RECHECK_MS) {
    current = "";
    pinnedUrl = "";
  }
  if (!current || current === urls[0]) return [...urls];
  return [current, ...urls.filter((u) => u !== current)];
}

/**
 * Records the endpoint that answered. A change is logged once, so an operator
 * can see which provider is actually serving the page — and, when the
 * configured first choice is skipped, why.
 */
function pin(url: string, failure: Error | null): void {
  const changed = pinnedUrl !== url;
  pinnedUrl = url;
  pinnedAt = Date.now();
  if (!changed) return;
  console.log(
    JSON.stringify({
      msg: "rpc endpoint selected",
      endpoint: url,
      ...(failure ? { after_error: failure.message } : {}),
    }),
  );
}

/** Sends one request body to url and returns the response text. */
async function post(url: string, body: string): Promise<string> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Public RPC providers drop unlabelled clients; be explicit.
      "user-agent": "epochs/1.0 (+https://github.com/iammatthias/epochs)",
    },
    body,
    // Bound each attempt so failover is not held up by one hung endpoint.
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`${url}: http ${resp.status}`);
  return await resp.text();
}

function asString(v: unknown, what: string): string {
  if (typeof v !== "string") throw new Error(`${what}: expected a hex string`);
  return v;
}

function sameEpochs(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Parses a 0x-prefixed quantity. */
export function parseHexQuantity(s: string): number {
  const v = BigInt(s.startsWith("0x") ? s : "0x" + s);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("quantity exceeds safe integer range");
  }
  return Number(v);
}

/** Decodes a 0x-prefixed hex string into bytes. */
export function hexToBytes(s: string): Uint8Array {
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  if (hex.length % 2 !== 0) throw new Error("odd-length hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("invalid hex string");
    out[i] = byte;
  }
  return out;
}

/**
 * Reads a uint256[12] return: a static type, so twelve 32-byte words with no
 * offset header.
 */
export function decodeEpochs(ret: Uint8Array): number[] {
  if (ret.length < COUNT * 32) {
    throw new Error(`getEpochs: short return (${ret.length} bytes)`);
  }
  const out: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const word = ret.subarray(i * 32, (i + 1) * 32);
    // Values are 1..11; anything wider than 8 bytes means we misread the
    // layout, so refuse it rather than silently truncating.
    for (let b = 0; b < 24; b++) {
      if (word[b] !== 0) throw new Error(`getEpochs: word ${i} overflows`);
    }
    out.push(beNumber(word.subarray(24)));
  }
  return out;
}

/** Reads a string[12] return. */
export function decodeLabels(ret: Uint8Array): string[] {
  // string[12] is a fixed-size array of a dynamic type, so the return is
  // wrapped: one offset to the array, then twelve offsets (relative to the
  // array's own start), then each string as length + bytes.
  if (ret.length < 32) throw new Error("getEpochLabels: short return");
  const base = readOffset(ret, 0, ret.length);
  const arr = ret.subarray(base);
  if (arr.length < COUNT * 32) {
    throw new Error("getEpochLabels: short offset table");
  }

  const decoder = new TextDecoder();
  const out: string[] = [];
  for (let i = 0; i < COUNT; i++) {
    const off = readOffset(arr, i * 32, arr.length);
    if (arr.length < off + 32) {
      throw new Error(`getEpochLabels: element ${i} truncated`);
    }
    const n = readOffset(arr, off, arr.length);
    const start = off + 32;
    if (start + n > arr.length) {
      throw new Error(`getEpochLabels: element ${i} overruns return data`);
    }
    out.push(decoder.decode(arr.subarray(start, start + n)));
  }
  return out;
}

/**
 * Reads the 32-byte word at pos as a length or offset, rejecting anything that
 * could not address the buffer. Bounds are enforced here so the decoders above
 * cannot be walked off the end by a hostile endpoint.
 */
function readOffset(buf: Uint8Array, pos: number, limit: number): number {
  if (pos < 0 || pos + 32 > buf.length) {
    throw new Error("out of range");
  }
  const word = buf.subarray(pos, pos + 32);
  for (let b = 0; b < 24; b++) {
    if (word[b] !== 0) throw new Error("value too large");
  }
  const v = beNumber(word.subarray(24));
  if (v > limit) throw new Error("value exceeds buffer");
  return v;
}

/** Reads up to 8 big-endian bytes as a safe integer. */
function beNumber(b: Uint8Array): number {
  let v = 0n;
  for (const c of b) v = (v << 8n) | BigInt(c);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("value exceeds safe integer range");
  }
  return Number(v);
}
