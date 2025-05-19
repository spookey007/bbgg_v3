import { InlineKeyboard } from 'grammy';
import { BotContext } from '../types/session';
import { UserWallet } from '../models/UserWallet';
import { generateEthereumWallet, generateSolanaWallet, generateBitcoinWallet, encryptData } from '../utils/walletUtils';
import { escapeMarkdown } from '../utils/helpers';
import logger from '../utils/logger';

export async function handleWalletCommand(ctx: BotContext) {
    try {
        const keyboard = new InlineKeyboard()
            .text('Generate ETH Wallet', 'generate_eth')
            .text('Generate SOL Wallet', 'generate_sol')
            .row()
            .text('Generate BTC Wallet', 'generate_btc')
            .row()
            .text('View My Wallets', 'view_wallets');

        await ctx.reply(
            '🔐 *Wallet Management*\n\n' +
            'Choose an option below:',
            { 
                parse_mode: 'MarkdownV2',
                reply_markup: keyboard
            }
        );
    } catch (error) {
        logger.error('Error in wallet command:', error);
        await ctx.reply('Sorry, something went wrong. Please try again later.');
    }
}

export async function handleGenerateWallet(ctx: BotContext) {
    try {
        const callbackData = ctx.callbackQuery?.data;
        if (!callbackData) return;

        const walletType = callbackData.split('_')[1].toUpperCase();
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        let wallet;
        switch (walletType) {
            case 'ETH':
                wallet = generateEthereumWallet();
                break;
            case 'SOL':
                wallet = generateSolanaWallet();
                break;
            case 'BTC':
                wallet = generateBitcoinWallet();
                break;
            default:
                throw new Error('Invalid wallet type');
        }

        // Save wallet to database
        const userWallet = await UserWallet.findOneAndUpdate(
            { chatId },
            {
                [`${walletType.toLowerCase()}Address`]: wallet.address,
                [`${walletType.toLowerCase()}PrivateKey`]: encryptData(wallet.privateKey)
            },
            { upsert: true, new: true }
        );

        // Send wallet details
        const message = `
🔐 *New ${walletType} Wallet Generated*

Address:
\`${wallet.address}\`

Private Key:
\`${wallet.privateKey}\`

⚠️ *IMPORTANT: Save your private key securely! It cannot be recovered if lost.*`;

        await ctx.editMessageText(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard()
                .text('Back to Wallet Menu', 'wallet_menu')
        });

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error generating wallet:', error);
        await ctx.reply('Sorry, something went wrong while generating your wallet. Please try again later.');
    }
}

export async function handleViewWallets(ctx: BotContext) {
    try {
        const chatId = ctx.from?.id.toString();
        if (!chatId) return;

        const userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) {
            await ctx.reply('You don\'t have any wallets yet. Generate one using the menu below.');
            return;
        }

        let message = '🔐 *Your Wallets*\n\n';
        
        if (userWallet.ethAddress) {
            message += `*Ethereum:*\nAddress: \`${userWallet.ethAddress}\`\n\n`;
        }
        
        if (userWallet.solAddress) {
            message += `*Solana:*\nAddress: \`${userWallet.solAddress}\`\n\n`;
        }
        
        if (userWallet.btcAddress) {
            message += `*Bitcoin:*\nAddress: \`${userWallet.btcAddress}\`\n\n`;
        }

        message += '⚠️ *Note: Private keys are stored securely and cannot be displayed here.*';

        await ctx.editMessageText(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: new InlineKeyboard()
                .text('Back to Wallet Menu', 'wallet_menu')
        });

        // Answer callback query
        await ctx.answerCallbackQuery();

    } catch (error) {
        logger.error('Error viewing wallets:', error);
        await ctx.reply('Sorry, something went wrong while retrieving your wallets. Please try again later.');
    }
} 