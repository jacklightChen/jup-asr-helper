import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { DONATION_ADDRESS, donationRpc } from './donation.ts';
import { isRecord } from './types.ts';
import type { RpcRequest } from './types.ts';

export const HISTORY_SCAN_LIMIT = 20;
export const HISTORY_DISPLAY_LIMIT = 10;
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export interface DonationRecord { signature: string; sender: string; lamports: bigint; blockTime: number | null; slot: number }
export interface DonationHistory { records: DonationRecord[]; partial: boolean }

function validAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  try { return new PublicKey(address).toBase58() === address; } catch { return false; }
}
function validSignature(signature: unknown): signature is string {
  if (typeof signature !== 'string') return false;
  try { return bs58.decode(signature).length === 64; } catch { return false; }
}
const validSlot = (slot: unknown): slot is number => typeof slot === 'number' && Number.isSafeInteger(slot) && slot >= 0;
const timestamp = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000 ? value : null;

// Parse explicit successful System Program transfers, including CPI transfers.
// Balance changes alone could include rent refunds or other non-donation activity.
export function parseDonationTransaction(value: unknown, signature: string): DonationRecord[] {
  if (!validSignature(signature) || !isRecord(value) || !validSlot(value.slot) || !isRecord(value.meta) || value.meta.err !== null ||
    !isRecord(value.transaction) || !Array.isArray(value.transaction.signatures) || value.transaction.signatures[0] !== signature ||
    !isRecord(value.transaction.message) || !Array.isArray(value.transaction.message.instructions)) {
    throw new Error('Unrecognized donation history transaction');
  }
  const instructions: unknown[] = [...value.transaction.message.instructions];
  if (value.meta.innerInstructions !== null && value.meta.innerInstructions !== undefined) {
    if (!Array.isArray(value.meta.innerInstructions)) throw new Error('Unrecognized inner instructions');
    for (const group of value.meta.innerInstructions) {
      if (!isRecord(group) || !Array.isArray(group.instructions)) throw new Error('Unrecognized inner instructions');
      instructions.push(...group.instructions);
    }
  }
  const slot = value.slot;
  const totals = new Map<string, bigint>();
  for (const instruction of instructions) {
    if (!isRecord(instruction) || instruction.programId !== SYSTEM_PROGRAM || !isRecord(instruction.parsed) ||
      !['transfer', 'transferWithSeed'].includes(String(instruction.parsed.type)) || !isRecord(instruction.parsed.info)) continue;
    const info = instruction.parsed.info;
    if (info.destination !== DONATION_ADDRESS || info.source === DONATION_ADDRESS) continue;
    if (!validAddress(info.source) || typeof info.lamports !== 'number' || !Number.isSafeInteger(info.lamports) || info.lamports <= 0) {
      throw new Error('Unrecognized SOL transfer');
    }
    totals.set(info.source, (totals.get(info.source) ?? 0n) + BigInt(info.lamports));
  }
  return [...totals].map(([sender, lamports]) => ({ signature, sender, lamports, blockTime: timestamp(value.blockTime), slot }));
}

export function formatHistorySol(lamports: bigint): string {
  const whole = lamports / 1000000000n, fractional = (lamports % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : String(whole);
}

export async function loadDonationHistory(rpc: RpcRequest = donationRpc): Promise<DonationHistory> {
  const response = await rpc('getSignaturesForAddress', [DONATION_ADDRESS, { limit: HISTORY_SCAN_LIMIT, commitment: 'confirmed' }]);
  if (!Array.isArray(response) || response.length > HISTORY_SCAN_LIMIT) throw new Error('Unrecognized donation history response');
  const signatures: string[] = [];
  let partial = false;
  for (const value of response) {
    if (!isRecord(value) || !validSignature(value.signature) || !validSlot(value.slot) || !('err' in value)) { partial = true; continue; }
    if (value.err !== null) continue;
    if (!['confirmed', 'finalized'].includes(String(value.confirmationStatus))) { partial = true; continue; }
    if (!signatures.includes(value.signature)) signatures.push(value.signature);
  }
  const records: DonationRecord[] = [];
  let next = 0;
  // Bound parallel requests so opening the page does not flood the public RPC.
  await Promise.all(Array.from({ length: Math.min(3, signatures.length) }, async () => {
    while (next < signatures.length) {
      const signature = signatures[next++];
      try {
        const transaction = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
        records.push(...parseDonationTransaction(transaction, signature));
      } catch { partial = true; }
    }
  }));
  records.sort((a, b) => b.slot - a.slot || a.signature.localeCompare(b.signature) || a.sender.localeCompare(b.sender));
  return { records: records.slice(0, HISTORY_DISPLAY_LIMIT), partial };
}
