// Block Reposters for X - content script
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

const DELAYS = {
  safe: [6000, 12000],
  normal: [3000, 7000],
  fast: [1500, 3500],
};

const DEFAULTS = {
  queue: [],
  running: false,
  finished: false,
  total: 0,
  done: 0,
  skipped: 0,
  whitelist: [],
  limit: 200,
  session: 0,
  speed: "normal",
};

const getState = () => chrome.storage.local.get(DEFAULTS);
const setState = (o) => chrome.storage.local.set(o);

function waitFor(selector, timeout = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function myHandle() {
  const a = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  return a ? a.getAttribute("href").replace("/", "").toLowerCase() : null;
}

const isRepostsPage = () => /\/status\/\d+\/retweets/.test(location.pathname);

function currentProfileHandle() {
  const m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  return m ? m[1].toLowerCase() : null;
}

// ---------- 1. Collecte ----------
async function collect() {
  if (!isRepostsPage()) {
    return { ok: false, error: "Ouvre la page des reposts d'un post (…/status/ID/retweets)." };
  }
  await waitFor('[data-testid="UserCell"]', 10000);
  const found = new Set();
  let stable = 0;
  while (stable < 4) {
    const before = found.size;
    document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
      const a = cell.querySelector('a[role="link"][href^="/"]');
      if (!a) return;
      const h = a.getAttribute("href").split("/")[1];
      if (h && /^[A-Za-z0-9_]{1,15}$/.test(h)) found.add(h);
    });
    stable = found.size === before ? stable + 1 : 0;
    window.scrollBy(0, window.innerHeight);
    await sleep(650);
  }
  const st = await getState();
  const me = myHandle();
  const skip = new Set([...st.whitelist, me].filter(Boolean).map((s) => s.toLowerCase()));
  const existing = new Set(st.queue.map((s) => s.toLowerCase()));
  const added = [...found].filter(
    (h) => !skip.has(h.toLowerCase()) && !existing.has(h.toLowerCase())
  );
  await setState({ queue: [...st.queue, ...added] });
  return { ok: true, found: found.size, added: added.length };
}

// ---------- 2. Blocage ----------
async function blockCurrentProfile() {
  const menuBtn = await waitFor('[data-testid="userActions"]');
  if (!menuBtn) return "skipped"; // introuvable, suspendu ou compte qui nous a déjà bloqué
  menuBtn.click();
  const blockItem = await waitFor('[data-testid="block"]', 3500);
  if (!blockItem) {
    document.body.click();
    return "skipped"; // déjà bloqué
  }
  blockItem.click();
  const confirm = await waitFor('[data-testid="confirmationSheetConfirm"]', 3500);
  if (!confirm) return "skipped";
  confirm.click();
  await sleep(500);
  return "blocked";
}

async function processStep() {
  const st = await getState();
  if (!st.running) return;
  if (st.queue.length === 0 || st.session >= st.limit) {
    await setState({ running: false, finished: st.queue.length === 0, session: 0 });
    return;
  }
  const target = st.queue[0];
  if (currentProfileHandle() !== target.toLowerCase()) {
    location.href = `https://x.com/${target}`;
    return;
  }
  const result = await blockCurrentProfile();
  const fresh = await getState();
  if (!fresh.running) return; // mis en pause pendant l'opération
  await setState({
    queue: fresh.queue.slice(1),
    done: fresh.done + (result === "blocked" ? 1 : 0),
    skipped: fresh.skipped + (result === "skipped" ? 1 : 0),
    session: fresh.session + 1,
  });
  const [min, max] = DELAYS[fresh.speed] || DELAYS.normal;
  await sleep(rand(min, max));
  const after = await getState();
  if (after.running && after.queue.length > 0 && after.session < after.limit) {
    location.href = `https://x.com/${after.queue[0]}`;
  } else {
    await setState({ running: false, finished: after.queue.length === 0, session: 0 });
  }
}

// ---------- Tout en un : collecte puis blocage automatique ----------
async function collectAndStart() {
  const res = await collect();
  if (!res.ok) return res;
  const st = await getState();
  if (st.queue.length === 0) {
    return { ok: false, error: "Aucun compte à bloquer (liste vide ou tous exclus)." };
  }
  await setState({
    running: true,
    finished: false,
    total: st.queue.length,
    done: 0,
    skipped: 0,
    session: 0,
  });
  location.href = `https://x.com/${st.queue[0]}`;
  return { ok: true, found: res.found, queued: st.queue.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "collectAndStart") {
    collectAndStart().then(sendResponse);
    return true;
  }
});

// Reprise automatique après chaque navigation
processStep();
