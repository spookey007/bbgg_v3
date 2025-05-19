import mongoose, { Document, Schema } from 'mongoose';

export interface IAppSettings extends Document {
    maintenanceMode: boolean;
    lastUpdatedBy: mongoose.Types.ObjectId;
    lastUpdatedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>({
    maintenanceMode: { type: Boolean, default: false },
    lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'UserWallet', required: true },
    lastUpdatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Ensure only one settings document exists
AppSettingsSchema.pre('save', async function(next) {
    if (this.isNew) {
        const count = await mongoose.model('AppSettings').countDocuments();
        if (count > 0) {
            throw new Error('Only one settings document can exist');
        }
    }
    next();
});

export const AppSettings = mongoose.model<IAppSettings>('AppSettings', AppSettingsSchema); 