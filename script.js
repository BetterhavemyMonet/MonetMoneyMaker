async function connectWallet() {
  if (!window.solana) {
    alert("Phantom wallet not found");
    return;
  }
  try {
    const resp = await window.solana.connect();
    alert("Connected: " + resp.publicKey.toString());
  } catch {
    alert("Connection failed");
  }
}

function goToExchange() {
  const SOL = "So11111111111111111111111111111111111111112";
  const MONET = "6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b";
  window.open(`https://jup.ag/swap/${SOL}-${MONET}`, "_blank");
}

function goToArcade() {
  alert("Arcade coming next 🎮");
}

window.connectWallet = connectWallet;
window.goToExchange = goToExchange;
window.goToArcade = goToArcade;
