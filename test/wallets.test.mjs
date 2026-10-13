import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { verifySignedTransaction, sameBytes } from '../src/transaction.mjs';
import { supportedWallets, walletBrand, selectWallet, SOLANA_MAINNET, SOLANA_MAINNET_GENESIS, mainnetChain } from '../src/wallets.mjs';
import { createPhantomWallet, createInjectedWallet, phantomAccount, matchesPhantomAccount } from '../src/phantom.mjs';

const neverCall = () => { throw new Error('Discovery tests must not request connection or signing'); };
const wallet = name => ({ name, chains: [SOLANA_MAINNET], features: {
  'standard:connect': { connect: neverCall }, 'solana:signTransaction': { signTransaction: neverCall },
} });
const keyA = '11111111111111111111111111111111';
const keyB = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

test('allowlist requires exact product names and actual Solana sign-only features', () => {
  const binance = wallet('Binance Wallet'), phantom = wallet('Phantom');
  const nonSolana = { ...wallet('Phantom'), chains: ['eip155:1'] };
  const sendOnly = { ...wallet('Phantom'), features: { 'standard:connect': { connect: neverCall }, 'solana:signAndSendTransaction': { signAndSendTransaction: neverCall } } };
  const invalidFeature = { ...wallet('Phantom'), features: { 'standard:connect': true, 'solana:signTransaction': true } };
  assert.deepEqual(supportedWallets([wallet('Not Phantom'), wallet('Phantom Mobile'), wallet('Binance Scam Wallet'), nonSolana, sendOnly, invalidFeature, binance, phantom]), [binance, phantom]);
  assert.equal(walletBrand(wallet('Binance Web3 Wallet')), 'binance');
  assert.equal(walletBrand(wallet('Binance')), 'binance');
  assert.equal(walletBrand(wallet('phantom')), null);
});

test('additional wallets require sign-only features and recognize both Solana mainnet chain names', () => {
  const additions = ['OKX Wallet', 'Backpack', 'MetaMask', 'Solflare'].map(wallet);
  additions[2].chains = [SOLANA_MAINNET_GENESIS];
  assert.deepEqual(supportedWallets(additions), additions);
  assert.equal(mainnetChain(additions[2]), SOLANA_MAINNET_GENESIS);
  assert.equal(mainnetChain({ chains: ['solana:devnet'] }), null);
  assert.equal(walletBrand(wallet('MetaMask Impostor')), null);
  assert.equal(walletBrand(wallet('OKX Scam Wallet')), null);
  assert.deepEqual(supportedWallets([{ ...wallet('MetaMask'), features: { 'standard:connect': { connect: neverCall } } }]), []);
});

for (const name of ['OKX Wallet', 'Backpack', 'Solflare', 'Trust Wallet']) {
  test(`${name} injected sign-only adapter preserves transaction bytes and verifies its output`, async () => {
    const user = Keypair.generate();
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })]
    }).compileToV0Message());
    const bytes = Uint8Array.from(tx.serialize());
    const provider = { publicKey: user.publicKey, connect: async () => {},
      signTransaction: async transaction => { transaction.sign([user]); return transaction; } };
    const adapter = createInjectedWallet(provider, name);
    const { accounts } = await adapter.features['standard:connect'].connect();
    const [output] = await adapter.features['solana:signTransaction'].signTransaction({ account: accounts[0], chain: SOLANA_MAINNET, transaction: bytes });
    assert.ok(verifySignedTransaction({ tx, bytes, signerIndex: 0, message: Uint8Array.from(tx.message.serialize()) }, output.signedTransaction, user.publicKey.toBase58()));
    provider.publicKey = Keypair.generate().publicKey;
    await assert.rejects(adapter.features['solana:signTransaction'].signTransaction({ account: accounts[0], chain: SOLANA_MAINNET, transaction: bytes }));
  });
}

test('Trust Wallet supports the official Trust registry name and rejects EVM-only or send-only interfaces', () => {
  const trust = wallet('Trust');
  assert.equal(walletBrand(trust), 'trust');
  assert.equal(walletBrand(wallet('Trust Wallet')), 'trust');
  assert.equal(walletBrand(wallet('Trust Wallet Fake')), null);
  assert.deepEqual(supportedWallets([trust]), [trust]);
  assert.deepEqual(supportedWallets([{ ...trust, chains: ['eip155:1'] }]), []);
  assert.deepEqual(supportedWallets([{ ...trust, features: { 'standard:connect': { connect: neverCall },
    'solana:signAndSendTransaction': { signAndSendTransaction: neverCall } } }]), []);
});

test('multiple wallets require a visible choice and preserve object identity across discovery changes', () => {
  const first = wallet('Phantom'), second = wallet('Phantom'), binance = wallet('Binance Wallet');
  assert.equal(selectWallet([]), null);
  assert.equal(selectWallet([first]), first);
  assert.equal(selectWallet([first, binance]), null);
  assert.equal(selectWallet([first, second], second), second);
  assert.equal(selectWallet([binance, second], first), null);
  assert.equal(selectWallet([binance], first), binance);
});

test('Phantom sign-only fallback supports v0 and binds the current provider account', () => {
  const provider = { isPhantom: true, publicKey: keyA, connect: neverCall, signTransaction: neverCall };
  const fallback = createPhantomWallet(provider);
  assert.equal(fallback.name, 'Phantom');
  assert.deepEqual(fallback.features['solana:signTransaction'].supportedTransactionVersions, ['legacy', 0]);
  assert.deepEqual(supportedWallets([fallback]), [fallback]);
  const account = phantomAccount(provider);
  assert.equal(account.address, keyA);
  assert.equal(matchesPhantomAccount(provider, account, SOLANA_MAINNET), true);
  assert.equal(matchesPhantomAccount(provider, account, 'solana:devnet'), false);
  assert.equal(matchesPhantomAccount(provider, { ...account, publicKey: new Uint8Array(32).fill(1) }, SOLANA_MAINNET), false);
  provider.publicKey = keyB;
  assert.equal(fallback.accounts[0].address, keyB);
  assert.equal(matchesPhantomAccount(provider, account, SOLANA_MAINNET), false);
  provider.publicKey = 'invalid';
  assert.deepEqual(fallback.accounts, []);
  assert.equal(createPhantomWallet({ ...provider, isPhantom: false }), null);
  assert.equal(createPhantomWallet({ ...provider, signTransaction: undefined }), null);
});

test('Phantom disconnect clears the adapter accounts and event teardown removes callbacks', () => {
  const callbacks = new Map();
  const provider = { isPhantom: true, publicKey: keyA, connect: neverCall, signTransaction: neverCall,
    on: (event, callback) => callbacks.set(event, callback), removeListener: (event, callback) => { if (callbacks.get(event) === callback) callbacks.delete(event); } };
  const fallback = createPhantomWallet(provider);
  let changed;
  const stop = fallback.features['standard:events'].on('change', value => { changed = value; });
  callbacks.get('disconnect')();
  assert.deepEqual(changed, { accounts: [] });
  assert.deepEqual(fallback.accounts, []);
  stop();
  assert.equal(callbacks.size, 0);
});

for (const version of ['legacy', 0]) {
  test(`Phantom provider signs ${version} bytes and its output passes the message/signature verifier`, async () => {
    const user = Keypair.generate();
    const builder = new TransactionMessage({ payerKey: user.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: user.publicKey,
        toPubkey: Keypair.generate().publicKey, lamports: 1 })] });
    const tx = new VersionedTransaction(version === 'legacy' ? builder.compileToLegacyMessage() : builder.compileToV0Message());
    const bytes = Uint8Array.from(tx.serialize());
    const provider = { isPhantom: true, publicKey: user.publicKey,
      connect: async () => ({ publicKey: user.publicKey }),
      signTransaction: async transaction => { transaction.sign([user]); return transaction; } };
    const adapter = createPhantomWallet(provider);
    const { accounts } = await adapter.features['standard:connect'].connect();
    const [output] = await adapter.features['solana:signTransaction'].signTransaction({
      account: accounts[0], chain: SOLANA_MAINNET, transaction: bytes });
    const prepared = { tx, bytes, message: Uint8Array.from(tx.message.serialize()), signerIndex: 0 };
    const verified = verifySignedTransaction(prepared, output.signedTransaction, user.publicKey.toBase58());
    assert.ok(sameBytes(bytes, tx.serialize()), 'unsigned transaction stays unchanged');
    assert.ok(sameBytes(VersionedTransaction.deserialize(Buffer.from(verified, 'base64')).message.serialize(), prepared.message));
    provider.publicKey = Keypair.generate().publicKey;
    await assert.rejects(adapter.features['solana:signTransaction'].signTransaction({
      account: accounts[0], chain: SOLANA_MAINNET, transaction: bytes }));
  });
}
