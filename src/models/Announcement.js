const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title:      { type: String, required: true, trim: true },
    body:       { type: String, required: true, trim: true },
    targetRole: { type: String, enum: ['all', 'artisan', 'customer'], default: 'all' },
    sentBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recipientCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

announcementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
