// ─── MONET ARCADE WALLET UTILITIES ───────────────────────────────────────────
// Multi-wallet adapter: Phantom, Solflare, Backpack, Glow, Coin98, Trust

const MONET_CONFIG = {
  MINT:         '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b',
  TREASURY:     'BmEAUUkKcj7BLNAxTF6wqFx6r25wbX5josw4voMbin9z',
  ENTRY_FEE:    5,      // updated dynamically by fetchEntryFee()
  ENTRY_FEE_USD: 0.50,  // target USD value per entry
  PAYOUT_RATE:  0.80,
  DECIMALS:     6,
  SYMBOL:       'MONET',
};

// ─── Dynamic entry fee ────────────────────────────────────────────────────────
// Fetches the current MONET price from the server and updates MONET_CONFIG.ENTRY_FEE
// so that it always equals $0.50 worth of MONET. Cached by the server for 5 min.
let _entryFeeFetched = false;
async function fetchEntryFee() {
  try {
    const r = await fetch('/api/monet-price');
    if (!r.ok) return;
    const d = await r.json();
    if (d.entryFeeMonet && d.entryFeeMonet > 0) {
      MONET_CONFIG.ENTRY_FEE = d.entryFeeMonet;
      MONET_CONFIG._priceUsd  = d.priceUsd;
      _entryFeeFetched = true;
      // Notify pay gate if it's already open
      document.dispatchEvent(new CustomEvent('entryFeeUpdated', { detail: d }));
    }
  } catch(_) {}
}

// Fetch on load, refresh every 5 minutes
fetchEntryFee();
setInterval(fetchEntryFee, 5 * 60 * 1000);

// Client-side RPC endpoints — last-resort fallback only.
// All balance/account queries now go through /api/balance (server-side) to
// avoid browser CORS rate-limit 403s on these public endpoints.
const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://mainnet.helius-rpc.com/',
];

const RPC_TIMEOUT_MS = 10000;

const TOKEN_PROGRAM_ID_STR       = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_STR = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bT3';

// ─── Wallet Definitions ───────────────────────────────────────────────────────
const WALLET_DEFS = [
  {
    name:     'Phantom',
    icon:     'https://phantom.app/img/phantom-logo.svg',
    detect:   () => window.phantom?.solana?.isPhantom ? window.phantom.solana
                  : window.solana?.isPhantom           ? window.solana
                  : null,
    install:  'https://phantom.app/',
    deeplink: () => `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
  },
  {
    name:     'Solflare',
    icon:     'https://solflare.com/assets/logo.svg',
    detect:   () => window.solflare?.isSolflare ? window.solflare : null,
    install:  'https://solflare.com/',
    deeplink: () => `https://solflare.com/ul/v1/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
  },
  {
    name:     'Backpack',
    icon:     'https://avatars.githubusercontent.com/u/97015936?s=48',
    detect:   () => window.backpack?.isBackpack ? window.backpack
                  : window.xnft?.solana         ? window.xnft.solana
                  : null,
    install:  'https://backpack.app/',
    deeplink: null,
  },
  {
    name:     'Glow',
    icon:     '',
    detect:   () => window.glowSolana?.isGlow ? window.glowSolana
                  : window.glow?.isGlow        ? window.glow
                  : null,
    install:  'https://glow.app/',
    deeplink: null,
  },
  {
    name:     'Coin98',
    icon:     '',
    detect:   () => window.coin98?.sol ?? null,
    install:  'https://coin98.com/wallet',
    deeplink: null,
  },
  {
    name:     'Trust Wallet',
    icon:     '',
    detect:   () => window.trustwallet?.solana ?? null,
    install:  'https://trustwallet.com/',
    deeplink: null,
  },
  {
    name:     'Math Wallet',
    icon:     '',
    detect:   () => window.solana?.isMathWallet ? window.solana : null,
    install:  'https://mathwallet.org/',
    deeplink: null,
  },
];

// ─── State ────────────────────────────────────────────────────────────────────
window.WalletState = {
  connected:    false,
  address:      null,
  monetBalance: 0,
  tokens:       [],
  solBalance:   0,
  walletName:   null,
  _provider:    null,
};

// ─── Provider Access ──────────────────────────────────────────────────────────
function getProvider() {
  if (WalletState._provider) return WalletState._provider;
  // fallback: try any available
  for (const def of WALLET_DEFS) {
    const p = def.detect();
    if (p) return p;
  }
  return null;
}

function getAvailableWallets() {
  return WALLET_DEFS
    .map(def => ({ ...def, provider: def.detect() }))
    .filter(w => w.provider !== null);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSolanaWeb3() {
  if (!window.solanaWeb3) throw new Error('solanaWeb3 not loaded');
  return window.solanaWeb3;
}

function _makeConnection(rpc) {
  const w = getSolanaWeb3();
  return new w.Connection(rpc, 'confirmed');
}

// Wraps an async RPC call, trying each endpoint in sequence with a timeout.
// fn receives a Connection and must return a Promise.
async function withRpcFallback(fn) {
  let lastErr;
  for (const rpc of RPC_ENDPOINTS) {
    const conn = _makeConnection(rpc);
    try {
      const result = await Promise.race([
        fn(conn),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`RPC timeout: ${rpc}`)), RPC_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch (e) {
      console.warn(`[MONET] RPC failed (${rpc}):`, e.message ?? e);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All RPC endpoints failed');
}

// Convenience: returns the first working Connection (used by payEntryFee which
// needs to reuse the same connection for blockhash + send).
async function getWorkingConnection() {
  let lastErr;
  for (const rpc of RPC_ENDPOINTS) {
    const conn = _makeConnection(rpc);
    try {
      await Promise.race([
        conn.getSlot(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout`)), RPC_TIMEOUT_MS)
        ),
      ]);
      return conn;
    } catch (e) {
      console.warn(`[MONET] Connection probe failed (${rpc}):`, e.message ?? e);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('No working RPC found');
}

function toRawAmount(uiAmount) {
  return Math.round(uiAmount * Math.pow(10, MONET_CONFIG.DECIMALS));
}

function getATA(mintPubkey, ownerPubkey) {
  const w = getSolanaWeb3();
  const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
  const ASSOC_PROGRAM_ID = new w.PublicKey(ASSOCIATED_TOKEN_PROGRAM_STR);
  return w.PublicKey.findProgramAddressSync(
    [ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    ASSOC_PROGRAM_ID
  )[0];
}

function createATAInstruction(payerPubkey, ataPubkey, ownerPubkey, mintPubkey) {
  const w = getSolanaWeb3();
  const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
  const ASSOC_PROGRAM_ID = new w.PublicKey(ASSOCIATED_TOKEN_PROGRAM_STR);
  return new w.TransactionInstruction({
    keys: [
      { pubkey: payerPubkey, isSigner: true,  isWritable: true  },
      { pubkey: ataPubkey,   isSigner: false, isWritable: true  },
      { pubkey: ownerPubkey, isSigner: false, isWritable: false },
      { pubkey: mintPubkey,  isSigner: false, isWritable: false },
      { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    ],
    programId: ASSOC_PROGRAM_ID,
    data: new Uint8Array([0]),
  });
}

function createTransferInstruction(sourcePubkey, destPubkey, ownerPubkey, rawAmount) {
  const w = getSolanaWeb3();
  const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);
  return new w.TransactionInstruction({
    keys: [
      { pubkey: sourcePubkey, isSigner: false, isWritable: true  },
      { pubkey: destPubkey,   isSigner: false, isWritable: true  },
      { pubkey: ownerPubkey,  isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

// Memo program — adds a human-readable label to a transaction.
// Phantom (and other wallets) display this text in the approval dialog
// instead of showing a raw token transfer, which removes the "unknown"
// warning for players.
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function createMemoInstruction(signerPubkey, text) {
  const w = getSolanaWeb3();
  const encoder = new TextEncoder();
  return new w.TransactionInstruction({
    keys:      [{ pubkey: signerPubkey, isSigner: true, isWritable: false }],
    programId: new w.PublicKey(MEMO_PROGRAM_ID),
    data:      encoder.encode(text),
  });
}

// ─── Wallet Picker Modal ──────────────────────────────────────────────────────
function _injectModalStyles() {
  if (document.getElementById('wm-styles')) return;
  const s = document.createElement('style');
  s.id = 'wm-styles';
  s.textContent = `
    #wm-overlay {
      position:fixed; inset:0; background:rgba(0,0,0,0.82); z-index:99999;
      display:flex; align-items:center; justify-content:center;
      font-family:'Orbitron',sans-serif;
    }
    #wm-box {
      background:#0b0f1a; border:1px solid #a855ff;
      border-radius:16px; padding:24px 20px 20px;
      width:min(340px, 94vw); box-shadow:0 0 40px #a855ff44;
      color:#fff; text-align:center;
    }
    #wm-title { font-size:14px; font-weight:800; color:#a855ff; margin-bottom:6px; }
    #wm-sub   { font-size:11px; color:#888; margin-bottom:16px; }
    .wm-btn {
      display:flex; align-items:center; gap:12px;
      width:100%; padding:11px 14px; margin-bottom:9px;
      border-radius:10px; border:1px solid #333;
      background:#111827; color:#fff; cursor:pointer;
      font-family:'Orbitron',sans-serif; font-size:12px; font-weight:600;
      transition:border-color .15s, box-shadow .15s;
    }
    .wm-btn:hover { border-color:#a855ff; box-shadow:0 0 12px #a855ff44; }
    .wm-btn img  { width:24px; height:24px; border-radius:6px; object-fit:contain; background:#fff; }
    .wm-btn .wm-icon-fallback { width:24px; height:24px; border-radius:6px; background:#222; display:flex; align-items:center; justify-content:center; font-size:16px; }
    .wm-btn .wm-badge { margin-left:auto; font-size:9px; color:#00ff9d; border:1px solid #00ff9d44; padding:2px 7px; border-radius:20px; }
    .wm-btn .wm-badge-install { color:#888; border-color:#33333380; }
    #wm-cancel { color:#555; font-size:11px; cursor:pointer; margin-top:6px; background:none; border:none; font-family:inherit; }
    #wm-cancel:hover { color:#ff4488; }
    #wm-deeplink-notice { font-size:10px; color:#555; margin-top:12px; line-height:1.5; }
  `;
  document.head.appendChild(s);
}

function showWalletPicker() {
  return new Promise((resolve, reject) => {
    _injectModalStyles();
    const overlay = document.createElement('div');
    overlay.id = 'wm-overlay';

    const available = getAvailableWallets();
    const isMobile  = /iPhone|iPad|Android/i.test(navigator.userAgent);

    let buttonsHtml = '';

    if (available.length > 0) {
      available.forEach(w => {
        const iconHtml = w.icon
          ? `<img src="${w.icon}" alt="${w.name}" onerror="this.style.display='none'">`
          : `<span class="wm-icon-fallback">💳</span>`;
        buttonsHtml += `
          <button class="wm-btn" data-wallet="${w.name}">
            ${iconHtml}
            <span>${w.name}</span>
            <span class="wm-badge">Detected</span>
          </button>`;
      });
    }

    // On mobile also show deeplink options for undetected wallets
    if (isMobile) {
      WALLET_DEFS.filter(d => !available.find(a => a.name === d.name) && d.deeplink).forEach(w => {
        buttonsHtml += `
          <button class="wm-btn" data-deeplink="${w.deeplink()}">
            ${w.icon ? `<img src="${w.icon}" alt="${w.name}" onerror="this.style.display='none'">` : `<span class="wm-icon-fallback">📲</span>`}
            <span>${w.name}</span>
            <span class="wm-badge wm-badge-install">Open app</span>
          </button>`;
      });
    }

    if (available.length === 0 && !isMobile) {
      buttonsHtml = `<p style="color:#888;font-size:12px">No Solana wallet detected.<br>Install <a href="https://phantom.app" target="_blank" style="color:#a855ff">Phantom</a> or <a href="https://solflare.com" target="_blank" style="color:#a855ff">Solflare</a> to continue.</p>`;
    }

    overlay.innerHTML = `
      <div id="wm-box">
        <div id="wm-title">SELECT WALLET</div>
        <div id="wm-sub">Choose your Solana wallet to connect</div>
        ${buttonsHtml}
        <button id="wm-cancel">Cancel</button>
        ${isMobile && available.length === 0 ? '<div id="wm-deeplink-notice">Tap an app above to open it, then return to this page.</div>' : ''}
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.wm-btn[data-wallet]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.wallet;
        const def  = WALLET_DEFS.find(d => d.name === name);
        overlay.remove();
        resolve({ provider: def.detect(), name });
      });
    });

    overlay.querySelectorAll('.wm-btn[data-deeplink]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.remove();
        window.location.href = btn.dataset.deeplink;
        reject(new Error('Redirecting to wallet app…'));
      });
    });

    document.getElementById('wm-cancel').addEventListener('click', () => {
      overlay.remove();
      reject(new Error('Wallet selection cancelled'));
    });
  });
}

// ─── Connect Wallet ───────────────────────────────────────────────────────────
async function connectWallet() {
  const available = getAvailableWallets();

  let chosen;
  if (available.length === 1) {
    chosen = { provider: available[0].provider, name: available[0].name };
  } else {
    // show picker even if 0 (handles install/deeplink case)
    chosen = await showWalletPicker();
  }

  const provider = chosen.provider;
  const resp = await provider.connect();
  const address = (resp.publicKey || provider.publicKey).toString();

  WalletState._provider    = provider;
  WalletState.walletName   = chosen.name;
  WalletState.connected    = true;
  WalletState.address      = address;
  localStorage.setItem('wallet_address', address);
  localStorage.setItem('wallet_name', chosen.name);

  // Fire walletConnected immediately so the UI shows "connected" right away,
  // then fetch the balance (may need a retry if RPC is warm-up rate-limiting).
  document.dispatchEvent(new CustomEvent('walletConnected', { detail: { address, walletName: chosen.name } }));
  await refreshBalances();
  // If balance is still 0 after first fetch, retry once more after a short delay
  if (WalletState.monetBalance === 0) {
    setTimeout(async () => { await refreshBalances(); }, 4000);
  }
  ensureMonetAccount(); // fire-and-forget: treasury creates player ATA if missing
  return address;
}

async function disconnectWallet() {
  const p = getProvider();
  if (p && p.disconnect) await p.disconnect().catch(() => {});
  WalletState.connected    = false;
  WalletState.address      = null;
  WalletState.monetBalance = 0;
  WalletState.tokens       = [];
  WalletState._provider    = null;
  WalletState.walletName   = null;
  localStorage.removeItem('wallet_address');
  localStorage.removeItem('wallet_name');
  document.dispatchEvent(new CustomEvent('walletDisconnected'));
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────────
async function tryAutoConnect() {
  const savedName    = localStorage.getItem('wallet_name');
  const savedAddress = localStorage.getItem('wallet_address');
  if (!savedAddress) return;

  // Try to find the previously used wallet
  const def = WALLET_DEFS.find(d => d.name === savedName);
  const provider = def ? def.detect() : getAvailableWallets()[0]?.provider;
  if (!provider) return;

  try {
    const resp = await provider.connect({ onlyIfTrusted: true });
    const address = (resp.publicKey || provider.publicKey).toString();
    WalletState._provider    = provider;
    WalletState.walletName   = savedName || def?.name;
    WalletState.connected    = true;
    WalletState.address      = address;
    localStorage.setItem('wallet_address', address);
    document.dispatchEvent(new CustomEvent('walletConnected', { detail: { address } }));
    await refreshBalances();
    if (WalletState.monetBalance === 0) {
      setTimeout(async () => { await refreshBalances(); }, 4000);
    }
    ensureMonetAccount(); // fire-and-forget: treasury creates player ATA if missing
  } catch(e) { /* not previously trusted */ }
}

// ─── Balances ─────────────────────────────────────────────────────────────────
// Primary path: call server /api/balance — server-side Node.js bypasses the
// browser CORS / rate-limit 403s that plague public Solana RPC endpoints.
async function refreshBalances() {
  if (!WalletState.address) return;
  let updated = false;
  try {
    const res  = await fetch(`/api/balance/${WalletState.address}`);
    if (res.ok) {
      const data = await res.json();
      // Always trust a 200 OK response — avoids stale display if the player
      // spends all their MONET. The 503 (all RPCs down) case is handled
      // separately by keeping the last known value.
      WalletState.monetBalance = data.monet ?? WalletState.monetBalance;
      WalletState.solBalance   = data.sol   ?? WalletState.solBalance;
      WalletState.hasMonetAta  = data.hasAta ?? WalletState.hasMonetAta;
      updated = true;

      // Auto-create MONET token account if the wallet doesn't have one yet.
      // Treasury pays the ~0.002 SOL rent — completely transparent to the user.
      if (!data.hasAta && WalletState.address) {
        fetch('/api/create-token-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: WalletState.address }),
        })
          .then(r => r.json())
          .then(d => {
            if (d.created) {
              console.log('[MONET] Token account created for', WalletState.address?.slice(0, 8));
              WalletState.hasMonetAta = true;
              // Re-fetch balance so UI reflects the new account
              setTimeout(refreshBalances, 3000);
            }
          })
          .catch(() => {});
      }
    }
    // 503 = all RPCs down with no cache — keep whatever balance we already have
  } catch(_) {}

  if (!updated) {
    // Fallback: direct browser RPC — only update if we get a real value back
    await Promise.allSettled([
      getMonetBalanceDirect().then(b => { if (b > 0) WalletState.monetBalance = b; }).catch(() => {}),
      getSolBalanceDirect().then(b   => { if (b >= 0) WalletState.solBalance = b; }).catch(() => {}),
    ]);
  }
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));
}

// Server-proxied helpers (preferred)
async function getMonetBalance() {
  if (!WalletState.address) return 0;
  try {
    const res = await fetch(`/api/balance/${WalletState.address}`);
    if (res.ok) { const d = await res.json(); return d.monet ?? 0; }
  } catch(_) {}
  return getMonetBalanceDirect();
}

async function getSolBalance() {
  if (!WalletState.address) return 0;
  try {
    const res = await fetch(`/api/balance/${WalletState.address}`);
    if (res.ok) { const d = await res.json(); return d.sol ?? 0; }
  } catch(_) {}
  return getSolBalanceDirect();
}

// Direct browser RPC (fallback only — often 403s on public endpoints)
async function getMonetBalanceDirect() {
  try {
    const w     = getSolanaWeb3();
    const mint  = new w.PublicKey(MONET_CONFIG.MINT);
    const owner = new w.PublicKey(WalletState.address);
    const accounts = await withRpcFallback(conn =>
      conn.getParsedTokenAccountsByOwner(owner, { mint })
    );
    if (!accounts || accounts.value.length === 0) return 0;
    return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
  } catch(e) {
    console.warn('[MONET] getMonetBalanceDirect failed:', e.message);
    return 0;
  }
}

async function getSolBalanceDirect() {
  try {
    const w = getSolanaWeb3();
    const owner = new w.PublicKey(WalletState.address);
    const lamports = await withRpcFallback(conn => conn.getBalance(owner));
    return (lamports ?? 0) / 1e9;
  } catch(e) {
    console.warn('[MONET] getSolBalanceDirect failed:', e.message);
    return 0;
  }
}

// Auto-create the player's MONET Associated Token Account if missing.
// Treasury pays the ~0.002 SOL rent so the player needs no SOL to get started.
async function ensureMonetAccount() {
  if (!WalletState.address) return;
  // Skip entirely if we already know the ATA exists — avoids unnecessary RPC calls
  if (WalletState.hasMonetAta) return;
  try {
    const res  = await fetch('/api/create-token-account', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ wallet: WalletState.address }),
    });
    const data = await res.json();
    if (data.created) {
      console.log('[MONET] Token account created for player:', data.ata);
      WalletState.hasMonetAta = true;
      setTimeout(refreshBalances, 2000);
    } else if (data.ok) {
      WalletState.hasMonetAta = true;
    }
  } catch(e) {
    console.warn('[MONET] ensureMonetAccount failed:', e.message);
  }
}

async function getAllTokens() {
  if (!WalletState.address) return [];
  try {
    const w = getSolanaWeb3();
    const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
    const owner = new w.PublicKey(WalletState.address);
    const accounts = await withRpcFallback(conn =>
      conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
    );
    if (!accounts) return [];
    return accounts.value
      .map(a => {
        const info = a.account.data.parsed.info;
        return {
          mint:     info.mint,
          balance:  info.tokenAmount.uiAmount || 0,
          decimals: info.tokenAmount.decimals,
          isMonet:  info.mint === MONET_CONFIG.MINT,
          address:  a.pubkey.toString(),
        };
      })
      .filter(t => t.balance > 0)
      .sort((a, b) => b.isMonet - a.isMonet);
  } catch(e) {
    console.warn('[MONET] getAllTokens failed after all RPCs:', e);
    return [];
  }
}

// ─── Pay Entry Fee ────────────────────────────────────────────────────────────
// amount: optional override (defaults to MONET_CONFIG.ENTRY_FEE)
// Resilient to browser-level RPC 403s: falls back to server endpoints for
// blockhash and account checks; wallet's own RPC handles broadcast/signing.
async function payEntryFee(gameName, onProgress, amount) {
  const fee = (amount && Number(amount) > 0) ? Number(amount) : MONET_CONFIG.ENTRY_FEE;
  const report = (step) => { try { onProgress && onProgress(step); } catch(_) {} };

  report('checking');
  if (!WalletState.connected || !WalletState.address) throw new Error('Connect wallet first');

  // Always refresh balance from server before checking sufficiency
  await refreshBalances().catch(() => {});
  if (WalletState.monetBalance < fee) {
    throw new Error(`Insufficient MONET. Need ${fee}, have ${WalletState.monetBalance.toFixed(2)}`);
  }

  const provider = getProvider();
  if (!provider)  throw new Error('No wallet provider found');

  const w        = getSolanaWeb3();
  const payer    = new w.PublicKey(WalletState.address);
  const mint     = new w.PublicKey(MONET_CONFIG.MINT);
  const treasury = new w.PublicKey(MONET_CONFIG.TREASURY);
  const sourceATA = getATA(mint, payer);
  const destATA   = getATA(mint, treasury);

  // ── Step 1: get blockhash ──────────────────────────────────────────────────
  // Try direct RPC first; fall back to server /api/blockhash to bypass browser 403s.
  let blockhash;
  try {
    const conn = await getWorkingConnection();
    ({ blockhash } = await conn.getLatestBlockhash());
  } catch(_) {
    try {
      const r = await fetch('/api/blockhash');
      if (!r.ok) throw new Error(`/api/blockhash ${r.status}`);
      ({ blockhash } = await r.json());
    } catch(e) {
      throw new Error(`Could not fetch blockhash: ${e.message}`);
    }
  }

  // ── Step 2: check treasury ATA, build transaction ─────────────────────────
  let tx;
  try {
    tx = new w.Transaction();
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;

    // Check treasury ATA existence via server to avoid browser 403s
    let destATAExists = false;
    try {
      const r = await fetch(`/api/account-exists/${destATA.toString()}`);
      if (r.ok) { const d = await r.json(); destATAExists = d.exists; }
    } catch(_) {
      // fallback: try direct RPC
      const conn = await getWorkingConnection().catch(() => null);
      if (conn) {
        const info = await conn.getAccountInfo(destATA).catch(() => null);
        destATAExists = !!info;
      }
    }
    if (!destATAExists) tx.add(createATAInstruction(payer, destATA, treasury, mint));
  } catch(e) {
    throw new Error(`Transaction preparation failed: ${e.message}`);
  }

  tx.add(createTransferInstruction(sourceATA, destATA, payer, toRawAmount(fee)));

  // Memo so wallets display a clear label ("Monet Arcade | PACMAN | 5 MONET")
  // instead of an anonymous token transfer, which reduces Phantom's risk warnings.
  const gameLabel = (gameName || 'GAME').toUpperCase();
  tx.add(createMemoInstruction(payer, `Monet Arcade | ${gameLabel} | ${fee} MONET entry fee`));

  // ── Step 3: sign & send via wallet (wallet uses its own RPC for broadcast) ─
  report('signing');
  let txId;
  try {
    if (provider.signAndSendTransaction) {
      const result = await provider.signAndSendTransaction(tx);
      txId = result.signature || result;
    } else {
      // signTransaction path — need a connection for sendRawTransaction
      const conn = await getWorkingConnection();
      const signed = await provider.signTransaction(tx);
      txId = await conn.sendRawTransaction(signed.serialize());
    }
  } catch(e) {
    throw new Error(`Signing failed: ${e.message}`);
  }

  // ── Step 4: confirm (best-effort; tx is signed and sent regardless) ────────
  report('confirming');
  try {
    const conn = await getWorkingConnection();
    await conn.confirmTransaction(txId, 'confirmed');
  } catch(_) {
    // Wallet already broadcast — confirmTransaction is informational only.
    // The session is still created with the txId for audit.
    console.warn('[MONET] confirmTransaction failed (tx may still confirm):', txId);
  }

  WalletState.monetBalance -= fee;
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));

  const session = { game: gameName, txId, paidAt: Date.now(), wallet: WalletState.address, entryFee: fee };
  sessionStorage.setItem('game_session', JSON.stringify(session));
  return txId;
}

window.payEntryFee        = payEntryFee;
window.ensureMonetAccount = ensureMonetAccount;
window.refreshBalances    = refreshBalances;

// ─── Pay Entry Fee (SOL) ──────────────────────────────────────────────────────
// Sends native SOL to treasury (~$0.25 worth) as an alternative to MONET.
const SOL_ENTRY_LAMPORTS = 1_500_000; // 0.0015 SOL ≈ $0.25 at ~$167/SOL

async function payEntryFeeSOL(gameName, onProgress, lamports) {
  const lam    = (lamports && lamports > 0) ? lamports : SOL_ENTRY_LAMPORTS;
  const report = (step) => { try { onProgress && onProgress(step); } catch(_) {} };

  report('checking');
  if (!WalletState.connected || !WalletState.address) throw new Error('Connect wallet first');

  await refreshBalances().catch(() => {});
  const solNeeded = lam / 1e9 + 0.001; // add tx fee buffer
  if (WalletState.solBalance < solNeeded) {
    throw new Error(`Insufficient SOL. Need ~${(lam/1e9).toFixed(4)}, have ${WalletState.solBalance.toFixed(4)}`);
  }

  const provider = getProvider();
  if (!provider)  throw new Error('No wallet provider found');

  const w       = getSolanaWeb3();
  const payer   = new w.PublicKey(WalletState.address);
  const treasury = new w.PublicKey(MONET_CONFIG.TREASURY);

  // Blockhash
  let blockhash;
  try {
    const conn = await getWorkingConnection();
    ({ blockhash } = await conn.getLatestBlockhash());
  } catch(_) {
    try {
      const r = await fetch('/api/blockhash');
      if (!r.ok) throw new Error(`/api/blockhash ${r.status}`);
      ({ blockhash } = await r.json());
    } catch(e) { throw new Error(`Could not fetch blockhash: ${e.message}`); }
  }

  const tx = new w.Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;

  // Native SOL transfer
  tx.add(w.SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports: lam }));

  // Memo for clear wallet display
  const gameLabel = (gameName || 'GAME').toUpperCase();
  tx.add(createMemoInstruction(payer, `Monet Arcade | ${gameLabel} | SOL entry fee`));

  report('signing');
  let txId;
  try {
    if (provider.signAndSendTransaction) {
      const result = await provider.signAndSendTransaction(tx);
      txId = result.signature || result;
    } else {
      const conn   = await getWorkingConnection();
      const signed = await provider.signTransaction(tx);
      txId = await conn.sendRawTransaction(signed.serialize());
    }
  } catch(e) { throw new Error(`Signing failed: ${e.message}`); }

  report('confirming');
  try {
    const conn = await getWorkingConnection();
    await conn.confirmTransaction(txId, 'confirmed');
  } catch(_) {
    console.warn('[MONET] SOL confirmTransaction timed out (tx may still confirm):', txId);
  }

  WalletState.solBalance -= lam / 1e9;
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));

  const session = { game: gameName, txId, paidAt: Date.now(), wallet: WalletState.address, paymentType: 'sol', lamports: lam };
  sessionStorage.setItem('game_session', JSON.stringify(session));
  return txId;
}

window.payEntryFeeSOL = payEntryFeeSOL;

// ─── Pay Shop Item (MONET or SOL) ─────────────────────────────────────────────
async function payShopItem(amountMonet, itemId, onProgress) {
  return payEntryFee(`SHOP_${(itemId || 'ITEM').toUpperCase()}`, onProgress, amountMonet);
}
async function payShopItemSOL(lamports, itemId, onProgress) {
  return payEntryFeeSOL(`SHOP_${(itemId || 'ITEM').toUpperCase()}`, onProgress, lamports);
}
window.payShopItem    = payShopItem;
window.payShopItemSOL = payShopItemSOL;

// ─── Record Win / Claim ───────────────────────────────────────────────────────
function recordWin(gameName, score) {
  const session = JSON.parse(sessionStorage.getItem('game_session') || 'null');
  if (!session) return false;
  const payout = (session.entryFee || MONET_CONFIG.ENTRY_FEE) * MONET_CONFIG.PAYOUT_RATE;
  const claim = {
    id:        Date.now().toString(36),
    wallet:    WalletState.address || session.wallet,
    game:      gameName,
    score,
    payout,
    entryTx:   session.txId,
    claimedAt: new Date().toISOString(),
    status:    'pending',
  };
  const claims = JSON.parse(localStorage.getItem('pending_claims') || '[]');
  claims.push(claim);
  localStorage.setItem('pending_claims', JSON.stringify(claims));
  sessionStorage.removeItem('game_session');
  return claim;
}

// ─── Check Valid Session ──────────────────────────────────────────────────────
function hasValidSession(gameName) {
  try {
    const s = JSON.parse(sessionStorage.getItem('game_session') || 'null');
    if (!s) return false;
    if (s.game !== gameName) return false;
    if (Date.now() - s.paidAt > 30 * 60 * 1000) return false;
    return true;
  } catch { return false; }
}

// ─── Wallet UI Helper ─────────────────────────────────────────────────────────
function renderWalletBar(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  function render() {
    if (WalletState.connected) {
      const short = WalletState.address.slice(0,4) + '...' + WalletState.address.slice(-4);
      const wname = WalletState.walletName ? `<span style="color:#888;font-size:10px;margin-right:6px">${WalletState.walletName}</span>` : '';
      el.innerHTML = `
        ${wname}
        <span style="color:#00ff9d;font-size:12px">&#9679; ${short}</span>
        <span style="color:#a855ff;font-size:13px;margin:0 10px"><b>${WalletState.monetBalance.toFixed(2)} MONET</b></span>
        <span style="color:#888;font-size:11px">${WalletState.solBalance.toFixed(3)} SOL</span>
        <button onclick="disconnectWallet()" style="margin-left:10px;padding:4px 10px;font-size:10px;border-radius:6px;border:1px solid #ff4488;background:transparent;color:#ff4488;cursor:pointer">Disconnect</button>
      `;
    } else {
      el.innerHTML = `<button onclick="connectWallet().then(()=>renderWalletBar('${containerId}')).catch(e=>alert(e.message))" style="padding:6px 16px;border-radius:8px;border:none;background:linear-gradient(135deg,#00ff9d,#00ffc3);color:#000;font-weight:bold;cursor:pointer;font-family:Orbitron,sans-serif;font-size:11px">CONNECT WALLET</button>`;
    }
  }
  render();
  document.addEventListener('walletConnected',   render);
  document.addEventListener('walletDisconnected', render);
  document.addEventListener('balanceUpdated',     render);
}

// ─── Treasury Payout (browser-signed) ────────────────────────────────────────
// Called when the treasury wallet is connected in the browser.
// Builds, signs, and broadcasts a MONET transfer from treasury → winner,
// then notifies the server to mark the claim as paid.
async function treasuryPayout(toAddress, amount, claimId, onProgress) {
  const report = (s) => { try { onProgress && onProgress(s); } catch(_) {} };

  if (!WalletState.connected) throw new Error('Connect treasury wallet first');
  if (WalletState.address !== MONET_CONFIG.TREASURY)
    throw new Error('Connected wallet is not the treasury');

  const provider = getProvider();
  const w        = getSolanaWeb3();
  const payer    = new w.PublicKey(WalletState.address);
  const mint     = new w.PublicKey(MONET_CONFIG.MINT);
  const winner   = new w.PublicKey(toAddress);
  const srcATA   = getATA(mint, payer);
  const dstATA   = getATA(mint, winner);

  report('building');

  // Blockhash
  let blockhash;
  try {
    const conn = await getWorkingConnection();
    ({ blockhash } = await conn.getLatestBlockhash());
  } catch(_) {
    const r = await fetch('/api/blockhash');
    if (!r.ok) throw new Error('Could not fetch blockhash');
    ({ blockhash } = await r.json());
  }

  const tx = new w.Transaction();
  tx.feePayer        = payer;
  tx.recentBlockhash = blockhash;

  // Create winner ATA if missing (treasury pays rent)
  try {
    const r = await fetch(`/api/account-exists/${dstATA.toString()}`);
    if (r.ok) {
      const d = await r.json();
      if (!d.exists) tx.add(createATAInstruction(payer, dstATA, winner, mint));
    }
  } catch(_) {}

  tx.add(createTransferInstruction(srcATA, dstATA, payer, toRawAmount(amount)));
  tx.add(createMemoInstruction(payer,
    `Monet Arcade | Payout | ${amount} MONET${claimId ? ' | ' + claimId.slice(0,8) : ''}`));

  report('signing');
  let txId;
  try {
    if (provider.signAndSendTransaction) {
      const result = await provider.signAndSendTransaction(tx);
      txId = result.signature || result;
    } else {
      const conn   = await getWorkingConnection();
      const signed = await provider.signTransaction(tx);
      txId = await conn.sendRawTransaction(signed.serialize());
    }
  } catch(e) {
    throw new Error('Signing failed: ' + e.message);
  }

  report('confirming');
  try {
    const conn = await getWorkingConnection();
    await conn.confirmTransaction(txId, 'confirmed');
  } catch(_) {}

  // Tell server to mark the claim paid
  if (claimId) {
    try {
      await fetch('/api/payout/complete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ claimId, txId }),
      });
    } catch(_) {}
  }

  await refreshBalances().catch(() => {});
  return txId;
}

function isTreasuryWallet() {
  return WalletState.connected && WalletState.address === MONET_CONFIG.TREASURY;
}

window.treasuryPayout   = treasuryPayout;
window.isTreasuryWallet = isTreasuryWallet;

// ─── Auto-init ────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryAutoConnect);
} else {
  tryAutoConnect();
}

// ─── API Client ───────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

// ─── Pay Gate Overlay ─────────────────────────────────────────────────────────
function _injectPayGateStyles() {
  if (document.getElementById('pg-styles')) return;
  const s = document.createElement('style');
  s.id = 'pg-styles';
  s.textContent = `
    #pg-overlay {
      position:fixed; inset:0; background:rgba(2,4,10,0.96);
      z-index:99990; display:flex; align-items:center; justify-content:center;
      font-family:'Orbitron',sans-serif; backdrop-filter:blur(4px);
    }
    #pg-box {
      background:linear-gradient(160deg,#0d1017,#111827);
      border:1px solid #a855ff; border-radius:20px;
      padding:28px 24px 22px; width:min(360px,94vw);
      box-shadow:0 0 60px #a855ff33; color:#fff; text-align:center;
    }
    #pg-star  { font-size:40px; margin-bottom:4px; }
    #pg-title { font-size:16px; font-weight:800; color:#a855ff; margin-bottom:2px; }
    #pg-game  { font-size:11px; color:#666; letter-spacing:2px; margin-bottom:14px; }
    .pg-row   { display:flex; justify-content:space-between; align-items:center;
                font-size:12px; padding:8px 0; border-bottom:1px solid #ffffff0d; }
    .pg-row:last-of-type { border:none; }
    .pg-label { color:#888; }
    .pg-val   { font-weight:700; }
    .pg-pot   { font-size:14px; font-weight:800; color:#ffd700; }
    #pg-wallet-row { font-size:11px; color:#888; margin:12px 0 0; }
    #pg-pay-btn {
      margin-top:14px; width:100%; padding:13px;
      border-radius:12px; border:none; cursor:pointer;
      background:linear-gradient(135deg,#a855ff,#7c3aed);
      color:#fff; font-family:'Orbitron',sans-serif; font-size:13px; font-weight:800;
      box-shadow:0 4px 24px #a855ff44; letter-spacing:0.5px;
      transition:opacity .15s;
    }
    #pg-pay-btn:disabled { opacity:0.5; cursor:not-allowed; }
    #pg-connect-btn {
      margin-top:14px; width:100%; padding:13px;
      border-radius:12px; border:none; cursor:pointer;
      background:linear-gradient(135deg,#00ff9d,#00c97b);
      color:#000; font-family:'Orbitron',sans-serif; font-size:13px; font-weight:800;
      box-shadow:0 4px 24px #00ff9d44;
    }
    #pg-back  {
      margin-top:10px; background:none; border:none; color:#555;
      font-family:'Orbitron',sans-serif; font-size:10px; cursor:pointer;
    }
    #pg-back:hover { color:#ff4488; }
    #pg-err   { color:#ff4488; font-size:11px; margin-top:8px; min-height:16px; }
    #pg-retry-btn {
      display:none; margin-top:10px; width:100%; padding:11px;
      border-radius:12px; border:2px solid #ff4488; cursor:pointer;
      background:transparent;
      color:#ff4488; font-family:'Orbitron',sans-serif; font-size:12px; font-weight:800;
      letter-spacing:0.5px; transition:background .15s, color .15s;
    }
    #pg-retry-btn:hover { background:#ff4488; color:#fff; }
    @keyframes pg-spin { to { transform:rotate(360deg); } }
    #pg-spinner {
      display:none; flex-direction:column; align-items:center; justify-content:center;
      margin-top:16px; gap:12px;
    }
    #pg-spinner.active { display:flex; }
    #pg-spinner-ring {
      width:40px; height:40px; border-radius:50%;
      border:3px solid rgba(168,85,255,0.25);
      border-top-color:#a855ff;
      animation: pg-spin 0.75s linear infinite;
    }
    #pg-spinner-label {
      font-family:'Orbitron',sans-serif; font-size:11px; color:#a855ff;
      letter-spacing:1px; text-align:center;
    }
    #pg-challenge-badge {
      background:rgba(0,240,255,0.1); border:1px solid #00f0ff44;
      border-radius:8px; padding:8px; margin-bottom:12px; font-size:11px; color:#00f0ff;
    }
    #pg-tourney-badge {
      background:rgba(255,215,0,0.1); border:1px solid #ffd70044;
      border-radius:8px; padding:8px; margin-bottom:12px; font-size:11px; color:#ffd700;
    }
    #pg-progress {
      display:flex; gap:6px; width:100%; max-width:200px;
    }
    .pg-progress-seg {
      flex:1; height:4px; border-radius:2px;
      background:rgba(168,85,255,0.18);
      transition:background 0.3s, box-shadow 0.3s;
    }
    .pg-progress-seg.active {
      background:#a855ff;
      box-shadow:0 0 7px #a855ff, 0 0 14px #a855ff88;
    }
  `;
  document.head.appendChild(s);
}

window._pgOnSuccess  = null;
window._pgGameName   = null;
window._pgRenderGate = null;

async function showPayGate(gameName, onSuccess, opts = {}) {
  if (hasValidSession(gameName)) { if (onSuccess) onSuccess(); return; }

  // Practice mode — free play, no payment, no prize
  const _up = new URLSearchParams(location.search);
  if (_up.has('practice')) {
    if (onSuccess) onSuccess('practice-mode');
    // Show a small non-blocking banner so the player knows they're in practice mode
    const _pb = document.createElement('div');
    _pb.id = '_practice-banner';
    _pb.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(168,85,255,0.18);border:1px solid #a855ff66;border-radius:20px;padding:5px 18px;font-family:Orbitron,sans-serif;font-size:10px;color:#a855ff;pointer-events:none;white-space:nowrap;';
    _pb.textContent = '🎮 PRACTICE MODE — no entry fee · no prize';
    document.body.appendChild(_pb);
    return;
  }

  // Bypass for players who already paid via challenge.html
  const _cc = _up.get('challenge');
  if (_cc) {
    const _cs = JSON.parse(sessionStorage.getItem('challenge_session') || 'null');
    if (_cs && _cs.code === _cc) { if (onSuccess) onSuccess(); return; }
  }
  // Bypass for CPU game (paid on challenge.html)
  const _cpuParam = _up.get('cpu');
  if (_cpuParam) {
    const _cpus = JSON.parse(sessionStorage.getItem('cpu_session') || 'null');
    if (_cpus && _cpus.cpuGameId === _up.get('cpuGameId')) {
      if (onSuccess) onSuccess();
      setTimeout(() => showCpuTarget(_cpus.cpuScore, _cpuParam), 300);
      return;
    }
  }

  _injectPayGateStyles();

  const urlParams     = new URLSearchParams(location.search);
  const challengeCode = urlParams.get('challenge');
  const tournamentId  = urlParams.get('tournament');

  window._pgOnSuccess = onSuccess;
  window._pgGameName  = gameName;

  const overlay = document.createElement('div');
  overlay.id = 'pg-overlay';
  document.body.appendChild(overlay);

  function renderGate() {
    const conn     = WalletState.connected;
    const bal      = WalletState.monetBalance;
    const fee      = MONET_CONFIG.ENTRY_FEE;
    const feeUsd   = MONET_CONFIG._priceUsd ? (fee * MONET_CONFIG._priceUsd).toFixed(2) : '0.50';
    const hasEnough = bal >= fee;
    const short    = conn ? WalletState.address.slice(0,4)+'...'+WalletState.address.slice(-4) : '';
    const potAmt   = opts.pot        ? opts.pot
                   : challengeCode  ? (fee * 2 * (1 - 0.20)).toFixed(1) + ' MONET'
                   : tournamentId   ? 'Pool grows with players'
                   : (fee * MONET_CONFIG.PAYOUT_RATE).toFixed(1) + ' MONET';

    overlay.innerHTML = `
      <div id="pg-box">
        <div id="pg-star">&#9733;</div>
        <div id="pg-title">PAY TO PLAY</div>
        <div id="pg-game">${gameName.toUpperCase()}</div>

        ${challengeCode ? `<div id="pg-challenge-badge">&#9876; HEAD-TO-HEAD CHALLENGE<br><b style="font-size:14px">${challengeCode}</b></div>` : ''}
        ${tournamentId  ? `<div id="pg-tourney-badge">&#127942; TOURNAMENT ENTRY</div>` : ''}

        <div class="pg-row">
          <span class="pg-label">Entry Fee</span>
          <span class="pg-val" style="color:#ff4488">${fee} MONET <span style="font-size:9px;color:#888">≈ $${feeUsd}</span></span>
        </div>
        <div class="pg-row">
          <span class="pg-label">Prize Pot</span>
          <span class="pg-pot">${potAmt}</span>
        </div>
        <div class="pg-row">
          <span class="pg-label">House Rake</span>
          <span class="pg-val" style="color:#888">${opts.rake !== undefined ? opts.rake : (challengeCode || tournamentId ? '20%' : Math.round((1 - MONET_CONFIG.PAYOUT_RATE) * 100) + '%')}</span>
        </div>

        ${conn ? `
          <div id="pg-wallet-row">
            &#9679; ${short} &nbsp;|&nbsp;
            <span style="color:${hasEnough?'#00ff9d':'#ff4488'}">${bal.toFixed(2)} MONET</span>
            &nbsp;·&nbsp;
            <span style="color:${WalletState.solBalance>=0.003?'#00ff9d':'#555'}">${WalletState.solBalance.toFixed(3)} SOL</span>
          </div>
          ${hasEnough ? `
            <button id="pg-pay-btn" onclick="pgPay()">PAY ${fee} MONET &amp; PLAY</button>
          ` : `
            <div style="color:#ff4488;font-size:11px;margin-top:10px">Insufficient MONET — need ${fee}</div>
            <button id="pg-pay-btn" onclick="location.href='exchange.html'" style="background:linear-gradient(135deg,#ff4488,#c0136c)">GET MONET &#8594;</button>
          `}
          <button id="pg-pay-sol-btn" onclick="pgPaySOL()"
            style="margin-top:8px;width:100%;padding:11px;border-radius:12px;border:1px solid ${WalletState.solBalance>=0.003?'#3b82f6':'#333'};cursor:${WalletState.solBalance>=0.003?'pointer':'not-allowed'};background:${WalletState.solBalance>=0.003?'rgba(59,130,246,0.12)':'rgba(255,255,255,0.03)'};color:${WalletState.solBalance>=0.003?'#60a5fa':'#555'};font-family:Orbitron,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.5px"
            ${WalletState.solBalance>=0.003?'':'disabled'}>
            ◎ PAY ~$0.25 IN SOL &amp; PLAY${WalletState.solBalance<0.003?' (need ~0.003 SOL)':''}
          </button>
        ` : `
          <button id="pg-connect-btn" onclick="pgConnect()">CONNECT WALLET</button>
        `}
        <div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-family:Orbitron,sans-serif;font-size:9px;color:#333;letter-spacing:1px">
          <div style="flex:1;height:1px;background:#1a1a2a"></div>OR<div style="flex:1;height:1px;background:#1a1a2a"></div>
        </div>
        <button id="pg-card-btn" onclick="pgPayCard()" style="margin-top:10px;width:100%;padding:11px;border-radius:12px;border:1px solid #22c55e;cursor:pointer;background:rgba(34,197,94,0.08);color:#22c55e;font-family:Orbitron,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.5px">
          &#128179; PAY $0.50 WITH CARD
        </button>
        <button id="pg-transak-btn" onclick="pgOpenTransak()" style="margin-top:8px;width:100%;padding:9px;border-radius:10px;border:1px solid #3b82f633;cursor:pointer;background:rgba(59,130,246,0.05);color:#3b82f6;font-family:Orbitron,sans-serif;font-size:10px;font-weight:800;letter-spacing:0.5px">
          &#127974; FUND WALLET WITH CARD
        </button>
        <div id="pg-spinner">
          <div id="pg-spinner-ring"></div>
          <div id="pg-spinner-label">CHECKING WALLET...</div>
          <div id="pg-progress">
            <div class="pg-progress-seg" id="pg-seg-1"></div>
            <div class="pg-progress-seg" id="pg-seg-2"></div>
            <div class="pg-progress-seg" id="pg-seg-3"></div>
          </div>
        </div>
        <div id="pg-err"></div>
        <button id="pg-retry-btn" onclick="pgRetry()">&#8635; TRY AGAIN</button>
        <button id="pg-back" onclick="pgBack()">&#8592; Back to Arcade</button>
      </div>
    `;
  }

  window._pgRenderGate = renderGate;
  renderGate();
  document.addEventListener('walletConnected',  renderGate);
  document.addEventListener('balanceUpdated',   renderGate);
  document.addEventListener('entryFeeUpdated',  renderGate);
}

async function pgConnect() {
  const btn = document.getElementById('pg-connect-btn');
  if (btn) { btn.textContent = 'Connecting...'; btn.disabled = true; }
  try {
    await connectWallet();
  } catch(e) {
    const errEl = document.getElementById('pg-err');
    if (errEl) errEl.textContent = e.message;
    if (btn) { btn.textContent = 'CONNECT WALLET'; btn.disabled = false; }
  }
}

async function pgPay() {
  const btn      = document.getElementById('pg-pay-btn');
  const err      = document.getElementById('pg-err');
  const spinner  = document.getElementById('pg-spinner');
  const spinLbl  = document.getElementById('pg-spinner-label');
  const retryBtn = document.getElementById('pg-retry-btn');
  if (btn)      { btn.style.display = 'none'; }
  if (retryBtn) { retryBtn.style.display = 'none'; }
  if (err)      err.textContent = '';
  if (spinner) spinner.classList.add('active');
  if (spinLbl) spinLbl.textContent = 'CHECKING WALLET...';
  const _rg = window._pgRenderGate;
  if (_rg) {
    document.removeEventListener('walletConnected', _rg);
    document.removeEventListener('balanceUpdated',  _rg);
  }

  const STEP_LABELS = {
    checking:   'CHECKING WALLET...',
    signing:    'SIGN IN YOUR WALLET...',
    confirming: 'CONFIRMING ON-CHAIN...',
  };
  const STEP_NUM = { checking: 1, signing: 2, confirming: 3 };
  function _pgSetStep(n) {
    for (let i = 1; i <= 3; i++) {
      const seg = document.getElementById('pg-seg-' + i);
      if (seg) seg.classList.toggle('active', i <= n);
    }
  }
  _pgSetStep(1);
  function onProgress(step) {
    if (spinLbl && STEP_LABELS[step]) spinLbl.textContent = STEP_LABELS[step];
    _pgSetStep(STEP_NUM[step] || 0);
  }

  try {
    const txId = await payEntryFee(window._pgGameName, onProgress);
    if (spinLbl) spinLbl.textContent = 'LAUNCHING GAME...';

    const urlParams     = new URLSearchParams(location.search);
    const challengeCode = urlParams.get('challenge');
    const tournamentId  = urlParams.get('tournament');

    if (challengeCode) {
      try {
        const existing = JSON.parse(sessionStorage.getItem('challenge_session') || 'null');
        if (!existing) {
          const res = await api(`/api/challenge/${challengeCode}`);
          const ch  = res.challenge;
          if (ch.status === 'open' && ch.player1.wallet !== WalletState.address) {
            await api('/api/challenge/join', 'POST', { code: challengeCode, wallet: WalletState.address, txId, paymentType: 'monet' });
          }
          sessionStorage.setItem('challenge_session', JSON.stringify({ challengeId: ch.id, code: challengeCode, txId }));
        }
      } catch(e2) { console.warn('[ARCADE] Challenge join error:', e2.message); }
    }

    if (tournamentId) {
      try {
        await api('/api/tournament/register', 'POST', { tournamentId, wallet: WalletState.address, txId, paymentType: 'monet' });
      } catch(e2) { console.warn('[ARCADE] Tournament register error:', e2.message); }
    }

    document.getElementById('pg-overlay')?.remove();
    if (window._pgOnSuccess) window._pgOnSuccess(txId);
    // If this was an H2H game launched via ?challenge= URL, start live score watch
    if (challengeCode && window.startH2HWatch) startH2HWatch(challengeCode);
  } catch(e) {
    if (_rg) {
      document.addEventListener('walletConnected', _rg);
      document.addEventListener('balanceUpdated',  _rg);
    }
    if (spinner)  spinner.classList.remove('active');
    if (err)      err.textContent = e.message;
    if (retryBtn) retryBtn.style.display = '';
  }
}

function pgRetry() {
  const err      = document.getElementById('pg-err');
  const retryBtn = document.getElementById('pg-retry-btn');
  if (err)      err.textContent = '';
  if (retryBtn) retryBtn.style.display = 'none';
  pgPay();
}

function pgBack() { location.href = 'arcade.html'; }

// ─── SOL payment path through the pay gate ────────────────────────────────────
async function pgPaySOL() {
  const solBtn   = document.getElementById('pg-pay-sol-btn');
  const monetBtn = document.getElementById('pg-pay-btn');
  const err      = document.getElementById('pg-err');
  const spinner  = document.getElementById('pg-spinner');
  const spinLbl  = document.getElementById('pg-spinner-label');
  const retryBtn = document.getElementById('pg-retry-btn');
  if (solBtn)   { solBtn.style.display = 'none'; }
  if (monetBtn) { monetBtn.style.display = 'none'; }
  if (retryBtn) { retryBtn.style.display = 'none'; }
  if (err)      err.textContent = '';
  if (spinner)  spinner.classList.add('active');
  if (spinLbl)  spinLbl.textContent = 'CHECKING WALLET...';
  const _rg = window._pgRenderGate;
  if (_rg) {
    document.removeEventListener('walletConnected', _rg);
    document.removeEventListener('balanceUpdated',  _rg);
  }
  const STEP_LABELS = { checking:'CHECKING WALLET...', signing:'SIGN IN YOUR WALLET...', confirming:'CONFIRMING ON-CHAIN...' };
  const STEP_NUM    = { checking:1, signing:2, confirming:3 };
  function _setStep(n) {
    for (let i = 1; i <= 3; i++) {
      const seg = document.getElementById('pg-seg-' + i);
      if (seg) seg.classList.toggle('active', i <= n);
    }
  }
  _setStep(1);
  function onProgress(step) {
    if (spinLbl && STEP_LABELS[step]) spinLbl.textContent = STEP_LABELS[step];
    _setStep(STEP_NUM[step] || 0);
  }

  try {
    const txId = await payEntryFeeSOL(window._pgGameName, onProgress);
    if (spinLbl) spinLbl.textContent = 'LAUNCHING GAME...';

    const urlParams     = new URLSearchParams(location.search);
    const challengeCode = urlParams.get('challenge');
    const tournamentId  = urlParams.get('tournament');

    if (challengeCode) {
      try {
        const existing = JSON.parse(sessionStorage.getItem('challenge_session') || 'null');
        if (!existing) {
          const res = await api(`/api/challenge/${challengeCode}`);
          const ch  = res.challenge;
          if (ch.status === 'open' && ch.player1.wallet !== WalletState.address) {
            await api('/api/challenge/join', 'POST', { code: challengeCode, wallet: WalletState.address, txId, paymentType: 'sol' });
          }
          sessionStorage.setItem('challenge_session', JSON.stringify({ challengeId: ch.id, code: challengeCode, txId }));
        }
      } catch(e2) { console.warn('[ARCADE] Challenge join (SOL) error:', e2.message); }
    }

    if (tournamentId) {
      try {
        await api('/api/tournament/register', 'POST', { tournamentId, wallet: WalletState.address, txId, paymentType: 'sol' });
      } catch(e2) { console.warn('[ARCADE] Tournament register (SOL) error:', e2.message); }
    }

    document.getElementById('pg-overlay')?.remove();
    if (window._pgOnSuccess) window._pgOnSuccess(txId);
    if (challengeCode && window.startH2HWatch) startH2HWatch(challengeCode);
  } catch(e) {
    if (_rg) {
      document.addEventListener('walletConnected', _rg);
      document.addEventListener('balanceUpdated',  _rg);
    }
    if (spinner)  spinner.classList.remove('active');
    if (err)      err.textContent = e.message;
    if (retryBtn) retryBtn.style.display = '';
    // Re-show both buttons
    if (solBtn)   solBtn.style.display = '';
    if (monetBtn) monetBtn.style.display = '';
  }
}

// ─── Card payment (Stripe) ────────────────────────────────────────────────────
async function pgPayCard() {
  const box = document.getElementById('pg-box');
  if (!box) return;
  const gameName = window._pgGameName || 'game';

  box.innerHTML = `
    <div id="pg-star">&#128179;</div>
    <div id="pg-title">PAY WITH CARD</div>
    <div id="pg-game">${gameName.toUpperCase()}</div>
    <div style="color:#888;font-size:11px;margin:6px 0 16px">$0.50 USD · No crypto wallet needed</div>
    <div id="pg-card-form-wrap" style="width:100%;text-align:left">
      <div style="color:#888;font-size:11px;text-align:center">Loading payment form…</div>
    </div>
    <div id="pg-err" style="color:#ff4488;font-size:11px;margin-top:8px;min-height:16px"></div>
    <button onclick="window._pgRenderGate&&window._pgRenderGate()" style="margin-top:10px;background:none;border:none;color:#555;font-family:Orbitron,sans-serif;font-size:10px;cursor:pointer">&#8592; Back</button>
    <button id="pg-back" onclick="pgBack()">&#8592; Back to Arcade</button>
  `;

  try {
    // 1. Check Stripe is configured
    const cfg = await fetch('/api/stripe/config').then(r => r.json());
    if (!cfg.publishableKey) throw new Error('Card payments are not yet configured — please use MONET or SOL.');

    // 2. Create payment intent on server
    const piRes = await fetch('/api/stripe/create-payment-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: gameName }),
    }).then(r => r.json());
    if (piRes.error) throw new Error(piRes.error);

    // 3. Load Stripe.js from CDN if not already loaded
    if (!window.Stripe) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load Stripe.js'));
        document.head.appendChild(s);
      });
    }

    // 4. Mount Stripe Elements
    const stripeInst = window.Stripe(cfg.publishableKey);
    const elements   = stripeInst.elements({ clientSecret: piRes.clientSecret, appearance: {
      theme: 'night',
      variables: { colorPrimary: '#a855ff', colorBackground: '#0a0a14', colorText: '#e5e7eb', fontFamily: 'Orbitron, sans-serif' }
    }});
    const payEl = elements.create('payment');
    const wrap  = document.getElementById('pg-card-form-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div id="stripe-payment-el"></div>';
    payEl.mount('#stripe-payment-el');

    window._stripeInst      = stripeInst;
    window._stripeElements  = elements;
    window._cardSessionToken = piRes.sessionToken;
    window._cardGameName    = gameName;

    // 5. Show submit button
    wrap.insertAdjacentHTML('beforeend', `
      <button id="pg-card-submit" onclick="pgCardSubmit()"
        style="margin-top:14px;width:100%;padding:13px;border-radius:12px;border:none;cursor:pointer;
               background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;
               font-family:Orbitron,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.5px;
               box-shadow:0 4px 20px #22c55e44">
        PAY $0.50 NOW &#8594;
      </button>
    `);
  } catch(e) {
    const errEl = document.getElementById('pg-err');
    if (errEl) errEl.textContent = e.message;
  }
}

async function pgCardSubmit() {
  const btn = document.getElementById('pg-card-submit');
  const err = document.getElementById('pg-err');
  if (btn) { btn.disabled = true; btn.textContent = 'PROCESSING…'; }
  if (err) err.textContent = '';

  try {
    const { error } = await window._stripeInst.confirmPayment({
      elements: window._stripeElements,
      confirmParams: { return_url: location.href },
      redirect: 'if_required',
    });
    if (error) throw new Error(error.message);

    // Validate payment server-side
    const r = await fetch('/api/card-session/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: window._cardSessionToken }),
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'Payment validation failed');

    // Store session so hasValidSession() passes
    sessionStorage.setItem('game_session', JSON.stringify({
      game: window._cardGameName, paidAt: Date.now(), method: 'card', token: window._cardSessionToken,
    }));

    document.getElementById('pg-overlay')?.remove();
    if (window._pgOnSuccess) window._pgOnSuccess('card-payment');
  } catch(e) {
    if (err) err.textContent = e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'PAY $0.50 NOW →'; }
  }
}

// ─── Transak on-ramp modal ────────────────────────────────────────────────────
function pgOpenTransak() {
  const walletAddr = window.WalletState?.address || '';
  const url = `https://global.transak.com/?network=solana&cryptoCurrencyCode=SOL&defaultCryptoCurrency=SOL${walletAddr ? '&walletAddress=' + encodeURIComponent(walletAddr) : ''}`;

  if (document.getElementById('transak-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'transak-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(2,4,10,0.96);display:flex;flex-direction:column;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="width:min(430px,96vw);border-radius:18px;overflow:hidden;background:#0a0a14;border:1px solid #a855ff44;box-shadow:0 0 40px #a855ff22">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #ffffff0d;background:#080810">
        <span style="font-family:Orbitron,sans-serif;font-size:12px;color:#a855ff;font-weight:800">&#127974; FUND WALLET WITH CARD</span>
        <button onclick="document.getElementById('transak-modal').remove()"
          style="background:none;border:1px solid #333;border-radius:6px;color:#888;font-size:14px;width:28px;height:28px;cursor:pointer;line-height:1">&#10005;</button>
      </div>
      <iframe src="${url}" style="width:100%;height:560px;border:none" allow="camera;microphone;payment;clipboard-write"></iframe>
    </div>
  `;
  document.body.appendChild(modal);
}

window.pgConnect     = pgConnect;
window.pgPay         = pgPay;
window.pgPaySOL      = pgPaySOL;
window.pgRetry       = pgRetry;
window.pgBack        = pgBack;
window.pgPayCard     = pgPayCard;
window.pgCardSubmit  = pgCardSubmit;
window.pgOpenTransak = pgOpenTransak;

// ─── CPU target badge ─────────────────────────────────────────────────────────
function showCpuTarget(cpuScore, difficulty) {
  if (document.getElementById('cpu-target-badge')) return;
  const badge = document.createElement('div');
  badge.id = 'cpu-target-badge';
  badge.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:rgba(2,4,10,0.92);border:1px solid #ff4488;border-radius:10px;padding:8px 14px;font-family:Orbitron,sans-serif;text-align:center;pointer-events:none';
  badge.innerHTML = `<div style="font-size:8px;color:#ff4488;letter-spacing:1px;margin-bottom:2px">CPU TARGET</div><div style="font-size:20px;font-weight:800;color:#fff">${cpuScore}</div><div style="font-size:8px;color:#888;margin-top:2px">${(difficulty||'').toUpperCase()}</div>`;
  document.body.appendChild(badge);
}
window.showCpuTarget = showCpuTarget;

// ─── Submit toast ─────────────────────────────────────────────────────────────
function _showSubmitToast(msg) {
  const existing = document.getElementById('arcade-submit-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'arcade-submit-toast';
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(2,4,10,0.95);border:1px solid #00f0ff55;border-radius:12px;padding:10px 20px;font-family:Orbitron,sans-serif;font-size:11px;color:#00f0ff;z-index:99998;pointer-events:none;box-shadow:0 0 20px #00f0ff22;white-space:nowrap';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// ─── H2H challenge result overlay ────────────────────────────────────────────
function _showChallengeResult(iWon, myScore, opScore, pot) {
  if (document.getElementById('challenge-result-overlay')) return;
  const box = document.createElement('div');
  box.id = 'challenge-result-overlay';
  box.style.cssText = 'position:fixed;inset:0;background:rgba(2,4,10,0.96);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Orbitron,sans-serif';
  const fmt = v => (v !== null && v !== undefined) ? Number(v).toLocaleString() : '—';
  box.innerHTML = `
    <div style="background:linear-gradient(160deg,#0d1017,#111827);border:2px solid ${iWon ? '#ffd700' : '#ff4488'};border-radius:20px;padding:28px 24px;width:min(340px,92vw);text-align:center">
      <div style="font-size:38px;margin-bottom:8px">${iWon ? '&#127942;' : '&#128128;'}</div>
      <div style="font-size:18px;font-weight:800;color:${iWon ? '#ffd700' : '#ff4488'};margin-bottom:14px">${iWon ? 'YOU WIN!' : 'OPPONENT WINS'}</div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ffffff0d;font-size:12px"><span style="color:#888">Your Score</span><span style="color:#00ff9d;font-weight:700">${fmt(myScore)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ffffff0d;font-size:12px"><span style="color:#888">Opponent</span><span style="color:#ff4488;font-weight:700">${fmt(opScore)}</span></div>
      ${iWon ? `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12px"><span style="color:#888">Payout</span><span style="color:#ffd700;font-weight:700">+${pot} MONET</span></div>` : `<div style="padding:8px 0;font-size:11px;color:#888">Better luck next time!</div>`}
      <button onclick="location.href='arcade.html'" style="margin-top:14px;width:100%;padding:12px;border-radius:12px;border:none;cursor:pointer;background:linear-gradient(135deg,#a855ff,#7c3aed);color:#fff;font-family:Orbitron,sans-serif;font-size:12px;font-weight:800">&#8592; BACK TO ARCADE</button>
      <button onclick="location.href='challenge.html'" style="margin-top:8px;width:100%;padding:10px;border-radius:12px;border:1px solid #333;cursor:pointer;background:transparent;color:#888;font-family:Orbitron,sans-serif;font-size:10px">CHALLENGE AGAIN</button>
    </div>`;
  document.body.appendChild(box);
}

window._showChallengeResult = _showChallengeResult;

// ─── CPU result overlay ───────────────────────────────────────────────────────
function _showCpuResult(result, playerScore) {
  if (document.getElementById('cpu-result-overlay')) return;
  const won = result.won;
  const box = document.createElement('div');
  box.id = 'cpu-result-overlay';
  box.style.cssText = 'position:fixed;inset:0;background:rgba(2,4,10,0.96);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Orbitron,sans-serif';
  box.innerHTML = `
    <div style="background:linear-gradient(160deg,#0d1017,#111827);border:2px solid ${won?'#ffd700':'#ff4488'};border-radius:20px;padding:28px 24px;width:min(340px,92vw);text-align:center">
      <div style="font-size:38px;margin-bottom:8px">${won?'&#127942;':'&#128128;'}</div>
      <div style="font-size:18px;font-weight:800;color:${won?'#ffd700':'#ff4488'};margin-bottom:14px">${won?'YOU BEAT THE CPU!':'CPU WINS'}</div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ffffff0d;font-size:12px"><span style="color:#888">Your Score</span><span style="color:#00ff9d;font-weight:700">${playerScore}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ffffff0d;font-size:12px"><span style="color:#888">CPU Score</span><span style="color:#ff4488;font-weight:700">${result.cpuScore}</span></div>
      ${won ? `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12px"><span style="color:#888">Payout</span><span style="color:#ffd700;font-weight:700">+${result.payout} MONET</span></div>` : `<div style="padding:8px 0;font-size:11px;color:#888">Better luck next time!</div>`}
      <button onclick="location.href='arcade.html'" style="margin-top:14px;width:100%;padding:12px;border-radius:12px;border:none;cursor:pointer;background:linear-gradient(135deg,#a855ff,#7c3aed);color:#fff;font-family:Orbitron,sans-serif;font-size:12px;font-weight:800">&#8592; BACK TO ARCADE</button>
      <button onclick="location.href='challenge.html'" style="margin-top:8px;width:100%;padding:10px;border-radius:12px;border:1px solid #333;cursor:pointer;background:transparent;color:#888;font-family:Orbitron,sans-serif;font-size:10px">PLAY AGAIN</button>
    </div>`;
  document.body.appendChild(box);
  sessionStorage.removeItem('cpu_session');
}

// ─── Arcade Score Submission ──────────────────────────────────────────────────
async function arcadeSubmitScore(gameName, score) {
  const urlParams     = new URLSearchParams(location.search);
  const challengeCode = urlParams.get('challenge');
  const tournamentId  = urlParams.get('tournament');

  // CPU game ID: prefer URL param (legacy redirect path), fall back to sessionStorage
  // The lobby stores cpu_session after payment so the ID survives without a URL change.
  const cpuSession = JSON.parse(sessionStorage.getItem('cpu_session') || 'null');
  const cpuGameId  = urlParams.get('cpuGameId')
    || (cpuSession && (!cpuSession.game || cpuSession.game === gameName) ? cpuSession.cpuGameId : null);

  // Check sessionStorage for an active challenge session scoped to this game
  const cs = JSON.parse(sessionStorage.getItem('challenge_session') || 'null');
  const csActive = cs && (!cs.game || cs.game === gameName);

  if (cpuGameId) {
    try {
      const result = await api('/api/cpu/submit', 'POST', { cpuGameId, wallet: WalletState.address, playerScore: score });
      sessionStorage.removeItem('cpu_session');
      _showCpuResult(result, score);
    } catch(e) { console.warn('[ARCADE] CPU submit error:', e.message); }
  } else if (challengeCode || csActive) {
    try {
      if (csActive) {
        _showSubmitToast('Score submitted! Waiting for opponent…');
        const result = await api('/api/challenge/submit', 'POST', { challengeId: cs.challengeId, wallet: WalletState.address, score });
        sessionStorage.removeItem('challenge_session');
        // If both players have now submitted, show the result immediately
        // instead of waiting for the next H2H watcher poll cycle.
        const ch = result.challenge;
        if (ch && ch.status === 'complete') {
          const myWallet = WalletState.address || '';
          const iWon = ch.winner && ch.winner === myWallet;
          const p1 = ch.player1, p2 = ch.player2;
          const myScore = p1?.wallet === myWallet ? p1.score : p2?.score ?? null;
          const opScore = p1?.wallet === myWallet ? p2?.score ?? null : p1.score;
          _showChallengeResult(iWon, myScore, opScore, ch.pot);
        }
      }
    } catch(e) { console.warn('[ARCADE] Challenge submit error:', e.message); }
  } else if (tournamentId) {
    try {
      _showSubmitToast('Score submitted to tournament!');
      await api('/api/tournament/submit', 'POST', { tournamentId, wallet: WalletState.address, score });
    } catch(e) { console.warn('[ARCADE] Tournament submit error:', e.message); }
  } else {
    if (score > 0 && WalletState.connected) recordWin(gameName, score);
  }
}

window.arcadeSubmitScore = arcadeSubmitScore;

// ─── Create challenge from game page ─────────────────────────────────────────
async function createChallenge(game, wager) {
  if (!WalletState.connected) throw new Error('Connect wallet first');
  const fee  = wager || MONET_CONFIG.ENTRY_FEE;
  const txId = await payEntryFee(game, null, fee);
  const res  = await api('/api/challenge/create', 'POST', { wallet: WalletState.address, txId, game, entryFee: fee });
  sessionStorage.setItem('challenge_session', JSON.stringify({ challengeId: res.challengeId, code: res.code, txId, entryFee: fee, game }));
  return res;
}

window.createChallenge = createChallenge;

// ─── H2H Live Score Overlay ───────────────────────────────────────────────────
// Shows a small persistent bar during an active Head-to-Head game that polls
// the challenge endpoint every 3 s and updates both players' best scores live.
// Expands to a winner banner when the challenge settles.

// Singleton state — ensures only one watcher runs at a time.
let _h2wPollId   = null;
let _h2wBarEl    = null;

function _h2wStop() {
  if (_h2wPollId !== null) { clearInterval(_h2wPollId); _h2wPollId = null; }
  if (_h2wBarEl  && _h2wBarEl.parentNode) { _h2wBarEl.remove(); }
  _h2wBarEl = null;
}

function startH2HWatch(code) {
  if (!code) {
    const cs = JSON.parse(sessionStorage.getItem('challenge_session') || 'null');
    code = cs?.code;
  }
  if (!code) return;

  // Stop any previous watcher before starting a new one
  _h2wStop();

  // ── styles (injected once) ──
  if (!document.getElementById('h2w-styles')) {
    const s = document.createElement('style');
    s.id = 'h2w-styles';
    s.textContent = `
      #h2w-bar {
        position: fixed; top: 42px; left: 50%; transform: translateX(-50%);
        z-index: 9990; display: flex; align-items: center; gap: 10px;
        background: rgba(2,4,10,0.93); border: 1px solid #00f0ff33;
        border-radius: 20px; padding: 5px 14px;
        font-family: 'Orbitron', sans-serif; font-size: 10px; color: #fff;
        white-space: nowrap; pointer-events: none;
        box-shadow: 0 0 18px #00f0ff18; backdrop-filter: blur(6px);
        transition: border-color 0.4s, box-shadow 0.4s, padding 0.3s;
      }
      #h2w-bar.winner {
        border-color: #ffd70088;
        box-shadow: 0 0 30px #ffd70033;
        padding: 7px 20px; pointer-events: auto;
      }
      .h2w-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #00ff9d; flex-shrink: 0;
        animation: h2w-blink 1.6s ease-in-out infinite;
      }
      @keyframes h2w-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
      .h2w-you  { color: #00f0ff; font-weight: 800; }
      .h2w-opp  { color: #ff6600; font-weight: 800; }
      .h2w-vs   { color: #444; font-size: 9px; letter-spacing: 1px; }
      .h2w-sc   { font-size: 13px; font-weight: 800; display: inline-block; min-width: 38px; text-align: center; }
      .h2w-code { color: #333; font-size: 8px; letter-spacing: 2px; margin-left: 2px; }
      .h2w-lead { color: #ffd700; }
      .h2w-win-icon { font-size: 16px; }
      .h2w-win-txt  { font-size: 11px; font-weight: 800; color: #ffd700; letter-spacing: 0.5px; }
      .h2w-win-sub  { font-size: 9px; color: #888; }
    `;
    document.head.appendChild(s);
  }

  // Bar starts hidden; made visible only once status === 'active'
  const bar = document.createElement('div');
  bar.id = 'h2w-bar';
  bar.style.display = 'none';
  bar.innerHTML = `
    <div class="h2w-dot"></div>
    <span class="h2w-you">YOU&nbsp;<span class="h2w-sc" id="h2w-my">—</span></span>
    <span class="h2w-vs">VS</span>
    <span class="h2w-opp"><span class="h2w-sc" id="h2w-op">—</span>&nbsp;OPP</span>
    <span class="h2w-code">${code}</span>
  `;
  document.body.appendChild(bar);
  _h2wBarEl = bar;

  let myWallet = null;
  let settled  = false;

  async function poll() {
    // Abort if bar was removed externally (e.g. page navigation)
    if (!bar.parentNode) { _h2wStop(); return; }

    try {
      const r = await fetch(`/api/challenge/${encodeURIComponent(code)}`);
      if (!r.ok) return;
      const { challenge: ch } = await r.json();

      // Only show the bar once the challenge is actually active or settled
      const isActive  = ch.status === 'active';
      const isSettled = ch.status === 'complete' || ch.status === 'expired';
      if (!isActive && !isSettled) return; // still 'open' — keep bar hidden

      bar.style.display = 'flex';

      // Resolve which side we are (wallet may not be set immediately)
      if (!myWallet) {
        myWallet = WalletState.address || localStorage.getItem('wallet_address') || '';
      }

      const p1 = ch.player1;
      const p2 = ch.player2;
      let myScore = null, opScore = null;

      if (myWallet && p1?.wallet === myWallet) {
        myScore = p1.score; opScore = p2?.score ?? null;
      } else if (myWallet && p2?.wallet === myWallet) {
        myScore = p2.score; opScore = p1?.score ?? null;
      } else {
        myScore = p1?.score ?? null; opScore = p2?.score ?? null;
      }

      if (isActive) {
        const myEl = document.getElementById('h2w-my');
        const opEl = document.getElementById('h2w-op');
        if (!myEl || !opEl) return;

        const fmt = v => v !== null ? v.toLocaleString() : '—';
        myEl.textContent = fmt(myScore);
        opEl.textContent = fmt(opScore);

        // Highlight the leader
        myEl.classList.toggle('h2w-lead', myScore !== null && (opScore === null || myScore > opScore));
        opEl.classList.toggle('h2w-lead', opScore !== null && (myScore === null || opScore > myScore));
      }

      if (isSettled && !settled) {
        settled = true;
        clearInterval(_h2wPollId);
        _h2wPollId = null;

        const fmt   = v => v !== null ? v.toLocaleString() : '—';
        const iWon  = ch.winner && ch.winner === myWallet;
        const pot   = ch.pot ?? '?';

        bar.classList.add('winner');
        bar.innerHTML = `
          <span class="h2w-win-icon">${iWon ? '🏆' : '💀'}</span>
          <span>
            <div class="h2w-win-txt">${iWon ? `YOU WIN! +${pot} MONET` : 'OPPONENT WINS'}</div>
            <div class="h2w-win-sub">YOU ${fmt(myScore)} · OPP ${fmt(opScore)}</div>
          </span>
        `;
        setTimeout(() => { bar.remove(); _h2wBarEl = null; }, 9000);
      }
    } catch (_) { /* ignore transient errors */ }
  }

  poll(); // immediate first fetch
  _h2wPollId = setInterval(poll, 3000);

  // Clean up when navigating away
  window.addEventListener('beforeunload', _h2wStop, { once: true });
}

window.startH2HWatch = startH2HWatch;
