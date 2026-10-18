const mongoose = require('mongoose');
const Article = require('../models/Article');
const Comment = require('../models/Comment');
const logger = require('../utils/logger');
const escapeRegex = require('../utils/escapeRegex');

const MAX_CONTENT_LENGTH = 1000;
const MAX_NAME_LENGTH = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Only these fields are sent to the browser (deviceId / ipAddress stay private).
 */
function toPublicComment(comment) {
    return {
        _id: comment._id,
        articleId: comment.articleId,
        authorName: comment.authorName,
        content: comment.content,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
    };
}

/**
 * Validates the comment text from the request body.
 * Returns { text } on success or { error } with a user-facing message.
 */
function validateContent(content) {
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) {
        return { error: 'Comment cannot be empty.' };
    }
    if (text.length > MAX_CONTENT_LENGTH) {
        return { error: `Comment is too long (max ${MAX_CONTENT_LENGTH} characters).` };
    }
    return { text };
}

/**
 * API: List the comments of an article, newest first (paginated, optional search)
 * GET /api/articles/:id/comments?page=1&limit=20&search=
 */
exports.getComments = async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) {
            return res.status(400).json({ success: false, message: 'Invalid article id' });
        }

        // Guests can only read comments of published articles (same rule as the article page)
        const article = await Article.findById(articleId).select('status').lean();
        const isStaff = req.session.user && req.session.user.role !== 'guest';
        if (!article || (article.status !== 'published' && !isStaff)) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        const filter = { articleId };
        if (search) {
            filter.content = { $regex: escapeRegex(search), $options: 'i' };
        }

        const skip = (page - 1) * limit;
        const [total, comments] = await Promise.all([
            Comment.countDocuments(filter),
            Comment.find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        res.json({
            success: true,
            page,
            limit,
            total,
            hasMore: skip + comments.length < total,
            comments: comments.map(toPublicComment)
        });
    } catch (err) {
        logger.error('Comments list failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load comments' });
    }
};

/**
 * API: Add a comment to a published article.
 * POST /api/articles/:id/comments   body: { content, authorName? }
 * Runs after the commentRateLimiter middleware (which sets req.deviceId).
 */
exports.createComment = async (req, res) => {
    try {
        const articleId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(articleId)) {
            return res.status(400).json({ success: false, message: 'Invalid article id' });
        }

        const { content, authorName } = req.body || {};

        const { text, error } = validateContent(content);
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const name = typeof authorName === 'string' ? authorName.trim() : '';
        if (name.length > MAX_NAME_LENGTH) {
            return res.status(400).json({ success: false, message: `Name is too long (max ${MAX_NAME_LENGTH} characters).` });
        }

        const article = await Article.findById(articleId).select('status').lean();
        if (!article || article.status !== 'published') {
            return res.status(404).json({ success: false, message: 'Comments can only be added to published articles.' });
        }

        const comment = await Comment.create({
            articleId,
            content: text,
            authorName: name || (req.session.user ? req.session.user.username : 'Guest'),
            deviceId: req.deviceId,
            ipAddress: req.ip
        });

        logger.info('Comment created', { commentId: String(comment._id), articleId, deviceId: req.deviceId });

        res.status(201).json({ success: true, comment: toPublicComment(comment) });
    } catch (err) {
        logger.error('Comment create failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to post comment' });
    }
};

/**
 * API (editors only): Edit a comment's text (moderation)
 * PUT /api/comments/:id   body: { content }
 */
exports.updateComment = async (req, res) => {
    try {
        const commentId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(commentId)) {
            return res.status(400).json({ success: false, message: 'Invalid comment id' });
        }

        const { text, error } = validateContent((req.body || {}).content);
        if (error) {
            return res.status(400).json({ success: false, message: error });
        }

        const comment = await Comment.findByIdAndUpdate(
            commentId,
            { content: text },
            { returnDocument: 'after', runValidators: true }
        ).lean();

        if (!comment) {
            return res.status(404).json({ success: false, message: 'Comment not found' });
        }

        logger.info('Comment edited by editor', { commentId, editor: req.session.user.username });
        res.json({ success: true, comment: toPublicComment(comment) });
    } catch (err) {
        logger.error('Comment update failed', { commentId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to update comment' });
    }
};

/**
 * API (editors only): Delete a comment
 * DELETE /api/comments/:id
 */
exports.deleteComment = async (req, res) => {
    try {
        const commentId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(commentId)) {
            return res.status(400).json({ success: false, message: 'Invalid comment id' });
        }

        const comment = await Comment.findByIdAndDelete(commentId).lean();
        if (!comment) {
            return res.status(404).json({ success: false, message: 'Comment not found' });
        }

        logger.info('Comment deleted by editor', { commentId, articleId: String(comment.articleId), editor: req.session.user.username });
        res.json({ success: true });
    } catch (err) {
        logger.error('Comment delete failed', { commentId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to delete comment' });
    }
};
