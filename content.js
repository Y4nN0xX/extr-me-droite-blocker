const MIN_LIMIT = 1000;

const DELAYS = {
  safe: [6000, 12000],
  normal: [3000, 7000],
  fast: [1500, 3500],
  ultra: [450, 550],
};

const DEFAULTS = {
  queue: [],
  running: false,
  finished: false,
  total: 0,
  done: 0,
  skipped: 0,
  whitelist: [],
  limit: MIN_LIMIT,
  session: 0,
  speed: "normal",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const getState = () => chrome.storage.local.get(DEFAULTS);
const setState = (values) => chrome.storage.local.set(values);
const getLimit = (state) => Math.max(MIN_LIMIT, Number(state.limit) || MIN_LIMIT);
const getDelay = (speed) => {
  const [min, max] = DELAYS[speed] || DELAYS.normal;
  return rand(min, max);
};

function waitFor(selector, timeout = 8000, interval = 100) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(tick, interval);
    };
    tick();
  });
}

function myHandle() {
  const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
  const href = link && link.getAttribute("href");
  return href ? href.replace("/", "").toLowerCase() : null;
}

const isRepostsPage = () => /\/status\/\d+\/retweets/.test(location.pathname);

function currentProfileHandle() {
  const match = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  return match ? match[1].toLowerCase() : null;
}

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
      const link = cell.querySelector('a[role="link"][href^="/"]');
      if (!link) return;
      const handle = link.getAttribute("href").split("/")[1];
      if (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle)) found.add(handle);
    });
    stable = found.size === before ? stable + 1 : 0;
    window.scrollBy(0, window.innerHeight);
    await sleep(650);
  }

  const state = await getState();
  const skip = new Set(
    [...state.whitelist, myHandle()].filter(Boolean).map((s) => s.toLowerCase())
  );
  const existing = new Set(state.queue.map((s) => s.toLowerCase()));
  const added = [...found].filter((h) => {
    const key = h.toLowerCase();
    return !skip.has(key) && !existing.has(key);
  });

  await setState({ queue: [...state.queue, ...added] });
  return { ok: true, found: found.size, added: added.length };
}

async function blockCurrentProfile() {
  try {
    const menuButton = await waitFor('[data-testid="userActions"]');
    if (!menuButton) return "skipped";
    menuButton.click();

    const blockItem = await waitFor('[data-testid="block"]', 3500);
    if (!blockItem) {
      document.body.click();
      return "skipped";
    }
    blockItem.click();

    const confirm = await waitFor('[data-testid="confirmationSheetConfirm"]', 3500);
    if (!confirm) return "skipped";
    confirm.click();

    await sleep(400);
    return "blocked";
  } catch {
    return "skipped";
  }
}

async function finish(queueLength) {
  await setState({ running: false, finished: queueLength === 0, session: 0 });
}

async function processStep() {
  const state = await getState();
  if (!state.running) return;

  if (state.queue.length === 0 || state.session >= getLimit(state)) {
    return finish(state.queue.length);
  }

  const target = state.queue[0];
  if (currentProfileHandle() !== target.toLowerCase()) {
    location.href = `https://x.com/${target}`;
    return;
  }

  const result = await blockCurrentProfile();

  const fresh = await getState();
  if (!fresh.running) return;

  await setState({
    queue: fresh.queue.slice(1),
    done: fresh.done + (result === "blocked" ? 1 : 0),
    skipped: fresh.skipped + (result === "skipped" ? 1 : 0),
    session: fresh.session + 1,
  });

  await sleep(getDelay(fresh.speed));

  const after = await getState();
  if (after.running && after.queue.length > 0 && after.session < getLimit(after)) {
    location.href = `https://x.com/${after.queue[0]}`;
  } else if (after.running) {
    await finish(after.queue.length);
  }
}

async function collectAndStart() {
  const result = await collect();
  if (!result.ok) return result;

  const state = await getState();
  if (state.queue.length === 0) {
    return { ok: false, error: "Aucun compte à bloquer (liste vide ou tous exclus)." };
  }

  await setState({
    running: true,
    finished: false,
    total: state.queue.length,
    done: 0,
    skipped: 0,
    session: 0,
  });

  location.href = `https://x.com/${state.queue[0]}`;
  return { ok: true, found: result.found, queued: state.queue.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "collectAndStart") {
    collectAndStart()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Échec de la collecte." }));
    return true;
  }
});

processStep().catch(() => {});
