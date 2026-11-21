import express from 'express';
import {
  getPublicPlan,
  getMySubscription,
  checkout,
  cancelSubscription,
} from '../controllers/subscriptionController.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

// Public: view plan offerings configured by admin
router.get('/plan', getPublicPlan);

// Protected: user billing operations
router.get('/my-subscription', protect, getMySubscription);
router.post('/checkout', protect, checkout);
router.post('/cancel', protect, cancelSubscription);

export default router;

