const crypto = require('crypto');
const Comment = require('../models/Comment');
const logger = require('../utils/logger');

const WINDOW_MS = 60 * 1000;  // 1 minute
const MAX_COMMENTS = 3;       // max comments per window

/**
 * Comment rate limiter: max 3 comments per minute from the same device.
 *
 * A "device" is identified by:
 *  - deviceId: a random id stored in the visitor's session (cookie). The session
 *    lives in MongoDB, so the id survives a server restart.
 *  - IP address: blocks the same machine even if it opens a new/incognito browser.
 * A request is blocked if EITHER of them already posted 3 comments in the last minute.
 *
 * The count is read from the comments collection itself (indexed query),
 * so the limit is shared by all server instances and survives restarts.
 */
module.exports = async (req, res, next) => {
    try {
        if (!req.session.deviceId) {
            req.session.deviceId = crypto.randomUUID();
        }
        const deviceId = req.session.deviceId;
        const ipAddress = req.ip;

        const windowStart = new Date(Date.now() - WINDOW_MS);
        const recentComments = await Comment.find({
            createdAt: { $gte: windowStart },
            $or: [{ deviceId }, { ipAddress }]
        })
            .sort({ createdAt: 1 })
            .limit(MAX_COMMENTS)
            .select('createdAt')
            .lean();

        if (recentComments.length >= MAX_COMMENTS) {
            // The oldest comment in the window decides when a new one is allowed
            const oldest = recentComments[0].createdAt.getTime();
            const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000));

            logger.warn('Comment blocked by rate limit', { deviceId, ipAddress, articleId: req.params.id, retryAfter });

            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                success: false,
                message: `You can post up to ${MAX_COMMENTS} comments per minute. Please try again in ${retryAfter} seconds.`,
                retryAfter
            });
        }

        // Pass the identifiers on to the controller that saves the comment
        req.deviceId = deviceId;
        next();
    } catch (err) {
        logger.error('Comment rate limiter failed', { error: err.message });
        res.status(500).json({ success: false, message: 'Could not verify comment rate limit' });
    }
};
