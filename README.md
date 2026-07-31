# EPOCHS

The front end for the epochs smart contract, lovingly recreated from broken artifacts.

The contract is live on Ethereum mainnet and it is read-only. There is nothing
to mint, no wallet to connect, nothing to sign:

**[0xde9f0c369Ef3692B4bF9D40803A9029a3722B9c4](https://etherscan.io/address/0xde9f0c369Ef3692B4bF9D40803A9029a3722B9c4#readContract)**

The original was a Next.js site from Cosmic Computation Laboratory has been offline for awhile, and frankly, I missed it. That was the whole imputus here. It was one of the first onchain projects that tickled my imagination. 

Claude drove Chrome in the background all day, browsing the Wayback Machine and scraping the broken NextJS webpack bundles. It wasn't much, but it was enough. 

## Running it

Bun, Vite and TypeScript on a Cloudflare Worker. No database — every value on
the page is a pure function of the block height, so the only thing the app
actually needs from the world is one number.

```sh
bun install
bun run dev
```

## Credit

The design, the copy and the idea are the Cosmic Computation Laboratory's. This
is a preservation project, published in that spirit.
