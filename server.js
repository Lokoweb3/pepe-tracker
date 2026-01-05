// server.js — UPDATED (CommonJS)
// ✅ Binds port first, prints actual bound address
// ✅ Handles listen errors (EADDRINUSE, permission, etc)
// ✅ Runs init in background (does not block server)
// ✅ /api/pool proxy
// ✅ SSE history + trade events + keepalive
// ✅ Paginated signatures (max 1000 per call)
// ✅ Optional retry/backoff for 429s when fetching parsed txs

const fetch = require("node-fetch"); // you already have this installed/used
const express = require("express");
const { Connection, PublicKey } = require("@solana/web3.js");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// =============================================================================
// CONFIG
// =============================================================================

const X1_RPC = "https://rpc.mainnet.x1.xyz";

const POOL_ID = "VmZfZnHzFTKSf19ZvAxa4duzChve3JYHVCPq1FvezhN";
const POOL_ADDRESS = new PublicKey(POOL_ID);

const XNT_MINT = "So11111111111111111111111111111111111111112";
const PEPE_MINT = "81LkybSBLvXYMTF6azXohUWyBvDGUXznm4yiXPkYkDTJ";

const POOL_API_URL = `https://api.xdex.xyz/api/xendex/pool/${POOL_ID}`;

const PORT = Number(process.env.PORT) || 3000;

// ✅ IMPORTANT: reduce default history to avoid 429 storms
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 1000;

// =============================================================================
// STATE
// =============================================================================

const connection = new Connection(X1_RPC, "confirmed");
let clients = [];
let tradeHistory = [];
let tradeIdCounter = 1;

// =============================================================================
// TOKEN-2022 HOLDER COUNT (cached)
// =============================================================================

const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Cache in memory to avoid hammering RPC
let holdersCache = {
  mint: null,
  holders: 0,
  totalTokenAccounts: 0,
  zeroBalanceAccounts: 0,
  updatedAt: 0
};
const HOLDERS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function readU64LE(buf) {
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    n |= BigInt(buf[i]) << (8n * BigInt(i));
  }
  return n;
}

async function getToken2022HoldersCached(mintStr) {
  const now = Date.now();
  if (
    holdersCache.mint === mintStr &&
    (now - holdersCache.updatedAt) < HOLDERS_CACHE_TTL_MS
  ) {
    return holdersCache;
  }

  const mintPk = new PublicKey(mintStr);

  // Sanity: mint must exist
  const mintInfo = await connection.getAccountInfo(mintPk, "confirmed");
  if (!mintInfo) {
    throw new Error("Mint account not found on this RPC/network.");
  }

  const AMOUNT_OFFSET = 64; // u64
  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: mintPk.toBase58() } }],
    dataSlice: { offset: AMOUNT_OFFSET, length: 8 },
  });

  let holders = 0;
  let zero = 0;

  for (const acc of accounts) {
    const amt = readU64LE(acc.account.data);
    if (amt > 0n) holders++;
    else zero++;
  }

  holdersCache = {
    mint: mintStr,
    holders,
    totalTokenAccounts: accounts.length,
    zeroBalanceAccounts: zero,
    updatedAt: now
  };

  return holdersCache;
}

// =============================================================================
// UTIL
// =============================================================================

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { retries = 6, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const is429 = msg.includes("429") || msg.includes("Too Many Requests");
      if (!is429 || attempt >= retries) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(`Server responded with 429 Too Many Requests. Retrying after ${delay}ms delay...`);
      await sleep(delay);
      attempt++;
    }
  }
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// =============================================================================
// LOG HEADER
// =============================================================================

console.log("\n🚀 Starting PEPE/XNT Trade Tracker...");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("📍 Pool:", POOL_ADDRESS.toBase58());
console.log("🔗 RPC:", X1_RPC);
console.log("💎 XNT:", XNT_MINT);
console.log("🐸 PEPE:", PEPE_MINT);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// =============================================================================
// ROUTES
// =============================================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "lp-dashboard.html"));
});

app.get("/api", (req, res) => {
  res.json({
    status: "running",
    pool: POOL_ADDRESS.toBase58(),
    rpc: X1_RPC,
    tradesLoaded: tradeHistory.length,
    connectedClients: clients.length,
    historyLimit: HISTORY_LIMIT,
  });
});

app.get("/api/pool", async (req, res) => {
  try {
    const r = await fetch(POOL_API_URL, { headers: { accept: "application/json" } });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

app.get("/api/holders", async (req, res) => {
  try {
    const mint = String(req.query.mint || PEPE_MINT);
    const data = await getToken2022HoldersCached(mint);
    res.json({
      success: true,
      mint,
      holders: data.holders,
      totalTokenAccounts: data.totalTokenAccounts,
      zeroBalanceAccounts: data.zeroBalanceAccounts,
      cached: (Date.now() - data.updatedAt) < HOLDERS_CACHE_TTL_MS,
      updatedAt: data.updatedAt
    });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e?.message || e) });
  }
});


app.get("/api/trades-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();

  console.log("📱 Client connected. Total:", clients.length + 1);

  // Send history immediately (so UI populates instantly)
  sseWrite(res, "history", tradeHistory.slice(0, 2000));

  clients.push(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (_) {}
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients = clients.filter((c) => c !== res);
    console.log("📱 Client disconnected. Remaining:", clients.length);
  });
});

// =============================================================================
// SSE BROADCAST
// =============================================================================

function broadcastTrade(trade) {
  const time = new Date(trade.timestamp).toLocaleTimeString();
  console.log(
    `📢 ${trade.trade_type.toUpperCase()} | ${trade.token_amount.toFixed(0)} PEPE for ${trade.native_amount.toFixed(4)} XNT | ${time} | 👤 ${trade.trader_prefix}`
  );

  tradeHistory.unshift(trade);
  if (tradeHistory.length > 8000) tradeHistory = tradeHistory.slice(0, 8000);

  clients.forEach((client) => {
    try {
      sseWrite(client, "trade", trade);
    } catch (_) {}
  });
}

// =============================================================================
// PARSE SWAP
// =============================================================================

function parseSwapFromTransaction(tx) {
  try {
    if (!tx || !tx.meta) return null;

    // 1) Identify trader (fee payer / first account key)
    let traderAddress = "Unknown";
    try {
      const accountKeys = tx.transaction.message.accountKeys;
      const firstKey = accountKeys?.[0];
      if (typeof firstKey === "string") traderAddress = firstKey;
      else if (firstKey?.pubkey) traderAddress = firstKey.pubkey.toString();
      else if (firstKey?.toBase58) traderAddress = firstKey.toBase58();
      else traderAddress = String(firstKey);
    } catch (_) {}

    const preToken = tx.meta.preTokenBalances || [];
    const postToken = tx.meta.postTokenBalances || [];

    const postByIndex = new Map();
    for (const p of postToken) postByIndex.set(p.accountIndex, p);

    // 2) Trader-owned SPL deltas
    let pepeChange = 0;
    let xntTokenChange = 0; // if swap used wrapped/native token mint

    for (const pre of preToken) {
      const post = postByIndex.get(pre.accountIndex);
      if (!post) continue;

      const owner = pre.owner || post.owner;
      if (!owner || owner !== traderAddress) continue;

      const preAmt = pre.uiTokenAmount?.uiAmount ?? 0;
      const postAmt = post.uiTokenAmount?.uiAmount ?? 0;
      const change = postAmt - preAmt;

      if (pre.mint === PEPE_MINT) pepeChange += change;

      // If your chain uses wrapped native mint, this might work.
      // But on native swaps, you'll get 0 here and we’ll fallback below.
      if (pre.mint === XNT_MINT) xntTokenChange += change;
    }

    // If we didn't even see PEPE change for trader, skip
    if (pepeChange === 0) return null;

    // 3) Native XNT (lamports) fallback
    // On Solana-like chains: preBalances/postBalances are lamports for each message account key
    let xntNativeChange = 0;
    try {
      const keys = tx.transaction.message.accountKeys;
      const preLamports = tx.meta.preBalances || [];
      const postLamports = tx.meta.postBalances || [];

      // Find trader index in account keys
      let traderIndex = -1;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const addr =
          typeof k === "string"
            ? k
            : k?.pubkey
              ? k.pubkey.toString()
              : k?.toBase58
                ? k.toBase58()
                : String(k);

        if (addr === traderAddress) {
          traderIndex = i;
          break;
        }
      }

      if (traderIndex >= 0 && preLamports[traderIndex] != null && postLamports[traderIndex] != null) {
        const deltaLamports = postLamports[traderIndex] - preLamports[traderIndex];
        // Convert lamports -> XNT (assumes 9 decimals like SOL)
        xntNativeChange = deltaLamports / 1e9;
      }
    } catch (_) {}

    // 4) Choose best XNT delta:
    // Prefer SPL token delta if present; otherwise use native lamport delta
    let xntChange = xntTokenChange;
    if (xntChange === 0) xntChange = xntNativeChange;

    // If STILL zero, we can’t price it
    if (xntChange === 0) return null;

    // 5) Determine trade type
// ----------------------------------
// LP ADD   : PEPE ↓ AND XNT ↓
// LP REMOVE: PEPE ↑ AND XNT ↑
// BUY      : PEPE ↑ AND XNT ↓
// SELL     : PEPE ↓ AND XNT ↑

let tradeType = null;

if (pepeChange < 0 && xntChange < 0) {
  tradeType = "lp_add";
} else if (pepeChange > 0 && xntChange > 0) {
  tradeType = "lp_remove";
} else if (pepeChange > 0 && xntChange < 0) {
  tradeType = "buy";
} else if (pepeChange < 0 && xntChange > 0) {
  tradeType = "sell";
} else {
  return null; // ignore weird/no-op txs
}

const sig =
  tx.transaction?.signatures?.[0] ||
  tx.signatures?.[0] ||
  "unknown_signature";

const ts = tx.blockTime ? tx.blockTime * 1000 : Date.now();

const pepeAbs = Math.abs(pepeChange);
const xntAbs = Math.abs(xntChange);

return {
  id: tradeIdCounter++,
  signature: sig,
  trade_type: tradeType,
  token_amount: pepeAbs,
  native_amount: xntAbs,
  price: (tradeType === "buy" || tradeType === "sell")
    ? (xntAbs / pepeAbs)
    : null, // LP events don't have a swap price
  trader_address: traderAddress,
  trader_prefix: traderAddress.substring(0, 6),
  timestamp: ts,
  slot: tx.slot,
};

  } catch (error) {
    console.error("❌ Parse error:", error.message);
    return null;
  }
}


// =============================================================================
// HISTORICAL TRADES (paged + retry for 429)
// =============================================================================

async function fetchHistoricalTrades(totalLimit = 1000) {
  console.log(`📚 Fetching last ${totalLimit} transactions...\n`);

  const MAX_RPC_LIMIT = 1000;
  let before = undefined;
  let signatures = [];

  while (signatures.length < totalLimit) {
    const remaining = totalLimit - signatures.length;
    const pageLimit = Math.min(MAX_RPC_LIMIT, remaining);

    const page = await withRetry(() =>
      connection.getSignaturesForAddress(POOL_ADDRESS, {
        limit: pageLimit,
        ...(before ? { before } : {}),
      })
    );

    if (!page || page.length === 0) break;

    signatures = signatures.concat(page);
    before = page[page.length - 1].signature;

    if (page.length < pageLimit) break;
  }

  console.log(`📝 Found ${signatures.length} signatures`);

  let processed = 0;
  const parsedTrades = [];

  // Slow down a bit to avoid 429 storms
  for (const sig of signatures) {
    try {
      const tx = await withRetry(() =>
        connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        })
      );

      if (!tx) continue;

      const trade = parseSwapFromTransaction(tx);
      if (!trade) continue;

      parsedTrades.push(trade);
      processed++;

      if (processed <= 5) {
        const time = new Date(trade.timestamp).toLocaleTimeString();
        console.log(
          `   ✅ ${trade.trade_type.toUpperCase()} | ${trade.token_amount.toFixed(0)} PEPE for ${trade.native_amount.toFixed(4)} XNT | ${time} | 👤 ${trade.trader_prefix}`
        );
      }

      // tiny throttle
      if (processed % 25 === 0) await sleep(120);
    } catch (_) {
      // ignore individual failures
    }
  }

  parsedTrades.sort((a, b) => b.timestamp - a.timestamp);
  tradeHistory = parsedTrades;

  console.log(`\n✅ Loaded ${processed} historical trades`);
}

// =============================================================================
// LIVE LISTENER
// =============================================================================

async function startBlockchainListener() {
  console.log("👂 Starting listener...\n");

  connection.onLogs(
    POOL_ADDRESS,
    async (logs) => {
      const time = new Date().toLocaleTimeString();
      console.log(`🔔 [${time}] New tx: ${logs.signature.substring(0, 16)}...`);

      try {
        const tx = await withRetry(() =>
          connection.getParsedTransaction(logs.signature, {
            maxSupportedTransactionVersion: 0,
          })
        );

        if (!tx) return;

        const trade = parseSwapFromTransaction(tx);
        if (trade) broadcastTrade(trade);
      } catch (error) {
        console.error("❌ Error processing:", error.message);
      }
    },
    "confirmed"
  );

  console.log("✅ Listener active\n");
}

// =============================================================================
// INIT (background)
// =============================================================================

async function init() {
  console.log("🔧 Initializing...\n");
  try {
    await fetchHistoricalTrades(HISTORY_LIMIT);
  } catch (e) {
    console.error("history init error:", e);
  }

  try {
    await startBlockchainListener();
  } catch (e) {
    console.error("listener init error:", e);
  }

  console.log("✅ Initialization complete!\n");
}

// =============================================================================
// START SERVER (bind FIRST; init in background)
// =============================================================================

const server = app.listen(PORT, "0.0.0.0", () => {
  const addr = server.address();
  if (!addr) {
    console.log("🌐 Server bound: (address unavailable yet)");
  } else {
    console.log("🌐 Server bound:", typeof addr === "string" ? addr : `${addr.address}:${addr.port}`);
  }
  console.log("🌐 Server:", `http://localhost:${PORT}`);
  console.log("📊 Dashboard:", `http://localhost:${PORT}`);
  console.log("📡 Stream:", `http://localhost:${PORT}/api/trades-stream`);
  console.log("❤️  API:", `http://localhost:${PORT}/api`);
  console.log("🧩 Pool Proxy:", `http://localhost:${PORT}/api/pool\n`);

  // Do not await init here; run it in background
  init().catch((e) => console.error("Startup error:", e));
});

server.on("error", (err) => {
  console.error("❌ listen error:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  server.close(() => process.exit(0));
});
