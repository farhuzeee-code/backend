import express from 'express';
import { signup, login, getMe, updateProfile, guestLogin } from '../controllers/authController.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/guest', guestLogin);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);

export default router;


