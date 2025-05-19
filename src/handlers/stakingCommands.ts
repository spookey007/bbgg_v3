import { InlineKeyboard } from 'grammy';
import { BotContext } from '../types/session';
import { UserWallet } from '../models/UserWallet';
import { StakingRecord } from '../models/StakingRecord';
import { validateStakingAmount } from '../utils/helpers';
import logger from '../utils/logger';

export async function handleStakingCommand(ctx: BotContext) {
    try {
        const keyboard = new InlineKeyboard()
            .text('Stake BTC', 'stake_btc')
            .text('Stake SOL', 'stake_sol')
            .row()
            .text('Stake SUI', 'stake_sui')
            .row()
            .text('View Active Stakes', 'view_stakes');

        await ctx.reply(
            '💰 *Staking Management*\n\n' +
            'Choose a coin to stake:',
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: keyboard
            }
        );
    } catch (error) {
        logger.error('Error in staking command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleStakeCoin(ctx: BotContext) {
    try {
        const callbackData = ctx.callbackQuery?.data;
        if (!callbackData) return;

        const coinType = callbackData.split('_')[1].toUpperCase();
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        // Check if user has a wallet for this coin
        const userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) {
            await ctx.reply('Please generate a wallet first using the /wallet command.');
            return;
        }

        // Set state for amount input
        ctx.session.state = {
            action: 'staking',
            step: 1,
            data: { coinType }
        };

        const minAmount = {
            'BTC': 1100,
            'SOL': 2500,
            'SUI': 1750
        }[coinType];

        await ctx.editMessageText(
            `💰 *Stake ${coinType}*\n\n` +
            `Minimum staking amount: $${minAmount}\n\n` +
            `Please enter the amount you want to stake:`,
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: new InlineKeyboard()
                    .text('Cancel', 'cancel_stake')
            }
        );

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error in stake coin handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleStakeAmount(ctx: BotContext) {
    try {
        const message = ctx.message?.text;
        if (!message) return;

        const amount = parseFloat(message);
        if (isNaN(amount)) {
            await ctx.reply('Please enter a valid number.');
            return;
        }

        const state = ctx.session.state;
        if (!state || state.action !== 'staking' || !state.data?.coinType) {
            await ctx.reply('Invalid state. Please start over with /stake command.');
            return;
        }

        const coinType = state.data.coinType;
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        // Validate staking amount
        try {
            validateStakingAmount(amount, coinType);
        } catch (error) {
            await ctx.reply(error instanceof Error ? error.message : 'Invalid staking amount.');
            return;
        }

        // Create staking record
        const stakingRecord = new StakingRecord({
            userId: chatId,
            coinType,
            amount,
            status: 'pending'
        });

        await stakingRecord.save();

        // Clear session state
        ctx.session.state = undefined;

        await ctx.reply(
            `✅ *Staking Request Submitted*\n\n` +
            `Coin: ${coinType}\n` +
            `Amount: $${amount}\n\n` +
            `Your staking request has been submitted and is pending confirmation.`,
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: new InlineKeyboard()
                    .text('View Active Stakes', 'view_stakes')
            }
        );

    } catch (error) {
        logger.error('Error in stake amount handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleViewStakes(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const activeStakes = await StakingRecord.find({
            userId: chatId,
            status: { $in: ['pending', 'active'] }
        }).sort({ createdAt: -1 });

        if (activeStakes.length === 0) {
            await ctx.editMessageText(
                'You don\'t have any active stakes.',
                {
                    reply_markup: new InlineKeyboard()
                        .text('Back to Staking Menu', 'staking_menu')
                }
            );
            return;
        }

        let message = '💰 *Your Active Stakes*\n\n';
        
        for (const stake of activeStakes) {
            message += `*${stake.coinType} Stake*\n` +
                      `Amount: $${stake.amount}\n` +
                      `Status: ${stake.status}\n` +
                      `Started: ${stake.startDate.toLocaleDateString()}\n\n`;
        }

        await ctx.editMessageText(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard()
                .text('Back to Staking Menu', 'staking_menu')
        });

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error viewing stakes:', error);
        await ctx.reply('Sorry, something went wrong while retrieving your stakes. Please try again later.');
    }
} 