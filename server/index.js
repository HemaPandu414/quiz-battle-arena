import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { randomInt, randomUUID } from 'node:crypto';
import { QUESTION_BANK } from './questions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 25000, pingTimeout: 20000 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  return code;
}
function cleanName(value) { return String(value ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18); }
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, isHost: p.id === room.hostId, answered: room.answers.has(p.id) }));
}
function safeQuestion(q) { return { category: q.category, difficulty: q.difficulty, question: q.question, options: q.options }; }
function broadcastRoom(room) {
  io.to(room.code).emit('room:update', { code: room.code, phase: room.phase, settings: room.settings, players: publicPlayers(room), questionIndex: room.questionIndex, totalQuestions: room.questions.length, deadline: room.deadline });
}
function sendQuestion(room) {
  const q = room.questions[room.questionIndex];
  room.phase = 'question'; room.answers = new Map(); room.deadline = Date.now() + room.settings.secondsPerQuestion * 1000;
  io.to(room.code).emit('game:question', { index: room.questionIndex, total: room.questions.length, question: safeQuestion(q), deadline: room.deadline });
  broadcastRoom(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => finishQuestion(room.code), room.settings.secondsPerQuestion * 1000);
}
function finishQuestion(code) {
  const room = rooms.get(code);
  if (!room || room.phase !== 'question') return;
  clearTimeout(room.timer);
  room.phase = 'reveal';
  const q = room.questions[room.questionIndex];
  io.to(room.code).emit('game:reveal', { answer: q.answer, explanation: q.explanation, scores: publicPlayers(room) });
  broadcastRoom(room);
  room.timer = setTimeout(() => {
    const current = rooms.get(code);
    if (!current || current.phase !== 'reveal') return;
    current.questionIndex += 1;
    if (current.questionIndex >= current.questions.length) finishGame(current);
    else sendQuestion(current);
  }, 2400);
}
function finishGame(room) {
  clearTimeout(room.timer);
  room.phase = 'finished'; room.deadline = null;
  const standings = publicPlayers(room).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  io.to(room.code).emit('game:finished', { standings, winner: standings[0] ?? null });
  broadcastRoom(room);
}
function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function leaveRoom(socket) {
  const room = getRoomForSocket(socket);
  if (!room) return;
  const playerId = socket.data.playerId;
  socket.leave(room.code);
  socket.data.roomCode = null;
  const player = room.players.get(playerId);
  if (player) {
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
  }
  if (room.phase === 'lobby' && room.hostId === playerId) {
    const next = [...room.players.values()].find(p => p.connected);
    if (next) room.hostId = next.id;
  }
  broadcastRoom(room);
  // Retain briefly for reconnection, then clean up empty rooms.
  setTimeout(() => {
    const current = rooms.get(room.code);
    if (!current) return;
    for (const [id, p] of current.players) if (!p.connected && Date.now() - (p.disconnectedAt || 0) > 120000) current.players.delete(id);
    if (!current.players.size) { clearTimeout(current.timer); rooms.delete(current.code); }
    else broadcastRoom(current);
  }, 121000);
}

io.on('connection', socket => {
  socket.on('room:create', (payload = {}, ack = () => {}) => {
    const name = cleanName(payload.name);
    if (!name) return ack({ ok: false, error: 'Enter a display name first.' });
    const count = Math.max(3, Math.min(12, Number(payload.questionCount) || 5));
    const seconds = Math.max(10, Math.min(45, Number(payload.secondsPerQuestion) || 15));
    const code = makeCode(); const playerId = randomUUID();
    const room = { code, hostId: playerId, phase: 'lobby', settings: { questionCount: count, secondsPerQuestion: seconds }, players: new Map(), answers: new Map(), questions: [], questionIndex: -1, deadline: null, timer: null };
    room.players.set(playerId, { id: playerId, name, score: 0, connected: true, socketId: socket.id });
    rooms.set(code, room); socket.join(code); socket.data.roomCode = code; socket.data.playerId = playerId;
    ack({ ok: true, code, playerId, room: { code, phase: room.phase, settings: room.settings, players: publicPlayers(room) } });
    broadcastRoom(room);
  });

  socket.on('room:join', (payload = {}, ack = () => {}) => {
    const code = String(payload.code ?? '').trim().toUpperCase();
    const name = cleanName(payload.name);
    const existingPlayerId = String(payload.playerId ?? '');
    const room = rooms.get(code);
    if (!name) return ack({ ok: false, error: 'Enter a display name first.' });
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code) || !room) return ack({ ok: false, error: 'That room code was not found. Check it and try again.' });
    if (room.phase !== 'lobby' && room.phase !== 'question' && room.phase !== 'reveal') return ack({ ok: false, error: 'This match has finished. Ask the host to create a new room.' });
    let player = existingPlayerId ? room.players.get(existingPlayerId) : null;
    if (player && player.connected && player.socketId !== socket.id) return ack({ ok: false, error: 'That player is already connected in this room.' });
    if (!player) {
      if (room.phase !== 'lobby') return ack({ ok: false, error: 'This match has already started, so new players cannot join.' });
      if (room.players.size >= 12) return ack({ ok: false, error: 'This room is full (12 players maximum).' });
      if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase() && p.connected)) return ack({ ok: false, error: 'That display name is already in use in this room.' });
      player = { id: randomUUID(), name, score: 0, connected: true, socketId: socket.id };
      room.players.set(player.id, player);
    } else {
      player.name = name; player.connected = true; player.socketId = socket.id; player.disconnectedAt = null;
    }
    socket.join(code); socket.data.roomCode = code; socket.data.playerId = player.id;
    ack({ ok: true, code, playerId: player.id, room: { code, phase: room.phase, settings: room.settings, players: publicPlayers(room), questionIndex: room.questionIndex, totalQuestions: room.questions.length, deadline: room.deadline }, reconnected: Boolean(existingPlayerId && existingPlayerId === player.id) });
    if (room.phase === 'question') socket.emit('game:question', { index: room.questionIndex, total: room.questions.length, question: safeQuestion(room.questions[room.questionIndex]), deadline: room.deadline });
    if (room.phase === 'reveal') { const q = room.questions[room.questionIndex]; socket.emit('game:reveal', { answer: q.answer, explanation: q.explanation, scores: publicPlayers(room) }); }
    broadcastRoom(room);
  });

  socket.on('game:start', (payload = {}, ack = () => {}) => {
    const room = getRoomForSocket(socket);
    if (!room) return ack({ ok: false, error: 'Join a room before starting.' });
    if (socket.data.playerId !== room.hostId) return ack({ ok: false, error: 'Only the host can start the match.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'This match has already started.' });
    if ([...room.players.values()].filter(p => p.connected).length < 2) return ack({ ok: false, error: 'At least two connected players are needed to start.' });
    const shuffled = [...QUESTION_BANK].sort(() => Math.random() - 0.5);
    room.questions = shuffled.slice(0, Math.min(room.settings.questionCount, shuffled.length));
    room.questionIndex = 0; for (const p of room.players.values()) p.score = 0;
    ack({ ok: true }); sendQuestion(room);
  });

  socket.on('game:answer', (payload = {}, ack = () => {}) => {
    const room = getRoomForSocket(socket);
    if (!room || room.phase !== 'question') return ack({ ok: false, error: 'There is no active question right now.' });
    const playerId = socket.data.playerId;
    const player = room.players.get(playerId);
    if (!player || !player.connected) return ack({ ok: false, error: 'You are not connected to this room.' });
    if (room.answers.has(playerId)) return ack({ ok: false, error: 'Your answer has already been submitted.' });
    if (Date.now() >= room.deadline) return ack({ ok: false, error: 'Time is up for this question.' });
    const option = Number(payload.option);
    if (!Number.isInteger(option) || option < 0 || option > 3) return ack({ ok: false, error: 'Choose one of the four available options.' });
    const correct = option === room.questions[room.questionIndex].answer;
    const remaining = Math.max(0, room.deadline - Date.now());
    const points = correct ? 100 + Math.floor(50 * remaining / (room.settings.secondsPerQuestion * 1000)) : 0;
    room.answers.set(playerId, { option, correct, points });
    player.score += points;
    ack({ ok: true, correct, points });
    io.to(room.code).emit('game:answer-status', { playerId, answeredCount: room.answers.size, playerCount: [...room.players.values()].filter(p => p.connected).length });
    broadcastRoom(room);
    if (room.answers.size >= [...room.players.values()].filter(p => p.connected).length) finishQuestion(room.code);
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'quiz-battle-arena', activeRooms: rooms.size }));
if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
server.listen(PORT, '0.0.0.0', () => console.log(`Quiz Battle Arena server listening on port ${PORT}`));
