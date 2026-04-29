# Monet Money Arcade

A Web3-integrated browser arcade with a cyberpunk neon aesthetic. Players log in with a username, optionally connect a Phantom Wallet (Solana), and play a collection of simple mini-games. Scores are tracked via `localStorage` and displayed on a leaderboard.

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Build Tool:** Vite (v8+)
- **Package Manager:** npm
- **Web3:** `@solana/web3.js` — Phantom Wallet / Solana integration
- **Font:** Orbitron (Google Fonts)

## Project Structure

```
/
├── index.html          # Main dashboard (requires login)
├── login.html          # Username entry + wallet connect
├── arcade.html         # Game hub
├── game1.html          # Game 1 (has backend payout integration at localhost:3001)
├── game2.html          # Game 2
├── game3.html          # Game 3
├── dodger.html         # Dodger mini-game
├── tap.html            # Tap mini-game
├── reaction.html       # Reaction mini-game
├── leaderboard.html    # Top scores from localStorage
├── script.js           # Global wallet/exchange utilities
├── styles.css          # Global arcade theme styles
├── vite.config.js      # Vite config (port 5000, host 0.0.0.0)
├── src/                # Vite boilerplate entry (not primary app)
└── public/             # Static assets (images, icons)
```

## Running the App

```bash
npm install
npm run dev   # starts Vite dev server on port 5000
```

## Deployment

Configured as a **static** deployment:
- Build command: `npm run build`
- Public directory: `dist`

## Notes

- Session management uses `localStorage` (`player_name`, `monet_balance`)
- Wallet connection uses `window.solana` (Phantom browser extension)
- `game1.html` references a backend at `localhost:3001` for payout logic (not included in this repo)
- Jupiter swap link targets the `$MONET` token on Solana
