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

// ++ NEW: ABIs for Aave ++
const aavePoolAbi = [
    "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
    "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)"
];
const aaveDataProviderAbi = [
    "function getReserveData(address asset) view returns (tuple(uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint40, uint16, bool, bool, bool))",
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

// ... (Rest of the Uniswap and formatting functions remain the same) ...

// ++ NEW: Aave Data Fetching and Formatting Logic ++
async function getAaveData(walletAddress, chain) {
    const chainConfig = chains[chain]?.aave;
    if (!chainConfig) {
        return null;
    }
    const provider = new ethers.JsonRpcProvider(chains[chain].rpcUrl);

    try {
        const pool = new ethers.Contract(chainConfig.poolAddress, aavePoolAbi, provider);
        const dataProvider = new ethers.Contract(chainConfig.dataProviderAddress, aaveDataProviderAbi, provider);

        const accountData = await pool.getUserAccountData(walletAddress);
        if (accountData.totalDebtBase.toString() === '0') {
            return null; // No Aave position
        }
        
        const healthFactor = parseFloat(formatUnits(accountData.healthFactor, 18));
        let healthStatus = "Safe";
        if (healthFactor < 1.5) healthStatus = "Careful";
        if (healthFactor < 1.1) healthStatus = "DANGER";
        
        // This is a simplified version; a full implementation would scan for all borrow events
        // to determine principal and start date accurately. For this example, we'll
        // present the data available from the main contract calls.
        const borrowedAssets = []; // This would be populated by scanning events

        // For demonstration, let's assume we found one borrowed asset
        // In a full implementation, you would scan for `Borrow` events for the user
        // and then get the reserve data for each borrowed asset.
        
        return {
            totalCollateral: `$${parseFloat(formatUnits(accountData.totalCollateralBase, 8)).toFixed(2)}`,
            totalDebt: `$${parseFloat(formatUnits(accountData.totalDebtBase, 8)).toFixed(2)}`,
            healthFactor: `${healthFactor.toFixed(2)} - ${healthStatus}`,
            borrowedAssets: "Note: Borrowed asset details require event scanning.", // Placeholder
            lendingCosts: "Note: Lending cost calculation requires event scanning." // Placeholder
        };

    } catch (error) {
        console.error(`Error fetching Aave data on ${chain}:`, error);
        return null;
    }
}


// --- Main Command Processing ---
async function processTelegramCommand(update) {
    if (update.message) {
        const messageText = update.message.text;
        const chatId = update.message.chat.id;

        const [command, chainArg] = messageText.split(' ');
        const chainName = chainArg?.toLowerCase();

        try {
            if (command === '/positions' || command === '/snapshot') {
                const chainsToQuery = chainName && chains[chainName] ? [chainName] : Object.keys(chains);

                await sendMessage(chatId, `Searching for positions on: *${chainsToQuery.join(', ')}*... This may take a moment.`);
                if (command === '/positions') await sendChatAction(chatId, 'typing');
                if (command === '/snapshot') await sendChatAction(chatId, 'upload_photo');

                // ++ NEW: Fetch both Uniswap and Aave data in parallel ++
                const promises = chainsToQuery.map(async (chain) => {
                    const uniPromise = getPositionsData(myAddress, chain).catch(e => ({ error: e, type: 'uniswap' }));
                    const aavePromise = getAaveData(myAddress, chain).catch(e => ({ error: e, type: 'aave' }));
                    return { chain, uniData: await uniPromise, aaveData: await aavePromise };
                });
                
                const results = await Promise.all(promises);

                let allChainMessages = "";
                let successfulChains = [];
                let failedChains = [];

                for (const result of results) {
                    if (result.uniData.error || result.aaveData.error) {
                        failedChains.push(result.chain);
                        if(result.uniData.error) console.error(`Failed to fetch Uniswap data for ${result.chain}:`, result.uniData.error);
                        if(result.aaveData.error) console.error(`Failed to fetch Aave data for ${result.chain}:`, result.aaveData.error);
                        continue;
                    }
                    
                    if (result.uniData.length > 0 || result.aaveData) {
                         successfulChains.push(result.chain);
                    }

                    if (command === '/positions') {
                        let chainMessage = "";
                        if(result.uniData.length > 0) {
                            chainMessage += await getFormattedPositionData(result.uniData, result.chain);
                        }
                        if(result.aaveData) {
                            chainMessage += `\n-------------- Aave Lending --------------\n`;
                            chainMessage += `Total Collateral: ${result.aaveData.totalCollateral}  Total Debt: ${result.aaveData.totalDebt}\n`;
                            chainMessage += `Health Factor: ${result.aaveData.healthFactor}\n`;
                            // These lines would be populated with real data in a full implementation
                            chainMessage += `Borrowed Assets: N/A (Requires event scanning)\n`;
                            chainMessage += `Actual lending costs: N/A (Requires event scanning)\n`;
                        }
                        allChainMessages += chainMessage;
                    }
                }
                
                let finalMessage = `*👜 Wallet: ${myAddress.substring(0, 6)}...${myAddress.substring(38)}*\n\n`;
                
                if (allChainMessages) {
                    finalMessage += allChainMessages;
                } else if (successfulChains.length > 0) {
                    finalMessage += "No active positions found on the queried chains.";
                }

                if (failedChains.length > 0) {
                    finalMessage += `\n\n⚠️ Could not fetch data for the following chains: *${failedChains.join(', ')}*.`;
                }

                await sendMessage(chatId, finalMessage);

            } else if (command === '/start') {
                const startMessage = `Welcome! I am a Uniswap V3 & Aave V3 tracker.\n\n` +
                                     `*/positions [chain]* - Get a detailed summary.\n` +
                                     `*/snapshot [chain]* - Get an image snapshot (Uniswap only).\n\n` +
                                     `If you don't specify a chain, I will search all supported chains.\n\n` +
                                     `*Supported Chains:*\n` +
                                     Object.keys(chains).join(', ');
                await sendMessage(chatId, startMessage);
            } else {
                await sendMessage(chatId, "I only understand the /positions and /snapshot commands.");
            }
        } catch (error) {
            console.error("Error in processTelegramCommand:", error);
            await sendMessage(chatId, `An unexpected error occurred. Please try again later.`);
        }
    }
}


// ... (The rest of the Express server setup, sendMessage, sendPhoto, sendChatAction functions remain the same) ...

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
             console.log(`Successfully sent photo to chat ID: ${chatId}`);
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

// Start the Express server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    setTelegramMenuCommands();
    console.log(`Telegram webhook URL: ${RENDER_WEBHOOK_URL}/bot${TELEGRAM_BOT_TOKEN}/webhook`);
});
