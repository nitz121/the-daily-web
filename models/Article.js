const mongoose = require('mongoose');
const sanitizeHtml = require('../utils/sanitizeHtml');

// ── Article lifecycle ──────────────────────────────────────────────────────
// `status` is the lifecycle until the first publication. Once published it stays 'published',
// so the public site (which shows status 'published') keeps showing the last approved version.
// An update of a published article has its own lifecycle in `revisionStatus`
// (null = no update in progress) and its text lives in draftTitle / draftContent.
const STATUS = {
    DRAFT: 'draft',         // "In preparation"
    PENDING: 'pending',     // "Pending editor approval"
    PUBLISHED: 'published', // "Published"
    RETURNED: 'returned'    // "Returned for corrections"
};

const REVISION_STATUSES = [STATUS.DRAFT, STATUS.PENDING, STATUS.RETURNED];

const STATUS_LABELS = {
    draft: 'In preparation',
    pending: 'Pending editor approval',
    published: 'Published',
    returned: 'Returned for corrections'
};

// The only allowed transitions (project spec). Any other transition is rejected.
// Before the first publication they apply to `status`, afterwards to `revisionStatus`.
const TRANSITIONS = [
    { from: STATUS.DRAFT,    to: STATUS.PENDING,   role: 'reporter', authorOnly: true },
    { from: STATUS.RETURNED, to: STATUS.PENDING,   role: 'reporter', authorOnly: true },
    { from: STATUS.PENDING,  to: STATUS.PUBLISHED, role: 'editor' },
    { from: STATUS.PENDING,  to: STATUS.RETURNED,  role: 'editor', requiresNote: true }
];

const TITLE_MAX = 200;
const EDITOR_NOTE_MAX = 1000;

// Error thrown when a workflow rule is broken (the controller turns it into a 400/403 response)
function workflowError(code, message, status = 400) {
    const err = new Error(message);
    err.name = 'WorkflowError';
    err.code = code;
    err.status = status;
    return err;
}

function isAuthor(article, user) {
    const authorId = article.author && article.author._id ? article.author._id : article.author;
    return Boolean(authorId) && String(authorId) === String(user.id);
}

function hasText(html) {
    return typeof html === 'string' && html.replace(/<[^>]*>/g, '').trim().length > 0;
}

// Stage the workflow is in: the article's status before publication, the update's status after it.
// A published article with no update in progress is simply 'published'.
function workflowStage(article) {
    if (article.status === STATUS.PUBLISHED) return article.revisionStatus || STATUS.PUBLISHED;
    return article.status;
}

// One entry per editor approval: the first is the original publication, the rest are updates.
// These timestamps are the markers on the Impact Analytics chart.
const publishRecordSchema = new mongoose.Schema({
    publishedAt: { type: Date, required: true },
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: { type: String }
}, { _id: false });

const articleSchema = new mongoose.Schema({
    // Live (public) version - changes only when an editor approves
    title: { type: String, default: '', maxlength: TITLE_MAX },
    content: { type: String, default: '' },

    // Working version: a new article, or an update of a published article
    draftTitle: { type: String, maxlength: TITLE_MAX },
    draftContent: { type: String },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true },
    status: {
        type: String,
        enum: Object.values(STATUS),
        default: STATUS.DRAFT
    },
    // Lifecycle of an update to a published article (null = no update in progress)
    revisionStatus: {
        type: String,
        enum: [null, ...REVISION_STATUSES],
        default: null
    },
    imageUrl: { type: String },
    viewsCount: { type: Number, default: 0 },

    // Editor's note when returning an article (or an update) for corrections
    editorNote: { type: String, maxlength: EDITOR_NOTE_MAX },

    // Publication data
    publishedAt: { type: Date }, // first publication
    publishHistory: { type: [publishRecordSchema], default: [] }
}, { timestamps: true });

articleSchema.index({ status: 1, updatedAt: -1 });         // editor dashboard tabs
articleSchema.index({ revisionStatus: 1, updatedAt: -1 }); // updates waiting for the editor
articleSchema.index({ author: 1, updatedAt: -1 });         // reporter dashboard: "my articles"

articleSchema.statics.workflowStage = workflowStage;

// ── Permissions ─────────────────────────────────────────────────────────────
// Editor: any article. Reporter: only own articles, and only while they are not waiting for
// the editor - in preparation / returned, or published with no update pending approval.
articleSchema.methods.canEditBy = function (user) {
    if (!user) return false;
    if (user.role === 'editor') return true;
    if (user.role !== 'reporter' || !isAuthor(this, user)) return false;

    if (this.status === STATUS.PUBLISHED) {
        return [null, STATUS.DRAFT, STATUS.RETURNED].includes(this.revisionStatus || null);
    }
    return [STATUS.DRAFT, STATUS.RETURNED].includes(this.status);
};

// ── Editing ─────────────────────────────────────────────────────────────────
// Returns 'draft' when the working version was changed, or 'live' when the change went public.
articleSchema.methods.applyEdit = function ({ title, content }, user) {
    const cleanTitle = typeof title === 'string' ? title.trim() : undefined;
    const cleanContent = typeof content === 'string' ? sanitizeHtml(content) : undefined;
    const isPublished = this.status === STATUS.PUBLISHED;

    // An editor is the approver, so an editor's change to a published article (with no update
    // in progress) goes live immediately and is recorded as an approved update.
    if (user.role === 'editor' && isPublished && !this.revisionStatus) {
        if (cleanTitle !== undefined) this.title = cleanTitle;
        if (cleanContent !== undefined) this.content = cleanContent;

        if (!this.title || !hasText(this.content)) {
            throw workflowError('EMPTY_ARTICLE', 'A published article must have a title and content');
        }
        this.recordPublication(user);
        return 'live';
    }

    // The first edit of a published article opens an update in preparation.
    // The live title / content stay untouched until an editor approves the update.
    if (isPublished && !this.revisionStatus) {
        this.revisionStatus = STATUS.DRAFT;
        this.draftTitle = this.title;
        this.draftContent = this.content;
    }

    if (cleanTitle !== undefined) this.draftTitle = cleanTitle;
    if (cleanContent !== undefined) this.draftContent = cleanContent;
    return 'draft';
};

// ── State machine ───────────────────────────────────────────────────────────
articleSchema.methods.transitionTo = function (to, user, note) {
    const isUpdate = this.status === STATUS.PUBLISHED;
    const from = isUpdate ? this.revisionStatus : this.status;
    const rule = TRANSITIONS.find(t => t.from === from && t.to === to);

    if (!rule) {
        const fromLabel = isUpdate && !from ? 'Published (no update in progress)' : STATUS_LABELS[from];
        throw workflowError('INVALID_TRANSITION',
            `An article cannot move from "${fromLabel}" to "${STATUS_LABELS[to] || to}"`);
    }
    if (rule.role !== user.role) {
        throw workflowError('FORBIDDEN', `Only a ${rule.role} can move an article to "${STATUS_LABELS[to]}"`, 403);
    }
    if (rule.authorOnly && !isAuthor(this, user)) {
        throw workflowError('FORBIDDEN', 'Only the author can submit this article for approval', 403);
    }

    if (rule.requiresNote) {
        const cleanNote = typeof note === 'string' ? note.trim() : '';
        if (!cleanNote) {
            throw workflowError('NOTE_REQUIRED', 'Please add a note explaining which corrections are needed');
        }
        if (cleanNote.length > EDITOR_NOTE_MAX) {
            throw workflowError('NOTE_TOO_LONG', `The note is limited to ${EDITOR_NOTE_MAX} characters`);
        }
        this.editorNote = cleanNote;
    }

    if (to === STATUS.PUBLISHED) {
        this.publishWorkingVersion(user);
    } else if (isUpdate) {
        this.revisionStatus = to;
    } else {
        this.status = to;
    }
};

// Approval: the working version becomes the live version
articleSchema.methods.publishWorkingVersion = function (user) {
    const newTitle = this.draftTitle != null ? this.draftTitle : this.title;
    const newContent = this.draftContent != null ? this.draftContent : this.content;

    if (!newTitle || !newTitle.trim() || !hasText(newContent)) {
        throw workflowError('NOTHING_TO_PUBLISH', 'The article needs a title and content before it can be published');
    }

    this.title = newTitle.trim();
    this.content = newContent;
    this.draftTitle = undefined;
    this.draftContent = undefined;
    this.editorNote = undefined;
    this.status = STATUS.PUBLISHED;
    this.revisionStatus = null;
    this.recordPublication(user);
};

articleSchema.methods.recordPublication = function (user, at = new Date()) {
    if (!this.publishedAt) this.publishedAt = at;
    this.publishHistory.push({ publishedAt: at, editor: user.id, title: this.title });
};

const Article = mongoose.model('Article', articleSchema);

Article.STATUS = STATUS;
Article.STATUS_LABELS = STATUS_LABELS;
Article.TRANSITIONS = TRANSITIONS;
Article.TITLE_MAX = TITLE_MAX;

module.exports = Article;
