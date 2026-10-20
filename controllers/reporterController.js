const mongoose = require('mongoose');
const Article = require('../models/Article');
const CATEGORIES = require('../config/categories');
const { textToHtml, htmlToText } = require('../utils/articleText');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

/**
 * Reporter area (Student 3)
 * The reporter's dashboard and editor page, and the create / autosave API.
 * All workflow rules come from the Article model (Student 4): canEditBy, applyEdit,
 * workflowStage and TRANSITIONS. Submitting for approval uses the shared
 * PATCH /api/articles/:id/status endpoint (editorController.changeStatus).
 */

const PAGE_SIZE = 20;
const CONTENT_MAX = 50000;
const { STATUS } = Article;
const TABS = [STATUS.DRAFT, STATUS.PENDING, STATUS.PUBLISHED, STATUS.RETURNED];

// ── Helpers ────────────────────────────────────────────────────────────────

function isAuthor(article, user) {
    return String(article.author) === String(user.id);
}

// The reporter may submit when the state machine has a reporter transition from the
// current stage (In preparation / Returned -> Pending approval)
function canSubmit(article) {
    const stage = Article.workflowStage(article);
    return Article.TRANSITIONS.some((t) => t.role === 'reporter' && t.from === stage);
}

// The version the reporter works on - the same rule as the editor's review:
// the working version (draftTitle / draftContent) when there is one, otherwise the live one.
// Category and image are not versioned in the Article model.
function workingVersion(article) {
    const hasWorkingVersion = article.status !== STATUS.PUBLISHED || Boolean(article.revisionStatus);
    return {
        title: hasWorkingVersion && article.draftTitle != null ? article.draftTitle : (article.title || ''),
        content: hasWorkingVersion && article.draftContent != null ? article.draftContent : (article.content || ''),
        category: article.category || '',
        imageUrl: article.imageUrl || ''
    };
}

// Dashboard tab filter. A published article with an update in progress appears both under
// "Published" and under the tab of its update's stage (same as the editor dashboard).
function tabFilter(tab) {
    if (tab === STATUS.PUBLISHED) return { status: STATUS.PUBLISHED };
    return { $or: [{ status: tab }, { revisionStatus: tab }] };
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
 * Validates the fields sent by the editor page.
 * A draft may be incomplete (autosave), so an empty title / content is allowed;
 * completeness is checked by the state machine when the editor publishes.
 * Returns { values } or { error } with a user-facing message.
 */
function validateInput(body) {
    const values = {};

    if (body.title !== undefined) {
        if (typeof body.title !== 'string') return { error: 'Title must be text.' };
        if (body.title.trim().length > Article.TITLE_MAX) {
            return { error: `Title is too long (max ${Article.TITLE_MAX} characters).` };
        }
        values.title = body.title;
    }

    if (body.content !== undefined) {
        if (typeof body.content !== 'string') return { error: 'Article text must be text.' };
        if (body.content.length > CONTENT_MAX) {
            return { error: `Article text is too long (max ${CONTENT_MAX} characters).` };
        }
        // Plain text -> escaped HTML paragraphs (applyEdit sanitizes it as well)
        values.content = textToHtml(body.content);
    }

    if (body.category !== undefined) {
        if (!CATEGORIES.includes(body.category)) return { error: 'Please choose a valid category.' };
        values.category = body.category;
    }

    if (body.imageUrl !== undefined) {
        if (typeof body.imageUrl !== 'string') return { error: 'Image URL must be text.' };
        const imageUrl = body.imageUrl.trim();
        if (imageUrl && !isHttpUrl(imageUrl)) {
            return { error: 'Image URL must be a full link starting with http:// or https://' };
        }
        // new URL().href percent-encodes characters like quotes, so the URL is safe inside HTML attributes
        values.imageUrl = imageUrl ? new URL(imageUrl).href : '';
    }

    return { values };
}

// Row in the reporter's article list
function toListItem(article, user) {
    const working = workingVersion(article);
    const stage = Article.workflowStage(article);
    return {
        _id: article._id,
        title: working.title || 'Untitled draft',
        category: working.category,
        status: article.status,
        revisionStatus: article.revisionStatus || null,
        stage,
        editorNote: stage === STATUS.RETURNED ? (article.editorNote || '') : '',
        updatedAt: article.updatedAt,
        isEditable: article.canEditBy(user),
        canSubmit: canSubmit(article)
    };
}

async function countByTab(authorId) {
    const [all, ...perTab] = await Promise.all([
        Article.countDocuments({ author: authorId }),
        ...TABS.map((tab) => Article.countDocuments({ author: authorId, ...tabFilter(tab) }))
    ]);

    const counts = { all };
    TABS.forEach((tab, i) => {
        counts[tab] = perTab[i];
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
        draft: { title: '', content: '', category: CATEGORIES[0], imageUrl: '' },
        categories: CATEGORIES,
        locked: false,
        canSubmit: true,
        isPublished: false
    });
};

/**
 * Editor for an existing article, pre-filled with the latest saved version.
 * GET /reporter/articles/:id/edit
 */
exports.renderEditArticle = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(404).send('Article not found');
        }

        const article = await Article.findById(id);
        if (!article) {
            return res.status(404).send('Article not found');
        }

        const user = req.session.user;
        if (!isAuthor(article, user)) {
            return res.status(403).send('Access Denied: you can only edit your own articles');
        }

        const draft = workingVersion(article);
        draft.content = htmlToText(draft.content);

        // Always fetch a fresh copy (no browser cache / back-forward cache),
        // so returning to the editor shows the latest saved version.
        res.set('Cache-Control', 'no-store');
        res.render('reporter/editor', {
            article,
            draft,
            categories: CATEGORIES,
            locked: !article.canEditBy(user),
            canSubmit: canSubmit(article),
            isPublished: article.status === STATUS.PUBLISHED
        });
    } catch (err) {
        logger.error('Reporter editor page failed', { articleId: req.params.id, error: err.message });
        res.status(500).send('Server Error');
    }
};

// ── API (AJAX) ─────────────────────────────────────────────────────────────

/**
 * The logged-in reporter's articles: stage tab, title search, pagination and tab counts.
 * GET /api/reporter/articles?status=all|draft|pending|published|returned&search=&page=1
 */
exports.getMyArticles = async (req, res) => {
    try {
        const user = req.session.user;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const tab = TABS.includes(req.query.status) ? req.query.status : 'all';
        const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

        const conditions = [{ author: user.id }];
        if (tab !== 'all') {
            conditions.push(tabFilter(tab));
        }
        if (search) {
            const pattern = { $regex: escapeRegex(search), $options: 'i' };
            conditions.push({ $or: [{ title: pattern }, { draftTitle: pattern }] });
        }
        const filter = { $and: conditions };

        const skip = (page - 1) * PAGE_SIZE;
        // Documents (not lean) so the model's canEditBy() can be used for every row
        const [articles, total, counts] = await Promise.all([
            Article.find(filter)
                .sort({ updatedAt: -1, _id: -1 })
                .skip(skip)
                .limit(PAGE_SIZE)
                .select('title draftTitle author category status revisionStatus editorNote updatedAt'),
            Article.countDocuments(filter),
            countByTab(user.id)
        ]);

        res.json({
            success: true,
            page,
            total,
            hasMore: skip + articles.length < total,
            counts,
            articles: articles.map((article) => toListItem(article, user))
        });
    } catch (err) {
        logger.error('Reporter articles list failed', { user: req.session.user.username, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load your articles' });
    }
};

/**
 * Create a new article (status "In preparation") - called by the first autosave of a new article.
 * POST /api/articles   body: { title, category, imageUrl, content }
 */
exports.createArticle = async (req, res) => {
    try {
        const { values, error } = validateInput(req.body || {});
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }
        if (!values.category) {
            return res.status(400).json({ success: false, message: 'Please choose a category.' });
        }

        const user = req.session.user;
        const article = new Article({
            author: user.id,
            status: STATUS.DRAFT,
            category: values.category,
            imageUrl: values.imageUrl || undefined
        });
        // A new article has no live version - the text goes to the working version
        article.applyEdit({ title: values.title, content: values.content }, user);
        await article.save();

        logger.info('Article created', { articleId: String(article._id), user: user.username });

        res.status(201).json({
            success: true,
            savedAt: article.updatedAt,
            article: { _id: article._id, status: article.status }
        });
    } catch (err) {
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: err.message });
        }
        logger.error('Article create failed', { user: req.session.user.username, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to create the article' });
    }
};

/**
 * Autosave of the reporter's working version.
 * applyEdit() (Article model) never touches the live title / content: the first edit of a
 * published article opens an update, and readers keep seeing the published version.
 * PUT /api/articles/:id   body: { title?, category?, imageUrl?, content? }
 */
exports.updateArticle = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        const user = req.session.user;
        const article = await Article.findById(id);
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }
        if (!isAuthor(article, user)) {
            logger.warn('Rejected article edit', { articleId: id, user: user.username, reason: 'not the author' });
            return res.status(403).json({ success: false, message: 'You can only edit your own articles' });
        }
        if (!article.canEditBy(user)) {
            return res.status(409).json({
                success: false,
                message: 'This article is awaiting editor approval and cannot be edited right now.'
            });
        }

        const { values, error } = validateInput(req.body || {});
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const isPublished = article.status === STATUS.PUBLISHED;
        if (isPublished) {
            // Only the title and content are versioned, so a published article's category and
            // image can't be changed by a reporter (the change would go public immediately)
            const categoryChanged = values.category !== undefined && values.category !== article.category;
            const imageChanged = values.imageUrl !== undefined && values.imageUrl !== (article.imageUrl || '');
            if (categoryChanged || imageChanged) {
                return res.status(400).json({
                    success: false,
                    message: "The category and image of a published article can't be changed."
                });
            }
        }

        article.applyEdit({ title: values.title, content: values.content }, user);

        if (!isPublished) {
            if (values.category !== undefined) article.category = values.category;
            if (values.imageUrl !== undefined) article.imageUrl = values.imageUrl || undefined;
        }

        await article.save();

        res.json({ success: true, savedAt: article.updatedAt });
    } catch (err) {
        if (err.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: err.message });
        }
        logger.error('Article autosave failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to save the article' });
    }
};
