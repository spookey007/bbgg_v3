import mongoose, { Document, Schema } from 'mongoose';

export interface IStakingRecord extends Document {
    userId: mongoose.Types.ObjectId;
    coinType: 'BTC' | 'SOL' | 'SUI';
    amount: number;
    status: 'pending' | 'active' | 'completed' | 'cancelled';
    startDate: Date;
    endDate?: Date;
    rewardAmount?: number;
    createdAt: Date;
    updatedAt: Date;
}

const StakingRecordSchema = new Schema<IStakingRecord>({
    userId: { type: Schema.Types.ObjectId, ref: 'UserWallet', required: true },
    coinType: { type: String, enum: ['BTC', 'SOL', 'SUI'], required: true },
    amount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'active', 'completed', 'cancelled'],
        default: 'pending'
    },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    rewardAmount: { type: Number }
}, {
    timestamps: true
});

// Indexes
StakingRecordSchema.index({ userId: 1 });
StakingRecordSchema.index({ status: 1 });
StakingRecordSchema.index({ coinType: 1 });
StakingRecordSchema.index({ startDate: 1 });

export const StakingRecord = mongoose.model<IStakingRecord>('StakingRecord', StakingRecordSchema); 