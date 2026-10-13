export const SOLANA_MAINNET = 'solana:mainnet';
export const SOLANA_MAINNET_GENESIS = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_CHAINS = [SOLANA_MAINNET, SOLANA_MAINNET_GENESIS];
export const mainnetChain = account => MAINNET_CHAINS.find(chain => account?.chains?.includes(chain)) ?? null;
export const WALLET_CATALOG = Object.freeze([
  { brand: 'binance', name: 'Binance Wallet', url: 'https://www.binance.com/en/web3wallet' },
  { brand: 'phantom', name: 'Phantom', url: 'https://phantom.com/' },
  { brand: 'okx', name: 'OKX Wallet', url: 'https://web3.okx.com/' },
  { brand: 'backpack', name: 'Backpack', url: 'https://backpack.app/' },
  { brand: 'metamask', name: 'MetaMask', url: 'https://metamask.io/' },
  { brand: 'solflare', name: 'Solflare', url: 'https://solflare.com/' },
  { brand: 'trust', name: 'Trust Wallet', url: 'https://trustwallet.com/' },
].map(Object.freeze));

// Wallet names are discovery hints, not cryptographic proof of the extension's identity.
// Accept the known product names only, and verify the required Wallet Standard features.
export function walletBrand(wallet) {
  if (wallet?.name === 'Phantom') return 'phantom';
  if (wallet?.name === 'Backpack') return 'backpack';
  if (wallet?.name === 'Solflare') return 'solflare';
  if (wallet?.name === 'MetaMask') return 'metamask';
  if (typeof wallet?.name === 'string' && /^(?:Trust|Trust Wallet)$/i.test(wallet.name)) return 'trust';
  if (typeof wallet?.name === 'string' && /^(?:OKX|OKX Wallet)$/i.test(wallet.name)) return 'okx';
  if (typeof wallet?.name === 'string' && /^(?:Binance|Binance Wallet|Binance Web3 Wallet)$/i.test(wallet.name)) return 'binance';
  return null;
}

export function supportedWallets(wallets) {
  return wallets.filter(wallet => walletBrand(wallet) &&
    Array.isArray(wallet.chains) && mainnetChain(wallet) &&
    typeof wallet.features?.['standard:connect']?.connect === 'function' &&
    typeof wallet.features?.['solana:signTransaction']?.signTransaction === 'function');
}

export function selectWallet(wallets, previous = null) {
  if (previous && wallets.includes(previous)) return previous;
  return wallets.length === 1 ? wallets[0] : null;
}
