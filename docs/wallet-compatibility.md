# Wallet compatibility review

Reviewed on October 13, 2026 for ASR 2026 Q3.

The tests exercise this helper’s adapter and verifier code with generated keys and the reviewed ASR instruction shape. Wallet Standard fixtures exercise the documented interface contract. They do not run real vendor extensions or mobile wallets. A successful real ASR claim is currently user-confirmed only for Binance Wallet; no real donation was broadcast during this review.

| Wallet | Interface used by the helper | Automated checks |
| --- | --- | --- |
| Binance Wallet | Native Solana Wallet Standard | Standard contract fixture: full ASR signing, donation signing, mainnet account selection and disconnection |
| Phantom | Sign-only Standard feature if provided; otherwise official injected provider | Full ASR fixture; legacy/v0 donation signing; permitted fee/blockhash changes; account changes during signing |
| OKX Wallet | Official injected provider preferred; Standard fallback | Full ASR fixture; native legacy input; legacy/v0 donation output; stale Standard account replacement; account-change event payload |
| Backpack | Sign-only Standard feature; injected provider fallback | Full ASR fixture; legacy/v0 donation signing; permitted fee/blockhash changes; account changes during signing |
| MetaMask | Native Solana Wallet Standard | Standard contract fixture with mainnet genesis chain ID: full ASR and donation signing; account changes; EVM-only and send-only rejection |
| Solflare | Sign-only Standard feature; injected provider fallback | Full ASR fixture; legacy/v0 donation signing; permitted fee/blockhash changes; account changes during signing |
| Trust Wallet | Native `Trust` Standard registration; injected provider fallback | Full ASR fixture; legacy/v0 donation signing; permitted fee/blockhash changes; account changes during signing |

## Claim behavior

Claims require a sign-only `solana:signTransaction` feature and support for Jupiter’s returned transaction version. The full message must remain identical to the prepared Jupiter transaction, and the signer, campaign instructions, staking destinations, reward amount, and signature are verified. The account is checked again after signing. Account changes also invalidate preparation through events and a passive account check.

If a wallet version rewrites an ASR message, the helper stops before `postClaim`. Support for a wallet name does not prove all releases preserve the message or that Jupiter will accept every account. A failed campaign-metadata request disables preparation until the page can load verified campaign data; reconnecting cannot bypass this check. Reward availability is determined by the connected address.

Phantom’s current documentation exposes sign-only operations through the injected provider and states that they are unavailable in its Wallet Standard implementation and may be removed in the future. If no sign-only method is available, this helper cannot use that wallet version. The helper never substitutes `signAndSendTransaction` for an ASR claim.

## Donation behavior

Donations require exactly one System Program transfer of the selected preset to the fixed public recipient. Legacy/v0 reserialization, a refreshed blockhash, and at most one compute-unit limit plus one compute-unit price instruction before that transfer are allowed. The actual returned message is signature-verified and submitted unchanged.

Extra transfers, unknown programs/accounts, changed recipients/amounts/payers, extra signers, address lookup tables, unsupported compute operations, duplicate budgets, invalid signatures, and excess fees are rejected. Both the local compute-fee bound and final RPC fee must be at most 50,000 lamports (0.00005 SOL). Before send, the signed message’s fee, current balance, blockhash validity, and account identity are checked again. A submitted signature remains pending until confirmed on-chain; unknown submission responses never trigger a resend.

Wallets advertising only legacy transactions use legacy donations. OKX also prefers legacy when supported. A wallet with only unsupported transaction formats stops before signing. The helper supports injected signing through actual `Transaction` objects for legacy and `VersionedTransaction` for v0.

## References

- [Solana Wallet Standard signing contract](https://github.com/anza-xyz/wallet-standard/blob/master/packages/core/features/src/signTransaction.ts)
- [Binance Solana provider](https://developers.binance.com/en/docs/products/web3-connect/solana-provider)
- [Phantom sign-only provider and limitations](https://docs.phantom.com/solana/sending-a-transaction)
- [OKX provider and account-change events](https://web3.okx.com/onchainos/dev-docs/wallet/dapp-connect/chains/solana/provider)
- [MetaMask Solana features](https://docs.metamask.io/metamask-connect/solana/reference/methods/)
- [Backpack documentation](https://docs.backpack.app/)
- [Solflare signing SDK](https://docs.solflare.com/solflare/technical/integrate-solflare/solflare-wallet-sdk)
- [Trust Wallet Standard implementation](https://github.com/trustwallet/trust-web3-provider/blob/main/packages/solana/adapter/wallet.ts)
- [RPC fee calculation](https://solana.com/docs/rpc/http/getfeeformessage) and [blockhash validity](https://solana.com/docs/rpc/http/isblockhashvalid)
