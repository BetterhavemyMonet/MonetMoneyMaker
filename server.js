import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  Keypair, SystemProgram,
} from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────
const MINT_ADDRESS    = '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b';
const TREASURY_ADDR   = 'ot1CyXFDUdTpSp3reSdgCPfLvivHfcSmi5c6yjnnRxs';
const ENTRY_FEE       = 5;
const ALLOWED_ENTRY_FEES = new Set([5, 10, 25, 50]);
const DECIMALS        = 6;
const HOUSE_RAKE      = 0.10;
const PRIZE_CUTS      = [0.50, 0.30, 0.10];
const CHALLENGE_TTL   = 24 * 60 * 60 * 1000;
const TOURNEY_WINDOW  = 60 * 60 * 1000;
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 16;

const TOKEN_PROG   = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_PROG   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bT3');
// Primary: user-configured via env var (recommended for production).
// Fallback: best-effort free public endpoints — server-side Node.js bypasses
// the browser CORS/rate-limit 403s that hit these from the frontend.
// Set SOLANA_RPC_URL secret for a dedicated RPC (Helius free tier recommended).
// Fallbacks are public endpoints that work from Node.js (no browser CORS issues).
const RPCS = [
  process.env.SOLANA_RPC_URL,
  'https://api.mainnet-beta.solana.com',
  'https://solana.drpc.org',
  'https://mainnet.helius-rpc.com/',
].filter(Boolean);

// ─── Data helpers ──────────────────────────────────────────────────────────────
function dbRead(name) {
  const f = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function dbWrite(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// ─── Treasury keypair ─────────────────────────────────────────────────────────
function getTreasuryKP() {
  const key = process.env.TREASURY_PRIVATE_KEY;
  if (!key) return null;
  try {
    const bytes = JSON.parse(key);
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    console.warn('[MONET] TREASURY_PRIVATE_KEY must be a JSON array of 64 bytes');
    return null;
  }
}

// ─── Solana utilities ─────────────────────────────────────────────────────────
async function withRpc(fn, timeoutMs = 15000) {
  let last;
  for (const rpc of RPCS) {
    const conn = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: false });
    try {
      return await Promise.race([
        fn(conn),
        new Promise((_, r) => setTimeout(() => r(new Error(`timeout:${rpc}`)), timeoutMs)),
      ]);
    } catch(e) { last = e; console.warn(`[RPC] ${rpc} failed:`, e.message); }
  }
  throw last ?? new Error('All RPCs failed');
}

function getATA(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
    ASSOC_PROG
  )[0];
}

function makeCreateATAIx(payer, ata, owner, mint) {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer,                    isSigner: true,  isWritable: true  },
      { pubkey: ata,                      isSigner: false, isWritable: true  },
      { pubkey: owner,                    isSigner: false, isWritable: false },
      { pubkey: mint,                     isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROG,               isSigner: false, isWritable: false },
    ],
    programId: ASSOC_PROG,
    data: Buffer.from([0]),
  });
}

function makeTransferIx(src, dst, owner, rawAmt) {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(rawAmt), 1);
  return new TransactionInstruction({
    keys: [
      { pubkey: src,   isSigner: false, isWritable: true  },
      { pubkey: dst,   isSigner: false, isWritable: true  },
      { pubkey: owner, isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROG,
    data,
  });
}

async function sendPayout(toAddress, amount) {
  const kp = getTreasuryKP();
  if (!kp) throw new Error('Treasury keypair not configured — set TREASURY_PRIVATE_KEY');

  const mint     = new PublicKey(MINT_ADDRESS);
  const treasury = new PublicKey(TREASURY_ADDR);
  const winner   = new PublicKey(toAddress);
  const srcATA   = getATA(mint, treasury);
  const dstATA   = getATA(mint, winner);
  const rawAmt   = Math.round(amount * Math.pow(10, DECIMALS));

  return withRpc(async conn => {
    const tx = new Transaction();
    tx.feePayer = treasury;
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    const dstInfo = await conn.getAccountInfo(dstATA);
    if (!dstInfo) tx.add(makeCreateATAIx(treasury, dstATA, winner, mint));
    tx.add(makeTransferIx(srcATA, dstATA, treasury, rawAmt));
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  });
}

let _tBal = 0, _tBalTs = 0;
async function getTreasuryBalance() {
  if (Date.now() - _tBalTs < 60_000) return _tBal;
  try {
    const mint  = new PublicKey(MINT_ADDRESS);
    const owner = new PublicKey(TREASURY_ADDR);
    const bal = await withRpc(async conn => {
      const res = await conn.getParsedTokenAccountsByOwner(owner, { mint });
      return res?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    });
    _tBal = bal; _tBalTs = Date.now();
    return bal;
  } catch { return _tBal; }
}

// ─── ID generators ────────────────────────────────────────────────────────────
function genCode()  { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function calcPot(n, fee = ENTRY_FEE) {
  const gross = n * fee;
  const rake  = Math.floor(gross * HOUSE_RAKE * 100) / 100;
  return { gross, rake, net: gross - rake };
}

// ─── On-chain payment verification ────────────────────────────────────────────
// Confirms txId is a real Solana tx that sent ≥ `expectedFee` MONET tokens
// to the treasury. Returns { ok, senderWallet, amount } on success or throws.
// Intentionally lenient on RPC failures (warns + allows through) to avoid
// blocking legitimate players during RPC outages; strict on bad amounts/recipients.
async function verifyEntryFee(txId, expectedFee = ENTRY_FEE) {
  const mint     = MINT_ADDRESS;
  const treasury = TREASURY_ADDR;
  const rawExpected = Math.round(expectedFee * Math.pow(10, DECIMALS));

  let tx;
  try {
    tx = await withRpc(async conn =>
      conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    , 14000);
  } catch(e) {
    console.warn(`[VERIFY] RPC error checking tx ${txId.slice(0,12)}…: ${e.message} — allowing through`);
    return { ok: true, rpcFailed: true };
  }

  if (!tx) {
    // Tx not found — may still be propagating; allow through but log
    console.warn(`[VERIFY] tx ${txId.slice(0,12)}… not found on-chain yet — allowing through`);
    return { ok: true, rpcFailed: true };
  }

  if (tx.meta?.err) {
    throw new Error(`Transaction ${txId.slice(0,12)}… failed on-chain`);
  }

  // Inspect all token balance changes for a MONET transfer to treasury
  const pre  = tx.meta?.preTokenBalances  ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  // Build a map of accountIndex → delta
  const deltaMap = new Map();
  for (const p of post) {
    if (p.mint !== mint) continue;
    const pre_ = pre.find(x => x.accountIndex === p.accountIndex && x.mint === mint);
    const before = pre_?.uiTokenAmount?.uiAmount ?? 0;
    const after  = p.uiTokenAmount?.uiAmount ?? 0;
    deltaMap.set(p.accountIndex, { delta: after - before, owner: p.owner, uiAmount: after });
  }
  for (const p of pre) {
    if (p.mint !== mint || deltaMap.has(p.accountIndex)) continue;
    const after_ = post.find(x => x.accountIndex === p.accountIndex && x.mint === mint);
    const before = p.uiTokenAmount?.uiAmount ?? 0;
    const after  = after_?.uiTokenAmount?.uiAmount ?? 0;
    deltaMap.set(p.accountIndex, { delta: after - before, owner: p.owner, uiAmount: after });
  }

  // Find treasury credit
  let treasuryCredit = 0, senderWallet = null;
  for (const [, info] of deltaMap) {
    if (info.owner === treasury && info.delta > 0) {
      treasuryCredit = info.delta;
    }
    if (info.delta < 0) {
      senderWallet = info.owner;
    }
  }

  if (treasuryCredit <= 0) {
    throw new Error(`Transaction ${txId.slice(0,12)}… did not send MONET to treasury`);
  }

  const rawActual = Math.round(treasuryCredit * Math.pow(10, DECIMALS));
  if (rawActual < rawExpected) {
    throw new Error(
      `Transaction sent ${treasuryCredit.toFixed(DECIMALS)} MONET but expected ${expectedFee}`
    );
  }

  console.log(`[VERIFY] ✓ tx ${txId.slice(0,12)}… verified: ${treasuryCredit} MONET → treasury from ${(senderWallet||'?').slice(0,8)}…`);
  return { ok: true, senderWallet, amount: treasuryCredit };
}

// ─── CPU score ranges per game/difficulty ─────────────────────────────────────
const CPU_RANGES = {
  easy:   { frogger:[100,350],    snake:[6,16],   pacman:[1000,3500],   pong:[2,4], dino:[300,900],   mario:[100,300]   },
  medium: { frogger:[500,1100],   snake:[22,50],  pacman:[5000,11000],  pong:[5,7], dino:[1200,3000], mario:[300,800]   },
  hard:   { frogger:[1800,4000],  snake:[80,140], pacman:[20000,40000], pong:[7,9], dino:[5000,12000], mario:[800,1500] },
};

// ─── Balance cache (stale-while-revalidate) ───────────────────────────────────
// Keeps the last known-good balance per wallet for up to 90 seconds.
// When RPCs are rate-limited the cached value is returned instead of 0,
// so the user sees a correct balance even during 429 windows.
const BALANCE_CACHE     = new Map();  // wallet → { monet, sol, ata, hasAta, ts }
const BALANCE_CACHE_TTL = 90_000;    // ms

// ─── Routes: wallet utilities ────────────────────────────────────────────────
app.get('/api/balance/:wallet', async (req, res) => {
  const walletAddr = req.params.wallet;
  const cached     = BALANCE_CACHE.get(walletAddr);

  // Serve stale cache while a fresh fetch runs in the background
  if (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) {
    return res.json({ ok: true, ...cached, cached: true });
  }

  try {
    const owner = new PublicKey(walletAddr);
    const mint  = new PublicKey(MINT_ADDRESS);

    // getParsedTokenAccountsByOwner is the most reliable method — returns
    // fully parsed data regardless of which RPC node answers.
    const [tokenResult, solResult] = await Promise.allSettled([
      withRpc(conn => conn.getParsedTokenAccountsByOwner(owner, { mint })),
      withRpc(conn => conn.getBalance(owner)),
    ]);

    const tokenOk = tokenResult.status === 'fulfilled';
    const solOk   = solResult.status   === 'fulfilled';

    // Token RPC failed — serve stale cache or 503 rather than a false 0
    if (!tokenOk) {
      if (cached) {
        console.warn(`[MONET] balance ${walletAddr.slice(0,8)}… token RPC failed, serving cache`);
        const solBalance = solOk ? (solResult.value ?? 0) / 1e9 : cached.sol;
        return res.json({ ok: true, ...cached, sol: solBalance, cached: true, stale: !solOk });
      }
      // No cache and token RPC failed — tell client to keep whatever it has
      console.warn(`[MONET] balance ${walletAddr.slice(0,8)}… token RPC failed, no cache`);
      return res.status(503).json({ error: 'Token RPC unavailable, no cached balance' });
    }

    let monetBalance = 0;
    let hasAta       = false;
    let ata          = null;
    if (tokenResult.value?.value?.length > 0) {
      const acct   = tokenResult.value.value[0];
      monetBalance = acct.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
      hasAta       = true;
      ata          = acct.pubkey.toString();
    } else {
      ata = getATA(mint, owner).toString();
    }

    const solBalance = solOk ? (solResult.value ?? 0) / 1e9 : (cached?.sol ?? 0);
    const entry = { monet: monetBalance, sol: solBalance, ata, hasAta, ts: Date.now() };
    BALANCE_CACHE.set(walletAddr, entry);

    console.log(`[MONET] balance ${walletAddr.slice(0,8)}… monet=${monetBalance} sol=${solBalance} hasAta=${hasAta}`);
    res.json({ ok: true, ...entry });
  } catch(e) {
    if (cached) {
      console.warn(`[MONET] /api/balance error (serving cache):`, e.message);
      return res.json({ ok: true, ...cached, cached: true, stale: true });
    }
    console.error('[MONET] /api/balance error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// Treasury auto-creates the player's MONET Associated Token Account.
// New players don't have an ATA until they acquire MONET, which means
// they also can't receive payouts. Treasury pays the ~0.002 SOL rent.
app.post('/api/create-token-account', async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  try {
    const mint  = new PublicKey(MINT_ADDRESS);
    const owner = new PublicKey(wallet);
    const ata   = getATA(mint, owner);

    // Check if ATA already exists — skip if so
    const existing = await withRpc(conn => conn.getAccountInfo(ata));
    if (existing) return res.json({ ok: true, ata: ata.toString(), created: false });

    const kp = getTreasuryKP();
    if (!kp) {
      // No key — tell client the ATA address so it can display it, but skip creation
      return res.json({ ok: false, ata: ata.toString(), created: false, error: 'Treasury key not set' });
    }

    // Build + sign + send the create-ATA transaction (treasury is payer)
    const txId = await withRpc(async conn => {
      const tx = new Transaction();
      tx.feePayer = kp.publicKey;
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.add(makeCreateATAIx(kp.publicKey, ata, owner, mint));
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction(sig, 'confirmed');
      return sig;
    }, 30000);

    console.log(`[MONET] ATA created for ${wallet.slice(0,8)}… txId: ${txId}`);
    res.json({ ok: true, ata: ata.toString(), created: true, txId });
  } catch(e) {
    console.error('[MONET] create-token-account failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Returns the latest blockhash for clients to build transactions.
// Bypasses browser 403s — the client uses this when direct RPC calls fail.
app.get('/api/blockhash', async (req, res) => {
  try {
    const { blockhash, lastValidBlockHeight } = await withRpc(conn => conn.getLatestBlockhash());
    res.json({ ok: true, blockhash, lastValidBlockHeight });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Returns whether an account (e.g. treasury ATA) exists on-chain.
app.get('/api/account-exists/:address', async (req, res) => {
  try {
    const info = await withRpc(conn => conn.getAccountInfo(new PublicKey(req.params.address)));
    res.json({ ok: true, exists: !!info });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: status ───────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const balance    = await getTreasuryBalance().catch(() => 0);
  const challenges = dbRead('challenges');
  const tourneys   = dbRead('tournaments');
  const claims     = dbRead('claims');
  res.json({
    ok: true,
    treasury:          TREASURY_ADDR,
    balance,
    hasTreasuryKey:    !!getTreasuryKP(),
    openChallenges:    challenges.filter(c => c.status === 'open').length,
    activeChallenges:  challenges.filter(c => c.status === 'active').length,
    activeTournaments: tourneys.filter(t => ['registration','active'].includes(t.status)).length,
    pendingClaims:     claims.filter(c => c.status === 'pending').length,
  });
});

// ─── Routes: challenges ───────────────────────────────────────────────────────
app.post('/api/challenge/create', async (req, res) => {
  const { wallet, txId, game, entryFee: reqFee } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  const challenges = dbRead('challenges');
  challenges.forEach(c => { if (c.status === 'open' && Date.now() > c.expiresAt) c.status = 'expired'; });

  const fee = (reqFee && Number(reqFee) > 0) ? Number(reqFee) : ENTRY_FEE;
  if (!ALLOWED_ENTRY_FEES.has(fee)) {
    return res.status(400).json({ error: `Invalid entry fee. Allowed amounts: ${[...ALLOWED_ENTRY_FEES].join(', ')} MONET` });
  }
  // Reject duplicate txIds to prevent replay
  const allForDedup = dbRead('challenges');
  if (allForDedup.some(c => c.player1?.txId === txId || c.player2?.txId === txId)) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  // Verify payment on-chain
  try { await verifyEntryFee(txId, fee); }
  catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  const code      = genCode();
  const pot       = calcPot(2, fee);
  const challenge = {
    id:        genId(),
    code,
    game,
    player1:   { wallet, txId, score: null, submittedAt: null },
    player2:   null,
    entryFee:  fee,
    pot:       pot.net,
    rake:      pot.rake,
    status:    'open',
    winner:    null,
    payoutTxId: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL,
  };
  challenges.push(challenge);
  dbWrite('challenges', challenges);
  res.json({ ok: true, code, challengeId: challenge.id, pot: pot.net, entryFee: fee });
});

app.get('/api/challenge/:code', (req, res) => {
  const challenges = dbRead('challenges');
  const c = challenges.find(ch => ch.code === req.params.code.toUpperCase());
  if (!c) return res.status(404).json({ error: 'Challenge not found' });
  res.json({ ok: true, challenge: c });
});

app.get('/api/challenges', (req, res) => {
  const { wallet } = req.query;
  let list = dbRead('challenges').filter(c => c.status !== 'expired');
  if (wallet) list = list.filter(c => c.player1?.wallet === wallet || c.player2?.wallet === wallet);
  res.json({ ok: true, challenges: list });
});

app.post('/api/challenge/join', async (req, res) => {
  const { code, wallet, txId } = req.body;
  if (!code || !wallet || !txId) return res.status(400).json({ error: 'code, wallet, txId required' });

  const challenges = dbRead('challenges');
  const idx = challenges.findIndex(c => c.code === code.toUpperCase());
  if (idx === -1) return res.status(404).json({ error: 'Challenge not found' });

  const c = challenges[idx];
  if (c.status !== 'open')          return res.status(409).json({ error: `Challenge is ${c.status}` });
  if (Date.now() > c.expiresAt)     { c.status = 'expired'; dbWrite('challenges', challenges); return res.status(410).json({ error: 'Challenge has expired' }); }
  if (c.player1.wallet === wallet)  return res.status(409).json({ error: 'Cannot challenge yourself' });
  // Reject duplicate txIds to prevent replay
  if (challenges.some(ch => ch.player1?.txId === txId || ch.player2?.txId === txId)) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  // Verify payment on-chain
  try { await verifyEntryFee(txId, c.entryFee || ENTRY_FEE); }
  catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  c.player2 = { wallet, txId, score: null, submittedAt: null };
  c.status  = 'active';
  dbWrite('challenges', challenges);
  res.json({ ok: true, challenge: c });
});

app.post('/api/challenge/submit', async (req, res) => {
  const { challengeId, wallet, score } = req.body;
  if (!challengeId || !wallet || score == null) return res.status(400).json({ error: 'challengeId, wallet, score required' });

  const challenges = dbRead('challenges');
  const idx = challenges.findIndex(c => c.id === challengeId);
  if (idx === -1) return res.status(404).json({ error: 'Challenge not found' });

  const c = challenges[idx];
  if (c.status === 'complete')  return res.json({ ok: true, challenge: c });
  if (Date.now() > c.expiresAt) { c.status = 'expired'; dbWrite('challenges', challenges); return res.status(410).json({ error: 'Challenge expired' }); }

  if (c.player1.wallet === wallet) {
    if (c.player1.score === null || score > c.player1.score) { c.player1.score = score; c.player1.submittedAt = Date.now(); }
  } else if (c.player2?.wallet === wallet) {
    if (c.player2.score === null || score > c.player2.score) { c.player2.score = score; c.player2.submittedAt = Date.now(); }
  } else {
    return res.status(403).json({ error: 'Not a participant in this challenge' });
  }

  if (c.player1.score !== null && c.player2?.score !== null) {
    c.winner = (c.player1.score >= c.player2.score) ? c.player1.wallet : c.player2.wallet;
    c.status = 'complete';
    try {
      c.payoutTxId = await sendPayout(c.winner, c.pot);
      console.log(`[PAYOUT] Challenge ${c.code} winner ${c.winner.slice(0,8)}… paid ${c.pot} MONET`);
    } catch(e) {
      console.error(`[PAYOUT] Challenge ${c.code} payout failed:`, e.message);
      const claims = dbRead('claims');
      claims.push({ id: genId(), type: 'challenge', refId: c.id, wallet: c.winner, amount: c.pot, status: 'pending', error: e.message, createdAt: Date.now() });
      dbWrite('claims', claims);
    }
  }

  dbWrite('challenges', challenges);
  res.json({ ok: true, challenge: c });
});

// ─── Routes: tournaments ──────────────────────────────────────────────────────
app.get('/api/tournament/list', (req, res) => {
  const list = dbRead('tournaments');
  res.json({ ok: true, tournaments: list });
});

app.post('/api/tournament/create', (req, res) => {
  const { game, title, maxPlayers } = req.body;
  if (!game) return res.status(400).json({ error: 'game required' });
  const max = Math.min(MAX_PLAYERS, Math.max(2, parseInt(maxPlayers) || 8));
  const t = {
    id:         genId(),
    game,
    title:      title || `${game.toUpperCase()} TOURNAMENT`,
    maxPlayers: max,
    minPlayers: MIN_PLAYERS,
    players:    [],
    entryFee:   ENTRY_FEE,
    prizePool:  0,
    rake:       0,
    prizes:     PRIZE_CUTS,
    status:     'registration',
    startTime:  null,
    endTime:    null,
    createdAt:  Date.now(),
    winners:    [],
  };
  const tourneys = dbRead('tournaments');
  tourneys.push(t);
  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: t });
});

app.get('/api/tournament/:id', (req, res) => {
  const t = dbRead('tournaments').find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  res.json({ ok: true, tournament: t });
});

app.post('/api/tournament/register', async (req, res) => {
  const { tournamentId, wallet, txId } = req.body;
  if (!tournamentId || !wallet || !txId) return res.status(400).json({ error: 'tournamentId, wallet, txId required' });

  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === tournamentId);
  if (idx === -1) return res.status(404).json({ error: 'Tournament not found' });

  const t = tourneys[idx];
  if (t.status !== 'registration')       return res.status(409).json({ error: `Tournament is ${t.status}` });
  if (t.players.find(p => p.wallet === wallet)) return res.status(409).json({ error: 'Already registered' });
  if (t.players.length >= t.maxPlayers)  return res.status(409).json({ error: 'Tournament is full' });

  // Verify payment on-chain
  try { await verifyEntryFee(txId, t.entryFee || ENTRY_FEE); }
  catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  t.players.push({ wallet, txId, score: null, submittedAt: null, rank: null });
  const pot = calcPot(t.players.length);
  t.prizePool = pot.net;
  t.rake      = pot.rake;

  if (t.players.length >= t.maxPlayers) {
    t.status    = 'active';
    t.startTime = Date.now();
    t.endTime   = Date.now() + TOURNEY_WINDOW;
  }

  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: t });
});

app.post('/api/tournament/start/:id', (req, res) => {
  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const t = tourneys[idx];
  if (t.status !== 'registration') return res.status(409).json({ error: 'Cannot start' });
  if (t.players.length < t.minPlayers) return res.status(409).json({ error: `Need at least ${t.minPlayers} players` });
  t.status    = 'active';
  t.startTime = Date.now();
  t.endTime   = Date.now() + TOURNEY_WINDOW;
  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: t });
});

app.post('/api/tournament/submit', async (req, res) => {
  const { tournamentId, wallet, score } = req.body;
  if (!tournamentId || !wallet || score == null) return res.status(400).json({ error: 'tournamentId, wallet, score required' });

  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === tournamentId);
  if (idx === -1) return res.status(404).json({ error: 'Tournament not found' });

  const t = tourneys[idx];
  if (t.status !== 'active') return res.status(409).json({ error: `Tournament is ${t.status}` });

  const playerIdx = t.players.findIndex(p => p.wallet === wallet);
  if (playerIdx === -1) return res.status(403).json({ error: 'Not registered' });

  if (t.players[playerIdx].score === null || score > t.players[playerIdx].score) {
    t.players[playerIdx].score       = score;
    t.players[playerIdx].submittedAt = Date.now();
  }

  const timeUp   = Date.now() > t.endTime;
  const allDone  = t.players.every(p => p.score !== null);
  if (timeUp || allDone) await settleTournament(tourneys, idx);

  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: tourneys[idx] });
});

async function settleTournament(tourneys, idx) {
  const t = tourneys[idx];
  if (t.status === 'complete') return;
  t.status = 'complete';

  const ranked = [...t.players]
    .filter(p => p.score !== null)
    .sort((a, b) => b.score - a.score);

  ranked.forEach((p, i) => {
    const pl = t.players.find(x => x.wallet === p.wallet);
    if (pl) pl.rank = i + 1;
  });

  const netPool = t.prizePool;
  t.winners = [];

  for (let i = 0; i < Math.min(3, ranked.length); i++) {
    const pct    = PRIZE_CUTS[i] ?? 0;
    const payout = Math.floor(netPool * pct * 100) / 100;
    if (payout <= 0) continue;
    const w = { wallet: ranked[i].wallet, rank: i + 1, payout, payoutTxId: null };
    try {
      w.payoutTxId = await sendPayout(w.wallet, payout);
      console.log(`[PAYOUT] Tournament rank #${i+1} ${w.wallet.slice(0,8)}… paid ${payout} MONET`);
    } catch(e) {
      console.error(`[PAYOUT] Tournament rank #${i+1} payout failed:`, e.message);
      const claims = dbRead('claims');
      claims.push({ id: genId(), type: 'tournament', refId: t.id, wallet: w.wallet, rank: i + 1, amount: payout, status: 'pending', error: e.message, createdAt: Date.now() });
      dbWrite('claims', claims);
    }
    t.winners.push(w);
  }
}

// ─── Routes: claims ───────────────────────────────────────────────────────────
app.get('/api/claims', (req, res) => {
  const { wallet } = req.query;
  let list = dbRead('claims');
  if (wallet) list = list.filter(c => c.wallet === wallet);
  res.json({ ok: true, claims: list });
});

app.post('/api/claims/process', async (req, res) => {
  const { claimId } = req.body;
  const claims = dbRead('claims');
  const idx = claims.findIndex(c => c.id === claimId);
  if (idx === -1) return res.status(404).json({ error: 'Claim not found' });
  const claim = claims[idx];
  if (claim.status !== 'pending') return res.status(409).json({ error: 'Already processed' });
  try {
    claim.payoutTxId   = await sendPayout(claim.wallet, claim.amount);
    claim.status       = 'paid';
    claim.processedAt  = Date.now();
    dbWrite('claims', claims);
    res.json({ ok: true, claim });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: leaderboard ──────────────────────────────────────────────────────
app.get('/api/leaderboard/:game', (req, res) => {
  const { game } = req.params;
  const challenges  = dbRead('challenges').filter(c => c.game === game && c.status === 'complete');
  const tourneys    = dbRead('tournaments').filter(t => t.game === game && t.status === 'complete');

  const scores = {};
  const addScore = (wallet, score) => {
    if (!scores[wallet] || score > scores[wallet]) scores[wallet] = score;
  };

  challenges.forEach(c => {
    if (c.player1.score) addScore(c.player1.wallet, c.player1.score);
    if (c.player2?.score) addScore(c.player2.wallet, c.player2.score);
  });
  tourneys.forEach(t => {
    t.players.forEach(p => { if (p.score) addScore(p.wallet, p.score); });
  });

  const board = Object.entries(scores)
    .map(([wallet, score]) => ({ wallet, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  res.json({ ok: true, game, leaderboard: board });
});

// ─── Routes: CPU challenges ───────────────────────────────────────────────────
app.post('/api/cpu/start', async (req, res) => {
  const { wallet, txId, game, difficulty } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  // Verify payment on-chain
  try { await verifyEntryFee(txId, ENTRY_FEE); }
  catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  const diff   = ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium';
  const range  = CPU_RANGES[diff]?.[game] || [100, 500];
  const cpuScore = Math.floor(range[0] + Math.random() * (range[1] - range[0]));

  const cpuGames = dbRead('cpu_games');
  const id = genId();
  cpuGames.push({ id, wallet, txId, game, difficulty: diff, cpuScore, playerScore: null, won: null, payoutTxId: null, status: 'active', createdAt: Date.now() });
  dbWrite('cpu_games', cpuGames);
  res.json({ ok: true, cpuGameId: id, cpuScore, difficulty: diff });
});

app.post('/api/cpu/submit', async (req, res) => {
  const { cpuGameId, wallet, playerScore } = req.body;
  if (!cpuGameId || !wallet || playerScore == null) return res.status(400).json({ error: 'cpuGameId, wallet, playerScore required' });

  const cpuGames = dbRead('cpu_games');
  const idx = cpuGames.findIndex(g => g.id === cpuGameId && g.wallet === wallet);
  if (idx === -1) return res.status(404).json({ error: 'CPU game not found' });

  const g = cpuGames[idx];
  const CPU_PAYOUTS = { easy: 9, medium: 9, hard: 9 };
  const CPU_PAYOUT = CPU_PAYOUTS[g.difficulty] ?? 9;
  if (g.status === 'complete') return res.json({ ok: true, won: g.won, cpuScore: g.cpuScore, playerScore: g.playerScore, payout: g.won ? CPU_PAYOUT : 0 });

  g.playerScore = playerScore;
  g.won         = playerScore > g.cpuScore;
  g.status      = 'complete';
  const payout  = CPU_PAYOUT;

  if (g.won) {
    try {
      g.payoutTxId = await sendPayout(wallet, payout);
      console.log(`[CPU] ${wallet.slice(0,8)}… beat CPU (${playerScore} vs ${g.cpuScore}) — paid ${payout} MONET`);
    } catch(e) {
      console.error(`[CPU] payout failed:`, e.message);
      const claims = dbRead('claims');
      claims.push({ id: genId(), type: 'cpu', refId: g.id, wallet, amount: payout, status: 'pending', error: e.message, createdAt: Date.now() });
      dbWrite('claims', claims);
    }
  }

  dbWrite('cpu_games', cpuGames);
  res.json({ ok: true, won: g.won, cpuScore: g.cpuScore, playerScore, payout: g.won ? payout : 0 });
});

// ─── Auto-retry pending payouts ───────────────────────────────────────────────
// Runs every 90 seconds. Any claim still in 'pending' state (failed on first
// attempt) is retried automatically as long as TREASURY_PRIVATE_KEY is set.
async function retryPendingClaims() {
  if (!getTreasuryKP()) return; // no key — nothing to do
  const claims = dbRead('claims');
  const pending = claims.filter(c => c.status === 'pending');
  if (!pending.length) return;
  console.log(`[PAYOUT-RETRY] ${pending.length} pending claim(s) — retrying…`);
  let changed = false;
  for (const claim of pending) {
    try {
      claim.payoutTxId  = await sendPayout(claim.wallet, claim.amount);
      claim.status      = 'paid';
      claim.processedAt = Date.now();
      delete claim.error;
      console.log(`[PAYOUT-RETRY] ✓ ${claim.type} ${claim.id.slice(0,8)} → ${claim.wallet.slice(0,8)}… ${claim.amount} MONET`);
      changed = true;
    } catch(e) {
      claim.error       = e.message;
      claim.lastRetryAt = Date.now();
      console.warn(`[PAYOUT-RETRY] ✗ ${claim.id.slice(0,8)} failed again: ${e.message}`);
    }
  }
  if (changed) dbWrite('claims', claims);
}
setInterval(retryPendingClaims, 90_000);
// Also run once 15 s after boot so fresh deploys pick up any queued claims fast
setTimeout(retryPendingClaims, 15_000);

// ─── Static files (production) ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = process.env.PORT || (process.env.NODE_ENV === 'production' ? 5000 : 3001);
app.listen(PORT, '0.0.0.0', () => {
  const hasKey = !!getTreasuryKP();
  console.log(`[MONET] API+WS server :${PORT} | treasury payouts: ${hasKey ? 'ENABLED' : 'QUEUED (set TREASURY_PRIVATE_KEY)'}`);
});
