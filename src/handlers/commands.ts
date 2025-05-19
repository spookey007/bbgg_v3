import { InlineKeyboard } from 'grammy';
import logger from '../utils/logger';
import { BotContext } from '../types/session';

export async function startCommand(ctx: BotContext) {
    try {
        const keyboard = new InlineKeyboard()
            .text('Help', 'help')
            .text('About', 'about');

        await ctx.reply(
            'Welcome to BBGG Bot v3! How can I help you today?',
            { reply_markup: keyboard }
        );
        logger.info(`User ${ctx.from?.username || ctx.from?.id} started the bot`);
    } catch (error) {
        logger.error('Error in start command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function helpCommand(ctx: BotContext) {
    try {
        const helpText = `
Available commands:
/start - Start the bot
/help - Show this help message
/about - Show information about the bot

You can also use the inline keyboard buttons below.`;

        const keyboard = new InlineKeyboard()
            .text('Back to Start', 'start');

        await ctx.reply(helpText, { reply_markup: keyboard });
    } catch (error) {
        logger.error('Error in help command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function aboutCommand(ctx: BotContext) {
    try {
        const aboutText = `
🤖 BBGG Bot Information:
Version: 3.0.0
Framework: Grammy
Language: TypeScript

This bot is built with modern technologies and includes:
• Type safety
• Error handling
• Logging
• Automatic reconnection`;

        const keyboard = new InlineKeyboard()
            .text('Back to Start', 'start');

        await ctx.reply(aboutText, { reply_markup: keyboard });
    } catch (error) {
        logger.error('Error in about command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
} 