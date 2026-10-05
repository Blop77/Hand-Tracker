import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import * as sfx from "./sfx.js";

const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const cv = document.getElementById("c"), ctx = cv.getContext("2d");
const video = document.getElementById("v");
let W = 0, H = 0;
const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
resize(); addEventListener("resize", resize);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TAU = Math.PI * 2;

let time = 0, camReady = false, landmarker = null, hands = [], showSkel = false, lastVT = -1;
let shake = 0, flash = 0;
const keys = {}, mouse = { x: innerWidth / 2, y: innerHeight / 2 };

/* ---------------- video / coordinates ---------------- */
function videoRect() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
  return { dw, dh, dx: (W - dw) / 2, dy: (H - dh) / 2 };
}
function drawVideo(c, alpha = 1) {
  if (!camReady) return;
  const r = videoRect();
  c.save(); c.globalAlpha = alpha; c.translate(r.dx + r.dw, r.dy); c.scale(-1, 1);
  c.drawImage(video, 0, 0, r.dw, r.dh); c.restore();
}
function lens(c, x, y, r, zoom) {
  if (!camReady) return;
  c.save(); c.globalCompositeOperation = "source-over";
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
  c.translate(x, y); c.scale(zoom, zoom); c.translate(-x, -y);
  drawVideo(c, 1); c.restore();
}

/* ---------------- hand analysis ---------------- */
function analyze(lm) {
  const r = videoRect();
  const P = lm.map(l => ({ x: r.dx + (1 - l.x) * r.dw, y: r.dy + l.y * r.dh }));
  const hs = dist(P[0], P[9]) || 1;
  const ext = (tip, pip) => dist(P[tip], P[0]) > dist(P[pip], P[0]) * 1.12;
  const e = [ext(8, 6), ext(12, 10), ext(16, 14), ext(20, 18)];
  let g = "none";
  if (e[0] && !e[1] && !e[2] && !e[3]) g = "point";
  else if (e[0] && e[1] && !e[2] && !e[3]) g = dist(P[8], P[12]) / hs < 0.36 ? "cross" : "peace";
  else if (e.every(Boolean)) g = "open";
  else if (!e.some(Boolean)) g = "fist";
  const dx = P[9].x - P[0].x, dy = P[9].y - P[0].y, dl = Math.hypot(dx, dy) || 1;
  return { P, hs, g, dir: { x: dx / dl, y: dy / dl } };
}
function orbPoint(h) {
  const tip = h.g === "point" ? h.P[8] : { x: (h.P[8].x + h.P[12].x) / 2, y: (h.P[8].y + h.P[12].y) / 2 };
  const R = clamp(h.hs * 0.4, 22, 80);
  return { x: tip.x + h.dir.x * R * 1.2, y: tip.y + h.dir.y * R * 1.2, r: R };
}
function sources() {
  const s = { blue: null, red: null, cross: null };
  for (const h of hands) {
    const k = h.g === "point" ? "blue" : h.g === "peace" ? "red" : h.g === "cross" ? "cross" : null;
    if (k && (!s[k] || h.hs > s[k].hs)) s[k] = h;
  }
  return s;
}

/* ---------------- state ---------------- */
const makeOrb = () => ({ x: 0, y: 0, cx: 0, cy: 0, r: 40, p: 0, seen: -9, act: false, acc: 0, ring: 0 });
const blue = makeOrb(), red = makeOrb();
const purple = { st: "idle", charge: 0, x: 0, y: 0, r: 60, armed: 0, lost: 0, cd: 0, sim: false, vx: 0, vy: 0, hist: [], acc: 0, beam: null };
const D = { active: false, t: 0, k: 0, ox: 0, oy: 0, hold: 0, gap: 0, fist: 0, cd: 0, hx: 0, hy: 0 };
const parts = [], rings = [];

function updateOrb(o, dt, src) {
  if (src) {
    o.seen = time;
    if (o.p < 0.03) { o.x = src.x; o.y = src.y; o.r = src.r; }
    else { const k = 1 - Math.exp(-dt * 22); o.x += (src.x - o.x) * k; o.y += (src.y - o.y) * k; o.r += (src.r - o.r) * k; }
  }
  o.act = time - o.seen < 0.2;
  o.p = clamp(o.p + (o.act ? dt * 5 : -dt * 4), 0, 1);
  o.cx = o.x; o.cy = o.y;
}

function emit(o) {
  if (parts.length > 2600) return;
  const p = Object.assign({ vx: 0, vy: 0, life: 1, size: 2, h: 0, s: 100, l: 60, drag: 0, att: 0, orb: null, kill: 0 }, o);
  p.max = p.life; parts.push(p);
}
function burst(x, y, n, h0, h1, sp) {
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU), v = rnd(sp * 0.3, sp);
    emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.5, 1.2), size: rnd(1.5, 4), h: rnd(h0, h1), l: rnd(60, 85), drag: 2.5 });
  }
}
const fuseDist = () => Math.max(160, 0.22 * Math.min(W, H));

/* ---------------- update ---------------- */
function update(dt) {
  const s = sources();
  let bs = s.blue ? orbPoint(s.blue) : null, rs = s.red ? orbPoint(s.red) : null;
  if (!bs && keys.b) bs = { x: mouse.x - (keys.r ? 80 : 0), y: mouse.y, r: 48 };
  if (!rs && keys.r) rs = { x: mouse.x + (keys.b ? 80 : 0), y: mouse.y, r: 48 };
  updateOrb(blue, dt, bs); updateOrb(red, dt, rs);

  updatePurple(dt);
  const hidden = purple.st === "ready" || purple.st === "fired";

  // Blue: particles spiral inward
  if (blue.p > 0.25 && !hidden) {
    blue.acc += dt * 170 * blue.p;
    while (blue.acc >= 1) {
      blue.acc--;
      const a = rnd(TAU), rad = blue.r * rnd(2.5, 6), v = rnd(180, 320);
      emit({ x: blue.cx + Math.cos(a) * rad, y: blue.cy + Math.sin(a) * rad, vx: -Math.sin(a) * v, vy: Math.cos(a) * v,
             life: rnd(1, 1.8), size: rnd(1, 2.6), h: rnd(198, 225), l: rnd(60, 85), orb: blue, att: 90000, kill: blue.r * 0.45 });
    }
  }
  // Red: sparks burst outward + shock rings
  if (red.p > 0.25 && !hidden) {
    red.acc += dt * 190 * red.p;
    while (red.acc >= 1) {
      red.acc--;
      const a = rnd(TAU), v = rnd(220, 760);
      emit({ x: red.cx + Math.cos(a) * red.r * 0.9, y: red.cy + Math.sin(a) * red.r * 0.9, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
             life: rnd(0.4, 0.9), size: rnd(1.4, 3.2), h: rnd(352, 372) % 360, l: rnd(55, 80), drag: 3 });
    }
    red.ring -= dt;
    if (red.ring <= 0) { red.ring = 0.42; rings.push({ x: red.cx, y: red.cy, r: red.r, max: red.r * 6, life: 0.7, max_l: 0.7, c: "255,70,60", w: 3 }); sfx.crackle(); }
  }

  updateDomain(dt, s);

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    let dead = p.life <= 0;
    if (!dead && p.orb) {
      const dx = p.orb.cx - p.x, dy = p.orb.cy - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < p.kill) dead = true;
      else { const a = p.att / Math.max(d, 30); p.vx += (dx / d) * a * dt; p.vy += (dy / d) * a * dt; }
    }
    if (dead) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.life -= dt; if (r.life <= 0) rings.splice(i, 1); }
}

function updatePurple(dt) {
  const P = purple;
  if (P.cd > 0) P.cd -= dt;
  const thr = fuseDist();

  if (P.st === "idle" || P.st === "charging") {
    const both = blue.act && red.act && blue.p > 0.5 && red.p > 0.5 && P.cd <= 0;
    const d = both ? dist(blue, red) : Infinity;
    P.charge = clamp(P.charge + (d < thr * (P.charge > 0 ? 1.4 : 1) ? dt / 0.9 : -dt * 1.5), 0, 1);
    P.st = P.charge > 0 ? "charging" : "idle";
    if (P.st === "charging") {
      // red & blue orbit each other and spiral into the midpoint
      const mx = (blue.x + red.x) / 2, my = (blue.y + red.y) / 2, c = P.charge, ang = c * c * Math.PI * 4, sh = 1 - c * c;
      for (const o of [blue, red]) {
        const vx = (o.x - mx) * sh, vy = (o.y - my) * sh;
        o.cx = mx + vx * Math.cos(ang) - vy * Math.sin(ang);
        o.cy = my + vx * Math.sin(ang) + vy * Math.cos(ang);
      }
      P.x = mx; P.y = my; P.r = (blue.r + red.r) * 0.95;
    }
    if (P.charge >= 1) {
      P.st = "ready"; P.armed = 0; P.lost = 0; P.hist = []; P.sim = hands.length < 2;
      flash = 0.85; shake = 16; sfx.fuse();
      burst(P.x, P.y, 160, 260, 300, 900);
      rings.push({ x: P.x, y: P.y, r: P.r, max: P.r * 10, life: 0.8, max_l: 0.8, c: "200,120,255", w: 6 });
    }
  } else if (P.st === "ready") {
    P.armed += dt;
    let target = null, sep = 0;
    if (hands.length >= 2) {
      const a = hands[0].P[9], b = hands[1].P[9];
      target = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; sep = dist(a, b); P.lost = 0;
    } else if (P.sim) target = mouse;
    else P.lost += dt;
    if (target) { const k = 1 - Math.exp(-dt * 14); P.x += (target.x - P.x) * k; P.y += (target.y - P.y) * k; }
    P.hist.push({ t: time, x: P.x, y: P.y });
    while (P.hist.length && time - P.hist[0].t > 0.3) P.hist.shift();

    P.acc += dt * 160;
    while (P.acc >= 1) {
      P.acc--;
      const a = rnd(TAU), rad = P.r * rnd(1.8, 4), v = rnd(150, 300);
      emit({ x: P.x + Math.cos(a) * rad, y: P.y + Math.sin(a) * rad, vx: -Math.sin(a) * v, vy: Math.cos(a) * v, life: rnd(0.8, 1.4),
             size: rnd(1, 3), h: Math.random() < 0.2 ? (Math.random() < 0.5 ? 215 : 0) : rnd(265, 295), l: rnd(65, 88), orb: { cx: P.x, cy: P.y }, att: 120000, kill: P.r * 0.4 });
    }
    const open = hands.some(h => h.g === "open");
    if (P.armed > 0.5 && (open || sep > thr * 2.4 || keys[" "] || (P.sim && P.armed > 4))) firePurple();
    else if (P.lost > 1.2) { P.st = "idle"; P.charge = 0; P.cd = 1; burst(P.x, P.y, 80, 260, 300, 400); sfx.fizzle(); }
  } else if (P.st === "fired") {
    P.x += P.vx * dt; P.y += P.vy * dt;
    P.beam.x1 = P.x; P.beam.y1 = P.y;
    for (let i = 0; i < 14; i++) {
      const n = rnd(-1, 1) * P.r * 1.4, nx = -P.vy / 2400, ny = P.vx / 2400;
      emit({ x: P.x + nx * n, y: P.y + ny * n, vx: -P.vx * 0.08 + rnd(-120, 120), vy: -P.vy * 0.08 + rnd(-120, 120),
             life: rnd(0.4, 1), size: rnd(2, 5), h: rnd(262, 300), l: rnd(60, 90), drag: 2 });
    }
    if (P.x < -400 || P.x > W + 400 || P.y < -400 || P.y > H + 400) { P.st = "idle"; P.charge = 0; P.cd = 1.5; P.beam.fade = true; }
  }
  if (P.beam && P.beam.fade) { P.beam.a -= dt * 1.6; if (P.beam.a <= 0) P.beam = null; }
}

function firePurple() {
  const P = purple, h = P.hist;
  let dx = 0, dy = 0;
  if (h.length > 2) { dx = h[h.length - 1].x - h[0].x; dy = h[h.length - 1].y - h[0].y; }
  const sp = Math.hypot(dx, dy) / 0.3;
  if (sp < 250) { dx = P.x < W / 2 ? 1 : -1; dy = 0; } else { const l = Math.hypot(dx, dy); dx /= l; dy /= l; }
  P.vx = dx * 2400; P.vy = dy * 2400; P.st = "fired";
  P.beam = { x0: P.x, y0: P.y, x1: P.x, y1: P.y, w: P.r * 1.7, a: 1, fade: false };
  shake = 34; flash = 0.7; sfx.fire();
  rings.push({ x: P.x, y: P.y, r: P.r, max: P.r * 14, life: 0.9, max_l: 0.9, c: "220,160,255", w: 10 });
}

function startDomain(x, y) {
  Object.assign(D, { active: true, t: 0, ox: x, oy: y, hold: 0, fist: 0 });
  flash = 1; shake = 26; sfx.domainStart();
  for (let i = 0; i < 4; i++) rings.push({ x, y, r: 10 + i * 40, max: Math.hypot(W, H), life: 1.2 + i * 0.25, max_l: 1.2 + i * 0.25, c: "255,255,255", w: 4 });
}
function endDomain() { D.active = false; D.cd = 2; flash = 0.9; shake = 18; sfx.domainEnd(); }

function updateDomain(dt, s) {
  if (D.cd > 0) D.cd -= dt;
  if (s.cross && !D.active && D.cd <= 0) {
    const p = s.cross.P; D.hx = (p[8].x + p[12].x) / 2; D.hy = (p[8].y + p[12].y) / 2;
    D.hold += dt; D.gap = 0;
    if (D.hold > 0.6) startDomain(D.hx, D.hy);
  } else { D.gap += dt; if (D.gap > 0.25) D.hold = 0; }
  if (D.active) {
    D.t += dt;
    if (D.t > 3 && hands.some(h => h.g === "fist")) D.fist += dt; else D.fist = Math.max(0, D.fist - dt);
    if (D.fist > 0.8 || D.t > 25) endDomain();
  }
  D.k = clamp(D.k + (D.active ? dt / 0.5 : -dt / 1.2), 0, 1);
}

/* ---------------- drawing helpers ---------------- */
function glow(x, y, r, stops) {
  if (r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function boltPts(x0, y0, x1, y1, segs, jit) {
  const pts = [[x0, y0]];
  for (let i = 1; i < segs; i++) { const t = i / segs; pts.push([x0 + (x1 - x0) * t + rnd(-jit, jit), y0 + (y1 - y0) * t + rnd(-jit, jit)]); }
  pts.push([x1, y1]); return pts;
}
function strokePts(pts, style, w) {
  ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
function arcs(x, y, R, n, len0, len1, hot, dark) {
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU), r1 = R * rnd(len0, len1);
    const pts = boltPts(x + Math.cos(a) * R * 0.7, y + Math.sin(a) * R * 0.7, x + Math.cos(a) * r1, y + Math.sin(a) * r1, 7, R * 0.22);
    if (dark) { ctx.globalCompositeOperation = "source-over"; strokePts(pts, dark, 4); }
    ctx.globalCompositeOperation = "lighter"; strokePts(pts, hot, 1.6);
  }
}

function drawBlue(o) {
  const { cx: x, cy: y, r: R, p } = o;
  lens(ctx, x, y, R * 2.2, 1 + 0.7 * p);
  ctx.globalCompositeOperation = "source-over";
  glow(x, y, R * 2.2, [[0, `rgba(10,40,200,${0.55 * p})`], [1, "rgba(0,10,80,0)"]]);
  ctx.globalCompositeOperation = "lighter";
  glow(x, y, R * 5.5 * (0.92 + 0.08 * Math.sin(time * 9)), [[0, `rgba(200,230,255,${0.95 * p})`], [0.12, `rgba(70,150,255,${0.8 * p})`], [0.4, `rgba(20,70,255,${0.28 * p})`], [1, "rgba(0,10,60,0)"]]);
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * (1.4 + i * 0.6) * (i % 2 ? -1 : 1) + i * 1.3); ctx.scale(1, 0.22 + 0.1 * i);
    ctx.strokeStyle = `rgba(140,200,255,${(0.55 - i * 0.08) * p})`; ctx.beginPath(); ctx.arc(0, 0, R * (1.5 + i * 0.45), 0, TAU); ctx.stroke();
    ctx.restore();
  }
  glow(x, y, R * 0.9, [[0, `rgba(255,255,255,${p})`], [0.55, `rgba(190,225,255,${0.95 * p})`], [1, "rgba(60,130,255,0)"]]);
}

function drawRed(o) {
  const { cx: x, cy: y, r: R, p } = o;
  ctx.globalCompositeOperation = "lighter";
  glow(x, y, R * 5 * (0.9 + 0.1 * Math.sin(time * 14)), [[0, `rgba(255,230,220,${0.95 * p})`], [0.14, `rgba(255,60,50,${0.85 * p})`], [0.45, `rgba(200,0,20,${0.28 * p})`], [1, "rgba(60,0,0,0)"]]);
  arcs(x, y, R, 5, 1.8, 3.6, `rgba(255,90,80,${p})`, `rgba(20,0,0,${0.6 * p})`);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgba(30,0,0,${0.55 * p})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, R * 1.02, 0, TAU); ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  glow(x, y, R * (0.9 + 0.06 * Math.sin(time * 20)), [[0, `rgba(255,255,255,${p})`], [0.5, `rgba(255,170,160,${p})`], [1, "rgba(255,40,40,0)"]]);
}

function drawPurple(x, y, R, p) {
  lens(ctx, x, y, R * 2.4, 1 + 0.9 * p);
  ctx.globalCompositeOperation = "source-over";
  glow(x, y, R * 2.4, [[0, `rgba(60,0,120,${0.5 * p})`], [1, "rgba(20,0,40,0)"]]);
  ctx.globalCompositeOperation = "lighter";
  glow(x, y, R * 6 * (0.93 + 0.07 * Math.sin(time * 11)), [[0, `rgba(255,235,255,${0.95 * p})`], [0.12, `rgba(195,100,255,${0.9 * p})`], [0.4, `rgba(120,30,230,${0.35 * p})`], [1, "rgba(30,0,60,0)"]]);
  arcs(x, y, R, 6, 1.6, 3.4, `rgba(230,170,255,${p})`, `rgba(15,0,30,${0.6 * p})`);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgba(15,0,35,${0.8 * p})`; ctx.lineWidth = R * 0.16; ctx.beginPath(); ctx.arc(x, y, R * 1.0, 0, TAU); ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(220,160,255,${0.7 * p})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R * 1.1 + Math.sin(time * 30) * 2, 0, TAU); ctx.stroke();
  glow(x, y, R * 0.95, [[0, `rgba(255,255,255,${p})`], [0.6, `rgba(225,190,255,${p})`], [1, "rgba(150,60,255,0)"]]);
}

function drawBeam(b) {
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  const seg = (w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke(); };
  const j = 1 + rnd(-0.08, 0.08);
  seg(b.w * 3 * j, `rgba(120,30,220,${0.22 * b.a})`);
  seg(b.w * 1.5 * j, `rgba(190,100,255,${0.5 * b.a})`);
  seg(b.w * 0.55, `rgba(255,240,255,${0.9 * b.a})`);
}

/* ---------------- domain: Infinite Void ---------------- */
const stars = Array.from({ length: 380 }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: rnd(0.05, 1), px: null, py: null }));
const GLYPHS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ無量空処∞領域展開".split("");
let cols = [];
function drawDomain(dt) {
  if (D.k <= 0.001) return;
  const k = D.k, t = D.t, cx = W / 2, cy = H / 2;
  ctx.save();
  if (D.active && t < 0.9) {
    const e = 1 - Math.pow(1 - t / 0.9, 3), rad = e * Math.hypot(W, H);
    ctx.beginPath(); ctx.arc(D.ox, D.oy, rad, 0, TAU); ctx.clip();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(0,0,6,${0.9 * k})`; ctx.fillRect(-50, -50, W + 100, H + 100);
  drawVideo(ctx, 0.28 * k);
  ctx.globalCompositeOperation = "lighter";

  // cosmic nebula
  glow(cx, cy, Math.max(W, H) * 0.7, [[0, `rgba(60,90,200,${0.18 * k})`], [0.5, `rgba(80,20,140,${0.1 * k})`], [1, "rgba(0,0,0,0)"]]);

  // warp tunnel of stars / information
  const sc = Math.min(W, H) * 0.5;
  ctx.lineCap = "round";
  for (const s of stars) {
    s.z -= dt * 0.42;
    const sx = cx + (s.x / s.z) * sc, sy = cy + (s.y / s.z) * sc;
    if (s.z < 0.03 || sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) { s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = 1; s.px = null; continue; }
    if (s.px !== null) {
      const a = (1 - s.z) * k;
      ctx.strokeStyle = `hsla(${215 + s.x * 40},80%,${75 + (1 - s.z) * 20}%,${a})`; ctx.lineWidth = (1 - s.z) * 3;
      ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(sx, sy); ctx.stroke();
    }
    s.px = sx; s.py = sy;
  }

  // falling streams of glyphs
  const cs = 22, n = Math.ceil(W / cs);
  if (cols.length !== n) cols = Array.from({ length: n }, () => ({ y: rnd(H), v: rnd(60, 280) }));
  ctx.font = `bold ${cs - 6}px monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  cols.forEach((c, i) => {
    c.y += c.v * dt;
    if (c.y - 12 * cs > H) { c.y = rnd(-200, 0); c.v = rnd(60, 280); }
    const row0 = Math.floor(c.y / cs);
    for (let j = 0; j < 12; j++) {
      const row = row0 - j, ch = GLYPHS[Math.abs((row * 31 + i * 17 + (Math.floor(time * 3 + i) % 5)) % GLYPHS.length)];
      ctx.fillStyle = j === 0 ? `rgba(230,245,255,${0.7 * k})` : `rgba(90,170,255,${(1 - j / 12) * 0.32 * k})`;
      ctx.fillText(ch, i * cs + cs / 2, row * cs);
    }
  });

  // rotating sigil
  ctx.save(); ctx.translate(cx, cy);
  const R0 = Math.min(W, H);
  ctx.strokeStyle = `rgba(200,220,255,${0.16 * k})`; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, R0 * (0.2 + i * 0.09) * (1 + 0.02 * Math.sin(time * 2 + i)), 0, TAU); ctx.stroke(); }
  ctx.rotate(time * 0.15);
  for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R0 * 0.2, Math.sin(a) * R0 * 0.2); ctx.lineTo(Math.cos(a) * R0 * 0.47, Math.sin(a) * R0 * 0.47); ctx.stroke(); }
  ctx.restore();
  ctx.restore();

  // expansion edge
  if (D.active && t < 0.9) {
    const e = 1 - Math.pow(1 - t / 0.9, 3);
    ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(255,255,255,${1 - e})`; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(D.ox, D.oy, e * Math.hypot(W, H), 0, TAU); ctx.stroke();
  }
}

function glitchText(str, x, y, size, alpha, space = 1.25) {
  if (alpha <= 0.01) return;
  ctx.font = `700 ${size}px "Yu Mincho","Hiragino Mincho ProN","Noto Serif JP","MS Mincho",serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const chars = [...str], w = size * space, x0 = x - ((chars.length - 1) * w) / 2;
  const g = Math.random() < 0.07 ? rnd(4, 14) : 1.5;
  ctx.globalCompositeOperation = "lighter";
  chars.forEach((ch, i) => {
    const cx = x0 + i * w;
    ctx.fillStyle = `rgba(255,0,90,${0.6 * alpha})`; ctx.fillText(ch, cx - g, y);
    ctx.fillStyle = `rgba(0,190,255,${0.6 * alpha})`; ctx.fillText(ch, cx + g, y);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fillText(ch, cx, y);
  });
}
function drawDomainText() {
  if (D.k <= 0.001 || !D.active && D.k < 0.05) return;
  const t = D.t, out = 1 - clamp((t - 6) / 1.5, 0, 1), m = Math.min(W, H);
  const a1 = clamp((t - 0.7) / 0.5, 0, 1) * out * D.k;
  const a2 = clamp((t - 1.8) / 0.6, 0, 1) * out * D.k;
  const a3 = clamp((t - 2.6) / 0.8, 0, 1) * out * D.k;
  glitchText("領域展開", W / 2, H * 0.3, m * 0.07 * (1 + (1 - clamp((t - 0.7) / 0.5, 0, 1)) * 0.3), a1, 1.6);
  glitchText("無量空処", W / 2, H * 0.47, m * 0.15, a2, 1.15);
  if (a3 > 0.01) {
    ctx.font = `300 ${m * 0.026}px system-ui,"Segoe UI",sans-serif`; ctx.textAlign = "center";
    ctx.fillStyle = `rgba(200,220,255,${a3})`;
    ctx.fillText("D O M A I N   E X P A N S I O N   ·   I N F I N I T E   V O I D", W / 2, H * 0.6);
  }
}

/* ---------------- render ---------------- */
function render(dt) {
  ctx.save();
  if (shake > 0.5) { ctx.translate(rnd(-shake, shake), rnd(-shake, shake)); }
  shake *= Math.exp(-dt * 6);
  ctx.globalCompositeOperation = "source-over";
  if (camReady) drawVideo(ctx, 1);
  else { const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, "#111633"); g.addColorStop(1, "#04050a"); ctx.fillStyle = g; ctx.fillRect(-50, -50, W + 100, H + 100); }

  // cinematic dim when a technique is active
  const dim = Math.max(blue.p, red.p, purple.charge, purple.st === "fired" ? 1 : 0) * 0.4;
  if (dim > 0.01) { ctx.fillStyle = `rgba(0,0,12,${dim})`; ctx.fillRect(-50, -50, W + 100, H + 100); }

  drawDomain(dt);

  // particles
  ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const p of parts) {
    const a = p.life / p.max;
    ctx.strokeStyle = `hsla(${p.h},${p.s}%,${p.l}%,${a})`; ctx.lineWidth = p.size * (0.5 + a * 0.5);
    ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  for (const r of rings) {
    const f = 1 - r.life / r.max_l, a = r.life / r.max_l;
    ctx.strokeStyle = `rgba(${r.c},${a})`; ctx.lineWidth = r.w * a;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r + (r.max - r.r) * (1 - Math.pow(1 - f, 2)), 0, TAU); ctx.stroke();
  }

  const P = purple;
  if (P.beam) drawBeam(P.beam);
  if (P.st === "charging") glow(P.x, P.y, P.r * (2 + P.charge * 4), [[0, `rgba(220,150,255,${0.6 * P.charge})`], [1, "rgba(80,0,160,0)"]]);
  if (P.st !== "ready" && P.st !== "fired") {
    if (blue.p > 0.01) drawBlue(blue);
    if (red.p > 0.01) drawRed(red);
  }
  if (P.st === "ready") drawPurple(P.x, P.y, P.r * (1.6 + 0.1 * Math.sin(time * 6)), 1);
  if (P.st === "fired") drawPurple(P.x, P.y, P.r * 1.7, 1);

  // domain charge indicator
  if (D.hold > 0 && !D.active) {
    ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(D.hx, D.hy, 46, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(D.hold / 0.6, 0, 1)); ctx.stroke();
  }

  drawDomainText();

  if (showSkel) {
    ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5;
    ctx.font = "14px system-ui"; ctx.fillStyle = "#fff";
    for (const h of hands) {
      for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) { ctx.beginPath(); ctx.moveTo(h.P[start].x, h.P[start].y); ctx.lineTo(h.P[end].x, h.P[end].y); ctx.stroke(); }
      ctx.fillText(h.g, h.P[0].x, h.P[0].y + 24);
    }
  }
  ctx.restore();

  if (flash > 0.01) {
    ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H);
    flash *= Math.exp(-dt * 5);
  }
  ctx.globalCompositeOperation = "source-over";
}

/* ---------------- loop ---------------- */
const chips = Object.fromEntries([...document.querySelectorAll(".chip")].map(c => [c.dataset.k, c]));
function hud() {
  chips.blue.classList.toggle("on", blue.p > 0.5 && purple.st !== "ready" && purple.st !== "fired");
  chips.red.classList.toggle("on", red.p > 0.5 && purple.st !== "ready" && purple.st !== "fired");
  chips.purple.classList.toggle("on", purple.st !== "idle");
  chips.dom.classList.toggle("on", D.active);
}
function detect() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVT) return;
  lastVT = video.currentTime;
  const res = landmarker.detectForVideo(video, performance.now());
  hands = (res.landmarks || []).map(analyze);
}
let last = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.05, now - last); last = now; time += dt;
  try { detect(); } catch (e) { console.error(e); }
  update(dt); render(dt); hud();
  const hid = purple.st === "ready" || purple.st === "fired";
  sfx.update({
    blue: hid ? 0 : blue.p, red: hid ? 0 : red.p,
    purple: purple.st === "charging" ? purple.charge : hid ? 1 : 0,
    pitch: purple.st === "charging" ? 120 + purple.charge * 500 : purple.st === "fired" ? 320 : 200 + Math.sin(time * 6) * 15,
    domain: D.k,
  }, dt);
  requestAnimationFrame(frame);
}

/* ---------------- input / startup ---------------- */
addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (k === "tab") { e.preventDefault(); document.getElementById("hud").classList.toggle("hidden"); return; }
  if (k === " ") e.preventDefault();
  if (k === "d" && !e.repeat) { if (D.active) endDomain(); else startDomain(mouse.x, mouse.y); }
  if (k === "h" && !e.repeat) showSkel = !showSkel;
  if (k === "m" && !e.repeat) toggleMute();
  keys[k] = true;
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
addEventListener("pointermove", e => { mouse.x = e.clientX; mouse.y = e.clientY; });

const msg = document.getElementById("msg");
const muteBtn = document.getElementById("mute");
function toggleMute() {
  sfx.setMuted(!sfx.isMuted());
  muteBtn.textContent = sfx.isMuted() ? "🔇" : "🔊";
}
muteBtn.onclick = () => { sfx.init(); toggleMute(); };
function begin() {
  sfx.init();
  document.getElementById("start").style.display = "none";
  document.getElementById("hud").classList.remove("hidden");
  muteBtn.style.display = "block";
}
document.getElementById("nocam").onclick = begin;
document.getElementById("go").onclick = async () => {
  sfx.init(); // must happen inside the click so the browser allows audio
  msg.className = ""; msg.textContent = "Requesting camera…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false });
    video.srcObject = stream; await video.play(); camReady = true;
    msg.textContent = "Loading hand-tracking model…";
    const files = await FilesetResolver.forVisionTasks(TASKS);
    const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: "VIDEO", numHands: 2,
                         minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { landmarker = await HandLandmarker.createFromOptions(files, opts("GPU")); }
    catch { landmarker = await HandLandmarker.createFromOptions(files, opts("CPU")); }
    begin();
  } catch (e) {
    console.error(e); msg.className = "err";
    msg.textContent = "Couldn't start: " + (e.message || e) + " — serve over http://localhost and allow camera access.";
  }
};
requestAnimationFrame(frame);
