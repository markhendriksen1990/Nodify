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
// ++ NEW: Import Aave ABIs ++
const { abi: aavePoolAbi } = require('@aave/core-v3/artifacts/contracts/protocol/pool/Pool.sol/Pool.json');
const { abi: aaveDataProviderAbi } = require('@aave/core-v3/artifacts/contracts/misc/AaveProtocolDataProvider.sol/AaveProtocolDataProvider.json');


// --- Configuration from Environment Variables ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const RENDER_WEBHOOK_URL = process.env.RENDER_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// --- Ethers.js Provider and Contract Addresses ---
const chains = {
    base: {
        rpcUrl: "https://base.publicnode.com",
        uniswap: {
            managerAddress: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
            factoryAddress: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'
        },
        aave: {
            poolAddress: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            dataProviderAddress: "0xC4Fcf9893072d61Cc2899C0054877Cb752587981"
        }
    },
    ethereum: {
        rpcUrl: "https://ethereum-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
            factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984"
        },
        aave: {
            poolAddress: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
            dataProviderAddress: "0x497a1994c46d4f6C864904A9f1fac6328Cb7C8a6"
        }
    },
    bnb: {
        rpcUrl: "https://bsc-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
            factoryAddress: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7"
        },
        aave: {
            poolAddress: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
            dataProviderAddress: "0x1e26247502e90b4fab9D0d17e4775e90085D2A35"
        }
    },
    polygon: {
        rpcUrl: "https://polygon-bor-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
            factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984"
        },
        aave: {
            poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            dataProviderAddress: "0x14496b405D62c24F91f04Cda1c69Dc526D56fDE5"
        }
    },
    avalanche: {
        rpcUrl: "https://avalanche-c-chain-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0x655C406EBFa14EE2006250925e54ec43AD184f8B",
            factoryAddress: "0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD"
        },
        aave: {
            poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            dataProviderAddress: "0x14496b405D62c24F91f04Cda1c69Dc526D56fDE5"
        }
    },
    optimism: {
        rpcUrl: "https://optimism-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
            factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984"
        },
        aave: {
            poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            dataProviderAddress: "0x14496b405D62c24F91f04Cda1c69Dc526D56fDE5"
        }
    },
    arbitrum: {
        rpcUrl: "https://arbitrum-one-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
            factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984"
        },
        aave: {
            poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            dataProviderAddress: "0x14496b405D62c24F91f04Cda1c69Dc526D56fDE5"
        }
    }
};

const myAddress = "0x2FD24cC510b7a40b176B05A5Bb628d024e3B6886";

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

async function getTokenMeta(addr, provider) {
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
    return `${days} days, ${hours} hours`;
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


async function getBlockTimestamp(blockNumber, provider) {
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
async function getPositionsData(walletAddress, chain) {
    const chainConfig = chains[chain]?.uniswap;
    if (!chainConfig) {
        throw new Error(`Unsupported chain for Uniswap: ${chain}`);
    }
    const provider = new ethers.JsonRpcProvider(chains[chain].rpcUrl);
    
    const prices = await getUsdPrices();
    const manager = new ethers.Contract(chainConfig.managerAddress, managerAbi, provider);
    const factory = new ethers.Contract(chainConfig.factoryAddress, FactoryAbi, provider);
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

        const t0 = await getTokenMeta(token0Addr, provider);
        const t1 = await getTokenMeta(token1Addr, provider);

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
        
        const positionDataObject = { i, tokenId, t0, t1, pos, nativeTick, amt0, amt1, fee0, fee1, prices, sqrtL, sqrtU, chain };

        try {
            const mintBlock = await getMintEventBlock(manager, tokenId, provider, walletAddress);
            const startTimestampMs = await getBlockTimestamp(mintBlock, provider);
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


async function getFormattedPositionData(allPositionsData, chain) {
    if (allPositionsData.length === 0) {
        return ``; 
    }
    
    let chainReport = "";
    
    for (const data of allPositionsData) {
        let currentPositionMessage = "";
        currentPositionMessage += `\n---------- ${data.chain.toUpperCase()} -- Position #${data.i.toString()} ----------\n`;
        currentPositionMessage += `🔹 Token ID: \`${data.tokenId.toString()}\`\n`;
        currentPositionMessage += `🔸 Pool: ${data.t0.symbol}/${data.t1.symbol} (${Number(data.pos.fee)/10000}% fee)\n`;

        if (data.positionHistoryAnalysisSucceeded) {
            const adjustedDate = new Date(data.currentPositionStartDate.getTime() + (2 * 60 * 60 * 1000));
            const day = adjustedDate.getDate().toString().padStart(2, '0');
            const month = (adjustedDate.getMonth() + 1).toString().padStart(2, '0');
            const year = adjustedDate.getFullYear();
            const hours = adjustedDate.getHours().toString().padStart(2, '0');
            const minutes = adjustedDate.getMinutes().toString().padStart(2, '0');

            currentPositionMessage += `📅 Created: ${day}-${month}-${year} ${hours}:${minutes}\n`;
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
        
        chainReport += currentPositionMessage;
    }

    return chainReport;
}

// ... (Rest of your existing code)
