import mongoose from 'mongoose';

const qualityRatingSchema = new mongoose.Schema({
  stars: {
    type: Number,
    min: 1,
    max: 5,
  },
  feedback: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
});

const callSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    caller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    callee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    durationSeconds: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'dropped', 'terminated'],
      default: 'active',
    },
    qualityRating: qualityRatingSchema,
  },
  {
    timestamps: true,
  }
);

export const Call = mongoose.model('Call', callSchema);

