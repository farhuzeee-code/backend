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

/**
 * @route   POST /api/lyora/reset
 * @desc    Reset Lyora busy state
 */
router.all('/reset', (req, res) => {
  lyoraState.isBusy = false;
  lyoraState.activeCallerSocketId = null;
  lyoraState.activeCallerUser = null;
  lyoraState.callStartTime = null;
  lyoraState.conversationHistory = [];
  res.json({ success: true, message: 'Lyora state successfully reset.' });
});

export default router;

