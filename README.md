# EPOCHS

The front end for the epochs smart contract, lovingly recreated from broken artifacts on the wayback machine.

## What it is

Epochs is a way of telling time by the blockchain. The base unit is one Ethereum
block, and each concentric *epoch* is eleven of the one below it — eleven blocks
make a Form, eleven Forms a Structure, on up through Bloom, Episode, Phase,
Season, Revolution, Aepoch, Aera, Arche and Aeon.

Every block therefore has twelve simultaneous readings, each cycling 1 through
11. Right now it is some Episode of some Phase of some Season, and also the
second Revolution, and also the first Aeon — and it will be the first Aeon for
another hundred thousand years.

A Season is about nine months. A Revolution is a little over eight years; the
second one began in March 2024. An Aeon is 285,311,670,611 blocks, which is not
a length of time anyone reading this will see the end of. That is rather the
point. It was built as a wayfinding system for Good Ancestors — people working
on things meant to outlast them.

The contract is live on Ethereum mainnet and it is read-only. There is nothing
to mint, no wallet to connect, nothing to sign:

**[0xde9f0c369Ef3692B4bF9D40803A9029a3722B9c4](https://etherscan.io/address/0xde9f0c369Ef3692B4bF9D40803A9029a3722B9c4#readContract)**

It is controlled by AspectsDAO. Even the twelve epoch names are read from the
chain rather than hardcoded here, so if they are ever renamed, this page follows.

## Why it needed recreating

`epochs.cosmiccomputation.org` went offline. The original was a Next.js site by
the Cosmic Computation Laboratory, and it did not survive in any form you could
simply restore — the Wayback Machine never captured a working copy of the page
itself.

What did survive was scattered: a few webpack bundles, one HTML snapshot from
December 2022, and the JSON payload buried inside it that the site had used to
build its own tables. That was enough. The palette, the type scale, the spacing,
the copy, the concentric-circle diagram and all twenty milestone events were
pulled back out of those pieces and reassembled.

Only the stack is new. Everything you see was theirs.

## Faithful, warts included

The rebuild reproduces the original rather than improving it, and that includes
the things a tidier rewrite would quietly fix:

- The diagram is clipped. Twelve rows need 240 pixels of height; the original's
  SVG was 220, so the bottom row — Block, the one that actually changes every
  twelve seconds — got cut off. It is still cut off.
- The System table has two columns both labelled "Blocks".
- One FAQ answer just stops mid-sentence: *"This is very experimental: feel free
  to use it,"*.
- There is a link to Ropsten, a testnet that was shut down in 2022.
- One milestone links to a transaction that does not exist, because the original
  data put a contract address in the hash field.

These are load-bearing. There are tests that fail if someone helpfully corrects
them.

One thing does differ. The original hardcoded a `1` for the five largest epochs,
which was true when it was written — but Revolution ticked over to 2 in March
2024, and a page about deep time should not be wrong about deep time. Those
values now come from the contract.

## What is gone for good

Two things could not be recovered, and both are checked against the archive
rather than assumed:

**The social card.** The original pointed at `/images/site-preview.png`. Wayback
holds no capture of anything under `/images/`, so the artwork is simply lost.
The tags are left out entirely rather than pointed at a 404 that would render a
broken preview everywhere the link is shared.

**New Spirit**, the heading typeface. It was never archived, and it — along with
Söhne Mono — is licensed and can't be redistributed here anyway. The page falls
back to a system serif and mono, which is close in character but not the same.
If you hold the licences you can point the app at your own copies and it will
use them.

The favicon is a stand-in, borrowed from the page's own motif: one row of the
diagram, the filled circle among the empty ones.

## Running it

Bun, Vite and TypeScript on a Cloudflare Worker. No database — every value on
the page is a pure function of the block height, so the only thing the app
actually needs from the world is one number.

```sh
bun install
bun run dev        # real workerd, not a shim
bun test
bun run deploy
```

That last line is a complete deployment. There is nothing to provision, no
bindings, no secrets. Once it lives at a real domain, set `EPOCHS_PUBLIC_URL` so
every copy agrees on one canonical address, and `EPOCHS_RPC_URL` if you would
rather not lean on the public RPC endpoints it ships with.

There is also `/api/current`, which returns the live reading as JSON. It is
public, like the contract behind it.

## Credit

The design, the copy and the idea are the Cosmic Computation Laboratory's. This
is a preservation project, published in that spirit — a site I liked, put back
on the internet.
