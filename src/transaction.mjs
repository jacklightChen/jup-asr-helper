import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

export const CURRENT_CAMPAIGN = Object.freeze({
  compute: 'ComputeBudget111111111111111111111111111111',
  voter: 'voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj',
  distributorProgram: 'DiS3nNjFVMieMgmiQFm6wgJL7nevk4NrhXKLbtEH1Z2R',
  locker: 'CVMdMd79no569tjc5Sq7kzz8isbfCcFyBS5TLGsrZ5dN',
  distributor: 'EPCNCHfQjQ68hU5PjmRvZNLuiS1XMHGvZhMAdJD35b7Q',
  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  system: '11111111111111111111111111111111',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message + '，已停止。');
}

function inspectOperations(tx, address) {
  const expected = CURRENT_CAMPAIGN;
  const keys = tx.message.staticAccountKeys;
  requireCondition(!(tx.message.addressTableLookups ?? []).length, '当前领取交易包含未核实的地址查找表');
  requireCondition(tx.message.header.numRequiredSignatures === 1 && keys[0].toBase58() === address,
    '当前领取交易的签名或手续费账户与钱包不一致');
  const user = new PublicKey(address), locker = new PublicKey(expected.locker);
  const distributor = new PublicKey(expected.distributor), voter = new PublicKey(expected.voter);
  const distributorProgram = new PublicKey(expected.distributorProgram);
  const escrow = PublicKey.findProgramAddressSync([Buffer.from('Escrow'), locker.toBuffer(), user.toBuffer()], voter)[0];
  const claimStatus = PublicKey.findProgramAddressSync([Buffer.from('ClaimStatus'), user.toBuffer(), distributor.toBuffer()], distributorProgram)[0];
  const ata = owner => PublicKey.findProgramAddressSync([
    owner.toBuffer(), new PublicKey(expected.token).toBuffer(), new PublicKey(expected.mint).toBuffer()
  ], new PublicKey(expected.associatedToken))[0];
  const seen = new Set();
  let createsEscrow = false, enablesMaxLock = false, claimedRaw;
  let computeUnitLimit = 200000, microLamports = 0n;
  for (const [position, ix] of tx.message.compiledInstructions.entries()) {
    const program = keys[ix.programIdIndex]?.toBase58();
    requireCondition([expected.compute, expected.voter, expected.distributorProgram].includes(program), '交易包含未核实的程序');
    const data = Buffer.from(ix.data);
    const accounts = ix.accountKeyIndexes.map(index => keys[index]);
    const matches = (index, value) => accounts[index]?.toBase58() === value.toString();
    const distinct = name => {
      requireCondition(!seen.has(name), '交易包含重复指令'); seen.add(name);
    };
    if (program === expected.compute) {
      requireCondition(!seen.has('claim') && !seen.has('escrow') && !seen.has('maxLock'), '计算预算指令位置异常');
      requireCondition(accounts.length === 0, '计算预算账户异常');
      if (data[0] === 2 && data.length === 5) {
        distinct('computeLimit'); computeUnitLimit = data.readUInt32LE(1);
        requireCondition(computeUnitLimit > 0 && computeUnitLimit <= 1400000, '交易计算额度异常');
      } else if (data[0] === 3 && data.length === 9) {
        distinct('computePrice'); microLamports = data.readBigUInt64LE(1);
      } else throw new Error('未识别的计算预算指令，已停止。');
      continue;
    }
    const discriminator = data.subarray(0, 8).toString('hex');
    if (program === expected.voter && discriminator === 'd8b68f0bdc2656b9') {
      distinct('escrow');
      requireCondition(!seen.has('claim') && !seen.has('maxLock') && data.length === 8 && accounts.length === 5 &&
        matches(0, locker) && matches(1, escrow) && matches(2, user) && matches(3, user) && matches(4, expected.system),
      '创建质押账户的交易参数异常');
      createsEscrow = true;
    } else if (program === expected.voter && discriminator === 'a39da184b36b7f8f') {
      distinct('maxLock');
      requireCondition(!seen.has('claim') && data.length === 9 && data[8] === 1 && accounts.length === 3 &&
        matches(0, locker) && matches(1, escrow) && matches(2, user), '持续质押的交易参数异常');
      enablesMaxLock = true;
    } else if (program === expected.distributorProgram && discriminator === '326ff27633fa8dbb') {
      distinct('claim');
      requireCondition(position === tx.message.compiledInstructions.length - 1 && accounts.length === 11 && data.length >= 28,
        '领取指令结构异常');
      const proofCount = data.readUInt32LE(24);
      requireCondition(proofCount <= 32 && data.length === 28 + proofCount * 32, '领取证明结构异常');
      claimedRaw = data.readBigUInt64LE(8) + data.readBigUInt64LE(16);
      requireCondition(claimedRaw > 0n && matches(0, distributor) && matches(1, claimStatus) && matches(2, ata(distributor)) &&
        matches(3, user) && matches(4, distributorProgram) && matches(5, expected.token) && matches(6, expected.system) &&
        matches(7, voter) && matches(8, locker) && matches(9, escrow) && matches(10, ata(escrow)), '领取账户与当前钱包或活动不一致');
    } else throw new Error('交易包含未识别的领取操作，已停止。');
  }
  requireCondition(seen.has('claim'), '交易没有领取并质押指令');
  const networkFeeLamports = 5000n + (BigInt(computeUnitLimit) * microLamports + 999999n) / 1000000n;
  requireCondition(networkFeeLamports <= 10000000n, '预估网络费超过 0.01 SOL');
  return { createsEscrow, enablesMaxLock, claimedRaw, networkFeeLamports,
    rentLamports: 1463040n + (createsEscrow ? 2286000n : 0n), escrow: escrow.toBase58() };
}

export function sameBytes(a, b) {
  return a?.length === b?.length && a.every((value, index) => value === b[index]);
}

export function decodeTransaction(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Jupiter 没有返回有效交易。');
  }
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  if (!bytes.length || bytes.length > 1232) throw new Error('交易大小异常，已停止。');
  const tx = VersionedTransaction.deserialize(bytes);
  if (!sameBytes(tx.serialize(), bytes)) throw new Error('交易编码不一致，已停止。');
  return { tx, bytes };
}

export function inspectPrepared(base64, address) {
  if (new PublicKey(address).toBase58() !== address) throw new Error('钱包地址无效。');
  const { tx, bytes } = decodeTransaction(base64);
  const keys = tx.message.staticAccountKeys;
  const signers = keys.slice(0, tx.message.header.numRequiredSignatures);
  const signerIndex = signers.findIndex(key => key.toBase58() === address);
  if (signerIndex < 0) throw new Error('当前钱包不是这笔领取交易的签名账户，已停止。');
  const programIds = [...new Set(tx.message.compiledInstructions.map(ix => {
    const key = keys[ix.programIdIndex];
    if (!key) throw new Error('交易使用未解析的程序地址，无法核对，已停止。');
    return key.toBase58();
  }))];
  const operations = inspectOperations(tx, address);
  return {
    tx, bytes, signerIndex, message: Uint8Array.from(tx.message.serialize()),
    version: tx.version, feePayer: keys[0].toBase58(),
    signers: signers.map(key => key.toBase58()), programIds,
    recentBlockhash: tx.message.recentBlockhash,
    lookupTables: (tx.message.addressTableLookups ?? []).map(item => item.accountKey.toBase58()),
    instructionCount: tx.message.compiledInstructions.length, operations
  };
}

export function verifySignedTransaction(prepared, signedBytes, address) {
  if (!(signedBytes instanceof Uint8Array)) throw new Error('钱包没有返回完整的已签名交易。');
  const signed = VersionedTransaction.deserialize(signedBytes);
  if (!sameBytes(signed.message.serialize(), prepared.message)) {
    throw new Error('钱包返回的交易内容发生变化，未提交。请重新准备交易。');
  }
  if (signed.signatures.length !== prepared.tx.signatures.length) {
    throw new Error('钱包返回的签名数量异常，未提交。');
  }
  for (let i = 0; i < prepared.tx.signatures.length; i++) {
    if (i === prepared.signerIndex) continue;
    const before = prepared.tx.signatures[i], after = signed.signatures[i];
    if (before.some(value => value !== 0) && after.some(value => value !== 0) && !sameBytes(before, after)) {
      throw new Error('钱包改变了交易中已有的其他签名，未提交。');
    }
  }
  const signature = signed.signatures[prepared.signerIndex];
  if (!signature || signature.length !== 64 || !nacl.sign.detached.verify(
    prepared.message, signature, new PublicKey(address).toBytes())) {
    throw new Error('钱包签名与当前地址或交易不匹配，未提交。');
  }
  // Keep the original message and all Jupiter co-signatures, even if a wallet
  // omits existing co-signatures from its output. Only add this account's signature.
  const finalTx = VersionedTransaction.deserialize(prepared.bytes);
  finalTx.signatures[prepared.signerIndex] = Uint8Array.from(signature);
  return Buffer.from(finalTx.serialize()).toString('base64');
}
