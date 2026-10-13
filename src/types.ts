import type { VersionedTransaction, Transaction } from '@solana/web3.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export interface WalletAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly string[];
  readonly features: readonly string[];
}
export function isWalletAccount(value: unknown): value is WalletAccount {
  return isRecord(value) && typeof value.address === 'string' && value.publicKey instanceof Uint8Array && value.publicKey.length === 32 &&
    Array.isArray(value.chains) && value.chains.every(chain => typeof chain === 'string') &&
    Array.isArray(value.features) && value.features.every(feature => typeof feature === 'string');
}
export interface SolanaWallet {
  readonly name: string;
  readonly chains: readonly string[];
  readonly accounts: readonly WalletAccount[];
  readonly features: {
    'standard:connect': { connect(): Promise<{ accounts: readonly WalletAccount[] }>; version?: string };
    'solana:signTransaction': {
      version?: string;
      supportedTransactionVersions?: readonly ('legacy' | 0 | 1)[];
      signTransaction(input: { account: WalletAccount; chain: string | null; transaction: Uint8Array }): Promise<readonly { signedTransaction: Uint8Array }[]>;
    };
    'standard:events'?: {
      version?: string;
      on(event: 'change', listener: (change: { accounts?: readonly WalletAccount[] }) => void): () => void;
    };
  };
}
export interface InjectedProvider {
  publicKey?: { toString(): string } | null;
  isPhantom?: boolean;
  isBackpack?: boolean;
  isSolflare?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  connect?(): Promise<unknown>;
  signTransaction?(transaction: Transaction | VersionedTransaction): Promise<{ serialize(): Uint8Array } | void>;
  on?(event: string, listener: (key?: unknown) => void): void;
  off?(event: string, listener: (key?: unknown) => void): void;
  removeListener?(event: string, listener: (key?: unknown) => void): void;
}
export interface SignaturePreparation {
  tx: VersionedTransaction;
  bytes: Uint8Array;
  message: Uint8Array;
  signerIndex: number;
}
export type RpcRequest = (method: string, params?: readonly unknown[]) => Promise<unknown>;
export interface Campaign {
  claimStartsAt: string;
  claimEndsAt: string;
  reward: { onlyClaimableThroughJup?: unknown };
}
export interface RewardStats {
  unclaimedAmount: number;
  claimedAmount: number;
}
declare global {
  interface Window {
    phantom?: { solana?: InjectedProvider };
    okxwallet?: { solana?: InjectedProvider };
    backpack?: InjectedProvider;
    solflare?: InjectedProvider;
    trustwallet?: { solana?: InjectedProvider };
    solana?: InjectedProvider;
  }
}
