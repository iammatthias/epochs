import { describe, expect, it } from "bun:test";

import { COUNT, DEFAULT_LABELS, compute, newReading } from "../src/epochs";
import { renderPage } from "../src/render";

const BLOCK = 15_537_394; // the Merge block
const reading = newReading(BLOCK, compute(BLOCK), DEFAULT_LABELS, true);

function page(over: Partial<Parameters<typeof renderPage>[0]> = {}): string {
  return renderPage({
    reading,
    publicUrl: "https://epochs.example",
    fontsBase: "",
    ...over,
  });
}

describe("the diagram", () => {
  it("draws twelve rows of eleven circles, Aeon first", () => {
    const html = page();
    const rows = [...html.matchAll(/<g transform="translate\(0,(\d+)\)">/g)];
    expect(rows).toHaveLength(COUNT);
    // Rows step 20px apart.
    rows.forEach((m, i) => expect(Number(m[1])).toBe(i * 20));
    expect(html.match(/<circle /g)).toHaveLength(COUNT * 11);
  });

  it("fills exactly one circle per row, at value - 1", () => {
    const html = page();
    const groups = html.split("<g transform=").slice(1);
    expect(groups).toHaveLength(COUNT);

    groups.forEach((g, row) => {
      const circles = [...g.matchAll(/<circle cx="(\d+)"[^>]*?(class="on")?><\/circle>/g)];
      expect(circles, `row ${row}`).toHaveLength(11);

      // Row r shows epoch index COUNT-1-r — the rows run reversed.
      const want = reading.epochs[COUNT - 1 - row]!;
      const filled = circles.flatMap((c, n) => (c[2] ? [n] : []));
      expect(filled, `row ${row} filled positions`).toEqual([want - 1]);

      // cx = 8 + 20n + 2, transcribed from the original SVG.
      circles.forEach((c, n) => expect(Number(c[1])).toBe(8 + 20 * n + 2));
    });
  });

  it("keeps the original's 220px height, which clips the twelfth row", () => {
    // 12 rows at 20px each is 240; the original's svg was 220 and SVG clips by
    // default, so the Block row was cut off. Reproduced, not fixed.
    expect(page()).toContain('<svg class="diagram" height="220"');
  });
});

describe("escaping", () => {
  // The epoch names come from getEpochLabels() on-chain and the contract owner
  // can set them to anything. Go's html/template escaped these implicitly; here
  // it is explicit, so it needs a test that would catch its removal.
  it("neutralises a hostile epoch label from the contract", () => {
    const hostile = [...DEFAULT_LABELS];
    hostile[6] = '<script>alert(1)</script>';
    hostile[3] = '"><img src=x onerror=alert(2)>';
    const html = page({
      reading: newReading(BLOCK, compute(BLOCK), hostile, true),
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes labels in the milestone table headers too", () => {
    const hostile = [...DEFAULT_LABELS];
    hostile[7] = "<b>Revolution</b>";
    const html = page({
      reading: newReading(BLOCK, compute(BLOCK), hostile, true),
    });
    expect(html).not.toContain("<b>Revolution</b>");
    expect(html).toContain("&lt;b&gt;Revolution&lt;/b&gt;");
  });
});

describe("the page", () => {
  it("renders the original's loading state when there is no reading", () => {
    const html = page({ reading: null });
    expect(html).toContain('<span class="t">Loading</span>');
    expect(html).not.toContain("It is currently");
    // No poller: there is nothing on the page for it to update.
    expect(html).not.toContain("/api/current");
  });

  it("states the current reading in the headline", () => {
    const html = page();
    expect(html).toContain("It is currently");
    expect(html).toContain('<span data-epoch="6">');
    expect(html).toContain("15,537,394");
  });

  it("points canonical and og:url at this deployment, never the dead original", () => {
    const html = page();
    expect(html).toContain('<link rel="canonical" href="https://epochs.example/">');
    expect(html).toContain('<meta property="og:url" content="https://epochs.example/">');
    expect(html).not.toContain('canonical" href="https://epochs.cosmiccomputation.org');
  });

  it("omits og:image, whose art was never archived", () => {
    const html = page();
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    // summary, not summary_large_image — there is no image to fill it.
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("ships no commentary to the browser", () => {
    // Notes about the rebuild belong in the source, not in served CSS or
    // script. The original's stylesheet was generated stitches output and
    // carried none.
    const html = page();
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(style).not.toContain("/*");
    const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
    expect(script).not.toContain("//");
    expect(script).not.toContain("/*");
    expect(html).not.toContain("<!--");
  });

  it("omits the @font-face rules when the licensed fonts are not configured", () => {
    const html = page();
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("woff2");
  });

  it("declares and preloads the fonts when a base URL is set", () => {
    const html = page({ fontsBase: "https://cdn.example/fonts/" });
    expect(html).toContain("@font-face");
    expect(html).toContain('href="https://cdn.example/fonts/NewSpirit-Medium.woff2"');
    expect(html).toContain("url(https://cdn.example/fonts/soehne-mono-buch.woff2)");
    // The trailing slash must not double up.
    expect(html).not.toContain("fonts//");
  });

  it("sorts the current block into its true place in history", () => {
    const html = page();
    const rows = html.slice(html.indexOf("Milestones"));
    const current = rows.indexOf("Current Block");
    const revolution2 = rows.indexOf("Start of Revolution 2");
    const season9 = rows.indexOf("Start of Season 9");
    // 15,537,394 sits between Season 9 (14,172,488) and Revolution 2
    // (19,487,171) — not appended at the end.
    expect(season9).toBeLessThan(current);
    expect(current).toBeLessThan(revolution2);
  });

  it("italicises milestones with no transaction behind them", () => {
    const html = page();
    // "Start of Season 7" has no hash in the recovered data.
    expect(html).toMatch(/<td class="unrealised">\s*Start of Season 7/);
    // "First transaction" does, so it links out.
    expect(html).toContain("https://etherscan.io/tx/0x5c504ed432cb");
  });

  it("keeps the artefacts of the original that a tidier rebuild would fix", () => {
    const html = page();
    // Two identically-named "Blocks" columns in The System.
    const system = html.slice(html.indexOf("The System"), html.indexOf("Milestones"));
    expect(system.match(/<th scope="col">Blocks<\/th>/g)).toHaveLength(2);
    // The unfinished FAQ sentence.
    expect(html).toContain("This is very experimental: feel free to use it,");
    // The dead Ropsten link, kept because it was on the page.
    expect(html).toContain("ropsten.etherscan.io");
  });
});
