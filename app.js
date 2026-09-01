/* =====================================================================
   ╔═══════════════════════════════════════════════════════════════════╗
   ║  1. LÉPÉS: ILLESZD BE IDE A SAJÁT FIREBASE KONFIGURÁCIÓDAT!       ║
   ║  (Firebase Console -> Projekt beállításai -> Web app -> Config)   ║
   ║  FONTOS: a databaseURL mező kötelező (Realtime Database)!         ║
   ╚═══════════════════════════════════════════════════════════════════╝
   ===================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyBE5KlivBiaeQ0AD0c6sF0fVY2S6TsIZDY",
  authDomain: "ket-igaz-egy-hamis.firebaseapp.com",
  databaseURL: "https://ket-igaz-egy-hamis-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ket-igaz-egy-hamis",
  storageBucket: "ket-igaz-egy-hamis.firebasestorage.app",
  messagingSenderId: "997622697398",
  appId: "1:997622697398:web:fcb76774acf32493cb4517"
};

/* ---------------------------------------------------------------------
   TITKOS TÖRLŐ KÓD
   A fejlécben lévő 3 pöttyre kattintva jön elő a törlő panel.
   Ide beírva ezt a kódot az ÖSSZES szoba véglegesen törlődik.
   Írd át valami sajátra!
   --------------------------------------------------------------------- */
const ADMIN_CODE = "TOROLD_MIND_2026";

/* =====================================================================
   INNENTŐL NEM KELL SEMMIT ÁTÍRNI
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, set, get, update, remove, onValue, off
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

/* =====================================================================
   ÁLLANDÓK / SEGÉDFÜGGVÉNYEK
   ===================================================================== */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O és 1/I kihagyva
const CODE_LENGTH   = 6;

const LS_UID  = "ktih_uid";
const LS_ROOM = "ktih_room";

const $  = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function randomCode() {
  let out = "";
  const buf = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

function uid() {
  let id = localStorage.getItem(LS_UID);
  if (!id) {
    id = "u" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(LS_UID, id);
  }
  return id;
}

/** Fisher–Yates keverés (helyben) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* =====================================================================
   GLOBÁLIS ÁLLAPOT
   ===================================================================== */

const MY_ID = uid();
let roomCode = null;      // aktuális szoba kódja
let room     = null;      // a szoba legfrissebb pillanatképe
let roomRef  = null;      // Firebase referencia
let listener = null;      // onValue leiratkozáshoz
let isHost   = false;

/* =====================================================================
   KÉPERNYŐKEZELÉS (SPA – csak DOM elemeket rejtünk / mutatunk)
   ===================================================================== */

const SCREENS = ["screen-landing", "screen-submit", "screen-lobby", "screen-game", "screen-end"];

function showScreen(id) {
  SCREENS.forEach(s => { $(s).hidden = (s !== id); });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateTopbar() {
  const inRoom = !!roomCode;
  $("top-room").hidden = !inRoom;
  $("top-role").hidden = !inRoom;
  $("btn-leave").hidden = !inRoom;
  if (inRoom) {
    $("top-room-code").textContent = roomCode;
    $("top-role").textContent = isHost ? "Hoszt" : "Játékos";
  }
}

/* =====================================================================
   SZOBA LÉTREHOZÁS / CSATLAKOZÁS
   ===================================================================== */

async function createRoom() {
  $("landing-error").hidden = true;
  $("btn-create").disabled = true;
  try {
    let code, tries = 0;
    do {
      code = randomCode();
      const snap = await get(ref(db, `rooms/${code}`));
      if (!snap.exists()) break;
      code = null;
    } while (++tries < 10);

    if (!code) throw new Error("Nem sikerült szabad szobakódot generálni.");

    await set(ref(db, `rooms/${code}`), {
      gameState: "submitting",
      hostId: MY_ID,
      activePlayerId: null,
      orderIndex: 0,
      authorRevealed: false,
      lieRevealed: false,
      createdAt: Date.now()
    });

    enterRoom(code);
    toast("Szoba létrehozva: " + code);
  } catch (e) {
    showLandingError(errText(e));
  } finally {
    $("btn-create").disabled = false;
  }
}

async function joinRoom(codeRaw) {
  $("landing-error").hidden = true;
  const code = String(codeRaw || "").trim().toUpperCase();
  if (code.length < 4) return showLandingError("Adj meg egy érvényes szobakódot!");

  $("btn-join").disabled = true;
  try {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) return showLandingError("Nincs ilyen szoba. Ellenőrizd a kódot!");
    const data = snap.val();
    const alreadyIn = data.players && data.players[MY_ID];
    if (data.gameState !== "submitting" && !alreadyIn) {
      return showLandingError("Ez a játék már elindult, most nem lehet csatlakozni.");
    }
    enterRoom(code);
  } catch (e) {
    showLandingError(errText(e));
  } finally {
    $("btn-join").disabled = false;
  }
}

function showLandingError(msg) {
  const el = $("landing-error");
  el.textContent = msg;
  el.hidden = false;
}

function errText(e) {
  console.error(e);
  const m = String(e && e.message || e);
  if (m.toLowerCase().includes("permission"))
    return "Az adatbázis nem engedi az írást. Ellenőrizd a Realtime Database szabályokat!";
  return "Hiba történt: " + m;
}

/** Feliratkozás a szobára – innentől minden a valós idejű adatokból renderelődik. */
function enterRoom(code) {
  roomCode = code;
  localStorage.setItem(LS_ROOM, code);
  roomRef = ref(db, `rooms/${code}`);
  if (listener) off(roomRef);
  listener = onValue(roomRef, (snap) => {
    if (!snap.exists()) {                 // a hoszt törölte a szobát
      leaveRoom(true);
      toast("A szoba megszűnt.");
      return;
    }
    room = snap.val();
    isHost = room.hostId === MY_ID;
    updateTopbar();
    render();
  }, (err) => showLandingError(errText(err)));
}

function leaveRoom(silent) {
  if (roomRef && listener) off(roomRef);
  listener = null; roomRef = null; room = null; roomCode = null; isHost = false;
  localStorage.removeItem(LS_ROOM);
  updateTopbar();
  showScreen("screen-landing");
  if (!silent) toast("Kiléptél a szobából.");
}

/* =====================================================================
   1. SZAKASZ – ÁLLÍTÁSOK BEKÜLDÉSE
   ===================================================================== */

async function submitStory(ev) {
  ev.preventDefault();
  const err  = $("submit-error");
  err.hidden = true;

  const name = $("inp-name").value.trim();
  const t1   = $("inp-t1").value.trim();
  const t2   = $("inp-t2").value.trim();
  const lie  = $("inp-lie").value.trim();

  if (!name || !t1 || !t2 || !lie) {
    err.textContent = "Minden mezőt tölts ki!";
    err.hidden = false;
    return;
  }

  // --- KRITIKUS RÉSZ: keverés + a hazugság indexének megjegyzése -------
  const pack = shuffle([
    { text: t1,  lie: false },
    { text: t2,  lie: false },
    { text: lie, lie: true  }
  ]);
  const statements = pack.map(p => p.text);
  const lieIndex   = pack.findIndex(p => p.lie);
  // --------------------------------------------------------------------

  $("btn-submit-story").disabled = true;
  try {
    await update(ref(db, `rooms/${roomCode}/players/${MY_ID}`), {
      name, statements, lieIndex,
      submitted: true,
      joinedAt: (room && room.players && room.players[MY_ID] && room.players[MY_ID].joinedAt) || Date.now()
    });
    toast("Beküldve! 🎉");
  } catch (e) {
    err.textContent = errText(e);
    err.hidden = false;
  } finally {
    $("btn-submit-story").disabled = false;
  }
}

/* =====================================================================
   HOSZT: JÁTÉKVEZÉRLÉS
   ===================================================================== */

function submittedPlayers() {
  const players = (room && room.players) || {};
  return Object.entries(players)
    .filter(([, p]) => p && p.submitted)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
}

async function startGame() {
  const list = submittedPlayers().map(([id]) => id);
  if (list.length < 2) return toast("Legalább 2 beküldött játékos kell!");
  const order = shuffle([...list]);
  await update(roomRef, {
    order,
    orderIndex: 0,
    activePlayerId: order[0],
    gameState: "guess_author",
    authorRevealed: false,
    lieRevealed: false,
    votes: null
  });
}

async function closeAuthorVoting() {
  await update(roomRef, { gameState: "reveal_author" });
}

/** Szerző felfedése + pontozás + az aktív játékos "elhasználtnak" jelölése. */
async function revealAuthor() {
  const votes = (room.votes && room.votes.author) || {};
  const scores = Object.assign({}, room.scores || {});
  Object.entries(votes).forEach(([voter, target]) => {
    if (target === room.activePlayerId) scores[voter] = (scores[voter] || 0) + 1;
  });
  const revealed = Object.assign({}, room.revealed || {});
  revealed[room.activePlayerId] = true;

  await update(roomRef, { authorRevealed: true, scores, revealed });
}

async function goToLieVoting() {
  await update(roomRef, { gameState: "guess_lie" });
}

async function closeLieVoting() {
  await update(roomRef, { gameState: "reveal_lie" });
}

async function revealLie() {
  const active = room.players[room.activePlayerId];
  const votes  = (room.votes && room.votes.lie) || {};
  const scores = Object.assign({}, room.scores || {});
  Object.entries(votes).forEach(([voter, idx]) => {
    if (Number(idx) === Number(active.lieIndex)) scores[voter] = (scores[voter] || 0) + 1;
  });
  await update(roomRef, { lieRevealed: true, scores });
}

async function nextPlayer() {
  const order = room.order || [];
  const next  = (room.orderIndex || 0) + 1;

  if (next >= order.length) {
    await update(roomRef, { gameState: "end", activePlayerId: null, votes: null });
    return;
  }
  await update(roomRef, {
    orderIndex: next,
    activePlayerId: order[next],
    gameState: "guess_author",
    authorRevealed: false,
    lieRevealed: false,
    votes: null
  });
}

async function newGame() {
  // Új kör ugyanazokkal az emberekkel: az állítások törlődnek, a nevek maradnak.
  const players = room.players || {};
  const cleaned = {};
  Object.entries(players).forEach(([id, p]) => {
    cleaned[id] = { name: p.name, submitted: false, joinedAt: p.joinedAt || Date.now() };
  });
  await update(roomRef, {
    gameState: "submitting",
    players: cleaned,
    order: null, orderIndex: 0, activePlayerId: null,
    authorRevealed: false, lieRevealed: false,
    votes: null, revealed: null, scores: null
  });
  toast("Új kör indul – mindenki írjon új állításokat!");
}

/* =====================================================================
   SZAVAZÁS (játékos oldal)
   ===================================================================== */

async function voteAuthor(targetId) {
  if (room.gameState !== "guess_author") return;
  if (MY_ID === room.activePlayerId) return;
  await set(ref(db, `rooms/${roomCode}/votes/author/${MY_ID}`), targetId);
  toast("Szavazatod elmentve ✔");
}

async function voteLie(index) {
  if (room.gameState !== "guess_lie") return;
  if (MY_ID === room.activePlayerId) return;
  await set(ref(db, `rooms/${roomCode}/votes/lie/${MY_ID}`), Number(index));
  toast("Szavazatod elmentve ✔");
}

/* =====================================================================
   RENDERELÉS
   ===================================================================== */

function render() {
  if (!room) return;
  const me = (room.players || {})[MY_ID];
  const gs = room.gameState;

  // 1. szakasz: aki még nem küldött be, az az űrlapot látja
  if (gs === "submitting") {
    if (!me || !me.submitted) { renderSubmit(); showScreen("screen-submit"); }
    else { renderLobby(); showScreen("screen-lobby"); }
    return;
  }

  if (gs === "end") { renderEnd(); showScreen("screen-end"); return; }

  // Ha valaki lemaradt a beküldésről, a játék alatt nézőként követi az eseményeket.
  renderGame();
  showScreen("screen-game");
}

/* ---------- 1. szakasz ---------- */
function renderSubmit() {
  $("submit-room-code").textContent = roomCode;
  const me = (room.players || {})[MY_ID];
  if (me && me.name && !$("inp-name").value) $("inp-name").value = me.name;
}

/* ---------- 2. szakasz ---------- */
function renderLobby() {
  $("lobby-room-code").textContent = roomCode;
  const list = submittedPlayers();
  $("lobby-count").textContent = `Beküldött játékosok: ${list.length}`;
  $("lobby-list").innerHTML = list.map(([id, p]) => `
    <li class="${id === MY_ID ? "is-me" : ""}">
      <span class="avatar">${esc((p.name || "?").charAt(0).toUpperCase())}</span>
      <span>${esc(p.name)}</span>
      ${id === room.hostId ? '<span class="tag">hoszt</span>' : ""}
    </li>`).join("");

  $("lobby-host").hidden = !isHost;
  $("lobby-hint").hidden = isHost;
  $("btn-start-game").disabled = list.length < 2;
}

/* ---------- segéd: állítás-kártyák ---------- */
function statementCards(stmts, opts = {}) {
  const { clickable = false, picked = null, lieIndex = null, counts = null, total = 0 } = opts;
  return stmts.map((txt, i) => {
    const cls = [
      "statement",
      picked === i ? "picked" : "",
      (lieIndex !== null && lieIndex === i) ? "is-lie" : ""
    ].join(" ").trim();
    const flag = (lieIndex !== null && lieIndex === i) ? '<span class="flag">HAZUGSÁG</span>' : "";
    const cnt  = counts ? `<span class="flag">${counts[i]} szavazat</span>` : "";
    const inner = `<span class="num">${i + 1}</span><span>${esc(txt)}</span>${flag || cnt}`;
    return clickable
      ? `<button type="button" class="${cls}" data-vote-lie="${i}">${inner}</button>`
      : `<div class="${cls}">${inner}</div>`;
  }).join("");
}

/* ---------- segéd: oszlopdiagram ---------- */
function barChart(rows) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return `<div class="bars">` + rows.map(r => `
    <div class="bar-row ${r.win ? "is-win" : ""}">
      <div class="bar-label">${esc(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.count / max * 100)}%"></div></div>
      <div class="bar-count">${r.count}</div>
    </div>`).join("") + `</div>`;
}

/* ---------- 3–4. szakasz ---------- */
function renderGame() {
  const gs      = room.gameState;
  const players = room.players || {};
  const active  = players[room.activePlayerId];
  const order   = room.order || [];
  const body    = $("game-body");

  if (!active) { body.innerHTML = `<p class="notice wait">Betöltés…</p>`; return; }

  $("stage-progress").textContent = `${(room.orderIndex || 0) + 1} / ${order.length}`;
  $("stage-chip").textContent = {
    guess_author: "1. kör – Ki írta?",
    reveal_author: "Eredmény – Ki írta?",
    guess_lie:    "2. kör – Melyik a hazugság?",
    reveal_lie:   "Eredmény – A hazugság"
  }[gs] || "Játék";

  const stmts       = active.statements || [];
  const iAmActive   = MY_ID === room.activePlayerId;
  const iSubmitted  = !!(players[MY_ID] && players[MY_ID].submitted);
  const authorVotes = (room.votes && room.votes.author) || {};
  const lieVotes    = (room.votes && room.votes.lie) || {};

  let html = "";

  /* ---- 3A: ki írta? ---- */
  if (gs === "guess_author") {
    const myVote = authorVotes[MY_ID] || null;
    html += `<h3 class="q-title">Vajon ki írta?</h3>`;
    html += `<div class="statements">${statementCards(stmts)}</div>`;

    if (iAmActive) {
      html += `<p class="notice">Ez a te történeted 🤫 Várd meg a többieket!</p>`;
    } else if (!iSubmitted) {
      html += `<p class="notice wait">Nézőként követed a játékot.</p>`;
    } else {
      const candidates = candidateList();
      html += `<div class="name-grid">` + candidates.map(([id, p]) => `
        <button type="button" class="name-btn ${myVote === id ? "picked" : ""}" data-vote-author="${id}">
          ${esc(p.name)}
        </button>`).join("") + `</div>`;
      html += myVote
        ? `<p class="muted center" style="margin-top:12px">Szavaztál: <b>${esc((players[myVote] || {}).name || "?")}</b> – át tudod írni, amíg a hoszt le nem zárja.</p>`
        : `<p class="muted center" style="margin-top:12px">Válassz egy nevet!</p>`;
    }
  }

  /* ---- 3B: szerző felfedése ---- */
  if (gs === "reveal_author") {
    html += `<h3 class="q-title">Szavazás eredménye</h3>`;
    const counts = {};
    candidateList().forEach(([id]) => counts[id] = 0);
    Object.values(authorVotes).forEach(t => { if (t in counts) counts[t]++; });
    const rows = Object.entries(counts)
      .map(([id, c]) => ({
        label: (players[id] || {}).name || "?",
        count: c,
        win: room.authorRevealed && id === room.activePlayerId
      }))
      .sort((a, b) => b.count - a.count);
    html += barChart(rows);

    if (room.authorRevealed) {
      html += `<div class="author-banner"><span class="lbl">A történet szerzője</span>
               <span class="who">${esc(active.name)}</span></div>`;
      html += `<div class="statements">${statementCards(stmts)}</div>`;
    } else {
      html += `<p class="notice wait">Várunk a hosztra, hogy felfedje a szerzőt…</p>`;
    }
  }

  /* ---- 4A: melyik a hazugság? ---- */
  if (gs === "guess_lie") {
    const myVote = (MY_ID in lieVotes) ? Number(lieVotes[MY_ID]) : null;
    html += `<div class="author-banner"><span class="lbl">${esc(active.name)} történetei</span></div>`;
    html += `<h3 class="q-title">Melyik a hazugság?</h3>`;

    if (iAmActive) {
      html += `<div class="statements">${statementCards(stmts)}</div>`;
      html += `<p class="notice">Te tudod a választ 🤐 Csendben maradsz!</p>`;
    } else if (!iSubmitted) {
      html += `<div class="statements">${statementCards(stmts)}</div>`;
      html += `<p class="notice wait">Nézőként követed a játékot.</p>`;
    } else {
      html += `<div class="statements">${statementCards(stmts, { clickable: true, picked: myVote })}</div>`;
      html += myVote !== null
        ? `<p class="muted center">Szavaztál a <b>${myVote + 1}.</b> állításra – át tudod írni a lezárásig.</p>`
        : `<p class="muted center">Kattints arra, amit hazugságnak gondolsz!</p>`;
    }
  }

  /* ---- 4B: hazugság felfedése ---- */
  if (gs === "reveal_lie") {
    html += `<div class="author-banner"><span class="lbl">A történetek szerzője</span>
             <span class="who">${esc(active.name)}</span></div>`;
    html += `<h3 class="q-title">Szavazás eredménye</h3>`;

    const counts = stmts.map((_, i) => Object.values(lieVotes).filter(v => Number(v) === i).length);
    html += barChart(stmts.map((t, i) => ({
      label: `${i + 1}. állítás`,
      count: counts[i],
      win: room.lieRevealed && i === Number(active.lieIndex)
    })));

    html += `<div class="statements">${statementCards(stmts, {
      lieIndex: room.lieRevealed ? Number(active.lieIndex) : null,
      counts: room.lieRevealed ? null : counts
    })}</div>`;

    if (!room.lieRevealed) html += `<p class="notice wait">Várunk a hosztra a leleplezéshez…</p>`;
  }

  body.innerHTML = html;
  renderHostControls();
}

/** Választható nevek: a már felfedett szerzők kiesnek. */
function candidateList() {
  const revealed = room.revealed || {};
  return submittedPlayers().filter(([id]) => !revealed[id] || id === room.activePlayerId);
}

/* ---------- hoszt vezérlőpanel ---------- */
function renderHostControls() {
  $("host-card").hidden = !isHost;
  if (!isHost) return;

  const gs      = room.gameState;
  const players = room.players || {};
  const voters  = submittedPlayers().filter(([id]) => id !== room.activePlayerId).length;
  let html = "";

  if (gs === "guess_author" || gs === "guess_lie") {
    const votes = (room.votes && room.votes[gs === "guess_author" ? "author" : "lie"]) || {};
    const n = Object.keys(votes).length;
    const pct = voters ? Math.round(n / voters * 100) : 0;
    html += `<div class="vote-progress">
      <span class="vp-text">${n}/${voters} szavazott</span>
      <div class="vp-track"><div class="vp-fill" style="width:${pct}%"></div></div>
    </div>`;
    html += `<button class="btn btn-primary btn-block" data-host="${gs === "guess_author" ? "closeAuthor" : "closeLie"}">
      Szavazás eredménye</button>`;
  }

  if (gs === "reveal_author") {
    if (!room.authorRevealed) {
      html += `<button class="btn btn-primary btn-block" data-host="revealAuthor">Szerző felfedése</button>`;
    } else {
      html += `<p class="host-note">A szerző: <b>${esc((players[room.activePlayerId] || {}).name || "?")}</b></p>`;
      html += `<button class="btn btn-primary btn-block" data-host="toLie">Tovább: hazugság szavazás</button>`;
    }
  }

  if (gs === "reveal_lie") {
    if (!room.lieRevealed) {
      html += `<button class="btn btn-primary btn-block" data-host="revealLie">Hazugság felfedése</button>`;
    } else {
      const last = (room.orderIndex || 0) + 1 >= (room.order || []).length;
      html += `<button class="btn btn-primary btn-block" data-host="next">
        ${last ? "Játék lezárása" : "Következő játékos"}</button>`;
    }
  }

  $("host-body").innerHTML = html;
}

/* ---------- 5. szakasz ---------- */
function renderEnd() {
  const players = room.players || {};
  const scores  = room.scores || {};
  const rows = submittedPlayers()
    .map(([id, p]) => ({ id, name: p.name, pts: scores[id] || 0 }))
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name, "hu"));

  $("final-list").innerHTML = rows.map((r, i) => `
    <li class="${r.id === MY_ID ? "is-me" : ""}">
      <span class="rank">${i + 1}</span>
      <span>${esc(r.name)}${r.id === MY_ID ? " (te)" : ""}</span>
      <span class="pts">${r.pts} pont</span>
    </li>`).join("");

  $("end-host").hidden = !isHost;
}

/* =====================================================================
   ESEMÉNYKEZELŐK
   ===================================================================== */

$("btn-create").addEventListener("click", createRoom);
$("btn-join").addEventListener("click", () => joinRoom($("join-code").value));
$("join-code").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom($("join-code").value); });
$("form-submit").addEventListener("submit", submitStory);
$("btn-start-game").addEventListener("click", startGame);
$("btn-new-game").addEventListener("click", newGame);

$("btn-leave").addEventListener("click", () => {
  if (confirm("Biztosan kilépsz a szobából? (Az adataid megmaradnak, később visszatérhetsz a kóddal.)"))
    leaveRoom();
});

/* ---------- QR-kód a kezdőoldalhoz ---------- */

/** A játék kezdőoldalának címe (kérdőjel és # nélkül). */
function gameUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

let qrLoaded = false;
async function openQr() {
  const modal  = $("qr-modal");
  const holder = $("qr-holder");
  const url    = gameUrl();

  $("qr-url").textContent = url;
  modal.hidden = false;

  if (qrLoaded) return;                      // egyszer elég kirajzolni
  holder.textContent = "Betöltés…";
  try {
    const { default: qrcode } =
      await import("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm");
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    holder.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 1, scalable: true });
    qrLoaded = true;
  } catch (e) {
    console.error(e);
    holder.textContent = "A QR-kódot nem sikerült elkészíteni. A link alatta így is használható.";
  }
}

$("btn-qr").addEventListener("click", openQr);
$("qr-close").addEventListener("click", () => { $("qr-modal").hidden = true; });
$("qr-modal").addEventListener("click", (e) => {
  if (e.target.id === "qr-modal") $("qr-modal").hidden = true;   // háttérre kattintva zár
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("qr-modal").hidden = true;
});

/* ---------- rejtett admin: teljes adatbázis törlése ---------- */

function toggleAdminPanel(show) {
  const panel = $("admin-panel");
  const open = (show === undefined) ? panel.hidden : show;
  panel.hidden = !open;
  $("admin-error").hidden = true;
  $("admin-code").value = "";
  if (open) $("admin-code").focus();
}

async function wipeDatabase() {
  const err = $("admin-error");
  err.hidden = true;

  if ($("admin-code").value !== ADMIN_CODE) {
    err.textContent = "Hibás kód.";
    err.hidden = false;
    $("admin-code").value = "";
    $("admin-code").focus();
    return;
  }

  if (!confirm("Biztosan törlöd az ÖSSZES szobát? Ez nem vonható vissza!")) return;

  $("admin-go").disabled = true;
  try {
    await set(ref(db, "rooms"), null);   // az egész "rooms" ág törlése
    leaveRoom(true);
    toggleAdminPanel(false);
    toast("Az adatbázis kiürítve.");
  } catch (e) {
    err.textContent = errText(e);
    err.hidden = false;
  } finally {
    $("admin-go").disabled = false;
  }
}

$("secret-trigger").addEventListener("click", () => toggleAdminPanel());
$("admin-go").addEventListener("click", wipeDatabase);
$("admin-cancel").addEventListener("click", () => toggleAdminPanel(false));
$("admin-code").addEventListener("keydown", e => { if (e.key === "Enter") wipeDatabase(); });

// szobakód másolása
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".code-chip");
  if (chip && roomCode) {
    navigator.clipboard?.writeText(roomCode)
      .then(() => toast("Szobakód másolva: " + roomCode))
      .catch(() => toast("Szobakód: " + roomCode));
  }
});

// szavazás + hoszt gombok (eseménydelegálás, mert a HTML dinamikus)
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-vote-author]");
  if (a) return voteAuthor(a.dataset.voteAuthor);

  const l = e.target.closest("[data-vote-lie]");
  if (l) return voteLie(l.dataset.voteLie);

  const h = e.target.closest("[data-host]");
  if (h && isHost) {
    const fn = {
      closeAuthor:  closeAuthorVoting,
      revealAuthor: revealAuthor,
      toLie:        goToLieVoting,
      closeLie:     closeLieVoting,
      revealLie:    revealLie,
      next:         nextPlayer
    }[h.dataset.host];
    if (fn) { h.disabled = true; Promise.resolve(fn()).catch(err => toast(errText(err))); }
  }
});

/* =====================================================================
   INDULÁS – oldalfrissítés utáni visszacsatlakozás
   ===================================================================== */

(async function boot() {
  updateTopbar();
  showScreen("screen-landing");

  const saved = localStorage.getItem(LS_ROOM);
  if (!saved) return;
  try {
    const snap = await get(ref(db, `rooms/${saved}`));
    if (snap.exists()) {
      enterRoom(saved);
      toast("Visszacsatlakoztál: " + saved);
    } else {
      localStorage.removeItem(LS_ROOM);
    }
  } catch (e) {
    console.warn("Automatikus visszacsatlakozás sikertelen:", e);
    localStorage.removeItem(LS_ROOM);
  }
})();
