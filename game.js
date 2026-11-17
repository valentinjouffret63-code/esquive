'use strict';
// Esquive — jeu d'esquive de balles rebondissantes. Tout est dessiné au canvas, aucun fichier image.
(() => {
  // ---------- Réglages de jeu (unités logiques : hauteur d'écran = 640) ----------
  const H = 640;              // hauteur logique
  const LAND = 135;           // hauteur du sol depuis le bas
  const GAUGE_TIME = 10;      // secondes pour remplir la jauge (change d'ambiance à chaque tour)
  const BALL_R = 40;          // rayon d'une balle de taille 1
  const HEAD_R = 21;          // rayon de la zone touchable du perso
  const HEAD_Y = 30;          // centre de cette zone au-dessus du sol
  const GAIN_R = 30;          // rayon de ramassage d'un bonus
  const MOVE_SPEED = 468;     // vitesse du perso (px/s)
  const EDGE = 20;            // marge aux bords
  const GRAV = 1000;          // gravité des balles
  const GAIN_GRAV = 2000;
  const RETRY_DELAY = 0.8;    // anti-tap accidentel après la mort

  const BALL_COLORS = ['#ff5d73', '#3ee6b0', '#4cb8ff', '#ffd23f', '#b07cff'];
  const PALETTES = [
    { name: 'Nuit',   top: '#0b1030', bot: '#2a2560', hillA: '#1c1a45', hillB: '#25205a', ground: '#141233', edge: '#7a6cff' },
    { name: 'Aube',   top: '#1a0f2e', bot: '#6b2d5c', hillA: '#3a1840', hillB: '#4d1f4f', ground: '#22102a', edge: '#ff7aa8' },
    { name: 'Océan',  top: '#03182a', bot: '#0c4a6e', hillA: '#062d45', hillB: '#0a3a57', ground: '#021622', edge: '#3ee6b0' },
    { name: 'Braise', top: '#1f0a0a', bot: '#5c1d14', hillA: '#34110c', hillB: '#451811', ground: '#1a0806', edge: '#ffb03f' },
    { name: 'Forêt',  top: '#07160f', bot: '#1b4a33', hillA: '#0c2a1c', hillB: '#123724', ground: '#06130c', edge: '#9cff6b' },
  ];
  const FONT = "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, -apple-system, sans-serif";

  // ---------- Utilitaires ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randStep = (a, b, step) => a + step * Math.floor(Math.random() * (Math.floor((b - a) / step + 1e-9) + 1));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indispo */ } };
  const fmt = (s) => (Math.floor(s * 100) / 100).toFixed(2);

  // Tirage sans répétition immédiate (sac mélangé).
  class Bag {
    constructor(n) { this.n = n; this.items = []; this.last = -1; }
    next() {
      if (!this.items.length) {
        this.items = [...Array(this.n).keys()];
        for (let i = this.n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.items[i], this.items[j]] = [this.items[j], this.items[i]]; }
        if (this.items[this.items.length - 1] === this.last && this.n > 1) [this.items[0], this.items[this.items.length - 1]] = [this.items[this.items.length - 1], this.items[0]];
      }
      this.last = this.items.pop();
      return this.last;
    }
  }

  // ---------- Écran, rotation, zones sûres ----------
  const stage = document.getElementById('stage');
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const probe = document.getElementById('probe');
  let LW = 0, LH = 0, dpr = 1, scale = 1, W = 1136, offX = 0, totalW = 1136, rot = 0, iw = 0, ih = 0;
  let flip = load('esquive.flip', false); // sens de rotation quand le téléphone est verrouillé en portrait

  function layout() {
    iw = window.innerWidth; ih = window.innerHeight;
    if (!iw || !ih) return; // fenêtre pas encore dimensionnée
    const portrait = ih > iw;
    rot = portrait ? (flip ? -90 : 90) : 0;
    LW = portrait ? ih : iw; LH = portrait ? iw : ih;
    stage.style.width = LW + 'px'; stage.style.height = LH + 'px';
    if (rot === 90) stage.style.transform = `translate(${iw}px,0) rotate(90deg)`;
    else if (rot === -90) stage.style.transform = `translate(0,${ih}px) rotate(-90deg)`;
    else stage.style.transform = 'none';
    const s = getComputedStyle(probe);
    const t = parseFloat(s.paddingTop) || 0, r = parseFloat(s.paddingRight) || 0;
    const b = parseFloat(s.paddingBottom) || 0, l = parseFloat(s.paddingLeft) || 0;
    let insL, insR;
    if (rot === 90) { insL = t; insR = b; } else if (rot === -90) { insL = b; insR = t; } else { insL = l; insR = r; }
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(LW * dpr); cv.height = Math.round(LH * dpr);
    cv.style.width = LW + 'px'; cv.style.height = LH + 'px';
    scale = LH / H;
    totalW = LW / scale;
    offX = insL / scale;
    W = (LW - insL - insR) / scale;
    bgCache.clear(); spriteCache.clear();
    if (player) player.x = clamp(player.x, EDGE, W - EDGE);
  }

  // Coordonnées écran -> coordonnées du jeu (paysage).
  function toLand(cx, cy) {
    if (rot === 90) return { x: cy, y: iw - cx };
    if (rot === -90) return { x: ih - cy, y: cx };
    return { x: cx, y: cy };
  }
  const toWorld = (p) => ({ x: p.x / scale - offX, y: p.y / scale });

  // ---------- Son (synthétisé, aucun fichier) ----------
  let ac = null, master = null;
  let muted = load('esquive.muted', false);
  function audioUnlock() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ac.destination);
        const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination); src.start(0);
      } catch (e) { ac = null; }
    }
    if (ac && ac.state !== 'running') ac.resume();
  }
  function tone(f1, f2, dur, type, vol, delay = 0) {
    if (!ac || muted) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  let noiseBuf = null;
  function noise(dur, vol, cutoff, delay = 0) {
    if (!ac || muted) return;
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
  }
  const sfx = {
    bounce(sizeIdx) { const f = [150, 120, 95][sizeIdx] || 120; tone(f, f * 0.55, 0.14, 'sine', 0.5); noise(0.05, 0.12, 900); },
    pickup() { tone(880, 1100, 0.08, 'triangle', 0.3); tone(1320, 1500, 0.12, 'triangle', 0.28, 0.07); },
    gauge() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.2, i * 0.07)); },
    die() { noise(0.45, 0.6, 3000); tone(420, 55, 0.5, 'sawtooth', 0.25); tone(90, 40, 0.35, 'sine', 0.6); },
    ui() { tone(660, 990, 0.06, 'square', 0.12); },
    record() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.18, 0.35 + i * 0.09)); },
  };
  function setMuted(m) { muted = m; save('esquive.muted', m); if (master) master.gain.value = m ? 0 : 0.55; }

  // ---------- État du jeu ----------
  let state = 'menu';        // menu | play | dying | over | pause
  let clock = 0;             // horloge d'animation
  let score = 0, best = load('esquive.best', 0), history = load('esquive.history', []);
  let newRecord = false, overT = 0, deathT = 0;
  let balls = [], gains = [], particles = [], floaters = [];
  let spawnTimer = 0, nextSpawn = 1, burstLeft = 0, burstTimer = 0, gainTimer = -1, spawnDir = 1, menuSpawn = 0;
  let paletteIdx = 0, paletteFrom = 0, paletteFade = 1, gaugeLap = 0, groundFlash = 0, gaugePulse = 0;
  let shake = 0, zoomT = 1, redFlash = 0, scorePop = 0;
  const colorBag = new Bag(BALL_COLORS.length), paletteBag = new Bag(PALETTES.length);
  const player = { x: 568, dir: 0, phase: 0, look: 0, visible: true };

  // Contrôles : moitié gauche / moitié droite de l'écran, la dernière pression gagne.
  const presses = new Map(); let pressSeq = 0;
  function currentDir() {
    let bestT = -1, d = 0;
    presses.forEach((p) => { if (p.t > bestT) { bestT = p.t; d = p.side; } });
    return d;
  }

  function nextSpawnTime() { return score < 10 ? 1 : score < 20 ? 0.7 : 0.5; }

  function spawnBall() {
    let jh = rand(200, 540);
    const overGauge = H - LAND - 25;
    if (jh > overGauge && Math.random() < 0.5) jh = rand(200, overGauge);
    spawnDir = -spawnDir;
    const vx = randStep(150, 240, 20) * spawnDir;
    const size = randStep(1, 1.4, 0.2);
    const sizeIdx = Math.round((size - 1) / 0.2);
    const r = BALL_R * size;
    const x = spawnDir > 0 ? -r - vx : W + r - vx; // apparaît 1 s plus tard, annoncé par un repère sur le côté
    balls.push({
      x, y: jh, vx, vy: 0, r, size, sizeIdx, c: colorBag.next(), jv: Math.sqrt(2 * GRAV * jh),
      rot: Math.random() * 6.28, rs: lerp(180, 360, clamp((Math.abs(vx) - 150) / 90, 0, 1)) * Math.sign(vx) * Math.PI / 180,
      squash: 0,
    });
  }

  function spawnGain() {
    gains.push({
      x: rand(100, W - 100), y: H + 15, vx: (Math.random() < 0.5 ? 1 : -1) * rand(0, 50), vy: 0,
      value: randStep(1, 3, 1), rot: 0, rs: rand(0.5, 1) * 400 * Math.PI / 180, resting: false, age: 0,
    });
    gains[gains.length - 1].rs *= gains[gains.length - 1].vx < 0 ? -1 : 1;
  }

  function startGame() {
    balls = []; gains = []; particles = []; floaters = [];
    score = 0; spawnTimer = 0; nextSpawn = nextSpawnTime(); burstLeft = 4; burstTimer = 0;
    gainTimer = randStep(3, 5, 1); spawnDir = Math.random() < 0.5 ? -1 : 1;
    gaugeLap = 0; newRecord = false;
    player.x = W / 2; player.dir = 0; player.visible = true;
    presses.clear();
    state = 'play';
    sfx.ui();
  }

  function die(ball) {
    state = 'dying'; deathT = 0; player.visible = false;
    shake = 0.6; zoomT = 0; redFlash = 1;
    const hx = player.x, hy = LAND + HEAD_Y;
    for (let i = 0; i < 46; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(120, 620);
      particles.push({
        x: hx, y: hy, vx: Math.cos(a) * sp + (ball.vx * 0.4), vy: Math.sin(a) * sp + 250,
        r: rand(3, 8), c: i % 3 === 0 ? '#f6f2e8' : BALL_COLORS[ball.c], life: rand(0.7, 1.4), age: 0,
      });
    }
    sfx.die();
    const s = Math.floor(score * 100) / 100;
    if (s > best) { best = s; newRecord = true; save('esquive.best', best); sfx.record(); }
    history.push({ s, d: Date.now() });
    history.sort((a, b) => b.s - a.s); history = history.slice(0, 10);
    save('esquive.history', history);
  }

  // ---------- Mise à jour ----------
  function updateBalls(h, live) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.x += b.vx * h;
      if ((b.vx > 0 && b.x > W + b.r) || (b.vx < 0 && b.x < -b.r)) { balls.splice(i, 1); continue; }
      b.vy -= GRAV * h; b.y += b.vy * h;
      if (b.y <= LAND + b.r) {
        b.y = LAND + b.r; b.vy = b.jv; b.squash = 1;
        if (live && Math.abs(b.x - player.x) < 280) sfx.bounce(b.sizeIdx);
      }
      b.rot += b.rs * h;
      b.squash = Math.max(0, b.squash - h * 7);
    }
  }

  function update(h) {
    clock += h;
    shake = Math.max(0, shake - h);
    redFlash = Math.max(0, redFlash - h * 1.6);
    groundFlash = Math.max(0, groundFlash - h * 1.5);
    gaugePulse = Math.max(0, gaugePulse - h * 3);
    scorePop = Math.max(0, scorePop - h * 4);
    if (zoomT < 1) zoomT = Math.min(1, zoomT + h / 0.6);
    if (paletteFade < 1) paletteFade = Math.min(1, paletteFade + h);

    if (state === 'pause') return;

    if (state === 'play') {
      // Perso
      player.dir = currentDir();
      player.x = clamp(player.x + player.dir * MOVE_SPEED * h, EDGE, W - EDGE);
      if (player.dir) player.phase += h * 17;
      // Score = temps de survie
      score += h;
      const lap = Math.floor(score / GAUGE_TIME);
      if (lap > gaugeLap) {
        gaugeLap = lap; paletteFrom = paletteIdx;
        let n = paletteBag.next(); if (n === paletteIdx) n = paletteBag.next();
        paletteIdx = n; paletteFade = 0; groundFlash = 1; sfx.gauge();
      }
      // Apparition des balles
      spawnTimer += h;
      if (spawnTimer >= nextSpawn) { spawnTimer = 0; nextSpawn = nextSpawnTime(); spawnBall(); }
      if (burstLeft > 0) { burstTimer += h; if (burstTimer >= 1) { burstTimer -= 1; burstLeft--; spawnBall(); } }
      // Bonus
      if (gainTimer >= 0) { gainTimer -= h; if (gainTimer < 0) spawnGain(); }
      updateBalls(h, true);
      // Collisions
      const hx = player.x, hy = LAND + HEAD_Y;
      for (const b of balls) {
        const dx = b.x - hx, dy = b.y - hy, rr = HEAD_R + b.r;
        if (dx * dx + dy * dy < rr * rr) { die(b); break; }
      }
      if (state === 'play') {
        for (let i = gains.length - 1; i >= 0; i--) {
          const g = gains[i], dx = g.x - hx, dy = g.y - hy, rr = HEAD_R + GAIN_R;
          if (dx * dx + dy * dy < rr * rr) {
            score += g.value; scorePop = 1; gaugePulse = 1;
            floaters.push({ x: g.x, y: g.y + 20, text: '+' + g.value, age: 0 });
            gains.splice(i, 1); gainTimer = randStep(3, 5, 1); sfx.pickup();
          }
        }
      }
    } else if (state === 'menu') {
      menuSpawn -= h;
      if (menuSpawn <= 0 && balls.length < 4) { menuSpawn = 1.6; spawnBall(); }
      updateBalls(h, false);
      player.dir = 0;
    } else {
      updateBalls(h, false);
      if (state === 'dying') { deathT += h; if (deathT > 0.9) { state = 'over'; overT = 0; } }
      if (state === 'over') overT += h;
    }

    // Bonus (physique)
    for (const g of gains) {
      g.age += h;
      if (g.resting) continue;
      g.vy -= GAIN_GRAV * h; g.y += g.vy * h; g.x = clamp(g.x + g.vx * h, 40, W - 40); g.rot += g.rs * h;
      if (g.y <= LAND + 10) {
        g.y = LAND + 10;
        if (g.vy > -100) { g.resting = true; g.vy = 0; } else g.vy = -g.vy * 0.3;
      }
    }
    // Particules
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.age += h;
      if (p.age > p.life) { particles.splice(i, 1); continue; }
      p.vy -= 1300 * h; p.x += p.vx * h; p.y += p.vy * h;
      if (p.y < LAND + p.r) { p.y = LAND + p.r; p.vy = -p.vy * 0.45; p.vx *= 0.7; }
    }
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.age += h; f.y += 60 * h; if (f.age > 0.9) floaters.splice(i, 1); }

    // Le perso regarde la balle la plus proche
    let near = null, nd = 1e9;
    for (const b of balls) { const d = Math.abs(b.x - player.x) + Math.abs(b.y - LAND); if (d < nd) { nd = d; near = b; } }
    const targetLook = near ? clamp((near.x - player.x) / 200, -1, 1) : 0;
    player.look = lerp(player.look, targetLook, Math.min(1, h * 10));
    player.lookUp = near ? clamp((near.y - LAND - HEAD_Y) / 300, -1, 1) : 0;
  }

  // ---------- Rendu ----------
  const bgCache = new Map(), spriteCache = new Map();

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

  // Décor pré-rendu (ciel, étoiles, collines, sol) pour chaque ambiance.
  function bgFor(idx) {
    if (bgCache.has(idx)) return bgCache.get(idx);
    const P = PALETTES[idx], k = dpr * scale;
    const c = makeCanvas(totalW * k, H * k), g = c.getContext('2d');
    g.scale(k, k);
    const gy = H - LAND;
    const sky = g.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, P.top); sky.addColorStop(1, P.bot);
    g.fillStyle = sky; g.fillRect(0, 0, totalW, gy + 2);
    // étoiles (pseudo-aléatoire fixe)
    let seed = 7 + idx * 101;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < totalW / 12; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.6; g.fillStyle = '#ffffff';
      const r = rnd() < 0.85 ? 1.2 : 2.2;
      g.beginPath(); g.arc(rnd() * totalW, rnd() * gy * 0.75, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // astre
    const mx = totalW * 0.78, my = 130;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 140);
    halo.addColorStop(0, P.edge + '55'); halo.addColorStop(1, P.edge + '00');
    g.fillStyle = halo; g.beginPath(); g.arc(mx, my, 140, 0, 7); g.fill();
    g.fillStyle = P.edge + 'cc'; g.beginPath(); g.arc(mx, my, 34, 0, 7); g.fill();
    g.fillStyle = P.top + '66'; g.beginPath(); g.arc(mx + 12, my - 8, 30, 0, 7); g.fill();
    // collines
    const hills = (color, base, amp, f1, f2, ph) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, gy + 2);
      for (let x = 0; x <= totalW + 10; x += 10) g.lineTo(x, base - amp * (0.6 * Math.sin(x * f1 + ph) + 0.4 * Math.sin(x * f2 + ph * 2)));
      g.lineTo(totalW + 10, gy + 2); g.closePath(); g.fill();
    };
    hills(P.hillA, gy - 120, 50, 0.004, 0.011, idx);
    hills(P.hillB, gy - 50, 30, 0.007, 0.017, idx + 2);
    // sol
    g.fillStyle = P.ground; g.fillRect(0, gy, totalW, LAND);
    g.fillStyle = P.edge; g.fillRect(0, gy, totalW, 4);
    g.globalAlpha = 0.07; g.fillStyle = '#ffffff';
    for (let x = 0; x < totalW; x += 64) g.fillRect(x, gy + 4, 2, LAND);
    for (let y = gy + 30; y < H; y += 34) g.fillRect(0, y, totalW, 2);
    g.globalAlpha = 1;
    bgCache.set(idx, c);
    return c;
  }

  // Balle pré-rendue (dégradé + bande qui tourne).
  function ballSprite(ci, sizeIdx) {
    const key = ci + '_' + sizeIdx;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const r = BALL_R * (1 + 0.2 * sizeIdx), pad = 14, k = dpr * scale;
    const s = (r + pad) * 2;
    const c = makeCanvas(s * k, s * k), g = c.getContext('2d');
    g.scale(k, k); g.translate(s / 2, s / 2);
    const col = BALL_COLORS[ci];
    const glow = g.createRadialGradient(0, 0, r * 0.8, 0, 0, r + pad);
    glow.addColorStop(0, col + '66'); glow.addColorStop(1, col + '00');
    g.fillStyle = glow; g.beginPath(); g.arc(0, 0, r + pad, 0, 7); g.fill();
    const body = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    body.addColorStop(0, '#ffffff'); body.addColorStop(0.18, col); body.addColorStop(1, shade(col, -0.45));
    g.fillStyle = body; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    // bande équatoriale (montre la rotation)
    g.save(); g.beginPath(); g.arc(0, 0, r, 0, 7); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = r * 0.16;
    g.beginPath(); g.ellipse(0, 0, r * 1.05, r * 0.32, 0, 0, 7); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(r * 0.55, -r * 0.05, r * 0.09, 0, 7); g.fill();
    g.restore();
    spriteCache.set(key, c);
    return c;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }

  const SY = (y) => H - y; // y vers le haut -> y écran

  function drawBall(b) {
    const spr = ballSprite(b.c, b.sizeIdx), k = dpr * scale, s = spr.width / k;
    const sx = b.x, sy = SY(b.y);
    // ombre au sol
    const hgt = clamp((b.y - LAND - b.r) / 500, 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * (1 - hgt * 0.7)})`;
    ctx.beginPath(); ctx.ellipse(sx, H - LAND + 4, b.r * (1 - hgt * 0.5), 6 * (1 - hgt * 0.5), 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(sx, sy + b.squash * b.r * 0.12);
    const sq = b.squash * 0.18;
    ctx.scale(1 + sq, 1 - sq);
    ctx.rotate(b.rot);
    ctx.drawImage(spr, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  function drawPlayer() {
    if (!player.visible) return;
    const P = PALETTES[paletteIdx];
    const gy = H - LAND, x = player.x, moving = player.dir !== 0;
    const bob = moving ? Math.abs(Math.sin(player.phase)) * 4 : Math.sin(clock * 2.2) * 1.2;
    const cy = gy - HEAD_Y - bob;
    // ombre
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, gy + 4, 20, 5, 0, 0, 7); ctx.fill();
    // pieds
    const f = moving ? Math.sin(player.phase) * 7 : 0;
    ctx.fillStyle = '#2b2340';
    ctx.beginPath(); ctx.ellipse(x - 9 + f, gy - 4 + (moving ? Math.max(0, Math.sin(player.phase)) * -3 : 0), 8, 5, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 9 - f, gy - 4 + (moving ? Math.max(0, -Math.sin(player.phase)) * -3 : 0), 8, 5, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, cy); ctx.rotate(player.dir * 0.12);
    // antenne
    ctx.strokeStyle = '#f6f2e8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const sway = Math.sin(clock * 6) * 2 - player.dir * 7;
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.quadraticCurveTo(sway * 0.3, -32, sway, -40); ctx.stroke();
    ctx.fillStyle = P.edge; ctx.shadowColor = P.edge; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(sway, -41, 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    // corps
    const body = ctx.createRadialGradient(-7, -8, 3, 0, 0, 23);
    body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#d9d2c3');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill();
    // joues
    ctx.fillStyle = 'rgba(255,110,140,0.35)';
    ctx.beginPath(); ctx.ellipse(-13 + player.look * 3, 6, 4, 2.5, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13 + player.look * 3, 6, 4, 2.5, 0, 0, 7); ctx.fill();
    // yeux (suivent la balle la plus proche)
    const lx = player.look * 4, ly = -player.lookUp * 3;
    const blink = (clock % 3.7) < 0.12 ? 0.15 : 1;
    ctx.fillStyle = '#1d1730';
    ctx.beginPath(); ctx.ellipse(-7 + lx, -3 + ly, 3.6, 5.2 * blink, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7 + lx, -3 + ly, 3.6, 5.2 * blink, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawGain(g) {
    const sx = g.x, sy = SY(g.y);
    const cols = ['#ffd23f', '#ff5df0', '#33c4ff'];
    const col = cols[Math.floor(clock / 0.12) % 3];
    ctx.save(); ctx.translate(sx, sy);
    ctx.rotate(g.resting ? Math.sin(clock * 3) * 0.15 : g.rot);
    const pulse = 1 + Math.sin(clock * 8) * 0.05;
    ctx.scale(pulse, pulse);
    ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 11 : 24; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.rotate(g.resting ? 0 : -g.rot);
    ctx.fillStyle = '#1d1730'; ctx.font = `900 17px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+' + g.value, 0, 2);
    ctx.restore();
  }

  function tri(x, y, size, angle, color, alpha) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, -size * 0.85); ctx.lineTo(-size * 0.7, size * 0.85); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawIndicators() {
    const blinkA = 0.65 + 0.35 * Math.sin(clock * 14);
    for (const b of balls) {
      const col = BALL_COLORS[b.c], sz = 9 + 5 * b.size;
      if (b.vx > 0 && b.x < -b.r) tri(sz + 4, clamp(SY(b.y), 40, H - LAND - 12), sz, 0, col, blinkA);
      else if (b.vx < 0 && b.x > W + b.r) tri(W - sz - 4, clamp(SY(b.y), 40, H - LAND - 12), sz, Math.PI, col, blinkA);
      if (b.y - b.r > H - 25 && b.x > -b.r && b.x < W + b.r) tri(clamp(b.x, 12, W - 12), 32, sz, Math.PI / 2, col, 0.9);
    }
  }

  function text(str, x, y, size, color, weight = 800, align = 'center', alpha = 1) {
    ctx.globalAlpha = alpha; ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(str, x + 2, y + 3);
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // Boutons (coordonnées du monde)
  const buttons = () => {
    const list = [{ id: 'mute', x: W - 34, y: 36, r: 22 }];
    if (rot !== 0) list.push({ id: 'flip', x: 34, y: 36, r: 22 });
    return list;
  };
  function drawButtons() {
    for (const b of buttons()) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#f6f2e8'; ctx.fillStyle = '#f6f2e8'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (b.id === 'mute') {
        ctx.beginPath(); ctx.moveTo(b.x - 10, b.y - 4); ctx.lineTo(b.x - 5, b.y - 4); ctx.lineTo(b.x + 2, b.y - 10); ctx.lineTo(b.x + 2, b.y + 10); ctx.lineTo(b.x - 5, b.y + 4); ctx.lineTo(b.x - 10, b.y + 4); ctx.closePath(); ctx.fill();
        if (muted) { ctx.beginPath(); ctx.moveTo(b.x + 6, b.y - 5); ctx.lineTo(b.x + 12, b.y + 5); ctx.moveTo(b.x + 12, b.y - 5); ctx.lineTo(b.x + 6, b.y + 5); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(b.x + 3, b.y, 7, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(b.x + 3, b.y, 12, -0.8, 0.8); ctx.stroke(); }
      } else {
        ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0.5, 5.2); ctx.stroke();
        tri(b.x + 10 * Math.cos(5.2), b.y + 10 * Math.sin(5.2), 6, 5.2 + Math.PI / 2, '#f6f2e8', 1);
      }
    }
  }

  function drawHUD() {
    const P = PALETTES[paletteIdx];
    // jauge
    const frac = (score % GAUGE_TIME) / GAUGE_TIME;
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(0, 4, W, 10);
    ctx.fillStyle = gaugePulse > 0 ? '#ffffff' : P.edge;
    ctx.fillRect(0, 4, W * frac, 10);
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(clock * 20);
    ctx.fillRect(W * frac - 3, 2, 4, 14); ctx.globalAlpha = 1;
    // score
    const sc = 1 + scorePop * 0.25;
    ctx.save(); ctx.translate(W / 2, 62); ctx.scale(sc, sc);
    text(fmt(score), 0, 0, 52, '#ffffff', 900);
    ctx.restore();
    if (best > 0) text('★ ' + fmt(best), W - 20, 38, 20, 'rgba(255,255,255,0.7)', 700, 'right');
  }

  function drawPanel(lines) {
    const w = Math.min(560, W - 40), h = 300, x = W / 2 - w / 2, y = H / 2 - h / 2 - 50;
    ctx.fillStyle = 'rgba(10,8,30,0.72)'; roundRect(x, y, w, h, 26); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2; ctx.stroke();
    lines(x, y, w, h);
  }

  function drawHistory(cx, y, max) {
    const list = history.slice(0, max);
    if (!list.length) return;
    text('Meilleurs scores', cx, y, 16, 'rgba(255,255,255,0.55)', 700);
    list.forEach((e, i) => text(`${i + 1}.  ${fmt(e.s)}`, cx, y + 24 + i * 21, 17, i === 0 ? '#ffd23f' : 'rgba(255,255,255,0.8)', 700));
  }

  function drawMenu() {
    const P = PALETTES[paletteIdx];
    const t = clock;
    ctx.save(); ctx.translate(W / 2, 128 + Math.sin(t * 2) * 4); ctx.rotate(Math.sin(t * 1.3) * 0.02);
    text('ESQUIVE', 0, 0, 92, '#ffffff', 900);
    ctx.restore();
    text('Garde ta tête loin des balles', W / 2, 192, 20, P.edge, 700);
    text('◀  touche à gauche      touche à droite  ▶', W / 2, 232, 18, 'rgba(255,255,255,0.75)', 700);
    text('Touche pour jouer', W / 2, 290, 30, '#ffffff', 900, 'center', 0.55 + 0.45 * Math.sin(t * 4));
    if (best > 0) text('Record : ' + fmt(best), W / 2, 335, 20, '#ffd23f', 800);
    drawButtons();
  }

  function drawOver() {
    drawPanel((x, y, w) => {
      text('Touché !', W / 2, y + 44, 40, '#ff5d73', 900);
      text(fmt(Math.floor(score * 100) / 100), W / 2, y + 104, 64, '#ffffff', 900);
      if (newRecord) text('NOUVEAU RECORD', W / 2, y + 152, 22, '#ffd23f', 900, 'center', 0.6 + 0.4 * Math.sin(clock * 8));
      else text('Record : ' + fmt(best), W / 2, y + 152, 20, 'rgba(255,255,255,0.75)', 700);
      drawHistory(W / 2, y + 188, 3);
    });
    if (overT > RETRY_DELAY) text('Touche pour rejouer', W / 2, H / 2 + 135, 26, '#ffffff', 900, 'center', 0.55 + 0.45 * Math.sin(clock * 4));
    drawButtons();
  }

  function draw() {
    const k = dpr * scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // décor (fondu entre ambiances)
    const bgTo = bgFor(paletteIdx);
    ctx.drawImage(bgFor(paletteFrom), 0, 0);
    if (paletteFade < 1) { ctx.globalAlpha = paletteFade; ctx.drawImage(bgTo, 0, 0); ctx.globalAlpha = 1; }
    else ctx.drawImage(bgTo, 0, 0);

    ctx.setTransform(k, 0, 0, k, 0, 0);
    // tremblement + zoom à la mort
    if (shake > 0) { const a = 18 * (shake / 0.6); ctx.translate(rand(-a, a), rand(-a, a)); }
    if (zoomT < 1) { const z = 1 + 0.1 * Math.sin(zoomT * Math.PI); ctx.translate(totalW / 2, H / 2); ctx.scale(z, z); ctx.translate(-totalW / 2, -H / 2); }
    ctx.translate(offX, 0);

    if (groundFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${groundFlash * 0.5})`; ctx.fillRect(-offX, H - LAND, totalW, LAND); }

    for (const g of gains) drawGain(g);
    drawPlayer();
    const sorted = balls.slice().sort((a, b) => b.size - a.size); // petites balles devant
    for (const b of sorted) drawBall(b);
    for (const p of particles) {
      ctx.globalAlpha = clamp(1 - p.age / p.life, 0, 1); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, SY(p.y), p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const f of floaters) text(f.text, f.x, SY(f.y), 30, '#ffd23f', 900, 'center', 1 - f.age / 0.9);
    if (state === 'play' || state === 'dying' || state === 'pause') { drawIndicators(); drawHUD(); }

    if (state === 'menu') drawMenu();
    else if (state === 'over') { drawHUDLite(); drawOver(); }
    else if (state === 'pause') {
      ctx.fillStyle = 'rgba(5,5,20,0.55)'; ctx.fillRect(-offX, 0, totalW, H);
      text('Pause', W / 2, H / 2 - 20, 56, '#ffffff', 900);
      text('Touche pour reprendre', W / 2, H / 2 + 36, 24, 'rgba(255,255,255,0.8)', 700);
    }

    // bord rouge à l'impact
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (redFlash > 0) {
      const vg = ctx.createRadialGradient(totalW / 2, H / 2, H * 0.35, totalW / 2, H / 2, totalW * 0.6);
      vg.addColorStop(0, 'rgba(255,40,60,0)'); vg.addColorStop(1, `rgba(255,40,60,${0.75 * redFlash})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, totalW, H);
    }
  }
  function drawHUDLite() {
    const P = PALETTES[paletteIdx];
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(0, 4, W, 10);
    ctx.fillStyle = P.edge; ctx.fillRect(0, 4, W * ((score % GAUGE_TIME) / GAUGE_TIME), 10);
  }

  // ---------- Entrées ----------
  function hitButton(w) {
    for (const b of buttons()) {
      if ((w.x - b.x) ** 2 + (w.y - b.y) ** 2 < (b.r + 12) ** 2) {
        if (b.id === 'mute') { setMuted(!muted); if (!muted) sfx.ui(); }
        if (b.id === 'flip') { flip = !flip; save('esquive.flip', flip); layout(); }
        return true;
      }
    }
    return false;
  }

  function onDown(id, cx, cy) {
    audioUnlock();
    const lp = toLand(cx, cy), w = toWorld(lp);
    if (state === 'menu') { if (!hitButton(w)) startGame(); return; }
    if (state === 'over') { if (hitButton(w)) return; if (overT > RETRY_DELAY) startGame(); return; }
    if (state === 'pause') { state = 'play'; return; }
    if (state === 'play') presses.set(id, { side: lp.x < LW / 2 ? -1 : 1, t: ++pressSeq });
  }
  function onMove(id, cx, cy) {
    const p = presses.get(id); if (!p) return;
    const side = toLand(cx, cy).x < LW / 2 ? -1 : 1;
    if (side !== p.side) { p.side = side; p.t = ++pressSeq; }
  }
  function onUp(id) { presses.delete(id); audioUnlock(); }

  const opts = { passive: false };
  window.addEventListener('touchstart', (e) => { e.preventDefault(); for (const t of e.changedTouches) onDown(t.identifier, t.clientX, t.clientY); }, opts);
  window.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) onMove(t.identifier, t.clientX, t.clientY); }, opts);
  const end = (e) => { e.preventDefault(); for (const t of e.changedTouches) onUp(t.identifier); };
  window.addEventListener('touchend', end, opts);
  window.addEventListener('touchcancel', end, opts);
  // souris (test sur ordinateur)
  let mouseDown = false;
  window.addEventListener('mousedown', (e) => { mouseDown = true; onDown('m', e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mouseDown) onMove('m', e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { mouseDown = false; onUp('m'); });
  // clavier
  const keySide = { ArrowLeft: -1, KeyA: -1, KeyQ: -1, ArrowRight: 1, KeyD: 1 };
  window.addEventListener('keydown', (e) => {
    audioUnlock();
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (state === 'menu' || (state === 'over' && overT > RETRY_DELAY)) startGame();
      else if (state === 'pause') state = 'play';
      return;
    }
    if (keySide[e.code] && state === 'play') presses.set('k' + e.code, { side: keySide[e.code], t: ++pressSeq });
    else if (keySide[e.code] && state === 'pause') state = 'play';
  });
  window.addEventListener('keyup', (e) => presses.delete('k' + e.code));
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play') { state = 'pause'; presses.clear(); }
  });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => { layout(); setTimeout(layout, 300); });

  // ---------- Boucle ----------
  let last = performance.now();
  function frame(t) {
    requestAnimationFrame(frame);
    let dt = (t - last) / 1000; last = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 1 / 20);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) update(dt / steps);
    if (!LW || !LH) { layout(); return; }
    draw();
  }

  layout();
  paletteIdx = paletteFrom = paletteBag.next();
  player.x = W / 2;
  requestAnimationFrame(frame);

  // Expose un petit point d'entrée pour les tests.
  window.__esquive = { get state() { return state; }, get score() { return score; }, get balls() { return balls; }, get player() { return player; }, startGame };

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
