const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 60000, pingInterval: 25000 });

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// CONFIGS
// ============================================================
const STAGES = {
  A: { rows: 30, cols: 30, mines: 150 },
  B: { rows: 25, cols: 25, mines: 100 },
  C: { rows: 20, cols: 20, mines: 60 }
};

const ITEM_PROBS = [
  { type: 'mine_detector', weight: 60 },
  { type: 'barrier', weight: 10 },
  { type: 'flag_thief', weight: 20 },
  { type: 'mine_detector_ex', weight: 10 }
];
const ITEM_TOTAL_WEIGHT = ITEM_PROBS.reduce((s, i) => s + i.weight, 0);

function randomItem() {
  let r = Math.random() * ITEM_TOTAL_WEIGHT;
  for (const item of ITEM_PROBS) {
    r -= item.weight;
    if (r <= 0) return item.type;
  }
  return 'mine_detector';
}

// ============================================================
// ROOMS
// ============================================================
const rooms = {};

function createRoom(code) {
  return {
    code,
    host: 'p1',
    players: [],
    state: 'waiting', // waiting|ruleSelect|stageSelect|colorSelect|countdown|playing|finished
    rule: null,    // standard|itemChaos|deathmatch
    stage: null,   // A|B|C
    rows: 30, cols: 30, mineCount: 150,
    board: null,
    revealedBy: null,
    flagsByPlayer: {},
    bombsRevealed: {},
    penalties: {},
    scores: {},
    revealedCount: 0,
    autoOpenedCells: null,
    // Item chaos
    items: {},          // playerId -> [itemType, ...]
    itemInterval: 60,   // seconds between item drops
    itemTimer: null,    // setInterval handle
    barriers: {},       // playerId -> Set of "r,c"
    yellowFlags: {},    // playerId -> Set of "r,c"
    // Timeline for result graph
    timeline: [],
    gameStartTime: null,
    // Final countdown
    finalCountdownActive: false,
    finalCountdownTimer: null,
    finalCountdownEnd: null,
  };
}

// ============================================================
// BOARD
// ============================================================
function generateBoard(rows, cols, mineCount) {
  const board = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, number: 0 }))
  );
  let placed = 0;
  while (placed < mineCount) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!board[r][c].mine) { board[r][c].mine = true; placed++; }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].mine) count++;
      }
      board[r][c].number = count;
    }
  }
  return board;
}

function findAutoOpenPosition(board, rows, cols) {
  let bestPos = null, bestSize = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!board[r][c].mine && board[r][c].number === 0) {
      const size = measureCascade(board, rows, cols, r, c);
      if (size > bestSize) { bestSize = size; bestPos = [r, c]; }
    }
  }
  if (!bestPos) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!board[r][c].mine) { bestPos = [r, c]; break; }
    }
  }
  return bestPos;
}

function measureCascade(board, rows, cols, sr, sc) {
  const visited = new Set([`${sr},${sc}`]);
  const queue = [[sr, sc]];
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (board[r][c].number === 0) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc, key = `${nr},${nc}`;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited.has(key) && !board[nr][nc].mine) {
          visited.add(key); queue.push([nr, nc]);
        }
      }
    }
  }
  return visited.size;
}

function performCascade(board, rows, cols, sr, sc) {
  const revealed = new Set([`${sr},${sc}`]);
  const queue = [[sr, sc]];
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (board[r][c].number === 0) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc, key = `${nr},${nc}`;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !revealed.has(key) && !board[nr][nc].mine) {
          revealed.add(key); queue.push([nr, nc]);
        }
      }
    }
  }
  return revealed;
}

// ============================================================
// HELPERS
// ============================================================
function getScores(room) {
  return room.players.map(p => ({
    id: p.id, name: p.name, color: p.color,
    cells: room.scores[p.id].cells,
    bombs: room.scores[p.id].bombs
  }));
}

function getOpponent(room, pid) {
  return room.players.find(p => p.id !== pid);
}

function getSocketForPlayer(room, pid) {
  const p = room.players.find(pl => pl.id === pid);
  return p ? io.sockets.sockets.get(p.socketId) : null;
}

function recordTimeline(room, pid, type, itemType) {
  if (!room.gameStartTime) return;
  room.timeline.push({
    t: Date.now() - room.gameStartTime,
    pid,
    type,
    cells: room.scores[pid].cells,
    itemType: itemType || null
  });
}

function notifyOppItemUsed(room, pid, inventory) {
  const opp = getOpponent(room, pid);
  if (opp) {
    const oppSock = getSocketForPlayer(room, opp.id);
    if (oppSock) oppSock.emit('oppItemUsed', { inventory });
  }
}

function cellsInArea(centerR, centerC, halfSize, rows, cols) {
  const cells = [];
  for (let dr = -halfSize; dr <= halfSize; dr++) {
    for (let dc = -halfSize; dc <= halfSize; dc++) {
      const r = centerR + dr, c = centerC + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols) cells.push({ r, c, key: `${r},${c}` });
    }
  }
  return cells;
}

// ============================================================
// ITEM TIMER (time-based distribution)
// ============================================================
function startItemTimer(room) {
  if (room.rule !== 'itemChaos') return;
  if (room.itemTimer) clearInterval(room.itemTimer);
  room.itemTimer = setInterval(() => {
    if (room.state !== 'playing') { clearInterval(room.itemTimer); room.itemTimer = null; return; }
    distributeItems(room);
  }, room.itemInterval * 1000);
}

function stopItemTimer(room) {
  if (room.itemTimer) { clearInterval(room.itemTimer); room.itemTimer = null; }
}

function distributeItems(room) {
  room.players.forEach(p => {
    if (room.items[p.id].length >= 9) return; // inventory full, skip
    const item = randomItem();
    room.items[p.id].push(item);
    const sock = getSocketForPlayer(room, p.id);
    if (sock) sock.emit('itemReceived', { item, inventory: room.items[p.id] });
    // Notify opponent of this player's updated inventory
    const opp = getOpponent(room, p.id);
    if (opp) {
      const oppSock = getSocketForPlayer(room, opp.id);
      if (oppSock) oppSock.emit('oppItemReceived', { inventory: room.items[p.id] });
    }
  });
}

// ============================================================
// FINAL COUNTDOWN
// ============================================================
function checkFinalCountdown(room) {
  if (room.finalCountdownActive) return;
  // Count unrevealed SAFE cells only (not mines)
  let unrevealedSafe = 0;
  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) {
      if (!room.board[r][c].mine && room.revealedBy[r][c] === null) {
        unrevealedSafe++;
      }
    }
  }
  if (unrevealedSafe <= 10) {
    room.finalCountdownActive = true;
    room.finalCountdownEnd = Date.now() + 30000;
    io.to(room.code).emit('finalCountdownStart', { duration: 30 });
    room.finalCountdownTimer = setTimeout(() => {
      if (room.state === 'playing') endGame(room);
    }, 30000);
  }
}

// ============================================================
// GAME END
// ============================================================
function checkGameEnd(room) {
  if (room.state !== 'playing') return;
  const { rows, cols } = room;

  // Deathmatch: bomb hit = instant end (handled in dig)

  // All non-bomb cells revealed?
  let allSafeRevealed = true;
  for (let r = 0; r < rows && allSafeRevealed; r++) {
    for (let c = 0; c < cols && allSafeRevealed; c++) {
      if (!room.board[r][c].mine && room.revealedBy[r][c] === null) allSafeRevealed = false;
    }
  }
  if (allSafeRevealed) { endGame(room); return; }

  checkFinalCountdown(room);
}

function endGame(room) {
  room.state = 'finished';
  stopItemTimer(room);
  if (room.finalCountdownTimer) { clearTimeout(room.finalCountdownTimer); room.finalCountdownTimer = null; }

  const bombPenalty = room.rule === 'deathmatch' ? 0 : -10;
  const results = room.players.map(p => {
    const s = room.scores[p.id];
    const penalty = s.bombs * bombPenalty;
    return { id: p.id, name: p.name, color: p.color, cells: s.cells, bombs: s.bombs, penalty, finalScore: s.cells + penalty };
  });

  results.sort((a, b) => b.finalScore - a.finalScore);
  let winner = null;
  if (results[0].finalScore > results[1].finalScore) winner = results[0].id;
  else if (results[0].finalScore < results[1].finalScore) winner = results[1].id;

  io.to(room.code).emit('gameEnd', { results, winner, rule: room.rule, timeline: room.timeline, gameDuration: Date.now() - (room.gameStartTime || Date.now()) });
}

function endGameDeathmatch(room, loserId) {
  room.state = 'finished';
  stopItemTimer(room);
  if (room.finalCountdownTimer) { clearTimeout(room.finalCountdownTimer); room.finalCountdownTimer = null; }

  const winnerId = room.players.find(p => p.id !== loserId).id;
  const results = room.players.map(p => {
    const s = room.scores[p.id];
    return { id: p.id, name: p.name, color: p.color, cells: s.cells, bombs: s.bombs, penalty: 0, finalScore: p.id === loserId ? -1 : s.cells };
  });

  io.to(room.code).emit('gameEnd', { results, winner: winnerId, rule: 'deathmatch', deathBy: loserId, timeline: room.timeline, gameDuration: Date.now() - (room.gameStartTime || Date.now()) });
}

// ============================================================
// START COUNTDOWN
// ============================================================
function startCountdown(room) {
  room.state = 'countdown';
  const { rows, cols, mineCount } = room;

  room.board = generateBoard(rows, cols, mineCount);
  room.revealedBy = Array.from({ length: rows }, () => Array(cols).fill(null));
  room.revealedCount = 0;
  room.finalCountdownActive = false;
  room.finalCountdownTimer = null;

  const autoPos = findAutoOpenPosition(room.board, rows, cols);
  let autoOpenedCells = new Set();
  if (autoPos) autoOpenedCells = performCascade(room.board, rows, cols, autoPos[0], autoPos[1]);
  room.autoOpenedCells = autoOpenedCells;

  const autoOpenData = [];
  for (const key of autoOpenedCells) {
    const [r, c] = key.split(',').map(Number);
    room.revealedBy[r][c] = '__auto__';
    room.revealedCount++;
    autoOpenData.push({ row: r, col: c, number: room.board[r][c].number });
  }

  const playerInfos = room.players.map(p => ({ id: p.id, name: p.name, color: p.color }));

  io.to(room.code).emit('countdownStart', {
    duration: 5, players: playerInfos,
    rows, cols, rule: room.rule, stage: room.stage
  });

  setTimeout(() => { io.to(room.code).emit('autoOpen', { cells: autoOpenData }); }, 2000);
  setTimeout(() => {
    room.state = 'playing';
    room.gameStartTime = Date.now();
    io.to(room.code).emit('gameStart');
    startItemTimer(room);
  }, 5000);
}

// ============================================================
// RESET ROOM FOR RESTART
// ============================================================
function resetRoom(room) {
  room.players.forEach(p => { p.color = null; p.ready = false; });
  room.rule = null; room.stage = null;
  room.board = null; room.revealedBy = null;
  room.bombsRevealed = {}; room.scores = {}; room.penalties = {};
  room.autoOpenedCells = null; room.revealedCount = 0;
  room.items = {}; room.itemInterval = 60;
  room.timeline = []; room.gameStartTime = null;
  stopItemTimer(room);
  room.barriers = {}; room.yellowFlags = {};
  room.finalCountdownActive = false;
  if (room.finalCountdownTimer) clearTimeout(room.finalCountdownTimer);
  room.finalCountdownTimer = null;
  room.players.forEach(p => {
    room.scores[p.id] = { cells: 0, bombs: 0 };
    room.penalties[p.id] = null;
    room.flagsByPlayer[p.id] = new Set();
    room.items[p.id] = [];
    room.barriers[p.id] = new Set();
    room.yellowFlags[p.id] = new Set();
  });
}

// ============================================================
// SOCKET HANDLING
// ============================================================
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);
  let currentRoom = null;
  let playerId = null;

  // --- CREATE ROOM ---
  socket.on('createRoom', ({ code, playerName }) => {
    if (rooms[code]) { socket.emit('error', { message: 'This room code is already in use.' }); return; }
    const room = createRoom(code);
    playerId = 'p1';
    room.players.push({ id: playerId, socketId: socket.id, name: playerName, color: null, ready: false });
    room.scores[playerId] = { cells: 0, bombs: 0 };
    room.penalties[playerId] = null;
    room.flagsByPlayer[playerId] = new Set();
    room.items[playerId] = [];
    room.barriers[playerId] = new Set();
    room.yellowFlags[playerId] = new Set();
    rooms[code] = room;
    currentRoom = code;
    socket.join(code);
    socket.emit('roomCreated', { code, playerId, isHost: true });
    console.log(`Room ${code} created by ${playerName}`);
  });

  // --- JOIN ROOM ---
  socket.on('joinRoom', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', { message: 'Room not found.' }); return; }
    if (room.players.length >= 2) { socket.emit('error', { message: 'Room is full.' }); return; }
    if (room.state !== 'waiting') { socket.emit('error', { message: 'Game already in progress.' }); return; }
    playerId = 'p2';
    room.players.push({ id: playerId, socketId: socket.id, name: playerName, color: null, ready: false });
    room.scores[playerId] = { cells: 0, bombs: 0 };
    room.penalties[playerId] = null;
    room.flagsByPlayer[playerId] = new Set();
    room.items[playerId] = [];
    room.barriers[playerId] = new Set();
    room.yellowFlags[playerId] = new Set();
    currentRoom = code;
    socket.join(code);
    socket.emit('roomJoined', { code, playerId, isHost: false });

    room.state = 'ruleSelect';
    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(code).emit('goToRuleSelect', { players: playerInfos, host: room.host });
    console.log(`${playerName} joined room ${code}`);
  });

  // --- BACK NAVIGATION ---
  socket.on('goBack', ({ from }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    if (from === 'ruleSelect' && room.state === 'ruleSelect') {
      // Back to matching: destroy the room
      io.to(currentRoom).emit('opponentLeft');
      delete rooms[currentRoom];
      currentRoom = null; playerId = null;
      return;
    }
    if (from === 'stageSelect' && room.state === 'stageSelect') {
      room.state = 'ruleSelect';
      room.rule = null;
      const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
      io.to(currentRoom).emit('goToRuleSelect', { players: playerInfos, host: room.host });
      return;
    }
    if (from === 'colorSelect' && room.state === 'colorSelect') {
      room.state = 'stageSelect';
      room.stage = null;
      room.players.forEach(p => { p.color = null; p.ready = false; });
      io.to(currentRoom).emit('goToStageSelect', { rule: room.rule, host: room.host });
      return;
    }
  });

  // --- RULE SELECT (host only) ---
  socket.on('selectRule', ({ rule }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'ruleSelect') return;
    if (playerId !== room.host) { socket.emit('notHost'); return; }
    if (!['standard', 'itemChaos', 'deathmatch'].includes(rule)) return;
    room.rule = rule;
    room.state = 'stageSelect';
    io.to(currentRoom).emit('goToStageSelect', { rule, host: room.host });
  });

  // --- STAGE SELECT (host only) ---
  socket.on('selectStage', ({ stage, itemInterval }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'stageSelect') return;
    if (playerId !== room.host) { socket.emit('notHost'); return; }
    if (!STAGES[stage]) return;
    room.stage = stage;
    const cfg = STAGES[stage];
    room.rows = cfg.rows; room.cols = cfg.cols; room.mineCount = cfg.mines;
    // Item interval (only for itemChaos, clamp to valid range)
    if (room.rule === 'itemChaos' && itemInterval) {
      room.itemInterval = Math.max(30, Math.min(120, Number(itemInterval) || 60));
    }

    room.state = 'colorSelect';
    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(currentRoom).emit('goToColorSelect', { players: playerInfos });
  });

  // --- COLOR SELECT ---
  socket.on('selectColor', ({ color }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'colorSelect') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    const other = room.players.find(p => p.id !== playerId);
    if (other && other.color === color) { socket.emit('colorTaken', { color }); return; }
    player.color = color;
    io.to(currentRoom).emit('colorUpdate', {
      playerId, color,
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color }))
    });
  });

  socket.on('deselectColor', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'colorSelect') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    player.color = null;
    io.to(currentRoom).emit('colorUpdate', {
      playerId, color: null,
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color }))
    });
  });

  socket.on('confirmColor', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'colorSelect') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.color) return;
    player.ready = true;
    io.to(currentRoom).emit('playerReady', { playerId });
    if (room.players.every(p => p.ready)) startCountdown(room);
  });

  // --- DIG ---
  socket.on('dig', ({ row, col }) => {
    try {
      const room = rooms[currentRoom];
      if (!room || room.state !== 'playing' || !room.board || !room.revealedBy) return;
      if (row < 0 || row >= room.rows || col < 0 || col >= room.cols) return;

      const penalty = room.penalties[playerId];
      if (penalty && Date.now() < penalty.until) { socket.emit('penalized'); return; }

      const key = `${row},${col}`;
      if (room.revealedBy[row][col] !== null) return;
      if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;

      const myFlags = room.flagsByPlayer[playerId];
      if (myFlags && myFlags.has(key)) return;
      if (room.yellowFlags[playerId] && room.yellowFlags[playerId].has(key)) return;

      // Barrier check: can't dig in opponent's barrier
      const opp = getOpponent(room, playerId);
      if (opp && room.barriers[opp.id] && room.barriers[opp.id].has(key)) return;

      const cell = room.board[row][col];

      if (cell.mine) {
        if (room.rule === 'deathmatch') {
          room.scores[playerId].bombs++;
          room.bombsRevealed[key] = true;
          room.revealedBy[row][col] = '__bomb__';
          room.revealedCount++;
          io.to(currentRoom).emit('bombHit', {
            row, col, playerId, penaltyUntil: 0, scores: getScores(room), deathmatch: true
          });
          recordTimeline(room, playerId, 'bomb');
          endGameDeathmatch(room, playerId);
          return;
        }
        // Standard / Item Chaos
        room.scores[playerId].bombs++;
        room.bombsRevealed[key] = true;
        room.revealedBy[row][col] = '__bomb__';
        room.revealedCount++;
        room.penalties[playerId] = { until: Date.now() + 5000 };
        io.to(currentRoom).emit('bombHit', {
          row, col, playerId,
          penaltyUntil: room.penalties[playerId].until,
          scores: getScores(room)
        });
        recordTimeline(room, playerId, 'bomb');
        checkGameEnd(room);
      } else {
        if (cell.number === 0) {
          const cascaded = performCascade(room.board, room.rows, room.cols, row, col);
          const newlyRevealed = [];
          for (const ck of cascaded) {
            const [cr, cc] = ck.split(',').map(Number);
            if (room.revealedBy[cr][cc] === null && !(room.autoOpenedCells && room.autoOpenedCells.has(ck))) {
              // Check opponent barrier for cascaded cells
              if (opp && room.barriers[opp.id] && room.barriers[opp.id].has(ck)) continue;
              room.revealedBy[cr][cc] = playerId;
              room.scores[playerId].cells++;
              room.revealedCount++;
              newlyRevealed.push({ row: cr, col: cc, number: room.board[cr][cc].number });
            }
          }
          if (newlyRevealed.length > 0) {
            io.to(currentRoom).emit('cellsRevealed', { cells: newlyRevealed, playerId, scores: getScores(room) });
            recordTimeline(room, playerId, 'dig');
          }
        } else {
          room.revealedBy[row][col] = playerId;
          room.scores[playerId].cells++;
          room.revealedCount++;
          io.to(currentRoom).emit('cellsRevealed', {
            cells: [{ row, col, number: cell.number }], playerId, scores: getScores(room)
          });
          recordTimeline(room, playerId, 'dig');
        }
        checkGameEnd(room);
      }
    } catch (err) { console.error('Error in dig:', err); }
  });

  // --- FLAG ---
  socket.on('flag', ({ row, col }) => {
    try {
      const room = rooms[currentRoom];
      if (!room || room.state !== 'playing' || !room.revealedBy) return;
      if (row < 0 || row >= room.rows || col < 0 || col >= room.cols) return;

      const penalty = room.penalties[playerId];
      if (penalty && Date.now() < penalty.until) { socket.emit('penalized'); return; }

      const key = `${row},${col}`;
      if (room.revealedBy[row][col] !== null) return;
      if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;
      // Don't toggle yellow flags with normal flag
      if (room.yellowFlags[playerId] && room.yellowFlags[playerId].has(key)) return;

      const flags = room.flagsByPlayer[playerId];
      if (flags.has(key)) { flags.delete(key); socket.emit('flagUpdate', { row, col, flagged: false }); }
      else { flags.add(key); socket.emit('flagUpdate', { row, col, flagged: true }); }
    } catch (err) { console.error('Error in flag:', err); }
  });

  // --- USE ITEM ---
  socket.on('useItem', ({ itemType, row, col }) => {
    try {
      const room = rooms[currentRoom];
      if (!room || room.state !== 'playing' || room.rule !== 'itemChaos') return;

      const penalty = room.penalties[playerId];
      if (penalty && Date.now() < penalty.until) { socket.emit('penalized'); return; }

      const inv = room.items[playerId];
      const idx = inv.indexOf(itemType);
      if (idx === -1) return;

      const opp = getOpponent(room, playerId);
      const oppId = opp ? opp.id : null;

      if (itemType === 'flag_thief') {
        // Immediate effect: remove up to 5 random opponent flags
        if (!oppId) return;
        const oppFlags = room.flagsByPlayer[oppId];
        const flagArr = [...oppFlags];
        const toRemove = [];
        const count = Math.min(5, flagArr.length);
        const shuffled = flagArr.sort(() => Math.random() - 0.5);
        for (let i = 0; i < count; i++) {
          oppFlags.delete(shuffled[i]);
          const [fr, fc] = shuffled[i].split(',').map(Number);
          toRemove.push({ row: fr, col: fc });
        }
        inv.splice(idx, 1);
        socket.emit('itemUsed', { itemType, inventory: inv });
        recordTimeline(room, playerId, 'item', 'flag_thief');
        const oppSock = getSocketForPlayer(room, oppId);
        if (oppSock) {
          oppSock.emit('oppItemUsed', { inventory: inv });
          oppSock.emit('flagsStolen', { flags: toRemove });
        }
        return;
      }

      if (row === undefined || col === undefined) return;
      if (row < 0 || row >= room.rows || col < 0 || col >= room.cols) return;

      if (itemType === 'mine_detector') {
        const key = `${row},${col}`;
        if (room.revealedBy[row][col] !== null) return;
        if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;
        // Can't use in opponent's barrier
        if (oppId && room.barriers[oppId] && room.barriers[oppId].has(key)) return;

        inv.splice(idx, 1);
        const cell = room.board[row][col];
        if (cell.mine) {
          // Place yellow flag
          room.yellowFlags[playerId].add(key);
          socket.emit('yellowFlagPlaced', { row, col });
          socket.emit('itemUsed', { itemType, inventory: inv });
          recordTimeline(room, playerId, 'item', 'mine_detector');
          notifyOppItemUsed(room, playerId, inv);
        } else {
          // Dig single cell (no cascade)
          room.revealedBy[row][col] = playerId;
          room.scores[playerId].cells++;
          room.revealedCount++;
          io.to(currentRoom).emit('cellsRevealed', {
            cells: [{ row, col, number: cell.number }], playerId, scores: getScores(room)
          });
          socket.emit('itemUsed', { itemType, inventory: inv });
          recordTimeline(room, playerId, 'item', 'mine_detector');
          notifyOppItemUsed(room, playerId, inv);
          checkGameEnd(room);
        }

      } else if (itemType === 'mine_detector_ex') {
        const area = cellsInArea(row, col, 1, room.rows, room.cols);
        // Check no cell is in opponent's barrier
        for (const a of area) {
          if (oppId && room.barriers[oppId] && room.barriers[oppId].has(a.key)) return;
        }

        inv.splice(idx, 1);
        const revealed = [];
        const yellows = [];
        for (const a of area) {
          if (room.revealedBy[a.r][a.c] !== null) continue;
          if (room.autoOpenedCells && room.autoOpenedCells.has(a.key)) continue;
          const cell = room.board[a.r][a.c];
          if (cell.mine) {
            room.yellowFlags[playerId].add(a.key);
            yellows.push({ row: a.r, col: a.c });
          } else {
            room.revealedBy[a.r][a.c] = playerId;
            room.scores[playerId].cells++;
            room.revealedCount++;
            revealed.push({ row: a.r, col: a.c, number: cell.number });
          }
        }
        if (yellows.length > 0) socket.emit('yellowFlagsPlaced', { flags: yellows });
        if (revealed.length > 0) {
          io.to(currentRoom).emit('cellsRevealed', { cells: revealed, playerId, scores: getScores(room) });
        }
        socket.emit('itemUsed', { itemType, inventory: inv });
        recordTimeline(room, playerId, 'item', 'mine_detector_ex');
        notifyOppItemUsed(room, playerId, inv);
        checkGameEnd(room);

      } else if (itemType === 'barrier') {
        const area = cellsInArea(row, col, 2, room.rows, room.cols);
        // Check no overlap with any existing barrier
        for (const a of area) {
          for (const pid of ['p1', 'p2']) {
            if (room.barriers[pid] && room.barriers[pid].has(a.key)) return;
          }
        }
        inv.splice(idx, 1);
        const barrierCells = [];
        for (const a of area) {
          room.barriers[playerId].add(a.key);
          barrierCells.push({ row: a.r, col: a.c });
        }
        socket.emit('itemUsed', { itemType, inventory: inv });
        recordTimeline(room, playerId, 'item', 'barrier');
        notifyOppItemUsed(room, playerId, inv);
        io.to(currentRoom).emit('barrierPlaced', {
          playerId, cells: barrierCells, center: { row, col }
        });
      }
    } catch (err) { console.error('Error in useItem:', err); }
  });

  // --- RESTART / LEAVE ---
  socket.on('requestRestart', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'finished') return;
    resetRoom(room);
    room.state = 'ruleSelect';
    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(currentRoom).emit('goToRuleSelect', { players: playerInfos, host: room.host });
  });

  socket.on('leaveRoom', () => handleDisconnect());

  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    handleDisconnect();
  });

  function handleDisconnect() {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      stopItemTimer(room);
      if (room.finalCountdownTimer) clearTimeout(room.finalCountdownTimer);
      io.to(currentRoom).emit('opponentLeft');
      delete rooms[currentRoom];
    }
    currentRoom = null; playerId = null;
  }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
    }
  }
  console.log('='.repeat(50));
  console.log('  MineSweeTory - Server Running!');
  console.log('='.repeat(50));
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('='.repeat(50));
});
