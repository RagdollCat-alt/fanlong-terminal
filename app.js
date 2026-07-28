const opening = document.querySelector('#opening');
const searchParams = new URLSearchParams(window.location.search);
const API_ORIGIN = 'https://fanlong-api.huaian.cloud';
let csrfToken = sessionStorage.getItem('fanlong_csrf') || '';
let sessionToken = sessionStorage.getItem('fanlong_session_token') || '';
if (searchParams.has('memories') || searchParams.has('memory') || searchParams.has('gallery') || searchParams.has('archive') || searchParams.has('daily') || searchParams.has('social') || searchParams.has('summon') || searchParams.has('summonResult') || searchParams.has('shop') || searchParams.has('bag') || searchParams.has('activity')) {
  document.body.classList.add('is-previewing');
}
if (searchParams.has('debug')) {
  document.body.classList.add('debug-enabled');
}
const login = document.querySelector('#login');
const loading = document.querySelector('#loading');
const home = document.querySelector('#home');
const dailyScreen = document.querySelector('#dailyScreen');
const socialScreen = document.querySelector('#socialScreen');
const shopScreen = document.querySelector('#shopScreen');
const bagScreen = document.querySelector('#bagScreen');
const archiveScreen = document.querySelector('#archiveScreen');
const galleryScreen = document.querySelector('#galleryScreen');
const memoryScreen = document.querySelector('#memoryScreen');
const memoryDetailScreen = document.querySelector('#memoryDetailScreen');
const summonScreen = document.querySelector('#summonScreen');
const summonResultScreen = document.querySelector('#summonResultScreen');
const toast = document.querySelector('#toast');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const loadingBar = document.querySelector('#loadingBar');
const loadingNote = document.querySelector('#loadingNote');
const terminalDialog = document.querySelector('#terminalDialog');
const terminalDialogTitle = document.querySelector('#terminalDialogTitle');
const terminalDialogBody = document.querySelector('#terminalDialogBody');
const terminalDialogConfirm = document.querySelector('#terminalDialogConfirm');
const terminalDialogPanel = document.querySelector('.terminal-dialog-panel');
const gameScreens = [opening, login, loading, home, dailyScreen, socialScreen, shopScreen, bagScreen, archiveScreen, galleryScreen, memoryScreen, memoryDetailScreen, summonScreen, summonResultScreen];
let toastTimer;
let loadingFrame;
let apiUser = null;
let dialogConfirmHandler = null;

function updateGameLayout() {
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const portraitCanvas = viewportWidth < viewportHeight && Math.min(viewportWidth, viewportHeight) <= 900;
  const scale = portraitCanvas
    ? Math.min(viewportWidth / 941, viewportHeight / 1672)
    : Math.min(viewportWidth / 1672, viewportHeight / 941);
  document.body.style.setProperty('--game-scale', String(Math.max(scale, .01)));
  document.body.classList.toggle('is-portrait-canvas', portraitCanvas);
}

function screenArtwork(screen) {
  const image = screen?.querySelector('.artboard > img');
  return image?.dataset.src || image?.getAttribute('src') || '';
}

function hydrateScreenAssets(screen) {
  if (!screen) return;
  const artwork = screenArtwork(screen);
  if (artwork) screen.style.setProperty('--screen-art', `url("${encodeURI(artwork)}")`);
  screen.querySelectorAll('img[data-src]').forEach((image) => {
    const source = image.dataset.src;
    const reveal = () => image.removeAttribute('data-src');
    image.addEventListener('load', reveal, { once: true });
    image.addEventListener('error', reveal, { once: true });
    image.src = source;
    if (image.complete) reveal();
  });
}

updateGameLayout();
window.addEventListener('resize', updateGameLayout, { passive: true });
window.visualViewport?.addEventListener('resize', updateGameLayout, { passive: true });
window.addEventListener('orientationchange', updateGameLayout, { passive: true });
hydrateScreenAssets(opening);

const scheduleAssetWarmup = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 500));
window.addEventListener('load', () => scheduleAssetWarmup(() => hydrateScreenAssets(login)), { once: true });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function openTerminalDialog({ title, html, confirmLabel = '确认', cancelLabel = '取消', hideConfirm = false, onConfirm = null, dialogClass = '' }) {
  terminalDialogTitle.textContent = title;
  terminalDialogBody.innerHTML = html;
  terminalDialogConfirm.textContent = confirmLabel;
  terminalDialogConfirm.hidden = hideConfirm;
  document.querySelector('#terminalDialogCancel').textContent = cancelLabel;
  dialogConfirmHandler = onConfirm;
  terminalDialogPanel.className = `terminal-dialog-panel${dialogClass ? ` ${dialogClass}` : ''}`;
  terminalDialog.classList.add('is-open');
  terminalDialog.setAttribute('aria-hidden', 'false');
}

function closeTerminalDialog() {
  terminalDialog.classList.remove('is-open');
  terminalDialog.setAttribute('aria-hidden', 'true');
  dialogConfirmHandler = null;
  terminalDialogConfirm.disabled = false;
}

document.querySelector('#terminalDialogClose').addEventListener('click', closeTerminalDialog);
document.querySelector('#terminalDialogCancel').addEventListener('click', closeTerminalDialog);
terminalDialog.addEventListener('click', (event) => { if (event.target === terminalDialog) closeTerminalDialog(); });
terminalDialogConfirm.addEventListener('click', async () => {
  if (!dialogConfirmHandler) { closeTerminalDialog(); return; }
  terminalDialogConfirm.disabled = true;
  try { await dialogConfirmHandler(); }
  catch (error) { showToast(error.message || '操作失败，请重试'); terminalDialogConfirm.disabled = false; }
});

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie.split('; ').find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
}

async function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const timeoutMs = Number(options.timeoutMs || 15000);
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = csrfToken || decodeURIComponent(readCookie('fanlong_csrf'));
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const url = path.startsWith('/api/') ? `${API_ORIGIN}${path}` : path;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, method, headers, credentials: 'include', cache: 'no-store', signal: controller.signal });
  } catch (error) {
    const message = error.name === 'AbortError' ? '服务器响应超时，请稍后重试' : '无法连接服务器，请检查网络后重试';
    const networkError = new Error(message);
    networkError.code = error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
    throw networkError;
  } finally {
    window.clearTimeout(timeout);
  }
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80) || '空响应';
    result = { ok: false, code: 'INVALID_RESPONSE', message: `服务器返回格式不正确（HTTP ${response.status}：${preview}）` };
  }
  if (!response.ok || !result.ok) {
    if (result.code === 'AUTH_REQUIRED') {
      sessionToken = '';
      csrfToken = '';
      sessionStorage.removeItem('fanlong_session_token');
      sessionStorage.removeItem('fanlong_csrf');
    }
    const error = new Error(result.message || `请求失败（${response.status}）`);
    error.code = result.code;
    error.status = response.status;
    error.data = result.data;
    throw error;
  }
  if (result.data?.csrfToken) {
    csrfToken = result.data.csrfToken;
    sessionStorage.setItem('fanlong_csrf', csrfToken);
  }
  if (result.data?.sessionToken) {
    sessionToken = result.data.sessionToken;
    sessionStorage.setItem('fanlong_session_token', sessionToken);
  }
  return result.data;
}

function apiAssetUrl(path) {
  return path?.startsWith('/api/') ? `${API_ORIGIN}${path}` : path;
}

function optimizedCardImage(path) {
  if (!path?.startsWith('assets/ui/summon-cards/')) return path;
  return path
    .replace('assets/ui/summon-cards/', 'assets/ui/summon-cards-web/')
    .replace(/\.(png|jpe?g)$/i, '.webp');
}

function showScreen(nextScreen) {
  hydrateScreenAssets(nextScreen);
  gameScreens.forEach((screen) => {
    const active = screen === nextScreen;
    screen.classList.toggle('is-active', active);
    screen.setAttribute('aria-hidden', String(!active));
  });
}

function enterLogin() {
  showScreen(login);
  scheduleAssetWarmup(() => {
    hydrateScreenAssets(loading);
    hydrateScreenAssets(home);
  });
  window.setTimeout(() => document.querySelector('#account').focus(), 500);
}

function enterLoading() {
  showScreen(loading);
  loadingBar.style.width = '0%';
  const startedAt = performance.now();
  const duration = 3200;

  function updateLoading(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    loadingBar.style.width = `${Math.round(eased * 100)}%`;

    if (progress < .42) loadingNote.textContent = '正在整理档案与记忆，请稍候';
    else if (progress < .78) loadingNote.textContent = '正在核验身份与虞宫权限';
    else loadingNote.textContent = '档案已开启';

    if (progress < 1) loadingFrame = requestAnimationFrame(updateLoading);
    else window.setTimeout(enterHome, 280);
  }

  loadingFrame = requestAnimationFrame(updateLoading);
}

function enterHome() {
  cancelAnimationFrame(loadingFrame);
  showScreen(home);
  opening.classList.remove('is-active');
}

function showToast(label) {
  clearTimeout(toastTimer);
  toast.textContent = label === '首页' ? '已在首页' : /(已|请|正在|暂不可用)/.test(label) ? label : `${label}功能暂不可用`;
  toast.classList.add('is-visible');
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1600);
}

document.querySelector('[data-enter]').addEventListener('click', async () => {
  enterLogin();
  try {
    const status = await apiRequest('/api/auth/status', { timeoutMs: 4000 });
    if (!status.authenticated) {
      return;
    }
    if (status.mustChangePassword) {
      enterLogin();
      loginError.textContent = '管理员已重置密码，请先完成密码修改';
      return;
    }
    await loadCurrentUser();
    enterLoading();
  } catch {
    loginError.textContent = '';
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const qq = String(data.get('account')).trim();
  const password = String(data.get('password'));
  if (!qq || !password) {
    loginError.textContent = '请输入账号和密码';
    return;
  }
  if (password.length < 8) {
    loginError.textContent = '密码至少需要8位';
    return;
  }
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  loginError.textContent = '正在验证档案…';
  try {
    try {
      await apiRequest('/api/auth/initialize', { method: 'POST', body: JSON.stringify({ qq, password }) });
    } catch (error) {
      if (error.code !== 'ACCOUNT_EXISTS') throw error;
      await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ qq, password }) });
    }
    await loadCurrentUser();
    loginError.textContent = '';
    enterLoading();
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED') loginError.textContent = '登录凭证未生效，请刷新页面后重试';
    else loginError.textContent = error.message || '登录失败，请稍后重试';
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-feature]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.feature === '剧情回忆') {
      renderMemories();
      showScreen(memoryScreen);
      if (apiUser) loadMemories().catch((error) => showToast(error.message));
    }
    else if (button.dataset.feature === '日常') {
      showScreen(dailyScreen);
      if (apiUser) refreshDailyFromApi().catch((error) => showToast(error.message));
      else renderDaily();
    }
    else if (button.dataset.feature === '社交') {
      showScreen(socialScreen);
      window.setTimeout(() => document.querySelector('#socialSearchInput').focus(), 350);
    }
    else if (button.dataset.feature === '商城') {
      showScreen(shopScreen);
      if (apiUser) loadShop().catch((error) => showToast(error.message));
      else showToast('商城需要登录后使用');
    }
    else if (button.dataset.feature === '角色') {
      ensureArchiveUi();
      setArchivePage('detail');
      showScreen(archiveScreen);
    }
    else if (button.dataset.feature === '背包') {
      renderBag();
      showScreen(bagScreen);
    }
    else if (button.dataset.feature === '图鉴') {
      showScreen(galleryScreen);
      if (apiUser) loadSummonState().catch((error) => showToast(error.message));
      else renderGallery();
    }
    else if (button.dataset.feature === '召集') {
      showScreen(summonScreen);
      if (apiUser) loadSummonState().catch((error) => showToast(error.message));
      else renderSummonDemo();
    }
    else if (button.dataset.feature === '活动') openActivityDialog();
    else showToast(button.dataset.feature);
  });
});

const DAILY_STORAGE_KEY = 'fanlongDailyDemoV1';
const dailyDate = new Date();
const dailyDateKey = `${dailyDate.getFullYear()}-${String(dailyDate.getMonth() + 1).padStart(2, '0')}-${String(dailyDate.getDate()).padStart(2, '0')}`;
const dailyStatNames = ['颜值', '魅力', '智力', '商业', '口才', '体能', '才艺', '威慑'];

function createDemoBlindBoxReward() {
  const amount = Math.floor(Math.random() * 11) - 2;
  const net = amount - 4;
  let comment = '😭 非酋';
  if (net >= 3) comment = '✨ 欧皇附体！';
  else if (net > 0) comment = '小赚一笔。';
  else if (net === 0) comment = '保本不亏。';
  else if (net >= -3) comment = '小亏一点。';
  const fragment = Math.random() <= 0.15 ? '幸运碎片' : null;
  return { amount, currency: 'yuCoin', unit: '虞元', cost: 4, net, comment, fragment, fragmentName: '幸运碎片' };
}

function createDailyState() {
  return {
    date: dailyDateKey,
    signedIn: false,
    trainingCount: 0,
    blindBoxCount: 0,
    signResult: '尚未领取今日签到奖励',
    trainingResult: '尚未进行训练',
    blindBoxResult: '尚未开启盲盒',
    logs: []
  };
}

function loadDailyState() {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY) || 'null');
    if (saved?.date === dailyDateKey) return { ...createDailyState(), ...saved };
  } catch {}
  return createDailyState();
}

let dailyState = loadDailyState();
const dailySignAction = document.querySelector('#dailySignAction');
const dailyTrainingAction = document.querySelector('#dailyTrainingAction');
const dailyBoxSingle = document.querySelector('#dailyBoxSingle');
const dailyBoxTen = document.querySelector('#dailyBoxTen');
const dailySignResult = document.querySelector('#dailySignResult');
const dailyTrainingResult = document.querySelector('#dailyTrainingResult');
const dailyBoxResult = document.querySelector('#dailyBoxResult');

function formatDailyBoxReward(reward) {
  if (typeof reward.amount !== 'number') return String(reward.amount ?? reward.fragment ?? '获得奖励');
  const amount = reward.amount >= 0 ? '+' : '';
  const currency = reward.unit || (reward.currency === 'reputation' ? '名誉' : '虞元');
  const parts = [`${amount}${reward.amount}${currency}`];
  if (reward.comment) parts.push(reward.comment);
  if (reward.fragment) parts.push(`${reward.fragment} ×1`);
  return parts.join(' · ');
}

function dailyNowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function createDailyLog(type, reward, extra = {}) {
  return {
    type,
    actionType: type,
    reward,
    time: dailyNowTime(),
    createdAt: new Date().toISOString(),
    ...extra
  };
}

function dailyLogType(log) {
  return log.type || log.actionType || log.action_type || log.source || 'record';
}

function dailyLogReward(log) {
  const reward = log.reward || log.reward_json || log.result || {};
  if (typeof reward === 'string') {
    try { return JSON.parse(reward); }
    catch { return reward; }
  }
  return reward;
}

function dailyLogBatch(log) {
  return log.batchId || log.batch_id || '';
}

function dailyLogTime(log) {
  const raw = log.time || log.createdAt || log.created_at;
  if (!raw) return '--:--';
  if (/^\d{1,2}:\d{2}/.test(String(raw))) return String(raw).slice(0, 5);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function dailyLogCreatedAt(log, fallback) {
  const raw = log.createdAt || log.created_at || '';
  const timestamp = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(timestamp) ? fallback : timestamp;
}

function dailyActionLabel(type) {
  if (type === 'signin' || type === 'sign_in') return '签到';
  if (type === 'training' || type === 'train') return '训练';
  if (type === 'blind_box' || type === 'blindBox') return '盲盒';
  return '记录';
}

function dailyResultClass(type) {
  if (type === 'signin' || type === 'sign_in') return 'daily-sign-result';
  if (type === 'training' || type === 'train') return 'daily-training-result';
  if (type === 'blind_box' || type === 'blindBox') return 'daily-box-result';
  return '';
}

function formatDailyLogResult(log) {
  const type = dailyLogType(log);
  const reward = dailyLogReward(log);
  if (type === 'signin' || type === 'sign_in') {
    const amount = Number(reward.amount || 0);
    const currency = reward.currency === 'reputation' ? '名誉' : '虞元';
    return `${currency} ${amount >= 0 ? '+' : ''}${amount}`;
  }
  if (type === 'training' || type === 'train') {
    return `${reward.label || reward.stat || '属性'} ${reward.amount ? '+1' : '已达上限'}`;
  }
  if (type === 'blind_box' || type === 'blindBox') return formatDailyBoxReward(reward);
  return typeof reward === 'string' ? reward : '已完成';
}

function renderDailyRecordItem(log, index) {
  const type = dailyLogType(log);
  const resultClass = dailyResultClass(type);
  return `<article class="daily-record">
    <span class="daily-record-index">${String(index + 1).padStart(2, '0')}</span>
    <strong class="daily-record-action">${escapeHtml(dailyActionLabel(type))}</strong>
    <span class="daily-record-result ${resultClass}">${escapeHtml(formatDailyLogResult(log))}</span>
    <time class="daily-record-time">${escapeHtml(dailyLogTime(log))}</time>
  </article>`;
}

function renderDailyBatchItem(logs, index) {
  const time = dailyLogTime(logs[0]);
  const details = logs.map((log, detailIndex) => `<li><i>${String(detailIndex + 1).padStart(2, '0')}</i><span>${escapeHtml(formatDailyLogResult(log))}</span></li>`).join('');
  return `<details class="daily-record-batch">
    <summary>
      <span class="daily-record-index">${String(index + 1).padStart(2, '0')}</span>
      <strong class="daily-record-action">盲盒</strong>
      <span class="daily-record-result daily-box-result">十连盲盒 · ${logs.length} 条明细</span>
      <time class="daily-record-time">${escapeHtml(time)}</time>
    </summary>
    <ol class="daily-record-details">${details}</ol>
  </details>`;
}

function buildDailyRecordItems(logs) {
  const sorted = logs
    .map((log, originalIndex) => ({ log, originalIndex, createdAt: dailyLogCreatedAt(log, originalIndex) }))
    .sort((a, b) => a.createdAt - b.createdAt || a.originalIndex - b.originalIndex);
  const items = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index].log;
    const type = dailyLogType(current);
    const batch = dailyLogBatch(current);
    if ((type === 'blind_box' || type === 'blindBox') && batch) {
      const group = [current];
      let nextIndex = index + 1;
      while (nextIndex < sorted.length && dailyLogBatch(sorted[nextIndex].log) === batch) {
        group.push(sorted[nextIndex].log);
        nextIndex += 1;
      }
      if (group.length >= 10) {
        items.push({ type: 'batch', logs: group });
        index = nextIndex - 1;
        continue;
      }
    }
    items.push({ type: 'single', log: current });
  }
  return items;
}

function dailyLogsOf(type) {
  return (dailyState.logs || []).filter((log) => {
    const logType = dailyLogType(log);
    if (type === 'signin') return logType === 'signin' || logType === 'sign_in';
    if (type === 'training') return logType === 'training' || logType === 'train';
    if (type === 'blind_box') return logType === 'blind_box' || logType === 'blindBox';
    return false;
  });
}

function latestDailyLog(type) {
  return dailyLogsOf(type)
    .map((log, index) => ({ log, createdAt: dailyLogCreatedAt(log, index), index }))
    .sort((a, b) => b.createdAt - a.createdAt || b.index - a.index)[0]?.log || null;
}

function summarizeTrainingResult(logs) {
  if (!logs.length) return '今日未训练';
  return logs.slice(-2).map((log) => formatDailyLogResult(log)).join(' / ');
}

function summarizeBlindBoxResult(logs) {
  if (!logs.length) return '今日未开启';
  const latestBatch = dailyLogBatch(logs[logs.length - 1]);
  const batchLogs = latestBatch ? logs.filter((log) => dailyLogBatch(log) === latestBatch) : [];
  if (batchLogs.length >= 10) {
    const total = batchLogs.reduce((sum, log) => {
      const reward = dailyLogReward(log);
      return sum + (typeof reward.amount === 'number' ? reward.amount : 0);
    }, 0);
    const reward = dailyLogReward(batchLogs[0]);
    const unit = reward.unit || (reward.currency === 'reputation' ? '名誉' : '虞元');
    return `十连完成 · ${total >= 0 ? '+' : ''}${total}${unit}`;
  }
  if (logs.length > 1) return `${formatDailyLogResult(logs[logs.length - 1])} · 共${logs.length}抽`;
  return formatDailyLogResult(logs[0]);
}

function saveDailyState() {
  localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(dailyState));
}

function renderDaily() {
  document.querySelector('#dailySignProgress').textContent = `${dailyState.signedIn ? 1 : 0}/1`;
  document.querySelector('#dailyTrainingProgress').textContent = `${dailyState.trainingCount}/2`;
  document.querySelector('#dailyBoxProgress').textContent = `${dailyState.blindBoxCount}/10`;
  const signinLog = latestDailyLog('signin');
  const trainingLogs = dailyLogsOf('training');
  const blindBoxLogs = dailyLogsOf('blind_box');
  dailySignResult.textContent = signinLog ? formatDailyLogResult(signinLog) : '今日未签到';
  dailyTrainingResult.textContent = summarizeTrainingResult(trainingLogs);
  dailyBoxResult.textContent = summarizeBlindBoxResult(blindBoxLogs);
  dailySignAction.disabled = dailyState.signedIn;
  dailyTrainingAction.disabled = dailyState.trainingCount >= 2;
  dailyBoxSingle.disabled = dailyState.blindBoxCount >= 10;
  dailyBoxTen.disabled = dailyState.blindBoxCount !== 0;
  dailySignAction.querySelector('span').textContent = dailyState.signedIn ? '已签到' : '进行';
  dailyTrainingAction.querySelector('span').textContent = dailyState.trainingCount >= 2 ? '已完成' : '进行';
}

function openDailyDetail(type) {
  const logs = dailyLogsOf(type);
  const titles = { signin: '签到奖励', training: '训练结果', blind_box: '盲盒结果' };
  if (!logs.length) {
    openTerminalDialog({
      title: titles[type],
      cancelLabel: '关闭',
      hideConfirm: true,
      html: `<p class="dialog-target">${type === 'signin' ? '今日尚未签到' : type === 'training' ? '今日尚未训练' : '今日尚未开启盲盒'}</p>`
    });
    return;
  }
  const rows = logs.map((log, index) => `<li><i>${String(index + 1).padStart(2, '0')}</i><span>${escapeHtml(formatDailyLogResult(log))}<small>${escapeHtml(dailyLogTime(log))}</small></span></li>`).join('');
  openTerminalDialog({
    title: titles[type],
    cancelLabel: '关闭',
    hideConfirm: true,
    html: `<p class="dialog-target">今日共 ${logs.length} 条记录</p><ol class="daily-box-dialog-results daily-detail-dialog-results">${rows}</ol>`
  });
}

function applyDailyApiState(state) {
  dailyState = {
    date: state.date,
    signedIn: state.signin.used > 0,
    trainingCount: state.training.used,
    blindBoxCount: state.blindBox.used,
    signResult: '尚未领取今日签到奖励',
    trainingResult: '尚未进行训练',
    blindBoxResult: '尚未开启盲盒',
    logs: state.logs || []
  };
  if (apiUser && state.currency) {
    apiUser.currency = state.currency;
    document.querySelector('#currency').textContent = state.currency.yuCoin;
    document.querySelector('#reputation').textContent = state.currency.reputation;
    document.querySelector('#bagCurrency').textContent = state.currency.yuCoin;
    document.querySelector('#bagReputation').textContent = state.currency.reputation;
  }
  renderDaily();
}

async function refreshDailyFromApi() {
  const state = await apiRequest('/api/daily');
  applyDailyApiState(state);
  return state;
}

function openDailyBoxResultDialog(result) {
  const rows = (result.results || []).map((item, index) => {
    return `<li><i>${String(index + 1).padStart(2, '0')}</i><span>${escapeHtml(formatDailyBoxReward(item))}</span></li>`;
  }).join('');
  const unit = result.unit || (result.rewardCurrency === 'reputation' ? '名誉' : '虞元');
  const totalReward = typeof result.totalReward === 'number' ? `${result.totalReward >= 0 ? '+' : ''}${result.totalReward}${unit}` : String(result.totalReward || '0');
  const fragmentLine = result.fragment?.count ? `<p class="dialog-target">碎片掉落：${escapeHtml(result.fragment.name)} × ${result.fragment.count}</p>` : '';
  const netLine = typeof result.net === 'number' ? `<p class="dialog-target">成本：${result.cost}虞元 · 净变化：${result.net >= 0 ? '+' : ''}${result.net}虞元</p>` : `<p class="dialog-target">成本：${result.cost || 0}虞元</p>`;
  openTerminalDialog({
    title: result.count === 10 ? '盲盒十连结果' : '盲盒结果',
    cancelLabel: '关闭',
    hideConfirm: true,
    html: `<p class="dialog-target">共 ${result.count || result.results.length} 次 · 合计 ${totalReward}</p>${netLine}${fragmentLine}<ol class="daily-box-dialog-results">${rows}</ol>`
  });
}

function operationHeaders(action) {
  return { 'Idempotency-Key': `${action}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}` };
}

dailySignAction.addEventListener('click', async () => {
  if (dailyState.signedIn) return;
  if (apiUser) {
    dailySignAction.disabled = true;
    try {
      const result = await apiRequest('/api/daily/signin', { method: 'POST', headers: operationHeaders('signin') });
      await refreshDailyFromApi();
      showToast(`签到成功·${result.reward.amount >= 0 ? '+' : ''}${result.reward.amount}${result.reward.currency === 'reputation' ? '名誉' : '虞元'}`);
    } catch (error) { showToast(error.message); renderDaily(); }
    return;
  }
  dailyState.signedIn = true;
  dailyState.signResult = '签到奖励：虞元 +5';
  dailyState.logs.push(createDailyLog('signin', { amount: 5, currency: 'yuCoin' }));
  saveDailyState();
  renderDaily();
  showToast('已完成今日签到');
});

dailyTrainingAction.addEventListener('click', async () => {
  if (dailyState.trainingCount >= 2) return;
  if (apiUser) {
    dailyTrainingAction.disabled = true;
    try {
      const result = await apiRequest('/api/daily/train', { method: 'POST', headers: operationHeaders('train') });
      await refreshDailyFromApi();
      showToast(`${result.reward.label}${result.reward.amount ? ' +1' : ' 已达上限'}`);
    } catch (error) { showToast(error.message); renderDaily(); }
    return;
  }
  const stat = dailyStatNames[Math.floor(Math.random() * dailyStatNames.length)];
  dailyState.trainingCount += 1;
  dailyState.trainingResult = `第 ${dailyState.trainingCount} 次训练：${stat} +1`;
  dailyState.logs.push(createDailyLog('training', { label: stat, amount: 1 }));
  saveDailyState();
  renderDaily();
  showToast(`已完成训练·${stat} +1`);
});

dailyBoxSingle.addEventListener('click', async () => {
  if (dailyState.blindBoxCount >= 10) return;
  if (apiUser) {
    dailyBoxSingle.disabled = true;
    try {
      const result = await apiRequest('/api/daily/blind-box', { method: 'POST', headers: operationHeaders('blind-single'), body: JSON.stringify({ count: 1 }) });
      await refreshDailyFromApi();
      openDailyBoxResultDialog(result);
    } catch (error) { showToast(error.message); renderDaily(); }
    return;
  }
  const reward = createDemoBlindBoxReward();
  dailyState.blindBoxCount += 1;
  dailyState.logs.push(createDailyLog('blind_box', reward));
  dailyState.blindBoxResult = `第 ${dailyState.blindBoxCount} 抽：${formatDailyBoxReward(reward)}`;
  saveDailyState();
  renderDaily();
  openDailyBoxResultDialog({ count: 1, cost: 4, totalReward: reward.amount, rewardCurrency: 'yuCoin', unit: '虞元', net: reward.net, fragment: { name: '幸运碎片', count: reward.fragment ? 1 : 0 }, results: [reward] });
});

dailyBoxTen.addEventListener('click', async () => {
  if (dailyState.blindBoxCount !== 0) return;
  if (apiUser) {
    dailyBoxTen.disabled = true;
    try {
      const result = await apiRequest('/api/daily/blind-box', { method: 'POST', headers: operationHeaders('blind-ten'), body: JSON.stringify({ count: 10 }) });
      await refreshDailyFromApi();
      openDailyBoxResultDialog(result);
    } catch (error) { showToast(error.message); renderDaily(); }
    return;
  }
  const rewards = Array.from({ length: 10 }, () => createDemoBlindBoxReward());
  const batchId = `blind-ten-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const time = dailyNowTime();
  dailyState.blindBoxCount = 10;
  dailyState.logs.push(...rewards.map((reward, index) => createDailyLog('blind_box', reward, { batchId, sequenceNo: index + 1, createdAt, time })));
  dailyState.blindBoxResult = `十连结果：${rewards.reduce((sum, reward) => sum + reward.amount, 0)}虞元`;
  saveDailyState();
  renderDaily();
  openDailyBoxResultDialog({
    count: 10,
    cost: 40,
    totalReward: rewards.reduce((sum, reward) => sum + reward.amount, 0),
    rewardCurrency: 'yuCoin',
    unit: '虞元',
    net: rewards.reduce((sum, reward) => sum + reward.amount, 0) - 40,
    fragment: { name: '幸运碎片', count: rewards.filter((reward) => reward.fragment).length },
    results: rewards
  });
});

document.querySelectorAll('[data-daily-detail]').forEach((button) => {
  button.addEventListener('click', () => openDailyDetail(button.dataset.dailyDetail));
});
document.querySelector('#dailyBack').addEventListener('click', () => showScreen(home));
renderDaily();

const socialSearchForm = document.querySelector('#socialSearchForm');
const socialSearchInput = document.querySelector('#socialSearchInput');
let selectedSocialPlayer = null;

function renderSocialSelection() {
  const panel = document.querySelector('#socialSelection');
  const avatar = document.querySelector('#socialSelectionAvatar');
  const name = document.querySelector('#socialSelectionName');
  panel.classList.toggle('has-player', Boolean(selectedSocialPlayer));
  panel.querySelector('span').textContent = selectedSocialPlayer ? '当前已选择' : '当前未选择玩家';
  name.textContent = selectedSocialPlayer?.name || '请先搜索';
  avatar.hidden = !selectedSocialPlayer?.avatarUrl;
  if (selectedSocialPlayer?.avatarUrl) avatar.src = apiAssetUrl(selectedSocialPlayer.avatarUrl);
}

socialSearchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = socialSearchInput.value.trim();
  if (!query) {
    showToast('请输入玩家姓名或账号');
    socialSearchInput.focus();
    return;
  }
  if (!apiUser) {
    selectedSocialPlayer = { id: query, name: query };
    renderSocialSelection();
    showToast(`已选择玩家·${query}`);
    return;
  }
  try {
    selectedSocialPlayer = await apiRequest(`/api/social/search?q=${encodeURIComponent(query)}`);
    socialSearchInput.value = selectedSocialPlayer.name;
    renderSocialSelection();
    showToast(`已选择玩家·${selectedSocialPlayer.name}`);
  } catch (error) { selectedSocialPlayer = null; renderSocialSelection(); showToast(error.message); }
});

document.querySelectorAll('[data-social-action]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!selectedSocialPlayer) {
      showToast('请先搜索并选择玩家');
      socialSearchInput.focus();
      return;
    }
    if (!apiUser) { showToast(`正在处理${selectedSocialPlayer.name}`); return; }
    const target = selectedSocialPlayer;
    if (button.dataset.socialAction === 'profile') {
      apiRequest(`/api/social/users/${encodeURIComponent(target.id)}`).then((profile) => {
        openTerminalDialog({
          title: `${profile.name}的档案`, hideConfirm: true, cancelLabel: '关闭',
          dialogClass: 'dialog-social-profile',
          html: `${profile.avatarUrl ? `<img class="dialog-avatar" src="${escapeHtml(apiAssetUrl(profile.avatarUrl))}" alt="">` : ''}<dl>${profile.profile.map((field) => `<dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value || '暂无记录')}</dd>`).join('')}</dl>`
        });
      }).catch((error) => showToast(error.message));
    } else if (button.dataset.socialAction === 'yuyuan') {
      openTerminalDialog({
        title: '赠送虞元', confirmLabel: '确认赠送',
        html: `<p class="dialog-target">接收者：${escapeHtml(target.name)}</p><label>赠送数量<input id="dialogCurrencyAmount" type="number" min="1" step="1" inputmode="numeric" placeholder="请输入正整数"></label><p>当前虞元：${escapeHtml(apiUser.currency.yuCoin)}</p>`,
        onConfirm: async () => {
          const amount = Number(document.querySelector('#dialogCurrencyAmount').value);
          if (!Number.isInteger(amount) || amount <= 0) throw new Error('请输入正确的赠送数量');
          const result = await apiRequest('/api/social/transfer-currency', { method: 'POST', headers: operationHeaders('transfer-currency'), body: JSON.stringify({ targetId: target.id, currency: 'yuCoin', amount }) });
          apiUser.currency.yuCoin = result.senderBalance;
          document.querySelector('#currency').textContent = result.senderBalance;
          document.querySelector('#bagCurrency').textContent = result.senderBalance;
          closeTerminalDialog(); showToast(`已向${target.name}赠送${amount}虞元`);
        }
      });
    } else {
      apiRequest('/api/inventory').then((inventory) => {
        const options = inventory.items.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}（${item.count}）</option>`).join('');
        openTerminalDialog({
          title: '赠送道具', confirmLabel: '确认赠送',
          html: `<p class="dialog-target">接收者：${escapeHtml(target.name)}</p><label>选择道具<select id="dialogItemName">${options}</select></label><label>赠送数量<input id="dialogItemAmount" type="number" min="1" step="1" value="1"></label>`,
          onConfirm: async () => {
            const item = document.querySelector('#dialogItemName').value;
            const amount = Number(document.querySelector('#dialogItemAmount').value);
            if (!item || !Number.isInteger(amount) || amount <= 0) throw new Error('请选择道具并填写正确数量');
            await apiRequest('/api/social/transfer-item', { method: 'POST', headers: operationHeaders('transfer-item'), body: JSON.stringify({ targetId: target.id, item, amount }) });
            applyApiInventory(await apiRequest('/api/inventory'));
            closeTerminalDialog(); showToast(`已向${target.name}赠送${item}×${amount}`);
          }
        });
      }).catch((error) => showToast(error.message));
    }
  });
});

document.querySelector('#socialBack').addEventListener('click', () => showScreen(home));
renderSocialSelection();

let shopItems = [];
let shopChannel = 'yuCoin';
let shopCategory = 'all';
let shopPageIndex = 0;
const shopPageSize = 10;

function shopItemCategory(item) {
  if (item.type === 'equip') return 'equip';
  if (item.type === 'consumable') return 'consumable';
  return item.type || 'other';
}

const shopCategoryLabels = { consumable: '道具', equip: '服饰', other: '其他' };

function renderShopTaxonomy() {
  const channels = [...new Set(shopItems.map((item) => item.channel))];
  document.querySelectorAll('[data-shop-channel]').forEach((button) => { button.hidden = !channels.includes(button.dataset.shopChannel); });
  if (!channels.includes(shopChannel)) shopChannel = channels[0] || 'yuCoin';
  document.querySelectorAll('[data-shop-channel]').forEach((button) => button.classList.toggle('is-active', button.dataset.shopChannel === shopChannel));
  const categories = [...new Set(shopItems.filter((item) => item.channel === shopChannel).map(shopItemCategory))];
  if (shopCategory !== 'all' && !categories.includes(shopCategory)) shopCategory = 'all';
  document.querySelector('#shopCategories').innerHTML = [
    ['all', '全部'],
    ...categories.map((category) => [category, shopCategoryLabels[category] || category])
  ].map(([key, label]) => `<button class="${shopCategory === key ? 'is-active' : ''}" data-shop-category="${escapeHtml(key)}" type="button">${escapeHtml(label)}</button>`).join('');
}

function filteredShopItems() {
  return shopItems.filter((item) => item.channel === shopChannel && (shopCategory === 'all' || shopItemCategory(item) === shopCategory));
}

function shopPageCount() {
  return Math.max(1, Math.ceil(filteredShopItems().length / shopPageSize));
}

function changeShopPage(delta) {
  const nextPage = Math.max(0, Math.min(shopPageIndex + delta, shopPageCount() - 1));
  if (nextPage === shopPageIndex) return false;
  shopPageIndex = nextPage;
  renderShop();
  return true;
}

function renderShop() {
  const filtered = filteredShopItems();
  const pages = Math.max(1, Math.ceil(filtered.length / shopPageSize));
  shopPageIndex = Math.max(0, Math.min(shopPageIndex, pages - 1));
  const visible = filtered.slice(shopPageIndex * shopPageSize, (shopPageIndex + 1) * shopPageSize);
  document.querySelector('#shopPage').textContent = `${String(shopPageIndex + 1).padStart(2, '0')} / ${String(pages).padStart(2, '0')}`;
  document.querySelector('#shopPrev').disabled = shopPageIndex === 0;
  document.querySelector('#shopNext').disabled = shopPageIndex >= pages - 1;
  document.querySelector('#shopEmpty').classList.toggle('is-visible', !visible.length);
  document.querySelector('#shopGrid').innerHTML = visible.map((item, index) => {
    const soldOut = item.stock === 0;
    const price = item.channel === 'compound' ? '查看配方' : `${item.price} ${item.currency === 'reputation' ? '名誉' : '虞元'}`;
    return `<button class="shop-card ${soldOut ? 'is-sold-out' : ''}" data-shop-item="${escapeHtml(item.name)}" type="button" style="--delay:${index * 35}ms">
      <img src="${encodeURI(itemAssetPath(item))}" alt="" onerror="this.onerror=null;this.src='assets/ui/web/通用占位图.webp'">
      <h2>${escapeHtml(item.name)}</h2>
      <footer><span>${price}</span><small>${soldOut ? '已售罄' : item.stock < 0 ? `持有 ${item.owned}` : `库存 ${item.stock}`}</small></footer>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-shop-item]').forEach((button) => button.addEventListener('click', () => openShopPurchase(shopItems.find((item) => item.name === button.dataset.shopItem))));
}

async function loadShop() {
  const data = await apiRequest('/api/shop');
  shopItems = data.items || [];
  document.querySelector('#shopReputation').textContent = apiUser?.currency.reputation ?? 0;
  document.querySelector('#shopCurrency').textContent = apiUser?.currency.yuCoin ?? 0;
  renderShopTaxonomy();
  renderShop();
}

function openShopPurchase(item) {
  if (!item) return;
  if (item.stock === 0) { showToast('该商品已售罄'); return; }
  const recipeEntries = Object.entries(item.recipe || {});
  const recipeHtml = recipeEntries.length ? `<dl>${recipeEntries.map(([name, amount]) => `<dt>${escapeHtml(name === 'yuCoin' ? '虞元' : name === 'reputation' ? '名誉' : name)}</dt><dd>${amount} / 件</dd>`).join('')}</dl>` : '';
  openTerminalDialog({
    title: item.channel === 'compound' ? '确认合成兑换' : '确认购买',
    confirmLabel: item.channel === 'compound' ? '确认兑换' : '确认购买',
    html: `<p class="dialog-target">${escapeHtml(item.name)} · 当前持有 ${item.owned}${item.stock >= 0 ? ` · 库存 ${item.stock}` : ''}</p><p>${escapeHtml(item.description)}</p>${recipeHtml}<label>数量<input id="dialogShopCount" type="number" min="1" max="999" step="1" value="1"></label>`,
    onConfirm: async () => {
      const count = Number(document.querySelector('#dialogShopCount').value);
      if (!Number.isInteger(count) || count <= 0) throw new Error('请输入正确数量');
      const endpoint = item.channel === 'compound' ? '/api/shop/compound' : '/api/shop/purchase';
      const result = await apiRequest(endpoint, { method: 'POST', headers: operationHeaders(item.channel === 'compound' ? 'compound' : 'purchase'), body: JSON.stringify({ item: item.name, count }) });
      await loadCurrentUser();
      await loadShop();
      closeTerminalDialog();
      showToast(`${item.channel === 'compound' ? '兑换' : '购买'}成功·${result.item}×${result.count}`);
    }
  });
}

document.querySelector('#shopBack').addEventListener('click', () => showScreen(home));
document.querySelector('#shopTabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-shop-channel]');
  if (!button || button.hidden) return;
  shopChannel = button.dataset.shopChannel; shopCategory = 'all'; shopPageIndex = 0;
  renderShopTaxonomy(); renderShop();
});
document.querySelector('#shopCategories').addEventListener('click', (event) => {
  const button = event.target.closest('[data-shop-category]');
  if (!button) return;
  shopCategory = button.dataset.shopCategory; shopPageIndex = 0;
  renderShopTaxonomy(); renderShop();
});
document.querySelector('#shopPrev').addEventListener('click', () => changeShopPage(-1));
document.querySelector('#shopNext').addEventListener('click', () => changeShopPage(1));

const shopCatalog = document.querySelector('.shop-catalog');
let shopSwipeStartX = 0;
let shopSwipeStartY = 0;
let shopSwipePointerId = null;
let shopSwipeSuppressClick = false;

shopCatalog.addEventListener('pointerdown', (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  shopSwipeStartX = event.clientX;
  shopSwipeStartY = event.clientY;
  shopSwipePointerId = event.pointerId;
});
shopCatalog.addEventListener('pointerup', (event) => {
  if (shopSwipePointerId !== event.pointerId) return;
  const deltaX = event.clientX - shopSwipeStartX;
  const deltaY = event.clientY - shopSwipeStartY;
  shopSwipePointerId = null;
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
  const changed = changeShopPage(deltaX < 0 ? 1 : -1);
  if (changed) {
    shopSwipeSuppressClick = true;
    window.setTimeout(() => { shopSwipeSuppressClick = false; }, 350);
  }
});
shopCatalog.addEventListener('pointercancel', () => { shopSwipePointerId = null; });
shopCatalog.addEventListener('click', (event) => {
  if (!shopSwipeSuppressClick) return;
  event.preventDefault();
  event.stopPropagation();
  shopSwipeSuppressClick = false;
}, true);

const avatarControl = document.querySelector('#avatarControl');
const avatarInput = document.querySelector('#avatarInput');
const playerAvatar = document.querySelector('#playerAvatar');
const AVATAR_STORAGE_KEY = 'fanlongPlayerAvatarV1';
const avatarCropper = document.querySelector('#avatarCropper');
const avatarCropCanvas = document.querySelector('#avatarCropCanvas');
const avatarCropContext = avatarCropCanvas.getContext('2d');
const avatarCropZoom = document.querySelector('#avatarCropZoom');
const avatarCropStage = document.querySelector('.avatar-crop-stage');
let cropImage;
let cropBaseScale = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropDragging = false;
let cropPointerX = 0;
let cropPointerY = 0;

function setPlayerAvatar(source) {
  playerAvatar.src = source || '';
  playerAvatar.alt = source ? '玩家自定义头像' : '';
  avatarControl.classList.toggle('has-avatar', Boolean(source));
}

setPlayerAvatar(localStorage.getItem(AVATAR_STORAGE_KEY));
avatarControl.addEventListener('click', () => avatarInput.click());

function clampCropOffset() {
  if (!cropImage) return;
  const scale = cropBaseScale * Number(avatarCropZoom.value) / 100;
  const maxX = Math.max(0, (cropImage.naturalWidth * scale - 320) / 2);
  const maxY = Math.max(0, (cropImage.naturalHeight * scale - 320) / 2);
  cropOffsetX = Math.max(-maxX, Math.min(maxX, cropOffsetX));
  cropOffsetY = Math.max(-maxY, Math.min(maxY, cropOffsetY));
}

function drawAvatarCrop() {
  if (!cropImage) return;
  clampCropOffset();
  const scale = cropBaseScale * Number(avatarCropZoom.value) / 100;
  const width = cropImage.naturalWidth * scale;
  const height = cropImage.naturalHeight * scale;
  avatarCropContext.clearRect(0, 0, 320, 320);
  avatarCropContext.drawImage(cropImage, (320 - width) / 2 + cropOffsetX, (320 - height) / 2 + cropOffsetY, width, height);
}

function closeAvatarCropper() {
  avatarCropper.classList.remove('is-open');
  avatarCropper.setAttribute('aria-hidden', 'true');
  cropDragging = false;
}

avatarInput.addEventListener('change', () => {
  const file = avatarInput.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    cropImage = new Image();
    cropImage.addEventListener('load', () => {
      cropBaseScale = Math.max(320 / cropImage.naturalWidth, 320 / cropImage.naturalHeight);
      cropOffsetX = 0; cropOffsetY = 0; avatarCropZoom.value = 100;
      drawAvatarCrop();
      avatarCropper.classList.add('is-open');
      avatarCropper.setAttribute('aria-hidden', 'false');
    });
    cropImage.src = reader.result;
  });
  reader.readAsDataURL(file);
  avatarInput.value = '';
});

avatarCropZoom.addEventListener('input', drawAvatarCrop);
avatarCropStage.addEventListener('pointerdown', (event) => {
  cropDragging = true; cropPointerX = event.clientX; cropPointerY = event.clientY;
  avatarCropStage.setPointerCapture(event.pointerId);
});
avatarCropStage.addEventListener('pointermove', (event) => {
  if (!cropDragging) return;
  const rect = avatarCropStage.getBoundingClientRect();
  cropOffsetX += (event.clientX - cropPointerX) * 320 / rect.width;
  cropOffsetY += (event.clientY - cropPointerY) * 320 / rect.height;
  cropPointerX = event.clientX; cropPointerY = event.clientY;
  drawAvatarCrop();
});
avatarCropStage.addEventListener('pointerup', () => { cropDragging = false; });
avatarCropStage.addEventListener('pointercancel', () => { cropDragging = false; });
document.querySelector('#avatarCropSave').addEventListener('click', async () => {
  const saveButton = document.querySelector('#avatarCropSave');
  saveButton.disabled = true;
  try {
    const blob = await new Promise((resolve, reject) => avatarCropCanvas.toBlob((value) => value ? resolve(value) : reject(new Error('头像生成失败')), 'image/jpeg', .9));
    if (apiUser) {
      const form = new FormData();
      form.append('avatar', blob, 'avatar.jpg');
      const result = await apiRequest('/api/me/avatar', { method: 'POST', body: form });
      setPlayerAvatar(`${apiAssetUrl(result.avatarUrl)}?v=${Date.now()}`);
      apiUser.avatarUrl = result.avatarUrl;
    } else {
      const avatarData = avatarCropCanvas.toDataURL('image/jpeg', .88);
      localStorage.setItem(AVATAR_STORAGE_KEY, avatarData);
      setPlayerAvatar(avatarData);
    }
    closeAvatarCropper();
    showToast('头像已更换');
  } catch (error) {
    showToast(error.message || '头像保存失败，请重试');
  } finally {
    saveButton.disabled = false;
  }
});
document.querySelector('#avatarCropCancel').addEventListener('click', closeAvatarCropper);
document.querySelector('#avatarCropClose').addEventListener('click', closeAvatarCropper);

let bagItems = [
  { id: 'letter', name: '手写信件', type: '信件', count: 3, image: 'assets/ui/bag-items/letter.png', description: '一封字迹娟秀的信，信封上是熟悉的香气，似乎承载着未说出口的话语。', usable: true },
  { id: 'perfume', name: '蔷薇香水', type: '礼物', count: 5, image: 'assets/ui/bag-items/perfume.png', description: '以夜色蔷薇调制的香水，香气清冷而持久，适合赠予重要之人。', usable: true },
  { id: 'brooch', name: '紫晶胸针', type: '服饰', count: 2, image: 'assets/ui/bag-items/brooch.png', description: '紫色晶石缀成的花枝胸针，在灯下有细碎流光。', usable: true },
  { id: 'journal', name: '旧日手账', type: '道具', count: 1, image: 'journal.png', description: '记录着零散日期与只言片语的手账，也许能找到某段往事的线索。', usable: true },
  { id: 'key', name: '蕾丝钥匙', type: '道具', count: 2, image: 'key.png', description: '一枚造型精致的古钥匙，不知能打开哪一扇门。', usable: true },
  { id: 'bow', name: '暗纹领结', type: '服饰', count: 4, image: 'bow.png', description: '深色织缎领结，边缘缀有细密金线，端正而不显张扬。', usable: true },
  { id: 'watch', name: '复古怀表', type: '礼物', count: 1, image: 'watch.png', description: '表盖内刻着一句已经模糊的祝语，指针仍走得很准。', usable: true },
  { id: 'medal', name: '旧徽章', type: '道具', count: 6, image: 'medal.png', description: '一枚有些年头的金属徽章，背面的家族纹章仍清晰可辨。', usable: false },
  { id: 'flowers', name: '紫藤花束', type: '礼物', count: 3, image: 'flowers.png', description: '刚用金线扎好的紫藤花束，花瓣上还留着露水。', usable: true },
  { id: 'pass', name: '镜金通行函', type: '道具', count: 2, image: 'pass.png', description: '烫有特殊纹章的通行函，可在指定时间内进入虞宫部分区域。', usable: true },
  { id: 'ring', name: '星芒戒指', type: '礼物', count: 1, image: 'ring.png', description: '安放在黑色绒盒中的戒指，宝石上折射着星芒。', usable: true },
  { id: 'feather', name: '青羽笔', type: '道具', count: 2, image: 'feather.png', description: '一支笔尖锋利的青黑色羽笔，书写时几乎不会留下墨渍。', usable: true }
];

let selectedBagItemId = 'letter';
let bagFilter = '全部';

function renderBagFilters() {
  const types = [...new Set(bagItems.map((item) => item.type).filter(Boolean))];
  if (bagFilter !== '全部' && !types.includes(bagFilter)) bagFilter = '全部';
  document.querySelector('#bagFilters').innerHTML = [['全部', '全部'], ...types.map((type) => [type, type])]
    .map(([key, label]) => `<button class="${bagFilter === key ? 'is-active' : ''}" data-bag-filter="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join('');
  document.querySelector('#bagFilters').style.setProperty('--bag-filter-count', types.length + 1);
}

function renderBag() {
  renderBagFilters();
  const visibleItems = bagItems.filter((item) => bagFilter === '全部' || item.type === bagFilter);
  const selectedVisible = visibleItems.some((item) => item.id === selectedBagItemId);
  if (!selectedVisible && visibleItems[0]) selectedBagItemId = visibleItems[0].id;

  document.querySelector('#bagGrid').innerHTML = visibleItems.map((item) => `
    <button class="bag-item ${item.id === selectedBagItemId ? 'is-selected' : ''}" data-bag-item="${item.id}" aria-label="${item.name}，数量${item.count}">
      <img src="${encodeURI(item.image)}" alt="" onerror="this.onerror=null;this.src='assets/ui/web/通用占位图.webp'">
      <span>${item.count}</span>
    </button>`).join('');

  document.querySelectorAll('[data-bag-item]').forEach((button) => button.addEventListener('click', () => {
    selectedBagItemId = button.dataset.bagItem;
    renderBag();
  }));

  const item = bagItems.find((entry) => entry.id === selectedBagItemId);
  if (!item) return;
  const preview = document.querySelector('#bagPreviewImage');
  preview.classList.toggle('is-placeholder', item.image === 'assets/ui/web/通用占位图.webp');
  preview.src = item.image;
  preview.onerror = () => { preview.onerror = null; preview.src = 'assets/ui/web/通用占位图.webp'; };
  preview.alt = item.name;
  document.querySelector('#bagItemName').textContent = item.name;
  document.querySelector('#bagItemCount').textContent = item.count;
  document.querySelector('#bagItemDescription').textContent = item.description;
  const useButton = document.querySelector('#bagUseButton');
  useButton.disabled = !item.usable || item.count < 1;
  useButton.querySelector('span').textContent = item.count < 1 ? '已用完' : item.usable ? '使用' : '不可使用';
}

document.querySelector('#bagBack').addEventListener('click', () => showScreen(home));
document.querySelector('#bagFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-bag-filter]');
  if (!button) return;
  bagFilter = button.dataset.bagFilter;
  renderBag();
});
document.querySelector('#bagUseButton').addEventListener('click', () => {
  const item = bagItems.find((entry) => entry.id === selectedBagItemId);
  if (!item || !item.usable || item.count < 1) return;
  const needsChoice = item.subType === 'optional_pack';
  const options = Array.isArray(item.param) ? item.param : [];
  openTerminalDialog({
    title: '确认使用道具',
    confirmLabel: '确认使用',
    html: `<p class="dialog-target">${escapeHtml(item.name)} · 当前持有 ${item.count}</p>
      <p>${escapeHtml(item.description)}</p>
      <label>使用数量<input id="dialogUseCount" type="number" min="1" max="${item.count}" step="1" value="1"></label>
      ${needsChoice ? `<label>选择增加属性<select id="dialogUseChoice"><option value="">请选择</option>${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select></label>` : ''}`,
    onConfirm: async () => {
      const count = Number(document.querySelector('#dialogUseCount').value);
      const choice = needsChoice ? document.querySelector('#dialogUseChoice').value : '';
      if (!Number.isInteger(count) || count < 1 || count > item.count) throw new Error('请输入正确数量');
      if (needsChoice && !choice) throw new Error('请选择要增加的属性');
      const result = await apiRequest('/api/inventory/use', {
        method: 'POST',
        headers: operationHeaders('inventory-use'),
        body: JSON.stringify({ item: item.name, count, choice })
      });
      await loadCurrentUser();
      closeTerminalDialog();
      const changeText = (result.changes || []).map((change) => `${change.label}${change.amount >= 0 ? '+' : ''}${change.amount}`).join('、');
      showToast(`已使用·${result.item}${changeText ? ` · ${changeText}` : ''}`);
    }
  });
});
function openResourceGuide(resource) {
  const isReputation = resource === '名誉';
  openTerminalDialog({
    title: `${resource}获取说明`,
    hideConfirm: true,
    cancelLabel: '知道了',
    html: `<p class="dialog-target">当前${escapeHtml(resource)}：${isReputation ? apiUser?.currency.reputation ?? 0 : apiUser?.currency.yuCoin ?? 0}</p><p>${isReputation ? '名誉通过剧情、活动及管理结算获得。' : '虞元可通过签到、剧情结算、日常奖励或其他玩家赠送获得。'}</p><p>个人终端不直接充值或修改余额，所有变动以机器人数据库记录为准。</p>`
  });
}

document.querySelectorAll('[data-resource-add]').forEach((button) => button.addEventListener('click', () => openResourceGuide(button.dataset.resourceAdd)));

let galleryCards = [];
let galleryFilter = 'all';

function renderGallery() {
  const visible = galleryCards.filter((card) => galleryFilter === 'all' || card.rarity === galleryFilter);
  const ownedCount = galleryCards.reduce((sum, card) => sum + (card.unlocked ? Number(card.copies || 1) : 0), 0);
  if (!visible.length) {
    document.querySelector('#galleryGrid').innerHTML = '<div class="gallery-empty"><i>✦</i><strong>尚未获得人物卡</strong><span>前往召集页面抽取角色后，将在这里展示。</span></div>';
    document.querySelector('#galleryCount').textContent = `拥有 ${ownedCount}`;
    return;
  }
  document.querySelector('#galleryGrid').innerHTML = visible.map((card) => `
    <button class="gallery-card rarity-${card.rarity.toLowerCase()} ${card.unlocked ? '' : 'is-locked'}" data-gallery-card="${card.id}" aria-label="${card.name}，${card.rarity}${card.unlocked ? '，已解锁' : '，未解锁'}">
      <img src="${encodeURI(optimizedCardImage(card.image))}" alt="${escapeHtml(card.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/ui/web/通用占位图.webp'">
      <span class="gallery-rarity">${card.rarity}</span>
      <span class="gallery-card-name">${card.name}</span>
      <span class="gallery-stars">${card.rarity === 'SSR' ? '★★★★★' : card.rarity === 'SR' ? '★★★★☆' : '★★★☆☆'}</span>
      ${card.unlocked && Number(card.copies || 1) > 1 ? `<span class="gallery-copy-count">${Number(card.copies || 1)}</span>` : ''}
      ${card.unlocked ? '' : `<span class="gallery-lock">${renderLockIcon()}<b>尚未解锁</b></span>`}
    </button>`).join('');
  document.querySelector('#galleryCount').textContent = `拥有 ${ownedCount}`;
  document.querySelectorAll('[data-gallery-card]').forEach((button) => button.addEventListener('click', () => {
    const card = galleryCards.find((item) => item.id === button.dataset.galleryCard);
    if (!card.unlocked) {
      showToast(`${card.name}尚未解锁`);
      return;
    }
    openTerminalDialog({
      title: `${card.name} · ${card.rarity}`,
      hideConfirm: true,
      cancelLabel: '关闭大图',
      html: `<figure class="dialog-gallery-preview"><img src="${encodeURI(optimizedCardImage(card.image))}" alt="${escapeHtml(card.name)}" decoding="async" onerror="this.onerror=null;this.src='assets/ui/web/通用占位图.webp'"><figcaption>${escapeHtml(card.name)} · ${card.rarity} · 已获得 ${card.copies || 1} 张</figcaption></figure>`
    });
  }));
}

document.querySelector('#galleryBack').addEventListener('click', () => showScreen(home));
document.querySelectorAll('[data-gallery-filter]').forEach((button) => button.addEventListener('click', () => {
  galleryFilter = button.dataset.galleryFilter;
  document.querySelectorAll('[data-gallery-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
  renderGallery();
}));
document.querySelectorAll('[data-gallery-add]').forEach((button) => button.addEventListener('click', () => openResourceGuide(button.dataset.galleryAdd)));

let summonData = { balance: 0, prices: { single: 5, ten: 45 }, cards: [] };
function applySummonState(data) {
  summonData = { ...summonData, ...data };
  galleryCards = (data.cards || []).map((card) => ({ ...card, image: optimizedCardImage(card.image), unlocked: true }));
  document.querySelector('#summonBalance').textContent = summonData.balance;
  if (apiUser) {
    apiUser.currency.yuCoin = summonData.balance;
    document.querySelector('#currency').textContent = summonData.balance;
    document.querySelector('#bagCurrency').textContent = summonData.balance;
    document.querySelector('#shopCurrency').textContent = summonData.balance;
  }
  renderGallery();
}

async function loadSummonState() {
  const data = await apiRequest('/api/summon');
  applySummonState(data);
  return data;
}

function renderSummonDemo() {
  document.querySelector('#summonBalance').textContent = '—';
}

function renderSummonResults(result) {
  const grid = document.querySelector('#summonResultGrid');
  grid.classList.toggle('is-single', result.results.length === 1);
  document.querySelector('#summonResultSummary').textContent = `共获得 ${result.results.length} 个角色`;
  grid.innerHTML = result.results.map((card, index) => `
    <article class="summon-result-card rarity-${card.rarity.toLowerCase()}" style="--result-delay:${index * 90}ms">
      <div class="summon-card-light" aria-hidden="true"></div>
      <img src="${encodeURI(optimizedCardImage(card.image))}" alt="${escapeHtml(card.name)}" decoding="async" onerror="this.onerror=null;this.src='assets/ui/web/通用占位图.webp'">
      <span class="summon-card-rarity">${card.rarity}</span>
      ${card.isNew ? '<i>NEW</i>' : ''}
      <strong>${escapeHtml(card.name)}</strong>
    </article>`).join('');
  showScreen(summonResultScreen);
}

function confirmSummon(count) {
  if (!apiUser) { showToast('请登录后进行召集'); return; }
  const cost = count === 10 ? 45 : 5;
  if (summonData.balance < cost) { showToast(`虞元不足，需要${cost}`); return; }
  openTerminalDialog({
    title: '确认召集',
    confirmLabel: '确认召集',
    html: `<p>确定消耗 <b class="dialog-currency"><img src="assets/ui/虞元icon.png" alt="">${cost} 虞元</b>，召集${count}次吗？</p><p class="dialog-target">当前虞元：${summonData.balance}</p>`,
    onConfirm: async () => {
      const result = await apiRequest('/api/summon/draw', {
        method: 'POST', headers: operationHeaders(`summon-${count}`), body: JSON.stringify({ count })
      });
      closeTerminalDialog();
      summonData.balance = result.balance;
      renderSummonResults(result);
      await loadSummonState();
    }
  });
}

document.querySelectorAll('[data-summon-count]').forEach((button) => button.addEventListener('click', () => confirmSummon(Number(button.dataset.summonCount))));
document.querySelector('#summonBack').addEventListener('click', () => showScreen(home));
document.querySelector('#summonResultBack').addEventListener('click', () => showScreen(summonScreen));
document.querySelector('#summonResultConfirm').addEventListener('click', () => showScreen(summonScreen));
document.querySelector('#summonResultAgain').addEventListener('click', () => confirmSummon(10));
document.querySelector('#summonGalleryLink').addEventListener('click', () => { renderGallery(); showScreen(galleryScreen); });
document.querySelector('#summonDetailsLink').addEventListener('click', () => openTerminalDialog({
  title: '召集详细说明',
  hideConfirm: true,
  cancelLabel: '知道了',
  html: '<p>本次召集概率：R 70% · SR 25% · SSR 5%。</p><p>每次十连召集至少获得一张 SR 或 SSR。重复角色会自动转化为星辉碎片。</p>'
}));

function openActivityDialog() {
  openTerminalDialog({
    title: '太一问道实录',
    hideConfirm: true,
    cancelLabel: '关闭',
    html: '<button class="activity-poster" id="activityPoster" type="button"><img src="assets/ui/web/太一问道实录.webp" alt="太一问道实录活动海报"><span>点击海报参与活动</span></button>'
  });
  document.querySelector('#activityPoster').addEventListener('click', () => showToast('活动进行中，请于群内参与。'));
}

let memoryEntries = [
  {
    id: 'snow-court',
    title: '夜雪照虞宫',
    time: '虞历二月初七 · 子时',
    people: ['虞景', '奚行简', '张勉'],
    words: 4820,
    reward: '名誉 +3',
    mine: true,
    today: true,
    favorite: true,
    summary: '雪停在长阶尽头，案灯未熄。三人在殿外对完最后一份证词，把未说出口的疑心都藏进风里。',
    body: [
      '夜雪压低虞宫的灯，廊下只剩纸页翻动的声音。',
      '虞景把供词扣在案上，指节停了片刻：“这一页不入档。”',
      '奚行简抬眼，没有追问，只将茶盏往前推了半寸。张勉站在门边，听见远处更漏一声，像有人替他们把今夜盖章。',
      '等雪光落进窗棂，三个人都知道，这场沉默比争辩更像结案。'
    ]
  },
  {
    id: 'lantern-contract',
    title: '灯宴旧约',
    time: '虞历正月十五 · 戌时',
    people: ['虞复', '虞熙怀'],
    words: 3610,
    reward: '虞元 +20',
    mine: false,
    today: false,
    favorite: false,
    summary: '上元灯影里，一纸旧约被重新展开。名字没有变，立约的人却都学会了把话说得更轻。',
    body: [
      '灯影从河面浮上来，照得旧约边角发软。',
      '虞复没有急着落印，只问：“你还认这份约吗？”',
      '虞熙怀笑了一下，像把整条长街的喧闹都挡在身后：“认。但今日要添一条。”',
      '纸页被灯火烤得微卷，墨色新旧相叠，像一段终于肯回头的年月。'
    ]
  },
  {
    id: 'spring-hunt',
    title: '春狩试锋',
    time: '虞历三月廿一 · 午后',
    people: ['都尉慎', '闻礼', '褚宗晏'],
    words: 5294,
    reward: '体能 +1 / 名誉 +2',
    mine: true,
    today: false,
    favorite: false,
    summary: '林间试锋本是演武，箭簇偏偏擦过旧怨。有人收弓，有人第一次把真话说出口。',
    body: [
      '春草被马蹄踏开，风里有铁和新叶的味道。',
      '都尉慎收弓时，箭靶还在微微颤。闻礼看着那支偏出半寸的箭，终于明白这不是失手。',
      '褚宗晏笑意淡了，抬手让随从退后：“既然来了，不如把旧账也算清。”',
      '林鸟惊起的一瞬，所有人都听见了锋刃出鞘前最轻的一声响。'
    ]
  },
  {
    id: 'ink-trial',
    title: '墨审无声',
    time: '虞历三月廿五 · 申时',
    people: ['明御', '司励慈'],
    words: 4188,
    reward: '智力 +1',
    mine: true,
    today: false,
    favorite: true,
    summary: '审问没有落在刑具上，只落在一滴迟迟不干的墨里。谁先改口，谁就先输了半局。',
    body: [
      '墨在砚边凝住，像一枚不肯落下的判词。',
      '明御问得很慢，每一句都留着退路。司励慈却听懂了，那不是宽宥，是网。',
      '窗外灯影晃了一下，供词上的名字被重新誊过。'
    ]
  },
  {
    id: 'violet-window',
    title: '紫窗来信',
    time: '虞历四月初二 · 晨间',
    people: ['闻翡', '鹿溪'],
    words: 2976,
    reward: '魅力 +1',
    mine: false,
    today: true,
    favorite: false,
    summary: '一封信在晨光里被拆开，信中没有告白，只有一枚折得很好的紫花书签。',
    body: [
      '晨光薄得像水，紫花压在信纸中央。',
      '闻翡看完最后一行，忽然把信折回原样。鹿溪没有问，只把窗推开，让风进来。',
      '有些话不必说出口，纸页已经替他们在春天里站了一会儿。'
    ]
  },
  {
    id: 'rain-ledger',
    title: '雨夜账册',
    time: '虞历四月初九 · 亥时',
    people: ['奚仲', '虞从野'],
    words: 4461,
    reward: '商业 +2',
    mine: true,
    today: false,
    favorite: false,
    summary: '账册被雨气洇开，旧年的银钱往来浮出水面。有人要还债，有人只想确认债主是谁。',
    body: [
      '雨把窗纸敲得发皱，账册边缘泛起潮气。',
      '奚仲翻到最后一页，指尖停在一个被刮去的名字旁。虞从野笑了笑：“原来你也查到这里。”',
      '他们隔着一盏将灭未灭的灯，终于看见同一条线。'
    ]
  }
];

let memoryFilter = 'all';
let selectedMemoryId = memoryEntries[0].id;

function splitMemoryPeople(value) {
  return String(value || '').split(/[、,，/|]+/).map((part) => part.trim()).filter(Boolean);
}

function apiMemoryEntry(item, existing = {}) {
  const content = String(item.content || '');
  const body = content.split(/\n\s*\n|\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return {
    ...existing,
    id: String(item.id),
    title: item.title || '未命名剧情',
    time: item.date || item.createdAt || '时间未记录',
    people: splitMemoryPeople(item.participants),
    words: Number(item.words || content.length || 0),
    reward: item.note || '以档案结算记录为准',
    favorite: Boolean(item.favorite),
    summary: item.note || (item.recorder ? `记录人：${item.recorder}` : '点击查看完整剧情记录'),
    body: body.length ? body : (existing.body || ['暂无正文记录'])
  };
}

async function loadMemories() {
  const data = await apiRequest(`/api/dramas?filter=${encodeURIComponent(memoryFilter)}&pageSize=50`);
  memoryEntries = (data.items || []).map((item) => apiMemoryEntry(item));
  selectedMemoryId = memoryEntries.some((item) => item.id === String(selectedMemoryId)) ? String(selectedMemoryId) : (memoryEntries[0]?.id || '');
  renderMemories();
}

async function loadMemoryDetail(memoryId) {
  const detail = await apiRequest(`/api/dramas/${encodeURIComponent(memoryId)}`);
  const index = memoryEntries.findIndex((item) => item.id === String(memoryId));
  const mapped = apiMemoryEntry(detail, index >= 0 ? memoryEntries[index] : {});
  if (index >= 0) memoryEntries[index] = mapped;
  else memoryEntries.unshift(mapped);
  selectedMemoryId = mapped.id;
  renderMemoryDetail();
}

function filteredMemories() {
  return memoryEntries.filter((entry) => {
    if (memoryFilter === 'mine') return entry.mine;
    if (memoryFilter === 'today') return entry.today;
    if (memoryFilter === 'favorite') return entry.favorite;
    return true;
  });
}

function renderMemories() {
  const visible = filteredMemories();
  const list = document.querySelector('#memoryList');
  if (!visible.length) {
    list.innerHTML = '<div class="memory-empty">暂无剧情记录</div>';
    return;
  }
  list.innerHTML = visible.map((entry, index) => `
    <button class="memory-card ${entry.favorite ? 'is-favorite' : ''}" data-memory-id="${escapeHtml(entry.id)}" type="button" style="--memory-delay:${index * 70}ms" aria-label="${escapeHtml(entry.title)}">
      <span class="memory-card-kicker">${escapeHtml(entry.time)}</span>
      <strong class="memory-card-title">${escapeHtml(entry.title)}</strong>
      <p class="memory-card-summary">${escapeHtml(entry.summary)}</p>
      <small class="memory-card-meta">${escapeHtml(entry.people.join(' / '))} · ${entry.words.toLocaleString()}字</small>
    </button>
  `).join('');
  list.querySelectorAll('[data-memory-id]').forEach((button) => button.addEventListener('click', () => {
    selectedMemoryId = button.dataset.memoryId;
    showScreen(memoryDetailScreen);
    loadMemoryDetail(selectedMemoryId).catch((error) => { showScreen(memoryScreen); showToast(error.message); });
  }));
}

function renderMemoryDetail() {
  const entry = memoryEntries.find((item) => item.id === selectedMemoryId) || memoryEntries[0];
  document.querySelector('#memoryDetailTitle').textContent = entry.title;
  document.querySelector('#memoryDetailTime').textContent = entry.time;
  document.querySelector('#memoryDetailPeople').textContent = entry.people.join('、');
  document.querySelector('#memoryDetailWords').textContent = `${entry.words.toLocaleString()} 字`;
  document.querySelector('#memoryDetailReward').textContent = entry.reward;
  document.querySelector('#memoryDetailBody').innerHTML = entry.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
  document.querySelector('#memoryFavoriteAction').classList.toggle('is-active', entry.favorite);
  document.querySelector('#memoryFavoriteAction').textContent = entry.favorite ? '已收藏' : '收藏';
}

document.querySelector('#memoryBack').addEventListener('click', () => showScreen(home));
document.querySelector('#memoryDetailBack').addEventListener('click', () => showScreen(memoryScreen));
document.querySelector('#memoryReturnAction').addEventListener('click', () => showScreen(memoryScreen));
document.querySelectorAll('[data-memory-filter]').forEach((button) => button.addEventListener('click', () => {
  memoryFilter = button.dataset.memoryFilter;
  document.querySelectorAll('[data-memory-filter]').forEach((entry) => entry.classList.toggle('is-active', entry === button));
  if (apiUser) loadMemories().catch((error) => showToast(error.message));
  else renderMemories();
}));
document.querySelector('#memoryFavoriteAction').addEventListener('click', async () => {
  const entry = memoryEntries.find((item) => item.id === selectedMemoryId);
  if (!entry) return;
  try {
    const result = await apiRequest(`/api/dramas/${encodeURIComponent(entry.id)}/favorite`, {
      method: entry.favorite ? 'DELETE' : 'POST'
    });
    entry.favorite = Boolean(result.favorite);
    renderMemoryDetail();
    renderMemories();
    showToast(entry.favorite ? '已收藏剧情' : '已取消收藏');
  } catch (error) { showToast(error.message); }
});
document.querySelector('#memoryShareAction').addEventListener('click', async () => {
  const entry = memoryEntries.find((item) => item.id === selectedMemoryId);
  if (!entry) return;
  try {
    const result = await apiRequest(`/api/dramas/${encodeURIComponent(entry.id)}/share`, { method: 'POST' });
    openTerminalDialog({
      title: '分享剧情链接',
      confirmLabel: '复制链接',
      cancelLabel: '关闭',
      html: `<p>复制下方链接，即可分享这段剧情回忆。</p><label class="dialog-share-label">分享链接<input id="dialogShareUrl" type="text" readonly value="${escapeHtml(result.url)}"></label>`,
      onConfirm: async () => {
        const input = document.querySelector('#dialogShareUrl');
        input.select();
        try { await navigator.clipboard.writeText(result.url); }
        catch { document.execCommand('copy'); }
        closeTerminalDialog();
        showToast('分享链接已复制');
      }
    });
  } catch (error) {
    showToast(error.message || '分享链接生成失败');
  }
});

const wardrobeDatabase = window.FANLONG_WARDROBE || { slots: [], items: [] };
const outfitSlots = wardrobeDatabase.slots;
let outfits = wardrobeDatabase.items.map((item, index) => {
  let stats = {};
  try { stats = JSON.parse(item.stats || '{}'); } catch { stats = {}; }
  if (Array.isArray(stats)) stats = {};
  return {
    ...item,
    id: `db-outfit-${index}`,
    type: item.slot,
    description: String(item.desc || '数据库暂无服饰说明。').replace(/^【[^】]+】/, '').trim(),
    stats,
    unlocked: Boolean(item.owned),
    equipped: Boolean(item.equipped)
  };
});

const playerArchive = {
  name: '张勉',
  romanName: 'ZHANG MIAN',
  fields: [
    ['姓名', '张勉（Zhang Mian）'],
    ['职位', '虞宫侍官长'],
    ['家世 / 身份', '虞宫近侍世家张氏嫡系，现任虞宫侍官长'],
    ['年龄', '32岁'],
    ['生日', '12月7日'],
    ['身高', '188cm'],
    ['特征', '银边眼镜 / 黑色手套 / 冷峻自持 / 运筹帷幄'],
    ['简介', '虞宫最年轻的侍官长，掌管宫内机要与秩序。\n思维缜密，手段干练，忠于职责与守护之人。\n在他冰冷克制的外表之下，藏着不容动摇的信念。'],
    ['籍贯', '虞都·东城'],
    ['现居', '虞宫侍官署西院'],
    ['所属阵营', '虞宫内廷'],
    ['入宫年限', '14年'],
    ['档案权限', '甲级·机要可阅'],
    ['关键关系', '侍官署 / 议阁 / 张氏宗族'],
    ['近期状态', '在岗·无异常记录'],
    ['档案备注', '曾三次主持虞宫大典内廷调度，并负责历任近侍的考核与迁调。']
  ],
  stats: [
    ['颜值', 82], ['魅力', 76], ['智力', 91], ['商业', 63],
    ['口才', 74], ['体能', 61], ['才艺', 58], ['威慑', 69]
  ],
  bonuses: [['常服·夜影', '+12 魅力'], ['身份特质·近侍', '+6 口才'], ['配饰·银边镜', '+4 智力']]
};

function applyDatabaseTestUser(database = window.FANLONG_DB_TEST) {
  const user = database?.users?.find((entry) => entry.id === database.activeUserId);
  if (!user) return;
  const profile = user.profile || {};
  playerArchive.name = user.name;
  playerArchive.romanName = user.name === '虞景' ? 'YU JING' : user.name.toUpperCase();
  playerArchive.fields = [
    ['姓名', `${user.name}（UID ${user.uid}）`],
    ['职位', profile.职位 || '暂无记录'],
    ['家世 / 身份', `${profile.家世 || '暂无记录'} · ${profile.户籍 || '户籍未录入'}`],
    ['年龄', profile.年龄 ? `${profile.年龄}岁` : '暂无记录'],
    ['身高', profile.身高 || '暂无记录'],
    ['属性', profile.属性 || '暂无记录'],
    ['隶属', profile.隶属 || '暂无记录'],
    ['性格', profile.性格 || '数据库暂无记录'],
    ['外貌', profile.外貌 || '数据库暂无记录'],
    ['简介', profile.背景 || '数据库暂无背景记录'],
    ['数据来源', `${database.source} · 只读测试快照`]
  ];
  playerArchive.stats = Object.entries(user.stats || {});
  document.querySelector('#playerName').textContent = user.name;
  document.querySelector('#playerRole').textContent = profile.职位 || '身份待录入';
  document.querySelector('#playerFamily').textContent = profile.户籍 || profile.家世 || '档案籍';
  document.querySelector('#reputation').textContent = user.currency.reputation;
  document.querySelector('#currency').textContent = user.currency.yuCoin;
  document.querySelector('#bagReputation').textContent = user.currency.reputation;
  document.querySelector('#bagCurrency').textContent = user.currency.yuCoin;
  document.querySelectorAll('.gallery-reputation strong').forEach((element) => { element.textContent = user.currency.reputation; });
  document.querySelectorAll('.gallery-currency strong').forEach((element) => { element.textContent = user.currency.yuCoin; });
  document.querySelector('#shopReputation').textContent = user.currency.reputation;
  document.querySelector('#shopCurrency').textContent = user.currency.yuCoin;
}

function applyApiUser(user) {
  if (!user) return;
  apiUser = user;
  const profile = Object.fromEntries((user.profile || []).map((field) => [field.label, field.value]));
  playerArchive.name = user.name;
  playerArchive.romanName = user.romanName || user.name;
  playerArchive.fields = (user.profile || []).map((field) => [field.label, field.value || '暂无记录']);
  document.querySelector('#playerName').textContent = user.name;
  document.querySelector('#playerRole').textContent = profile.职位 || profile.官职 || '身份待录入';
  document.querySelector('#playerFamily').textContent = profile.户籍 || profile.家世 || '档案籍';
  document.querySelector('#reputation').textContent = user.currency.reputation;
  document.querySelector('#currency').textContent = user.currency.yuCoin;
  document.querySelector('#bagReputation').textContent = user.currency.reputation;
  document.querySelector('#bagCurrency').textContent = user.currency.yuCoin;
  document.querySelectorAll('.gallery-reputation strong').forEach((element) => { element.textContent = user.currency.reputation; });
  document.querySelectorAll('.gallery-currency strong').forEach((element) => { element.textContent = user.currency.yuCoin; });
  document.querySelector('#shopReputation').textContent = user.currency.reputation;
  document.querySelector('#shopCurrency').textContent = user.currency.yuCoin;
  setPlayerAvatar(apiAssetUrl(user.avatarUrl) || '');
  renderArchiveData();
}

function itemAssetPath(item) {
  const wardrobeItem = wardrobeDatabase.items.find((entry) => entry.name === item.name);
  const slot = item.slot || wardrobeItem?.slot;
  const categories = { top: '上衣', bottom: '下装', head: '头饰', neck: '颈饰', interior: '内饰', accessory: '配饰' };
  if (categories[slot]) return `assets/ui/products-web/${categories[slot]}/${item.name}.webp`;
  if (item.type === 'consumable') return `assets/ui/products-web/消耗类/${item.name}.webp`;
  return 'assets/ui/web/通用占位图.webp';
}

function applyApiStats(data) {
  playerArchive.stats = (data.stats || []).map((stat) => [stat.label === '服从/威慑' ? '威慑' : stat.label, stat.total]);
  playerArchive.bonuses = (data.bonusSources || []).flatMap((source) => source.values.map((entry) => [source.item, `+${entry.value} ${entry.label}`]));
  playerArchive.bonusTotal = (data.stats || []).reduce((sum, stat) => sum + Number(stat.bonus || 0), 0);
  renderArchiveData();
}

function applyApiInventory(data) {
  bagItems = (data.items || []).map((item, index) => ({
    ...item,
    id: `api-bag-${index}`,
    type: item.type === 'equip' ? '服饰' : item.type === 'consumable' ? '道具' : '其他',
    image: itemAssetPath(item),
    usable: item.type === 'consumable'
  }));
  selectedBagItemId = bagItems[0]?.id || '';
  renderBag();
}

function applyApiWardrobe(data) {
  outfits = (data.items || []).map((item, index) => {
    const presentation = wardrobeDatabase.items.find((entry) => entry.name === item.name) || {};
    return {
      ...presentation,
      ...item,
      id: `api-outfit-${index}`,
      type: item.slot,
      description: item.description || '数据库暂无服饰说明。',
      unlocked: item.owned > 0,
      equipped: item.equippedSlots.length > 0,
      is_selling: item.isSelling,
      stock_qty: item.stock
    };
  });
  selectedOutfitId = outfits.find((item) => item.unlocked && (outfitFilter === 'all' || item.slot === outfitFilter) && item.equipped)?.id || outfits.find((item) => item.unlocked && (outfitFilter === 'all' || item.slot === outfitFilter))?.id || '';
  outfitPage = 0;
  renderOutfitFilters();
  renderOutfits();
  renderOutfitDetails();
  renderEquippedOutfit();
}

async function loadCurrentUser() {
  const [user, stats, inventory, wardrobe] = await Promise.all([
    apiRequest('/api/me'),
    apiRequest('/api/me/stats'),
    apiRequest('/api/inventory'),
    apiRequest('/api/wardrobe')
  ]);
  applyApiUser(user);
  applyApiStats(stats);
  applyApiInventory(inventory);
  applyApiWardrobe(wardrobe);
  return user;
}

async function refreshLiveDatabaseUser() {
  if (!searchParams.has('dbtest')) return;
  if (!/^https?:$/.test(window.location.protocol)) return;
  try {
    const response = await fetch('api/test-user.php?id=3586801984', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const database = await response.json();
    if (!database.ok) throw new Error(database.message || '数据库接口读取失败');
    window.FANLONG_DB_TEST = database;
    applyDatabaseTestUser(database);
    renderArchiveData();
  } catch (error) {
    console.warn('实时数据库不可用，继续使用只读快照。', error);
  }
}

const archiveBackgrounds = {
  detail: 'assets/ui/web/档案-详情.webp',
  stats: 'assets/ui/web/档案-属性.webp',
  outfit: 'assets/ui/web/档案-服饰-v2.webp'
};

function renderArchiveData() {
  document.querySelector('#detailList').innerHTML = playerArchive.fields.map(([label, value]) => `
    <div class="detail-row ${label === '简介' ? 'is-intro' : ''}">
      <dt>${label}</dt><dd>${value.replaceAll('\n', '<br>')}</dd>
    </div>`).join('');
  document.querySelector('#signatureName').textContent = playerArchive.name;
  document.querySelector('#signatureRoman').textContent = playerArchive.romanName;
  const total = playerArchive.stats.reduce((sum, [, value]) => sum + value, 0);
  document.querySelector('#totalStats').textContent = total;
  const statEnglish = { '颜值': 'APPEARANCE', '魅力': 'CHARM', '智力': 'INTELLIGENCE', '商业': 'BUSINESS', '口才': 'ELOQUENCE', '体能': 'PHYSICAL', '才艺': 'TALENT', '威慑': 'DOMINANCE' };
  document.querySelector('#statsGrid').innerHTML = playerArchive.stats.map(([name, value], index) => `
    <article class="stat-card" data-stat="${name}" style="--delay:${index * 45}ms">
      <div class="stat-emblem">${renderStatIcon(name)}</div>
      <span class="stat-index">0${index + 1}</span>
      <div class="stat-label"><h3>${name}</h3><small>${statEnglish[name]}</small></div>
      <strong>${value}</strong>
      <i><b style="width:${Math.min(100, value)}%"></b></i>
    </article>`).join('');
  document.querySelector('#bonusList').innerHTML = playerArchive.bonuses.map(([name, value]) => `
    <div class="bonus-item"><span>${name}</span><strong>${value}</strong></div>`).join('');
  const bonusTotal = Number.isFinite(playerArchive.bonusTotal)
    ? playerArchive.bonusTotal
    : playerArchive.bonuses.reduce((sum, [, value]) => sum + (Number(String(value).match(/[+-]?\d+/)?.[0]) || 0), 0);
  document.querySelector('#bonusTotal').textContent = `${bonusTotal >= 0 ? '+' : ''}${bonusTotal}`;
}

function setArchivePage(page) {
  const background = document.querySelector('#archiveBackground');
  background.src = archiveBackgrounds[page];
  background.removeAttribute('data-src');
  archiveScreen.style.setProperty('--screen-art', `url("${encodeURI(archiveBackgrounds[page])}")`);
  background.alt = `角色${page === 'detail' ? '详情' : page === 'stats' ? '属性' : '服饰'}页面`;
  document.querySelectorAll('[data-archive-page]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.archivePage === page));
  document.querySelectorAll('[data-archive-tab]').forEach((tab) => {
    const active = tab.dataset.archiveTab === page;
    tab.toggleAttribute('aria-current', active);
  });
}

let outfitFilter = 'all';
let outfitPage = 0;
const outfitsPerPage = 6;
let selectedOutfitId = outfits.find((item) => item.unlocked && item.equipped)?.id || outfits.find((item) => item.unlocked)?.id || '';

const outfitGrid = document.querySelector('#outfitGrid');
const equipButton = document.querySelector('#equipButton');
const productCategoryBySlot = {
  top: '上衣',
  bottom: '下装',
  head: '头饰',
  neck: '颈饰',
  interior: '内饰',
  accessory: '配饰'
};

function renderOutfitIcon(outfit) {
  const symbols = { hair: '♒', top: '♜', bottom: '♟', head: '♕', neck: '♢', interior: '✣', accessory: '✦' };
  const fallback = `<span class="slot-glyph slot-${outfit.slot}" aria-hidden="true"><b>${symbols[outfit.slot] || '✦'}</b></span>`;
  const category = productCategoryBySlot[outfit.slot];
  if (!category) return `<img class="product-art" src="assets/ui/web/通用占位图.webp" alt="">${fallback}`;
  const imagePath = `assets/ui/products-web/${category}/${outfit.name}.webp`;
  return `<img class="product-art" src="${encodeURI(imagePath)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/ui/web/通用占位图.webp'">${fallback}`;
}

function renderEquippedOutfit() {
  const outfit = outfits.find((item) => item.id === selectedOutfitId);
  const preview = document.querySelector('#outfitPreview');
  if (!outfit) {
    preview.innerHTML = '<div class="outfit-showcase is-empty"><span>暂无可预览服饰</span></div>';
    document.querySelector('#equippedName').textContent = '尚未选择服饰';
    document.querySelector('#equippedSlot').textContent = '服饰预览';
    return;
  }
  const showcaseModifier = outfit.name === '素圈戒指' ? ' showcase-item-plain-ring' : '';
  preview.innerHTML = `<div class="outfit-showcase showcase-slot-${outfit.slot}${showcaseModifier}">
    <div class="showcase-window">
      <div class="showcase-aura" aria-hidden="true"></div>
      <div class="showcase-ring" aria-hidden="true"></div>
      <div class="showcase-pedestal" aria-hidden="true"></div>
      <div class="showcase-item">${renderOutfitIcon(outfit)}</div>
    </div>
  </div>`;
  document.querySelector('#equippedName').textContent = outfit.name;
  document.querySelector('#equippedSlot').textContent = `${slotLabel(outfit.slot)} · ${outfit.equipped ? '当前穿戴' : outfit.unlocked ? '已拥有' : '未持有'}`;
}

function renderLockIcon() {
  return `<svg class="outfit-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="10" width="14" height="11" rx="2"/>
    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>
    <circle cx="12" cy="14" r="1" class="lock-dot"/>
  </svg>`;
}

function renderStatIcon(name) {
  const paths = {
    '魅力': '<path d="M3 8l4 3 5-7 5 7 4-3-2 10H5z"/><path d="M6 21h12M7 11l2 7m8-7-2 7M12 4v14"/><circle cx="12" cy="11" r="1.4"/>',
    '口才': '<path d="M19 3c-5 .8-10 4.8-12 11.5l5-2.7 3.2-4.5-4.7 4.4M5 21l4.8-9.2"/><path d="M14 5l4 4M7 17h10M6 20h12"/>',
    '体能': '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/><path d="M2 6l2 1M20 7l2-1M12 4v2M12 18v2"/>',
    '智力': '<path d="M4 5c3-1 5 0 8 2v13c-3-2-5-3-8-2zM20 5c-3-1-5 0-8 2v13c3-2 5-3 8-2z"/><path d="M12 7v13M6.5 8.5c1.5 0 2.5.3 3.5 1M17.5 8.5c-1.5 0-2.5.3-3.5 1"/><path d="m12 2 .8 1.7 1.7.8-1.7.8L12 7l-.8-1.7-1.7-.8 1.7-.8z"/>',
    '威慑': '<path d="M12 3l8 3v6c0 5-3 8-8 10-5-2-8-5-8-10V6z"/><path d="M7 10l2 1.5 3-4 3 4 2-1.5-1 6H8zM9 18h6"/>',
    '颜值': '<path d="M6 9c0-4 2-6 6-6s6 2 6 6v4c0 5-2.5 8-6 8s-6-3-6-8z"/><path d="M6 10c2-1 3-3 4-5 2 3 5 4 8 4M8.5 12h1M14.5 12h1M9.5 16c1.7 1 3.3 1 5 0"/><path d="m19 3 .7 1.5 1.5.7-1.5.7L19 7.4l-.7-1.5-1.5-.7 1.5-.7z"/>',
    '才艺': '<path d="M7 5v11c0 3 10 3 10 0V5M7 8c3 2 7 2 10 0M7 12c3 2 7 2 10 0M12 5v13"/><path d="M5 5h14M9 3h6"/>',
    '商业': '<path d="M4 20V10M10 20V6M16 20V12M22 20H2"/><path d="m3 14 6-5 5 2 7-7M17 4h4v4"/><circle cx="10" cy="6" r="1.2"/>'
  };
  const slugs = { '颜值': 'appearance', '魅力': 'charm', '智力': 'intelligence', '商业': 'business', '口才': 'eloquence', '体能': 'physical', '才艺': 'talent', '威慑': 'dominance' };
  return `<svg class="outfit-stat-icon stat-icon-${slugs[name] || 'charm'}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths['魅力']}</svg>`;
}

function renderOutfits() {
  const filtered = outfits.filter((outfit) => outfit.unlocked && (outfitFilter === 'all' || outfit.slot === outfitFilter));
  if (filtered.length && !filtered.some((outfit) => outfit.id === selectedOutfitId)) {
    selectedOutfitId = filtered.find((outfit) => outfit.equipped)?.id || filtered[0].id;
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / outfitsPerPage));
  outfitPage = Math.min(outfitPage, pageCount - 1);
  const visible = filtered.slice(outfitPage * outfitsPerPage, (outfitPage + 1) * outfitsPerPage);
  document.querySelector('#outfitCategoryTitle').textContent = outfitFilter === 'all' ? '全部' : slotLabel(outfitFilter);
  document.querySelector('#outfitCategoryCount').textContent = `${filtered.length} 件`;
  document.querySelector('#outfitPage').textContent = `${String(outfitPage + 1).padStart(2, '0')} / ${String(pageCount).padStart(2, '0')}`;
  document.querySelector('#outfitPrev').disabled = outfitPage === 0;
  document.querySelector('#outfitNext').disabled = outfitPage >= pageCount - 1;
  if (!visible.length) {
    selectedOutfitId = '';
    outfitGrid.innerHTML = `<div class="outfit-empty"><i>◇</i><strong>暂无已拥有${outfitFilter === 'all' ? '服饰' : slotLabel(outfitFilter)}</strong><span>未拥有的服饰不在衣橱中展示</span></div>`;
    return;
  }
  outfitGrid.innerHTML = visible.map((outfit) => {
    const state = outfit.equipped ? '✓' : '';
    return `<button class="outfit-card ${outfit.id === selectedOutfitId ? 'is-selected' : ''}" data-outfit-id="${outfit.id}">
      <span class="garment-visual">${renderOutfitIcon(outfit)}</span>
      <strong>${outfit.name}</strong>
      <small>${outfit.equipped ? '当前穿戴' : '已拥有'}</small>
      ${state ? `<i class="state-mark">${state}</i>` : ''}
    </button>`;
  }).join('');

  outfitGrid.querySelectorAll('[data-outfit-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedOutfitId = button.dataset.outfitId;
      renderOutfits();
      renderOutfitDetails();
      renderEquippedOutfit();
    });
  });
}

function renderOutfitDetails() {
  const outfit = outfits.find((item) => item.id === selectedOutfitId);
  if (!outfit) {
    document.querySelector('#outfitName').textContent = `暂无${outfitFilter === 'all' ? '服饰' : slotLabel(outfitFilter)}`;
    document.querySelector('#outfitRarity').textContent = 'EMPTY SLOT';
    document.querySelector('#outfitDescription').textContent = '当前尚未拥有该分类服饰。';
    document.querySelector('#outfitStats').innerHTML = '';
    document.querySelector('#outfitEffect').textContent = '等待录入';
    equipButton.disabled = true;
    equipButton.textContent = '暂无可穿戴服饰';
    const owned = outfits.filter((item) => item.unlocked).length;
    document.querySelector('#collectionCount').textContent = `${owned}/${outfits.length}`;
    document.querySelector('#collectionBar').style.width = `${owned / Math.max(1, outfits.length) * 100}%`;
    return;
  }
  document.querySelector('#outfitName').textContent = outfit.name;
  document.querySelector('#outfitRarity').textContent = `${slotLabel(outfit.slot)} · ${outfit.equipped ? '当前穿戴' : outfit.unlocked ? '已拥有' : '未拥有'}`;
  document.querySelector('#outfitDescription').textContent = outfit.description;
  const stats = Object.entries(outfit.stats);
  document.querySelector('#outfitStats').innerHTML = stats.length ? stats.map(([name, value]) => `<div><dt>${renderStatIcon(normalizeStatName(name))}<span>${name}</span></dt><dd>+${value}</dd></div>`).join('') : '<div class="no-stat"><dt>属性加成</dt><dd>无</dd></div>';
  document.querySelector('#outfitEffect').textContent = outfit.price < 0 ? '限定获取' : `${outfit.price} ${currencyLabel(outfit.currency)}`;
  const lockedEquipment = outfit.name === '家徽烙印•罪';
  equipButton.disabled = !outfit.unlocked || (outfit.equipped && lockedEquipment);
  equipButton.textContent = !outfit.unlocked ? '未持有' : outfit.equipped ? (lockedEquipment ? '无法卸下' : '卸下') : '穿戴';
  const owned = outfits.filter((item) => item.unlocked).length;
  document.querySelector('#collectionCount').textContent = `${owned}/${outfits.length}`;
  document.querySelector('#collectionBar').style.width = `${owned / Math.max(1, outfits.length) * 100}%`;
}

equipButton.addEventListener('click', () => {
  const outfit = outfits.find((item) => item.id === selectedOutfitId);
  if (!outfit || !outfit.unlocked) return;
  const unequipping = outfit.equipped;
  openTerminalDialog({
    title: unequipping ? '确认卸下服饰' : '确认穿戴服饰',
    confirmLabel: unequipping ? '确认卸下' : '确认穿戴',
    html: `<p class="dialog-target">${escapeHtml(outfit.name)} · ${escapeHtml(slotLabel(outfit.slot))}</p><p>${escapeHtml(outfit.description)}</p>${unequipping ? '<p>卸下后，该服饰会回到背包。</p>' : '<p>若对应位置已有服饰，将自动替换并放回背包。</p>'}`,
    onConfirm: async () => {
      const endpoint = unequipping ? '/api/wardrobe/unequip' : '/api/wardrobe/equip';
      const body = { item: outfit.name };
      if (unequipping && outfit.equippedSlots?.length) body.slot = outfit.equippedSlots[0];
      const result = await apiRequest(endpoint, {
        method: 'POST',
        headers: operationHeaders(unequipping ? 'wardrobe-unequip' : 'wardrobe-equip'),
        body: JSON.stringify(body)
      });
      await loadCurrentUser();
      const refreshedOutfit = outfits.find((entry) => entry.name === result.item);
      if (refreshedOutfit) {
        if (outfitFilter !== 'all') outfitFilter = refreshedOutfit.slot;
        selectedOutfitId = refreshedOutfit.id;
        renderOutfitFilters();
        renderOutfits();
        renderOutfitDetails();
        renderEquippedOutfit();
      }
      closeTerminalDialog();
      const bonus = (result.firstWearChanges || []).map((change) => `${change.label}+${change.amount}`).join('、');
      showToast(`${unequipping ? '已卸下' : '已穿戴'}·${result.item}${bonus ? ` · 首次穿戴 ${bonus}` : ''}`);
    }
  });
});

function slotLabel(slotId) { return outfitSlots.find((slot) => slot.id === slotId)?.label || slotId; }
function currencyLabel(currency) { return currency === 'reputation' ? '名誉' : '虞元'; }
function acquisitionLabel(outfit) { return outfit.price < 0 ? '限定获取' : outfit.is_selling ? `${outfit.price} ${currencyLabel(outfit.currency)}` : '暂不可获得'; }
function normalizeStatName(name) { return name.includes('威慑') || name.includes('服从') ? '威慑' : name === '名誉' ? '魅力' : name; }

function renderOutfitFilters() {
  const filters = [{ id: 'all', label: '全部' }, ...outfitSlots];
  document.querySelector('#outfitFilters').innerHTML = filters.map((slot) => {
    return `<button class="${slot.id === outfitFilter ? 'is-active' : ''}" data-filter="${slot.id}" type="button"><span>${slot.label}</span></button>`;
  }).join('');
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    outfitFilter = button.dataset.filter;
    outfitPage = 0;
    selectedOutfitId = outfits.find((item) => item.unlocked && (outfitFilter === 'all' || item.slot === outfitFilter) && item.equipped)?.id || outfits.find((item) => item.unlocked && (outfitFilter === 'all' || item.slot === outfitFilter))?.id || '';
    renderOutfitFilters();
    renderOutfits();
    renderOutfitDetails();
    renderEquippedOutfit();
  }));
}

document.querySelector('#outfitPrev').addEventListener('click', () => { outfitPage -= 1; renderOutfits(); });
document.querySelector('#outfitNext').addEventListener('click', () => { outfitPage += 1; renderOutfits(); });

document.querySelector('#wardrobeBack').addEventListener('click', () => showScreen(home));
document.querySelectorAll('[data-archive-tab]').forEach((button) => button.addEventListener('click', () => setArchivePage(button.dataset.archiveTab)));

let archiveUiInitialized = false;
function ensureArchiveUi() {
  if (archiveUiInitialized) return;
  archiveUiInitialized = true;
  applyDatabaseTestUser();
  renderArchiveData();
  refreshLiveDatabaseUser();
  renderOutfitFilters();
  renderOutfits();
  renderOutfitDetails();
  renderEquippedOutfit();
}

const previewTab = searchParams.get('archive');
if (archiveBackgrounds[previewTab]) {
  ensureArchiveUi();
  setArchivePage(previewTab);
  showScreen(archiveScreen);
}
if (searchParams.has('gallery')) {
  renderGallery();
  showScreen(galleryScreen);
}
if (searchParams.has('memories')) {
  renderMemories();
  showScreen(memoryScreen);
}
if (searchParams.has('daily')) {
  renderDaily();
  showScreen(dailyScreen);
}
if (searchParams.has('social')) {
  showScreen(socialScreen);
}
if (searchParams.has('shop')) {
  renderShopTaxonomy();
  renderShop();
  showScreen(shopScreen);
}
if (searchParams.has('bag')) {
  renderBag();
  showScreen(bagScreen);
}
if (searchParams.has('summon')) {
  renderSummonDemo();
  showScreen(summonScreen);
}
if (searchParams.has('summonResult')) {
  renderSummonResults({ count: 10, results: [
    ['R', '张勉', 'R/张勉完整版.png'], ['SR', '闻礼', 'SR/闻礼.png'], ['R', '虞复', 'R/虞复完整版.png'],
    ['SSR', '虞景', 'SSR/虞景.png'], ['SR', '褚旻', 'SR/褚旻.png'], ['R', '奚仲', 'R/奚仲A完整版.png'],
    ['SR', '司烬安', 'SR/司烬安.png'], ['R', '都尉慎', 'R/都尉慎完整版.png'], ['R', '都尉瑶', 'R/都尉瑶完整版.png'], ['SR', '鹿溪', 'SR/鹿溪.png']
  ].map(([rarity, name, image], index) => ({ rarity, name, image: `assets/ui/summon-cards/${image}`, isNew: index === 3 })) });
}
if (searchParams.has('activity')) openActivityDialog();
const previewMemory = searchParams.get('memory');
if (previewMemory) {
  selectedMemoryId = memoryEntries.some((entry) => entry.id === previewMemory) ? previewMemory : selectedMemoryId;
  renderMemories();
  renderMemoryDetail();
  showScreen(memoryDetailScreen);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && terminalDialog.classList.contains('is-open')) {
    closeTerminalDialog();
  } else if (event.key === 'Escape' && archiveScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && dailyScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && socialScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && shopScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && bagScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && galleryScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && summonResultScreen.classList.contains('is-active')) {
    showScreen(summonScreen);
  } else if (event.key === 'Escape' && summonScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && memoryDetailScreen.classList.contains('is-active')) {
    showScreen(memoryScreen);
  } else if (event.key === 'Escape' && memoryScreen.classList.contains('is-active')) {
    showScreen(home);
  } else if (event.key === 'Escape' && home.classList.contains('is-active')) {
    showScreen(opening);
  }
});

const debugGroups = [
  ['home-name', '主页·姓名', '#playerName'], ['home-role', '主页·职位', '#playerRole'], ['home-family', '主页·身份', '#playerFamily'],
  ['home-reputation-label', '主页·名誉文字', '.reputation-copy span'], ['home-reputation', '主页·名誉数值', '#reputation'],
  ['home-currency-label', '主页·虞元文字', '.currency-copy span'], ['home-currency', '主页·虞元数值', '#currency'], ['loading-note', '加载·提示文字', '#loadingNote'],
  ['login-inputs', '登录·输入框文字', '.login-form input'],
  ['daily-progress-sign', '日常·签到进度', '#dailySignProgress'], ['daily-progress-training', '日常·训练进度', '#dailyTrainingProgress'], ['daily-progress-box', '日常·盲盒进度', '#dailyBoxProgress'],
  ['daily-record-heading', '日常·记录标题', '.daily-results-heading'], ['daily-record-flow', '日常·记录流', '.daily-record-flow'], ['daily-record-items', '日常·记录条', '.daily-record, .daily-record-batch summary'],
  ['daily-sign-result', '日常·签到结果', '.daily-sign-result'], ['daily-training-result', '日常·训练结果', '.daily-training-result'], ['daily-box-result', '日常·盲盒结果', '.daily-box-result'],
  ['daily-action-sign', '日常·签到按钮文字', '#dailySignAction'], ['daily-action-training', '日常·训练按钮文字', '#dailyTrainingAction'], ['daily-action-box-single', '日常·单抽按钮文字', '#dailyBoxSingle'], ['daily-action-box-ten', '日常·十连按钮文字', '#dailyBoxTen'],
  ['social-input', '社交·输入文字', '#socialSearchInput'], ['social-selection-label', '社交·已选提示', '#socialSelection span'], ['social-selection-name', '社交·已选玩家名', '#socialSelectionName'],
  ['shop-resources', '商城·资源数值', '.shop-resources'], ['shop-tabs', '商城·商店切换', '.shop-tabs button'], ['shop-categories', '商城·商品分类', '.shop-categories button'], ['shop-card-names', '商城·商品名称', '.shop-card h2'], ['shop-card-price', '商城·价格', '.shop-card footer span'],
  ['summon-rate', '召集·概率与保底说明', '#summonRate'], ['summon-prices', '召集·价格文字', '.summon-draw span'], ['summon-result-summary', '召集结果·获得数量', '#summonResultSummary'],
  ['bag-resources', '背包·资源数值', '.bag-resource strong'], ['bag-filters', '背包·分类文字', '.bag-filters button'],
  ['bag-counts', '背包·物品数量', '.bag-item span'], ['bag-name', '背包·物品名', '#bagItemName'], ['bag-owned', '背包·拥有数量', '.bag-detail-heading span'],
  ['bag-description', '背包·物品描述', '#bagItemDescription'], ['bag-use', '背包·使用按钮', '#bagUseButton'],
  ['gallery-resources', '图鉴·资源数值', '.gallery-resource strong'], ['gallery-filters', '图鉴·筛选文字', '.gallery-filters button'],
  ['gallery-count', '图鉴·收集进度', '#galleryCount'],
  ['memory-filters', '剧情·筛选文字', '.memory-filters button'], ['memory-card-time', '剧情列表·时间', '.memory-card-kicker'], ['memory-card-title', '剧情列表·标题', '.memory-card-title'],
  ['memory-card-summary', '剧情列表·摘要', '.memory-card-summary'], ['memory-card-meta', '剧情列表·参与人与字数', '.memory-card-meta'],
  ['memory-detail-title', '剧情详情·标题', '#memoryDetailTitle'], ['memory-detail-labels', '剧情详情·字段名', '.memory-detail-meta i'], ['memory-detail-values', '剧情详情·字段值', '.memory-detail-meta b'],
  ['memory-detail-favorite', '剧情详情·收藏按钮', '#memoryFavoriteAction'], ['memory-detail-share', '剧情详情·分享按钮', '#memoryShareAction'], ['memory-detail-return', '剧情详情·返回按钮', '#memoryReturnAction'],
  ['detail-labels', '档案详情·字段名', '.detail-row dt'], ['detail-values', '档案详情·字段值', '.detail-row dd'],
  ['signature-name', '档案详情·署名', '#signatureName'], ['signature-roman', '档案详情·英文署名', '#signatureRoman'],
  ['stats-summary', '属性·综合评定', '.stats-summary'], ['stat-names', '属性·属性名', '.stat-card h3'], ['stat-values', '属性·数值', '.stat-card strong'], ['stat-notes', '属性·说明', '.stat-card small'],
  ['bonus-text', '属性·加成区', '.stats-bonus'], ['outfit-title', '服饰·标题', '.wardrobe-content h2'], ['outfit-card-names', '服饰·卡片名', '.outfit-card strong'],
  ['outfit-detail', '服饰·详情区', '.outfit-details'], ['outfit-filters', '服饰·分类', '.outfit-filters button']
].map(([key, label, selector]) => ({ key, label, selector }));

localStorage.removeItem('fanlongTextDebugV1');
localStorage.removeItem('fanlongTextDebugV2');
localStorage.removeItem('fanlongTextDebugV3');
localStorage.removeItem('fanlongTextDebugV4');
localStorage.removeItem('fanlongTextDebugV5');
localStorage.removeItem('fanlongTextDebugV6');
localStorage.removeItem('fanlongTextDebugV7');
localStorage.removeItem('fanlongTextDebugV8');
localStorage.removeItem('fanlongTextDebugV9');
const DEBUG_STORAGE_KEY = 'fanlongTextDebugV10';
const SHOWCASE_DEBUG_STORAGE_KEY = 'fanlongShowcaseDebugV2';
localStorage.removeItem('fanlongVisualDebugV1');
localStorage.removeItem('fanlongVisualDebugV2');
localStorage.removeItem('fanlongVisualDebugV3');
localStorage.removeItem('fanlongVisualDebugV4');
const VISUAL_DEBUG_STORAGE_KEY = 'fanlongVisualDebugV5';
const defaultDebugConfig = {
  'home-reputation-label': { x: 28, y: 14, size: 122 },
  'home-reputation': { x: 8, y: 14, size: 103 },
  'home-currency-label': { x: 23, y: 14, size: 122 },
  'home-currency': { x: 0, y: 14, size: 103 },
  'memory-card-time': { x: -37, y: -16, size: 123 },
  'memory-card-title': { x: -40, y: -14, size: 100 },
  'memory-card-summary': { x: -15, y: 11, size: 150 },
  'memory-card-meta': { x: 0, y: 0, size: 129 },
  'memory-detail-title': { x: 0, y: -1, size: 100 },
  'memory-detail-labels': { x: -12, y: 0, size: 100 },
  'memory-detail-values': { x: 53, y: 10, size: 99 },
  'memory-detail-favorite': { x: -11, y: -5, size: 100 },
  'memory-detail-share': { x: 4, y: -3, size: 100 },
  'memory-detail-return': { x: -5, y: -4, size: 100 },
  'daily-progress-sign': { x: 12, y: 9, size: 100 },
  'daily-progress-training': { x: -1, y: 9, size: 100 },
  'daily-progress-box': { x: 7, y: 9, size: 100 },
  'daily-record-heading': { x: 0, y: 0, size: 100 },
  'daily-record-flow': { x: 0, y: 0, size: 100 },
  'daily-record-items': { x: 0, y: 0, size: 100 },
  'social-input': { x: 64, y: -2, size: 100 },
  'social-selection-name': { x: 0, y: -7, size: 113 },
  'social-selection-label': { x: 74, y: 20, size: 111 },
  'shop-card-names': { x: 1, y: -173, size: 122 },
  'shop-card-price': { x: 3, y: -1, size: 169 },
  'signature-name': { x: -102, y: 22, size: 100 },
  'signature-roman': { x: -104, y: 60, size: 139 },
  'bonus-text': { x: 4, y: 36, size: 100 },
  'outfit-filters': { x: 0, y: 0, size: 124 },
  'outfit-card-names': { x: 0, y: 0, size: 119 },
  'outfit-detail': { x: -1, y: 0, size: 100 },
  'bag-description': { x: 0, y: 0, size: 85 },
  'bag-use': { x: 0, y: 0, size: 103 },
  'summon-rate': { x: 0, y: 28, size: 108 },
  'summon-prices': { x: -4, y: -18, size: 170 },
  'summon-result-summary': { x: 0, y: 41, size: 117 },
  'daily-sign-result': { x: 0, y: -16, size: 127 },
  'daily-training-result': { x: 0, y: -16, size: 127 },
  'daily-box-result': { x: 0, y: -16, size: 127 },
  'shop-resources': { x: 0, y: 8, size: 124 },
  'shop-tabs': { x: 4, y: 0, size: 100 }
};
let debugConfig = { ...defaultDebugConfig, ...JSON.parse(localStorage.getItem(DEBUG_STORAGE_KEY) || '{}') };
let showcaseDebugConfig = JSON.parse(localStorage.getItem(SHOWCASE_DEBUG_STORAGE_KEY) || '{}');
let visualDebugConfig = JSON.parse(localStorage.getItem(VISUAL_DEBUG_STORAGE_KEY) || '{}');
let activeDebugKey = debugGroups[0].key;
const debugPanel = document.querySelector('#debugPanel');
const debugTarget = document.querySelector('#debugTarget');
const debugControls = {
  x: document.querySelector('#debugX'), y: document.querySelector('#debugY'), size: document.querySelector('#debugSize'),
  xValue: document.querySelector('#debugXValue'), yValue: document.querySelector('#debugYValue'), sizeValue: document.querySelector('#debugSizeValue')
};
const showcaseDebugFields = [
  ['stageLeft', 'showcaseStageLeft', '--showcase-stage-left', '%', 50, (value) => value],
  ['stageWidth', 'showcaseStageWidth', '--showcase-stage-width', '%', 82, (value) => value],
  ['windowX', 'showcaseWindowX', '--showcase-window-x', '%', 0, (value) => value],
  ['windowY', 'showcaseWindowY', '--showcase-window-y', '%', 0, (value) => value],
  ['windowW', 'showcaseWindowW', '--showcase-window-w', '', 100, (value) => value / 100],
  ['windowH', 'showcaseWindowH', '--showcase-window-h', '', 100, (value) => value / 100],
  ['itemX', 'showcaseItemX', '--showcase-item-x', '%', -1, (value) => value],
  ['itemY', 'showcaseItemY', '--showcase-item-y', '%', -0.5, (value) => value],
  ['itemScale', 'showcaseItemScale', '--showcase-item-debug-scale', '', 100, (value) => value / 100],
  ['auraX', 'showcaseAuraX', '--showcase-aura-x', '%', 0, (value) => value],
  ['auraY', 'showcaseAuraY', '--showcase-aura-y', '%', 0.5, (value) => value],
  ['auraScale', 'showcaseAuraScale', '--showcase-aura-debug-scale', '', 100, (value) => value / 100],
  ['baseX', 'showcaseBaseX', '--showcase-base-x', '%', 0, (value) => value],
  ['baseY', 'showcaseBaseY', '--showcase-base-y', '%', 5.5, (value) => value],
  ['baseScale', 'showcaseBaseScale', '--showcase-base-debug-scale', '', 100, (value) => value / 100],
  ['textX', 'showcaseTextX', '--showcase-text-x', '%', 0.5, (value) => value],
  ['textY', 'showcaseTextY', '--showcase-text-y', 'px', 0, (value) => value],
  ['textScale', 'showcaseTextScale', '--showcase-text-debug-scale', '', 100, (value) => value / 100]
].map(([key, inputId, cssVar, unit, defaultValue, toCss]) => {
  const input = document.querySelector(`#${inputId}`);
  return {
    key,
    input,
    output: document.querySelector(`#${inputId}Value`),
    cssVar,
    unit,
    defaultValue,
    toCss
  };
});
const visualDebugFields = [
  ['shopProductY', 'shopProductY', '--shop-product-y', '%', 12, (value) => value],
  ['shopProductScale', 'shopProductScale', '--shop-product-scale', '', 100, (value) => value / 100],
  ['shopPriceY', 'shopPriceY', '--shop-price-y', 'px', -8, (value) => value],
  ['shopPriceScale', 'shopPriceScale', '--shop-price-scale', '', 100, (value) => value / 100],
  ['summonPriceY', 'summonPriceY', '--summon-price-y', 'px', 140, (value) => value],
  ['summonPriceScale', 'summonPriceScale', '--summon-price-scale', '', 100, (value) => value / 100]
].map(([key, inputId, cssVar, unit, defaultValue, toCss]) => {
  const input = document.querySelector(`#${inputId}`);
  return {
    key,
    input,
    output: document.querySelector(`#${inputId}Value`),
    cssVar,
    unit,
    defaultValue,
    toCss
  };
});

debugTarget.innerHTML = debugGroups.map((group) => `<option value="${group.key}">${group.label}</option>`).join('');

function formatShowcaseDebugValue(field, value) {
  if (field.key.endsWith('Scale') || ['windowW', 'windowH'].includes(field.key)) return `${value}%`;
  return `${value}${field.unit}`;
}

function applyShowcaseDebugConfig() {
  const target = document.querySelector('.wardrobe-content .equipped-preview');
  if (!target) return;
  showcaseDebugFields.forEach((field) => {
    const value = Number(showcaseDebugConfig[field.key] ?? field.defaultValue);
    const cssValue = field.unit ? `${field.toCss(value)}${field.unit}` : field.toCss(value);
    target.style.setProperty(field.cssVar, cssValue);
    if (field.input) field.input.value = value;
    if (field.output) field.output.value = formatShowcaseDebugValue(field, value);
  });
}

function saveShowcaseDebugControl() {
  showcaseDebugFields.forEach((field) => {
    if (field.input) showcaseDebugConfig[field.key] = Number(field.input.value);
  });
  localStorage.setItem(SHOWCASE_DEBUG_STORAGE_KEY, JSON.stringify(showcaseDebugConfig));
  applyShowcaseDebugConfig();
}

function formatVisualDebugValue(field, value) {
  if (field.key.endsWith('Scale')) return `${value}%`;
  return `${value}${field.unit}`;
}

function applyVisualDebugConfig() {
  visualDebugFields.forEach((field) => {
    const value = Number(visualDebugConfig[field.key] ?? field.defaultValue);
    const cssValue = field.unit ? `${field.toCss(value)}${field.unit}` : field.toCss(value);
    document.documentElement.style.setProperty(field.cssVar, cssValue);
    if (field.input) field.input.value = value;
    if (field.output) field.output.value = formatVisualDebugValue(field, value);
  });
}

function saveVisualDebugControl() {
  visualDebugFields.forEach((field) => {
    if (field.input) visualDebugConfig[field.key] = Number(field.input.value);
  });
  localStorage.setItem(VISUAL_DEBUG_STORAGE_KEY, JSON.stringify(visualDebugConfig));
  applyVisualDebugConfig();
}

function refreshDebugTargets() {
  debugGroups.forEach((group) => document.querySelectorAll(group.selector).forEach((element) => {
    element.dataset.debugTarget = group.key;
    if (!element.dataset.debugBaseFont) element.dataset.debugBaseFont = parseFloat(getComputedStyle(element).fontSize) || 16;
  }));
  applyAllDebugConfig();
}

function applyDebugGroup(key) {
  const group = debugGroups.find((entry) => entry.key === key);
  if (!group) return;
  const config = debugConfig[key];
  document.querySelectorAll(group.selector).forEach((element) => {
    if (!config) {
      element.style.removeProperty('translate');
      element.style.removeProperty('font-size');
      return;
    }
    const baseFont = Number(element.dataset.debugBaseFont) || parseFloat(getComputedStyle(element).fontSize) || 16;
    element.style.translate = `${config.x}px ${config.y}px`;
    element.style.fontSize = `${baseFont * config.size / 100}px`;
  });
}

function applyAllDebugConfig() { debugGroups.forEach((group) => applyDebugGroup(group.key)); }

function selectDebugGroup(key) {
  activeDebugKey = key;
  debugTarget.value = key;
  document.querySelectorAll('.debug-selected').forEach((element) => element.classList.remove('debug-selected'));
  const group = debugGroups.find((entry) => entry.key === key);
  if (group) document.querySelectorAll(group.selector).forEach((element) => element.classList.add('debug-selected'));
  const config = debugConfig[key] || { x: 0, y: 0, size: 100 };
  debugControls.x.value = config.x; debugControls.y.value = config.y; debugControls.size.value = config.size;
  debugControls.xValue.value = `${config.x} px`; debugControls.yValue.value = `${config.y} px`; debugControls.sizeValue.value = `${config.size}%`;
}

function saveDebugControl() {
  debugConfig[activeDebugKey] = { x: Number(debugControls.x.value), y: Number(debugControls.y.value), size: Number(debugControls.size.value) };
  localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(debugConfig));
  applyDebugGroup(activeDebugKey);
  selectDebugGroup(activeDebugKey);
}

function setDebugOpen(open) {
  debugPanel.classList.toggle('is-open', open);
  debugPanel.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('debug-mode', open);
  document.querySelector('#debugToggle').setAttribute('aria-expanded', String(open));
  if (open) { refreshDebugTargets(); selectDebugGroup(activeDebugKey); applyShowcaseDebugConfig(); applyVisualDebugConfig(); }
  else document.querySelectorAll('.debug-selected').forEach((element) => element.classList.remove('debug-selected'));
}

document.querySelector('#debugToggle').addEventListener('click', () => setDebugOpen(!debugPanel.classList.contains('is-open')));
document.querySelector('#debugClose').addEventListener('click', () => setDebugOpen(false));
debugTarget.addEventListener('change', () => selectDebugGroup(debugTarget.value));
[debugControls.x, debugControls.y, debugControls.size].forEach((control) => control.addEventListener('input', saveDebugControl));
showcaseDebugFields.forEach((field) => field.input?.addEventListener('input', saveShowcaseDebugControl));
visualDebugFields.forEach((field) => field.input?.addEventListener('input', saveVisualDebugControl));
document.querySelector('#debugReset').addEventListener('click', () => { delete debugConfig[activeDebugKey]; localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(debugConfig)); applyDebugGroup(activeDebugKey); selectDebugGroup(activeDebugKey); });
document.querySelector('#showcaseDebugReset')?.addEventListener('click', () => { showcaseDebugConfig = {}; localStorage.removeItem(SHOWCASE_DEBUG_STORAGE_KEY); applyShowcaseDebugConfig(); });
document.querySelector('#visualDebugReset')?.addEventListener('click', () => { visualDebugConfig = {}; localStorage.removeItem(VISUAL_DEBUG_STORAGE_KEY); applyVisualDebugConfig(); });
document.querySelector('#debugResetAll').addEventListener('click', () => { debugConfig = {}; showcaseDebugConfig = {}; visualDebugConfig = {}; localStorage.removeItem(DEBUG_STORAGE_KEY); localStorage.removeItem(SHOWCASE_DEBUG_STORAGE_KEY); localStorage.removeItem(VISUAL_DEBUG_STORAGE_KEY); applyAllDebugConfig(); applyShowcaseDebugConfig(); applyVisualDebugConfig(); selectDebugGroup(activeDebugKey); });
document.querySelector('#debugExport').addEventListener('click', async () => {
  const output = JSON.stringify({ text: debugConfig, outfitShowcase: showcaseDebugConfig, visual: visualDebugConfig }, null, 2);
  try { await navigator.clipboard.writeText(output); } catch { window.prompt('复制下方配置：', output); }
  showToast('调试配置已复制');
});
document.addEventListener('click', (event) => {
  if (!document.body.classList.contains('debug-mode') || event.target.closest('.debug-panel, .debug-toggle')) return;
  const target = event.target.closest('[data-debug-target]');
  if (!target) return;
  event.preventDefault(); event.stopPropagation();
  selectDebugGroup(target.dataset.debugTarget);
}, true);
new MutationObserver(() => refreshDebugTargets()).observe(document.querySelector('.game-shell'), { childList: true, subtree: true });
refreshDebugTargets();
applyShowcaseDebugConfig();
applyVisualDebugConfig();
