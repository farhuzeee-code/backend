import { User } from '../models/User.js';
import { Call } from '../models/Call.js';
import { Settings } from '../models/Settings.js';
import { Invoice } from '../models/Invoice.js';
import { roomStore } from '../sockets/roomStore.js';

// Reference to terminateRoom injected from server setup
let terminateRoomFn = null;
export const setTerminateRoomFn = (fn) => {
  terminateRoomFn = fn;
};

/**
 * @desc    Get dashboard metrics & trends
 * @route   GET /api/admin/stats
 * @access  Admin / Superadmin
 */
export const getStats = async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalCalls = await Call.countDocuments();
    const activeCalls = roomStore.getAllActiveRooms();
    const activeCallsCount = activeCalls.length;

    // Total call duration in minutes
    const durationAgg = await Call.aggregate([
      {
        $group: {
          _id: null,
          totalDurationSeconds: { $sum: '$durationSeconds' },
        },
      },
    ]);
    const totalDurationSeconds = durationAgg[0]?.totalDurationSeconds || 0;
    const totalMinutes = Math.round(totalDurationSeconds / 60);

    // Signups over the past 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    const signupsAgg = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: fourteenDaysAgo },
          role: 'user',
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Build complete 14-day map with 0 counts for missing days
    const signupsMap = new Map(signupsAgg.map((item) => [item._id, item.count]));
    const signupsTrend = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(fourteenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      signupsTrend.push({
        date: dateStr,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: signupsMap.get(dateStr) || 0,
      });
    }

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalCalls,
        activeCallsCount,
        totalMinutes,
      },
      signupsTrend,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all registered users with search, filter, pagination
 * @route   GET /api/admin/users
 * @access  Admin / Superadmin
 */
export const getUsers = async (req, res, next) => {
  try {
    const { search, status, role, page = 1, limit = 10 } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    if (status && ['active', 'suspended'].includes(status)) {
      query.status = status;
    }

    if (role && ['user', 'admin', 'superadmin'].includes(role)) {
      query.role = role;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const totalUsers = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      totalUsers,
      page: Number(page),
      totalPages: Math.ceil(totalUsers / Number(limit)) || 1,
      users,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle or set user suspension status
 * @route   PATCH /api/admin/users/:id/suspend
 * @access  Admin / Superadmin
 */
export const suspendUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Super Administrator accounts cannot be suspended.',
      });
    }

    if (user.role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only Super Administrators can suspend admin accounts.',
      });
    }

    user.status = status || (user.status === 'active' ? 'suspended' : 'active');
    await user.save();

    res.json({
      success: true,
      message: `User ${user.name} is now ${user.status}`,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a user account
 * @route   DELETE /api/admin/users/:id
 * @access  Admin / Superadmin
 */
export const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Super Administrator accounts cannot be deleted.',
      });
    }

    if (user.role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only Super Administrators can delete admin accounts.',
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: `User ${user.name} was successfully deleted`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get paginated call logs with duration and ratings
 * @route   GET /api/admin/calls
 * @access  Admin / Superadmin
 */
export const getCallLogs = async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;

    const query = {};
    if (search) {
      query.roomId = { $regex: search, $options: 'i' };
    }
    if (status && ['active', 'completed', 'dropped', 'terminated'].includes(status)) {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const totalCalls = await Call.countDocuments(query);
    const calls = await Call.find(query)
      .populate('caller', 'name email avatar')
      .populate('callee', 'name email avatar')
      .populate('participants', 'name email avatar')
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      totalCalls,
      page: Number(page),
      totalPages: Math.ceil(totalCalls / Number(limit)) || 1,
      calls,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get currently active live calls from in-memory room store
 * @route   GET /api/admin/active-calls
 * @access  Admin / Superadmin
 */
export const getActiveCalls = async (req, res) => {
  const activeRooms = roomStore.getAllActiveRooms();
  res.json({
    success: true,
    count: activeRooms.length,
    activeCalls: activeRooms,
  });
};

/**
 * @desc    Force terminate an active call room
 * @route   POST /api/admin/active-calls/:roomId/terminate
 * @access  Admin / Superadmin
 */
export const terminateActiveCall = async (req, res) => {
  const { roomId } = req.params;

  if (terminateRoomFn) {
    const terminated = await terminateRoomFn(roomId, 'Terminated by Platform Administrator');
    if (terminated) {
      return res.json({
        success: true,
        message: `Room ${roomId} was successfully terminated`,
      });
    }
  }

  return res.status(404).json({
    success: false,
    message: `Room ${roomId} is not currently active`,
  });
};

/**
 * @desc    Get all admin accounts
 * @route   GET /api/admin/admins
 * @access  Superadmin only
 */
export const getAdmins = async (req, res, next) => {
  try {
    const admins = await User.find({
      role: { $in: ['admin', 'superadmin'] },
    })
      .select('-passwordHash')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      admins,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new regular admin account
 * @route   POST /api/admin/admins
 * @access  Superadmin only
 */
export const createAdmin = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Admin passwords must be at least 8 characters',
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    const passwordHash = await User.hashPassword(password);
    const newAdmin = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: 'admin',
      status: 'active',
      avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
    });

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      admin: {
        _id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role,
        status: newAdmin.status,
        createdAt: newAdmin.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a regular admin account
 * @route   DELETE /api/admin/admins/:id
 * @access  Superadmin only
 */
export const deleteAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const admin = await User.findById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin account not found' });
    }

    if (admin.role === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete a Super Administrator account',
      });
    }

    await User.findByIdAndDelete(id);

    res.json({
      success: true,
      message: `Admin account for ${admin.name} was removed`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get platform settings
 * @route   GET /api/admin/settings
 * @access  Superadmin only
 */
export const getPlatformSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update platform settings
 * @route   PATCH /api/admin/settings
 * @access  Superadmin only
 */
export const updatePlatformSettings = async (req, res, next) => {
  try {
    const { allowSignups, maxCallDurationMinutes } = req.body;
    const settings = await Settings.getSettings();

    if (allowSignups !== undefined) {
      settings.allowSignups = Boolean(allowSignups);
    }

    if (maxCallDurationMinutes !== undefined) {
      const minutes = Number(maxCallDurationMinutes);
      if (minutes < 5 || minutes > 720) {
        return res.status(400).json({
          success: false,
          message: 'Max call duration must be between 5 and 720 minutes',
        });
      }
      settings.maxCallDurationMinutes = minutes;
    }

    await settings.save();

    res.json({
      success: true,
      message: 'Platform settings updated successfully',
      settings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Subscription Plan & Metrics (MRR, Active Subscribers)
 * @route   GET /api/admin/subscriptions/stats
 * @access  Superadmin only
 */
export const getSubscriptionStats = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    const plan = settings.subscriptionPlan;

    const activeSubscribersCount = await User.countDocuments({
      'subscription.status': 'active',
    });

    const totalSubscribersEver = await User.countDocuments({
      'subscription.status': { $in: ['active', 'canceled'] },
    });

    // Calculate MRR
    const mrr = Math.round(activeSubscribersCount * (plan.priceMonthly || 0) * 100) / 100;

    // Total revenue from invoices
    const revenueAgg = await Invoice.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalRevenue = revenueAgg[0]?.total ? Math.round(revenueAgg[0].total * 100) / 100 : 0;

    res.json({
      success: true,
      plan,
      metrics: {
        activeSubscribersCount,
        totalSubscribersEver,
        mrr,
        totalRevenue,
        currency: plan.currency || 'USD',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update Subscription Plan details (price, currency, features, enabled)
 * @route   PATCH /api/admin/subscriptions/plan
 * @access  Superadmin only
 */
export const updateSubscriptionPlan = async (req, res, next) => {
  try {
    const {
      enabled,
      name,
      priceMonthly,
      currency,
      features,
      trialDays,
      requireSubscription,
    } = req.body;

    const settings = await Settings.getSettings();

    if (!settings.subscriptionPlan) {
      settings.subscriptionPlan = {};
    }

    if (enabled !== undefined) settings.subscriptionPlan.enabled = Boolean(enabled);
    if (name) settings.subscriptionPlan.name = String(name).trim();
    if (priceMonthly !== undefined) settings.subscriptionPlan.priceMonthly = Math.max(0, Number(priceMonthly));
    if (currency) settings.subscriptionPlan.currency = String(currency).trim().toUpperCase();
    if (features && Array.isArray(features)) {
      settings.subscriptionPlan.features = features.map((f) => String(f).trim()).filter(Boolean);
    }
    if (trialDays !== undefined) settings.subscriptionPlan.trialDays = Math.max(0, Number(trialDays));
    if (requireSubscription !== undefined) {
      settings.subscriptionPlan.requireSubscription = Boolean(requireSubscription);
    }

    await settings.save();

    res.json({
      success: true,
      message: 'Subscription plan configuration updated successfully',
      plan: settings.subscriptionPlan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all subscribed users
 * @route   GET /api/admin/subscriptions/subscribers
 * @access  Superadmin only
 */
export const getSubscribersList = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const query = {
      'subscription.status': { $in: ['active', 'canceled'] },
    };

    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(query);
    const subscribers = await User.find(query)
      .select('name email avatar subscription createdAt')
      .sort({ 'subscription.currentPeriodEnd': -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
      subscribers,
    });
  } catch (error) {
    next(error);
  }
};
