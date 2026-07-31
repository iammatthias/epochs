import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COUNT, DEFAULT_LABELS, compute } from "../src/epochs";
import { fetchHead, resetEndpoint, currentEndpoint } from "../src/chain";
import { getReading, resetState } from "../src/state";

const LABELS_HEX = readFileSync(
  join(import.meta.dir, "testdata", "getEpochLabels.hex"),
  "utf8",
).trim();

/** Encodes twelve values as a uint256[12] return. */
function encodeEpochs(values: readonly number[]): string {
  return (
    "0x" + values.map((v) => v.toString(16).padStart(64, "0")).join("")
  );
}

interface StubOptions {
  /** Per-URL behaviour; a URL absent from the map fails to connect. */
  urls: Record<string, "ok" | "http500" | "rpcError" | "partial" | "notArray">;
  block: number;
  /** Epochs to return; defaults to the ones matching `block`. */
  epochs?: number[];
  /** Reverse the response array to prove id-matching, not position-matching. */
  shuffle?: boolean;
}

interface Stub {
  calls: { url: string; methods: string[] }[];
  restore: () => void;
}

function stubFetch(opts: StubOptions): Stub {
  const original = globalThis.fetch;
  const calls: { url: string; methods: string[] }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const batch = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params?: unknown[];
    }[];
    calls.push({ url, methods: batch.map((b) => b.method) });

    const mode = opts.urls[url];
    if (!mode) throw new TypeError(`fetch failed: ${url}`);
    if (mode === "http500") return new Response("nope", { status: 500 });
    if (mode === "notArray") return new Response(JSON.stringify({ ok: true }));

    const epochs = opts.epochs ?? compute(opts.block);
    let responses = batch.map((req) => {
      if (mode === "rpcError") {
        return { id: req.id, error: { code: -32000, message: "boom" } };
      }
      if (req.method === "eth_blockNumber") {
        return { id: req.id, result: "0x" + opts.block.toString(16) };
      }
      // Distinguish the two eth_call sub-requests by their selector.
      const data = String(
        (req.params?.[0] as { data?: string } | undefined)?.data ?? "",
      );
      if (data.startsWith("0x32e394e0")) {
        return { id: req.id, result: LABELS_HEX };
      }
      return { id: req.id, result: encodeEpochs(epochs) };
    });

    if (mode === "partial") responses = responses.slice(0, 1);
    if (opts.shuffle) responses = responses.slice().reverse();

    return new Response(JSON.stringify(responses));
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const GOOD = "https://good.test";
const BAD = "https://bad.test";

let stub: Stub | null = null;

beforeEach(() => {
  resetEndpoint();
  resetState();
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("fetchHead", () => {
  it("gets the height and the epochs in a single round trip", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 25_648_419 });

    const head = await fetchHead([GOOD], false);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.methods).toEqual(["eth_blockNumber", "eth_call"]);
    expect(head.block).toBe(25_648_419);
    expect(head.epochs).toEqual(compute(25_648_419));
  });

  it("matches results by id, not by position in the response array", async () => {
    stub = stubFetch({
      urls: { [GOOD]: "ok" },
      block: 25_648_419,
      shuffle: true,
    });

    const head = await fetchHead([GOOD], false);

    expect(head.block).toBe(25_648_419);
    expect(head.epochs).toEqual(compute(25_648_419));
  });

  it("recomputes epochs when the provider answers one block apart", async () => {
    // The height says one block; the eth_call returns the neighbour's epochs.
    // The page must never show a block whose epochs belong to another.
    stub = stubFetch({
      urls: { [GOOD]: "ok" },
      block: 25_648_419,
      epochs: compute(25_648_420),
    });

    const head = await fetchHead([GOOD], false);

    expect(head.epochs).toEqual(compute(25_648_419));
  });

  it("reads the epoch names when asked", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 1 });

    const head = await fetchHead([GOOD], true);

    expect(stub.calls[0]!.methods).toHaveLength(3);
    expect(head.labels).toEqual([...DEFAULT_LABELS]);
  });

  it("keeps a good reading when only the labels fail to decode", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { id: number }[];
      return new Response(
        JSON.stringify(
          batch.map((req, i) => ({
            id: req.id,
            result:
              i === 0
                ? "0x64"
                : i === 1
                  ? encodeEpochs(compute(100))
                  : "0xdeadbeef", // labels: garbage
          })),
        ),
      );
    }) as typeof fetch;

    const head = await fetchHead([GOOD], true);
    globalThis.fetch = original;

    expect(head.block).toBe(100);
    expect(head.epochs).toEqual(compute(100));
    expect(head.labels).toBeUndefined();
  });
});

describe("failover", () => {
  it("moves past an endpoint that cannot connect", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 500 });

    const head = await fetchHead([BAD, GOOD], false);

    expect(head.endpoint).toBe(GOOD);
    expect(stub.calls.map((c) => c.url)).toEqual([BAD, GOOD]);
  });

  it.each([
    ["an HTTP error", "http500"],
    ["a JSON-RPC error", "rpcError"],
    ["a dropped sub-request", "partial"],
    ["a non-array response", "notArray"],
  ] as const)("moves past %s", async (_name, mode) => {
    stub = stubFetch({ urls: { [BAD]: mode, [GOOD]: "ok" }, block: 7 });

    const head = await fetchHead([BAD, GOOD], false);

    expect(head.endpoint).toBe(GOOD);
  });

  it("throws when every endpoint fails", async () => {
    stub = stubFetch({ urls: {}, block: 1 });
    await expect(fetchHead([BAD, GOOD], false)).rejects.toThrow();
  });

  it("sticks with the endpoint that answered instead of retrying a dead first choice", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 1000 });

    await fetchHead([BAD, GOOD], false);
    await fetchHead([BAD, GOOD], false);
    await fetchHead([BAD, GOOD], false);

    // BAD is attempted once, on the first call only.
    expect(stub.calls.filter((c) => c.url === BAD)).toHaveLength(1);
    expect(stub.calls.filter((c) => c.url === GOOD)).toHaveLength(3);
    expect(currentEndpoint()).toBe(GOOD);
  });
});

describe("state", () => {
  it("serves the memo without touching the network inside the fresh window", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 42 });

    const first = await getReading([GOOD]);
    const second = await getReading([GOOD]);

    expect(first.reading?.block).toBe(42);
    expect(second.reading?.block).toBe(42);
    expect(stub.calls).toHaveLength(1);
  });

  it("coalesces a burst of concurrent requests onto one upstream call", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 99 });

    const readings = await Promise.all(
      Array.from({ length: 25 }, () => getReading([GOOD])),
    );

    expect(stub.calls).toHaveLength(1);
    for (const r of readings) expect(r.reading?.block).toBe(99);
  });

  it("asks for the epoch names once, then stops paying for them", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 1 });

    await getReading([GOOD], 0); // freshMs 0 forces a refresh every call
    await getReading([GOOD], 0);
    await getReading([GOOD], 0);

    expect(stub.calls[0]!.methods).toHaveLength(3); // with labels
    expect(stub.calls[1]!.methods).toHaveLength(2); // without
    expect(stub.calls[2]!.methods).toHaveLength(2);
  });

  it("keeps serving the last reading when the chain goes away, marked not live", async () => {
    stub = stubFetch({ urls: { [GOOD]: "ok" }, block: 314 });
    const ok = await getReading([GOOD], 0);
    expect(ok.reading?.live).toBe(true);
    stub.restore();

    stub = stubFetch({ urls: {}, block: 0 }); // every endpoint now fails
    const stale = await getReading([GOOD], 0);

    expect(stale.reading?.block).toBe(314);
    expect(stale.reading?.live).toBe(false);
    expect(stale.error).toBeTruthy();
  });

  it("returns no reading at all when a cold isolate cannot reach the chain", async () => {
    stub = stubFetch({ urls: {}, block: 0 });

    const { reading, error } = await getReading([GOOD], 0);

    expect(reading).toBeNull();
    expect(error).toBeTruthy();
  });

  it("falls back to the built-in labels before the contract has been read", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { id: number }[];
      return new Response(
        JSON.stringify(
          batch.map((req, i) => ({
            id: req.id,
            result:
              i === 0
                ? "0x1"
                : i === 1
                  ? encodeEpochs(compute(1))
                  : "0xdeadbeef",
          })),
        ),
      );
    }) as typeof fetch;

    const { reading } = await getReading([GOOD], 0);
    globalThis.fetch = original;

    expect(reading?.labels).toEqual([...DEFAULT_LABELS]);
    expect(reading?.labels).toHaveLength(COUNT);
  });
});
