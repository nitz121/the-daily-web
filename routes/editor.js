const express = require('express');
const router = express.Router();
const editorController = require('../controllers/editorController');
const {
    ensureAuthenticated,
    ensureEditor,
    ensureEditorApi,
    ensureStaffApi
} = require('../middleware/authMiddleware');

// Editor dashboard page (SSR shell, data is loaded with AJAX)
router.get('/editor-dashboard', ensureAuthenticated, ensureEditor, editorController.renderDashboard);

// Editor data API
router.get('/api/editor/articles', ensureEditorApi, editorController.listArticles);
router.get('/api/editor/articles/:id', ensureEditorApi, editorController.getArticle);
router.put('/api/editor/articles/:id', ensureEditorApi, editorController.updateArticle);

// Article lifecycle (status change is shared with reporters - the model checks who may do what)
router.patch('/api/articles/:id/status', ensureStaffApi, editorController.changeStatus);
router.delete('/api/articles/:id', ensureEditorApi, editorController.deleteArticle);

module.exports = router;
