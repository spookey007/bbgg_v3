import { Bot, session } from 'grammy';
import { run } from '@grammyjs/runner';
import dotenv from 'dotenv';
import logger from './utils/logger';
import { 
    startCommand, 
    helpCommand, 
    aboutCommand,
    maintenanceStatusCommand,
    aprCommand,
    announcementCommand,
    referralCommand,
    referralAcceptCommand,
    addFundsCommand,
    addRewardsCommand,
    balanceCommand,
    stakingHistoryCommand,
    rewardsHistoryCommand,
    userStatsCommand,
    userInfoCommand,
    broadcastCommand,
    depositCommand,
    withdrawCommand,
    setMinStakeCommand,
    setAprCommand,
    setMaintenanceCommand,
    simstartCommand,
    unstakeCommand,
    refreshCommand,
    simdepositCommand,
    sentCommand,
    modifystakeCommand
} from './handlers/commands';
import { BotContext, SessionData } from './types/session';
import { connectDatabase, disconnectDatabase } from './utils/database';

// Load environment variables
dotenv.config();

// Create bot instance with proper typing
const bot = new Bot<BotContext>(process.env.TELEGRAM_BOT_TOKEN || '');

// Error handling
bot.catch((err) => {
    logger.error('Bot error:', err);
});

// Add session middleware
bot.use(session({
    initial: (): SessionData => ({
        state: undefined
    })
}));

// Register command handlers
bot.command('start', startCommand);
bot.command('help', helpCommand);
bot.command('about', aboutCommand);
bot.command('maintenance-status', maintenanceStatusCommand);
bot.command('apr', aprCommand);
bot.command('announcement', announcementCommand);
bot.command('referral', referralCommand);
bot.command('referralaccept', referralAcceptCommand);
bot.command('addfunds', addFundsCommand);
bot.command('addrewards', addRewardsCommand);
bot.command('balance', balanceCommand);
bot.command('staking-history', stakingHistoryCommand);
bot.command('rewards-history', rewardsHistoryCommand);
bot.command('userstats', userStatsCommand);
bot.command('userinfo', userInfoCommand);
bot.command('broadcast', broadcastCommand);
bot.command('deposit', depositCommand);
bot.command('withdraw', withdrawCommand);
bot.command('setminstake', setMinStakeCommand);
bot.command('setapr', setAprCommand);
bot.command('setmaintenance', setMaintenanceCommand);
bot.command('simstart', simstartCommand);
bot.command('unstake', unstakeCommand);
bot.command('refresh', refreshCommand);
bot.command('simdeposit', simdepositCommand);
bot.command('sent', sentCommand);
bot.command('modifystake', modifystakeCommand);

// Handle callback queries
bot.callbackQuery('start', startCommand);
bot.callbackQuery('help', helpCommand);
bot.callbackQuery('about', aboutCommand);

// Handle messages
bot.on('message', async (ctx) => {
    try {
        // console.log(ctx.message)
        if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
            console.log(ctx.message.text)
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
        // Connect to MongoDB
        await connectDatabase();
        logger.info('Connected to MongoDB');

        // Use the runner to handle updates
        const runner = run(bot);
        
        // Handle graceful shutdown
        const stopRunner = async () => {
            logger.info('Stopping bot...');
            await disconnectDatabase();
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