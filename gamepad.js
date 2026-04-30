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
