const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ROOMS
// ============================================================
const rooms = {}; // roomCode -> Room

function createRoom(code) {
  return {
    code,
    players: [],      // [{ id, socketId, name, color, ready }]
    state: 'waiting',  // waiting | colorSelect | countdown | playing | finished
    board: null,
    revealedBy: null,  // 30x30 array: null | playerId
    flagsByPlayer: {}, // playerId -> Set of "r,c"
    bombsRevealed: {}, // "r,c" -> true
    penalties: {},     // playerId -> { until: timestamp }
    scores: {},        // playerId -> { cells: 0, bombs: 0 }
    totalSafeCells: 0,
    revealedCount: 0,
    autoOpenedCells: null, // Set of "r,c"
  };
}

// ============================================================
// BOARD GENERATION
// ============================================================
function generateBoard(rows, cols, mineCount) {
  const board = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ mine: false, number: 0 }))
  );

  // Place mines
  let placed = 0;
  while (placed < mineCount) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!board[r][c].mine) {
      board[r][c].mine = true;
      placed++;
    }
  }

  // Calculate numbers
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].mine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].mine) {
            count++;
          }
        }
      }
      board[r][c].number = count;
    }
  }

  return board;
}

// Find a good auto-open position: a cell with number=0 that cascades to a big area
function findAutoOpenPosition(board, rows, cols) {
  let bestPos = null;
  let bestSize = 0;

  // Try random positions to find a good cascade
  const zeroCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!board[r][c].mine && board[r][c].number === 0) {
        zeroCells.push([r, c]);
      }
    }
  }

  // Evaluate each zero cell's cascade size
  for (const [r, c] of zeroCells) {
    const size = measureCascade(board, rows, cols, r, c);
    if (size > bestSize) {
      bestSize = size;
      bestPos = [r, c];
    }
  }

  // Fallback: if no zero cell, pick a safe cell
  if (!bestPos) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!board[r][c].mine) {
          bestPos = [r, c];
          break;
        }
      }
      if (bestPos) break;
    }
  }

  return bestPos;
}

function measureCascade(board, rows, cols, startR, startC) {
  const visited = new Set();
  const queue = [[startR, startC]];
  visited.add(`${startR},${startC}`);

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (board[r][c].number === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          const key = `${nr},${nc}`;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited.has(key) && !board[nr][nc].mine) {
            visited.add(key);
            queue.push([nr, nc]);
          }
        }
      }
    }
  }
  return visited.size;
}

function performCascade(board, rows, cols, startR, startC) {
  const revealed = new Set();
  const queue = [[startR, startC]];
  revealed.add(`${startR},${startC}`);

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (board[r][c].number === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          const key = `${nr},${nc}`;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !revealed.has(key) && !board[nr][nc].mine) {
            revealed.add(key);
            queue.push([nr, nc]);
          }
        }
      }
    }
  }
  return revealed;
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
    if (rooms[code]) {
      socket.emit('error', { message: 'This room code is already in use.' });
      return;
    }
    const room = createRoom(code);
    playerId = 'p1';
    room.players.push({ id: playerId, socketId: socket.id, name: playerName, color: null, ready: false });
    room.scores[playerId] = { cells: 0, bombs: 0 };
    room.penalties[playerId] = null;
    room.flagsByPlayer[playerId] = new Set();
    rooms[code] = room;
    currentRoom = code;
    socket.join(code);
    socket.emit('roomCreated', { code, playerId });
    console.log(`Room ${code} created by ${playerName}`);
  });

  // --- JOIN ROOM ---
  socket.on('joinRoom', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'Room not found.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error', { message: 'Room is full.' });
      return;
    }
    if (room.state !== 'waiting') {
      socket.emit('error', { message: 'Game already in progress.' });
      return;
    }
    playerId = 'p2';
    room.players.push({ id: playerId, socketId: socket.id, name: playerName, color: null, ready: false });
    room.scores[playerId] = { cells: 0, bombs: 0 };
    room.penalties[playerId] = null;
    room.flagsByPlayer[playerId] = new Set();
    currentRoom = code;
    socket.join(code);
    socket.emit('roomJoined', { code, playerId });

    // Both players present -> go to color select
    room.state = 'colorSelect';
    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(code).emit('goToColorSelect', { players: playerInfos });
    console.log(`${playerName} joined room ${code}`);
  });

  // --- COLOR SELECT ---
  socket.on('selectColor', ({ color }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'colorSelect') return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    // Check if color is already taken by other player
    const otherPlayer = room.players.find(p => p.id !== playerId);
    if (otherPlayer && otherPlayer.color === color) {
      socket.emit('colorTaken', { color });
      return;
    }

    player.color = color;
    io.to(currentRoom).emit('colorUpdate', {
      playerId,
      color,
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
      playerId,
      color: null,
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

    // Both ready? Start countdown
    if (room.players.every(p => p.ready)) {
      startCountdown(room);
    }
  });

  // --- GAME ACTIONS ---
  socket.on('dig', ({ row, col }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'playing') return;

    // Check penalty
    const penalty = room.penalties[playerId];
    if (penalty && Date.now() < penalty.until) {
      socket.emit('penalized');
      return;
    }

    const key = `${row},${col}`;

    // Already revealed?
    if (room.revealedBy[row][col] !== null) return;

    // Is it in auto-opened cells?
    if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;

    // Has a flag? Block dig (must remove flag first)
    const myFlags = room.flagsByPlayer[playerId];
    if (myFlags && myFlags.has(key)) return;

    const cell = room.board[row][col];

    if (cell.mine) {
      // BOMB HIT
      room.scores[playerId].bombs++;
      room.bombsRevealed[key] = true;
      room.revealedBy[row][col] = '__bomb__';
      room.revealedCount++;

      // 5 second penalty
      room.penalties[playerId] = { until: Date.now() + 5000 };

      io.to(currentRoom).emit('bombHit', {
        row, col, playerId,
        penaltyUntil: room.penalties[playerId].until,
        scores: getScores(room)
      });

      checkGameEnd(room);
    } else {
      // Safe cell - perform cascade if number is 0
      if (cell.number === 0) {
        const cascaded = performCascade(room.board, 30, 30, row, col);
        const newlyRevealed = [];
        for (const cellKey of cascaded) {
          const [cr, cc] = cellKey.split(',').map(Number);
          if (room.revealedBy[cr][cc] === null && !(room.autoOpenedCells && room.autoOpenedCells.has(cellKey))) {
            room.revealedBy[cr][cc] = playerId;
            room.scores[playerId].cells++;
            room.revealedCount++;
            newlyRevealed.push({ row: cr, col: cc, number: room.board[cr][cc].number });
          }
        }
        if (newlyRevealed.length > 0) {
          io.to(currentRoom).emit('cellsRevealed', {
            cells: newlyRevealed,
            playerId,
            scores: getScores(room)
          });
        }
      } else {
        // Single cell reveal
        room.revealedBy[row][col] = playerId;
        room.scores[playerId].cells++;
        room.revealedCount++;
        io.to(currentRoom).emit('cellsRevealed', {
          cells: [{ row, col, number: cell.number }],
          playerId,
          scores: getScores(room)
        });
      }

      checkGameEnd(room);
    }
  });

  socket.on('flag', ({ row, col }) => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'playing') return;

    const penalty = room.penalties[playerId];
    if (penalty && Date.now() < penalty.until) {
      socket.emit('penalized');
      return;
    }

    const key = `${row},${col}`;
    // Can't flag revealed cells
    if (room.revealedBy[row][col] !== null) return;
    if (room.autoOpenedCells && room.autoOpenedCells.has(key)) return;

    const flags = room.flagsByPlayer[playerId];
    if (flags.has(key)) {
      flags.delete(key);
      socket.emit('flagUpdate', { row, col, flagged: false });
    } else {
      flags.add(key);
      socket.emit('flagUpdate', { row, col, flagged: true });
    }
  });

  // --- RESTART / LEAVE ---
  socket.on('requestRestart', () => {
    const room = rooms[currentRoom];
    if (!room || room.state !== 'finished') return;

    // Reset for color select
    room.players.forEach(p => {
      p.color = null;
      p.ready = false;
    });
    room.state = 'colorSelect';
    room.board = null;
    room.revealedBy = null;
    room.bombsRevealed = {};
    room.scores = {};
    room.penalties = {};
    room.autoOpenedCells = null;
    room.revealedCount = 0;
    room.players.forEach(p => {
      room.scores[p.id] = { cells: 0, bombs: 0 };
      room.penalties[p.id] = null;
      room.flagsByPlayer[p.id] = new Set();
    });

    const playerInfos = room.players.map(p => ({ id: p.id, name: p.name }));
    io.to(currentRoom).emit('goToColorSelect', { players: playerInfos });
  });

  socket.on('leaveRoom', () => {
    handleDisconnect();
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    handleDisconnect();
  });

  function handleDisconnect() {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      io.to(currentRoom).emit('opponentLeft');
      delete rooms[currentRoom];
    }
    currentRoom = null;
    playerId = null;
  }
});

// ============================================================
// GAME FLOW
// ============================================================
function startCountdown(room) {
  room.state = 'countdown';

  // Generate board
  room.board = generateBoard(30, 30, 150);
  room.revealedBy = Array.from({ length: 30 }, () => Array(30).fill(null));
  room.totalSafeCells = 30 * 30 - 150;
  room.revealedCount = 0;

  // Find auto-open position
  const autoPos = findAutoOpenPosition(room.board, 30, 30);
  let autoOpenedCells = new Set();
  if (autoPos) {
    autoOpenedCells = performCascade(room.board, 30, 30, autoPos[0], autoPos[1]);
  }
  room.autoOpenedCells = autoOpenedCells;

  // Mark auto-opened cells as revealed (no owner)
  const autoOpenData = [];
  for (const key of autoOpenedCells) {
    const [r, c] = key.split(',').map(Number);
    room.revealedBy[r][c] = '__auto__';
    room.revealedCount++;
    autoOpenData.push({ row: r, col: c, number: room.board[r][c].number });
  }

  const playerInfos = room.players.map(p => ({ id: p.id, name: p.name, color: p.color }));

  // Send countdown start (5 seconds)
  io.to(room.code).emit('countdownStart', {
    duration: 5,
    players: playerInfos
  });

  // At 2 seconds remaining (3 seconds in), reveal auto-opened cells
  setTimeout(() => {
    io.to(room.code).emit('autoOpen', { cells: autoOpenData });
  }, 2000);

  // At 5 seconds, start game
  setTimeout(() => {
    room.state = 'playing';
    io.to(room.code).emit('gameStart');
  }, 5000);
}

function getScores(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    cells: room.scores[p.id].cells,
    bombs: room.scores[p.id].bombs
  }));
}

function checkGameEnd(room) {
  // Game ends when all safe cells + bombs are revealed
  const totalCells = 30 * 30;
  if (room.revealedCount >= totalCells) {
    endGame(room);
    return;
  }

  // Also check: all non-bomb cells revealed
  let allSafeRevealed = true;
  for (let r = 0; r < 30; r++) {
    for (let c = 0; c < 30; c++) {
      if (!room.board[r][c].mine && room.revealedBy[r][c] === null) {
        allSafeRevealed = false;
        break;
      }
    }
    if (!allSafeRevealed) break;
  }

  if (allSafeRevealed) {
    endGame(room);
  }
}

function endGame(room) {
  room.state = 'finished';

  const results = room.players.map(p => {
    const s = room.scores[p.id];
    const finalScore = s.cells + (s.bombs * -10);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      cells: s.cells,
      bombs: s.bombs,
      penalty: s.bombs * -10,
      finalScore
    };
  });

  // Determine winner
  results.sort((a, b) => b.finalScore - a.finalScore);
  let winner = null;
  if (results[0].finalScore > results[1].finalScore) {
    winner = results[0].id;
  } else if (results[0].finalScore < results[1].finalScore) {
    winner = results[1].id;
  }
  // else draw

  io.to(room.code).emit('gameEnd', { results, winner });
}

// ============================================================
// START SERVER
// ============================================================
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  // Get local IP for easy access
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  console.log('='.repeat(50));
  console.log('  OURS SWEEPER - Server Running!');
  console.log('='.repeat(50));
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('='.repeat(50));
  console.log('  Share the Network URL with your opponent!');
  console.log('='.repeat(50));
});
