import { UserWallet } from '../models/UserWallet';
import { DepositRecord } from '../models/DepositRecord';
import { RewardHistory } from '../models/RewardHistory';

interface BalanceSummary {
    depositSummary: string;
    totalDeposits: number;
}

interface RewardSummary {
    rewardSummary: string;
    totalRewards: number;
}

export async function getBalanceSummary(chatId: string): Promise<BalanceSummary | null> {
    try {
        const userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) return null;

        const depositSummary = await DepositRecord.aggregate([
            { $match: { uid: userWallet._id } },
            { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
        ]);

        const summary = depositSummary.map(deposit => 
            `${deposit._id.toUpperCase()}: $${deposit.totalAmount.toLocaleString()}`
        ).join('\n');

        const totalDeposits = depositSummary.reduce((sum, deposit) => sum + deposit.totalAmount, 0);

        return {
            depositSummary: summary,
            totalDeposits
        };
    } catch (error) {
        console.error('Error getting balance summary:', error);
        return null;
    }
}

export async function getRewardSummary(chatId: string): Promise<RewardSummary | null> {
    try {
        const userWallet = await UserWallet.findOne({ chatId });
        if (!userWallet) return null;

        const rewardSummary = await RewardHistory.aggregate([
            { $match: { uid: userWallet._id } },
            { $group: { _id: "$coin_type", totalAmount: { $sum: "$amount" } } }
        ]);

        const summary = rewardSummary.map(reward => 
            `${reward._id.toUpperCase()}: $${reward.totalAmount.toLocaleString()}`
        ).join('\n');

        const totalRewards = rewardSummary.reduce((sum, reward) => sum + reward.totalAmount, 0);

        return {
            rewardSummary: summary,
            totalRewards
        };
    } catch (error) {
        console.error('Error getting reward summary:', error);
        return null;
    }
} 