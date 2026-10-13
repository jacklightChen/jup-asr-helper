export const SOLANA_MAINNET = 'solana:mainnet';

// Wallet names are discovery hints, not cryptographic proof of the extension's identity.
// Accept the known product names only, and verify the required Wallet Standard features.
export function walletBrand(wallet) {
  if (wallet?.name === 'Phantom') return 'phantom';
  if (typeof wallet?.name === 'string' && /^(?:Binance|Binance Wallet|Binance Web3 Wallet)$/i.test(wallet.name)) return 'binance';
  return null;
}

export function supportedWallets(wallets) {
  return wallets.filter(wallet => walletBrand(wallet) &&
    Array.isArray(wallet.chains) && wallet.chains.includes(SOLANA_MAINNET) &&
    typeof wallet.features?.['standard:connect']?.connect === 'function' &&
    typeof wallet.features?.['solana:signTransaction']?.signTransaction === 'function');
}

export function selectWallet(wallets, previous = null) {
  if (previous && wallets.includes(previous)) return previous;
  return wallets.length === 1 ? wallets[0] : null;
}
