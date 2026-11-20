const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

// Serve static assets (index.html, style.css, script.js, img/) from the project root
app.use(express.static(__dirname));

// Fallback to index.html for root or unmatched GET routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`L'Oréal Beauty Assistant listening on http://${HOST}:${PORT}`);
});
