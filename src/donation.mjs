import { PublicKey, SystemProgram, SystemInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { verifySignedTransaction } from './transaction.mjs';
import { LocalizedError } from './i18n.mjs';

export const DONATION_ADDRESS = '5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H';
export const DONATION_AMOUNTS = Object.freeze({ '0.01': 10000000n, '0.05': 50000000n });
export const DONATION_RPC = 'https://solana-rpc.publicnode.com';

export async function donationRpc(method, params = [], fetcher = fetch) {
  let response, data;
  try {
    response = await fetcher(DONATION_RPC, { method: 'POST', credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
    data = await response.json();
  } catch { throw new LocalizedError('errorDonationRpc', { detail: '' }); }
  if (!response.ok || data.error || data.jsonrpc !== '2.0' || data.id !== 1 || !('result' in data)) {
    throw new LocalizedError('errorDonationRpc', { detail: String(data.error?.message ?? response.status).slice(0, 200) });
  }
  return data.result;
}

function assertTransfer(tx, address, amount) {
  try {
    if (!Object.hasOwn(DONATION_AMOUNTS, amount) || tx.message.header.numRequiredSignatures !== 1 ||
      tx.message.staticAccountKeys[0].toBase58() !== address || (tx.message.addressTableLookups ?? []).length) throw new Error();
    const { instructions } = TransactionMessage.decompile(tx.message);
    if (instructions.length !== 1) throw new Error();
    const transfer = SystemInstruction.decodeTransfer(instructions[0]);
    if (transfer.fromPubkey.toBase58() !== address || transfer.toPubkey.toBase58() !== DONATION_ADDRESS ||
      BigInt(transfer.lamports) !== DONATION_AMOUNTS[amount]) throw new Error();
  } catch { throw new LocalizedError('errorDonationTransaction'); }
}

export async function prepareDonation(address, amount, rpc = donationRpc) {
  if (!Object.hasOwn(DONATION_AMOUNTS, amount)) throw new LocalizedError('errorDonationTransaction');
  const block = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]))?.value;
  if (!block || !Number.isSafeInteger(block.lastValidBlockHeight) || block.lastValidBlockHeight <= 0) throw new LocalizedError('errorDonationTransaction');
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
  const fee = feeResult?.value, balance = balanceResult?.value;
  if (!Number.isSafeInteger(fee) || fee < 0 || fee > 50000) throw new LocalizedError('errorDonationFee');
  if (!Number.isSafeInteger(balance) || balance < 0 || BigInt(balance) < DONATION_AMOUNTS[amount] + BigInt(fee)) throw new LocalizedError('errorDonationBalance');
  return { tx, bytes: Uint8Array.from(tx.serialize()), message, signerIndex: 0, amount, fee, lastValidBlockHeight: block.lastValidBlockHeight };
}

export function verifyDonationSigned(prepared, signedBytes, address) {
  const signedTx = verifySignedTransaction(prepared, signedBytes, address);
  const tx = VersionedTransaction.deserialize(Buffer.from(signedTx, 'base64'));
  assertTransfer(tx, address, prepared.amount);
  return { signedTx, signature: bs58.encode(tx.signatures[0]) };
}

export async function submitDonation(verified, rpc = donationRpc) {
  const signature = await rpc('sendTransaction', [verified.signedTx, {
    encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
  }]);
  if (signature !== verified.signature) throw new LocalizedError('errorDonationTransaction');
  return signature;
}

export async function donationStatus(signature, rpc = donationRpc) {
  const response = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  if (!Array.isArray(response?.value) || response.value.length !== 1) throw new LocalizedError('errorDonationTransaction');
  const status = response.value[0];
  if (!status) return 'pending';
  if (status.err) return 'failed';
  return ['confirmed', 'finalized'].includes(status.confirmationStatus) ? 'confirmed' : 'pending';
}
