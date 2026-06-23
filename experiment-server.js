const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 60000, pingInterval: 25000 });

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

app.use(express.static(path.join(__dirname, 'public-exp')));
app.use('/characters', express.static(path.join(__dirname, 'public/characters')));

// ============================================================
// FIXED BOARDS (20x20, 60 mines each)
// 0=safe, 1=mine, 2=auto-open origin (treated as safe)
// ============================================================
const FIXED_BOARDS = {
  A: {
    autoOpen: [19, 10],
    grid: [
      [0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,0,0,0,0,0,0,1,0,1,0,0,0,1,0,1,0,0],
      [0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,1,0,0,0,1,0,1,0,0,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
      [0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,1,0],
      [1,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1],
      [0,0,1,1,0,0,1,0,0,0,0,1,0,1,0,0,1,0,1,0],
      [0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0,0],
      [0,1,0,1,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0],
      [0,0,0,0,0,1,1,0,0,0,0,0,1,0,0,0,0,0,1,0],
      [0,0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,0,0]
    ]
  },
  B: {
    autoOpen: [0, 0],
    grid: [
      [0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1],
      [0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0],
      [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,0,0],
      [0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [0,0,0,1,1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0],
      [0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,0],
      [0,0,0,0,0,0,1,0,1,0,0,1,0,0,0,1,0,1,1,0],
      [0,1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0],
      [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,1,0,1,1,0,0,0,1,0,1,0,1,1,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,1,0,1,1,0,0,0,0,0,0],
      [0,1,0,1,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,1]
    ]
  },
  C: {
    autoOpen: [10, 8],
    grid: [
      [1,0,0,0,0,0,0,1,0,1,1,0,0,0,0,1,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,0,1,0,1,0,1,1,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0],
      [0,0,0,0,0,0,0,1,0,1,0,0,1,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0],
      [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0],
      [0,1,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,0,1,0,0,0,0,0,0,0,0,1,0,0,0,1,0],
      [0,1,1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
      [1,1,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0],
      [0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,1,0,0,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0],
      [0,0,0,0,0,1,1,0,0,0,0,1,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    ]
  }
};

const ROWS = 20, COLS = 20;

// ============================================================
// BOARD HELPERS
// ============================================================
function buildBoardFromGrid(grid) {
  const rows = grid.length, cols = grid[0].length;
  const board = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ mine: grid[r][c] === 1, number: 0 }))
  );
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
// ROOMS
// ============================================================
const rooms = {};

function createRoom(code) {
  return {
    code,
    host: 'p1',
    players: [],
    state: 'waiting',
    mode: null,
    pattern: null,
    rows: ROWS, cols: COLS, mineCount: 60,
    board: null,
    revealedBy: null,
    revealedCount: 0,
    autoOpenedCells: null,
    flagsByPlayer: {},
    bombsRevealed: {},
    penalties: {},
    scores: {},
    // Solo
    soloState: {},
    // Timeline & logging
    timeline: [],
    gameStartTime: null,
    actionLog: [],
    mouseLog: [],
    // VS final countdown
    finalCountdownActive: false,
    finalCountdownTimer: null,
    finalCountdownEnd: null,
    // Co-op cursor throttle
    lastCursorBroadcast: {},
  };
}

// ============================================================
// HELPERS
// ============================================================
function getOpponent(room, pid) {
  return room.players.find(p => p.id !== pid);
}

function getSocketForPlayer(room, pid) {
  const p = room.players.find(pl => pl.id === pid);
  return p ? io.sockets.sockets.get(p.socketId) : null;
}

function getScoresArray(room) {
  return room.players.map(p => ({
    id: p.id, name: p.name, color: p.color,
    cells: room.scores[p.id].cells,
    bombs: room.scores[p.id].bombs
  }));
}

function recordAction(room, playerId, actionType, row, col, result) {
  if (!room.gameStartTime) return;
  room.actionLog.push({
    timestamp: Date.now() - room.gameStartTime,
    playerId, actionType, row, col,
    result: result !== undefined ? String(result) : ''
  });
}

function recordTimeline(room, pid, type) {
  if (!room.gameStartTime) return;
  const cells = room.mode === 'solo'
    ? room.soloState[pid].scores.cells
    : room.scores[pid].cells;
  room.timeline.push({
    t: Date.now() - room.gameStartTime,
    pid, type, cells
  });
}

function recordMouse(room, playerId, x, y) {
  if (!room.gameStartTime) return;
  room.mouseLog.push({
    timestamp: Date.now() - room.gameStartTime,
    playerId, x, y
  });
}

function buildCSV(room) {
  const actionHeader = 'timestamp,playerId,actionType,row,col,result';
  const actionRows = room.actionLog.map(a =>
    `${a.timestamp},${a.playerId},${a.actionType},${a.row},${a.col},${a.result}`
  );
  const actionCSV = [actionHeader, ...actionRows].join('\n');

  const mouseHeader = 'timestamp,playerId,x,y';
  const mouseRows = room.mouseLog.map(m =>
    `${m.timestamp},${m.playerId},${Math.round(m.x)},${Math.round(m.y)}`
  );
  const mouseCSV = [mouseHeader, ...mouseRows].join('\n');

  return { actionCSV, mouseCSV };
}

// ============================================================
// COUNTDOWN & GAME START
// ============================================================
function startCountdown(room) {
  room.state = 'countdown';
  const { rows, cols } = room;
  const boardData = FIXED_BOARDS[room.pattern];
  room.board = buildBoardFromGrid(boardData.grid);

  const [autoR, autoC] = boardData.autoOpen;
  const autoOpenedCells = performCascade(room.board, rows, cols, autoR, autoC);
  room.autoOpenedCells = autoOpenedCells;

  const autoOpenData = [];
  if (room.mode === 'solo') {
    for (const pid of ['p1', 'p2']) {
      const st = room.soloState[pid];
      for (const key of autoOpenedCells) {
        const [r, c] = key.split(',').map(Number);
        st.revealedBy[r][c] = '__auto__';
        st.revealedCount++;
      }
    }
    for (const key of autoOpenedCells) {
      const [r, c] = key.split(',').map(Number);
      autoOpenData.push({ row: r, col: c, number: room.board[r][c].number });
    }
  } else {
    room.revealedBy = Array.from({ length: rows }, () => Array(cols).fill(null));
    room.revealedCount = 0;
    for (const key of autoOpenedCells) {
      const [r, c] = key.split(',').map(Number);
      room.revealedBy[r][c] = '__auto__';
      room.revealedCount++;
      autoOpenData.push({ row: r, col: c, number: room.board[r][c].number });
    }
  }

  room.finalCountdownActive = false;
  room.finalCountdownTimer = null;

  const playerInfos = room.players.map(p => ({ id: p.id, name: p.name, color: p.color }));

  io.to(room.code).emit('countdownStart', {
    duration: 5, players: playerInfos,
    rows, cols, mode: room.mode, pattern: room.pattern
  });

  setTimeout(() => { io.to(room.code).emit('autoOpen', { cells: autoOpenData }); }, 2000);
  setTimeout(() => {
    room.state = 'playing';
    room.gameStartTime = Date.now();
    io.to(room.code).emit('gameStart');
  }, 5000);
}

// ============================================================
// GAME END
// ============================================================
function checkGameEndVS(room) {
  if (room.state !== 'playing') return;
  let allSafeRevealed = true;
  for (let r = 0; r < room.rows && allSafeRevealed; r++) {
    for (let c = 0; c < room.cols && allSafeRevealed; c++) {
      if (!room.board[r][c].mine && room.revealedBy[r][c] === null) allSafeRevealed = false;
    }
  }
  if (allSafeRevealed) { endGameVS(room); return; }
  checkFinalCountdown(room);
}

function checkFinalCountdown(room) {
  if (room.finalCountdownActive) return;
  let unrevealedSafe = 0;
  for (let r = 0; r < room.rows; r++) {
    for (let c = 0; c < room.cols; c++) {
      if (!room.board[r][c].mine && room.revealedBy[r][c] === null) unrevealedSafe++;
    }
  }
  if (unrevealedSafe <= 10) {
    room.finalCountdownActive = true;
    room.finalCountdownEnd = Date.now() + 30000;
    io.to(room.code).emit('finalCountdownStart', { duration: 30 });
    room.finalCountdownTimer = setTimeout(() => {
      if (room.state === 'playing') endGameVS(room);
    }, 30000);
  }
}

function endGameVS(room) {
  room.state = 'finished';
  if (room.finalCountdownTimer) { clearTimeout(room.finalCountdownTimer); room.finalCountdownTimer = null; }

  const results = room.players.map(p => {
    const s = room.scores[p.id];
    const penalty = s.bombs * -10;
    return { id: p.id, name: p.name, color: p.color, cells: s.cells, bombs: s.bombs, penalty, finalScore: s.cells + penalty };
  });
  results.sort((a, b) => b.finalScore - a.finalScore);
  let winner = null;
  if (results[0].finalScore > results[1].finalScore) winner = results[0].id;
  else if (results[0].finalScore < results[1].finalScore) winner = results[1].id;

  io.to(room.code).emit('gameEnd', {
    results, winner, mode: 'vs',
    timeline: room.timeline,
    gameDuration: Date.now() - (room.gameStartTime || Date.now())
  });
}

function checkGameEndCoop(room) {
  if (room.state !== 'playing') return;
  let allSafeRevealed = true;
  for (let r = 0; r < room.rows && allSafeRevealed; r++) {
    for (let c = 0; c < room.cols && allSafeRevealed; c++) {
      if (!room.board[r][c].mine && room.revealedBy[r][c] === null) allSafeRevealed = false;
    }
  }
  if (allSafeRevealed) endGameCoop(room);
}

function endGameCoop(room) {
  room.state = 'finished';
  const totalBombs = room.players.reduce((s, p) => s + room.scores[p.id].bombs, 0);
  const totalCells = room.players.reduce((s, p) => s + room.scores[p.id].cells, 0);
  const results = room.players.map(p => ({
    id: p.id, name: p.name,
    cells: room.scores[p.id].cells,
    bombs: room.scores[p.id].bombs
  }));
  io.to(room.code).emit('gameEnd', {
    results, mode: 'coop',
    totalCells, totalBombs,
    timeline: room.timeline,
    gameDuration: Date.now() - (room.gameStartTime || Date.now())
  });
}

function checkGameEndSolo(room, playerId) {
  if (room.state !== 'playing') return;
  const st = room.soloState[playerId];
  if (st.finished) return;
  let allSafeRevealed = true;
  for (let r = 0; r < room.rows && allSafeRevealed; r++) {
    for (let c = 0; c < room.cols && allSafeRevealed; c++) {
      if (!room.board[r][c].mine && st.revealedBy[r][c] === null) allSafeRevealed = false;
    }
  }
  if (allSafeRevealed) {
    st.finished = true;
    st.finishTime = Date.now() - room.gameStartTime;
    io.to(room.code).emit('playerFinished', {
      playerId, time: st.finishTime, bombs: st.scores.bombs
    });
    const allDone = room.players.every(p => room.soloState[p.id].finished);
    if (allDone) endGameSolo(room);
  }
}

function endGameSolo(room) {
  room.state = 'finished';
  const results = room.players.map(p => {
    const st = room.soloState[p.id];
    return {
      id: p.id, name: p.name,
      cells: st.scores.cells, bombs: st.scores.bombs,
      finishTime: st.finishTime
    };
  });
  io.to(room.code).emit('gameEnd', {
    results, mode: 'solo',
    timeline: room.timeline,
    gameDuration: Date.now() - (room.gameStartTime || Date.now())
  });
}

// ============================================================
// RESET ROOM
// ============================================================
function resetRoom(room) {
  room.players.forEach(p => { p.color = null; p.ready = false; });
  room.mode = null; room.pattern = null;
  room.board = null; room.revealedBy = null;
  room.revealedCount = 0; room.autoOpenedCells = null;
  room.bombsRevealed = {}; room.scores = {}; room.penalties = {};
  room.flagsByPlayer = {};
  room.coopFlags = null;
  room.soloState = {};
  room.timeline = []; room.gameStartTime = null;
  room.actionLog = []; room.mouseLog = [];
  room.finalCountdownActive = false;
  if (room.finalCountdownTimer) clearTimeout(room.finalCountdownTimer);
  room.finalCountdownTimer = null;
  room.lastCursorBroadcast = {};
}

function initPlayerState(room) {
  room.players.forEach(p => {
    room.scores[p.id] = { cells: 0, bombs: 0 };
    room.penalties[p.id] = null;
    room.flagsByPlayer[p.id] = new Set();
  });
}

function initSoloState(room) {
  room.players.forEach(p => {
    room.soloState[p.id] = {
      revealedBy: Array.from({ length: room.rows }, () => Array(room.cols).fill(null)),
      revealedCount: 0,
      flags: new Set(),
      scores: { cells: 0, bombs: 0 },
      finished: false,
      finishTime: null
    };
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
    currentRoom = code;
    socket.join(code);
    socket.emit('roomJoined', { code, playerId, isHost: false });
    room.state = 'modeSelect';
    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(code).emit('goToModeSelect', { players: playerInfos, host: room.host });
    console.log(`${playerName} joined room ${code}`);
  });

  // --- BACK NAVIGATION ---
  socket.on('goBack', ({ from }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    if (from === 'modeSelect' && room.state === 'modeSelect') {
      io.to(currentRoom).emit('opponentLeft');
      delete rooms[currentRoom];
      currentRoom = null; playerId = null;
      return;
    }
    if (from === 'patternSelect' && room.state === 'patternSelect') {
      room.state = 'modeSelect';
      room.mode = null;
      const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
      io.to(currentRoom).emit('goToModeSelect', { players: playerInfos, host: room.host });
      return;
    }
    if (from === 'ready' && room.state === 'ready') {
      room.state = 'patternSelect';
      room.pattern = null;
      room.players.forEach(p => { p.color = null; p.ready = false; });
      io.to(currentRoom).emit('goToPatternSelect', { mode: room.mode, host: room.host });
      return;
    }
  });

  // --- MODE SELECT (host only) ---
  socket.on('selectMode', ({ mode }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'modeSelect') return;
    if (playerId !== room.host) { socket.emit('notHost'); return; }
    if (!['solo', 'coop', 'vs'].includes(mode)) return;
    room.mode = mode;
    room.state = 'patternSelect';
    io.to(currentRoom).emit('goToPatternSelect', { mode, host: room.host });
  });

  // --- PATTERN SELECT (host only) ---
  socket.on('selectPattern', ({ pattern }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'patternSelect') return;
    if (playerId !== room.host) { socket.emit('notHost'); return; }
    if (!FIXED_BOARDS[pattern]) return;
    room.pattern = pattern;

    if (room.mode === 'vs') {
      // Auto-assign colors and go to ready screen
      room.players.forEach(p => {
        p.color = p.id === 'p1' ? 'red' : 'blue';
      });
      room.state = 'ready';
      const playerInfos = room.players.map(p => ({ id: p.id, name: p.name, color: p.color }));
      io.to(currentRoom).emit('goToReady', { players: playerInfos });
    } else {
      // Solo/Co-op: no color select, init and start countdown directly
      initPlayerState(room);
      if (room.mode === 'solo') {
        initSoloState(room);
      }
      startCountdown(room);
    }
  });

  // --- READY (VS only) ---
  socket.on('confirmReady', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'ready') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    player.ready = true;
    io.to(currentRoom).emit('playerReady', { playerId });
    if (room.players.every(p => p.ready)) {
      initPlayerState(room);
      startCountdown(room);
    }
  });

  // --- DIG ---
  socket.on('dig', ({ row, col }) => {
    try {
      const room = rooms[currentRoom];
      if (!room || room.state !== 'playing' || !room.board) return;
      if (row < 0 || row >= room.rows || col < 0 || col >= room.cols) return;

      if (room.mode === 'solo') handleDigSolo(room, playerId, row, col, socket);
      else if (room.mode === 'coop') handleDigCoop(room, playerId, row, col);
      else handleDigVS(room, playerId, row, col, socket);
    } catch (err) { console.error('Error in dig:', err); }
  });

  // --- FLAG ---
  socket.on('flag', ({ row, col }) => {
    try {
      const room = rooms[currentRoom];
      if (!room || room.state !== 'playing') return;
      if (row < 0 || row >= room.rows || col < 0 || col >= room.cols) return;

      if (room.mode === 'solo') handleFlagSolo(room, playerId, row, col, socket);
      else if (room.mode === 'coop') handleFlagCoop(room, playerId, row, col);
      else handleFlagVS(room, playerId, row, col, socket);
    } catch (err) { console.error('Error in flag:', err); }
  });

  // --- CURSOR MOVE (logging + co-op broadcast) ---
  socket.on('cursorMove', ({ x, y }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'playing') return;
    recordMouse(room, playerId, x, y);
    if (room.mode === 'coop') {
      const now = Date.now();
      if (now - (room.lastCursorBroadcast[playerId] || 0) < 50) return;
      room.lastCursorBroadcast[playerId] = now;
      const opp = getOpponent(room, playerId);
      if (opp) {
        const oppSock = getSocketForPlayer(room, opp.id);
        if (oppSock) oppSock.emit('oppCursorMove', { x, y });
      }
    }
  });

  // --- LOG DOWNLOAD ---
  socket.on('requestLog', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'finished') return;
    const { actionCSV, mouseCSV } = buildCSV(room);
    socket.emit('logData', { actionCSV, mouseCSV, mode: room.mode, pattern: room.pattern });
  });

  // --- RESTART ---
  socket.on('requestRestart', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'finished') return;
    resetRoom(room);
    room.state = 'modeSelect';
    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(currentRoom).emit('goToModeSelect', { players: playerInfos, host: room.host });
  });

  socket.on('leaveRoom', () => handleDisconnect());
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    handleDisconnect();
  });

  function handleDisconnect() {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      if (room.finalCountdownTimer) clearTimeout(room.finalCountdownTimer);
      io.to(currentRoom).emit('opponentLeft');
      delete rooms[currentRoom];
    }
    currentRoom = null; playerId = null;
  }
});

// ============================================================
// DIG HANDLERS
// ============================================================
function handleDigSolo(room, playerId, row, col, socket) {
  const st = room.soloState[playerId];
  if (!st || st.finished) return;
  const key = `${row},${col}`;
  if (st.revealedBy[row][col] !== null) return;
  if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;
  if (st.flags.has(key)) return;

  const cell = room.board[row][col];
  if (cell.mine) {
    st.scores.bombs++;
    st.revealedBy[row][col] = '__bomb__';
    st.revealedCount++;
    socket.emit('bombHit', { row, col, playerId, scores: [{ id: playerId, cells: st.scores.cells, bombs: st.scores.bombs }] });
    recordAction(room, playerId, 'bomb', row, col, 'bomb');
    recordTimeline(room, playerId, 'bomb');
    checkGameEndSolo(room, playerId);
  } else {
    if (cell.number === 0) {
      const cascaded = performCascade(room.board, room.rows, room.cols, row, col);
      const newlyRevealed = [];
      for (const ck of cascaded) {
        const [cr, cc] = ck.split(',').map(Number);
        if (st.revealedBy[cr][cc] === null && !(room.autoOpenedCells && room.autoOpenedCells.has(ck))) {
          st.revealedBy[cr][cc] = playerId;
          st.scores.cells++;
          st.revealedCount++;
          newlyRevealed.push({ row: cr, col: cc, number: room.board[cr][cc].number });
        }
      }
      if (newlyRevealed.length > 0) {
        socket.emit('cellsRevealed', { cells: newlyRevealed, playerId, scores: [{ id: playerId, cells: st.scores.cells, bombs: st.scores.bombs }] });
        recordAction(room, playerId, 'dig', row, col, cell.number);
        recordTimeline(room, playerId, 'dig');
      }
    } else {
      st.revealedBy[row][col] = playerId;
      st.scores.cells++;
      st.revealedCount++;
      socket.emit('cellsRevealed', { cells: [{ row, col, number: cell.number }], playerId, scores: [{ id: playerId, cells: st.scores.cells, bombs: st.scores.bombs }] });
      recordAction(room, playerId, 'dig', row, col, cell.number);
      recordTimeline(room, playerId, 'dig');
    }
    checkGameEndSolo(room, playerId);
  }
}

function handleDigCoop(room, playerId, row, col) {
  const key = `${row},${col}`;
  if (room.revealedBy[row][col] !== null) return;
  if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;
  if (room.coopFlags && room.coopFlags.has(key)) return;

  const cell = room.board[row][col];
  if (cell.mine) {
    room.scores[playerId].bombs++;
    room.bombsRevealed[key] = true;
    room.revealedBy[row][col] = '__bomb__';
    room.revealedCount++;
    io.to(room.code).emit('bombHit', { row, col, playerId, scores: getScoresArray(room) });
    recordAction(room, playerId, 'bomb', row, col, 'bomb');
    recordTimeline(room, playerId, 'bomb');
    checkGameEndCoop(room);
  } else {
    if (cell.number === 0) {
      const cascaded = performCascade(room.board, room.rows, room.cols, row, col);
      const newlyRevealed = [];
      for (const ck of cascaded) {
        const [cr, cc] = ck.split(',').map(Number);
        if (room.revealedBy[cr][cc] === null && !(room.autoOpenedCells && room.autoOpenedCells.has(ck))) {
          room.revealedBy[cr][cc] = playerId;
          room.scores[playerId].cells++;
          room.revealedCount++;
          newlyRevealed.push({ row: cr, col: cc, number: room.board[cr][cc].number });
        }
      }
      if (newlyRevealed.length > 0) {
        io.to(room.code).emit('cellsRevealed', { cells: newlyRevealed, playerId, scores: getScoresArray(room) });
        recordAction(room, playerId, 'dig', row, col, cell.number);
        recordTimeline(room, playerId, 'dig');
      }
    } else {
      room.revealedBy[row][col] = playerId;
      room.scores[playerId].cells++;
      room.revealedCount++;
      io.to(room.code).emit('cellsRevealed', { cells: [{ row, col, number: cell.number }], playerId, scores: getScoresArray(room) });
      recordAction(room, playerId, 'dig', row, col, cell.number);
      recordTimeline(room, playerId, 'dig');
    }
    checkGameEndCoop(room);
  }
}

function handleDigVS(room, playerId, row, col, socket) {
  if (!room.revealedBy) return;
  const penalty = room.penalties[playerId];
  if (penalty && Date.now() < penalty.until) { socket.emit('penalized'); return; }

  const key = `${row},${col}`;
  if (room.revealedBy[row][col] !== null) return;
  if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;
  const myFlags = room.flagsByPlayer[playerId];
  if (myFlags && myFlags.has(key)) return;

  const cell = room.board[row][col];
  if (cell.mine) {
    room.scores[playerId].bombs++;
    room.bombsRevealed[key] = true;
    room.revealedBy[row][col] = '__bomb__';
    room.revealedCount++;
    room.penalties[playerId] = { until: Date.now() + 5000 };
    io.to(room.code).emit('bombHit', {
      row, col, playerId,
      penaltyUntil: room.penalties[playerId].until,
      scores: getScoresArray(room)
    });
    recordAction(room, playerId, 'bomb', row, col, 'bomb');
    recordTimeline(room, playerId, 'bomb');
    checkGameEndVS(room);
  } else {
    if (cell.number === 0) {
      const cascaded = performCascade(room.board, room.rows, room.cols, row, col);
      const newlyRevealed = [];
      for (const ck of cascaded) {
        const [cr, cc] = ck.split(',').map(Number);
        if (room.revealedBy[cr][cc] === null && !(room.autoOpenedCells && room.autoOpenedCells.has(ck))) {
          room.revealedBy[cr][cc] = playerId;
          room.scores[playerId].cells++;
          room.revealedCount++;
          newlyRevealed.push({ row: cr, col: cc, number: room.board[cr][cc].number });
        }
      }
      if (newlyRevealed.length > 0) {
        io.to(room.code).emit('cellsRevealed', { cells: newlyRevealed, playerId, scores: getScoresArray(room) });
        recordAction(room, playerId, 'dig', row, col, cell.number);
        recordTimeline(room, playerId, 'dig');
      }
    } else {
      room.revealedBy[row][col] = playerId;
      room.scores[playerId].cells++;
      room.revealedCount++;
      io.to(room.code).emit('cellsRevealed', { cells: [{ row, col, number: cell.number }], playerId, scores: getScoresArray(room) });
      recordAction(room, playerId, 'dig', row, col, cell.number);
      recordTimeline(room, playerId, 'dig');
    }
    checkGameEndVS(room);
  }
}

// ============================================================
// FLAG HANDLERS
// ============================================================
function handleFlagSolo(room, playerId, row, col, socket) {
  const st = room.soloState[playerId];
  if (!st || st.finished) return;
  const key = `${row},${col}`;
  if (st.revealedBy[row][col] !== null) return;
  if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;

  if (st.flags.has(key)) {
    st.flags.delete(key);
    socket.emit('flagUpdate', { row, col, flagged: false });
    recordAction(room, playerId, 'unflag', row, col);
  } else {
    st.flags.add(key);
    socket.emit('flagUpdate', { row, col, flagged: true });
    recordAction(room, playerId, 'flag', row, col);
  }
}

function handleFlagCoop(room, playerId, row, col) {
  const key = `${row},${col}`;
  if (room.revealedBy[row][col] !== null) return;
  if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;

  if (!room.coopFlags) room.coopFlags = new Set();
  if (room.coopFlags.has(key)) {
    room.coopFlags.delete(key);
    io.to(room.code).emit('coopFlagUpdate', { row, col, flagged: false });
    recordAction(room, playerId, 'unflag', row, col);
  } else {
    room.coopFlags.add(key);
    io.to(room.code).emit('coopFlagUpdate', { row, col, flagged: true });
    recordAction(room, playerId, 'flag', row, col);
  }
}

function handleFlagVS(room, playerId, row, col, socket) {
  if (!room.revealedBy) return;
  const penalty = room.penalties[playerId];
  if (penalty && Date.now() < penalty.until) { socket.emit('penalized'); return; }

  const key = `${row},${col}`;
  if (room.revealedBy[row][col] !== null) return;
  if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;

  const flags = room.flagsByPlayer[playerId];
  if (flags.has(key)) {
    flags.delete(key);
    socket.emit('flagUpdate', { row, col, flagged: false });
    recordAction(room, playerId, 'unflag', row, col);
  } else {
    flags.add(key);
    socket.emit('flagUpdate', { row, col, flagged: true });
    recordAction(room, playerId, 'flag', row, col);
  }
}

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || process.env.EXP_PORT || 3001;
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
  console.log('  OURS SWEEPER - Experiment Server Running!');
  console.log('='.repeat(50));
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('='.repeat(50));
});
