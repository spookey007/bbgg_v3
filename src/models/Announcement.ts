import mongoose, { Document, Schema } from 'mongoose';

export interface IAnnouncement extends Document {
    title: string;
    content: string;
    scheduledFor?: Date;
    status: 'draft' | 'scheduled' | 'sent' | 'cancelled';
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const AnnouncementSchema = new Schema<IAnnouncement>({
    title: { type: String, required: true },
    content: { type: String, required: true },
    scheduledFor: { type: Date },
    status: { 
        type: String, 
        enum: ['draft', 'scheduled', 'sent', 'cancelled'],
        default: 'draft'
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'UserWallet', required: true }
}, {
    timestamps: true
});

// Indexes
AnnouncementSchema.index({ status: 1 });
AnnouncementSchema.index({ scheduledFor: 1 });
AnnouncementSchema.index({ createdBy: 1 });

export const Announcement = mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema); 