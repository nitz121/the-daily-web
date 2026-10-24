const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

// Article page, fully rendered on the server (SEO)
router.get('/:id', articleController.getArticleById);

module.exports = router;
