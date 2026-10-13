import type { InjectedProvider, WalletAccount, SolanaWallet } from './types.ts';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { SOLANA_MAINNET } from './wallets.ts';
import { LocalizedError } from './i18n.ts';

// Phantom's injected provider supports sign-only transactions. Its current
// Wallet Standard interface supports sign-and-send, which would skip postClaim.
// Adapt the official provider so every signature still passes our verifier and
// only Jupiter's postClaim endpoint submits the transaction.
export function phantomAccount(provider: InjectedProvider | null | undefined): WalletAccount | null {
  if (!provider?.publicKey) return null;
  try {
    const key = new PublicKey(provider.publicKey.toString());
    return { address: key.toBase58(), publicKey: Uint8Array.from(key.toBytes()),
      chains: [SOLANA_MAINNET], features: ['solana:signTransaction'] };
  } catch { return null; }
}
export function matchesPhantomAccount(provider: InjectedProvider, account: WalletAccount, chain: string | null) {
  const current = phantomAccount(provider);
  return chain === SOLANA_MAINNET && !!current && current.address === account?.address &&
    account.publicKey?.length === current.publicKey.length && current.publicKey.every((value, index) => value === account.publicKey[index]);
}
export function createPhantomWallet(provider: InjectedProvider | null | undefined) {
  return provider?.isPhantom === true ? createInjectedWallet(provider, 'Phantom') : null;
}
export function createInjectedWallet(provider: InjectedProvider | null | undefined, name: string): SolanaWallet | null {
  if (!['Phantom', 'OKX Wallet', 'Backpack', 'Solflare', 'Trust Wallet'].includes(name) ||
    typeof provider?.connect !== 'function' || typeof provider?.signTransaction !== 'function') return null;
  const connect = provider.connect.bind(provider), sign = provider.signTransaction.bind(provider);
  let disconnected = false;
  const currentAccount = () => disconnected ? null : phantomAccount(provider);
  return {
    name,
    chains: [SOLANA_MAINNET],
    get accounts() { const account = currentAccount(); return account ? [account] : []; },
    features: {
      'standard:connect': {
        version: '1.0.0',
        async connect() {
          await connect(); disconnected = false;
          const account = currentAccount();
          return { accounts: account ? [account] : [] };
        },
      },
      'solana:signTransaction': {
        version: '1.0.0', supportedTransactionVersions: ['legacy', 0],
        async signTransaction({ account, chain, transaction }) {
          const current = currentAccount();
          if (!current || !matchesPhantomAccount(provider, account, chain)) throw new LocalizedError('errorAccountChanged');
          const decoded = VersionedTransaction.deserialize(transaction);
          const unsigned = decoded.version === 'legacy' ? Transaction.from(transaction) : decoded;
          const signed = (await sign(unsigned)) ?? unsigned;
          if (!currentAccount() || !matchesPhantomAccount(provider, account, chain)) throw new LocalizedError('errorAccountChangedSigning');
          return [{ signedTransaction: Uint8Array.from(signed.serialize()) }];
        },
      },
      'standard:events': {
        version: '1.0.0',
        on(event, listener) {
          if (event !== 'change' || typeof provider.on !== 'function') return () => {};
          const changed = (key?: unknown) => {
            const account = key === undefined ? currentAccount() : phantomAccount({ publicKey: { toString: () => String(key) } });
            listener({ accounts: account ? [account] : [] });
          };
          const disconnectedEvent = () => { disconnected = true; listener({ accounts: [] }); };
          provider.on('accountChanged', changed); provider.on('disconnect', disconnectedEvent);
          return () => {
            const remove = provider.removeListener ?? provider.off;
            if (typeof remove === 'function') { remove.call(provider, 'accountChanged', changed); remove.call(provider, 'disconnect', disconnectedEvent); }
          };
        },
      },
    },
  };
}
