import { Keypair, PublicKey, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { CURRENT_CAMPAIGN as C } from '../src/transaction.ts';

// Generated test claimant with the reviewed ASR 2026 Q3 instruction shape.
export function currentClaimFixture() {
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
