/** Optional Firebase Realtime Database sync. Offline-first; no-ops without config. */

let app = null;
let dbRef = null;
let unsub = null;
let liveUnsub = null;

export function hasConfig(cfg) {
  return !!(cfg && cfg.apiKey && cfg.databaseURL && cfg.projectId);
}

export async function initSync(cfg) {
  if (!hasConfig(cfg)) { app = null; dbRef = null; return false; }
  try {
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const { getDatabase, ref } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
    if (!getApps().length) app = initializeApp(cfg);
    else app = getApps()[0];
    dbRef = getDatabase(app);
    return true;
  } catch (e) {
    console.warn("Firebase init failed", e);
    app = null;
    dbRef = null;
    return false;
  }
}

export async function pushBundle(syncCode, bundle) {
  if (!dbRef || !syncCode) return false;
  try {
    const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
    await set(ref(dbRef, `rooms/${syncCode}/bundle`), { ...bundle, pushedAt: Date.now() });
    return true;
  } catch (e) {
    console.warn("push failed", e);
    return false;
  }
}

export async function pullBundle(syncCode) {
  if (!dbRef || !syncCode) return null;
  try {
    const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
    const snap = await get(ref(dbRef, `rooms/${syncCode}/bundle`));
    return snap.exists() ? snap.val() : null;
  } catch (e) {
    console.warn("pull failed", e);
    return null;
  }
}

export async function subscribeBundle(syncCode, onData) {
  if (unsub) { try { unsub(); } catch {} unsub = null; }
  if (!dbRef || !syncCode) return;
  const { ref, onValue, off } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
  const r = ref(dbRef, `rooms/${syncCode}/bundle`);
  const handler = (snap) => { if (snap.exists()) onData(snap.val()); };
  onValue(r, handler);
  unsub = () => off(r, "value", handler);
}

export async function pushLiveDay(syncCode, date, payload) {
  if (!dbRef || !syncCode || !date) return false;
  try {
    const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
    await set(ref(dbRef, `rooms/${syncCode}/live/${date}`), { ...payload, updatedAt: Date.now() });
    return true;
  } catch (e) {
    console.warn("live push failed", e);
    return false;
  }
}

export async function subscribeLiveDay(syncCode, date, onData) {
  if (liveUnsub) { try { liveUnsub(); } catch {} liveUnsub = null; }
  if (!dbRef || !syncCode || !date) return;
  const { ref, onValue, off } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
  const r = ref(dbRef, `rooms/${syncCode}/live/${date}`);
  const handler = (snap) => { if (snap.exists()) onData(snap.val()); };
  onValue(r, handler);
  liveUnsub = () => off(r, "value", handler);
}

export async function pushAdvisorNote(syncCode, note) {
  if (!dbRef || !syncCode) return false;
  try {
    const { ref, push } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
    await push(ref(dbRef, `rooms/${syncCode}/inbox`), { ...note, at: Date.now() });
    return true;
  } catch (e) {
    console.warn("note push failed", e);
    return false;
  }
}

export async function subscribeInbox(syncCode, onData) {
  if (!dbRef || !syncCode) return () => {};
  const { ref, onValue, off } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
  const r = ref(dbRef, `rooms/${syncCode}/inbox`);
  const handler = (snap) => {
    const val = snap.val() || {};
    const list = Object.entries(val).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.at || 0) - (a.at || 0));
    onData(list);
  };
  onValue(r, handler);
  return () => off(r, "value", handler);
}

export async function setViewerPresence(syncCode, date, info) {
  if (!dbRef || !syncCode) return;
  try {
    const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
    await set(ref(dbRef, `rooms/${syncCode}/presence/${date}`), { ...info, at: Date.now() });
  } catch {}
}

export async function subscribePresence(syncCode, date, onData) {
  if (!dbRef || !syncCode) return () => {};
  const { ref, onValue, off } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js");
  const r = ref(dbRef, `rooms/${syncCode}/presence/${date}`);
  const handler = (snap) => { if (snap.exists()) onData(snap.val()); };
  onValue(r, handler);
  return () => off(r, "value", handler);
}

export function genSyncCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
