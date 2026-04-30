# Monet Money Arcade

A Web3 Solana arcade with MONET token payment gating. Players pay 5 MONET to enter each game. Solo play returns 80% to the high-score holder, while Head-to-Head challenges and Tournaments use a 90% payout pool.

## Token Details
- **MONET Mint:** `6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b`
- **Treasury:** `ot1CyXFDUdTpSp3reSdgCPfLvivHfcSmi5c6yjnnRxs`

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Build Tool:** Vite (v8+) on port 5000
- **Backend:** Express.js API server on port 3001 (`server.js`)
- **Package Manager:** npm
- **Web3:** `@solana/web3.js@1.98.0` via CDN — Phantom Wallet / Solana integration
- **Font:** Orbitron (Google Fonts)

## Project Structure

```
/
├── index.html          # Main dashboard
├── login.html          # Username entry + wallet connect
├── arcade.html         # Game hub with pot banner + compete section
├── challenge.html      # Head-to-Head challenge lobby
├── tournament.html     # Tournament lobby
├── exchange.html       # Token exchange
├── portfolio.html      # Portfolio tracker
├── scores.html         # Leaderboard
├── frogger.html        # Frogger game (pay-gated)
├── snake.html          # Snake game (pay-gated)
├── pong.html           # Pong game (pay-gated)
├── pacman.html         # Pac-Man game (pay-gated)
├── dino.html           # Dino Runner game (pay-gated)
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

## Treasury Payouts

Payouts are **QUEUED** by default. Set `TREASURY_PRIVATE_KEY` environment variable (JSON array of 64 bytes) to enable live on-chain payouts from the treasury keypair. Without it, claims queue in `data/claims.json`.

## Prize Structure

| Mode | Entry | Player Payout | House Rake |
|------|-------|--------------|------------|
| Solo | 5 MONET | 4 MONET (80%) | 20% |
| CPU Challenge | 5 MONET | 4.5 MONET if you beat CPU | 10% |
| H2H Challenge | 5 MONET each | 9 MONET to winner | 10% |
| Tournament | 5 MONET each | 50%/30%/10% top 3 | 10% |

## Deployment

- Build command: `npm run build`
- Public directory: `dist`
- Requires API server (`node server.js`) running alongside for challenge/tournament features
