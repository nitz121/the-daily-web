const express = require('express');
const router = express.Router();
const reporterController = require('../controllers/reporterController');
const { requireRole } = require('../middleware/authMiddleware');

const reporterOnly = requireRole('reporter');

// Reporter area pages (SSR)
router.get('/reporter-dashboard', reporterOnly, reporterController.renderDashboard);
router.get('/reporter/articles/new', reporterOnly, reporterController.renderNewArticle);
router.get('/reporter/articles/:id/edit', reporterOnly, reporterController.renderEditArticle);

// Reporter API (AJAX)
router.get('/api/reporter/articles', reporterOnly, reporterController.getMyArticles);
router.post('/api/articles', reporterOnly, reporterController.createArticle);
router.put('/api/articles/:id', reporterOnly, reporterController.updateArticle);
// Submitting for approval: PATCH /api/articles/:id/status (shared with the editor - routes/editor.js)

module.exports = router;
