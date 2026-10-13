import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { inspectPrepared, verifySignedTransaction, sameBytes, CURRENT_CAMPAIGN as C } from '../src/transaction.mjs';

function currentClaimFixture() {
  const user = Keypair.generate(), locker = new PublicKey(C.locker), distributor = new PublicKey(C.distributor);
  const voter = new PublicKey(C.voter), distributorProgram = new PublicKey(C.distributorProgram);
  const escrow = PublicKey.findProgramAddressSync([Buffer.from('Escrow'), locker.toBuffer(), user.publicKey.toBuffer()], voter)[0];
  const status = PublicKey.findProgramAddressSync([Buffer.from('ClaimStatus'), user.publicKey.toBuffer(), distributor.toBuffer()], distributorProgram)[0];
  const ata = owner => PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(C.token).toBuffer(), new PublicKey(C.mint).toBuffer()], new PublicKey(C.associatedToken))[0];
  const key = (pubkey, isSigner = false, isWritable = true) => ({ pubkey: new PublicKey(pubkey), isSigner, isWritable });
  const data = Buffer.alloc(28); Buffer.from('326ff27633fa8dbb', 'hex').copy(data);
  data.writeBigUInt64LE(1000000n, 8); data.writeBigUInt64LE(0n, 16); data.writeUInt32LE(0, 24);
  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 90137 }),
    new TransactionInstruction({ programId: voter,
      data: Buffer.from('d8b68f0bdc2656b9', 'hex'),
      keys: [key(locker), key(escrow), key(user.publicKey, true), key(user.publicKey, true), key(C.system, false, false)] }),
    new TransactionInstruction({ programId: voter,
      data: Buffer.from('a39da184b36b7f8f01', 'hex'),
      keys: [key(locker), key(escrow), key(user.publicKey, true)] }),
    new TransactionInstruction({ programId: distributorProgram, data,
      keys: [key(distributor), key(status), key(ata(distributor)), key(user.publicKey, true), key(C.distributorProgram, false, false),
        key(C.token, false, false), key(C.system, false, false), key(C.voter, false, false), key(locker), key(escrow), key(ata(escrow))] })
  ];
  const build = () => new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions }).compileToV0Message());
  return { user, instructions, build };
}

test('verified current campaign operation decodes amount, lock and fees', () => {
  const { user, build } = currentClaimFixture();
  const prepared = inspectPrepared(Buffer.from(build().serialize()).toString('base64'), user.publicKey.toBase58());
  assert.equal(prepared.operations.claimedRaw, 1000000n);
  assert.equal(prepared.operations.createsEscrow, true);
  assert.equal(prepared.operations.enablesMaxLock, true);
  assert.equal(prepared.operations.networkFeeLamports, 14014n);
  assert.equal(prepared.operations.rentLamports, 3749040n);
});

test('signed current claim validates and preserves its original message', () => {
  const { user, build } = currentClaimFixture();
  const tx = build();
  const prepared = inspectPrepared(Buffer.from(tx.serialize()).toString('base64'), user.publicKey.toBase58());
  tx.sign([user]);
  const base64 = verifySignedTransaction(prepared, tx.serialize(), user.publicKey.toBase58());
  const final = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  assert.ok(sameBytes(final.message.serialize(), prepared.message));
  assert.ok(nacl.sign.detached.verify(final.message.serialize(), final.signatures[0], user.publicKey.toBytes()));
});

test('a different claimant and arbitrary transfer are rejected before signing', () => {
  const fixture = currentClaimFixture();
  fixture.instructions.at(-1).keys[3].pubkey = Keypair.generate().publicKey;
  assert.throws(() => inspectPrepared(Buffer.from(fixture.build().serialize()).toString('base64'), fixture.user.publicKey.toBase58()), /签名或手续费账户|领取账户/);
  const another = currentClaimFixture();
  another.instructions.splice(4, 0, SystemProgram.transfer({ fromPubkey: another.user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  assert.throws(() => inspectPrepared(Buffer.from(another.build().serialize()).toString('base64'), another.user.publicKey.toBase58()), /未核实的程序/);
});

test('different token destination and changed lock operation fail closed', () => {
  const fixture = currentClaimFixture();
  fixture.instructions.at(-1).keys[10].pubkey = Keypair.generate().publicKey;
  assert.throws(() => inspectPrepared(Buffer.from(fixture.build().serialize()).toString('base64'), fixture.user.publicKey.toBase58()), /领取账户/);
  const another = currentClaimFixture();
  another.instructions[3].data[8] = 0;
  assert.throws(() => inspectPrepared(Buffer.from(another.build().serialize()).toString('base64'), another.user.publicKey.toBase58()), /持续质押/);
});

for (const version of ['legacy', 0]) {
  test(`signature preservation and tamper checks work for ${version}`, () => {
    const sponsor = Keypair.generate(), user = Keypair.generate();
    const messageBuilder = new TransactionMessage({ payerKey: sponsor.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: sponsor.publicKey, lamports: 1 })] });
    const tx = new VersionedTransaction(version === 'legacy' ? messageBuilder.compileToLegacyMessage() : messageBuilder.compileToV0Message());
    tx.sign([sponsor]);
    const signerIndex = tx.message.staticAccountKeys.findIndex(key => key.equals(user.publicKey));
    const prepared = { tx, bytes: Uint8Array.from(tx.serialize()), message: Uint8Array.from(tx.message.serialize()), signerIndex };
    const returned = VersionedTransaction.deserialize(prepared.bytes);
    returned.sign([user]); returned.signatures[0] = new Uint8Array(64);
    const final = VersionedTransaction.deserialize(Buffer.from(verifySignedTransaction(prepared, returned.serialize(), user.publicKey.toBase58()), 'base64'));
    assert.ok(sameBytes(final.signatures[0], tx.signatures[0]));
    assert.ok(nacl.sign.detached.verify(prepared.message, final.signatures[signerIndex], user.publicKey.toBytes()));
    const changed = VersionedTransaction.deserialize(prepared.bytes);
    changed.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); changed.sign([user]);
    assert.throws(() => verifySignedTransaction(prepared, changed.serialize(), user.publicKey.toBase58()), /交易内容发生变化/);
    const wrongSignature = VersionedTransaction.deserialize(prepared.bytes);
    wrongSignature.signatures[signerIndex] = nacl.sign.detached(prepared.message, Keypair.generate().secretKey);
    assert.throws(() => verifySignedTransaction(prepared, wrongSignature.serialize(), user.publicKey.toBase58()), /签名与当前地址/);
    const changedSponsor = VersionedTransaction.deserialize(prepared.bytes);
    changedSponsor.sign([user]); changedSponsor.signatures[0][0] ^= 1;
    assert.throws(() => verifySignedTransaction(prepared, changedSponsor.serialize(), user.publicKey.toBase58()), /已有的其他签名/);
  });
}
