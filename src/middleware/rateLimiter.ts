import { Middleware } from 'grammy';
import { BotContext } from '../types/session';
import logger from '../utils/logger';

const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60000; // 1 minute in milliseconds

export const rateLimiter: Middleware<BotContext> = async (ctx, next) => {
    const now = Date.now();
    const session = ctx.session;
    
    // Initialize rate limit data if not exists
    if (!session.lastRequest) {
        session.lastRequest = now;
        session.requestCount = 1;
        return next();
    }
    
    // Reset counter if window has passed
    if (now - session.lastRequest > RATE_WINDOW) {
        session.lastRequest = now;
        session.requestCount = 1;
        return next();
    }
    
    // Check if rate limit exceeded
    if (session.requestCount && session.requestCount >= RATE_LIMIT) {
        logger.warn(`Rate limit exceeded for user ${ctx.from?.id}`);
        await ctx.reply('⚠️ Too many requests. Please wait a minute before trying again.');
        return;
    }
    
    // Increment counter
    session.requestCount = (session.requestCount || 0) + 1;
    return next();
}; 