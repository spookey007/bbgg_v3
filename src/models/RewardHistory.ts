import mongoose, { Document, Schema } from 'mongoose';

export interface IRewardHistory extends Document {
    userId: mongoose.Types.ObjectId;
    amount: number;
    type: 'staking' | 'referral' | 'promotion';
    status: 'pending' | 'completed' | 'failed';
    stakingRecordId?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const RewardHistorySchema = new Schema<IRewardHistory>({
    userId: { type: Schema.Types.ObjectId, ref: 'UserWallet', required: true },
    amount: { type: Number, required: true },
    type: { 
        type: String, 
        enum: ['staking', 'referral', 'promotion'],
        required: true
    },
    status: { 
        type: String, 
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    stakingRecordId: { type: Schema.Types.ObjectId, ref: 'StakingRecord' }
}, {
    timestamps: true
});

// Indexes
RewardHistorySchema.index({ userId: 1 });
RewardHistorySchema.index({ type: 1 });
RewardHistorySchema.index({ status: 1 });
RewardHistorySchema.index({ createdAt: 1 });

export const RewardHistory = mongoose.model<IRewardHistory>('RewardHistory', RewardHistorySchema); 