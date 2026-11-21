import mongoose from 'mongoose';

const subscriptionPlanSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: true,
  },
  name: {
    type: String,
    default: 'AQELEO Pro',
    trim: true,
  },
  priceMonthly: {
    type: Number,
    default: 9.99,
    min: [0, 'Price cannot be negative'],
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
  },
  features: {
    type: [String],
    default: [
      'Unlimited call duration (no 60-min cap)',
      'HD 1080p WebRTC audio & video bitrate',
      'Screen sharing & window capture',
      'Priority Google STUN routing',
      'Custom meeting codes & vanity links',
      'Dedicated 24/7 priority support',
    ],
  },
  trialDays: {
    type: Number,
    default: 7,
    min: 0,
  },
  requireSubscription: {
    type: Boolean,
    default: false,
  },
});

const settingsSchema = new mongoose.Schema(
  {
    allowSignups: {
      type: Boolean,
      default: true,
    },
    maxCallDurationMinutes: {
      type: Number,
      default: 60,
      min: [5, 'Call duration limit must be at least 5 minutes'],
      max: [720, 'Call duration limit cannot exceed 12 hours'],
    },
    genderFilterRequiresPro: {
      type: Boolean,
      default: false,
    },
    subscriptionPlan: {
      type: subscriptionPlanSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      allowSignups: true,
      maxCallDurationMinutes: 60,
      subscriptionPlan: {
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
      },
    });
  }
  return settings;
};

export const Settings = mongoose.model('Settings', settingsSchema);
