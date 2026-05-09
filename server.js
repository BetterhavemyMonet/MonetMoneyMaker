import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  Keypair, SystemProgram,
} from '@solana/web3.js';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Stripe (Replit connector — sandbox in dev, live in production) ───────────
async function _getStripeCredentials() {
  const hostname     = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  // Fallback: honour plain env vars if Replit connector isn't available
  if (!hostname || !xReplitToken) {
    const sk = process.env.STRIPE_SECRET_KEY;
    const pk = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!sk || !pk) throw new Error('Stripe not configured');
    return { secretKey: sk, publishableKey: pk };
  }

  const env = process.env.REPLIT_DEPLOYMENT === '1' ? 'production' : 'development';
  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets',  'true');
  url.searchParams.set('connector_names',  'stripe');
  url.searchParams.set('environment',      env);

  const resp = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken },
  });
  const data   = await resp.json();
  const conn   = data.items?.[0];
  if (!conn?.settings?.secret || !conn?.settings?.publishable) {
    throw new Error(`Stripe ${env} connection not found`);
  }
  return { secretKey: conn.settings.secret, publishableKey: conn.settings.publishable };
}

// Never cache — always call this to get a fresh client (per Replit guidelines)
async function _getStripeClient() {
  const { secretKey } = await _getStripeCredentials();
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

const CARD_SESSION_TTL = 60 * 60 * 1000; // 1 hour

function getCardSessions() {
  const f = path.join(DATA_DIR, 'card-sessions.json');
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function saveCardSessions(data) {
  fs.writeFileSync(path.join(DATA_DIR, 'card-sessions.json'), JSON.stringify(data, null, 2));
}
function createCardSession(game, paymentIntentId) {
  const token    = crypto.randomUUID();
  const sessions = getCardSessions().filter(s => Date.now() < s.expiresAt);
  sessions.push({ token, game, paymentIntentId, createdAt: Date.now(), expiresAt: Date.now() + CARD_SESSION_TTL, confirmed: false });
  saveCardSessions(sessions);
  return token;
}

const app = express();

app.use(cors({ origin: '*' }));

// Stripe webhook — raw body MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });
  try {
    const stripe = await _getStripeClient().catch(() => null);
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const event  = secret
      ? stripe.webhooks.constructEvent(req.body, sig, secret)
      : JSON.parse(req.body.toString());
    if (event.type === 'payment_intent.succeeded') {
      const pi    = event.data.object;
      const token = pi.metadata?.sessionToken;
      if (token) {
        const sessions = getCardSessions();
        const s = sessions.find(s => s.token === token);
        if (s) { s.confirmed = true; saveCardSessions(sessions); }
      }
    }
    res.json({ received: true });
  } catch(e) {
    console.error('[STRIPE] Webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────
const MINT_ADDRESS    = '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b';
const TREASURY_ADDR   = 'BmEAUUkKcj7BLNAxTF6wqFx6r25wbX5josw4voMbin9z';
const ENTRY_FEE       = 5;   // fallback only — dynamic fee targets $0.50 USD
const TARGET_USD      = 0.50; // entry fee target in USD
const PRICE_CACHE_MS  = 5 * 60 * 1000; // cache MONET price for 5 minutes

// ─── Dynamic MONET pricing ─────────────────────────────────────────────────
let _monetPriceUsd = null;
let _monetPriceTs  = 0;

async function fetchMonetPrice() {
  try {
    // DexScreener — reliable, no API key required
    const r = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${MINT_ADDRESS}`,
      { headers: { 'User-Agent': 'monet-arcade/1.0' } }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    // Use the first pair with a valid USD price (highest liquidity usually first)
    const pairs = d?.pairs || [];
    const best  = pairs.find(p => p.priceUsd && parseFloat(p.priceUsd) > 0);
    const p     = best ? parseFloat(best.priceUsd) : 0;
    if (p > 0) { _monetPriceUsd = p; _monetPriceTs = Date.now(); }
  } catch(e) {
    console.warn('[PRICE] DexScreener fetch failed:', e.message);
  }
  return _monetPriceUsd;
}

async function getMonetPrice() {
  if (_monetPriceUsd && Date.now() - _monetPriceTs < PRICE_CACHE_MS) return _monetPriceUsd;
  return fetchMonetPrice();
}

// Returns the current MONET entry fee (how many MONET = $0.50 USD)
// Falls back to ENTRY_FEE (5) if price cannot be fetched.
async function getDynamicEntryFee() {
  const p = await getMonetPrice();
  if (!p) return ENTRY_FEE;
  return Math.max(1, Math.round(TARGET_USD / p));
}

// Warm the price cache at startup
fetchMonetPrice().then(p => {
  if (p) console.log(`[PRICE] MONET = $${p.toExponential(3)} → entry fee ≈ ${Math.round(TARGET_USD/p)} MONET ($${TARGET_USD})`);
}).catch(() => {});

const DECIMALS        = 6;
const HOUSE_RAKE      = 0.20;
const CPU_PAYOUT_MAX  = 9;
const SOL_ENTRY_LAMPORTS = 1_500_000;   // ~0.0015 SOL ≈ $0.25 at ~$167/SOL
const PRIZE_CUTS      = [0.50, 0.30, 0.20];
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
  process.env.SOLANA_RPC_URL,          // dedicated key — set SOLANA_RPC_URL secret
  'https://solana-rpc.publicnode.com', // free, no key required, reliable
  'https://api.mainnet-beta.solana.com', // official — rate-limited but works
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
  const rawAmt   = Math.round(amount * Math.pow(10, DECIMALS));

  // Phase 1: build + send. Look up actual token accounts via getParsedTokenAccountsByOwner
  // rather than computing with getATA — handles non-standard account addresses correctly.
  let sig = null;
  await withRpc(async conn => {
    // Find the treasury's actual MONET token account
    const srcAccounts = await conn.getParsedTokenAccountsByOwner(treasury, { mint });
    if (!srcAccounts.value.length) throw new Error('Treasury has no MONET token account');
    const srcATA = new PublicKey(srcAccounts.value[0].pubkey);

    // Find or prepare the winner's MONET token account
    const dstAccounts = await conn.getParsedTokenAccountsByOwner(winner, { mint });

    const tx = new Transaction();
    tx.feePayer = treasury;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash      = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    let dstATA;
    if (dstAccounts.value.length) {
      dstATA = new PublicKey(dstAccounts.value[0].pubkey);
    } else {
      // Recipient has no MONET account — create a standard ATA (treasury pays rent)
      dstATA = getATA(mint, winner);
      tx.add(makeCreateATAIx(treasury, dstATA, winner, mint));
    }

    tx.add(makeTransferIx(srcATA, dstATA, treasury, rawAmt));
    tx.sign(kp);
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    console.log(`[PAYOUT] sent ${amount} MONET → ${toAddress.slice(0,8)}… sig: ${sig.slice(0,12)}…`);
  });

  // Phase 2: poll for confirmation (public RPCs don't support signatureSubscribe WebSocket).
  // Poll every 2 s for up to 60 s — tx is in-flight and will confirm regardless.
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const status = await withRpc(conn => conn.getSignatureStatus(sig));
      const conf = status?.value?.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized') {
        console.log(`[PAYOUT] confirmed (${conf}) sig: ${sig.slice(0,12)}…`);
        break;
      }
      if (status?.value?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
    } catch(e) {
      if (e.message.startsWith('Transaction failed')) throw e;
      // RPC error — keep polling
    }
  }
  return sig;
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

// Verify a SOL (lamport) payment to treasury — for the SOL entry-fee option.
async function verifySOLPayment(txId, expectedLamports = SOL_ENTRY_LAMPORTS) {
  let tx;
  try {
    tx = await withRpc(async conn =>
      conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    , 14000);
  } catch(e) {
    console.warn(`[VERIFY-SOL] RPC error ${txId.slice(0,12)}…: ${e.message} — allowing through`);
    return { ok: true, rpcFailed: true };
  }
  if (!tx) {
    console.warn(`[VERIFY-SOL] tx ${txId.slice(0,12)}… not found — allowing through`);
    return { ok: true, rpcFailed: true };
  }
  if (tx.meta?.err) throw new Error(`Transaction ${txId.slice(0,12)}… failed on-chain`);

  // Find treasury account index and check SOL balance delta
  const keys = tx.transaction.message.accountKeys || [];
  const tIdx = keys.findIndex(a => (typeof a === 'string' ? a : a.pubkey?.toString()) === TREASURY_ADDR);
  if (tIdx === -1) throw new Error(`Transaction ${txId.slice(0,12)}… did not involve treasury`);

  const delta = (tx.meta.postBalances[tIdx] ?? 0) - (tx.meta.preBalances[tIdx] ?? 0);
  if (delta < expectedLamports) {
    throw new Error(`SOL payment too small: got ${delta} lamports, expected ${expectedLamports}`);
  }
  console.log(`[VERIFY-SOL] ✓ tx ${txId.slice(0,12)}… verified: ${delta} lamports → treasury`);
  return { ok: true, delta };
}

// ─── CPU score ranges per game/difficulty ─────────────────────────────────────
const CPU_RANGES = {
  easy:   { frogger:[100,350],    snake:[6,16],   pacman:[1000,3500],   pong:[2,4], dino:[300,900],   mario:[100,300]   },
  medium: { frogger:[500,1100],   snake:[22,50],  pacman:[5000,11000],  pong:[5,7], dino:[1200,3000], mario:[300,800]   },
  hard:   { frogger:[1800,4000],  snake:[80,140], pacman:[20000,40000], pong:[7,9], dino:[5000,12000], mario:[800,1500] },
  expert: { frogger:[5000,9000],  snake:[200,400],pacman:[60000,99000], pong:[9,10],dino:[15000,30000],mario:[2000,4000]},
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

// ─── Routes: Stripe card payments ─────────────────────────────────────────────
app.get('/api/stripe/config', async (_req, res) => {
  try {
    const { publishableKey } = await _getStripeCredentials();
    res.json({ ok: true, publishableKey });
  } catch(e) {
    res.json({ ok: false, publishableKey: null, reason: e.message });
  }
});

app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    const stripe       = await _getStripeClient();
    const game         = (req.body.game || 'game').toLowerCase();
    const sessionToken = crypto.randomUUID();
    const pi = await stripe.paymentIntents.create({
      amount:   50,          // $0.50 USD in cents
      currency: 'usd',
      metadata: { game, sessionToken, source: 'monet-arcade' },
    });
    // Pre-create card session (confirmed once payment webhook fires)
    createCardSession(game, pi.id);
    // Patch the stored session with the token we already embedded in metadata
    const sessions = getCardSessions();
    const s = sessions.find(s => s.paymentIntentId === pi.id);
    if (s) { s.token = sessionToken; saveCardSessions(sessions); }
    res.json({ ok: true, clientSecret: pi.client_secret, sessionToken });
  } catch(e) {
    console.error('[STRIPE] create-payment-intent error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/card-session/validate', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const sessions = getCardSessions();
    let s = sessions.find(s => s.token === token);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (Date.now() > s.expiresAt) return res.status(410).json({ error: 'Session expired' });

    // If not yet confirmed by webhook, verify directly with Stripe API
    if (!s.confirmed) {
      try {
        const stripe = await _getStripeClient();
        const pi = await stripe.paymentIntents.retrieve(s.paymentIntentId);
        if (pi.status === 'succeeded') { s.confirmed = true; saveCardSessions(sessions); }
      } catch(_) {}
    }
    if (!s.confirmed) return res.status(402).json({ error: 'Payment not confirmed yet' });

    res.json({ ok: true, game: s.game, expiresAt: s.expiresAt });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: status ───────────────────────────────────────────────────────────
app.get('/api/rpc-url', (_req, res) => {
  const url = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  res.json({ ok: true, url });
});

// ─── Routes: MONET price / dynamic entry fee ──────────────────────────────
app.get('/api/monet-price', async (_req, res) => {
  try {
    const priceUsd     = await getMonetPrice();
    const entryFeeMonet = priceUsd
      ? Math.max(1, Math.round(TARGET_USD / priceUsd))
      : ENTRY_FEE;
    res.json({
      ok: true,
      priceUsd,
      entryFeeMonet,
      entryFeeUsd: TARGET_USD,
      cached: !!(priceUsd && Date.now() - _monetPriceTs < PRICE_CACHE_MS),
    });
  } catch(e) {
    res.json({ ok: true, priceUsd: null, entryFeeMonet: ENTRY_FEE, entryFeeUsd: TARGET_USD });
  }
});

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
  const { wallet, txId, game, entryFee: reqFee, paymentType } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  const challenges = dbRead('challenges');
  challenges.forEach(c => { if (c.status === 'open' && Date.now() > c.expiresAt) c.status = 'expired'; });

  const baseFee = await getDynamicEntryFee();
  const fee = (reqFee && Number(reqFee) > 0) ? Number(reqFee) : baseFee;
  // Accept any fee >= 0.4x and <= 12x of the current dynamic base fee (tolerant of price swings)
  if (fee <= 0 || fee < baseFee * 0.4 || fee > baseFee * 12) {
    return res.status(400).json({ error: `Invalid entry fee: ${fee} MONET (current base: ${baseFee} MONET)` });
  }
  // Reject duplicate txIds to prevent replay
  const allForDedup = dbRead('challenges');
  if (allForDedup.some(c => c.player1?.txId === txId || c.player2?.txId === txId)) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  // Verify payment on-chain — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, fee); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  const code      = genCode();
  const pot       = calcPot(2, fee);
  const challenge = {
    id:        genId(),
    code,
    game,
    player1:   { wallet, txId, paymentType: paymentType || 'monet', score: null, submittedAt: null },
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
  const { code, wallet, txId, paymentType } = req.body;
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

  // Verify payment on-chain — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, c.entryFee || ENTRY_FEE); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  c.player2 = { wallet, txId, paymentType: paymentType || 'monet', score: null, submittedAt: null };
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

app.post('/api/tournament/create', async (req, res) => {
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
    entryFee:   await getDynamicEntryFee(),
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
  const { tournamentId, wallet, txId, paymentType } = req.body;
  if (!tournamentId || !wallet || !txId) return res.status(400).json({ error: 'tournamentId, wallet, txId required' });

  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === tournamentId);
  if (idx === -1) return res.status(404).json({ error: 'Tournament not found' });

  const t = tourneys[idx];
  if (t.status !== 'registration')       return res.status(409).json({ error: `Tournament is ${t.status}` });
  if (t.players.find(p => p.wallet === wallet)) return res.status(409).json({ error: 'Already registered' });
  if (t.players.length >= t.maxPlayers)  return res.status(409).json({ error: 'Tournament is full' });

  // Verify payment on-chain — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, t.entryFee || ENTRY_FEE); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  t.players.push({ wallet, txId, paymentType: paymentType || 'monet', score: null, submittedAt: null, rank: null });
  const pot = calcPot(t.players.length, t.entryFee || ENTRY_FEE);
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

app.get('/api/claims/pending', (_req, res) => {
  const claims = dbRead('claims').filter(c => c.status === 'pending');
  res.json({ ok: true, claims, count: claims.length });
});

// Mark a claim paid after the browser-connected treasury wallet broadcasts the tx.
// Idempotent: safe to call twice with the same txId.
app.post('/api/payout/complete', async (req, res) => {
  const { claimId, txId } = req.body;
  if (!claimId || !txId) return res.status(400).json({ error: 'claimId and txId required' });

  const claims = dbRead('claims');
  const idx = claims.findIndex(c => c.id === claimId);
  if (idx === -1) return res.status(404).json({ error: 'Claim not found' });

  const claim = claims[idx];
  if (claim.status === 'paid') return res.json({ ok: true, claim }); // already done

  claim.payoutTxId  = txId;
  claim.status      = 'paid';
  claim.processedAt = Date.now();
  delete claim.error;
  dbWrite('claims', claims);

  console.log(`[PAYOUT] Browser-signed: ${claim.type} ${claim.id.slice(0,8)} → ${claim.wallet.slice(0,8)}… ${claim.amount} MONET | tx: ${txId.slice(0,12)}…`);
  res.json({ ok: true, claim });
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
  const { wallet, txId, game, paymentType } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  // Verify payment — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, await getDynamicEntryFee()); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  // CPU is always expert
  const diff   = 'expert';
  const range  = CPU_RANGES[diff]?.[game] || [2000, 4000];
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
  const dynFee = await getDynamicEntryFee();
  const CPU_PAYOUT = Math.min(dynFee * 2 * (1 - HOUSE_RAKE), CPU_PAYOUT_MAX * (dynFee / ENTRY_FEE));
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
      // If sendPayout already got a sig (tx sent but confirm timed out), just
      // re-confirm instead of sending a second transaction (avoids double-pay).
      if (claim.payoutTxId) {
        await withRpc(conn => conn.confirmTransaction(claim.payoutTxId, 'confirmed'), 60_000);
        console.log(`[PAYOUT-RETRY] ✓ confirmed existing tx ${claim.payoutTxId.slice(0,12)}… for ${claim.wallet.slice(0,8)}…`);
      } else {
        claim.payoutTxId = await sendPayout(claim.wallet, claim.amount);
        console.log(`[PAYOUT-RETRY] ✓ ${claim.type} ${claim.id.slice(0,8)} → ${claim.wallet.slice(0,8)}… ${claim.amount} MONET`);
      }
      claim.status      = 'paid';
      claim.processedAt = Date.now();
      delete claim.error;
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

// ─── Auto-refund expired open challenges ──────────────────────────────────────
// Runs every 5 minutes. Any challenge that is still 'open' but past its
// expiresAt gets marked 'expired' and a full entry-fee refund is queued for P1.
function refundExpiredChallenges() {
  const challenges = dbRead('challenges');
  const claims     = dbRead('claims');
  const now        = Date.now();
  let changed = false;

  for (const c of challenges) {
    if (c.status !== 'open' || now <= c.expiresAt) continue;
    c.status = 'expired';
    changed  = true;

    // Only queue a refund if one hasn't been created yet for this challenge
    const alreadyQueued = claims.some(cl => cl.refId === c.id && cl.type === 'challenge_expired_refund');
    if (!alreadyQueued && c.player1?.wallet && c.player1.txId !== 'practice-mode') {
      const amount = c.entryFee || ENTRY_FEE;
      claims.push({
        id:        'refund_' + c.code,
        type:      'challenge_expired_refund',
        refId:     c.id,
        wallet:    c.player1.wallet,
        amount,
        status:    'pending',
        error:     `Challenge ${c.code} expired with no opponent — full entry-fee refund`,
        createdAt: now,
      });
      console.log(`[REFUND] Queued ${amount} MONET refund for ${c.player1.wallet.slice(0,8)}… (challenge ${c.code} expired)`);
    }
  }

  if (changed) {
    dbWrite('challenges', challenges);
    dbWrite('claims', claims);
  }
}
setInterval(refundExpiredChallenges, 5 * 60_000);
setTimeout(refundExpiredChallenges, 5_000);

// ─── Admin: server-side process all pending claims ────────────────────────────
// Protected by ADMIN_TOKEN env var. Attempts sendPayout for every pending claim.
// Returns per-claim results so the UI can show pass/fail without wallet signing.
app.post('/api/admin/process-claims', async (req, res) => {
  const token = (req.headers['x-admin-token'] || '').trim();
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }

  const claims = dbRead('claims');
  const pending = claims.filter(c => c.status === 'pending');
  if (!pending.length) return res.json({ ok: true, processed: 0, results: [] });

  const results = [];
  for (const claim of pending) {
    try {
      claim.payoutTxId   = await sendPayout(claim.wallet, claim.amount);
      claim.status       = 'paid';
      claim.processedAt  = Date.now();
      delete claim.error;
      results.push({ id: claim.id, wallet: claim.wallet, amount: claim.amount, ok: true, txId: claim.payoutTxId });
      console.log(`[ADMIN] ✓ paid ${claim.wallet.slice(0,8)}… ${claim.amount} MONET`);
    } catch(e) {
      claim.error       = e.message;
      claim.lastRetryAt = Date.now();
      results.push({ id: claim.id, wallet: claim.wallet, amount: claim.amount, ok: false, error: e.message });
      console.warn(`[ADMIN] ✗ ${claim.id} failed: ${e.message}`);
    }
  }
  dbWrite('claims', claims);
  res.json({ ok: true, processed: pending.length, results });
});

// ─── SOL entry fee info ───────────────────────────────────────────────────────
app.get('/api/sol-entry-fee', (_req, res) => {
  res.json({ ok: true, lamports: SOL_ENTRY_LAMPORTS, sol: SOL_ENTRY_LAMPORTS / 1e9, approxUsd: 0.25 });
});

// ─── Monet Maker Shop ─────────────────────────────────────────────────────────
const SHOP_ITEMS = [
  { id: 'spike_wall',   name: 'Spike Wall',    desc: 'Razor-sharp red barrier — extra-tall & narrow',       monetPrice: 1, lamports:  300_000, row: 3, icon: '🔺', solLabel: '~$0.05' },
  { id: 'mega_bird',    name: 'Mega Bird',     desc: 'Giant gold bird that dominates the airspace',          monetPrice: 1, lamports:  300_000, row: 4, icon: '🦅', solLabel: '~$0.05' },
  { id: 'speed_burst',  name: 'Speed Burst',   desc: 'Cyan zone that triples runner speed for 2 seconds',    monetPrice: 2, lamports:  600_000, row: 5, icon: '⚡', solLabel: '~$0.10' },
  { id: 'double_stack', name: 'Double Stack',  desc: 'Ground + air combo — requires both jump and duck',     monetPrice: 2, lamports:  600_000, row: 6, icon: '📦', solLabel: '~$0.10' },
  { id: 'boss_block',   name: 'Boss Block',    desc: 'Massive pulsing wall — nearly impossible to survive',  monetPrice: 3, lamports:  900_000, row: 7, icon: '💀', solLabel: '~$0.15' },
];

app.get('/api/shop/items', (_req, res) => {
  res.json({ items: SHOP_ITEMS });
});

app.get('/api/shop/owned/:wallet', (req, res) => {
  const { wallet } = req.params;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });
  const purchases = dbRead('shop_purchases');
  const owned = [...new Set(purchases.filter(p => p.wallet === wallet).map(p => p.itemId))];
  res.json({ owned });
});

app.post('/api/shop/purchase', async (req, res) => {
  const { wallet, txId, itemId, paymentType } = req.body;
  if (!wallet || !txId || !itemId) return res.status(400).json({ error: 'wallet, txId, itemId required' });

  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(400).json({ error: 'Unknown item' });

  const purchases = dbRead('shop_purchases');
  if (purchases.some(p => p.txId === txId)) return res.status(400).json({ error: 'Transaction already used' });
  if (purchases.some(p => p.wallet === wallet && p.itemId === itemId)) return res.json({ ok: true, alreadyOwned: true });

  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId, item.lamports); }
    else { await verifyEntryFee(txId, item.monetPrice); }
  } catch (e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  purchases.push({ wallet, txId, itemId, paymentType: paymentType || 'monet', purchasedAt: Date.now() });
  dbWrite('shop_purchases', purchases);
  console.log(`[SHOP] ${wallet.slice(0,8)} purchased ${itemId} via ${paymentType || 'monet'} (${paymentType === 'sol' ? item.lamports + ' lam' : item.monetPrice + ' MONET'})`);
  res.json({ ok: true, item });
});

// ─── Terms acceptance log ─────────────────────────────────────────────────────
app.post('/api/terms/accept', (req, res) => {
  const { username } = req.body || {};
  const record = {
    id: Math.random().toString(36).slice(2),
    username: username || 'anonymous',
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || '',
    timestamp: Date.now(),
    date: new Date().toISOString(),
  };
  const logs = dbRead('terms_log');
  logs.push(record);
  dbWrite('terms_log', logs);
  console.log(`[TERMS] accepted by ${record.username} from ${record.ip}`);
  res.json({ ok: true });
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
  const kp = getTreasuryKP();
  if (kp) {
    const kpAddr = kp.publicKey.toString();
    if (kpAddr !== TREASURY_ADDR) {
      console.error('');
      console.error('╔══════════════════════════════════════════════════════════════╗');
      console.error('║  ⚠️  TREASURY KEY MISMATCH — PAYOUTS WILL FAIL              ║');
      console.error('╠══════════════════════════════════════════════════════════════╣');
      console.error(`║  Expected: ${TREASURY_ADDR}`);
      console.error(`║  Got:      ${kpAddr}`);
      console.error('║                                                              ║');
      console.error('║  Fix: update TREASURY_PRIVATE_KEY secret to the 64-byte     ║');
      console.error(`║  private key for address: ${TREASURY_ADDR.slice(0,20)}…   ║`);
      console.error('╚══════════════════════════════════════════════════════════════╝');
      console.error('');
    } else {
      console.log(`[MONET] API+WS server :${PORT} | treasury payouts: ENABLED ✓ (key verified)`);
    }
  } else {
    console.log(`[MONET] API+WS server :${PORT} | treasury payouts: QUEUED (set TREASURY_PRIVATE_KEY)`);
  }
});
