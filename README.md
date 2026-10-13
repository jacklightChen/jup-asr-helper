# JUP ASR Helper

[简体中文](README.zh-CN.md) · English · [GitHub repository](https://github.com/jacklightChen/jup-asr-helper) · [Open helper](https://jup-asr-helper.github.io/)

An open-source helper for reviewing a Jupiter ASR claim and requesting a signature with **Binance Wallet or Phantom**. Binance connects through Solana Wallet Standard; Phantom connects through its official injected Solana provider. Open the page in a supported mobile wallet's DApp browser or a desktop browser with its wallet extension. Each visitor connects their own Solana account. This is an independent community project, with no affiliation to Binance, Phantom, or Jupiter.

The GitHub Pages website is [jup-asr-helper.github.io](https://jup-asr-helper.github.io/). On a phone, open that URL inside Binance Wallet or Phantom to connect your wallet.

## Current compatibility

Only the **ASR 2026 Q3** campaign (`asr-2026-q3`) is supported. Its published claim window ends **January 12, 2027 at 14:00 UTC** (22:00 Beijing time). The page reads the live campaign window and stops preparation outside it. See the [official campaign](https://jup.ag/rewards/asr-2026-q3).

**A user confirmed a successful claim through mobile Binance Wallet on October 13, 2026.** This verifies the phone signing and API submission flow for that test. Unsigned claim construction and a Solana RPC simulation also succeeded during development.

| Wallet | Connection | Validation status |
| --- | --- | --- |
| Binance Wallet | Mobile DApp browser; an injected desktop extension if it exposes the required Solana Wallet Standard features | A successful mobile claim was user-confirmed on October 13, 2026; desktop extension claiming has not been tested |
| Phantom | Official injected Solana provider in its mobile in-app browser or desktop extension | Adapter verification uses generated test transactions and the same signature checks; no live Phantom claim has been confirmed yet |

Binance discovery requires Solana mainnet support and the `standard:connect` and `solana:signTransaction` features. Phantom discovery checks `window.phantom.solana.isPhantom` and requires the injected provider's `connect` and `signTransaction` methods. When multiple supported wallets are detected, choose one in the page's wallet selector before connecting. See the official [Binance Solana interface documentation](https://developers.binance.com/en/docs/products/web3-connect/solana-provider) and [Phantom provider detection documentation](https://docs.phantom.com/solana/detecting-the-provider).

Phantom's current Wallet Standard interface does not expose sign-only `signTransaction`; its [official injected provider does](https://docs.phantom.com/solana/sending-a-transaction). This helper adapts that provider for legacy and v0 transactions, verifies the returned signature and unchanged message locally, then submits through Jupiter's `postClaim`. It does not use Phantom's direct sign-and-send route. The implementation follows the provider pattern in the [Phantom wallet adapter](https://github.com/anza-xyz/wallet-adapter/blob/master/packages/wallets/phantom/src/adapter.ts). If sign-only support is unavailable in an installed wallet version, signing is not enabled.

The campaign metadata currently sets `onlyClaimableThroughJup: true`. The page displays this official flag alongside the reported Binance Wallet success. It uses the wallet's real account and signature, without impersonating Jupiter Wallet or altering eligibility. API availability, wallet versions, and individual eligibility can still affect later claims.

Rewards are **Staked JUP**, added to your staking account. The reviewed transaction may create a staking account and enable continuous staking (`max lock`). To withdraw later, disable continuous staking and wait the required **7 days**. Check the actual transaction and current [Jupiter staking page](https://vote.jup.ag/) before signing.

## Use with your wallet

1. On a phone, open the published site's HTTPS URL in **Binance Wallet's DApp browser** or **Phantom's in-app browser**. On desktop, open it in a browser with a supported wallet extension enabled. Menu names can differ by app version. An ordinary browser without an injected supported wallet cannot connect.
2. Select **English / 简体中文**, choose the desired wallet if multiple wallets are detected, then select **Connect wallet**. Authorize the Solana account that earned the reward; the page reads that account's allocation.
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

No seed phrase, private key, Binance exchange API key, or Reown Project ID is needed. The frontend has no analytics or application backend. It stores only the selected interface language in `localStorage`; wallet connection and transaction state remain in page memory. Jupiter receives the public wallet address for queries and the signed transaction when the user submits it. Hosting and API providers can retain their own request logs. The repository contains no personal claim allocation or signed transaction. The voluntary donation address below is intentionally public.

## Develop

Use Node.js 24 and npm. Install the locked dependencies, run the transaction checks, and build the static site:

```sh
npm ci
npm test
npm run build
```

The build emits `dist/index.html`, `dist/app.js`, and `dist/style.css`. Run `npm run build:pages` to also refresh the committed `index.html`, `app.js`, `style.css`, and `.nojekyll` at the repository root before publishing changes. Asset references use `./`, so the site works at the organization homepage or under a GitHub Pages project path. To preview the layout locally:

```sh
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080` on the development computer. A supported desktop extension may inject its wallet on localhost. For a real mobile wallet connection, deploy to HTTPS and open that URL inside Binance Wallet or Phantom; a phone's `localhost` is the phone itself. Tests do not request a real wallet signature or broadcast a transaction.

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

For a future ASR campaign, review the new metadata, contract/distributor addresses, instruction layouts, account derivations, fee/rent assumptions, and tests before changing the campaign. Changing only the slug is insufficient. The supported constants live in [`src/transaction.mjs`](src/transaction.mjs), and the API selection and wallet flow live in [`src/app.mjs`](src/app.mjs).

## GitHub Pages

Source is maintained at [`jacklightChen/jup-asr-helper`](https://github.com/jacklightChen/jup-asr-helper). The website is published from [`jup-asr-helper/jup-asr-helper.github.io`](https://github.com/jup-asr-helper/jup-asr-helper.github.io), using its preserved **Deploy from a branch → `main` → `/ (root)`** configuration. No custom domain or deployment secret is required. Other GitHub Pages settings are unchanged.

Before releasing a change, run `npm test` and `npm run build`, then commit and push the source to `jacklightChen/jup-asr-helper`. Copy `dist/index.html`, `dist/app.js`, and `dist/style.css` to the root of a separate checkout of the organization homepage repository. Keep its `.nojekyll` file, commit the updated assets there, and push its `main` branch. `npm run build:pages` is also available to refresh the root assets in the deployment checkout.

The source [CI workflow](https://github.com/jacklightChen/jup-asr-helper/blob/main/.github/workflows/ci.yml) runs tests and builds. The deployment repository additionally checks that the committed Pages assets match its source snapshot. Neither check changes Pages settings. GitHub's **pages build and deployment** run publishes [https://jup-asr-helper.github.io/](https://jup-asr-helper.github.io/) when the organization's `main` branch is updated. See GitHub's [publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## License

[MIT](LICENSE) for this project's source. Third-party dependencies retain their respective licenses.

## Support development

If this helper was useful, you can support its development with a voluntary donation.

Solana address:

```text
5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H
```

Donations are optional and separate from ASR claims.
