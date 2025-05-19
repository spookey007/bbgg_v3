import { InlineKeyboard } from 'grammy';
import { BotContext } from '../types/session';
import { UserWallet } from '../models/UserWallet';
import { AppSettings } from '../models/AppSettings';
import { Announcement } from '../models/Announcement';
import { StakingRecord } from '../models/StakingRecord';
import { RewardHistory } from '../models/RewardHistory';
import { escapeMarkdown } from '../utils/helpers';
import logger from '../utils/logger';

// Helper function to check if user is admin
async function isAdmin(chatId: string): Promise<boolean> {
    try {
        const user = await UserWallet.findOne({ chatId });
        return user?.isAdmin || false;
    } catch (error) {
        logger.error('Error checking admin status:', error);
        return false;
    }
}

export async function handleAdminCommand(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        if (!await isAdmin(chatId)) {
            await ctx.reply('⚠️ You do not have permission to use admin commands.');
            return;
        }

        const keyboard = new InlineKeyboard()
            .text('Maintenance Mode', 'admin_maintenance')
            .text('Create Announcement', 'admin_announcement')
            .row()
            .text('View Pending Stakes', 'admin_pending_stakes')
            .text('View Pending Rewards', 'admin_pending_rewards')
            .row()
            .text('User Statistics', 'admin_stats');

        await ctx.reply(
            '👑 *Admin Panel*\n\n' +
            'Choose an option below:',
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: keyboard
            }
        );
    } catch (error) {
        logger.error('Error in admin command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleMaintenanceMode(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId || !await isAdmin(chatId)) return;

        const settings = await AppSettings.findOne();
        const currentMode = settings?.maintenanceMode || false;

        await AppSettings.findOneAndUpdate(
            {},
            { 
                maintenanceMode: !currentMode,
                lastUpdatedBy: chatId,
                lastUpdatedAt: new Date()
            },
            { upsert: true }
        );

        await ctx.editMessageText(
            `🛠 *Maintenance Mode ${!currentMode ? 'Enabled' : 'Disabled'}*\n\n` +
            `The system is now ${!currentMode ? 'under maintenance' : 'operational'}.`,
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: new InlineKeyboard()
                    .text('Back to Admin Panel', 'admin_panel')
            }
        );

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error in maintenance mode handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleCreateAnnouncement(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId || !await isAdmin(chatId)) return;

        // Set state for announcement creation
        ctx.session.state = {
            action: 'announcement',
            step: 1
        };

        await ctx.editMessageText(
            '📢 *Create Announcement*\n\n' +
            'Please enter the announcement title:',
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: new InlineKeyboard()
                    .text('Cancel', 'cancel_announcement')
            }
        );

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error in create announcement handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleAnnouncementTitle(ctx: BotContext) {
    try {
        const message = ctx.message?.text;
        if (!message) return;

        const state = ctx.session.state;
        if (!state || state.action !== 'announcement' || state.step !== 1) {
            await ctx.reply('Invalid state. Please start over with /admin command.');
            return;
        }

        // Save title and move to content step
        ctx.session.state = {
            action: 'announcement',
            step: 2,
            data: { title: message }
        };

        await ctx.reply(
            'Now please enter the announcement content:',
            {
                reply_markup: new InlineKeyboard()
                    .text('Cancel', 'cancel_announcement')
            }
        );

    } catch (error) {
        logger.error('Error in announcement title handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleAnnouncementContent(ctx: BotContext) {
    try {
        const message = ctx.message?.text;
        if (!message) return;

        const state = ctx.session.state;
        if (!state || state.action !== 'announcement' || state.step !== 2 || !state.data?.title) {
            await ctx.reply('Invalid state. Please start over with /admin command.');
            return;
        }

        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        // Create announcement
        const announcement = new Announcement({
            title: state.data.title,
            content: message,
            createdBy: chatId,
            status: 'draft'
        });

        await announcement.save();

        // Clear session state
        ctx.session.state = undefined;

        await ctx.reply(
            '✅ *Announcement Created*\n\n' +
            'The announcement has been saved as a draft. You can schedule it from the admin panel.',
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: new InlineKeyboard()
                    .text('Back to Admin Panel', 'admin_panel')
            }
        );

    } catch (error) {
        logger.error('Error in announcement content handler:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handlePendingStakes(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId || !await isAdmin(chatId)) return;

        const pendingStakes = await StakingRecord.find({ status: 'pending' })
            .sort({ createdAt: -1 })
            .limit(10);

        if (pendingStakes.length === 0) {
            await ctx.editMessageText(
                'No pending stakes found.',
                {
                    reply_markup: new InlineKeyboard()
                        .text('Back to Admin Panel', 'admin_panel')
                }
            );
            return;
        }

        let message = '⏳ *Pending Stakes*\n\n';
        
        for (const stake of pendingStakes) {
            message += `*${stake.coinType} Stake*\n` +
                      `User ID: ${stake.userId}\n` +
                      `Amount: $${stake.amount}\n` +
                      `Created: ${stake.createdAt.toLocaleDateString()}\n\n`;
        }

        await ctx.editMessageText(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard()
                .text('Back to Admin Panel', 'admin_panel')
        });

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error viewing pending stakes:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handlePendingRewards(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId || !await isAdmin(chatId)) return;

        const pendingRewards = await RewardHistory.find({ status: 'pending' })
            .sort({ createdAt: -1 })
            .limit(10);

        if (pendingRewards.length === 0) {
            await ctx.editMessageText(
                'No pending rewards found.',
                {
                    reply_markup: new InlineKeyboard()
                        .text('Back to Admin Panel', 'admin_panel')
                }
            );
            return;
        }

        let message = '🎁 *Pending Rewards*\n\n';
        
        for (const reward of pendingRewards) {
            message += `*${reward.type} Reward*\n` +
                      `User ID: ${reward.userId}\n` +
                      `Amount: $${reward.amount}\n` +
                      `Created: ${reward.createdAt.toLocaleDateString()}\n\n`;
        }

        await ctx.editMessageText(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard()
                .text('Back to Admin Panel', 'admin_panel')
        });

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error viewing pending rewards:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleUserStats(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId || !await isAdmin(chatId)) return;

        const [
            totalUsers,
            totalStakes,
            totalRewards,
            activeStakes
        ] = await Promise.all([
            UserWallet.countDocuments(),
            StakingRecord.countDocuments(),
            RewardHistory.countDocuments(),
            StakingRecord.countDocuments({ status: 'active' })
        ]);

        const message = 
            '📊 *User Statistics*\n\n' +
            `Total Users: ${totalUsers}\n` +
            `Total Stakes: ${totalStakes}\n` +
            `Active Stakes: ${activeStakes}\n` +
            `Total Rewards: ${totalRewards}`;

        await ctx.editMessageText(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard()
                .text('Back to Admin Panel', 'admin_panel')
        });

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error viewing user stats:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
} 