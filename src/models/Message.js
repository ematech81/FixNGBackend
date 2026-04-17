const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // 'text' | 'image' | 'audio'
    type: {
      type: String,
      enum: ['text', 'image', 'audio'],
      default: 'text',
    },
    // For text messages
    text: {
      type: String,
      default: null,
      maxlength: [1000, 'Message too long.'],
    },
    // For image messages — cloudinary url
    imageUrl: {
      type: String,
      default: null,
    },
    imagePublicId: {
      type: String,
      default: null,
    },
    // For audio (voice note) messages
    audioUrl: {
      type: String,
      default: null,
    },
    audioPublicId: {
      type: String,
      default: null,
    },
    audioDuration: {
      type: Number, // seconds
      default: null,
    },
    // True when a phone number or external contact was detected and masked
    wasFiltered: {
      type: Boolean,
      default: false,
    },
    // Soft delete — message removed by admin
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for fast chat history retrieval per job
MessageSchema.index({ jobId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', MessageSchema);
