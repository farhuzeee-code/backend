import { Call } from '../models/Call.js';

/**
 * @desc    Get logged-in user's call history
 * @route   GET /api/calls/history
 * @access  Private
 */
export const getCallHistory = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const calls = await Call.find({
      $or: [
        { participants: userId },
        { caller: userId },
        { callee: userId },
      ],
    })
      .populate('caller', 'name email avatar')
      .populate('callee', 'name email avatar')
      .populate('participants', 'name email avatar')
      .sort({ startTime: -1 })
      .limit(50);

    // Format calls to easily show peer name and duration
    const formattedCalls = calls.map((call) => {
      // Find the other participant
      let peer = null;
      if (call.caller && call.caller._id.toString() !== userId.toString()) {
        peer = call.caller;
      } else if (call.callee && call.callee._id.toString() !== userId.toString()) {
        peer = call.callee;
      } else {
        peer = call.participants?.find((p) => p._id.toString() !== userId.toString()) || null;
      }

      return {
        _id: call._id,
        roomId: call.roomId,
        peer: peer
          ? { _id: peer._id, name: peer.name, email: peer.email, avatar: peer.avatar }
          : { name: 'Unknown Peer', avatar: '' },
        startTime: call.startTime,
        endTime: call.endTime,
        durationSeconds: call.durationSeconds || 0,
        status: call.status,
        qualityRating: call.qualityRating || null,
      };
    });

    res.json({
      success: true,
      count: formattedCalls.length,
      calls: formattedCalls,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Submit call quality rating
 * @route   POST /api/calls/:id/rate
 * @access  Private
 */
export const rateCall = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stars, feedback } = req.body;

    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5 stars',
      });
    }

    const call = await Call.findById(id);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: 'Call record not found',
      });
    }

    // Check if user was participant
    const isParticipant =
      call.participants.some((p) => p.toString() === req.user._id.toString()) ||
      call.caller?.toString() === req.user._id.toString() ||
      call.callee?.toString() === req.user._id.toString();

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You can only rate calls you participated in',
      });
    }

    call.qualityRating = {
      stars: Number(stars),
      feedback: feedback ? String(feedback).trim() : '',
      submittedAt: new Date(),
    };

    await call.save();

    res.json({
      success: true,
      message: 'Thank you for your rating!',
      qualityRating: call.qualityRating,
    });
  } catch (error) {
    next(error);
  }
};

