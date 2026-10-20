const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },

    authorName: { type: String, trim: true, maxlength: 50, default: 'Guest' },
    content: { type: String, required: true, trim: true, maxlength: 1000 },

    // Used by the comment rate limiter (max 3 comments per minute from the same device).
    // deviceId is a random id stored in the visitor's session cookie.
    // Never sent back to the client.
    deviceId: { type: String, required: true },
    ipAddress: { type: String }
}, { timestamps: true });

// List the comments of an article, newest first
commentSchema.index({ articleId: 1, createdAt: -1 });

// Rate limiter: "how many comments did this device / IP post in the last minute?"
commentSchema.index({ deviceId: 1, createdAt: -1 });
commentSchema.index({ ipAddress: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', commentSchema);
