const mongoose = require('mongoose');
const Article = require('../models/Article');
const analytics = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * Editor area (Student 4)
 * Lists every article by status, review of submitted content (live vs proposed version),
 * editing by the editor, approve / return / delete, and the shared status-change endpoint.
 */

const PAGE_SIZE = 20;
const CONTENT_MAX = 50000;
const { STATUS } = Article;

// Dashboard tabs. A published article with an update in progress keeps status 'published'
// (readers still see it), and also appears in the tab of its update's stage.
const TAB_FILTERS = {
    all: {},
    pending: { $or: [{ status: STATUS.PENDING }, { revisionStatus: STATUS.PENDING }] },
    published: { status: STATUS.PUBLISHED },
    returned: { $or: [{ status: STATUS.RETURNED }, { revisionStatus: STATUS.RETURNED }] },
    draft: { $or: [{ status: STATUS.DRAFT }, { revisionStatus: STATUS.DRAFT }] }
};

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function invalidId(res) {
    return res.status(404).json({ success: false, message: 'Article not found' });
}

function hasWorkingVersion(article) {
    return article.status !== STATUS.PUBLISHED || Boolean(article.revisionStatus);
}

// The title shown in lists: the version that is being worked on, or the live one
function workingTitle(article) {
    if (!hasWorkingVersion(article)) return article.title;
    return article.draftTitle || article.title || '(untitled)';
}

// Row in the editor's articles table
function toSummary(article) {
    return {
        _id: article._id,
        title: workingTitle(article),
        author: article.author && article.author.username ? article.author.username : 'Unknown',
        category: article.category,
        status: article.status,
        revisionStatus: article.revisionStatus || null,
        stage: Article.workflowStage(article), // the stage the editor acts on
        viewsCount: article.viewsCount || 0,
        updatedAt: article.updatedAt,
        publishedAt: article.publishedAt || null,
        updatesCount: Math.max((article.publishHistory || []).length - 1, 0)
    };
}

// Full data for the review dialog: what readers see now vs the version waiting for approval
function toReview(article) {
    return {
        ...toSummary(article),
        imageUrl: article.imageUrl || '',
        editorNote: article.editorNote || '',
        createdAt: article.createdAt,
        live: article.status === STATUS.PUBLISHED ? { title: article.title, content: article.content } : null,
        draft: hasWorkingVersion(article)
            ? {
                title: article.draftTitle != null ? article.draftTitle : article.title,
                content: article.draftContent != null ? article.draftContent : article.content
            }
            : null,
        publishHistory: (article.publishHistory || []).map(record => ({
            publishedAt: record.publishedAt,
            editor: record.editor && record.editor.username ? record.editor.username : 'Editor',
            title: record.title
        }))
    };
}

function sendWorkflowError(res, err) {
    return res.status(err.status || 400).json({ success: false, code: err.code, message: err.message });
}

// ── Page ────────────────────────────────────────────────────────────────────
exports.renderDashboard = (req, res) => {
    res.render('editor-dashboard');
};

// ── GET /api/editor/articles?status=&search=&page= ─────────────────────────
exports.listArticles = async (req, res) => {
    try {
        const tab = req.query.status || 'pending';
        if (!Object.prototype.hasOwnProperty.call(TAB_FILTERS, tab)) {
            return res.status(400).json({ success: false, message: 'Unknown status filter' });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

        // Search by the live title or the title that is being worked on
        const searchFilter = {};
        if (search) {
            const pattern = new RegExp(escapeRegex(search), 'i');
            searchFilter.$or = [{ title: pattern }, { draftTitle: pattern }];
        }
        const conditions = [TAB_FILTERS[tab], searchFilter].filter(c => Object.keys(c).length > 0);
        const filter = conditions.length ? { $and: conditions } : {};

        // The approval queue is handled first-in first-out; other lists show the latest changes first
        const sort = tab === STATUS.PENDING ? { updatedAt: 1 } : { updatedAt: -1 };
        const skip = (page - 1) * PAGE_SIZE;

        // Tab counters in one pass (an article with an update counts as published and in its update's tab)
        const inStage = (stage) => ({
            $cond: [{ $or: [{ $eq: ['$status', stage] }, { $eq: ['$revisionStatus', stage] }] }, 1, 0]
        });

        const [total, articles, countRows] = await Promise.all([
            Article.countDocuments(filter),
            Article.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(PAGE_SIZE)
                .select('title draftTitle author category status revisionStatus viewsCount updatedAt publishedAt publishHistory.publishedAt')
                .populate('author', 'username')
                .lean(),
            Article.aggregate([
                { $match: searchFilter },
                {
                    $group: {
                        _id: null,
                        all: { $sum: 1 },
                        published: { $sum: { $cond: [{ $eq: ['$status', STATUS.PUBLISHED] }, 1, 0] } },
                        pending: { $sum: inStage(STATUS.PENDING) },
                        returned: { $sum: inStage(STATUS.RETURNED) },
                        draft: { $sum: inStage(STATUS.DRAFT) }
                    }
                }
            ])
        ]);

        const { _id, ...counts } = countRows[0] || { all: 0, published: 0, pending: 0, returned: 0, draft: 0 };

        res.json({
            success: true,
            page,
            total,
            hasMore: skip + articles.length < total,
            counts,
            articles: articles.map(toSummary)
        });
    } catch (err) {
        logger.error('Editor articles list failed', { error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load articles' });
    }
};

// ── GET /api/editor/articles/:id ────────────────────────────────────────────
exports.getArticle = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);

        const article = await Article.findById(req.params.id)
            .populate('author', 'username')
            .populate('publishHistory.editor', 'username')
            .lean();
        if (!article) return invalidId(res);

        res.json({ success: true, article: toReview(article) });
    } catch (err) {
        logger.error('Editor article load failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load the article' });
    }
};

// ── PUT /api/editor/articles/:id  (the editor edits the article) ───────────
exports.updateArticle = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);

        const { title, content } = req.body || {};
        if (title === undefined && content === undefined) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }
        if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.trim().length > Article.TITLE_MAX)) {
            return res.status(400).json({ success: false, message: `The title is required and limited to ${Article.TITLE_MAX} characters` });
        }
        if (content !== undefined && (typeof content !== 'string' || content.length > CONTENT_MAX)) {
            return res.status(400).json({ success: false, message: 'Invalid article content' });
        }

        const article = await Article.findById(req.params.id).populate('author', 'username');
        if (!article) return invalidId(res);

        const user = req.session.user;
        if (!article.canEditBy(user)) {
            return res.status(403).json({ success: false, message: 'You are not allowed to edit this article' });
        }

        let appliedTo;
        try {
            appliedTo = article.applyEdit({ title, content }, user);
        } catch (err) {
            if (err.name === 'WorkflowError') return sendWorkflowError(res, err);
            throw err;
        }

        await article.save();
        await article.populate('publishHistory.editor', 'username');

        logger.info('Article edited by editor', {
            articleId: String(article._id), editor: user.username, appliedTo
        });

        res.json({
            success: true,
            appliedTo,
            message: appliedTo === 'live'
                ? 'Changes saved and published - readers now see the new version.'
                : 'Changes saved to the version waiting for approval.',
            article: toReview(article.toObject())
        });
    } catch (err) {
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: err.message });
        }
        logger.error('Editor article update failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to save the article' });
    }
};

// ── PATCH /api/articles/:id/status ─────────────────────────────────────────
// Shared by both roles: reporters submit (draft/returned -> pending),
// editors approve (pending -> published) or return with a note (pending -> returned).
// All the rules live in the Article model's state machine.
exports.changeStatus = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);

        const { status, editorNote } = req.body || {};
        if (!Object.values(Article.STATUS).includes(status)) {
            return res.status(400).json({ success: false, message: 'Unknown status' });
        }

        const article = await Article.findById(req.params.id).populate('author', 'username');
        if (!article) return invalidId(res);

        const user = req.session.user;
        const previousStage = Article.workflowStage(article);

        try {
            article.transitionTo(status, user, editorNote);
        } catch (err) {
            if (err.name === 'WorkflowError') {
                logger.warn('Rejected status change', {
                    articleId: String(article._id), from: previousStage, to: status, user: user.username, code: err.code
                });
                return sendWorkflowError(res, err);
            }
            throw err;
        }

        await article.save();

        logger.info('Article status changed', {
            articleId: String(article._id), from: previousStage, to: status, user: user.username
        });

        const messages = {
            published: 'Approved - the new version is now live.',
            returned: 'Returned to the reporter with your note.',
            pending: 'Submitted for editor approval.'
        };

        res.json({
            success: true,
            message: messages[status] || 'Status updated.',
            article: toSummary(article.toObject())
        });
    } catch (err) {
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: err.message });
        }
        logger.error('Status change failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to change the status' });
    }
};

// ── DELETE /api/articles/:id ────────────────────────────────────────────────
exports.deleteArticle = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);

        const article = await Article.findByIdAndDelete(req.params.id);
        if (!article) return invalidId(res);

        // Remove everything that belongs to the article. The comments collection is accessed
        // directly so this works regardless of when the Comment model is added.
        const [stats, comments] = await Promise.all([
            analytics.deleteArticleStats(article._id),
            mongoose.connection.collection('comments').deleteMany({ articleId: article._id })
        ]);

        logger.info('Article deleted', {
            articleId: String(article._id),
            title: article.title || article.draftTitle,
            editor: req.session.user.username,
            removedStats: stats.deletedCount,
            removedComments: comments.deletedCount
        });

        res.json({ success: true, message: 'The article was deleted.' });
    } catch (err) {
        logger.error('Article delete failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to delete the article' });
    }
};
