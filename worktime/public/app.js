const COMPANY = 'BESY';
const EMPLOYEE = '혜린';
const KEY_SESSION = 'besy.session';
const KEY_HISTORY = 'besy.history';

const $ = id => document.getElementById(id);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// session: { start, pauses: [{from, to|null}] } | null
let session = load(KEY_SESSION, null);
let history = load(KEY_HISTORY, []);

const pad = n => String(n).padStart(2, '0');
const hms = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const ymd = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const isPaused = () => session && session.pauses.length && session.pauses.at(-1).to == null;
const breakMs = (now = Date.now()) => session ? session.pauses.reduce((a, p) => a + ((p.to ?? now) - p.from), 0) : 0;
const workMs = (now = Date.now()) => session ? now - session.start - breakMs(now) : 0;

function render() {
  const d = new Date();
  $('today').textContent = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  $('timer').textContent = hms(workMs());
  $('startAt').textContent = session ? hm(session.start) : '--:--';
  $('breakTime').textContent = dur(breakMs());

  const state = !session ? 'idle' : isPaused() ? 'paused' : 'working';
  $('statusText').textContent = { idle: '출근 전', working: '근무 중', paused: '일시정지 중' }[state];
  $('dot').className = 'dot ' + state;
  $('btnStart').disabled = state !== 'idle';
  $('btnPause').disabled = state === 'idle';
  $('btnEnd').disabled = state === 'idle';
  $('btnPause').textContent = state === 'paused' ? '근무 재개' : '일시정지';
  $('btnPause').classList.toggle('resume', state === 'paused');
}

function renderHistory() {
  const ul = $('history');
  if (!history.length) { ul.innerHTML = '<li class="empty">아직 기록이 없어요.</li>'; return; }
  ul.innerHTML = '';
  history.slice(0, 10).forEach((r, i) => {
    const li = document.createElement('li');
    const tag = r.notionUrl ? `<span class="tag"><a href="${r.notionUrl}" target="_blank" rel="noopener">노션 ↗</a></span>`
      : `<span class="tag fail" data-i="${i}">노션 저장 실패 · 다시 시도</span>`;
    li.innerHTML = `<div class="row"><span class="d">${r.date}${tag}</span><span class="t">${r.startText}–${r.endText} · ${r.workText}</span></div>
      <div class="s"></div>`;
    li.querySelector('.s').textContent = r.summary;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.tag.fail').forEach(el => el.onclick = () => retry(+el.dataset.i));
}

async function sendToNotion(record) {
  const res = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장 실패');
  return data.url;
}

async function retry(i) {
  try { history[i].notionUrl = await sendToNotion(history[i]); save(KEY_HISTORY, history); renderHistory(); }
  catch (e) { alert('노션 저장 실패: ' + e.message); }
}

// ── 버튼 ─────────────────────────────
$('btnStart').onclick = () => {
  session = { start: Date.now(), pauses: [] };
  save(KEY_SESSION, session); render();
};

$('btnPause').onclick = () => {
  if (isPaused()) session.pauses.at(-1).to = Date.now();
  else session.pauses.push({ from: Date.now(), to: null });
  save(KEY_SESSION, session); render();
};

$('btnEnd').onclick = () => {
  const now = Date.now();
  $('endSummary').textContent = `출근 ${hm(session.start)} · 지금 ${hm(now)} · 실근무 ${dur(workMs(now))} · 휴식 ${dur(breakMs(now))}`;
  $('endError').textContent = '';
  $('endDialog').showModal();
  $('summary').focus();
};

$('btnCancel').onclick = () => $('endDialog').close();

$('endForm').onsubmit = async e => {
  e.preventDefault();
  const text = $('summary').value.trim();
  if (!text) { $('endError').textContent = '오늘 한 일을 적어주세요.'; return; }

  const now = Date.now();
  if (isPaused()) session.pauses.at(-1).to = now; // 일시정지 상태에서 퇴근하면 휴식 종료 처리
  const record = {
    company: COMPANY, employee: EMPLOYEE, date: ymd(session.start),
    start: new Date(session.start).toISOString(), end: new Date(now).toISOString(),
    startText: hm(session.start), endText: hm(now),
    workMinutes: Math.round(workMs(now) / 60000), breakMinutes: Math.round(breakMs(now) / 60000),
    workText: dur(workMs(now)), breakText: dur(breakMs(now)), summary: text,
  };

  $('btnSave').disabled = true; $('btnSave').textContent = '노션에 저장 중…';
  try {
    record.notionUrl = await sendToNotion(record);
  } catch (err) {
    $('endError').textContent = `노션 저장 실패: ${err.message} (기록은 이 기기에 보관되며, 목록에서 다시 시도할 수 있어요)`;
    await new Promise(r => setTimeout(r, 1800));
  }
  history.unshift(record); save(KEY_HISTORY, history);
  session = null; localStorage.removeItem(KEY_SESSION);
  $('summary').value = '';
  $('btnSave').disabled = false; $('btnSave').textContent = '저장하고 퇴근';
  $('endDialog').close();
  render(); renderHistory();
};

fetch('/api/status').then(r => r.json()).then(s => {
  $('notionState').textContent = s.notion ? '● 노션 연동됨 · 퇴근 시 BESY 근무 기록에 저장됩니다' : '○ 노션 미연동 — 서버 .env 설정이 필요해요';
}).catch(() => { $('notionState').textContent = '○ 서버에 연결할 수 없어요'; });

render(); renderHistory();
setInterval(render, 1000);
