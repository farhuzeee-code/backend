import express from 'express';
import { getCallHistory, rateCall } from '../controllers/callController.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

router.use(protect);

router.get('/history', getCallHistory);
router.post('/:id/rate', rateCall);

export default router;

