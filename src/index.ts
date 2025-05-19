import { Bot, session } from 'grammy';
import { run } from '@grammyjs/runner';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { startCommand, helpCommand, aboutCommand } from './handlers/commands';

// Load environment variables
dotenv.config();

// Create bot instance
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || '');

// Error handling
bot.catch((err) => {
    logger.error('Bot error:', err);
});

// Session middleware
bot.use(session());

// Command handlers
bot.command('start', startCommand);
bot.command('help', helpCommand);
bot.command('about', aboutCommand);

// Handle callback queries
bot.callbackQuery('start', startCommand);
bot.callbackQuery('help', helpCommand);
bot.callbackQuery('about', aboutCommand);

// Handle messages
bot.on('message', async (ctx) => {
    try {
        if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
            logger.info(`Received message from ${ctx.from?.username || ctx.from?.id}: ${ctx.message.text}`);
            await ctx.reply(`You said: ${ctx.message.text}`);
        }
    } catch (error) {
        logger.error('Error handling message:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
});

// Start the bot
async function startBot() {
    try {
        // Use the runner to handle updates
        const runner = run(bot);
        
        // Handle graceful shutdown
        const stopRunner = () => {
            logger.info('Stopping bot...');
            runner.stop();
            process.exit(0);
        };

        process.once('SIGINT', stopRunner);
        process.once('SIGTERM', stopRunner);

        logger.info('Bot started successfully');
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Start the bot
startBot(); 