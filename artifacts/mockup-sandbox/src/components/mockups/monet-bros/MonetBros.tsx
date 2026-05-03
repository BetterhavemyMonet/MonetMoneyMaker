import { useEffect, useState, useRef } from "react";

const TILE = 40;

export function MonetBros() {
  const [playerX, setPlayerX] = useState(120);
  const [playerY, setPlayerY] = useState(0);
  const [velY, setVelY] = useState(0);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [running, setRunning] = useState(false);
  const [frame, setFrame] = useState(0);
  const [coins, setCoins] = useState([
    { id: 0, x: 260, y: 280, collected: false },
    { id: 1, x: 380, y: 200, collected: false },
    { id: 2, x: 500, y: 280, collected: false },
    { id: 3, x: 620, y: 160, collected: false },
    { id: 4, x: 760, y: 280, collected: false },
    { id: 5, x: 880, y: 200, collected: false },
    { id: 6, x: 1000, y: 280, collected: false },
  ]);
  const [score, setScore] = useState(0);
  const [monetEarned, setMonetEarned] = useState(0);
  const [lives, setLives] = useState(3);
  const [goombas, setGoombas] = useState([
    { id: 0, x: 350, dir: 1, dead: false },
    { id: 1, x: 650, dir: -1, dead: false },
    { id: 2, x: 900, dir: 1, dead: false },
  ]);
  const [showPayGate, setShowPayGate] = useState(true);
  const [animTick, setAnimTick] = useState(0);

  const keysRef = useRef<Set<string>>(new Set());
  const stateRef = useRef({ playerX, playerY, velY, running });

  useEffect(() => {
    stateRef.current = { playerX, playerY, velY, running };
  });

  // Ground Y = canvas height - 1 tile - 1 tile(ground thickness) = 480 - 40 = 440... let's use 380 as ground
  const GROUND_Y = 380;

  const platforms = [
    { x: 240, y: 300, w: 3 }, // 3 tiles wide
    { x: 480, y: 220, w: 2 },
    { x: 680, y: 180, w: 3 },
    { x: 920, y: 260, w: 2 },
    { x: 1080, y: 200, w: 3 },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.type === "keydown") keysRef.current.add(e.key);
      else keysRef.current.delete(e.key);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  useEffect(() => {
    if (showPayGate) return;
    let tickCount = 0;
    const loop = setInterval(() => {
      tickCount++;
      if (tickCount % 8 === 0) setFrame(f => (f + 1) % 4);
      setAnimTick(t => t + 1);

      setPlayerX(px => {
        let nx = px;
        const keys = keysRef.current;
        const speed = 4;
        if (keys.has("ArrowLeft") || keys.has("a")) { nx -= speed; setFacing("left"); setRunning(true); }
        else if (keys.has("ArrowRight") || keys.has("d")) { nx += speed; setFacing("right"); setRunning(true); }
        else { setRunning(false); }
        return Math.max(10, Math.min(1200, nx));
      });

      setVelY(vy => {
        const keys = keysRef.current;
        let nvy = vy + 0.5; // gravity
        setPlayerY(py => {
          // check platform landing
          let onPlatform = false;
          let platformTop = GROUND_Y;
          for (const p of platforms) {
            const px2 = stateRef.current.playerX;
            if (px2 >= p.x - 10 && px2 <= p.x + p.w * TILE + 10) {
              if (py + nvy >= p.y - TILE && py < p.y - TILE + 5) {
                platformTop = p.y - TILE;
                onPlatform = true;
                break;
              }
            }
          }
          if (py + nvy >= GROUND_Y) {
            nvy = 0;
            if ((keys.has("ArrowUp") || keys.has("w") || keys.has(" ")) && py >= GROUND_Y - 2) {
              nvy = -12;
            }
            return GROUND_Y;
          }
          if (onPlatform && py + nvy >= platformTop) {
            nvy = 0;
            if ((keys.has("ArrowUp") || keys.has("w") || keys.has(" "))) {
              nvy = -12;
            }
            return platformTop;
          }
          return py + nvy;
        });
        return nvy;
      });

      // coin collection
      setCoins(cs => cs.map(c => {
        if (c.collected) return c;
        const px = stateRef.current.playerX;
        const py = stateRef.current.playerY;
        if (Math.abs(px - c.x) < 30 && Math.abs(py - c.y) < 30) {
          setScore(s => s + 100);
          setMonetEarned(m => Math.round((m + 0.5) * 10) / 10);
          return { ...c, collected: true };
        }
        return c;
      }));

      // goomba movement
      setGoombas(gs => gs.map(g => {
        if (g.dead) return g;
        const nx = g.x + g.dir * 1.5;
        const newDir = nx < 200 || nx > 1100 ? -g.dir : g.dir;
        // stomp check
        const px = stateRef.current.playerX;
        const py = stateRef.current.playerY;
        const vy = stateRef.current.velY;
        if (Math.abs(px - g.x) < 30 && Math.abs(py - GROUND_Y + 20) < 30 && vy > 2) {
          setScore(s => s + 200);
          return { ...g, dead: true };
        }
        return { ...g, x: nx, dir: newDir };
      }));
    }, 16);
    return () => clearInterval(loop);
  }, [showPayGate]);

  const clouds = [
    { x: 80, y: 60, s: 1 }, { x: 300, y: 40, s: 0.8 }, { x: 600, y: 70, s: 1.2 },
    { x: 850, y: 45, s: 0.9 }, { x: 1100, y: 65, s: 1.1 },
  ];

  return (
    <div style={{
      width: "100vw", height: "100vh", overflow: "hidden",
      fontFamily: "'Press Start 2P', monospace", background: "#000",
      display: "flex", flexDirection: "column"
    }}>
      {/* Google font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" />

      {/* HUD */}
      <div style={{
        background: "#1a1a2e",
        borderBottom: "3px solid #ffd700",
        padding: "8px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        color: "#fff", fontSize: "11px", flexShrink: 0
      }}>
        <div style={{ display: "flex", gap: 24 }}>
          <span style={{ color: "#ffd700" }}>MONET BROS</span>
          <span>SCORE <span style={{ color: "#ffd700" }}>{score.toString().padStart(6, "0")}</span></span>
          <span>COINS <span style={{ color: "#ffd700" }}>{coins.filter(c => c.collected).length}/{coins.length}</span></span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <span>LEVEL <span style={{ color: "#4ade80" }}>1-1</span></span>
          <span>
            {Array.from({ length: lives }).map((_, i) => (
              <span key={i} style={{ marginLeft: 2 }}>❤️</span>
            ))}
          </span>
          <span style={{
            background: "#7c3aed", padding: "3px 10px", borderRadius: 4,
            border: "2px solid #a855f7", color: "#e9d5ff"
          }}>
            💰 {monetEarned.toFixed(1)} MONET
          </span>
        </div>
      </div>

      {/* Game canvas */}
      <div style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: "linear-gradient(180deg, #5c94fc 0%, #87ceeb 60%, #87ceeb 100%)"
      }}>

        {/* Clouds */}
        {clouds.map((c, i) => (
          <Cloud key={i} x={c.x + (animTick * 0.2 * c.s) % 1280} y={c.y} scale={c.s} />
        ))}

        {/* Mountains / hills */}
        <svg style={{ position: "absolute", bottom: TILE * 2, width: "100%", height: 180 }} viewBox="0 0 1280 180" preserveAspectRatio="none">
          <ellipse cx="150" cy="180" rx="200" ry="120" fill="#5a8f3c" opacity="0.6" />
          <ellipse cx="450" cy="180" rx="180" ry="100" fill="#4a7f2c" opacity="0.7" />
          <ellipse cx="800" cy="180" rx="220" ry="130" fill="#5a8f3c" opacity="0.6" />
          <ellipse cx="1100" cy="180" rx="190" ry="110" fill="#4a7f2c" opacity="0.65" />
        </svg>

        {/* Ground */}
        <Ground y={GROUND_Y} width={1280} />

        {/* Platforms */}
        {platforms.map((p, i) => (
          <Platform key={i} x={p.x} y={p.y} tiles={p.w} />
        ))}

        {/* Question blocks */}
        <QuestionBlock x={340} y={220} animTick={animTick} />
        <QuestionBlock x={580} y={140} animTick={animTick} />
        <QuestionBlock x={780} y={100} animTick={animTick} />

        {/* Pipes */}
        <Pipe x={160} height={80} groundY={GROUND_Y} />
        <Pipe x={1060} height={100} groundY={GROUND_Y} />

        {/* Coins */}
        {coins.map(c => !c.collected && (
          <Coin key={c.id} x={c.x} y={c.y} animTick={animTick} />
        ))}

        {/* Goombas */}
        {goombas.map(g => (
          <Goomba key={g.id} x={g.x} y={GROUND_Y} dead={g.dead} animTick={animTick} />
        ))}

        {/* Player */}
        <Player x={playerX} y={playerY} facing={facing} running={running} frame={frame} groundY={GROUND_Y} />

        {/* Score popups */}
        {coins.filter(c => c.collected).map(c => (
          <div key={c.id} style={{
            position: "absolute",
            left: c.x - 15, top: c.y - 30,
            color: "#ffd700", fontSize: "10px",
            animation: "floatUp 1s ease-out forwards",
            pointerEvents: "none"
          }}>+100</div>
        ))}

        {/* Pay gate overlay */}
        {showPayGate && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 50
          }}>
            <div style={{
              background: "#1a1a2e",
              border: "4px solid #ffd700",
              borderRadius: 8,
              padding: "32px 40px",
              textAlign: "center",
              color: "#fff",
              maxWidth: 420,
              boxShadow: "0 0 40px rgba(255,215,0,0.3)"
            }}>
              <div style={{ fontSize: "28px", marginBottom: 12 }}>🍄</div>
              <div style={{ color: "#ffd700", fontSize: "16px", marginBottom: 8 }}>MONET BROS</div>
              <div style={{ fontSize: "9px", color: "#a0a0a0", marginBottom: 20, lineHeight: "1.8" }}>
                WORLD 1-1
              </div>
              <div style={{ color: "#e0e0e0", fontSize: "10px", marginBottom: 6 }}>
                Entry Fee
              </div>
              <div style={{
                color: "#ffd700", fontSize: "22px", marginBottom: 20,
                textShadow: "0 0 10px rgba(255,215,0,0.5)"
              }}>
                5 MONET
              </div>
              <div style={{ fontSize: "8px", color: "#a0a0c0", marginBottom: 24, lineHeight: 2 }}>
                Complete levels to earn MONET rewards<br />
                Collect coins · Stomp enemies · Find the flag
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  onClick={() => setShowPayGate(false)}
                  style={{
                    background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                    border: "2px solid #c084fc",
                    color: "#fff", fontSize: "10px",
                    padding: "10px 20px", borderRadius: 4,
                    cursor: "pointer", letterSpacing: 1
                  }}
                >
                  PAY &amp; PLAY
                </button>
                <button
                  style={{
                    background: "transparent",
                    border: "2px solid #555",
                    color: "#888", fontSize: "10px",
                    padding: "10px 20px", borderRadius: 4,
                    cursor: "pointer"
                  }}
                >
                  BACK
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Controls hint */}
        {!showPayGate && (
          <div style={{
            position: "absolute", bottom: TILE * 2 + 8, right: 16,
            color: "rgba(255,255,255,0.5)", fontSize: "8px", textAlign: "right"
          }}>
            ← → move &nbsp; ↑ / SPACE jump
          </div>
        )}
      </div>

      <style>{`
        @keyframes floatUp {
          0% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-40px); }
        }
        @keyframes coinSpin {
          0%,100% { transform: scaleX(1); }
          50% { transform: scaleX(0.1); }
        }
        @keyframes qBounce {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}

function Cloud({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <div style={{
      position: "absolute", left: x % 1280, top: y,
      transform: `scale(${scale})`, transformOrigin: "top left",
      pointerEvents: "none"
    }}>
      <div style={{ position: "relative", width: 120, height: 50 }}>
        <div style={{ position: "absolute", bottom: 0, left: 20, width: 80, height: 30, background: "#fff", borderRadius: 20 }} />
        <div style={{ position: "absolute", bottom: 14, left: 30, width: 60, height: 40, background: "#fff", borderRadius: 30 }} />
        <div style={{ position: "absolute", bottom: 14, left: 10, width: 40, height: 30, background: "#fff", borderRadius: 20 }} />
        <div style={{ position: "absolute", bottom: 14, left: 70, width: 35, height: 28, background: "#fff", borderRadius: 20 }} />
      </div>
    </div>
  );
}

function Ground({ y, width }: { y: number; width: number }) {
  const tiles = Math.ceil(width / TILE) + 1;
  return (
    <>
      {/* top row: grass */}
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={`g${i}`} style={{
          position: "absolute", left: i * TILE, top: y,
          width: TILE, height: TILE,
          background: "linear-gradient(180deg, #4a9e2f 0%, #3a8020 40%, #8B5E3C 40%, #7a4f30 100%)",
          borderTop: "3px solid #5cb847",
          boxSizing: "border-box"
        }} />
      ))}
      {/* bottom rows: dirt */}
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={`d${i}`} style={{
          position: "absolute", left: i * TILE, top: y + TILE,
          width: TILE, height: TILE * 3,
          background: "#8B5E3C",
          borderRight: "1px solid #7a4f30"
        }} />
      ))}
    </>
  );
}

function Platform({ x, y, tiles }: { x: number; y: number; tiles: number }) {
  return (
    <>
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} style={{
          position: "absolute", left: x + i * TILE, top: y,
          width: TILE, height: TILE,
          background: "linear-gradient(180deg, #e8b84b 0%, #d4982a 100%)",
          border: "3px solid #b87820",
          boxSizing: "border-box",
          boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.3)"
        }}>
          <div style={{ position: "absolute", top: 6, left: 6, width: TILE - 16, height: TILE - 16, border: "2px solid rgba(255,255,255,0.2)", borderRadius: 2 }} />
        </div>
      ))}
    </>
  );
}

function QuestionBlock({ x, y, animTick }: { x: number; y: number; animTick: number }) {
  const bounce = Math.sin(animTick * 0.1) * 3;
  return (
    <div style={{
      position: "absolute", left: x, top: y + bounce,
      width: TILE, height: TILE,
      background: "linear-gradient(135deg, #f5a623, #e8901a)",
      border: "3px solid #8B5E3C",
      boxSizing: "border-box",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#8B5E3C", fontFamily: "'Press Start 2P', monospace",
      fontSize: "18px", fontWeight: "bold",
      boxShadow: "inset -2px -2px 0 rgba(0,0,0,0.3), inset 2px 2px 0 rgba(255,255,255,0.3)"
    }}>
      ?
    </div>
  );
}

function Pipe({ x, height, groundY }: { x: number; height: number; groundY: number }) {
  const pipeW = TILE * 1.5;
  const capH = 20;
  return (
    <>
      {/* Cap */}
      <div style={{
        position: "absolute", left: x - 5, top: groundY - height - capH,
        width: pipeW + 10, height: capH,
        background: "linear-gradient(180deg, #5cb847 0%, #3a8020 100%)",
        border: "3px solid #2a6010",
        boxSizing: "border-box"
      }} />
      {/* Body */}
      <div style={{
        position: "absolute", left: x, top: groundY - height,
        width: pipeW, height: height,
        background: "linear-gradient(90deg, #5cb847 0%, #3a8020 50%, #2a6010 100%)",
        border: "3px solid #2a6010",
        boxSizing: "border-box"
      }} />
    </>
  );
}

function Coin({ x, y, animTick }: { x: number; y: number; animTick: number }) {
  const spinPhase = (animTick * 5) % 360;
  const scaleX = Math.abs(Math.cos((spinPhase * Math.PI) / 180));
  const bob = Math.sin(animTick * 0.08) * 5;
  return (
    <div style={{
      position: "absolute", left: x - 12, top: y - 12 + bob,
      width: 24, height: 24,
      borderRadius: "50%",
      background: "radial-gradient(circle at 35% 35%, #fff9c4, #ffd700 40%, #b8860b)",
      border: "2px solid #b8860b",
      transform: `scaleX(${Math.max(0.1, scaleX)})`,
      boxShadow: "0 0 6px rgba(255,215,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "10px"
    }}>
      <span style={{ transform: `scaleX(${1 / Math.max(0.1, scaleX)})`, display: "block" }}>𝕄</span>
    </div>
  );
}

function Goomba({ x, y, dead, animTick }: { x: number; y: number; dead: boolean; animTick: number }) {
  const walk = animTick % 20 < 10;
  if (dead) {
    return (
      <div style={{
        position: "absolute", left: x - 16, top: y - 10,
        width: 32, height: 10,
        background: "#8B4513",
        borderRadius: "50%",
        opacity: 0.6
      }} />
    );
  }
  return (
    <div style={{ position: "absolute", left: x - 16, top: y - 36 }}>
      {/* body */}
      <div style={{
        width: 32, height: 28,
        background: "#8B4513",
        borderRadius: "40% 40% 20% 20%",
        position: "relative",
        border: "2px solid #5a2d0c"
      }}>
        {/* eyes */}
        <div style={{ position: "absolute", top: 6, left: 4, width: 8, height: 8, background: "#fff", borderRadius: "50%", border: "1px solid #333" }}>
          <div style={{ position: "absolute", top: 2, left: 2, width: 4, height: 4, background: "#111", borderRadius: "50%" }} />
        </div>
        <div style={{ position: "absolute", top: 6, right: 4, width: 8, height: 8, background: "#fff", borderRadius: "50%", border: "1px solid #333" }}>
          <div style={{ position: "absolute", top: 2, right: 2, width: 4, height: 4, background: "#111", borderRadius: "50%" }} />
        </div>
        {/* eyebrows angry */}
        <div style={{ position: "absolute", top: 3, left: 2, width: 10, height: 2, background: "#333", transform: "rotate(20deg)", borderRadius: 2 }} />
        <div style={{ position: "absolute", top: 3, right: 2, width: 10, height: 2, background: "#333", transform: "rotate(-20deg)", borderRadius: 2 }} />
        {/* mouth */}
        <div style={{ position: "absolute", bottom: 4, left: 8, right: 8, height: 3, background: "#333", borderRadius: 2 }} />
      </div>
      {/* feet */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 0 }}>
        <div style={{
          width: 14, height: 8,
          background: "#5a2d0c",
          borderRadius: "0 0 6px 6px",
          transform: walk ? "rotate(-8deg)" : "rotate(8deg)",
          transformOrigin: "top center"
        }} />
        <div style={{
          width: 14, height: 8,
          background: "#5a2d0c",
          borderRadius: "0 0 6px 6px",
          transform: walk ? "rotate(8deg)" : "rotate(-8deg)",
          transformOrigin: "top center"
        }} />
      </div>
    </div>
  );
}

function Player({ x, y, facing, running, frame, groundY }: {
  x: number; y: number; facing: "left" | "right";
  running: boolean; frame: number; groundY: number;
}) {
  const airborne = y < groundY - 2;
  const legPhase = frame % 2 === 0;

  return (
    <div style={{
      position: "absolute",
      left: x - 16,
      top: y - 48,
      transform: facing === "left" ? "scaleX(-1)" : "scaleX(1)",
      width: 32
    }}>
      {/* hat */}
      <div style={{ width: 28, height: 10, background: "#e03c2d", marginLeft: 2, borderRadius: "4px 4px 0 0", border: "1px solid #a02010" }} />
      {/* face */}
      <div style={{ width: 32, height: 16, background: "#f5cba7", border: "1px solid #d4a574", position: "relative" }}>
        {/* eye */}
        <div style={{ position: "absolute", top: 4, left: 20, width: 4, height: 4, background: "#111", borderRadius: "50%" }} />
        {/* mustache */}
        <div style={{ position: "absolute", bottom: 3, left: 6, width: 20, height: 4, background: "#5a3200", borderRadius: 3 }} />
        {/* nose */}
        <div style={{ position: "absolute", top: 5, left: 14, width: 7, height: 5, background: "#e8956d", borderRadius: "50%" }} />
      </div>
      {/* body (overalls) */}
      <div style={{ width: 32, height: 14, background: "#3b5bdb", border: "1px solid #2142b8", position: "relative" }}>
        {/* overall straps */}
        <div style={{ position: "absolute", top: 0, left: 4, width: 6, height: 14, background: "#e03c2d" }} />
        <div style={{ position: "absolute", top: 0, right: 4, width: 6, height: 14, background: "#e03c2d" }} />
      </div>
      {/* legs */}
      <div style={{ display: "flex", gap: 2 }}>
        <div style={{
          width: 14, height: 8,
          background: "#3b5bdb",
          transform: airborne ? "rotate(-10deg)" : (running && legPhase ? "rotate(-15deg)" : "rotate(5deg)"),
          transformOrigin: "top center",
          transition: "transform 0.08s"
        }} />
        <div style={{
          width: 14, height: 8,
          background: "#3b5bdb",
          transform: airborne ? "rotate(10deg)" : (running && legPhase ? "rotate(5deg)" : "rotate(-15deg)"),
          transformOrigin: "top center",
          transition: "transform 0.08s"
        }} />
      </div>
      {/* shoes */}
      <div style={{ display: "flex", gap: 2, marginTop: 0 }}>
        <div style={{ width: 16, height: 6, background: "#5a3200", borderRadius: "0 4px 4px 4px" }} />
        <div style={{ width: 16, height: 6, background: "#5a3200", borderRadius: "4px 0 4px 4px" }} />
      </div>
    </div>
  );
}
