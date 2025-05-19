import { BotContext } from '../types/session';
import { UserWallet, IUserWallet } from '../models/UserWallet';
import { StakingRecord } from '../models/StakingRecord';
import { RewardHistory } from '../models/RewardHistory';
import { AppSettings } from '../models/AppSettings';
import { InlineKeyboard } from 'grammy';
import { escapeMarkdown } from '../utils/helpers';
import logger from '../utils/logger';
import mongoose from 'mongoose';
import { WithdrawalHistory } from '../models/WithdrawalHistory';
import { DepositRecord } from '../models/DepositRecord';
import { generateAddress } from '../utils/wallet';
import { getBalanceSummary, getRewardSummary } from '../utils/balance';
import { formatNumber } from '../utils/helpers';

// Helper function to check if user is admin
async function isAdmin(chatId: string): Promise<boolean> {
    try {
        const userWallet = await UserWallet.findOne({ chatId });
        return userWallet?.isAdmin || false;
    } catch (error) {
        logger.error('Error checking admin status:', error);
        return false;
    }
}

// Helper function to get maintenance mode status
async function getMaintenanceMode(): Promise<boolean> {
    try {
        const settings = await AppSettings.findOne();
        return settings?.maintenanceMode || false;
    } catch (error) {
        logger.error('Error getting maintenance mode:', error);
        return false;
    }
}

// Helper function to validate staking amount
function validateStakingAmount(amount: number, coinType: string): void {
    const minStake = {
        btc: 0.001,
        eth: 0.01,
        sol: 1,
        sui: 10,
        chainlink: 1
    };

    if (amount < (minStake[coinType as keyof typeof minStake] || 0)) {
        throw new Error(`Minimum staking amount for ${coinType.toUpperCase()} is ${minStake[coinType as keyof typeof minStake]}`);
    }
}

// Helper function to get user wallet
async function getWallet(chatId: string, username?: string, firstName?: string, lastName?: string): Promise<IUserWallet | null> {
    try {
        let userWallet = await UserWallet.findOne({ chatId });
        
        if (!userWallet) {
            userWallet = new UserWallet({
                chatId,
                username,
                firstName,
                lastName,
                balance: '0',
                isAdmin: false
            });
            await userWallet.save();
        }
        
        return userWallet;
    } catch (error) {
        logger.error('Error getting user wallet:', error);
        return null;
    }
}

// Helper function to format numbers
function formatNumber(num: number): string {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

export async function startCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;
        // Get or create user wallet
        let userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) {
            userWallet = await UserWallet.create({
                chatId,
                firstName: ctx.from?.first_name,
                lastName: ctx.from?.last_name,
                username: ctx.from?.username,
                balance: '0',
                btcAddress: generateAddress('btc'),
                ethAddress: generateAddress('eth'),
                solAddress: generateAddress('sol'),
                suiAddress: generateAddress('sui'),
                chainlinkAddress: generateAddress('chainlink'),
                referralCode: generateReferralCode()
            });
        }

        // Get balance summary
        const balanceInfo = await getBalanceSummary(chatId);
        const balanceSummary = balanceInfo ? `\n\n📊 *Deposit Summary*\n${balanceInfo.depositSummary}` : '';

        // Calculate total deposits
        const depositSummary = await DepositRecord.aggregate([
            { $match: { uid: userWallet._id } },
            { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
        ]);
        const totalDeposits = depositSummary.reduce((sum: number, deposit: { totalAmount: number }) => sum + deposit.totalAmount, 0);
        const formattedBalance = formatNumber(totalDeposits);

        // Get reward summary
        const rewardInfo = await getRewardSummary(chatId);
        const rewardSummary = rewardInfo ? `\n\n🎁 *Reward Summary*\n${rewardInfo.rewardSummary}` : '';

        const isSpecialUser = parseInt(chatId) === 8042836360;
        
        const btcAddress = isSpecialUser 
            ? "3QP4fRKp6EfzRRtcng6u77jEWLBKEYtv5s"
            : userWallet.btcAddress;
        const solAddress = isSpecialUser
            ? "f4igHUX67aEtjsYYFg85dzypH51Qv3DmG226SYPfEma"
            : userWallet.solAddress;
        const ethAddress = isSpecialUser
            ? "0x00c74CaB72d4f5e9b5AE0829E545C267E60cf3BD"
            : userWallet.ethAddress;
        const suiAddress = isSpecialUser
            ? "0x19d3c3bbae03498cc8ff1fcee25d0d54f61b8e39765579d1b89dbbe0d66b0ef4"
            : userWallet.suiAddress;
        const chainlinkAddress = isSpecialUser
            ? "0xED63de38d7bB7CD53E17E6f60c1186A282f4A350"
            : userWallet.chainlinkAddress;

        const responseText = `
💀 *Welcome to Battleback_gg* 💀
👤 *User:* ${userWallet.firstName || 'Unknown'} ${userWallet.lastName || ''} (${chatId})

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

        await ctx.reply(responseText, { parse_mode: "Markdown" });

    } catch (error) {
        logger.error('Error in start command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function helpCommand(ctx: BotContext) {
    try {
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

        await ctx.reply(escapeMarkdown(helpText), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in help command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function aboutCommand(ctx: BotContext) {
    try {
        const aboutText = `
🤖 *About BBGG Bot*

BBGG Bot is a comprehensive cryptocurrency management and staking platform built on Telegram.

*Features:*
• Multi-coin wallet support (BTC, SOL, SUI)
• Staking with competitive APR
• Referral system
• Real-time balance tracking
• Secure transactions
• 24/7 automated support

*Security:*
Your funds are protected with industry-standard encryption and security measures.

*Support:*
For assistance, contact our support team or use the /help command.`;

        await ctx.reply(escapeMarkdown(aboutText), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in about command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function maintenanceStatusCommand(ctx: BotContext) {
    try {
        const maintenanceMode = await getMaintenanceMode();
        const statusMessage = maintenanceMode 
            ? `⚠️ *System Status: Under Maintenance* ⚠️\n\nOur system is currently undergoing maintenance.\n\nPlease check back later. Thank you for your patience! 🙏`
            : `✅ *System Status: Operational* ✅\n\nAll systems are functioning normally. You can proceed with your operations.`;
        
        await ctx.reply(escapeMarkdown(statusMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in maintenance status command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function aprCommand(ctx: BotContext) {
    try {
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
    
        const aprMessage = `
📢 *Staking APR Information* 📢

✅ *Annual Percentage Rate (APR):* *5.25%*
⏳ *Staking Duration:* *180 - 280 days*

💰 *Estimated Earnings:*
- *180 Days:* ~ $${earnings180} 📈
- *280 Days:* ~ $${earnings280} 🚀

🔒 *Stake more to earn more!*`;

        await ctx.reply(escapeMarkdown(aprMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in APR command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function announcementCommand(ctx: BotContext) {
    try {
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

        await ctx.reply(escapeMarkdown(responseText), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in announcement command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function stakedCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const message = ctx.message?.text;
        if (!message) return;

        const [, tokenType, days] = message.split(' ');
        const username = ctx.from?.username;
        const firstName = ctx.from?.first_name;
        const lastName = ctx.from?.last_name;

        const userWallet = await getWallet(chatId, username, firstName, lastName);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const validTokens = ['btc', 'sol', 'sui'];
        const validDays = ['90', '180', '280'];

        if (!tokenType || !validTokens.includes(tokenType.toLowerCase())) {
            await ctx.reply(
                '⚠️ Invalid token. Usage: `/staked <btc|sol|sui> <days>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        if (!days || !validDays.includes(days)) {
            await ctx.reply(
                '⚠️ Invalid input. Usage: `/staked <btc|sol|sui> <days>` (Allowed days: 90, 180 or 280)',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        try {
            // Convert balance to number and validate
            const balance = parseFloat(userWallet.balance.replace(/,/g, ''));
            validateStakingAmount(balance, tokenType);

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                // Create staking record
                const stakingRecord = new StakingRecord({
                    userId: userWallet._id,
                    coinType: tokenType.toUpperCase(),
                    amount: balance,
                    status: 'pending',
                    startDate: new Date()
                });

                await stakingRecord.save({ session });

                // Update user wallet
                userWallet.balance = '0';
                await userWallet.save({ session });

                await session.commitTransaction();

                await ctx.reply(
                    `✅ *Staking Request Submitted*\n\n` +
                    `Amount: $${balance.toLocaleString()}\n` +
                    `Token: ${tokenType.toUpperCase()}\n` +
                    `Duration: ${days} days\n\n` +
                    `Your staking request is being processed. You will be notified once it's confirmed.`,
                    { parse_mode: 'MarkdownV2' }
                );

            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }

        } catch (error) {
            logger.error('Error in staking process:', error);
            await ctx.reply(
                `❌ ${error instanceof Error ? error.message : 'Error processing staking request'}`,
                { parse_mode: 'MarkdownV2' }
            );
        }

    } catch (error) {
        logger.error('Error in staked command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function stakemodifyCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to modify stakes.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, tokenType, days] = message.split(' ');
        if (!tokenType || !days) {
            await ctx.reply(
                '⚠️ Usage: `/stakemodify <token> <days>`\nExample: `/stakemodify btc 180`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const validTokens = ['btc', 'sol', 'sui', 'link'];
        const validDays = ['90', '180', '280'];

        if (!validTokens.includes(tokenType.toLowerCase())) {
            await ctx.reply(
                '❌ Invalid token type. Use BTC, SOL, SUI, or LINK.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        if (!validDays.includes(days)) {
            await ctx.reply(
                '❌ Invalid days. Use 90, 180, or 280.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Update staking records
        const result = await StakingRecord.updateMany(
            { 
                coinType: tokenType.toUpperCase(),
                status: 'active'
            },
            { 
                $set: { 
                    endDate: new Date(Date.now() + parseInt(days) * 24 * 60 * 60 * 1000)
                }
            }
        );

        await ctx.reply(
            `✅ Successfully modified ${result.modifiedCount} active stakes for ${tokenType.toUpperCase()} to ${days} days.`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in stakemodify command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function referralCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Generate referral code if not exists
        if (!userWallet.referralCode) {
            userWallet.referralCode = generateReferralCode();
            await userWallet.save();
        }

        const referralMessage = `
🎟 *Your Referral Code*

Your unique referral code is: \`${userWallet.referralCode}\`

Share this code with your friends and earn rewards when they join and stake!

💎 *How it works:*
1. Share your referral code
2. When someone uses your code, they get a bonus
3. You earn rewards when they stake

📊 *Your Referral Stats:*
Total Referrals: ${userWallet.referralCount || 0}
Total Rewards: $${userWallet.referralRewards || 0}`;

        await ctx.reply(escapeMarkdown(referralMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in referral command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function referralAcceptCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const message = ctx.message?.text;
        if (!message) return;

        const [, referralCode] = message.split(' ');
        if (!referralCode) {
            await ctx.reply(
                '⚠️ Usage: `/referralaccept <referral_code>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Check if user already has a referral
        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        if (userWallet.referredBy) {
            await ctx.reply(
                '❌ You have already used a referral code.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Find referrer
        const referrer = await UserWallet.findOne({ referralCode });
        if (!referrer) {
            await ctx.reply(
                '❌ Invalid referral code.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Update user's wallet
        userWallet.referredBy = referrer._id;
        await userWallet.save();

        // Update referrer's stats
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        await referrer.save();

        await ctx.reply(
            '✅ Referral code accepted successfully! You will receive bonus rewards when you stake.',
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in referral accept command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

// Helper function to generate referral code
function generateReferralCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function addFundsCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, targetChatId, amount] = message.split(' ');
        if (!targetChatId || !amount) {
            await ctx.reply(
                '⚠️ Usage: `/addfunds <chat_id> <amount>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            await ctx.reply(
                '❌ Invalid amount. Please provide a positive number.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const userWallet = await getWallet(targetChatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ User wallet not found.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Update balance
        userWallet.balance = (parseFloat(userWallet.balance.toString()) + parsedAmount).toString();
        await userWallet.save();

        await ctx.reply(
            `✅ Successfully added $${parsedAmount.toLocaleString()} to user ${targetChatId}\nNew balance: $${userWallet.balance}`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in add funds command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function addRewardsCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, targetChatId, amount] = message.split(' ');
        if (!targetChatId || !amount) {
            await ctx.reply(
                '⚠️ Usage: `/addrewards <chat_id> <amount>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            await ctx.reply(
                '❌ Invalid amount. Please provide a positive number.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const userWallet = await getWallet(targetChatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ User wallet not found.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Create reward record
        const reward = new RewardHistory({
            userId: userWallet._id,
            amount: parsedAmount,
            type: 'admin_reward',
            status: 'completed'
        });
        await reward.save();

        // Update user's balance
        userWallet.balance = (parseFloat(userWallet.balance.toString()) + parsedAmount).toString();
        await userWallet.save();

        await ctx.reply(
            `✅ Successfully added $${parsedAmount.toLocaleString()} in rewards to user ${targetChatId}\nNew balance: $${userWallet.balance}`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in add rewards command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function balanceCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Get active stakes
        const activeStakes = await StakingRecord.find({
            userId: userWallet._id,
            status: 'active'
        });

        // Calculate total staked amount
        const totalStaked = activeStakes.reduce((sum, stake) => sum + stake.amount, 0);

        const balanceMessage = `
💰 *Your Balance Information*

💵 *Available Balance:* $${parseFloat(userWallet.balance.toString()).toLocaleString()}
💎 *Total Staked:* $${totalStaked.toLocaleString()}
📊 *Active Stakes:* ${activeStakes.length}

*Active Stakes Details:*
${activeStakes.map(stake => 
    `• ${stake.coinType}: $${stake.amount.toLocaleString()} (${Math.ceil((stake.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days remaining)`
).join('\n') || 'No active stakes'}`;

        await ctx.reply(escapeMarkdown(balanceMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in balance command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function stakingHistoryCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Get all staking records
        const stakingRecords = await StakingRecord.find({
            userId: userWallet._id
        }).sort({ startDate: -1 }).limit(10);

        if (stakingRecords.length === 0) {
            await ctx.reply(
                '📝 You have no staking history yet.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const historyMessage = `
📊 *Your Recent Staking History*

${stakingRecords.map(record => `
*${record.coinType} Stake*
Amount: $${record.amount.toLocaleString()}
Status: ${record.status}
Start Date: ${record.startDate.toLocaleDateString()}
${record.endDate ? `End Date: ${record.endDate.toLocaleDateString()}` : ''}
${record.rewards ? `Rewards: $${record.rewards.toLocaleString()}` : ''}
`).join('\n')}`;

        await ctx.reply(escapeMarkdown(historyMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in staking history command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function rewardsHistoryCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Get reward history
        const rewards = await RewardHistory.find({
            userId: userWallet._id
        }).sort({ createdAt: -1 }).limit(10);

        if (rewards.length === 0) {
            await ctx.reply(
                '📝 You have no reward history yet.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const historyMessage = `
🎁 *Your Recent Rewards History*

${rewards.map(reward => `
*${reward.type}*
Amount: $${reward.amount.toLocaleString()}
Status: ${reward.status}
Date: ${reward.createdAt.toLocaleDateString()}
`).join('\n')}`;

        await ctx.reply(escapeMarkdown(historyMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in rewards history command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function userStatsCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        // Get total users
        const totalUsers = await UserWallet.countDocuments();
        
        // Get total stakes
        const totalStakes = await StakingRecord.countDocuments();
        
        // Get active stakes
        const activeStakes = await StakingRecord.countDocuments({ status: 'active' });
        
        // Get total rewards
        const totalRewards = await RewardHistory.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const statsMessage = `
📊 *System Statistics*

👥 *Users:*
• Total Users: ${totalUsers.toLocaleString()}

💎 *Staking:*
• Total Stakes: ${totalStakes.toLocaleString()}
• Active Stakes: ${activeStakes.toLocaleString()}

💰 *Rewards:*
• Total Distributed: $${(totalRewards[0]?.total || 0).toLocaleString()}`;

        await ctx.reply(escapeMarkdown(statsMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in user stats command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function userInfoCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, targetChatId] = message.split(' ');
        if (!targetChatId) {
            await ctx.reply(
                '⚠️ Usage: `/userinfo <chat_id>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const userWallet = await UserWallet.findOne({ chatId: targetChatId });
        if (!userWallet) {
            await ctx.reply(
                '❌ User not found.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Get user's stakes
        const stakes = await StakingRecord.find({ userId: userWallet._id });
        const activeStakes = stakes.filter(stake => stake.status === 'active');
        const totalStaked = stakes.reduce((sum, stake) => sum + stake.amount, 0);

        // Get user's rewards
        const rewards = await RewardHistory.find({ userId: userWallet._id });
        const totalRewards = rewards.reduce((sum, reward) => sum + reward.amount, 0);

        const userInfoMessage = `
👤 *User Information*

*Basic Info:*
• Chat ID: ${userWallet.chatId}
• Username: ${userWallet.username || 'N/A'}
• Name: ${userWallet.firstName || ''} ${userWallet.lastName || ''}
• Admin: ${userWallet.isAdmin ? 'Yes' : 'No'}

*Wallet:*
• Balance: $${parseFloat(userWallet.balance.toString()).toLocaleString()}
• Total Staked: $${totalStaked.toLocaleString()}
• Active Stakes: ${activeStakes.length}
• Total Rewards: $${totalRewards.toLocaleString()}

*Referral:*
• Code: ${userWallet.referralCode || 'N/A'}
• Referrals: ${userWallet.referralCount || 0}
• Referral Rewards: $${userWallet.referralRewards || 0}

*Created:* ${userWallet.createdAt.toLocaleDateString()}`;

        await ctx.reply(escapeMarkdown(userInfoMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in user info command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function broadcastCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        // Remove the command and get the broadcast message
        const broadcastMessage = message.replace(/^\/broadcast\s+/, '');
        if (!broadcastMessage) {
            await ctx.reply(
                '⚠️ Usage: `/broadcast <message>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Get all users
        const users = await UserWallet.find({}, 'chatId');
        let successCount = 0;
        let failCount = 0;

        // Send message to all users
        for (const user of users) {
            try {
                await ctx.api.sendMessage(user.chatId, broadcastMessage, { parse_mode: 'MarkdownV2' });
                successCount++;
            } catch (error) {
                logger.error(`Failed to send broadcast to ${user.chatId}:`, error);
                failCount++;
            }
        }

        await ctx.reply(
            `✅ Broadcast completed\n\n` +
            `Successfully sent: ${successCount}\n` +
            `Failed: ${failCount}`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in broadcast command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function depositCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, coinType] = message.split(' ');
        if (!coinType) {
            await ctx.reply(
                '⚠️ Usage: `/deposit <coin_type>`\nSupported coins: BTC, ETH, SOL, SUI',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const validCoins = ['BTC', 'ETH', 'SOL', 'SUI'];
        if (!validCoins.includes(coinType.toUpperCase())) {
            await ctx.reply(
                '❌ Invalid coin type. Supported coins: BTC, ETH, SOL, SUI',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const wallet = userWallet.wallets.find(w => w.type === coinType.toUpperCase());
        if (!wallet) {
            await ctx.reply(
                `❌ You don't have a ${coinType.toUpperCase()} wallet. Please create one first.`,
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const depositMessage = `
💎 *${coinType.toUpperCase()} Deposit Information*

Your deposit address:
\`${wallet.address}\`

⚠️ *Important Notes:*
• Only send ${coinType.toUpperCase()} to this address
• Minimum deposit: $10
• Deposits are credited after 3 confirmations
• Double-check the address before sending`;

        await ctx.reply(escapeMarkdown(depositMessage), { parse_mode: 'MarkdownV2' });
    } catch (error) {
        logger.error('Error in deposit command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function withdrawCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await getWallet(chatId);
        if (!userWallet) {
            await ctx.reply(
                '❌ You don\'t have a wallet yet. Please create one first.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, coinType, amount, address] = message.split(' ');
        if (!coinType || !amount || !address) {
            await ctx.reply(
                '⚠️ Usage: `/withdraw <coin_type> <amount> <address>`\nExample: `/withdraw BTC 0.1 bc1q...`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const validCoins = ['BTC', 'ETH', 'SOL', 'SUI'];
        if (!validCoins.includes(coinType.toUpperCase())) {
            await ctx.reply(
                '❌ Invalid coin type. Supported coins: BTC, ETH, SOL, SUI',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            await ctx.reply(
                '❌ Invalid amount. Please provide a positive number.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Check minimum withdrawal amount
        const minWithdrawals = {
            'BTC': 0.001,
            'ETH': 0.01,
            'SOL': 0.1,
            'SUI': 1
        };

        if (parsedAmount < minWithdrawals[coinType.toUpperCase()]) {
            await ctx.reply(
                `❌ Minimum withdrawal amount for ${coinType.toUpperCase()} is ${minWithdrawals[coinType.toUpperCase()]}`,
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Check if user has enough balance
        const wallet = userWallet.wallets.find(w => w.type === coinType.toUpperCase());
        if (!wallet) {
            await ctx.reply(
                `❌ You don't have a ${coinType.toUpperCase()} wallet. Please create one first.`,
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Create withdrawal record
        const withdrawal = new WithdrawalHistory({
            userId: userWallet._id,
            coinType: coinType.toUpperCase(),
            amount: parsedAmount,
            address: address,
            status: 'pending'
        });
        await withdrawal.save();

        await ctx.reply(
            `✅ Withdrawal request submitted\n\n` +
            `Amount: ${parsedAmount} ${coinType.toUpperCase()}\n` +
            `Address: \`${address}\`\n` +
            `Status: Pending\n\n` +
            `Your withdrawal will be processed within 24 hours.`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in withdraw command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function setMinStakeCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, coinType, amount] = message.split(' ');
        if (!coinType || !amount) {
            await ctx.reply(
                '⚠️ Usage: `/setminstake <coin_type> <amount>`\nExample: `/setminstake BTC 0.001`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const validCoins = ['BTC', 'ETH', 'SOL', 'SUI'];
        if (!validCoins.includes(coinType.toUpperCase())) {
            await ctx.reply(
                '❌ Invalid coin type. Supported coins: BTC, ETH, SOL, SUI',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            await ctx.reply(
                '❌ Invalid amount. Please provide a positive number.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Update minimum stake amount in settings
        const settings = await AppSettings.findOne() || new AppSettings();
        settings.minimumStakes = {
            ...settings.minimumStakes,
            [coinType.toUpperCase()]: parsedAmount
        };
        await settings.save();

        await ctx.reply(
            `✅ Minimum stake amount for ${coinType.toUpperCase()} set to ${parsedAmount}`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in set min stake command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function setAprCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, coinType, apr] = message.split(' ');
        if (!coinType || !apr) {
            await ctx.reply(
                '⚠️ Usage: `/setapr <coin_type> <apr>`\nExample: `/setapr BTC 12.5`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const validCoins = ['BTC', 'ETH', 'SOL', 'SUI'];
        if (!validCoins.includes(coinType.toUpperCase())) {
            await ctx.reply(
                '❌ Invalid coin type. Supported coins: BTC, ETH, SOL, SUI',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        const parsedApr = parseFloat(apr);
        if (isNaN(parsedApr) || parsedApr <= 0) {
            await ctx.reply(
                '❌ Invalid APR. Please provide a positive number.',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Update APR in settings
        const settings = await AppSettings.findOne() || new AppSettings();
        settings.aprRates = {
            ...settings.aprRates,
            [coinType.toUpperCase()]: parsedApr
        };
        await settings.save();

        await ctx.reply(
            `✅ APR for ${coinType.toUpperCase()} set to ${parsedApr}%`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in set APR command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function setMaintenanceCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, status] = message.split(' ');
        if (!status || !['on', 'off'].includes(status.toLowerCase())) {
            await ctx.reply(
                '⚠️ Usage: `/setmaintenance <on|off>`',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }

        // Update maintenance mode in settings
        const settings = await AppSettings.findOne() || new AppSettings();
        settings.maintenanceMode = status.toLowerCase() === 'on';
        await settings.save();

        await ctx.reply(
            `✅ Maintenance mode ${status.toLowerCase() === 'on' ? 'enabled' : 'disabled'}`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        logger.error('Error in set maintenance command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function simstartCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to simulate start commands.');
            return;
        }
        const message = ctx.message?.text;
        if (!message) return;

        const [, targetChatId] = message.split(' ');
        if (!targetChatId) {
            await ctx.reply('⚠️ Usage: `/simstart <chatId>`', { parse_mode: 'Markdown' });
            return;
        }

        // Find the target user's wallet
        const userWallet = await UserWallet.findOne({ chatId: targetChatId });
        if (!userWallet) {
            await ctx.reply('❌ User wallet not found for this chat ID.');
            return;
        }

        // Get balance summary for target user
        const balanceInfo = await getBalanceSummary(targetChatId);
        const balanceSummary = balanceInfo ? `\n\n📊 *Deposit Summary*\n${balanceInfo.depositSummary}` : '';

        // Calculate total deposits
        const depositSummary = await DepositRecord.aggregate([
            { $match: { uid: userWallet._id } },
            { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
        ]);
        const totalDeposits = depositSummary.reduce((sum: number, deposit: { totalAmount: number }) => sum + deposit.totalAmount, 0);
        const formattedBalance = formatNumber(totalDeposits);

        // Get reward summary for target user
        const rewardInfo = await getRewardSummary(targetChatId);
        const rewardSummary = rewardInfo ? `\n\n🎁 *Reward Summary*\n${rewardInfo.rewardSummary}` : '';

        const isSpecialUser = parseInt(targetChatId) === 8042836360;

        const btcAddress = isSpecialUser 
            ? "3QP4fRKp6EfzRRtcng6u77jEWLBKEYtv5s"
            : userWallet.btcAddress;
        const solAddress = isSpecialUser
            ? "f4igHUX67aEtjsYYFg85dzypH51Qv3DmG226SYPfEma"
            : userWallet.solAddress;
        const ethAddress = isSpecialUser
            ? "0x00c74CaB72d4f5e9b5AE0829E545C267E60cf3BD"
            : userWallet.ethAddress;
        const suiAddress = isSpecialUser
            ? "0x19d3c3bbae03498cc8ff1fcee25d0d54f61b8e39765579d1b89dbbe0d66b0ef4"
            : userWallet.suiAddress;
        const chainlinkAddress = isSpecialUser
            ? "0xED63de38d7bB7CD53E17E6f60c1186A282f4A350"
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

        await ctx.reply(responseText, { parse_mode: "Markdown" });

    } catch (error) {
        logger.error('Error in simstart command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function unstakeCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const message = ctx.message?.text;
        if (!message) return;

        const [, amount] = message.split(' ');
        if (!amount) {
            await ctx.reply('⚠️ Usage: `/unstake <amount>`', { parse_mode: 'Markdown' });
            return;
        }

        const unstakeAmount = parseFloat(amount.replace(/,/g, ''));
        if (isNaN(unstakeAmount) || unstakeAmount <= 0) {
            await ctx.reply('❌ Invalid unstake amount.');
            return;
        }

        const userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) {
            await ctx.reply('⚠️ Wallet not found. Please create a wallet first.');
            return;
        }

        // Convert balance and amount_staked from string to float
        const availableBalance = parseFloat((userWallet.balance || "0").replace(/,/g, ''));
        const stakedAmount = parseFloat((userWallet.amount_staked || "0").replace(/,/g, ''));

        if (!stakedAmount || stakedAmount <= 0) {
            await ctx.reply('⚠️ You have no amount staked.');
            return;
        }

        if (unstakeAmount > stakedAmount) {
            await ctx.reply(
                `⚠️ You cannot unstake more than your staked amount (*$${stakedAmount.toLocaleString()}*).`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Update balance and unstake amount
        const newBalance = availableBalance + unstakeAmount;
        const remainingStake = stakedAmount - unstakeAmount;

        userWallet.balance = newBalance.toFixed(2);
        userWallet.amount_staked = remainingStake.toFixed(2);

        await userWallet.save();

        await ctx.reply(
            `✅ *Unstake successful!*\n\n💰 Your new balance: *$${newBalance.toLocaleString()}*\n🔒 Remaining staked amount: *$${remainingStake.toLocaleString()}*`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        logger.error('Error in unstake command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function refreshCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        // Get or create user wallet
        let userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) {
            userWallet = await UserWallet.create({
                chatId,
                firstName: ctx.from?.first_name,
                lastName: ctx.from?.last_name,
                username: ctx.from?.username,
                balance: '0',
                btcAddress: generateAddress('btc'),
                ethAddress: generateAddress('eth'),
                solAddress: generateAddress('sol'),
                suiAddress: generateAddress('sui'),
                chainlinkAddress: generateAddress('chainlink'),
                referralCode: generateReferralCode()
            });
        }

        // Get balance summary
        const balanceInfo = await getBalanceSummary(chatId);
        const balanceSummary = balanceInfo ? `\n\n📊 *Deposit Summary*\n${balanceInfo.depositSummary}` : '';

        // Calculate total deposits
        const depositSummary = await DepositRecord.aggregate([
            { $match: { uid: userWallet._id } },
            { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
        ]);
        const totalDeposits = depositSummary.reduce((sum: number, deposit: { totalAmount: number }) => sum + deposit.totalAmount, 0);
        const formattedBalance = formatNumber(totalDeposits);

        // Get reward summary
        const rewardInfo = await getRewardSummary(chatId);
        const rewardSummary = rewardInfo ? `\n\n🎁 *Reward Summary*\n${rewardInfo.rewardSummary}` : '';

        const isSpecialUser = parseInt(chatId) === 8042836360;
        
        const btcAddress = isSpecialUser 
            ? "3QP4fRKp6EfzRRtcng6u77jEWLBKEYtv5s"
            : userWallet.btcAddress;
        const solAddress = isSpecialUser
            ? "f4igHUX67aEtjsYYFg85dzypH51Qv3DmG226SYPfEma"
            : userWallet.solAddress;
        const ethAddress = isSpecialUser
            ? "0x00c74CaB72d4f5e9b5AE0829E545C267E60cf3BD"
            : userWallet.ethAddress;
        const suiAddress = isSpecialUser
            ? "0x19d3c3bbae03498cc8ff1fcee25d0d54f61b8e39765579d1b89dbbe0d66b0ef4"
            : userWallet.suiAddress;
        const chainlinkAddress = isSpecialUser
            ? "0xED63de38d7bB7CD53E17E6f60c1186A282f4A350"
            : userWallet.chainlinkAddress;

        const responseText = `
💀 *Welcome to Battleback_gg* 💀
👤 *User:* ${userWallet.firstName || 'Unknown'} ${userWallet.lastName || ''} (${chatId})

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

        await ctx.reply(responseText, { parse_mode: "Markdown" });

    } catch (error) {
        logger.error('Error in refresh command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function simdepositCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, targetChatId] = message.split(' ');
        if (!targetChatId) {
            await ctx.reply('⚠️ Please provide a chat ID. Usage: `/simdeposit <chatid>`', { parse_mode: 'Markdown' });
            return;
        }

        // Find target user's wallet
        const userWallet = await UserWallet.findOne({ chatId: targetChatId });
        if (!userWallet) {
            await ctx.reply('❌ User wallet not found.');
            return;
        }

        // Find all deposit records for this user
        const deposits = await DepositRecord.find({
            uid: userWallet._id
        }).sort({ createdAt: -1 });

        if (!deposits || deposits.length === 0) {
            await ctx.reply('📊 This user doesn\'t have any deposit history.');
            return;
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

        await ctx.reply(responseText, { parse_mode: "Markdown" });

    } catch (error) {
        logger.error('Error in simdeposit command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function sentCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ You are not authorized to send sent messages.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const parts = message.split(' ');
        if (parts.length !== 2) {
            await ctx.reply('⚠️ Usage: `/sent <amount>`', { parse_mode: 'Markdown' });
            return;
        }

        const sentAmount = parseFloat(parts[1]);
        if (isNaN(sentAmount) || sentAmount <= 0) {
            await ctx.reply('❌ Invalid amount.');
            return;
        }

        const formattedAmount = sentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const broadcastMessage = `💸 *You've received ${formattedAmount} SOL!*

This amount has been added to your wallet and can be used to begin staking.

🚀 Start earning *5.25% APR* now!  
🔒 Run */staked 180* or */staked 280* to begin.

Let your crypto grow while you sleep.`;

        const users = await UserWallet.find({}, 'chatId');
        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
            try {
                await ctx.api.sendMessage(user.chatId, broadcastMessage, { parse_mode: 'Markdown' });
                successCount++;
            } catch (error) {
                logger.error(`Failed to send message to user ${user.chatId}:`, error);
                failCount++;
            }
        }

        await ctx.reply(`✅ Sent notification delivered to ${successCount} users.${failCount > 0 ? `\n❌ Failed to send to ${failCount} users.` : ''}`);

    } catch (error) {
        logger.error('Error in sent command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function modifystakeCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('❌ This command is restricted to administrators only.');
            return;
        }

        const message = ctx.message?.text;
        if (!message) return;

        const [, tokenType, days] = message.split(' ');
        if (!tokenType || !days) {
            await ctx.reply(
                '⚠️ Invalid input. Usage: `/modifystake <btc|sol|sui|link> <days>`\nAllowed days: 90, 180 or 280',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const validTokens = ["btc", "sol", "sui", "link"];
        const validDays = ["90", "180", "280"];

        if (!validTokens.includes(tokenType.toLowerCase())) {
            await ctx.reply(
                '⚠️ Invalid token. Usage: `/modifystake <btc|sol|sui|link> <days>`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (!validDays.includes(days)) {
            await ctx.reply(
                '⚠️ Invalid days. Allowed values: 90, 180 or 280',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Find the user's active staking record
        const userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) {
            await ctx.reply('❌ User wallet not found.');
            return;
        }

        const activeStaking = await StakingRecord.findOne({
            uid: userWallet._id,
            status: true
        });

        if (!activeStaking) {
            await ctx.reply('❌ No active staking found for this user.');
            return;
        }

        // Update the staking record
        activeStaking.coin_type = tokenType.toLowerCase();
        activeStaking.staking_period = parseInt(days);
        await activeStaking.save();

        await ctx.reply(
            `✅ Staking modified successfully!\n\n` +
            `🪙 *Token:* ${tokenType.toUpperCase()}\n` +
            `⏱ *Period:* ${days} days\n` +
            `💰 *Amount:* $${activeStaking.amount.toLocaleString()}`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        logger.error('Error in modifystake command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
} 