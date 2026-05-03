// ─── MONET ARCADE GAMEPAD MODULE ─────────────────────────────────────────────
// Polls the Gamepad API each frame and maps inputs to a standard action set.
// D-pad / left stick = directional movement
// A button (index 0) = jump / primary action
// B button (index 1) = secondary action
// Start button (index 9) = pause / start

(function () {
  const AXIS_DEADZONE = 0.4;

  // Standard mapping indices (Xbox / Standard layout)
  const BTN_A     = 0;
  const BTN_B     = 1;
  const BTN_START = 9;
  const DPAD_UP   = 12;
  const DPAD_DOWN = 13;
  const DPAD_LEFT = 14;
  const DPAD_RIGHT= 15;
  const AXIS_LX   = 0;
  const AXIS_LY   = 1;

  let _prevState = {};
  let _handlers  = {};
  let _rafId     = null;
  let _running   = false;

  function _getGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }

  function _btn(pad, idx) {
    const b = pad.buttons[idx];
    return b ? (b.pressed || b.value > 0.5) : false;
  }

  function _pressed(id, cur) {
    const was = _prevState[id] || false;
    if (cur && !was) return true;
    return false;
  }

  function _held(id, cur) {
    return cur;
  }

  function _poll() {
    if (!_running) return;
    _rafId = requestAnimationFrame(_poll);

    const pad = _getGamepad();
    if (!pad) return;

    const ax = pad.axes[AXIS_LX] || 0;
    const ay = pad.axes[AXIS_LY] || 0;

    const cur = {
      up:    _btn(pad, DPAD_UP)    || ay < -AXIS_DEADZONE,
      down:  _btn(pad, DPAD_DOWN)  || ay >  AXIS_DEADZONE,
      left:  _btn(pad, DPAD_LEFT)  || ax < -AXIS_DEADZONE,
      right: _btn(pad, DPAD_RIGHT) || ax >  AXIS_DEADZONE,
      a:     _btn(pad, BTN_A),
      b:     _btn(pad, BTN_B),
      start: _btn(pad, BTN_START),
    };

    function fire(action) {
      const fn = _handlers[action];
      if (fn) fn();
    }

    if (_pressed('up',    cur.up))    fire('up');
    if (_pressed('down',  cur.down))  fire('down');
    if (_pressed('left',  cur.left))  fire('left');
    if (_pressed('right', cur.right)) fire('right');
    if (_pressed('a',     cur.a))     fire('a');
    if (_pressed('b',     cur.b))     fire('b');
    if (_pressed('start', cur.start)) fire('start');

    // Continuous directional hold (for games like Pong that need held movement)
    if (_held('up',    cur.up))    fire('hold_up');
    if (_held('down',  cur.down))  fire('hold_down');
    if (_held('left',  cur.left))  fire('hold_left');
    if (_held('right', cur.right)) fire('hold_right');

    _prevState = cur;
  }

  function start() {
    if (_running) return;
    _running = true;
    _poll();
  }

  function stop() {
    _running = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  function on(action, fn) {
    _handlers[action] = fn;
  }

  function off(action) {
    delete _handlers[action];
  }

  function isConnected() {
    return !!_getGamepad();
  }

  window.GamepadMgr = { start, stop, on, off, isConnected };

  window.addEventListener('gamepadconnected', () => {
    console.log('[GamepadMgr] Controller connected');
    start();
  });
  window.addEventListener('gamepaddisconnected', () => {
    console.log('[GamepadMgr] Controller disconnected');
  });

  // Start polling immediately in case already connected
  start();
})();

// ─── ANALOG D-PAD ────────────────────────────────────────────────────────────
// Makes every .ctrl-dpad accept touch/click anywhere in its area.
// Direction is calculated from the angle of the touch relative to the centre.
// The matching .dpad-* button's existing handlers are fired via synthetic
// mouse events, so every game's own code continues to work unchanged.
(function () {
  'use strict';

  const DEAD_RATIO = 0.16;   // dead-zone as fraction of half-width
  const THUMB_R    = 18;     // thumb-dot radius in px

  function initDpad(dpad) {
    if (dpad._analogReady) return;
    dpad._analogReady = true;

    if (getComputedStyle(dpad).position === 'static') dpad.style.position = 'relative';

    // Transparent overlay that swallows all input on the d-pad
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:absolute;inset:0;z-index:50;touch-action:none;' +
      '-webkit-tap-highlight-color:transparent;border-radius:inherit;user-select:none;';
    dpad.appendChild(overlay);

    // Floating thumb dot — visual feedback
    const thumb = document.createElement('div');
    thumb.style.cssText =
      'position:absolute;width:' + (THUMB_R * 2) + 'px;height:' + (THUMB_R * 2) + 'px;' +
      'border-radius:50%;background:rgba(168,85,255,0.5);' +
      'border:2.5px solid rgba(168,85,255,0.95);' +
      'box-shadow:0 0 14px rgba(168,85,255,0.7);' +
      'pointer-events:none;transform:translate(-50%,-50%);' +
      'transition:left .03s,top .03s;display:none;z-index:52;';
    overlay.appendChild(thumb);

    const btnUp    = dpad.querySelector('.dpad-up');
    const btnDown  = dpad.querySelector('.dpad-down');
    const btnLeft  = dpad.querySelector('.dpad-left');
    const btnRight = dpad.querySelector('.dpad-right');
    const btnMap   = { up: btnUp, down: btnDown, left: btnLeft, right: btnRight };

    const held     = new Set();  // currently simulated-pressed buttons
    const lastDirs = new Set();  // directions active on last frame

    function isOff(btn) {
      if (!btn) return true;
      const s = btn.style;
      return s.pointerEvents === 'none' || parseFloat(s.opacity || '1') < 0.5;
    }

    function press(btn) {
      if (isOff(btn) || held.has(btn)) return;
      held.add(btn);
      btn.classList.add('dpad-pressed');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }

    function release(btn) {
      if (!held.has(btn)) return;
      held.delete(btn);
      btn.classList.remove('dpad-pressed');
      btn.dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
    }

    function releaseAll() {
      for (const b of [...held]) release(b);
      lastDirs.clear();
    }

    // Returns array of active direction strings from a touch/mouse position
    function calcDirs(clientX, clientY) {
      const r  = dpad.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const d  = Math.hypot(dx, dy);
      if (d < (r.width / 2) * DEAD_RATIO) return [];
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const dirs = [];
      // Vertical: dominant if its component > 35% of horizontal
      if (ady >= adx * 0.35) dirs.push(dy < 0 ? 'up' : 'down');
      // Horizontal: dominant if its component > 35% of vertical
      if (adx >= ady * 0.35) dirs.push(dx < 0 ? 'left' : 'right');
      return dirs;
    }

    // Clamps raw position inside the d-pad circle for the thumb dot
    function thumbPos(clientX, clientY) {
      const r   = dpad.getBoundingClientRect();
      const cx  = r.left + r.width  / 2;
      const cy  = r.top  + r.height / 2;
      const dx  = clientX - cx;
      const dy  = clientY - cy;
      const max = r.width  / 2 - 6;
      const d   = Math.hypot(dx, dy);
      const s   = d > max ? max / d : 1;
      return { x: r.width / 2 + dx * s, y: r.height / 2 + dy * s };
    }

    function applyDirs(dirs) {
      const dirSet = new Set(dirs);
      // Release buttons whose direction is no longer active
      for (const [dir, btn] of Object.entries(btnMap)) {
        if (!dirSet.has(dir)) release(btn);
      }
      // Press buttons for newly active directions
      for (const dir of dirs) {
        if (!lastDirs.has(dir)) press(btnMap[dir]);
      }
      lastDirs.clear();
      for (const d of dirs) lastDirs.add(d);
    }

    function showThumb(clientX, clientY) {
      const tp = thumbPos(clientX, clientY);
      thumb.style.display = 'block';
      thumb.style.left = tp.x + 'px';
      thumb.style.top  = tp.y + 'px';
    }

    // ── Touch ──────────────────────────────────────────────────────────────────
    overlay.addEventListener('touchstart', function (e) {
      e.preventDefault();
      const t = e.touches[0];
      showThumb(t.clientX, t.clientY);
      applyDirs(calcDirs(t.clientX, t.clientY));
    }, { passive: false });

    overlay.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!e.touches.length) return;
      const t = e.touches[0];
      showThumb(t.clientX, t.clientY);
      applyDirs(calcDirs(t.clientX, t.clientY));
    }, { passive: false });

    overlay.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (e.touches.length === 0) {
        thumb.style.display = 'none';
        releaseAll();
      } else {
        const t = e.touches[0];
        showThumb(t.clientX, t.clientY);
        applyDirs(calcDirs(t.clientX, t.clientY));
      }
    }, { passive: false });

    overlay.addEventListener('touchcancel', function (e) {
      thumb.style.display = 'none';
      releaseAll();
    }, { passive: false });

    // ── Mouse (desktop testing) ────────────────────────────────────────────────
    overlay.addEventListener('mousedown', function (e) {
      showThumb(e.clientX, e.clientY);
      applyDirs(calcDirs(e.clientX, e.clientY));
    });

    overlay.addEventListener('mousemove', function (e) {
      if (!(e.buttons & 1)) return;
      showThumb(e.clientX, e.clientY);
      applyDirs(calcDirs(e.clientX, e.clientY));
    });

    function endMouse() {
      thumb.style.display = 'none';
      releaseAll();
    }

    overlay.addEventListener('mouseup',    endMouse);
    overlay.addEventListener('mouseleave', endMouse);
    document.addEventListener('mouseup',   endMouse);
  }

  function initAll() {
    document.querySelectorAll('.ctrl-dpad').forEach(initDpad);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(initAll, 80); });
  } else {
    setTimeout(initAll, 80);
  }
})();

// ─── CANVAS CONTAIN-SCALER ───────────────────────────────────────────────────
// Like object-fit:contain for <canvas>: scales to fill the canvas-wrap while
// preserving the game's native aspect ratio. Reruns on every resize.
(function () {
  function fitAll() {
    document.querySelectorAll('.canvas-wrap').forEach(function (wrap) {
      // Use the first canvas that isn't a tiny preview canvas
      var canvas = Array.prototype.find.call(
        wrap.querySelectorAll('canvas'),
        function (c) { return c.width > 60 && c.height > 60; }
      );
      if (!canvas || !canvas.width || !canvas.height) return;

      var availW = wrap.clientWidth;
      var availH = wrap.clientHeight;
      if (!availW || !availH) return;

      var scale  = Math.min(availW / canvas.width, availH / canvas.height);
      var dispW  = Math.round(canvas.width  * scale);
      var dispH  = Math.round(canvas.height * scale);

      canvas.style.width  = dispW + 'px';
      canvas.style.height = dispH + 'px';
    });
  }

  function boot() {
    // Run immediately, then again after a short delay so game scripts that set
    // canvas.width/height dynamically (snake, pacman, frogger…) are ready.
    fitAll();
    setTimeout(fitAll, 120);
    setTimeout(fitAll, 400);
    window.addEventListener('resize', fitAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// ─── CONTROLLER AUTO-SCALER ──────────────────────────────────────────────────
// Measures .ctrl-body's natural size vs the .ctrl-area it lives in and applies
// a uniform CSS scale so it always fits — even on very short screens.
(function () {
  function scaleCtrl() {
    var area = document.querySelector('.ctrl-area');
    var body = document.querySelector('.ctrl-body');
    if (!area || !body) return;

    // Reset so we can measure the natural size
    body.style.transform      = '';
    body.style.transformOrigin = 'center center';

    var aW = area.clientWidth  - 12;   // a little breathing room
    var aH = area.clientHeight - 8;
    var bW = body.scrollWidth;
    var bH = body.scrollHeight;
    if (!bW || !bH) return;

    var scale = Math.min(1, aW / bW, aH / bH);
    if (scale < 1) {
      body.style.transform = 'scale(' + scale.toFixed(3) + ')';
    }
  }

  function boot() {
    scaleCtrl();
    setTimeout(scaleCtrl, 150);
    window.addEventListener('resize', scaleCtrl);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

// ─── TAP-TO-JUMP ─────────────────────────────────────────────────────────────
// A quick tap anywhere on the game canvas fires the current game's jump action.
// The d-pad buttons, ctrl-area, and any overlays are excluded automatically.
(function () {
  function setup() {
    document.querySelectorAll('.canvas-wrap').forEach(function (wrap) {
      if (wrap._tapJumpReady) return;
      wrap._tapJumpReady = true;

      var t0, x0, y0;

      wrap.addEventListener('touchstart', function (e) {
        t0 = Date.now();
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
      }, { passive: true });

      wrap.addEventListener('touchend', function (e) {
        var dt   = Date.now() - t0;
        var dx   = e.changedTouches[0].clientX - x0;
        var dy   = e.changedTouches[0].clientY - y0;
        var dist = Math.sqrt(dx * dx + dy * dy);

        // Short tap (< 220 ms, < 28 px travel) = jump
        if (dt < 220 && dist < 28) {
          if      (typeof window.ctrlJump  === 'function') window.ctrlJump();
          else if (typeof window.ctrlDir   === 'function') window.ctrlDir(0, -1);
          else if (typeof window.ctrlMove  === 'function') window.ctrlMove(0, -1);
        }
      }, { passive: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(setup, 100); });
  } else {
    setTimeout(setup, 100);
  }
})();
