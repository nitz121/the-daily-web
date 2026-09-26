const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    // Live (public) content
    title: { type: String, required: true },
    content: { type: String, required: true },

    // Draft content (reporter edits a published article without touching the live version)
    draftTitle: { type: String },
    draftContent: { type: String },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true },
    status: {
        type: String,
        enum: ['draft', 'pending', 'published', 'returned'],
        default: 'draft'
    },
    imageUrl: { type: String },
    viewsCount: { type: Number, default: 0 },

    // Editor's note when returning an article for corrections
    editorNote: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Article', articleSchema);
