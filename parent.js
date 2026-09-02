// ==== 設定：跟 app.js 用同一個 GAS Web App 網址 ====
const API_URL = 'https://script.google.com/macros/s/AKfycbxdNkLfxDi33wjWTPmMYxH1otbD-GpcdBCWJP_cMEazjz-MChH5bjfpodOric4G13Hv/exec';
const KID = 'kid_1';
const PARENT_PIN = '1234'; // demo PIN — change before real use

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let TASKS = [];
let REWARDS = [];
let weekStatus = {};
let balance = 0;
let pastWeeks = [];
const redemptionHistory = []; // session-only, no read API for Redemptions yet

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
    init();
  } else {
    pinErrorEl.textContent = 'Wrong PIN, try again';
    pinInputEl.value = '';
  }
}

// ---------- DOM refs (only valid after appContent is shown) ----------

let pointsValueEl, totalValueEl, weekTableHeadEl, weekTableBodyEl,
    rewardsListEl, historyListEl, redemptionHistoryEl, toastEl,
    cashPointsEl, cashPreviewEl, cashRedeemBtn,
    surpriseNameEl, surprisePointsEl, surpriseRedeemBtn,
    bonusReasonEl, bonusPointsEl, bonusAwardBtn,
    newTaskTitleEl, newTaskPointsEl, addTaskBtn,
    newRewardNameEl, newRewardCostEl, addRewardBtn;

function bindDomRefs() {
  pointsValueEl = document.getElementById('pointsValue');
  totalValueEl = document.getElementById('totalValue');
  weekTableHeadEl = document.getElementById('weekTableHead');
  weekTableBodyEl = document.getElementById('weekTableBody');
  rewardsListEl = document.getElementById('rewardsList');
  historyListEl = document.getElementById('historyList');
  redemptionHistoryEl = document.getElementById('redemptionHistory');
  toastEl = document.getElementById('toast');
  cashPointsEl = document.getElementById('cashPoints');
  cashPreviewEl = document.getElementById('cashPreview');
  cashRedeemBtn = document.getElementById('cashRedeemBtn');
  surpriseNameEl = document.getElementById('surpriseName');
  surprisePointsEl = document.getElementById('surprisePoints');
  surpriseRedeemBtn = document.getElementById('surpriseRedeemBtn');
  bonusReasonEl = document.getElementById('bonusReason');
  bonusPointsEl = document.getElementById('bonusPoints');
  bonusAwardBtn = document.getElementById('bonusAwardBtn');
  newTaskTitleEl = document.getElementById('newTaskTitle');
  newTaskPointsEl = document.getElementById('newTaskPoints');
  addTaskBtn = document.getElementById('addTaskBtn');
  newRewardNameEl = document.getElementById('newRewardName');
  newRewardCostEl = document.getElementById('newRewardCost');
  addRewardBtn = document.getElementById('addRewardBtn');
}

const CASH_RATE = 100;

// ---------- date helpers ----------

function getWeekDates() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dayOfWeek);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatToday() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

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
  if (!redemptionHistory.length) {
    redemptionHistoryEl.innerHTML = '<div class="redemption-empty">No rewards redeemed yet</div>';
    return;
  }
  redemptionHistoryEl.innerHTML = redemptionHistory
    .slice().reverse()
    .map(item => `
      <div class="redemption-item">
        <span class="name">${item.name}<span class="meta"> · ${item.date}</span></span>
        <span class="cost">-${item.cost}</span>
      </div>
    `).join('');
}

// ---------- week table ----------

function renderWeekHead() {
  const todayStr = new Date().toDateString();
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  weekTableHeadEl.innerHTML = '<th class="task-name-cell"></th>' + weekDates.map((d, i) => {
    const isToday = d.toDateString() === todayStr;
    return `<th class="${isToday ? 'today-col' : ''}">${DAYS[i]}<span class="day-num">${fmt(d)}</span></th>`;
  }).join('');
}

function renderWeekTable() {
  weekTableBodyEl.innerHTML = '';
  TASKS.forEach(task => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'task-name-cell';
    nameTd.innerHTML = `${task.title}<span class="task-points">+${task.points} / day</span>`;
    tr.appendChild(nameTd);

    DAYS.forEach((day, dayIndex) => {
      const td = document.createElement('td');
      td.className = 'day-cell';

      const dayStatus = (weekStatus[task.task_id] && weekStatus[task.task_id][day]) || {};
      const kidChecked = !!dayStatus.kid_checked;
      const parentApproved = !!dayStatus.parent_approved;

      const pair = document.createElement('div');
      pair.className = 'circle-pair';

      // parent can toggle the kid's box too — fixes accidental unchecking
      const kidCircle = document.createElement('div');
      kidCircle.className = 'circle kid' + (kidChecked ? ' checked' : '');
      kidCircle.textContent = '✓';
      kidCircle.addEventListener('click', () => handleKidCheck(task.task_id, day));

      // gold circle — tap to approve, tap again to undo
      const parentCircle = document.createElement('div');
      parentCircle.className = 'circle parent' + (parentApproved ? ' checked' : '');
      parentCircle.textContent = '✓';
      parentCircle.addEventListener('click', () => handleApproval(task.task_id, day, task.points));

      pair.appendChild(kidCircle);
      pair.appendChild(parentCircle);
      td.appendChild(pair);
      tr.appendChild(td);
    });

    weekTableBodyEl.appendChild(tr);
  });
}

async function handleKidCheck(taskId, day) {
  if (!weekStatus[taskId]) weekStatus[taskId] = {};
  if (!weekStatus[taskId][day]) weekStatus[taskId][day] = { kid_checked: false, parent_approved: false };
  const prev = { ...weekStatus[taskId][day] };

  // optimistic update, matching backend's auto-revert-approval-on-uncheck behavior
  const wasChecked = prev.kid_checked;
  weekStatus[taskId][day].kid_checked = !wasChecked;
  if (wasChecked && prev.parent_approved) {
    weekStatus[taskId][day].parent_approved = false;
  }
  renderWeekTable();

  try {
    const result = await apiPost('toggleKidCheck', {
      kid: KID, task_id: taskId, week_start: weekStart, day_of_week: day
    });
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
  if (!wasApproved) weekStatus[taskId][day].kid_checked = true; // approving also marks kid side
  renderWeekTable();
  showToast(wasApproved ? `Approval removed, -${points} pts` : `Approved +${points} pts`);

  try {
    const result = await apiPost('toggleApproval', {
      kid: KID, task_id: taskId, week_start: weekStart, day_of_week: day
    });
    if (!result.success) throw new Error('toggle failed');
    balance = result.balance;
    updatePointsDisplay();
  } catch (err) {
    weekStatus[taskId][day] = prev;
    renderWeekTable();
    showToast('Network hiccup, try again');
  }
}

// ---------- rewards (fixed) ----------

function renderRewards() {
  rewardsListEl.innerHTML = '';
  REWARDS.forEach(reward => {
    const card = document.createElement('div');
    card.className = 'reward-card';
    const canAfford = balance >= reward.cost;
    card.innerHTML = `
      <div>
        <div class="reward-name">${reward.name}</div>
        <div class="reward-cost">${reward.cost} pts</div>
      </div>
      <button class="reward-btn" ${canAfford ? '' : 'disabled'}>Redeem</button>
    `;
    card.querySelector('.reward-btn').addEventListener('click', () => redeemFixedReward(reward));
    rewardsListEl.appendChild(card);
  });
}

async function redeemFixedReward(reward) {
  if (balance < reward.cost) return;
  try {
    const result = await apiPost('redeem', {
      kid: KID, type: 'fixed', reward_id: reward.reward_id, name: reward.name, cost: reward.cost
    });
    if (!result.success) {
      showToast('Not enough points');
      return;
    }
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

// ---------- cash it in ----------

function bindCashCard() {
  cashPointsEl.addEventListener('input', () => {
    const pts = parseInt(cashPointsEl.value, 10) || 0;
    cashPreviewEl.textContent = `$${(pts / CASH_RATE).toFixed(2)}`;
  });

  cashRedeemBtn.addEventListener('click', async () => {
    const pts = parseInt(cashPointsEl.value, 10);
    if (!pts || pts <= 0) {
      showToast('Pick points to cash out');
      return;
    }
    if (balance < pts) {
      showToast('Not enough points');
      return;
    }
    const cash = pts / CASH_RATE;
    try {
      const result = await apiPost('redeem', {
        kid: KID, type: 'cash', name: `Cash ($${cash.toFixed(2)})`, cost: pts
      });
      if (!result.success) {
        showToast('Not enough points');
        return;
      }
      balance = result.balance;
      redemptionHistory.push({ name: `Cash ($${cash.toFixed(2)})`, cost: pts, date: formatToday() });
      updatePointsDisplay();
      renderRedemptionHistory();
      renderRewards();
      showToast(`Redeemed ${pts} pts for $${cash.toFixed(2)}`);
      cashPointsEl.value = '';
      cashPreviewEl.textContent = '$0.00';
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

// ---------- surprise reward ----------

function bindSurpriseCard() {
  surpriseRedeemBtn.addEventListener('click', async () => {
    const name = surpriseNameEl.value.trim();
    const cost = parseInt(surprisePointsEl.value, 10);
    if (!name) {
      showToast('What did they earn?');
      return;
    }
    if (!cost || cost <= 0) {
      showToast('Enter points');
      return;
    }
    if (balance < cost) {
      showToast('Not enough points');
      return;
    }
    try {
      const result = await apiPost('redeem', { kid: KID, type: 'surprise', name, cost });
      if (!result.success) {
        showToast('Not enough points');
        return;
      }
      balance = result.balance;
      redemptionHistory.push({ name, cost, date: formatToday() });
      updatePointsDisplay();
      renderRedemptionHistory();
      showToast(`Redeemed "${name}" for ${cost} pts`);
      surpriseNameEl.value = '';
      surprisePointsEl.value = '';
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

// ---------- bonus points ----------

function bindBonusCard() {
  bonusAwardBtn.addEventListener('click', async () => {
    const reason = bonusReasonEl.value.trim();
    const points = parseInt(bonusPointsEl.value, 10);
    if (!reason) {
      showToast('What did they do?');
      return;
    }
    if (!points || points <= 0) {
      showToast('Enter points');
      return;
    }
    try {
      const result = await apiPost('awardBonus', { kid: KID, reason, points });
      if (!result.success) throw new Error('award failed');
      balance = result.balance;
      updatePointsDisplay();
      showToast(`+${points} pts for "${reason}"`);
      bonusReasonEl.value = '';
      bonusPointsEl.value = '';
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

// ---------- add task ----------

function bindAddTaskCard() {
  addTaskBtn.addEventListener('click', async () => {
    const title = newTaskTitleEl.value.trim();
    const points = parseInt(newTaskPointsEl.value, 10);
    if (!title) {
      showToast('Give the task a name');
      return;
    }
    if (!points || points <= 0) {
      showToast('Enter points');
      return;
    }
    try {
      const result = await apiPost('addTask', { title, points });
      if (!result.success) throw new Error('add task failed');
      TASKS.push(result.task);
      renderWeekTable();
      newTaskTitleEl.value = '';
      newTaskPointsEl.value = '';
      showToast(`Added "${title}"`);
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

// ---------- add reward ----------

function bindAddRewardCard() {
  addRewardBtn.addEventListener('click', async () => {
    const name = newRewardNameEl.value.trim();
    const cost = parseInt(newRewardCostEl.value, 10);
    if (!name) {
      showToast('Give the reward a name');
      return;
    }
    if (!cost || cost <= 0) {
      showToast('Enter points');
      return;
    }
    try {
      const result = await apiPost('addReward', { name, cost });
      if (!result.success) throw new Error('add reward failed');
      REWARDS.push(result.reward);
      renderRewards();
      newRewardNameEl.value = '';
      newRewardCostEl.value = '';
      showToast(`Added "${name}"`);
    } catch (err) {
      showToast('Network hiccup, try again');
    }
  });
}

// ---------- history ----------

function renderHistory() {
  if (!pastWeeks.length) {
    historyListEl.innerHTML = '<div class="empty">No past weeks yet</div>';
    return;
  }
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

// ---------- init ----------

async function init() {
  bindDomRefs();
  bindCashCard();
  bindSurpriseCard();
  bindBonusCard();
  bindAddTaskCard();
  bindAddRewardCard();
  renderWeekHead();

  try {
    const [tasks, rewards, status, history] = await Promise.all([
      apiGet('getTasks'),
      apiGet('getRewards'),
      apiGet('getWeekStatus', { kid: KID, week_start: weekStart }),
      apiGet('getHistory', { kid: KID, weeks: 2 })
    ]);
    TASKS = tasks;
    REWARDS = rewards;
    weekStatus = status.tasks || {};
    balance = status.balance || 0;
    pastWeeks = history || [];

    renderWeekTable();
    renderRewards();
    renderHistory();
    updatePointsDisplay();
    renderRedemptionHistory();
  } catch (err) {
    weekTableBodyEl.innerHTML = '<tr><td class="empty">Could not load — check your connection</td></tr>';
  }
}
