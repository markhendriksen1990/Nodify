// --- Import necessary modules ---
const { ethers } = require("ethers");
const express = require('express');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// --- Configuration from Environment Variables ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RENDER_WEBHOOK_URL = process.env.RENDER_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// --- Ethers.js Provider and Contract Addresses ---
const provider = new ethers.JsonRpcProvider("https://base.publicnode.com");

const managerAddress = "0x03a520b32c04bf3beef7beb72e919cf822ed34f1";
const poolAddress = "0xd0b53D9277642d899DF5C87A3966A349A798F224";
const myAddress = "0x2FD24cC510b7a40b176B05A5Bb628d024e3B6886";

// --- ABIs ---
const managerAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external returns (uint256 amount0, uint256 amount1)"
];

const poolAbi = [
  "function slot0() external view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const UINT128_MAX = "340282366920938463463374607431768211455";
const { formatUnits } = ethers;

// --- Utility Functions ---
function tickToSqrtPriceX96(tick) {
  const ratio = Math.pow(1.0001, Number(tick));
  const product = Math.sqrt(ratio) * (2 ** 96);

  if (!Number.isFinite(product)) {
    return 0n; 
  }
  return BigInt(Math.floor(product));
}

function getAmountsFromLiquidity(liquidity, sqrtPriceX96, sqrtLowerX96, sqrtUpperX96) {
  liquidity = BigInt(liquidity);
  sqrtPriceX96 = BigInt(sqrtPriceX96);
  sqrtLowerX96 = BigInt(sqrtLowerX96);
  sqrtUpperX96 = BigInt(sqrtUpperX96);

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPriceX96 <= sqrtLowerX96) {
    amount0 = liquidity * (sqrtUpperX96 - sqrtLowerX96) * (1n << 96n) / (sqrtLowerX96 * sqrtUpperX96);
  } else if (sqrtPriceX96 < sqrtUpperX96) {
    amount0 = liquidity * (sqrtUpperX96 - sqrtPriceX96) * (1n << 96n) / (sqrtPriceX96 * sqrtUpperX96);
    amount1 = liquidity * (sqrtPriceX96 - sqrtLowerX96) / (1n << 96n);
  } else {
    amount1 = liquidity * (sqrtUpperX96 - sqrtLowerX96) / (1n << 96n);
  }
  return [amount0, amount1];
}

async function getTokenMeta(addr) {
  try {
    const t = new ethers.Contract(addr, erc20Abi, provider);
    const [symbol, decimals] = await Promise.all([t.symbol(), t.decimals()]);
    return { symbol, decimals, address: addr };
  } catch {
    return { symbol: "UNKNOWN", decimals: 18, address: addr };
  }
}

// getUsdPrices using CoinLore (current prices)
async function getUsdPrices() {
  try {
    const res = await fetch("https://api.coinlore.net/api/tickers/"); // CoinLore API for tickers
    
    if (!res.ok) {
        console.error(`CoinLore API responded with status: ${res.status} ${res.statusText}`);
        const errorBody = await res.text();
        console.error(`CoinLore API error body: ${errorBody.substring(0, 200)}...`);
        throw new Error(`CoinLore API failed to fetch prices: ${res.status}`);
    }

    const d = await res.json();
    
    if (!d || !Array.isArray(d.data)) {
        console.error("CoinLore API returned unexpected data structure for tickers:", JSON.stringify(d));
        throw new Error("CoinLore API returned incomplete or malformed price data.");
    }

    let wethPrice = 0;
    let usdcPrice = 0;

    for (const ticker of d.data) {
        if (ticker.symbol === "WETH" && ticker.price_usd) {
            wethPrice = parseFloat(ticker.price_usd);
        }
        if (ticker.symbol === "USDC" && ticker.price_usd) {
            usdcPrice = parseFloat(ticker.price_usd);
        }
        if (wethPrice > 0 && usdcPrice > 0) {
            break; // Found both, exit loop
        }
    }

    if (wethPrice === 0 || usdcPrice === 0) {
        throw new Error("Could not find WETH or USDC prices in CoinLore API response (symbols not found or price_usd missing).");
    }

    return { WETH: wethPrice, USDC: usdcPrice };
  } catch (error) {
    console.error(`Failed to get CURRENT USD prices from CoinLore: ${error.message}`);
    // Fallback to default prices if CoinLore fails
    return { WETH: 0, USDC: 1 }; 
  }
}

function getRatio(weth, usdc) {
  const sum = weth + usdc;
  if (sum === 0) return { weth: 0, usdc: 0 };
  const wethPct = (weth / sum) * 100;
  const usdcPct = (usdc / sum) * 100;
  return {
    weth: Math.round(wethPct),
    usdc: Math.round(usdcPct)
  };
}

function tickToPricePerToken0(tick, token0Decimals, token1Decimals) {
  tick = Number(tick);
  token0Decimals = Number(token0Decimals);
  token1Decimals = Number(token1Decimals);
  return Math.pow(1.0001, tick) / Math.pow(10, token1Decimals - token0Decimals);
}

function formatTokenAmount(val, decimals = 6) {
  return Number(val).toFixed(decimals).replace(/\.?0+$/, '');
}

function formatElapsedDaysHours(ms) {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days} days, ${hours} hours`;
}

// MODIFIED: getMintEventBlock - Increased MAX_BLOCK_SEARCH_DEPTH
async function getMintEventBlock(manager, tokenId, provider, ownerAddress) {
  const latestBlock = await provider.getBlockNumber();
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  // Increased depth significantly to capture older mint events
  const MAX_BLOCK_SEARCH_DEPTH = 5000000; // Increased to 5 million blocks (approx. 200 days on Base)
  const RPC_QUERY_WINDOW = 49999;       // Retaining 49999 as requested (may still cause RPC errors)

  let fromBlock = latestBlock - RPC_QUERY_WINDOW;
  let toBlock = latestBlock;
  ownerAddress = ownerAddress.toLowerCase();

  while (toBlock >= 0 && (latestBlock - fromBlock) < MAX_BLOCK_SEARCH_DEPTH) { 
    if (fromBlock < 0) fromBlock = 0; 
    const filter = manager.filters.Transfer(zeroAddress, null, tokenId);
    try {
      const events = await manager.queryFilter(filter, fromBlock, toBlock);
      const mint = events.find(e => e.args && e.args.to.toLowerCase() === ownerAddress);
      if (mint) return mint.blockNumber; 
    } catch (e) {
      console.warn(`Error querying block range ${fromBlock}-${toBlock}: ${e.message}. Attempting next window.`);
    }
    toBlock = fromBlock - 1;
    fromBlock = toBlock - RPC_QUERY_WINDOW; 
  }
  throw new Error(`Mint event not found for tokenId within the last ${MAX_BLOCK_SEARCH_DEPTH} blocks.`);
}

// fetchHistoricalPrice using CoinGecko (historical prices)
async function fetchHistoricalPrice(coinId, dateStr) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}`;
    const res = await fetch(url);

    if (!res.ok) {
        console.error(`CoinGecko Historical API responded with status: ${res.status} ${res.statusText}`);
        const errorBody = await res.text();
        console.error(`CoinGecko Historical API error body: ${errorBody.substring(0, 200)}...`);
        // If 429, handle gracefully without rethrowing to allow other calcs to proceed
        if (res.status === 429) {
            console.warn(`CoinGecko Historical API rate limit hit. Returning 0 for price and trying next time.`);
            return 0; // Return 0 if rate limited for historical price
        }
        throw new Error(`CoinGecko Historical API failed to fetch price for ${coinId} on ${dateStr}: ${res.status}`);
    }

    const data = await res.json();
    
    if (!data || !data.market_data || !data.market_data.current_price || !data.market_data.current_price.usd) {
        console.error(`CoinGecko Historical API returned unexpected data structure for ${coinId} on ${dateStr}:`, JSON.stringify(data));
        throw new Error(`CoinGecko Historical API returned incomplete data for ${coinId} on ${dateStr}.`);
    }

    const price = data.market_data.current_price.usd || 0;
    // No in-memory cache for historical prices here, as previous cache was problematic.
    // If multiple calls for same historical date happen, it will re-query.
    return price;
  } catch (error) {
    console.error(`Failed to get HISTORICAL USD price from CoinGecko for ${coinId} on ${dateStr}: ${error.message}`);
    // If any error occurs here, historical price will be 0, leading to "Could not analyze position history"
    return 0; 
  }
}

// --- Refactored LP Position Data Fetcher ---
async function getFormattedPositionData(walletAddress) {
  let responseMessage = "";
  let prices = { WETH: 0, USDC: 0 }; // Initialize prices to avoid errors if getUsdPrices fails

  try {
    // Fetch CURRENT prices from CoinLore
    prices = await getUsdPrices(); 

    const manager = new ethers.Contract(managerAddress, managerAbi, provider);
    const pool = new ethers.Contract(poolAddress, poolAbi, provider);

    const [balance, slot0, token0Addr, token1Addr] = await Promise.all([
      manager.balanceOf(walletAddress),
      pool.slot0(),
      pool.token0(),
      pool.token1()
    ]);
    const sqrtP = slot0[0];
    const nativeTick = slot0[1];

    const [poolT0, poolT1] = await Promise.all([
      getTokenMeta(token0Addr),
      getTokenMeta(token1Addr)
    ]);

    responseMessage += `*👜 Wallet: ${walletAddress.substring(0, 6)}...${walletAddress.substring(38)}*\n\n`;
    responseMessage += `✨ You own *${balance.toString()}* position(s) in ${poolT0.symbol}/${poolT1.symbol} pool\n`;

    if (balance === 0n) {
      return responseMessage;
    }

    let totalFeeUSD = 0;
    let startPrincipalUSD = null;
    let startDate = null;
    let lastPortfolioValue = 0;

    for (let i = 0n; i < balance; i++) {
      responseMessage += `\n--- *Position #${i.toString()}* ---\n`;
      const tokenId = await manager.tokenOfOwnerByIndex(walletAddress, i);
      responseMessage += `🔹 Token ID: \`${tokenId.toString()}\`\n`;
      const pos = await manager.positions(tokenId);
      const [t0, t1] = await Promise.all([
        getTokenMeta(pos.token0),
        getTokenMeta(pos.token1)
      ]);
      responseMessage += `🔸 Pool: ${t0.symbol}/${t1.symbol}\n`;

      let currentPositionStartDate = null;
      let currentPositionInitialPrincipalUSD = null; 
      let positionHistoryAnalysisSucceeded = false;

      // Get mint event and analyze initial investment (uses CoinGecko for historical)
      try {
        const mintBlock = await getMintEventBlock(manager, tokenId, provider, walletAddress);
        const startTimestampMs = await getBlockTimestamp(mintBlock);
        currentPositionStartDate = new Date(startTimestampMs);
        
        // Only set overall startDate and startPrincipalUSD from the oldest position if not set yet, or update if this is older
        if (!startDate || currentPositionStartDate.getTime() < startDate.getTime()) {
            startDate = currentPositionStartDate;
            const day = startDate.getDate().toString().padStart(2, '0');
            const month = (startDate.getMonth() + 1).toString().padStart(2, '0');
            const year = startDate.getFullYear();
            const dateStr = `${day}-${month}-${year}`;
            // Use CoinGecko for historical prices here
            const histWETH = await fetchHistoricalPrice('ethereum', dateStr);
            const histUSDC = await fetchHistoricalPrice('usd-coin', dateStr);

            const [histAmt0, histAmt1] = getAmountsFromLiquidity(
              pos.liquidity,
              tickToSqrtPriceX96(Number(pos.tickLower)),
              tickToSqrtPriceX96(Number(pos.tickLower)), 
              tickToSqrtPriceX96(Number(pos.tickUpper)) 
            );

            let histWETHamt = 0, histUSDCamt = 0;
            if (t0.symbol.toUpperCase() === "WETH") {
              histWETHamt = parseFloat(formatUnits(histAmt0, t0.decimals));
              histUSDCamt = parseFloat(formatUnits(histAmt1, t1.decimals));
            } else {
              histWETHamt = parseFloat(formatUnits(histAmt1, t1.decimals));
              histUSDCamt = parseFloat(formatUnits(histAmt0, t0.decimals));
            }
            startPrincipalUSD = histWETHamt * histWETH + histUSDCamt * histUSDC;
        }
        
        // For *this specific position*, calculate its initial principal based on its mint date
        // Use CoinGecko for historical prices here
        const dayCurrent = currentPositionStartDate.getDate().toString().padStart(2, '0');
        const monthCurrent = (currentPositionStartDate.getMonth() + 1).toString().padStart(2, '0');
        const yearCurrent = currentPositionStartDate.getFullYear();
        const dateStrCurrent = `${dayCurrent}-${monthCurrent}-${yearCurrent}`;
        const histWETHCurrent = await fetchHistoricalPrice('ethereum', dateStrCurrent);
        const histUSDCCurrent = await fetchHistoricalPrice('usd-coin', dateStrCurrent);

        const [histAmt0Current, histAmt1Current] = getAmountsFromLiquidity(
            pos.liquidity,
            tickToSqrtPriceX96(Number(pos.tickLower)),
            tickToSqrtPriceX96(Number(pos.tickLower)), 
            tickToSqrtPriceX96(Number(pos.tickUpper)) 
        );
        let histWETHamtCurrent = 0, histUSDCamtCurrent = 0;
        if (t0.symbol.toUpperCase() === "WETH") {
            histWETHamtCurrent = parseFloat(formatUnits(histAmt0Current, t0.decimals));
            histUSDCamtCurrent = parseFloat(formatUnits(histAmt1Current, t1.decimals));
        } else {
            histWETHamtCurrent = parseFloat(formatUnits(histAmt1Current, t1.decimals));
            histUSDCamtCurrent = parseFloat(formatUnits(histAmt0Current, t0.decimals));
        }
        currentPositionInitialPrincipalUSD = histWETHamtCurrent * histWETHCurrent + histUSDCamtCurrent * histUSDCCurrent;
        positionHistoryAnalysisSucceeded = true;


        responseMessage += `📅 Created: ${currentPositionStartDate.toISOString().replace('T', ' ').slice(0, 19)}\n`;
        responseMessage += `💰 Initial Est. Investment: $${currentPositionInitialPrincipalUSD.toFixed(2)}\n`; 
      } catch (error) {
        responseMessage += `⚠️ Could not analyze position history: ${error.message}\n`;
      }

      // Current position analysis
      const lowerPrice = tickToPricePerToken0(Number(pos.tickLower), Number(t0.decimals), Number(t1.decimals));
      const upperPrice = tickToPricePerToken0(Number(pos.tickUpper), Number(t0.decimals), Number(t1.decimals));
      const currentPrice = tickToPricePerToken0(Number(nativeTick), Number(t0.decimals), Number(t1.decimals));

      responseMessage += `\n📊 *Price Information*\n`;
      responseMessage += `🏷️ Tick Range: \`[${pos.tickLower}, ${pos.tickUpper}]\`\n`;
      responseMessage += `🏷️ Price Range: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)} ${t1.symbol}/${t0.symbol}\n`; // 2 decimals
      responseMessage += `🌐 Current Tick: \`${nativeTick}\`\n`;
      responseMessage += `🌐 Current Price: $${currentPrice.toFixed(2)} ${t1.symbol}/${t0.symbol}\n`; // 2 decimals
      
      const inRange = nativeTick >= pos.tickLower && nativeTick < pos.tickUpper;
      responseMessage += `📍 In Range? ${inRange ? "✅ Yes" : "❌ No"}\n`;

      // Calculate current amounts
      const [sqrtL, sqrtU] = [
        tickToSqrtPriceX96(Number(pos.tickLower)),
        tickToSqrtPriceX96(Number(pos.tickUpper))
      ];
      const [raw0, raw1] = getAmountsFromLiquidity(pos.liquidity, sqrtP, sqrtL, sqrtU);
      const amt0 = parseFloat(formatUnits(raw0, t0.decimals));
      const amt1 = parseFloat(formatUnits(raw1, t1.decimals));

      let amtWETH = 0, amtUSDC = 0;
      if (t0.symbol.toUpperCase() === "WETH") {
        amtWETH = amt0;
        amtUSDC = amt1;
      } else {
        amtWETH = amt1;
        amtUSDC = amt0;
      }

      const principalUSD = amtWETH * prices.WETH + amtUSDC * prices.USDC;
      const ratio = getRatio(amtWETH * prices.WETH, amtUSDC * prices.USDC);

      responseMessage += `\n💧 *Current Position Holdings*\n`;
      responseMessage += `💧 ${formatTokenAmount(amtWETH, 6)} WETH ($${(amtWETH * prices.WETH).toFixed(2)})\n`;
      responseMessage += `💧 ${formatTokenAmount(amtUSDC, 2)} USDC ($${(amtUSDC * prices.USDC).toFixed(2)})\n`;
      responseMessage += `💧 Ratio: WETH/USDC ${ratio.weth}/${ratio.usdc}%\n`;
      responseMessage += `💧 Total Position Value: *$${principalUSD.toFixed(2)}*\n`;

      // Uncollected fees analysis
      const xp = await manager.collect.staticCall({
        tokenId,
        recipient: walletAddress,
        amount0Max: UINT128_MAX,
        amount1Max: UINT128_MAX
      });

      const fee0 = parseFloat(formatUnits(xp[0], t0.decimals));
      const fee1 = parseFloat(formatUnits(xp[1], t1.decimals));
      const feeUSD0 = fee0 * (t0.symbol.toUpperCase() === "WETH" ? prices.WETH : prices.USDC);
      const feeUSD1 = fee1 * (t1.symbol.toUpperCase() === "WETH" ? prices.WETH : prices.USDC);
      const totalPositionFeesUSD = feeUSD0 + feeUSD1;

      responseMessage += `\n💰 *Uncollected Fees*\n`;
      responseMessage += `💰 ${formatTokenAmount(fee0, 6)} ${t0.symbol} ($${feeUSD0.toFixed(2)})\n`;
      responseMessage += `💰 ${formatTokenAmount(fee1, 2)} ${t1.symbol} ($${feeUSD1.toFixed(2)})\n`;
      responseMessage += `💰 Total Fees: *$${totalPositionFeesUSD.toFixed(2)}*\n`;

      // Per-Position Fee Performance (uses currentPositionStartDate and currentPositionInitialPrincipalUSD)
      if (positionHistoryAnalysisSucceeded && currentPositionInitialPrincipalUSD !== null && currentPositionInitialPrincipalUSD > 0) {
          const now = new Date();
          const elapsedMs = now.getTime() - currentPositionStartDate.getTime();
          const rewardsPerHour = elapsedMs > 0 ? totalPositionFeesUSD / (elapsedMs / 1000 / 60 / 60) : 0;
          const rewardsPerDay = rewardsPerHour * 24;
          const rewardsPerMonth = rewardsPerDay * 30.44;
          const rewardsPerYear = rewardsPerDay * 365.25;
          const feesAPR = (rewardsPerYear / currentPositionInitialPrincipalUSD) * 100;

          responseMessage += `\n📊 *Fee Performance (This Position)*\n`;
          responseMessage += `💎 Fees per hour: $${rewardsPerHour.toFixed(2)}\n`;
          responseMessage += `💎 Fees per day: $${rewardsPerDay.toFixed(2)}\n`;
          responseMessage += `💎 Fees per month: $${rewardsPerMonth.toFixed(2)}\n`;
          responseMessage += `💎 Fees per year: $${rewardsPerYear.toFixed(2)}\n`;
          responseMessage += `💎 Fees APR: ${feesAPR.toFixed(2)}%\n`;
      } else {
          responseMessage += `\n⚠️ Could not determine per-position fee performance (initial investment unknown or zero).\n`;
      }

      const currentTotalValue = principalUSD + totalPositionFeesUSD;
      responseMessage += `\n🏦 *Total Position Value (incl. fees): $${currentTotalValue.toFixed(2)}*\n`;

      totalFeeUSD += (feeUSD0 + feeUSD1);
      lastPortfolioValue = currentTotalValue;
    }

    // --- Overall Portfolio Performance Analysis Section ---
    if (startDate && startPrincipalUSD !== null) {
        const now = new Date();
        const elapsedMs = now.getTime() - startDate.getTime();
        const rewardsPerHour = elapsedMs > 0 ? totalFeeUSD / (elapsedMs / 1000 / 60 / 60) : 0;
        const rewardsPerDay = rewardsPerHour * 24;
        const rewardsPerMonth = rewardsPerDay * 30.44;
        const rewardsPerYear = rewardsPerDay * 365.25;
        const totalReturn = lastPortfolioValue - startPrincipalUSD;
        const totalReturnPercent = (totalReturn / startPrincipalUSD) * 100;
        const feesAPR = (rewardsPerYear / startPrincipalUSD) * 100;

        responseMessage += `\n=== *OVERALL PORTFOLIO PERFORMANCE* ===\n`;
        responseMessage += `📅 Oldest Position: ${startDate.toISOString().replace('T', ' ').slice(0, 19)}\n`;
        responseMessage += `📅 Analysis Period: ${formatElapsedDaysHours(elapsedMs)}\n`;
        responseMessage += `💰 Initial Investment: $${startPrincipalUSD.toFixed(2)}\n`;
        responseMessage += `💰 Current Value: $${lastPortfolioValue.toFixed(2)}\n`;
        responseMessage += `💰 Total Return: $${totalReturn.toFixed(2)} (${totalReturnPercent.toFixed(2)}%)\n`;
        
        responseMessage += `\n📊 *Fee Performance*\n`;
        responseMessage += `💎 Total Fees Earned: $${totalFeeUSD.toFixed(2)}\n`;
        responseMessage += `💎 Fees per hour: $${rewardsPerHour.toFixed(2)}\n`;
        responseMessage += `💎 Fees per day: $${rewardsPerDay.toFixed(2)}\n`;
        responseMessage += `💎 Fees per month: $${rewardsPerMonth.toFixed(2)}\n`;
        responseMessage += `💎 Fees per year: $${rewardsPerYear.toFixed(2)}\n`;
        responseMessage += `💎 Fees APR: ${feesAPR.toFixed(2)}%\n`;

        responseMessage += `\n🎯 *Overall Performance*\n`;
        responseMessage += `📈 Total APR (incl. price changes): ${((totalReturn / startPrincipalUSD) * (365.25 / (elapsedMs / (1000 * 60 * 60 * 24))) * 100).toFixed(2)}%\n`;
    } else {
        responseMessage += '\n❌ Could not determine start date or start principal USD value for overall performance analysis.\n';
    }

  } catch (error) {
    console.error("Error in getFormattedPositionData:", error);
    responseMessage = `An error occurred while fetching liquidity positions: ${error.message}. Please try again later.`;
  }
  return responseMessage;
}

// --- Express App Setup for Webhook ---
const app = express();
const PORT = process.env.PORT || 3000;

// Use body-parser to parse JSON payloads from Telegram
app.use(bodyParser.json());

// Telegram Webhook endpoint
app.post(`/bot${TELEGRAM_BOT_TOKEN}/webhook`, async (req, res) => {
    // Validate Telegram's webhook secret
    const telegramSecret = req.get('X-Telegram-Bot-Api-Secret-Token');
    if (!WEBHOOK_SECRET || telegramSecret !== WEBHOOK_SECRET) {
        console.warn('Unauthorized webhook access attempt! Invalid or missing secret token.');
        return res.status(403).send('Forbidden: Invalid secret token');
    }

    // IMPORTANT: Always respond with 200 OK immediately to Telegram to acknowledge receipt
    res.sendStatus(200);

    // Process the command asynchronously in the background.
    // Ensure 'update' is passed correctly to the async function.
    processTelegramCommand(req.body).catch(error => { // Pass req.body as 'update'
        console.error("Unhandled error in async Telegram command processing:", error);
        // Optionally, send a generic error message to the user here if processing fails
        // after the initial 200 OK was sent.
        // E.g., sendMessage(update.message.chat.id, "Sorry, a background error occurred. Please try again later.").catch(e => console.error("Failed to send async error msg:", e));
    });
});

// NEW: Asynchronous function to process Telegram commands and send responses
async function processTelegramCommand(update) {
    if (update.message) {
        const messageText = update.message.text;
        const chatId = update.message.chat.id;

        if (messageText && messageText.startsWith('/positions')) {
            try {
                await sendChatAction(chatId, 'typing');
                const positionData = await getFormattedPositionData(myAddress);
                await sendMessage(chatId, positionData);
            } catch (error) {
                console.error("Error processing /positions command asynchronously:", error);
                await sendMessage(chatId, "Sorry, I encountered an internal error while fetching positions. Please try again later.");
            }
        } else if (messageText && messageText.startsWith('/start')) {
            await sendMessage(chatId, "Welcome! I can provide you with information about your Uniswap V3 liquidity positions. Type /positions to get a summary.");
        } else {
            await sendMessage(chatId, "I received your message, but I only understand the /positions command. If you want to see your positions, type /positions or select it from the menu.");
        }
    }
}


// Function to send messages back to Telegram
async function sendMessage(chatId, text) {
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Failed to send message:', data);
        }
    } catch (error) {
        console.error('Error sending message to Telegram:', error);
    }
}

// Function to send chat actions (like 'typing')
async function sendChatAction(chatId, action) {
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;
    try {
        await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                action: action
            })
        });
    } catch (error) {
        console.error('Error sending chat action to Telegram:', error);
    }
}


// Start the Express server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Telegram webhook URL: ${RENDER_WEBHOOK_URL}/bot${TELEGRAM_BOT_TOKEN}/webhook`);
});
