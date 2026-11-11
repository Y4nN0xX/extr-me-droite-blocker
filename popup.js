const $ = (id) => document.getElementById(id);
const say = (t) => ($("msg").textContent = t);

const DELAY_AVG = { safe: 9, normal: 5, fast: 2.5 }; // secondes, pour l'estimation

const DEFAULTS = {
  queue: [], running: false, finished: false, total: 0,
  done: 0, skipped: 0, whitelist: [], limit: 200, speed: "normal",
};

function fmtEta(seconds) {
  if (seconds < 60) return `~${Math.ceil(seconds)} s`;
  const m = Math.ceil(seconds / 60);
  return m < 60 ? `~${m} min` : `~${Math.floor(m / 60)} h ${m % 60} min`;
}

async function refresh() {
  const s = await chrome.storage.local.get(DEFAULTS);

  $("sQueue").textContent = s.queue.length;
  $("sDone").textContent = s.done;
  $("sSkip").textContent = s.skipped;

  const pill = $("pill");
  if (s.running) { pill.textContent = "En cours"; pill.className = "pill run"; }
  else if (s.finished) { pill.textContent = "Terminé"; pill.className = "pill done"; }
  else { pill.textContent = s.queue.length ? "En pause" : "Prêt"; pill.className = "pill idle"; }

  const processed = s.done + s.skipped;
  const showProgress = s.total > 0 && (s.running || processed > 0);
  $("progressBox").hidden = !showProgress;
  if (showProgress) {
    const pct = Math.min(100, Math.round((processed / s.total) * 100));
    $("barFill").style.width = pct + "%";
    $("pct").textContent = `${pct}%  (${processed}/${s.total})`;
    $("eta").textContent = s.running && s.queue.length
      ? fmtEta(s.queue.length * (DELAY_AVG[s.speed] + 2)) : "";
  }

  $("toggle").textContent = s.running ? "Pause" : "Reprendre";
  $("toggle").disabled = !s.running && s.queue.length === 0;
  $("mainLabel").textContent = s.queue.length && !s.running
    ? "Collecter et bloquer à nouveau" : "Bloquer tous les reposteurs";
  $("main").disabled = s.running;

  const a = document.activeElement;
  if (a !== $("limit")) $("limit").value = s.limit;
  if (a !== $("whitelist")) $("whitelist").value = s.whitelist.join("\n");
  if (a !== $("speed")) $("speed").value = s.speed;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Un seul clic : collecte puis blocage automatique
$("main").onclick = async () => {
  const tab = await activeTab();
  if (!tab || !/^https:\/\/x\.com\//.test(tab.url || "")) {
    return say("Ouvre d'abord la page des reposts d'un post sur x.com.");
  }
  say("Collecte en cours… garde cet onglet ouvert.");
  $("main").disabled = true;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "collectAndStart" });
    if (res && res.ok) say(`${res.queued} comptes en file, blocage lancé.`);
    else say((res && res.error) || "Échec de la collecte.");
  } catch {
    say("Recharge la page x.com (F5) puis réessaie.");
  }
  refresh();
};

$("toggle").onclick = async () => {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (s.running) {
    await chrome.storage.local.set({ running: false });
    say("En pause.");
  } else if (s.queue.length) {
    await chrome.storage.local.set({ running: true, finished: false, session: 0 });
    const tab = await activeTab();
    await chrome.tabs.update(tab.id, { url: `https://x.com/${s.queue[0]}` });
    say("Reprise du blocage.");
  }
  refresh();
};

$("clear").onclick = async () => {
  await chrome.storage.local.set({
    queue: [], running: false, finished: false, total: 0, done: 0, skipped: 0, session: 0,
  });
  say("File vidée.");
  refresh();
};

$("save").onclick = async () => {
  const whitelist = $("whitelist").value
    .split("\n").map((l) => l.trim().replace(/^@/, "")).filter(Boolean);
  const limit = Math.max(1, parseInt($("limit").value, 10) || 200);
  await chrome.storage.local.set({ whitelist, limit, speed: $("speed").value });
  say("Réglages enregistrés.");
};

refresh();
setInterval(refresh, 1000);
