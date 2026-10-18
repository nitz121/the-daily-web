const mongoose = require('mongoose');
const Article = require('../models/Article');
const analytics = require('../services/analyticsService');
const logger = require('../utils/logger');

/**
 * Impact Analytics API (Student 4) - editors only
 */

// ── GET /api/analytics/article/:id?range=24h|7d|30d|all  or  ?from=&to= ────
exports.getArticleAnalytics = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        const article = await Article.findById(req.params.id)
            .select('title draftTitle status revisionStatus viewsCount publishedAt createdAt publishHistory')
            .populate('publishHistory.editor', 'username')
            .lean();
        if (!article) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        let window;
        try {
            window = analytics.resolveWindow(article, req.query);
        } catch (err) {
            if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
            throw err;
        }

        const timeline = await analytics.getArticleTimeline(article, window);

        res.json({
            success: true,
            article: {
                _id: article._id,
                title: article.title || article.draftTitle || '(untitled)',
                status: article.status,
                revisionStatus: article.revisionStatus || null,
                publishedAt: article.publishedAt || null
            },
            ...timeline
        });
    } catch (err) {
        logger.error('Analytics request failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load analytics' });
    }
};

// ── GET /api/analytics/top?range=7d&limit=10 ────────────────────────────────
exports.getTopArticles = async (req, res) => {
    try {
        const range = req.query.range || '7d';
        if (!analytics.RANGE_KEYS.includes(range)) {
            return res.status(400).json({ success: false, message: 'Unknown range' });
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 20);

        const articles = await analytics.getTopArticles(range, limit);
        res.json({ success: true, range, articles });
    } catch (err) {
        logger.error('Top articles request failed', { error: err.message });
        res.status(500).json({ success: false, message: 'Failed to load the most viewed articles' });
    }
};

// ── DELETE /api/analytics/article/:id  (reset the article's statistics) ────
exports.resetArticleStats = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        const exists = await Article.exists({ _id: req.params.id });
        if (!exists) {
            return res.status(404).json({ success: false, message: 'Article not found' });
        }

        const removed = await analytics.resetArticleStats(req.params.id);
        logger.info('Article statistics reset', {
            articleId: req.params.id, editor: req.session.user.username, removedBuckets: removed
        });

        res.json({ success: true, message: 'Statistics were reset.' });
    } catch (err) {
        logger.error('Statistics reset failed', { articleId: req.params.id, error: err.message });
        res.status(500).json({ success: false, message: 'Failed to reset the statistics' });
    }
};
