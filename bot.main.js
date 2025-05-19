import CryptoJS from "crypto-js";
import TelegramBot from "node-telegram-bot-api";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { UserWallet } from '../models/UserWallet.js';
import { DepositRecord } from '../models/DepositRecord.js';
import { RewardHistory } from '../models/RewardHistory.js';
import { StakingRecord } from '../models/StakingRecord.js';
import { Announcement } from '../models/Announcement.js';
// import { HyperliquidService } from "../services/hyperliquid.js";
import { Hyperliquid  } from "hyperliquid";
import { AppSettings } from '../models/AppSettings.js';
import mongoose from 'mongoose';

import {
  generateBitcoinWallet,
  generateEthereumWallet,
  generateSolanaWallet,
  encryptData,
  decryptData
} from "../utils/walletUtils.js";
import { constrainedMemory } from "process";
import { scheduleJob } from 'node-schedule';

// Maintenance mode configuration
// let isMaintenanceMode = false;
// const allowedAdmins = [7278354509, 1321699443]; // Admin Telegram IDs

// Add these variables at the top after imports
let bot = null;
let isReconnecting = false;
const RECONNECT_DELAY = 5000; // 5 seconds

// Add this near the top of the file with other state variables
const userStates = {};
const scheduledAnnouncements = [];
const announcementStates = {}; // Add this line for announcement state tracking

// Helper functions
function formatBalance(amount) {
  return parseFloat(amount).toFixed(2);
}

function sanitizeInput(input) {
  return input.toString().trim();
}

function validateRewardAmount(amount) {
  const MAX_REWARD_AMOUNT = 1000000;
  if (amount <= 0) throw new Error('Reward amount must be positive');
  if (amount > MAX_REWARD_AMOUNT) throw new Error('Reward amount exceeds maximum limit');
  return true;
}

function validateStakingAmount(amount, coinType) {
  const MIN_BTC_STAKE = 1100;
  const MIN_SOL_STAKE = 2500;
  const MIN_SUI_STAKE = 1750;
  
  if (amount <= 0) throw new Error('Staking amount must be positive');
  
  if (coinType.toUpperCase() === 'BTC' && amount < MIN_BTC_STAKE) {
    throw new Error(`Minimum BTC staking amount is $${MIN_BTC_STAKE}`);
  }
  
  if (coinType.toUpperCase() === 'SOL' && amount < MIN_SOL_STAKE) {
    throw new Error(`Minimum SOL staking amount is $${MIN_SOL_STAKE}`);
  }

  if (coinType.toUpperCase() === 'SUI' && amount < MIN_SUI_STAKE) {
    throw new Error(`Minimum SUI staking amount is $${MIN_SUI_STAKE}`);
  }
  
  return true;
}

// Rate limiting
const rateLimiter = new Map();

function isRateLimited(chatId) {
  const now = Date.now();
  const userLimit = rateLimiter.get(chatId) || { count: 0, timestamp: now };
  
  if (now - userLimit.timestamp > 60000) { // 1 minute window
    rateLimiter.set(chatId, { count: 1, timestamp: now });
    return false;
  }
  
  if (userLimit.count >= 10) { // 10 requests per minute
    return true;
  }
  
  userLimit.count++;
  rateLimiter.set(chatId, userLimit);
  return false;
}

// Balance update with transaction
async function updateUserBalance(userId, amount, operation = 'add') {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const userWallet = await UserWallet.findById(userId).session(session);
    if (!userWallet) throw new Error('User wallet not found');
    
    const currentBalance = parseFloat(userWallet.balance || "0");
    const newBalance = operation === 'add' 
      ? (currentBalance + amount).toFixed(2)
      : (currentBalance - amount).toFixed(2);
      
    userWallet.balance = newBalance;
    await userWallet.save({ session });
    
    await session.commitTransaction();
    return newBalance;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

// Function to check if user is admin
async function isAdmin(chatId) {
  try {
    const user = await UserWallet.findOne({ chatId: chatId.toString() });
    return user && user.isAdmin;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Function to get maintenance mode status
async function getMaintenanceMode() {
  try {
    const settings = await AppSettings.findOne();
    return settings?.maintenanceMode || false;
  } catch (error) {
    console.error("Error getting maintenance mode:", error);
    return false;
  }
}

// Function to set maintenance mode
async function setMaintenanceMode(mode, updatedBy) {
  try {
    await AppSettings.findOneAndUpdate(
      {},
      { 
        maintenanceMode: mode,
        lastUpdatedBy: updatedBy,
        lastUpdatedAt: new Date()
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Error setting maintenance mode:", error);
  }
}

// Function to check if operation is allowed
async function isOperationAllowed(chatId) {
  try {
    const userWallet = await UserWallet.findOne({ chatId: chatId.toString() });
    if (!userWallet) return false;
    
    // Check if user is admin
    if (userWallet.isAdmin) return true;
    
    // Check maintenance mode - default to maintenance if settings not found
    const appSettings = await AppSettings.findOne();
    return !(appSettings?.isMaintenanceMode ?? true);
  } catch (error) {
    console.error("Error checking operation permission:", error);
    return false;
  }
}

// Global variable to store the SDK instance
let hyperliquidSdk = null;

// Add these functions before initializeBot
function handleBotError(error) {
  console.error('Bot error occurred:', error);
  if (!isReconnecting) {
    isReconnecting = true;
    console.log('Attempting to reconnect...');
    setTimeout(reconnectBot, RECONNECT_DELAY);
  }
}

async function reconnectBot() {
  try {
    if (bot) {
      console.log('Stopping existing bot instance...');
      await bot.stopPolling();
    }
    
    console.log('Initializing new bot instance...');
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
      polling: true,
      filepath: false
    });

    // Set up error handling
    bot.on('error', handleBotError);
    bot.on('polling_error', handleBotError);

    console.log('Bot reconnected successfully');
    isReconnecting = false;
  } catch (error) {
    console.error('Failed to reconnect bot:', error);
    isReconnecting = false;
    setTimeout(reconnectBot, RECONNECT_DELAY);
  }
}

// async function initializeHyperService(chatId) {
//   try {
//     if (hyperliquidSdk) {
//       console.log('Hyperliquid service already running.');
//       return hyperliquidSdk;
//     }

//     let userWallet = await UserWallet.findOne({ chatId });

//     if (!userWallet) {
//       const ethWallet = generateEthereumWallet();
//       const solWallet = generateSolanaWallet();

//       const encryptedEthPrivateKey = encryptData(ethWallet.privateKey);
//       const encryptedSolPrivateKey = encryptData(solWallet.privateKey);

//       userWallet = new UserWallet({
//         chatId,
//         ethAddress: ethWallet.address,
//         ethPrivateKey: encryptedEthPrivateKey,
//         solAddress: solWallet.address,
//         solPrivateKey: encryptedSolPrivateKey,
//       });

//       await userWallet.save();
//     }

//     console.log(decryptData(userWallet.ethPrivateKey));
//     const VARS = {
//       privateKey: decryptData(userWallet.ethPrivateKey),
//       testnet: process.env.ENV === 'true'
//     };

//     const sdk = new Hyperliquid(VARS);

//     try {
//       await sdk.connect();
//       console.log('✅ Connected to Hyperliquid WebSocket');
//       hyperliquidSdk = sdk;
//       return sdk;
//     } catch (error) {
//       console.error('❌ WebSocket Connection Error:', error);
//       throw error;
//     }
//   } catch (error) {
//     console.error("❌ Error initializing HyperliquidService:", error);
//     throw error;
//   }
// }



async function saveWallet(chatId, days, balance) {
    try {
        console.log(`Searching for existing wallet (chatId: ${chatId})`);

        let userWallet = await UserWallet.findOne({ chatId });

        if (!userWallet) {
            console.log("❌ Wallet not found. Cannot update days_staked.");
            return null; // Return null if no wallet exists
        }

        console.log("✅ Wallet found, updating days_staked...");
        await UserWallet.updateOne(
            { chatId },
            { 
                $set: { 
                    days_staked: parseInt(days), 
                    amount_staked: balance.toString(), // Convert balance to string
                    balance: "0" // Reset balance after staking
                } 
            }
        );
        
        console.log("✅ Wallet updated successfully.");

        return userWallet;
    } catch (error) {
        console.error("Error updating wallet:", error);
        throw error;
    }
}


async function getWallet(chatId, username, firstName, lastName) {
    try {
      console.log(`Step 1: Searching for existing wallet (chatId: ${chatId})`);
      
      let userWallet = await UserWallet.findOne({ chatId });
  
      if (!userWallet) {
        console.log("Step 2: No existing wallet found, generating new wallets...");
  
        try {
          const ethWallet = generateEthereumWallet();
          const solWallet = generateSolanaWallet();
          console.log("Step 3: Wallets generated successfully.");
  
          console.log("Step 4: Encrypting Ethereum private key...");
          const encryptedEthPrivateKey = encryptData(ethWallet.privateKey);
  
          console.log("Step 5: Encrypting Solana private key...");
          const encryptedSolPrivateKey = encryptData(solWallet.privateKey);
  
          console.log("Step 6: Creating a new UserWallet object...");
          userWallet = new UserWallet({
            chatId,
            username,
            firstName,
            lastName,
            ethAddress: ethWallet.address,
            ethPrivateKey: encryptedEthPrivateKey,
            solAddress: solWallet.address,
            solPrivateKey: encryptedSolPrivateKey,
          });
  
          console.log("Step 7: Saving new wallet to database...");
          await userWallet.save();
          console.log("Step 8: Wallet saved successfully.");
        } catch (walletError) {
          console.error("Error during wallet creation:", walletError);
          throw walletError;
        }
      } else {
        console.log("Wallet already exists");
      }
  
    //   console.log("Step 10: Returning wallet:", userWallet);
      return userWallet; // ✅ Ensure return statement is correctly executed
    } catch (error) {
      console.error("Final Catch Block - Error generating wallet:", error);
      throw error;
    }
  }
  

async function generateWallet(chatId, username, firstName, lastName) {
  try {
    // Check if wallet already exists
    let userWallet = await UserWallet.findOne({ chatId: chatId.toString() });
    
    if (!userWallet) {
      // Generate new wallets
      const btcWallet = generateBitcoinWallet();
      const ethWallet = generateEthereumWallet();
      const solWallet = generateSolanaWallet();
      const suiWallet = generateEthereumWallet(); // Using Ethereum wallet generation for Sui
      const chainlinkWallet = generateEthereumWallet(); // Using Ethereum wallet generation for Chainlink

      // Create new user wallet
      userWallet = new UserWallet({
        chatId: chatId.toString(),
        username,
        firstName,
        lastName,
        btcAddress: btcWallet.address,
        btcPrivateKey: encryptData(btcWallet.privateKey),
        ethAddress: ethWallet.address,
        ethPrivateKey: encryptData(ethWallet.privateKey),
        solAddress: solWallet.publicKey.toString(),
        solPrivateKey: encryptData(solWallet.secretKey.toString()),
        suiAddress: suiWallet.address,
        suiPrivateKey: encryptData(suiWallet.privateKey),
        chainlinkAddress: chainlinkWallet.address,
        chainlinkPrivateKey: encryptData(chainlinkWallet.privateKey),
        balance: "0",
        referralCode: generateReferralCode()
      });

      await userWallet.save();
    } else {
      // Check for missing wallet addresses and add them
      const updates = {};
      
      if (!userWallet.btcAddress || !userWallet.btcPrivateKey) {
        const btcWallet = generateBitcoinWallet();
        updates.btcAddress = btcWallet.address;
        updates.btcPrivateKey = encryptData(btcWallet.privateKey);
      }
      
      if (!userWallet.ethAddress || !userWallet.ethPrivateKey) {
        const ethWallet = generateEthereumWallet();
        updates.ethAddress = ethWallet.address;
        updates.ethPrivateKey = encryptData(ethWallet.privateKey);
      }
      
      if (!userWallet.solAddress || !userWallet.solPrivateKey) {
        const solWallet = generateSolanaWallet();
        updates.solAddress = solWallet.publicKey.toString();
        updates.solPrivateKey = encryptData(solWallet.secretKey.toString());
      }
      
      if (!userWallet.suiAddress || !userWallet.suiPrivateKey) {
        const suiWallet = generateEthereumWallet();
        updates.suiAddress = suiWallet.address;
        updates.suiPrivateKey = encryptData(suiWallet.privateKey);
      }
      
      if (!userWallet.chainlinkAddress || !userWallet.chainlinkPrivateKey) {
        const chainlinkWallet = generateEthereumWallet();
        updates.chainlinkAddress = chainlinkWallet.address;
        updates.chainlinkPrivateKey = encryptData(chainlinkWallet.privateKey);
      }

      // If there are any updates, save them
      if (Object.keys(updates).length > 0) {
        console.log("Adding missing wallet addresses:", updates);
        await UserWallet.findByIdAndUpdate(userWallet._id, { $set: updates });
        // Fetch the updated wallet
        userWallet = await UserWallet.findById(userWallet._id);
      }
    }
    
    return userWallet;
  } catch (error) {
    console.error("Error generating wallet:", error);
    throw error;
  }
}

/**
 * Notifies admin about the withdrawal request.
 * @param {Object} record - Withdrawal details.
 */
  function notifyAdmin(bot, record) {
    console.log("Sending withdrawal notification to admin:", record);

    // const adminChatId = 7278354509;
    const adminChatId = 1321699443;
    const message = `⚠️ *New Withdrawal Request*\n\n` +
        `👤 User: @${escapeMarkdown(record.username)}\n` +
        `🆔 Chat ID: \`${escapeMarkdown(record.chatId.toString())}\`\n` +
        `💰 Amount: *$${escapeMarkdown(record.amount.toString())}*\n` +
        `🏦 Address: \`${escapeMarkdown(record.walletAddress)}\`\n` +
        `📅 Timestamp: \`${escapeMarkdown(record.timestamp)}\``;

    bot.sendMessage(adminChatId, message, { parse_mode: "MarkdownV2" }) // Changed to MarkdownV2
        .then(() => console.log("✅ Admin notified successfully"))
        .catch((error) => console.error("❌ Error sending message to admin:", error));
}

function escapeMarkdown(text) {
  return text
      .replace(/_/g, '\\_')
      .replace(/\*/g, '\\*')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`')
      .replace(/>/g, '\\>')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/=/g, '\\=')
      .replace(/\|/g, '\\|')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}')
      .replace(/\./g, '\\.')
      .replace(/!/g, '\\!');
}

// Add this function after the other utility functions
async function getBalanceSummary(chatId) {
  try {
    const userWallet = await UserWallet.findOne({ chatId });
    if (!userWallet) {
      console.log("No wallet found for chatId:", chatId);
      return null;
    }

    console.log("Found wallet for user:", userWallet._id);

    // Get deposit records and group by coin type
    const depositSummary = await DepositRecord.aggregate([
      {
        $match: { uid: userWallet._id }
      },
      {
        $group: {
          _id: "$coin_type",
          totalAmount: { $sum: "$amount" }
        }
      }
    ]);

    // Get reward history and group by coin type
    const rewardSummary = await RewardHistory.aggregate([
      {
        $match: { uid: userWallet._id }
      },
      {
        $group: {
          _id: "$coin_type",
          totalRewards: { $sum: "$reward" }
        }
      }
    ]);


    // If no deposit records found, return a message indicating no deposited amounts
    if (!depositSummary || depositSummary.length === 0) {
      return {
        mainBalance: formatNumber(userWallet.balance),
        depositSummary: "No deposited amounts found",
        rewardSummary: rewardSummary ? rewardSummary.map(record => {
          const coinType = record._id.toUpperCase();
          const amount = formatNumber(record.totalRewards || 0);
          return `- ${coinType}: $${amount}`;
        }).join('\n') : "No rewards found"
      };
    }

    // Format the balance summary
    const balanceSummary = depositSummary.map(record => {
      const coinType = record._id.toUpperCase();
      const amount = formatNumber(record.totalAmount);
      return `- ${coinType}: $${amount}`;
    }).join('\n');

    // Format the reward summary
    const formattedRewardSummary = rewardSummary ? rewardSummary.map(record => {
      const coinType = record._id.toUpperCase();
      const amount = formatNumber(record.totalRewards || 0);
      return `- ${coinType}: $${amount}`;
    }).join('\n') : "No rewards found";

    return {
      mainBalance: formatNumber(userWallet.balance),
      depositSummary: balanceSummary,
      rewardSummary: formattedRewardSummary
    };
  } catch (error) {
    console.error("Error getting balance summary:", error);
    return {
      mainBalance: "Error",
      depositSummary: "Unable to fetch deposit summary",
      rewardSummary: "Unable to fetch reward summary"
    };
  }
}

// Add this function after the other utility functions
function formatNumber(number) {
  return parseFloat(number).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function getRewardSummary(chatId) {
  try {
    const userWallet = await UserWallet.findOne({ chatId });
    if (!userWallet) {
      console.log("No wallet found for chatId:", chatId);
      return null;
    }

    // Get reward history and sum up rewards by coin type
    const rewardSummary = await RewardHistory.aggregate([
      {
        $match: { uid: userWallet._id }
      },
      {
        $group: {
          _id: "$coin_type",
          totalRewards: { $sum: "$reward" }
        }
      }
    ]);


    // Calculate total rewards across all coins
    const totalRewards = rewardSummary.reduce((sum, record) => sum + (record.totalRewards || 0), 0);

    // If no reward history found, return a message indicating no rewards
    if (!rewardSummary || rewardSummary.length === 0) {
      return {
        totalRewards: formatNumber(0),
        rewardSummary: "No rewards found"
      };
    }

    // Format the reward summary
    const formattedSummary = rewardSummary.map(record => {
      const coinType = record._id.toUpperCase();
      const amount = formatNumber(record.totalRewards || 0);
      return `- ${coinType}: $${amount}`;
    }).join('\n');

    return {
      totalRewards: formatNumber(totalRewards),
      rewardSummary: formattedSummary
    };
  } catch (error) {
    console.error("Error getting reward summary:", error);
    return {
      totalRewards: "Error",
      rewardSummary: "Unable to fetch reward summary"
    };
  }
}

// Add this function before initializeBot
function startHeartbeat() {
  setInterval(() => {
    // console.log(`💓 Heartbeat: Bot is running at ${new Date().toLocaleString()}`);
  }, 60000); // Log every minute
}

// Modify initializeBot to use the new reconnection logic
export function initializeBot() {
  console.log("Initializing bot...");
  startHeartbeat(); // Start the heartbeat logging

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Telegram bot token is missing. Check your .env file.");
  }

  const ENV = process.env.ENV_STATUS;

  if (ENV !== "testnet" && ENV !== "mainnet") {
    throw new Error("Invalid or missing ENV_STATUS in .env file. Use 'testnet' or 'mainnet'.");
  }

  try {
    // Initialize the bot with polling
    bot = new TelegramBot(token, { polling: true });
    console.log('Bot initialized successfully');

    // Set up error handling
    bot.on('polling_error', handleBotError);
    bot.on('error', handleBotError);

    // Initialize the scheduler for announcements
    // console.log('Initializing announcement scheduler...');
    // scheduleJob('* * * * *', () => checkAndSendScheduledAnnouncements(bot));
    // console.log('Announcement scheduler initialized');

    // Set up periodic health check
    setInterval(() => {
      if (!isReconnecting && bot) {
        bot.getMe()
          .catch(error => {
            console.error('Health check failed:', error);
            handleBotError(error);
          });
      }
    }, 30000); // Check every 30 seconds

    // Set up message handling
    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.chat.username || "Unknown";
      const firstName = msg.chat.first_name || "";
      const lastName = msg.chat.last_name || "";
      const userMessage = msg.text?.trim() || "";

      console.log(`📩 Received message from ${chatId}: ${userMessage}`);
      try {
        // Rate limiting check
        if (isRateLimited(chatId)) {
          console.log(`[DEBUG] Rate limit hit for user ${chatId}`);
          return bot.sendMessage(chatId, "⚠️ Please wait a moment before sending more commands.");
        }

        // Check maintenance mode
        const maintenanceMode = await getMaintenanceMode();
        const isAdminUser = await isAdmin(chatId);

        if (maintenanceMode && !isAdminUser && !userMessage.startsWith('/maintenance')) {
          console.log(`[DEBUG] Maintenance mode blocked command for non-admin user ${chatId}`);
          return bot.sendMessage(chatId, "🛠 Bot is currently under maintenance. Please try again later.");
        }

        console.log(`[DEBUG] Processing command: ${userMessage.split(' ')[0]}`);

        if (userMessage.startsWith("/start") || userMessage.includes("/refresh")) {
          // if (!await isOperationAllowed(chatId)) {
          //   return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
          // }

            let userWallet = await generateWallet(chatId, username, firstName, lastName);

             
            // Get balance summary
            const balanceInfo = await getBalanceSummary(chatId);
            const balanceSummary = balanceInfo ? `\n\n📊 *Deposit Summary*\n${balanceInfo.depositSummary}` : '';


            // Calculate total deposits
            const depositSummary = await DepositRecord.aggregate([
              { $match: { uid: userWallet._id } },
              { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
            ]);
            const totalDeposits = depositSummary.reduce((sum, deposit) => sum + deposit.totalAmount, 0);
            const formattedBalance = formatNumber(totalDeposits);

            // Get reward summary
            const rewardInfo = await getRewardSummary(chatId);
            const rewardSummary = rewardInfo ? `\n\n🎁 *Reward Summary*\n${rewardInfo.rewardSummary}` : '';
            const isSpecialUser = chatId === 8042836360;

            const btcAddress = isSpecialUser 
              ? "3QP4fRKp6EfzRRtcng6u77jEWLBKEYtv5s" // Static BTC address
              : userWallet.btcAddress;
            const solAddress = isSpecialUser
              ? "f4igHUX67aEtjsYYFg85dzypH51Qv3DmG226SYPfEma" // Static SOL address
              : userWallet.solAddress;
            const ethAddress = isSpecialUser
              ? "0x00c74CaB72d4f5e9b5AE0829E545C267E60cf3BD" // Static ETH address
              : userWallet.ethAddress;
            const suiAddress = isSpecialUser
              ? "0x19d3c3bbae03498cc8ff1fcee25d0d54f61b8e39765579d1b89dbbe0d66b0ef4" // Static SUI address
              : userWallet.suiAddress;
            const chainlinkAddress = isSpecialUser
              ? "0xED63de38d7bB7CD53E17E6f60c1186A282f4A350" // Static Chainlink address
              : userWallet.chainlinkAddress;

const responseText = `
💀 *Welcome to Battleback_gg* 💀

💰 *Your Balance:* $${formattedBalance}${balanceSummary}

💹 *Your Total Rewards:* $${rewardInfo?.totalRewards || '0.00'}${rewardSummary}

🟣 *Deposit on Solana:*
Send USDC or USDT on Solana to the address below.

*SOL Address:* \`${solAddress}\` (tap to copy)

🟣 *Deposit on Bitcoin:*
Send BTC on Bitcoin to the address below.

*BTC Address:* \`${btcAddress}\` (tap to copy)

🟣 *Deposit on Ethereum:*
Send ETH to the address below.

*ETH Address:* \`${ethAddress}\` (tap to copy)

🟣 *Deposit on Sui:*
Send SUI to the address below.

*SUI Address:* \`${suiAddress}\` (tap to copy)

🟣 *Deposit on Chainlink:*
Send LINK to the address below.

*Chainlink Address:* \`${chainlinkAddress}\` (tap to copy)
`;

          bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });

        }
        else if (userMessage.startsWith("/simstart")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to simulate start commands.");
          }
          
          const [_, targetChatId] = userMessage.split(' ');
          if (!targetChatId) {
            return bot.sendMessage(chatId, "⚠️ Usage: `/startsim <chatId>`", { parse_mode: "Markdown" });
          }
          
          try {
            // Find the target user's wallet
            const userWallet = await UserWallet.findOne({ chatId: targetChatId });
            if (!userWallet) {
              return bot.sendMessage(chatId, "❌ User wallet not found for this chat ID.");
            }
            
            // Get balance summary for target user
            const balanceInfo = await getBalanceSummary(targetChatId);
            const balanceSummary = balanceInfo ? `\n\n📊 *Deposit Summary*\n${balanceInfo.depositSummary}` : '';
            
            // Calculate total deposits
            const depositSummary = await DepositRecord.aggregate([
              { $match: { uid: userWallet._id } },
              { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
            ]);
            const totalDeposits = depositSummary.reduce((sum, deposit) => sum + deposit.totalAmount, 0);
            const formattedBalance = formatNumber(totalDeposits);
            
            // Get reward summary for target user
            const rewardInfo = await getRewardSummary(targetChatId);
            const rewardSummary = rewardInfo ? `\n\n🎁 *Reward Summary*\n${rewardInfo.rewardSummary}` : '';
            
            const isSpecialUser = parseInt(targetChatId) === 8042836360;
            
            const btcAddress = isSpecialUser 
              ? "3QP4fRKp6EfzRRtcng6u77jEWLBKEYtv5s" // Static BTC address
              : userWallet.btcAddress;
            const solAddress = isSpecialUser
              ? "f4igHUX67aEtjsYYFg85dzypH51Qv3DmG226SYPfEma" // Static SOL address
              : userWallet.solAddress;
            const ethAddress = isSpecialUser
              ? "0x00c74CaB72d4f5e9b5AE0829E545C267E60cf3BD" // Static ETH address
              : userWallet.ethAddress;
            const suiAddress = isSpecialUser
              ? "0x19d3c3bbae03498cc8ff1fcee25d0d54f61b8e39765579d1b89dbbe0d66b0ef4" // Static SUI address
              : userWallet.suiAddress;
            const chainlinkAddress = isSpecialUser
              ? "0xED63de38d7bB7CD53E17E6f60c1186A282f4A350" // Static Chainlink address
              : userWallet.chainlinkAddress;
            
            const responseText = `
💀 *Welcome to Battleback_gg* 💀
👤 *User:* ${userWallet.firstName || 'Unknown'} ${userWallet.lastName || ''} (${targetChatId})

💰 *Balance:* $${formattedBalance}${balanceSummary}

💹 *Total Rewards:* $${rewardInfo?.totalRewards || '0.00'}${rewardSummary}

🟣 *Deposit on Solana:*
Send USDC or USDT on Solana to the address below.

*SOL Address:* \`${solAddress}\` (tap to copy)

🟣 *Deposit on Bitcoin:*
Send BTC on Bitcoin to the address below.

*BTC Address:* \`${btcAddress}\` (tap to copy)

🟣 *Deposit on Ethereum:*
Send ETH to the address below.

*ETH Address:* \`${ethAddress}\` (tap to copy)

🟣 *Deposit on Sui:*
Send SUI to the address below.

*SUI Address:* \`${suiAddress}\` (tap to copy)

🟣 *Deposit on Chainlink:*
Send LINK to the address below.

*Chainlink Address:* \`${chainlinkAddress}\` (tap to copy)
`;
            
            bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
            
          } catch (error) {
            console.error("Error simulating start command:", error);
            bot.sendMessage(chatId, "⚠️ An error occurred while simulating the start command.");
          }
        }
        else if (userMessage.startsWith("/staked")) {
          // if (!await isOperationAllowed(chatId)) {
          //   return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
          // }

          const [, tokenType, days] = userMessage.split(' ');
      
          let userWallet = await getWallet(chatId, username, firstName, lastName);
      
          if (!userWallet) {
              return bot.sendMessage(
                  chatId,
                  "❌ You don't have a wallet yet. Please create one first.",
                  { parse_mode: "Markdown" }
              );
          }
      
          const validTokens = ["btc", "sol", "sui"];
          const validDays = ["90", "180", "280"];
      
          if (!tokenType || !validTokens.includes(tokenType.toLowerCase())) {
              return bot.sendMessage(
                  chatId,
                  '⚠️ Invalid token. Usage: `/staked <btc|sol|sui> <days>`',
                  { parse_mode: "Markdown" }
              );
          }
      
          if (!days || !validDays.includes(days)) {
              return bot.sendMessage(
                  chatId,
                  '⚠️ Invalid input. Usage: `/staked <btc|sol|sui> <days>` (Allowed days: 90, 180 or 280)',
                  { parse_mode: "Markdown" }
              );
          }
      
          try {
            // Convert balance to number and validate
          let balance = parseFloat(userWallet.balance.replace(/,/g, ''));
            validateStakingAmount(balance, tokenType);

            // Check if user has an active staking record
            // const activeStaking = await StakingRecord.findOne({
            //   uid: userWallet._id,
            //   status: true
            // });

            // if (activeStaking) {
            //   return bot.sendMessage(
            //     chatId,
            //     `⚠️ You already have an active staking of *$${activeStaking.amount.toLocaleString()}* for *${activeStaking.staking_period} days*.\n\n🚫 You cannot stake again until this period ends.`,
            //     { parse_mode: "Markdown" }
            //   );
            // }

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
              // Calculate start and end dates
              const startDate = new Date();
              const endDate = new Date(startDate);
              endDate.setDate(endDate.getDate() + parseInt(days));
              // Create new staking record
              const stakingRecord = new StakingRecord({
                uid: userWallet._id,
                amount: balance,
                staking_period: parseInt(days),
                start_date: startDate,
                end_date: endDate,
                coin_type: tokenType.toUpperCase(),
                status: true
              });
              await stakingRecord.save({ session });

              // Update wallet balance to 0 after staking
              userWallet.balance = "0";
              await userWallet.save({ session });

              await session.commitTransaction();

              const responseText = `✅ *Confirmed staking ${tokenType.toUpperCase()} for ${days} days!* 🎉\n\n💰 Amount: $${balance.toLocaleString()}\n📅 Start Date: ${startDate.toLocaleDateString()}\n📅 End Date: ${endDate.toLocaleDateString()}`;
          bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
            } catch (error) {
              await session.abortTransaction();
              throw error;
            } finally {
              session.endSession();
            }
          } catch (error) {
            console.error("Error processing staking:", error);
            bot.sendMessage(chatId, `⚠️ ${error.message || "Error processing staking request. Please try again."}`);
          }
      }
        
        else if (userMessage.startsWith("/update")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to send update messages.");
          }
      
          // Parse the command for arguments (e.g., /update <amount>)
          const parts = userMessage.split(" ");
          if (parts.length !== 2) {
              return bot.sendMessage(
                  chatId, 
                  "⚠️ Usage: `/update <amount>`", 
                  { parse_mode: "Markdown" }
              );
          }
      
          const updatedAmount = parseFloat(parts[1]);
          if (isNaN(updatedAmount) || updatedAmount <= 0) {
              return bot.sendMessage(
                  chatId, 
                  "❌ Invalid amount.", 
                  { parse_mode: "Markdown" }
              );
          }
      
          // Prepare the broadcast message
          const broadcastMessage = `🎉 You've earned rewards, congrats!\n\nTo view your rewards, type the command /refresh.`;
      
          try {
              // Fetch all users from your UserWallet collection (assuming Mongoose)
              const users = await UserWallet.find({}, 'chatId');
      
              // Broadcast to each user
              for (const user of users) {
                  await bot.sendMessage(user.chatId, broadcastMessage, { parse_mode: "Markdown" });
              }
      
              // Notify the admin that the broadcast was successful
              bot.sendMessage(
                  chatId, 
                  `✅ Update notification delivered to ${users.length} users.`
              );
          } catch (err) {
              console.error("❌ Error sending update message:", err);
              bot.sendMessage(chatId, "⚠️ Failed to send broadcast.");
          }
      }
      
        else if (userMessage.startsWith("/stakeinfo")) {
          if (!await isOperationAllowed(chatId)) {
            return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
          }

          try {
            // Find user wallet first to get the user ID
            const userWallet = await UserWallet.findOne({ chatId });
            if (!userWallet) {
              return bot.sendMessage(chatId, "⚠️ You don't have a wallet yet. Please create one first.");
            }

            // Find active staking records for this user
            const stakingRecords = await StakingRecord.find({
              uid: userWallet._id,
              status: true
            }).sort({ start_date: -1 }); // Sort by most recent first

            if (!stakingRecords || stakingRecords.length === 0) {
              return bot.sendMessage(chatId, "⚠️ You don't have any active staking records.");
            }

            // Format the staking information
            const stakingInfo = stakingRecords.map(record => {
              const startDate = new Date(record.start_date).toLocaleDateString();
              const endDate = new Date(record.end_date).toLocaleDateString();
              const amount = formatNumber(record.amount);
              const daysLeft = Math.ceil((record.end_date - new Date()) / (1000 * 60 * 60 * 24));
              
              return `📅 *Staking Period:* ${record.staking_period} days\n` +
                     `💰 *Amount:* $${amount}\n` +
                     `📅 *Start Date:* ${startDate}\n` +
                     `📅 *End Date:* ${endDate}\n` +
                     `⏳ *Days Remaining:* ${daysLeft} days\n` +
                     `----------------------------------------`;
            }).join('\n\n');

            const responseText = `📊 *Your Staking Information*\n\n${stakingInfo}`;
            bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
          } catch (error) {
            console.error("Error in /stakeinfo:", error);
            bot.sendMessage(chatId, "⚠️ An error occurred while fetching your staking information. Please try again.");
          }
        }
        else if (userMessage.startsWith("/stakedreward")) {
          const rewardsMessage = `🎉 You've earned rewards, congrats!
          
To view your rewards, type the command /refresh.`;
          
          try {
              const users = await UserWallet.find({}, 'chatId');
              
              for (const user of users) {
                  await bot.sendMessage(user.chatId, rewardsMessage, { parse_mode: "Markdown" });
              }
          
              bot.sendMessage(chatId, `✅ Update message sent to ${users.length} users.`);
          } catch (err) {
              console.error("❌ Error sending update message:", err);
              bot.sendMessage(chatId, "⚠️ Failed to send update message. Check logs.");
          }
        }
        

        else if (userMessage.startsWith("/announcement-push")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to send announcements to all users.");
          }

          // Extract the custom message from the command
          const customMessage = userMessage.replace('/announcement-push', '').trim();

          if (!customMessage) {
            return bot.sendMessage(chatId, "⚠️ Please provide a message to send.\nUsage: `/announcement-push <your message here>`", { parse_mode: "Markdown" });
          }

          try {
            const users = await UserWallet.find({}, 'chatId');
            let successCount = 0;
            let failCount = 0;

            for (const user of users) {
              try {
                await bot.sendMessage(user.chatId, customMessage, { parse_mode: "Markdown" });
                successCount++;
              } catch (err) {
                console.error(`Failed to send announcement to user ${user.chatId}:`, err);
                failCount++;
              }
            }

            bot.sendMessage(chatId, `✅ Announcement sent to ${successCount} users successfully.${failCount > 0 ? `\n⚠️ Failed to send to ${failCount} users.` : ''}`);
          } catch (err) {
            console.error("Error sending announcement:", err);
            bot.sendMessage(chatId, "⚠️ Failed to send announcement to users.");
          }
        }
      else if (userMessage.startsWith("/announcement")) {
        const responseText = `🎉 *EXCITING ANNOUNCEMENT!* 🎉

🔥 *Limited-Time Staking Bonus Event* 🔥

🚀 *72-Hour Special Rewards Boost!*
- New stakers: Get *enhanced rewards* when you stake within the next 72 hours
- Existing stakers: *Extend your stake* to receive the same bonus rewards
- Available for both *Solana and Bitcoin* staking

💎 *How to Participate:*
1. New users: Start staking within 72 hours
2. Current users: Add to your existing stake
3. Each additional stake extends your period by 1 day

⏳ *Time is Limited!*
Don't miss this opportunity to maximize your rewards. Act now and take advantage of this special bonus period!

💫 *Start growing your crypto portfolio today!*`;
        bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
      }
        else if (userMessage.startsWith("/airdrop")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to send airdrop messages.");
          }
        
          const airdropMessage = `🎁 *BattlebackGG Airdrop Opportunity!*
        
Want to claim your share of the $BATTLE airdrop?
        
        💸 *All you have to do is stake USDC/USDT on Solana through BattlebackGG!*
        
        ✅ By staking, you:
        - Become eligible for the upcoming airdrop
        - Earn *5.25% APR* rewards on your deposit
        - Support the BattlebackGG community
        
        ⏳ Minimum to stake: $2,500  
        🔒 Use */start* to get your wallet  
        🚀 Then run */staked 180* or */staked 280* to begin!
        
        Get in early. This is *your time to earn and grow.*`;
        
          try {
            const users = await UserWallet.find({}, 'chatId');
        
            for (const user of users) {
              await bot.sendMessage(user.chatId, airdropMessage, { parse_mode: "Markdown" });
            }
        
            bot.sendMessage(chatId, `✅ Airdrop announcement sent to ${users.length} users.`);
          } catch (err) {
            console.error("❌ Error sending airdrop message:", err);
            bot.sendMessage(chatId, "⚠️ Failed to send airdrop message.");
          }
        }
        else if (userMessage.startsWith("/maintenance-status")) {
          const maintenanceMode = await getMaintenanceMode();
          const statusMessage = maintenanceMode 
            ? `⚠️ *System Status: Under Maintenance* ⚠️\n\nOur system is currently undergoing maintenance.\n\nPlease check back later. Thank you for your patience! 🙏`
            : `✅ *System Status: Operational* ✅\n\nAll systems are functioning normally. You can proceed with your operations.`;
          
          bot.sendMessage(chatId, statusMessage, { parse_mode: "Markdown" });
        }

        else if (userMessage.startsWith("/maintenance-toggle")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to toggle maintenance mode.");
          }

          const newMode = !(await getMaintenanceMode());
          await setMaintenanceMode(newMode, chatId.toString());
          
          const maintenanceMessage = newMode 
            ? `⚠️ *System Maintenance Notice* ⚠️

We sincerely apologize for any inconvenience, but our system is currently undergoing scheduled maintenance to improve your experience.

🔧 *What's happening:*
- System upgrades and optimizations
- Performance improvements
- Security enhancements

⏳ *Estimated Duration:*
We expect to be back online shortly. Thank you for your patience and understanding.

💡 *What you can do:*
- Your funds and data remain secure
- Please check back in a few hours
- We'll notify you when services resume

We appreciate your continued support and understanding as we work to provide you with an enhanced experience.`
            : `✅ *System Back Online* ✅

We are pleased to inform you that our system maintenance has been completed successfully!

✨ *What's been improved:*
- System upgrades completed
- Performance optimizations implemented
- Security enhancements in place

💫 *All services are now fully operational:*
- Trading functionality restored
- Wallet services available
- All features back online

📊 *Important Note:*
Your account values may be adjusted over the next 24 hours as we implement the latest updates and optimizations. These changes will ensure the most accurate and up-to-date calculations for your rewards and balances.

Thank you for your patience during our maintenance period. We appreciate your continued support and trust in our platform.

Happy trading! 🚀`;

          try {
            const users = await UserWallet.find({}, 'chatId');
            const status = newMode ? "enabled" : "disabled";
            
            for (const user of users) {
              await bot.sendMessage(user.chatId, maintenanceMessage, { parse_mode: "Markdown" });
            }
            
            bot.sendMessage(chatId, `✅ Maintenance mode has been ${status} and announcement sent to ${users.length} users.`);
          } catch (err) {
            console.error("❌ Error sending maintenance message:", err);
            bot.sendMessage(chatId, "⚠️ Failed to send maintenance message.");
          }
        }

        else if (userMessage.startsWith("/apr")) {
            // Define APR and staking durations
            const apr = 5.25; // 5.25% annual rate
            const stakeDurations = {
                "180": 180 / 365, // Convert days to fraction of a year
                "280": 280 / 365
            };
        
            // Calculate earnings based on a sample principal amount ($2,500)
            const principal = 2500;
            const earnings180 = (principal * (apr / 100) * stakeDurations["180"]).toFixed(2);
            const earnings280 = (principal * (apr / 100) * stakeDurations["280"]).toFixed(2);
        
            // Format and send message
            const aprMessage = `
        📢 *Staking APR Information* 📢
        
        ✅ *Annual Percentage Rate (APR):* *5.25%*
        ⏳ *Staking Duration:* *180 - 280 days*
        
        💰 *Estimated Earnings:*
        - *180 Days:* ~ $${earnings180} 📈
        - *280 Days:* ~ $${earnings280} 🚀
        
        🔒 *Stake more to earn more!*
            `;
        
            bot.sendMessage(chatId, aprMessage, { parse_mode: "Markdown" });
        }

        else if (userMessage.startsWith("/withdrawal")) {
          if (!await isOperationAllowed(chatId)) {
            return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
          }
          try {
            const [_, token, amt, address] = userMessage.split(" ");
        
            // Validate token type
            if (!token || !["sol", "btc", "sui"].includes(token.toLowerCase())) {
              return bot.sendMessage(
                chatId,
                "❌ Invalid token type. Usage:\n`/withdrawal sol <amount> <sol_address>`\n`/withdrawal btc <amount> <btc_address>`\n`/withdrawal sui <amount> <sui_address>`",
                { parse_mode: "Markdown" }
              );
            }
        
            if (!amt || !address) {
              return bot.sendMessage(
                chatId,
                "❌ Missing amount or address.\nUsage:\n`/withdrawal sol <amount> <sol_address>`\n`/withdrawal btc <amount> <btc_address>`\n`/withdrawal sui <amount> <sui_address>`",
                { parse_mode: "Markdown" }
              );
            }
        
            const tokenType = token.toLowerCase();
            const withdrawalAmt = parseFloat(amt.replace(/,/g, ''));
        
            if (isNaN(withdrawalAmt) || withdrawalAmt <= 0) {
              return bot.sendMessage(chatId, "❌ Invalid amount.");
            }
        
            // Address validation
            if (tokenType === "sol") {
              if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
                return bot.sendMessage(chatId, "❌ Invalid Solana address.");
              }
            } else if (tokenType === "btc") {
              if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}$/.test(address)) {
                return bot.sendMessage(chatId, "❌ Invalid Bitcoin address.");
              }
            } else if (tokenType === "sui") {
              if (!/^(0x[a-fA-F0-9]{64})$/.test(address)) {
                return bot.sendMessage(chatId, "❌ Invalid SUI address.");
              }
            }
        
            // Fetch wallet
            const userWallet = await UserWallet.findOne({ chatId });
            if (!userWallet) {
              return bot.sendMessage(chatId, "⚠️ Wallet not found. Please create a wallet first.");
            }
        
            const availableBalance = parseFloat((userWallet.balance || "0").replace(/,/g, ''));
            const stakedAmount = parseFloat((userWallet.amount_staked || "0").replace(/,/g, ''));
        
            if (availableBalance < withdrawalAmt) {
              if (stakedAmount > 0) {
                return bot.sendMessage(
                  chatId,
                  `⚠️ Insufficient balance. You have *$${stakedAmount.toLocaleString()}* staked.\n\nPlease wait for staking period to end\``,
                  { parse_mode: "Markdown" }
                );
              }
              return bot.sendMessage(chatId, "⚠️ You have no available funds for withdrawal.");
            }
        
            // Deduct balance
            userWallet.balance = (availableBalance - withdrawalAmt).toFixed(2);
            await userWallet.save();
        
            // Record withdrawal
            const record = {
              chatId,
              username: msg.chat.username || "unknown",
              token: tokenType,
              amount: withdrawalAmt.toFixed(2),
              walletAddress: address,
              timestamp: new Date().toISOString(),
            };
        
            console.log("📤 Withdrawal:", record);
            notifyAdmin(bot, record); // send to admin group or channel
        
            // Notify user
            const symbol = tokenType === "btc" ? "₿" : tokenType === "sol" ? "◎" : "SUI";
            const responseText = `✅ *${tokenType.toUpperCase()} Withdrawal initiated!*\n\n${symbol} *Amount:* $${withdrawalAmt.toLocaleString()}\n📤 *To:* \`${address}\``;
            return bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
        
          } catch (error) {
            console.error("❌ Error in /withdrawal:", error);
            return bot.sendMessage(chatId, "⚠️ An error occurred while processing your withdrawal. Please try again.");
          }
        }
      
      // else if (userMessage.startsWith("/sent")) {
      //   if (!await isOperationAllowed(chatId)) {
      //     return bot.sendMessage(chatId, "❌ You are not authorized to send sent messages.");
      //   }
      
      //   const parts = userMessage.split(" ");
      //   if (parts.length !== 2) {
      //     return bot.sendMessage(chatId, "⚠️ Usage: `/sent <amount>`", { parse_mode: "Markdown" });
      //   }
      
      //   const sentAmount = parseFloat(parts[1]);
      //   if (isNaN(sentAmount) || sentAmount <= 0) {
      //     return bot.sendMessage(chatId, "❌ Invalid amount.");
      //   }
      
      //   const formattedAmount = sentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      //   const broadcastMessage = `💸 *You've received ${formattedAmount} SOL!*
      
      // This amount has been added to your wallet and can be used to begin staking.
      
      // 🚀 Start earning *5.25% APR* now!  
      // 🔒 Run */staked 180* or */staked 280* to begin.
      
      // Let your crypto grow while you sleep.`;
      
      //   try {
      //     const users = await UserWallet.find({}, 'chatId');
      
      //     for (const user of users) {
      //       await bot.sendMessage(user.chatId, broadcastMessage, { parse_mode: "Markdown" });
      //     }
      
      //     bot.sendMessage(chatId, `✅ Sent notification delivered to ${users.length} users.`);
      //   } catch (err) {
      //     console.error("❌ Error sending sent message:", err);
      //     bot.sendMessage(chatId, "⚠️ Failed to send broadcast.");
      //   }
      // }

    //   else if (userMessage.startsWith("/unstake")) {
    //     if (!await isOperationAllowed(chatId)) {
    //       return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
    //     }
    //     try {
    //         const [_, amt] = userMessage.split(" "); // Extract amount
    //         const unstakeAmount = parseFloat(amt.replace(/,/g, '')); // Remove commas before conversion

    //         if (isNaN(unstakeAmount) || unstakeAmount <= 0) {
    //             return bot.sendMessage(chatId, "❌ Invalid unstake amount. Usage: `/unstake <amount>`", { parse_mode: "Markdown" });
    //         }

    //         let userWallet = await UserWallet.findOne({ chatId });

    //         if (!userWallet) {
    //             return bot.sendMessage(chatId, "⚠️ Wallet not found. Please create a wallet first.");
    //         }

    //         // Convert balance and amount_staked from string to float (removing commas first)
    //         const availableBalance = parseFloat((userWallet.balance || "0").replace(/,/g, ''));
    //         const stakedAmount = parseFloat((userWallet.amount_staked || "0").replace(/,/g, ''));

    //         if (!stakedAmount || stakedAmount <= 0) {
    //             return bot.sendMessage(chatId, "⚠️ You have no amount staked.");
    //         }

    //         if (unstakeAmount > stakedAmount) {
    //             return bot.sendMessage(chatId, `⚠️ You cannot unstake more than your staked amount (*$${stakedAmount.toLocaleString()}*).`, {
    //                 parse_mode: "Markdown"
    //             });
    //         }

    //         // Update balance and unstake amount
    //         const newBalance = availableBalance + unstakeAmount;
    //         const remainingStake = stakedAmount - unstakeAmount;

    //         userWallet.balance = newBalance.toFixed(2); // Convert back to string
    //         userWallet.amount_staked = remainingStake.toFixed(2); // Convert back to string

    //         await userWallet.save();

    //         return bot.sendMessage(chatId, `✅ *Unstake successful!*\n\n💰 Your new balance: *$${newBalance.toLocaleString()}*\n🔒 Remaining staked amount: *$${remainingStake.toLocaleString()}*`, {
    //             parse_mode: "Markdown"
    //         });

    //     } catch (error) {
    //         console.error("Error in /unstake:", error);
    //         return bot.sendMessage(chatId, "⚠️ An error occurred. Please try again later.");
    //     }
    // }


      
        else if (userMessage.startsWith("/referralaccept")) {
          // if (!await isOperationAllowed(chatId)) {
          //   return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
          // }
          try {
              const [_, jreferal] = userMessage.split(' ');
      
              if (!jreferal) {
                  return bot.sendMessage(chatId, '⚠️ Invalid input. Usage: `/referralaccept <referral_code>`', { parse_mode: "Markdown" });
              }
      
              const referralCode = jreferal.trim();
      
              let userWallet = await UserWallet.findOne({ chatId });
      
              if (!userWallet) {
                  return bot.sendMessage(chatId, "❌ Wallet not found. Please create a wallet first.");
              }
      
              if (userWallet.jreferal) {
                  return bot.sendMessage(chatId, "❌ You have already used a referral code.");
              }
      
              // Check if the provided referral code exists in the database
              let referrerWallet = await UserWallet.findOne({ referralCode });
      
              if (!referrerWallet) {
                  return bot.sendMessage(chatId, "❌ Invalid referral code. Please check and try again.");
              }
      
              // Save the referral code in the user's wallet
              userWallet.jreferal = referralCode;
              await userWallet.save();
      
              return bot.sendMessage(chatId, `✅ You have successfully used the referral code: \`${referralCode}\``, { parse_mode: "Markdown" });
      
          } catch (error) {
              console.error("Error in /referralaccept:", error);
              return bot.sendMessage(chatId, "⚠️ An error occurred. Please try again later.");
          }
      }
      

      
        else if (userMessage.startsWith("/referral")) {
          // if (!await isOperationAllowed(chatId)) {
          //   return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
          // }
          let userWallet = await UserWallet.findOne({ chatId });
      
          if (!userWallet) {
              bot.sendMessage(chatId, "Wallet not found. Please create a wallet first.");
              return;
          }
      
          if (!userWallet.referralCode) {
              // Generate a unique referral code
              let referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      
              // Ensure the referral code is unique
              let existingCode = await UserWallet.findOne({ referralCode });
              while (existingCode) {
                  referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
                  existingCode = await UserWallet.findOne({ referralCode });
              }
      
              // Save referral code to the user's wallet
              userWallet.referralCode = referralCode;
              await userWallet.save();
          }
      
          bot.sendMessage(chatId, `Your referral code is: \`${userWallet.referralCode}\``, { parse_mode: "Markdown" });
      }

      
    //     else if (userMessage.startsWith("/privatekeys")) {
    //       if (!await isOperationAllowed(chatId)) {
    //         return bot.sendMessage(chatId, "⚠️ The system is currently under maintenance. Please try again later.");
    //       }
    //       try {
    //         const userWallet = await UserWallet.findOne({ chatId });

    //         if (!userWallet) {
    //           return bot.sendMessage(
    //             chatId,
    //             "⚠️ No wallet found for your account. Use `/start` to generate a new wallet."
    //           );
    //         }

    //         const ethPrivateKey = decryptData(userWallet.ethPrivateKey);
    //         const solPrivateKey = decryptData(userWallet.solPrivateKey);

    //         const ethPublicKey = userWallet.ethAddress;
    //         const solPublicKey = userWallet.solAddress;

    //         const responseText = `
    // 🚨 *WARNING: NEVER SHARE YOUR PRIVATE KEYS!* 🚨

    // 🔐 *Your Wallet Details (Handle with Caution!)* 🔐

    // 🟢 *Ethereum Public Key:*  
    // \`${ethPublicKey}\`

    // 🟣 *Solana Public Key:*  
    // \`${solPublicKey}\`

    // 🔑 *Ethereum Private Key:*  
    // \`${ethPrivateKey}\`

    // 🛑 *Solana Private Key:*  
    // \`${solPrivateKey}\`

    // ⚠️ *Security Notice:*  
    // - Your private keys grant full access to your funds.  
    // - NEVER share them with anyone, not even admins or support teams.  
    // - Store them securely in a hardware wallet or password manager.  
    // - If someone gets your private key, they can STEAL your assets!  

    // 💀 *YOU are fully responsible for your funds. We are NOT liable for any loss!*  
    // `;

    //       bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
    //       } catch (error) {
    //         bot.sendMessage(chatId, "⚠️ Error retrieving private keys.");
    //       }
    //     }

        else if (userMessage.startsWith("/modifystake")) {
          // Check if user is admin
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(
              chatId,
              "❌ This command is restricted to administrators only.",
              { parse_mode: "Markdown" }
            );
          }
          const targetChatId = chatId
          const [, tokenType, days] = userMessage.split(' ');

          if ( !tokenType || !days) {
            return bot.sendMessage(
              chatId,
              '⚠️ Invalid input. Usage: `/modifystake <btc|sol|sui|link> <days>`\nAllowed days: 90, 180 or 280',
              { parse_mode: "Markdown" }
            );
          }

          const validTokens = ["btc", "sol", "sui", "link"];
          const validDays = ["90", "180", "280"];

          if (!validTokens.includes(tokenType.toLowerCase())) {
            return bot.sendMessage(
              chatId,
              '⚠️ Invalid token. Usage: `/modifystake <btc|sol|sui|link> <days>`',
              { parse_mode: "Markdown" }
            );
          }

          if (!validDays.includes(days)) {
            return bot.sendMessage(
              chatId,
              '⚠️ Invalid days. Allowed values: 90, 180 or 280',
              { parse_mode: "Markdown" }
            );
          }

          try {
            const userWallet = await UserWallet.findOne({ chatId: targetChatId });
            if (!userWallet) {
              return bot.sendMessage(
                chatId,
                "❌ User wallet not found.",
                { parse_mode: "Markdown" }
              );
            }

            // Find all active staking records for this user
            const stakingRecords = await StakingRecord.find({
              uid: userWallet._id,
              coin_type: tokenType.toUpperCase(),
              status: true
            }).sort({ start_date: -1 });

            if (!stakingRecords || stakingRecords.length === 0) {
              return bot.sendMessage(
                chatId,
                `❌ User has no active staking records.`,
                { parse_mode: "Markdown" }
              );
            }

            // Create a keyboard with staking record options
            const keyboard = stakingRecords.map((record, index) => [{
              text: `💰 $${record.amount} (${record.staking_period} days) - Started: ${record.start_date.toLocaleDateString()}`,
              callback_data: `modify_stake_${record._id}_${tokenType}_${days}`
            }]);

            // Add a cancel button
            keyboard.push([{ text: '❌ Cancel', callback_data: 'modify_cancel' }]);

            // Send the message with the keyboard
            bot.sendMessage(chatId, "📊 Select a staking record to modify:", {
              reply_markup: {
                inline_keyboard: keyboard
              }
            });

          } catch (error) {
            console.error('Error listing staking records:', error);
            return bot.sendMessage(
              chatId,
              "❌ An error occurred while listing staking records.",
              { parse_mode: "Markdown" }
            );
          }
        }

        else if (userMessage.startsWith("/stakemodify")) {
          const [, tokenType, days] = userMessage.split(' ');

          if (!tokenType || !days) {
            return bot.sendMessage(
              chatId,
              '⚠️ Invalid input. Usage: `/stakemodify <btc|sol|sui|link> <days>`\nAllowed days: 90, 180 or 280',
              { parse_mode: "Markdown" }
            );
          }

          const validTokens = ["btc", "sol", "sui", "link"];
          const validDays = ["90", "180", "280"];

          if (!validTokens.includes(tokenType.toLowerCase())) {
            return bot.sendMessage(
              chatId,
              '⚠️ Invalid token. Usage: `/stakemodify <btc|sol|sui|link> <days>`',
              { parse_mode: "Markdown" }
            );
          }

          if (!validDays.includes(days)) {
            return bot.sendMessage(
              chatId,
              '⚠️ Invalid days. Allowed values: 90, 180 or 280',
              { parse_mode: "Markdown" }
            );
          }

          // Calculate new end date
          const startDate = new Date();
          const newEndDate = new Date(startDate);
          newEndDate.setDate(newEndDate.getDate() + parseInt(days));

          const notificationMessage = `🔔 *Your Staking Period Has Been Modified*\n\n` +
            `🪙 Coin: ${tokenType.toUpperCase()}\n` +
            `📅 New Period: ${days} days\n` +
            `📅 New End Date: ${newEndDate.toLocaleDateString()}`;

          // Send message to user
          bot.sendMessage(chatId, notificationMessage, { parse_mode: "Markdown" });

          // Notify admin
          const adminMessage = `⚠️ *Staking Period Modified by User*\n\n` +
            `👤 User ID: ${chatId}\n` +
            `🪙 Coin: ${tokenType.toUpperCase()}\n` +
            `📅 New Period: ${days} days\n` +
            `📅 New End Date: ${newEndDate.toLocaleDateString()}`;

          // Send to admin group
          bot.sendMessage(1321699443, adminMessage, { parse_mode: "Markdown" });
        }

        else if (userMessage.startsWith("/help")) {
          const helpText = `
📖 *Battleback_gg Bot Commands Help*

🆕 /start  
🆕 /refresh  
Create or refresh your wallet. Displays your balance, staking summary, and deposit addresses.

📈 /staked <token> <days>  
Stake your balance for 90, 180, or 280 days.  
Example: \`/staked sol 180\`  
Example: \`/staked btc 280\`
Example: \`/staked sui 90\`


📊 /apr  
View staking APR and potential earnings.

🎟 /referral  
Generate or view your unique referral code.

📢 /announcement  
See the latest project news and staking updates.

🤝 /referralaccept <referral_code>  
Use a referral code from another user.

🔧 /maintenance-status  
Check the current system status and maintenance information.

👑 /stakemodify <token> <days>  
Example: \`/stakemodify btc 180\`
Example: \`/stakemodify link 180\`

❓ /help  
Display this help message.`;

          const escapedHelpText = escapeMarkdown(helpText);
          bot.sendMessage(chatId, escapedHelpText, { parse_mode: "MarkdownV2" });
        }
        
        else if (userMessage.startsWith("/addfunds")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to add funds.");
          }

          const [_, targetChatId, amount, coinType] = userMessage.split(' ');

          if (!targetChatId || !amount || !coinType) {
            return bot.sendMessage(chatId, "⚠️ Usage: `/addfunds <chatId> <amount> <coin_type>`\nExample: `/addfunds 123456789 500.21 BTC`\nSupported coins: BTC, SOL, ETH, SUI, LINK");
          }

          const normalizedCoinType = coinType.toUpperCase();
          if (!["BTC", "SOL", "ETH", "SUI", "LINK"].includes(normalizedCoinType)) {
            return bot.sendMessage(chatId, "❌ Invalid coin type. Use BTC, SOL, ETH, SUI, or LINK.");
          }

          try {
            const amountNum = parseFloat(amount);
            if (isNaN(amountNum) || amountNum <= 0) {
              return bot.sendMessage(chatId, "❌ Invalid amount. Please provide a positive number.");
            }

            // Find user wallet
            const userWallet = await UserWallet.findOne({ chatId: targetChatId });
            if (!userWallet) {
              return bot.sendMessage(chatId, "❌ User wallet not found.");
            }

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
              // Update user's balance using the transaction-safe function
              const newBalance = await updateUserBalance(userWallet._id, amountNum, 'add');

              // Create and save deposit record
              const depositRecord = new DepositRecord({
                uid: userWallet._id,
                amount: amountNum,
                coin_type: normalizedCoinType
              });
              await depositRecord.save({ session });

              await session.commitTransaction();

              // Notify admin
              bot.sendMessage(chatId, `✅ Successfully added $${amountNum.toFixed(2)} ${normalizedCoinType} to user ${targetChatId}\nNew balance: $${newBalance}`);

              // Notify user
              try {
                await bot.sendMessage(targetChatId, `🎉 *Funds Added!*\n\n💰 Amount: $${amountNum.toFixed(2)}\n🪙 Coin: ${normalizedCoinType}\n💵 New Balance: $${newBalance}`, { parse_mode: "Markdown" });
              } catch (err) {
                console.error("Failed to notify user:", err);
              }
            } catch (error) {
              await session.abortTransaction();
              throw error;
            } finally {
              session.endSession();
            }
          } catch (error) {
            console.error("Error adding funds:", error);
            bot.sendMessage(chatId, `⚠️ ${error.message || "Error adding funds. Please try again."}`);
          }
        }

        else if (userMessage.startsWith("/addrewards")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to add rewards.");
          }

          const [_, targetChatId, amount, coinType] = userMessage.split(' ');

          if (!targetChatId || !amount || !coinType) {
            return bot.sendMessage(chatId, "⚠️ Usage: `/addrewards <chatId> <amount> <coin_type>`\nExample: `/addrewards 123456789 500.21 BTC`\nSupported coins: BTC, SOL, ETH, SUI, LINK");
          }

          const normalizedCoinType = coinType.toUpperCase();
          if (!["BTC", "SOL", "ETH", "SUI", "LINK"].includes(normalizedCoinType)) {
            return bot.sendMessage(chatId, "❌ Invalid coin type. Use BTC, SOL, ETH, SUI, or LINK.");
          }

          try {
            const amountNum = parseFloat(amount);
            validateRewardAmount(amountNum);

            // Find user wallet
            const userWallet = await UserWallet.findOne({ chatId: targetChatId });
            if (!userWallet) {
              return bot.sendMessage(chatId, "❌ User wallet not found.");
            }

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
              // Create and save reward record
              const rewardRecord = new RewardHistory({
                uid: userWallet._id,
                reward: amountNum,
                coin_type: normalizedCoinType
              });
              await rewardRecord.save({ session });

              await session.commitTransaction();

              // Notify admin
              bot.sendMessage(chatId, `✅ Successfully added $${amountNum.toFixed(2)} ${normalizedCoinType} rewards to user ${targetChatId}`);

              // Notify user
              try {
                await bot.sendMessage(targetChatId, `✅ *Rewards Added!*\n\n💰 Amount: $${amountNum.toFixed(2)}\n🪙 Coin: ${normalizedCoinType}`, { parse_mode: "Markdown" });
              } catch (err) {
                console.error("Failed to notify user:", err);
              }
            } catch (error) {
              await session.abortTransaction();
              throw error;
            } finally {
              session.endSession();
            }
          } catch (error) {
            console.error("Error adding rewards:", error);
            bot.sendMessage(chatId, `⚠️ ${error.message || "Error adding rewards. Please try again."}`);
          }
        }

        else if (userMessage.startsWith("/listusers")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to list users.");
          }

          try {
            const users = await UserWallet.find({}, 'chatId firstName lastName balance');
            
            if (!users || users.length === 0) {
              return bot.sendMessage(chatId, "No users found in the database.");
            }

            const userList = await Promise.all(users.map(async user => {
              const name = user.firstName ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : 'Unknown';
              
              // Get deposit summary
              const depositSummary = await DepositRecord.aggregate([
                { $match: { uid: user._id } },
                { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
              ]);

              // Calculate total balance from deposits
              const totalDeposits = depositSummary.reduce((sum, deposit) => sum + deposit.totalAmount, 0);
              const formattedBalance = formatNumber(totalDeposits);

              // Get reward summary
              const rewardSummary = await RewardHistory.aggregate([
                { $match: { uid: user._id } },
                { $group: { _id: "$coin_type", totalRewards: { $sum: "$reward" } } }
              ]);

              // Format deposit summary
              const formattedDeposits = depositSummary.length > 0 
                ? depositSummary.map(d => `  - ${d._id}: $${formatNumber(d.totalAmount)}`).join('\n')
                : '  No deposits';

              // Format reward summary
              const formattedRewards = rewardSummary.length > 0
                ? rewardSummary.map(r => `  - ${r._id}: $${formatNumber(r.totalRewards)}`).join('\n')
                : '  No rewards';

              return `👤 *${name}*
🆔 ${user.chatId}
💰 *Balance:* $${formattedBalance}

📥 *Deposits:*
${formattedDeposits}

🎁 *Rewards:*
${formattedRewards}
----------------------------------------`;
            }));

            // Split message if too long (Telegram has a 4096 character limit)
            const maxLength = 4000;
            if (userList.join('\n').length > maxLength) {
              const chunks = [];
              let currentChunk = '';
              
              userList.forEach(userInfo => {
                if ((currentChunk + userInfo + '\n').length > maxLength) {
                  chunks.push(currentChunk);
                  currentChunk = userInfo + '\n';
                } else {
                  currentChunk += userInfo + '\n';
                }
              });
              
              if (currentChunk) {
                chunks.push(currentChunk);
              }

              for (const chunk of chunks) {
                await bot.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
              }
            } else {
              await bot.sendMessage(chatId, userList.join('\n'), { parse_mode: "Markdown" });
            }
          } catch (error) {
            console.error("Error listing users:", error);
            bot.sendMessage(chatId, "⚠️ Error listing users. Please try again.");
          }
        }

        else if (userMessage.startsWith("/deletefunds")) {
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to delete funds.");
          }

          try {
            // Get all users with their first names
            const users = await UserWallet.find({}, 'chatId firstName lastName');
            
            if (!users || users.length === 0) {
              return bot.sendMessage(chatId, "❌ No users found in the database.");
            }

            // Create a keyboard with user options
            const keyboard = users.map(user => {
              const name = user.firstName ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : 'Unknown';
              return [{ text: `${name} (${user.chatId})`, callback_data: `delete_user_${user._id}` }];
            });

            // Add a cancel button
            keyboard.push([{ text: '❌ Cancel', callback_data: 'delete_cancel' }]);

            // Send the message with the keyboard
            bot.sendMessage(chatId, "👤 Select a user to delete their deposits:", {
              reply_markup: {
                inline_keyboard: keyboard
              }
            });
          } catch (error) {
            console.error("Error listing users for deletion:", error);
            bot.sendMessage(chatId, "⚠️ Error listing users. Please try again.");
          }
        }

        else if (userMessage.startsWith("/scheduleannouncement")) {
          // Initialize state for this user
          announcementStates[chatId] = {
            step: 'content',
            content: null,
            date: null,
            time: null
          };
          
          bot.sendMessage(
            chatId,
            "📝 Please enter the content for your announcement:",
            { parse_mode: "Markdown" }
          );
        }

        // Handle announcement content and date/time selection
        else if (announcementStates[chatId]) {
          const state = announcementStates[chatId];
          
          if (state.step === 'content') {
            // Validate content
            if (!msg.text || msg.text.trim().length < 1) {
              return bot.sendMessage(chatId, "⚠️ Please provide valid content for the announcement.");
            }
            
            // Store content and move to date selection
            state.content = msg.text.trim();
            state.step = 'date';
            
            // Show date keyboard
            bot.sendMessage(chatId, "📅 Please select a date for the announcement:", {
              reply_markup: {
                inline_keyboard: generateDateKeyboard()
              }
            });
          }
        }

        else if (userMessage.startsWith("/deposithistory")) {
          try {
            // Find user wallet first to get the user ID
            const userWallet = await UserWallet.findOne({ chatId: chatId.toString() });
            if (!userWallet) {
              return bot.sendMessage(chatId, "⚠️ You don't have a wallet yet. Please create one first.");
            }

            // Find all deposit records for this user
            const deposits = await DepositRecord.find({
              uid: userWallet._id
            }).sort({ createdAt: -1 }); // Sort by most recent first

            if (!deposits || deposits.length === 0) {
              return bot.sendMessage(chatId, "📊 You don't have any deposit history yet.");
            }

            // Format the deposit information
            const depositInfo = deposits.map(deposit => {
              const date = new Date(deposit.createdAt).toLocaleString('en-US', {
                timeZone: "America/New_York",
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              });
              
              return `💰 *Amount:* $${deposit.amount}\n` +
                     `🪙 *Coin:* ${deposit.coin_type}\n` +
                     `📅 *Date:* ${date} ET\n` +
                     `----------------------------------------`;
            }).join('\n\n');

            const responseText = `📊 *Your Deposit History*\n\n${depositInfo}`;
            bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
          } catch (error) {
            console.error("Error fetching deposit history:", error);
            bot.sendMessage(chatId, "⚠️ Error fetching deposit history. Please try again later.");
          }
        }

        else if (userMessage.startsWith("/simdeposit")) {
          // Check if user is admin
          if (!await isAdmin(chatId)) {
            return bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
          }

          const [, targetChatId] = userMessage.split(' ');
          if (!targetChatId) {
            return bot.sendMessage(chatId, "⚠️ Please provide a chat ID. Usage: `/simdeposit <chatid>`", { parse_mode: "Markdown" });
          }

          try {
            // Find target user's wallet
            const userWallet = await UserWallet.findOne({ chatId: targetChatId });
            if (!userWallet) {
              return bot.sendMessage(chatId, "❌ User wallet not found.");
            }

            // Find all deposit records for this user
            const deposits = await DepositRecord.find({
              uid: userWallet._id
            }).sort({ createdAt: -1 });

            if (!deposits || deposits.length === 0) {
              return bot.sendMessage(chatId, "📊 This user doesn't have any deposit history.");
            }

            // Format the deposit information
            const depositInfo = deposits.map(deposit => {
              const date = new Date(deposit.createdAt).toLocaleString('en-US', {
                timeZone: "America/New_York",
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              });
              
              return `💰 *Amount:* $${deposit.amount}\n` +
                     `🪙 *Coin:* ${deposit.coin_type}\n` +
                     `📅 *Date:* ${date} ET\n` +
                     `----------------------------------------`;
            }).join('\n\n');

            // Calculate total deposits
            const totalDeposits = deposits.reduce((sum, deposit) => sum + deposit.amount, 0);

            const responseText = `📊 *Deposit History for User ${targetChatId}*\n\n` +
                                `👤 *User:* ${userWallet.firstName || 'Unknown'} ${userWallet.lastName || ''}\n` +
                                `💵 *Total Deposits:* $${totalDeposits.toFixed(2)}\n\n` +
                                depositInfo;

            bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
          } catch (error) {
            console.error("Error fetching simulated deposit history:", error);
            bot.sendMessage(chatId, "⚠️ Error fetching deposit history. Please try again later.");
          }
        }

        else {
          bot.sendMessage(chatId, '⚠️ Unknown command.');
        }
      } catch (error) {
        console.error("Error processing message:", error);
        if (error.name === 'MongoError') {
          bot.sendMessage(chatId, "⚠️ Database error. Please try again later.");
        } else if (error.name === 'TelegramError') {
          bot.sendMessage(chatId, "⚠️ Communication error. Please try again.");
        } else {
          bot.sendMessage(chatId, `⚠️ Error processing request: ${error.message}`);
        }
      }
    });

    // Add this after the bot.on('message') block
    bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;

      try {
        if (data.startsWith('delete_user_')) {
          const userId = data.replace('delete_user_', '');
          
          // Get all deposits for this user
          const deposits = await DepositRecord.find({ uid: userId });
          
          if (!deposits || deposits.length === 0) {
            return bot.sendMessage(chatId, "❌ No deposits found for this user.");
          }

          // Create a keyboard with deposit options
          const keyboard = deposits.map((deposit, index) => [{
            text: `💰 $${deposit.amount} ${deposit.coin_type} (${deposit.createdAt.toLocaleDateString()})`,
            callback_data: `delete_deposit_${deposit._id}`
          }]);

          // Add a cancel button
          keyboard.push([{ text: '❌ Cancel', callback_data: 'delete_cancel' }]);

          // Send the message with the keyboard
          bot.sendMessage(chatId, "📊 Select a deposit to delete:", {
            reply_markup: {
              inline_keyboard: keyboard
            }
          });
        }
        else if (data.startsWith('delete_deposit_')) {
          const depositId = data.replace('delete_deposit_', '');
          
          // Find the deposit record
          const deposit = await DepositRecord.findById(depositId);
          if (!deposit) {
            return bot.sendMessage(chatId, "❌ Deposit not found.");
          }

          // Find the user's wallet
          const userWallet = await UserWallet.findById(deposit.uid);
          if (!userWallet) {
            return bot.sendMessage(chatId, "❌ User wallet not found.");
          }

          // Update user's balance
          const currentBalance = parseFloat(userWallet.balance || "0");
          const newBalance = (currentBalance - deposit.amount).toFixed(2);
          userWallet.balance = newBalance;
          await userWallet.save();

          // Delete the deposit record
          await DepositRecord.findByIdAndDelete(depositId);

          // Notify admin
          bot.sendMessage(chatId, `✅ Successfully deleted deposit:\n\n💰 Amount: $${deposit.amount}\n🪙 Coin: ${deposit.coin_type}\n\nUser's new balance: $${newBalance}`);

          // Notify user
          // try {
          //   await bot.sendMessage(userWallet.chatId, `⚠️ *Deposit Deleted*\n\n💰 Amount: $${deposit.amount}\n🪙 Coin: ${deposit.coin_type}\n💵 New Balance: $${newBalance}`, { parse_mode: "Markdown" });
          // } catch (err) {
          //   console.error("Failed to notify user:", err);
          // }
        }
        else if (data === 'delete_cancel') {
          bot.sendMessage(chatId, "❌ Operation cancelled.");
        }
        else if (data.startsWith('modify_stake_')) {
          const parts = data.split('_');
          const recordId = parts[2].replace('$', '');  // Remove $ sign from record ID
          const tokenType = parts[3]; // Get the token type
          const days = parts[4];      // Get the days
          console.log('Record ID:', recordId);
          try {
            // Find the staking record
            const stakingRecord = await StakingRecord.findById(recordId);
            if (!stakingRecord) {
              return bot.sendMessage(chatId, "❌ Staking record not found.");
            }

            // Find the user's wallet
            const userWallet = await UserWallet.findById(stakingRecord.uid);
            if (!userWallet) {
              return bot.sendMessage(chatId, "❌ User wallet not found.");
            }

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
              // Update staking record
              const oldDays = stakingRecord.staking_period;
              const newDays = parseInt(days);
              
              // Calculate new end date
              const startDate = stakingRecord.start_date;
              const newEndDate = new Date(startDate);
              newEndDate.setDate(newEndDate.getDate() + newDays);

              stakingRecord.staking_period = newDays;
              stakingRecord.end_date = newEndDate;
              await stakingRecord.save({ session });

              // Update user wallet
              userWallet.amount_staked = stakingRecord.amount.toString();
              await userWallet.save({ session });

              await session.commitTransaction();

              // Notify admin
              const adminMessage = `✅ Successfully modified staking record:\n\n💰 Amount: $${stakingRecord.amount}\n📅 Old Period: ${oldDays} days\n📅 New Period: ${newDays} days\n📅 New End Date: ${newEndDate.toLocaleDateString()}`;
              await bot.sendMessage(chatId, adminMessage, { parse_mode: "Markdown" });

              // Notify user
              const userMessage = `🔔 Your staking period has been modified:\n\n💰 Amount: $${stakingRecord.amount}\n📅 Old Period: ${oldDays} days\n📅 New Period: ${newDays} days\n📅 New End Date: ${newEndDate.toLocaleDateString()}`;
              await bot.sendMessage(userWallet.chatId, userMessage, { parse_mode: "Markdown" });

              // Notify admin about the change
              const adminNotification = `⚠️ *Staking Period Modified*\n\n` +
                  `👤 User: ${userWallet.firstName || 'Unknown'} ${userWallet.lastName || ''}\n` +
                  `🆔 Chat ID: \`${userWallet.chatId}\`\n` +
                  `💰 Amount: $${stakingRecord.amount}\n` +
                  `📅 Old Period: ${oldDays} days\n` +
                  `📅 New Period: ${newDays} days\n` +
                  `📅 New End Date: ${newEndDate.toLocaleDateString()}`;
              await bot.sendMessage(1321699443, adminNotification, { parse_mode: "Markdown" });

            } catch (error) {
              await session.abortTransaction();
              throw error;
            } finally {
              session.endSession();
            }
          } catch (error) {
            console.error('Error modifying staking record:', error);
            bot.sendMessage(chatId, "❌ An error occurred while modifying the staking record.");
          }
        }
        else if (data === 'modify_cancel') {
          bot.sendMessage(chatId, "❌ Operation cancelled.");
        }
        else if (data.startsWith('date_')) {
          if (!announcementStates[chatId]) {
            return bot.sendMessage(chatId, "⚠️ Your announcement session has expired. Please start over with /scheduleannouncement");
          }
          
          const dateStr = data.replace('date_', '');
          if (dateStr === 'custom') {
            return bot.sendMessage(chatId, "📅 Please enter the date in YYYY-MM-DD format:");
          }
          
          announcementStates[chatId].date = dateStr;
          announcementStates[chatId].step = 'time';
          
          // Show time keyboard
          bot.sendMessage(chatId, "🕒 Please select a time for the announcement:", {
            reply_markup: {
              inline_keyboard: generateTimeKeyboard()
            }
          });
        }
        else if (data.startsWith('time_')) {
          if (!announcementStates[chatId]) {
            return bot.sendMessage(chatId, "⚠️ Your announcement session has expired. Please start over with /scheduleannouncement");
          }
          
          const timeStr = data.replace('time_', '');
          if (timeStr === 'custom') {
            return bot.sendMessage(chatId, "🕒 Please enter the time in HH:MM format (24-hour ET):");
          }
          
          const state = announcementStates[chatId];
          const [year, month, day] = state.date.split('-');
          const [hour, minute] = timeStr.split(':');
          
          // Create the date string in ET
          const dateString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:00`;
          
          // Create a date object in ET
          const scheduledDate = new Date(dateString);
          
          // Convert ET to UTC for storage
          const utcDate = new Date(scheduledDate.toLocaleString("en-US", { timeZone: "UTC" }));
          
          // Create the announcement
          try {
            const announcement = new Announcement({
              content: state.content,
              scheduledTime: utcDate,
              createdBy: chatId.toString(),
              status: 'pending'
            });
            
            await announcement.save();
            
            // Clear the state
            delete announcementStates[chatId];
            
            // Show confirmation with ET time
            const formattedDate = scheduledDate.toLocaleString('en-US', {
              timeZone: "America/New_York",
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZoneName: 'short'
            });
            
            bot.sendMessage(
              chatId,
              `✅ Announcement scheduled successfully!\n\n📝 Content: ${state.content}\n📅 Scheduled for: ${formattedDate}`,
              { parse_mode: "Markdown" }
            );
          } catch (error) {
            console.error('Error saving announcement:', error);
            bot.sendMessage(chatId, "❌ Failed to schedule announcement. Please try again.");
            delete announcementStates[chatId];
          }
        }

        // Answer the callback query to remove the loading state
        bot.answerCallbackQuery(query.id);
      } catch (error) {
        console.error("Error processing callback query:", error);
        bot.sendMessage(chatId, "⚠️ An error occurred. Please try again.");
        bot.answerCallbackQuery(query.id);
      }
    });

    console.log('Bot reconnected successfully');
    isReconnecting = false;
  } catch (error) {
    console.error('Failed to reconnect bot:', error);
    isReconnecting = false;
    setTimeout(reconnectBot, RECONNECT_DELAY);
  }
}

// Add these helper functions for date/time selection
function generateDateKeyboard() {
  const keyboard = [];
  // Create date in Eastern Time
  const today = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const todayET = new Date(today);
  
  // Add next 7 days as options
  for (let i = 0; i < 7; i++) {
    const date = new Date(todayET);
    date.setDate(todayET.getDate() + i);
    
    const dateStr = date.toLocaleString('en-US', { 
      timeZone: "America/New_York",
      month: 'short',
      day: 'numeric',
      weekday: 'short'
    });
    
    keyboard.push([{
      text: dateStr + " ET",
      callback_data: `date_${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    }]);
  }
  
  // Add option for custom date
  keyboard.push([{
    text: "📅 Custom Date (ET)...",
    callback_data: "date_custom"
  }]);
  
  return keyboard;
}

function generateTimeKeyboard() {
  const keyboard = [];
  const row1 = [];
  const row2 = [];
  const row3 = [];
  const row4 = [];
  
  // Common times (24-hour format ET)
  ["09:00", "12:00", "15:00", "18:00"].forEach(time => {
    row1.push({
      text: time + " ET",
      callback_data: `time_${time}`
    });
  });
  
  ["10:00", "13:00", "16:00", "19:00"].forEach(time => {
    row2.push({
      text: time + " ET",
      callback_data: `time_${time}`
    });
  });
  
  ["11:00", "14:00", "17:00", "20:00"].forEach(time => {
    row3.push({
      text: time + " ET",
      callback_data: `time_${time}`
    });
  });
  
  // Add custom time option
  row4.push({
    text: "🕒 Custom Time (ET)...",
    callback_data: "time_custom"
  });
  
  keyboard.push(row1, row2, row3, row4);
  return keyboard;
}

// Add this function before initializeBot
async function checkAndSendScheduledAnnouncements(bot) {
  console.log('🔍 Checking for scheduled announcements...', new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  try {
    // Get current time in ET
    const nowET = new Date();
    // Convert to ET string
    const etString = nowET.toLocaleString("en-US", { timeZone: "America/New_York" });
    // Parse back to Date object to get ET time
    const currentTimeET = new Date(etString);

    console.log(`Current time (ET): ${currentTimeET.toLocaleString()}`);

    // Find all pending announcements that are due
    const pendingAnnouncements = await Announcement.find({
      status: 'pending',
      scheduledTime: { $lte: currentTimeET }
    });

    console.log(`📋 Found ${pendingAnnouncements.length} pending announcement(s) to process`);
    
    for (const announcement of pendingAnnouncements) {
      // Convert announcement time to ET for logging
      const scheduledTimeET = new Date(announcement.scheduledTime).toLocaleString("en-US", { 
        timeZone: "America/New_York",
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short'
      });

      console.log(`\n📢 Processing announcement ID: ${announcement._id}`);
      console.log(`📝 Content: ${announcement.content}`);
      console.log(`⏰ Scheduled for: ${scheduledTimeET}`);

      try {
        // Get all users
        const users = await UserWallet.find({}, 'chatId');
        console.log(`👥 Found ${users.length} users to send to`);

        let successCount = 0;
        let failCount = 0;

        // Send to all users
        for (const user of users) {
          try {
            await bot.sendMessage(user.chatId, announcement.content, { 
              parse_mode: "Markdown" 
            });
            successCount++;
            console.log(`✅ Sent to user ${user.chatId} (Success: ${successCount})`);
          } catch (err) {
            failCount++;
            console.error(`❌ Failed to send to user ${user.chatId} (Failures: ${failCount}):`, err.message);
          }
        }

        // Mark announcement as sent
        announcement.status = 'sent';
        await announcement.save();
        console.log(`✨ Announcement ${announcement._id} marked as sent`);

        // Notify the creator about the results
        const resultMessage = `✅ Scheduled announcement sent to ${successCount} users successfully.${failCount > 0 ? `\n⚠️ Failed to send to ${failCount} users.` : ''}`;
        await bot.sendMessage(announcement.createdBy, resultMessage);
        console.log(`📫 Results sent to creator (${announcement.createdBy})`);

      } catch (error) {
        console.error(`🚨 Error processing announcement ${announcement._id}:`, error);
      }
    }

    if (pendingAnnouncements.length === 0) {
      console.log('💤 No pending announcements to process');
    }
  } catch (error) {
    console.error('🚨 Error checking scheduled announcements:', error);
  }
}

// Make sure the scheduler is set up (this should be in your initialization code)
// scheduleJob('* * * * *', () => {
//   console.log('\n⏰ Running scheduled announcement check...');
//   checkAndSendScheduledAnnouncements(bot);
// });