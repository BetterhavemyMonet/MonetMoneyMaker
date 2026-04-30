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
const DECIMALS        = 6;
const HOUSE_RAKE      = 0.10;
const PRIZE_CUTS      = [0.50, 0.30, 0.10];
const CHALLENGE_TTL   = 24 * 60 * 60 * 1000;
const TOURNEY_WINDOW  = 60 * 60 * 1000;
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 16;

const TOKEN_PROG   = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_PROG   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bT3');
const RPCS = [
  'https://rpc.ankr.com/solana',
  'https://solana-api.projectserum.com',
  'https://api.mainnet-beta.solana.com',
];

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
async function withRpc(fn) {
  let last;
  for (const rpc of RPCS) {
    const conn = new Connection(rpc, 'confirmed');
    try {
      return await Promise.race([
        fn(conn),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 10000)),
      ]);
    } catch(e) { last = e; }
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

async function getTreasuryBalance() {
  try {
    const mint  = new PublicKey(MINT_ADDRESS);
    const owner = new PublicKey(TREASURY_ADDR);
    const ata   = getATA(mint, owner);
    return withRpc(async conn => {
      const info = await conn.getParsedAccountInfo(ata);
      return info?.value?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    });
  } catch { return 0; }
}

// ─── ID generators ────────────────────────────────────────────────────────────
function genCode()  { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function calcPot(n, fee = ENTRY_FEE) {
  const gross = n * fee;
  const rake  = Math.floor(gross * HOUSE_RAKE * 100) / 100;
  return { gross, rake, net: gross - rake };
}

// ─── CPU score ranges per game/difficulty ─────────────────────────────────────
const CPU_RANGES = {
  easy:   { frogger:[80,250],   snake:[4,12],  pacman:[800,2500],   pong:[2,4], dino:[200,600]  },
  medium: { frogger:[250,700],  snake:[12,30], pacman:[2500,7000],  pong:[4,6], dino:[600,1800] },
  hard:   { frogger:[600,1800], snake:[28,70], pacman:[6000,18000], pong:[5,9], dino:[1500,5000]},
};

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
app.post('/api/challenge/create', (req, res) => {
  const { wallet, txId, game } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  const challenges = dbRead('challenges');
  challenges.forEach(c => { if (c.status === 'open' && Date.now() > c.expiresAt) c.status = 'expired'; });

  const code      = genCode();
  const pot       = calcPot(2);
  const challenge = {
    id:        genId(),
    code,
    game,
    player1:   { wallet, txId, score: null, submittedAt: null },
    player2:   null,
    entryFee:  ENTRY_FEE,
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
  res.json({ ok: true, code, challengeId: challenge.id, pot: pot.net });
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

app.post('/api/challenge/join', (req, res) => {
  const { code, wallet, txId } = req.body;
  if (!code || !wallet || !txId) return res.status(400).json({ error: 'code, wallet, txId required' });

  const challenges = dbRead('challenges');
  const idx = challenges.findIndex(c => c.code === code.toUpperCase());
  if (idx === -1) return res.status(404).json({ error: 'Challenge not found' });

  const c = challenges[idx];
  if (c.status !== 'open')          return res.status(409).json({ error: `Challenge is ${c.status}` });
  if (Date.now() > c.expiresAt)     { c.status = 'expired'; dbWrite('challenges', challenges); return res.status(410).json({ error: 'Challenge has expired' }); }
  if (c.player1.wallet === wallet)  return res.status(409).json({ error: 'Cannot challenge yourself' });

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

app.post('/api/tournament/register', (req, res) => {
  const { tournamentId, wallet, txId } = req.body;
  if (!tournamentId || !wallet || !txId) return res.status(400).json({ error: 'tournamentId, wallet, txId required' });

  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === tournamentId);
  if (idx === -1) return res.status(404).json({ error: 'Tournament not found' });

  const t = tourneys[idx];
  if (t.status !== 'registration')       return res.status(409).json({ error: `Tournament is ${t.status}` });
  if (t.players.find(p => p.wallet === wallet)) return res.status(409).json({ error: 'Already registered' });
  if (t.players.length >= t.maxPlayers)  return res.status(409).json({ error: 'Tournament is full' });

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
app.post('/api/cpu/start', (req, res) => {
  const { wallet, txId, game, difficulty } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

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
  if (g.status === 'complete') return res.json({ ok: true, won: g.won, cpuScore: g.cpuScore, playerScore: g.playerScore, payout: g.won ? ENTRY_FEE * (1 - HOUSE_RAKE) : 0 });

  g.playerScore = playerScore;
  g.won         = playerScore > g.cpuScore;
  g.status      = 'complete';
  const payout  = parseFloat((ENTRY_FEE * (1 - HOUSE_RAKE)).toFixed(2));

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
  console.log(`[MONET] API server :${PORT} | treasury payouts: ${hasKey ? 'ENABLED' : 'QUEUED (set TREASURY_PRIVATE_KEY)'}`);
});
