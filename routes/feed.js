const express = require('express');
const router = express.Router();
const feedController = require('../controllers/feedController');

// Consumer Homepage (SSR View + AJAX Feed)
router.get('/', feedController.renderHomePage);

// AJAX Feed Endpoints
router.get('/api/articles', feedController.getArticles);
router.get('/api/categories', feedController.getCategories);
router.get('/api/weather', feedController.getWeather);

module.exports = router;
