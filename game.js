/* Bưu Điện Mây — a tiny 20/10 delivery minigame.
 * State flow: intro → tutorial → collecting → delivery → card.
 * Simulation (update) and DOM writes (render) are separate; one rAF loop. */
(() => {
  'use strict';

  /* ================= helpers ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches;
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  /* ================= name ================= */
  function readName() {
    let raw = '';
    try { raw = new URLSearchParams(window.location.search).get('name') || ''; } catch (e) { raw = ''; }
    if (raw.normalize) raw = raw.normalize('NFC');
    raw = raw.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, '')
      .replace(/\s+/g, ' ').trim();
    let parts;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      parts = Array.from(new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(raw), s => s.segment);
    } else {
      parts = Array.from(raw);
    }
    if (parts.length > 30) raw = parts.slice(0, 30).join('').trim();
    return raw;
  }
  const RAW_NAME = readName();
  const NAME = RAW_NAME || 'bạn';
  const NAME_START = RAW_NAME || 'Bạn';
  $$('[data-name]').forEach(el => { el.textContent = el.dataset.name === 'start' ? NAME_START : NAME; });
  if (RAW_NAME) document.title = `Bưu Điện Mây · gửi ${RAW_NAME}`;

  /* ================= sound ================= */
  const Sound = {
    ctx: null, buffers: {}, els: {}, on: store.get('bdm-sound') !== 'off', unlocked: false,
    files: { pop: 'sfx/pop.mp3', stamp: 'sfx/stamp.mp3', paper: 'sfx/paper.mp3', bell: 'sfx/bell.mp3', boing: 'sfx/boing.mp3', sparkle: 'sfx/sparkle.mp3' },
    vol: { pop: 0.75, stamp: 0.85, paper: 0.6, bell: 0.55, boing: 0.45, sparkle: 0.5 },
    unlock() {
      if (this.unlocked) { this.resume(); return; }
      this.unlocked = true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        try {
          this.ctx = new AC();
          const b = this.ctx.createBuffer(1, 1, 22050);
          const s = this.ctx.createBufferSource();
          s.buffer = b; s.connect(this.ctx.destination); s.start(0);
        } catch (e) { this.ctx = null; }
      }
      Object.keys(this.files).forEach(k => this.load(k, this.files[k]));
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); },
    load(k, url) {
      if (this.ctx && window.location.protocol !== 'file:' && window.fetch) {
        fetch(url)
          .then(r => { if (!r.ok) throw new Error('sfx'); return r.arrayBuffer(); })
          .then(ab => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
          .then(buf => { this.buffers[k] = buf; })
          .catch(() => this.useEl(k, url));
      } else this.useEl(k, url);
    },
    useEl(k, url) { try { const a = new Audio(url); a.preload = 'auto'; this.els[k] = a; } catch (e) { /* no audio */ } },
    play(k, rate = 1) {
      if (!this.on || !this.unlocked) return;
      const v = this.vol[k] == null ? 0.6 : this.vol[k];
      if (this.ctx && this.buffers[k]) {
        this.resume();
        const s = this.ctx.createBufferSource();
        s.buffer = this.buffers[k];
        s.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = v;
        s.connect(g); g.connect(this.ctx.destination);
        s.start();
      } else if (this.els[k]) {
        try {
          const a = this.els[k].cloneNode();
          a.volume = v; a.playbackRate = rate;
          const p = a.play(); if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignore */ }
      } else if (this.ctx) {
        // tiny synthesized blip while files are still loading
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
        o.type = 'sine'; o.frequency.setValueAtTime(660 * rate, t); o.frequency.exponentialRampToValueAtTime(990 * rate, t + 0.08);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.15);
      }
    },
  };

  const soundBtn = $('#soundBtn');
  function syncSoundBtn() {
    soundBtn.setAttribute('aria-pressed', String(Sound.on));
    soundBtn.setAttribute('aria-label', Sound.on ? 'Tắt âm thanh' : 'Bật âm thanh');
  }
  syncSoundBtn();
  soundBtn.addEventListener('click', () => {
    Sound.on = !Sound.on;
    store.set('bdm-sound', Sound.on ? 'on' : 'off');
    syncSoundBtn();
    Sound.unlock();
    Sound.play('pop', 1.2);
  });

  /* ================= hero illustration ================= */
  const BODY = 'M-44 40 C-66 40 -72 16 -56 6 C-64 -16 -42 -32 -24 -24 C-16 -42 18 -44 28 -26 C46 -32 66 -14 58 4 C72 12 68 40 46 40 Z';
  const HAT = 'M-38 -24 C-40 -60 36 -64 38 -24Z';
  function heroInner(o = {}) {
    const hid = 'style="display:none"';
    const ink = '#49352D';
    return `
<ellipse cx="0" cy="46" rx="46" ry="6.5" fill="${ink}" opacity=".12"/>
${o.feet ? `<g class="h-feet">
  <g class="h-foot fl"><path d="M-18 32 L-21 50" stroke="${ink}" stroke-width="3.4" stroke-linecap="round" fill="none"/><ellipse cx="-22" cy="52" rx="7.5" ry="4.8" fill="#FFB7C5" stroke="${ink}" stroke-width="2.6"/></g>
  <g class="h-foot fr"><path d="M16 32 L19 50" stroke="${ink}" stroke-width="3.4" stroke-linecap="round" fill="none"/><ellipse cx="20" cy="52" rx="7.5" ry="4.8" fill="#FFB7C5" stroke="${ink}" stroke-width="2.6"/></g>
</g>` : ''}
<g class="h-body">
  <path d="${BODY}" transform="translate(4 5)" fill="#C9BEF5" opacity=".6"/>
  <path d="${BODY}" fill="#FFFFFF"/>
  <ellipse cx="2" cy="31" rx="40" ry="7" fill="#F1ECFF"/>
  <path d="M-46 -2 C-48 -12 -40 -18 -34 -16" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
  <path d="${BODY}" fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>
  <ellipse class="h-cheek" data-cx="-27" data-cy="13" cx="-27" cy="13" rx="8" ry="5" fill="#FFB7C5"/>
  <ellipse class="h-cheek" data-cx="24" data-cy="13" cx="24" cy="13" rx="8" ry="5" fill="#FFB7C5"/>
  <g class="h-lines" ${hid} stroke="#E0708C" stroke-width="1.8" stroke-linecap="round"><path d="M-33 9 l3 6 M-28 9 l3 6 M-23 9 l3 6"/><path d="M18 9 l3 6 M23 9 l3 6 M28 9 l3 6"/></g>
  <g class="h-eyes">
    <g class="e e-open"><ellipse cx="-14" cy="2" rx="4.3" ry="5.6" fill="${ink}"/><ellipse cx="12" cy="2" rx="4.3" ry="5.6" fill="${ink}"/><circle cx="-12.6" cy="-0.6" r="1.6" fill="#fff"/><circle cx="13.4" cy="-0.6" r="1.6" fill="#fff"/></g>
    <g class="e e-happy" ${hid} fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"><path d="M-19 4 q5 -6 10 0"/><path d="M7 4 q5 -6 10 0"/></g>
    <g class="e e-surprise" ${hid}><circle cx="-14" cy="1" r="5.8" fill="${ink}"/><circle cx="12" cy="1" r="5.8" fill="${ink}"/><circle cx="-12.2" cy="-1.2" r="2.1" fill="#fff"/><circle cx="13.8" cy="-1.2" r="2.1" fill="#fff"/></g>
  </g>
  <g class="h-mouth" stroke-linecap="round" stroke-linejoin="round">
    <path class="m m-smile" d="M-6 12 q5 5.5 10 0" fill="none" stroke="${ink}" stroke-width="2.6"/>
    <g class="m m-open" ${hid}><ellipse cx="-1" cy="15" rx="4" ry="5" fill="${ink}"/><ellipse cx="-1" cy="17.6" rx="2.4" ry="1.7" fill="#FF8FA8"/></g>
    <path class="m m-shy" ${hid} d="M-7 14 q2.5 -2.5 5 0 q2.5 2.5 5 0" fill="none" stroke="${ink}" stroke-width="2.4"/>
    <g class="m m-proud" ${hid}><path d="M-9 11 q8 11 16 0 z" fill="${ink}" stroke="${ink}" stroke-width="2"/><path d="M-4.5 15.6 q3.5 2.6 7 0" fill="#FF8FA8"/></g>
    <path class="m m-puff" ${hid} d="M-2 9.5 q4 2 0 4 q4 2 0 4" fill="none" stroke="${ink}" stroke-width="2.4"/>
  </g>
  <path d="M26 -27 C40 -12 44 2 48 19" fill="none" stroke="${ink}" stroke-width="5.6" stroke-linecap="round"/>
  <path d="M26 -27 C40 -12 44 2 48 19" fill="none" stroke="#BDE5D2" stroke-width="2.6" stroke-linecap="round"/>
  <g class="h-bag"><g transform="translate(44 17)">
    <rect x="-4" y="0" width="30" height="24" rx="6" fill="#BDE5D2" stroke="${ink}" stroke-width="2.6"/>
    <path d="M-4 8 Q11 17 26 8 L26 5 Q26 0 21 0 L1 0 Q-4 0 -4 5Z" fill="#FFB7C5" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="11" cy="11" r="2.6" fill="#FFE49B" stroke="${ink}" stroke-width="2"/>
  </g></g>
</g>
<g class="h-hat">
  <path d="${HAT}" transform="translate(3 4)" fill="#C9BEF5" opacity=".55"/>
  <path d="M30 -27 C50 -31 70 -26 68 -18 C56 -14 38 -16 26 -21Z" fill="#F7CF6B" stroke="${ink}" stroke-width="2.8" stroke-linejoin="round"/>
  <path d="${HAT}" fill="#FFE49B" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M-38.5 -25 C-20 -31 20 -31 38.5 -25 L37.6 -33 C20 -38 -20 -38 -38 -33Z" fill="#FFB7C5" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
  <g transform="translate(-9 -50)"><rect width="18" height="12" rx="2" fill="#fff" stroke="${ink}" stroke-width="2"/><path d="M1.5 1.8 L9 7 L16.5 1.8" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/></g>
  <path d="M-26 -42 C-22 -50 -14 -54 -8 -55" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  <circle cx="0" cy="-54" r="4" fill="#FFB7C5" stroke="${ink}" stroke-width="2.2"/>
  <g class="hat-flower" ${o.flower ? '' : hid}><g transform="translate(-24 -50) scale(.5)"><use href="#sym-bloom" x="-32" y="-32" width="64" height="64"/></g></g>
  <g class="hat-star" ${hid}><g transform="translate(8 -66) scale(.62)"><use href="#sym-star" x="-32" y="-32" width="64" height="64"/></g></g>
</g>`;
  }

  const EXPR = {
    neutral: { e: 'e-open', m: 'm-smile', cheek: 1, lines: false },
    happy: { e: 'e-happy', m: 'm-smile', cheek: 1.1, lines: false },
    surprise: { e: 'e-surprise', m: 'm-open', cheek: 0.9, lines: false },
    shy: { e: 'e-happy', m: 'm-shy', cheek: 1.4, lines: true },
    proud: { e: 'e-happy', m: 'm-proud', cheek: 1.15, lines: false },
    puff: { e: 'e-open', m: 'm-puff', cheek: 1.5, lines: false },
  };
  function applyExpr(root, name) {
    const x = EXPR[name] || EXPR.neutral;
    $$('.e', root).forEach(n => { n.style.display = n.classList.contains(x.e) ? '' : 'none'; });
    $$('.m', root).forEach(n => { n.style.display = n.classList.contains(x.m) ? '' : 'none'; });
    $$('.h-cheek', root).forEach(n => {
      const cx = n.dataset.cx, cy = n.dataset.cy;
      n.setAttribute('transform', `translate(${cx} ${cy}) scale(${x.cheek}) translate(${-cx} ${-cy})`);
    });
    const lines = $('.h-lines', root);
    if (lines) lines.style.display = x.lines ? '' : 'none';
  }

  /* ================= DOM ================= */
  const stage = $('#stage'), world = $('#world');
  const heroEl = $('#hero'), itemsEl = $('#items'), cushionEl = $('#cushion');
  const bubbleEl = $('#bubble'), bubbleIn = $('.bubble-in', bubbleEl);
  const bannerEl = $('#banner'), hintEl = $('#hint'), handEl = $('#hand');
  const control = $('#control'), hud = $('#hud'), skipBtn = $('#skipBtn');
  const slots = $$('.slot');
  const introEl = $('#intro'), helpBtn = $('#helpBtn');
  const introParcel = $('#introParcel'), ropeSvg = $('#rope'), ropePath = $('#rope path');
  const rail = $('#rail'), groundBag = $('#groundBag');
  const parcelWrap = $('#parcelWrap'), parcel = $('#parcel'), labelCard = $('#labelCard');
  const openBtn = $('#openGift'), popLayer = $('#popLayer');
  const cardEl = $('#card'), probe = $('#safeProbe');

  heroEl.innerHTML = `<svg viewBox="-80 -100 160 160" width="100%" height="100%">${heroInner()}</svg>`;
  const P = {
    body: $('.h-body', heroEl), hat: $('.h-hat', heroEl), eyes: $('.h-eyes', heroEl),
    eOpen: $('.e-open', heroEl), bag: $('.h-bag', heroEl),
    hatFlower: $('.hat-flower', heroEl), hatStar: $('.hat-star', heroEl),
  };

  // bunting flags along Q(-4,10)(180,66)(364,10)
  (function buildBunting() {
    const g = $('#bunting'); if (!g) return;
    const cols = ['#FFB7C5', '#FFE49B', '#BDE5D2', '#C9BEF5'];
    let out = '';
    for (let i = 0; i < 11; i++) {
      const t = 0.06 + i * 0.088;
      const x = -4 + 368 * t, y = 10 + 112 * t * (1 - t);
      const ang = Math.atan2(112 * (1 - 2 * t), 368) * 180 / Math.PI;
      out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})"><path class="flag" style="animation-delay:${(-i * 0.3).toFixed(1)}s" d="M-10 0 L10 0 L0 20Z" fill="${cols[i % 4]}" stroke="#49352D" stroke-width="1.6" stroke-linejoin="round"/></g>`;
    }
    g.insertAdjacentHTML('beforeend', out);
  })();

  const gHero = $('#gHero');
  gHero.innerHTML = heroInner({ feet: true, flower: true });
  applyExpr(gHero, 'happy');

  /* ================= geometry ================= */
  const G = { W: 360, H: 640, left: 0, top: 0, S: 0.9, heroPx: 150, itemPx: 70, safeB: 0, heroY: 0, catchY: 0, floorY: 0, spawnY: 0, minX: 0, maxX: 0, g: 1500, bw: 0, bh: 0 };
  function layout() {
    const r = stage.getBoundingClientRect();
    G.W = r.width || window.innerWidth; G.H = r.height || window.innerHeight;
    G.left = r.left; G.top = r.top;
    G.safeB = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    G.heroPx = G.H < 620 ? 124 : (G.W < 380 ? 140 : 150);
    G.S = G.heroPx / 160;
    G.itemPx = Math.round(G.heroPx * 0.46);
    heroEl.style.width = heroEl.style.height = G.heroPx + 'px';
    heroEl.style.transformOrigin = `${80 * G.S}px ${140 * G.S}px`;
    G.floorY = G.H - G.safeB - 38;
    G.heroY = G.H - G.safeB - 66 - 40 * G.S;
    G.catchY = G.heroY - 56 * G.S;
    const hb = hud.getBoundingClientRect();
    G.spawnY = Math.max(hb.bottom - G.top, 60) + G.itemPx * 0.5 + 10;
    G.minX = 62 * G.S + 8;
    G.maxX = G.W - 72 * G.S - 8;
    rail.style.top = (G.heroY + 47 * G.S) + 'px';
    if (G.bw) { G.bw = bubbleEl.offsetWidth; G.bh = bubbleEl.offsetHeight; }
    hero.x = clamp(hero.x || G.W / 2, G.minX, G.maxX);
    hero.target = clamp(hero.target || G.W / 2, G.minX, G.maxX);
    layoutParcel();
  }
  function layoutParcel() {
    const hb = hud.getBoundingClientRect();
    const top = Math.max(hb.bottom - G.top + 34, G.H * 0.13);
    parcelWrap.style.top = top + 'px';
  }

  /* ================= state ================= */
  const STAGES = [
    { type: 'mochi', step: 'Chặng 1/3', title: 'Hứng chút ngọt ngào', dur: 2.6 },
    { type: 'flower', step: 'Chặng 2/3', title: 'Thêm chút rực rỡ', dur: 2.9 },
    { type: 'star', step: 'Chặng 3/3', title: 'Gom chút may mắn', dur: 3.3 },
  ];
  const LINES = {
    mochi: ['Ngọt vừa đủ. Dễ thương hơi dư.', 'Mochi xin phép vào túi nha.', 'Mềm mềm như ngày hôm nay vậy đó.'],
    flower: ['Hoa tự ứng tuyển đi giao luôn.', 'Hoa nói: cho tui đi ké với!', 'Cài hoa lên mũ cho chuyên nghiệp.'],
    star: ['May mắn hơi nghịch, nhưng tới rồi.', 'Sao lạc đường xíu, giờ về đúng chỗ.', 'May mắn đậu nhầm mũ, giờ vô túi rồi.'],
    miss: ['Đệm mây hất lại nè!', 'Suýt nữa thôi~', 'Không sao, lại nhé!', 'Ui, bay lên lại rồi!'],
  };
  const sim = {
    state: 'intro', time: 0, timers: [], items: [], stage: 0, round: 0,
    idleT: 0, hintOn: false, bubbleT: 0, introT: 0, lastLine: {}, parcelAnim: null,
  };
  const hero = {
    x: 0, vx: 0, target: 0, tilt: 0, forceTilt: null,
    hatRot: 0, hatV: 0, hatDy: 0, hatDyV: 0, hatWob: 0,
    sq: 0, sqV: 0, jumpY: 0, jumpV: 0,
    ex: 0, ey: 0, blink: 1, blinkT: 2.5, blinkHold: 0,
    expr: 'neutral', exprT: 0, bagW: 0, lookUp: 0, lookPlayer: 0,
    flowerS: 0, flowerOn: false, starOn: false, starWob: 0,
  };
  const cush = { sq: 0, v: 0 };
  const input = { dragId: null, keys: new Set(), keyDir: 0 };

  function after(sec, fn) { sim.timers.push({ at: sim.time + sec, fn }); }
  function runTimers() {
    if (!sim.timers.length) return;
    const due = sim.timers.filter(t => t.at <= sim.time);
    if (!due.length) return;
    sim.timers = sim.timers.filter(t => t.at > sim.time);
    due.sort((a, b) => a.at - b.at).forEach(t => t.fn());
  }

  function setExpr(name, dur = 0) {
    hero.expr = name; hero.exprT = dur;
    applyExpr(heroEl, name);
  }
  function chooseLine(kind) {
    const arr = LINES[kind];
    if (sim.round === 0 && kind !== 'miss') { sim.lastLine[kind] = 0; return arr[0]; }
    let i; let n = 0;
    do { i = Math.floor(Math.random() * arr.length); n++; } while (i === sim.lastLine[kind] && n < 6);
    sim.lastLine[kind] = i;
    return arr[i];
  }

  /* ================= UI bits ================= */
  function showBubble(text, dur) {
    bubbleIn.textContent = text;
    bubbleEl.classList.remove('show');
    G.bw = bubbleEl.offsetWidth; G.bh = bubbleEl.offsetHeight;
    void bubbleEl.offsetWidth;
    bubbleEl.classList.add('show');
    sim.bubbleT = dur == null ? Infinity : dur;
    positionBubble();
  }
  function hideBubble() { bubbleEl.classList.remove('show'); sim.bubbleT = 0; }
  function positionBubble() {
    const hx = hero.x;
    const side = hx > G.W / 2 ? -1 : 1;
    const cx = hx + side * G.bw * 0.22;
    const left = clamp(cx - G.bw / 2, 10, Math.max(10, G.W - G.bw - 10));
    const y = G.heroY + hero.jumpY - 62 * G.S - G.bh - 14;
    bubbleEl.style.transform = `translate3d(${left.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    bubbleEl.style.setProperty('--tail', `${clamp(hx - left, 20, G.bw - 20).toFixed(1)}px`);
  }
  function showBanner(step, title) {
    bannerEl.innerHTML = '';
    const s = document.createElement('small'); s.textContent = step;
    bannerEl.append(s, document.createTextNode(title));
    bannerEl.classList.remove('show'); void bannerEl.offsetWidth; bannerEl.classList.add('show');
  }
  function showHint() { sim.hintOn = true; hintEl.classList.add('on'); }
  function hideHint() { sim.hintOn = false; hintEl.classList.remove('on'); }
  function setControl(on) { control.classList.toggle('off', !on); rail.classList.toggle('on', on); }
  function stamp(i) {
    const s = slots[i]; if (!s || s.classList.contains('stamped')) return;
    s.classList.add('stamped');
    Sound.play('stamp');
    setTimeout(() => Sound.play('pop', 1.35), 120);
  }
  function bagPop() { hero.bagW = 1; hero.sqV += 3; Sound.play('pop', 1.15); }
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ================= hero point helpers ================= */
  function heroPt(lx, ly) {
    const S = G.S, a = hero.tilt * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = lx * S, dy = (ly - 40) * S;
    return { x: hero.x + dx * c - dy * s, y: G.heroY + hero.jumpY + 40 * S + dx * s + dy * c };
  }
  function toLocal(x, y) { return { x: (x - hero.x) / G.S, y: (y - G.heroY - hero.jumpY) / G.S }; }

  /* ================= intro ================= */
  function introLayout() {
    sim.introBaseX = G.W * 0.22;
    hero.x = hero.target = clamp(G.W * 0.66, G.minX, G.maxX);
  }
  function updateIntro(dt) {
    sim.introT += dt;
    const tug = Math.max(0, Math.sin(sim.introT * 6.2));
    hero.forceTilt = 9 + tug * 7;
    hero.sq = 0.06 + tug * 0.16; hero.sqV = 0;
    hero.ex = -3.5; hero.ey = 0.5;
    if (!sim.parcelAnim) {
      sim.introX = sim.introBaseX + Math.min(26, sim.introT * 2.6) + tug * 4;
      sim.introRot = -tug * 5;
      sim.introS = 1;
    }
  }
  function renderIntro() {
    const pw = G.heroPx * 0.8;
    const ph = pw * 112 / 120;
    introParcel.style.width = pw + 'px'; introParcel.style.height = ph + 'px';
    const bottom = G.heroY + 46 * G.S;
    introParcel.style.transform = `translate3d(${(sim.introX - pw / 2).toFixed(1)}px, ${(bottom - ph + (sim.introDy || 0)).toFixed(1)}px, 0) rotate(${(sim.introRot || 0).toFixed(2)}deg) scale(${(sim.introS || 1).toFixed(3)})`;
    if (sim.state === 'intro') {
      const a = heroPt(-56, 14);
      const b = { x: sim.introX + pw * 0.42, y: bottom - ph * 0.55 };
      const tug = Math.max(0, Math.sin(sim.introT * 6.2));
      const mx = (a.x + b.x) / 2, my = Math.max(a.y, b.y) + 16 - tug * 14;
      ropePath.setAttribute('d', `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
  }
  function startHelp() {
    if (sim.state !== 'intro') return;
    Sound.unlock();
    Sound.play('pop');
    sim.state = 'intro-out';
    introEl.classList.add('out');
    ropeSvg.style.display = 'none';
    hero.forceTilt = null;
    setExpr('proud', 1.2);
    const from = { x: sim.introX, s: 1 };
    sim.parcelAnim = { t: 0, from };
    after(0.62, () => {
      introParcel.style.display = 'none';
      bagPop();
      showBubble('Cất vô túi đã. Giờ đi gom quà nè!', 1.8);
    });
    after(1.2, () => startCollect(true));
  }
  function updateParcelAnim(dt) {
    const a = sim.parcelAnim; if (!a) return;
    a.t += dt;
    const q = Math.min(1, a.t / 0.6), e = easeInOut(q);
    const bag = heroPt(58, 26);
    const pw = G.heroPx * 0.8, ph = pw * 112 / 120;
    const bottom = G.heroY + 46 * G.S;
    sim.introX = lerp(a.from.x, bag.x, e);
    sim.introDy = lerp(0, bag.y - (bottom - ph / 2), e) - Math.sin(Math.PI * q) * 60;
    sim.introS = lerp(1, 0.18, e);
    sim.introRot = 360 * e;
    if (q >= 1) sim.parcelAnim = null;
  }

  /* ================= collecting ================= */
  function startCollect(tutorial) {
    sim.state = tutorial ? 'tutorial' : 'collecting';
    hud.classList.remove('off');
    skipBtn.hidden = false;
    setControl(true);
    hero.forceTilt = null;
    sim.stage = 0;
    startStage(0, tutorial);
  }
  function startStage(i, tutorial) {
    sim.stage = i;
    const st = STAGES[i];
    showBanner(st.step, st.title);
    if (tutorial) showHint();
    after(tutorial ? 0.5 : 1.0, () => spawnItem(st.type));
  }

  function makeItemEl(type) {
    const d = document.createElement('div');
    d.className = 'item';
    d.style.width = d.style.height = G.itemPx + 'px';
    d.innerHTML = `<svg viewBox="-32 -32 64 64" width="100%" height="100%"><use href="#sym-${type}" x="-32" y="-32" width="64" height="64"/></svg>`;
    itemsEl.appendChild(d);
    return d;
  }
  function pickSpawnX() {
    const lo = G.minX, hi = G.maxX;
    if (sim.round > 0) {
      let x = rand(lo, hi), n = 0;
      while (Math.abs(x - hero.x) < 80 && n++ < 10) x = rand(lo, hi);
      return x;
    }
    const away = Math.min(170, (hi - lo) * 0.6);
    let dir = hero.x < G.W / 2 ? 1 : -1;
    return clamp(hero.x + dir * rand(away * 0.65, away), lo, hi);
  }
  function catchHalf(it) { return (72 + (it.misses >= 2 ? 22 : 0) + (it.misses >= 4 ? 14 : 0)) * G.S; }
  function fallSpeed(it) {
    const D = Math.max(120, G.catchY - G.spawnY);
    let dur = STAGES.find(s => s.type === it.type).dur;
    if (it.tut) dur = 4.0;
    const mul = it.misses >= 4 ? 0.55 : it.misses >= 2 ? 0.72 : 1;
    return D / dur * mul;
  }
  function spawnItem(type) {
    if (sim.items.some(i => i.state !== 'gone')) return;   // never two main items at once
    const x = pickSpawnX();
    const it = {
      type, el: makeItemEl(type), x, baseX: x, y: G.spawnY, vx: 0, vy: 0, t: 0, ramp: 1,
      state: 'enter', rot: 0, sc: 0, sx: 1, sy: 1, op: 1,
      swoop: null, swoopOff: 0, swoopTilt: 0, swoopDone: false, misses: 0,
      tut: sim.state === 'tutorial', lx0: 0, ly0: 0,
    };
    it.speed = fallSpeed(it);
    sim.items.push(it);
    Sound.play('pop', 1.3);
  }

  function updateItems(dt) {
    const half = G.itemPx / 2;
    for (const it of sim.items) {
      if (it.state === 'gone') continue;
      it.t += dt;
      if (it.state === 'enter') {
        const k = Math.min(1, it.t / 0.35);
        it.sc = 0.4 + 0.6 * easeOut(k) + Math.sin(k * Math.PI) * 0.15;
        it.rot = Math.sin(it.t * 9) * 6;
        if (k >= 1) { it.state = 'fall'; it.t = 0; it.sc = 1; it.ramp = 1; }
        continue;
      }
      if (it.state === 'fall') {
        it.ramp = Math.min(1, it.ramp + dt / 0.4);
        it.y += it.speed * (0.3 + 0.7 * it.ramp) * dt;
        const prog = (it.y - G.spawnY) / Math.max(1, G.catchY - G.spawnY);
        if (it.type === 'mochi') {
          it.x = it.baseX + Math.sin(it.t * 2.2) * 6 * G.S;
          it.rot = Math.sin(it.t * 3) * 8;
          it.sx = 1 + Math.sin(it.t * 5) * 0.035; it.sy = 2 - it.sx;
        } else if (it.type === 'flower') {
          if (!it.swoopDone && !it.swoop && prog > 0.34) it.swoop = { t: 0, dir: it.baseX < G.W / 2 ? 1 : -1 };
          it.swoopTilt = 0;
          if (it.swoop) {
            it.swoop.t += dt;
            const q = Math.min(1, it.swoop.t / 0.6);
            it.swoopOff = it.swoop.dir * 72 * G.S * easeInOut(q);
            it.swoopTilt = it.swoop.dir * 28 * Math.sin(Math.PI * q);
            if (q >= 1) { it.baseX = clamp(it.baseX + it.swoopOff, G.minX, G.maxX); it.swoopOff = 0; it.swoop = null; it.swoopDone = true; }
          }
          it.x = it.baseX + it.swoopOff + Math.sin(it.t * 2.6) * 18 * G.S;
          it.rot = Math.cos(it.t * 2.6) * 12 + it.swoopTilt;
          it.sx = it.sy = 1;
        } else {
          it.x = it.baseX + Math.sin(it.t * 1.5) * 14 * G.S;
          it.rot = Math.sin(it.t * 1.8) * 16;
          it.sx = it.sy = 1 + Math.sin(it.t * 6) * 0.05;
        }
        it.x = clamp(it.x, half + 4, G.W - half - 4);
        const dx = Math.abs(it.x - hero.x);
        if (it.y >= G.catchY - half * 0.7 && it.y <= G.catchY + 44 * G.S && dx <= catchHalf(it)) { onCatch(it); continue; }
        if (it.y >= G.floorY) onMiss(it);
        continue;
      }
      if (it.state === 'rebound') {
        it.vy += G.g * dt; it.y += it.vy * dt; it.x += it.vx * dt; it.rot += it.spin * dt;
        it.sx = it.sy = 1;
        if (it.vy >= 0) {
          it.state = 'fall'; it.t = 0; it.ramp = 0; it.baseX = it.x; it.rot = 0;
          it.swoopDone = it.misses >= 2; it.speed = fallSpeed(it);
        }
        continue;
      }
      if (it.state === 'caught') updateCaught(it, dt);
    }
    if (sim.items.length && sim.items.every(i => i.state === 'gone')) sim.items = [];
  }

  function onMiss(it) {
    it.misses++;
    it.y = G.floorY;
    cush.v += 7;
    Sound.play('boing');
    const lo = G.minX, hi = G.maxX;
    const nx = it.misses >= 2 ? clamp(hero.x + rand(-60, 60) * G.S, lo, hi) : rand(lo, hi);
    const apex = G.spawnY + 20;
    it.vy = -Math.sqrt(2 * G.g * Math.max(80, it.y - apex));
    const tA = -it.vy / G.g;
    it.vx = (nx - it.x) / tA;
    it.spin = (nx > it.x ? 1 : -1) * 360 / tA;
    it.state = 'rebound'; it.t = 0; it.swoop = null; it.swoopOff = 0;
    setExpr('surprise', 0.8);
    if (it.misses === 2) showBubble('Để mình thả chậm lại cho dễ hứng nè~', 1.9);
    else if (it.misses === 1 || it.misses % 2 === 1) showBubble(chooseLine('miss'), 1.4);
  }

  function onCatch(it) {
    it.state = 'caught'; it.t = 0;
    const L = toLocal(it.x, it.y); it.lx0 = L.x; it.ly0 = L.y;
    hero.sqV += 8; hero.hatDyV += 70;
    Sound.play('pop');
    sim.idleT = 0; hideHint();
    if (sim.state === 'tutorial') sim.state = 'collecting';
    const line = chooseLine(it.type);
    if (it.type === 'mochi') {
      setExpr('surprise', 0.55);
      after(0.95, () => { bagPop(); setExpr('puff', 2.3); showBubble(line, 2.4); });
      after(2.5, () => stamp(0));
      after(3.3, () => startStage(1));
    } else if (it.type === 'flower') {
      setExpr('happy', 0.5);
      after(0.5, () => { hero.flowerOn = true; hero.flowerS = 0.01; P.hatFlower.style.display = ''; setExpr('proud', 2.2); Sound.play('sparkle', 1.1); });
      after(0.6, () => showBubble(line, 2.4));
      after(2.3, () => stamp(1));
      after(3.1, () => startStage(2));
    } else {
      after(0.32, () => { hero.starOn = true; P.hatStar.style.display = ''; hero.lookUp = 1; setExpr('surprise'); Sound.play('sparkle'); });
      after(1.45, () => { hero.starOn = false; P.hatStar.style.display = 'none'; });
      after(2.0, () => { bagPop(); hero.lookUp = 0; setExpr('happy', 2.2); showBubble(line, 2.4); });
      after(3.4, () => stamp(2));
      after(4.4, () => goDelivery(false));
    }
  }

  function updateCaught(it, dt) {
    const t = it.t;
    let lx, ly, sc = 1, rot = 0, sx = 1, sy = 1, hidden = false, done = false;
    if (it.type === 'mochi') {
      const top = -84;
      if (t < 0.55) {
        const p = t / 0.55;
        lx = lerp(it.lx0, 0, easeOut(Math.min(1, p * 1.4)));
        ly = lerp(Math.max(it.ly0, top), top, Math.min(1, p * 3)) - Math.sin(Math.PI * p) * 42;
        if (p < 0.16) { sx = 1.22; sy = 0.8; } else if (p > 0.88) { sx = 1.15; sy = 0.86; }
      } else if (t < 0.95) {
        const q = (t - 0.55) / 0.4, e = easeInOut(q);
        lx = lerp(0, 58, e); ly = lerp(top, 30, e) - Math.sin(Math.PI * q) * 34;
        sc = lerp(1, 0.28, e); rot = 40 * e;
      } else done = true;
    } else if (it.type === 'flower') {
      if (t < 0.5) {
        const p = t / 0.5, e = easeOut(p);
        lx = lerp(it.lx0, -24, e); ly = lerp(it.ly0, -46, e) - Math.sin(Math.PI * p) * 40;
        sc = lerp(1, 0.55, e); rot = lerp(0, -20, e) + Math.sin(p * 12) * 8 * (1 - p);
      } else done = true;
    } else {
      if (t < 0.32) {
        const p = t / 0.32, e = easeOut(p);
        lx = lerp(it.lx0, 8, e); ly = lerp(it.ly0, -66, e) - Math.sin(Math.PI * p) * 22;
        sc = lerp(1, 0.55, e); rot = 120 * e;
      } else if (t < 1.45) {
        hidden = true; lx = 8; ly = -66;
      } else if (t < 2.0) {
        const q = (t - 1.45) / 0.55, e = easeInOut(q), u = 1 - e;
        lx = u * u * 8 + 2 * u * e * 76 + e * e * 58;
        ly = u * u * -66 + 2 * u * e * -48 + e * e * 30;
        sc = lerp(0.55, 0.26, e); rot = 360 * e;
      } else done = true;
    }
    if (done) { it.state = 'gone'; it.el.remove(); return; }
    const p = heroPt(lx, ly);
    it.x = p.x; it.y = p.y; it.sc = sc; it.rot = rot; it.sx = sx; it.sy = sy;
    it.op = hidden ? 0 : 1;
  }

  function renderItems() {
    const half = G.itemPx / 2;
    for (const it of sim.items) {
      if (it.state === 'gone') continue;
      it.el.style.opacity = it.op;
      it.el.style.transform = `translate3d(${(it.x - half).toFixed(1)}px, ${(it.y - half).toFixed(1)}px, 0) rotate(${it.rot.toFixed(1)}deg) scale(${(it.sc * it.sx).toFixed(3)}, ${(it.sc * it.sy).toFixed(3)})`;
    }
  }
  function clearItems() { sim.items.forEach(i => i.el.remove()); sim.items = []; }

  /* ================= hero sim + render ================= */
  function updateHero(dt) {
    if (input.keyDir && canControl()) hero.target += input.keyDir * 560 * dt;
    hero.target = clamp(hero.target, G.minX, G.maxX);
    if (sim.state !== 'intro') {
      const k = 170, c = 2 * Math.sqrt(k) * 0.8;
      hero.vx += ((hero.target - hero.x) * k - hero.vx * c) * dt;
      hero.x += hero.vx * dt;
    } else hero.vx = 0;
    const tiltT = hero.forceTilt != null ? hero.forceTilt : clamp(hero.vx * 0.022, -16, 16);
    hero.tilt = lerp(hero.tilt, tiltT, 1 - Math.exp(-12 * dt));
    hero.hatV += ((hero.tilt - hero.hatRot) * 70 - hero.hatV * 6.5) * dt;
    hero.hatRot += hero.hatV * dt;
    if (sim.state !== 'intro') {
      hero.sqV += (-hero.sq * 260 - hero.sqV * 11) * dt;
      hero.sq += hero.sqV * dt;
    }
    hero.hatDyV += (-hero.hatDy * 220 - hero.hatDyV * 10) * dt;
    hero.hatDy += hero.hatDyV * dt;
    if (hero.jumpY < 0 || hero.jumpV !== 0) {
      hero.jumpV += 2300 * dt; hero.jumpY += hero.jumpV * dt;
      if (hero.jumpY >= 0) {
        if (hero.jumpV > 150) { hero.sqV += 7; hero.hatDyV += 60; }
        hero.jumpY = 0; hero.jumpV = 0;
      }
    }
    // eyes
    if (sim.state !== 'intro') {
      let tx = clamp(hero.vx * 0.02, -4.5, 4.5), ty = 0;
      const falling = sim.items.find(i => i.state === 'fall' || i.state === 'rebound');
      if (Math.abs(hero.vx) < 40 && falling) { tx = clamp((falling.x - hero.x) / G.S * 0.04, -4, 4); ty = -2.5; }
      if (hero.lookUp) { tx = 1.5; ty = -5; }
      if (hero.lookPlayer) { tx = 0; ty = 1; }
      hero.ex = lerp(hero.ex, tx, 1 - Math.exp(-14 * dt));
      hero.ey = lerp(hero.ey, ty, 1 - Math.exp(-14 * dt));
    }
    // blink
    if (hero.blinkHold > 0) { hero.blinkHold -= dt; hero.blink = 0.12; if (hero.blinkHold <= 0) hero.blink = 1; }
    else if ((hero.blinkT -= dt) <= 0) { hero.blinkHold = 0.13; hero.blinkT = rand(2.2, 4.6); }
    // expression timeout
    if (hero.exprT > 0 && (hero.exprT -= dt) <= 0) setExpr('neutral');
    hero.bagW = Math.max(0, hero.bagW - dt * 2.2);
    if (hero.flowerOn) hero.flowerS += (1 - hero.flowerS) * (1 - Math.exp(-10 * dt)) + (hero.flowerS < 1 ? Math.sin(sim.time * 30) * 0 : 0);
    hero.starWob = hero.starOn ? Math.sin(sim.time * 10) * 12 : 0;
    // cushion
    cush.v += (-cush.sq * 300 - cush.v * 12) * dt;
    cush.sq += cush.v * dt;
  }

  function renderHero() {
    const S = G.S;
    heroEl.style.transform = `translate3d(${(hero.x - 80 * S).toFixed(2)}px, ${(G.heroY + hero.jumpY - 100 * S).toFixed(2)}px, 0) rotate(${hero.tilt.toFixed(2)}deg)`;
    const breathe = reduced() ? 0 : Math.sin(sim.time * 2.4) * 0.016;
    const sx = 1 + hero.sq * 0.2 - breathe * 0.5, sy = 1 - hero.sq * 0.2 + breathe;
    P.body.setAttribute('transform', `translate(0 40) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(0 -40)`);
    const hatRel = clamp(hero.hatRot - hero.tilt, -24, 24);
    const hatY = (sy - 1) * 68 + hero.hatDy;
    const hatX = clamp(-hero.vx * 0.006, -5, 5);
    P.hat.setAttribute('transform', `translate(${hatX.toFixed(2)} ${hatY.toFixed(2)}) rotate(${hatRel.toFixed(2)} 0 -26)`);
    P.eyes.setAttribute('transform', `translate(${hero.ex.toFixed(2)} ${hero.ey.toFixed(2)})`);
    P.eOpen.setAttribute('transform', `translate(0 2) scale(1 ${hero.blink.toFixed(3)}) translate(0 -2)`);
    const bw = hero.bagW;
    P.bag.setAttribute('transform', `rotate(${(Math.sin(sim.time * 24) * bw * 14).toFixed(2)} 58 17) translate(58 29) scale(${(1 + bw * 0.14).toFixed(3)}) translate(-58 -29)`);
    if (hero.flowerOn) {
      const s = hero.flowerS < 0.98 ? hero.flowerS * (1 + Math.sin(hero.flowerS * Math.PI) * 0.35) : 1;
      P.hatFlower.setAttribute('transform', `translate(-24 -50) scale(${s.toFixed(3)}) translate(24 50)`);
    }
    if (hero.starOn) P.hatStar.setAttribute('transform', `rotate(${hero.starWob.toFixed(2)} 8 -54)`);
    cushionEl.style.transform = `scale(${(1 + cush.sq * 0.03).toFixed(4)}, ${(1 - cush.sq * 0.14).toFixed(4)})`;
  }

  /* ================= delivery ================= */
  function goDelivery(skipped) {
    if (['delivery', 'ready', 'opening', 'card'].includes(sim.state)) return;
    const fromIntro = sim.state === 'intro' || sim.state === 'intro-out';
    sim.state = 'delivery';
    sim.timers = [];
    sim.parcelAnim = null;
    clearItems();
    hideHint(); hideBubble();
    bannerEl.classList.remove('show');
    setControl(false);
    input.dragId = null;
    skipBtn.hidden = true;
    hud.classList.remove('off');
    if (fromIntro) {
      introEl.classList.add('out');
      ropeSvg.style.display = 'none';
      introParcel.style.display = 'none';
      Sound.unlock();
    }
    hero.forceTilt = null; hero.starOn = false; P.hatStar.style.display = 'none';
    hero.lookUp = 0; hero.lookPlayer = 0;
    hero.target = G.W / 2;
    setExpr(skipped ? 'happy' : 'proud', 1.2);
    layoutParcel();

    after(0.6, () => {
      P.bag.style.display = 'none';
      const p = heroPt(70, 26);
      groundBag.style.transform = `translate3d(${(p.x - 20).toFixed(1)}px, ${(G.heroY + 46 * G.S - 30).toFixed(1)}px, 0)`;
      groundBag.classList.add('show');
      hero.sqV += 5;
      Sound.play('pop', 0.9);
    });
    after(1.1, popItemsOut);
    after(1.95, gatherItems);
    after(2.3, () => { parcel.classList.add('show'); Sound.play('paper'); });
    after(2.9, () => {
      popLayer.innerHTML = '';
      if (!reduced() && G.H >= 600) {
        const r = parcel.getBoundingClientRect();
        world.style.transformOrigin = `${(r.left + r.width / 2 - G.left).toFixed(0)}px ${(r.top + r.height / 2 - G.top).toFixed(0)}px`;
        world.classList.add('zoom');
      }
    });
    after(3.4, () => { hero.sqV += 6; setExpr('proud'); });
    after(3.62, () => { hero.jumpV = -640; hero.sqV -= 9; Sound.play('pop', 1.4); });
    after(3.85, () => { labelCard.classList.add('flipped'); Sound.play('paper', 1.25); });
    after(4.3, () => { hero.lookUp = 1; setExpr('surprise'); });
    after(5.9, () => {
      hero.lookUp = 0; hero.lookPlayer = 1; setExpr('shy');
      showBubble(sim.round > 0 ? `Ủa… lại là đơn của ${NAME} nè!` : `Ủa… đơn này của ${NAME} nè!`, null);
      Sound.play('bell');
    });
    after(6.9, () => { sim.state = 'ready'; openBtn.classList.add('show'); });
  }

  function parcelCenter() {
    const r = parcel.getBoundingClientRect();
    return { x: r.left + r.width / 2 - G.left, y: r.top + r.height / 2 - G.top, w: r.width };
  }
  function popItemsOut() {
    const gb = groundBag.getBoundingClientRect();
    const sx = gb.left + gb.width / 2 - G.left, sy = gb.top + 6 - G.top;
    const c = parcelCenter();
    const spread = Math.min(96, c.w * 0.36);
    const targets = [
      { type: 'mochi', x: c.x - spread, y: c.y + 10, r: -14 },
      { type: 'flower', x: c.x, y: c.y - 40, r: 10 },
      { type: 'star', x: c.x + spread, y: c.y + 10, r: 22 },
    ];
    popLayer.innerHTML = '';
    targets.forEach((tg, i) => {
      const d = document.createElement('div');
      d.className = 'fly';
      d.innerHTML = `<svg viewBox="-32 -32 64 64" width="64" height="64"><use href="#sym-${tg.type}" x="-32" y="-32" width="64" height="64"/></svg>`;
      d.style.transform = `translate3d(${sx}px, ${sy}px, 0) scale(.2)`;
      d.style.transitionDelay = (i * 0.12) + 's';
      popLayer.appendChild(d);
      d.getBoundingClientRect();
      requestAnimationFrame(() => { d.style.transform = `translate3d(${tg.x}px, ${tg.y}px, 0) rotate(${tg.r}deg) scale(1)`; });
      setTimeout(() => Sound.play('pop', 1 + i * 0.15), i * 120);
    });
  }
  function gatherItems() {
    const c = parcelCenter();
    $$('.fly', popLayer).forEach((d, i) => {
      d.classList.add('in');
      d.style.transitionDelay = (i * 0.05) + 's';
      d.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) rotate(${180 + i * 60}deg) scale(.15)`;
      d.style.opacity = '0';
    });
  }

  function openGift() {
    if (sim.state !== 'ready') return;
    sim.state = 'opening';
    Sound.play('paper', 0.9);
    openBtn.classList.remove('show');
    hideBubble();
    parcel.classList.add('burst');
    setExpr('proud');
    hero.jumpV = -420;
    after(0.75, showCard);
  }

  /* ================= card ================= */
  let eggT = 0;
  function showCard() {
    sim.state = 'card';
    stopLoop();
    stage.hidden = true;
    cardEl.hidden = false;
    cardEl.scrollTop = 0;
    applyExpr(gHero, 'happy');
    $('.g-egg-stamp').classList.remove('show');
    $$('.rv', cardEl).forEach((el, i) => el.style.setProperty('--rv', (reduced() ? 0 : 0.12 + i * 0.13).toFixed(2) + 's'));
    cardEl.classList.remove('enter'); void cardEl.offsetWidth; cardEl.classList.add('enter');
    petalBurst();
    setTimeout(() => Sound.play('bell', 1.12), 250);
  }
  function petalBurst() {
    const layer = $('#petals');
    layer.innerHTML = '';
    if (reduced()) return;
    const colors = ['#FFB7C5', '#C9BEF5', '#FFE49B', '#BDE5D2', '#FFD0DA'];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'petal';
      p.style.left = rand(-2, 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--d', rand(2.2, 3.2).toFixed(2) + 's');
      p.style.setProperty('--delay', rand(0, 0.7).toFixed(2) + 's');
      p.style.setProperty('--dx', rand(-80, 80).toFixed(0) + 'px');
      p.style.setProperty('--rot', rand(180, 540).toFixed(0) + 'deg');
      const s = rand(0.8, 1.4); p.style.width = 14 * s + 'px'; p.style.height = 10 * s + 'px';
      layer.appendChild(p);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 4400);
  }
  function replayClass(el, cls) { el.classList.remove(cls); el.getBoundingClientRect(); void el.offsetWidth; el.classList.add(cls); }
  function egg(kind, el) {
    Sound.unlock();
    if (kind === 'hero') {
      applyExpr(gHero, 'shy');
      $('.g-egg-stamp').classList.add('show');
      Sound.play('stamp');
      clearTimeout(eggT);
      eggT = setTimeout(() => { applyExpr(gHero, 'happy'); $('.g-egg-stamp').classList.remove('show'); }, 2600);
    } else if (kind === 'mochi') { replayClass(el, 'bounce'); Sound.play('boing', 1.3); }
    else if (kind === 'flower') { replayClass(el, 'bow'); Sound.play('pop', 0.85); }
    else if (kind === 'star') { replayClass(el, 'flash'); Sound.play('sparkle'); }
  }
  $$('#gardenSvg [data-egg]').forEach(el => {
    el.addEventListener('click', () => egg(el.dataset.egg, el));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); egg(el.dataset.egg, el); } });
  });

  /* ================= PNG export ================= */
  const FF = '"Be Vietnam Pro", "Segoe UI", Roboto, system-ui, -apple-system, sans-serif';
  function slug(s) {
    return (s.normalize ? s.normalize('NFD') : s).replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 30) || 'ban';
  }
  function gardenSVGString(w) {
    const clone = $('#gardenSvg').cloneNode(true);
    const st = $('.g-egg-stamp', clone); if (st) st.parentNode.removeChild(st);
    const hero2 = $('#gHero', clone); if (hero2) { hero2.removeAttribute('id'); applyExpr(hero2, 'happy'); }
    clone.removeAttribute('id');
    clone.setAttribute('width', w);
    clone.setAttribute('height', Math.round(w * 320 / 360));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const defs = $('#defs').cloneNode(true); defs.removeAttribute('id');
    clone.insertBefore(defs, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }
  function wrapLines(ctx, text, maxW) {
    const words = text.split(' ');
    const out = []; let line = '';
    const pushLong = w => {
      let chunk = '';
      for (const ch of Array.from(w)) {
        if (ctx.measureText(chunk + ch).width > maxW && chunk) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      return chunk;
    };
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) out.push(line);
      line = ctx.measureText(w).width > maxW ? pushLong(w) : w;
    }
    if (line) out.push(line);
    return out;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  async function renderCardPNG() {
    if (document.fonts && document.fonts.load) {
      const sample = `${NAME} Chúc ngày dễ thương được trân trọng —`;
      await Promise.all(['800 54px', '500 38px', 'italic 500 31px', '700 26px']
        .map(f => document.fonts.load(`${f} "Be Vietnam Pro"`, sample).catch(() => null)));
    }
    const W = 1080, M = 40, pad = 84;
    const gw = W - 2 * pad, gh = Math.round(gw * 320 / 360);
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(gardenSVGString(gw * 2)));
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const maxW = W - 2 * pad - 20;
    const blocks = [
      { font: `800 34px ${FF}`, lh: 50, color: '#A63A57', lines: [`Gửi ${NAME} ♡`], gap: 34, pill: true },
      { font: `800 54px ${FF}`, lh: 74, color: '#49352D', lines: [`Chúc ${NAME} một ngày 20/10 thật dễ thương 🌷`], gap: 30 },
      { font: `500 38px ${FF}`, lh: 62, color: '#49352D', lines: ['Có chút ngọt ngào để vui,', 'chút may mắn để mọi chuyện nhẹ nhàng,', 'và thật nhiều dịu dàng dành cho chính mình.'], gap: 30 },
      { font: `500 38px ${FF}`, lh: 62, color: '#49352D', lines: [`Mong ${NAME} luôn được trân trọng,`, 'được làm điều mình thích,', 'và có thật nhiều lý do để cười —', 'hôm nay và cả những ngày bình thường nữa.'], gap: 44 },
      { font: `italic 500 31px ${FF}`, lh: 48, color: '#6E564C', lines: [`Có người chuẩn bị chuyến giao này chỉ để ${NAME} vui thêm một chút.`], gap: 26, note: true },
      { font: `700 29px ${FF}`, lh: 42, color: '#6E564C', lines: ['— Mây shipper, Bưu Điện Mây ☁'], gap: 0 },
    ];
    let textH = 0;
    blocks.forEach(b => {
      ctx.font = b.font;
      b.wrapped = [];
      b.lines.forEach(l => b.wrapped.push(...wrapLines(ctx, l, maxW)));
      textH += b.wrapped.length * b.lh + b.gap;
    });
    const top = M + 44;
    const H = top + gh + 70 + textH + 60 + 70 + M;
    c.width = W; c.height = H;
    ctx.font = blocks[0].font;   // re-set after resize
    const cw = W - 2 * M - 12, ch = H - 2 * M - 16;
    // polka-dot backdrop
    ctx.fillStyle = '#FFF8EE'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(201,190,245,.45)';
    for (let yy = 12; yy < H; yy += 36) for (let xx = (yy / 36) % 2 ? 30 : 12; xx < W; xx += 36) { ctx.beginPath(); ctx.arc(xx, yy, 3, 0, Math.PI * 2); ctx.fill(); }
    // paper card
    ctx.fillStyle = '#C9BEF5'; roundRect(ctx, M + 12, M + 16, cw, ch, 44); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; roundRect(ctx, M, M, cw, ch, 44); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#49352D'; ctx.stroke();
    ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = '#FFCFDA';
    roundRect(ctx, M + 18, M + 18, cw - 36, ch - 36, 30); ctx.stroke(); ctx.setLineDash([]);
    // garden
    ctx.save(); roundRect(ctx, pad - 6, top, gw, gh, 30); ctx.clip();
    ctx.drawImage(img, pad - 6, top, gw, gh);
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = '#49352D'; roundRect(ctx, pad - 6, top, gw, gh, 30); ctx.stroke();
    // washi tape
    const tape = (x, y, w, h, rot, c1, c2) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot * Math.PI / 180);
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
      for (let i = -w; i < w; i += 22) {
        ctx.fillStyle = (i / 22) % 2 ? c1 : c2;
        ctx.beginPath(); ctx.moveTo(i, -h / 2); ctx.lineTo(i + 22, -h / 2); ctx.lineTo(i + 22 + h, h / 2); ctx.lineTo(i + h, h / 2); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    };
    tape((W - 12) / 2, top + 2, 230, 56, -3, 'rgba(189,229,210,.95)', 'rgba(201,190,245,.92)');
    tape(M + 110, M + 6, 200, 52, -9, 'rgba(255,183,197,.92)', 'rgba(255,228,155,.92)');
    // text
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let y = top + gh + 70 + 40;
    const cx = (W - 12) / 2;
    blocks.forEach(b => {
      ctx.font = b.font; ctx.fillStyle = b.color;
      if (b.note) {
        ctx.strokeStyle = '#C9BEF5'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(pad + 40, y - 52); ctx.lineTo(W - pad - 52, y - 52); ctx.stroke(); ctx.setLineDash([]);
        y += 14;
      }
      b.wrapped.forEach(l => {
        if (b.pill) {
          const tw = Math.min(maxW, ctx.measureText(l).width) + 56;
          ctx.fillStyle = '#FFF0F3'; roundRect(ctx, cx - tw / 2, y - 38, tw, 54, 27); ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = '#FFB7C5'; ctx.stroke();
          ctx.fillStyle = b.color;
        }
        ctx.fillText(l, cx, y); y += b.lh;
      });
      y += b.gap;
    });
    ctx.font = `700 26px ${FF}`; ctx.fillStyle = '#B5425F';
    ctx.fillText('BƯU ĐIỆN MÂY  ·  20/10', cx, H - M - 16 - 44);
    return c;
  }
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|Zalo|Line\/|Messenger|TikTok|MicroMessenger/i.test(navigator.userAgent);
  let saving = false, lastUrl = '';
  async function saveCard() {
    if (saving) return;
    saving = true;
    const btn = $('#saveBtn'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Đang gói thiệp…';
    try {
      const canvas = await renderCardPNG();
      const blob = await new Promise(r => { try { canvas.toBlob(r, 'image/png'); } catch (e) { r(null); } });
      if (lastUrl.startsWith('blob:')) URL.revokeObjectURL(lastUrl);
      lastUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
      const fname = `thiep-20-10-${slug(NAME)}.png`;
      const canDownload = 'download' in document.createElement('a');
      if (isIOS || inApp || !canDownload) openSaveModal(lastUrl, fname);
      else {
        const a = document.createElement('a');
        a.href = lastUrl; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
        toast('Đã lưu thiệp vào máy ✿');
      }
    } catch (e) {
      toast('Chưa lưu được, thử lại nhé');
    } finally {
      saving = false; btn.disabled = false; btn.textContent = label;
    }
  }
  function openSaveModal(url, fname) {
    const m = $('#saveModal');
    $('#saveImg').src = url;
    const link = $('#saveLink'); link.href = url; link.setAttribute('download', fname);
    m.hidden = false;
    $('#closeModal').focus();
  }
  $('#closeModal').addEventListener('click', () => { $('#saveModal').hidden = true; });
  $('#saveModal').addEventListener('click', e => { if (e.target.id === 'saveModal') e.currentTarget.hidden = true; });
  $('#saveBtn').addEventListener('click', saveCard);

  /* ================= reset / replay ================= */
  function resetGame() {
    sim.timers = []; sim.parcelAnim = null; sim.idleT = 0;
    clearItems();
    slots.forEach(s => s.classList.remove('stamped'));
    hero.flowerOn = false; hero.flowerS = 0; P.hatFlower.style.display = 'none';
    hero.starOn = false; P.hatStar.style.display = 'none';
    P.bag.style.display = '';
    hero.vx = 0; hero.jumpY = 0; hero.jumpV = 0; hero.sq = 0; hero.sqV = 0;
    hero.lookUp = 0; hero.lookPlayer = 0; hero.forceTilt = null;
    hero.x = hero.target = G.W / 2;
    setExpr('neutral');
    groundBag.classList.remove('show');
    parcel.classList.remove('show', 'burst');
    labelCard.classList.remove('flipped');
    openBtn.classList.remove('show');
    world.classList.remove('zoom');
    popLayer.innerHTML = '';
    hideBubble(); hideHint();
    bannerEl.classList.remove('show');
    introEl.classList.add('out');
    introParcel.style.display = 'none';
    ropeSvg.style.display = 'none';
    $('#petals').innerHTML = '';
  }
  $('#replayBtn').addEventListener('click', () => {
    Sound.unlock(); Sound.play('pop');
    cardEl.hidden = true; cardEl.classList.remove('enter');
    stage.hidden = false;
    sim.round++;
    layout();
    resetGame();
    startLoop();
    startCollect(false);
  });

  /* ================= input ================= */
  function canControl() { return sim.state === 'tutorial' || sim.state === 'collecting'; }
  function onUserInput() {
    sim.idleT = 0;
    if (sim.hintOn) hideHint();
    if (sim.state === 'tutorial') sim.state = 'collecting';
  }
  function setTargetFromClient(clientX) { hero.target = clamp(clientX - G.left, G.minX, G.maxX); }
  control.addEventListener('pointerdown', e => {
    if (!canControl()) return;
    e.preventDefault();
    Sound.unlock();
    input.dragId = e.pointerId;
    try { control.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    setTargetFromClient(e.clientX);
    onUserInput();
  });
  control.addEventListener('pointermove', e => {
    if (e.pointerId !== input.dragId || !canControl()) return;
    setTargetFromClient(e.clientX);
    onUserInput();
  });
  const endDrag = e => {
    if (e.pointerId !== input.dragId) return;
    input.dragId = null;
    try { control.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  control.addEventListener('pointerup', endDrag);
  control.addEventListener('pointercancel', endDrag);
  control.addEventListener('lostpointercapture', endDrag);
  control.addEventListener('contextmenu', e => e.preventDefault());

  const LEFT = ['ArrowLeft', 'a', 'A'], RIGHT = ['ArrowRight', 'd', 'D'];
  function syncKeys() {
    const l = LEFT.some(k => input.keys.has(k)), r = RIGHT.some(k => input.keys.has(k));
    input.keyDir = (r ? 1 : 0) - (l ? 1 : 0);
  }
  window.addEventListener('keydown', e => {
    if (!LEFT.includes(e.key) && !RIGHT.includes(e.key)) return;
    if (!canControl()) return;
    e.preventDefault();
    Sound.unlock();
    input.keys.add(e.key); syncKeys();
    if (Math.abs(hero.target - hero.x) < 2) hero.target = hero.x;
    onUserInput();
  });
  window.addEventListener('keyup', e => { input.keys.delete(e.key); syncKeys(); });
  window.addEventListener('blur', () => { input.keys.clear(); syncKeys(); input.dragId = null; });

  helpBtn.addEventListener('click', startHelp);
  skipBtn.addEventListener('click', () => { Sound.unlock(); Sound.play('pop'); goDelivery(true); });
  openBtn.addEventListener('click', openGift);

  /* ================= loop ================= */
  let rafId = 0, last = 0, paused = false;
  function update(dt) {
    sim.time += dt;
    runTimers();
    if (sim.state === 'intro') updateIntro(dt);
    updateParcelAnim(dt);
    updateHero(dt);
    updateItems(dt);
    if (sim.state === 'collecting' && sim.items.some(i => i.state === 'fall' || i.state === 'rebound') && input.dragId == null && !input.keyDir) {
      sim.idleT += dt;
      if (sim.idleT > 4.5 && !sim.hintOn) showHint();
    }
    if (sim.bubbleT > 0 && sim.bubbleT !== Infinity) { sim.bubbleT -= dt; if (sim.bubbleT <= 0) hideBubble(); }
  }
  function render() {
    renderHero();
    renderItems();
    if (sim.state === 'intro' || sim.state === 'intro-out') renderIntro();
    if (bubbleEl.classList.contains('show')) positionBubble();
    if (sim.hintOn) handEl.style.transform = `translate3d(${(hero.x - 22).toFixed(1)}px, ${(G.heroY + 4 * G.S).toFixed(1)}px, 0)`;
  }
  function frame(now) {
    rafId = 0;
    if (paused) return;
    // fixed sub-steps keep collisions stable on slow frames; long gaps are capped
    let elapsed = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    while (elapsed > 1e-4) {
      const step = Math.min(elapsed, 1 / 60);
      update(step);
      elapsed -= step;
    }
    render();
    rafId = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (rafId || paused) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { paused = true; stopLoop(); input.dragId = null; input.keys.clear(); syncKeys(); }
    else { paused = false; if (sim.state !== 'card') startLoop(); }
  });
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (sim.state === 'card') return;
      layout();
      if (sim.state === 'intro') introLayout();
    }, 80);
  });

  /* ================= boot ================= */
  hud.classList.add('off');
  skipBtn.hidden = true;
  setExpr('puff');
  layout();
  introLayout();
  sim.introX = sim.introBaseX;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());
  startLoop();
  try { if (new URLSearchParams(window.location.search).has('debug')) window.__bdm = { sim, hero, G, renderCardPNG }; } catch (e) { /* ignore */ }
})();
