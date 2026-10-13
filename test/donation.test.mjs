import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, SystemInstruction, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { DONATION_ADDRESS, prepareDonation, verifyDonationSigned, submitDonation, checkDonationNetwork, donationStatus, donationRpc, MAX_DONATION_FEE } from '../src/donation.ts';

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
    const refreshed = verifyDonationSigned(prepared, signed.serialize(), user.publicKey.toBase58());
    assert.equal(refreshed.signedTx, Buffer.from(signed.serialize()).toString('base64'), 'keep the wallet-signed blockhash and signature');
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

const plainTransfer = (user, recipient = DONATION_ADDRESS, lamports = 10000000) =>
  SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: new PublicKey(recipient), lamports });
function walletSigned(user, instructions, version = 0, blockhash = hash, payer = user.publicKey) {
  const builder = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions });
  const tx = new VersionedTransaction(version === 'legacy' ? builder.compileToLegacyMessage() : builder.compileToV0Message());
  tx.sign([user]); return tx;
}

for (const version of ['legacy', 0]) {
  test(`donation accepts a wallet's ${version} rebuild with bounded fee instructions and a refreshed blockhash`, async () => {
    const user = Keypair.generate(), address = user.publicKey.toBase58();
    const prepared = await prepareDonation(address, '0.01', mockRpc());
    const currentHash = Keypair.generate().publicKey.toBase58();
    const signed = walletSigned(user, [ComputeBudgetProgram.setComputeUnitLimit({ units: 3000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }), plainTransfer(user)], version, currentHash);
    const verified = verifyDonationSigned(prepared, signed.serialize(), address);
    assert.equal(verified.signedTx, Buffer.from(signed.serialize()).toString('base64'));
    assert.notEqual(verified.signedTx, Buffer.from(prepared.bytes).toString('base64'));
    const reads = [];
    const fee = await checkDonationNetwork(verified, address, '0.01', async (method, params) => {
      reads.push(method);
      if (method === 'getFeeForMessage') {
        assert.equal(params[0], Buffer.from(signed.message.serialize()).toString('base64'));
        return { value: 5300 };
      }
      if (method === 'getBalance') { assert.equal(params[0], address); return { value: 20000000 }; }
      if (method === 'isBlockhashValid') { assert.equal(params[0], currentHash); return { value: true }; }
      throw new Error('Must not broadcast in validation');
    });
    assert.equal(fee, 5300);
    assert.deepEqual(reads.sort(), ['getBalance', 'getFeeForMessage', 'isBlockhashValid']);
  });
}

test('donation rejects changes to recipient, amount, payer, extra transfers, tokens and unknown operations', async () => {
  const user = Keypair.generate(), other = Keypair.generate(), address = user.publicKey.toBase58();
  const prepared = await prepareDonation(address, '0.01', mockRpc());
  for (const [instructions, key] of [
    [[plainTransfer(user, other.publicKey.toBase58())], 'errorDonationDestination'],
    [[plainTransfer(user, DONATION_ADDRESS, 10000001)], 'errorDonationDestination'],
    [[plainTransfer(user), plainTransfer(user, other.publicKey.toBase58(), 1)], 'errorDonationExtraOperation'],
    [[plainTransfer(user), plainTransfer(user)], 'errorDonationExtraOperation'],
    [[SystemProgram.createAccount({ fromPubkey: user.publicKey, newAccountPubkey: user.publicKey, space: 0,
      lamports: 10000000, programId: SystemProgram.programId })], 'errorDonationExtraOperation'],
    [[new TransactionInstruction({ programId: other.publicKey, keys: [], data: Buffer.from([1]) }), plainTransfer(user)], 'errorDonationExtraOperation'],
  ]) {
    const signed = walletSigned(user, instructions);
    assert.throws(() => verifyDonationSigned(prepared, signed.serialize(), address), { key });
  }
  const differentPayer = walletSigned(other, [plainTransfer(other)]);
  assert.throws(() => verifyDonationSigned(prepared, differentPayer.serialize(), address), { key: 'errorDonationPayer' });
  const signed = walletSigned(user, [plainTransfer(user)]); signed.signatures[0].fill(0);
  assert.throws(() => verifyDonationSigned(prepared, signed.serialize(), address), { key: 'errorDonationSignature' });
});

test('donation rejects lookup tables, unknown accounts, invalid budgets and excessive priority fees before RPC', async () => {
  const user = Keypair.generate(), address = user.publicKey.toBase58(), prepared = await prepareDonation(address, '0.01', mockRpc());
  const limit = units => ComputeBudgetProgram.setComputeUnitLimit({ units });
  const price = microLamports => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
  for (const [instructions, key] of [
    [[limit(3000), price(15000001), plainTransfer(user)], 'errorDonationFee'],
    [[price(225001), plainTransfer(user)], 'errorDonationFee'],
    [[limit(0), plainTransfer(user)], 'errorDonationFee'],
    [[limit(1400001), plainTransfer(user)], 'errorDonationFee'],
    [[limit(3000), limit(3000), plainTransfer(user)], 'errorDonationExtraOperation'],
    [[price(1), price(2), plainTransfer(user)], 'errorDonationExtraOperation'],
    [[plainTransfer(user), price(1)], 'errorDonationExtraOperation'],
    [[ComputeBudgetProgram.requestHeapFrame({ bytes: 32768 }), plainTransfer(user)], 'errorDonationExtraOperation'],
  ]) {
    assert.throws(() => verifyDonationSigned(prepared, walletSigned(user, instructions).serialize(), address), { key });
  }
  const atCap = walletSigned(user, [limit(3000), price(15000000), plainTransfer(user)]);
  assert.ok(verifyDonationSigned(prepared, atCap.serialize(), address)); // 5k + 45k = 50k lamports.
  const unused = walletSigned(user, [plainTransfer(user)]);
  unused.message.staticAccountKeys.push(Keypair.generate().publicKey);
  unused.message.header.numReadonlyUnsignedAccounts++;
  unused.sign([user]);
  assert.throws(() => verifyDonationSigned(prepared, unused.serialize(), address), { key: 'errorDonationExtraOperation' });
  const lookup = walletSigned(user, [plainTransfer(user)]);
  lookup.message.addressTableLookups.push({ accountKey: Keypair.generate().publicKey, writableIndexes: [], readonlyIndexes: [] });
  lookup.sign([user]);
  assert.throws(() => verifyDonationSigned(prepared, lookup.serialize(), address), { key: 'errorDonationPayer' });
});

test('final network validation stops expired transactions, unknown fees, higher fees and insufficient current balance', async () => {
  const user = Keypair.generate(), address = user.publicKey.toBase58(), prepared = await prepareDonation(address, '0.01', mockRpc());
  const verified = verifyDonationSigned(prepared, walletSigned(user, [plainTransfer(user)]).serialize(), address);
  const finalRpc = (fee, balance, valid) => async method => {
    if (method === 'getFeeForMessage') return { value: fee };
    if (method === 'getBalance') return { value: balance };
    if (method === 'isBlockhashValid') return { value: valid };
    throw new Error('No broadcast allowed');
  };
  for (const valid of [false, null, 'true']) {
    await assert.rejects(checkDonationNetwork(verified, address, '0.01', finalRpc(5000, 20000000, valid)), { key: 'errorDonationExpired' });
  }
  for (const fee of [null, MAX_DONATION_FEE + 1, -1]) {
    await assert.rejects(checkDonationNetwork(verified, address, '0.01', finalRpc(fee, 20000000, true)), { key: 'errorDonationFee' });
  }
  await assert.rejects(checkDonationNetwork(verified, address, '0.01', finalRpc(5000, 10004999, true)), {
    key: 'errorDonationBalance', values: { balance: '0.010004999', required: '0.010005000' },
  });
  await assert.rejects(checkDonationNetwork({ ...verified, signature: 'different' }, address, '0.01', finalRpc(5000, 20000000, true)), { key: 'errorDonationSignature' });
});

test('OKX donation can be prepared in the native legacy transaction format', async () => {
  const user = Keypair.generate(), address = user.publicKey.toBase58();
  const prepared = await prepareDonation(address, '0.01', mockRpc(), 'legacy');
  assert.equal(prepared.tx.version, 'legacy');
  const signed = VersionedTransaction.deserialize(prepared.bytes); signed.sign([user]);
  assert.ok(verifyDonationSigned(prepared, signed.serialize(), address));
});
