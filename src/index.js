require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Create bot instance with polling
const bot = new TelegramBot(process.env.TELEGRAM_TELEGRAM_BOT_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Error handling for bot
bot.on('polling_error', (error) => {
    logger.error('Polling error:', error);
});

bot.on('webhook_error', (error) => {
    logger.error('Webhook error:', error);
});

// Handle connection errors
bot.on('error', (error) => {
    logger.error('Bot error:', error);
});

// Basic command handlers
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    logger.info(`User ${msg.from.username || msg.from.id} started the bot`);
    bot.sendMessage(chatId, 'Welcome! I am your Telegram bot. How can I help you?');
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/help - Show this help message');
});

// Handle all messages
bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        logger.info(`Received message from ${msg.from.username || msg.from.id}: ${msg.text}`);
        // Echo the message back
        bot.sendMessage(msg.chat.id, `You said: ${msg.text}`);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Bot is shutting down...');
    bot.stopPolling();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled Rejection:', error);
});

logger.info('Bot started successfully'); 