import * as shamsi from "./shamsi.js";
import * as db from "./db.js";
import * as timer from "./timer.js";
import { lineChart, monthKeys, MONTHS } from "./charts.js";
import { encodeSnapshot, decodeSnapshot } from "./share.js";
import * as sync from "./sync.js";
import * as skyMod from "./sky.js";
import * as examMod from "./exam.js";

const { formatLong, formatShort, todayKey, parseKey, daysInJalaliMonth } = shamsi;
const { formatHMS, elapsedMs, createTimer, pauseTimer, resumeTimer, finishTimer, uid } = timer;
const GOLD = "#E6A817";
const FA = "۰۱۲۳۴۵۶۷۸۹";
const DEFAULTS = [["زیست","#00A693"],["شیمی","#800040"],["فیزیک","#848482"],["ریاضی","#FF8200"],["زمین","#FE28A2"],["فارسی","#1C39BB"],["عربی","#93C572"],["دینی","#3E2723"],["انگلیسی","#FAD6A5"]];
const appEl = document.getElementById("app");
const miniEl = document.getElementById("mini");
const overlay = document.getElementById("overlay");
const sheet = document.getElementById("sheet");
const focusEl = document.getElementById("focus");
const printEl = document.getElementById("print");
const state = {
  today: todayKey(), viewing: todayKey(),
  settings: { dailyTargetSec: 10 * 3600, overlay: 0.45, timerFont: "system", digits: "en", panelBgOpacity: 0.28, focusOverlay: 0.45 },
  catalog: [], day: null, days: [], notes: [], sessions: [], timer: null, readonly: false, liveMode: false,
  panelBg: "", panelBgType: "", focusUrl: "", focusVideo: "",
  syncCode: "", firebase: null, skyCity: "tehran", weatherOn: false, weather: null,
  advisorInbox: [], advisorPresence: null, inboxSeenAt: 0, exams: [], focusImmersive: false
};

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "");
}
function dig(str) {
  const s = String(str);
  if (state.settings.digits !== "fa") return s;
  return s.replace(/\d/g, (d) => FA[d]);
}
function hm(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return dig(h + ":" + String(m).padStart(2, "0"));
}
function num(n, d = 0) {
  const v = Number.isFinite(n) ? (d ? n.toFixed(d) : String(Math.round(n))) : "0";
  return dig(v);
}
function clamp(n) { return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }
function totalOf(s) { return (s.studySec || 0) + (s.testSec || 0); }
function liveBonus(subjectId, activity) {
  const t = state.timer;
  if (!t || t.status === "finished" || t.date !== state.viewing) return 0;
  if (subjectId && t.subjectId !== subjectId) return 0;
  if (activity && t.activity !== activity) return 0;
  if (t.status !== "running" && t.status !== "paused") return 0;
  return Math.round(elapsedMs(t) / 1000);
}
function subjectLive(s) {
  const bonusStudy = liveBonus(s.id, "study");
  const bonusTest = liveBonus(s.id, "test");
  return {
    studySec: (s.studySec || 0) + bonusStudy,
    testSec: (s.testSec || 0) + bonusTest,
    sum: (s.studySec || 0) + (s.testSec || 0) + bonusStudy + bonusTest
  };
}
function dayTotal(day) {
  let t = Object.values(day?.subjects || {}).reduce((a, s) => a + totalOf(s), 0);
  if (day?.date === state.viewing) t += liveBonus(null, null);
  return t;
}
function sleepDur(bed, wake) {
  const to = (t) => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
  const b = to(bed), w = to(wake);
  if (b == null || w == null) return null;
  return w > b ? w - b : w + 86400 - b;
}
function snap(sub, order = 0) {
  return { id: sub.id, name: sub.name, color: sub.color, targetSec: sub.targetSec, studySec: 0, testSec: 0, correct: 0, wrong: 0, blank: 0, practice: 0, quality: 0, dailyNote: "", order, updatedAt: 0 };
}
function hexOk(v) { return /^#[0-9a-fA-F]{6}$/.test(v); }
function sortedSubjects(day) {
  return Object.values(day.subjects || {}).sort((a, b) => {
    const ao = a.order ?? 9999, bo = b.order ?? 9999;
    if (ao !== bo) return ao - bo;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}
function touchSubject(s) {
  s.updatedAt = Date.now();
  const list = sortedSubjects(state.day).filter((x) => x.id !== s.id);
  s.order = 0;
  list.forEach((x, i) => { x.order = i + 1; });
}

document.getElementById("dock").onclick = (e) => {
  if (state.readonly) return;
  const nav = e.target.closest("[data-nav]")?.dataset.nav;
  if (!nav) return;
  if (!state.day) return alert("برنامه هنوز آماده نیست");
  if (nav === "manage") openManage();
  if (nav === "history") openHistory();
  if (nav === "stats") openStats();
  if (nav === "share") openShare();
  if (nav === "exam") openExamHub();
  if (nav === "advisor") openAdvisor();
};
appEl.onclick = (e) => {
  if (e.target.closest("[data-drag]")) return;
  const open = e.target.closest("[data-open]");
  if (open) return openMenu(open.dataset.open);
  if (e.target.closest("[data-today]")) return go(state.today);
  if (e.target.closest("[data-note]")) return openNotes(e.target.closest("[data-note]").dataset.note);
  if (e.target.closest("[data-reset]")) return resetDay();
  if (e.target.closest("[data-advisor]")) return openAdvisor();
};
let lastTap = { id: "", t: 0 };
function handleDblTarget(el) {
  if (!el) return;
  const key = el.dataset.dbl;
  if (!key) return;
  const now = Date.now();
  if (lastTap.id === key && now - lastTap.t < 450) {
    lastTap = { id: "", t: 0 };
    onDouble(key);
  } else {
    lastTap = { id: key, t: now };
  }
}
appEl.addEventListener("dblclick", (e) => {
  const el = e.target.closest("[data-dbl]");
  if (el) { e.preventDefault(); onDouble(el.dataset.dbl); }
});
appEl.addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse" && e.detail === 2) return;
  const el = e.target.closest("[data-dbl]");
  if (!el) return;
  handleDblTarget(el);
});
miniEl.onclick = onMini;
window.addEventListener("scroll", () => { const s = document.querySelector(".sheen"); if (s) s.style.setProperty("--sheen", String(Math.round(window.scrollY * -0.2))); }, { passive: true });

async function boot() {
  if (location.hash.startsWith("#r=")) return renderReadonly(location.hash.slice(3));
  if (location.hash.startsWith("#live=")) return bootLiveViewer(location.hash.slice(6));
  state.settings = Object.assign(state.settings, (await db.kvGet("settings")) || {});
  state.syncCode = (await db.kvGet("syncCode")) || "";
  state.firebase = (await db.kvGet("firebase")) || null;
  state.skyCity = (await db.kvGet("skyCity")) || "tehran";
  state.weatherOn = !!(await db.kvGet("weatherOn"));
  state.inboxSeenAt = Number(await db.kvGet("inboxSeenAt")) || 0;
  state.exams = await db.all("exams").catch(() => []);
  state.catalog = await db.all("subjects");
  if (!state.catalog.length) {
    state.catalog = DEFAULTS.map(([name, color], i) => ({ id: uid("sub"), name, color, targetSec: 4 * 3600, active: true, createdAt: Date.now(), updatedAt: Date.now(), order: i }));
    for (const s of state.catalog) await db.put("subjects", s);
  }
  state.days = await db.all("days");
  state.notes = await db.all("notes");
  state.sessions = await db.all("sessions");
  state.timer = (await db.kvGet("activeTimer")) || null;
  const bg = await db.blobGet("panelBg");
  if (bg) { state.panelBg = URL.createObjectURL(bg); state.panelBgType = (await db.kvGet("panelBgType")) || "image"; }
  const img = await db.blobGet("focusImage"); if (img) state.focusUrl = URL.createObjectURL(img);
  const vid = await db.blobGet("focusVideo"); if (vid) state.focusVideo = URL.createObjectURL(vid);
  await ensure(state.today);
  state.viewing = state.today;
  state.day = await db.get("days", state.viewing);
  render();
  bindScoreBars();
  if (state.timer && state.timer.status !== "finished") openRecover();
  setInterval(() => {
    if (state.timer && state.timer.status !== "finished") {
      const b = miniEl.querySelector("b"); if (b) b.textContent = formatHMS(elapsedMs(state.timer));
      const c = focusEl.querySelector(".clock"); if (c) c.textContent = formatHMS(elapsedMs(state.timer));
      if (state.timer.status === "running") updateLiveProgress();
    }
    const sky = document.getElementById("sky-body");
    if (sky) updateSkyDom(sky);
  }, 500);
  if (navigator.onLine) {
    try {
      await sync.initSync(state.firebase);
      if (state.syncCode) {
        await sync.subscribeBundle(state.syncCode, onRemoteBundle);
        await sync.subscribeInbox(state.syncCode, (list) => {
          state.advisorInbox = list || [];
          updateAdvisorBell();
        });
        await sync.subscribePresence(state.syncCode, state.viewing, (p) => { state.advisorPresence = p; updateAdvisorBell(); const c=document.querySelector(".advisor-chip"); if(c) c.outerHTML=advisorChipHtml(); });
        schedulePush();
      }
      if (state.weatherOn) refreshWeather();
    } catch (e) { console.warn(e); }
  }
  window.addEventListener("online", () => { if (state.firebase) sync.initSync(state.firebase).then(() => schedulePush()); if (state.weatherOn) refreshWeather(); });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const t = todayKey();
    if (t !== state.today) { state.today = t; await ensure(t); if (state.viewing !== t) state.viewing = t; state.day = await db.get("days", state.viewing); render(); }
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((err) => console.warn("SW", err));
  }
  setupInstall();
}
let deferredInstall = null;
function setupInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
  });
}
async function promptInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch {}
    deferredInstall = null;
    return;
  }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return alert("برنامه از قبل نصب است.");
  alert("اگر دکمه نصب دیده نمی‌شود:\n1) سایت باید روی HTTPS باشد\n2) یک بار صفحه را کامل رفرش کن\n3) در کروم منوی ⋮ → Install app / افزودن به صفحه اصلی");
}

async function ensure(date) {
  let day = await db.get("days", date);
  if (!day) {
    day = { date, targetSec: state.settings.dailyTargetSec || 36000, sleep: null, subjects: {}, updatedAt: Date.now() };
    state.catalog.filter((s) => s.active !== false).forEach((s, i) => { day.subjects[s.id] = snap(s, i); });
    await db.put("days", day);
  } else if (date === todayKey()) {
    state.catalog.filter((s) => s.active !== false).forEach((s, i) => {
      if (!day.subjects[s.id]) day.subjects[s.id] = snap(s, i);
      else { day.subjects[s.id].name = s.name; day.subjects[s.id].color = s.color; day.subjects[s.id].targetSec = s.targetSec; }
    });
    await db.put("days", day);
  }
  return day;
}
async function saveDay() {
  state.day.updatedAt = Date.now();
  await db.put("days", state.day);
  const i = state.days.findIndex((d) => d.date === state.day.date);
  if (i >= 0) state.days[i] = state.day; else state.days.push(state.day);
  schedulePush();
  scheduleLivePush();
}
let pushTimer = null, livePushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1200);
}
function scheduleLivePush() {
  clearTimeout(livePushTimer);
  livePushTimer = setTimeout(pushLiveNow, 800);
}
async function pushNow() {
  if (!navigator.onLine || !state.syncCode || !sync.hasConfig(state.firebase)) return;
  const bundle = await db.exportAll();
  await sync.pushBundle(state.syncCode, bundle);
}
async function pushLiveNow() {
  if (!navigator.onLine || !state.syncCode || !sync.hasConfig(state.firebase) || !state.day) return;
  const liveSec = state.timer && state.timer.status !== "finished" && state.timer.date === state.day.date
    ? Math.round(elapsedMs(state.timer) / 1000) : 0;
  await sync.pushLiveDay(state.syncCode, state.day.date, {
    day: state.day,
    timer: state.timer && state.timer.status !== "finished" ? { ...state.timer, liveSec } : null,
    motto: state.day.motto || ""
  });
}
async function onRemoteBundle(bundle) {
  if (!bundle || state.readonly || state.liveMode) return;
  if (bundle.pushedAt && state._lastPull && bundle.pushedAt <= state._lastPull) return;
  // merge carefully: only if remote newer for days
  try {
    if (Array.isArray(bundle.days)) {
      for (const rd of bundle.days) {
        const local = await db.get("days", rd.date);
        if (!local || (rd.updatedAt || 0) > (local.updatedAt || 0)) {
          await db.put("days", rd);
          if (rd.date === state.viewing) state.day = rd;
        }
      }
      state.days = await db.all("days");
    }
    if (Array.isArray(bundle.subjects) && bundle.subjects.length) {
      for (const s of bundle.subjects) await db.put("subjects", s);
      state.catalog = await db.all("subjects");
    }
    state._lastPull = bundle.pushedAt || Date.now();
    render();
  } catch (e) { console.warn("merge", e); }
}

async function saveTimer() { await db.kvSet("activeTimer", state.timer); }

function render() {
  const day = state.day; if (!day) return;
  const total = dayTotal(day), target = day.targetSec || 1, pct = clamp(total / target * 100), remain = Math.max(0, target - total), remainPct = clamp(100 - pct);
  const upd = day.updatedAt ? dig(new Date(day.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })) : "—";
  const past = state.viewing !== state.today;
  const subjects = sortedSubjects(day);
  const motto = day.motto || "";
  const ro = state.readonly;
  appEl.innerHTML = `${past && !ro ? `<div class="past"><span>روز گذشته ${formatShort(state.viewing)}</span><button class="ghost" data-today>امروز</button></div>` : ""}
  ${ro ? `<div class="readonly-banner">نمایش فقط‌خواندنی — قابل ویرایش نیست</div>` : ""}
  <section class="glass" id="panel">${state.panelBg ? (state.panelBgType === "video" ? `<video class="panel-bg" src="${state.panelBg}" autoplay muted loop playsinline style="opacity:${state.settings.panelBgOpacity ?? 0.28}"></video>` : `<img class="panel-bg" alt="" src="${state.panelBg}" style="opacity:${state.settings.panelBgOpacity ?? 0.28}">`) : ""}<div class="sheen"></div>
    <div class="topbar">
      <div class="when"><small>تاریخ</small><b>${formatLong(state.viewing)}</b></div>
      <div class="upd"><small>آخرین به‌روزرسانی</small><b data-live-upd>${upd}</b></div>
    </div>
    ${!ro ? advisorChipHtml() : ""}
    <div class="motto-wrap">${ro ? (motto ? `<div class="motto">${escapeHtml(motto)}</div>` : "") : `<input class="motto-input" id="motto" type="text" maxlength="80" placeholder="متن دلخواه بالای پنل…" value="${escapeAttr(motto)}" />`}</div>
    <div class="daily">${ring(pct, GOLD, num(Math.round(pct)) + "%", "پیشرفت روز")}
      <div><div class="meter-top"><div><span class="k">مطالعه شده</span><span class="v" data-live-total>${hm(total)}</span></div><div><span class="k">باقی مانده</span><span class="v" data-live-remain>${hm(remain)}</span></div></div>
      <div class="track"><i data-live-bar style="width:${pct}%;background:${GOLD}"></i></div><div class="meter-bot" data-live-pct>${num(remainPct)}%</div></div>
    </div>
    ${sleepBlock(day)}
    <div id="subjects">${subjects.map(subjectBlock).join("")}</div>
    ${skyBlock()}
    ${ro ? "" : `<button class="ghost reset-day" data-reset>ریست این روز</button>`}
  </section>`;
  renderMini();
  bindDrag();
  const mottoEl = document.getElementById("motto");
  if (mottoEl && !state.readonly) {
    mottoEl.addEventListener("change", async () => {
      state.day.motto = mottoEl.value.trim();
      await saveDay();
    });
  }
  const sky = document.getElementById("sky-body");
  if (sky) updateSkyDom(sky);
}

function ring(pct, color, main, sub) {
  const c = 2 * Math.PI * 42, dash = clamp(pct) / 100 * c;
  return `<div class="ring"><svg width="108" height="108" viewBox="0 0 108 108"><circle cx="54" cy="54" r="42" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="8"/><circle cx="54" cy="54" r="42" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${dash} ${c}"/></svg><div class="lab"><div><strong>${main}</strong><br><small>${sub}</small></div></div></div>`;
}
function sleepBlock(day) {
  if (!day.sleep?.bed || !day.sleep?.wake) return "";
  const dur = sleepDur(day.sleep.bed, day.sleep.wake);
  const { jy, jm } = parseKey(day.date);
  const rows = state.days.filter((d) => d.date.startsWith(`${jy}-${String(jm).padStart(2, "0")}`) && d.sleep?.bed);
  const avg = rows.length ? rows.reduce((a, d) => a + (sleepDur(d.sleep.bed, d.sleep.wake) || 0), 0) / rows.length : dur;
  return `<div class="sleep-grid"><div class="sq"><small>ساعت خواب</small><b>${dig(day.sleep.bed)}</b></div><div class="sq"><small>ساعت بیداری</small><b>${dig(day.sleep.wake)}</b></div><div class="sq"><small>مقدار خواب امروز</small><b>${hm(dur || 0)}</b></div><div class="sq"><small>میانگین مقدار ساعت خواب</small><b>${hm(avg || 0)}</b></div></div>`;
}
function scorePct(c, w, b) {
  const total = (c || 0) + (w || 0) + (b || 0);
  if (!total) return null;
  return ((c * 3 - w) / (total * 3)) * 100;
}
function subjectBlock(s) {
  const live = subjectLive(s);
  const sum = live.sum, pct = s.targetSec ? clamp(sum / s.targetSec * 100) : 0;
  const remain = Math.max(0, (s.targetSec || 0) - sum);
  const studyShare = sum ? live.studySec / sum * 100 : 0;
  const testShare = sum ? live.testSec / sum * 100 : 0;
  const c = s.correct || 0, w = s.wrong || 0, b = s.blank || 0;
  const tests = c + w + b;
  const maxT = Math.max(1, c, w, b);
  const neg = scorePct(c, w, b);
  const note = s.dailyNote || state.notes.find((n) => n.subjectId === s.id)?.text || "";
  const tActive = state.timer && state.timer.status !== "finished" && state.timer.subjectId === s.id;
  const showStudy = (s.studySec || 0) > 0 || (tActive && state.timer.activity === "study");
  const showTestTime = (s.testSec || 0) > 0 || (tActive && state.timer.activity === "test");
  const showTime = showStudy || showTestTime;
  const showTests = tests > 0;
  const showPractice = (s.practice || 0) > 0;
  return `<article class="subject" data-sid="${s.id}">
    <div class="subject-head">
      <button class="subject-name" data-open="${s.id}" style="color:${s.color}">${s.name}</button>
      <div style="display:flex;gap:8px;align-items:center"><span>${num(Math.round(pct))}%</span><span class="drag-handle" data-drag="${s.id}" title="نگه دار و جابه‌جا کن">⋮⋮</span></div>
    </div>
    <div class="track"><i data-live-subbar="${s.id}" style="width:${pct}%;background:${s.color}"></i></div>
    <div class="goal-line"><span data-live-subsum="${s.id}">${hm(sum)} مطالعه شده . هدف: ${hm(s.targetSec || 0)}</span><span class="remain-line">${hm(remain)} باقی مانده</span></div>
    ${showTime ? `<div class="split ${showStudy && showTestTime ? "" : "single"}">
      ${showStudy ? `<div>
        <div class="fine"><span data-dbl="study:${s.id}" class="tap-target">مطالعه / کلاس</span><span data-dbl="edit-study:${s.id}" class="tap-target time-hit">${hm(live.studySec)}</span></div>
        <div class="track thin" data-dbl="study:${s.id}"><i data-live-study="${s.id}" style="width:${studyShare}%;background:${s.color}"></i></div>
      </div>` : ""}
      ${showTestTime ? `<div class="test-col">
        <div class="mini-ring"><svg width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="5"/><circle cx="36" cy="36" r="28" fill="none" stroke="${s.color}" stroke-width="5" stroke-dasharray="${testShare / 100 * 176} 176"/></svg><span data-dbl="test:${s.id}" class="tap-target">تست</span></div>
        <div class="test-time time-hit" data-dbl="edit-test:${s.id}">${hm(live.testSec)}</div>
      </div>` : ""}
    </div>
    ${sum > 0 ? `<div class="share-pct">مطالعه/کلاس ${num(Math.round(studyShare))}% · تست ${num(Math.round(testShare))}%</div>` : ""}` : ""}
    ${showTests ? `<div class="tests">
      <div class="test-row"><span class="tl">صحیح</span><i class="tb ok" style="width:${(c / maxT) * 100}%"></i><b>${num(c)}</b></div>
      <div class="test-row"><span class="tl">غلط</span><i class="tb bad" style="width:${(w / maxT) * 100}%"></i><b>${num(w)}</b></div>
      <div class="test-row"><span class="tl">نزده</span><i class="tb blank" style="width:${(b / maxT) * 100}%"></i><b>${num(b)}</b></div>
      <div class="test-sum"><span>مجموع تست ${num(tests)}</span><span>درصد با نمره منفی ${neg == null ? "—" : dig(neg.toFixed(1)) + "%"}</span></div>
    </div>` : ""}
    ${showPractice ? `<div class="practice-line">تمرین: ${num(s.practice || 0)}</div>` : ""}
    <div class="score-row">
      <span>نمره مطالعه</span>
      <div class="score-bar" data-score="${s.id}"><i style="width:${(s.quality || 0) * 10}%;background:${s.color}"></i></div>
      <span class="score-num">${num(s.quality || 0)}</span>
    </div>
    ${note ? `<button class="ghost" data-note="${s.id}" style="margin-top:8px;width:100%;text-align:right">${note.slice(0, 42)}</button>` : ""}
  </article>`;
}

function skyBlock() {
  const info = skyInfo();
  const wx = state.weatherOn ? (state.weather || skyMod.offlineWeatherHint(info.isDay)) : null;
  const city = skyMod.CITIES.find((c) => c.id === state.skyCity) || skyMod.CITIES[0];
  return `<div class="sky" data-dbl="sky"><div class="sky-card">
    <div class="sky-head"><b>${info.isDay ? "خورشید" : "ماه"} · ${city.name}</b><span>${info.label}</span></div>
    <div class="sky-path"><div class="sky-arc"></div><div id="sky-body" class="sky-body ${info.isDay ? "sun" : "moon"}" style="left:${info.x}%;top:${info.y}%"></div></div>
    <div class="sky-meta"><span>طلوع ${dig(info.rise)}</span><span>غروب ${dig(info.set)}</span></div>
    ${wx ? `<div class="sky-weather">${wx.icon} ${wx.label}${wx.temp != null ? " · " + dig(Math.round(wx.temp)) + "°" : ""}${wx.offline ? " (آفلاین)" : ""}</div>` : ""}
    <div class="sky-hint">دابل‌کلیک: شهر و آب‌وهوا</div>
  </div></div>`;
}
function skyInfo(now = new Date()) {
  const city = skyMod.CITIES.find((c) => c.id === state.skyCity) || skyMod.CITIES[0];
  const { riseMin, setMin } = skyMod.sunTimes(city.lat, city.lon, now, city.tz);
  const pos = skyMod.skyPosition(now, riseMin, setMin);
  const label = dig(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  return { ...pos, rise: skyMod.fmtMin(riseMin), set: skyMod.fmtMin(setMin), label, left: dig("طلوع " + skyMod.fmtMin(riseMin)), right: dig("غروب " + skyMod.fmtMin(setMin)) };
}
function updateSkyDom(el) {
  const info = skyInfo();
  el.className = `sky-body ${info.isDay ? "sun" : "moon"}`;
  el.style.left = info.x + "%";
  el.style.top = info.y + "%";
}
async function refreshWeather() {
  if (!state.weatherOn) return;
  const city = skyMod.CITIES.find((c) => c.id === state.skyCity) || skyMod.CITIES[0];
  try {
    if (navigator.onLine) state.weather = await skyMod.fetchWeather(city.lat, city.lon);
    else state.weather = skyMod.offlineWeatherHint(skyInfo().isDay);
  } catch {
    state.weather = skyMod.offlineWeatherHint(skyInfo().isDay);
  }
  const el = document.querySelector(".sky-weather");
  if (el && state.weather) {
    const wx = state.weather;
    el.textContent = `${wx.icon} ${wx.label}${wx.temp != null ? " · " + Math.round(wx.temp) + "°" : ""}${wx.offline ? " (آفلاین)" : ""}`;
  }
}
function openSkySettings() {
  if (state.readonly || state.liveMode) return;
  openSheet(`<h3>آسمان و آب‌وهوا</h3>
    <div class="field"><label>شهر</label><select id="city">${skyMod.CITIES.map((c) => `<option value="${c.id}" ${c.id === state.skyCity ? "selected" : ""}>${c.name}</option>`).join("")}</select></div>
    <div class="field"><label><input type="checkbox" id="wx" ${state.weatherOn ? "checked" : ""}> نمایش آب‌وهوا</label></div>
    <button class="primary" id="ok">ذخیره</button>`);
  sheet.querySelector("#ok").onclick = async () => {
    state.skyCity = sheet.querySelector("#city").value;
    state.weatherOn = sheet.querySelector("#wx").checked;
    await db.kvSet("skyCity", state.skyCity);
    await db.kvSet("weatherOn", state.weatherOn);
    if (state.weatherOn) await refreshWeather();
    else state.weather = null;
    closeSheet(); render();
  };
}
function updateLiveProgress() {
  if (!state.day || state.readonly) return;
  const day = state.day;
  const total = dayTotal(day);
  const target = day.targetSec || 1;
  const pct = clamp(total / target * 100);
  const remain = Math.max(0, target - total);
  const elT = document.querySelector("[data-live-total]");
  const elR = document.querySelector("[data-live-remain]");
  const elB = document.querySelector("[data-live-bar]");
  const elP = document.querySelector("[data-live-pct]");
  if (elT) elT.textContent = hm(total);
  if (elR) elR.textContent = hm(remain);
  if (elB) elB.style.width = pct + "%";
  if (elP) elP.textContent = num(clamp(100 - pct)) + "%";
  // subject bars
  sortedSubjects(day).forEach((s) => {
    const live = subjectLive(s);
    const sum = live.sum;
    const sp = s.targetSec ? clamp(sum / s.targetSec * 100) : 0;
    const bar = document.querySelector(`[data-live-subbar="${s.id}"]`);
    const lab = document.querySelector(`[data-live-subsum="${s.id}"]`);
    if (bar) bar.style.width = sp + "%";
    if (lab) lab.textContent = `${hm(sum)} مطالعه شده . هدف: ${hm(s.targetSec || 0)}`;
  });
  scheduleLivePush();
}


function bindScoreBars() {
  if (appEl._scoreBound) return;
  appEl._scoreBound = true;
  let active = null;
  const setFromEvent = async (e, save) => {
    if (!active || !state.day) return;
    const bar = active;
    const id = bar.dataset.score;
    const s = state.day.subjects[id];
    if (!s) return;
    const rect = bar.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let ratio = (clientX - rect.left) / rect.width;
    if (getComputedStyle(document.documentElement).direction === "rtl") ratio = 1 - ratio;
    const q = Math.max(0, Math.min(10, Math.round(ratio * 10)));
    s.quality = q;
    const fill = bar.querySelector("i");
    if (fill) fill.style.width = `${q * 10}%`;
    const numEl = bar.parentElement?.querySelector(".score-num");
    if (numEl) numEl.textContent = num(q);
    if (save) { touchSubject(s); await saveDay(); }
  };
  appEl.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest("[data-score]");
    if (!bar) return;
    active = bar;
    bar.setPointerCapture?.(e.pointerId);
    setFromEvent(e, false);
  });
  appEl.addEventListener("pointermove", (e) => { if (active) setFromEvent(e, false); });
  appEl.addEventListener("pointerup", async (e) => { if (!active) return; await setFromEvent(e, true); active = null; });
  appEl.addEventListener("pointercancel", () => { active = null; });
}

function bindDrag() {
  const root = document.getElementById("subjects");
  if (!root || root._dragBound) return;
  root._dragBound = true;
  let dragId = null, holdTimer = null, holding = false;
  const clear = () => { clearTimeout(holdTimer); holding = false; dragId = null; root.querySelectorAll(".subject").forEach((el) => el.classList.remove("dragging")); };
  const onStart = (e) => {
    const handle = e.target.closest("[data-drag]");
    if (!handle) return;
    const id = handle.dataset.drag;
    holdTimer = setTimeout(() => { holding = true; dragId = id; handle.closest(".subject")?.classList.add("dragging"); }, 280);
  };
  const onMove = (e) => {
    if (!holding || !dragId) return;
    e.preventDefault();
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const el = document.elementFromPoint(x, y)?.closest(".subject");
    if (!el || el.dataset.sid === dragId) return;
    const list = sortedSubjects(state.day);
    const from = list.findIndex((s) => s.id === dragId);
    const to = list.findIndex((s) => s.id === el.dataset.sid);
    if (from < 0 || to < 0 || from === to) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    list.forEach((s, i) => { s.order = i; });
    render();
    const again = document.querySelector(`[data-sid="${dragId}"]`);
    if (again) again.classList.add("dragging");
  };
  const onEnd = async () => {
    if (holding && dragId) await saveDay();
    clear();
  };
  root.addEventListener("touchstart", onStart, { passive: true });
  root.addEventListener("mousedown", onStart);
  root.addEventListener("touchmove", onMove, { passive: false });
  root.addEventListener("mousemove", onMove);
  root.addEventListener("touchend", onEnd);
  root.addEventListener("mouseup", onEnd);
}

function renderMini() {
  const t = state.timer;
  if (!t || t.status === "finished" || focusEl.classList.contains("open")) { miniEl.classList.remove("show"); return; }
  const sub = state.catalog.find((s) => s.id === t.subjectId);
  miniEl.classList.add("show");
  miniEl.innerHTML = `<div><small>${sub?.name || ""} / ${t.activity === "test" ? "تست" : "مطالعه"}</small><b>${formatHMS(elapsedMs(t))}</b></div><div class="row-actions"><button class="ghost" data-act="pause">${t.status === "paused" ? "ادامه" : "مکث"}</button><button class="ghost" data-act="finish">پایان</button><button class="ghost" data-act="full">تمام‌صفحه</button></div>`;
}
function onDouble(key) {
  if (!key) return;
  if (key === "sky") return openSkySettings();
  if (key.startsWith("edit-study:")) return editTime(key.slice(11), "studySec");
  if (key.startsWith("edit-test:")) return editTime(key.slice(10), "testSec");
  if (key.startsWith("study:")) return startTimer(key.slice(6), "study");
  if (key.startsWith("test:")) return startTimer(key.slice(5), "test");
}
function openSheet(html) { sheet.innerHTML = html; overlay.classList.add("open"); sheet.querySelectorAll("[data-close]").forEach((b) => b.onclick = closeSheet); }
function closeSheet() { overlay.classList.remove("open"); }
overlay.onclick = (e) => { if (e.target === overlay) closeSheet(); };

function openMenu(id) {
  if (state.readonly) return;
  const name = state.day.subjects[id]?.name || "درس";
  const sessions = (state.sessions || []).filter((s) => s.subjectId === id && s.date === state.viewing && s.status === "finished").sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  const fmt = (ts) => ts ? dig(new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })) : "—";
  const sessHtml = sessions.length
    ? `<div class="sess-list"><p style="color:#aaa;font-size:.78rem;margin:8px 0 4px">بازه‌های تایمر امروز</p>${sessions.map((s) => `<div class="sess-row"><span>${s.activity === "test" ? "تست" : "مطالعه/کلاس"}</span><span>${fmt(s.startTime)} تا ${fmt(s.endTime)}</span><span>${hm(s.duration || 0)}</span></div>`).join("")}</div>`
    : `<p style="color:#666;font-size:.78rem;margin:8px 0">هنوز بازه تایمری برای این درس ثبت نشده.</p>`;
  openSheet(`<h3>${name}</h3>${sessHtml}<div class="row-actions" style="flex-wrap:wrap">
    <button class="primary" data-a="tstudy">شروع تایمر مطالعه</button>
    <button class="primary" data-a="ttest">شروع تایمر تست</button>
    <button class="ghost" data-a="study">زمان مطالعه</button>
    <button class="ghost" data-a="test">زمان تست</button>
    <button class="ghost" data-a="c">صحیح</button>
    <button class="ghost" data-a="w">غلط</button>
    <button class="ghost" data-a="b">نزده</button>
    <button class="ghost" data-a="p">تمرین</button>
    <button class="ghost" data-a="note">یادداشت</button>
    <button class="ghost" data-close>بستن</button></div>`);
  sheet.onclick = (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    if (a === "note") return openNotes(id);
    if (a === "tstudy") { closeSheet(); return startTimer(id, "study"); }
    if (a === "ttest") { closeSheet(); return startTimer(id, "test"); }
    askAdd(id, a);
  };
}
function askAdd(id, kind) {
  const time = kind === "study" || kind === "test";
  openSheet(`<h3>افزودن</h3>${time ? `<div class="field"><label>ساعت</label><input id="hh" type="number" min="0" max="24" value="0"></div><div class="field"><label>دقیقه</label><input id="mm" type="number" min="0" max="59" value="0"></div>` : `<div class="field"><label>تعداد</label><input id="nn" type="number" min="0" value="1"></div>`}<button class="primary" id="ok">ثبت</button>`);
  sheet.querySelector("#ok").onclick = async () => {
    const s = state.day.subjects[id];
    if (time) {
      const hh = Number(sheet.querySelector("#hh").value) || 0, mm = Number(sheet.querySelector("#mm").value) || 0;
      if (mm > 59 || hh < 0) return alert("زمان نامعتبر است");
      const sec = hh * 3600 + mm * 60;
      if (kind === "study") s.studySec += sec; else s.testSec += sec;
    } else {
      const n = Number(sheet.querySelector("#nn").value) || 0; if (n < 0) return;
      if (kind === "c") s.correct += n; if (kind === "w") s.wrong += n; if (kind === "b") s.blank += n; if (kind === "p") s.practice = (s.practice || 0) + n;
    }
    touchSubject(s); await saveDay(); closeSheet(); render();
  };
}
function editTime(id, field) {
  const s = state.day.subjects[id];
  const raw = Math.max(0, Math.round(Number(s[field] || 0)));
  const hh = Math.floor(raw / 3600), mm = Math.floor((raw % 3600) / 60);
  openSheet(`<h3>اصلاح</h3><div class="field"><label>ساعت</label><input id="hh" type="number" value="${hh}"></div><div class="field"><label>دقیقه</label><input id="mm" type="number" value="${mm}"></div><button class="primary" id="ok">ذخیره</button>`);
  sheet.querySelector("#ok").onclick = async () => {
    s[field] = (Number(sheet.querySelector("#hh").value) || 0) * 3600 + (Number(sheet.querySelector("#mm").value) || 0) * 60;
    touchSubject(s); await saveDay(); closeSheet(); render();
  };
}
async function startTimer(subjectId, activity) {
  if (state.timer && state.timer.status !== "finished") {
    if (state.timer.subjectId === subjectId && state.timer.activity === activity) {
      if (state.timer.status === "paused") state.timer = resumeTimer(state.timer);
      await saveTimer(); return render();
    }
    if (!confirm("تایمر فعلی متوقف و تایمر جدید شروع شود؟")) return;
    await finishActive();
  }
  state.timer = createTimer({ subjectId, activity, date: state.viewing });
  await saveTimer(); render();
}
async function finishActive() {
  if (!state.timer || state.timer.persisted) return;
  state.timer.persisted = true; state.timer = finishTimer(state.timer);
  const sec = Math.round(elapsedMs(state.timer, state.timer.finishedAt) / 1000);
  const day = await db.get("days", state.timer.date);
  if (day?.subjects[state.timer.subjectId] && sec > 0) {
    const s = day.subjects[state.timer.subjectId];
    if (state.timer.activity === "test") s.testSec += sec; else s.studySec += sec;
    s.updatedAt = Date.now();
    const list = Object.values(day.subjects).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).filter((x) => x.id !== s.id);
    s.order = 0; list.forEach((x, i) => { x.order = i + 1; });
    await db.put("days", day);
    if (day.date === state.viewing) state.day = day;
  }
  const sess = { id: state.timer.id, subjectId: state.timer.subjectId, activity: state.timer.activity, date: state.timer.date, startTime: state.timer.segments[0]?.start, endTime: state.timer.finishedAt, duration: sec, status: "finished" };
  await db.put("sessions", sess);
  state.sessions.push(sess);
  state.timer = null; await saveTimer(); render();
}
function onMini(e) {
  const act = e.target.closest("[data-act]")?.dataset.act; if (!act || !state.timer) return;
  if (act === "pause") { state.timer = state.timer.status === "paused" ? resumeTimer(state.timer) : pauseTimer(state.timer); saveTimer().then(render); }
  if (act === "finish") finishActive();
  if (act === "full") openFocus();
}
function openFocus() {
  if (!state.timer) return;
  state.focusImmersive = false;
  const sub = state.catalog.find((s) => s.id === state.timer.subjectId) || state.day?.subjects?.[state.timer.subjectId];
  focusEl.classList.add("open");
  focusEl.style.backgroundImage = state.focusUrl && !state.focusVideo ? `url(${state.focusUrl})` : "none";
  const paint = () => {
    const paused = state.timer.status === "paused";
    const hide = state.focusImmersive ? "display:none" : "";
    focusEl.innerHTML = `${state.focusVideo ? `<video src="${state.focusVideo}" autoplay muted loop playsinline></video>` : ""}
      <div class="dim" style="background:#000;opacity:${state.settings.focusOverlay ?? state.settings.overlay ?? 0.45}"></div>
      <div class="ui focus-ui">
        <div class="focus-name">${sub?.name || ""}</div>
        <div class="focus-act">${state.timer.activity === "test" ? "تست" : "مطالعه / کلاس"}</div>
        <div class="clock">${formatHMS(elapsedMs(state.timer))}</div>
        <div class="cwb" style="${hide}">
          <button type="button" class="cwb-btn ok" id="fc" title="صحیح">✓</button>
          <button type="button" class="cwb-btn bad" id="fw" title="غلط">✕</button>
          <button type="button" class="cwb-btn blank" id="fb" title="نزده">○</button>
        </div>
        <div class="row-actions focus-actions" style="justify-content:center;${hide}">
          <button class="ghost" id="fp">${paused ? "ادامه" : "مکث"}</button>
          <button class="primary" id="ff">پایان</button>
          <button class="ghost" id="fs">تمام‌صفحه</button>
          <button class="ghost" id="fe">خروج</button>
        </div>
        ${state.focusImmersive ? `<div class="focus-hint">دابل‌کلیک: نمایش دکمه‌ها</div>` : ""}
      </div>`;
    focusEl.querySelector("#fp").onclick = async () => {
      state.timer = state.timer.status === "paused" ? resumeTimer(state.timer) : pauseTimer(state.timer);
      await saveTimer(); scheduleLivePush(); paint();
    };
    focusEl.querySelector("#ff").onclick = async () => {
      focusEl.classList.remove("open"); state.focusImmersive = false;
      document.exitFullscreen?.(); await finishActive();
    };
    focusEl.querySelector("#fe").onclick = () => {
      focusEl.classList.remove("open"); state.focusImmersive = false;
      document.exitFullscreen?.(); render();
    };
    focusEl.querySelector("#fs").onclick = () => {
      state.focusImmersive = true;
      paint();
      focusEl.requestFullscreen?.().catch(() => {});
    };
    focusEl.querySelector("#fc").onclick = () => bumpTest("correct");
    focusEl.querySelector("#fw").onclick = () => bumpTest("wrong");
    focusEl.querySelector("#fb").onclick = () => bumpTest("blank");
  };
  paint();
  focusEl.ondblclick = (e) => {
    if (e.target.closest("button")) return;
    if (state.focusImmersive) {
      state.focusImmersive = false;
      document.exitFullscreen?.();
      paint();
    }
  };
}
async function bumpTest(kind) {
  if (!state.timer || !state.day?.subjects?.[state.timer.subjectId]) return;
  const s = state.day.subjects[state.timer.subjectId];
  s[kind] = (s[kind] || 0) + 1;
  touchSubject(s);
  await saveDay();
}
function openRecover() {
  openSheet(`<h3>جلسه ناتمام</h3><div class="row-actions"><button class="primary" id="rc">ادامه</button><button class="ghost" id="rf">پایان</button><button class="danger" id="rd">حذف</button></div>`);
  sheet.querySelector("#rc").onclick = async () => { if (state.timer.status === "paused") state.timer = resumeTimer(state.timer); await saveTimer(); closeSheet(); render(); };
  sheet.querySelector("#rf").onclick = async () => { closeSheet(); await finishActive(); };
  sheet.querySelector("#rd").onclick = async () => { if (!confirm("حذف شود؟")) return; state.timer = null; await saveTimer(); closeSheet(); render(); };
}
async function resetDay() {
  if (!confirm("همه اطلاعات همین روز پاک شود؟")) return;
  const date = state.day.date, target = state.day.targetSec;
  state.day = { date, targetSec: target, sleep: null, subjects: {}, updatedAt: Date.now() };
  state.catalog.filter((s) => s.active !== false).forEach((s, i) => { state.day.subjects[s.id] = snap(s, i); });
  await saveDay(); render();
}
function openManage() {
  const rows = state.catalog.filter((s) => s.active !== false).map((s) => `<div class="field"><label>${s.name}</label><input data-id="${s.id}" data-k="name" value="${s.name}"><input data-id="${s.id}" data-k="color" value="${s.color}" placeholder="#00A693"><input data-id="${s.id}" data-k="target" value="${Math.floor((s.targetSec || 0) / 3600)}:${String(Math.floor(((s.targetSec || 0) % 3600) / 60)).padStart(2, "0")}"><button class="danger" data-del="${s.id}">حذف</button></div>`).join("");
  openSheet(`<h3>مدیریت</h3>
    <div class="field"><label>هدف روزانه ساعت:دقیقه</label><input id="dt" value="${Math.floor(state.settings.dailyTargetSec / 3600)}:${String(Math.floor((state.settings.dailyTargetSec % 3600) / 60)).padStart(2, "0")}"></div>
    <div class="field"><label>زبان اعداد</label><select id="digits"><option value="en" ${state.settings.digits !== "fa" ? "selected" : ""}>English 1 2 3</option><option value="fa" ${state.settings.digits === "fa" ? "selected" : ""}>فارسی ۰ ۱ ۲</option></select></div>
    <div class="field"><label>خواب</label><input id="bed" placeholder="23:45" value="${state.day.sleep?.bed || ""}"></div>
    <div class="field"><label>بیداری</label><input id="wake" placeholder="07:15" value="${state.day.sleep?.wake || ""}"></div>
    <p style="color:#aaa;font-size:.75rem">رنگ را با کد مثل #00A693 عوض کن. پس‌زمینه پنل می‌تواند عکس یا فیلم تکرارشونده باشد.</p>
    ${rows}
    <div class="field"><label>درس جدید</label><input id="nn"></div>
    <div class="field"><label>کدورت زمینه پنل (۰–۱)</label><input id="pop" type="number" min="0" max="1" step="0.05" value="${state.settings.panelBgOpacity ?? 0.28}"></div>
    <div class="field"><label>کدورت لایه تمرکز</label><input id="fop" type="number" min="0" max="1" step="0.05" value="${state.settings.focusOverlay ?? 0.45}"></div>
    <hr style="border-color:rgba(255,255,255,.1)">
    <p style="color:#aaa;font-size:.75rem">همگام‌سازی چند دستگاه + لینک زنده مشاور (Firebase)</p>
    <div class="field"><label>کد همگام‌سازی</label><input id="scode" value="${state.syncCode || ""}" placeholder="مثلاً AB12CD34"></div>
    <div class="row-actions"><button class="ghost" id="genCode">ساخت کد جدید</button><button class="ghost" id="pullSync">دریافت از ابر</button></div>
    <div class="field"><label>Firebase apiKey</label><input id="fb_key" value="${state.firebase?.apiKey || ""}"></div>
    <div class="field"><label>projectId</label><input id="fb_pid" value="${state.firebase?.projectId || ""}"></div>
    <div class="field"><label>databaseURL</label><input id="fb_url" value="${state.firebase?.databaseURL || ""}" placeholder="https://….firebaseio.com"></div>
    <hr style="border-color:rgba(255,255,255,.1)">
    <div class="row-actions" style="flex-wrap:wrap">
      <button class="ghost" id="bakOut">دانلود بک‌آپ JSON</button>
      <button class="ghost" id="bakIn">آپلود بک‌آپ JSON</button>
      <input id="bakFile" type="file" accept="application/json,.json" hidden>
    </div>
    <div class="row-actions" style="flex-wrap:wrap">
      <button class="primary" id="save">ذخیره</button>
      <button class="ghost" id="add">افزودن</button>
      <button class="ghost" id="pimg">عکس پنل</button>
      <button class="ghost" id="pvid">فیلم پنل</button>
      <button class="ghost" id="fimg">تصویر تمرکز</button>
      <button class="ghost" id="fvid">ویدیو تمرکز</button>
      <button class="ghost" id="install">نصب روی گوشی</button><button class="ghost" data-close>بستن</button>
    </div>
    <input id="pimgf" type="file" accept="image/*" hidden>
    <input id="pvidf" type="file" accept="video/*" hidden>
    <input id="ifile" type="file" accept="image/*" hidden>
    <input id="vfile" type="file" accept="video/*" hidden>`);
  sheet.querySelector("#pimg").onclick = () => sheet.querySelector("#pimgf").click();
  sheet.querySelector("#pvid").onclick = () => sheet.querySelector("#pvidf").click();
  sheet.querySelector("#fimg").onclick = () => sheet.querySelector("#ifile").click();
  sheet.querySelector("#fvid").onclick = () => sheet.querySelector("#vfile").click();
  sheet.querySelector("#pimgf").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    await db.blobSet("panelBg", f); state.panelBgType = "image"; await db.kvSet("panelBgType", "image");
    if (state.panelBg) URL.revokeObjectURL(state.panelBg);
    state.panelBg = URL.createObjectURL(f); render();
  };
  sheet.querySelector("#pvidf").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    await db.blobSet("panelBg", f); state.panelBgType = "video"; await db.kvSet("panelBgType", "video");
    if (state.panelBg) URL.revokeObjectURL(state.panelBg);
    state.panelBg = URL.createObjectURL(f); render();
  };
  sheet.querySelector("#ifile").onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return; await db.blobSet("focusImage", f); state.focusUrl = URL.createObjectURL(f); };
  sheet.querySelector("#vfile").onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return; await db.blobSet("focusVideo", f); state.focusVideo = URL.createObjectURL(f); };
  sheet.querySelector("#add").onclick = async () => {
    const name = sheet.querySelector("#nn").value.trim(); if (!name) return;
    const sub = { id: uid("sub"), name, color: GOLD, targetSec: 7200, active: true, createdAt: Date.now(), updatedAt: Date.now() };
    state.catalog.push(sub); await db.put("subjects", sub);
    state.day.subjects[sub.id] = snap(sub, 0); touchSubject(state.day.subjects[sub.id]);
    await saveDay(); openManage(); render();
  };
  sheet.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("حذف شود؟")) return;
    const sub = state.catalog.find((s) => s.id === b.dataset.del); sub.active = false; await db.put("subjects", sub);
    if (state.day.subjects[sub.id] && !totalOf(state.day.subjects[sub.id])) delete state.day.subjects[sub.id];
    await saveDay(); openManage(); render();
  });
  const inst = sheet.querySelector("#install"); if (inst) inst.onclick = () => promptInstall();
  sheet.querySelector("#genCode").onclick = () => { sheet.querySelector("#scode").value = sync.genSyncCode(); };
  sheet.querySelector("#bakOut").onclick = async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `study-backup-${state.today}.json`;
    a.click();
  };
  sheet.querySelector("#bakIn").onclick = () => sheet.querySelector("#bakFile").click();
  sheet.querySelector("#bakFile").onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm("همه داده‌های فعلی با بک‌آپ جایگزین شود؟")) return;
      await db.importAll(data);
      location.reload();
    } catch (err) { alert("بک‌آپ نامعتبر: " + err.message); }
  };
  sheet.querySelector("#pullSync").onclick = async () => {
    const code = sheet.querySelector("#scode").value.trim().toUpperCase();
    const fb = {
      apiKey: sheet.querySelector("#fb_key").value.trim(),
      projectId: sheet.querySelector("#fb_pid").value.trim(),
      databaseURL: sheet.querySelector("#fb_url").value.trim()
    };
    if (!code || !sync.hasConfig(fb)) return alert("کد و تنظیمات Firebase را کامل کن");
    await sync.initSync(fb);
    const bundle = await sync.pullBundle(code);
    if (!bundle) return alert("چیزی در ابر پیدا نشد");
    if (!confirm("داده ابری جایگزین/ادغام شود؟")) return;
    await onRemoteBundle(bundle);
    alert("دریافت شد");
  };
  sheet.querySelector("#save").onclick = async () => {
    const [h, m] = sheet.querySelector("#dt").value.split(":").map(Number);
    state.settings.dailyTargetSec = (h || 0) * 3600 + (m || 0) * 60;
    state.settings.digits = sheet.querySelector("#digits").value;
    state.settings.panelBgOpacity = Math.max(0, Math.min(1, Number(sheet.querySelector("#pop").value) || 0.28));
    state.settings.focusOverlay = Math.max(0, Math.min(1, Number(sheet.querySelector("#fop").value) || 0.45));
    state.settings.overlay = state.settings.focusOverlay;
    await db.kvSet("settings", state.settings);
    state.syncCode = sheet.querySelector("#scode").value.trim().toUpperCase();
    await db.kvSet("syncCode", state.syncCode);
    state.firebase = {
      apiKey: sheet.querySelector("#fb_key").value.trim(),
      projectId: sheet.querySelector("#fb_pid").value.trim(),
      databaseURL: sheet.querySelector("#fb_url").value.trim()
    };
    await db.kvSet("firebase", state.firebase);
    if (sync.hasConfig(state.firebase)) {
      await sync.initSync(state.firebase);
      if (state.syncCode) {
        await sync.subscribeBundle(state.syncCode, onRemoteBundle);
        schedulePush();
      }
    }

    state.day.targetSec = state.settings.dailyTargetSec;
    const bed = sheet.querySelector("#bed").value.trim(), wake = sheet.querySelector("#wake").value.trim();
    if (bed && wake) state.day.sleep = { bed, wake };
    sheet.querySelectorAll("[data-id]").forEach((input) => {
      const sub = state.catalog.find((s) => s.id === input.dataset.id); if (!sub) return;
      if (input.dataset.k === "name" && input.value.trim()) sub.name = input.value.trim();
      if (input.dataset.k === "color" && hexOk(input.value.trim())) sub.color = input.value.trim();
      if (input.dataset.k === "target") { const [hh, mm] = input.value.split(":").map(Number); sub.targetSec = (hh || 0) * 3600 + (mm || 0) * 60; }
    });
    for (const sub of state.catalog) await db.put("subjects", sub);
    if (state.viewing === state.today) state.catalog.filter((s) => s.active !== false).forEach((s) => {
      if (state.day.subjects[s.id]) { state.day.subjects[s.id].name = s.name; state.day.subjects[s.id].color = s.color; state.day.subjects[s.id].targetSec = s.targetSec; }
    });
    await saveDay(); closeSheet(); render();
  };
}
async function go(date) { await ensure(date); state.viewing = date; state.day = await db.get("days", date); closeSheet(); render(); }
function openHistory() {
  const { jy } = parseKey(state.today);
  openSheet(`<h3>تاریخچه ${dig(jy)}</h3><div class="row-actions" style="flex-wrap:wrap">${MONTHS.map((m, i) => `<button class="ghost" data-m="${i + 1}">${m}</button>`).join("")}</div>`);
  sheet.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => openMonth(jy, Number(b.dataset.m)));
}
async function openMonth(year, month) {
  const map = Object.fromEntries((await db.all("days")).map((d) => [d.date, d]));
  let html = "";
  for (let d = 1; d <= daysInJalaliMonth(year, month); d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const rec = map[key]; const sum = rec ? dayTotal(rec) : 0;
    html += `<button class="ghost" data-date="${key}" style="width:100%;margin:4px 0;opacity:${sum ? 1 : .45}">${dig(d)} ${MONTHS[month - 1]} ${sum ? hm(sum) : ""}</button>`;
  }
  openSheet(`<h3>${MONTHS[month - 1]}</h3>${html}<button class="ghost" id="back">ماه‌ها</button>`);
  sheet.querySelector("#back").onclick = openHistory;
  sheet.querySelectorAll("[data-date]").forEach((b) => b.onclick = () => go(b.dataset.date));
}
async function openStats() {
  openSheet(`<h3>آمار ماهانه</h3><div class="field"><select id="ms">${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select></div><div class="row-actions"><button class="ghost" data-tab="study">مطالعه</button><button class="ghost" data-tab="test">تست</button><button class="ghost" data-tab="sleep">خواب</button></div><div id="chart"></div><p style="color:#aaa;font-size:.75rem">افقی: روز ماه. عمودی: ساعت مطالعه، تعداد تست، یا ساعت خواب.</p>`);
  const draw = async (tab) => {
    const month = Number(sheet.querySelector("#ms").value);
    const { jy } = parseKey(state.viewing);
    const map = Object.fromEntries((await db.all("days")).map((d) => [d.date, d]));
    const points = monthKeys(jy, month).slice(0, daysInJalaliMonth(jy, month)).map((date) => {
      const rec = map[date]; if (!rec) return { date, value: 0 };
      if (tab === "test") return { date, value: Object.values(rec.subjects).reduce((a, s) => a + (s.correct || 0) + (s.wrong || 0) + (s.blank || 0), 0) };
      if (tab === "sleep") return { date, value: Math.round(((sleepDur(rec.sleep?.bed, rec.sleep?.wake) || 0) / 3600) * 10) / 10 };
      return { date, value: Math.round((dayTotal(rec) / 3600) * 10) / 10 };
    });
    lineChart(sheet.querySelector("#chart"), points, tab === "test" ? "#ff5d5d" : tab === "sleep" ? "#7eb6ff" : GOLD, (sum) => tab === "test" ? `مجموع تست ${dig(sum)}` : `مجموع ساعت ${dig(Math.round(sum * 10) / 10)}`);
  };
  sheet.querySelector("#ms").onchange = () => draw("study");
  sheet.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => draw(b.dataset.tab));
  draw("study");
}
function openNotes(id) {
  const s = state.day.subjects[id]; const perm = state.notes.find((n) => n.subjectId === id);
  openSheet(`<h3>یادداشت</h3><div class="field"><label>دائمی</label><textarea id="p">${perm?.text || ""}</textarea></div><div class="field"><label>همین روز</label><textarea id="d">${s.dailyNote || ""}</textarea></div><button class="primary" id="ok">ذخیره</button>`);
  sheet.querySelector("#ok").onclick = async () => {
    const text = sheet.querySelector("#p").value.trim();
    if (perm) { perm.text = text; await db.put("notes", perm); }
    else if (text) { const note = { id: uid("note"), subjectId: id, kind: "permanent", text, updatedAt: Date.now() }; state.notes.push(note); await db.put("notes", note); }
    s.dailyNote = sheet.querySelector("#d").value.trim(); touchSubject(s); await saveDay(); closeSheet(); render();
  };
}
function openShare() {
  openSheet(`<h3>اشتراک پنل همین روز</h3><p style="color:#aaa;font-size:.75rem">عکس / PDF / لینک ثابت. لینک زنده نیاز به Firebase و کد همگام دارد.</p>
    <button class="primary" id="img">عکس پنل</button>
    <button class="ghost" id="pdf">PDF</button>
    <button class="ghost" id="link">لینک فقط‌خواندنی (ثابت)</button>
    <button class="ghost" id="live">لینک زنده مشاور (همین روز)</button>
    <button class="ghost" data-close>بستن</button>`);
  sheet.querySelector("#img").onclick = sharePng;
  sheet.querySelector("#live").onclick = async () => {
    if (!state.syncCode || !sync.hasConfig(state.firebase)) {
      return alert("ابتدا در مدیریت کد همگام و Firebase را تنظیم کن");
    }
    await sync.initSync(state.firebase);
    await pushLiveNow();
    const url = location.href.split("#")[0] + "#live=" + encodeURIComponent(state.syncCode + "/" + state.viewing);
    try { await navigator.clipboard.writeText(url); alert("لینک زنده کپی شد"); } catch { prompt("لینک", url); }
  };
  sheet.querySelector("#pdf").onclick = () => {
    const panel = document.getElementById("panel");
    printEl.innerHTML = `<div style="background:#000;color:#fff;padding:16px">${panel ? panel.outerHTML : ""}</div>`;
    window.print();
  };
  sheet.querySelector("#link").onclick = async () => {
    const payload = {
      day: JSON.parse(JSON.stringify(state.day)),
      settings: { digits: state.settings.digits },
      readonly: true,
      motto: state.day.motto || ""
    };
    const url = location.origin + location.pathname.replace(/index\.html.?$/, "") + (location.pathname.endsWith("/") ? "" : "") + (location.pathname.includes("index.html") ? location.pathname : location.pathname) + "#r=" + encodeSnapshot(payload);
    const clean = location.href.split("#")[0] + "#r=" + encodeSnapshot(payload);
    try { await navigator.clipboard.writeText(clean); alert("لینک فقط‌خواندنی کپی شد."); } catch { prompt("لینک", clean); }
  };
}

async function sharePng() {
  closeSheet();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const panel = document.getElementById("panel");
  if (!panel) return alert("پنل پیدا نشد");
  const hide = [];
  panel.querySelectorAll(".drag-handle, .reset-day, .motto-input, [data-score]").forEach((el) => {
    hide.push([el, el.style.visibility]);
    el.style.visibility = "hidden";
  });
  try {
    const scale = Math.min(2, window.devicePixelRatio || 2);
    const rect = panel.getBoundingClientRect();
    const w = Math.ceil(rect.width * scale);
    const h = Math.ceil(rect.height * scale);
    // Clone with inlined styles for foreignObject
    const clone = panel.cloneNode(true);
    clone.querySelectorAll("video").forEach((v) => v.remove());
    const walk = (src, dst) => {
      const st = getComputedStyle(src);
      let css = "";
      for (let i = 0; i < st.length; i++) {
        const prop = st[i];
        css += prop + ":" + st.getPropertyValue(prop) + ";";
      }
      dst.setAttribute("style", css);
      const sc = src.children, dc = dst.children;
      for (let i = 0; i < sc.length; i++) walk(sc[i], dc[i]);
    };
    walk(panel, clone);
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.background = "#000";
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px;background:#000;transform:scale(${scale});transform-origin:top left">${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
    if (!blob) throw new Error("blob empty");
    const file = new File([blob], `panel-${state.day.date}.jpg`, { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "پنل مطالعه" }); return; } catch {}
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    // fallback canvas drawing
    try { await sharePngFallback(); } catch (e2) {
      alert("ساخت عکس ممکن نشد: " + (err.message || err));
    }
  } finally {
    hide.forEach(([el, v]) => { el.style.visibility = v; });
  }
}
async function sharePngFallback() {
  const day = state.day;
  const total = dayTotal(day), target = day.targetSec || 1, pct = clamp(total / target * 100), remain = Math.max(0, target - total);
  const subjects = sortedSubjects(day);
  const W = 1080;
  const H = Math.max(1600, 320 + subjects.length * 200);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff"; g.font = "700 34px Tahoma"; g.textAlign = "right";
  g.fillText(formatLong(day.date), W - 60, 80);
  g.fillStyle = "#3dd68c"; g.textAlign = "left"; g.font = "400 20px Tahoma";
  g.fillText("آخرین به‌روزرسانی", 60, 60);
  g.font = "700 28px Tahoma";
  g.fillText(day.updatedAt ? new Date(day.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—", 60, 95);
  if (day.motto) {
    g.fillStyle = "rgba(255,255,255,0.85)"; g.textAlign = "center"; g.font = "400 24px Tahoma";
    g.fillText(day.motto, W / 2, 140);
  }
  drawRing(g, 150, 250, 64, pct, GOLD, Math.round(pct) + "%", "پیشرفت روز");
  g.fillStyle = "#fff"; g.textAlign = "right"; g.font = "400 22px Tahoma"; g.fillText("مطالعه شده", W - 60, 210);
  g.font = "700 40px Tahoma"; g.fillText(String(hm(total)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)), W - 60, 255);
  g.textAlign = "left"; g.font = "400 22px Tahoma"; g.fillText("باقی مانده", 260, 210);
  g.font = "700 40px Tahoma"; g.fillText(String(hm(remain)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)), 260, 255);
  g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(260, 280, W - 340, 12);
  g.fillStyle = GOLD; g.fillRect(260, 280, (W - 340) * pct / 100, 12);
  let y = 360;
  subjects.forEach((s) => {
    const sum = totalOf(s);
    g.fillStyle = s.color || GOLD; g.fillRect(W - 80, y - 14, 10, 22);
    g.fillStyle = "#fff"; g.font = "700 26px Tahoma"; g.textAlign = "right"; g.fillText(s.name, W - 95, y + 4);
    g.textAlign = "left"; g.font = "400 20px Tahoma"; g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillText(hm(s.studySec || 0) + " مطالعه  |  " + hm(s.testSec || 0) + " تست", 60, y + 4);
    y += 48;
  });
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `panel-${day.date}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
}
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function drawRing(g, x, y, r, pct, color, main, sub) {
  g.beginPath(); g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 10; g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.strokeStyle = color; g.lineCap = "round"; g.lineWidth = 10;
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + clamp(pct) / 100 * Math.PI * 2); g.stroke();
  g.fillStyle = "#fff"; g.font = "700 20px Tahoma"; g.textAlign = "center"; g.fillText(main, x, y);
  g.fillStyle = "rgba(255,255,255,0.55)"; g.font = "400 13px Tahoma"; g.fillText(sub, x, y + 20);
}

function renderReadonly(token) {
  document.getElementById("dock").style.display = "none";
  miniEl.style.display = "none";
  state.readonly = true;
  try {
    const data = decodeSnapshot(token);
    state.day = data.day;
    if (data.motto && state.day) state.day.motto = data.motto;
    if (data.settings?.digits) state.settings.digits = data.settings.digits;
    state.viewing = state.day.date;
    state.today = state.day.date;
    state.days = [state.day];
    state.notes = [];
    state.catalog = [];
    state.sessions = [];
    state.timer = null;
    render();
    // block interactions
    appEl.style.pointerEvents = "none";
  } catch { appEl.innerHTML = "<p style='color:#fff;padding:16px'>لینک نامعتبر است.</p>"; }
}


function showLiveTimerBubble() {
  let el = document.getElementById("live-timer-bubble");
  const t = state.timer;
  if (!t || t.status === "finished" || state.liveMode !== true) {
    if (el) el.remove();
    return;
  }
  const sub = state.day?.subjects?.[t.subjectId];
  const name = sub?.name || "درس";
  const act = t.activity === "test" ? "تست" : "مطالعه";
  const clock = formatHMS(elapsedMs(t));
  if (!el) {
    el = document.createElement("div");
    el.id = "live-timer-bubble";
    el.className = "live-timer-bubble";
    document.body.appendChild(el);
  }
  el.innerHTML = `<small>${name} · ${act}</small><b>${clock}</b>`;
}
async function bootLiveViewer(token) {
  state.liveMode = true;
  state.readonly = true;
  document.getElementById("dock").style.display = "none";
  miniEl.style.display = "none";
  const parts = decodeURIComponent(token).split("/");
  const code = parts[0];
  const date = parts[1];
  appEl.innerHTML = `<p style="padding:16px;color:#fff">در حال اتصال به پنل زنده…</p>`;
  state.firebase = (await db.kvGet("firebase")) || state.firebase;
  // allow viewer to use same config from URL query? use stored or prompt
  if (!sync.hasConfig(state.firebase)) {
    openSheet(`<h3>تنظیم Firebase برای مشاهده</h3>
      <div class="field"><label>apiKey</label><input id="fb_key"></div>
      <div class="field"><label>projectId</label><input id="fb_pid"></div>
      <div class="field"><label>databaseURL</label><input id="fb_url"></div>
      <button class="primary" id="ok">اتصال</button>`);
    await new Promise((res) => {
      sheet.querySelector("#ok").onclick = async () => {
        state.firebase = {
          apiKey: sheet.querySelector("#fb_key").value.trim(),
          projectId: sheet.querySelector("#fb_pid").value.trim(),
          databaseURL: sheet.querySelector("#fb_url").value.trim()
        };
        await db.kvSet("firebase", state.firebase);
        closeSheet(); res();
      };
    });
  }
  const ok = await sync.initSync(state.firebase);
  if (!ok) { appEl.innerHTML = `<p style="padding:16px;color:#fff">اتصال Firebase ناموفق</p>`; return; }
  state.syncCode = code;
  state.viewing = date;
  await sync.setViewerPresence(code, date, { viewing: true });
  await sync.subscribeLiveDay(code, date, (payload) => {
    if (!payload?.day) return;
    state.day = payload.day;
    if (payload.timer) state.timer = payload.timer;
    else state.timer = null;
    render();
    showLiveTimerBubble();
  });
  setInterval(() => {
    sync.setViewerPresence(code, date, { viewing: true });
  }, 15000);
  setInterval(() => {
    if (state.timer && state.timer.status !== "finished") showLiveTimerBubble();
  }, 500);
  // inject advisor note UI
  const noteBtn = document.createElement("button");
  noteBtn.className = "primary";
  noteBtn.style.cssText = "position:fixed;bottom:16px;left:16px;right:16px;z-index:50";
  noteBtn.textContent = "ارسال یادداشت به دانش‌آموز";
  noteBtn.onclick = () => {
    openSheet(`<h3>یادداشت مشاور</h3><div class="field"><textarea id="nt" rows="4" placeholder="پیام…"></textarea></div><button class="primary" id="ok">ارسال</button>`);
    sheet.querySelector("#ok").onclick = async () => {
      const text = sheet.querySelector("#nt").value.trim();
      if (!text) return;
      await sync.pushAdvisorNote(code, { text, from: "مشاور" });
      closeSheet();
      alert("ارسال شد");
    };
  };
  document.body.appendChild(noteBtn);
}

function unreadAdvisorCount() {
  const seen = state.inboxSeenAt || 0;
  return (state.advisorInbox || []).filter((n) => (n.at || 0) > seen).length;
}
function advisorChipHtml() {
  const n = unreadAdvisorCount();
  const online = state.advisorPresence && (Date.now() - (state.advisorPresence.at || 0) < 120000);
  return `<button type="button" class="advisor-chip" data-advisor>
    <span>مشاور${online ? " · آنلاین" : ""}</span>
    ${n > 0 ? `<span class="bell" title="پیام جدید">🔔<i>${n > 9 ? "9+" : n}</i></span>` : ""}
  </button>`;
}
function updateAdvisorBell() {
  const chip = document.querySelector(".advisor-chip");
  if (!chip) return;
  const n = unreadAdvisorCount();
  let bell = chip.querySelector(".bell");
  if (n > 0) {
    if (!bell) {
      bell = document.createElement("span");
      bell.className = "bell";
      chip.appendChild(bell);
    }
    bell.innerHTML = `🔔<i>${n > 9 ? "9+" : n}</i>`;
  } else if (bell) {
    bell.remove();
  }
  // dock badge
  const dockBtn = document.querySelector('[data-nav="advisor"]');
  if (dockBtn) {
    dockBtn.classList.toggle("has-badge", n > 0);
    let b = dockBtn.querySelector(".dock-badge");
    if (n > 0) {
      if (!b) { b = document.createElement("span"); b.className = "dock-badge"; dockBtn.appendChild(b); }
      b.textContent = n > 9 ? "9+" : String(n);
    } else if (b) b.remove();
  }
}
function openAdvisor() {
  if (state.readonly) return;
  const pres = state.advisorPresence;
  const last = pres?.at ? new Date(pres.at).toLocaleString("fa-IR") : "—";
  const online = pres && (Date.now() - (pres.at || 0) < 120000);
  const notes = (state.advisorInbox || []).map((n) => {
    const unread = (n.at || 0) > (state.inboxSeenAt || 0);
    return `<div class="note-card ${unread ? "unread" : ""}"><div class="sess-row"><span>${escapeHtml(n.from || "مشاور")}</span><span>${n.at ? new Date(n.at).toLocaleString("fa-IR") : ""}</span></div><p>${escapeHtml(n.text || "")}</p></div>`;
  }).join("") || `<p style="color:#666">یادداشتی نیست</p>`;
  openSheet(`<h3>مشاور</h3>
    <p style="color:${online ? "#3dd68c" : "#aaa"}">${online ? "● آنلاین / در حال مشاهده" : "○ آفلاین"}</p>
    <p style="color:#aaa;font-size:.8rem">آخرین بازدید: ${last}</p>
    <h4 style="margin-top:12px">صندوق یادداشت‌ها</h4>
    ${notes}
    <button class="ghost" data-close>بستن</button>`);
  // mark as seen
  const maxAt = (state.advisorInbox || []).reduce((m, n) => Math.max(m, n.at || 0), 0);
  if (maxAt > (state.inboxSeenAt || 0)) {
    state.inboxSeenAt = maxAt;
    db.kvSet("inboxSeenAt", state.inboxSeenAt);
    updateAdvisorBell();
    const chip = document.querySelector(".advisor-chip");
    if (chip) chip.outerHTML = advisorChipHtml();
  }
}

function openExamHub() {
  if (state.readonly) return;
  const list = (state.exams || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  openSheet(`<div class="exam-hub">
    <h3>آزمون‌های آزمایشی</h3>
    <p class="hint">پاسخنامهٔ چهارگزینه‌ای آفلاین — طراحی انعطاف‌پذیر</p>
    <button class="primary btn-block" id="newEx">＋ آزمون جدید</button>
    <div class="exam-list">${list.length ? list.map((ex) => `
      <div class="exam-card" data-ex="${ex.id}">
        <div class="exam-card-top">
          <b>${escapeHtml(ex.title)}</b>
          <span class="tag ${ex.status === "graded" ? "ok" : "draft"}">${ex.status === "graded" ? "تصحیح‌شده" : "پیش‌نویس"}</span>
        </div>
        <div class="exam-card-meta">${ex.subject ? escapeHtml(ex.subject) + " · " : ""}سوال ${dig(ex.from)}–${dig(ex.to)} · ${examMod.parityLabel(ex.parity || "all")} · ${dig(ex.questions?.length || 0)} تست</div>
        ${ex.result ? `<div class="exam-card-score">${dig(ex.result.pctNeg)}٪ ${ex.result.negative !== false ? "(منفی)" : ""}</div>` : ""}
        <div class="exam-card-actions">
          <button class="ghost sm" data-open-ex="${ex.id}">باز کردن</button>
          <button class="danger sm" data-del-ex="${ex.id}">حذف</button>
        </div>
      </div>`).join("") : `<p class="hint">هنوز آزمونی نیست</p>`}</div>
    <button class="ghost btn-block" data-close>بستن</button>
  </div>`);
  sheet.querySelector("#newEx").onclick = () => openNewExam();
  sheet.querySelectorAll("[data-open-ex]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); openExam(b.dataset.openEx); });
  sheet.querySelectorAll("[data-del-ex]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm("این آزمون حذف شود؟")) return;
    const id = b.dataset.delEx;
    await db.del("exams", id);
    state.exams = state.exams.filter((x) => x.id !== id);
    openExamHub();
  });
}

function openNewExam() {
  openSheet(`<div class="exam-hub">
    <h3>آزمون جدید</h3>
    <div class="field"><label>عنوان</label><input id="title" placeholder="مثلاً زیست جامع قلم‌چی"></div>
    <div class="field"><label>درس (اختیاری)</label><input id="subj" placeholder="زیست"></div>
    <div class="field-row">
      <div class="field"><label>از شماره</label><input id="from" type="number" value="1" min="1"></div>
      <div class="field"><label>تا شماره</label><input id="to" type="number" value="50" min="1"></div>
    </div>
    <div class="field"><label>شماره سوال‌ها</label>
      <select id="parity">
        <option value="all">همه (۱ تا n)</option>
        <option value="odd">فقط مضارب فرد (۱،۳،۵…)</option>
        <option value="even">فقط مضارب زوج (۲،۴،۶…)</option>
      </select>
    </div>
    <div class="field"><label><input type="checkbox" id="neg" checked> نمره منفی در کارنامه</label></div>
    <button class="primary btn-block" id="ok">ساخت پاسخنامه</button>
    <button class="ghost btn-block" id="back">بازگشت</button>
  </div>`);
  sheet.querySelector("#back").onclick = openExamHub;
  sheet.querySelector("#ok").onclick = async () => {
    const ex = examMod.createExam({
      title: sheet.querySelector("#title").value.trim(),
      subject: sheet.querySelector("#subj").value.trim(),
      from: sheet.querySelector("#from").value,
      to: sheet.querySelector("#to").value,
      parity: sheet.querySelector("#parity").value,
      negative: sheet.querySelector("#neg").checked
    });
    state.exams.push(ex);
    await db.put("exams", ex);
    openExam(ex.id);
  };
}

async function openExam(id) {
  let ex = state.exams.find((e) => e.id === id) || await db.get("exams", id);
  if (!ex) return;
  const paint = () => {
    const answered = ex.questions.filter((q) => q.answer).length;
    const rows = ex.questions.map((q, i) => {
      const choices = ["1", "2", "3", "4"].map((c) =>
        `<button type="button" class="choice ${q.answer === c ? "on" : ""}" data-i="${i}" data-c="${c}">${dig(c)}</button>`
      ).join("");
      let mark = "";
      if (ex.result) {
        const d = ex.result.detail.find((x) => x.n === q.n);
        if (d) mark = `<span class="mark ${d.status}">${d.status === "ok" ? "✓" : d.status === "bad" ? "✕" : "—"}</span>`;
      }
      return `<div class="exam-q"><span class="qn">${dig(q.n)}</span><div class="choices">${choices}</div>${mark}</div>`;
    }).join("");
    const res = ex.result ? `<div class="exam-result">
      <div class="er-title">کارنامه</div>
      <div class="er-grid">
        <div><b>${dig(ex.result.correct)}</b><span>صحیح</span></div>
        <div><b>${dig(ex.result.wrong)}</b><span>غلط</span></div>
        <div><b>${dig(ex.result.blank)}</b><span>نزده</span></div>
        <div><b>${dig(ex.result.pctRaw)}٪</b><span>خام</span></div>
        <div class="span2"><b>${dig(ex.result.pctNeg)}٪</b><span>${ex.result.negative !== false ? "با نمره منفی" : "نهایی"}</span></div>
      </div>
    </div>` : "";
    openSheet(`<div class="exam-hub">
      <div class="exam-head">
        <div>
          <h3>${escapeHtml(ex.title)}</h3>
          <p class="hint">${ex.subject ? escapeHtml(ex.subject) + " · " : ""}${examMod.parityLabel(ex.parity || "all")} · ${dig(answered)}/${dig(ex.questions.length)} پاسخ</p>
        </div>
      </div>
      <div class="exam-sheet">${rows}</div>
      ${res}
      <div class="exam-toolbar">
        <button class="ghost" id="saveEx">ذخیره</button>
        ${ex.result ? "" : `<button class="primary" id="grade">تصحیح</button>`}
        <button class="ghost" id="shareEx">اشتراک</button>
        <button class="danger" id="delEx">حذف</button>
        <button class="ghost" id="backHub">فهرست</button>
      </div>
    </div>`);
    sheet.querySelectorAll(".choice").forEach((b) => {
      b.onclick = () => {
        if (ex.result) return;
        ex = examMod.setAnswer(ex, Number(b.dataset.i), b.dataset.c);
        const ix = state.exams.findIndex((e) => e.id === ex.id);
        if (ix >= 0) state.exams[ix] = ex;
        paint();
      };
    });
    sheet.querySelector("#saveEx").onclick = async () => {
      ex.updatedAt = Date.now();
      await db.put("exams", ex);
      const ix = state.exams.findIndex((e) => e.id === ex.id);
      if (ix >= 0) state.exams[ix] = ex;
      alert("ذخیره شد");
    };
    sheet.querySelector("#backHub").onclick = openExamHub;
    sheet.querySelector("#delEx").onclick = async () => {
      if (!confirm("حذف این آزمون؟")) return;
      await db.del("exams", ex.id);
      state.exams = state.exams.filter((x) => x.id !== ex.id);
      openExamHub();
    };
    const g = sheet.querySelector("#grade");
    if (g) g.onclick = () => {
      openSheet(`<div class="exam-hub">
        <h3>کلید پاسخنامه</h3>
        <p class="hint">فقط اعداد ۱ تا ۴ به ترتیب سوال‌ها — بدون شماره سوال<br>مثال برای ۵ سوال: <code>31421</code></p>
        <div class="field"><textarea id="key" rows="3" placeholder="مثلاً 24132143..." inputmode="numeric"></textarea></div>
        <button class="primary btn-block" id="ok">تصحیح و کارنامه</button>
        <button class="ghost btn-block" id="back">بازگشت</button>
      </div>`);
      sheet.querySelector("#back").onclick = () => openExam(ex.id);
      sheet.querySelector("#ok").onclick = async () => {
        const map = examMod.parseKey(sheet.querySelector("#key").value, ex);
        if (!map) return alert("کلید نامعتبر — فقط ارقام ۱ تا ۴");
        if (Object.keys(map).length < ex.questions.length) {
          if (!confirm(`کلید کوتاه‌تر از تعداد سوال است (${Object.keys(map).length}/${ex.questions.length}). ادامه؟`)) return;
        }
        ex.result = examMod.gradeExam(ex, map);
        ex.status = "graded";
        ex.updatedAt = Date.now();
        await db.put("exams", ex);
        const ix = state.exams.findIndex((e) => e.id === ex.id);
        if (ix >= 0) state.exams[ix] = ex;
        openExam(ex.id);
      };
    };
    sheet.querySelector("#shareEx").onclick = async () => {
      const text = examMod.examShareText(ex);
      try { await navigator.clipboard.writeText(text); alert("کارنامه کپی شد"); } catch { prompt("کارنامه", text); }
    };
  };
  paint();
}

boot().catch((err) => { appEl.innerHTML = `<p style="color:#fff;background:#3a1010;padding:12px;border-radius:12px;margin:16px">خطا: ${err && err.message ? err.message : err}</p>`; console.error(err); });
