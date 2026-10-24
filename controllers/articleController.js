const mongoose = require('mongoose');
const Article = require('../models/Article');
const { recordView } = require('../services/analyticsService');
const logger = require('../utils/logger');

// Plain-text summary for the <meta name="description"> tag (SEO)
function toMetaDescription(html) {
    const text = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 160 ? text.substring(0, 157) + '...' : text;
}

exports.getArticleById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).send('Article not found');
        }

        const article = await Article.findById(req.params.id).populate('author', 'username');

        if (!article) {
            return res.status(404).send('Article not found');
        }

        // Public users can only see published articles.
        // Reporters and editors can preview any status for review purposes.
        const isStaff = req.session.user && req.session.user.role !== 'guest';
        if (article.status !== 'published' && !isStaff) {
            return res.status(404).send('Article not found or not published');
        }

        // Staff see the working version of an unpublished article or of an update in progress.
        // Everyone else always sees the last approved version (title / content).
        const hasWorkingVersion = article.status !== 'published' || Boolean(article.revisionStatus);
        const showDraft = Boolean(isStaff && hasWorkingVersion && article.draftTitle);

        // Every visit to the public version is counted for the statistics (a staff draft preview is not).
        // The write is not awaited, so it never delays the page.
        if (article.status === 'published' && !showDraft) {
            article.viewsCount += 1; // the page shows the count including this visit
            recordView(article._id).catch(err => {
                logger.error('Failed to record a view', { articleId: String(article._id), error: err.message });
            });
        }

        // Remember viewed articles in the session (for the feed's read / unread filter)
        if (!req.session.viewedArticles) {
            req.session.viewedArticles = [];
        }
        const articleIdStr = article._id.toString();
        if (!req.session.viewedArticles.includes(articleIdStr)) {
            req.session.viewedArticles.push(articleIdStr);
        }

        res.render('article', {
            article,
            showDraft,
            metaDescription: toMetaDescription(showDraft ? article.draftContent : article.content)
        });
    } catch (error) {
        logger.error('Article page failed', { articleId: req.params.id, error: error.message });
        res.status(500).send('Server Error');
    }
};
