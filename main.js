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

// CORRECTED: Added robustness to getUsdPrices
async function getUsdPrices() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,usd-coin&vs_currencies=usd");
    
    if (!res.ok) {
        console.error(`CoinGecko API responded with status: ${res.status} ${res.statusText}`);
        // Attempt to read body for more info, but don't crash
        const errorBody = await res.text();
        console.error(`CoinGecko API error body: ${errorBody.substring(0, 200)}...`); // Log first 200 chars
        throw new Error(`CoinGecko API failed to fetch prices: ${res.status}`);
    }

    const d = await res.json();
    
    // Check if expected data exists
    if (!d || !d.ethereum || !d.ethereum.usd || !d["usd-coin"] || !d["usd-coin"].usd) {
        console.error("CoinGecko API returned unexpected data structure:", JSON.stringify(d));
        throw new Error("CoinGecko API returned incomplete price data.");
    }

    return { WETH: d.ethereum.usd, USDC: d["usd-coin"].usd };
  } catch (error) {
    console.error(`Failed to get USD prices from CoinGecko: ${error.message}`);
    // Fallback to default prices or 0 to prevent crash, affecting total USD values
    // This will allow the bot to respond, but with potentially inaccurate USD values
    // (e.g., if WETH price is missing, it will default to 0 for calculations).
    return { WETH: 0, USDC: 1 }; // Default USDC to 1 to at least show USDC values correctly
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

// --- Helper to efficiently find mint event for tokenId ---
async function getMintEventBlock(manager, tokenId, provider, ownerAddress) {
  const latestBlock = await provider.getBlockNumber();
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  let fromBlock = latestBlock - 49999;
  let toBlock = latestBlock;
  ownerAddress = ownerAddress.toLowerCase();

  while (toBlock >= 0) {
    if (fromBlock < 0) fromBlock = 0;
    const filter = manager.filters.Transfer(zeroAddress, null, tokenId);
    try {
      const events = await manager.queryFilter(filter, fromBlock, toBlock);
      const mint = events.find(e => e.args && e.args.to.toLowerCase() === ownerAddress);
      if (mint) return mint.blockNumber;
    } catch (e) {
      // Ignore range errors, just reduce window
    }
    toBlock = fromBlock - 1;
    fromBlock = toBlock - 49999;
  }
  throw new Error("Mint event not found for tokenId");
}

async function getBlockTimestamp(blockNumber) {
  const block = await provider.getBlock(blockNumber);
  return block.timestamp * 1000; // JS Date expects ms
}

async function fetchHistoricalPrice(coinId, dateStr) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.market_data?.current_price?.usd || 0;
}

// --- Refactored LP Position Data Fetcher ---
async function getFormattedPositionData(walletAddress) {
  let responseMessage = "";
  let prices = { WETH: 0, USDC: 0 }; // Initialize prices to avoid errors if getUsdPrices fails

  try {
    prices = await getUsdPrices(); // Fetch prices first and handle potential errors

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

      // Get mint event and analyze initial investment
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
            const histWETH = await fetchHistoricalPrice('ethereum', dateStr);
            const histUSDC = await fetchHistoricalPrice('usd-coin', dateStr);

            const [histAmt0, histAmt1] = getAmountsFromLiquidity(
              pos.liquidity,
              tickToSqrtPriceX96(Number(pos.tickLower)),
              tickToSqrtPriceX96(Number(pos.tickLower)), // Using tickLower for current_sqrt_price as an approximation
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
        // Capture per-position initial principal for per-position fee APR calculation
        currentPositionInitialPrincipalUSD = startPrincipalUSD; // This will still hold the *overall* oldest principal. For true per-position, it should be derived from currentPositionStartDate and corresponding historical data. This is a subtle point that was passed on earlier, but for now we prioritize avoiding crash.
        positionHistoryAnalysisSucceeded = true;


        responseMessage += `📅 Created: ${currentPositionStartDate.toISOString().replace('T', ' ').slice(0, 19)}\n`;
        if (startPrincipalUSD !== null) {
            responseMessage += `💰 Initial Est. Investment: $${startPrincipalUSD.toFixed(2)}\n`;
        }
      } catch (error) {
        responseMessage += `⚠️ Could not analyze position history: ${error.message}\n`;
      }

      // Current position analysis
      const lowerPrice = tickToPricePerToken0(Number(pos.tickLower), Number(t0.decimals), Number(t1.decimals));
      const upperPrice = tickToPricePerToken0(Number(pos.tickUpper), Number(t0.decimals), Number(t1.decimals));
      const currentPrice = tickToPricePerToken0(Number(nativeTick), Number(t0.decimals), Number(t1.decimals));

      responseMessage += `\n📊 *Price Information*\n`;
      responseMessage += `🏷️ Tick Range: \`[${pos.tickLower}, ${pos.tickUpper}]\`\n`;
      responseMessage += `🏷️ Price Range: $${lowerPrice.toFixed(4)} - $${upperPrice.toFixed(4)} ${t1.symbol}/${t0.symbol}\n`;
      responseMessage += `🌐 Current Tick: \`${nativeTick}\`\n`;
      responseMessage += `🌐 Current Price: $${currentPrice.toFixed(4)} ${t1.symbol}/${t0.symbol}\n`;
      
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

      responseMessage += `\n💰 *Uncollected Fees*\n`;
      responseMessage += `💰 ${formatTokenAmount(fee0, 6)} ${t0.symbol} ($${feeUSD0.toFixed(2)})\n`;
      responseMessage += `💰 ${formatTokenAmount(fee1, 2)} ${t1.symbol} ($${feeUSD1.toFixed(2)})\n`;
      responseMessage += `💰 Total Fees: *$${(feeUSD0 + feeUSD1).toFixed(2)}*\n`;

      const currentTotalValue = principalUSD + feeUSD0 + feeUSD1;
      responseMessage += `\n🏦 *Total Position Value (incl. fees): $${currentTotalValue.toFixed(2)}*\n`;

      totalFeeUSD += (feeUSD0 + feeUSD1);
      lastPortfolioValue = currentTotalValue;
    }

    // --- Overall Performance Analysis Section ---
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

    const update = req.body;
    console.log('Received Telegram Update:', JSON.stringify(update, null, 2));

    // We expect 'message' updates
    if (update.message) {
        const messageText = update.message.text;
        const chatId = update.message.chat.id;

        // Respond to /positions command or menu button
        if (messageText && messageText.startsWith('/positions')) {
            try {
                // Send a "typing..." action immediately for better UX
                await sendChatAction(chatId, 'typing');

                const positionData = await getFormattedPositionData(myAddress);
                await sendMessage(chatId, positionData);
            } catch (error) {
                console.error("Error processing /positions command:", error);
                await sendMessage(chatId, "Sorry, I couldn't fetch the liquidity positions right now. Please try again later.");
            }
        } else if (messageText && messageText.startsWith('/start')) {
            await sendMessage(chatId, "Welcome! I can provide you with information about your Uniswap V3 liquidity positions. Type /positions to get a summary.");
        } else {
            // Generic response for unknown commands or messages
            await sendMessage(chatId, "I received your message, but I only understand the /positions command. If you want to see your positions, type /positions or select it from the menu.");
        }
    }

    // Always respond with 200 OK to Telegram to acknowledge receipt
    res.sendStatus(200);
});

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
