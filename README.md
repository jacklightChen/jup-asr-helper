# JUP ASR Helper

[简体中文](README.zh-CN.md) · English · [GitHub repository](https://github.com/jacklightChen/jup-asr-helper) · [Open helper](https://jup-asr-helper.github.io/)

An open-source helper for reviewing and claiming Jupiter ASR rewards with **Binance Wallet, Phantom, OKX Wallet, Backpack, MetaMask, Solflare, or Trust Wallet**. Open it in a supported wallet's mobile DApp browser or an extension-enabled desktop browser. Each visitor connects their own Solana account and approves each transaction in their wallet. This independent community project is not affiliated with Jupiter or the listed wallets.

The GitHub Pages website is [jup-asr-helper.github.io](https://jup-asr-helper.github.io/). On a phone, open that URL inside a supported wallet to connect your wallet.

## Current compatibility

Only the **ASR 2026 Q3** campaign (`asr-2026-q3`) is supported. Its published claim window ends **January 12, 2027 at 14:00 UTC** (22:00 Beijing time). The page reads the live campaign window and stops preparation outside it. See the [official campaign](https://jup.ag/rewards/asr-2026-q3).

| Wallet | Connection |
| --- | --- |
| Binance Wallet | Solana Wallet Standard |
| Phantom | Wallet Standard or official `window.phantom.solana` provider |
| OKX Wallet | Official `window.okxwallet.solana` provider preferred; Wallet Standard fallback |
| Backpack | Wallet Standard or `window.backpack` provider |
| MetaMask | Native Solana Wallet Standard registration |
| Solflare | Wallet Standard or `window.solflare` provider |
| Trust Wallet | Official `Trust` Wallet Standard registration; injected Solana provider fallback |

Wallet discovery requires a recognized name, Solana mainnet, `standard:connect`, and sign-only `solana:signTransaction`. Both the `solana:mainnet` alias and the mainnet CAIP-2 identifier are supported. An EVM-only MetaMask provider is insufficient. The Connect dialog always lists all supported wallets, including Binance Wallet. Detected Solana interfaces connect from their cards; unavailable wallets show instructions to open the page inside the wallet or enable its extension. With multiple detected instances of the same wallet, choose the desired card. OKX uses its direct provider when available so the page reads the actively selected Solana account and its account-change events. Legacy bytes are passed to injected providers as a native `Transaction`; v0 bytes use `VersionedTransaction`. Injected adapters accept the wallets' official Solana transaction methods, and all signed output passes the same local message and signature checks before Jupiter's `postClaim` submission.

The [wallet compatibility review](docs/wallet-compatibility.md) records the adapter tests, Standard contract fixtures, and limits of live validation.

Integration references: [Binance Solana interface](https://developers.binance.com/en/docs/products/web3-connect/solana-provider), [Phantom provider](https://docs.phantom.com/solana/sending-a-transaction), [OKX Solana provider](https://web3.okx.com/onchainos/dev-docs/wallet/dapp-connect/chains/solana/provider), [Backpack](https://docs.backpack.app/), [MetaMask Wallet Standard features](https://docs.metamask.io/metamask-connect/solana/reference/methods/), [Trust Wallet Solana provider](https://github.com/trustwallet/trust-web3-provider/tree/main/packages/solana), and [Solflare SDK](https://docs.solflare.com/solflare/technical/integrate-solflare/solflare-wallet-sdk).

The helper uses Jupiter's campaign API to prepare and submit claims after wallet authorization and local verification. API availability, wallet versions, and individual eligibility can affect claims.

Rewards are **Staked JUP**, added to your staking account. The reviewed transaction may create a staking account and enable continuous staking (`max lock`). To withdraw later, disable continuous staking and wait the required **7 days**. Check the actual transaction and current [Jupiter staking page](https://vote.jup.ag/) before signing.

## Use with your wallet

1. On a phone, open the published site's HTTPS URL in a **supported wallet's DApp browser**. On desktop, open it in a browser with a supported wallet extension enabled. Menu names can differ by app version. An ordinary browser without an injected supported wallet cannot connect.
2. Select **English / 简体中文**, select **Connect wallet**, then choose your wallet card in the dialog. Authorize the Solana account that earned the reward; the page reads that account's allocation.
3. Select **Prepare transaction**. Review the reward, staking effect, fee payer, programs, and estimated SOL cost.
4. Select the **Sign and submit** button, then review and authorize the transaction in the selected wallet. This explicit wallet approval is the final signing step.
5. Check **Refresh claim status** and the on-chain transaction result. If submission times out, check the reward status and wallet history before trying again; the page does not automatically resubmit.

Preparation expires after 45 seconds to reduce stale-blockhash failures. Prepare again if the page asks you to do so. Keep SOL available for the network fee and any account rent. The displayed rent constants reflect the reviewed account sizes and current parameters; estimates can change and the wallet preview and executed transaction determine the real cost.

If your wallet cannot be detected, reopen the URL in its embedded DApp browser, or enable the desktop extension and refresh. Check that the installed version exposes the required connection and sign-only methods described above. If Jupiter rejects the wallet or claim, use the official campaign's supported flow. Do not alter wallet identity or contract checks to force a submission.

## What the page checks

- The connected mainnet account, fee payer, and required signer match.
- The campaign, JUP mint, distributor, locker, derived claimant accounts, supported program IDs, instruction data, and reward amount match the reviewed campaign.
- Unexpected programs, transfers, account destinations, instruction structures, address lookup tables, duplicate operations, and excessive estimated network fees are rejected.
- The returned signed transaction has the exact original message, and its signature is valid for the connected account. Existing signatures are preserved.
- Account changes invalidate the prepared transaction. A submission is followed by a fresh reward-status query.

These checks cover the supported transaction shape; they are not a smart-contract audit. Tests use generated fixture keypairs, never a real user's keys.

## Privacy

No seed phrase, private key, Binance exchange API key, or Reown Project ID is needed. The frontend has no analytics or application backend. It stores only the selected interface language in `localStorage`; wallet connection and transaction state remain in page memory. Jupiter receives the public wallet address for claim queries and the signed claim transaction on submission. Donation history queries send the public recipient address and transaction IDs to PublicNode’s Solana mainnet RPC. Optional donations use the same RPC, which receives the public address for balance queries and the signed transfer on submission. Hosting and API providers can retain their own request logs. The repository contains no personal claim allocation or signed transaction. The voluntary donation address below is intentionally public.

## Develop

The frontend and build script are written in TypeScript with strict type checking. Use Node.js 24 and npm; Node runs the build script and test imports with native type stripping. Install the locked dependencies, check types, run the transaction checks, and build the static site:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The build emits `dist/index.html`, content-hashed scripts and styles in `dist/assets/`, local wallet icons in `dist/icons/`, and `dist/asset-manifest.json`. Compatibility copies of `app.js` and `style.css` are also included. Content hashes keep cached HTML paired with the correct script and style versions. `npm run build:pages` additionally refreshes these files at the deployment repository root while retaining older hashed assets for cached visitors. Asset references are relative, supporting both homepage and project paths. To preview the layout locally:

```sh
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080` on the development computer. A supported desktop extension may inject its wallet on localhost. For a real mobile wallet connection, deploy to HTTPS and open that URL inside a supported wallet; a phone's `localhost` is the phone itself. Tests do not request a real wallet signature or broadcast a transaction.

## API flow

The page calls Jupiter directly with no proxy. The campaign-specific base URL is:

```text
https://datapi.jup.ag/rewards/v1/campaigns/asr-2026-q3
```

| Method | Route relative to the base URL | Purpose |
| --- | --- | --- |
| GET | `/` | Read campaign metadata and claim window |
| GET | `/stats/{address}` | Read the connected account's reward status |
| GET | `/claim?address={address}` | Obtain an unsigned claim transaction |
| POST | `/postClaim` | Submit `{ "address": "…", "signedTx": "…" }` after wallet approval and local signature verification |

These campaign endpoints are the flow observed from Jupiter's rewards application. They can change or reject unsupported clients; the app stops on an unrecognized response. No generic CLI private-key signing example is included.

For a future ASR campaign, review the new metadata, contract/distributor addresses, instruction layouts, account derivations, fee/rent assumptions, and tests before changing the campaign. Changing only the slug is insufficient. The supported constants live in [`src/transaction.ts`](src/transaction.ts), and the API selection and wallet flow live in [`src/app.ts`](src/app.ts).

## GitHub Pages

Source is maintained at [`jacklightChen/jup-asr-helper`](https://github.com/jacklightChen/jup-asr-helper). The website is published from [`jup-asr-helper/jup-asr-helper.github.io`](https://github.com/jup-asr-helper/jup-asr-helper.github.io), using its preserved **Deploy from a branch → `main` → `/ (root)`** configuration. No custom domain or deployment secret is required. Other GitHub Pages settings are unchanged.

Before releasing, run `npm run typecheck`, `npm test`, and `npm run build`, then commit and push source to `jacklightChen/jup-asr-helper`. Sync the release's `src/`, `test/`, `build.ts`, `tsconfig.json`, package files, and READMEs into a separate checkout of the organization homepage repository, preserving its deployment verification workflow. In that checkout, run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build:pages`, then commit and push all updated source and generated assets to its `main` branch. Keep `.nojekyll` and older hashed files in `assets/`; cached HTML may still reference them.
The source [CI workflow](https://github.com/jacklightChen/jup-asr-helper/blob/main/.github/workflows/ci.yml) checks types, runs tests, and builds. The deployment repository additionally checks that the committed Pages assets match its source snapshot. Neither check changes Pages settings. GitHub's **pages build and deployment** run publishes [https://jup-asr-helper.github.io/](https://jup-asr-helper.github.io/) when the organization's `main` branch is updated. See GitHub's [publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## License

[MIT](LICENSE) for this project's source. Third-party dependencies retain their respective licenses.

## Support development

If this helper was useful, you can support its development with a voluntary donation.

Solana address:

```text
5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H
```

The page offers **Donate 0.01 SOL** and **Donate 0.05 SOL** after wallet connection. Each is a separate SOL transfer to the address above, plus the network fee. The wallet must approve it. The helper verifies exactly one SOL transfer, its fixed recipient and preset amount, the connected payer, and the signature over the wallet-returned transaction before submitting to [PublicNode's Solana mainnet RPC](https://solana.publicnode.com/). Donations may accept a wallet’s legacy/v0 reserialization, refreshed blockhash, and up to two recognized compute-budget instructions placed before the transfer. Local compute-fee bounds and the final RPC fee must both stay within **0.00005 SOL**. Additional transfers, programs, signers, unapproved accounts, and address lookup tables are rejected. Immediately before submission, the page checks the returned message’s actual fee, current balance, blockhash validity, and unchanged wallet account. OKX donations prefer legacy when supported; other wallets advertising only legacy use it too. ASR claim messages still require byte-for-byte equality. A returned transaction ID is not treated as confirmation; use **Check donation status** or the transaction link. If submission or confirmation is unknown, the donation buttons stay disabled to avoid a duplicate transfer. No automatic resend occurs. See Solana's [submission](https://solana.com/docs/rpc/http/sendtransaction) and [confirmation](https://solana.com/docs/rpc/http/getsignaturestatuses) documentation.

The donation section also reads this address’s latest 20 confirmed transactions and displays up to 10 incoming SOL transfer records, with the sender, exact SOL amount, UTC+8 time, and Solscan transaction link. It includes direct manual transfers to the address. On-chain data cannot prove donation intent; this is a recent-transfer view, not a complete donor ledger. Only explicit successful System Program transfers (including inner instructions) are counted; outgoing transfers, token transfers, and rent-related balance changes are excluded. Refresh manually or after the page confirms a donation. Queries need no wallet connection or signature. Failed or incomplete RPC reads show a notice and do not block claims. See Solana’s [signature history](https://solana.com/docs/rpc/http/getsignaturesforaddress) and [parsed transaction](https://solana.com/docs/rpc/http/gettransaction) documentation.

Donations are voluntary and do not affect claim eligibility. Public RPC availability and rate limits can affect donation buttons; manual transfers in the wallet remain available.

## Disclaimer

This independent community tool is provided as is and is not investment advice. API availability, wallet versions, and individual eligibility may affect claims. Review the network, recipient, amount, and staking operations before signing. This tool cannot reverse confirmed on-chain transfers. Donations are separate from ASR claims.
