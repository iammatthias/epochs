import { compute, type Reading } from "./epochs";

/**
 * One row of the Milestones table. `hash` is the transaction that realised the
 * event, when there is one; rows without a hash render in italic, exactly as
 * the original did — that was how it distinguished "someone did this" from
 * "this block is simply significant".
 */
export interface Milestone {
  label: string;
  block: number;
  hash?: string;
  epochs: number[];
}

/**
 * The event list recovered verbatim from the site's Wayback capture (the
 * __NEXT_DATA__ payload of the 2022-12-08 snapshot), which is where
 * getStaticProps baked it. Reproduced exactly, including two quirks that were
 * in the original data:
 *
 *   - "CryptoPunks contract deployed" carries the CryptoPunks *contract
 *     address* in its hash field, not a transaction hash, so its link points at
 *     a tx that does not exist. Preserved deliberately.
 *   - "Start of Revolution 2" (block 19,487,171 = 11^7) was a future event in
 *     2022 and has since happened. It now renders as history, which is the
 *     table working as designed.
 *
 * Epoch values are computed from the block number rather than copied from the
 * capture; a test asserts the computation reproduces every baked value.
 */
const MILESTONES: readonly { label: string; block: number; hash?: string }[] = [
  { label: "Genesis", block: 0 },
  {
    label: "First transaction",
    block: 46147,
    hash: "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
  },
  {
    label: "CryptoPunks contract deployed",
    block: 3914495,
    hash: "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB",
  },
  { label: "Start of Season 7", block: 10629366 },
  {
    label: "Chromie Squiggle#0 Minted",
    block: 11341538,
    hash: "0xec39476d2cf54b44c43e17070257250dcb369c33941de978b4cbeebe7aa0907c",
  },
  {
    label: "Zora Deployed",
    block: 11565020,
    hash: "0x9e5c9c1382e1ed51022b0c8038e07ed00064a43e84a61ef4cef5175128aab757",
  },
  {
    label: "thesarahshow.eth mints FNDv2#1",
    block: 11694715,
    hash: "0xaffde820c8f8f07885c46d2be368dcd7f1929b98e2cf314e21f20c1510ea11d4",
  },
  {
    label: "MikeDem loses souljaboy.eth",
    block: 11748899,
    hash: "0xf851e4f5db0c8be03bee5b50a2f11f8615812d289e9e5e59de339e3a5debc7c5",
  },
  {
    label: "Sale of Punk#7804",
    block: 12014171,
    hash: "0xe387b6978f19029efb175bf594467c031c792fe99a4b76ccc242f1f7bd6638f4",
  },
  {
    label: "Sale of Everydays: The First 5000 Days",
    block: 12027953,
    hash: "0x01d0967faaaf95f3e19164803a1cf1a2f96644ebfababb2b810d41a72f502d49",
  },
  {
    label: "FWB Pro Deployed",
    block: 12061284,
    hash: "0xc918c25947a6e2ad1bffd4e43b9f9fad91a699d7212968c6d1cd666973bcb159",
  },
  {
    label: "x*y=k Minted",
    block: 12108534,
    hash: "0xe24d515557e405e40a507ed06f7e1bd0af9ffbef0969c3c7ebbe375c09008595",
  },
  {
    label: "Solvency Deployed",
    block: 12272493,
    hash: "0xafbc3267f5cf1a8077f1a45fb2c21e27f8b9a3488026f45b0ac473d741afec84",
  },
  {
    label: "Zora Auction House Deployed",
    block: 12372205,
    hash: "0xeb249fa282d86e18b1a092473d5e40dacc45d8a1d23c187d1567888bd595ed22",
  },
  {
    label: "PartyDAO Crowdfund Deployed",
    block: 12376091,
    hash: "0x3a94784a723c5b5ead0168e6df96be1f801784c654a87b4da92052bbdfea84ac",
  },
  { label: "Start of Season 8", block: 12400927 },
  {
    label: "Punk 3269 bought by @houseofhalle",
    block: 12995606,
    hash: "0xcdd246cde8992af48182b84f0039ab674be03dc1f690b33108ff680925cce824",
  },
  {
    label: "10.3 ETH bid for Latashá's glo.up remix",
    block: 13291730,
    hash: "0xad6ee05d941af7d7b9879a028caa0e60466fe78af2f6f3206ac62c3013861ad5",
  },
  { label: "Start of Season 9", block: 14172488 },
  { label: "Start of Revolution 2", block: 19487171 },
];

/**
 * The table's rows: the recovered events plus the live "Current Block", sorted
 * by block number. The original built this list the same way, on every render,
 * so the current block slots into its true place in history rather than sitting
 * at the end.
 */
export function milestoneRows(current: Reading): Milestone[] {
  const rows: Milestone[] = [
    { label: "Current Block", block: current.block, epochs: current.epochs },
    ...MILESTONES.map((m) => ({ ...m, epochs: compute(m.block) })),
  ];
  // Stable sort — Array.prototype.sort is required to be stable, so a
  // milestone that shares the current block keeps its relative order.
  return rows.sort((a, b) => a.block - b.block);
}
