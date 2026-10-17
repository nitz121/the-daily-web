const mongoose = require('mongoose');

// Live fields are required only once the article is published:
// a brand-new draft has no approved (live) version yet - the reporter's
// work is kept in the draft* fields until an editor approves it.
function isPublished() {
    return this.status === 'published';
}

const articleSchema = new mongoose.Schema({
    // Live (public) content - the last version approved by an editor
    title: { type: String, required: isPublished },
    content: { type: String, required: isPublished },

    // Draft content (reporter edits a published article without touching the live version)
    draftTitle: { type: String },
    draftContent: { type: String },
    draftCategory: { type: String },
    draftImageUrl: { type: String },
    draftUpdatedAt: { type: Date }, // last autosave of the draft

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: isPublished },
    status: {
        type: String,
        enum: ['draft', 'pending', 'published', 'returned'],
        default: 'draft'
    },

    // State of an update to an article that is already published.
    // status stays 'published' (readers keep seeing the live version) while the
    // new version goes through its own approval flow: draft -> pending -> approved / returned.
    revisionStatus: {
        type: String,
        enum: [null, 'draft', 'pending', 'returned'],
        default: null
    },
    submittedAt: { type: Date }, // last time the reporter submitted for approval

    imageUrl: { type: String },
    viewsCount: { type: Number, default: 0 },

    // Editor's note when returning an article for corrections
    editorNote: { type: String }
}, { timestamps: true });

// Reporter dashboard: "my articles, most recently updated first"
articleSchema.index({ author: 1, updatedAt: -1 });

module.exports = mongoose.model('Article', articleSchema);
