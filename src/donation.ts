import { PublicKey, SystemProgram, SystemInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { sameBytes } from './transaction.ts';
import { LocalizedError } from './i18n.ts';
import { isRecord } from './types.ts';
import type { RpcRequest, SignaturePreparation } from './types.ts';

export const DONATION_ADDRESS = '5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H';
export const DONATION_AMOUNTS = Object.freeze({ '0.01': 10000000n, '0.05': 50000000n });
export const MAX_DONATION_FEE = 50000;
export const DONATION_RPC = 'https://solana-rpc.publicnode.com';
export type DonationAmount = keyof typeof DONATION_AMOUNTS;
export type DonationStatus = 'pending' | 'failed' | 'confirmed';
export interface PreparedDonation extends SignaturePreparation {
  amount: DonationAmount;
  fee: number;
  lastValidBlockHeight: number;
}
export interface DonationReceipt { amount: DonationAmount; signature: string; status: DonationStatus }
export interface VerifiedDonation { readonly signedTx: string; readonly signature: string }
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

// A wallet may rebuild a simple donation while signing. Check the transfer intent
// and a bounded compute budget instead of applying the ASR byte-for-byte rule.
function assertDonationIntent(tx: VersionedTransaction, address: string, amount: DonationAmount, allowFees = true) {
  if (!approvedAmount(amount) || tx.message.header.numRequiredSignatures !== 1 || tx.signatures.length !== 1 ||
    tx.message.header.numReadonlySignedAccounts !== 0 || tx.message.staticAccountKeys[0]?.toBase58() !== address ||
    (tx.message.addressTableLookups ?? []).length) throw new LocalizedError('errorDonationPayer');
  const computeProgram = 'ComputeBudget111111111111111111111111111111';
  const allowedKeys = new Set([address, DONATION_ADDRESS, SystemProgram.programId.toBase58(), computeProgram]);
  const keys = tx.message.staticAccountKeys.map(key => key.toBase58());
  if (new Set(keys).size !== keys.length) throw new LocalizedError('errorDonationExtraOperation');
  const { instructions } = TransactionMessage.decompile(tx.message);
  let transfers = 0, computeUnits = 200000, unitPrice = 0n;
  const seen = new Set<number>();
  for (const instruction of instructions) {
    const programIndex = keys.indexOf(instruction.programId.toBase58());
    if (tx.message.isAccountWritable(programIndex) || tx.message.isAccountSigner(programIndex)) throw new LocalizedError('errorDonationExtraOperation');
    if (instruction.programId.toBase58() === computeProgram) {
      const tag = instruction.data[0];
      if (!allowFees || transfers || instruction.keys.length || seen.has(tag)) throw new LocalizedError('errorDonationExtraOperation');
      if (tag === 2 && instruction.data.length === 5) {
        computeUnits = instruction.data.readUInt32LE(1);
        if (computeUnits <= 0 || computeUnits > 1400000) throw new LocalizedError('errorDonationFee');
      } else if (tag === 3 && instruction.data.length === 9) unitPrice = instruction.data.readBigUInt64LE(1);
      else throw new LocalizedError('errorDonationExtraOperation');
      seen.add(tag); continue;
    }
    if (!instruction.programId.equals(SystemProgram.programId) || transfers || instruction.keys.length !== 2 ||
      instruction.data.length !== 12) throw new LocalizedError('errorDonationExtraOperation');
    let transfer;
    try { transfer = SystemInstruction.decodeTransfer(instruction); }
    catch { throw new LocalizedError('errorDonationExtraOperation'); }
    if (transfer.fromPubkey.toBase58() !== address || !instruction.keys[0].isSigner ||
      !instruction.keys[0].isWritable || !instruction.keys[1].isWritable) throw new LocalizedError('errorDonationPayer');
    if (transfer.toPubkey.toBase58() !== DONATION_ADDRESS || BigInt(transfer.lamports) !== DONATION_AMOUNTS[amount]) {
      throw new LocalizedError('errorDonationDestination');
    }
    transfers++;
  }
  if (transfers !== 1 || keys.some(key => !allowedKeys.has(key))) throw new LocalizedError('errorDonationExtraOperation');
  // 200k is a conservative default upper bound for this single built-in transfer
  // when a wallet omits SetComputeUnitLimit. Query the actual fee again before send.
  const feeBound = 5000n + (BigInt(computeUnits) * unitPrice + 999999n) / 1000000n;
  if (feeBound > BigInt(MAX_DONATION_FEE)) throw new LocalizedError('errorDonationFee');
}

function checkFunds(feeResult: unknown, balanceResult: unknown, amount: DonationAmount): number {
  const fee = isRecord(feeResult) ? feeResult.value : null, balance = isRecord(balanceResult) ? balanceResult.value : null;
  if (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0 || fee > MAX_DONATION_FEE) throw new LocalizedError('errorDonationFee');
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) throw new LocalizedError('errorDonationTransaction');
  const required = DONATION_AMOUNTS[amount] + BigInt(fee);
  if (BigInt(balance) < required) throw new LocalizedError('errorDonationBalance', {
    balance: (balance / 1e9).toFixed(9), required: (Number(required) / 1e9).toFixed(9),
  });
  return fee;
}

export async function prepareDonation(address: string, amount: string, rpc: RpcRequest = donationRpc, version: 'legacy' | 0 = 0): Promise<PreparedDonation> {
  if (!approvedAmount(amount)) throw new LocalizedError('errorDonationTransaction');
  const blockResult = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const block = isRecord(blockResult) ? blockResult.value : null;
  if (!isRecord(block) || typeof block.blockhash !== 'string' || typeof block.lastValidBlockHeight !== 'number' ||
    !Number.isSafeInteger(block.lastValidBlockHeight) || block.lastValidBlockHeight <= 0) throw new LocalizedError('errorDonationTransaction');
  const user = new PublicKey(address);
  const builder = new TransactionMessage({ payerKey: user, recentBlockhash: block.blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(DONATION_ADDRESS), lamports: DONATION_AMOUNTS[amount] })]
  });
  const tx = new VersionedTransaction(version === 'legacy' ? builder.compileToLegacyMessage() : builder.compileToV0Message());
  assertDonationIntent(tx, address, amount, false);
  const message = Uint8Array.from(tx.message.serialize());
  const [feeResult, balanceResult] = await Promise.all([
    rpc('getFeeForMessage', [Buffer.from(message).toString('base64'), { commitment: 'confirmed' }]),
    rpc('getBalance', [address, { commitment: 'confirmed' }]),
  ]);
  const fee = checkFunds(feeResult, balanceResult, amount);
  return { tx, bytes: Uint8Array.from(tx.serialize()), message, signerIndex: 0, amount, fee, lastValidBlockHeight: block.lastValidBlockHeight };
}

export function verifyDonationSigned(prepared: Pick<PreparedDonation, 'amount'>, signedBytes: unknown, address: string): VerifiedDonation {
  if (!(signedBytes instanceof Uint8Array) || !signedBytes.length || signedBytes.length > 1232) throw new LocalizedError('errorDonationTransaction');
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(signedBytes); }
  catch { throw new LocalizedError('errorDonationTransaction'); }
  if (!sameBytes(tx.serialize(), signedBytes)) throw new LocalizedError('errorDonationTransaction');
  assertDonationIntent(tx, address, prepared.amount);
  if (!nacl.sign.detached.verify(tx.message.serialize(), tx.signatures[0], new PublicKey(address).toBytes())) {
    throw new LocalizedError('errorDonationSignature');
  }
  // Submit exactly what the user approved and signed, including validated fee or
  // blockhash updates. Replacing its message with the original would break signing.
  return Object.freeze({ signedTx: Buffer.from(tx.serialize()).toString('base64'), signature: bs58.encode(tx.signatures[0]) });
}

export async function checkDonationNetwork(verified: VerifiedDonation, address: string, amount: DonationAmount, rpc: RpcRequest = donationRpc): Promise<number> {
  const checked = verifyDonationSigned({ amount }, Uint8Array.from(Buffer.from(verified.signedTx, 'base64')), address);
  if (checked.signature !== verified.signature || checked.signedTx !== verified.signedTx) throw new LocalizedError('errorDonationSignature');
  const tx = VersionedTransaction.deserialize(Buffer.from(checked.signedTx, 'base64'));
  const [feeResult, balanceResult, blockResult] = await Promise.all([
    rpc('getFeeForMessage', [Buffer.from(tx.message.serialize()).toString('base64'), { commitment: 'confirmed' }]),
    rpc('getBalance', [address, { commitment: 'confirmed' }]),
    rpc('isBlockhashValid', [tx.message.recentBlockhash, { commitment: 'confirmed' }]),
  ]);
  if (!isRecord(blockResult) || blockResult.value !== true) throw new LocalizedError('errorDonationExpired');
  return checkFunds(feeResult, balanceResult, amount);
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
