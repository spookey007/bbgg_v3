import { Context, SessionFlavor } from 'grammy';

// Define the session data structure
export interface SessionData {
    // User state
    state?: {
        action?: string;
        step?: number;
        data?: Record<string, any>;
    };
    
    // Rate limiting
    lastRequest?: number;
    requestCount?: number;
    
    // Wallet state
    walletType?: 'ETH' | 'SOL' | 'BTC';
    walletData?: {
        address?: string;
        privateKey?: string;
    };
    
    // Staking state
    stakingAmount?: number;
    stakingCoin?: string;
    
    // Admin state
    isAdmin?: boolean;
    maintenanceMode?: boolean;
}

// Create a type for the context with session
export type BotContext = Context & SessionFlavor<SessionData>; 