// Ricochet Infinity — Native macOS HTML5/Canvas Engine
// Drives all 1,275 decoded .Frame/.Sequence sprites, 378 retail rounds, 27 ships, 33 power-ups, and 227 OGG audio tracks.

// 1. Invoker Commands API Feature Detection (per modern-web-guidance)
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  import('https://esm.sh/invokers-polyfill').catch(() => {
    // Offline fallback if CDN is unreachable
    document.querySelectorAll('button[commandfor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('commandfor');
        const cmd = btn.getAttribute('command');
        const target = document.getElementById(targetId);
        if (!target) return;
        const evt = new CustomEvent('command', { detail: { command: cmd } });
        evt.command = cmd;
        target.dispatchEvent(evt);
        if (cmd === 'show-modal' && typeof target.showModal === 'function') target.showModal();
        else if (cmd === 'close' && typeof target.close === 'function') target.close();
      });
    });
  });
}

// Playfield geometry inside the 800x600 Score Board Frame
const PLAYFIELD = {
  left: 14,
  top: 14,
  right: 626,
  bottom: 586,
  width: 612,
  height: 572,
  centerX: 320,
  centerY: 300,
};

function normalizeResKey(raw) {
  if (!raw || raw === '!None' || raw === '!none') return '';
  let s = String(raw).trim().replace(/\\/g, '/');
  s = s.replace(/^Resources\//i, '');
  s = s.replace(/\.(Sequence|Frame|BrickStyle|Background|PowerUp|Sound|png|ogg)$/i, '');
  return s;
}

function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

class SpriteManager {
  constructor(manifest) {
    this.manifest = manifest || {};
    this.images = new Map();
    this.loading = new Map();
  }

  resolveKey(rawKey) {
    const norm = normalizeResKey(rawKey);
    if (!norm) return null;
    if (this.manifest[norm]) return norm;
    const lower = norm.toLowerCase();
    if (this.manifest[lower]) return this.manifest[lower].key || lower;
    // Try Bricks/ prefix if style path omitted it
    if (this.manifest['bricks/' + lower]) return this.manifest['bricks/' + lower].key;
    if (this.manifest['power ups/' + lower]) return this.manifest['power ups/' + lower].key;
    return null;
  }

  getMeta(rawKey) {
    const key = this.resolveKey(rawKey);
    return key ? this.manifest[key] || this.manifest[key.toLowerCase()] : null;
  }

  getImage(rawKey) {
    const meta = this.getMeta(rawKey);
    if (!meta || !meta.url) return null;
    const key = meta.key;
    if (this.images.has(key)) return this.images.get(key);
    if (!this.loading.has(key)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = meta.url;
      img.onload = () => {
        this.images.set(key, img);
      };
      this.loading.set(key, img);
    }
    return null;
  }

  preloadKeys(keys) {
    for (const k of keys) {
      if (k && k !== '!None') this.getImage(k);
    }
  }

  draw(ctx, rawKey, x, y, options = {}) {
    const meta = this.getMeta(rawKey);
    if (!meta) return false;
    const img = this.getImage(rawKey);
    if (!img || !img.complete || img.naturalWidth === 0) return false;

    const frames = meta.frames;
    const additive = options.additive ?? Boolean(meta.additive);
    const alpha = options.alpha ?? 1.0;
    const scaleX = options.scaleX ?? options.scale ?? 1.0;
    const scaleY = options.scaleY ?? options.scale ?? 1.0;
    const rotation = options.rotation ?? 0;

    ctx.save();
    if (additive) ctx.globalCompositeOperation = 'lighter';
    if (alpha < 1.0) ctx.globalAlpha = Math.max(0, alpha);

    ctx.translate(x, y);
    if (rotation !== 0) ctx.rotate(rotation);
    if (scaleX !== 1.0 || scaleY !== 1.0) ctx.scale(scaleX, scaleY);

    if (frames && frames.length > 0) {
      let frameIdx = 0;
      if (typeof options.frameIndex === 'number') {
        frameIdx = Math.max(0, Math.min(frames.length - 1, Math.floor(options.frameIndex)));
      } else {
        const fps = options.fps || meta.fps || 20;
        const timeSec = options.time ?? (performance.now() / 1000);
        frameIdx = Math.floor(timeSec * fps) % frames.length;
      }
      const f = frames[frameIdx];
      if (!f || f.w <= 0 || f.h <= 0) {
        ctx.restore();
        return false;
      }
      const dx = options.topLeft ? 0 : (typeof f.ox === 'number' ? f.ox : -Math.floor(f.w / 2));
      const dy = options.topLeft ? 0 : (typeof f.oy === 'number' ? f.oy : -Math.floor(f.h / 2));
      ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
    } else {
      const w = meta.sheetW || img.naturalWidth;
      const h = meta.sheetH || img.naturalHeight;
      const dx = options.topLeft ? 0 : -Math.floor(w / 2);
      const dy = options.topLeft ? 0 : -Math.floor(h / 2);
      ctx.drawImage(img, 0, 0, w, h, dx, dy, w, h);
    }

    ctx.restore();
    return true;
  }
}

class AudioManager {
  constructor(audioManifest) {
    this.manifest = audioManifest || {};
    this.enabled = true;
    this.currentMusic = null;
    this.currentMusicUrl = null;
    this.lastPlayedAt = new Map();
  }

  resolveAudioUrl(rawName) {
    if (!rawName || rawName === '!None') return null;
    const clean = String(rawName)
      .replace(/\\/g, '/')
      .replace(/^Resources\/(Sounds|Music)\//i, '')
      .replace(/\.(Sound|ogg|wav)$/i, '')
      .trim();
    return (
      this.manifest[clean] ||
      this.manifest[clean.toLowerCase()] ||
      this.manifest['Music/' + clean] ||
      this.manifest['music/' + clean.toLowerCase()] ||
      null
    );
  }

  playSound(rawName, volume = 0.45) {
    if (!this.enabled || !rawName || rawName === '!None') return;
    const url = this.resolveAudioUrl(rawName);
    if (!url) return;

    const now = performance.now();
    const prev = this.lastPlayedAt.get(url) || 0;
    if (now - prev < 42) return;
    this.lastPlayedAt.set(url, now);

    const snd = new Audio(url);
    snd.volume = Math.min(1, Math.max(0, volume));
    snd.play().catch(() => {});
  }

  playMusicTrack(trackName) {
    if (!this.enabled || !trackName) return;
    const url = this.resolveAudioUrl(trackName) || this.resolveAudioUrl('Alien Vista');
    if (!url || url === this.currentMusicUrl) return;

    this.stopMusic();
    this.currentMusicUrl = url;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.28;
    audio.play().catch(() => {});
    this.currentMusic = audio;
  }

  stopMusic() {
    if (this.currentMusic) {
      this.currentMusic.pause();
      this.currentMusic = null;
      this.currentMusicUrl = null;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopMusic();
    return this.enabled;
  }
}

// Real-Time CBrickPlugIn Execution Runner (drives orbiting, patrolling, spring, and conditional bricks)
class BrickPluginRunner {
  constructor(brick, engine) {
    this.brick = brick;
    this.engine = engine;
    this.root = brick.raw.plugins ? this.compileNode(brick.raw.plugins) : null;
  }

  compileNode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const cls = raw.__class__ || raw.type || '';
    if (!cls) return null;

    const node = {
      cls,
      raw,
      children: [],
      activeIdx: 0,
      elapsed: 0,
      initialized: false,
      done: false,
      state: {},
    };

    if (cls === 'CBrickPlugInSimultaneous') {
      const container = raw['Simultaneous PlugIns'];
      const items = container ? asArray(container['Simultaneous PlugIn']) : [];
      node.children = items.map((c) => this.compileNode(c)).filter(Boolean);
    } else if (cls === 'CBrickPlugInSequence') {
      const container = raw['Steps'];
      const items = container ? asArray(container['Step']) : [];
      node.children = items.map((c) => this.compileNode(c)).filter(Boolean);
    }

    return node;
  }

  resetNode(node) {
    if (!node) return;
    node.activeIdx = 0;
    node.elapsed = 0;
    node.initialized = false;
    node.done = false;
    node.state = {};
    for (const c of node.children) this.resetNode(c);
  }

  resolvePosition(posObj) {
    if (!posObj || typeof posObj !== 'object') {
      return { x: this.brick.baseX, y: this.brick.baseY };
    }
    const targetName =
      (posObj.Position && posObj.Position.Name) ||
      posObj.Name ||
      posObj['Target Brick Name'];
    if (targetName) {
      return this.engine.findPivotPoint(targetName, this.brick);
    }
    if (posObj.X !== undefined && posObj.Y !== undefined) {
      return {
        x: PLAYFIELD.left + Number(posObj.X),
        y: PLAYFIELD.top + Number(posObj.Y),
      };
    }
    return { x: this.brick.baseX, y: this.brick.baseY };
  }

  update(dt) {
    if (this.root && !this.root.done) {
      this.updateNode(this.root, dt);
    }
  }

  updateNode(node, dt) {
    if (!node || node.done) return;
    const r = node.raw;

    switch (node.cls) {
      case 'CBrickPlugInSimultaneous': {
        for (const c of node.children) {
          this.updateNode(c, dt);
        }
        break;
      }

      case 'CBrickPlugInSequence': {
        if (node.children.length === 0) {
          node.done = true;
          break;
        }
        const curr = node.children[node.activeIdx];
        if (!curr) {
          node.activeIdx = 0;
          break;
        }
        this.updateNode(curr, dt);
        if (curr.done) {
          node.activeIdx++;
          if (node.activeIdx >= node.children.length) {
            // Loop sequences continuously unless they ended with DestroySelf
            const hasDestroy = node.children.some((c) => c.cls === 'CBrickPlugInDestroySelf');
            if (hasDestroy) {
              node.done = true;
            } else {
              node.activeIdx = 0;
              for (const c of node.children) this.resetNode(c);
            }
          }
        }
        break;
      }

      case 'CBrickPlugInOrbit': {
        const centerPt = this.resolvePosition(r.Center);
        if (!node.initialized) {
          node.initialized = true;
          const dx = this.brick.x - centerPt.x;
          const dy = this.brick.y - centerPt.y;
          node.state.radius = Math.hypot(dx, dy);
          node.state.angle = Math.atan2(dy, dx);
          node.state.traveled = 0;

          const dirStr = String(r.Direcion || r.Direction || 'Clockwise');
          const sign = dirStr.toLowerCase().includes('counter') ? -1 : 1;

          let angSpeed = (Math.PI * 2) / 5.0;
          const spdObj = r.Speed;
          if (spdObj && typeof spdObj === 'object') {
            const val = Number(spdObj.Speed || 4);
            if (spdObj.__class__ === 'CSecondsPerRotationOrbitSpeed' && val > 0) {
              angSpeed = (Math.PI * 2) / val;
            } else if (spdObj.__class__ === 'CRPMOrbitSpeed') {
              angSpeed = (val * Math.PI * 2) / 60;
            } else if (spdObj.__class__ === 'CPixelsPerSecondOrbitSpeed') {
              angSpeed = val / Math.max(16, node.state.radius);
            }
          }
          node.state.angVel = angSpeed * sign;
          const stopRot = Number(r.Stop || 0);
          node.state.maxAngle = stopRot > 0 ? stopRot * Math.PI * 2 : 0;
        }

        const stepAng = node.state.angVel * dt;
        node.state.angle += stepAng;
        node.state.traveled += Math.abs(stepAng);

        if (node.state.radius > 0.5) {
          this.brick.x = centerPt.x + Math.cos(node.state.angle) * node.state.radius;
          this.brick.y = centerPt.y + Math.sin(node.state.angle) * node.state.radius;
        }

        if (node.state.maxAngle > 0 && node.state.traveled >= node.state.maxAngle) {
          node.done = true;
        }
        break;
      }

      case 'CBrickPlugInMoveToPoint': {
        if (!node.initialized) {
          node.initialized = true;
          node.state.startX = this.brick.x;
          node.state.startY = this.brick.y;
          const endPt = this.resolvePosition(r['End Point']);
          node.state.endX = endPt.x;
          node.state.endY = endPt.y;
          const dist = Math.hypot(endPt.x - this.brick.x, endPt.y - this.brick.y);
          const timeToComplete = Number(r['Time To Complete'] || 0);
          node.state.duration =
            timeToComplete > 0 ? timeToComplete : Math.max(0.2, dist / 110);
          node.elapsed = 0;
        }
        node.elapsed += dt;
        const t = Math.min(1, node.elapsed / node.state.duration);
        // Smooth ease-in-out interpolation
        const smooth = t * t * (3 - 2 * t);
        this.brick.x = node.state.startX + (node.state.endX - node.state.startX) * smooth;
        this.brick.y = node.state.startY + (node.state.endY - node.state.startY) * smooth;
        if (t >= 1) node.done = true;
        break;
      }

      case 'CBrickPlugInSpring': {
        if (!node.initialized) {
          node.initialized = true;
          const ptsRaw = r['Points List'] && asArray(r['Points List'].Points);
          node.state.points =
            ptsRaw && ptsRaw.length >= 2
              ? ptsRaw.map((p) => this.resolvePosition(p))
              : [
                  { x: this.brick.baseX - 30, y: this.brick.baseY },
                  { x: this.brick.baseX + 30, y: this.brick.baseY },
                ];
          node.state.phase = Math.random() * Math.PI * 2;
        }
        node.state.phase += dt * 2.2;
        const p0 = node.state.points[0];
        const p1 = node.state.points[1];
        const w = (Math.sin(node.state.phase) + 1) * 0.5;
        this.brick.x = p0.x + (p1.x - p0.x) * w;
        this.brick.y = p0.y + (p1.y - p0.y) * w;
        break;
      }

      case 'CBrickPlugInWaitXSeconds': {
        if (!node.initialized) {
          node.initialized = true;
          node.state.wait = Number(r['Time To Wait'] || r.Seconds || 0.5);
          node.elapsed = 0;
        }
        node.elapsed += dt;
        if (node.elapsed >= node.state.wait) node.done = true;
        break;
      }

      case 'CBrickPlugInWaitForBrickToBeDestroyed': {
        const trigName = r['Trigger Brick'] && r['Trigger Brick'].Name;
        if (!trigName) {
          node.done = true;
          break;
        }
        const anyAlive = this.engine.bricks.some(
          (b) => b.alive && b.name === trigName
        );
        if (!anyAlive) node.done = true;
        break;
      }

      case 'CBrickPlugInDestroySelf': {
        this.engine.damageBrick(this.brick, { piercing: true });
        node.done = true;
        break;
      }

      default:
        node.done = true;
        break;
    }
  }
}

class RicochetEngine {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.sprites = null;
    this.brickStyles = {};
    this.backgrounds = {};
    this.powerupDefs = {};
    this.ships = [];
    this.questsData = { quests: [], packs: [] };
    this.audio = null;
    this.levelPackCache = new Map();

    this.currentPackSlug = 'rounds_planets_standard_pack_1_main_1_ricochet_station';
    this.currentPack = null;
    this.currentRoundIndex = 0;
    this.currentRound = null;
    this.currentBgDef = null;

    this.score = 0;
    this.lives = 3;
    this.ringsInRound = 0;
    this.totalRings = 125;
    this.paused = false;
    this.time = 0;

    this.selectedShip = null;
    this.selectedBallKey = 'Ball/Selectable Player Balls/Ball';
    this.availableBalls = [
      { name: 'Ion Sphere (Standard)', key: 'Ball/Selectable Player Balls/Ball' },
      { name: 'Fire Sphere', key: 'Power Ups/Ball Fire' },
      { name: 'Lightning Sphere', key: 'Power Ups/Ball Lightning' },
      { name: 'Rail Sphere', key: 'Power Ups/Ball Rail' },
      { name: 'Acid Sphere', key: 'Power Ups/Acid Ball Ball' },
      { name: 'Nuclear Sphere', key: 'Ball/Selectable Player Balls/Nuke' },
      { name: 'Golden Sphere', key: 'Ball/Selectable Player Balls/Golden Ball' },
      { name: 'Eyeball Sphere', key: 'Ball/Selectable Player Balls/EyeBall' },
      { name: 'Smiley Sphere', key: 'Ball/Selectable Player Balls/Smiley' },
      { name: 'Racer Sphere', key: 'Ball/Selectable Player Balls/Racer' },
      { name: 'Checker Sphere', key: 'Ball/Selectable Player Balls/CheckerBall' },
      { name: 'Bee Sphere', key: 'Ball/Selectable Player Balls/Bee Ball' },
      { name: 'Baseball Sphere', key: 'Ball/Selectable Player Balls/BaseBall' },
      { name: 'Basketball Sphere', key: 'Ball/Selectable Player Balls/Basketball' },
    ];

    this.bricks = [];
    this.pivotMarkers = new Map();
    this.balls = [];
    this.fallingPowerups = [];
    this.projectiles = [];
    this.particles = [];
    this.lightningArcs = [];
    this.recallWaves = [];

    this.ship = {
      x: PLAYFIELD.centerX,
      y: 556,
      targetX: PLAYFIELD.centerX,
      vx: 0,
      width: 82,
      height: 22,
      scale: 1.0,
      bankFrame: 10,
      hasGun: false,
      hasStinger: false,
      hasCatcher: false,
      hasSight: false,
      shieldActive: false,
      fireCooldown: 0,
      stingerCooldown: 0,
    };

    this.keys = { left: false, right: false, recall: false };
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    this.lastRecallSound = 0;
    this.roundClearTimer = 0;
  }

  async init() {
    const [sprites, brickStyles, backgrounds, powerups, ships, quests, audio] = await Promise.all([
      fetch('assets/data/sprites.json').then((r) => r.json()),
      fetch('assets/data/brick_styles.json').then((r) => r.json()),
      fetch('assets/data/backgrounds.json').then((r) => r.json()),
      fetch('assets/data/powerups.json').then((r) => r.json()),
      fetch('assets/data/ships.json').then((r) => r.json()),
      fetch('assets/data/quests.json').then((r) => r.json()),
      fetch('assets/data/audio.json').then((r) => r.json()),
    ]);

    this.sprites = new SpriteManager(sprites);
    this.brickStyles = brickStyles;
    this.backgrounds = backgrounds;
    this.powerupDefs = powerups;
    this.ships = ships;
    this.questsData = quests;
    this.audio = new AudioManager(audio);

    this.selectedShip =
      this.ships.find((s) => s.key.toLowerCase().includes('infinity')) ||
      this.ships.find((s) => s.key.toLowerCase().includes('normal')) ||
      this.ships[0];

    this.sprites.preloadKeys([
      'Arena/Score Board Frame',
      'Ball/Selectable Player Balls/Ball',
      'Power Ups/Ball Fire',
      'Power Ups/Ball Lightning',
      'Power Ups/Ball Rail',
      'Power Ups/Acid Ball Ball',
      'Bricks/Common/Coin',
      'Effects/Ball Explosion',
      'Effects/Mayan Explosion',
      'Effects/Ring Pickup',
      'Player Ship/RS Small Guns',
      'Power Ups/Stinger Missile Launcher Left',
      'Power Ups/Stinger Missile Launcher Right',
      'Power Ups/Stinger Missile',
      'Player Ship/RS Long Shield',
      this.selectedShip && this.selectedShip.sequence,
    ]);

    this.bindInput();
    this.buildModals();

    await this.loadPackAndRound('rounds_planets_standard_pack_1_main_1_ricochet_station', 0);

    this.lastFrameTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  bindInput() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const mx = (e.clientX - rect.left) * scaleX;
      const halfW = (this.ship.width * this.ship.scale) / 2;
      this.ship.targetX = Math.max(
        PLAYFIELD.left + halfW + 4,
        Math.min(PLAYFIELD.right - halfW - 4, mx)
      );
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDownLeft = true;
        this.hideBanner();
        this.launchCaughtBalls();
        this.fireWeapons();
      } else if (e.button === 2) {
        this.mouseDownRight = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDownLeft = false;
      if (e.button === 2) this.mouseDownRight = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = true;
      if (e.code === 'Space') {
        e.preventDefault();
        this.hideBanner();
        if (this.balls.some((b) => b.caught)) {
          this.launchCaughtBalls();
        } else {
          this.keys.recall = true;
        }
      }
      if (e.code === 'BracketLeft') this.stepRound(-1);
      if (e.code === 'BracketRight') this.stepRound(1);
      if (e.code === 'KeyP') this.togglePause();
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = false;
      if (e.code === 'Space') this.keys.recall = false;
    });

    document.getElementById('btn-prev-round').addEventListener('click', () => this.stepRound(-1));
    document.getElementById('btn-next-round').addEventListener('click', () => this.stepRound(1));

    const audioBtn = document.getElementById('btn-toggle-audio');
    audioBtn.addEventListener('click', () => {
      const on = this.audio.toggle();
      audioBtn.textContent = on ? '🔊 Audio: ON' : '🔇 Audio: OFF';
      audioBtn.setAttribute('aria-pressed', String(on));
      if (on && this.currentBgDef) {
        this.audio.playMusicTrack(this.currentBgDef.music);
      }
    });

    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.addEventListener('click', () => this.togglePause());

    document.querySelectorAll('.pu-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const puName = chip.getAttribute('data-pu');
        this.applyPowerup(puName);
      });
    });

    // Listen for Invoker 'command' events directly on target <dialog> elements (does not bubble)
    ['planets-dialog', 'hangar-dialog', 'inspector-dialog'].forEach((id) => {
      const dlg = document.getElementById(id);
      if (!dlg) return;
      dlg.addEventListener('command', (e) => {
        const cmd = e.command || (e.detail && e.detail.command);
        if (cmd === 'show-modal') this.paused = true;
      });
      dlg.addEventListener('close', () => {
        this.paused = false;
      });
    });
  }

  togglePause() {
    this.paused = !this.paused;
    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.textContent = this.paused ? '▶ Resume (P)' : '⏸ Pause (P)';
    pauseBtn.setAttribute('aria-pressed', String(this.paused));
  }

  hideBanner() {
    const banner = document.getElementById('level-banner');
    if (banner && !banner.hidden) banner.hidden = true;
  }

  showBanner(planetTitle, roundTitle, subText) {
    const banner = document.getElementById('level-banner');
    document.getElementById('banner-planet').textContent = planetTitle;
    document.getElementById('banner-title').textContent = roundTitle;
    document.getElementById('banner-sub').textContent =
      subText || 'Left-Click or Space to Launch Ion Sphere · Right-Click / Hold Space for Ion Recall';
    banner.hidden = false;
  }

  async loadPack(slug) {
    if (this.levelPackCache.has(slug)) {
      return this.levelPackCache.get(slug);
    }
    const data = await fetch(`assets/data/levels/${slug}.json`).then((r) => r.json());
    this.levelPackCache.set(slug, data);
    return data;
  }

  async loadPackAndRound(slug, roundIdx = 0) {
    const pack = await this.loadPack(slug);
    this.currentPackSlug = slug;
    this.currentPack = pack;
    const rounds = pack.rounds || [];
    this.currentRoundIndex = Math.max(0, Math.min(rounds.length - 1, roundIdx));
    this.setupRound(rounds[this.currentRoundIndex]);
  }

  stepRound(delta) {
    if (!this.currentPack || !this.currentPack.rounds) return;
    const total = this.currentPack.rounds.length;
    let next = this.currentRoundIndex + delta;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;
    this.currentRoundIndex = next;
    this.setupRound(this.currentPack.rounds[this.currentRoundIndex]);
  }

  setupRound(roundDef) {
    if (!roundDef) return;
    this.currentRound = roundDef;
    this.ringsInRound = 0;
    this.roundClearTimer = 0;
    this.bricks = [];
    this.pivotMarkers.clear();
    this.fallingPowerups = [];
    this.projectiles = [];
    this.particles = [];
    this.lightningArcs = [];
    this.recallWaves = [];

    const bgKey = roundDef.background || 'Environments/Alien Vista/AlienVista';
    const bgDef =
      this.backgrounds[bgKey] ||
      this.backgrounds[bgKey.toLowerCase()] ||
      this.backgrounds['Environments/Alien Vista/AlienVista'] ||
      {};
    this.currentBgDef = bgDef;

    this.sprites.preloadKeys([bgDef.backgroundImage, bgDef.midgroundImage, bgDef.foregroundImage]);

    // First pass: register named bricks and CBrickPositionMarker pivots
    for (const raw of roundDef.bricks || []) {
      if (raw.name) {
        this.pivotMarkers.set(String(raw.name), {
          x: PLAYFIELD.left + Number(raw.x || 0),
          y: PLAYFIELD.top + Number(raw.y || 0),
          brickRef: null,
        });
      }
    }

    // Second pass: instantiate bricks
    for (let i = 0; i < (roundDef.bricks || []).length; i++) {
      const raw = roundDef.bricks[i];
      const styleKey = raw.style || '';
      const styleDef =
        this.brickStyles[styleKey] ||
        this.brickStyles[styleKey.toLowerCase()] ||
        {};

      const seqKey =
        styleDef.sequence && styleDef.sequence !== '!None'
          ? styleDef.sequence
          : 'Bricks/' + styleKey;
      const meta = this.sprites.getMeta(seqKey);
      this.sprites.getImage(seqKey);

      let w = 38;
      let h = 18;
      if (meta && meta.frames && meta.frames.length > 0) {
        w = meta.frames[0].w || 38;
        h = meta.frames[0].h || 18;
      } else if (meta && meta.sheetW && meta.sheetH) {
        w = meta.sheetW;
        h = meta.sheetH;
      }

      // Note: Ricochet brick coordinates in .Round files are center/hotspot coordinates relative to the playfield!
      const cx = PLAYFIELD.left + Number(raw.x || 0);
      const cy = PLAYFIELD.top + Number(raw.y || 0);

      const cls = raw.class || 'CBrickNormal';
      const isMarker = cls === 'CBrickPositionMarker';
      const isIndestructible =
        cls === 'CBrickNearlyIndestructible' ||
        cls === 'CBrickIndestructible' ||
        cls === 'CBrickSwitch' ||
        cls === 'CBrickTeleporter' ||
        cls === 'CBrickBallDeflector' ||
        cls === 'CBrickSpeedChange' ||
        cls === 'CBrickNudge' ||
        cls === 'CBrickPusher' ||
        cls === 'CBrickRail';

      const maxHp = cls === 'CBrickNHitSide' ? 3 : 1;

      const brick = {
        id: i,
        class: cls,
        name: raw.name || '',
        raw,
        styleKey,
        styleDef,
        imageKey: seqKey,
        powerupName: this.extractBrickPowerup(raw),
        x: cx,
        y: cy,
        prevX: cx,
        prevY: cy,
        vx: 0,
        vy: 0,
        baseX: cx,
        baseY: cy,
        w,
        h,
        hp: maxHp,
        maxHp,
        indestructible: isIndestructible,
        isMarker,
        isCoin: cls === 'CBrickCoin',
        isExploder: cls === 'CBrickExploder' || cls === 'CBrickDetonator',
        hidden: false,
        alive: !isMarker,
        hitFlashTime: 0,
        score: Number(styleDef.score || 100),
        runner: null,
      };

      if (brick.name) {
        this.pivotMarkers.set(brick.name, { x: cx, y: cy, brickRef: brick });
      }

      brick.runner = new BrickPluginRunner(brick, this);
      this.bricks.push(brick);
    }

    this.ship.scale = 1.0;
    this.ship.hasGun = false;
    this.ship.hasStinger = false;
    this.ship.hasCatcher = false;
    this.ship.hasSight = false;
    this.ship.shieldActive = false;
    this.spawnCaughtBall();

    const planetTitle = this.getPlanetDisplayName(this.currentPackSlug);
    const totalRounds = (this.currentPack && this.currentPack.rounds && this.currentPack.rounds.length) || 1;
    document.getElementById('round-indicator').textContent = `${planetTitle} · Round ${this.currentRoundIndex + 1}/${totalRounds}`;

    this.showBanner(
      planetTitle.toUpperCase(),
      roundDef.name || `Round ${this.currentRoundIndex + 1}`,
      `Author: ${roundDef.author || this.currentPack.author || 'Reflexive Entertainment'} · Left-Click or Space to Launch`
    );

    if (bgDef.music) {
      this.audio.playMusicTrack(bgDef.music);
    }
  }

  extractBrickPowerup(raw) {
    const ext = raw.extra || {};
    const p =
      ext['Power-Up Style'] ||
      ext['PowerUp'] ||
      ext['Power Up'] ||
      '';
    if (p && p !== '!None') {
      return String(p)
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.PowerUp$/i, '');
    }
    if (raw.class === 'CBrickPowerup' || raw.class === 'CBrickInstantPowerUp' || raw.class === 'CBrickLottery') {
      const pool = [
        'Fire Ball',
        'Multiply 3',
        'Stinger Missile Launcher',
        'Lightning Ball',
        'Acid Ball',
        'Rail Ball',
        'Gun',
        'Expand Paddle',
        'Sight',
        'Extra Ball',
      ];
      return pool[raw.id % pool.length];
    }
    return '';
  }

  findPivotPoint(targetName, callerBrick) {
    if (targetName && this.pivotMarkers.has(String(targetName))) {
      const entry = this.pivotMarkers.get(String(targetName));
      if (entry.brickRef) {
        return { x: entry.brickRef.x, y: entry.brickRef.y };
      }
      return { x: entry.x, y: entry.y };
    }
    return {
      x: callerBrick ? callerBrick.baseX : PLAYFIELD.centerX,
      y: callerBrick ? callerBrick.baseY : PLAYFIELD.centerY,
    };
  }

  spawnCaughtBall() {
    this.balls = [
      {
        x: this.ship.x,
        y: this.ship.y - 16,
        vx: 0,
        vy: 0,
        radius: 8,
        speed: 355,
        caught: true,
        catchOffset: 0,
        spriteKey: this.selectedBallKey,
        fire: false,
        acid: false,
        lightning: false,
        rail: false,
        trail: [],
      },
    ];
  }

  launchCaughtBalls() {
    let launched = false;
    for (const b of this.balls) {
      if (b.caught) {
        b.caught = false;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.25 + this.ship.vx * 0.00035;
        b.vx = Math.cos(angle) * b.speed;
        b.vy = Math.sin(angle) * b.speed;
        launched = true;
      }
    }
    if (launched) {
      this.audio.playSound('Bounce');
    }
  }

  fireWeapons() {
    if (this.ship.hasGun && this.ship.fireCooldown <= 0) {
      this.ship.fireCooldown = 0.22;
      const halfW = (this.ship.width * this.ship.scale) * 0.36;
      this.projectiles.push(
        { kind: 'laser', x: this.ship.x - halfW, y: this.ship.y - 12, vx: 0, vy: -540 },
        { kind: 'laser', x: this.ship.x + halfW, y: this.ship.y - 12, vx: 0, vy: -540 }
      );
      this.audio.playSound('Bounce', 0.3);
    }
    if (this.ship.hasStinger && this.ship.stingerCooldown <= 0) {
      this.ship.stingerCooldown = 0.45;
      const halfW = (this.ship.width * this.ship.scale) * 0.44;
      this.projectiles.push(
        { kind: 'stinger', x: this.ship.x - halfW, y: this.ship.y - 10, vx: -70, vy: -310, angle: -Math.PI / 2 },
        { kind: 'stinger', x: this.ship.x + halfW, y: this.ship.y - 10, vx: 70, vy: -310, angle: -Math.PI / 2 }
      );
      this.audio.playSound('Super Explode Brick', 0.35);
    }
  }

  applyPowerup(puName) {
    const def = this.powerupDefs[puName] || this.powerupDefs[puName.toLowerCase()] || {};
    this.audio.playSound(def.sound || 'Bounce');
    this.score += 250;

    if (this.balls.length === 0) this.spawnCaughtBall();

    switch (puName) {
      case 'Fire Ball':
        for (const b of this.balls) {
          b.fire = true;
          b.spriteKey = 'Power Ups/Ball Fire';
        }
        break;
      case 'Acid Ball':
        for (const b of this.balls) {
          b.acid = true;
          b.spriteKey = 'Power Ups/Acid Ball Ball';
        }
        break;
      case 'Lightning Ball':
        for (const b of this.balls) {
          b.lightning = true;
          b.spriteKey = 'Power Ups/Ball Lightning';
        }
        break;
      case 'Rail Ball':
        for (const b of this.balls) {
          b.rail = true;
          b.spriteKey = 'Power Ups/Ball Rail';
        }
        break;
      case 'Multiply 3':
      case 'Multiply 3 Inline':
      case 'Multiply 8': {
        const clones = [];
        const count = puName === 'Multiply 8' ? 4 : 2;
        for (const b of this.balls.slice(0, 4)) {
          if (b.caught) {
            b.caught = false;
            b.vx = 120;
            b.vy = -b.speed;
          }
          for (let i = 0; i < count; i++) {
            const ang = Math.atan2(b.vy, b.vx) + (i - (count - 1) / 2) * 0.34;
            clones.push({
              ...b,
              vx: Math.cos(ang) * b.speed,
              vy: Math.sin(ang) * b.speed,
              caught: false,
              trail: [],
            });
          }
        }
        this.balls.push(...clones);
        break;
      }
      case 'Stinger Missile Launcher':
        this.ship.hasStinger = true;
        this.fireWeapons();
        break;
      case 'Gun':
      case 'Big Gun':
        this.ship.hasGun = true;
        this.fireWeapons();
        break;
      case 'Expand Paddle':
      case 'Expand':
        this.ship.scale = Math.min(1.45, this.ship.scale + 0.22);
        break;
      case 'Shrink Paddle':
      case 'Shrink':
        this.ship.scale = Math.max(0.72, this.ship.scale - 0.2);
        break;
      case 'Catch':
      case 'Catcher':
        this.ship.hasCatcher = true;
        break;
      case 'Sight':
        this.ship.hasSight = true;
        break;
      case 'Safty Bumper':
      case 'Shield':
        this.ship.shieldActive = true;
        break;
      case 'Slow':
        for (const b of this.balls) b.speed = Math.max(240, b.speed * 0.8);
        break;
      case 'Fast':
        for (const b of this.balls) b.speed = Math.min(520, b.speed * 1.22);
        break;
      case 'Extra Ball':
        this.lives++;
        break;
      default:
        break;
    }
  }

  loop(now) {
    const dt = Math.min(0.033, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    }
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    // 1. Update ship position & 21-frame banking animation
    const keyboardSpeed = 480;
    if (this.keys.left) this.ship.targetX -= keyboardSpeed * dt;
    if (this.keys.right) this.ship.targetX += keyboardSpeed * dt;

    const halfW = (this.ship.width * this.ship.scale) / 2;
    this.ship.targetX = Math.max(
      PLAYFIELD.left + halfW + 4,
      Math.min(PLAYFIELD.right - halfW - 4, this.ship.targetX)
    );

    const prevShipX = this.ship.x;
    this.ship.x += (this.ship.targetX - this.ship.x) * Math.min(1, dt * 22);
    this.ship.vx = (this.ship.x - prevShipX) / Math.max(0.001, dt);

    const targetBank = 10 + Math.max(-10, Math.min(10, Math.round(this.ship.vx / 55)));
    this.ship.bankFrame += (targetBank - this.ship.bankFrame) * Math.min(1, dt * 16);

    if (this.ship.fireCooldown > 0) this.ship.fireCooldown -= dt;
    if (this.ship.stingerCooldown > 0) this.ship.stingerCooldown -= dt;
    if (this.mouseDownLeft) this.fireWeapons();

    // 2. Update real-time CBrickPlugIn motion scripts on all bricks
    for (const b of this.bricks) {
      b.prevX = b.x;
      b.prevY = b.y;
      if (b.runner && (b.alive || b.isMarker)) {
        b.runner.update(dt);
      }
      b.vx = (b.x - b.prevX) / Math.max(0.001, dt);
      b.vy = (b.y - b.prevY) / Math.max(0.001, dt);
      if (b.hitFlashTime > 0) b.hitFlashTime = Math.max(0, b.hitFlashTime - dt);
    }

    // 3. Ion Sphere Recall (Right-Click or Spacebar tractor pull)
    const recallActive = this.mouseDownRight || this.keys.recall;
    if (recallActive && this.balls.some((b) => !b.caught)) {
      if (this.time - this.lastRecallSound > 0.35) {
        this.lastRecallSound = this.time;
        this.audio.playSound('Recall', 0.4);
        this.recallWaves.push({ x: this.ship.x, y: this.ship.y - 10, radius: 12, alpha: 0.9 });
      }
      for (const b of this.balls) {
        if (b.caught) continue;
        const dx = this.ship.x - b.x;
        const dy = this.ship.y - 14 - b.y;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = 980 * dt;
        b.vx += (dx / dist) * pull;
        b.vy += (dy / dist) * pull * 0.72;
        const mag = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / mag) * b.speed;
        b.vy = (b.vy / mag) * b.speed;
      }
    }

    for (let i = this.recallWaves.length - 1; i >= 0; i--) {
      const w = this.recallWaves[i];
      w.radius += 260 * dt;
      w.alpha -= 1.8 * dt;
      if (w.alpha <= 0) this.recallWaves.splice(i, 1);
    }

    // 4. Update Balls & Collisions
    for (let bi = this.balls.length - 1; bi >= 0; bi--) {
      const ball = this.balls[bi];
      if (ball.caught) {
        ball.x = this.ship.x + ball.catchOffset;
        ball.y = this.ship.y - 16;
        continue;
      }

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 7) ball.trail.shift();

      const steps = 2;
      const stepDt = dt / steps;
      for (let s = 0; s < steps; s++) {
        ball.x += ball.vx * stepDt;
        ball.y += ball.vy * stepDt;

        if (ball.x - ball.radius < PLAYFIELD.left) {
          ball.x = PLAYFIELD.left + ball.radius;
          ball.vx = Math.abs(ball.vx);
          this.audio.playSound('Bump', 0.25);
        } else if (ball.x + ball.radius > PLAYFIELD.right) {
          ball.x = PLAYFIELD.right - ball.radius;
          ball.vx = -Math.abs(ball.vx);
          this.audio.playSound('Bump', 0.25);
        }
        if (ball.y - ball.radius < PLAYFIELD.top) {
          ball.y = PLAYFIELD.top + ball.radius;
          ball.vy = Math.abs(ball.vy);
          this.audio.playSound('Bump', 0.25);
        }

        // Ship paddle bounce
        const shipTop = this.ship.y - 11;
        const shipBottom = this.ship.y + 10;
        const shipHalfW = (this.ship.width * this.ship.scale) / 2 + 4;
        if (
          ball.vy > 0 &&
          ball.y + ball.radius >= shipTop &&
          ball.y - ball.radius <= shipBottom &&
          ball.x >= this.ship.x - shipHalfW &&
          ball.x <= this.ship.x + shipHalfW
        ) {
          if (this.ship.hasCatcher) {
            ball.caught = true;
            ball.catchOffset = ball.x - this.ship.x;
            this.audio.playSound('Bounce');
            break;
          }
          const hitNorm = (ball.x - this.ship.x) / shipHalfW;
          const maxBounceAngle = 1.12;
          const bounceAngle = -Math.PI / 2 + hitNorm * maxBounceAngle;
          ball.vx = Math.cos(bounceAngle) * ball.speed;
          ball.vy = Math.sin(bounceAngle) * ball.speed;
          ball.y = shipTop - ball.radius - 1;
          this.audio.playSound('Bounce');
        }

        this.checkBallBrickCollisions(ball);
      }

      if (ball.y - ball.radius > PLAYFIELD.bottom) {
        if (this.ship.shieldActive) {
          this.ship.shieldActive = false;
          ball.y = PLAYFIELD.bottom - ball.radius - 4;
          ball.vy = -Math.abs(ball.vy);
          this.audio.playSound('Bounce');
        } else {
          this.balls.splice(bi, 1);
          if (this.balls.length === 0) {
            this.audio.playSound('Lost Ball');
            this.lives = Math.max(1, this.lives - 1);
            this.spawnCaughtBall();
          }
        }
      }
    }

    // 5. Update Homing Stinger Missiles & Laser Beams
    for (let pi = this.projectiles.length - 1; pi >= 0; pi--) {
      const p = this.projectiles[pi];
      if (p.kind === 'stinger') {
        let bestBrick = null;
        let bestDist = Infinity;
        for (const b of this.bricks) {
          if (!b.alive || b.hidden || b.indestructible) continue;
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d < bestDist) {
            bestDist = d;
            bestBrick = b;
          }
        }
        if (bestBrick) {
          const desiredAngle = Math.atan2(bestBrick.y - p.y, bestBrick.x - p.x);
          let diff = desiredAngle - p.angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          p.angle += Math.max(-6.5 * dt, Math.min(6.5 * dt, diff));
          const spd = 380;
          p.vx = Math.cos(p.angle) * spd;
          p.vy = Math.sin(p.angle) * spd;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (
        p.x < PLAYFIELD.left ||
        p.x > PLAYFIELD.right ||
        p.y < PLAYFIELD.top ||
        p.y > PLAYFIELD.bottom
      ) {
        this.projectiles.splice(pi, 1);
        continue;
      }

      for (const b of this.bricks) {
        if (!b.alive || b.hidden) continue;
        if (
          Math.abs(p.x - b.x) <= b.w / 2 + 6 &&
          Math.abs(p.y - b.y) <= b.h / 2 + 6
        ) {
          this.damageBrick(b, { piercing: p.kind === 'stinger' });
          this.projectiles.splice(pi, 1);
          break;
        }
      }
    }

    // 6. Update Falling Power-Up Capsules
    const shipHalfW = (this.ship.width * this.ship.scale) / 2 + 8;
    for (let i = this.fallingPowerups.length - 1; i >= 0; i--) {
      const pu = this.fallingPowerups[i];
      pu.y += pu.vy * dt;
      if (
        Math.abs(pu.y - this.ship.y) < 20 &&
        Math.abs(pu.x - this.ship.x) < shipHalfW
      ) {
        this.applyPowerup(pu.name);
        this.fallingPowerups.splice(i, 1);
      } else if (pu.y > PLAYFIELD.bottom + 24) {
        this.fallingPowerups.splice(i, 1);
      }
    }

    // 7. Update Explosions & Lightning Arcs
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.elapsed += dt;
      if (pt.delay && pt.elapsed < pt.delay) continue;
      if (pt.onTrigger) {
        pt.onTrigger();
        pt.onTrigger = null;
      }
      if (pt.elapsed >= pt.duration) {
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.lightningArcs.length - 1; i >= 0; i--) {
      this.lightningArcs[i].ttl -= dt;
      if (this.lightningArcs[i].ttl <= 0) this.lightningArcs.splice(i, 1);
    }

    // 8. Check Round Victory
    const remaining = this.bricks.filter(
      (b) => b.alive && !b.indestructible && !b.isCoin
    );
    if (remaining.length === 0 && this.bricks.length > 0) {
      this.roundClearTimer += dt;
      if (this.roundClearTimer > 1.1) {
        this.audio.playSound('Level Ending Tune');
        this.stepRound(1);
      }
    }
  }

  checkBallBrickCollisions(ball) {
    for (const b of this.bricks) {
      if (!b.alive || b.hidden) continue;
      const halfW = b.w / 2;
      const halfH = b.h / 2;
      const closestX = Math.max(b.x - halfW, Math.min(ball.x, b.x + halfW));
      const closestY = Math.max(b.y - halfH, Math.min(ball.y, b.y + halfH));
      const dx = ball.x - closestX;
      const dy = ball.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq <= ball.radius * ball.radius) {
        if (b.isCoin) {
          this.collectCoin(b);
          continue;
        }

        if (b.class === 'CBrickTrappedBall' || b.class === 'CBrickFloatingBall' || b.class === 'CBrickBallFactory') {
          this.balls.push({
            ...ball,
            x: b.x,
            y: b.y,
            vx: -ball.vx,
            vy: -ball.vy,
            caught: false,
            trail: [],
          });
        }

        if (b.class === 'CBrickSwitch') {
          this.audio.playSound('Brick Turned Off');
          for (const other of this.bricks) {
            if (other.class === 'CBrickOnOff') other.hidden = !other.hidden;
          }
        }

        if (b.class === 'CBrickTeleporter') {
          const other = this.bricks.find(
            (o) => o !== b && o.class === 'CBrickTeleporter' && o.alive
          );
          if (other) {
            ball.x = other.x + (ball.vx >= 0 ? other.w : -other.w);
            ball.y = other.y;
            this.audio.playSound('Bounce');
            break;
          }
        }

        const piercing = ball.rail || ball.acid || (ball.fire && !b.indestructible);
        if (!piercing) {
          const overlapX = halfW + ball.radius - Math.abs(ball.x - b.x);
          const overlapY = halfH + ball.radius - Math.abs(ball.y - b.y);
          if (overlapX < overlapY) {
            ball.vx = ball.x < b.x ? -Math.abs(ball.vx) : Math.abs(ball.vx);
            ball.x += ball.x < b.x ? -overlapX : overlapX;
          } else {
            ball.vy = ball.y < b.y ? -Math.abs(ball.vy) : Math.abs(ball.vy);
            ball.y += ball.y < b.y ? -overlapY : overlapY;
          }
          ball.vx += b.vx * 0.18;
          ball.vy += b.vy * 0.18;
          const mag = Math.hypot(ball.vx, ball.vy) || 1;
          ball.vx = (ball.vx / mag) * ball.speed;
          ball.vy = (ball.vy / mag) * ball.speed;
        }

        this.damageBrick(b, {
          piercing: ball.fire || ball.acid || ball.rail,
          fire: ball.fire,
          lightning: ball.lightning,
        });
        break;
      }
    }
  }

  collectCoin(brick) {
    brick.alive = false;
    this.ringsInRound++;
    this.totalRings++;
    this.score += 500;
    this.audio.playSound('Rings Earn Ball');
    this.particles.push({
      spriteKey: 'Effects/Ring Pickup',
      x: brick.x,
      y: brick.y,
      elapsed: 0,
      duration: 0.45,
      additive: true,
    });
    if (this.ringsInRound >= 5) {
      this.ringsInRound = 0;
      this.score += 5000;
      this.lives++;
      this.audio.playSound('Redeem Ring for Ball');
    }
  }

  damageBrick(brick, opts = {}) {
    if (!brick.alive) return;

    if (brick.indestructible && !opts.piercing) {
      brick.hitFlashTime = 0.25;
      this.audio.playSound(brick.styleDef.hitSound || 'Metal Damage');
      return;
    }

    brick.hp -= opts.piercing ? 3 : 1;
    if (brick.hp > 0) {
      brick.hitFlashTime = 0.22;
      this.audio.playSound(brick.styleDef.hitSound || 'Metal Damage');
      return;
    }

    brick.alive = false;
    this.score += brick.score;
    this.audio.playSound(brick.styleDef.destroyedSound || 'Bounce');

    const expKey =
      brick.styleDef.destroyedSeq && brick.styleDef.destroyedSeq !== '!None'
        ? brick.styleDef.destroyedSeq
        : 'Effects/Ball Explosion';

    this.particles.push({
      spriteKey: expKey,
      x: brick.x,
      y: brick.y,
      elapsed: 0,
      duration: 0.45,
      additive: true,
    });

    if (brick.powerupName) {
      const puDef = this.powerupDefs[brick.powerupName] || this.powerupDefs[brick.powerupName.toLowerCase()] || {};
      const puSprite = puDef.sequence || `Power Ups/${brick.powerupName}`;
      this.sprites.getImage(puSprite);
      this.fallingPowerups.push({
        name: brick.powerupName,
        spriteKey: puSprite,
        x: brick.x,
        y: brick.y,
        vy: 135,
      });
    }

    if (brick.isExploder || opts.fire) {
      this.audio.playSound('Super Explode Brick');
      const radius = brick.isExploder ? 62 : 46;
      for (const other of this.bricks) {
        if (!other.alive || other === brick) continue;
        if (Math.hypot(other.x - brick.x, other.y - brick.y) <= radius) {
          this.particles.push({
            spriteKey: 'Effects/Mayan Explosion',
            x: other.x,
            y: other.y,
            elapsed: 0,
            delay: 0.07,
            duration: 0.5,
            additive: true,
            onTrigger: () => this.damageBrick(other, { piercing: true }),
          });
        }
      }
    }

    if (opts.lightning) {
      const targets = this.bricks
        .filter((o) => o.alive && !o.hidden && !o.indestructible && o !== brick)
        .sort((a, b) => Math.hypot(a.x - brick.x, a.y - brick.y) - Math.hypot(b.x - brick.x, b.y - brick.y))
        .slice(0, 3);
      for (const t of targets) {
        if (Math.hypot(t.x - brick.x, t.y - brick.y) < 160) {
          this.lightningArcs.push({ x1: brick.x, y1: brick.y, x2: t.x, y2: t.y, ttl: 0.22 });
          this.damageBrick(t, { piercing: true });
        }
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 800, 600);

    // 1. Playfield clipped region
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLAYFIELD.left, PLAYFIELD.top, PLAYFIELD.width, PLAYFIELD.height);
    ctx.clip();

    // Background image
    const bgImg = this.currentBgDef && this.currentBgDef.backgroundImage;
    if (!this.sprites.draw(ctx, bgImg, 6, 11, { topLeft: true })) {
      ctx.fillStyle = '#071126';
      ctx.fillRect(PLAYFIELD.left, PLAYFIELD.top, PLAYFIELD.width, PLAYFIELD.height);
    }

    // Midground image
    const mgImg = this.currentBgDef && this.currentBgDef.midgroundImage;
    if (mgImg && mgImg !== '!None') {
      this.sprites.draw(ctx, mgImg, PLAYFIELD.left, PLAYFIELD.top, { topLeft: true });
    }

    // Bottom Shield if active
    if (this.ship.shieldActive) {
      this.sprites.draw(ctx, 'Player Ship/RS Long Shield', PLAYFIELD.centerX, PLAYFIELD.bottom - 8, {
        time: this.time,
        scaleX: 4.5,
        additive: true,
      });
    }

    // Sight Laser guide if active
    if (this.ship.hasSight) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 65, 65, 0.55)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.ship.x, this.ship.y - 16);
      ctx.lineTo(this.ship.x, PLAYFIELD.top);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Render Bricks
    for (const b of this.bricks) {
      if (!b.alive || b.hidden) continue;

      if (b.isCoin) {
        this.sprites.draw(ctx, 'Bricks/Common/Coin', b.x, b.y, { time: this.time });
        continue;
      }

      const drawn = this.sprites.draw(ctx, b.imageKey, b.x, b.y, { time: this.time });
      if (!drawn) {
        ctx.fillStyle = b.indestructible ? '#5a6f94' : '#2a85d6';
        ctx.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        ctx.strokeStyle = '#8ad8ff';
        ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
      }

      // Multi-hit / Metallic hit overlays
      const hitImgs = b.styleDef.hitImages || [];
      if (b.maxHp === 3 && b.hp === 2 && hitImgs[0]) {
        this.sprites.draw(ctx, hitImgs[0], b.x, b.y, { time: this.time });
      } else if (b.maxHp === 3 && b.hp === 1 && (hitImgs[1] || hitImgs[0])) {
        this.sprites.draw(ctx, hitImgs[1] || hitImgs[0], b.x, b.y, { time: this.time });
      }

      if (b.hitFlashTime > 0 && hitImgs[0]) {
        this.sprites.draw(ctx, hitImgs[0], b.x, b.y, {
          time: this.time,
          alpha: b.hitFlashTime / 0.25,
          additive: true,
        });
      }
    }

    // 3. Render Ion Recall Tractor Waves
    for (const w of this.recallWaves) {
      ctx.save();
      ctx.strokeStyle = `rgba(60, 232, 255, ${w.alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Render Player Ship (21-frame banking sprite + weapon pods)
    const shipSprite =
      (this.selectedShip && this.selectedShip.sequence) ||
      'Player Ship/Selectable Player Ships/Ricochet Infinity';
    const bankFrame = Math.max(0, Math.min(20, Math.round(this.ship.bankFrame)));
    if (
      !this.sprites.draw(ctx, shipSprite, this.ship.x, this.ship.y, {
        frameIndex: bankFrame,
        scaleX: this.ship.scale,
      })
    ) {
      ctx.fillStyle = '#3ce8ff';
      ctx.fillRect(this.ship.x - 40 * this.ship.scale, this.ship.y - 9, 80 * this.ship.scale, 18);
    }

    if (this.ship.hasGun) {
      this.sprites.draw(ctx, 'Player Ship/RS Small Guns', this.ship.x, this.ship.y - 6, {
        scaleX: this.ship.scale,
      });
    }
    if (this.ship.hasStinger) {
      this.sprites.draw(ctx, 'Power Ups/Stinger Missile Launcher Left', this.ship.x - 32 * this.ship.scale, this.ship.y, {});
      this.sprites.draw(ctx, 'Power Ups/Stinger Missile Launcher Right', this.ship.x + 32 * this.ship.scale, this.ship.y, {});
    }

    // 5. Render Falling Power-Ups
    for (const pu of this.fallingPowerups) {
      if (!this.sprites.draw(ctx, pu.spriteKey, pu.x, pu.y, { time: this.time })) {
        ctx.fillStyle = '#ffc83b';
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 6. Render Projectiles (Lasers & Homing Stinger Missiles)
    for (const p of this.projectiles) {
      if (p.kind === 'stinger') {
        if (!this.sprites.draw(ctx, 'Power Ups/Stinger Missile', p.x, p.y, { time: this.time })) {
          ctx.fillStyle = '#ff9838';
          ctx.fillRect(p.x - 3, p.y - 6, 6, 12);
        }
      } else {
        ctx.fillStyle = '#3ce8ff';
        ctx.fillRect(p.x - 2, p.y - 8, 4, 16);
      }
    }

    // 7. Render Balls & Trails
    for (const ball of this.balls) {
      for (let i = 0; i < ball.trail.length; i++) {
        const t = ball.trail[i];
        const a = ((i + 1) / ball.trail.length) * 0.28;
        ctx.fillStyle = ball.fire
          ? `rgba(255, 120, 30, ${a})`
          : ball.lightning
          ? `rgba(110, 220, 255, ${a})`
          : `rgba(80, 210, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, ball.radius * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!this.sprites.draw(ctx, ball.spriteKey, ball.x, ball.y, { time: this.time })) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 8. Render Explosions & Lightning Arcs
    for (const pt of this.particles) {
      if (pt.delay && pt.elapsed < pt.delay) continue;
      const activeTime = pt.elapsed - (pt.delay || 0);
      this.sprites.draw(ctx, pt.spriteKey, pt.x, pt.y, {
        time: activeTime,
        additive: pt.additive,
      });
    }

    for (const arc of this.lightningArcs) {
      ctx.save();
      ctx.strokeStyle = '#70f3ff';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#3ce8ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      const midX = (arc.x1 + arc.x2) / 2 + (Math.random() - 0.5) * 18;
      const midY = (arc.y1 + arc.y2) / 2 + (Math.random() - 0.5) * 18;
      ctx.lineTo(midX, midY);
      ctx.lineTo(arc.x2, arc.y2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // End playfield clip

    // 9. Draw Authentic Retail Score Board Frame Overlay (800x600)
    this.sprites.draw(ctx, 'Arena/Score Board Frame', 0, 0, { topLeft: true });

    // 10. Render Right-Hand Retail HUD Readouts (x: 642..792)
    this.renderHUD(ctx);
  }

  renderHUD(ctx) {
    ctx.save();
    const hudCenterX = 716;

    ctx.font = 'bold 11px "RicochetArchive", sans-serif';
    ctx.fillStyle = '#8ea5cc';
    ctx.textAlign = 'center';
    ctx.fillText('SCORE', hudCenterX, 54);

    ctx.font = 'bold 20px "RicochetTitle", monospace';
    ctx.fillStyle = '#3ce8ff';
    ctx.fillText(this.score.toLocaleString(), hudCenterX, 78);

    ctx.font = 'bold 11px "RicochetArchive", sans-serif';
    ctx.fillStyle = '#8ea5cc';
    ctx.fillText('ION SPHERES', hudCenterX, 118);

    for (let i = 0; i < Math.min(6, this.lives); i++) {
      const bx = 668 + i * 19;
      this.sprites.draw(ctx, this.selectedBallKey, bx, 136, { time: this.time, scale: 0.85 });
    }

    ctx.fillStyle = '#8ea5cc';
    ctx.fillText('GOLDEN RINGS', hudCenterX, 178);

    for (let i = 0; i < 5; i++) {
      const rx = 668 + i * 24;
      const lit = i < this.ringsInRound;
      ctx.beginPath();
      ctx.arc(rx, 198, 8, 0, Math.PI * 2);
      ctx.fillStyle = lit ? '#ffc83b' : '#182644';
      ctx.fill();
      ctx.strokeStyle = lit ? '#fff2a6' : '#3a588f';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.font = 'bold 13px "RicochetArchive", sans-serif';
    ctx.fillStyle = '#ffc83b';
    ctx.fillText(`TOTAL: ${this.totalRings}`, hudCenterX, 226);

    ctx.fillStyle = '#8ea5cc';
    ctx.font = 'bold 10.5px "RicochetArchive", sans-serif';
    const planetName = this.getPlanetDisplayName(this.currentPackSlug);
    ctx.fillText(planetName.toUpperCase().slice(0, 18), hudCenterX, 272);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px -apple-system, sans-serif';
    const roundTitle = (this.currentRound && this.currentRound.name) || 'Round';
    ctx.fillText(roundTitle.slice(0, 18), hudCenterX, 292);

    const destructibleCount = this.bricks.filter(
      (b) => b.alive && !b.indestructible && !b.isCoin
    ).length;
    ctx.fillStyle = '#3ce8ff';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(`Bricks Left: ${destructibleCount}`, hudCenterX, 312);

    ctx.fillStyle = '#8ea5cc';
    ctx.font = 'bold 10.5px "RicochetArchive", sans-serif';
    ctx.fillText('ACTIVE SHIP', hudCenterX, 362);

    if (this.selectedShip) {
      this.sprites.draw(ctx, this.selectedShip.sequence, hudCenterX, 392, {
        frameIndex: 10,
        scale: 0.78,
      });
      ctx.fillStyle = '#ffc83b';
      ctx.font = 'bold 11px -apple-system, sans-serif';
      ctx.fillText(this.selectedShip.name.slice(0, 18), hudCenterX, 422);
    }

    const recallActive = this.mouseDownRight || this.keys.recall;
    ctx.fillStyle = recallActive ? '#3ce8ff' : '#182949';
    ctx.strokeStyle = '#3ce8ff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(652, 452, 128, 32, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = recallActive ? '#041022' : '#3ce8ff';
    ctx.font = 'bold 11px "RicochetArchive", sans-serif';
    ctx.fillText(recallActive ? '⚡ RECALL ACTIVE' : 'ION RECALL READY', hudCenterX, 472);

    ctx.fillStyle = '#8ea5cc';
    ctx.font = 'bold 10px "RicochetArchive", sans-serif';
    ctx.fillText('ACTIVE MODS', hudCenterX, 514);

    const mods = [];
    if (this.balls.some((b) => b.fire)) mods.push('🔥 Fire');
    if (this.balls.some((b) => b.acid)) mods.push('🧪 Acid');
    if (this.balls.some((b) => b.lightning)) mods.push('🌩 Lightning');
    if (this.balls.some((b) => b.rail)) mods.push('💠 Rail');
    if (this.ship.hasStinger) mods.push('🚀 Stinger');
    if (this.ship.hasGun) mods.push('🔫 Laser');
    if (this.ship.hasSight) mods.push('🎯 Sight');
    if (this.ship.hasCatcher) mods.push('🧲 Catcher');

    ctx.fillStyle = '#dbe9ff';
    ctx.font = '11px -apple-system, sans-serif';
    if (mods.length === 0) {
      ctx.fillText('Standard Ion Mode', hudCenterX, 534);
    } else {
      ctx.fillText(mods.slice(0, 2).join(' · '), hudCenterX, 534);
      if (mods.length > 2) {
        ctx.fillText(mods.slice(2, 4).join(' · '), hudCenterX, 552);
      }
    }

    ctx.restore();
  }

  getPlanetDisplayName(slug) {
    for (const q of this.questsData.quests || []) {
      for (const p of q.planets || []) {
        if (p.slug === slug) return p.name;
      }
    }
    const pack = (this.questsData.packs || []).find((p) => p.slug === slug);
    if (pack && pack.name) return pack.name;
    return slug.replace(/_/g, ' ');
  }

  buildModals() {
    // 1. Planets & Level Packs Modal
    const tabs = document.querySelectorAll('.campaign-tabs .tab-btn');
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderPlanetsTab(btn.getAttribute('data-tab'));
      });
    });
    this.renderPlanetsTab('main-quest');

    // 2. Ship & Ball Hangar Modal
    const shipsGrid = document.getElementById('ships-grid');
    shipsGrid.innerHTML = '';
    for (const ship of this.ships) {
      const card = document.createElement('div');
      card.className = 'hangar-card' + (this.selectedShip && this.selectedShip.key === ship.key ? ' active' : '');

      const preview = document.createElement('div');
      preview.className = 'hangar-preview';
      const iconMeta = this.sprites.getMeta(ship.iconSequence) || this.sprites.getMeta(ship.sequence);
      if (iconMeta) {
        const img = document.createElement('img');
        img.src = iconMeta.url;
        img.alt = ship.name;
        preview.appendChild(img);
      }

      const title = document.createElement('div');
      title.className = 'planet-card-title';
      title.textContent = ship.name;

      card.append(preview, title);
      card.addEventListener('click', () => {
        this.selectedShip = ship;
        this.sprites.getImage(ship.sequence);
        shipsGrid.querySelectorAll('.hangar-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.audio.playSound('Bounce');
      });
      shipsGrid.appendChild(card);
    }

    const ballsGrid = document.getElementById('balls-grid');
    ballsGrid.innerHTML = '';
    for (const b of this.availableBalls) {
      const card = document.createElement('div');
      card.className = 'hangar-card' + (this.selectedBallKey === b.key ? ' active' : '');

      const preview = document.createElement('div');
      preview.className = 'hangar-preview';
      const meta = this.sprites.getMeta(b.key);
      if (meta) {
        const img = document.createElement('img');
        img.src = meta.url;
        img.alt = b.name;
        preview.appendChild(img);
      }

      const title = document.createElement('div');
      title.className = 'planet-card-title';
      title.textContent = b.name;

      card.append(preview, title);
      card.addEventListener('click', () => {
        this.selectedBallKey = b.key;
        this.sprites.getImage(b.key);
        for (const activeBall of this.balls) {
          activeBall.spriteKey = b.key;
        }
        ballsGrid.querySelectorAll('.hangar-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.audio.playSound('Bounce');
      });
      ballsGrid.appendChild(card);
    }

    // 3. Binary RE & Sprite Inspector Modal
    const searchInput = document.getElementById('sprite-search');
    const canonicalSprites = Object.entries(this.sprites.manifest)
      .filter(([k, v]) => k === v.key)
      .map(([, v]) => v);

    const renderSpriteBrowser = (query = '') => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? canonicalSprites.filter((m) => m.key.toLowerCase().includes(q))
        : canonicalSprites;
      document.getElementById('sprite-count-label').textContent = `${filtered.length} / ${canonicalSprites.length} Sprites`;

      const grid = document.getElementById('sprite-browser-grid');
      grid.innerHTML = '';
      for (const m of filtered.slice(0, 72)) {
        const card = document.createElement('div');
        card.className = 'sprite-card';

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = m.url;
        img.alt = m.key;

        const name = document.createElement('div');
        name.className = 'sprite-card-name';
        name.textContent = m.key;

        const info = document.createElement('div');
        info.className = 'sprite-card-meta';
        const frameCount = m.frames ? m.frames.length : 1;
        info.textContent = `${m.type.toUpperCase()} · ${m.sheetW}×${m.sheetH} · ${frameCount}f`;

        card.append(img, name, info);
        grid.appendChild(card);
      }
    };
    searchInput.addEventListener('input', (e) => renderSpriteBrowser(e.target.value));
    renderSpriteBrowser('');
  }

  renderPlanetsTab(tabName) {
    const grid = document.getElementById('planets-grid');
    grid.innerHTML = '';

    const mainQuest = (this.questsData.quests || []).find((q) => q.file.includes('Ricochet Infinity'));
    const ep2Quest = (this.questsData.quests || []).find((q) => q.file.includes('Episode 2'));

    let items = [];
    if (tabName === 'main-quest' && mainQuest) {
      items = mainQuest.planets.map((p) => ({
        title: p.name,
        slug: p.slug,
        env: `Difficulty ${p.difficulty} · ${(p.environments[0] || '').split('/').pop()}`,
        image: p.medImage || p.largeImage || p.smallImage,
      }));
    } else if (tabName === 'ep2-quest' && ep2Quest) {
      items = ep2Quest.planets.map((p) => ({
        title: p.name,
        slug: p.slug,
        env: `Difficulty ${p.difficulty} · ${(p.environments[0] || '').split('/').pop()}`,
        image: p.medImage || p.largeImage || p.smallImage,
      }));
    } else {
      items = (this.questsData.packs || []).map((p) => ({
        title: p.name || p.slug,
        slug: p.slug,
        env: `${p.roundCount} Rounds · ${p.author || 'Reflexive'}`,
        image: 'Interface/Quest Select/Planets/Planet 01 Med',
      }));
    }

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'planet-card' + (item.slug === this.currentPackSlug ? ' active' : '');

      const meta = this.sprites.getMeta(item.image);
      if (meta) {
        const img = document.createElement('img');
        img.src = meta.url;
        img.alt = item.title;
        card.appendChild(img);
      }

      const title = document.createElement('div');
      title.className = 'planet-card-title';
      title.textContent = item.title;

      const sub = document.createElement('div');
      sub.className = 'planet-card-meta';
      sub.textContent = item.env;

      card.append(title, sub);
      card.addEventListener('click', async () => {
        grid.querySelectorAll('.planet-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        await this.renderRoundsListForPack(item.slug, item.title);
      });
      grid.appendChild(card);
    }

    if (items.length > 0) {
      const activeItem = items.find((i) => i.slug === this.currentPackSlug) || items[0];
      this.renderRoundsListForPack(activeItem.slug, activeItem.title);
    }
  }

  async renderRoundsListForPack(slug, displayTitle) {
    const panel = document.getElementById('rounds-list-panel');
    panel.innerHTML = `<div class="section-heading">Loading ${displayTitle}...</div>`;
    const pack = await this.loadPack(slug);
    const rounds = pack.rounds || [];
    panel.innerHTML = `<div class="section-heading">${displayTitle} — Select Round (${rounds.length} Rounds)</div>`;

    const rGrid = document.createElement('div');
    rGrid.className = 'rounds-grid';

    rounds.forEach((lvl, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'round-btn' + (slug === this.currentPackSlug && idx === this.currentRoundIndex ? ' active' : '');
      const envShort = ((lvl.background || '').split('/').pop() || 'Arena').replace(/\.Background$/i, '');
      btn.innerHTML = `
        <span class="r-num">ROUND ${idx + 1} · ${envShort}</span>
        <span class="r-name">${lvl.name || 'Round ' + (idx + 1)}</span>
      `;
      btn.addEventListener('click', async () => {
        await this.loadPackAndRound(slug, idx);
        const dlg = document.getElementById('planets-dialog');
        if (dlg && dlg.open) dlg.close();
      });
      rGrid.appendChild(btn);
    });

    panel.appendChild(rGrid);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const engine = new RicochetEngine();
  window.ricochetEngine = engine;
  engine.init();
});
