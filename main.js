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
const { abi: aavePoolAbi } = require('@aave/core-v3/artifacts/contracts/protocol/pool/Pool.sol/Pool.json');
const { abi: aaveDataProviderAbi } = require('@aave/core-v3/artifacts/contracts/misc/AaveProtocolDataProvider.sol/AaveProtocolDataProvider.json');

// --- Polyfill to allow JSON.stringify to handle BigInt ---
BigInt.prototype.toJSON = function () {
    return this.toString();
};

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
    unichain: {
        rpcUrl: "https://unichain-rpc.publicnode.com",
        uniswap: {
            managerAddress: "0x943e6e07a7e8e791dafc44083e54041d743c46e9",
            factoryAddress: '0x1f98400000000000000000000000000000000003'
        },
        aave: {
            poolAddress: "",
            dataProviderAddress: ""
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

// --- In-Memory Caches for API Data ---
const geckoChainIdCache = {};
const geckoTokenIdCache = {};
const historicalPriceCache = {};
let coingeckoHistoricalCooldownUntil = 0;

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
    "function balanceOf(address owner) view returns (uint256)", "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)", "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256, uint256, uint128, uint128)", "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)", "function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external returns (uint256 amount0, uint256 amount1)"
];
const poolAbi = [
    "function slot0() external view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)", "function token1() view returns (address)"
];
const erc20Abi = [
    "function symbol() view returns (string)", "function decimals() view returns (uint8)"
];

const UINT128_MAX = "340282366920938463463374607431768211455";
const { formatUnits } = ethers;

// --- UTILITY FUNCTIONS ---
function formatSignificant(number, digits = 6) {
    if (typeof number !== 'number' || isNaN(number)) return '0';
    // Uses toLocaleString to get significant digits without scientific notation
    return number.toLocaleString('en-US', {
        maximumSignificantDigits: digits,
        useGrouping: false // Ensures no commas, e.g., 123456 not 123,456
    });
}

function formatUSD(number) {
    if (typeof number !== 'number' || isNaN(number)) return '$0,00';
    // Uses German locale to get '.' for thousands and ',' for decimal
    const formatted = number.toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return `$${formatted}`;
}

function createHeader(text) {
    const totalWidth = 33; // Width of "====== OVERALL PERFORMANCE ======"
    const textWidth = text.length;
    if (textWidth >= totalWidth) {
        return text;
    }
    const paddingWidth = totalWidth - textWidth - 2; // -2 for spaces
    const leftPadding = Math.floor(paddingWidth / 2);
    const rightPadding = Math.ceil(paddingWidth / 2);
    return `${'-'.repeat(leftPadding)} ${text} ${'-'.repeat(rightPadding)}`;
}

function padString(str, length) {
    return str.padEnd(length, ' ');
}

function formatHealthFactor(healthString) {
    const [value, status] = healthString.split(' - ');
    switch (status) {
        case "Safe":
            return `${value} - Safe ✅`;
        case "Careful":
            return `${value} - ⚠️ Careful ⚠️`;
        case "DANGER":
            return `${value} - 🚨🚨🚨🚨🚨 DANGER 🚨🚨🚨🚨🚨`;
        default:
            return healthString;
    }
}

function formatElapsedDaysHours(ms) {
    if (typeof ms !== 'number' || ms < 0) return '0 d, 0 h';
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days} days, ${hours} hours`;
}

function tickToPrice(tick, t0, t1) {
    const priceRatio = Math.pow(1.0001, Number(tick));
    const decimalAdjustment = Math.pow(10, Number(t0.decimals) - Number(t1.decimals));
    return priceRatio * decimalAdjustment;
}

function tickToSqrtPriceX96(tick) {
    const ratio = Math.pow(1.0001, Number(tick));
    const product = Math.sqrt(ratio) * (2 ** 96);
    if (!Number.isFinite(product)) { return 0n; }
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

// --- BLOCK FUNCTIONS ---
async function getMintEventBlock(manager, tokenId, provider, ownerAddress) {
    const latestBlock = await provider.getBlockNumber();
    const zeroAddress = ethers.ZeroAddress;
    const INITIAL_RPC_QUERY_WINDOW = 49999;
    const maxRetries = 5;
    let toBlock = latestBlock;
    ownerAddress = ownerAddress.toLowerCase();
    while (toBlock >= 0) {
        let currentQueryWindow = INITIAL_RPC_QUERY_WINDOW;
        let fromBlock = toBlock - currentQueryWindow;
        if (fromBlock < 0) { fromBlock = 0; }
        const filter = manager.filters.Transfer(zeroAddress, null, tokenId);
        let success = false;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const events = await manager.queryFilter(filter, fromBlock, toBlock);
                const mint = events.find(e => e.args && e.args.to.toLowerCase() === ownerAddress);
                if (mint) { return mint.blockNumber; }
                success = true;
                break;
            } catch (e) {
                const errorMessage = e.message || "";
                if (errorMessage.includes("invalid block range") || errorMessage.includes("block range is too wide")) {
                    currentQueryWindow = Math.floor(currentQueryWindow / 2);
                    if (currentQueryWindow < 1) currentQueryWindow = 1;
                    fromBlock = toBlock - currentQueryWindow;
                    if (fromBlock < 0) fromBlock = 0;
                    console.warn(`Attempt ${attempt} for tokenId ${tokenId}: Block range too large. Retrying with smaller window: ${currentQueryWindow}`);
                    await new Promise(res => setTimeout(res, 1000 * attempt));
                } else {
                    console.error(`Unrecoverable error querying logs for tokenId ${tokenId}:`, e);
                    throw e;
                }
            }
        }
        if (!success) {
            console.error(`All ${maxRetries} retry attempts failed for block range ending at ${toBlock} on tokenId ${tokenId}.`);
        }
        toBlock = toBlock - INITIAL_RPC_QUERY_WINDOW - 1;
    }
    throw new Error(`Mint event not found for tokenId ${tokenId} after scanning all blocks.`);
}

async function getBlockTimestamp(blockNumber, provider) {
    const block = await provider.getBlock(blockNumber);
    return block.timestamp * 1000;
}

// --- Aave-Specific Functions ---
async function getAaveBorrowEvents(pool, provider, userAddress) {
    const latestBlock = await provider.getBlockNumber();
    const borrowFilter = pool.filters.Borrow(null, null, userAddress);
    let events = [];
    let fromBlock = 0;
    const initialWindow = 49999;
    while (fromBlock <= latestBlock) {
        let toBlock = fromBlock + initialWindow;
        if (toBlock > latestBlock) { toBlock = latestBlock; }
        let success = false;
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                const newEvents = await pool.queryFilter(borrowFilter, fromBlock, toBlock);
                events = events.concat(newEvents);
                success = true;
                break;
            } catch (e) {
                const errorMessage = e.message || "";
                if (errorMessage.includes("block range") || errorMessage.includes("exceed maximum")) {
                    const smallerWindow = Math.floor((toBlock - fromBlock) / 2);
                    toBlock = fromBlock + smallerWindow;
                    console.warn(`Aave event scan failed (Attempt ${attempt}): Range too large. Retrying with window size ${smallerWindow}.`);
                    await new Promise(res => setTimeout(res, 500 * attempt));
                } else {
                    console.error(`Unrecoverable error fetching Aave borrow events:`, e);
                    throw e;
                }
            }
        }
        if (!success) {
            console.error(`Failed to fetch Aave events for range ${fromBlock}-${toBlock} after multiple retries.`);
        }
        fromBlock = toBlock + 1;
    }
    return events;
}
async function getAaveData(walletAddress, chain) {
    const chainConfig = chains[chain]?.aave;
    if (!chainConfig || !chainConfig.poolAddress) {
        return null;
    }
    const provider = new ethers.JsonRpcProvider(chains[chain].rpcUrl);
    try {
        const pool = new ethers.Contract(chainConfig.poolAddress, aavePoolAbi, provider);
        const dataProvider = new ethers.Contract(chainConfig.dataProviderAddress, aaveDataProviderAbi, provider);
        const accountData = await pool.getUserAccountData(walletAddress);
        if (accountData.totalCollateralBase.toString() === '0') {
            return null;
        }
        const healthFactor = parseFloat(formatUnits(accountData.healthFactor, 18));
        let healthStatus = "Safe";
        if (healthFactor < 1.5) healthStatus = "Careful";
        if (healthFactor < 1.1) healthStatus = "DANGER";
        let borrowedAssetsString = "None";
        let lendingCostsString = "$0.00 over 0 d";
        if (accountData.totalDebtBase.toString() > '0') {
            const allReserves = await dataProvider.getAllReservesTokens();
            let borrowedAssetDetails = [];
            let totalDebtUSD = parseFloat(formatUnits(accountData.totalDebtBase, 8));
            let weightedApySum = 0;
            let totalBorrowValue = 0;
            for (const reserve of allReserves) {
                try {
                    const userReserveData = await dataProvider.getUserReserveData(reserve.tokenAddress, walletAddress);
                    const currentDebt = userReserveData.currentStableDebt > userReserveData.currentVariableDebt ? userReserveData.currentStableDebt : userReserveData.currentVariableDebt;
                    const debtType = userReserveData.currentStableDebt > userReserveData.currentVariableDebt ? 'Stable' : 'Variable';
                    if (currentDebt > 0n) {
                        const reserveAssetContract = new ethers.Contract(reserve.tokenAddress, erc20Abi, provider);
                        const decimals = await reserveAssetContract.decimals();
                        const formattedDebt = Number(ethers.formatUnits(currentDebt, decimals));
                        let apy = 0;
                        try {
                            const reserveData = await pool.getReserveData(reserve.tokenAddress);
                            const borrowRate = debtType === 'Stable' ? reserveData.currentStableBorrowRate : reserveData.currentVariableBorrowRate;
                            const apr = Number(ethers.formatUnits(borrowRate, 25));
                            apy = (((1 + (apr / 100) / 365) ** 365) - 1) * 100;
                        } catch (e) {
                            console.error(`--> Could not fetch APY for ${reserve.symbol}:`, e.message);
                        }
                        borrowedAssetDetails.push(`• ${reserve.symbol}: ${formattedDebt.toFixed(2)} @ ${apy.toFixed(2)}% APY (${debtType} rate)`);
                        weightedApySum += formattedDebt * apy;
                        totalBorrowValue += formattedDebt;
                    }
                } catch (assetError) {}
            }
            if (borrowedAssetDetails.length > 0) {
                borrowedAssetsString = borrowedAssetDetails.join('\n');
            }
            const borrowEvents = await getAaveBorrowEvents(pool, provider, walletAddress);
            if (borrowEvents.length > 0) {
                let earliestBorrowTimestamp = Date.now();
                for (const event of borrowEvents) {
                    const block = await provider.getBlock(event.blockNumber);
                    if (block.timestamp * 1000 < earliestBorrowTimestamp) {
                        earliestBorrowTimestamp = block.timestamp * 1000;
                    }
                }
                const loanDurationMs = Date.now() - earliestBorrowTimestamp;
                const loanDurationInDays = loanDurationMs / (1000 * 60 * 60 * 24);
                const averageApy = totalBorrowValue > 0 ? weightedApySum / totalBorrowValue : 0;
                const estimatedCost = totalDebtUSD * (averageApy / 100) * (loanDurationInDays / 365);
                lendingCostsString = `$${estimatedCost.toFixed(2)} over ${formatElapsedDaysHours(loanDurationMs)}`;
            }
        }
        return {
            totalCollateral: `$${parseFloat(formatUnits(accountData.totalCollateralBase, 8)).toFixed(2)}`,
            totalDebt: `$${parseFloat(formatUnits(accountData.totalDebtBase, 8)).toFixed(2)}`,
            healthFactor: `${healthFactor.toFixed(2)} - ${healthStatus}`,
            borrowedAssets: borrowedAssetsString,
            lendingCosts: lendingCostsString
        };
    } catch (error) {
        console.error(`Error fetching Aave data on ${chain}:`, error);
        return null;
    }
}

// --- COINGECKO HELPER FUNCTIONS ---
async function getCoinGeckoChainIdMap() {
    if (geckoChainIdCache.map) return geckoChainIdCache.map;
    console.log("Fetching CoinGecko network list for the first time...");
    const allNetworks = [];
    let url = `https://api.coingecko.com/api/v3/onchain/networks?x_cg_demo_api_key=CG-UVFFYYLSfEA26y4Dd31pYcLL`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
        while (url) {
            console.log(`[DEBUG] Fetching page from URL: ${url}`);
            const pageRes = await fetch(url, { signal: controller.signal });
             if (!pageRes.ok) {
                console.error(`[DEBUG] API for page responded with status: ${pageRes.status}`);
                throw new Error(`API call failed with status ${pageRes.status}`);
            }
            const pageData = await pageRes.json();
            allNetworks.push(...pageData.data);
            url = pageData.links.next;
        }
        clearTimeout(timeoutId);
        console.log(`[DEBUG] Finished fetching all pages. Total networks found: ${allNetworks.length}`);
        const chainIdMap = {};
        for (const network of allNetworks) {
            chainIdMap[network.attributes.name] = network.id;
        }
        geckoChainIdCache.map = chainIdMap;
        return chainIdMap;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error("[DEBUG] ERROR: The request to CoinGecko timed out after 15 seconds.");
        } else {
            console.error("[DEBUG] ERROR: An error occurred while fetching the CoinGecko network list:", error);
        }
        return {};
    }
}

async function getCoinId(coingeckoChainId, tokenAddress) {
    const cacheKey = `${coingeckoChainId}-${tokenAddress}`;
    if (geckoTokenIdCache[cacheKey]) return geckoTokenIdCache[cacheKey];
    try {
        const url = `https://api.coingecko.com/api/v3/onchain/networks/${coingeckoChainId}/tokens/${tokenAddress}/info?x_cg_demo_api_key=CG-UVFFYYLSfEA26y4Dd31pYcLL`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const coinId = data.data.attributes.coingecko_coin_id;
        if (coinId) {
            geckoTokenIdCache[cacheKey] = coinId;
        }
        return coinId;
    } catch (error) {
        console.error(`Could not fetch CoinGecko ID for ${tokenAddress} on ${coingeckoChainId}: ${error.message}`);
        return null;
    }
}

async function fetchCurrentPrice(coinId) {
    if (!coinId) return 0;
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}?x_cg_demo_api_key=CG-UVFFYYLSfEA26y4Dd31pYcLL`;
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`CoinGecko Current Price API responded with status: ${res.status}`);
            return 0;
        }
        const data = await res.json();
        return data.market_data?.current_price?.usd || 0;
    } catch (error) {
        console.error(`Failed to get CURRENT USD price from CoinGecko for ${coinId}: ${error.message}`);
        return 0;
    }
}

async function fetchHistoricalPrice(coinId, dateStr) {
    if (!coinId) return 0;
    const cacheKey = `${coinId}-${dateStr}`;
    if (historicalPriceCache[cacheKey]) return historicalPriceCache[cacheKey];
    if (Date.now() < coingeckoHistoricalCooldownUntil) {
        console.warn(`CoinGecko Hist. API on cooldown for ${cacheKey}.`);
        return 0;
    }
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}&x_cg_demo_api_key=CG-UVFFYYLSfEA26y4Dd31pYcLL`;
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`CoinGecko Historical API responded with status: ${res.status}`);
            if (res.status === 429) {
                const cooldownDuration = 60 * 1000;
                coingeckoHistoricalCooldownUntil = Date.now() + cooldownDuration;
                console.warn(`CoinGecko Historical API rate limit hit. Setting cooldown for ${cooldownDuration / 1000} seconds.`);
            }
            return 0;
        }
        const data = await res.json();
        const price = data.market_data?.current_price?.usd || 0;
        historicalPriceCache[cacheKey] = price;
        return price;
    } catch (error) {
        console.error(`Failed to get HISTORICAL USD price for ${coinId}: ${error.message}`);
        return 0;
    }
}

// --- Main Data Fetching and Formatting Logic ---
async function getPositionsData(walletAddress, chainName, coingeckoChainIdMap) {
    const chainConfig = chains[chainName]?.uniswap;
    if (!chainConfig) { throw new Error(`Unsupported chain: ${chainName}`); }
    const provider = new ethers.JsonRpcProvider(chains[chainName].rpcUrl);

    const manager = new ethers.Contract(chainConfig.managerAddress, managerAbi, provider);
    const factory = new ethers.Contract(chainConfig.factoryAddress, FactoryAbi, provider);
    const balance = await manager.balanceOf(walletAddress);
    if (balance === 0n) { return []; }

    const capitalizedChainName = Object.keys(coingeckoChainIdMap).find(key => key.toLowerCase() === chainName.toLowerCase());
    const coingeckochainid = coingeckoChainIdMap[capitalizedChainName];
    if (!coingeckochainid) {
        console.warn(`Could not find CoinGecko Chain ID for ${chainName}. Price lookups will be unavailable.`);
    }

    const positionsData = [];
    for (let i = 0n; i < balance; i++) {
        const tokenId = await manager.tokenOfOwnerByIndex(walletAddress, i);
        const pos = await manager.positions(tokenId);
        const dynamicPoolAddress = await factory.getPool(pos.token0, pos.token1, pos.fee);
        if (dynamicPoolAddress === ethers.ZeroAddress) { continue; }

        const pool = new ethers.Contract(dynamicPoolAddress, poolAbi, provider);
        const slot0 = await pool.slot0();
        const [token0Addr, token1Addr] = await Promise.all([pool.token0(), pool.token1()]);
        const [t0, t1] = await Promise.all([getTokenMeta(token0Addr, provider), getTokenMeta(token1Addr, provider)]);
        
        if (coingeckochainid) {
            const coinId0 = await getCoinId(coingeckochainid, t0.address);
            const coinId1 = await getCoinId(coingeckochainid, t1.address);
            t0.priceUSD = await fetchCurrentPrice(coinId0);
            t1.priceUSD = await fetchCurrentPrice(coinId1);
        } else {
            t0.priceUSD = 0;
            t1.priceUSD = 0;
        }

        const sqrtP = slot0[0];
        const [sqrtL, sqrtU] = [tickToSqrtPriceX96(Number(pos.tickLower)), tickToSqrtPriceX96(Number(pos.tickUpper))];
        const [raw0, raw1] = getAmountsFromLiquidity(pos.liquidity, sqrtP, sqrtL, sqrtU);
        const amt0 = parseFloat(formatUnits(raw0, t0.decimals));
        const amt1 = parseFloat(formatUnits(raw1, t1.decimals));

        const xp = await manager.collect.staticCall({ tokenId, recipient: walletAddress, amount0Max: UINT128_MAX, amount1Max: UINT128_MAX });
        const fee0 = parseFloat(formatUnits(xp[0], t0.decimals));
        const fee1 = parseFloat(formatUnits(xp[1], t1.decimals));

        if (amt0 === 0 && amt1 === 0 && fee0 === 0 && fee1 === 0) { continue; }

        const positionDataObject = { i: i.toString(), tokenId: tokenId.toString(), t0, t1, pos, nativeTick: slot0[1].toString(), amt0, amt1, fee0, fee1, chain: chainName };

        try {
            if (coingeckochainid) {
                const mintBlock = await getMintEventBlock(manager, tokenId, provider, walletAddress);
                const startTimestampMs = await getBlockTimestamp(mintBlock, provider);
                const startDate = new Date(startTimestampMs);
                positionDataObject.currentPositionStartDate = startDate;
                const dateStr = `${startDate.getDate().toString().padStart(2, '0')}-${(startDate.getMonth() + 1).toString().padStart(2, '0')}-${startDate.getFullYear()}`;
                
                const coinId0 = await getCoinId(coingeckochainid, t0.address);
                const coinId1 = await getCoinId(coingeckochainid, t1.address);
                const histPrice0 = await fetchHistoricalPrice(coinId0, dateStr);
                const histPrice1 = await fetchHistoricalPrice(coinId1, dateStr);

                const histPriceRatio = histPrice1 !== 0 ? histPrice0 / histPrice1 : 0;
                const decimalAdjustment = Math.pow(10, Number(t1.decimals) - Number(t0.decimals));
                const historicalPriceOfToken0 = histPriceRatio * decimalAdjustment;
                
                const estimatedHistoricalTick = Math.log(historicalPriceOfToken0) / Math.log(1.0001);
                if (!Number.isFinite(estimatedHistoricalTick)) {
                    throw new Error("Could not estimate a valid historical tick from price data.");
                }
                const historicalSqrtPriceX96 = tickToSqrtPriceX96(Number(estimatedHistoricalTick));

                const [histAmt0_raw, histAmt1_raw] = getAmountsFromLiquidity(pos.liquidity, historicalSqrtPriceX96, sqrtL, sqrtU);
                positionDataObject.histAmount0 = parseFloat(formatUnits(histAmt0_raw, t0.decimals));
                positionDataObject.histAmount1 = parseFloat(formatUnits(histAmt1_raw, t1.decimals));
                
                positionDataObject.histPrincipalUSD = (positionDataObject.histAmount0 * histPrice0) + (positionDataObject.histAmount1 * histPrice1);
                positionDataObject.positionHistoryAnalysisSucceeded = positionDataObject.histPrincipalUSD > 0;
            }
        } catch (error) {
            console.error(`ERROR during historical analysis for token ${tokenId.toString()}: ${error.message}`);
            positionDataObject.positionHistoryAnalysisSucceeded = false;
        }
        positionsData.push(positionDataObject);
    }
    return positionsData;
}

function formatPositionData(data, walletAddress) {
    let message = "";
    message += `\n${createHeader(`${data.chain.toUpperCase()} -- Position #${data.i}`)}\n`;
    message += `${padString('🔹 Token ID:', 25)} ${data.tokenId}\n`;
    message += `${padString('🔸 Pool:', 25)} ${data.t0.symbol}/${data.t1.symbol} (${Number(data.pos.fee) / 10000}% fee)\n`;

    if (data.positionHistoryAnalysisSucceeded) {
        const date = data.currentPositionStartDate;
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        message += `${padString('📅 Created:', 25)} ${day}-${month}-${year} ${hours}:${minutes}\n`;
        message += `${padString('💰 Initial Investment:', 25)} ${formatUSD(data.histPrincipalUSD)}\n`;
    } else {
        message += `📅 Created: (Date unavailable)\n`;
        message += `💰 Initial Investment: (Unavailable)\n`;
    }

    const lowerPrice = tickToPrice(data.pos.tickLower, data.t0, data.t1);
    const upperPrice = tickToPrice(data.pos.tickUpper, data.t0, data.t1);
    const currentPrice = tickToPrice(data.nativeTick, data.t0, data.t1);

    const value0 = data.amt0 * data.t0.priceUSD;
    const value1 = data.amt1 * data.t1.priceUSD;
    const totalValue = value0 + value1;
    const ratio0 = totalValue > 0 ? (value0 / totalValue) * 100 : 0;
    const ratio1 = totalValue > 0 ? (value1 / totalValue) * 100 : 0;

    message += `\nPrice Information\n`;
    message += `${padString('Range:', 17)} ${formatSignificant(lowerPrice)} - ${formatSignificant(upperPrice)} ${data.t1.symbol}/${data.t0.symbol}\n`;
    message += `${padString('Current Price:', 17)} ${formatSignificant(currentPrice)} ${data.t1.symbol}/${data.t0.symbol}\n`;
    message += `${padString('Ratio:', 17)} ${data.t0.symbol}/${data.t1.symbol} \`${Math.round(ratio0)}%/${Math.round(ratio1)}%\`\n`;

    const inRange = BigInt(data.nativeTick) >= BigInt(data.pos.tickLower) && BigInt(data.nativeTick) < BigInt(data.pos.tickUpper);
    message += `${padString('📍 In Range?', 17)} ${inRange ? "✅ Yes" : "❌❌❌ NO ❌❌❌"}\n`;

    const holdingsUSD = value0 + value1;
    message += `\nCurrent Holdings\n`;
    const holdingsStr0 = `🏛 ${formatSignificant(data.amt0)} ${data.t0.symbol}`;
    message += `${padString(holdingsStr0, 25)} ${formatUSD(value0)}\n`;
    const holdingsStr1 = `🏛 ${formatSignificant(data.amt1)} ${data.t1.symbol}`;
    message += `${padString(holdingsStr1, 25)} ${formatUSD(value1)}\n`;
    message += `${padString('🏛 Holdings:', 25)} ${formatUSD(holdingsUSD)}\n`;

    if (data.positionHistoryAnalysisSucceeded) {
        const holdingsChange = holdingsUSD - data.histPrincipalUSD;
        message += `${padString('📈 Holdings change:', 25)} ${formatUSD(holdingsChange)}\n`;
        }

    const feeUSD0 = data.fee0 * data.t0.priceUSD;
    const feeUSD1 = data.fee1 * data.t1.priceUSD;
    const totalFeesUSD = feeUSD0 + feeUSD1;

    message += `\nUncollected Fees\n`;
    const feeStr0 = `💰 ${formatSignificant(data.fee0)} ${data.t0.symbol}`;
    message += `${padString(feeStr0, 25)} ${formatUSD(feeUSD0)}\n`;
    const feeStr1 = `💰 ${formatSignificant(data.fee1)} ${data.t1.symbol}`;
    message += `${padString(feeStr1, 25)} ${formatUSD(feeUSD1)}\n`;
    message += `${padString('💰 Total Fees:', 25)} ${formatUSD(totalFeesUSD)}\n`;

    if (data.positionHistoryAnalysisSucceeded && data.histPrincipalUSD > 0) {
        const now = new Date();
        const elapsedMs = now.getTime() - data.currentPositionStartDate.getTime();
        const rewardsPerYear = elapsedMs > 0 ? totalFeesUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
        const feesAPR = (rewardsPerYear / data.histPrincipalUSD) * 100;

        message += `\nFee Performance\n`;
        message += `${padString('💧 Fees per hour:', 25)} ${formatUSD(rewardsPerYear / 365.25 / 24)}\n`;
        message += `${padString('💧 Fees per day:', 25)} ${formatUSD(rewardsPerYear / 365.25)}\n`;
        message += `${padString('💧 Fees per month:', 25)} ${formatUSD(rewardsPerYear / 12)}\n`;
        message += `${padString('💧 Fees per year:', 25)} ${formatUSD(rewardsPerYear)}\n`;
        message += `${padString('💧 Fees APR:', 25)} ${feesAPR.toFixed(2)}%\n`;
    }

    const positionValue = holdingsUSD + totalFeesUSD;
    message += `${padString('\n🏦 Position Value:', 26)} ${formatUSD(positionValue)}\n`;
    if (data.positionHistoryAnalysisSucceeded) {
        const totalReturn = positionValue - data.histPrincipalUSD;
        message += `${padString('📈 Position return+Fees:', 25)} ${formatUSD(totalReturn)}\n`;
    }

    return message;
}

// --- Execution Block (Now for Telegram Bot) ---
const addressToMonitor = "0x2FD24cC510b7a40b176B05A5Bb628d024e3B6886";
const allChains = Object.keys(chains);

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

async function handleSnapshotCommand(allPositionsData, chain, chatId) {
    if (allPositionsData.length === 0) {
        return;
    }

    for (const data of allPositionsData) {
        const holdingsUSD = (data.amt0 * data.t0.priceUSD) + (data.amt1 * data.t1.priceUSD);
        const feeUSD0 = data.fee0 * data.t0.priceUSD;
        const feeUSD1 = data.fee1 * data.t1.priceUSD;
        const totalPositionFeesUSD = feeUSD0 + feeUSD1;
        
        let feesAPR = "N/A";
        let timestamp = "N/A";
        let holdingsChange = "N/A";

        if (data.positionHistoryAnalysisSucceeded) {
             const now = new Date();
             const elapsedMs = now.getTime() - data.currentPositionStartDate.getTime();
             const rewardsPerYear = elapsedMs > 0 ? totalPositionFeesUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
             if (data.histPrincipalUSD > 0) {
                feesAPR = `${((rewardsPerYear / data.histPrincipalUSD) * 100).toFixed(2)}%`;
             }
             holdingsChange = (holdingsUSD - data.histPrincipalUSD).toFixed(2);

             const adjustedDate = new Date(data.currentPositionStartDate.getTime() + (2 * 60 * 60 * 1000));
             const day = adjustedDate.getDate().toString().padStart(2, '0');
             const month = (adjustedDate.getMonth() + 1).toString().padStart(2, '0');
             const year = adjustedDate.getFullYear();
             const hours = adjustedDate.getHours().toString().padStart(2, '0');
             const minutes = adjustedDate.getMinutes().toString().padStart(2, '0');
             timestamp = `${day}-${month}-${year} ${hours}:${minutes}`;
        }

        const snapshotData = {
            timestamp: timestamp,
            pair: `${data.t0.symbol}/${data.t1.symbol}`,
            feeTier: `${(Number(data.pos.fee) / 10000).toFixed(2)}%`,
            currentValue: `$${holdingsUSD.toFixed(2)}`,
            holdingsChange: holdingsChange,
            t0Symbol: data.t0.symbol,
            t1Symbol: data.t1.symbol,
            // --- CORRECTED LINES ---
            // Replaced the old formatTokenAmount with the correct formatSignificant function
            fees0: formatSignificant(data.fee0),
            fees1: formatSignificant(data.fee1),
            totalFees: `$${totalPositionFeesUSD.toFixed(2)}`,
            feesAPR: feesAPR
        };
        
        const imageBuffer = await generateSnapshotImage(snapshotData);
        await sendPhoto(chatId, imageBuffer, `Position on ${chain}`);
    }
}

// --- Telegram API Functions ---
async function setTelegramMenuCommands() {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`;
    const commands = [
        { command: 'start', description: 'Info about this bot.' },
        { command: 'positions', description: 'Get a summary of your DeFi positions.' },
        { command: 'snapshot', description: 'Get a visual snapshot of your Uniswap positions.' }
    ];
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commands })
        });
        const data = await response.json();
        if (data.ok) {
            console.log('Telegram menu commands were set successfully.');
        } else {
            console.error('Failed to set Telegram menu commands:', data.description);
        }
    } catch (error) {
        console.error('Error setting Telegram menu commands:', error);
    }
}

async function sendMessage(chatId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        // Wrap the entire message in a MarkdownV2 code block to preserve spacing
        const formattedText = "```\n" + text + "\n```";
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: formattedText, parse_mode: 'MarkdownV2' })
        });
    } catch (error) {
        console.error('Failed to send Telegram message:', error);
    }
}

async function sendPhoto(chatId, photoBuffer, caption = '') {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', photoBuffer, { filename: 'snapshot.png', contentType: 'image/png' });
    form.append('caption', caption);
    try {
        await fetch(url, { method: 'POST', body: form });
    } catch (error) {
        console.error('Failed to send photo to Telegram:', error);
    }
}

async function sendChatAction(chatId, action) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, action: action })
        });
    } catch (error) {
        console.error('Failed to send chat action:', error);
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
        const myAddress = addressToMonitor;

        const [command, chainArg] = messageText.split(' ');
        const chainName = chainArg?.toLowerCase();

        try {
            if (command === '/positions') {
                const chainsToQuery = chainName && chains[chainName] ? [chainName] : Object.keys(chains);
                
                await sendMessage(chatId, `Searching for positions on: *${chainsToQuery.join(', ')}*... This may take a moment.`);
                await sendChatAction(chatId, 'typing');

                const coingeckoChainIdMap = await getCoinGeckoChainIdMap();

                const promises = chainsToQuery.map(async (chain) => {
                    const uniPromise = getPositionsData(myAddress, chain, coingeckoChainIdMap).catch(e => ({ error: e, type: 'uniswap' }));
                    const aavePromise = getAaveData(myAddress, chain).catch(e => ({ error: e, type: 'aave' }));
                    return { chain, uniData: await uniPromise, aaveData: await aavePromise };
                });
                
                const results = await Promise.all(promises);

                let allChainMessages = "";
                let successfulChains = 0;
                let failedChains = [];
                let grandOverallData = { totalFeeUSD: 0, startPrincipalUSD: 0, startDate: null, totalPortfolioPrincipalUSD: 0, totalPositions: 0 };
                
                for (const result of results) {
                    if ((result.uniData?.error) || (result.aaveData?.error)) {
                        failedChains.push(result.chain);
                        if(result.uniData?.error) console.error(`Failed to fetch Uniswap data for ${result.chain}:`, result.uniData.error);
                        if(result.aaveData?.error) console.error(`Failed to fetch Aave data for ${result.chain}:`, result.aaveData.error);
                        continue;
                    }
                    
                    if ((result.uniData && result.uniData.length > 0) || result.aaveData) {
                         successfulChains++;
                    }

                    let chainMessage = "";
                    if(result.uniData && result.uniData.length > 0) {
                        for (const posData of result.uniData) {
                            chainMessage += formatPositionData(posData, myAddress);
                            
                            if (posData.positionHistoryAnalysisSucceeded) {
                                if (!grandOverallData.startDate || posData.currentPositionStartDate.getTime() < grandOverallData.startDate.getTime()) {
                                    grandOverallData.startDate = posData.currentPositionStartDate;
                                }
                                grandOverallData.startPrincipalUSD += posData.histPrincipalUSD;
                            }
                            const principalUSD = (posData.amt0 * posData.t0.priceUSD) + (posData.amt1 * posData.t1.priceUSD);
                            const feeUSD0 = posData.fee0 * posData.t0.priceUSD;
                            const feeUSD1 = posData.fee1 * posData.t1.priceUSD;
                            
                            grandOverallData.totalPortfolioPrincipalUSD += principalUSD;
                            grandOverallData.totalFeeUSD += (feeUSD0 + feeUSD1);
                            grandOverallData.totalPositions++;
                        }
                    }
                    if(result.aaveData) {
                        chainMessage += `\n${createHeader(`Aave Lending (${result.chain.toUpperCase()})`)}\n`;
                        chainMessage += `${padString('🔹 Total Collateral:', 25)} ${result.aaveData.totalCollateral}\n`;
                        chainMessage += `${padString('🔺 Total Debt:', 25)} ${result.aaveData.totalDebt}\n`;
                        chainMessage += `${padString('Health Factor:', 25)} ${formatHealthFactor(result.aaveData.healthFactor)}\n`;
                        chainMessage += `Borrowed Assets:\n${result.aaveData.borrowedAssets.replace(/•/g, '🔺')}\n`;
                        chainMessage += `📉 Lending Costs: ${result.aaveData.lendingCosts}\n`;
                    }
                    allChainMessages += chainMessage;
                }
                
                let finalMessage = `👜 Wallet: ${myAddress.substring(0, 6)}...${myAddress.substring(myAddress.length - 4)}\n`;
                
                if (allChainMessages) {
                    finalMessage += allChainMessages;
                    
                    if (grandOverallData.startPrincipalUSD > 0) {
                        const totalReturn = grandOverallData.totalPortfolioPrincipalUSD - grandOverallData.startPrincipalUSD;
                        const totalReturnPercent = (totalReturn / grandOverallData.startPrincipalUSD) * 100;
                        const elapsedMs = new Date() - grandOverallData.startDate;
                        const rewardsPerYear = elapsedMs > 0 ? grandOverallData.totalFeeUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
                        const feesAPR = (rewardsPerYear / grandOverallData.startPrincipalUSD) * 100;

                        finalMessage += `\n${createHeader("OVERALL PERFORMANCE")}\n`;
                        finalMessage += `(${grandOverallData.totalPositions} position(s) with value)\n`;
                        finalMessage += `${padString('🏛 Initial Investment:', 25)} ${formatUSD(grandOverallData.startPrincipalUSD)}\n`;
                        finalMessage += `${padString('🏛 Total Holdings:', 25)} ${formatUSD(grandOverallData.totalPortfolioPrincipalUSD)}\n`;
                        finalMessage += `${padString('📈 Holdings Change:', 25)} ${formatUSD(totalReturn)} (${totalReturnPercent.toFixed(2)}%)\n`;

                        finalMessage += `\n*Fee Performance*\n`;
                        finalMessage += `${padString('💰 Total Fees Earned:', 25)} ${formatUSD(grandOverallData.totalFeeUSD)}\n`;
                        finalMessage += `${padString('💰 Fees APR:', 25)} ${feesAPR.toFixed(2)}%\n`;

                        const allTimeGains = totalReturn + grandOverallData.totalFeeUSD;
                        finalMessage += `${padString('\n📈 Total return + Fees:', 25)} ${formatUSD(allTimeGains)}\n`;
                    }
                }
                
                if (successfulChains === 0 && failedChains.length === 0) {
                    finalMessage = "No active Uniswap V3 or Aave positions found on any of the queried chains.";
                } else if (failedChains.length > 0) {
                    finalMessage += `\n\n⚠️ Could not fetch data for the following chains: *${failedChains.join(', ')}*.`;
                }

                if (finalMessage) {
                    await sendMessage(chatId, finalMessage);
                }

            } else if (command === '/snapshot') {
                const chainsToQuery = chainName && chains[chainName] ? [chainName] : Object.keys(chains);
                
                await sendMessage(chatId, `Generating snapshots for: *${chainsToQuery.join(', ')}*...`);
                await sendChatAction(chatId, 'upload_photo');
                
                const coingeckoChainIdMap = await getCoinGeckoChainIdMap();
                
                const promises = chainsToQuery.map(chain => getPositionsData(myAddress, chain, coingeckoChainIdMap).then(data => ({ chain, data, status: 'fulfilled' })).catch(error => ({ chain, error, status: 'rejected' })));
                const results = await Promise.all(promises);

                let successfulChains = 0;
                let failedChains = [];
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.data.length > 0) {
                        successfulChains++;
                        await handleSnapshotCommand(result.data, result.chain, chatId);
                    } else if (result.status === 'rejected') {
                        failedChains.push(result.chain);
                        console.error(`Failed to fetch data for ${result.chain}:`, result.error);
                    }
                }
                if (successfulChains === 0 && failedChains.length === 0) {
                    await sendMessage(chatId, "No active Uniswap V3 positions found to snapshot.");
                } else if (failedChains.length > 0) {
                    await sendMessage(chatId, `\n\n⚠️ Could not fetch data for snapshots on: *${failedChains.join(', ')}*.`);
                }

            } else if (command === '/start') {
                const startMessage = `Welcome! I am a Uniswap V3 & Aave V3 tracker.\n\n` +
                                     `Here are the available commands:\n` +
                                     `*/positions [chain]* - Get a detailed summary.\n` +
                                     `*/snapshot [chain]* - Get an image snapshot (Uniswap only).\n\n` +
                                     `If you don't specify a chain, I will search all supported chains.\n\n` +
                                     `*Supported Chains:*\n` +
                                     Object.keys(chains).join(', ');
                await sendMessage(chatId, startMessage);
            } else {
                await sendMessage(chatId, "I only understand the /positions and /snapshot commands. Please select one from the menu.");
            }
        } catch (error) {
            console.error("Error in processTelegramCommand:", error);
            await sendMessage(chatId, `An unexpected error occurred. Please try again later.`);
        }
    }
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    setTelegramMenuCommands();
    console.log(`Telegram webhook URL: ${RENDER_WEBHOOK_URL}/bot${TELEGRAM_BOT_TOKEN}/webhook`);
});
