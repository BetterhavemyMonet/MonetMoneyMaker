function connectWallet() {
  if (!window.solana) {
    alert("Install Phantom Wallet");
    return;
  }

  window.solana.connect()
    .then(res => {
      alert("Connected: " + res.publicKey.toString());
    })
    .catch(() => {
      alert("Connection failed");
    });
}

function goToExchange() {
  const url = "https://jup.ag/swap/So11111111111111111111111111111111111111112-6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b";
  window.open(url, "_blank");
}

window.connectWallet = connectWallet;
window.goToExchange = goToExchange;
