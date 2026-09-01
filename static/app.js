// static/app.js - Chess Trainer LOCAL (sin Firebase, sin servidores)

let board = null;
let game  = null;
let ws    = null;
let mpLiveGame = null;
let lobbyMembers = [];

let gm_hits = 0, module_hits = 0, misses = 0;
let enginePanelTimer = null;

function updateLocalCounters() {
  const gmEl     = document.getElementById('gm-count');
  const engineEl = document.getElementById('engine-count');
  const missEl   = document.getElementById('misses-count');
  if (gmEl)     gmEl.textContent     = gm_hits;
  if (engineEl) engineEl.textContent = module_hits;
  if (missEl)   missEl.textContent   = misses;
}

function resetLocalCounters() {
  gm_hits = 0;
  module_hits = 0;
  misses = 0;
  updateLocalCounters();
}

function maybeCountLocalFeedback(text) {
  const normalized = text.toLowerCase();
  console.log('[CONTADOR]', 'text:', text, 'normalized:', normalized);
  if (normalized.includes('perfecto') || normalized.includes('acertado con gm')) {
    gm_hits += 1;
    console.log('[CONTADOR] GM HIT:', gm_hits);
  } else if (normalized.includes('mejor del módulo') || normalized.includes('casi perfecta') || normalized.includes('muy cercana') || normalized.includes('aceptable')) {
    module_hits += 1;
    console.log('[CONTADOR] ENGINE HIT:', module_hits);
  } else if (normalized.includes('demasiado inferior') || normalized.includes('fallaste')) {
    misses += 1;
    console.log('[CONTADOR] MISS:', misses);
  } else {
    console.log('[CONTADOR] NO MATCH');
    return;
  }
  updateLocalCounters();
}

// ── Navegación del tablero ────────────────────────────────────
let fenHistory    = [];   // local: FENs en orden
let viewIndex     = -1;
let feedbackTimer = null;

// ── helpers ─────────────────────────────────────────────────
function show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function ensureLobbyMembersPanel() {
  let panel = document.getElementById('lobby-members-panel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'lobby-members-panel';
  panel.className = 'game-info-card lobby-members-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="gi-meta">
      <div class="gi-opening">Lobby privado</div>
      <div class="gi-tags" id="lobby-members-count">0 unidos</div>
    </div>
    <div class="lobby-members-list" id="lobby-members-list"></div>
  `;

  const target = document.querySelector('#multiplayer-ui .info-column') || document.querySelector('.info-column') || document.body;
  target.appendChild(panel);
  return panel;
}

function renderLobbyMembers(names) {
  lobbyMembers = Array.isArray(names) ? names : [];
  const panel = ensureLobbyMembersPanel();
  const countEl = document.getElementById('lobby-members-count');
  const listEl = document.getElementById('lobby-members-list');
  if (countEl) countEl.textContent = `${lobbyMembers.length} unidos`;
  if (listEl) {
    listEl.innerHTML = lobbyMembers.length
      ? lobbyMembers.map(name => `<div class="lobby-member-item">${name}</div>`).join('')
      : '<div class="lobby-member-empty">Aún no se ha unido nadie</div>';
  }
  panel.style.display = 'block';
}

function parseUciMove(uci) {
  const from = uci.slice(0, 2);
  const to   = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

function syncMpLiveGameFromFen(fen) {
  if (!mpLiveGame) mpLiveGame = new Chess();
  try {
    if (fen === 'start') mpLiveGame.reset();
    else mpLiveGame.load(fen);
  } catch {}
}

function applyMpLiveMove(uci) {
  if (!mpLiveGame) mpLiveGame = new Chess();
  let moveFen = null;
  try {
    const move = parseUciMove(uci);
    mpLiveGame.move(move);
    moveFen = mpLiveGame.fen();
  } catch {
    return null;
  }

  if (mpIsPrivate) {
    mpFenHistory.push(moveFen);
  }

  if (mpIsReviewing()) {
    mpUpdateNavBar();
    return moveFen;
  }

  try {
    game.load(moveFen);
    board.position(moveFen, false);
    if (board?.resize) board.resize();
  } catch {}

  if (mpIsPrivate) {
    mpViewIndex = -1;
    mpUpdateNavBar();
  }

  return moveFen;
}

// ── Inicio automático ────────────────────────────────────────
function bootLocalApp() {
  // Ocultar TODO menos local-ui
  hide('auth-screen');
  hide('menu');
  hide('multiplayer-ui');
  hide('lobby-selector');
  hide('user-info');
  
  // Iniciar directamente en modo local
  startLocalGame();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLocalApp);
} else {
  bootLocalApp();
}

function startLocalGame() {
  show('local-ui');
  initLocalMode();
}

window.startLocalGame = startLocalGame;
window.initLocalMode = initLocalMode;
window.onDropLocal = onDropLocal;

// ── Mode selection ────────────────────────────────────────────

function startMode(mode) {
  clearAllFeedback();
  currentMode = mode;
  hide('menu'); hide('local-ui'); hide('multiplayer-ui'); hide('lobby-selector');

  if (mode === 'local') {
    show('local-ui');
    initLocalMode();
  } else if (mode === 'multiplayer_general') {
    currentMode = 'multiplayer';
    show('multiplayer-ui');
    initMultiplayer(null);  // lobby "default"
  } else if (mode === 'multiplayer_private') {
    show('lobby-selector');
  } else {
    alert("Modo no implementado aún");
    show('menu');
  }
}

// ── WebSocket Robusto: reconexión automática y heartbeat ─────
let wsReconnectAttempts = 0;
let wsReconnectMaxAttempts = 15;
let wsReconnectDelay = 1000; // ms
let wsHeartbeatInterval = null;
let wsReconnectTimer = null;
let wsMode = null;  // 'local' o 'multiplayer'
let wsModeParams = {};  // params para reconectar

function wsConnect(mode = 'local', params = {}) {
  wsMode = mode;
  wsModeParams = params;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  let url = `${protocol}://${location.host}/ws`;
  
  if (mode === 'multiplayer') {
    const uid = params.uid || '';
    const lobbyId = params.lobbyId || '';
    url += `?mode=multiplayer&uid=${encodeURIComponent(uid)}`;
    if (lobbyId) url += `&lobby_id=${encodeURIComponent(lobbyId)}`;
  }
  
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.error("[WS] Error creando WebSocket:", e);
    return;
  }

  ws.onopen = () => {
    wsReconnectAttempts = 0;
    console.log("[WS] Conectado");
    const statusMode = mode === 'local' ? 'local' : 'mp';
    setStatus("✓ Conectado", statusMode);
    wsStartHeartbeat();
    if (mode === 'multiplayer' && params.displayName) {
      wsSend(JSON.stringify({ type: "user_info", displayName: params.displayName }));
    }
  };

  ws.onclose = () => {
    console.log("[WS] Desconectado");
    wsStopHeartbeat();
    wsScheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error("[WS] Error:", err);
    wsStopHeartbeat();
  };

  ws.onmessage = wsHandleMessage;
}

function wsStopHeartbeat() {
  if (wsHeartbeatInterval) {
    clearInterval(wsHeartbeatInterval);
    wsHeartbeatInterval = null;
  }
}

function wsStartHeartbeat() {
  wsStopHeartbeat();
  // Enviar ping cada 30 segundos
  wsHeartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('ping');
    }
  }, 30000);
}

function wsScheduleReconnect() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  
  if (wsReconnectAttempts >= wsReconnectMaxAttempts) {
    const statusMode = wsMode === 'local' ? 'local' : 'mp';
    setStatus("❌ Conexión perdida (recarga la página)", statusMode);
    return;
  }
  
  wsReconnectAttempts++;
  const delay = Math.min(wsReconnectDelay * Math.pow(1.5, wsReconnectAttempts - 1), 30000);
  const statusMode = wsMode === 'local' ? 'local' : 'mp';
  const remainingSecs = Math.round(delay / 1000);
  
  console.log(`[WS] Reconectando en ${remainingSecs}s (intento ${wsReconnectAttempts}/${wsReconnectMaxAttempts})`);
  setStatus(`⟳ Reconectando en ${remainingSecs}s...`, statusMode);
  
  wsReconnectTimer = setTimeout(() => {
    console.log(`[WS] Intentando reconectar...`);
    wsConnect(wsMode, wsModeParams);
  }, delay);
}

function wsSend(msg) {
  if (!ws) return;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else if (ws.readyState === WebSocket.CONNECTING) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (ws.readyState === WebSocket.OPEN) {
        clearInterval(timer);
        ws.send(msg);
      } else if (ws.readyState !== WebSocket.CONNECTING || attempts >= 63) {
        clearInterval(timer);
        console.warn("[WS] Mensaje descartado:", msg.substring(0, 60));
      }
    }, 80);
  }
}

// Handler centralizado para mensajes del WebSocket
function wsHandleMessage({ data: msg }) {
  // Ignorar pong
  if (msg === 'pong') return;
  
  if (wsMode === 'local') {
    wsHandleLocalMessage(msg);
  } else if (wsMode === 'multiplayer') {
    wsHandleMultiplayerMessage(msg);
  }
}

// ── Local mode ────────────────────────────────────────────────

function initLocalMode() {
  game  = new Chess();
  board = Chessboard('board-local', {
    draggable: true,
    position: 'start',
    onDrop: onDropLocal,
    pieceTheme: 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png'
  });
  window.board = board;
  window.game = game;
  _bindTapMoveLocal();

  mpLiveGame = new Chess();

  // Usar el nuevo sistema robusto de WebSocket
  wsConnect('local');

  // Resetear el textarea por si quedó algo de una sesión anterior
  const ta = document.getElementById('pgn-textarea');
  if (ta) {
    ta.value = '';
    // Ctrl+Enter para analizar sin hacer clic
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        loadPgnFromTextarea();
      }
    };
  }
  const panel = document.getElementById('pgn-paste-panel');
  if (panel) panel.style.display = 'none';
  const btn = document.getElementById('btn-pgn-toggle');
  if (btn) btn.classList.remove('active');

  // Teclas de cursor para navegar el historial
  // Solo actúa cuando el modo local está visible y el foco no está en un input
  if (!window._localKeyHandler) {
    window._localKeyHandler = (e) => {
      if (!document.getElementById('local-ui') ||
           document.getElementById('local-ui').style.display === 'none') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navNext(); }
      if (e.key === 'ArrowUp' || e.key === 'Home') { e.preventDefault(); navFirst(); }
      if (e.key === 'ArrowDown' || e.key === 'End') { e.preventDefault(); navLast(); }
    };
    document.addEventListener('keydown', window._localKeyHandler);
  }
}

// Handler para mensajes del modo local
function wsHandleLocalMessage(msg) {
  if (msg.startsWith("fen:")) {
    const fen = msg.substring(4).trim();
    if (fen === 'start') {
      // Sin partida — tablero en posición inicial, bloqueado
      board.start(false);
      game.reset();
      syncMpLiveGameFromFen('start');
      setBoardLocked(true);
      return;
    }
    game.load(fen); board.position(fen, false);
    syncMpLiveGameFromFen(fen);
    setBoardLocked(false);
    fenHistory.push(fen);
    viewIndex = -1;
    updateNavBar();
  }
  else if (msg === "local_no_pgn:1") {
    // Abrir el panel de PGN automáticamente e invitar al usuario
    setBoardLocked(true);
    setStatus("📋 Pega un PGN para empezar", "local");
    // Abrir panel si no está ya abierto
    const panel = document.getElementById('pgn-paste-panel');
    if (panel && panel.style.display === 'none') togglePgnPanel();
  }
  else if (msg.startsWith("score:")) {
    const v = msg.substring(6).trim();
    document.getElementById("score-local").textContent = `${v} pts`;
  }
  else if (msg.startsWith("turno:")) {
    setStatus(msg.substring(6), "local");
  }
  else if (msg.startsWith("feedback:")) {
    const parts    = msg.substring(9).split('|');
    const type     = (parts[0] || 'info').trim();
    const text     = (parts[1] || '').trim();
    const points   = (parts[parts.length - 1] || '0').trim();
    const top3_str = parts.slice(2, parts.length - 1).join('|').trim();

    if (text.includes("lista") || text.includes("analizado") || (text.includes("PGN") && text.includes("cargado"))) {
      setBoardLocked(false);
      hideAnalysisProgress('local');
    }

    renderFeedbackLocal(type, text, points, top3_str);
    maybeCountLocalFeedback(text);
    if (top3_str) showEnginePanel(top3_str);
  }
  else if (msg.startsWith("game_progress:")) {
    const parts   = msg.substring(14).split('|');
    const current = parseInt(parts[0]) || 0;
    const total   = parseInt(parts[1]) || 0;
    updateGameProgress('local', current, total);
    updateOpeningHighlight(current);
  }
  else if (msg.startsWith("gameover:")) {
    hideEnginePanel(); hideBgEval(); updateNavBar();
    try {
      const summary = JSON.parse(msg.substring(9));
      showSummaryModal(summary);
    } catch {
      setStatus(msg.substring(9), "local");
    }
  }
  else if (msg.startsWith("bg_eval:")) {
    const parts  = msg.substring(8).split('|');
    const state  = parts[0];
    const uci    = parts[1] || '';
    const score  = parts[2] || '';
    if (state === 'analyzing') showBgEval(uci, null);
    else if (state === 'result') showBgEval(uci, score);
  }
  else if (msg.startsWith("analysis_progress:")) {
    const parts   = msg.substring(18).split('|');
    const current = parseInt(parts[0]) || 0;
    const total   = parseInt(parts[1]) || null;
    updateAnalysisProgress('local', current, total);
  }
  else if (msg.startsWith("pgn_info:")) {
    // El servidor envía los headers del PGN al conectar o al cargar uno nuevo
    renderGameInfo(msg.substring(9));
  }
  else if (msg.startsWith("opening_pieces:")) {
    try {
      const payload = JSON.parse(msg.substring(15));
      // structured payload: { white: [{piece,from,san},...], black: [...] }
      window.openingPiecesData = payload;
      // only update highlight (do not display the textual list)
      const cur = window.currentGameProgress || 0;
      updateOpeningHighlight(cur);
    } catch (e) { /* ignore */ }
  }
}

function onDropLocal(source, target) {
  if (boardLocked || isReviewing()) return "snapback";
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (!move) return "snapback";
  ws.send(`move:${source}${target}`);
  game.undo();
  return "snapback";
}

/** Renders the feedback card in local mode. Dura 15 s, cierra al clic. */
function renderFeedbackLocal(type, text, points, top3_str) {
  const fb = document.getElementById("main-feedback-local");
  if (!fb) return;

  // Cancelar timer anterior si lo hay
  if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }

  const DURATION = 15000; // 15 segundos

  let emoji = '', cssClass = 'fb-info';

  if (text.includes("PERFECTO") && text.includes("módulo")) {
    emoji = '🏆'; cssClass = 'fb-success';
  } else if (text.includes("ACERTADO con GM")) {
    emoji = '🎯'; cssClass = 'fb-warn';
  } else if (text.includes("Mejor del módulo") && text.includes("Stockfish")) {
    emoji = '⚡'; cssClass = 'fb-success';
  } else if (text.includes("Casi perfecta") || text.includes("Muy cercana")) {
    emoji = '✅'; cssClass = 'fb-warn';
  } else if (text.includes("Aceptable")) {
    emoji = '👍'; cssClass = 'fb-info';
  } else if (text.includes("demasiado inferior")) {
    emoji = '⚠️'; cssClass = 'fb-fail';
  } else if (text.includes("Fallaste")) {
    emoji = '❌'; cssClass = 'fb-fail';
  } else if (type === 'success') {
    emoji = '🏁'; cssClass = 'fb-success';
  } else {
    emoji = '💡'; cssClass = 'fb-info';
  }

  let html = `<span class="fb-close-hint">clic para cerrar</span>`;
  html    += `<div class="fb-emoji">${emoji}</div>`;
  html    += `<div class="fb-title">${text}</div>`;
  if (points && points !== '0') {
    html += `<div class="fb-points">+${points} pts</div>`;
  }

  // Limpiar animación anterior y reasignar
  fb.style.animation = 'none';
  fb.offsetHeight; // force reflow para reiniciar la animación CSS
  fb.style.animation = '';

  fb.className   = `feedback-card ${cssClass}`;
  fb.style.setProperty('--fb-duration', `${DURATION}ms`);
  fb.innerHTML   = html;
  fb.style.display = 'block';
  fb.style.opacity = '1';
  fb.style.transition = '';

  // Cerrar al hacer clic
  fb.onclick = () => dismissFeedback();

  // Auto-cerrar a los 15 s
  feedbackTimer = setTimeout(() => dismissFeedback(), DURATION);
}

function dismissFeedback() {
  if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
  const fb = document.getElementById("main-feedback-local");
  if (!fb || fb.style.display === 'none') return;
  fb.style.transition = 'opacity 0.5s';
  fb.style.opacity    = '0';
  setTimeout(() => {
    fb.style.display = 'none';
    fb.innerHTML     = '';
    fb.style.transition = '';
    fb.onclick = null;
  }, 520);
}

// ── Engine panel ──────────────────────────────────────────────

function showEnginePanel(top3_str) {
  if (enginePanelTimer) { clearTimeout(enginePanelTimer); enginePanelTimer = null; }

  const moves = top3_str.split('|').map(s => s.trim()).filter(Boolean);
  const ids   = ['eng-move-1', 'eng-move-2', 'eng-move-3'];

  ids.forEach((id, i) => {
    const card = document.getElementById(id);
    if (!card) return;
    const mv = moves[i];
    if (!mv) { card.innerHTML = `<span class="eng-rank">#${i+1}</span><span class="eng-move">—</span>`; return; }

    // mv: "Cf3 (+0.35)"  →  san = "Cf3",  score = "+0.35"
    const spaceIdx  = mv.lastIndexOf(' ');
    const san       = spaceIdx > -1 ? mv.slice(0, spaceIdx).trim() : mv;
    const scorePart = spaceIdx > -1 ? mv.slice(spaceIdx + 1) : '';
    const scoreDisp = scorePart.replace(/[()]/g, '');
    const scoreNum  = parseFloat(scoreDisp);
    const scoreColor = isNaN(scoreNum) ? 'var(--cream-dim)' : (scoreNum >= 0 ? 'var(--success)' : 'var(--fail)');

    card.innerHTML = `
      <span class="eng-rank">#${i+1}</span>
      <span class="eng-move">${san}</span>
      <span class="eng-score" style="color:${scoreColor};">${scoreDisp}</span>
    `;
  });

  const panel = document.getElementById("engine-panel-local");
  if (panel) panel.classList.add('active');

  enginePanelTimer = setTimeout(() => hideEnginePanel(), 10000);
}

function hideEnginePanel() {
  if (enginePanelTimer) { clearTimeout(enginePanelTimer); enginePanelTimer = null; }
  clearEngineHighlight();
  ['eng-move-1','eng-move-2','eng-move-3'].forEach((id, i) => {
    const card = document.getElementById(id);
    if (card) {
      card.innerHTML = `<span class="eng-rank">#${i+1}</span><span class="eng-move">—</span>`;
      card.onmouseenter = null; card.onmouseleave = null;
    }
  });
  const panel = document.getElementById("engine-panel-local");
  if (panel) panel.classList.remove('active');
}

/**
 * Bloquea o desbloquea el tablero local.
 * Cuando está bloqueado, onDropLocal devuelve snapback sin enviar nada.
 */
let boardLocked = false;
function setBoardLocked(locked) {
  boardLocked = locked;
  const wrapper = document.getElementById("board-wrapper-local");
  if (wrapper) wrapper.style.opacity = locked ? "0.45" : "1";
  const hint = document.getElementById("status-local");
  if (!locked && hint && hint.textContent.includes("Stockfish")) hint.textContent = "";
}

function isTouchDevice() {
  return !!(
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  );
}

function _isLikelyMobileUA() {
  const ua = String(navigator.userAgent || navigator.vendor || '').toLowerCase();
  return /(android|iphone|ipad|ipod|mobile|iemobile|opera mini)/.test(ua);
}

function _hasCoarsePointer() {
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function shouldUseTapMove() {
  if (window._forceTapMove === true) return true;
  if (window._hasSeenTouchInteraction) return true;
  if (_isLikelyMobileUA()) return true;
  if (_hasCoarsePointer()) return true;
  if (isTouchDevice() && !(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return true;
  return false;
}

function _markTouchInteraction() {
  window._hasSeenTouchInteraction = true;
  window._lastInputWasTouchUntil = Date.now() + 1000;
}

function _wasRecentTouchInteraction() {
  return Date.now() < (window._lastInputWasTouchUntil || 0);
}

function _isSyntheticClickFromTouch(ev) {
  return !!(ev && ev.type === 'click' && _wasRecentTouchInteraction());
}

function _isTouchListEvent(ev) {
  return !!(ev && ev.changedTouches && ev.changedTouches.length > 0);
}

function _forEachChangedTouch(ev, callback) {
  if (!_isTouchListEvent(ev)) return;
  for (let i = 0; i < ev.changedTouches.length; i++) {
    callback(ev.changedTouches[i]);
  }
}

function _eventCameFromTouch(ev) {
  if (!ev) return false;
  if (_isTouchListEvent(ev)) return true;
  if (ev.pointerType === 'touch') return true;
  if (typeof ev.type === 'string' && ev.type.startsWith('touch')) return true;
  return false;
}

function _isTouchLikeEvent(ev) {
  if (_eventCameFromTouch(ev)) return true;
  if (_isSyntheticClickFromTouch(ev)) return true;
  return false;
}

function _getVisibleBoardRoots() {
  const roots = [
    document.getElementById('board-local'),
    document.getElementById('board-mp')
  ].filter(Boolean);

  return roots.filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function _pointInsideRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function _touchIsInsideAnyBoard(touch) {
  if (!touch) return false;
  const roots = _getVisibleBoardRoots();
  for (const boardRoot of roots) {
    const rect = boardRoot.getBoundingClientRect();
    if (_pointInsideRect(touch.clientX, touch.clientY, rect)) return true;
  }
  return false;
}

function _setBoardTouchActive(active) {
  const body = document.body;
  const html = document.documentElement;
  if (!body || !html) return;

  if (active) {
    if (body.classList.contains('board-touch-active')) return;
    window._boardLockScrollY = window.scrollY || window.pageYOffset || 0;
    body.classList.add('board-touch-active');
    html.classList.add('board-touch-active');
    body.style.position = 'fixed';
    body.style.top = `-${window._boardLockScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    return;
  }

  if (!body.classList.contains('board-touch-active')) return;
  body.classList.remove('board-touch-active');
  html.classList.remove('board-touch-active');
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  const y = Number.isFinite(window._boardLockScrollY) ? window._boardLockScrollY : 0;
  window.scrollTo(0, y);
}

function _installGlobalBoardTouchGuard() {
  if (window._boardTouchGuardInstalled) return;
  window._boardTouchGuardInstalled = true;
  window._boardTouchLockIdentifiers = new Set();

  document.addEventListener('touchstart', (ev) => {
    _markTouchInteraction();

    let shouldLock = false;
    _forEachChangedTouch(ev, (t) => {
      if (_touchIsInsideAnyBoard(t)) {
        shouldLock = true;
        window._boardTouchLockIdentifiers.add(t.identifier);
      }
    });

    if (!shouldLock) {
      const target = ev && ev.target;
      if (target && target.closest && target.closest('#board-local, #board-mp')) {
        shouldLock = true;
      }
    }

    if (shouldLock) {
      _setBoardTouchActive(true);
      if (ev.cancelable) ev.preventDefault();
    }
  }, { passive: false, capture: true });

  window._boardTouchDocMove = (ev) => {
    if (!document.body?.classList.contains('board-touch-active')) return;
    _markTouchInteraction();
    if (window._boardTouchLockIdentifiers) {
      _forEachChangedTouch(ev, (t) => {
        if (_touchIsInsideAnyBoard(t)) {
          window._boardTouchLockIdentifiers.add(t.identifier);
        }
      });
    }
    if (ev.cancelable) ev.preventDefault();
  };

  window._boardTouchDocEnd = (ev) => {
    if (window._boardTouchLockIdentifiers) {
      _forEachChangedTouch(ev, (t) => {
        window._boardTouchLockIdentifiers.delete(t.identifier);
      });
    }

    const stillLocked = window._boardTouchLockIdentifiers && window._boardTouchLockIdentifiers.size > 0;
    if (!stillLocked) {
      _setBoardTouchActive(false);
    }
  };

  document.addEventListener('touchmove', window._boardTouchDocMove, { passive: false, capture: true });
  document.addEventListener('touchend', window._boardTouchDocEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', window._boardTouchDocEnd, { passive: true, capture: true });
  window.addEventListener('blur', window._boardTouchDocEnd);
}

function _findSquareElement(boardRoot, square) {
  if (!boardRoot || !square) return null;
  return boardRoot.querySelector(`.square-${square}`) ||
         boardRoot.querySelector(`[data-square="${square}"]`);
}

function _extractSquareFromClassName(className) {
  const text = String(className || '');
  const parts = text.split(/\s+/);
  for (const cls of parts) {
    if (/^square-[a-h][1-8]$/.test(cls)) return cls.slice(7);
  }
  return null;
}

function _extractSquareFromEventTarget(target) {
  let node = target;
  while (node && node !== document) {
    if (node.getAttribute) {
      const dataSquare = node.getAttribute('data-square');
      if (dataSquare && /^[a-h][1-8]$/.test(dataSquare)) return dataSquare;
    }
    const fromClass = _extractSquareFromClassName(node.className);
    if (fromClass) return fromClass;
    if (node.parentElement) {
      node = node.parentElement;
    } else {
      break;
    }
  }
  return null;
}

function _extractSquareFromBoardPoint(boardRoot, clientX, clientY) {
  if (!boardRoot || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

  const rect = boardRoot.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null;

  const fileIndex = Math.max(0, Math.min(7, Math.floor((localX / rect.width) * 8)));
  const rankFromTop = Math.max(0, Math.min(7, Math.floor((localY / rect.height) * 8)));
  const orientation = (board && typeof board.orientation === 'function') ? String(board.orientation()) : 'white';
  const files = 'abcdefgh';

  const file = orientation === 'black' ? 7 - fileIndex : fileIndex;
  const rank = orientation === 'black' ? rankFromTop + 1 : 8 - rankFromTop;
  return `${files[file]}${rank}`;
}

function _resolveSquareFromInteraction(boardRoot, ev) {
  if (!boardRoot || !ev) return null;

  if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) {
    const pointSquare = _extractSquareFromBoardPoint(boardRoot, ev.clientX, ev.clientY);
    if (pointSquare) return pointSquare;
  }

  let touchSquare = null;
  _forEachChangedTouch(ev, (t) => {
    const pointSquare = _extractSquareFromBoardPoint(boardRoot, t.clientX, t.clientY);
    if (pointSquare) {
      touchSquare = pointSquare;
      return;
    }
    if (touchSquare) return;
    const node = document.elementFromPoint(t.clientX, t.clientY);
    const square = _extractSquareFromEventTarget(node);
    if (square) touchSquare = square;
  });
  if (touchSquare) return touchSquare;

  return _extractSquareFromEventTarget(ev.target);
}

function _bindBoardTouchLock(boardRoot, key) {
  if (!boardRoot) return;
  _installGlobalBoardTouchGuard();

  const moveKey = key === 'local' ? '_touchMoveLocal' : '_touchMoveMp';
  const startKey = key === 'local' ? '_touchStartLocal' : '_touchStartMp';
  const endKey = key === 'local' ? '_touchEndLocal' : '_touchEndMp';
  const pointerDownKey = key === 'local' ? '_pointerDownLocal' : '_pointerDownMp';
  const pointerMoveKey = key === 'local' ? '_pointerMoveLocal' : '_pointerMoveMp';
  const dragStartKey = key === 'local' ? '_dragStartLocal' : '_dragStartMp';

  if (window[moveKey]) {
    boardRoot.removeEventListener('touchmove', window[moveKey]);
  }
  if (window[startKey]) {
    boardRoot.removeEventListener('touchstart', window[startKey]);
  }
  if (window[endKey]) {
    boardRoot.removeEventListener('touchend', window[endKey]);
    boardRoot.removeEventListener('touchcancel', window[endKey]);
  }
  if (window[pointerDownKey]) {
    boardRoot.removeEventListener('pointerdown', window[pointerDownKey]);
  }
  if (window[pointerMoveKey]) {
    boardRoot.removeEventListener('pointermove', window[pointerMoveKey]);
  }
  if (window[dragStartKey]) {
    boardRoot.removeEventListener('dragstart', window[dragStartKey], true);
  }

  window[startKey] = (ev) => {
    _markTouchInteraction();
    if (window._boardTouchLockIdentifiers) {
      _forEachChangedTouch(ev, (t) => {
        window._boardTouchLockIdentifiers.add(t.identifier);
      });
    }
    _setBoardTouchActive(true);
  };

  window[moveKey] = (ev) => {
    if (ev.cancelable) ev.preventDefault();
    _setBoardTouchActive(true);
  };

  window[endKey] = (ev) => {
    if (window._boardTouchLockIdentifiers) {
      _forEachChangedTouch(ev, (t) => {
        window._boardTouchLockIdentifiers.delete(t.identifier);
      });
    }
    if (!window._boardTouchLockIdentifiers || window._boardTouchLockIdentifiers.size === 0) {
      _setBoardTouchActive(false);
    }
  };

  window[pointerDownKey] = (ev) => {
    if (ev.pointerType === 'touch') _setBoardTouchActive(true);
  };

  window[pointerMoveKey] = (ev) => {
    if (ev.pointerType === 'touch' && ev.cancelable && document.body?.classList.contains('board-touch-active')) {
      ev.preventDefault();
    }
  };

  window[dragStartKey] = (ev) => {
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  };

  boardRoot.addEventListener('touchstart', window[startKey], { passive: false });
  boardRoot.addEventListener('touchmove', window[moveKey], { passive: false });
  boardRoot.addEventListener('touchend', window[endKey], { passive: true });
  boardRoot.addEventListener('touchcancel', window[endKey], { passive: true });
  boardRoot.addEventListener('pointerdown', window[pointerDownKey], { passive: false });
  boardRoot.addEventListener('pointermove', window[pointerMoveKey], { passive: false });
  boardRoot.addEventListener('dragstart', window[dragStartKey], true);
}

function _clearTapSelection(boardRoot, selectedSquare) {
  if (!boardRoot || !selectedSquare) return;
  const el = _findSquareElement(boardRoot, selectedSquare);
  if (el) el.classList.remove('tap-selected');
}

function _setTapSelection(boardRoot, square) {
  const el = _findSquareElement(boardRoot, square);
  if (el) el.classList.add('tap-selected');
}

function _clearLegalTargets(boardRoot, squares) {
  if (!boardRoot || !Array.isArray(squares)) return;
  for (const square of squares) {
    const el = _findSquareElement(boardRoot, square);
    if (el) el.classList.remove('tap-legal-target');
  }
}

function _showLegalTargets(boardRoot, squares) {
  if (!boardRoot) return [];
  const legalSquares = Array.isArray(squares)
    ? [...new Set(squares.filter(square => /^[a-h][1-8]$/.test(String(square))))]
    : [];
  for (const square of legalSquares) {
    const el = _findSquareElement(boardRoot, square);
    if (el) el.classList.add('tap-legal-target');
  }
  return legalSquares;
}

let _tapSelectedLocal = null;
let _tapSelectedMp = null;
let _tapLegalTargetsLocal = [];
let _tapLegalTargetsMp = [];
let _lastTapTouchLocal = 0;
let _lastTapTouchMp = 0;

function _bindTapMoveLocal() {
  const boardRoot = document.getElementById('board-local');
  if (!boardRoot) return;
  _bindBoardTouchLock(boardRoot, 'local');
  const captureOpts = { capture: true };

  if (window._tapHandlerLocal) {
    boardRoot.removeEventListener('pointerup', window._tapHandlerLocal, captureOpts);
    boardRoot.removeEventListener('touchend', window._tapHandlerLocal, captureOpts);
    boardRoot.removeEventListener('click', window._tapHandlerLocal, captureOpts);
  }

  window._tapHandlerLocal = (ev) => {
    const isPointerTap = ev.type === 'pointerup' || ev.type === 'touchend';
    const isClickFallback = ev.type === 'click' || ev.type === 'dblclick';
    if (!isPointerTap && !isClickFallback) return;
    if (ev.type === 'touchend' || (ev.type === 'pointerup' && ev.pointerType === 'touch')) {
      _lastTapTouchLocal = Date.now();
      if (ev.cancelable) ev.preventDefault();
    } else if (ev.type === 'click' && (Date.now() - _lastTapTouchLocal) < 450) {
      return;
    }

    const localUi = document.getElementById('local-ui');
    if (!localUi || localUi.style.display === 'none') return;
    if (boardLocked || isReviewing() || !game) return;

    const square = _resolveSquareFromInteraction(boardRoot, ev);
    if (!square) return;

    if (!_tapSelectedLocal) {
      const legalFromSquare = game.moves({ square, verbose: true });
      if (!legalFromSquare || legalFromSquare.length === 0) return;
      _tapSelectedLocal = square;
      _tapLegalTargetsLocal = _showLegalTargets(boardRoot, legalFromSquare.map((move) => move.to));
      _setTapSelection(boardRoot, square);
      return;
    }

    if (_tapSelectedLocal === square) {
      return;
    }

    const from = _tapSelectedLocal;
    const move = game.move({ from, to: square, promotion: 'q' });
    _clearTapSelection(boardRoot, _tapSelectedLocal);
    _clearLegalTargets(boardRoot, _tapLegalTargetsLocal);
    _tapLegalTargetsLocal = [];
    _tapSelectedLocal = null;

    if (!move) {
      const legalFromSquare = game.moves({ square, verbose: true });
      if (legalFromSquare && legalFromSquare.length > 0) {
        _tapSelectedLocal = square;
        _tapLegalTargetsLocal = _showLegalTargets(boardRoot, legalFromSquare.map((move) => move.to));
        _setTapSelection(boardRoot, square);
      }
      return;
    }

    game.undo();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(`move:${from}${square}`);
    }
  };

  boardRoot.addEventListener('pointerup', window._tapHandlerLocal, captureOpts);
  boardRoot.addEventListener('touchend', window._tapHandlerLocal, { passive: false, capture: true });
  boardRoot.addEventListener('click', window._tapHandlerLocal, captureOpts);
}

function _bindTapMoveMultiplayer() {
  const boardRoot = document.getElementById('board-mp');
  if (!boardRoot) return;
  _bindBoardTouchLock(boardRoot, 'mp');
  const captureOpts = { capture: true };

  if (window._tapHandlerMp) {
    boardRoot.removeEventListener('pointerup', window._tapHandlerMp, captureOpts);
    boardRoot.removeEventListener('touchend', window._tapHandlerMp, captureOpts);
    boardRoot.removeEventListener('click', window._tapHandlerMp, captureOpts);
  }

  window._tapHandlerMp = (ev) => {
    if (ev.type !== 'click' && !_isTouchLikeEvent(ev)) return;
    if (ev.type === 'touchend' || (ev.type === 'pointerup' && ev.pointerType === 'touch')) {
      _lastTapTouchMp = Date.now();
      if (ev.cancelable) ev.preventDefault();
    } else if (ev.type === 'click' && (Date.now() - _lastTapTouchMp) < 450) {
      return;
    }

    const mpUi = document.getElementById('multiplayer-ui');
    if (!mpUi || mpUi.style.display === 'none') return;
    if (mpIsReviewing() || !game) return;

    const square = _resolveSquareFromInteraction(boardRoot, ev);
    if (!square) return;

    if (!_tapSelectedMp) {
      const legalFromSquare = game.moves({ square, verbose: true });
      if (!legalFromSquare || legalFromSquare.length === 0) return;
      _tapSelectedMp = square;
      _tapLegalTargetsMp = _showLegalTargets(boardRoot, legalFromSquare.map((move) => move.to));
      _setTapSelection(boardRoot, square);
      return;
    }

    if (_tapSelectedMp === square) {
      _clearTapSelection(boardRoot, _tapSelectedMp);
      _clearLegalTargets(boardRoot, _tapLegalTargetsMp);
      _tapLegalTargetsMp = [];
      _tapSelectedMp = null;
      return;
    }

    const from = _tapSelectedMp;
    const move = game.move({ from, to: square, promotion: 'q' });
    _clearTapSelection(boardRoot, _tapSelectedMp);
    _clearLegalTargets(boardRoot, _tapLegalTargetsMp);
    _tapLegalTargetsMp = [];
    _tapSelectedMp = null;

    if (!move) {
      const legalFromSquare = game.moves({ square, verbose: true });
      if (legalFromSquare && legalFromSquare.length > 0) {
        _tapSelectedMp = square;
        _tapLegalTargetsMp = _showLegalTargets(boardRoot, legalFromSquare.map((move) => move.to));
        _setTapSelection(boardRoot, square);
      }
      return;
    }

    game.undo();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus("⚠ Conexión cerrada. Vuelve a entrar al lobby.", "mp");
      return;
    }
    ws.send(`move:${from}${square}`);
  };

  boardRoot.addEventListener('pointerup', window._tapHandlerMp, captureOpts);
  boardRoot.addEventListener('touchend', window._tapHandlerMp, { passive: false, capture: true });
  boardRoot.addEventListener('click', window._tapHandlerMp, captureOpts);
}

// ── Navegación del tablero ────────────────────────────────────

function updateNavBar() {
  const total = fenHistory.length;
  const isLive = viewIndex === -1;
  const idx    = isLive ? total - 1 : viewIndex;

  const navBar  = document.getElementById('nav-bar');
  const posEl   = document.getElementById('nav-pos');
  const btnFirst = document.getElementById('nav-first');
  const btnPrev  = document.getElementById('nav-prev');
  const btnNext  = document.getElementById('nav-next');
  const btnLast  = document.getElementById('nav-last');

  if (!navBar) return;

  // Posición textual
  if (total === 0) {
    if (posEl) posEl.textContent = '—';
  } else {
    if (posEl) posEl.textContent = `${idx + 1} / ${total}`;
  }

  // Activar/desactivar botones
  const atStart = idx <= 0;
  const atEnd   = idx >= total - 1;
  if (btnFirst) btnFirst.disabled = atStart;
  if (btnPrev)  btnPrev.disabled  = atStart;
  if (btnNext)  btnNext.disabled  = atEnd;
  if (btnLast)  btnLast.disabled  = isLive; // desactivado cuando ya estamos en vivo

  // Modo revisión: borde dorado en tablero
  navBar.classList.toggle('reviewing', !isLive);
  const wrapper = document.getElementById('board-wrapper-local');
  if (wrapper) wrapper.classList.toggle('reviewing', !isLive);

  // Texto del botón en vivo
  if (btnLast) btnLast.textContent = isLive ? '⏭ En vivo' : '⏭ Volver al juego';
}

function navFirst() {
  if (fenHistory.length === 0) return;
  viewIndex = 0;
  _showHistoryFen();
}

function navPrev() {
  const current = viewIndex === -1 ? fenHistory.length - 1 : viewIndex;
  if (current <= 0) return;
  viewIndex = current - 1;
  _showHistoryFen();
}

function navNext() {
  const current = viewIndex === -1 ? fenHistory.length - 1 : viewIndex;
  if (current >= fenHistory.length - 1) {
    navLast(); return;
  }
  viewIndex = current + 1;
  if (viewIndex === fenHistory.length - 1) { navLast(); return; }
  _showHistoryFen();
}

function navLast() {
  viewIndex = -1;
  if (fenHistory.length > 0) {
    const fen = fenHistory[fenHistory.length - 1];
    game.load(fen); board.position(fen, false);
  }
  updateNavBar();
}

function _showHistoryFen() {
  const fen = fenHistory[viewIndex];
  if (!fen) return;
  game.load(fen);
  board.position(fen, false);
  updateNavBar();
}

/** Devuelve true si estamos revisando el historial (no en vivo) */
function isReviewing() {
  return viewIndex !== -1;
}

function highlightEngineMove(from, to) {
  let style = document.getElementById('engine-sq-style');
  if (!style) { style = document.createElement('style'); style.id = 'engine-sq-style'; document.head.appendChild(style); }
  style.textContent = `
    #board-local [data-square="${from}"] { background: rgba(201,168,76,0.55) !important; }
    #board-local [data-square="${to}"]   { background: rgba(201,168,76,0.85) !important; }
  `;
}
function clearEngineHighlight() {
  const s = document.getElementById('engine-sq-style');
  if (s) s.textContent = '';
}

// ── Banner de evaluación en background ───────────────────────
// Aparece debajo del tablero cuando la jugada estaba fuera del top3.
// Primero muestra "Analizando..." y luego el score real.

let bgEvalTimer = null;

function showBgEval(san, score) {
  if (bgEvalTimer) { clearTimeout(bgEvalTimer); bgEvalTimer = null; }

  let banner = document.getElementById('bg-eval-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bg-eval-banner';
    banner.className = 'bg-eval-banner';
    const panel = document.getElementById('engine-panel-local');
    if (panel && panel.parentNode) {
      panel.parentNode.insertBefore(banner, panel.nextSibling);
    } else {
      document.getElementById('info-column')?.appendChild(banner);
    }
  }

  if (score === null) {
    banner.innerHTML = `
      <span class="bge-spinner"></span>
      <span class="bge-label">Analizando tu jugada <strong>${san}</strong> con Stockfish…</span>
    `;
    banner.classList.remove('bge-done');
    banner.style.opacity = '1';
  } else {
    const num        = parseFloat(score);
    const scoreColor = isNaN(num) ? 'var(--cream-dim)' : (num >= 0 ? 'var(--success)' : 'var(--fail)');
    const label      = isNaN(num) ? 'sin datos' : score;

    banner.innerHTML = `
      <span class="bge-icon">⚙</span>
      <span class="bge-label">
        Tu jugada <strong>${san}</strong>:
        <span style="color:${scoreColor}; font-weight:600;">${label}</span>
        según Stockfish
      </span>
    `;
    banner.classList.add('bge-done');
    banner.style.opacity = '1';
    bgEvalTimer = setTimeout(() => hideBgEval(), 12000);
  }
}

function hideBgEval() {
  if (bgEvalTimer) { clearTimeout(bgEvalTimer); bgEvalTimer = null; }
  const banner = document.getElementById('bg-eval-banner');
  if (banner) {
    banner.style.opacity = '0';
    setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 600);
  }
}

// ── Lobby privado ─────────────────────────────────────────────

function createPrivateLobby() {
  fetch('/create_lobby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: currentUser.uid, turn_seconds: 10 })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { alert('Error: ' + data.error); return; }
    hide('lobby-selector');
    currentMode = 'multiplayer';
    show('multiplayer-ui');
    initMultiplayer(data.lobby_id);
  })
  .catch(() => alert('Error al crear el lobby'));
}

function joinPrivateLobby() {
  const input = document.getElementById('join-code-input');
  const code  = input?.value.trim().toUpperCase();
  const errEl = document.getElementById('join-code-error');

  if (errEl) errEl.textContent = '';

  if (!code || code.length < 4) {
    if (errEl) errEl.textContent = 'Introduce el código del lobby';
    else alert('Introduce el código del lobby');
    return;
  }

  // Deshabilitar el botón mientras comprobamos
  const btn = document.querySelector('[onclick="joinPrivateLobby()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Comprobando…'; }

  fetch(`/lobby/${code}/exists`)
    .then(r => r.json())
    .then(data => {
      if (!data.exists) {
        if (errEl) errEl.textContent = 'Este lobby no existe o ya fue cerrado';
        if (input) input.focus();
      } else {
        hide('lobby-selector');
        currentMode = 'multiplayer';
        show('multiplayer-ui');
        initMultiplayer(code);
      }
    })
    .catch(() => {
      if (errEl) errEl.textContent = 'Error de conexión. Inténtalo de nuevo';
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = 'Unirse al lobby'; }
    });
}

function copyLobbyCode() {
  const code = document.getElementById('lobby-id-display')?.textContent;
  if (!code || code === '—') return;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('btn-copy-lobby');
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1500); }
  });
}

function ownerLoadPgn() {
  const ta = document.getElementById('mp-pgn-textarea');
  if (!ta) return;
  const pgnText = ta.value.trim();
  if (!pgnText) { ta.focus(); return; }
  if (!pgnText.includes('1.') && !pgnText.includes('1. ')) {
    setStatus('⚠ PGN no válido', 'mp'); return;
  }
  const depth = document.getElementById('depth-slider-mp')?.value || 16;
  renderGameInfoFromPgn(pgnText);
  setStatus(`⚙ Analizando partida (depth ${depth})…`, 'mp');
  showAnalysisProgress('mp');
  wsSend(`load_pgn:depth=${depth}|${pgnText}`);
  ta.value = '';
}

// ── Panel Stockfish modo multijugador ─────────────────────────
// Misma lógica que showEnginePanel pero apunta a los ids mp-eng-move-*

let enginePanelMpTimer = null;

function showEnginePanelMp(top3_str) {
  if (enginePanelMpTimer) { clearTimeout(enginePanelMpTimer); enginePanelMpTimer = null; }

  const moves = top3_str.split('|').map(s => s.trim()).filter(Boolean);
  const ids   = ['mp-eng-move-1', 'mp-eng-move-2', 'mp-eng-move-3'];

  ids.forEach((id, i) => {
    const card = document.getElementById(id);
    if (!card) return;
    const mv = moves[i];
    if (!mv) { card.innerHTML = `<span class="eng-rank">#${i+1}</span><span class="eng-move">—</span>`; return; }

    const spaceIdx  = mv.lastIndexOf(' ');
    const san       = spaceIdx > -1 ? mv.slice(0, spaceIdx).trim() : mv;
    const scorePart = spaceIdx > -1 ? mv.slice(spaceIdx + 1) : '';
    const scoreDisp = scorePart.replace(/[()]/g, '');
    const scoreNum  = parseFloat(scoreDisp);
    const scoreColor = isNaN(scoreNum) ? 'var(--cream-dim)' : (scoreNum >= 0 ? 'var(--success)' : 'var(--fail)');

    card.innerHTML = `
      <span class="eng-rank">#${i+1}</span>
      <span class="eng-move">${san}</span>
      <span class="eng-score" style="color:${scoreColor};">${scoreDisp}</span>
    `;
  });

  const panel = document.getElementById("engine-panel-mp");
  if (panel) panel.classList.add('active');

  enginePanelMpTimer = setTimeout(() => hideEnginePanelMp(), 10000);
}

function hideEnginePanelMp() {
  if (enginePanelMpTimer) { clearTimeout(enginePanelMpTimer); enginePanelMpTimer = null; }
  ['mp-eng-move-1','mp-eng-move-2','mp-eng-move-3'].forEach((id, i) => {
    const card = document.getElementById(id);
    if (card) card.innerHTML = `<span class="eng-rank">#${i+1}</span><span class="eng-move">—</span>`;
  });
  const panel = document.getElementById("engine-panel-mp");
  if (panel) panel.classList.remove('active');
}

/** Renderiza info de partida en el panel del multiplayer */
function renderGameInfoMp(payload) {
  try {
    const h = JSON.parse(payload);
    const $ = id => document.getElementById(id);
    if (!$('mp-gi-white-name')) return;

    $('mp-gi-white-name').textContent = h.White || '—';
    $('mp-gi-black-name').textContent = h.Black || '—';
    $('mp-gi-white-elo').textContent  = h.WhiteElo || '';
    $('mp-gi-black-elo').textContent  = h.BlackElo || '';
    $('mp-gi-white-elo').style.display = h.WhiteElo ? '' : 'none';
    $('mp-gi-black-elo').style.display = h.BlackElo ? '' : 'none';

    const eco     = h.ECO     ? `${h.ECO} · ` : '';
    const opening = h.Opening || h.Variant || '—';
    $('mp-gi-opening').textContent = eco + opening;

    const tags = [];
    if (h.Date && !h.Date.includes('?')) tags.push(h.Date);
    if (h.TimeControl && h.TimeControl !== '-') {
      const tc = formatTimeControl(h.TimeControl);
      if (tc) tags.push(tc);
    }
    if (h.Result) tags.push(h.Result);
    if (h.Event && h.Event !== '?') tags.push(h.Event.substring(0, 30));

    const tagsEl = $('mp-gi-tags');
    if (tagsEl) tagsEl.innerHTML = tags.filter(Boolean)
      .map(t => `<span class="gi-tag">${t}</span>`).join('');
  } catch {
    // si no es JSON válido, ignorar
  }
}

function ownerStart()       { wsSend("owner_start"); }
function ownerAdvance()     { wsSend("owner_advance"); }
function ownerPauseResume() {
  const btn = document.getElementById("btn-owner-pause");
  const paused = btn?.classList.contains('paused');
  wsSend(paused ? "owner_resume" : "owner_pause");
}

function ownerSetTime() {
  const secs = document.getElementById("time-slider-mp")?.value || 10;
  wsSend(`set_time:${secs}`);
}

function ownerShowLoadPgn() {
  const panel = document.getElementById("owner-pgn-panel");
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function ownerDeleteLobby() {
  if (!currentLobbyId || !currentUser) return;
  if (!confirm("¿Cerrar el lobby? Todos los jugadores serán expulsados.")) return;
  fetch(`/lobby/${currentLobbyId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: currentUser.uid })
  }).then(() => leaveMultiplayer()).catch(() => leaveMultiplayer());
}

// ── Navegación tablero multiplayer (lobby privado) ───────────

function mpIsReviewing() { return mpViewIndex !== -1; }

function mpUpdateNavBar() {
  const total  = mpFenHistory.length;
  const isLive = mpViewIndex === -1;
  const idx    = isLive ? total - 1 : mpViewIndex;

  const posEl    = document.getElementById('mp-nav-pos');
  const btnFirst = document.getElementById('mp-nav-first');
  const btnPrev  = document.getElementById('mp-nav-prev');
  const btnNext  = document.getElementById('mp-nav-next');
  const btnLast  = document.getElementById('mp-nav-last');
  const navBar   = document.getElementById('nav-bar-mp');
  const wrapper  = document.getElementById('board-wrapper-mp');

  if (posEl)  posEl.textContent  = total > 0 ? `${idx + 1} / ${total}` : '—';
  if (btnFirst) btnFirst.disabled = idx <= 0;
  if (btnPrev)  btnPrev.disabled  = idx <= 0;
  if (btnNext)  btnNext.disabled  = idx >= total - 1;
  if (btnLast)  btnLast.disabled  = isLive;
  if (btnLast)  btnLast.textContent = isLive ? '⏭ En vivo' : '⏭ Volver al juego';
  if (navBar)   navBar.classList.toggle('reviewing', !isLive);
  if (wrapper)  wrapper.classList.toggle('reviewing', !isLive);
}

function mpNavFirst() {
  if (!mpFenHistory.length) return;
  mpViewIndex = 0; _mpShowFen();
}
function mpNavPrev() {
  const cur = mpViewIndex === -1 ? mpFenHistory.length - 1 : mpViewIndex;
  if (cur <= 0) return;
  mpViewIndex = cur - 1; _mpShowFen();
}
function mpNavNext() {
  const cur = mpViewIndex === -1 ? mpFenHistory.length - 1 : mpViewIndex;
  if (cur >= mpFenHistory.length - 1) { mpNavLast(); return; }
  mpViewIndex = cur + 1;
  if (mpViewIndex === mpFenHistory.length - 1) { mpNavLast(); return; }
  _mpShowFen();
}
function mpNavLast() {
  mpViewIndex = -1;
  if (mpFenHistory.length) {
    const fen = mpFenHistory[mpFenHistory.length - 1];
    try { game.load(fen); board.position(fen, false); } catch {}
  }
  mpUpdateNavBar();
}
function _mpShowFen() {
  const fen = mpFenHistory[mpViewIndex];
  if (!fen) return;
  try { game.load(fen); board.position(fen, false); } catch {}
  mpUpdateNavBar();
}

// Teclas cursor para lobby privado
function _initMpKeyHandler() {
  if (window._mpKeyHandler) return;
  window._mpKeyHandler = (e) => {
    if (!mpIsPrivate) return;
    const mpUi = document.getElementById('multiplayer-ui');
    if (!mpUi || mpUi.style.display === 'none') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); mpNavPrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); mpNavNext(); }
    if (e.key === 'ArrowUp'   || e.key === 'Home') { e.preventDefault(); mpNavFirst(); }
    if (e.key === 'ArrowDown' || e.key === 'End')  { e.preventDefault(); mpNavLast(); }
  };
  document.addEventListener('keydown', window._mpKeyHandler);
}
function _removeMpKeyHandler() {
  if (window._mpKeyHandler) {
    document.removeEventListener('keydown', window._mpKeyHandler);
    window._mpKeyHandler = null;
  }
}

// ── Resumen grupal (lobby privado) ────────────────────────────

function showGroupSummary(group) {
  const modal = document.getElementById('group-summary-modal');
  const table = document.getElementById('group-summary-table');
  if (!modal || !table) return;

  let html = `<div class="group-table-row header">
    <div>Jugador</div><div>Pts</div><div>GM</div><div>Módulo</div><div>Fallos</div>
  </div>`;

  group.forEach((p, i) => {
    const cls = i === 0 ? ' rank-1' : '';
    const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
    html += `<div class="group-table-row${cls}">
      <div class="gt-name">${medal}${p.name}</div>
      <div class="gt-score">${p.score}</div>
      <div class="gt-gm">${p.gm}</div>
      <div class="gt-eng">${p.engine}</div>
      <div class="gt-miss">${p.misses}</div>
    </div>`;
  });

  table.innerHTML = html;
  modal.style.display = 'flex';
}

function sendChat() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(`chat:${text}`);
  input.value = '';
}

function appendChatMessage(name, text, isSystem) {
  const container = document.getElementById("chat-messages");
  if (!container) return;
  const div = document.createElement("div");
  div.className = isSystem ? "chat-msg system" : "chat-msg";
  if (isSystem) {
    div.innerHTML = `<span class="chat-text">${text}</span>`;
  } else {
    div.innerHTML = `<span class="chat-name">${name}</span><span class="chat-text">${text}</span>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // Máximo 100 mensajes
  while (container.children.length > 100) container.removeChild(container.firstChild);
}

function closeGroupSummary() {
  const modal = document.getElementById('group-summary-modal');
  if (modal) modal.style.display = 'none';
}

// ── Barra de progreso de la partida ──────────────────────────

function updateGameProgress(mode, current, total) {
  const suffix = mode === 'mp' ? '-mp' : '-local';
  const bar    = document.getElementById(`game-progress${suffix}`);
  const fill   = document.getElementById(`gp-fill${suffix}`);
  const label  = document.getElementById(`gp-label${suffix}`);

  if (!bar || !total) return;

  bar.style.display = 'flex';
  const pct = Math.round((current / total) * 100);
  if (fill)  fill.style.width    = pct + '%';
  if (label) label.textContent   = `${current} / ${total}`;
}

function hideGameProgress(mode) {
  const suffix = mode === 'mp' ? '-mp' : '-local';
  const bar = document.getElementById(`game-progress${suffix}`);
  if (bar) bar.style.display = 'none';
}

// ── Modal resumen final ───────────────────────────────────────

function showSummaryModal(summary) {
  const grade      = summary.grade      || '—';
  const score      = summary.score      ?? 0;
  const gmHits     = summary.gm_hits    ?? 0;
  const engHits    = summary.engine_hits?? 0;
  const misses     = summary.misses     ?? 0;
  const pct        = summary.pct        ?? 0;
  const bestMove   = summary.best_move;   // [san, pts] o null

  const gradeEl = document.getElementById('summary-grade');
  if (gradeEl) {
    gradeEl.textContent = grade;
    gradeEl.className   = `summary-grade grade-${grade}`;
  }
  document.getElementById('summary-score').textContent = `${score} pts`;
  const gmEl   = document.getElementById('summary-gm-hits');
  const engEl  = document.getElementById('summary-engine-hits');
  const missEl = document.getElementById('summary-misses');
  const pctEl  = document.getElementById('summary-pct');
  if (gmEl)   gmEl.textContent   = gmHits;
  if (engEl)  engEl.textContent  = engHits;
  if (missEl) missEl.textContent = misses;
  if (pctEl)  pctEl.textContent  = pct + '%';

  const bestEl = document.getElementById('summary-best');
  const moveEl = document.getElementById('sb-move');
  if (bestMove && bestEl && moveEl) {
    moveEl.textContent  = `${bestMove[0]} (+${bestMove[1]} pts)`;
    bestEl.style.display = 'flex';
  } else if (bestEl) {
    bestEl.style.display = 'none';
  }

  const modal = document.getElementById('summary-modal');
  if (modal) modal.style.display = 'flex';
}

function closeSummary() {
  const modal = document.getElementById('summary-modal');
  if (modal) modal.style.display = 'none';
}

// ── Multiplayer mode ──────────────────────────────────────────

function initMultiplayer(lobbyId) {
  _mpCurrentLobbyId = lobbyId || null;
  show('multiplayer-ui');

  if (!board || !document.getElementById('board-mp').children.length) {
    game = new Chess();
    try {
      board = Chessboard('board-mp', {
        draggable: true, position: 'start', onDrop: onDropMulti,
        pieceTheme: 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png'
      });
      if (board?.resize) board.resize();
    } catch (e) {
      console.error("[BOARD ERROR]", e);
      setStatus("❌ Error creando el tablero", "mp"); return;
    }
  }

  _bindTapMoveMultiplayer();

  // Usar el nuevo sistema robusto de WebSocket
  const displayName = document.getElementById("username")?.textContent.trim() || "Jugador";
  wsConnect('multiplayer', {
    uid: currentUser?.uid || 'anonymous',
    lobbyId: lobbyId || null,
    displayName: displayName
  });

  _initMpKeyHandler();
}

// Handler para mensajes del multiplayer
function wsHandleMultiplayerMessage(msg) {
  msg = msg.trim();

    if (msg.startsWith("fen:")) {
      const fen = msg.substring(4).trim();
      if (mpIsReviewing()) {
        // Estamos revisando — actualizar silenciosamente sin mover el tablero
        mpFenHistory.push(fen);
        mpUpdateNavBar();
        hide('lobby-waiting-msg');
        return;
      }
      try { game.load(fen); board.position(fen, false); if (board?.resize) board.resize(); } catch {}
      hide('lobby-waiting-msg');
      if (mpIsPrivate) {
        mpFenHistory.push(fen);
        mpViewIndex = -1;
        mpUpdateNavBar();
      }
    }
    else if (msg.startsWith("turno:"))        { setStatus(msg.substring(6).trim(), "mp"); }
    else if (msg.startsWith("score:"))        {
      const parts = msg.substring(6).trim().split('|');
      const perGame = parts[0] || '0';
      const global  = parts[1] || null;
      document.getElementById("my-score").textContent = perGame;
      const gEl = document.getElementById("my-score-global");
      if (gEl) gEl.textContent = global ? ` (${global})` : '';
    }
    else if (msg.startsWith("ranking:"))      { updateRanking(msg.substring(8).trim()); }
    else if (msg.startsWith("player_count:")){ document.getElementById("player-count").textContent = msg.substring(13).trim(); }
    else if (msg.startsWith("lobby_id:"))    {
      const code = msg.substring(9).trim() || "default";
      const d = document.getElementById("lobby-id-display");
      if (d) d.textContent = code;
      currentLobbyId = code;
    }
    else if (msg.startsWith("lobby_role:"))  {
      const role  = msg.substring(11).trim();
      const panel = document.getElementById("owner-pgn-panel");
      const ctrl  = document.getElementById("owner-controls");
      if (panel) panel.style.display = role === 'owner' ? 'block' : 'none';
      if (ctrl)  ctrl.style.display  = role === 'owner' ? 'block' : 'none';
    }
    else if (msg === "owner_ready:1") {
      // PGN cargado — mostrar botón de inicio al owner, ocultar panel de carga
      const startBtn = document.getElementById("btn-owner-start");
      if (startBtn) startBtn.style.display = '';
      const panel = document.getElementById("owner-pgn-panel");
      if (panel) panel.style.display = 'none';
      hideAnalysisProgress('mp');
    }
    else if (msg === "owner_started:1") {
      // La partida ha comenzado — ocultar mensaje de espera, ocultar botón inicio
      hide('lobby-waiting-msg');
      const startBtn = document.getElementById("btn-owner-start");
      if (startBtn) startBtn.style.display = 'none';
      setStatus("¡La partida ha comenzado!", "mp");
    }
    else if (msg.startsWith("owner_paused:")) {
      const paused   = msg.substring(13).trim() === '1';
      const btn      = document.getElementById("btn-owner-pause");
      const cd       = document.getElementById("countdown");
      if (btn) {
        btn.textContent = paused ? '▶ Reanudar' : '⏸ Pausar';
        btn.classList.toggle('paused', paused);
      }
      if (cd) cd.textContent = paused ? '⏸ Pausado por el admin' : '';
    }
    else if (msg.startsWith("lobby_type:"))  {
      const type = msg.substring(11).trim();
      mpIsPrivate = type === 'private';
      const lbl  = document.getElementById("lobby-type-label");
      const btn  = document.getElementById("btn-copy-lobby");
      const nav  = document.getElementById("nav-bar-mp");
      if (lbl) lbl.textContent = mpIsPrivate ? 'Lobby privado' : 'Lobby general';
      if (btn) btn.style.display = mpIsPrivate ? 'inline' : 'none';
      if (nav) nav.style.display = mpIsPrivate ? 'flex' : 'none';
      const chatPanel = document.getElementById("chat-panel");
      if (chatPanel) chatPanel.style.display = mpIsPrivate ? 'flex' : 'none';
    }
    else if (msg.startsWith("lobby_waiting:")){ 
      const el = document.getElementById("lobby-waiting-msg");
      if (el) { el.textContent = msg.substring(14).trim(); el.style.display = 'block'; }
    }
    else if (msg.startsWith("player_joined:")) {
      const name = msg.substring(14).trim();
      appendChatMessage('', `${name} se ha unido al lobby`, true);
    }
    else if (msg.startsWith("player_left:")) {
      const name = msg.substring(12).trim();
      appendChatMessage('', `${name} ha salido del lobby`, true);
    }
    else if (msg.startsWith("lobby_members:")) {
      try {
        renderLobbyMembers(JSON.parse(msg.substring(14)));
      } catch {
        renderLobbyMembers([]);
      }
    }
    else if (msg.startsWith("gm_move:"))     {
      const san = msg.substring(8).trim();
      const el  = document.getElementById("status-mp");
      if (el) {
        el.textContent = `♟ GM jugó: ${san}`;
        setTimeout(() => { if (el.textContent.includes('GM jugó')) el.textContent = ''; }, 4000);
      }
    }
    else if (msg.startsWith("analysis_progress:")) {
      const parts   = msg.substring(18).split('|');
      const current = parseInt(parts[0]) || 0;
      const total   = parseInt(parts[1]) || null;
      updateAnalysisProgress('mp', current, total);
      // Mostrar barra si no está ya visible
      const bar = document.getElementById('analysis-progress-mp');
      if (bar && bar.style.display === 'none') bar.style.display = 'block';
    }
    else if (msg.startsWith("pgn_info:"))    { renderGameInfoMp(msg.substring(9)); }
    else if (msg.startsWith("next_advance:")) {
      const ts = parseInt(msg.substring(13));
      if (ts === 0) {
        // Pausa — detener countdown
        if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
        const el = document.getElementById("countdown");
        if (el) el.textContent = '';
      } else {
        startCountdown(ts);
      }
    }
    else if (msg.startsWith("top3:"))        {
      const el = document.getElementById("gi-top3") || document.getElementById("top3-moves");
      const s  = msg.substring(5);
      if (el) el.innerHTML = s ? s.split('|').map((x,i) => `${i+1}. ${x.trim()}`).join('<br>') : '—';
    }
    else if (msg.startsWith("feedback:"))    { renderFeedbackMp(msg.substring(9)); }
    else if (msg.startsWith("game_progress:")) {
      const parts   = msg.substring(14).split('|');
      const current = parseInt(parts[0]) || 0;
      const total   = parseInt(parts[1]) || 0;
      updateGameProgress('mp', current, total);
    }
    else if (msg.startsWith("move_applied:")) {
      const payload = msg.substring(13).trim();
      const parts   = payload.split('|');
      const uci     = (parts[0] || '').trim();
      const current = parseInt(parts[1]) || 0;
      const total   = parseInt(parts[2]) || 0;
      if (uci) applyMpLiveMove(uci);
      updateGameProgress('mp', current, total);
    }
    else if (msg.startsWith("gameover:"))    {
      try {
        const summary = JSON.parse(msg.substring(9));
        showSummaryModal(summary);
        setStatus("🏁 Partida completada", "mp");
      } catch {
        setStatus(msg.substring(9).trim(), "mp");
      }
    }
    else if (msg.startsWith("gameover_group:")) {
      try {
        const group = JSON.parse(msg.substring(15));
        showGroupSummary(group);
      } catch {}
    }
    else if (msg === "score_reset:1") {
      document.getElementById("my-score").textContent = "0";
      const gEl = document.getElementById("my-score-global");
      if (gEl) gEl.textContent = gEl.textContent; // keep global, reset display
      setStatus("🔄 Nueva partida — puntuación reiniciada", "mp");
    }
    else if (msg.startsWith("chat:")) {
      const sep  = msg.indexOf('|');
      const name = sep > -1 ? msg.substring(5, sep) : '?';
      const text = sep > -1 ? msg.substring(sep + 1) : msg.substring(5);
      appendChatMessage(name, text, false);
    }
    else if (msg === "lobby_game_ended:1") {
      // Lobby privado terminó la partida — mostrar panel de carga al owner
      setStatus("🏁 Partida terminada · Carga otra para continuar", "mp");
      const loadBtn = document.getElementById("btn-owner-load");
      if (loadBtn) loadBtn.style.display = '';
      const startBtn = document.getElementById("btn-owner-start");
      if (startBtn) startBtn.style.display = '';
    }
    else if (msg.startsWith("lobby_closed:")) {
      alert("El admin ha cerrado el lobby.");
      leaveMultiplayer();
    }
    else if (msg.startsWith("error:")) {
      const txt = msg.substring(6).trim();
      if (txt.includes("Lobby")) {
        // Lobby eliminado — volver al menú con aviso
        const mpUi = document.getElementById('multiplayer-ui');
        if (mpUi && mpUi.style.display !== 'none') {
          alert("Este lobby ya no existe.");
          leaveMultiplayer();
        }
      }
    }
    else if (msg.startsWith("turn_seconds:")) {
      const secs = parseInt(msg.substring(13)) || 10;
      const slider = document.getElementById("time-slider-mp");
      const val    = document.getElementById("time-val-mp");
      if (slider) slider.value = secs;
      if (val)    val.textContent = secs + 's';
    }
    else if (msg.startsWith("status:"))      {
      const el = document.getElementById("status-mp");
      if (el) { el.textContent = msg.substring(7); setTimeout(() => { if (el.textContent.includes("Analizando") || el.textContent.includes("Cargando")) el.textContent = ""; }, 12000); }
    }
    else if (msg === "game_transition:start") {
      setStatus("⚙ Analizando partida con Stockfish…", "mp");
      showAnalysisProgress('mp');
    }
    else if (msg === "analysis:complete")    {
      hideAnalysisProgress('mp');
    }
  };
function renderFeedbackMp(payload) {
  // Formato: tipo|texto|mov1|mov2|mov3|puntos|gm_uci
  //   parts[0]               = tipo
  //   parts[1]               = texto
  //   parts[2..n-3]          = jugadas top3 del módulo
  //   parts[n-2]             = puntos
  //   parts[n-1]             = gm_uci
  const parts    = payload.split('|');
  const type     = (parts[0] || 'info').trim();
  const text     = (parts[1] || '').trim();
  const gm_uci   = (parts[parts.length - 1] || 'fin').trim();
  const points   = (parts[parts.length - 2] || '0').trim();
  const top3_str = parts.slice(2, parts.length - 2).join('|').trim();

  const fb = document.getElementById("main-feedback");
  if (!fb) return;

  // Mismos emojis y clases que el modo local
  let emoji = '', cssClass = 'fb-info';
  if (text.includes("PERFECTO") && text.includes("módulo")) {
    emoji = '🏆'; cssClass = 'fb-success';
  } else if (text.includes("ACERTADO con GM")) {
    emoji = '🎯'; cssClass = 'fb-warn';
  } else if (text.includes("Mejor del módulo") && text.includes("Stockfish")) {
    emoji = '⚡'; cssClass = 'fb-success';
  } else if (text.includes("Casi perfecta") || text.includes("Muy cercana")) {
    emoji = '✅'; cssClass = 'fb-warn';
  } else if (text.includes("Aceptable")) {
    emoji = '👍'; cssClass = 'fb-info';
  } else if (text.includes("demasiado inferior")) {
    emoji = '⚠️'; cssClass = 'fb-fail';
  } else if (text.includes("Fallaste")) {
    emoji = '❌'; cssClass = 'fb-fail';
  } else if (type === 'success') {
    emoji = '🏁'; cssClass = 'fb-success';
  } else {
    emoji = '💡'; cssClass = 'fb-info';
  }

  let html = `<div class="fb-emoji">${emoji}</div>`;
  html    += `<div class="fb-title">${text}</div>`;
  if (points && points !== '0') {
    html += `<div class="fb-points">+${points} pts</div>`;
  }
  if (gm_uci && gm_uci !== 'fin') {
    html += `<div class="fb-gm-move">♟ GM jugó: ${gm_uci}</div>`;
  }

  // Limpiar animación anterior
  fb.style.animation = 'none';
  fb.offsetHeight;
  fb.style.animation = '';

  fb.className        = `feedback-card ${cssClass}`;
  fb.style.setProperty('--fb-duration', '15000ms');
  fb.innerHTML        = html;
  fb.style.display    = 'block';
  fb.style.opacity    = '1';
  fb.style.transition = '';
  fb.onclick = () => {
    fb.style.transition = 'opacity 0.5s';
    fb.style.opacity    = '0';
    setTimeout(() => { fb.style.display = 'none'; fb.innerHTML = ''; fb.style.transition = ''; fb.onclick = null; }, 520);
  };
  setTimeout(() => fb.onclick?.(), 15000);

  // Panel Stockfish — igual que en local
  if (top3_str) showEnginePanelMp(top3_str);
}

function onDropMulti(source, target) {
  if (mpIsReviewing()) return "snapback";
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (!move) return "snapback";
  ws.send(`move:${source}${target}`);
  game.undo();
  return "snapback";
}

function updateRanking(dataStr) {
  const tbody = document.querySelector("#ranking-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  dataStr.split("|").forEach(item => {
    if (!item.trim()) return;
    const [name, score] = item.split(":");
    if (!name || score === undefined) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${score}</td>`;
    tbody.appendChild(tr);
  });
}

function leaveMultiplayer() {
  if (ws) { try { ws.close(1000); } catch {} }
  _removeMpKeyHandler();
  mpFenHistory = []; mpViewIndex = -1; mpIsPrivate = false;
  mpLiveGame = null;
  lobbyMembers = [];
  closeGroupSummary(); closeSummary();
  hide('multiplayer-ui'); show('menu');
  currentLobbyId = null;
  clearAllFeedback();
  hideGameProgress('mp');
  const cd = document.getElementById("countdown");
  if (cd) cd.textContent = '';
  hideEnginePanelMp();
  const op = document.getElementById("owner-pgn-panel");
  if (op) op.style.display = 'none';
  const wm = document.getElementById("lobby-waiting-msg");
  if (wm) { wm.style.display = 'none'; wm.textContent = ''; }
  const lbl = document.getElementById("lobby-type-label");
  if (lbl) lbl.textContent = 'Lobby';
  const btn = document.getElementById("btn-copy-lobby");
  if (btn) btn.style.display = 'none';
  const members = document.getElementById('lobby-members-panel');
  if (members) members.remove();
}

// ── Common ────────────────────────────────────────────────────

function setStatus(text, mode = "local") {
  const el = document.getElementById(mode === "mp" ? "status-mp" : "status-local");
  if (el) el.textContent = text;
}

function updateConnectionStatus(mode, connected) {
  const statusText = connected ? "✓ Conectado" : "⟳ Reconectando...";
  setStatus(statusText, mode);
}

function openAnalysis() {
  // Obtener FEN actual del tablero (en vivo o en revisión)
  const fen = game ? game.fen() : 'start';
  const url = `/analysis?fen=${encodeURIComponent(fen)}`;
  window.open(url, '_blank', 'width=1100,height=750,noopener');
}

function resetBoard() {
  fenHistory = []; viewIndex = -1;
  updateNavBar();
  hideGameProgress('local');
  closeSummary();
  resetLocalCounters();
  setBoardLocked(true);
  setStatus("📋 Pega un PGN para empezar", "local");
  wsSend("reset");
}
function suggestMove() { wsSend("suggest"); }

function leaveLocal() {
  if (ws) ws.close();
  if (window._localKeyHandler) {
    document.removeEventListener('keydown', window._localKeyHandler);
    window._localKeyHandler = null;
  }
  hideEnginePanel(); hideBgEval(); dismissFeedback(); closeSummary();
  hideGameProgress('local');
  fenHistory = []; viewIndex = -1;
  hide('local-ui'); show('menu');
  clearAllFeedback();
}

let countdownTimer = null;
function startCountdown(targetTime) {
  if (countdownTimer) clearTimeout(countdownTimer);
  const el = document.getElementById("countdown");
  if (!el) return;
  const update = () => {
    const remaining = targetTime - Math.floor(Date.now() / 1000);
    if (remaining <= 0) { el.textContent = "⏱ ¡Avanzando!"; countdownTimer = null; return; }
    el.textContent = `⏱ Próxima jugada en ${remaining}s`;
    countdownTimer = setTimeout(update, 1000);
  };
  update();
}

// ── PGN paste panel ────────────────────────────────────────────

// ── Barra de progreso del análisis ───────────────────────────

function showAnalysisProgress(mode) {
  const id = mode === 'mp' ? 'analysis-progress-mp' : 'analysis-progress-local';
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
  updateAnalysisProgress(mode, 0, null);
}

function updateAnalysisProgress(mode, current, total) {
  const suffix  = mode === 'mp' ? '-mp' : '-local';
  const barEl   = document.getElementById(`ap-bar${suffix}`);
  const countEl = document.getElementById(`ap-count${suffix}`);
  const textEl  = document.getElementById(`ap-text${suffix}`);

  const pct  = total ? Math.round((current / total) * 100) : 0;
  const done = current === total && total > 0;
  const txt  = done ? '¡Listo!' : `Analizando jugada ${current}…`;
  const cnt  = total ? `${current} / ${total}` : `${current} / …`;

  if (barEl)   barEl.style.width   = pct + '%';
  if (countEl) countEl.textContent = cnt;
  if (textEl)  textEl.textContent  = txt;


}

function hideAnalysisProgress(mode) {
  const id = mode === 'mp' ? 'analysis-progress-mp' : 'analysis-progress-local';
  const el = document.getElementById(id);
  if (el) setTimeout(() => { el.style.display = 'none'; }, 800);

}

function togglePgnPanel() {
  const panel = document.getElementById('pgn-paste-panel');
  const btn   = document.getElementById('btn-pgn-toggle');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  btn?.classList.toggle('active', !isOpen);
  if (!isOpen) {
    // Foco automático al abrir
    setTimeout(() => document.getElementById('pgn-textarea')?.focus(), 50);
  }
}

function loadPgnFromTextarea() {
  const ta = document.getElementById('pgn-textarea');
  if (!ta) return;
  const pgnText = ta.value.trim();

  if (!pgnText) {
    ta.focus();
    ta.style.borderColor = 'var(--fail)';
    setTimeout(() => { ta.style.borderColor = ''; }, 1500);
    return;
  }

  if (!pgnText.includes('1.') && !pgnText.includes('1. ')) {
    ta.style.borderColor = 'var(--fail)';
    setStatus("⚠ PGN no válido — ¿has pegado el texto completo?", "local");
    setTimeout(() => { ta.style.borderColor = ''; }, 2000);
    return;
  }

  const depth = document.getElementById('depth-slider-local')?.value || 16;

  renderGameInfoFromPgn(pgnText);
  togglePgnPanel();   // cerrar panel pero mantener barra de progreso visible
  setBoardLocked(true);
  setStatus(`⚙ Analizando con Stockfish (depth ${depth})…`, "local");

  // Mostrar barra de progreso
  showAnalysisProgress('local');

  wsSend(`load_pgn:depth=${depth}|${pgnText}`);
}

function clearPgnTextarea() {
  const ta = document.getElementById('pgn-textarea');
  if (ta) { ta.value = ''; ta.focus(); }
}

function clearAllFeedback() {
  ['feedback-mp','feedback-local','main-feedback','main-feedback-local'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = ''; el.className = el.className.replace(/fb-\S+/g, '').trim(); el.style.display = 'none'; }
  });
  ['status-mp','status-local'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
}

function showFeedback(text, type, mode) {
  // kept for compatibility — use renderFeedbackLocal / renderFeedbackMp for new code
  const id = mode === "mp" ? "feedback-mp" : "feedback-local";
  const fb = document.getElementById(id);
  if (!fb) return;
  fb.textContent = text;
  setTimeout(() => { fb.textContent = ''; }, 10000);
}

// ── PGN info panel ────────────────────────────────────────────

function renderGameInfoFromPgn(pgnText) {
  const headers = {};
  const tagRegex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = tagRegex.exec(pgnText)) !== null) {
    headers[match[1]] = match[2];
  }
  renderGameInfoFromHeaders(headers);
}

function renderGameInfoFromHeaders(h) {
  const $ = id => document.getElementById(id);
  if (!$('gi-white-name')) return; // panel not present

  $('gi-white-name').textContent = h.White || '—';
  $('gi-black-name').textContent = h.Black || '—';
  $('gi-white-elo').textContent  = h.WhiteElo || '';
  $('gi-black-elo').textContent  = h.BlackElo || '';
  $('gi-white-elo').style.display = h.WhiteElo ? '' : 'none';
  $('gi-black-elo').style.display = h.BlackElo ? '' : 'none';

  const eco     = h.ECO     ? `${h.ECO} · ` : '';
  const opening = h.Opening || h.Variant || 'Apertura desconocida';
  $('gi-opening').textContent = eco + opening;

  const tags = [];
  if (h.Date && !h.Date.includes('?')) tags.push(h.Date);
  if (h.TimeControl && h.TimeControl !== '-') {
    const tc = formatTimeControl(h.TimeControl);
    if (tc) tags.push(tc);
  }
  if (h.Result) tags.push(h.Result);
  if (h.Event && h.Event !== '?') tags.push(h.Event.substring(0, 30));

  const tagsEl = $('gi-tags');
  if (tagsEl) tagsEl.innerHTML = tags.filter(Boolean)
    .map(t => `<span class="gi-tag">${t}</span>`).join('');
}

function formatTimeControl(tc) {
  if (!tc || tc === '-') return '';
  const [base, inc] = tc.split('+').map(Number);
  if (isNaN(base)) return tc;
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  let str = mins > 0 ? `${mins}min` : `${secs}s`;
  if (!isNaN(inc) && inc > 0) str += `+${inc}s`;
  return str;
}

function renderGameInfo(payload) {
  try {
    renderGameInfoFromHeaders(JSON.parse(payload));
  } catch {
    if (payload.includes('[White')) renderGameInfoFromPgn(payload);
  }
}

// renderOpeningPieces removed: opening pieces textual list is hidden by design.

function highlightOpeningSquare(from) {
  if (!from) return;
  let style = document.getElementById('opening-sq-style');
  if (!style) { style = document.createElement('style'); style.id = 'opening-sq-style'; document.head.appendChild(style); }
  style.textContent = `#board-local [data-square="${from}"] { background: rgba(100,180,255,0.65) !important; border: 2px solid rgba(30,110,220,0.9) !important; }`;
}

function clearOpeningHighlight() {
  const s = document.getElementById('opening-sq-style');
  if (s) s.textContent = '';
}

function updateOpeningHighlight(currentTurn) {
  // currentTurn = number of moves already played (0 means next is white move 1)
  try {
    window.currentGameProgress = currentTurn;
    clearOpeningHighlight();
    const data = window.openingPiecesData;
    if (!data) return;
    const idx = Math.floor(currentTurn / 2);
    if (currentTurn % 2 === 0) {
      // white to move
      const obj = (data.white || [])[idx];
      if (obj && obj.from) highlightOpeningSquare(obj.from);
    } else {
      const obj = (data.black || [])[idx];
      if (obj && obj.from) highlightOpeningSquare(obj.from);
    }
  } catch (e) { /* ignore */ }
}