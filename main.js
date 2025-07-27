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

// ADDED: New helper functions for formatting
function formatRelevantDecimals(number) {
    if (typeof number !== 'number' || isNaN(number)) return '0';
    // Format to a max of 6 decimal places and remove trailing zeros
    return parseFloat(number.toFixed(6)).toString();
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
    const paddingWidth = totalWidth - textWidth - 2; // -2 for spaces
    const leftPadding = Math.floor(paddingWidth / 2);
    const rightPadding = Math.ceil(paddingWidth / 2);
    return `${'='.repeat(leftPadding)} ${text} ${'='.repeat(rightPadding)}`;
}


function formatElapsedDaysHours(ms) {
    if (typeof ms !== 'number' || ms < 0) return '0 days, 0 hours';
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
    // ... (This function remains unchanged)
}

async function getAaveData(walletAddress, chain) {
    // ... (This function remains unchanged)
}

// --- COINGECKO HELPER FUNCTIONS ---
async function getCoinGeckoChainIdMap() {
    // ... (This function remains unchanged)
}

async function getCoinId(coingeckoChainId, tokenAddress) {
    // ... (This function remains unchanged)
}

async function fetchCurrentPrice(coinId) {
    // ... (This function remains unchanged)
}

async function fetchHistoricalPrice(coinId, dateStr) {
    // ... (This function remains unchanged)
}

// --- Main Data Fetching Logic ---
async function getPositionsData(walletAddress, chainName, coingeckoChainIdMap) {
    // ... (This function remains unchanged)
}

// --- Formatting Function ---
function formatPositionData(data, walletAddress) {
    // MODIFIED: Removed the duplicate "Wallet:" line
    let message = "";
    // MODIFIED: Using the new createHeader function
    message += `\n${createHeader(`${data.chain.toUpperCase()} -- Position #${data.i}`)}\n`;
    message += ` Token ID: ${data.tokenId}\n`;
    message += ` Pool: ${data.t0.symbol}/${data.t1.symbol} (${Number(data.pos.fee) / 10000}% fee)\n`;

    if (data.positionHistoryAnalysisSucceeded) {
        const date = data.currentPositionStartDate;
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        message += ` Created: ${day}-${month}-${year} ${hours}:${minutes}\n`;
        // MODIFIED: Using new formatUSD function
        message += ` Initial Investment: ${formatUSD(data.histPrincipalUSD)}\n`;
    } else {
        message += ` Created: (Date unavailable)\n`;
        message += ` Initial Investment: (Unavailable)\n`;
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
    // MODIFIED: Using new formatRelevantDecimals function and removed '$'
    message += ` Range: ${formatRelevantDecimals(lowerPrice)} - ${formatRelevantDecimals(upperPrice)} ${data.t1.symbol}/${data.t0.symbol}\n`;
    message += ` Current Price: ${formatRelevantDecimals(currentPrice)} ${data.t1.symbol}/${data.t0.symbol}\n`;
    // MODIFIED: Wrapped ratio in backticks to fix Telegram link issue
    message += ` Ratio: ${data.t0.symbol}/${data.t1.symbol} \`${Math.round(ratio0)}%/${Math.round(ratio1)}%\`\n`;

    const inRange = BigInt(data.nativeTick) >= BigInt(data.pos.tickLower) && BigInt(data.nativeTick) < BigInt(data.pos.tickUpper);
    message += `  In Range?  ${inRange ? "Yes" : "No"}\n`;

    const holdingsUSD = value0 + value1;
    message += `\nCurrent Holdings\n`;
    // MODIFIED: Using new formatting functions
    message += ` ${formatRelevantDecimals(data.amt0)} ${data.t0.symbol} (${formatUSD(value0)})\n`;
    message += ` ${formatRelevantDecimals(data.amt1)} ${data.t1.symbol} (${formatUSD(value1)})\n`;
    message += ` Holdings: ${formatUSD(holdingsUSD)}\n`;

    if (data.positionHistoryAnalysisSucceeded) {
        const holdingsChange = holdingsUSD - data.histPrincipalUSD;
        message += ` Holdings change: ${formatUSD(holdingsChange)}\n`;
    }

    const feeUSD0 = data.fee0 * data.t0.priceUSD;
    const feeUSD1 = data.fee1 * data.t1.priceUSD;
    const totalFeesUSD = feeUSD0 + feeUSD1;

    message += `\nUncollected Fees\n`;
    // MODIFIED: Using new formatting functions
    message += ` ${formatRelevantDecimals(data.fee0)} ${data.t0.symbol} (${formatUSD(feeUSD0)})\n`;
    message += ` ${formatRelevantDecimals(data.fee1)} ${data.t1.symbol} (${formatUSD(feeUSD1)})\n`;
    message += ` Total Fees: ${formatUSD(totalFeesUSD)}\n`;

    if (data.positionHistoryAnalysisSucceeded && data.histPrincipalUSD > 0) {
        const now = new Date();
        const elapsedMs = now.getTime() - data.currentPositionStartDate.getTime();
        const rewardsPerYear = elapsedMs > 0 ? totalFeesUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
        const feesAPR = (rewardsPerYear / data.histPrincipalUSD) * 100;

        message += `\nFee Performance\n`;
        // MODIFIED: Using new formatUSD function
        message += ` Fees per hour: ${formatUSD(rewardsPerYear / 365.25 / 24)}\n`;
        message += ` Fees per day: ${formatUSD(rewardsPerYear / 365.25)}\n`;
        message += ` Fees per month: ${formatUSD(rewardsPerYear / 12)}\n`;
        message += ` Fees per year: ${formatUSD(rewardsPerYear)}\n`;
        message += ` Fees APR: ${feesAPR.toFixed(2)}%\n`;
    }

    const positionValue = holdingsUSD + totalFeesUSD;
    message += `\n Position Value: ${formatUSD(positionValue)}\n`;
    if (data.positionHistoryAnalysisSucceeded) {
        const totalReturn = positionValue - data.histPrincipalUSD;
        message += ` Position Total return + Fees: ${formatUSD(totalReturn)}\n`;
    }
    return message;
}

// --- Execution Block (Now for Telegram Bot) ---
const addressToMonitor = "0x2FD24cC510b7a40b176B05A5Bb628d024e3B6886";
const allChains = Object.keys(chains);

async function generateSnapshotImage(data) {
    // ... (This function remains unchanged)
}

async function handleSnapshotCommand(allPositionsData, chain, chatId) {
    // ... (This function remains unchanged, though it could also be updated to use the new formatters)
}

// --- Telegram API Functions ---
async function setTelegramMenuCommands() {
    // ... (This function remains unchanged)
}

async function sendMessage(chatId, text) {
    // ... (This function remains unchanged)
}

async function sendPhoto(chatId, photoBuffer, caption = '') {
    // ... (This function remains unchanged)
}

async function sendChatAction(chatId, action) {
    // ... (This function remains unchanged)
}

// --- Express App Setup for Webhook ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.post(`/bot${TELEGRAM_BOT_TOKEN}/webhook`, async (req, res) => {
    // ... (This function remains unchanged)
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
                            chainMessage += formatPositionData(posData, myAddress); // Using the formatter here
                            
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
                        // MODIFIED: Using new createHeader function for consistency
                        chainMessage += `\n${createHeader(`Aave Lending (${result.chain.toUpperCase()})`)}\n`;
                        chainMessage += `Total Collateral: ${result.aaveData.totalCollateral}  Total Debt: ${result.aaveData.totalDebt}\n`;
                        chainMessage += `Health Factor: ${result.aaveData.healthFactor}\n`;
                        chainMessage += `Borrowed Assets:\n   ${result.aaveData.borrowedAssets}\n`;
                        chainMessage += `Estimated Lending Costs: ${result.aaveData.lendingCosts}\n`;
                    }
                    allChainMessages += chainMessage;
                }
                
                let finalMessage = `*👜 Wallet: ${myAddress.substring(0, 6)}...${myAddress.substring(myAddress.length - 4)}*\n`;
                
                if (allChainMessages) {
                    finalMessage += allChainMessages;
                    
                    if (grandOverallData.startPrincipalUSD > 0) {
                        const totalReturn = grandOverallData.totalPortfolioPrincipalUSD - grandOverallData.startPrincipalUSD;
                        const totalReturnPercent = (totalReturn / grandOverallData.startPrincipalUSD) * 100;
                        const elapsedMs = new Date() - grandOverallData.startDate;
                        const rewardsPerYear = elapsedMs > 0 ? grandOverallData.totalFeeUSD * (365.25 * 24 * 60 * 60 * 1000) / elapsedMs : 0;
                        const feesAPR = (rewardsPerYear / grandOverallData.startPrincipalUSD) * 100;

                        // MODIFIED: Using new createHeader and formatUSD functions
                        finalMessage += `\n${createHeader("OVERALL PERFORMANCE")}\n`;
                        // MODIFIED: Text changed as requested
                        finalMessage += `(Based on the *${grandOverallData.totalPositions}* displayed position(s) with value)\n`;
                        finalMessage += `🏛 Initial Investment: ${formatUSD(grandOverallData.startPrincipalUSD)}\n`;
                        finalMessage += `🏛 Total Holdings: ${formatUSD(grandOverallData.totalPortfolioPrincipalUSD)}\n`;
                        finalMessage += `📈 Holdings Change: ${formatUSD(totalReturn)} (${totalReturnPercent.toFixed(2)}%)\n`;

                        finalMessage += `\n*Fee Performance*\n`;
                        finalMessage += `💰 Total Fees Earned: ${formatUSD(grandOverallData.totalFeeUSD)}\n`;
                        finalMessage += `💰 Fees APR: ${feesAPR.toFixed(2)}%\n`;

                        const allTimeGains = totalReturn + grandOverallData.totalFeeUSD;
                        finalMessage += `\n📈 Total return + Fees: ${formatUSD(allTimeGains)}\n`;
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
                // ... (This block remains unchanged)

            } else if (command === '/start') {
                // ... (This block remains unchanged)
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
