// ==== 設定：換成你自己的 GAS Web App 網址 ====
const API_URL = 'https://script.google.com/macros/s/AKfycbxdNkLfxDi33wjWTPmMYxH1otbD-GpcdBCWJP_cMEazjz-MChH5bjfpodOric4G13Hv/exec';
const KID = 'kid_1';

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let TASKS = [];
let REWARDS = [];
let weekStatus = {}; // { task_id: { Sun: {kid_checked, parent_approved}, ... } }
let balance = 0;
let pastWeeks = [];
// redemption history only persists for this page session — there's no
// read API for Redemptions yet, so a refresh clears this list
const redemptionHistory = [];

const pointsValueEl = document.getElementById('pointsValue');
const totalValueEl = document.getElementById('totalValue');
const weekTableHeadEl = document.getElementById('weekTableHead');
const weekTableBodyEl = document.getElementById('weekTableBody');
const rewardsListEl = document.getElementById('rewardsList');
const historyListEl = document.getElementById('historyList');
const redemptionHistoryEl = document.getElementById('redemptionHistory');
const toastEl = document.getElementById('toast');
const cashPointsEl = document.getElementById('cashPoints');
const cashPreviewEl = document.getElementById('cashPreview');
const cashRedeemBtn = document.getElementById('cashRedeemBtn');

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
const weekStart = toYMD(weekDates[0]); // Sunday of the current week

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

      const kidCircle = document.createElement('div');
      kidCircle.className = 'circle kid' + (kidChecked ? ' checked' : '');
      kidCircle.textContent = '✓';
      kidCircle.addEventListener('click', () => handleKidCheck(task.task_id, day));

      const parentCircle = document.createElement('div');
      parentCircle.className = 'circle parent' + (parentApproved ? ' checked' : '') + ' readonly';
      parentCircle.textContent = '✓';

      pair.appendChild(kidCircle);
      pair.appendChild(parentCircle);
      td.appendChild(pair);
      tr.appendChild(td);
    });

    weekTableBodyEl.appendChild(tr);
  });
}

async function handleKidCheck(taskId, day) {
  // optimistic update — flip locally first, then confirm with the server
  if (!weekStatus[taskId]) weekStatus[taskId] = {};
  if (!weekStatus[taskId][day]) weekStatus[taskId][day] = { kid_checked: false, parent_approved: false };
  const prev = { ...weekStatus[taskId][day] };
  weekStatus[taskId][day].kid_checked = !prev.kid_checked;
  renderWeekTable();
  showToast(weekStatus[taskId][day].kid_checked ? 'Nice! Waiting on parent' : 'Unchecked');

  try {
    const result = await apiPost('toggleKidCheck', {
      kid: KID, task_id: taskId, week_start: weekStart, day_of_week: day
    });
    if (!result.success) throw new Error('toggle failed');
    balance = result.balance;
    updatePointsDisplay();
  } catch (err) {
    weekStatus[taskId][day] = prev; // roll back
    renderWeekTable();
    showToast('Network hiccup, try again');
  }
}

// ---------- rewards ----------

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

init();
