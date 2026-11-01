const mongoose = require('mongoose');

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * SyntheticSession Schema
 * Dedicated test collection ('synthetic_sessions') for training & validating ML models
 * without polluting the primary user sessions collection.
 */
const syntheticSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    userPersona: {
      type: String,
      enum: ['morning_lark', 'night_owl', 'afternoon_focuser', 'weekend_warrior', 'inconsistent'],
      default: 'morning_lark',
    },
    taskId: {
      type: String,
    },
    taskPriority: {
      type: String,
      enum: ['Low', 'Medium', 'High'],
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
    },
    timeOfDay: {
      type: String, // HH:MM format e.g. "09:30"
      required: true,
      index: true,
    },
    timeOfDayBucket: {
      type: String, // "early_morning", "morning", "afternoon", "evening", "night", "late_night"
      index: true,
    },
    dayOfWeek: {
      type: String,
      enum: DAYS_OF_WEEK,
      required: true,
      index: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
    },
    actualDurationMinutes: {
      type: Number,
      required: true,
    },
    completed: {
      type: Boolean,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['completed', 'abandoned'],
      required: true,
    },
    abandonReason: {
      type: String,
      default: 'none',
    },
  },
  {
    timestamps: true,
    collection: 'synthetic_sessions', // explicitly isolated test collection
  }
);

syntheticSessionSchema.index({ userId: 1, startTime: -1 });
syntheticSessionSchema.index({ dayOfWeek: 1, timeOfDayBucket: 1 });

module.exports = mongoose.model('SyntheticSession', syntheticSessionSchema);
