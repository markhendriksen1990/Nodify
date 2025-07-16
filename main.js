// --- Import necessary modules ---
const { ethers } = require("ethers");
const express = require('express');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { abi: FactoryAbi } = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json');
const { createCanvas, loadImage, registerFont } = require('canvas');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');


// --- Configuration from Environment Variables ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RENDER_WEBHOOK_URL = process.env.RENDER_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// --- Ethers.js Provider and Contract Addresses ---
const provider = new ethers.JsonRpcProvider("https://base.publicnode.com");

const managerAddress = "0x03a520b32c04bf3beef7beb72e919cf822ed34f1";
const myAddress = "0x2FD24cC510b7a40b176B05A5Bb628d024e3B6886";
const factoryAddress = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// --- Register Font for Image Snapshots ---
try {
    if (fs.existsSync('Roboto-Regular.ttf')) {
        registerFont('Roboto-Regular.ttf', { family: 'Roboto' });
        console.log("Font 'Roboto-Regular.ttf' registered successfully.");
    } else {
        console.warn("Font file 'Roboto-Regular.ttf' not found. Text in snapshots may not render correctly.");
    }
} catch (e) {
    console.error("Could not register font:", e);
}


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
    sqrtLowerX96 = BigInt(sqrtLowerX96 || 0n);
    sqrtUpperX96 = BigInt(sqrtUpperX96 || 0n);
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
        const symbol = await t.symbol();
        const decimals = await t.decimals();
        return { symbol, decimals, address: addr };
    } catch {
        return { symbol: "UNKNOWN", decimals: 18, address: addr };
    }
}

async function getUsdPrices() {
    try {
        const res = await fetch("https://api.coinlore.net/api/tickers/");
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
                break;
            }
        }
        if (wethPrice === 0 || usdcPrice === 0) {
            throw new Error("Could not find WETH or USDC prices in CoinLore API response (symbols not found or price_usd missing).");
        }
        return { WETH: wethPrice, USDC: usdcPrice };
    } catch (error) {
        console.error(`Failed to get CURRENT USD prices from CoinLore: ${error.message}`);
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
    return `${days} days, ${hours} `;
}

async function getMintEventBlock(manager, tokenId, provider, ownerAddress) {
    const latestBlock = await provider.getBlockNumber();
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const INITIAL_RPC_QUERY_WINDOW = 49999;
    const maxRetries = 5;

    let toBlock = latestBlock;
    ownerAddress = ownerAddress.toLowerCase();

    while (toBlock >= 0) {
        let currentQueryWindow = INITIAL_RPC_QUERY_WINDOW;
        let fromBlock = toBlock - currentQueryWindow;
        if (fromBlock < 0) {
            fromBlock = 0;
        }

        const filter = manager.filters.Transfer(zeroAddress, null, tokenId);
        
        let success = false;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const events = await manager.queryFilter(filter, fromBlock, toBlock);
                const mint = events.find(e => e.args && e.args.to.toLowerCase() === ownerAddress);
                if (mint) {
                    return mint.blockNumber;
                }
                success = true;
                break;
            } catch (e) {
                const errorMessage = e.message || "";
                if (errorMessage.includes("invalid block range") || errorMessage.includes("block range is too wide")) {
                    currentQueryWindow = Math.floor(currentQueryWindow / 2);
                    if (currentQueryWindow < 1) currentQueryWindow = 1;
                    fromBlock = toBlock - currentQueryWindow;
                    if(fromBlock < 0) fromBlock = 0;
                    console.warn(`Attempt ${attempt} failed for tokenId ${tokenId}: Block range too large. Retrying with smaller window: ${currentQueryWindow} blocks.`);
                    await new Promise(res => setTimeout(res, 1000 * attempt));
                } else {
                    console.error(`Unrecoverable error querying logs for tokenId ${tokenId}:`, e);
                    throw e;
                }
            }
        }

        if (!success) {
            console.error(`All ${maxRetries} retry attempts failed for block range ending at ${toBlock} on tokenId ${tokenId}. Skipping this chunk.`);
        }

        toBlock = toBlock - INITIAL_RPC_QUERY_WINDOW - 1;
    }

    throw new Error(`Mint event not found for tokenId ${tokenId} after scanning all blocks.`);
}


async function getBlockTimestamp(blockNumber) {
    const block = await provider.getBlock(blockNumber);
    return block.timestamp * 1000;
}

const historicalPriceCache = {};
let coingeckoHistoricalCooldownUntil = 0;

async function fetchHistoricalPrice(coinId, dateStr) {
    const cacheKey = `${coinId}-${dateStr}`;
    if (historicalPriceCache[cacheKey]) {
        return historicalPriceCache[cacheKey];
    }
    if (Date.now() < coingeckoHistoricalCooldownUntil) {
        console.warn(`CoinGecko Historical API still on cooldown. Skipping request for ${cacheKey}.`);
        return 0;
    }
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&x_cg_demo_api_key=CG-UVFFYYLSfEA26y4Dd31pYcLL`;
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`CoinGecko Historical API responded with status: ${res.status} ${res.statusText}`);
            const errorBody = await res.text();
            console.error(`CoinGecko Historical API error body: ${errorBody.substring(0, 200)}...`);
            if (res.status === 429) {
                const retryAfter = res.headers.get('Retry-After');
                const cooldownDuration = (retryAfter ? parseInt(retryAfter) * 1000 : 60 * 1000);
                coingeckoHistoricalCooldownUntil = Date.now() + cooldownDuration;
                console.warn(`CoinGecko Historical API rate limit hit. Setting cooldown for ${cooldownDuration / 1000} seconds.`);
                return 0;
            }
            throw new Error(`CoinGecko Historical API failed to fetch price for ${coinId} on ${dateStr}: ${res.status}`);
        }
        const data = await res.json();
        if (!data || !data.market_data || !data.market_data.current_price || !data.market_data.current_price.usd) {
            console.error(`CoinGecko Historical API returned unexpected data structure for ${coinId} on ${dateStr}:`, JSON.stringify(data));
            throw new Error(`CoinGecko Historical API returned incomplete data for ${coinId} on ${dateStr}.`);
        }
        const price = data.market_data.current_price.usd || 0;
        historicalPriceCache[cacheKey] = price;
        return price;
    } catch (error) {
        console.error(`Failed to get HISTORICAL USD price from CoinGecko for ${coinId} on ${dateStr}: ${error.message}`);
        return 0;
    }
}


// --- Main Data Fetching and Formatting Logic ---
async function getPositionsData(walletAddress) {
    const prices = await getUsdPrices();
    const manager = new ethers.Contract(managerAddress, managerAbi, provider);
    const factory = new ethers.Contract(factoryAddress, FactoryAbi, provider);
    const balance = await manager.balanceOf(walletAddress);

    if (balance === 0n) {
        return [];
    }
    
    const positionsData = [];

    for (let i = 0n; i < balance; i++) {
        const tokenId = await manager.tokenOfOwnerByIndex(walletAddress, i);
        const pos = await manager.positions(tokenId);
        const dynamicPoolAddress = await factory.getPool(pos.token0, pos.token1, pos.fee);

        if (dynamicPoolAddress === ethers.ZeroAddress) {
            continue;
        }
        
        const pool = new ethers.Contract(dynamicPoolAddress, poolAbi, provider);
        const slot0 = await pool.slot0();
        const token0Addr = await pool.token0();
        const token1Addr = await pool.token1();
        
        const sqrtP = slot0[0];
        const nativeTick = slot0[1];

        const t0 = await getTokenMeta(token0Addr);
        const t1 = await getTokenMeta(token1Addr);

        const [sqrtL, sqrtU] = [ tickToSqrtPriceX96(Number(pos.tickLower)), tickToSqrtPriceX96(Number(pos.tickUpper)) ];
        const [raw0, raw1] = getAmountsFromLiquidity(pos.liquidity, sqrtP, sqrtL, sqrtU);
        const amt0 = parseFloat(formatUnits(raw0, t0.decimals));
        const amt1 = parseFloat(formatUnits(raw1, t1.decimals));

        const xp = await manager.collect.staticCall({ tokenId, recipient: walletAddress, amount0Max: UINT128_MAX, amount1Max: UINT128_MAX });
        const fee0 = parseFloat(formatUnits(xp[0], t0.decimals));
        const fee1 = parseFloat(formatUnits(xp[1], t1.decimals));

        if (amt0 === 0 && amt1 === 0 && fee0 === 0 && fee1 === 0) {
            continue;
        }
        
        const positionDataObject = { i, tokenId, t0, t1, pos, nativeTick, amt0, amt1, fee0, fee1, prices, sqrtL, sqrtU };

        try {
            const mintBlock = await getMintEventBlock(manager, tokenId, provider, walletAddress);
            const startTimestampMs = await getBlockTimestamp(mintBlock);
            positionDataObject.currentPositionStartDate = new Date(startTimestampMs);

            if (!positionDataObject.startDate || positionDataObject.currentPositionStartDate.getTime() < positionDataObject.startDate.getTime()) {
                positionDataObject.startDate = positionDataObject.currentPositionStartDate;
            }

            const dayCurrent = positionDataObject.currentPositionStartDate.getDate().toString().padStart(2, '0');
            const monthCurrent = (positionDataObject.currentPositionStartDate.getMonth() + 1).toString().padStart(2, '0');
            const yearCurrent = positionDataObject.currentPositionStartDate.getFullYear();
            const dateStrCurrent = `${dayCurrent}-${monthCurrent}-${yearCurrent}`;
            
            const histWETHCurrent = await fetchHistoricalPrice('ethereum', dateStrCurrent);
            const histUSDCCurrent = await fetchHistoricalPrice('usd-coin', dateStrCurrent);
            
            const decimalAdjustment = Math.pow(10, Number(t1.decimals) - Number(t0.decimals));
            const historicalPriceOfToken0 = (t0.symbol === "WETH" ? histWETHCurrent / histUSDCCurrent : histUSDCCurrent / histWETHCurrent) * decimalAdjustment;
            const estimatedHistoricalTick = Math.log(historicalPriceOfToken0) / Math.log(1.0001);
            const historicalSqrtPriceX96 = tickToSqrtPriceX96(Number(estimatedHistoricalTick));

            const [histAmt0Current_raw, histAmt1Current_raw] = getAmountsFromLiquidity(
                pos.liquidity, historicalSqrtPriceX96, sqrtL, sqrtU
            );

            if (t0.symbol.toUpperCase() === "WETH") {
                positionDataObject.histWETHamtCurrent = parseFloat(formatUnits(histAmt0Current_raw, t0.decimals));
                positionDataObject.histUSDCamtCurrent = parseFloat(formatUnits(histAmt1Current_raw, t1.decimals));
            } else {
                positionDataObject.histWETHamtCurrent = parseFloat(formatUnits(histAmt1Current_raw, t1.decimals));
                positionDataObject.histUSDCamtCurrent = parseFloat(formatUnits(histAmt0Current_raw, t0.decimals));
            }
            
            positionDataObject.currentPositionInitialPrincipalUSD = positionDataObject.histWETHamtCurrent * histWETHCurrent + positionDataObject.histUSDCamtCurrent * histUSDCCurrent;
            positionDataObject.positionHistoryAnalysisSucceeded = positionDataObject.currentPositionInitialPrincipalUSD > 0;

        } catch (error) {
            console.error(`ERROR during historical analysis for token ${tokenId.toString()}:`, error);
            positionDataObject.historyError = error;
            positionDataObject.positionHistoryAnalysisSucceeded = false;
        }
        
        positionsData.push(positionDataObject);
    }
    
    return positionsData;
}


async function getFormattedPositionData(walletAddress) {
    let responseMessage = "";
    
    try {
        const allPositionsData = await getPositionsData(walletAddress);

        if (allPositionsData.length === 0) {
            return `*👜 Wallet: ${walletAddress.substring(0, 6)}...${walletAddress.substring(38)}*\n\n✨ You own *0* Uniswap V3 positions with value.`;
        }
        
        const positionMessages = [];
        let overallData = {
            totalFeeUSD: 0,
            startPrincipalUSD: null,
            startDate: null,
            totalPortfolioPrincipalUSD: 0
        };

        for (const data of allPositionsData) {
            let currentPositionMessage = "";
            currentPositionMessage += `\n-------------- Position #${data.i.toString()} --------------\n`;
            currentPositionMessage += `🔹 Token ID: \`${data.tokenId.toString()}\`\n`;
            currentPositionMessage += `🔸 Pool: ${data.t0.symbol}/${data.t1.symbol} (${Number(data.pos.fee)/10000}% fee)\n`;

            if (data.positionHistoryAnalysisSucceeded) {
                if (!overallData.startDate || data.currentPositionStartDate.getTime() < overallData.startDate.getTime()) {
                    overallData.startDate = data.currentPositionStartDate;
                    overallData.startPrincipalUSD = data.currentPositionInitialPrincipalUSD;
                }
                const adjustedDate = new Date(data.currentPositionStartDate.getTime() + (2 * 60 * 60 * 1000));
                currentPositionMessage += `📅 Created: ${adjustedDate.toISOString().replace('T', ' ').slice(0, 19)}\n`;
                currentPositionMessage += `💰 Initial Investment: $${data.currentPositionInitialPrincipalUSD.toFixed(2)}\n`;
            } else {
                const sanitizedErrorMessage = (data.historyError?.message || "Unknown error").replace(/[*_`[\]]/g, '');
                currentPositionMessage += `⚠️ Could not analyze position history: ${sanitizedErrorMessage}\n`;
            }

            const lowerPrice = tickToPricePerToken0(Number(data.pos.tickLower), Number(data.t0.decimals), Number(data.t1.decimals));
            const upperPrice = tickToPricePerToken0(Number(data.pos.tickUpper), Number(data.t0.decimals), Number(data.t1.decimals));
            const currentPrice = tickToPricePerToken0(Number(data.nativeTick), Number(data.t0.decimals), Number(data.t1.decimals));
            
            let amtWETH = 0, amtUSDC = 0;
            if (data.t0.symbol.toUpperCase() === "WETH") { amtWETH = data.amt0; amtUSDC = data.amt1; } 
            else { amtWETH = data.amt1; amtUSDC = data.amt0; }
            const ratio = getRatio(amtWETH * data.prices.WETH, amtUSDC * data.prices.USDC);

            currentPositionMessage += `\n*Price Information*\n`;
            currentPositionMessage += `Range: $${lowerPrice.toFixed(2)} - $${upperPrice.toFixed(2)} ${data.t1.symbol}/${data.t0.symbol}\n`;
            currentPositionMessage += `Current Price: $${currentPrice.toFixed(2)} ${data.t1.symbol}/${data.t0.symbol}\n`;
            currentPositionMessage += `Ratio: WETH/USDC ${ratio.weth}/${ratio.usdc}%\n`;

            const inRange = data.nativeTick >= data.pos.tickLower && data.nativeTick < data.pos.tickUpper;
            currentPositionMessage += `📍 In Range? ${inRange ? "✅ Yes" : "❌ No"}\n`;
            
            const principalUSD = amtWETH * data.prices.WETH + amtUSDC * data.prices.USDC;
            overallData.totalPortfolioPrincipalUSD += principalUSD;

            currentPositionMessage += `\n*Current Holdings*\n`;
            currentPositionMessage += `🏛 ${formatTokenAmount(amtWETH, 6)} WETH ($${(amtWETH * data.prices.WETH).toFixed(2)})\n`;
            currentPositionMessage += `🏛 ${formatTokenAmount(amtUSDC, 2)} USDC ($${(amtUSDC * data.prices.USDC).toFixed(2)})\n`;
            currentPositionMessage += `🏛 Holdings: *$${principalUSD.toFixed(2)}*\n`;

            const positionHoldingsChange = principalUSD - data.currentPositionInitialPrincipalUSD;
            if (data.positionHistoryAnalysisSucceeded) {
                currentPositionMessage += `📈 Holdings change: $${positionHoldingsChange.toFixed(2)}\n`;
            }
            
            const feeUSD0 = data.fee0 * (data.t0.symbol.toUpperCase() === "WETH" ? data.prices.WETH : data.prices.USDC);
            const feeUSD1 = data.fee1 * (data.t1.symbol.toUpperCase() === "WETH" ? data.prices.WETH : data.prices.USDC);
            const totalPositionFeesUSD = feeUSD0 + feeUSD1;

            currentPositionMessage += `\n*Uncollected Fees*\n`;
            currentPositionMessage += `💰 ${formatTokenAmount(data.fee0, 6)} ${data.t0.symbol} ($${feeUSD0.toFixed(2)})\n`;
            currentPositionMessage += `💰 ${formatTokenAmount(data.fee1, 2)} ${data.t1.symbol} ($${feeUSD1.toFixed(2)})\n`;
            currentPositionMessage += `💰 Total Fees: *$${totalPositionFeesUSD.toFixed(2)}*\n`;
            
            if (data.positionHistoryAnalysisSucceeded) {
                const now = new Date();
                const elapsedMs = now.getTime() - data.currentPositionStartDate.getTime();
                const rewardsPerYear = elapsedMs > 0 ? totalPositionFeesUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
                const rewardsPerDay = rewardsPerYear / 365.25;
                const rewardsPerHour = rewardsPerDay / 24;
                const rewardsPerMonth = rewardsPerYear / 12;
                const feesAPR = (rewardsPerYear / data.currentPositionInitialPrincipalUSD) * 100;

                currentPositionMessage += `\n*Fee Performance*\n`;
                currentPositionMessage += `💧 Fees per hour: $${rewardsPerHour.toFixed(2)}\n`;
                currentPositionMessage += `💧 Fees per day: $${rewardsPerDay.toFixed(2)}\n`;
                currentPositionMessage += `💧 Fees per month: $${rewardsPerMonth.toFixed(2)}\n`;
                currentPositionMessage += `💧 Fees per year: $${rewardsPerYear.toFixed(2)}\n`;
                currentPositionMessage += `💧 Fees APR: ${feesAPR.toFixed(2)}%\n`;
            } else {
                currentPositionMessage += `\n⚠️ Could not determine per-position fee performance (initial investment unknown or zero).\n`;
            }

            const currentTotalValue = principalUSD + totalPositionFeesUSD;
            currentPositionMessage += `\n🏦 Position Value: *$${currentTotalValue.toFixed(2)}*\n`;

            const positionReturn = principalUSD - data.currentPositionInitialPrincipalUSD;
            const positionTotalGains = positionReturn + totalPositionFeesUSD;
            if (data.positionHistoryAnalysisSucceeded) {
                currentPositionMessage += `📈 Position Total return + Fees: $${positionTotalGains.toFixed(2)}\n`;
            }

            overallData.totalFeeUSD += totalPositionFeesUSD;
            
            positionMessages.push(currentPositionMessage);
        }

        responseMessage = `*👜 Wallet: ${walletAddress.substring(0, 6)}...${walletAddress.substring(38)}*\n\n`;
        responseMessage += `✨ Displaying *${positionMessages.length}* of *${allPositionsData.length}* total positions with value.\n`;
        responseMessage += positionMessages.join('');

        if (overallData.startDate && overallData.startPrincipalUSD !== null) {
            const now = new Date();
            const elapsedMs = now.getTime() - overallData.startDate.getTime();
            const rewardsPerYear = elapsedMs > 0 ? overallData.totalFeeUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
            const totalReturn = overallData.totalPortfolioPrincipalUSD - overallData.startPrincipalUSD;
            const totalReturnPercent = (totalReturn / overallData.startPrincipalUSD) * 100;
            const feesAPR = (rewardsPerYear / overallData.startPrincipalUSD) * 100;

            responseMessage += `\n====== OVERALL PERFORMANCE ======\n`;
            responseMessage += `(Based on the *${positionMessages.length}* displayed position(s))\n`;
            responseMessage += `🏛 Initial Investment: $${overallData.startPrincipalUSD.toFixed(2)}\n`;
            responseMessage += `🏛 Total Holdings: $${overallData.totalPortfolioPrincipalUSD.toFixed(2)}\n`;
            responseMessage += `📈 Holdings Change: $${totalReturn.toFixed(2)} (${totalReturnPercent.toFixed(2)}%)\n`;

            responseMessage += `\n*Fee Performance*\n`;
            responseMessage += `💰 Total Fees Earned: $${overallData.totalFeeUSD.toFixed(2)}\n`;
            responseMessage += `💰 Fees APR: ${feesAPR.toFixed(2)}%\n`;

            const allTimeGains = totalReturn + overallData.totalFeeUSD;
            responseMessage += `\n📈 Total return + Fees: $${allTimeGains.toFixed(2)}\n`;
        } else if (positionMessages.length > 0) {
            responseMessage += `\n⚠️ Could not determine overall portfolio performance (initial investment unknown).\n`;
        }

    } catch (error) {
        console.error("Error in getFormattedPositionData:", error);
        const sanitizedErrorMessage = (error.message || "Unknown error").replace(/[*_`[\]]/g, '');
        responseMessage = `An error occurred while fetching liquidity positions: ${sanitizedErrorMessage}. Please try again later.`;
    }
    return responseMessage;
}


async function generateSnapshotImage(data) {
    const width = 720;
    const height = 1280;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    try {
        if (fs.existsSync('background.jpg')) {
            const background = await loadImage('background.jpg');
            ctx.drawImage(background, 0, 0, width, height);
        } else {
            ctx.fillStyle = '#1a202c';
            ctx.fillRect(0, 0, width, height);
        }
    } catch (e) {
        console.error("Could not load background image:", e);
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, width, height);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(50, 200, width - 100, 600);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 200, width - 100, 600);


    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    
    // ++ CHANGE: Header text is now split into two lines with different sizes ++
    ctx.font = '40px Roboto';
    ctx.fillText(`${data.pair} ${data.feeTier}`, width / 2, 260);
    ctx.font = '30px Roboto';
    ctx.fillText(`${data.timestamp}`, width / 2, 300);

    ctx.font = '32px Roboto';
    ctx.textAlign = 'left';

    const drawLine = (label, value, y) => {
        ctx.fillStyle = '#cccccc';
        ctx.fillText(label, 70, y);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'right';
        ctx.fillText(value, width - 70, y);
        ctx.textAlign = 'left';
    };
    
    const holdingsChangeColor = data.holdingsChange.startsWith('-') ? '#FF6B6B' : '#63FF84';

    drawLine("Current Value:", data.currentValue, 380);
    
    ctx.fillStyle = '#cccccc';
    ctx.fillText("Holdings Change:", 70, 440);
    ctx.fillStyle = holdingsChangeColor;
    ctx.textAlign = 'right';
    ctx.fillText(data.holdingsChange, width - 70, 440);
    ctx.textAlign = 'left';

    drawLine(`Uncollected ${data.t0Symbol}:`, data.fees0, 530);
    drawLine(`Uncollected ${data.t1Symbol}:`, data.fees1, 590);
    drawLine("Total Fees:", data.totalFees, 650);
    drawLine("Fees APR:", data.feesAPR, 710);

    return canvas.toBuffer('image/png');
}

async function handleSnapshotCommand(chatId) {
    try {
        console.log("[DEBUG] '/snapshot' command received. Starting generation...");
        await sendChatAction(chatId, 'upload_photo');
        const allPositionsData = await getPositionsData(myAddress);

        if (allPositionsData.length === 0) {
            await sendMessage(chatId, "No positions with value found to create a snapshot.");
            return;
        }

        for (const data of allPositionsData) {
            console.log(`[DEBUG] [Snapshot] Generating image for tokenId: ${data.tokenId.toString()}`);
            
            const principalUSD = (data.amt0 * data.prices.WETH) + (data.amt1 * data.prices.USDC);
            const positionHoldingsChange = principalUSD - data.currentPositionInitialPrincipalUSD;
            const feeUSD0 = data.fee0 * (data.t0.symbol.toUpperCase() === "WETH" ? data.prices.WETH : data.prices.USDC);
            const feeUSD1 = data.fee1 * (data.t1.symbol.toUpperCase() === "WETH" ? data.prices.WETH : data.prices.USDC);
            const totalPositionFeesUSD = feeUSD0 + feeUSD1;
            
            let feesAPR = "N/A";
            let timestamp = "N/A";

            if (data.positionHistoryAnalysisSucceeded) {
                 const now = new Date();
                 const elapsedMs = now.getTime() - data.currentPositionStartDate.getTime();
                 const rewardsPerYear = elapsedMs > 0 ? totalPositionFeesUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
                 feesAPR = `${((rewardsPerYear / data.currentPositionInitialPrincipalUSD) * 100).toFixed(2)}%`;
                 const adjustedDate = new Date(data.currentPositionStartDate.getTime() + (2 * 60 * 60 * 1000));
                 timestamp = adjustedDate.toISOString().replace('T', ' ').slice(0, 16);
            }

            const snapshotData = {
                timestamp: timestamp,
                pair: `${data.t0.symbol}/${data.t1.symbol}`,
                feeTier: `${Number(data.pos.fee) / 10000}%`,
                currentValue: `$${principalUSD.toFixed(2)}`,
                holdingsChange: `${positionHoldingsChange.toFixed(2)}`,
                t0Symbol: data.t0.symbol,
                t1Symbol: data.t1.symbol,
                fees0: formatTokenAmount(data.fee0, 6),
                fees1: formatTokenAmount(data.fee1, 2),
                totalFees: `$${totalPositionFeesUSD.toFixed(2)}`,
                feesAPR: feesAPR
            };
            
            console.log("[DEBUG] [Snapshot] Data for image:", snapshotData);

            const imageBuffer = await generateSnapshotImage(snapshotData);
            console.log(`[DEBUG] [Snapshot] Image buffer created for tokenId: ${data.tokenId.toString()}. Sending to Telegram...`);
            await sendPhoto(chatId, imageBuffer);
        }

    } catch (error) {
        console.error("Error handling /snapshot command:", error);
        await sendMessage(chatId, "An error occurred while generating snapshots.");
    }
}



// --- Express App Setup for Webhook ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.post(`/bot${TELEGRAM_BOT_TOKEN}/webhook`, async (req, res) => {
    const telegramSecret = req.get('X-Telegram-Bot-Api-Secret-Token');
    if (!WEBHOOK_SECRET || telegramSecret !== WEBHOOK_SECRET) {
        console.warn('Unauthorized webhook access attempt! Invalid or missing secret token.');
        return res.status(403).send('Forbidden: Invalid secret token');
    }
    res.sendStatus(200);
    processTelegramCommand(req.body).catch(error => {
        console.error("Unhandled error in async Telegram command processing:", error);
    });
});

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
        } else if (messageText && messageText.startsWith('/snapshot')) {
             await handleSnapshotCommand(chatId);
        } else if (messageText && messageText.startsWith('/start')) {
            await sendMessage(chatId, "Welcome! I can provide you with information about your Uniswap V3 liquidity positions. Type /positions for a text summary or /snapshot for an image summary.");
        } else {
            await sendMessage(chatId, "I received your message, but I only understand the /positions and /snapshot commands. Please select one from the menu.");
        }
    }
}

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

async function sendPhoto(chatId, photoBuffer, caption = '') {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', photoBuffer, {
        filename: 'snapshot.png',
        contentType: 'image/png',
    });
    if (caption) {
        form.append('caption', caption);
    }

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    try {
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Failed to send photo:', data);
        } else {
             console.log(`[DEBUG] [Snapshot] Successfully sent photo to chat ID: ${chatId}`);
        }
    } catch (error) {
        console.error('Error sending photo to Telegram:', error);
    }
}


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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Telegram webhook URL: ${RENDER_WEBHOOK_URL}/bot${TELEGRAM_BOT_TOKEN}/webhook`);
});
