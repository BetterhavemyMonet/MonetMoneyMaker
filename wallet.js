// ─── MONET ARCADE WALLET UTILITIES ───────────────────────────────────────────
// Loaded by all pages. Requires solanaWeb3 from CDN.

const MONET_CONFIG = {
  MINT:     '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b',
  TREASURY: 'ot1CyXFDUdTpSp3reSdgCPfLvivHfcSmi5c6yjnnRxs',
  ENTRY_FEE: 5,
  PAYOUT_RATE: 0.80,
  DECIMALS: 6,
  RPC: 'https://api.mainnet-beta.solana.com',
  SYMBOL: 'MONET',
};

const TOKEN_PROGRAM_ID_STR      = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_STR = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bT3';

// ─── State ────────────────────────────────────────────────────────────────────
window.WalletState = {
  connected: false,
  address: null,
  monetBalance: 0,
  tokens: [],
  solBalance: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSolanaWeb3() {
  if (!window.solanaWeb3) throw new Error('solanaWeb3 not loaded');
  return window.solanaWeb3;
}

function getConnection() {
  const w = getSolanaWeb3();
  return new w.Connection(MONET_CONFIG.RPC, 'confirmed');
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

// ─── Connect Wallet ───────────────────────────────────────────────────────────
async function connectWallet() {
  if (!window.solana) throw new Error('Phantom Wallet not installed');
  const resp = await window.solana.connect();
  const address = resp.publicKey.toString();
  WalletState.connected = true;
  WalletState.address = address;
  localStorage.setItem('wallet_address', address);
  await refreshBalances();
  document.dispatchEvent(new CustomEvent('walletConnected', { detail: { address } }));
  return address;
}

async function disconnectWallet() {
  if (window.solana) await window.solana.disconnect();
  WalletState.connected = false;
  WalletState.address = null;
  WalletState.monetBalance = 0;
  WalletState.tokens = [];
  localStorage.removeItem('wallet_address');
  document.dispatchEvent(new CustomEvent('walletDisconnected'));
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────────
async function tryAutoConnect() {
  if (window.solana && window.solana.isConnected) {
    try {
      const resp = await window.solana.connect({ onlyIfTrusted: true });
      WalletState.connected = true;
      WalletState.address = resp.publicKey.toString();
      localStorage.setItem('wallet_address', WalletState.address);
      await refreshBalances();
      document.dispatchEvent(new CustomEvent('walletConnected', { detail: { address: WalletState.address } }));
    } catch(e) { /* not previously trusted */ }
  }
}

// ─── Balances ─────────────────────────────────────────────────────────────────
async function refreshBalances() {
  if (!WalletState.address) return;
  await Promise.all([
    getMonetBalance().then(b => { WalletState.monetBalance = b; }),
    getSolBalance().then(b => { WalletState.solBalance = b; }),
    getAllTokens().then(t => { WalletState.tokens = t; }),
  ]);
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));
}

async function getMonetBalance() {
  if (!WalletState.address) return 0;
  try {
    const conn = getConnection();
    const w = getSolanaWeb3();
    const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
    const mint = new w.PublicKey(MONET_CONFIG.MINT);
    const owner = new w.PublicKey(WalletState.address);
    const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
    if (accounts.value.length === 0) return 0;
    return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
  } catch(e) { console.warn('Balance fetch error:', e); return 0; }
}

async function getSolBalance() {
  if (!WalletState.address) return 0;
  try {
    const conn = getConnection();
    const w = getSolanaWeb3();
    const lamports = await conn.getBalance(new w.PublicKey(WalletState.address));
    return lamports / 1e9;
  } catch(e) { return 0; }
}

// ─── Portfolio: All tokens ─────────────────────────────────────────────────────
async function getAllTokens() {
  if (!WalletState.address) return [];
  try {
    const conn = getConnection();
    const w = getSolanaWeb3();
    const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
    const owner = new w.PublicKey(WalletState.address);
    const accounts = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });
    return accounts.value
      .map(a => {
        const info = a.account.data.parsed.info;
        return {
          mint: info.mint,
          balance: info.tokenAmount.uiAmount || 0,
          decimals: info.tokenAmount.decimals,
          isMonet: info.mint === MONET_CONFIG.MINT,
          address: a.pubkey.toString(),
        };
      })
      .filter(t => t.balance > 0)
      .sort((a, b) => b.isMonet - a.isMonet);
  } catch(e) { console.warn('Token fetch error:', e); return []; }
}

// ─── Pay Entry Fee ────────────────────────────────────────────────────────────
async function payEntryFee(gameName) {
  if (!WalletState.connected || !WalletState.address) throw new Error('Connect wallet first');
  if (WalletState.monetBalance < MONET_CONFIG.ENTRY_FEE) {
    throw new Error(`Insufficient MONET. Need ${MONET_CONFIG.ENTRY_FEE}, have ${WalletState.monetBalance.toFixed(2)}`);
  }

  const w = getSolanaWeb3();
  const conn = getConnection();

  const payer   = new w.PublicKey(WalletState.address);
  const mint    = new w.PublicKey(MONET_CONFIG.MINT);
  const treasury = new w.PublicKey(MONET_CONFIG.TREASURY);

  const sourceATA = getATA(mint, payer);
  const destATA   = getATA(mint, treasury);

  const tx = new w.Transaction();
  tx.feePayer = payer;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  // Create treasury ATA if it doesn't exist
  const destATAInfo = await conn.getAccountInfo(destATA);
  if (!destATAInfo) {
    tx.add(createATAInstruction(payer, destATA, treasury, mint));
  }

  // Transfer MONET
  const rawAmount = toRawAmount(MONET_CONFIG.ENTRY_FEE);
  tx.add(createTransferInstruction(sourceATA, destATA, payer, rawAmount));

  const signed = await window.solana.signAndSendTransaction(tx);
  const txId = signed.signature;

  // Confirm
  await conn.confirmTransaction(txId, 'confirmed');

  // Update balance
  WalletState.monetBalance -= MONET_CONFIG.ENTRY_FEE;
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));

  // Store session
  const session = { game: gameName, txId, paidAt: Date.now(), wallet: WalletState.address, entryFee: MONET_CONFIG.ENTRY_FEE };
  sessionStorage.setItem('game_session', JSON.stringify(session));

  return txId;
}

// ─── Record Win / Claim ───────────────────────────────────────────────────────
function recordWin(gameName, score) {
  const session = JSON.parse(sessionStorage.getItem('game_session') || 'null');
  if (!session) return false;
  const payout = MONET_CONFIG.ENTRY_FEE * MONET_CONFIG.PAYOUT_RATE;
  const claim = {
    id: Date.now().toString(36),
    wallet: WalletState.address || session.wallet,
    game: gameName,
    score,
    payout,
    entryTx: session.txId,
    claimedAt: new Date().toISOString(),
    status: 'pending',
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
    if (Date.now() - s.paidAt > 30 * 60 * 1000) return false; // 30 min session
    return true;
  } catch { return false; }
}

// ─── Wallet UI Helper ─────────────────────────────────────────────────────────
function renderWalletBar(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  function render() {
    if (WalletState.connected) {
      const short = WalletState.address.slice(0,4)+'...'+WalletState.address.slice(-4);
      el.innerHTML = `
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
  document.addEventListener('walletConnected', render);
  document.addEventListener('walletDisconnected', render);
  document.addEventListener('balanceUpdated', render);
}

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryAutoConnect);
} else {
  tryAutoConnect();
}
