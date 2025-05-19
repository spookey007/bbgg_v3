import mongoose, { Document, Schema } from 'mongoose';

export interface IUserWallet extends Document {
    chatId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    ethAddress?: string;
    ethPrivateKey?: string;
    solAddress?: string;
    solPrivateKey?: string;
    btcAddress?: string;
    btcPrivateKey?: string;
    balance: number;
    isAdmin: boolean;
    referralCode?: string;
    referralCount?: number;
    referralRewards?: number;
    referredBy?: mongoose.Types.ObjectId;
    suiAddress: string;
    chainlinkAddress: string;
    createdAt: Date;
    updatedAt: Date;
}

const UserWalletSchema = new Schema<IUserWallet>({
    chatId: { type: String, required: true, unique: true },
    username: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    ethAddress: { type: String },
    ethPrivateKey: { type: String },
    solAddress: { type: String },
    solPrivateKey: { type: String },
    btcAddress: { type: String },
    btcPrivateKey: { type: String },
    balance: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    referralCode: { type: String, unique: true, sparse: true },
    referralCount: { type: Number, default: 0 },
    referralRewards: { type: Number, default: 0 },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'UserWallet' },
    suiAddress: { type: String, required: true },
    chainlinkAddress: { type: String, required: true }
}, {
    timestamps: true
});

// Indexes
UserWalletSchema.index({ chatId: 1 });
UserWalletSchema.index({ ethAddress: 1 });
UserWalletSchema.index({ solAddress: 1 });
UserWalletSchema.index({ btcAddress: 1 });

export const UserWallet = mongoose.model<IUserWallet>('UserWallet', UserWalletSchema); 