import { InlineKeyboard } from 'grammy';
import { BotContext } from '../types/session';
import { 
    handleAdminCommand,
    handleMaintenanceMode,
    handleCreateAnnouncement,
    handlePendingStakes,
    handlePendingRewards,
    handleUserStats
} from './adminCommands';
import { 
    handleWalletCommand,
    handleViewWallets,
    handleGenerateWallet
} from './walletCommands';
import { 
    handleStakingCommand,
    handleViewStakes,
    handleStakeCoin
} from './stakingCommands';
import logger from '../utils/logger';

export async function handleCallbackQuery(ctx: BotContext) {
    try {
        const callbackData = ctx.callbackQuery?.data;
        if (!callbackData) return;

        // Admin panel callbacks
        if (callbackData.startsWith('admin_')) {
            switch (callbackData) {
                case 'admin_panel':
                    await handleAdminCommand(ctx);
                    break;
                case 'admin_maintenance':
                    await handleMaintenanceMode(ctx);
                    break;
                case 'admin_announcement':
                    await handleCreateAnnouncement(ctx);
                    break;
                case 'admin_pending_stakes':
                    await handlePendingStakes(ctx);
                    break;
                case 'admin_pending_rewards':
                    await handlePendingRewards(ctx);
                    break;
                case 'admin_stats':
                    await handleUserStats(ctx);
                    break;
                case 'cancel_announcement':
                    ctx.session.state = undefined;
                    await ctx.editMessageText(
                        '❌ Announcement creation cancelled.',
                        {
                            reply_markup: new InlineKeyboard()
                                .text('Back to Admin Panel', 'admin_panel')
                        }
                    );
                    break;
            }
        }
        // Wallet callbacks
        else if (callbackData.startsWith('wallet_')) {
            switch (callbackData) {
                case 'wallet_menu':
                    await handleWalletCommand(ctx);
                    break;
                case 'view_wallets':
                    await handleViewWallets(ctx);
                    break;
                default:
                    if (callbackData.startsWith('generate_')) {
                        await handleGenerateWallet(ctx);
                    }
            }
        }
        // Staking callbacks
        else if (callbackData.startsWith('stake_')) {
            switch (callbackData) {
                case 'staking_menu':
                    await handleStakingCommand(ctx);
                    break;
                case 'view_stakes':
                    await handleViewStakes(ctx);
                    break;
                case 'cancel_stake':
                    ctx.session.state = undefined;
                    await ctx.editMessageText(
                        '❌ Staking cancelled.',
                        {
                            reply_markup: new InlineKeyboard()
                                .text('Back to Staking Menu', 'staking_menu')
                        }
                    );
                    break;
                default:
                    if (callbackData.startsWith('stake_')) {
                        await handleStakeCoin(ctx);
                    }
            }
        }

        // Answer callback query to remove loading state
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error handling callback query:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
} 