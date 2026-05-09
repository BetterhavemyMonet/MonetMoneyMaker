# Monet Money Arcade

A Web3 Solana arcade with MONET token payment gating. Entry fee is ≈$0.50 USD (dynamically priced in MONET). Three payment methods: MONET tokens, SOL (~$0.25), or credit/debit card via Stripe. Solo play returns 80% to the high-score holder; Head-to-Head and Tournaments use a 90% payout pool. Players can also fund their crypto wallet via the Transak on-ramp widget.

## Token Details
- **MONET Mint:** `6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b`
- **Treasury:** `BmEAUUkKcj7BLNAxTF6wqFx6r25wbX5josw4voMbin9z`

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Build Tool:** Vite (v8+) on port 5000
- **Backend:** Express.js API server on port 3001 (`server.js`)
- **Package Manager:** npm
- **Web3:** `@solana/web3.js@1.98.0` via CDN — Phantom Wallet / Solana integration
- **Font:** Orbitron (Google Fonts)

## Game Roster

Active games (arcade.html displays in this order):
1. **Monet Bros** (`mario.html`) — Super Mario-style platformer; ≈$0.50 entry, 90% of pot as prize on level clear
2. **Pac-Man** (`pacman.html`) — Maze dot-eating
3. **Runner** (`dino.html`) — Endless runner + level creator
4. **Frogger** (`frogger.html`) — Cross traffic/river
5. **Snake** (`snake.html`) — Classic snake
6. **Space Invaders** (`invaders.html`) — Alien wave shooter
7. **Pong** (`pong.html`) — vs CPU paddle game
8. **Level Builder** (links to `dino.html` create tab) — Custom level designer

**Monet Bros** uses the direct pay-gate pattern (`showPayGate` → `/api/cpu/start` → play → `/api/cpu/submit`).  
All other games use `showGameLobby()` (lobby.js) which presents Solo or H2H modes before play.

## Project Structure

```
/
├── index.html          # Main dashboard
├── login.html          # Username entry + wallet connect
├── arcade.html         # Game hub — cleaned roster, H2H badges, ordered cards
├── challenge.html      # Head-to-Head challenge lobby
├── tournament.html     # Tournament lobby
├── exchange.html       # Token exchange
├── portfolio.html      # Portfolio tracker
├── leaderboard.html    # Leaderboard
├── pacman.html         # Pac-Man (lobby + gamepad)
├── frogger.html        # Frogger (lobby + gamepad)
├── snake.html          # Snake (lobby + gamepad)
├── pong.html           # Pong (lobby + gamepad)
├── dino.html           # Runner + Level Builder (lobby + gamepad)
├── mario.html          # Monet Bros — Mario-style platformer (pay-gate, CPU challenge)
├── invaders.html       # Space Invaders (lobby + gamepad)
├── lobby.js            # Shared game lobby: Solo vs H2H, wager picker, challenge flow
├── gamepad.js          # Shared gamepad module: Gamepad API polling, standard action map
├── server.js           # Express API (challenges, tournaments, treasury, claims)
├── wallet.js           # Wallet logic + pay gate overlay + arcadeSubmitScore
├── styles.css          # Global arcade theme styles
├── vite.config.js      # Vite config (port 5000, /api proxy → localhost:3001)
├── data/               # JSON persistence (challenges.json, tournaments.json, claims.json)
└── public/             # Static assets
```

## Running the App

```bash
npm install
npm run dev       # Vite dev server on port 5000
node server.js    # API server on port 3001 (separate workflow)
```

## API Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Treasury balance + server status |
| POST | `/api/challenge/create` | Create H2H challenge (P1 pays) |
| PUT | `/api/challenge/join/:code` | Join challenge (P2 pays) |
| POST | `/api/challenge/submit` | Submit score, resolve winner |
| GET | `/api/challenge/list/:wallet` | List challenges for a wallet |
| POST | `/api/cpu/start` | Start CPU challenge (returns cpuGameId + cpuScore) |
| POST | `/api/cpu/submit` | Submit player score vs CPU, payout if player wins |
| POST | `/api/tournament/create` | Create tournament |
| POST | `/api/tournament/join` | Join tournament + pay |
| POST | `/api/tournament/submit` | Submit score |
| GET | `/api/tournament/list` | All active tournaments |
| GET | `/api/leaderboard/:game` | Top 10 scores for a game |
| GET | `/api/balance/:wallet` | MONET + SOL balance for a wallet (server-side RPC proxy — bypasses browser 403s) |
| GET | `/api/blockhash` | Latest Solana blockhash (used by payEntryFee when browser RPCs fail) |
| GET | `/api/account-exists/:address` | Check if a Solana account exists on-chain |
| POST | `/api/create-token-account` | Treasury creates player MONET ATA if missing (treasury pays ~0.002 SOL rent) |

## Solana RPC Strategy

All balance/account queries are routed through the server (`/api/balance/:wallet`) to avoid browser CORS rate-limit 403s on public Solana RPC endpoints. `payEntryFee` falls back to `/api/blockhash` and `/api/account-exists` when direct browser RPC calls fail. The wallet extension's own RPC handles transaction broadcast/signing.

Set `SOLANA_RPC_URL` environment variable to use a private RPC (e.g. Helius) as the primary endpoint — highly recommended for production.

## Treasury Payouts

Payouts are **QUEUED** by default. Set `TREASURY_PRIVATE_KEY` environment variable (JSON array of 64 bytes) to enable live on-chain payouts from the treasury keypair. Without it, claims queue in `data/claims.json`.

## Payment Methods

| Method | How it works |
|--------|-------------|
| MONET tokens | Pay directly from connected Phantom/Solflare/Backpack wallet |
| SOL | Pay ~$0.25 in SOL from connected wallet |
| Credit/Debit Card | Pay $0.50 USD via Stripe — no crypto wallet needed (requires `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`) |
| Fund Wallet (Transak) | Buy SOL with card via Transak on-ramp widget, then play with MONET/SOL |

## Prize Structure

| Mode | Entry | Player Payout | House Rake |
|------|-------|--------------|------------|
| Solo | ≈$0.50 (dynamic MONET) | 80% back | 20% |
| CPU Challenge | ≈$0.50 | 80–180% back depending on difficulty | varies |
| H2H Challenge | ≈$0.50 each | 90% of combined pot to winner | 10% |
| Tournament | ≈$0.50 each | 50%/30%/20% top 3 | 10% |

## Deployment

- Build command: `npm run build`
- Public directory: `dist`
- Requires API server (`node server.js`) running alongside for challenge/tournament features
