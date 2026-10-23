const express = require('express');
const userController = require('../controllers/userController');
const { ensureEditorApi } = require('../middleware/authMiddleware');

const router = express.Router();

// User administration is intentionally editor-only. Password hashes are never selected or returned.
router.use(ensureEditorApi);
router.get('/api/users', userController.listUsers);
router.post('/api/users', userController.createUser);
router.put('/api/users/:id', userController.updateUser);
router.delete('/api/users/:id', userController.deleteUser);

module.exports = router;
