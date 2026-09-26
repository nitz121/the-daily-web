const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

// SSR route for viewing an article by ID
router.get('/:id', articleController.getArticleById);

module.exports = router;
