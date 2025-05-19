import mongoose from 'mongoose';

export interface IWithdrawalHistory {
    uid: mongoose.Types.ObjectId;
    coin_type: string;
    amount: number;
    address: string;
    status: string;
    txHash?: string;
    createdAt: Date;
    updatedAt: Date;
}

const withdrawalHistorySchema = new mongoose.Schema<IWithdrawalHistory>({
    uid: { type: mongoose.Schema.Types.ObjectId, ref: 'UserWallet', required: true },
    coin_type: { type: String, required: true },
    amount: { type: Number, required: true },
    address: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' },
    txHash: { type: String }
}, { timestamps: true });

export const WithdrawalHistory = mongoose.model<IWithdrawalHistory>('WithdrawalHistory', withdrawalHistorySchema); 