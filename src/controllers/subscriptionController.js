import { Settings } from '../models/Settings.js';
import { User } from '../models/User.js';
import { Invoice } from '../models/Invoice.js';

/**
 * @desc    Get currently active subscription plan details (configured by admin)
 * @route   GET /api/subscriptions/plan
 * @access  Public
 */
export const getPublicPlan = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    const plan = settings.subscriptionPlan || {
      enabled: true,
      name: 'AQELEO Pro',
      priceMonthly: 9.99,
      currency: 'USD',
      features: [
        'Unlimited call duration (no 60-min cap)',
        'HD 1080p WebRTC audio & video bitrate',
        'Screen sharing & window capture',
        'Priority Google STUN routing',
        'Custom meeting codes & vanity links',
        'Dedicated 24/7 priority support',
      ],
      trialDays: 7,
      requireSubscription: false,
    };

    res.json({
      success: true,
      plan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get logged in user's subscription status and invoice history
 * @route   GET /api/subscriptions/my-subscription
 * @access  Private
 */
export const getMySubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const invoices = await Invoice.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);

    const settings = await Settings.getSettings();

    res.json({
      success: true,
      subscription: user.subscription || { plan: 'Free', status: 'free' },
      invoices,
      availablePlan: settings.subscriptionPlan,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process subscription checkout (Simulated Free-Tier Instant or Live)
 * @route   POST /api/subscriptions/checkout
 * @access  Private
 */
export const checkout = async (req, res, next) => {
  try {
    const { paymentMethod = 'Credit Card (Mock Checkout)' } = req.body;
    const settings = await Settings.getSettings();
    const plan = settings.subscriptionPlan;

    if (!plan.enabled) {
      return res.status(400).json({
        success: false,
        message: 'Subscriptions are currently disabled by platform administrators.',
      });
    }

    const user = await User.findById(req.user._id);

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Generate unique invoice receipt number
    const randPart = Math.floor(1000 + Math.random() * 9000);
    const invoiceNumber = `INV-${now.getFullYear()}-${randPart}`;

    // Record invoice receipt in DB
    const invoice = await Invoice.create({
      userId: user._id,
      invoiceNumber,
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: plan.currency,
      status: 'paid',
      paymentMethod,
      periodStart: now,
      periodEnd,
    });

    // Update user subscription state
    user.subscription = {
      plan: plan.name,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      paymentMethod,
    };

    await user.save();

    res.json({
      success: true,
      message: `Congratulations! You have upgraded to ${plan.name}`,
      subscription: user.subscription,
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel subscription renewal at end of current period
 * @route   POST /api/subscriptions/cancel
 * @access  Private
 */
export const cancelSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user.subscription || user.subscription.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'You do not have an active subscription to cancel.',
      });
    }

    user.subscription.cancelAtPeriodEnd = true;
    await user.save();

    res.json({
      success: true,
      message: 'Auto-renewal has been cancelled. You retain Pro access until the end of your billing cycle.',
      subscription: user.subscription,
    });
  } catch (error) {
    next(error);
  }
};

