// ─── MONET ARCADE GAME LOBBY ──────────────────────────────────────────────────
// Shared pre-game lobby: Solo (practice) vs Head-to-Head (wager MONET).
// Requires wallet.js to be loaded first.

(function () {
  const WAGER_PRESETS = [5, 10, 25, 50];
  const POLL_INTERVAL = 2500;

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
        padding:28px 24px 22px; width:min(380px,94vw);
        box-shadow:0 0 60px #a855ff33; color:#fff; text-align:center;
      }
      #lb-logo { font-size:36px; margin-bottom:2px; }
      #lb-title {
        font-size:15px; font-weight:800; color:#a855ff; margin-bottom:2px;
        text-shadow:0 0 12px #a855ff66;
      }
      #lb-game-label { font-size:10px; color:#666; letter-spacing:2px; margin-bottom:18px; }
      .lb-mode-row { display:flex; gap:12px; margin:0 0 16px; }
      .lb-mode-btn {
        flex:1; padding:16px 8px; border-radius:14px; cursor:pointer; border:2px solid;
        font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800;
        transition:transform .12s, box-shadow .12s; background:transparent;
      }
      .lb-mode-btn:hover { transform:translateY(-2px); }
      .lb-mode-btn.solo {
        border-color:#00ff9d; color:#00ff9d;
      }
      .lb-mode-btn.solo:hover { box-shadow:0 0 20px #00ff9d44; }
      .lb-mode-btn.h2h {
        border-color:#00f0ff; color:#00f0ff;
      }
      .lb-mode-btn.h2h:hover { box-shadow:0 0 20px #00f0ff44; }
      .lb-mode-icon { font-size:24px; display:block; margin-bottom:4px; }
      .lb-mode-sub  { font-size:9px; color:#888; margin-top:3px; font-weight:normal; }

      .lb-wager-label { font-size:10px; color:#888; margin:0 0 8px; letter-spacing:1px; }
      .lb-wager-row { display:flex; gap:8px; justify-content:center; margin-bottom:16px; flex-wrap:wrap; }
      .lb-wager-btn {
        padding:8px 14px; border-radius:10px; border:1px solid #a855ff44;
        background:rgba(168,85,255,0.07); color:#a855ff;
        font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800; cursor:pointer;
        transition:background .12s, box-shadow .12s;
      }
      .lb-wager-btn:hover, .lb-wager-btn.selected {
        background:rgba(168,85,255,0.22); box-shadow:0 0 12px #a855ff44;
        border-color:#a855ff;
      }

      .lb-h2h-options { display:flex; gap:10px; margin-bottom:14px; }
      .lb-h2h-opt {
        flex:1; padding:12px 8px; border-radius:12px; cursor:pointer;
        font-family:'Orbitron',sans-serif; font-size:10px; font-weight:800;
        border:1px solid; transition:box-shadow .12s; background:transparent;
      }
      .lb-h2h-opt.create { border-color:#a855ff44; color:#a855ff; }
      .lb-h2h-opt.create:hover { box-shadow:0 0 16px #a855ff44; border-color:#a855ff; }
      .lb-h2h-opt.join   { border-color:#00f0ff44; color:#00f0ff; }
      .lb-h2h-opt.join:hover   { box-shadow:0 0 16px #00f0ff44; border-color:#00f0ff; }
      .lb-h2h-icon { font-size:20px; display:block; margin-bottom:3px; }

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

      #lb-wait-status {
        color:#888; font-size:11px; margin:10px 0; line-height:1.6;
      }
      #lb-wait-dots { color:#a855ff; }

      .lb-err { color:#ff4488; font-size:11px; margin-top:8px; min-height:16px; }
      #lb-back { color:#555; font-size:10px; cursor:pointer; background:none; border:none; font-family:inherit; margin-top:10px; }
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
      .lb-progress {
        display:flex; gap:5px; margin-top:4px; width:100%; max-width:180px;
      }
      .lb-progress-seg {
        flex:1; height:4px; border-radius:2px;
        background:rgba(168,85,255,0.18);
        transition:background 0.3s, box-shadow 0.3s;
      }
      .lb-progress-seg.active {
        background:#a855ff;
        box-shadow:0 0 7px #a855ff, 0 0 14px #a855ff88;
      }
      .lb-pot-info {
        font-size:10px; color:#ffd700; margin-bottom:10px;
        background:rgba(255,215,0,0.07); border:1px solid #ffd70022;
        border-radius:8px; padding:6px 10px;
      }
    `;
    document.head.appendChild(s);
  }

  let _overlay = null;
  let _pollTimer = null;
  let _dotTimer  = null;
  let _dotCount  = 0;
  let _selectedWager = 5;
  let _gameName  = null;
  let _onStart   = null;

  function _clearPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_dotTimer)  { clearInterval(_dotTimer);  _dotTimer  = null; }
  }

  function _remove() {
    _clearPolling();
    if (_overlay) { _overlay.remove(); _overlay = null; }
  }

  function _errEl() {
    return document.getElementById('lb-err');
  }
  function _setErr(msg) {
    const el = _errEl();
    if (el) el.textContent = msg || '';
  }

  // ─── SCREEN: Mode select ───────────────────────────────────────────────────
  function _screenMode() {
    document.getElementById('lb-body').innerHTML = `
      <div class="lb-mode-row">
        <button class="lb-mode-btn solo" onclick="window._lbSolo()">
          <span class="lb-mode-icon">🎮</span>
          SOLO
          <div class="lb-mode-sub">Practice · No wager<br>Free to try</div>
        </button>
        <button class="lb-mode-btn h2h" onclick="window._lbH2H()">
          <span class="lb-mode-icon">⚔</span>
          HEAD-TO-HEAD
          <div class="lb-mode-sub">Wager MONET<br>Winner takes pot</div>
        </button>
      </div>
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="location.href='arcade.html'">← Back to Arcade</button>
    `;
  }

  // ─── SCREEN: H2H wager + options ──────────────────────────────────────────
  function _screenH2H() {
    document.getElementById('lb-body').innerHTML = `
      <div class="lb-wager-label">SELECT WAGER AMOUNT</div>
      <div class="lb-wager-row" id="lb-wager-row">
        ${WAGER_PRESETS.map(v => `
          <button class="lb-wager-btn${v === _selectedWager ? ' selected' : ''}"
            onclick="window._lbSelectWager(${v})">${v} MONET</button>
        `).join('')}
      </div>
      <div class="lb-pot-info" id="lb-pot-info"></div>
      <div class="lb-h2h-options">
        <button class="lb-h2h-opt create" onclick="window._lbCreate()">
          <span class="lb-h2h-icon">➕</span>
          CREATE<br>CHALLENGE
        </button>
        <button class="lb-h2h-opt join" onclick="window._lbShowJoin()">
          <span class="lb-h2h-icon">🔗</span>
          JOIN WITH<br>CODE
        </button>
      </div>
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="window._lbScreenMode()">← Back</button>
    `;
    _updatePotInfo();
  }

  function _updatePotInfo() {
    const el = document.getElementById('lb-pot-info');
    if (!el) return;
    const pot = (_selectedWager * 2 * 0.9).toFixed(1);
    el.textContent = `Wager ${_selectedWager} MONET each · Winner gets ${pot} MONET · 10% house rake`;
  }

  // ─── SCREEN: Create challenge ─────────────────────────────────────────────
  function _screenCreating() {
    document.getElementById('lb-body').innerHTML = `
      <div class="lb-spinner-row">
        <div class="lb-spinner"></div>
        <div class="lb-spinner-lbl" id="lb-spin-lbl">PREPARING CHALLENGE...</div>
        <div class="lb-progress">
          <div class="lb-progress-seg" id="lb-seg-1"></div>
          <div class="lb-progress-seg" id="lb-seg-2"></div>
          <div class="lb-progress-seg" id="lb-seg-3"></div>
        </div>
      </div>
      <div class="lb-err" id="lb-err"></div>
    `;
  }

  function _screenWaiting(code, pot) {
    document.getElementById('lb-body').innerHTML = `
      <div id="lb-code-box">
        <div style="font-size:10px;color:#888;margin-bottom:4px;letter-spacing:1px">CHALLENGE CODE</div>
        <div id="lb-code-val">${code}</div>
        <div id="lb-code-hint">Share this code with your opponent</div>
        <button class="lb-copy-btn" onclick="window._lbCopyCode('${code}')">📋 COPY CODE</button>
      </div>
      <div class="lb-pot-info">Pot: ${pot} MONET when opponent joins · 10% rake</div>
      <div id="lb-wait-status">Waiting for opponent<span id="lb-wait-dots">...</span></div>
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="window._lbCancelWait()">✕ Cancel</button>
    `;
    _dotCount = 0;
    _dotTimer = setInterval(() => {
      _dotCount = (_dotCount + 1) % 4;
      const el = document.getElementById('lb-wait-dots');
      if (el) el.textContent = '.'.repeat(_dotCount + 1);
    }, 600);
  }

  // ─── SCREEN: Join challenge ───────────────────────────────────────────────
  function _screenJoin() {
    const prefill = new URLSearchParams(location.search).get('challenge') || '';
    document.getElementById('lb-body').innerHTML = `
      <div style="font-size:10px;color:#888;margin-bottom:8px;letter-spacing:1px">ENTER CHALLENGE CODE</div>
      <input id="lb-join-input" maxlength="8" placeholder="XXXXXX" value="${prefill}">
      <button class="lb-action-btn cyan" onclick="window._lbJoin()">🔗 JOIN CHALLENGE</button>
      <div class="lb-err" id="lb-err"></div>
      <button id="lb-back" onclick="window._lbScreenH2H()">← Back</button>
    `;
    const inp = document.getElementById('lb-join-input');
    if (inp) inp.focus();
  }

  // ─── SCREEN: Paying ───────────────────────────────────────────────────────
  function _screenPaying(label) {
    document.getElementById('lb-body').innerHTML = `
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
    `;
  }

  function _setSpinLabel(txt) {
    const el = document.getElementById('lb-spin-lbl');
    if (el) el.textContent = txt;
  }

  function _setSpinStep(n) {
    for (let i = 1; i <= 3; i++) {
      const seg = document.getElementById('lb-seg-' + i);
      if (seg) seg.classList.toggle('active', i <= n);
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  async function _ensureWallet() {
    if (!WalletState.connected) {
      try {
        await connectWallet();
      } catch (e) {
        throw new Error('Connect your wallet first');
      }
    }
  }

  async function _doSolo() {
    try {
      await _ensureWallet();
    } catch (e) {
      _setErr(e.message);
      return;
    }
    // Clear any stale H2H session so solo scores don't go to old challenge
    sessionStorage.removeItem('challenge_session');
    _remove();
    if (_onStart) _onStart({ mode: 'solo' });
  }

  async function _doCreate() {
    try {
      await _ensureWallet();
    } catch (e) {
      _setErr(e.message);
      return;
    }
    if (WalletState.monetBalance < _selectedWager) {
      _setErr(`Insufficient MONET — need ${_selectedWager}, have ${WalletState.monetBalance.toFixed(2)}`);
      return;
    }

    _screenCreating();

    const STEP = {
      checking:   'CHECKING WALLET...',
      signing:    'SIGN IN YOUR WALLET...',
      confirming: 'CONFIRMING ON-CHAIN...',
    };
    const STEP_NUM = { checking: 1, signing: 2, confirming: 3 };

    let txId;
    try {
      txId = await payEntryFee(_gameName, step => {
        _setSpinLabel(STEP[step] || 'PROCESSING...');
        _setSpinStep(STEP_NUM[step] || 0);
      }, _selectedWager);
    } catch (e) {
      _screenH2H();
      _setErr(e.message);
      return;
    }

    _setSpinLabel('CREATING CHALLENGE...');
    let res;
    try {
      res = await api('/api/challenge/create', 'POST', {
        wallet: WalletState.address, txId, game: _gameName, entryFee: _selectedWager,
      });
    } catch (e) {
      _screenH2H();
      _setErr('Challenge creation failed: ' + e.message);
      return;
    }

    sessionStorage.setItem('challenge_session', JSON.stringify({
      challengeId: res.challengeId, code: res.code, txId, entryFee: _selectedWager, game: _gameName,
    }));

    const pot = (_selectedWager * 2 * 0.9).toFixed(1);
    _screenWaiting(res.code, pot);

    // Poll for opponent
    _pollTimer = setInterval(async () => {
      try {
        const r = await api(`/api/challenge/${res.code}`);
        if (r.challenge.status === 'active') {
          _clearPolling();
          _remove();
          if (_onStart) _onStart({ mode: 'h2h', challengeId: res.challengeId, code: res.code });
        }
      } catch (e) { /* ignore transient poll errors */ }
    }, POLL_INTERVAL);
  }

  async function _doJoin() {
    const inp  = document.getElementById('lb-join-input');
    const code = inp ? inp.value.trim().toUpperCase() : '';
    if (!code || code.length < 4) {
      _setErr('Enter a valid challenge code');
      return;
    }
    try {
      await _ensureWallet();
    } catch (e) {
      _setErr(e.message);
      return;
    }

    // Look up the challenge first
    let ch;
    try {
      const r = await api(`/api/challenge/${code}`);
      ch = r.challenge;
    } catch (e) {
      _setErr('Challenge not found: ' + code);
      return;
    }

    if (ch.status !== 'open') {
      _setErr(`Challenge is ${ch.status}`);
      return;
    }
    if (ch.player1.wallet === WalletState.address) {
      _setErr('Cannot join your own challenge — share the code with an opponent');
      return;
    }

    const wager = ch.entryFee || 5;
    if (WalletState.monetBalance < wager) {
      _setErr(`Insufficient MONET — need ${wager}, have ${WalletState.monetBalance.toFixed(2)}`);
      return;
    }

    _screenPaying('CHECKING WALLET...');
    _setSpinStep(1);

    const STEP = {
      checking:   'CHECKING WALLET...',
      signing:    'SIGN IN YOUR WALLET...',
      confirming: 'CONFIRMING ON-CHAIN...',
    };
    const STEP_NUM = { checking: 1, signing: 2, confirming: 3 };

    let txId;
    try {
      txId = await payEntryFee(_gameName, step => {
        _setSpinLabel(STEP[step] || 'PROCESSING...');
        _setSpinStep(STEP_NUM[step] || 0);
      }, wager);
    } catch (e) {
      _screenJoin();
      _setErr(e.message);
      return;
    }

    _setSpinLabel('JOINING CHALLENGE...');
    try {
      const r = await api('/api/challenge/join', 'POST', {
        code, wallet: WalletState.address, txId,
      });
      sessionStorage.setItem('challenge_session', JSON.stringify({
        challengeId: r.challenge.id, code, txId, entryFee: wager, game: _gameName,
      }));
    } catch (e) {
      _screenJoin();
      _setErr(e.message);
      return;
    }

    _remove();
    const cs = JSON.parse(sessionStorage.getItem('challenge_session') || '{}');
    if (_onStart) _onStart({ mode: 'h2h', challengeId: cs.challengeId, code });
  }

  function _cancelWait() {
    _clearPolling();
    _screenMode();
  }

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

  // Expose on window for inline onclick
  window._lbSolo        = _doSolo;
  window._lbH2H         = _screenH2H;
  window._lbCreate      = _doCreate;
  window._lbShowJoin    = _screenJoin;
  window._lbJoin        = _doJoin;
  window._lbCancelWait  = _cancelWait;
  window._lbCopyCode    = _copyCode;
  window._lbSelectWager = _selectWager;
  window._lbScreenMode  = _screenMode;
  window._lbScreenH2H   = _screenH2H;

  // ─── Public API ───────────────────────────────────────────────────────────
  function showGameLobby(gameName, onStart) {
    _gameName  = gameName;
    _onStart   = onStart;
    _selectedWager = 5;

    _injectStyles();

    if (_overlay) _overlay.remove();
    _overlay = document.createElement('div');
    _overlay.id = 'lb-overlay';
    _overlay.innerHTML = `
      <div id="lb-box">
        <div id="lb-logo">🕹</div>
        <div id="lb-title">CHOOSE MODE</div>
        <div id="lb-game-label">${gameName.toUpperCase()}</div>
        <div id="lb-body"></div>
      </div>
    `;
    document.body.appendChild(_overlay);

    // Check for challenge code in URL → skip to join screen
    const urlCode = new URLSearchParams(location.search).get('challenge');
    if (urlCode) {
      _screenJoin();
    } else {
      _screenMode();
    }
  }

  window.showGameLobby = showGameLobby;
  window.isLobbyOpen  = () => !!document.getElementById('lb-overlay');
})();
