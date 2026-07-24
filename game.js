'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#eeff00', // J - amarillo fosforito
  '#ffb74d', // L - orange
  '#b0bec5', // Tuerca - gris metálico
  '#ff5252', // Bomba - rojo
];

const BOMB_TYPE = 9;
const BOMB_LINE_INTERVAL = 5; // líneas para garantizar una bomba
const BOMB_CHANCE = 0.05;     // chance extra por spawn

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca 3x3 hueca
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// --- Configuración del sistema de habilidades cargables ---
// La barra de energía va de 0 a MAX_ENERGY. Se llena al limpiar líneas: cuantas
// más líneas se limpian de golpe, más energía se gana (premia los Tetris).
// Índice = nº de líneas limpiadas simultáneamente (0 a 4), igual que LINE_SCORES.
const MAX_ENERGY = 100;
const ENERGY_GAIN = [0, 20, 45, 70, 100];

// Nº de piezas "extra" que se mantienen preparadas por delante de `next`,
// para poder mostrar 5 piezas en total (next + UPCOMING_COUNT) cuando se
// activa la habilidad de Visión.
const UPCOMING_COUNT = 4;

// Duración (en milisegundos) que permanece visible el panel de Visión
// una vez que la habilidad se activa automáticamente al llenar la barra.
const VISION_DURATION = 10000;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');

// --- Elementos del sistema de habilidades cargables (barra de energía + habilidad "Visión") ---
const energyBarFill = document.getElementById('energy-bar-fill');
const visionPanel = document.getElementById('vision-panel');
const visionCanvas = document.getElementById('vision-canvas');
const visionCtx = visionCanvas.getContext('2d');
const visionTimerEl = document.getElementById('vision-timer');

const THEME_KEY = 'tetris-theme';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, linesSinceBomb;
let gridColor = '#22222e';

// --- Estado del sistema de habilidades cargables ---
let upcoming;      // array con las UPCOMING_COUNT piezas que vienen después de `next`
let energy;         // energía actual de la barra (0 a MAX_ENERGY)
let skillActive;    // true mientras la habilidad de Visión está activa
let skillTimer;     // milisegundos restantes de la habilidad activa

function applyTheme(isLight) {
  document.body.classList.toggle('light-theme', isLight);
  themeToggle.checked = isLight;
  gridColor = getComputedStyle(document.body).getPropertyValue('--grid-line-color').trim();
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
}

applyTheme(localStorage.getItem(THEME_KEY) === 'light');
themeToggle.addEventListener('change', () => applyTheme(themeToggle.checked));

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  let type;
  if (linesSinceBomb >= BOMB_LINE_INTERVAL || Math.random() < BOMB_CHANCE) {
    type = BOMB_TYPE;
    linesSinceBomb = 0;
  } else {
    type = Math.floor(Math.random() * 8) + 1;
  }
  const shape = type === BOMB_TYPE ? [[BOMB_TYPE]] : PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

// Rellena la cola `upcoming` hasta tener UPCOMING_COUNT piezas preparadas.
// Se usa al iniciar la partida y cada vez que se saca una pieza de la cola
// en spawn(), de forma que siempre haya piezas listas para la habilidad de Visión.
function fillUpcoming() {
  while (upcoming.length < UPCOMING_COUNT) {
    upcoming.push(randomPiece());
  }
}

// Suma energía a la barra según el nº de líneas limpiadas de una vez
// (usa ENERGY_GAIN, que premia más los clears múltiples). Si la barra
// llega al máximo, activa automáticamente la habilidad de Visión.
function gainEnergy(cleared) {
  if (!cleared || skillActive) return; // no acumular energía mientras la habilidad ya está activa
  energy = Math.min(MAX_ENERGY, energy + (ENERGY_GAIN[cleared] || 0));
  updateEnergyBar();
  if (energy >= MAX_ENERGY) {
    activateVisionSkill();
  }
}

// Refresca el ancho visual de la barra de energía según el valor actual.
function updateEnergyBar() {
  const pct = (energy / MAX_ENERGY) * 100;
  energyBarFill.style.width = `${pct}%`;
  energyBarFill.classList.toggle('energy-full', energy >= MAX_ENERGY);
}

// Activa la habilidad "Visión": muestra el panel con las 5 próximas piezas
// (la pieza `next` + las UPCOMING_COUNT de la cola `upcoming`) durante
// VISION_DURATION milisegundos y vacía la barra de energía.
function activateVisionSkill() {
  skillActive = true;
  skillTimer = VISION_DURATION;
  energy = 0;
  updateEnergyBar();
  visionPanel.classList.remove('hidden');
  drawVisionQueue();
}

// Desactiva la habilidad "Visión" cuando se agota el tiempo: oculta el panel.
function deactivateVisionSkill() {
  skillActive = false;
  skillTimer = 0;
  visionPanel.classList.add('hidden');
}

// Avanza el contador de tiempo de la habilidad activa; se llama cada frame
// desde loop(). Cuando llega a 0 desactiva la habilidad.
function updateSkillTimer(dt) {
  if (!skillActive) return;
  skillTimer -= dt;
  visionTimerEl.textContent = `${Math.ceil(Math.max(0, skillTimer) / 1000)}s`;
  if (skillTimer <= 0) {
    deactivateVisionSkill();
  }
}

// Dibuja en vision-canvas las 5 próximas piezas (next + upcoming), apiladas
// verticalmente, para que el jugador pueda planificar con antelación.
function drawVisionQueue() {
  const VB = 20; // tamaño de bloque reducido: 4 celdas x VB x 5 piezas = 400px = alto del canvas
  visionCtx.clearRect(0, 0, visionCanvas.width, visionCanvas.height);
  const queue = [next, ...upcoming];
  queue.forEach((piece, i) => {
    const shape = piece.shape;
    const offX = Math.floor((4 - shape[0].length) / 2);
    const offY = i * 4 + Math.floor((4 - shape.length) / 2);
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        drawBlock(visionCtx, offX + c, offY + r, shape[r][c], VB);
  });
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    linesSinceBomb += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    gainEnergy(cleared);
    updateHUD();
  }
}

function explodeBomb() {
  const cx = current.x;
  const cy = current.y;
  let destroyed = 0;
  for (let r = cy - 1; r <= cy + 1; r++) {
    for (let c = cx - 1; c <= cx + 1; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (board[r][c]) destroyed++;
      board[r][c] = 0;
    }
  }
  score += destroyed * 20 * level;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === BOMB_TYPE) {
    explodeBomb();
  } else {
    merge();
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  // La nueva "next" sale de la cola `upcoming`; luego se rellena la cola
  // para mantener siempre UPCOMING_COUNT piezas preparadas por delante.
  next = upcoming.shift();
  fillUpcoming();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  if (skillActive) drawVisionQueue(); // si la Visión está activa, refrescar el panel con la cola actualizada
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  if (colorIndex === BOMB_TYPE) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    const radius = size / 2 - 3;
    context.fillStyle = '#1a1a1a';
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx, cy, radius - 3, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ffd54f';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx + radius * 0.3, cy - radius * 0.6);
    context.lineTo(cx + radius * 0.9, cy - radius * 1.1);
    context.stroke();
    context.globalAlpha = 1;
    return;
  }
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawBombRadius(gy) {
  ctx.strokeStyle = 'rgba(255,82,82,0.6)';
  ctx.lineWidth = 2;
  const x0 = Math.max(0, current.x - 1);
  const y0 = Math.max(0, gy - 1);
  const x1 = Math.min(COLS, current.x + 2);
  const y1 = Math.min(ROWS, gy + 2);
  ctx.strokeRect(x0 * BLOCK, y0 * BLOCK, (x1 - x0) * BLOCK, (y1 - y0) * BLOCK);
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  if (current.type === BOMB_TYPE) drawBombRadius(gy);
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  updateSkillTimer(dt);
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  linesSinceBomb = 0;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();

  // Reinicio del sistema de habilidades cargables
  upcoming = [];
  fillUpcoming();
  energy = 0;
  updateEnergyBar();
  deactivateVisionSkill();

  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
