import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { DONATION_ADDRESS } from '../src/donation.ts';
import { parseDonationTransaction, loadDonationHistory, formatHistorySol } from '../src/donation-history.ts';

const sender = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();
const signature = n => bs58.encode(new Uint8Array(64).fill(n));
const transfer = (source = sender, destination = DONATION_ADDRESS, lamports = 10000000) => ({
  programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source, destination, lamports } },
});
const transaction = (n, instructions, innerInstructions = null) => ({ slot: n,
  blockTime: 1791864000, meta: { err: null, innerInstructions },
  transaction: { signatures: [signature(n)], message: { instructions } },
});
const signatureInfo = n => ({ signature: signature(n), slot: n, err: null, confirmationStatus: 'confirmed' });

test('history aggregates confirmed explicit SOL transfers by sender including inner instructions', () => {
  const tx = transaction(1, [transfer(), transfer(sender, DONATION_ADDRESS, 1)], [
    { index: 0, instructions: [transfer(sender, DONATION_ADDRESS, 50000000), transfer(other, DONATION_ADDRESS, 20000000)] },
  ]);
  const records = parseDonationTransaction(tx, signature(1));
  assert.equal(records.length, 2);
  assert.equal(records[0].sender, sender);
  assert.equal(records[0].lamports, 60000001n);
  assert.equal(records[1].lamports, 20000000n);
  assert.equal(records[0].signature, signature(1));
  assert.equal(records[0].blockTime, tx.blockTime);
});

test('history excludes outgoing, self, token transfers and rent-related balance changes', () => {
  const token = { ...transfer(), programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
  const rent = { ...transfer(), parsed: { type: 'createAccount', info: { source: sender, newAccount: DONATION_ADDRESS, lamports: 12345 } } };
  const tx = transaction(2, [transfer(DONATION_ADDRESS, other), transfer(DONATION_ADDRESS), transfer(sender, other), token, rent]);
  tx.meta.postBalances = [100000000]; // A balance increase alone is not an explicit transfer.
  assert.deepEqual(parseDonationTransaction(tx, signature(2)), []);
});

test('history rejects failed or mismatched transactions and malformed transfer amounts', () => {
  const failed = transaction(3, [transfer()]); failed.meta.err = { InstructionError: [0, 'bad'] };
  assert.throws(() => parseDonationTransaction(failed, signature(3)));
  assert.throws(() => parseDonationTransaction(transaction(3, [transfer()]), signature(4)));
  assert.throws(() => parseDonationTransaction(null, signature(3)));
  for (const amount of [-1, 0, '10000000', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseDonationTransaction(transaction(3, [transfer(sender, DONATION_ADDRESS, amount)]), signature(3)));
  }
  assert.throws(() => parseDonationTransaction(transaction(3, [transfer('invalid')]), signature(3)));
  assert.throws(() => parseDonationTransaction(transaction(3, [transfer()]), '../fake'));
});

test('history supports transferWithSeed, unknown timestamps, and exact lamport formatting', () => {
  const instruction = transfer(); instruction.parsed.type = 'transferWithSeed';
  const tx = transaction(4, [instruction]); tx.blockTime = null;
  assert.equal(parseDonationTransaction(tx, signature(4))[0].blockTime, null);
  tx.blockTime = Number.MAX_SAFE_INTEGER;
  assert.equal(parseDonationTransaction(tx, signature(4))[0].blockTime, null);
  assert.equal(formatHistorySol(1n), '0.000000001');
  assert.equal(formatHistorySol(10000000n), '0.01');
  assert.equal(formatHistorySol(50000000n), '0.05');
  assert.equal(formatHistorySol(9007199254740993n), '9007199.254740993');
});

test('history limits scan, concurrency and display, filters failed signatures and sorts newest first', async () => {
  let active = 0, peak = 0, calls = 0;
  const rpc = async (method, params) => {
    if (method === 'getSignaturesForAddress') {
      assert.deepEqual(params, [DONATION_ADDRESS, { limit: 20, commitment: 'confirmed' }]);
      return Array.from({ length: 20 }, (_, i) => signatureInfo(i + 1));
    }
    assert.equal(method, 'getTransaction');
    assert.deepEqual(params[1], { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const n = bs58.decode(params[0])[0];
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return transaction(n, [transfer()]);
  };
  const result = await loadDonationHistory(rpc);
  assert.equal(calls, 20); assert.equal(peak, 3); assert.equal(result.partial, false);
  assert.deepEqual(result.records.map(record => record.slot), [20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
});

test('history distinguishes empty, partial and failed RPC results without fabricating records', async () => {
  assert.deepEqual(await loadDonationHistory(async () => []), { records: [], partial: false });
  const result = await loadDonationHistory(async (method, params) => {
    if (method === 'getSignaturesForAddress') return [signatureInfo(1), signatureInfo(2), signatureInfo(1),
      { ...signatureInfo(3), err: { InstructionError: [0, 'bad'] } },
      { ...signatureInfo(4), confirmationStatus: 'processed' }, { signature: 'malformed' }];
    if (params[0] === signature(2)) throw new Error('RPC unavailable');
    assert.equal(params[0], signature(1));
    return transaction(1, [transfer()]);
  });
  assert.equal(result.partial, true); assert.equal(result.records.length, 1);
  await assert.rejects(loadDonationHistory(async () => { throw new Error('unavailable'); }));
  await assert.rejects(loadDonationHistory(async () => ({ result: [] })));
  const pending = await loadDonationHistory(async method => method === 'getSignaturesForAddress' ? [signatureInfo(1)] : null);
  assert.deepEqual(pending, { records: [], partial: true });
});
