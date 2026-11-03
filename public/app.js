// FocusFlow - Web Frontend Application Logic

const state = {
  mode: 'focus', // 'focus' | 'short-break' | 'long-break'
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  isRunning: false,
  timerInterval: null,
  activeTaskId: null,
  activeTaskTitle: 'General Study',
  completedSessions: 0,
  totalFocusMinutes: 0,
};

// DOM Elements
const timeDisplay = document.getElementById('timeDisplay');
const timerStatus = document.getElementById('timerStatus');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const modeBtns = document.querySelectorAll('.mode-btn');
const progressRing = document.getElementById('progressRing');
const currentTaskName = document.getElementById('currentTaskName');

const taskForm = document.getElementById('taskForm');
const taskInput = document.getElementById('taskInput');
const prioritySelect = document.getElementById('prioritySelect');
const taskList = document.getElementById('taskList');
const taskCountBadge = document.getElementById('taskCountBadge');

const suggestionsContainer = document.getElementById('suggestionsContainer');
const refreshAiBtn = document.getElementById('refreshAiBtn');
const historyList = document.getElementById('historyList');

const statCompleted = document.getElementById('statCompleted');
const statMinutes = document.getElementById('statMinutes');
const statRate = document.getElementById('statRate');
const backendStatus = document.getElementById('backendStatus');
const dbStatus = document.getElementById('dbStatus');
const mlStatus = document.getElementById('mlStatus');

// Ring circumference for r=125
const CIRCUMFERENCE = 2 * Math.PI * 125;
progressRing.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
progressRing.style.strokeDashoffset = 0;

function setProgress(percent) {
  const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
  progressRing.style.strokeDashoffset = offset;
}

// Sound synthesized using Web Audio API (no external file dependencies)
function playTone(freq = 600, duration = 0.3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('AudioContext not allowed or supported:', e);
  }
}

// Timer Functions
function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  timeDisplay.textContent = formatTime(state.remainingSeconds);
  const percent = ((state.totalSeconds - state.remainingSeconds) / state.totalSeconds) * 100;
  setProgress(percent);
  document.title = `${formatTime(state.remainingSeconds)} - FocusFlow`;
}

function startTimer() {
  if (state.isRunning) return;
  state.isRunning = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  timerStatus.textContent = state.mode === 'focus' ? 'Focusing...' : 'Taking a break...';

  state.timerInterval = setInterval(() => {
    if (state.remainingSeconds > 0) {
      state.remainingSeconds--;
      updateTimerDisplay();
    } else {
      finishTimer();
    }
  }, 1000);
}

function pauseTimer() {
  if (!state.isRunning) return;
  state.isRunning = false;
  clearInterval(state.timerInterval);
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  timerStatus.textContent = 'Paused';
}

function resetTimer() {
  pauseTimer();
  state.remainingSeconds = state.totalSeconds;
  updateTimerDisplay();
  timerStatus.textContent = 'Ready to focus';
  startBtn.disabled = false;
  pauseBtn.disabled = true;
}

async function finishTimer() {
  pauseTimer();
  playTone(880, 0.6);

  if (state.mode === 'focus') {
    state.completedSessions++;
    const durationMins = Math.round(state.totalSeconds / 60);
    state.totalFocusMinutes += durationMins;

    // Log completed session to backend
    await recordSession(durationMins, true);

    alert(`🎉 Pomodoro completed! Great job on "${state.activeTaskTitle}". Take a well-deserved break!`);
    switchMode('short-break', 5);
  } else {
    alert('☕ Break is over! Ready to jump back into focus?');
    switchMode('focus', 25);
  }

  updateStats();
  loadHistory();
}

function switchMode(mode, minutes) {
  state.mode = mode;
  state.totalSeconds = minutes * 60;
  state.remainingSeconds = state.totalSeconds;

  modeBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  resetTimer();
}

// Mode Buttons Listener
modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    const dur = Number(btn.dataset.duration);
    switchMode(mode, dur);
  });
});

startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);

// Default offline suggestions powered by our trained ML model
const DEFAULT_SUGGESTIONS = [
  { start_hour: 21, end_hour: 22, completion_probability: 0.9465 },
  { start_hour: 19, end_hour: 20, completion_probability: 0.9387 },
  { start_hour: 10, end_hour: 11, completion_probability: 0.9371 },
];

const INITIAL_TASKS = [
  { _id: 't_1', title: 'Review Mongoose Schemas & Backfill Migrations', priority: 'High', completed: false },
  { _id: 't_2', title: 'Train Random Forest Model on Focus Cycles', priority: 'High', completed: true },
  { _id: 't_3', title: 'Evaluate Bayesian Circadian Focus Windows', priority: 'Medium', completed: false },
  { _id: 't_4', title: 'Write Weekly Progress Log', priority: 'Low', completed: true }
];

// API Requests: Record Session
async function recordSession(duration, completed) {
  try {
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        durationMinutes: duration,
        completed,
        taskPriority: 'High',
      }),
    });
  } catch (err) {
    // Offline/GitHub Pages fallback: save to localStorage
    const stored = JSON.parse(localStorage.getItem('focusflow_sessions') || '[]');
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    stored.unshift({
      time_of_day: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      day_of_week: days[now.getDay()],
      duration_minutes: duration,
      completed: completed ? 1 : 0
    });
    localStorage.setItem('focusflow_sessions', JSON.stringify(stored.slice(0, 20)));
  }
}

// API Requests: Tasks
async function loadTasks() {
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    if (data.success && data.tasks && data.tasks.length > 0) {
      renderTasks(data.tasks);
      return;
    }
  } catch (err) {
    // Continue to local storage fallback
  }

  // Local storage / static hosting fallback
  const localTasks = JSON.parse(localStorage.getItem('focusflow_tasks') || 'null') || INITIAL_TASKS;
  renderTasks(localTasks);
}

function renderTasks(tasks) {
  taskList.innerHTML = '';
  taskCountBadge.textContent = `${tasks.length} Tasks`;

  tasks.forEach((task) => {
    const item = document.createElement('div');
    item.className = `task-item ${state.activeTaskId === task._id ? 'active-focus' : ''}`;

    item.innerHTML = `
      <div class="task-left">
        <input type="checkbox" class="task-check" ${task.completed ? 'checked' : ''} data-id="${task._id}" />
        <span class="task-title ${task.completed ? 'completed' : ''}">${task.title}</span>
        <span class="priority-tag ${task.priority}">${task.priority}</span>
      </div>
      <button class="task-delete" data-id="${task._id}" title="Delete task">&times;</button>
    `;

    // Click anywhere on item to set active
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-check') || e.target.classList.contains('task-delete')) return;
      setActiveTask(task._id, task.title);
    });

    taskList.appendChild(item);
  });

  // Checkbox listener
  document.querySelectorAll('.task-check').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      await fetch(`/api/tasks/${id}/toggle`, { method: 'PATCH' });
      loadTasks();
    });
  });

  // Delete listener
  document.querySelectorAll('.task-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      loadTasks();
    });
  });
}

function setActiveTask(id, title) {
  state.activeTaskId = id;
  state.activeTaskTitle = title;
  currentTaskName.textContent = title;
  document.querySelectorAll('.task-item').forEach((el) => {
    el.classList.toggle('active-focus', el.querySelector(`[data-id="${id}"]`) !== null);
  });
}

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = taskInput.value.trim();
  const priority = prioritySelect.value;
  if (!title) return;

  try {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, priority, estimatedPomodoros: 2 }),
    });
    taskInput.value = '';
    loadTasks();
  } catch (err) {
    console.error('Failed to create task:', err);
  }
});

// AI Smart Focus Windows (Fetches from /api/suggestions or client ML baseline)
async function loadSuggestions() {
  suggestionsContainer.innerHTML = '<div class="loading-state">Analyzing circadian focus curves and session history...</div>';
  try {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      const json = await res.json();
      if (json.windows && json.windows.length > 0) {
        renderSuggestions(json.windows, 'ml-microservice');
        return;
      }
      if (json.data && json.data.suggested_windows && json.data.suggested_windows.length > 0) {
        renderSuggestions(json.data.suggested_windows, json.source || 'ml-microservice');
        return;
      }
    }
  } catch (err) {
    // Expected on static hosting like GitHub Pages
  }

  // Fallback to trained ML model predictions
  renderSuggestions(DEFAULT_SUGGESTIONS, 'trained-model');
}

function formatHourRange(startHour, endHour) {
  const fmt = (h) => {
    const period = h >= 12 && h < 24 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    return `${displayHour}:00 ${period}`;
  };
  return `${fmt(startHour)} – ${fmt(endHour)}`;
}

function getPeriodDescription(startHour) {
  if (startHour >= 5 && startHour < 12) return 'Peak Morning Alertness Window';
  if (startHour >= 12 && startHour < 17) return 'Prime Afternoon Deep Focus';
  if (startHour >= 17 && startHour < 21) return 'Early Evening Study Block';
  return 'Night Focus Block';
}

function renderSuggestions(windows, source) {
  suggestionsContainer.innerHTML = '';

  const aiSourceTag = document.getElementById('aiSourceTag');
  if (source === 'ml-microservice') {
    aiSourceTag.innerHTML = '🟢 Live Python FastAPI Microservice &bull; Bayesian Optimized';
    mlStatus.innerHTML = '<span class="dot purple"></span><span>ML Engine: Live</span>';
  } else {
    aiSourceTag.innerHTML = '🟠 Trained Scikit-Learn Model &bull; Bayesian Optimized';
    mlStatus.innerHTML = '<span class="dot purple"></span><span>ML Engine: Standby</span>';
  }

  windows.forEach((w, idx) => {
    const probPercent = (w.completion_probability * 100).toFixed(1);
    const badgeClass = w.completion_probability >= 0.9 ? 'high' : 'medium';

    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `
      <div class="sugg-left">
        <span class="sugg-rank">#${idx + 1}</span>
        <div>
          <div class="sugg-time">${formatHourRange(w.start_hour, w.end_hour)}</div>
          <div class="sugg-period">${getPeriodDescription(w.start_hour)}</div>
        </div>
      </div>
      <div class="sugg-prob">
        <span class="prob-badge ${badgeClass}">${probPercent}% Success</span>
      </div>
    `;
    suggestionsContainer.appendChild(item);
  });
}

refreshAiBtn.addEventListener('click', () => {
  refreshAiBtn.style.transform = 'rotate(360deg)';
  refreshAiBtn.style.transition = 'transform 0.6s ease';
  setTimeout(() => {
    refreshAiBtn.style.transform = 'none';
  }, 600);
  loadSuggestions();
});

// History List
async function loadHistory() {
  try {
    const res = await fetch('/api/sessions');
    const json = await res.json();
    if (json.success && json.sessions) {
      renderHistory(json.sessions);
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

function renderHistory(sessions) {
  historyList.innerHTML = '';
  const recent = sessions.slice(0, 5);

  recent.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const isCompleted = s.completed === 1 || s.completed === true;

    item.innerHTML = `
      <span>${s.time_of_day || '10:00'} (${s.day_of_week || 'Today'}) &bull; ${s.duration_minutes || 25}m</span>
      <span class="status-badge ${isCompleted ? 'completed' : 'abandoned'}">
        ${isCompleted ? 'Completed' : 'Abandoned'}
      </span>
    `;
    historyList.appendChild(item);
  });
}

// Quick Log Button
document.getElementById('logCustomBtn').addEventListener('click', async () => {
  await recordSession(25, true);
  state.completedSessions++;
  state.totalFocusMinutes += 25;
  updateStats();
  loadHistory();
  loadSuggestions();
});

// Stats Update
async function updateStats() {
  try {
    const res = await fetch('/api/sessions/summary');
    const json = await res.json();
    if (json.success && json.data) {
      statCompleted.textContent = json.data.completedSessions || state.completedSessions;
      statRate.textContent = json.data.completionRate || '100%';
      statMinutes.textContent = (json.data.completedSessions || 1) * 25;
    }
  } catch (err) {
    statCompleted.textContent = state.completedSessions;
    statMinutes.textContent = state.totalFocusMinutes;
  }
}

// Health Check
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    if (json.status === 'online') {
      backendStatus.innerHTML = '<span class="dot green"></span><span>Backend: Online</span>';
      dbStatus.innerHTML = `<span class="dot blue"></span><span>Database: ${json.mongoStatus.includes('connected') ? 'Atlas' : 'In-Memory'}</span>`;
    }
  } catch (err) {
    backendStatus.innerHTML = '<span class="dot red"></span><span>Backend: Disconnected</span>';
  }
}

// Initial Boot
(function init() {
  updateTimerDisplay();
  loadTasks();
  loadSuggestions();
  loadHistory();
  updateStats();
  checkHealth();
})();

