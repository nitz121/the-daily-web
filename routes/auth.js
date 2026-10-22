const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Login page
router.get('/login', authController.getLogin);

// Login form submit
router.post('/login', authController.postLogin);

// Logout
router.get('/logout', authController.logout);

module.exports = router;
