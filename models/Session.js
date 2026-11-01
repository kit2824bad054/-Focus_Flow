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
 * ============================================================================
 * FOCUSFLOW SESSION SCHEMA (UPDATED FOR SMART SESSION SUGGESTIONS / ML)
 * ============================================================================
 *
 * PREVIOUS (ORIGINAL) BASELINE SCHEMA:
 * ------------------------------------
 * const sessionSchema = new mongoose.Schema({
 *   user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 *   task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
 *   duration: { type: Number, default: 25 },
 * }, { timestamps: true });
 *
 * DEFICIENCIES IN PREVIOUS SCHEMA:
 * --------------------------------
 * 1. session start timestamp: Only had `createdAt` (db insert time, not actual timer start).
 * 2. day of week: Missing; required manual runtime computation on every query.
 * 3. task priority: Missing on session; required $lookup to Task collection.
 * 4. session duration: Ambiguous units; lacked validation and actual vs target tracking.
 * 5. completed or abandoned: Missing; only successful sessions were stored or no status recorded.
 *
 * NEW / UPDATED FIELDS ADDED BELOW:
 * ---------------------------------
 * - startTime (Date, required, indexed)
 * - endTime (Date)
 * - dayOfWeek (String enum: Monday-Sunday, auto-computed via pre-save hook)
 * - taskPriority (String enum: 'Low', 'Medium', 'High', 'None')
 * - durationMinutes (Number, standardized duration in minutes)
 * - actualDurationMinutes (Number, actual focus time if abandoned or finished early)
 * - completed (Boolean, required, indexed for fast ML target extraction)
 * - status (String enum: 'completed', 'abandoned', 'interrupted')
 * - abandonReason (String, optional qualitative context)
 * ============================================================================
 */

const sessionSchema = new mongoose.Schema(
  {
    // User association (required)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Session must belong to a user'],
      index: true,
    },

    // Task association (optional, session can be an unlinked focus block)
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      index: true,
    },

    // 1. Session start timestamp (exact timer initiation)
    startTime: {
      type: Date,
      required: [true, 'Session start timestamp is required'],
      default: Date.now,
      index: true,
    },

    // Session completion/end timestamp
    endTime: {
      type: Date,
    },

    // 2. Day of week (e.g., 'Monday', 'Tuesday')
    dayOfWeek: {
      type: String,
      enum: DAYS_OF_WEEK,
      index: true,
    },

    // 3. Task priority (denormalized from Task to prevent stale joins and support standalone sessions)
    taskPriority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'None'],
      default: 'Medium',
      index: true,
    },

    // 4. Session duration (target length in minutes, default Pomodoro is 25)
    durationMinutes: {
      type: Number,
      required: [true, 'Session duration in minutes is required'],
      min: [1, 'Duration must be at least 1 minute'],
      default: 25,
    },

    // Actual focus time completed (useful for early abandonment e.g., stopped at 12 mins)
    actualDurationMinutes: {
      type: Number,
      min: 0,
      default: 25,
    },

    // 5. Completed vs Abandoned status
    completed: {
      type: Boolean,
      required: [true, 'Completed status flag is required'],
      default: true,
      index: true,
    },

    // Explicit status categorization
    status: {
      type: String,
      enum: ['completed', 'abandoned', 'interrupted'],
      default: 'completed',
      index: true,
    },

    // Context reason for abandonment (valuable for ML error analysis)
    abandonReason: {
      type: String,
      enum: ['distraction', 'fatigue', 'interruption', 'timer_cancelled', 'manual_stop', 'none'],
      default: 'none',
    },

    // Legacy field alias support (preserves compatibility with older code reading session.duration)
    duration: {
      type: Number,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: formatted time of day string (e.g. "14:30")
sessionSchema.virtual('timeOfDayFormatted').get(function () {
  if (!this.startTime) return '';
  const d = new Date(this.startTime);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
});

// Virtual: time of day bucket (e.g. "morning", "afternoon", "evening", "night")
sessionSchema.virtual('timeOfDayBucket').get(function () {
  if (!this.startTime) return 'unknown';
  const hour = new Date(this.startTime).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
});

// Pre-save hook: automatically compute dayOfWeek and sync duration fields if not provided
sessionSchema.pre('save', function (next) {
  // Ensure startTime exists
  if (!this.startTime) {
    this.startTime = this.createdAt || new Date();
  }

  // Derive dayOfWeek from startTime if missing
  if (!this.dayOfWeek && this.startTime) {
    const dayIndex = new Date(this.startTime).getDay();
    this.dayOfWeek = DAYS_OF_WEEK[dayIndex];
  }

  // Sync legacy duration field with durationMinutes
  if (this.durationMinutes && !this.duration) {
    this.duration = this.durationMinutes;
  } else if (this.duration && !this.durationMinutes) {
    this.durationMinutes = this.duration;
  }

  // Sync completed boolean with status
  if (this.status === 'abandoned' || this.status === 'interrupted') {
    this.completed = false;
  } else if (this.completed === false && this.status === 'completed') {
    this.status = 'abandoned';
  }

  // Default actualDurationMinutes for completed sessions
  if (this.completed && (!this.actualDurationMinutes || this.actualDurationMinutes === 0)) {
    this.actualDurationMinutes = this.durationMinutes;
  }

  next();
});

// Compound index for high-performance ML export queries per user
sessionSchema.index({ user: 1, startTime: -1 });
sessionSchema.index({ user: 1, completed: 1, dayOfWeek: 1 });

module.exports = mongoose.model('Session', sessionSchema);
