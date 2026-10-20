const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const commentRateLimiter = require('../middleware/commentRateLimiter');
const { ensureEditorApi } = require('../middleware/authMiddleware');

// Public: read an article's comments / post a new one (max 3 per minute per device)
router.get('/api/articles/:id/comments', commentController.getComments);
router.post('/api/articles/:id/comments', commentRateLimiter, commentController.createComment);

// Editors only: comment moderation
router.put('/api/comments/:id', ensureEditorApi, commentController.updateComment);
router.delete('/api/comments/:id', ensureEditorApi, commentController.deleteComment);

module.exports = router;
