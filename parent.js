// ==== 設定 ====
const API_URL = 'https://script.google.com/macros/s/AKfycbxdNkLfxDi33wjWTPmMYxH1otbD-GpcdBCWJP_cMEazjz-MChH5bjfpodOric4G13Hv/exec';
const PARENT_PIN = '1225';

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const CASH_RATE = 100;

let KIDS = [];        // [{kid_id, name}]
let activeKid = null;
let TASKS = [];
let REWARDS = [];
let weekStatus = {};
let balance = 0;
let pastWeeks = [];
const redemptionHistory = []; // session-only per kid switch — resets when you change kid or reload

// ---------- PIN gate ----------

const pinScreenEl = document.getElementById('pinScreen');
const appContentEl = document.getElementById('appContent');
const pinInputEl = document.getElementById('pinInput');
const pinSubmitBtn = document.getElementById('pinSubmitBtn');
const pinErrorEl = document.getElementById('pinError');

pinSubmitBtn.addEventListener('click', tryUnlock);
pinInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

function tryUnlock() {
  if (pinInputEl.value === PARENT_PIN) {
    pinScreenEl.style.display = 'none';
    appContentEl.style.display = 'block';
    bindAllCards();
    init();
  } else {
    pinErrorEl.textContent = 'Wrong PIN, try again';
    pinInputEl.value = '';
  }
}

// ---------- DOM refs ----------

const kidSelectEl = document.getElementById('kidSelect');
const pointsValueEl = document.getElementById('pointsValue');
const totalValueEl = document.getElementById('totalValue');
const weekHeadingEl = document.getElementById('weekHeading');
const weekDayHeaderEl = document.getElementById('weekDayHeader');
const taskListEl = document.getElementById('taskList');
const rewardsListEl = document.getElementById('rewardsList');
const historyListEl = document.getElementById('historyList');
const redemptionHistoryEl = document.getElementById('redemptionHistory');
const toastEl = document.getElementById('toast');
const cashPointsEl = document.getElementById('cashPoints');
const cashPreviewEl = document.getElementById('cashPreview');
const cashRedeemBtn = document.getElementById('cashRedeemBtn');
const surpriseNameEl = document.getElementById('surpriseName');
const surprisePointsEl = document.getElementById('surprisePoints');
const surpriseRedeemBtn = document.getElementById('surpriseRedeemBtn');
const bonusReasonEl = document.getElementById('bonusReason');
const bonusPointsEl = document.getElementById('bonusPoints');
const bonusAwardBtn = document.getElementById('bonusAwardBtn');
const newTaskTitleEl = document.getElementById('newTaskTitle');
const newTaskPointsEl = document.getElementById('newTaskPoints');
const addTaskBtn = document.getElementById('addTaskBtn');
const newRewardNameEl = document.getElementById('newRewardName');
const newRewardCostEl = document.getElementById('newRewardCost');
const addRewardBtn = document.getElementById('addRewardBtn');

// ---------- date helpers ----------

function getWeekDates() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dayOfWeek);
  const dates = [];
  for (let i = 0; i < 7; i++) { const d = new Date(sunday); d.setDate(sunday.getDate() + i); dates.push(d); }
  return dates;
}
function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatToday() { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()}`; }

const weekDates = getWeekDates();
const weekStart = toYMD(weekDates[0]);

// ---------- API helpers ----------

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  return res.json();
}
async function apiPost(action, body) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}

// ---------- toast ----------

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------- scoreboard ----------

function updatePointsDisplay() {
  pointsValueEl.textContent = balance;
  const pastTotal = pastWeeks.reduce((sum, w) => sum + w.pointsEarned, 0);
  totalValueEl.textContent = pastTotal + balance;
}
function renderRedemptionHistory() {
  if (!redemptionHistory.length) { redemptionHistoryEl.innerHTML = '<div class="redemption-empty">No rewards redeemed yet</div>'; return; }
  redemptionHistoryEl.innerHTML = redemptionHistory.slice().reverse().slice(0, 3).map(item => `
    <div class="redemption-item">
      <span class="name">${item.name}<span class="meta"> · ${item.date}</span></span>
      <span class="cost ${item.sign === '+' ? 'positive' : ''}">${item.sign || '-'}${item.cost}</span>
    </div>
  `).join('');
}

// ---------- kid select ----------

function kidName(id) {
  const k = KIDS.find(k => k.kid_id === id);
  return k ? k.name : id;
}

function renderKidSelect() {
  kidSelectEl.innerHTML = KIDS.map(k =>
    `<option value="${k.kid_id}" ${k.kid_id === activeKid ? 'selected' : ''}>${k.name}</option>`
  ).join('');
}

kidSelectEl.addEventListener('change', async () => {
  activeKid = kidSelectEl.value;
  await loadKidData(); // re-fetches activity for the newly selected kid, replacing the old list
  renderAll();
});

// ---------- week task cards ----------

function renderWeekHead() {
  const todayStr = new Date().toDateString();
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  const labels = weekDates.map((d, i) => {
    const isToday = d.toDateString() === todayStr;
    return `<div class="day-label ${isToday ? 'today-col' : ''}">${DAYS[i]}<span class="day-num">${fmt(d)}</span></div>`;
  }).join('');
  weekDayHeaderEl.innerHTML = '<div class="task-name-spacer"></div><div class="week-day-header-days">' + labels + '</div>';
}

function renderWeekTable() {
  taskListEl.innerHTML = '';
  TASKS.forEach((task, idx) => {
    const row = document.createElement('div');
    row.className = 'task-card-row';

    const card = document.createElement('div');
    card.className = 'task-card';

    const reorderHtml = `
      <span class="task-reorder">
        <button data-reorder-dir="up" data-reorder-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button data-reorder-dir="down" data-reorder-idx="${idx}" ${idx === TASKS.length - 1 ? 'disabled' : ''}>▼</button>
      </span>`;
    const editHtml = `<button class="task-points-edit" data-edit-idx="${idx}">edit</button>`;

    const daysHtml = DAYS.map(day => `<div class="day-cell" data-task="${task.task_id}" data-day="${day}"></div>`).join('');

    card.innerHTML = `
      <div class="task-card-name">${task.title}<span class="task-points">+${task.points} / day${editHtml}</span></div>
      <div class="task-card-days">${daysHtml}</div>
    `;
    row.innerHTML = reorderHtml;
    row.appendChild(card);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'task-remove-btn';
    removeBtn.title = 'Remove task';
    removeBtn.textContent = '✕';
    removeBtn.dataset.removeIdx = idx;
    row.appendChild(removeBtn);

    taskListEl.appendChild(row);

    card.querySelectorAll('.day-cell').forEach(cellEl => {
      const day = cellEl.dataset.day;
      const dayStatus = (weekStatus[task.task_id] && weekStatus[task.task_id][day]) || {};
      const kidChecked = !!dayStatus.kid_checked;
      const parentApproved = !!dayStatus.parent_approved;

      const pair = document.createElement('div');
      pair.className = 'circle-pair';

      const kidCircle = document.createElement('div');
      kidCircle.className = 'circle kid' + (kidChecked ? ' checked' : '');
      kidCircle.textContent = '✓';
      kidCircle.addEventListener('click', () => handleKidCheck(task.task_id, day));

      const parentCircle = document.createElement('div');
      parentCircle.className = 'circle parent' + (parentApproved ? ' checked' : '');
      parentCircle.textContent = '✓';
      parentCircle.addEventListener('click', () => handleApproval(task.task_id, day, task.points));

      pair.appendChild(kidCircle);
      pair.appendChild(parentCircle);
      cellEl.appendChild(pair);
    });
  });

  taskListEl.querySelectorAll('[data-reorder-idx]').forEach(btn => {
    btn.addEventListener('click', () => reorderTaskLocal(parseInt(btn.dataset.reorderIdx, 10), btn.dataset.reorderDir));
  });
  taskListEl.querySelectorAll('.task-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeTaskLocal(parseInt(btn.dataset.removeIdx, 10)));
  });
  taskListEl.querySelectorAll('.task-points-edit').forEach(btn => {
    btn.addEventListener('click', () => editTaskPointsLocal(parseInt(btn.dataset.editIdx, 10)));
  });
}

async function handleKidCheck(taskId, day) {
  if (!weekStatus[taskId]) weekStatus[taskId] = {};
  if (!weekStatus[taskId][day]) weekStatus[taskId][day] = { kid_checked: false, parent_approved: false };
  const prev = { ...weekStatus[taskId][day] };
  const wasChecked = prev.kid_checked;
  weekStatus[taskId][day].kid_checked = !wasChecked;
  if (wasChecked && prev.parent_approved) weekStatus[taskId][day].parent_approved = false;
  renderWeekTable();

  try {
    const result = await apiPost('toggleKidCheck', { kid: activeKid, task_id: taskId, week_start: weekStart, day_of_week: day });
    if (!result.success) throw new Error('toggle failed');
    balance = result.balance;
    updatePointsDisplay();
  } catch (err) {
    weekStatus[taskId][day] = prev;
    renderWeekTable();
    showToast('Network hiccup, try again');
  }
}

async function handleApproval(taskId, day, points) {
  if (!weekStatus[taskId]) weekStatus[taskId] = {};
  if (!weekStatus[taskId][day]) weekStatus[taskId][day] = { kid_checked: false, parent_approved: false };
  const prev = { ...weekStatus[taskId][day] };
  const wasApproved = prev.parent_approved;
  weekStatus[taskId][day].parent_approved = !wasApproved;
  if (!wasApproved) weekStatus[taskId][day].kid_checked = true;
  renderWeekTable();
  showToast(wasApproved ? `Approval removed, -${points} pts` : `Approved +${points} pts`);

  try {
    const result = await apiPost('toggleApproval', { kid: activeKid, task_id: taskId, week_start: weekStart, day_of_week: day });
    if (!result.success) throw new Error('toggle failed');
    balance = result.balance;
    updatePointsDisplay();
  } catch (err) {
    weekStatus[taskId][day] = prev;
    renderWeekTable();
    showToast('Network hiccup, try again');
  }
}

// ---------- reorder / remove / edit points ----------

async function reorderTaskLocal(idx, dir) {
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= TASKS.length) return;
  [TASKS[idx], TASKS[swapWith]] = [TASKS[swapWith], TASKS[idx]];
  renderWeekTable();
  try {
    await apiPost('reorderTasks', { task_ids: TASKS.map(t => t.task_id) });
  } catch (err) {
    showToast('Order saved locally, but sync failed — try again');
  }
}

async function removeTaskLocal(idx) {
  const task = TASKS[idx];
  if (!confirm(`Remove "${task.title}"? This week's checkmarks for it will be lost.`)) return;
  try {
    const result = await apiPost('removeTask', { task_id: task.task_id });
    if (!result.success) throw new Error('remove failed');
    TASKS.splice(idx, 1);
    renderWeekTable();
    showToast(`Removed "${task.title}"`);
  } catch (err) {
    showToast('Network hiccup, try again');
  }
}

async function editTaskPointsLocal(idx) {
  const task = TASKS[idx];
  const input = prompt(`New points/day for "${task.title}"`, task.points);
  if (input === null) return;
  const newPoints = parseInt(input, 10);
  if (!newPoints || newPoints <= 0) { showToast('Enter a valid point value'); return; }
  try {
    const result = await apiPost('editTaskPoints', { task_id: task.task_id, points: newPoints });
    if (!result.success) throw new Error('edit failed');
    // only future approvals use the new rate — PointsLedger history is untouched
    task.points = newPoints;
    renderWeekTable();
    showToast(`"${task.title}" is now +${newPoints}/day`);
  } catch (err) {
    showToast('Network hiccup, try again');
  }
}

// ---------- rewards ----------

function renderRewards() {
  rewardsListEl.innerHTML = '';
  REWARDS.forEach((reward, idx) => {
    const card = document.createElement('div');
    card.className = 'reward-card';
    const canAfford = balance >= reward.cost;
    const reorderHtml = `
      <span class="reward-reorder">
        <button data-reward-reorder-dir="up" data-reward-reorder-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button data-reward-reorder-dir="down" data-reward-reorder-idx="${idx}" ${idx === REWARDS.length - 1 ? 'disabled' : ''}>▼</button>
      </span>`;
    card.innerHTML = `
      ${reorderHtml}
      <div style="flex:1;">
        <div class="reward-name">${reward.name}</div>
        <div class="reward-cost">${reward.cost} pts</div>
      </div>
      <button class="reward-btn" ${canAfford ? '' : 'disabled'}>Redeem</button>
    `;
    card.querySelector('.reward-btn').addEventListener('click', () => redeemFixedReward(reward));
    rewardsListEl.appendChild(card);
  });
  rewardsListEl.querySelectorAll('[data-reward-reorder-idx]').forEach(btn => {
    btn.addEventListener('click', () => reorderRewardLocal(parseInt(btn.dataset.rewardReorderIdx, 10), btn.dataset.rewardReorderDir));
  });
}

async function reorderRewardLocal(idx, dir) {
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= REWARDS.length) return;
  [REWARDS[idx], REWARDS[swapWith]] = [REWARDS[swapWith], REWARDS[idx]];
  renderRewards();
  try {
    await apiPost('reorderRewards', { reward_ids: REWARDS.map(r => r.reward_id) });
  } catch (err) {
    showToast('Order saved locally, but sync failed — try again');
  }
}

async function redeemFixedReward(reward) {
  if (balance < reward.cost) return;
  try {
    const result = await apiPost('redeem', { kid: activeKid, type: 'fixed', reward_id: reward.reward_id, name: reward.name, cost: reward.cost });
    if (!result.success) { showToast('Not enough points'); return; }
    balance = result.balance;
    redemptionHistory.push({ name: reward.name, cost: reward.cost, date: formatToday() });
    updatePointsDisplay();
    renderRedemptionHistory();
    renderRewards();
    showToast(`Redeemed "${reward.name}" for ${reward.cost} pts`);
  } catch (err) {
    showToast('Network hiccup, try again');
  }
}

// ---------- cash it in / surprise / bonus ----------

function bindCashCard() {
  cashPointsEl.addEventListener('input', () => {
    const pts = parseInt(cashPointsEl.value, 10) || 0;
    cashPreviewEl.textContent = `$${(pts / CASH_RATE).toFixed(2)}`;
  });
  cashRedeemBtn.addEventListener('click', async () => {
    const pts = parseInt(cashPointsEl.value, 10);
    if (!pts || pts <= 0) { showToast('Pick points to cash out'); return; }
    if (balance < pts) { showToast('Not enough points'); return; }
    const cash = pts / CASH_RATE;
    try {
      const result = await apiPost('redeem', { kid: activeKid, type: 'cash', name: `Cash ($${cash.toFixed(2)})`, cost: pts });
      if (!result.success) { showToast('Not enough points'); return; }
      balance = result.balance;
      redemptionHistory.push({ name: `Cash ($${cash.toFixed(2)})`, cost: pts, date: formatToday() });
      updatePointsDisplay();
      renderRedemptionHistory();
      renderRewards();
      showToast(`Redeemed ${pts} pts for $${cash.toFixed(2)}`);
      cashPointsEl.value = ''; cashPreviewEl.textContent = '$0.00';
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

function bindSurpriseCard() {
  surpriseRedeemBtn.addEventListener('click', async () => {
    const name = surpriseNameEl.value.trim();
    const cost = parseInt(surprisePointsEl.value, 10);
    if (!name) { showToast('What did they earn?'); return; }
    if (!cost || cost <= 0) { showToast('Enter points'); return; }
    if (balance < cost) { showToast('Not enough points'); return; }
    try {
      const result = await apiPost('redeem', { kid: activeKid, type: 'surprise', name, cost });
      if (!result.success) { showToast('Not enough points'); return; }
      balance = result.balance;
      redemptionHistory.push({ name, cost, date: formatToday() });
      updatePointsDisplay();
      renderRedemptionHistory();
      showToast(`Redeemed "${name}" for ${cost} pts`);
      surpriseNameEl.value = ''; surprisePointsEl.value = '';
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

function bindBonusCard() {
  bonusAwardBtn.addEventListener('click', async () => {
    const reason = bonusReasonEl.value.trim();
    const points = parseInt(bonusPointsEl.value, 10);
    if (!reason) { showToast('What did they do?'); return; }
    if (!points || points <= 0) { showToast('Enter points'); return; }
    try {
      const result = await apiPost('awardBonus', { kid: activeKid, reason, points });
      if (!result.success) throw new Error('award failed');
      balance = result.balance;
      redemptionHistory.push({ name: reason, cost: points, date: formatToday(), sign: '+' });
      updatePointsDisplay();
      renderRedemptionHistory();
      showToast(`+${points} pts for "${reason}"`);
      bonusReasonEl.value = ''; bonusPointsEl.value = '';
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

// ---------- add task / add reward / add kid ----------

function bindAddTaskCard() {
  addTaskBtn.addEventListener('click', async () => {
    const title = newTaskTitleEl.value.trim();
    const points = parseInt(newTaskPointsEl.value, 10);
    if (!title) { showToast('Give the task a name'); return; }
    if (!points || points <= 0) { showToast('Enter points'); return; }
    try {
      const result = await apiPost('addTask', { title, points });
      if (!result.success) throw new Error('add task failed');
      TASKS.push(result.task);
      renderWeekTable();
      newTaskTitleEl.value = ''; newTaskPointsEl.value = '';
      showToast(`Added "${title}"`);
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

function bindAddRewardCard() {
  addRewardBtn.addEventListener('click', async () => {
    const name = newRewardNameEl.value.trim();
    const cost = parseInt(newRewardCostEl.value, 10);
    if (!name) { showToast('Give the reward a name'); return; }
    if (!cost || cost <= 0) { showToast('Enter points'); return; }
    try {
      const result = await apiPost('addReward', { name, cost });
      if (!result.success) throw new Error('add reward failed');
      REWARDS.push(result.reward);
      renderRewards();
      newRewardNameEl.value = ''; newRewardCostEl.value = '';
      showToast(`Added "${name}"`);
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

function bindAllCards() {
  bindCashCard();
  bindSurpriseCard();
  bindBonusCard();
  bindAddTaskCard();
  bindAddRewardCard();
}

// ---------- history ----------

function renderHistory() {
  if (!pastWeeks.length) { historyListEl.innerHTML = '<div class="empty">No past weeks yet</div>'; return; }
  historyListEl.innerHTML = pastWeeks.slice(0, 2).map(week => `
    <div class="history-card">
      <div>
        <div class="history-week">${week.week_start}</div>
        <div class="history-stats">${week.tasksCompleted} tasks completed</div>
      </div>
      <div class="history-points">${week.pointsEarned}</div>
    </div>
  `).join('');
}

// ---------- load / render orchestration ----------

async function loadKidData() {
  const [status, history, activity] = await Promise.all([
    apiGet('getWeekStatus', { kid: activeKid, week_start: weekStart }),
    apiGet('getHistory', { kid: activeKid, weeks: 2 }),
    apiGet('getRecentActivity', { kid: activeKid, limit: 3 })
  ]);
  weekStatus = status.tasks || {};
  balance = status.balance || 0;
  pastWeeks = history || [];
  redemptionHistory.length = 0;
  redemptionHistory.push(...(activity || []).reverse()); // reverse: renderRedemptionHistory re-reverses to show newest first
}

function renderAll() {
  document.getElementById('kidNameLabel').textContent = kidName(activeKid);
  weekHeadingEl.textContent = 'This Week';
  renderWeekHead();
  updatePointsDisplay();
  renderWeekTable();
  renderRewards();
  renderRedemptionHistory();
  renderHistory();
}

async function init() {
  try {
    const [kids, tasks, rewards] = await Promise.all([
      apiGet('getKids'),
      apiGet('getTasks'),
      apiGet('getRewards')
    ]);
    KIDS = kids;
    TASKS = tasks;
    REWARDS = rewards;
    activeKid = KIDS.length ? KIDS[0].kid_id : null;
    renderKidSelect();

    if (activeKid) {
      await loadKidData();
      renderAll();
      startPolling();
      startIdleTimer();
    } else {
      taskListEl.innerHTML = '<div class="empty">No kids yet — add one above</div>';
    }
  } catch (err) {
    taskListEl.innerHTML = '<div class="empty">Could not load — check your connection</div>';
  }
}

// ---------- polling (picks up kid check-ins without a manual refresh) ----------

const POLL_INTERVAL_MS = 15000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let pollTimer = null;
let idleTimer = null;

async function refreshStatus() {
  if (!activeKid) return;
  try {
    await loadKidData();
    renderWeekTable();
    updatePointsDisplay();
    renderRedemptionHistory();
    renderRewards(); // affordability may have changed
  } catch (err) {
    // silent — a failed background refresh shouldn't interrupt the parent
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshStatus();
  }, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && activeKid) refreshStatus();
});

// ---------- idle auto-lock (10 min of no touch/click/key -> back to PIN) ----------

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (appContentEl.style.display === 'none') return; // not unlocked yet
  idleTimer = setTimeout(lockOut, IDLE_TIMEOUT_MS);
}
function startIdleTimer() {
  ['click', 'touchstart', 'keydown'].forEach(evt =>
    document.addEventListener(evt, resetIdleTimer)
  );
  resetIdleTimer();
}
function lockOut() {
  stopPolling();
  appContentEl.style.display = 'none';
  pinScreenEl.style.display = 'flex';
  pinInputEl.value = '';
  pinErrorEl.textContent = '';
}
