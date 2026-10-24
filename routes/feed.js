const express = require('express');
const router = express.Router();
const feedController = require('../controllers/feedController');

// Home page (server-rendered shell, the feed itself is loaded with AJAX)
router.get('/', feedController.renderHomePage);

// Feed API (AJAX)
router.get('/api/articles', feedController.getArticles);
router.get('/api/categories', feedController.getCategories);
router.get('/api/weather', feedController.getWeather);

module.exports = router;
