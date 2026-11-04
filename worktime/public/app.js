// BESY 근무기록 — 화면 스크립트
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const durM = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`; };
const dur = ms => durM(ms / 60000);
const hmK = m => { m = Math.round(m); return `${Math.floor(m / 60)}시간 ${m % 60}분`; };
const hhmm = m => `${Math.floor(m / 60)}:${pad(Math.round(m) % 60)}`;
const ymd = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ym = (y, m) => `${y}-${pad(m + 1)}`;
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
// 3.3% 원천징수: 소득세 3% + 지방소득세(소득세의 10%) — 각각 10원 미만 버림
function payCalc(minutes, wage) {
  const gross = Math.round(minutes / 60 * wage);
  const inc = Math.floor(gross * 0.03 / 10) * 10;
  const local = Math.floor(inc * 0.1 / 10) * 10;
  return { gross, inc, local, tax: inc + local, net: gross - inc - local };
}
const NAMES = { hyerin: '혜린', yujeong: '유정' };
const KEYS = Object.keys(NAMES);

// ───────── 상태 ─────────
let token = ls.get('besy.token', null);
let me = null, isAdmin = false, adminInfo = null;
let myState = { session: null, todos: [] };
let allStates = {};
const recCache = {};          // 'person|YYYY-MM' -> records[]
const recLoading = {};
let adminWho = 'hyerin', selDate = null;
const now0 = new Date(); let viewY = now0.getFullYear(), viewM = now0.getMonth();
const stateOf = k => (k === me ? myState : allStates[k]) || { session: null, todos: [] };

// ───────── 서버 통신 ─────────
let pending = 0, loadTimer = null;
function busy(on) {
  pending += on ? 1 : -1;
  clearTimeout(loadTimer);
  if (pending > 0) loadTimer = setTimeout(() => {
    $('loading').hidden = false;
    $('loadingText').textContent = '서버를 깨우는 중이에요…\n오랜만에 열면 최대 1분 정도 걸릴 수 있어요.';
  }, 1200);
  else $('loading').hidden = true;
}
async function api(path, { method = 'GET', body, quiet = false } = {}) {
  if (!quiet) busy(true);
  try {
    const res = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') { logout(); throw new Error(data.error || '다시 로그인해 주세요.'); }
    if (!res.ok) throw new Error(data.error || `오류가 났어요 (${res.status})`);
    return data;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('인터넷 연결을 확인해 주세요.');
    throw e;
  } finally { if (!quiet) busy(false); }
}
function note(t) { $('note').textContent = t; $('adminNote').textContent = t; }

let saveTimer = null, savePending = false;
function saveState() {
  ls.set('besy.state.' + me, myState);
  clearTimeout(saveTimer); savePending = true;
  saveTimer = setTimeout(() => {
    api('/api/state', { method: 'PUT', body: myState, quiet: true })
      .then(() => { savePending = false; if (/저장하지 못했/.test($('note').textContent)) note(''); })
      .catch(e => note('⚠️ 저장하지 못했어요: ' + e.message));
  }, 400);
}

async function loadRecords(k, y, m, force) {
  const key = `${k}|${ym(y, m)}`;
  if (recCache[key] && !force) return recCache[key];
  if (recLoading[key]) return recLoading[key];
  recLoading[key] = api(`/api/records?person=${k}&month=${ym(y, m)}`, { quiet: true })
    .then(d => (recCache[key] = d.records))
    .finally(() => delete recLoading[key]);
  return recLoading[key];
}
const cached = (k, y, m) => recCache[`${k}|${ym(y, m)}`];

// ───────── 계산 ─────────
const isPaused = s => !!(s && s.pauses.length && s.pauses.at(-1).to == null);
const breakMs = (s, now = Date.now()) => s ? s.pauses.reduce((a, p) => a + ((p.to ?? now) - p.from), 0) : 0;
const workMs = (s, now = Date.now()) => s ? now - s.start - breakMs(s, now) : 0;
const stateName = s => !s ? 'idle' : isPaused(s) ? 'paused' : 'working';
function liveMinutesIn(k, y, m) { const s = stateOf(k).session; return s && ymd(s.start).startsWith(ym(y, m) + '-') ? workMs(s) / 60000 : 0; }
function byDay(list) { const o = {}; (list || []).forEach(r => { (o[r.date] ||= []).push(r); }); return o; }

// ───────── 근무 화면 ─────────
function render() {
  if (!me) return;
  const s = myState.session;
  $('today').textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  $('timer').textContent = hms(workMs(s));
  $('startAt').textContent = s ? hm(s.start) : '--:--';
  $('breakTime').textContent = dur(breakMs(s));
  const st = stateName(s);
  $('statusText').textContent = { idle: '출근 전', working: '근무 중', paused: '일시정지 중' }[st];
  $('dot').className = 'dot ' + st;
  $('btnStart').disabled = st !== 'idle';
  $('btnPause').disabled = st === 'idle';
  $('btnEnd').disabled = st === 'idle';
  $('btnPause').textContent = st === 'paused' ? '근무 재개' : '일시정지';
  $('btnPause').classList.toggle('resume', st === 'paused');
  renderLive();
}

function renderTodos() {
  if (!me) return;
  const ul = $('todos'); ul.replaceChildren();
  const todos = myState.todos;
  const done = todos.filter(t => t.done).length;
  $('todoCount').textContent = todos.length ? `${done} / ${todos.length} 완료` : '';
  if (!todos.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '출근하면 오늘 할 일을 먼저 적어보세요.'; ul.append(li); return; }
  todos.forEach(t => {
    const li = document.createElement('li'); if (t.done) li.className = 'done';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
    cb.onchange = () => { t.done = cb.checked; saveState(); renderTodos(); };
    const sp = document.createElement('span'); sp.textContent = t.text;
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', '삭제');
    x.onclick = () => { myState.todos = myState.todos.filter(o => o !== t); saveState(); renderTodos(); };
    li.append(cb, sp, x); ul.append(li);
  });
}
$('todoForm').onsubmit = e => {
  e.preventDefault();
  const v = $('todoInput').value.trim(); if (!v) return;
  myState.todos.push({ id: Date.now().toString(36), text: v, done: false });
  $('todoInput').value = ''; saveState(); renderTodos();
};

function renderMonthMini() {
  if (!me) return;
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  $('myMonthLabel').textContent = `${m + 1}월 누적 근무`;
  const list = cached(me, y, m);
  if (!list) { $('myMonthTotal').textContent = '…'; loadRecords(me, y, m).then(renderMonthMini).catch(() => { $('myMonthTotal').textContent = '-'; }); return; }
  const total = list.reduce((a, r) => a + r.workMinutes, 0);
  $('myMonthTotal').textContent = hmK(total);
  $('myMonthDays').textContent = `${Object.keys(byDay(list)).length}일 근무`;
}

// ───────── 내 기록 / 고치기 ─────────
let myY = now0.getFullYear(), myM = now0.getMonth();
function renderMyRecs() {
  if (!me) return;
  $('myMLabel').textContent = `${myM + 1}월`;
  const ul = $('myRecs'); ul.replaceChildren();
  const list = cached(me, myY, myM);
  if (!list) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = '불러오는 중…'; ul.append(li);
    loadRecords(me, myY, myM).then(renderMyRecs).catch(e => { li.textContent = '⚠️ ' + e.message; });
    return;
  }
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '이 달에는 기록이 없어요.'; ul.append(li); return; }
  [...list].reverse().forEach(r => {
    const li = document.createElement('li');
    const d = document.createElement('span'); d.className = 'd';
    const [, mm, dd] = r.date.split('-'); const wd = '일월화수목금토'[new Date(r.date + 'T00:00').getDay()];
    d.textContent = `${+mm}/${+dd} (${wd})`;
    const t = document.createElement('span'); t.className = 't';
    t.append(`${r.startText}–${r.endText} · `); const b = document.createElement('b'); b.textContent = durM(r.workMinutes); t.append(b);
    if (r.edited) { const g = document.createElement('span'); g.className = 'badge'; g.textContent = '수정됨'; t.append(g); }
    const e = document.createElement('button'); e.className = 'edit-btn'; e.textContent = '✏️ 수정'; e.onclick = () => openEdit(r, me);
    li.append(d, t, e); ul.append(li);
  });
}
$('myPrev').onclick = () => { myM--; if (myM < 0) { myM = 11; myY--; } renderMyRecs(); };
$('myNext').onclick = () => { myM++; if (myM > 11) { myM = 0; myY++; } renderMyRecs(); };

let editing = null;
const tMin = v => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; };
function editCalc() {
  const s = tMin($('eStart').value), e = tMin($('eEnd').value), brk = Math.max(0, +$('eBreak').value || 0);
  if (s == null || e == null) { $('eCalc').textContent = '출근·퇴근 시각을 넣어주세요.'; return null; }
  const span = e > s ? e - s : e + 1440 - s, work = span - brk;
  $('eCalc').replaceChildren(`실근무 `, Object.assign(document.createElement('b'), { textContent: work > 0 ? hmK(work) : '-' }),
    e <= s ? ' (다음 날 퇴근으로 계산)' : '', work <= 0 ? ' — 휴식이 너무 길어요' : '');
  return work;
}
['eStart', 'eEnd', 'eBreak'].forEach(id => $(id).addEventListener('input', editCalc));
function openEdit(r, owner) {
  editing = { r, owner };
  const [, mm, dd] = r.date.split('-');
  $('editDate').textContent = `${NAMES[owner]} 님 · ${+mm}월 ${+dd}일 기록`;
  $('eStart').value = r.startText; $('eEnd').value = r.endText; $('eBreak').value = r.breakMinutes;
  $('eSummary').value = r.summary || '';
  $('editError').textContent = '';
  editCalc();
  $('editOverlay').classList.add('open');
}
$('editCancel').onclick = () => $('editOverlay').classList.remove('open');
$('editForm').onsubmit = async e => {
  e.preventDefault();
  const work = editCalc();
  if (!work || work <= 0) { $('editError').textContent = '시간을 다시 확인해 주세요.'; return; }
  $('editSave').disabled = true; $('editSave').textContent = '저장 중…';
  try {
    const { r, owner } = editing;
    const d = await api('/api/records/' + r.id, { method: 'PATCH', body: {
      startText: $('eStart').value.slice(0, 5), endText: $('eEnd').value.slice(0, 5),
      breakMinutes: Math.max(0, +$('eBreak').value || 0), summary: $('eSummary').value,
    } });
    Object.assign(r, d.record);
    Object.keys(recCache).forEach(k => { if (k.startsWith(owner + '|')) delete recCache[k]; });
    $('editOverlay').classList.remove('open');
    note('✅ 기록을 고쳤어요. 노션에도 반영됐어요.');
    renderAll();
  } catch (err) { $('editError').textContent = '저장하지 못했어요: ' + err.message; }
  finally { $('editSave').disabled = false; $('editSave').textContent = '저장'; }
};

// ───────── 버튼 ─────────
$('btnStart').onclick = () => { myState.session = { start: Date.now(), pauses: [] }; saveState(); render(); };
$('btnPause').onclick = () => {
  const s = myState.session;
  if (isPaused(s)) s.pauses.at(-1).to = Date.now();
  else s.pauses.push({ from: Date.now(), to: null });
  saveState(); render();
};
$('btnEnd').onclick = () => {
  const s = myState.session, now = Date.now();
  $('endTitle').textContent = `오늘도 수고했어요, ${NAMES[me]} 님 👏`;
  $('endSummary').textContent = `출근 ${hm(s.start)} · 지금 ${hm(now)} · 실근무 ${dur(workMs(s, now))} · 휴식 ${dur(breakMs(s, now))}`;
  $('endError').textContent = '';
  if (!$('summary').value.trim()) $('summary').value = myState.todos.filter(t => t.done).map(t => '- ' + t.text).join('\n');
  $('overlay').classList.add('open'); $('summary').focus();
};
$('btnCancel').onclick = () => $('overlay').classList.remove('open');

$('endForm').onsubmit = async e => {
  e.preventDefault();
  const text = $('summary').value.trim();
  if (!text) { $('endError').textContent = '오늘 한 일을 적어주세요.'; return; }
  $('btnSave').disabled = true; $('btnSave').textContent = '노션에 저장 중…';
  try {
    clearTimeout(saveTimer);
    const d = await api('/api/finish', { method: 'POST', body: { summary: text, session: myState.session, todos: myState.todos } });
    myState = d.state; ls.set('besy.state.' + me, myState);
    const n = new Date(); delete recCache[`${me}|${ym(n.getFullYear(), n.getMonth())}`];
    Object.keys(recCache).forEach(k => { if (k.startsWith(me + '|')) delete recCache[k]; });
    $('summary').value = ''; $('overlay').classList.remove('open');
    note('✅ 노션에 저장됐어요. 오늘도 수고 많았어요!');
    renderAll();
  } catch (err) {
    $('endError').textContent = '저장하지 못했어요: ' + err.message + ' 잠시 뒤 다시 눌러주세요. (근무 기록은 그대로 있어요)';
  } finally { $('btnSave').disabled = false; $('btnSave').textContent = '저장하고 퇴근'; }
};

// ───────── 관리자 화면 ─────────
function renderLive() {
  if ($('view-admin').hidden) return;
  const box = $('liveList'); box.replaceChildren();
  KEYS.forEach(k => {
    const s = stateOf(k).session, st = stateName(s);
    const row = document.createElement('div'); row.className = 'live-row';
    const dot = document.createElement('span'); dot.className = 'dot ' + st;
    const t = document.createElement('span'); t.textContent = `${NAMES[k]} 님 · ` + { idle: '출근 전', working: '근무 중', paused: '휴식 중' }[st];
    const w = document.createElement('span'); w.className = 'when'; w.textContent = s ? `${hm(s.start)} 출근 · 실근무 ${hms(workMs(s))}` : '';
    row.append(dot, t, w); box.append(row);
  });
}
const heat = m => m <= 0 ? 'var(--bg)' : `color-mix(in srgb, var(--accent) ${Math.round(12 + Math.min(m / 540, 1) * 48)}%, var(--card))`;
$('lg1').style.background = heat(120); $('lg2').style.background = heat(300); $('lg3').style.background = heat(540);

function monthMinutes(k, y, m) {
  const list = cached(k, y, m);
  if (!list) { loadRecords(k, y, m).then(renderAdmin).catch(e => note('⚠️ ' + e.message)); return null; }
  return list.reduce((a, r) => a + r.workMinutes, 0) + liveMinutesIn(k, y, m);
}

function renderPay() {
  const k = 'hyerin', wage = adminInfo?.people?.[k]?.wage || 0, PAYDAY = adminInfo?.payday || 5, n = new Date();
  $('payCard').hidden = !wage;
  if (!wage) return;
  $('payRate').textContent = `시급 ${won(wage)}`;
  const pd = n.getDate() <= PAYDAY ? new Date(n.getFullYear(), n.getMonth(), PAYDAY) : new Date(n.getFullYear(), n.getMonth() + 1, PAYDAY);
  const wm = new Date(pd.getFullYear(), pd.getMonth() - 1, 1);
  const dLeft = Math.round((pd - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
  $('payNextLabel').textContent = `다음 급여일 ${pd.getMonth() + 1}월 ${PAYDAY}일` + (dLeft === 0 ? ' (오늘)' : ` (D-${dLeft})`);
  const m1 = monthMinutes(k, wm.getFullYear(), wm.getMonth());
  const m2 = monthMinutes(k, n.getFullYear(), n.getMonth());
  $('payNowLabel').textContent = `${n.getMonth() + 1}월 누적 (오늘까지)`;
  if (m1 == null || m2 == null) { $('payNextWon').textContent = $('payNowWon').textContent = '…'; return; }
  const p1 = payCalc(m1, wage), p2 = payCalc(m2, wage);
  $('payNextWon').textContent = won(p1.net);
  $('payNextSub').textContent = `실지급 · ${wm.getMonth() + 1}월 근무 ${hmK(m1)}`;
  $('payNowWon').textContent = won(p2.net);
  $('payNowSub').textContent = `실지급 · ${hmK(m2)} 근무 · 세전 ${won(p2.gross)}`;
  $('payTblCap').textContent = `${pd.getMonth() + 1}월 ${PAYDAY}일 지급 명세 (${wm.getMonth() + 1}월 근무분)`;
  $('tGross').textContent = won(p1.gross);
  $('tInc').textContent = '-' + won(p1.inc);
  $('tLocal').textContent = '-' + won(p1.local);
  $('tNet').textContent = won(p1.net);
  const taxDue = new Date(pd.getFullYear(), pd.getMonth() + 1, 10);
  $('payTaxNote').textContent = `🏢 원천세 ${won(p1.tax)}은 회사가 ${taxDue.getMonth() + 1}월 10일까지 신고·납부해요.`;
}

function renderAdmin() {
  if ($('view-admin').hidden) return;
  renderLive();
  renderPay();
  const chips = $('chips'); chips.replaceChildren();
  KEYS.forEach(k => {
    const c = document.createElement('button'); c.className = 'chip' + (k === adminWho ? ' on' : ''); c.textContent = NAMES[k];
    c.onclick = () => { adminWho = k; selDate = null; renderAdmin(); };
    chips.append(c);
  });
  $('mLabel').textContent = `${viewY}년 ${viewM + 1}월`;
  const list = cached(adminWho, viewY, viewM);
  if (!list) loadRecords(adminWho, viewY, viewM).then(renderAdmin).catch(e => note('⚠️ ' + e.message));
  const recs = list || [], days = byDay(recs);
  const total = recs.reduce((a, r) => a + r.workMinutes, 0);
  const brk = recs.reduce((a, r) => a + r.breakMinutes, 0);
  const nDays = Object.keys(days).length;
  $('sTotal').textContent = list ? hmK(total) : '…';
  $('sDays').textContent = list ? `${nDays}일` : '…';
  $('sAvg').textContent = list ? (nDays ? hmK(total / nDays) : '-') : '…';
  $('sBreak').textContent = list ? hmK(brk) : '…';

  const wage = adminInfo?.people?.[adminWho]?.wage || 0, PAYDAY = adminInfo?.payday || 5;
  $('monthPay').hidden = !wage || !list;
  if (wage && list) {
    const pd = new Date(viewY, viewM + 1, PAYDAY);
    const pc = payCalc(total + liveMinutesIn(adminWho, viewY, viewM), wage);
    $('monthPay').innerHTML = '<span></span><div class="r"><b></b><small></small></div>';
    $('monthPay').firstChild.textContent = `${viewM + 1}월 급여 (${pd.getMonth() + 1}월 ${PAYDAY}일 지급)`;
    $('monthPay').querySelector('b').textContent = '실지급 ' + won(pc.net);
    $('monthPay').querySelector('small').textContent = `세전 ${won(pc.gross)} · 원천세 ${won(pc.tax)}`;
  }

  const cal = $('cal'); cal.replaceChildren();
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) => { const e = document.createElement('div'); e.className = 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''); e.textContent = d; cal.append(e); });
  const first = new Date(viewY, viewM, 1).getDay(), last = new Date(viewY, viewM + 1, 0).getDate();
  for (let i = 0; i < first; i++) { const e = document.createElement('div'); e.className = 'day blank'; cal.append(e); }
  const todayStr = ymd(Date.now()), s = stateOf(adminWho).session;
  for (let d = 1; d <= last; d++) {
    const ds = `${ym(viewY, viewM)}-${pad(d)}`, dow = (first + d - 1) % 7;
    let mins = (days[ds] || []).reduce((a, r) => a + r.workMinutes, 0);
    const live = s && ymd(s.start) === ds;
    if (live) mins += workMs(s) / 60000;
    const b = document.createElement('button');
    b.className = 'day' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') + (ds === todayStr ? ' today' : '') + (ds === selDate ? ' sel' : '') + (live ? ' live' : '');
    b.style.background = heat(mins);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = d;
    const h = document.createElement('span'); h.className = 'h'; h.textContent = mins >= 1 ? hhmm(mins) : '';
    b.append(n, h); b.onclick = () => { selDate = ds; renderAdmin(); };
    cal.append(b);
  }
  renderDetail(recs);
}

function renderDetail(recs) {
  const box = $('detail'); box.replaceChildren();
  if (!selDate) { box.innerHTML = '<p class="empty">달력에서 날짜를 누르면 그날 기록을 볼 수 있어요.</p>'; return; }
  const [y, m, d] = selDate.split('-').map(Number);
  const h = document.createElement('h2'); h.textContent = `${NAMES[adminWho]} 님 · ` + new Date(y, m - 1, d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  box.append(h);
  const list = recs.filter(r => r.date === selDate);
  const s = stateOf(adminWho).session, liveHere = s && ymd(s.start) === selDate;
  if (liveHere) { const p = document.createElement('p'); p.className = 'txt'; p.textContent = `🟢 지금 근무 중 · ${hm(s.start)} 출근 · 실근무 ${dur(workMs(s))}`; box.append(p); }
  if (!list.length) { if (!liveHere) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '이날은 근무 기록이 없어요.'; box.append(p); } return; }
  list.forEach(r => {
    const div = document.createElement('div'); div.className = 'rec';
    div.innerHTML = `<div class="kv"><div>출근<b></b></div><div>퇴근<b></b></div><div>실근무<b></b></div></div>`;
    const bs = div.querySelectorAll('b'); bs[0].textContent = r.startText; bs[1].textContent = r.endText; bs[2].textContent = durM(r.workMinutes);
    const sub = document.createElement('div'); sub.className = 'empty'; sub.textContent = `휴식 ${durM(r.breakMinutes)}`;
    if (r.edited) { const g = document.createElement('span'); g.className = 'badge'; g.textContent = '✏️ 수정됨'; sub.append(g); }
    div.append(sub);
    if (r.editLog) { const lg = document.createElement('div'); lg.className = 'editlog'; lg.textContent = r.editLog; div.append(lg); }
    const l2 = document.createElement('div'); l2.className = 'lbl'; l2.textContent = '오늘 한 일';
    const tx = document.createElement('div'); tx.className = 'txt'; tx.textContent = r.summary || '-';
    div.append(l2, tx);
    const nl = document.createElement('div'); nl.className = 'nlink';
    const eb = document.createElement('button'); eb.className = 'edit-btn'; eb.textContent = '✏️ 수정'; eb.onclick = () => openEdit(r, adminWho); nl.append(eb);
    if (r.url) { const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '노션에서 보기 ↗'; nl.append(a); }
    div.append(nl);
    box.append(div);
  });
}

$('prevM').onclick = () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } selDate = null; renderAdmin(); };
$('nextM').onclick = () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } selDate = null; renderAdmin(); };

async function refreshStates() {
  if (!isAdmin || $('view-admin').hidden) return;
  try {
    const d = await api('/api/states', { quiet: true });
    allStates = d.states; renderAdmin();
  } catch {}
}

// ───────── 탭 ─────────
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  $('view-work').hidden = tab !== 'work';
  $('view-admin').hidden = tab !== 'admin';
  if (tab === 'admin') { Object.keys(recCache).forEach(k => delete recCache[k]); refreshStates(); }
  renderAll();
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ───────── 로그인 ─────────
let pickKey = null, pin = '';
function enter(d) {
  me = d.person; isAdmin = !!d.admin; adminInfo = d.adminInfo || null;
  ls.set('besy.admin', isAdmin);
  myState = d.state || { session: null, todos: [] };
  ls.set('besy.state.' + me, myState);
  $('view-login').hidden = true;
  $('topBar').hidden = false;
  $('tabs').hidden = !isAdmin;
  $('whoName').textContent = NAMES[me];
  $('summary').value = '';
  showTab('work');
}
function logout() {
  token = null; me = null; isAdmin = false; adminInfo = null;
  ls.del('besy.token'); ls.del('besy.admin');
  Object.keys(recCache).forEach(k => delete recCache[k]);
  $('view-login').hidden = false; $('topBar').hidden = true; $('tabs').hidden = true;
  $('view-work').hidden = $('view-admin').hidden = true;
  $('pickBox').hidden = false; $('pinBox').hidden = true;
}
function drawPin() { [...$('pinDots').children].forEach((d, i) => d.classList.toggle('on', i < pin.length)); }
async function pressKey(k) {
  if (pin.length === 4) return;
  if (k === 'del') pin = pin.slice(0, -1); else pin += k;
  $('pinErr').textContent = ''; drawPin();
  if (pin.length === 4) {
    try {
      const d = await api('/api/login', { method: 'POST', body: { person: pickKey, pin } });
      token = d.token; ls.set('besy.token', token);
      const meData = await api('/api/me');
      pin = ''; drawPin(); enter(meData);
    } catch (e) {
      $('pinErr').textContent = e.message;
      $('pinDots').classList.remove('shake'); void $('pinDots').offsetWidth; $('pinDots').classList.add('shake');
      pin = ''; setTimeout(drawPin, 300);
    }
  }
}
['1','2','3','4','5','6','7','8','9','','0','del'].forEach(k => {
  const b = document.createElement('button'); b.type = 'button';
  if (!k) { b.className = 'key ghost'; b.disabled = true; }
  else { b.className = 'key' + (k === 'del' ? ' ghost' : ''); b.textContent = k === 'del' ? '지우기' : k; b.onclick = () => pressKey(k); }
  $('keypad').append(b);
});
document.addEventListener('keydown', e => {
  if ($('pinBox').hidden || $('view-login').hidden) return;
  if (/^[0-9]$/.test(e.key)) pressKey(e.key);
  else if (e.key === 'Backspace') pressKey('del');
});
document.querySelectorAll('.pick-btn').forEach(b => b.onclick = () => {
  pickKey = b.dataset.person; pin = ''; drawPin(); $('pinErr').textContent = '';
  $('pinWho').textContent = NAMES[pickKey] + ' 님';
  $('pickBox').hidden = true; $('pinBox').hidden = false;
});
$('pinBack').onclick = () => { $('pickBox').hidden = false; $('pinBox').hidden = true; };
$('btnLogout').onclick = logout;

function renderAll() { render(); renderTodos(); renderMonthMini(); renderMyRecs(); renderAdmin(); }

// 다른 기기에서 바꾼 내용 불러오기 (화면으로 돌아왔을 때)
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !me || $('overlay').classList.contains('open')) return;
  try {
    const d = await api('/api/me', { quiet: true });
    if (!savePending) { myState = d.state; ls.set('besy.state.' + me, myState); renderAll(); }
  } catch {}
});

// 시작
(async () => {
  if (!token) return logout();
  const p = token.split('.')[0];
  if (NAMES[p]) enter({ person: p, admin: ls.get('besy.admin', false), state: ls.get('besy.state.' + p, { session: null, todos: [] }) }); // 화면은 바로 보여주고 서버 응답으로 갱신
  try { enter(await api('/api/me')); }
  catch (e) { if (me) note('⚠️ ' + e.message); else logout(); }
})();

let lastMin = -1, lastPoll = 0;
setInterval(() => {
  render();
  const m = new Date().getMinutes();
  if (m !== lastMin) { lastMin = m; renderAdmin(); }
  if (isAdmin && !$('view-admin').hidden && Date.now() - lastPoll > 15000) { lastPoll = Date.now(); refreshStates(); }
}, 1000);
