const MIN_LIMIT = 1000;

const DELAY_AVG = { safe: 9, normal: 5, fast: 2.5, ultra: 0.5 };

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

const $ = (id) => document.getElementById(id);
const say = (text) => {
  $("msg").textContent = text;
};
const store = chrome.storage.local;

function formatEta(seconds) {
  if (seconds < 60) return `~${Math.ceil(seconds)} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

async function refresh() {
  const s = await store.get(DEFAULTS);
  const pill = $("pill");

  $("sQueue").textContent = s.queue.length;
  $("sDone").textContent = s.done;
  $("sSkip").textContent = s.skipped;

  if (s.running) {
    pill.textContent = "En cours";
    pill.className = "pill run";
  } else if (s.finished) {
    pill.textContent = "Terminé";
    pill.className = "pill done";
  } else {
    pill.textContent = s.queue.length ? "En pause" : "Prêt";
    pill.className = "pill idle";
  }

  const processed = s.done + s.skipped;
  const showProgress = s.total > 0 && (s.running || processed > 0);
  $("progressBox").hidden = !showProgress;

  if (showProgress) {
    const pct = Math.min(100, Math.round((processed / s.total) * 100));
    const perAccount = (DELAY_AVG[s.speed] ?? DELAY_AVG.normal) + 2;
    $("barFill").style.width = `${pct}%`;
    $("pct").textContent = `${pct}%  (${processed}/${s.total})`;
    $("eta").textContent = s.running && s.queue.length ? formatEta(s.queue.length * perAccount) : "";
  }

  $("toggle").textContent = s.running ? "Pause" : "Reprendre";
  $("toggle").disabled = !s.running && s.queue.length === 0;
  $("stop").disabled = !s.running && s.session === 0 && processed === 0;
  $("clear").disabled = s.running || (s.queue.length === 0 && processed === 0 && s.total === 0);
  $("mainLabel").textContent =
    s.queue.length && !s.running ? "Collecter et bloquer à nouveau" : "Bloquer tous les reposteurs";
  $("main").disabled = s.running;

  const active = document.activeElement;
  if (active !== $("limit")) $("limit").value = Math.max(MIN_LIMIT, s.limit);
  if (active !== $("whitelist")) $("whitelist").value = s.whitelist.join("\n");
  if (active !== $("speed")) $("speed").value = s.speed;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$("main").onclick = async () => {
  const tab = await activeTab();
  if (!tab || !/^https:\/\/x\.com\//.test(tab.url || "")) {
    return say("Ouvre d'abord la page des reposts d'un post sur x.com.");
  }

  say("Collecte en cours… garde cet onglet ouvert.");
  $("main").disabled = true;

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "collectAndStart" });
    say(res && res.ok ? `${res.queued} comptes en file, blocage lancé.` : (res && res.error) || "Échec de la collecte.");
  } catch {
    say("Recharge la page x.com (F5) puis réessaie.");
  }

  refresh();
};

$("toggle").onclick = async () => {
  const s = await store.get(DEFAULTS);

  if (s.running) {
    await store.set({ running: false });
    say("En pause.");
  } else if (s.queue.length) {
    const tab = await activeTab();
    if (!tab) return say("Aucun onglet actif.");
    await store.set({ running: true, finished: false, session: 0 });
    await chrome.tabs.update(tab.id, { url: `https://x.com/${s.queue[0]}` });
    say("Reprise du blocage.");
  }

  refresh();
};

$("stop").onclick = async () => {
  await store.set({
    running: false,
    finished: false,
    total: 0,
    done: 0,
    skipped: 0,
    session: 0,
  });
  say("Arrêté. La file d'attente est conservée.");
  refresh();
};

$("clear").onclick = async () => {
  await store.set({
    queue: [],
    running: false,
    finished: false,
    total: 0,
    done: 0,
    skipped: 0,
    session: 0,
  });
  say("File vidée.");
  refresh();
};

async function saveSettings() {
  const whitelist = [
    ...new Set(
      $("whitelist")
        .value.split("\n")
        .map((line) => line.trim().replace(/^@/, ""))
        .filter(Boolean)
    ),
  ];
  const requested = parseInt($("limit").value, 10) || MIN_LIMIT;
  const limit = Math.max(MIN_LIMIT, requested);

  await store.set({ whitelist, limit, speed: $("speed").value });
  $("limit").value = limit;
  say(requested < MIN_LIMIT ? "Minimum : 1000." : "Réglages enregistrés.");
}

$("speed").onchange = saveSettings;
$("limit").onchange = saveSettings;
$("whitelist").onchange = saveSettings;

refresh();
setInterval(refresh, 1000);
