/**
 * The Epochs page, transcribed from the original React tree.
 *
 * Element order, class-equivalents, copy and punctuation are reproduced as they
 * were — including the two identically-named "Blocks" columns in The System,
 * the unfinished FAQ sentence, and the dead Ropsten link (that testnet was shut
 * down in 2022; the line is kept because it was on the page).
 *
 * The palette, type scale and spacing are transcribed from the original site's
 * stitches configuration, recovered from its webpack bundle and Wayback
 * capture. Please do not "correct" any of it toward a house style.
 *
 * Notes about the rebuild belong in comments like this one — never in CSS or
 * script comments, which would be served to visitors. The original's stylesheet
 * was generated stitches output and carried no commentary, so neither does
 * this one.
 */

import {
  BLOCK_TIME,
  at,
  commas,
  labelAt,
  systemTable,
  type Reading,
} from "./epochs";
import { CONTRACT } from "./chain";
import { milestoneRows } from "./milestones";

/**
 * The epoch columns of the Milestones table, in the order the original printed
 * them: Revolution, Season, Phase, Episode, Bloom. The original addressed them
 * positionally, so the names can change on-chain without touching this.
 */
const MILESTONE_COLS: readonly number[] = [7, 6, 5, 4, 3];

/**
 * Escapes text for HTML. Go's html/template did this implicitly; here it is
 * explicit and must not be skipped for the epoch labels — they come from
 * getEpochLabels() on-chain and the contract owner can set them to anything.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Diagram geometry, transcribed from the original SVG. */
const DIAGRAM_HEIGHT = 220;
const DIAGRAM_ROW_STEP = 20;
const CIRCLE_RADIUS = 8;
const CIRCLE_CY = 10;

export interface PageOptions {
  /** null renders the original's "Loading" state. */
  reading: Reading | null;
  /** Absolute origin for canonical and og:url, e.g. "https://epochs.example". */
  publicUrl: string;
  /** Base URL for the licensed woff2 files; empty omits the @font-face rules. */
  fontsBase: string;
}

/**
 * The concentric-epoch figure: twelve rows of eleven circles, Aeon first.
 *
 * Note the height: 12 rows at 20px each is 240, but the original's <svg> was
 * 220 tall and SVG clips by default, so the final row — Block, the one that
 * changes every twelve seconds — was cut off. That is reproduced here rather
 * than corrected: it is what the page looked like. Raising DIAGRAM_HEIGHT to
 * 240 reveals the twelfth row.
 */
function diagram(r: Reading): string {
  const rows = r.rows
    .map((e, i) => {
      const circles = Array.from({ length: 11 }, (_, n) => {
        // fill={f-1===n ? "black" : "none"} — values are 1-indexed.
        const on = e.value - 1 === n ? ' class="on"' : "";
        const cx = 8 + DIAGRAM_ROW_STEP * n + 2;
        return `<circle cx="${cx}" cy="${CIRCLE_CY}" r="${CIRCLE_RADIUS}"${on}></circle>`;
      }).join("");
      return `        <g transform="translate(0,${i * DIAGRAM_ROW_STEP})">
          ${circles}
        </g>`;
    })
    .join("\n");

  return `      <svg class="diagram" height="${DIAGRAM_HEIGHT}" width="100%" id="diagram">
${rows}
      </svg>`;
}

function systemRows(labels: readonly string[]): string {
  return systemTable(labels)
    .map(
      (row) => `          <tr>
            <td class="bold">${esc(row.label)}</td>
            <td>${esc(row.prevLabel)}</td>
            <td>11<sup>${row.exp}</sup></td>
            <td>${commas(row.blocks)}</td>
            <td>${esc(row.time)}</td>
          </tr>`,
    )
    .join("\n");
}

function milestoneTable(reading: Reading): string {
  return milestoneRows(reading)
    .map((m) => {
      const label = esc(m.label);
      // The hash is either a real tx hash or, for CryptoPunks, a contract
      // address — both are hex from a fixed list, but encode anyway.
      const event = m.hash
        ? `<a href="https://etherscan.io/tx/${encodeURIComponent(m.hash)}">${label}</a>`
        : label;
      const cells = MILESTONE_COLS.map(
        (c) => `<td class="align-end">${m.epochs[c] ?? ""}</td>`,
      ).join("");
      return `          <tr>
            <td${m.hash ? "" : ' class="unrealised"'}>
              ${event}
            </td>
            <td class="align-end"><a href="https://etherscan.io/block/${m.block}">${commas(m.block)}</a></td>
            ${cells}
          </tr>`;
    })
    .join("\n");
}

/**
 * The live-update script. The original subscribed to its provider's "block"
 * event in the browser and re-rendered; here the edge holds the reading, so the
 * page polls /api/current instead. The server-rendered page is already correct
 * without this — it only keeps a tab that is left open from going stale.
 *
 * This renders into <head>, so it executes before <body> is parsed and must
 * wait for the DOM: looking the elements up immediately finds nothing and
 * silently does nothing at all, which is exactly the bug this once had.
 *
 * Kept comment-free: this ships to the browser.
 */
const LIVE_SCRIPT = `<script>
  (function () {
    function init() {
    var display = document.getElementById('block-display');
    var diagram = document.getElementById('diagram');
    if (!display || !diagram) return;
    var rows = diagram.querySelectorAll('g');

    function paint(data) {
      if (!data || typeof data.block !== 'number') return;
      display.textContent = data.display;
      for (var i = 0; i < data.epochs.length; i++) {
        var el = document.querySelector('[data-epoch="' + i + '"]');
        if (el) el.textContent = data.epochs[i];
      }
      for (var r = 0; r < rows.length; r++) {
        var value = data.epochs[data.epochs.length - 1 - r];
        var circles = rows[r].querySelectorAll('circle');
        for (var n = 0; n < circles.length; n++) {
          circles[n].classList.toggle('on', value - 1 === n);
        }
      }
    }

    function tick() {
      fetch('/api/current', { headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(paint)
        .catch(function () {});
    }

    setInterval(tick, 12000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
</script>`;

/**
 * The tab icon. The original's /favicon.ico is listed in the Wayback index at
 * 1,924 bytes but its replay 404s, so the art is not recoverable. This is a
 * stand-in built from the page's own motif — one row of the diagram, the
 * filled circle among the empty ones — rather than a mark borrowed from
 * somewhere else.
 */
const FAVICON =
  `<link rel="icon" href="data:image/svg+xml,` +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" fill="#fff"/>` +
      `<g fill="none" stroke="#000" stroke-width="5">` +
      `<circle cx="17" cy="32" r="11"/><circle cx="47" cy="32" r="11" fill="#000"/>` +
      `</g></svg>`,
  ) +
  `">`;

function fontFaces(base: string): string {
  if (!base) return "";
  const b = base.replace(/\/$/, "");
  return `
    @font-face {
      font-family: NS; font-weight: 500; font-style: normal; font-display: swap;
      src: url(${b}/NewSpirit-Medium.woff2) format("woff2");
    }
    @font-face {
      font-family: SM; font-weight: 400; font-style: normal; font-display: swap;
      src: url(${b}/soehne-mono-buch.woff2) format("woff2");
    }
    @font-face {
      font-family: SM; font-weight: 600; font-style: normal; font-display: swap;
      src: url(${b}/soehne-mono-halbfett.woff2) format("woff2");
    }`;
}

function preloads(base: string): string {
  if (!base) return "";
  const b = base.replace(/\/$/, "");
  return (
    `\n  <link rel="preload" href="${b}/NewSpirit-Medium.woff2" as="font" type="font/woff2" crossorigin>` +
    `\n  <link rel="preload" href="${b}/soehne-mono-buch.woff2" as="font" type="font/woff2" crossorigin>` +
    `\n  <link rel="preload" href="${b}/soehne-mono-halbfett.woff2" as="font" type="font/woff2" crossorigin>`
  );
}

/**
 * The page shell.
 *
 * --colors-background (#fef9f3) is declared because the original declared it,
 * but the original never applied it to anything: the rendered page had a white
 * ground. Adding `background: var(--colors-background)` to body is the one-line
 * change if the cream is wanted.
 *
 * .t is the Text component: a block element with a 16px bottom margin, sized
 * from the fontSizes scale, set either in the heading face (600, 1.25) or the
 * body mono (1.5). Links are the "subtle" variant — slate text under a
 * hairline-grey underline; the "blue" variant existed in the bundle but the
 * page never used it. Tables are table-layout:fixed with a 2px top rule and
 * muted zebra striping; on a narrow viewport the unbreakable figures overflow
 * their cells and the browser shrink-to-fits the page, as the original did.
 */
export function renderPage(opts: PageOptions): string {
  const { reading, publicUrl, fontsBase } = opts;
  const canonical = publicUrl.replace(/\/$/, "");

  const body = reading ? renderBody(reading) : LOADING_BODY;
  const head = reading ? `\n  ${LIVE_SCRIPT}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>Epochs</title>
  <meta name="description" content="A wayfinding system for Good Ancestors">
  <link rel="canonical" href="${esc(canonical)}/">
  <meta property="og:url" content="${esc(canonical)}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Epochs">
  <meta property="og:title" content="Epochs">
  <meta property="og:description" content="A wayfinding system for Good Ancestors">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:site" content="@cosmiccomlab">
  <meta name="twitter:title" content="Epochs">
  <meta name="twitter:description" content="A wayfinding system for Good Ancestors">
  ${FAVICON}${preloads(fontsBase)}
  <style>
    :root {
      --fonts-body: "SM";
      --fonts-heading: NS;
      --colors-text: #454f5b;
      --colors-background: #fef9f3;
      --colors-primary: #5c6ac4;
      --colors-secondary: #006fbb;
      --colors-highlight: #47c1bf;
      --colors-muted: #e6e6e6;
      --colors-gray: #dfe3e8;
      --colors-accent: #f49342;
      --colors-darken: #00044c;
      --lineHeights-heading: 1.25;
      --lineHeights-body: 1.5;
      --fontSizes-1: 12px;  --fontSizes-2: 14px; --fontSizes-3: 16px;
      --fontSizes-4: 20px;  --fontSizes-5: 24px; --fontSizes-6: 32px;
      --fontSizes-7: 48px;  --fontSizes-8: 64px; --fontSizes-9: 96px;
      --space-1: 4px;   --space-2: 8px;   --space-3: 16px;  --space-4: 32px;
      --space-5: 64px;  --space-6: 128px; --space-7: 256px; --space-8: 512px;
    }${fontFaces(fontsBase)}
    *, :after, :before { box-sizing: border-box; }

    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: "Untitled Sans", -apple-system, BlinkMacSystemFont, "Segoe UI",
        Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans",
        "Helvetica Neue", sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      line-height: 1;
      color: var(--colors-text);
    }
    svg { display: block; vertical-align: middle; }

    .container {
      box-sizing: border-box; flex-shrink: 0;
      margin-left: auto; margin-right: auto;
      max-width: 1145px;
      padding-left: var(--space-3); padding-right: var(--space-3);
    }
    @media (min-width: 768px) {
      .container { padding-left: var(--space-4); padding-right: var(--space-4); }
    }
    .page { padding-top: var(--space-5); padding-bottom: var(--space-5); }

    .t {
      color: var(--colors-text); margin: 0 0 var(--space-3);
      font-weight: 400; display: block;
      font-family: var(--fonts-body), ui-monospace, SFMono-Regular, "SF Mono",
        Menlo, Consolas, "Liberation Mono", monospace;
      line-height: var(--lineHeights-body);
      font-size: var(--fontSizes-3);
    }
    .t.heading {
      font-family: var(--fonts-heading), "Iowan Old Style", "Palatino Linotype",
        Palatino, Georgia, ui-serif, serif;
      font-weight: 600;
      line-height: var(--lineHeights-heading);
    }
    .t.s1 { font-size: var(--fontSizes-1); }
    .t.s2 { font-size: var(--fontSizes-2); }
    .t.s4 { font-size: var(--fontSizes-4); }
    .t.s6 { font-size: var(--fontSizes-6); }
    .t.s8 { font-size: var(--fontSizes-8); }
    .t.normal { font-weight: normal; }
    .t.measure { max-width: 33em; }
    .t.tight { line-height: 1.1; }

    .box { box-sizing: border-box; }
    .mb4 { margin-bottom: var(--space-4); }
    .mb5 { margin-bottom: var(--space-5); }
    .head-row {
      display: flex; justify-content: space-between; flex-direction: row;
      margin-bottom: var(--space-3);
    }

    a {
      align-items: center; gap: var(--space-1); flex-shrink: 0;
      outline: none; text-underline-offset: 3px;
      color: var(--colors-text);
      text-decoration-color: var(--colors-muted);
      -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
      line-height: inherit;
    }
    a .t { color: inherit; }
    @media (hover: hover) {
      a:hover { text-decoration-line: underline; }
    }
    a:focus-visible {
      outline: 2px solid var(--colors-muted); outline-offset: 2px;
      text-decoration-line: none;
    }

    table {
      width: 100%; border-top: 2px solid var(--colors-text);
      table-layout: fixed; border-spacing: 0;
      font-family: var(--fonts-body), ui-monospace, SFMono-Regular, "SF Mono",
        Menlo, Consolas, "Liberation Mono", monospace;
    }
    tbody { width: 100%; }
    tbody tr:nth-child(odd) { background-color: var(--colors-muted); }
    th {
      font-weight: unset; text-align: start; vertical-align: top;
      color: var(--colors-text);
      font-size: var(--fontSizes-1);
      padding-top: var(--space-1); padding-bottom: var(--space-1);
    }
    thead th {
      font-weight: bold;
      padding-top: var(--space-1); padding-bottom: var(--space-4);
    }
    td {
      vertical-align: top; color: var(--colors-text);
      font-size: var(--fontSizes-1);
      padding-top: var(--space-2); padding-bottom: var(--space-2);
    }
    @media (min-width: 768px) {
      th, td { font-size: var(--fontSizes-2); }
    }
    .align-end { text-align: end; }
    .bold { font-weight: bold; }
    .unrealised { font-style: italic; }
    @media (min-width: 640px) {
      .col-event { width: 300px; }
    }

    .footer {
      padding-top: var(--space-5); padding-bottom: var(--space-5);
      background: var(--colors-muted);
    }

    .diagram { width: 100%; }
    .diagram circle { fill: none; stroke: #000; stroke-width: 2; }
    .diagram circle.on { fill: #000; }
  </style>${head}
</head>
<body>
${body}
</body>
</html>`;
}

/** The original rendered exactly this until its provider answered. */
const LOADING_BODY = `  <div class="container page">
    <span class="t">Loading</span>
  </div>`;

function renderBody(r: Reading): string {
  const headerCols = MILESTONE_COLS.map(
    (c) => `<th scope="col" class="align-end">${esc(labelAt(r, c))}</th>`,
  ).join("");

  return `<div>
  <div class="container page">

    <div class="box head-row">
      <h1 class="t heading s8">Epochs</h1>
      <span class="t">Block <span id="block-display">${commas(r.block)}</span></span>
    </div>

    <div class="box mb4">
${diagram(r)}
    </div>

    <div class="box mb4">
      <span class="t heading s8 tight">It is currently
        ${esc(labelAt(r, 6))} <span data-epoch="6">${at(r, 6)}</span>,
        ${esc(labelAt(r, 5))} <span data-epoch="5">${at(r, 5)}</span>,
        ${esc(labelAt(r, 4))} <span data-epoch="4">${at(r, 4)}</span></span>
      <span class="t heading s4 normal">Looking further out, we are in
        ${esc(labelAt(r, 7))} <span data-epoch="7">${at(r, 7)}</span> /
        ${esc(labelAt(r, 8))} <span data-epoch="8">${at(r, 8)}</span> /
        ${esc(labelAt(r, 9))} <span data-epoch="9">${at(r, 9)}</span> /
        ${esc(labelAt(r, 10))} <span data-epoch="10">${at(r, 10)}</span> /
        ${esc(labelAt(r, 11))} <span data-epoch="11">${at(r, 11)}</span></span>
      <span class="t heading s6">~</span>
      <p class="t heading s4 normal measure">Epochs is a crypto-native temporal wayfinding system for Good Ancestors working on immutable technology that lasts forever.</p>
      <p class="t heading s4 normal measure">Epochs is a meditation on the Eternal Now, and a warphole through the connectedness of time. A mapping from here until the inevitable end state of time mediated by the blockchain. A ritual framework for the people stewarding digital altars. A belief that numbers are sacred.</p>
      <span class="t heading s6">~</span>
    </div>

    <div class="box mb5">
      <h2 class="t heading s6">The System</h2>
      <p class="t heading s4 normal measure">The base unit is one Ethereum block; each concentric <em>epoch</em> is of length 11<sup>n</sup> blocks, from 11<sup>1</sup> to 11<sup>11</sup> blocks.</p>
      <p class="t heading s4 normal measure">Exact earth-times fluctuate based on block-time. For convenience in conceptualizing, ballpark earth-time approximations of <em>epoch</em> lengths are provided, assuming a block time of ~${BLOCK_TIME} seconds.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Epoch</th>
            <th scope="col">Length</th>
            <th scope="col">Blocks</th>
            <th scope="col">Blocks</th>
            <th scope="col">~Gaia Time</th>
          </tr>
        </thead>
        <tbody>
${systemRows(r.labels)}
        </tbody>
      </table>
    </div>

    <div class="box mb5">
      <h2 class="t heading s6">Milestones</h2>
      <p class="t heading s4 normal measure">The Epochs of any block can be calculated, and simple math can be used to calculate auspicious future events.</p>
      <table>
        <thead>
          <tr>
            <th scope="col" class="col-event">Event</th>
            <th scope="col" class="align-end">Block</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody>
${milestoneTable(r)}
        </tbody>
      </table>
    </div>

    <div class="box mb5">
      <h2 class="t heading s6">FAQ</h2>
      <span class="t bold">How do I mint this?</span>
      <span class="t">Epochs is a public-good implementation of an algorithm, not an NFT. It&rsquo;s a read-only contract on the Ethereum blockchain: to participate, make something with it!</span>
      <span class="t bold">Who controls Epochs?</span>
      <span class="t">The canonical Epochs smart contract is controlled by AspectsDAO.</span>
      <span class="t bold">Where do I find out more?</span>
      <span class="t">An initial Solidity implementation is on <a href="https://etherscan.io/address/${CONTRACT}#readContract">Mainnet</a> &amp; <a href="https://ropsten.etherscan.io/address/0xBe5cB98a3864c19bc22fD181bdc1BBa0e86A0718#readContract">Ropsten</a>.</span>
      <span class="t">The interface is on IPFS at QmYxEr4XjXEeQDY6DUENEqCXJVC4FxySJSwsSf5zKwtuGj.</span>
      <span class="t">This is very experimental: feel free to use it,</span>
      <span class="t bold">How can I get involved?</span>
      <span class="t">We have a small, manageable <a href="https://discord.com/invite/yck92CMRKa">Discord</a> where we discuss Epochs, spin-off projects building on it, and throw regular Ceremonies.</span>
    </div>

  </div>

  <div class="footer">
    <div class="container">
      <span class="t s2"><a href="https://cosmiccomputation.org">Cosmic Computation Laboratory</a></span>
    </div>
  </div>
</div>`;
}
