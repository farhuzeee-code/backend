import express from 'express';
import {
  getStats,
  getUsers,
  suspendUser,
  deleteUser,
  getCallLogs,
  getActiveCalls,
  terminateActiveCall,
  getAdmins,
  createAdmin,
  deleteAdmin,
  getPlatformSettings,
  updatePlatformSettings,
  getSubscriptionStats,
  updateSubscriptionPlan,
  getSubscribersList,
} from '../controllers/adminController.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Regular Admin & Super Admin accessible endpoints
router.use(authorize('admin', 'superadmin'));

router.get('/stats', getStats);
router.get('/users', getUsers);
router.patch('/users/:id/suspend', suspendUser);
router.delete('/users/:id', deleteUser);
router.get('/calls', getCallLogs);
router.get('/active-calls', getActiveCalls);
router.post('/active-calls/:roomId/terminate', terminateActiveCall);

// Super Admin ONLY endpoints
router.get('/admins', authorize('superadmin'), getAdmins);
router.post('/admins', authorize('superadmin'), createAdmin);
router.delete('/admins/:id', authorize('superadmin'), deleteAdmin);

router.get('/settings', authorize('superadmin'), getPlatformSettings);
router.patch('/settings', authorize('superadmin'), updatePlatformSettings);

// Subscription & Billing endpoints (Super Admin only)
router.get('/subscriptions/stats', authorize('superadmin'), getSubscriptionStats);
router.patch('/subscriptions/plan', authorize('superadmin'), updateSubscriptionPlan);
router.get('/subscriptions/subscribers', authorize('superadmin'), getSubscribersList);

export default router;
