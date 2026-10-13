import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { DONATION_ADDRESS, prepareDonation, verifyDonationSigned, submitDonation, donationStatus, donationRpc } from '../src/donation.ts';

const hash = Keypair.generate().publicKey.toBase58();
const mockRpc = (fee = 5000, balance = 100000000) => async method => {
  if (method === 'getLatestBlockhash') return { value: { blockhash: hash, lastValidBlockHeight: 1234 } };
  if (method === 'getFeeForMessage') return { value: fee };
  if (method === 'getBalance') return { value: balance };
  throw new Error('Unexpected RPC method');
};

for (const amount of ['0.01', '0.05']) {
  test(`donation ${amount} SOL contains only the fixed-recipient transfer and verifies wallet output`, async () => {
    const user = Keypair.generate();
    const prepared = await prepareDonation(user.publicKey.toBase58(), amount, mockRpc());
    const { instructions } = TransactionMessage.decompile(prepared.tx.message);
    assert.equal(instructions.length, 1);
    const transfer = SystemInstruction.decodeTransfer(instructions[0]);
    assert.equal(transfer.toPubkey.toBase58(), DONATION_ADDRESS);
    assert.equal(BigInt(transfer.lamports), amount === '0.01' ? 10000000n : 50000000n);
    assert.equal(prepared.tx.message.header.numRequiredSignatures, 1);
    assert.equal(prepared.fee, 5000);
    const signed = VersionedTransaction.deserialize(prepared.bytes); signed.sign([user]);
    const verified = verifyDonationSigned(prepared, signed.serialize(), user.publicKey.toBase58());
    assert.match(verified.signature, /^[1-9A-HJ-NP-Za-km-z]{80,100}$/);
    signed.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); signed.sign([user]);
    assert.throws(() => verifyDonationSigned(prepared, signed.serialize(), user.publicKey.toBase58()), /交易内容发生变化/);
  });
}

test('unapproved amounts, excessive/unknown fees and insufficient balance stop before signing', async () => {
  const address = Keypair.generate().publicKey.toBase58();
  for (const amount of ['1', '0.1', '__proto__', '0.010']) {
    await assert.rejects(prepareDonation(address, amount, () => { throw new Error('must not call RPC'); }), { key: 'errorDonationTransaction' });
  }
  await assert.rejects(prepareDonation(address, '0.01', mockRpc(50001)), { key: 'errorDonationFee' });
  await assert.rejects(prepareDonation(address, '0.01', mockRpc(null)), { key: 'errorDonationFee' });
  await assert.rejects(prepareDonation(address, '0.05', mockRpc(5000, 50004999)), { key: 'errorDonationBalance' });
});

test('submission preserves the signed transfer, uses preflight and sends once even if response is lost', async () => {
  let calls = 0;
  const verified = { signedTx: 'fixture', signature: 'expected' };
  assert.equal(await submitDonation(verified, async (method, params) => {
    calls++; assert.equal(method, 'sendTransaction');
    assert.equal(params[0], verified.signedTx);
    assert.equal(params[1].skipPreflight, false); assert.equal(params[1].maxRetries, 0);
    return verified.signature;
  }), 'expected');
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(submitDonation(verified, async () => { calls++; throw new Error('connection lost'); }));
  assert.equal(calls, 1);
  await assert.rejects(submitDonation(verified, async () => 'different'), { key: 'errorDonationTransaction' });
});

test('a submitted signature is confirmed only after on-chain confirmation and RPC errors remain errors', async () => {
  for (const [status, expected] of [[null, 'pending'], [{ err: null, confirmationStatus: 'processed' }, 'pending'],
    [{ err: null, confirmationStatus: 'confirmed' }, 'confirmed'], [{ err: { InstructionError: [0, 'bad'] } }, 'failed']]) {
    assert.equal(await donationStatus('signature', async () => ({ value: [status] })), expected);
  }
  await assert.rejects(donationRpc('getLatestBlockhash', [], async () => ({ ok: false, status: 403,
    json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'Access forbidden' } }) })), { key: 'errorDonationRpc' });
});
