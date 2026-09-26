const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Render Login Page
router.get('/login', authController.getLogin);

// Handle Login Form
router.post('/login', authController.postLogin);

// Handle Logout
router.get('/logout', authController.logout);

module.exports = router;
