import { Context, SessionFlavor } from 'grammy';

// Define the session data structure
export interface SessionData {
    // Add any session data you want to store here
    // For example:
    // lastCommand?: string;
    // userPreferences?: Record<string, any>;
}

// Create a type for the context with session
export type BotContext = Context & SessionFlavor<SessionData>; 