import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COUNT,
  DEFAULT_LABELS,
  POW11,
  commas,
  compute,
  humanDuration,
  systemTable,
} from "../src/epochs";
import { decodeEpochs, decodeLabels, hexToBytes } from "../src/chain";

function fixture(name: string): Uint8Array {
  const raw = readFileSync(join(import.meta.dir, "testdata", name), "utf8");
  return hexToBytes(raw.trim());
}

/**
 * The milestone rows as the original site baked them, taken from the
 * __NEXT_DATA__ payload of the 2022-12-08 Wayback capture. The epoch values
 * were computed by the deployed contract, so reproducing all twenty of them is
 * a direct check that compute() matches getEpochs — no network needed.
 */
const ARCHIVED: readonly [number, string, number[]][] = [
  [0, "Genesis", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
  [46147, "First transaction", [3, 5, 8, 2, 4, 1, 1, 1, 1, 1, 1, 1]],
  [3914495, "CryptoPunks contract deployed", [3, 3, 1, 5, 4, 3, 3, 1, 1, 1, 1, 1]],
  [10629366, "Start of Season 7", [1, 1, 1, 1, 1, 1, 7, 1, 1, 1, 1, 1]],
  [11341538, "Chromie Squiggle#0 Minted", [11, 8, 1, 8, 5, 5, 7, 1, 1, 1, 1, 1]],
  [11565020, "Zora Deployed", [6, 8, 11, 10, 9, 6, 7, 1, 1, 1, 1, 1]],
  [11694715, "thesarahshow.eth mints FNDv2#1", [11, 6, 5, 9, 7, 7, 7, 1, 1, 1, 1, 1]],
  [11748899, "MikeDem loses souljaboy.eth", [9, 4, 2, 6, 11, 7, 7, 1, 1, 1, 1, 1]],
  [12014171, "Sale of Punk#7804", [5, 8, 5, 7, 7, 9, 7, 1, 1, 1, 1, 1]],
  [12027953, "Sale of Everydays", [4, 7, 9, 6, 8, 9, 7, 1, 1, 1, 1, 1]],
  [12061284, "FWB Pro Deployed", [5, 1, 10, 9, 10, 9, 7, 1, 1, 1, 1, 1]],
  [12108534, "x*y=k Minted", [10, 6, 4, 1, 3, 10, 7, 1, 1, 1, 1, 1]],
  [12272493, "Solvency Deployed", [3, 7, 6, 3, 3, 11, 7, 1, 1, 1, 1, 1]],
  [12372205, "Zora Auction House Deployed", [11, 7, 5, 1, 10, 11, 7, 1, 1, 1, 1, 1]],
  [12376091, "PartyDAO Crowdfund Deployed", [3, 9, 4, 4, 10, 11, 7, 1, 1, 1, 1, 1]],
  [12400927, "Start of Season 8", [1, 1, 1, 1, 1, 1, 8, 1, 1, 1, 1, 1]],
  [12995606, "Punk 3269 bought by @houseofhalle", [9, 8, 9, 7, 8, 4, 8, 1, 1, 1, 1, 1]],
  [13291730, "10.3 ETH bid for Latashá's glo.up remix", [2, 1, 4, 10, 6, 6, 8, 1, 1, 1, 1, 1]],
  [14172488, "Start of Season 9", [1, 1, 1, 1, 1, 1, 9, 1, 1, 1, 1, 1]],
  [19487171, "Start of Revolution 2", [1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1]],
];

describe("compute", () => {
  it("reproduces every epoch value the deployed contract baked in 2022", () => {
    for (const [block, label, want] of ARCHIVED) {
      expect(compute(block), `${label} @ ${block}`).toEqual(want);
    }
  });

  it("matches a return captured from the contract at the Merge block", () => {
    const onchain = decodeEpochs(fixture("getEpochs_15537394.hex"));
    expect(compute(15537394)).toEqual(onchain);
  });

  it("is 1-indexed for every block, including boundaries", () => {
    const blocks = [
      0, 1, 10, 11, 12, 120, 121, 1771560, 1771561, 19487170, 19487171,
      25647505, 2 ** 40,
    ];
    for (const b of blocks) {
      for (const [i, v] of compute(b).entries()) {
        expect(v, `compute(${b})[${i}]`).toBeGreaterThanOrEqual(1);
        expect(v, `compute(${b})[${i}]`).toBeLessThanOrEqual(11);
      }
    }
  });

  it("rolls over at exact multiples of 11^n and resets everything below", () => {
    const season = POW11[6]!; // 1,771,561 blocks
    const at = compute(season * 6);
    expect(at[6]).toBe(7);
    for (let i = 0; i < 6; i++) {
      expect(at[i], `epoch ${i} at a Season boundary`).toBe(1);
    }
    expect(compute(season * 6 - 1)[6]).toBe(6);
  });
});

describe("ABI decoding", () => {
  it("reads the twelve labels from a live getEpochLabels return", () => {
    expect(decodeLabels(fixture("getEpochLabels.hex"))).toEqual([
      ...DEFAULT_LABELS,
    ]);
  });

  it("refuses truncated or hostile returns rather than walking off the end", () => {
    const full = fixture("getEpochLabels.hex");
    // Cuts that remove real structure. Lopping only the last byte or two is not
    // included: those bytes are the final string's zero padding, and a return
    // short by less than a word still carries every label.
    for (const n of [0, 16, 32, 64, Math.floor(full.length / 2)]) {
      expect(() => decodeLabels(full.subarray(0, n)), `${n} bytes`).toThrow();
    }

    const epochs = fixture("getEpochs_15537394.hex");
    for (const n of [0, 32, COUNT * 32 - 1]) {
      expect(() => decodeEpochs(epochs.subarray(0, n)), `${n} bytes`).toThrow();
    }

    // A word claiming a value beyond a safe integer must be refused, not
    // silently truncated.
    const oversized = new Uint8Array(COUNT * 32);
    oversized[0] = 0xff;
    expect(() => decodeEpochs(oversized)).toThrow();
  });
});

describe("humanDuration", () => {
  it("matches the original's date-fns output", () => {
    const cases: [number, string][] = [
      [11, "2 minutes"],
      [121, "27 minutes"],
      [1331, "4 hours 59 minutes"],
      [14641, "2 days 6 hours 54 minutes"],
    ];
    for (const [blocks, want] of cases) {
      expect(humanDuration(blocks), `${blocks} blocks`).toBe(want);
    }
  });

  it("singularises a 1 and pluralises everything else", () => {
    // Walk the output as (count, unit) pairs rather than substring-matching:
    // "21 minutes" trivially contains "1 minutes".
    for (const blocks of [11, 1331, 161051, 1771561, POW11[9]!, POW11[11]!]) {
      const got = humanDuration(blocks);
      const fields = got.split(/\s+/);
      expect(fields.length % 2, `${got}: not count/unit pairs`).toBe(0);
      for (let i = 0; i < fields.length; i += 2) {
        const count = fields[i]!;
        const unit = fields[i + 1]!;
        if (count === "1") {
          expect(unit.endsWith("s"), `${got}: pluralised a 1`).toBe(false);
        } else {
          expect(unit.endsWith("s"), `${got}: singularised a ${count}`).toBe(true);
        }
      }
    }
  });
});

describe("systemTable", () => {
  it("derives each epoch from eleven of the one below it", () => {
    const rows = systemTable(DEFAULT_LABELS);
    expect(rows).toHaveLength(COUNT);
    expect(rows[0]!.time).toBe("13.5 seconds");
    // The base unit is stated, not derived.
    expect(rows[0]!.prevLabel).toBe("");
    expect(rows[1]!.prevLabel).toBe("11 Blocks");
    expect(rows[11]!.blocks).toBe(285_311_670_611);
  });
});

describe("commas", () => {
  it("renders integers the way toLocaleString('en') does", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [7, "7"],
      [999, "999"],
      [1000, "1,000"],
      [46147, "46,147"],
      [15537394, "15,537,394"],
      [285311670611, "285,311,670,611"],
    ];
    for (const [n, want] of cases) {
      expect(commas(n), `commas(${n})`).toBe(want);
    }
  });
});
