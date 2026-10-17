const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { ensureEditorApi } = require('../middleware/authMiddleware');

// Impact Analytics API (editors only)
router.use(ensureEditorApi);

router.get('/top', analyticsController.getTopArticles);
router.get('/article/:id', analyticsController.getArticleAnalytics);
router.delete('/article/:id', analyticsController.resetArticleStats);

module.exports = router;
