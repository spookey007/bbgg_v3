import mongoose from 'mongoose';
import logger from './logger';

export async function connectDatabase(): Promise<void> {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }

        await mongoose.connect(mongoUri);
        logger.info('Connected to MongoDB');

        // Handle connection events
        mongoose.connection.on('error', (error) => {
            logger.error('MongoDB connection error:', error);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected. Attempting to reconnect...');
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('MongoDB reconnected');
        });

    } catch (error) {
        logger.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}

export async function disconnectDatabase(): Promise<void> {
    try {
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB');
    } catch (error) {
        logger.error('Error disconnecting from MongoDB:', error);
    }
} 