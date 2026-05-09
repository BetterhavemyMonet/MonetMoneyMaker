// ─── MONET ARCADE GAME LOBBY ──────────────────────────────────────────────────
// 5-mode lobby: Practice · CPU Expert · Join Live H2H · Create H2H · Tournament
// Supports MONET or SOL (~$0.25) entry fee payments.
// Requires wallet.js to be loaded first.

(function () {
  let WAGER_PRESETS    = [5, 10, 25, 50]; // updated dynamically once price is known
  const POLL_INTERVAL  = 2500;
  const HOUSE_RAKE     = 0.20;
  let CPU_WIN_PAYOUT = 8;   // updated dynamically (= baseFee * 2 * 0.80)
  let _baseFee = 5;         // current dynamic entry fee (1x wager)

  function _injectStyles() {
    if (document.getElementById('lb-styles')) return;
    const s = document.createElement('style');
    s.id = 'lb-styles';
    s.textContent = `
      #lb-overlay {
        position:fixed; inset:0; background:rgba(2,4,10,0.97);
        z-index:99990; display:flex; align-items:center; justify-content:center;
        font-family:'Orbitron',sans-serif; backdrop-filter:blur(6px);
      }
      #lb-box {
        background:linear-gradient(160deg,#0d1017,#111827);
        border:1px solid #a855ff; border-radius:20px;
        padding:24px 20px 20px; width:min(400px,96vw);
        box-shadow:0 0 60px #a855ff33; color:#fff; text-align:center;
        max-height:92vh; overflow-y:auto;
      }
      #lb-logo { font-size:32px; margin-bottom:2px; }
      #lb-title {
        font-size:14px; font-weight:800; color:#a855ff; margin-bottom:2px;
        text-shadow:0 0 12px #a855ff66;
      }
      #lb-game-label { font-size:10px; color:#666; letter-spacing:2px; margin-bottom:16px; }

      /* ── 5-mode grid ── */
      .lb-mode-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px; }
      .lb-mode-card {
        padding:14px 10px; border-radius:14px; cursor:pointer; border:1px solid;
        font-family:'Orbitron',sans-serif; font-weight:800;
        transition:transform .12s, box-shadow .12s; background:transparent;
        text-align:center;
      }
      .lb-mode-card:hover { transform:translateY(-2px); }
      .lb-mode-card.full-row { grid-column:1/-1; }
      .lb-mc-icon { font-size:22px; display:block; margin-bottom:4px; }
      .lb-mc-name { font-size:11px; margin-bottom:3px; }
      .lb-mc-sub  { font-size:9px; font-weight:normal; color:#888; line-height:1.4; margin-top:2px; }

      .lb-mode-card.free    { border-color:#00ff9d66; color:#00ff9d; }
      .lb-mode-card.free:hover   { box-shadow:0 0 18px #00ff9d44; border-color:#00ff9d; }
      .lb-mode-card.cpu    { border-color:#f97316aa; color:#f97316; }
      .lb-mode-card.cpu:hover    { box-shadow:0 0 18px #f9731644; border-color:#f97316; }
      .lb-mode-card.live   { border-color:#00f0ffaa; color:#00f0ff; }
      .lb-mode-card.live:hover   { box-shadow:0 0 18px #00f0ff44; border-color:#00f0ff; }
      .lb-mode-card.create { border-color:#a855ffaa; color:#a855ff; }
      .lb-mode-card.create:hover { box-shadow:0 0 18px #a855ff44; border-color:#a855ff; }
      .lb-mode-card.tourney{ border-color:#ffd700aa; color:#ffd700; }
      .lb-mode-card.tourney:hover{ box-shadow:0 0 18px #ffd70044; border-color:#ffd700; }

      /* ── Currency picker ── */
      .lb-curr-btn {
        display:flex; align-items:center; gap:14px;
        width:100%; padding:14px 16px; margin-bottom:10px; border-radius:12px;
        cursor:pointer; border:1px solid; background:transparent; text-align:left;
        font-family:'Orbitron',sans-serif; transition:box-shadow .12s, border-color .12s;
      }
      .lb-curr-btn.monet { border-color:#a855ff66; color:#fff; }
      .lb-curr-btn.monet:not(:disabled):hover { border-color:#a855ff; box-shadow:0 0 16px #a855ff44; }
      .lb-curr-btn.sol   { border-color:#3b82f666; color:#fff; }
      .lb-curr-btn.sol:not(:disabled):hover   { border-color:#3b82f6; box-shadow:0 0 16px #3b82f644; }
      .lb-curr-btn:disabled { opacity:0.38; cursor:not-allowed; }
      .lb-curr-icon { font-size:22px; flex-shrink:0; }

      /* ── Wager selector ── */
      .lb-wager-label { font-size:10px; color:#888; margin:0 0 8px; letter-spacing:1px; }
      .lb-wager-row { display:flex; gap:8px; justify-content:center; margin-bottom:14px; flex-wrap:wrap; }
      .lb-wager-btn {
        padding:8px 14px; border-radius:10px; border:1px solid #a855ff44;
        background:rgba(168,85,255,0.07); color:#a855ff;
        font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800; cursor:pointer;
        transition:background .12s, box-shadow .12s;
      }
      .lb-wager-btn:hover, .lb-wager-btn.selected {
        background:rgba(168,85,255,0.22); box-shadow:0 0 12px #a855ff44; border-color:#a855ff;
      }

      /* ── Code box & waiting ── */
      #lb-code-box {
        background:rgba(168,85,255,0.08); border:1px solid #a855ff44;
        border-radius:12px; padding:14px; margin-bottom:14px;
      }
      #lb-code-val {
        font-size:26px; font-weight:800; color:#a855ff; letter-spacing:4px;
        margin-bottom:6px; text-shadow:0 0 16px #a855ff88;
      }
      #lb-code-hint { font-size:10px; color:#888; }
      .lb-copy-btn {
        padding:6px 14px; border-radius:8px; border:1px solid #a855ff44;
        background:rgba(168,85,255,0.1); color:#a855ff;
        font-family:'Orbitron',sans-serif; font-size:10px; cursor:pointer; margin-top:8px;
      }
      .lb-copy-btn:hover { background:rgba(168,85,255,0.2); }
      #lb-join-input {
        width:100%; box-sizing:border-box; padding:10px 14px;
        background:#0a0f1a; border:1px solid #333; border-radius:10px;
        color:#00f0ff; font-family:'Orbitron',sans-serif; font-size:16px;
        letter-spacing:3px; text-align:center; margin-bottom:10px; text-transform:uppercase;
      }
      #lb-join-input:focus { outline:none; border-color:#00f0ff44; }
      #lb-wait-status { color:#888; font-size:11px; margin:10px 0; line-height:1.6; }
      #lb-wait-dots   { color:#a855ff; }

      /* ── Live challenges list ── */
      .lb-live-list { max-height:180px; overflow-y:auto; margin-bottom:10px; }
      .lb-live-item {
        display:flex; justify-content:space-between; align-items:center;
        padding:9px 12px; border-radius:10px; margin-bottom:6px;
        border:1px solid #00f0ff22; background:rgba(0,240,255,0.05); cursor:pointer;
        transition:border-color .12s; font-size:11px;
      }
      .lb-live-item:hover { border-color:#00f0ff44; }
      .lb-live-badge { font-size:9px; color:#00ff9d; border:1px solid #00ff9d44; padding:2px 6px; border-radius:20px; }

      /* ── Tournament list ── */
      .lb-tourney-list { max-height:180px; overflow-y:auto; margin-bottom:10px; }
      .lb-tourney-item {
        display:flex; justify-content:space-between; align-items:center;
        padding:9px 12px; border-radius:10px; margin-bottom:6px;
        border:1px solid #ffd70022; background:rgba(255,215,0,0.04); cursor:pointer;
        transition:border-color .12s; font-size:11px;
      }
      .lb-tourney-item:hover { border-color:#ffd70044; }

      /* ── Shared UI ── */
      .lb-action-btn {
        width:100%; padding:13px; border-radius:12px; border:none; cursor:pointer;
        font-family:'Orbitron',sans-serif; font-size:13px; font-weight:800;
        margin-top:6px; transition:opacity .15s; letter-spacing:0.5px;
      }
      .lb-action-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .lb-action-btn.primary {
        background:linear-gradient(135deg,#a855ff,#7c3aed);
        color:#fff; box-shadow:0 4px 24px #a855ff44;
      }
      .lb-action-btn.cyan {
        background:linear-gradient(135deg,#00f0ff22,#00f0ff11);
        color:#00f0ff; border:1px solid #00f0ff44;
      }
      .lb-action-btn.gold {
        background:linear-gradient(135deg,#ffd70022,#ffd70011);
        color:#ffd700; border:1px solid #ffd70044;
      }
      .lb-err { color:#ff4488; font-size:11px; margin-top:8px; min-height:16px; }
      #lb-back {
        color:#555; font-size:10px; cursor:pointer; background:none;
        border:none; font-family:inherit; margin-top:10px;
      }
      #lb-back:hover { color:#ff4488; }
      @keyframes lb-spin { to { transform:rotate(360deg); } }
      .lb-spinner-row {
        display:flex; flex-direction:column; align-items:center; gap:10px; margin:14px 0;
      }
      .lb-spinner {
        width:36px; height:36px; border-radius:50%;
        border:3px solid rgba(168,85,255,0.2); border-top-color:#a855ff;
        animation:lb-spin 0.75s linear infinite;
      }
      .lb-spinner-lbl { font-size:10px; color:#a855ff; letter-spacing:1px; }
      .lb-progress { display:flex; gap:5px; margin-top:4px; width:100%; max-width:180px; }
      .lb-progress-seg {
        flex:1; height:4px; border-radius:2px; background:rgba(168,85,255,0.18);
        transition:background 0.3s, box-shadow 0.3s;
      }
      .lb-progress-seg.active {
        background:#a855ff; box-shadow:0 0 7px #a855ff, 0 0 14px #a855ff88;
      }
      .lb-pot-info {
        font-size:10px; color:#ffd700; margin-bottom:10px;
        background:rgba(255,215,0,0.07); border:1px solid #ffd70022;
        border-radius:8px; padding:6px 10px;
      }
      .lb-divider {
        border:none; border-top:1px solid #ffffff0d; margin:12px 0;
      }
    `;
    document.head.appendChild(s);
  }

  // ─── State ───────────────────────────────────────────────────────────────────
  let _overlay       = null;
  let _pollTimer     = null;
  let _dotTimer      = null;
  let _dotCount      = 0;
  let _selectedWager = 5;
  let _gameName      = null;
  let _onStart       = null;
  let _paymentType   = 'monet'; // 'monet' | 'sol'
  let _pendingCurrencyOnMonet = null;
  let _pendingCurrencyOnSol   = null;

  function _clearPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_dotTimer)  { clearInterval(_dotTimer);  _dotTimer  = null; }
  }
  function _remove() {
    _clearPolling();
    if (_overlay) { _overlay.remove(); _overlay = null; }
  }
  function _body()    { return document.getElementById('lb-body'); }
  function _errEl()   { return document.getElementById('lb-err'); }
  function _setErr(msg) { const el = _errEl(); if (el) el.textContent = msg || ''; }
  function _setHtml(h)  { const b = _body(); if (b) b.innerHTML = h; }

  // ─── SCREEN: 5-mode select ──────────────────────────────────────────────────
  function _screenMode() {
    _setHtml(`
      <div class="lb-mode-grid">
        <button class="lb-mode-card free" onclick="window._lbSolo()">
          <span class="lb-mc-icon">🎮</span>
          <div class="lb-mc-name">PRACTICE</div>
          <div class="lb-mc-sub">Free · No entry fee<br>No prize pool</div>
        </button>
        <button class="lb-mode-card cpu" onclick="window._lbCpuExpert()">
          <span class="lb-mc-icon">🤖</span>
          <div class="lb-mc-name">CPU EXPERT</div>
          <div class="lb-mc-sub">≈$0.50 entry · Win 80% back<br>(~${CPU_WIN_PAYOUT} MONET if you win)</div>
        </button>
        <button class="lb-mode-card live" onclick="window._lbJoinLive()">
          <span class="lb-mc-icon">⚡</span>
          <div class="lb-mc-name">JOIN LIVE</div>
          <div class="lb-mc-sub">Browse open H2H<br>80/20 pot split</div>
        </button>
        <button class="lb-mode-card create" onclick="window._lbCreate()">
          <span class="lb-mc-icon">⚔</span>
          <div class="lb-mc-name">CREATE H2H</div>
          <div class="lb-mc-sub">Challenge a friend<br>80/20 pot split</div>
        </button>
      </div>
      <button class="lb-mode-card tourney full-row" style="width:100%;display:block" onclick="window._lbTournament()">
        <span class="lb-mc-icon">🏆</span>
        <div class="lb-mc-name">TOURNAMENT</div>
        <div class="lb-mc-sub">Multi-player pool · Top 3 paid out automatically in MONET</div>
      </button>
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="location.href='arcade.html'">← Back to Arcade</button>
    `);
  }

  // ─── SCREEN: Currency picker ────────────────────────────────────────────────
  function _screenCurrency(modeLabel, modeIcon, onMonet, onSol) {
    _pendingCurrencyOnMonet = onMonet;
    _pendingCurrencyOnSol   = onSol;
    const monet    = WalletState?.monetBalance || 0;
    const sol      = WalletState?.solBalance   || 0;
    const hasMonet = monet >= _selectedWager;
    const hasSol   = sol  >= 0.003;
    _setHtml(`
      <div style="text-align:center;margin-bottom:14px">
        <div style="font-size:28px">${modeIcon}</div>
        <div style="font-size:12px;color:#a855ff;font-weight:800;margin-top:4px">${modeLabel}</div>
      </div>
      <div class="lb-wager-label">SELECT PAYMENT METHOD</div>
      <button class="lb-curr-btn monet" ${hasMonet ? '' : 'disabled'} onclick="window._lbPickMonet()">
        <div class="lb-curr-icon">💎</div>
        <div>
          <div style="font-size:12px;font-weight:800">PAY ${_selectedWager} MONET</div>
          <div style="font-size:9px;color:${hasMonet?'#00ff9d':'#ff4488'};margin-top:2px">
            ${hasMonet ? `Balance: ${monet.toFixed(2)} MONET ✓` : `Need ${_selectedWager} MONET — have ${monet.toFixed(2)}`}
          </div>
        </div>
      </button>
      <button class="lb-curr-btn sol" ${hasSol ? '' : 'disabled'} onclick="window._lbPickSol()">
        <div class="lb-curr-icon">◎</div>
        <div>
          <div style="font-size:12px;font-weight:800">PAY ~$0.25 IN SOL</div>
          <div style="font-size:9px;color:${hasSol?'#00ff9d':'#ff4488'};margin-top:2px">
            ${hasSol ? `Balance: ${sol.toFixed(4)} SOL ✓` : `Need ~0.003 SOL — have ${sol.toFixed(4)}`}
          </div>
        </div>
      </button>
      ${!hasMonet && !hasSol ? `
        <div style="margin-top:8px;font-size:10px;color:#888">
          <a href="exchange.html" style="color:#a855ff">Get MONET →</a>
          &nbsp;·&nbsp; Add SOL from any exchange
        </div>
      ` : ''}
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="window._lbScreenMode()">← Back</button>
    `);
  }

  // ─── SCREEN: Wager amount (for H2H modes) ───────────────────────────────────
  function _screenWager(modeLabel, modeIcon, onPick) {
    _setHtml(`
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:24px">${modeIcon}</div>
        <div style="font-size:12px;color:#a855ff;font-weight:800;margin-top:4px">${modeLabel}</div>
      </div>
      <div class="lb-wager-label">SELECT WAGER PER PLAYER</div>
      <div class="lb-wager-row" id="lb-wager-row">
        ${WAGER_PRESETS.map(v => {
          const usd = MONET_CONFIG?._priceUsd ? '$' + (v * MONET_CONFIG._priceUsd).toFixed(2) : '';
          return `<button class="lb-wager-btn${v === _selectedWager ? ' selected' : ''}"
            onclick="window._lbSelectWager(${v})">${usd || (v+' MONET')}<br><span style="font-size:8px;opacity:0.6">${usd ? v+' MONET' : 'Win 90%'}</span></button>`;
        }).join('')}
      </div>
      <div class="lb-pot-info" id="lb-pot-info"></div>
      <div class="lb-err" id="lb-err"></div>
      <button class="lb-action-btn primary" onclick="window._lbWagerNext()" style="margin-top:10px">CONTINUE →</button>
      <br><button id="lb-back" onclick="window._lbScreenMode()">← Back</button>
    `);
    window._lbWagerNext = onPick;
    _updatePotInfo();
  }

  function _updatePotInfo() {
    const el = document.getElementById('lb-pot-info');
    if (!el) return;
    const pot = (_selectedWager * 2 * (1 - HOUSE_RAKE)).toFixed(1);
    el.textContent = `${_selectedWager} MONET each · Winner gets ${pot} MONET · 20% house rake`;
  }

  // ─── SCREEN: Spinners ────────────────────────────────────────────────────────
  function _screenCreating() {
    _setHtml(`
      <div class="lb-spinner-row">
        <div class="lb-spinner"></div>
        <div class="lb-spinner-lbl" id="lb-spin-lbl">PREPARING...</div>
        <div class="lb-progress">
          <div class="lb-progress-seg" id="lb-seg-1"></div>
          <div class="lb-progress-seg" id="lb-seg-2"></div>
          <div class="lb-progress-seg" id="lb-seg-3"></div>
        </div>
      </div>
      <div class="lb-err" id="lb-err"></div>
    `);
  }

  function _screenPaying(label) {
    _setHtml(`
      <div class="lb-spinner-row">
        <div class="lb-spinner"></div>
        <div class="lb-spinner-lbl" id="lb-spin-lbl">${label || 'PROCESSING...'}</div>
        <div class="lb-progress">
          <div class="lb-progress-seg" id="lb-seg-1"></div>
          <div class="lb-progress-seg" id="lb-seg-2"></div>
          <div class="lb-progress-seg" id="lb-seg-3"></div>
        </div>
      </div>
      <div class="lb-err" id="lb-err"></div>
    `);
  }

  function _setSpinLabel(txt) { const el = document.getElementById('lb-spin-lbl'); if (el) el.textContent = txt; }
  function _setSpinStep(n)    { for (let i=1;i<=3;i++){const s=document.getElementById('lb-seg-'+i);if(s)s.classList.toggle('active',i<=n);} }

  // ─── SCREEN: Waiting for opponent ───────────────────────────────────────────
  function _screenWaiting(code, pot) {
    _setHtml(`
      <div id="lb-code-box">
        <div style="font-size:10px;color:#888;margin-bottom:4px;letter-spacing:1px">CHALLENGE CODE</div>
        <div id="lb-code-val">${code}</div>
        <div id="lb-code-hint">Share this code with your opponent</div>
        <button class="lb-copy-btn" onclick="window._lbCopyCode('${code}')">📋 COPY CODE</button>
      </div>
      <div class="lb-pot-info">Pot: ${pot} MONET when opponent joins · 20% rake</div>
      <div id="lb-wait-status">Waiting for opponent<span id="lb-wait-dots">...</span></div>
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="window._lbCancelWait()">✕ Cancel</button>
    `);
    _dotCount = 0;
    _dotTimer = setInterval(() => {
      _dotCount = (_dotCount + 1) % 4;
      const el = document.getElementById('lb-wait-dots');
      if (el) el.textContent = '.'.repeat(_dotCount + 1);
    }, 600);
  }

  // ─── SCREEN: Join with code ──────────────────────────────────────────────────
  function _screenJoin() {
    const prefill = new URLSearchParams(location.search).get('challenge') || '';
    _setHtml(`
      <div style="font-size:10px;color:#888;margin-bottom:8px;letter-spacing:1px">ENTER CHALLENGE CODE</div>
      <input id="lb-join-input" maxlength="8" placeholder="XXXXXX" value="${prefill}">
      <div class="lb-err" id="lb-err"></div>
      <button class="lb-action-btn cyan" onclick="window._lbLookupAndJoin()">🔗 LOOK UP CHALLENGE</button>
      <br><button id="lb-back" onclick="window._lbScreenMode()">← Back</button>
    `);
    const inp = document.getElementById('lb-join-input');
    if (inp) inp.focus();
  }

  // ─── SCREEN: Join Live — list open challenges ───────────────────────────────
  async function _screenJoinLive() {
    _setHtml(`
      <div style="font-size:10px;color:#00f0ff;margin-bottom:10px;letter-spacing:1px">⚡ LIVE CHALLENGES</div>
      <div class="lb-live-list" id="lb-live-list">
        <div style="color:#888;font-size:11px;padding:14px">Loading...</div>
      </div>
      <hr class="lb-divider">
      <div style="font-size:10px;color:#888;margin-bottom:6px">Or enter a code directly:</div>
      <input id="lb-join-input" maxlength="8" placeholder="XXXXXX">
      <div class="lb-err" id="lb-err"></div>
      <button class="lb-action-btn cyan" onclick="window._lbLookupAndJoin()" style="margin-top:6px">🔗 JOIN WITH CODE</button>
      <br><button id="lb-back" onclick="window._lbScreenMode()">← Back</button>
    `);

    try {
      const r = await api(`/api/challenges`);
      const open = (r.challenges || []).filter(c => c.status === 'open' && c.game === _gameName);
      const listEl = document.getElementById('lb-live-list');
      if (!listEl) return;
      if (!open.length) {
        listEl.innerHTML = `<div style="color:#888;font-size:11px;padding:14px">No open challenges right now.<br><span style="color:#00f0ff">Be the first — Create H2H!</span></div>`;
      } else {
        listEl.innerHTML = open.map(c => {
          const short = c.player1?.wallet?.slice(0,6) + '…' || 'unknown';
          const pot   = (c.entryFee * 2 * (1 - HOUSE_RAKE)).toFixed(1);
          return `<div class="lb-live-item" onclick="window._lbJoinChallenge('${c.code}')">
            <div>
              <div style="color:#fff;font-weight:800">${c.code}</div>
              <div style="color:#888;font-size:9px;margin-top:2px">${short} · ≈$0.50 each (${c.entryFee} MONET)</div>
            </div>
            <div style="text-align:right">
              <div style="color:#ffd700;font-weight:800;font-size:12px">${pot} MONET</div>
              <span class="lb-live-badge">OPEN</span>
            </div>
          </div>`;
        }).join('');
      }
    } catch(e) {
      const listEl = document.getElementById('lb-live-list');
      if (listEl) listEl.innerHTML = `<div style="color:#ff4488;font-size:11px;padding:8px">${e.message}</div>`;
    }
  }

  // ─── SCREEN: Tournament list ─────────────────────────────────────────────────
  async function _screenTournament() {
    _setHtml(`
      <div style="font-size:10px;color:#ffd700;margin-bottom:10px;letter-spacing:1px">🏆 TOURNAMENTS</div>
      <div class="lb-tourney-list" id="lb-tourney-list">
        <div style="color:#888;font-size:11px;padding:14px">Loading...</div>
      </div>
      <div class="lb-err" id="lb-err"></div>
      <button class="lb-action-btn gold" onclick="window._lbCreateTournament()" style="margin-top:4px">+ CREATE TOURNAMENT</button>
      <br><button id="lb-back" onclick="window._lbScreenMode()">← Back</button>
    `);

    try {
      const r       = await api('/api/tournament/list');
      const tourneys = (r.tournaments || []).filter(t =>
        (t.game === _gameName || !t.game) && t.status === 'registration'
      );
      const listEl  = document.getElementById('lb-tourney-list');
      if (!listEl) return;
      if (!tourneys.length) {
        listEl.innerHTML = `<div style="color:#888;font-size:11px;padding:14px">No open tournaments.<br><span style="color:#ffd700">Create one below!</span></div>`;
      } else {
        listEl.innerHTML = tourneys.map(t => {
          const spots = t.maxPlayers - t.players.length;
          return `<div class="lb-tourney-item" onclick="window._lbJoinTournament('${t.id}', ${t.entryFee})">
            <div>
              <div style="color:#fff;font-weight:800;font-size:11px">${t.title}</div>
              <div style="color:#888;font-size:9px;margin-top:2px">${t.players.length}/${t.maxPlayers} players · ≈$0.50 entry (${t.entryFee} MONET)</div>
            </div>
            <div style="text-align:right">
              <div style="color:#ffd700;font-weight:800;font-size:11px">${t.prizePool.toFixed(1)} POT</div>
              <div style="color:#888;font-size:9px">${spots} spot${spots!==1?'s':''} left</div>
            </div>
          </div>`;
        }).join('');
      }
    } catch(e) {
      const listEl = document.getElementById('lb-tourney-list');
      if (listEl) listEl.innerHTML = `<div style="color:#ff4488;font-size:11px;padding:8px">${e.message}</div>`;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  async function _ensureWallet() {
    if (!WalletState.connected) {
      await connectWallet();
    }
    await refreshBalances().catch(() => {});
  }

  const STEP_LABELS = { checking:'CHECKING WALLET...', signing:'SIGN IN YOUR WALLET...', confirming:'CONFIRMING ON-CHAIN...' };
  const STEP_NUM    = { checking:1, signing:2, confirming:3 };
  function _onStep(step) {
    _setSpinLabel(STEP_LABELS[step] || 'PROCESSING...');
    _setSpinStep(STEP_NUM[step] || 0);
  }

  async function _pay(wager) {
    if (_paymentType === 'sol') {
      return await payEntryFeeSOL(_gameName, _onStep);
    } else {
      return await payEntryFee(_gameName, _onStep, wager);
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  // PRACTICE — free, skip payment
  async function _doSolo() {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    sessionStorage.removeItem('challenge_session');
    _remove();
    if (_onStart) _onStart({ mode: 'solo' });
  }

  // CPU EXPERT — currency picker then pay → launch via showPayGate
  function _doCpuExpert() {
    _screenCurrency('CPU EXPERT', '🤖',
      () => { _paymentType = 'monet'; _doPayAndLaunchCpu(); },
      () => { _paymentType = 'sol';   _doPayAndLaunchCpu(); }
    );
  }

  async function _doPayAndLaunchCpu() {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    _screenPaying('CHECKING WALLET...');
    _setSpinStep(1);
    let txId;
    try { txId = await _pay(_selectedWager); }
    catch(e) { _doCpuExpert(); _setErr(e.message); return; }

    _setSpinLabel('LAUNCHING CPU GAME...');
    try {
      const wallet = WalletState.address;
      const res = await api('/api/cpu/start', 'POST', {
        wallet, txId, game: _gameName, paymentType: _paymentType,
      });
      sessionStorage.setItem('cpu_session', JSON.stringify({
        cpuGameId: res.cpuGameId, cpuScore: res.cpuScore,
        difficulty: 'expert', game: _gameName, txId,
      }));
      _remove();
      if (_onStart) _onStart({ mode: 'cpu', cpuGameId: res.cpuGameId, cpuScore: res.cpuScore });
      if (typeof showCpuTarget === 'function') setTimeout(() => showCpuTarget(res.cpuScore, 'expert'), 300);
    } catch(e) {
      _doCpuExpert();
      _setErr('Failed to start CPU game: ' + e.message);
    }
  }

  // JOIN LIVE — browse then currency pick → pay → join
  function _doJoinLive() { _screenJoinLive(); }

  async function _doJoinChallenge(code) {
    let ch;
    try {
      const r = await api(`/api/challenge/${code}`);
      ch = r.challenge;
    } catch(e) { _setErr('Challenge not found: ' + code); return; }

    if (ch.status !== 'open')                      { _setErr(`Challenge is ${ch.status}`); return; }
    if (ch.player1.wallet === WalletState.address) { _setErr('Cannot join your own challenge'); return; }

    const wager = ch.entryFee || 5;
    _selectedWager = wager;

    _screenCurrency(`JOIN: ${code}`, '⚡',
      () => { _paymentType = 'monet'; _doPayAndJoin(code, wager); },
      () => { _paymentType = 'sol';   _doPayAndJoin(code, wager); }
    );
  }

  async function _doPayAndJoin(code, wager) {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    _screenPaying('CHECKING WALLET...');
    _setSpinStep(1);
    let txId;
    try { txId = await _pay(wager); }
    catch(e) { _screenJoinLive(); _setErr(e.message); return; }

    _setSpinLabel('JOINING CHALLENGE...');
    try {
      const r = await api('/api/challenge/join', 'POST', {
        code, wallet: WalletState.address, txId, paymentType: _paymentType,
      });
      sessionStorage.setItem('challenge_session', JSON.stringify({
        challengeId: r.challenge.id, code, txId, entryFee: wager, game: _gameName,
      }));
    } catch(e) {
      _screenJoinLive();
      _setErr(e.message);
      return;
    }

    _remove();
    const cs = JSON.parse(sessionStorage.getItem('challenge_session') || '{}');
    if (_onStart) _onStart({ mode: 'h2h', challengeId: cs.challengeId, code });
    if (window.startH2HWatch) startH2HWatch(code);
  }

  // JOIN with typed code
  async function _doLookupAndJoin() {
    const inp  = document.getElementById('lb-join-input');
    const code = inp ? inp.value.trim().toUpperCase() : '';
    if (!code || code.length < 4) { _setErr('Enter a valid challenge code'); return; }
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    await _doJoinChallenge(code);
  }

  // CREATE H2H — wager picker → currency picker → pay → create → wait
  function _doCreate() {
    _screenWager('CREATE H2H', '⚔', () => {
      _screenCurrency(`CREATE: ${_selectedWager} MONET`, '⚔',
        () => { _paymentType = 'monet'; _doPayAndCreate(); },
        () => { _paymentType = 'sol';   _doPayAndCreate(); }
      );
    });
  }

  async function _doPayAndCreate() {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    if (_paymentType === 'monet' && WalletState.monetBalance < _selectedWager) {
      _setErr(`Insufficient MONET — need ${_selectedWager}, have ${WalletState.monetBalance.toFixed(2)}`);
      return;
    }
    _screenCreating();
    _setSpinLabel('CHECKING WALLET...');
    _setSpinStep(1);
    let txId;
    try { txId = await _pay(_selectedWager); }
    catch(e) { _doCreate(); _setErr(e.message); return; }

    _setSpinLabel('CREATING CHALLENGE...');
    let res;
    try {
      res = await api('/api/challenge/create', 'POST', {
        wallet: WalletState.address, txId, game: _gameName,
        entryFee: _selectedWager, paymentType: _paymentType,
      });
    } catch(e) {
      _doCreate();
      _setErr('Challenge creation failed: ' + e.message);
      return;
    }

    sessionStorage.setItem('challenge_session', JSON.stringify({
      challengeId: res.challengeId, code: res.code, txId,
      entryFee: _selectedWager, game: _gameName,
    }));

    const pot = (_selectedWager * 2 * (1 - HOUSE_RAKE)).toFixed(1);
    _screenWaiting(res.code, pot);

    _pollTimer = setInterval(async () => {
      try {
        const r = await api(`/api/challenge/${res.code}`);
        if (r.challenge.status === 'active') {
          _clearPolling();
          _remove();
          if (_onStart) _onStart({ mode: 'h2h', challengeId: res.challengeId, code: res.code });
          if (window.startH2HWatch) startH2HWatch(res.code);
        }
      } catch(_) {}
    }, POLL_INTERVAL);
  }

  // TOURNAMENT — list → join or create
  function _doTournament() { _screenTournament(); }

  async function _doJoinTournament(tournamentId, entryFee) {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    const fee = entryFee || _baseFee;
    _selectedWager = fee;
    _screenCurrency('TOURNAMENT ENTRY', '🏆',
      () => { _paymentType = 'monet'; _doPayAndRegisterTourney(tournamentId, fee); },
      () => { _paymentType = 'sol';   _doPayAndRegisterTourney(tournamentId, fee); }
    );
  }

  async function _doPayAndRegisterTourney(tournamentId, fee) {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    _screenPaying('CHECKING WALLET...');
    _setSpinStep(1);
    let txId;
    try { txId = await _pay(fee); }
    catch(e) { _screenTournament(); _setErr(e.message); return; }

    _setSpinLabel('REGISTERING...');
    try {
      await api('/api/tournament/register', 'POST', {
        tournamentId, wallet: WalletState.address, txId, paymentType: _paymentType,
      });
      sessionStorage.setItem('tournament_session', JSON.stringify({ tournamentId, txId, game: _gameName }));
    } catch(e) {
      _screenTournament();
      _setErr(e.message);
      return;
    }

    _remove();
    if (_onStart) _onStart({ mode: 'tournament', tournamentId });
  }

  async function _doCreateTournament() {
    try { await _ensureWallet(); } catch(e) { _setErr(e.message); return; }
    _screenPaying('CREATING TOURNAMENT...');
    try {
      const res = await api('/api/tournament/create', 'POST', { game: _gameName });
      await _doJoinTournament(res.tournament.id, res.tournament.entryFee);
    } catch(e) {
      _screenTournament();
      _setErr('Failed to create tournament: ' + e.message);
    }
  }

  function _cancelWait() { _clearPolling(); _screenMode(); }

  function _copyCode(code) {
    navigator.clipboard.writeText(code).catch(() => {});
    const btn = document.querySelector('.lb-copy-btn');
    if (btn) { btn.textContent = '✓ COPIED!'; setTimeout(() => { if (btn) btn.textContent = '📋 COPY CODE'; }, 1500); }
  }

  function _selectWager(v) {
    _selectedWager = v;
    document.querySelectorAll('.lb-wager-btn').forEach(b => {
      b.classList.toggle('selected', parseInt(b.textContent) === v);
    });
    _updatePotInfo();
  }

  // ─── Expose on window ────────────────────────────────────────────────────────
  window._lbSolo            = _doSolo;
  window._lbCpuExpert       = _doCpuExpert;
  window._lbJoinLive        = _doJoinLive;
  window._lbCreate          = _doCreate;
  window._lbTournament      = _doTournament;
  window._lbJoinChallenge   = _doJoinChallenge;
  window._lbJoinTournament  = _doJoinTournament;
  window._lbCreateTournament= _doCreateTournament;
  window._lbLookupAndJoin   = _doLookupAndJoin;
  window._lbCancelWait      = _cancelWait;
  window._lbCopyCode        = _copyCode;
  window._lbSelectWager     = _selectWager;
  window._lbScreenMode      = _screenMode;
  window._lbScreenH2H       = _doCreate;
  window._lbPickMonet       = () => { if (_pendingCurrencyOnMonet) _pendingCurrencyOnMonet(); };
  window._lbPickSol         = () => { if (_pendingCurrencyOnSol)   _pendingCurrencyOnSol(); };

  // ─── Public API ───────────────────────────────────────────────────────────────
  function showGameLobby(gameName, onStart) {
    _gameName      = gameName;
    _onStart       = onStart;
    _selectedWager = _baseFee;
    _paymentType   = 'monet';

    _injectStyles();

    if (_overlay) _overlay.remove();
    _overlay = document.createElement('div');
    _overlay.id = 'lb-overlay';
    _overlay.innerHTML = `
      <div id="lb-box">
        <div id="lb-logo">🕹</div>
        <div id="lb-title">CHOOSE MODE</div>
        <div id="lb-game-label">${gameName.toUpperCase()}</div>
        <div id="lb-body"><div style="color:#888;font-size:11px;padding:24px 0;text-align:center">Loading...</div></div>
      </div>
    `;
    document.body.appendChild(_overlay);

    const urlCode = new URLSearchParams(location.search).get('challenge');

    // Fetch dynamic fee then render — fallback after 1.5s to avoid blocking
    const priceTimeout = new Promise(resolve => setTimeout(resolve, 1500));
    const priceFetch   = fetch('/api/monet-price').then(r => r.json()).then(d => {
      if (d.entryFeeMonet > 0) {
        _baseFee = d.entryFeeMonet;
        const b = _baseFee;
        WAGER_PRESETS = [...new Set([b, b*2, b*5, b*10].map(Math.round))];
        _selectedWager = b;
        CPU_WIN_PAYOUT = Math.round(b * 2 * (1 - 0.20) * 10) / 10;
      }
    }).catch(() => {});
    Promise.race([priceFetch, priceTimeout]).then(() => {
      if (urlCode) { _screenJoin(); }
      else         { _screenMode(); }
    });
  }

  window.showGameLobby = showGameLobby;
  window.isLobbyOpen  = () => !!document.getElementById('lb-overlay');
})();
