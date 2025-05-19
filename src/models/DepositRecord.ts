import mongoose from 'mongoose';

export interface IDepositRecord {
    uid: mongoose.Types.ObjectId;
    coin_type: string;
    amount: number;
    tx_hash: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

const depositRecordSchema = new mongoose.Schema<IDepositRecord>({
    uid: { type: mongoose.Schema.Types.ObjectId, ref: 'UserWallet', required: true },
    coin_type: { type: String, required: true },
    amount: { type: Number, required: true },
    tx_hash: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' }
}, { timestamps: true });

export const DepositRecord = mongoose.model<IDepositRecord>('DepositRecord', depositRecordSchema); 