import { PublicKey, SystemProgram, SystemInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { verifySignedTransaction } from './transaction.ts';
import { LocalizedError } from './i18n.ts';
import { isRecord } from './types.ts';
import type { RpcRequest, SignaturePreparation } from './types.ts';

export const DONATION_ADDRESS = '5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H';
export const DONATION_AMOUNTS = Object.freeze({ '0.01': 10000000n, '0.05': 50000000n });
export const DONATION_RPC = 'https://solana-rpc.publicnode.com';
export type DonationAmount = keyof typeof DONATION_AMOUNTS;
export type DonationStatus = 'pending' | 'failed' | 'confirmed';
export interface PreparedDonation extends SignaturePreparation {
  amount: DonationAmount;
  fee: number;
  lastValidBlockHeight: number;
}
export interface DonationReceipt { amount: DonationAmount; signature: string; status: DonationStatus }
export interface VerifiedDonation { signedTx: string; signature: string }
const approvedAmount = (amount: string): amount is DonationAmount => Object.hasOwn(DONATION_AMOUNTS, amount);

export async function donationRpc(method: string, params: readonly unknown[] = [], fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response, data: unknown;
  try {
    response = await fetcher(DONATION_RPC, { method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
    data = await response.json();
  } catch { throw new LocalizedError('errorDonationRpc', { detail: '' }); }
  if (!response.ok || !isRecord(data) || data.error || data.jsonrpc !== '2.0' || data.id !== 1 || !('result' in data)) {
    const error = isRecord(data) && isRecord(data.error) ? data.error.message : response.status;
    throw new LocalizedError('errorDonationRpc', { detail: String(error).slice(0, 200) });
  }
  return data.result;
}

function assertTransfer(tx: VersionedTransaction, address: string, amount: DonationAmount) {
  try {
    if (!approvedAmount(amount) || tx.message.header.numRequiredSignatures !== 1 ||
      tx.message.staticAccountKeys[0].toBase58() !== address || (tx.message.addressTableLookups ?? []).length) throw new Error();
    const { instructions } = TransactionMessage.decompile(tx.message);
    if (instructions.length !== 1) throw new Error();
    const transfer = SystemInstruction.decodeTransfer(instructions[0]);
    if (transfer.fromPubkey.toBase58() !== address || transfer.toPubkey.toBase58() !== DONATION_ADDRESS ||
      BigInt(transfer.lamports) !== DONATION_AMOUNTS[amount]) throw new Error();
  } catch { throw new LocalizedError('errorDonationTransaction'); }
}

export async function prepareDonation(address: string, amount: string, rpc: RpcRequest = donationRpc): Promise<PreparedDonation> {
  if (!approvedAmount(amount)) throw new LocalizedError('errorDonationTransaction');
  const blockResult = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const block = isRecord(blockResult) ? blockResult.value : null;
  if (!isRecord(block) || typeof block.blockhash !== 'string' || typeof block.lastValidBlockHeight !== 'number' ||
    !Number.isSafeInteger(block.lastValidBlockHeight) || block.lastValidBlockHeight <= 0) throw new LocalizedError('errorDonationTransaction');
  const user = new PublicKey(address);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: block.blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(DONATION_ADDRESS), lamports: DONATION_AMOUNTS[amount] })]
  }).compileToV0Message());
  assertTransfer(tx, address, amount);
  const message = Uint8Array.from(tx.message.serialize());
  const [feeResult, balanceResult] = await Promise.all([
    rpc('getFeeForMessage', [Buffer.from(message).toString('base64'), { commitment: 'confirmed' }]),
    rpc('getBalance', [address, { commitment: 'confirmed' }]),
  ]);
  const fee = isRecord(feeResult) ? feeResult.value : null, balance = isRecord(balanceResult) ? balanceResult.value : null;
  if (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0 || fee > 50000) throw new LocalizedError('errorDonationFee');
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0 ||
    BigInt(balance) < DONATION_AMOUNTS[amount] + BigInt(fee)) throw new LocalizedError('errorDonationBalance');
  return { tx, bytes: Uint8Array.from(tx.serialize()), message, signerIndex: 0, amount, fee, lastValidBlockHeight: block.lastValidBlockHeight };
}

export function verifyDonationSigned(prepared: PreparedDonation, signedBytes: unknown, address: string): VerifiedDonation {
  const signedTx = verifySignedTransaction(prepared, signedBytes, address);
  const tx = VersionedTransaction.deserialize(Buffer.from(signedTx, 'base64'));
  assertTransfer(tx, address, prepared.amount);
  return { signedTx, signature: bs58.encode(tx.signatures[0]) };
}

export async function submitDonation(verified: VerifiedDonation, rpc: RpcRequest = donationRpc) {
  const signature = await rpc('sendTransaction', [verified.signedTx, {
    encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
  }]);
  if (signature !== verified.signature) throw new LocalizedError('errorDonationTransaction');
  return verified.signature;
}

export async function donationStatus(signature: string, rpc: RpcRequest = donationRpc): Promise<DonationStatus> {
  const response = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  if (!isRecord(response) || !Array.isArray(response.value) || response.value.length !== 1) throw new LocalizedError('errorDonationTransaction');
  const status: unknown = response.value[0];
  if (status === null) return 'pending';
  if (!isRecord(status) || !('err' in status)) throw new LocalizedError('errorDonationTransaction');
  if (status.err) return 'failed';
  if (typeof status.confirmationStatus !== 'string') throw new LocalizedError('errorDonationTransaction');
  return ['confirmed', 'finalized'].includes(status.confirmationStatus) ? 'confirmed' : 'pending';
}
