import express from 'express';
import { lyoraState } from '../sockets/lyoraHandler.js';

const router = express.Router();

/**
 * @route   GET /api/lyora/status
 * @desc    Get real-time availability of Lyora AI Companion
 * @access  Public
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    isBusy: Boolean(lyoraState.isBusy),
    name: 'Lyora',
    age: 22,
    personality: 'Flirty, Emotionally Supportive, Human-like',
    callDuration: lyoraState.callStartTime
      ? Math.floor((Date.now() - lyoraState.callStartTime) / 1000)
      : 0,
  });
});

export default router;

