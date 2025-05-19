export function formatBalance(amount: number): string {
    return amount.toFixed(2);
}

export function formatNumber(number: number): string {
    return new Intl.NumberFormat('en-US').format(number);
}

export function sanitizeInput(input: string): string {
    return input.toString().trim();
}

export function validateRewardAmount(amount: number): boolean {
    const MAX_REWARD_AMOUNT = 1000000;
    if (amount <= 0) throw new Error('Reward amount must be positive');
    if (amount > MAX_REWARD_AMOUNT) throw new Error('Reward amount exceeds maximum limit');
    return true;
}

export function validateStakingAmount(amount: number, coinType: string): boolean {
    const MIN_BTC_STAKE = 1100;
    const MIN_SOL_STAKE = 2500;
    const MIN_SUI_STAKE = 1750;
    
    if (amount <= 0) throw new Error('Staking amount must be positive');
    
    const coin = coinType.toUpperCase();
    switch (coin) {
        case 'BTC':
            if (amount < MIN_BTC_STAKE) {
                throw new Error(`Minimum BTC staking amount is $${MIN_BTC_STAKE}`);
            }
            break;
        case 'SOL':
            if (amount < MIN_SOL_STAKE) {
                throw new Error(`Minimum SOL staking amount is $${MIN_SOL_STAKE}`);
            }
            break;
        case 'SUI':
            if (amount < MIN_SUI_STAKE) {
                throw new Error(`Minimum SUI staking amount is $${MIN_SUI_STAKE}`);
            }
            break;
        default:
            throw new Error('Invalid coin type');
    }
    
    return true;
}

export function escapeMarkdown(text: string): string {
    return text
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/~/g, '\\~')
        .replace(/`/g, '\\`')
        .replace(/>/g, '\\>')
        .replace(/#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/-/g, '\\-')
        .replace(/=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/{/g, '\\{')
        .replace(/}/g, '\\}')
        .replace(/\./g, '\\.')
        .replace(/!/g, '\\!');
} 