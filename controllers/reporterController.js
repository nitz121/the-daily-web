const mongoose = require('mongoose');
const Article = require('../models/Article');
const CATEGORIES = require('../config/categories');
const { textToHtml, htmlToText } = require('../utils/articleText');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

const PAGE_SIZE = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50000;
const MIN_TITLE_LENGTH = 3;
const MIN_CONTENT_LENGTH = 20;
const STATUS_FILTERS = ['draft', 'pending', 'published', 'returned'];

// ── Article State Helpers ──────────────────────────────────────────────────

function isOwner(article, user) {
    return article.author.toString() === String(user.id);
}

// While an editor reviews the article (or its update) the reporter can't change it
function isLockedForReview(article) {
    return article.status === 'pending' || article.revisionStatus === 'pending';
}

// Allowed reporter transitions:
//   draft / returned               -> pending
//   published + update in progress -> update pending (live version stays public)
function canSubmit(article) {
    if (article.status === 'draft' || article.status === 'returned') return true;
    return article.status === 'published' && ['draft', 'returned'].includes(article.revisionStatus);
}

function isReturned(article) {
    return article.status === 'returned' || article.revisionStatus === 'returned';
}

// The version the reporter works on. For a published article with no update in
// progress it is the live version; otherwise the draft fields (falling back to
// the live ones for fields that were never edited).
function workingCopy(article) {
    if (article.status === 'published' && !article.revisionStatus) {
        return {
            title: article.title || '',
            content: article.content || '',
            category: article.category || '',
            imageUrl: article.imageUrl || ''
        };
    }
    return {
        title: article.draftTitle ?? article.title ?? '',
        content: article.draftContent ?? article.content ?? '',
        category: article.draftCategory ?? article.category ?? '',
        imageUrl: article.draftImageUrl ?? article.imageUrl ?? ''
    };
}

// Filter for a dashboard tab. An update of a published article appears both under
// "Published" and under the tab of the update's state (e.g. "Awaiting Approval").
function statusFilter(status) {
    if (status === 'published') return { status: 'published' };
    return { $or: [{ status }, { revisionStatus: status }] };
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

/**
 * Validates the fields sent by the editor page and builds the $set for the draft fields.
 * Drafts may be incomplete (autosave), so empty values are allowed here;
 * completeness is checked only when the article is submitted for approval.
 * Returns { update } or { error } with a user-facing message.
 */
function buildDraftUpdate(body) {
    const update = {};

    if (body.title !== undefined) {
        if (typeof body.title !== 'string') return { error: 'Title must be text.' };
        const title = body.title.trim();
        if (title.length > MAX_TITLE_LENGTH) {
            return { error: `Title is too long (max ${MAX_TITLE_LENGTH} characters).` };
        }
        update.draftTitle = title;
    }

    if (body.content !== undefined) {
        if (typeof body.content !== 'string') return { error: 'Article text must be text.' };
        if (body.content.length > MAX_CONTENT_LENGTH) {
            return { error: `Article text is too long (max ${MAX_CONTENT_LENGTH} characters).` };
        }
        update.draftContent = textToHtml(body.content);
    }

    if (body.category !== undefined) {
        if (body.category !== '' && !CATEGORIES.includes(body.category)) {
            return { error: 'Please choose a valid category.' };
        }
        update.draftCategory = body.category;
    }

    if (body.imageUrl !== undefined) {
        if (typeof body.imageUrl !== 'string') return { error: 'Image URL must be text.' };
        const imageUrl = body.imageUrl.trim();
        if (imageUrl && !isHttpUrl(imageUrl)) {
            return { error: 'Image URL must be a full link starting with http:// or https://' };
        }
        // new URL().href percent-encodes characters like quotes, so the URL is safe inside HTML attributes
        update.draftImageUrl = imageUrl ? new URL(imageUrl).href : '';
    }

    return { update };
}

/**
 * Checks that a draft is complete enough to be sent to an editor.
 * Returns an error message or null.
 */
function validateForSubmit(draft) {
    if (draft.title.trim().length < MIN_TITLE_LENGTH) {
        return `Please write a title (at least ${MIN_TITLE_LENGTH} characters).`;
    }
    if (!CATEGORIES.includes(draft.category)) {
        return 'Please choose a category.';
    }
    if (htmlToText(draft.content).length < MIN_CONTENT_LENGTH) {
        return `The article text is too short (at least ${MIN_CONTENT_LENGTH} characters).`;
    }
    return null;
}

// Shape of an article in the dashboard list
function toListItem(article) {
    const draft = workingCopy(article);
    return {
        _id: article._id,
        title: draft.title || 'Untitled draft',
        category: draft.category,
        status: article.status,
        revisionStatus: article.revisionStatus || null,
        editorNote: isReturned(article) ? (article.editorNote || '') : '',
        updatedAt: article.updatedAt,
        isEditable: !isLockedForReview(article),
        canSubmit: canSubmit(article)
    };
}

async function countByStatus(authorId) {
    const [all, ...perStatus] = await Promise.all([
        Article.countDocuments({ author: authorId }),
        ...STATUS_FILTERS.map((status) => Article.countDocuments({ author: authorId, ...statusFilter(status) }))
    ]);

    const counts = { all };
    STATUS_FILTERS.forEach((status, i) => {
        counts[status] = perStatus[i];
    });
    return counts;
}

// ── Pages (SSR) ────────────────────────────────────────────────────────────

/**
 * Reporter dashboard page - the list itself is loaded with AJAX
 * GET /reporter-dashboard
 */
exports.renderDashboard = (req, res) => {
    res.render('reporter/dashboard', { submitted: req.query.submitted === '1' });
};

/**
 * Empty editor for a new article. The article is created on the first autosave
 * that has some content, so abandoned empty drafts are never stored.
 * GET /reporter/articles/new
 */
exports.renderNewArticle = (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.render('reporter/editor', {
        article: null,
        draft: { title: '', content: '', category: '', imageUrl: '' },
        categories: CATEGORIES,
        locked: false,
        canSubmit: true
    });
};

/**
 * Editor for an existing article, pre-filled with the latest saved version.
 * GET /reporter/articles/:id/edit
 */
exports.renderEditArticle = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).send('Article not found');
        }

        const article = await Article.findById(id).lean();
        if (!article) {
            return res.status(404).send('Article not found');
        }
        if (!isOwner(article, req.session.user)) {
            return res.status(403).send('Access Denied: you can only edit your own articles');
        }

        const draft = workingCopy(article);
        draft.content = htmlToText(draft.content);

        // Always fetch a fresh copy (no browser cache / back-forward cache),
        // so returning to the editor shows the latest saved version.
        res.set('Cache-Control', 'no-store');
        res.render('reporter/editor', {
            article,
            draft,
            categories: CATEGORIES,
            locked: isLockedForReview(article),
            canSubmit: canSubmit(article)
        });
    } catch (err) {
        logger.error('reporter_editor_render_failed', { articleId: req.params.id, message: err.message });
        res.status(500).send('Server Error');
    }
};

// ── API (AJAX) ─────────────────────────────────────────────────────────────

/**
 * The logged-in reporter's articles: status tab, title search, pagination and tab counts.
 * GET /api/reporter/articles?status=all|draft|pending|published|returned&search=&page=1
 */
exports.getMyArticles = async (req, res) => {
    try {
        const authorId = req.session.user.id;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const status = STATUS_FILTERS.includes(req.query.status) ? req.query.status : 'all';
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        const conditions = [{ author: authorId }];
        if (status !== 'all') {
            conditions.push(statusFilter(status));
        }
        if (search) {
            const pattern = { $regex: escapeRegex(search), $options: 'i' };
            conditions.push({ $or: [{ title: pattern }, { draftTitle: pattern }] });
        }
        const filter = { $and: conditions };

        const skip = (page - 1) * PAGE_SIZE;
        const [articles, total, counts] = await Promise.all([
            Article.find(filter)
                .sort({ updatedAt: -1, _id: -1 })
                .skip(skip)
                .limit(PAGE_SIZE)
                .select('title draftTitle category draftCategory status revisionStatus editorNote updatedAt')
                .lean(),
            Article.countDocuments(filter),
            countByStatus(authorId)
        ]);

        res.json({
            success: true,
            page,
            total,
            hasMore: skip + articles.length < total,
            counts,
            articles: articles.map(toListItem)
        });
    } catch (err) {
        logger.error('reporter_articles_list_failed', { user: req.session.user.username, message: err.message });
        res.status(500).json({ success: false, message: 'Failed to load your articles' });
    }
};

/**
 * Create a new article (status "draft") - called by the first autosave of a new article.
 * POST /api/articles   body: { title, category, imageUrl, content }
 */
exports.createArticle = async (req, res) => {
    try {
        const { update, error } = buildDraftUpdate(req.body || {});
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const savedAt = new Date();
        const article = await Article.create({
            ...update,
            draftUpdatedAt: savedAt,
            author: req.session.user.id,
            status: 'draft'
        });

        logger.info('article_created', { articleId: article._id.toString(), user: req.session.user.username });

        res.status(201).json({
            success: true,
            savedAt,
            article: { _id: article._id, status: article.status }
        });
    } catch (err) {
        logger.error('article_create_failed', { user: req.session.user.username, message: err.message });
        res.status(500).json({ success: false, message: 'Failed to create the article' });
    }
};

/**
 * Autosave: update the draft fields of an article. Never touches the live fields,
 * so readers keep seeing the published version.
 * Reporters may only update their own articles and not while they await approval.
 * PUT /api/articles/:id   body: { title?, category?, imageUrl?, content? }
 */
exports.updateArticle = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid article id' });
        }

        const user = req.session.user;
        const article = await Article.findById(id).select('author status revisionStatus').lean();
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        if (user.role === 'reporter') {
            if (!isOwner(article, user)) {
                logger.warn('article_update_forbidden', { articleId: id, user: user.username });
                return res.status(403).json({ success: false, message: 'You can only edit your own articles' });
            }
            if (isLockedForReview(article)) {
                return res.status(409).json({
                    success: false,
                    message: 'This article is awaiting editor approval and cannot be edited right now.'
                });
            }
        }

        const { update, error } = buildDraftUpdate(req.body || {});
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        update.draftUpdatedAt = new Date();

        // The first change to a published article starts a new update (revision)
        if (article.status === 'published' && !article.revisionStatus) {
            update.revisionStatus = 'draft';
        }

        await Article.updateOne({ _id: id }, { $set: update });

        res.json({ success: true, savedAt: update.draftUpdatedAt });
    } catch (err) {
        logger.error('article_autosave_failed', { articleId: req.params.id, message: err.message });
        res.status(500).json({ success: false, message: 'Failed to save the article' });
    }
};

/**
 * Submit an article (or an update of a published article) for editor approval.
 * PATCH /api/articles/:id/submit
 */
exports.submitArticle = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid article id' });
        }

        const article = await Article.findById(id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        if (!isOwner(article, req.session.user)) {
            logger.warn('article_submit_forbidden', { articleId: id, user: req.session.user.username });
            return res.status(403).json({ success: false, message: 'You can only submit your own articles' });
        }
        if (!canSubmit(article)) {
            const message = isLockedForReview(article)
                ? 'This article is already awaiting editor approval.'
                : 'There are no new changes to submit. Edit the article first.';
            return res.status(409).json({ success: false, message });
        }

        const draft = workingCopy(article);
        const problem = validateForSubmit(draft);
        if (problem) {
            return res.status(400).json({ success: false, message: problem });
        }

        // Store the complete version for the editor (fields never edited are taken from the live version)
        article.draftTitle = draft.title;
        article.draftContent = draft.content;
        article.draftCategory = draft.category;
        article.draftImageUrl = draft.imageUrl;

        if (article.status === 'published') {
            article.revisionStatus = 'pending'; // live version stays public until approved
        } else {
            article.status = 'pending';
        }
        article.submittedAt = new Date();
        await article.save();

        logger.info('article_submitted', {
            articleId: id,
            user: req.session.user.username,
            status: article.status,
            revisionStatus: article.revisionStatus
        });

        res.json({ success: true, status: article.status, revisionStatus: article.revisionStatus });
    } catch (err) {
        logger.error('article_submit_failed', { articleId: req.params.id, message: err.message });
        res.status(500).json({ success: false, message: 'Failed to submit the article' });
    }
};
