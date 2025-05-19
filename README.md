# BBGG Bot v3

A robust Telegram bot built with Grammy and TypeScript that includes error handling, logging, and automatic reconnection capabilities.

## Features

- Built with Grammy (modern Telegram Bot framework)
- TypeScript for type safety
- Robust error handling
- Comprehensive logging
- Automatic reconnection
- Inline keyboard support
- Session management
- Graceful shutdown

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory and add your bot token:
```
BOT_TOKEN=your_bot_token_here
```

3. Build the project:
```bash
npm run build
```

4. Start the bot:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Project Structure

```
src/
├── handlers/     # Command and message handlers
├── utils/        # Utility functions and logger
└── index.ts      # Main bot file
```

## Logging

The bot uses Winston for logging. Logs are stored in:
- `logs/error.log` - Error level logs
- `logs/combined.log` - All logs
- Console output for real-time monitoring

## Error Handling

The bot includes comprehensive error handling for:
- Bot errors
- Command errors
- Message handling errors
- Uncaught exceptions
- Graceful shutdown

## Commands

- `/start` - Start the bot
- `/help` - Show help message
- `/about` - Show information about the bot

## Development

- `npm run dev` - Start development mode with auto-reload
- `npm run build` - Build TypeScript files
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier # bbgg_v3
