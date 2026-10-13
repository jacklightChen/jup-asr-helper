import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction, VersionedTransaction, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { currentClaimFixture } from './fixtures.mjs';
import { inspectPrepared, verifySignedTransaction, sameBytes } from '../src/transaction.ts';
import { createPhantomWallet, createInjectedWallet } from '../src/phantom.ts';
import { WALLET_CATALOG, SOLANA_MAINNET, SOLANA_MAINNET_GENESIS, mainnetChain, supportedWallets, accountsInclude, donationVersion } from '../src/wallets.ts';
import { prepareDonation, verifyDonationSigned, checkDonationNetwork } from '../src/donation.ts';

const neverBroadcast = () => { throw new Error('Flow tests must never call a wallet broadcast method'); };
function injected(name, user, change) {
  const provider = { isPhantom: name === 'Phantom', publicKey: user.publicKey,
    connect: async () => ({ publicKey: user.publicKey }),
    signAndSendTransaction: neverBroadcast,
    signTransaction: async tx => {
      if (change) tx = change(tx, provider);
      if (tx instanceof Transaction) tx.sign(user); else tx.sign([user]);
      return tx;
    },
  };
  return name === 'Phantom' ? createPhantomWallet(provider) : createInjectedWallet(provider, name);
}
const injectedNames = ['Phantom', 'OKX Wallet', 'Backpack', 'Solflare', 'Trust Wallet'];
const rpcFor = (block, fee = 5000) => async method => {
  if (method === 'getLatestBlockhash') return { value: { blockhash: block, lastValidBlockHeight: 12345 } };
  if (method === 'getFeeForMessage') return { value: fee };
  if (method === 'getBalance') return { value: 100000000 };
  if (method === 'isBlockhashValid') return { value: true };
  throw new Error('Unexpected RPC method; no broadcast permitted');
};
async function signedOutput(wallet, bytes) {
  const { accounts } = await wallet.features['standard:connect'].connect();
  const account = accounts[0];
  const output = await wallet.features['solana:signTransaction'].signTransaction({ account, chain: mainnetChain(account), transaction: bytes });
  assert.equal(output.length, 1);
  return { account, signed: output[0].signedTransaction };
}

for (const name of injectedNames) {
  test(`${name} sign-only adapter preserves the full current ASR claim and produces a valid claimant signature`, async () => {
    const { user, build } = currentClaimFixture(), tx = build();
    const prepared = inspectPrepared(Buffer.from(tx.serialize()).toString('base64'), user.publicKey.toBase58());
    const wallet = injected(name, user);
    assert.ok(supportedWallets([wallet]).includes(wallet));
    const { account, signed } = await signedOutput(wallet, Uint8Array.from(prepared.bytes));
    const final = VersionedTransaction.deserialize(Buffer.from(verifySignedTransaction(prepared, signed, account.address), 'base64'));
    assert.ok(sameBytes(final.message.serialize(), prepared.message));
    assert.equal(prepared.operations.claimedRaw, 1000000n);
    assert.equal(prepared.operations.enablesMaxLock, true);
  });

  test(`${name} donation adapter accepts a valid wallet fee/blockhash update in legacy and v0 formats`, async () => {
    const user = Keypair.generate(), address = user.publicKey.toBase58();
    for (const version of ['legacy', 0]) {
      const prepared = await prepareDonation(address, '0.01', rpcFor(Keypair.generate().publicKey.toBase58()), version);
      const wallet = injected(name, user, tx => {
        const decoded = tx instanceof Transaction ? VersionedTransaction.deserialize(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) : tx;
        const message = TransactionMessage.decompile(decoded.message);
        const builder = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 3000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }), ...message.instructions,
        ] });
        return new VersionedTransaction(version === 'legacy' ? builder.compileToLegacyMessage() : builder.compileToV0Message());
      });
      const { signed } = await signedOutput(wallet, Uint8Array.from(prepared.bytes));
      const verified = verifyDonationSigned(prepared, signed, address);
      assert.equal(verified.signedTx, Buffer.from(signed).toString('base64'));
      assert.equal(await checkDonationNetwork(verified, address, '0.01', rpcFor('unused', 5300)), 5300);
    }
  });
}

// Native Standard wallets are tested against the documented wire contract, not
// the real extension. Runtime account authorization and UI approval remain required.
for (const [name, chain] of [['Binance Wallet', SOLANA_MAINNET], ['MetaMask', SOLANA_MAINNET_GENESIS]]) {
  test(`${name} Wallet Standard contract fixture covers ASR signing, donation signing, and mainnet account changes`, async () => {
    const { user, build } = currentClaimFixture();
    const account = { address: user.publicKey.toBase58(), publicKey: user.publicKey.toBytes(), chains: [chain], features: ['solana:signTransaction'] };
    const wallet = { name, chains: [chain], accounts: [account], features: {
      'standard:connect': { connect: async () => ({ accounts: [account] }) },
      'solana:signAndSendTransaction': { signAndSendTransaction: neverBroadcast },
      'solana:signTransaction': { supportedTransactionVersions: ['legacy', 0], signTransaction: async input => {
        assert.equal(input.chain, chain); assert.equal(input.account, account);
        const tx = VersionedTransaction.deserialize(input.transaction); tx.sign([user]);
        return [{ signedTransaction: tx.serialize() }];
      } },
    } };
    assert.deepEqual(supportedWallets([wallet]), [wallet]);
    const tx = build(), prepared = inspectPrepared(Buffer.from(tx.serialize()).toString('base64'), account.address);
    const claimOutput = await signedOutput(wallet, prepared.bytes);
    assert.ok(verifySignedTransaction(prepared, claimOutput.signed, account.address));
    const donation = await prepareDonation(account.address, '0.05', rpcFor(Keypair.generate().publicKey.toBase58()), donationVersion(wallet));
    const donationOutput = await signedOutput(wallet, donation.bytes);
    assert.ok(verifyDonationSigned(donation, donationOutput.signed, account.address));
    wallet.accounts = [];
    assert.equal(accountsInclude(wallet.accounts, account), false);
  });
}

test('all seven wallet brands select a supported donation version including legacy-only interfaces', () => {
  for (const item of WALLET_CATALOG) {
    const wallet = versions => ({ name: item.name, features: { 'solana:signTransaction': { supportedTransactionVersions: versions } } });
    assert.equal(donationVersion(wallet(['legacy'])), 'legacy', item.name);
    assert.equal(donationVersion(wallet([0])), 0, item.name);
    assert.equal(donationVersion(wallet([1])), null, item.name);
    assert.equal(donationVersion(wallet([])), null, item.name);
    assert.equal(donationVersion(wallet(['legacy', 0])), item.brand === 'okx' ? 'legacy' : 0, item.name);
  }
});

test('all injected claim adapters stop an account switch during signing and claims keep the original message', async () => {
  for (const name of injectedNames) {
    const { user, build } = currentClaimFixture(), tx = build();
    const prepared = inspectPrepared(Buffer.from(tx.serialize()).toString('base64'), user.publicKey.toBase58());
    const changedAccount = injected(name, user, (transaction, provider) => {
      provider.publicKey = Keypair.generate().publicKey; return transaction;
    });
    await assert.rejects(signedOutput(changedAccount, prepared.bytes), { key: 'errorAccountChangedSigning' });
    const changedMessage = injected(name, user, transaction => {
      transaction.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); return transaction;
    });
    const { signed } = await signedOutput(changedMessage, prepared.bytes);
    assert.throws(() => verifySignedTransaction(prepared, signed, user.publicKey.toBase58()), /交易内容发生变化/);
  }
});
