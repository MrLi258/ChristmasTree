import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- Configuration ---
const CONFIG = {
    treeColor1: 0xffffff, // White
    treeColor2: 0x88ccff, // Light Blue
    bgColor: 0x000510,    // Dark Blue
    snowCount: 1500,
    treeHeight: 40,
    treeRadius: 15,
};

const containerEl = document.getElementById('canvas-container');
const loadingEl = document.getElementById('loading');

const audioEl = document.getElementById('bgm');
const audioBtnEl = document.getElementById('audio-btn');
const audioUiEl = document.getElementById('audio-ui');

function createAudioSync(audio) {
    const state = {
        started: false,
        ready: false,
        durationReady: false,
        duration: 0,
        energy: 0,
        energySmoothed: 0,
        beatPulse: 0,
        lastBeatAt: -1e9,
        avgEnergy: 1e-6,
    };

    let audioCtx = null;
    let analyser = null;
    let data = null;
    let src = null;
    const energyHistory = [];
    const energyHistoryMax = 60;

    function ensureGraph() {
        if (state.ready) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('WebAudio is not supported in this browser');
        audioCtx = new Ctx();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.65;
        data = new Uint8Array(analyser.fftSize);
        src = audioCtx.createMediaElementSource(audio);
        src.connect(analyser);
        analyser.connect(audioCtx.destination);
        state.ready = true;
    }

    function ensureDuration() {
        if (!audio || state.durationReady) return;
        const d = audio.duration;
        if (Number.isFinite(d) && d > 0) {
            state.durationReady = true;
            state.duration = d;
        }
    }

    async function toggle() {
        if (!audio) return;
        ensureGraph();
        await audioCtx.resume();

        if (audio.paused) {
            await audio.play();
            state.started = true;
            ensureDuration();
        } else {
            audio.pause();
        }
    }

    async function tryAutoplay() {
        if (!audio) return { ok: false, reason: 'no-audio-el' };
        try {
            // IMPORTANT: Do NOT create/resume AudioContext here.
            // Most browsers require a user gesture for AudioContext, and failing it should not break the whole page.
            // Best-effort autoplay (may still be blocked by browser policy on first visit).
            await audio.play();
            state.started = true;
            ensureDuration();
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: String(e && e.message ? e.message : e) };
        }
    }

    function update(nowMs) {
        // Decay beat pulse even when paused.
        state.beatPulse = Math.max(0, state.beatPulse - 0.08);
        ensureDuration();
        if (!state.ready || !state.started || !audio || audio.paused) {
            state.energy = 0;
            state.energySmoothed *= 0.92;
            return;
        }

        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        const instantEnergy = sum / data.length;
        energyHistory.push(instantEnergy);
        if (energyHistory.length > energyHistoryMax) energyHistory.shift();

        let avg = 0;
        for (let i = 0; i < energyHistory.length; i++) avg += energyHistory[i];
        avg /= Math.max(1, energyHistory.length);
        state.avgEnergy = avg;

        // Normalize energy: 0..1-ish
        const ratio = instantEnergy / Math.max(1e-6, avg);
        const energyNorm = Math.min(1, Math.max(0, (ratio - 1.0) * 1.6));
        state.energy = energyNorm;
        state.energySmoothed = state.energySmoothed * 0.85 + energyNorm * 0.15;

        // Simple beat detection: energy spike with refractory
        const beatThreshold = 0.38;
        const refractoryMs = 260;
        if (energyNorm > beatThreshold && (nowMs - state.lastBeatAt) > refractoryMs) {
            state.lastBeatAt = nowMs;
            state.beatPulse = 1.0;
        }
    }

    function speedMul() {
        // “卡点”感觉：平时略慢，拍点瞬间加速。
        const e = state.energySmoothed;
        const b = state.beatPulse;
        return 0.90 + e * 0.30 + b * 0.50;
    }

    function timeNorm() {
        if (!audio || !state.durationReady || state.duration <= 0) return null;
        return Math.min(1, Math.max(0, audio.currentTime / state.duration));
    }

    function beamPulse() {
        // Use beat pulse mostly (less jitter than raw energy).
        return 0.80 + 0.55 * state.beatPulse + 0.15 * state.energySmoothed;
    }

    return { state, toggle, tryAutoplay, update, speedMul, beamPulse, timeNorm };
}

const audioSync = createAudioSync(audioEl);
if (audioBtnEl) {
    audioBtnEl.addEventListener('click', async () => {
        try {
            await audioSync.toggle();
            audioBtnEl.textContent = (audioEl && !audioEl.paused) ? '暂停音乐' : '播放音乐并卡点';
            if (audioUiEl && audioEl && !audioEl.paused) audioUiEl.style.display = 'none';
        } catch (e) {
            console.error('Audio failed to start:', e);
            if (audioUiEl) audioUiEl.style.display = 'block';
            if (audioBtnEl) audioBtnEl.textContent = '点击启用音乐';
        }
    });
}

// Autoplay attempt on load (best effort). If blocked, show the fallback UI.
(async () => {
    if (!audioEl) return;
    audioEl.loop = false;
    audioEl.preload = 'auto';
    try {
        const res = await audioSync.tryAutoplay();
        if (!res.ok) {
            if (audioUiEl) audioUiEl.style.display = 'block';
        } else {
            if (audioUiEl) audioUiEl.style.display = 'none';
            if (audioBtnEl) audioBtnEl.textContent = '暂停音乐';
        }
    } catch {
        if (audioUiEl) audioUiEl.style.display = 'block';
    }
})();

function showFatal(message, details) {
    if (loadingEl) {
        loadingEl.style.opacity = 1;
        loadingEl.textContent = message;
    }
    // Keep error details out of the page UI.
    if (details) console.error(details);
}

function hideLoading() {
    if (loadingEl) loadingEl.style.opacity = 0;
}

function createSnowflakeBitmap(size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const mid = size / 2;

    ctx.translate(mid, mid);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(1, Math.floor(size / 32));
    ctx.lineCap = 'round';

    // 6-branch snowflake with small barbs
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, mid - 6);
        ctx.stroke();

        const barb1 = mid * 0.35;
        const barb2 = mid * 0.55;
        const barbLen = mid * 0.18;

        ctx.beginPath();
        ctx.moveTo(0, barb1);
        ctx.lineTo(barbLen, barb1 + barbLen * 0.45);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, barb1);
        ctx.lineTo(-barbLen, barb1 + barbLen * 0.45);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, barb2);
        ctx.lineTo(barbLen * 0.8, barb2 + barbLen * 0.35);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, barb2);
        ctx.lineTo(-barbLen * 0.8, barb2 + barbLen * 0.35);
        ctx.stroke();

        ctx.rotate(Math.PI / 3);
    }

    // Soft center glow
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, mid * 0.35);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, mid * 0.35, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
}

function createGlowParticleBitmap(size = 64, color = 'rgba(170,220,255,1)') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const mid = size / 2;

    const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grad.addColorStop(0.0, color);
    grad.addColorStop(0.25, color.replace(',1)', ',0.55)'));
    grad.addColorStop(1.0, 'rgba(170,220,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mid, mid, mid, 0, Math.PI * 2);
    ctx.fill();

    // add a tiny bright core
    const core = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.22);
    core.addColorStop(0, 'rgba(235,250,255,0.95)');
    core.addColorStop(1, 'rgba(235,250,255,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(mid, mid, mid * 0.22, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
}

function startCanvasFallback() {
    // 2D fallback: simulates the same camera move + pine needles + realistic snowflakes.
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.width = Math.floor(window.innerWidth * (window.devicePixelRatio || 1));
    canvas.height = Math.floor(window.innerHeight * (window.devicePixelRatio || 1));
    containerEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    const snowBmp = createSnowflakeBitmap(64);
    const beamParticleBmp = createGlowParticleBitmap(64, 'rgba(170,220,255,1)');

    function treeSurfaceRadiusAtY(y) {
        const t = Math.min(1, Math.max(0, y / CONFIG.treeHeight));
        return (CONFIG.treeRadius * (1 - t) + 1);
    }

    // Scene assets in local 3D (tree-centered)
    const needleCount = 9000;
    const needles = [];
    const color1 = { r: 1.0, g: 1.0, b: 1.0 };
    const color2 = { r: 0.533, g: 0.8, b: 1.0 };

    const layers = 12;
    for (let l = 0; l < layers; l++) {
        const t = l / layers;
        const layerY = t * CONFIG.treeHeight;
        const layerRadius = CONFIG.treeRadius * (1 - t) + 1;
        const needlesInLayer = Math.floor(needleCount / layers);
        for (let i = 0; i < needlesInLayer; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * layerRadius;
            const yOffset = (Math.random() - 0.5) * 3;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const y = layerY + yOffset;
            const out = 0.22;
            const nx = x * out;
            const ny = 1.0;
            const nz = z * out;
            const mix = Math.random();
            needles.push({
                x, y, z,
                x2: x + nx, y2: y + ny, z2: z + nz,
                r: color1.r + (color2.r - color1.r) * mix,
                g: color1.g + (color2.g - color1.g) * mix,
                b: color1.b + (color2.b - color1.b) * mix,
            });
        }
    }

    const snowCount2d = 900;
    const snow = [];
    for (let i = 0; i < snowCount2d; i++) {
        snow.push({
            x: (Math.random() - 0.5) * 110,
            y: Math.random() * 70,
            z: (Math.random() - 0.5) * 110,
            vy: 2 + Math.random() * 5,
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 1.2,
            size: 0.35 + Math.random() * 0.85,
            alpha: 0.35 + Math.random() * 0.55,
        });
    }

    // Big decorative snowflakes: only 5–6, distributed around the tree at different heights.
    const bigFlakeCount2d = 10;
    const bigFlakes2d = [];
    for (let i = 0; i < bigFlakeCount2d; i++) {
        const t = (i + 0.5) / bigFlakeCount2d;
        const y = 4 + t * (CONFIG.treeHeight - 6);
        const baseAngle = (i / bigFlakeCount2d) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
        bigFlakes2d.push({
            baseAngle,
            y,
            sizeW: 4.2 + Math.random() * 2.2, // world-ish size
            spin: (Math.random() - 0.5) * 0.9,
            orbit: (Math.random() < 0.5 ? -1 : 1) * (0.10 + Math.random() * 0.10),
            phase: Math.random() * Math.PI * 2,
            out: 0.32 + Math.random() * 0.18,
        });
    }

    // Camera path: same phases as WebGL version
    function cameraPathAt(p) {
        // p: 0..1
        if (p < 0.18) {
            const t = p / 0.18;
            // ground approach (far -> near root)
            return {
                x: 0,
                y: 2,
                z: 60 - t * 45,
                lookY: 6,
            };
        }
        if (p < 0.92) {
            const t = (p - 0.18) / (0.92 - 0.18);
            const loops = 3;
            const ang = t * Math.PI * 2 * loops;
            const radius = 15 * (1 - t) + 5;
            const y = 2 + t * CONFIG.treeHeight;
            const x = Math.cos(ang) * radius;
            const z = Math.sin(ang) * radius;
            return { x, y, z, lookY: y + 2 };
        }
        // converge near star
        const t = (p - 0.92) / (1 - 0.92);
        return {
            x: 0,
            y: CONFIG.treeHeight + t * 1.2,
            z: 2 - t * 1.5,
            lookY: CONFIG.treeHeight + 0.5,
        };
    }

    function vec3(x, y, z) { return { x, y, z }; }
    function sub(a, b) { return vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
    function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    function cross(a, b) {
        return vec3(
            a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x
        );
    }
    function len(v) { return Math.hypot(v.x, v.y, v.z); }
    function norm(v) {
        const l = len(v) || 1;
        return vec3(v.x / l, v.y / l, v.z / l);
    }

    function project(point, camPos, camTarget, width, height) {
        const forward = norm(sub(camTarget, camPos));
        const worldUp = vec3(0, 1, 0);
        const right = norm(cross(forward, worldUp));
        const up = cross(right, forward);

        const rel = sub(point, camPos);
        const x = dot(rel, right);
        const y = dot(rel, up);
        const z = dot(rel, forward);
        if (z <= 0.1) return null;

        const fov = 60 * Math.PI / 180;
        const f = 0.9 * (width / 2) / Math.tan(fov / 2);
        const sx = (x * f) / z + width / 2;
        const sy = (-y * f) / z + height / 2;
        return { x: sx, y: sy, z };
    }

    let progress = 0;
    const speed = 0.00055;
    let state = 'traveling';
    let flashStart = 0;

    // Timeline fractions (0..1 audio-normalized)
    const TL_TRAVEL_END = 0.84;
    const TL_FLASH_END = 0.92;

    // Ray trail (world-space history, projected each frame)
    const rayTrailLen = 140;
    const rayTrail1 = [];
    function pushTrail(trail, point) {
        trail.push(point);
        if (trail.length > rayTrailLen) trail.shift();
    }

    // Particle-beam ray renderer (curved trail, many glowing particles)
    function hash01(n) {
        const x = Math.sin(n) * 43758.5453123;
        return x - Math.floor(x);
    }

    function buildSmoothPath(points2d) {
        if (points2d.length < 2) return null;
        const path = new Path2D();
        path.moveTo(points2d[0].x, points2d[0].y);
        for (let i = 1; i < points2d.length - 1; i++) {
            const p = points2d[i];
            const n = points2d[i + 1];
            const mx = (p.x + n.x) * 0.5;
            const my = (p.y + n.y) * 0.5;
            path.quadraticCurveTo(p.x, p.y, mx, my);
        }
        const last = points2d[points2d.length - 1];
        path.lineTo(last.x, last.y);
        return path;
    }

    function drawSoftRibbonGlow(trail, camPos, camTarget, width, height, baseWidthPx) {
        if (trail.length < 2) return;
        const pts = [];
        for (let i = 0; i < trail.length; i++) {
            const p = project(trail[i], camPos, camTarget, width, height);
            if (p) pts.push(p);
        }
        if (pts.length < 2) return;
        const path = buildSmoothPath(pts);
        if (!path) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // Keep this subtle, but visible enough to read as a continuous beam body.
        ctx.strokeStyle = 'rgba(140,200,255,0.032)';
        ctx.lineWidth = baseWidthPx;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(140,200,255,0.28)';
        ctx.shadowBlur = 34;
        ctx.stroke(path);
        ctx.restore();
    }

    function drawBeamCoreStroke(trail, camPos, camTarget, width, height, lineWidthPx, alpha) {
        if (trail.length < 2) return;
        const pts = [];
        for (let i = 0; i < trail.length; i++) {
            const p = project(trail[i], camPos, camTarget, width, height);
            if (p) pts.push(p);
        }
        if (pts.length < 2) return;
        const path = buildSmoothPath(pts);
        if (!path) return;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(185,230,255,${alpha})`;
        ctx.lineWidth = lineWidthPx;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = `rgba(185,230,255,${Math.min(0.9, alpha * 2.6)})`;
        ctx.shadowBlur = 18;
        ctx.stroke(path);
        ctx.restore();
    }

    function drawParticleBeam(trail, camPos, camTarget, width, height, now, particleBmp, baseSizePx, baseSpreadPx, maxParticles, pulseMul = 1.0) {
        if (trail.length < 2) return;

        const pts = [];
        for (let i = 0; i < trail.length; i++) {
            const p = project(trail[i], camPos, camTarget, width, height);
            if (p) pts.push(p);
        }
        if (pts.length < 2) return;

        // Precompute segment lengths for sampling
        const segs = [];
        let totalLen = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const L = Math.hypot(dx, dy);
            if (L > 0.001) {
                segs.push({ a, b, L, dx, dy });
                totalLen += L;
            }
        }
        if (segs.length === 0 || totalLen <= 0.001) return;

        // With the solid core removed, we need enough particles to read as a beam.
        // Keep density bounded to avoid blowing out the screen with additive blending.
        const particleCount = Math.min(maxParticles, Math.max(34, Math.floor(totalLen / 10.0)));

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Sample along the polyline by arc-length
        for (let pIndex = 0; pIndex < particleCount; pIndex++) {
            const u = pIndex / Math.max(1, particleCount - 1); // 0 tail -> 1 head
            const seed = pIndex * 37.13 + now * 0.001;
            const jitterU = (hash01(seed) - 0.5) * (1 / particleCount) * 12;
            const uu = Math.min(1, Math.max(0, u + jitterU));

            let d = uu * totalLen;
            let seg = segs[0];
            for (let si = 0; si < segs.length; si++) {
                if (d <= segs[si].L) {
                    seg = segs[si];
                    break;
                }
                d -= segs[si].L;
            }
            const t = seg.L <= 0 ? 0 : d / seg.L;
            const x = seg.a.x + seg.dx * t;
            const y = seg.a.y + seg.dy * t;

            // Perpendicular jitter to form a beam volume
            const invL = 1 / Math.max(0.001, seg.L);
            const px = -seg.dy * invL;
            const py = seg.dx * invL;
            // Tighter “tube” feel: less perpendicular scatter and less widening toward the head.
            const swirl = (hash01(seed + 91.7) - 0.5) * 1.15;
            const spread = baseSpreadPx * (0.06 + 0.26 * Math.pow(uu, 1.15));
            const off = swirl * spread;

            // Depth / fog-ish fade using projected z (approx from nearest end)
            const zApprox = (seg.a.z + seg.b.z) * 0.5;
            const fog = Math.min(1, Math.max(0, (zApprox - 10) / 120));

            // Make the beam feel like particles (not a solid line): add sparkle variation per particle.
            // Tighter, more solid particles
            const sparkle = 0.75 + 0.75 * hash01(seed + 51.3);
            const pulseGain = 0.95 + 0.65 * pulseMul;
            const alpha = Math.min(0.85, (0.046 + 0.44 * Math.pow(uu, 1.55)) * sparkle * pulseGain * (1 - fog * 0.62));
            // Smaller points (less “blob”), thickness should come from spread + core stroke.
            const size = baseSizePx * (0.56 + 1.10 * Math.pow(uu, 1.05)) * (0.92 + 0.28 * hash01(seed + 19.2));

            ctx.globalAlpha = alpha;
            ctx.drawImage(particleBmp, x + px * off - size, y + py * off - size, size * 2, size * 2);
        }

        ctx.restore();
        ctx.globalAlpha = 1;
    }

    function drawStar2D(x, y, radius, glow, color) {
        const spikes = 5;
        const outer = radius;
        const inner = radius * 0.45;
        let rot = -Math.PI / 2;
        const step = Math.PI / spikes;
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.moveTo(Math.cos(rot) * outer, Math.sin(rot) * outer);
        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(Math.cos(rot) * outer, Math.sin(rot) * outer);
            rot += step;
            ctx.lineTo(Math.cos(rot) * inner, Math.sin(rot) * inner);
            rot += step;
        }
        ctx.closePath();

        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
        ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
    }

    let lastTime = performance.now();
    function frame(now) {
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        audioSync.update(now);

        const width = window.innerWidth;
        const height = window.innerHeight;

        // Background
        ctx.clearRect(0, 0, width, height);
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#000510');
        bgGrad.addColorStop(1, '#001026');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Update snow
        for (const s of snow) {
            s.y -= s.vy * dt;
            s.x += Math.sin(now * 0.0005 + s.z) * dt * 0.3;
            s.rot += s.vrot * dt;
            if (s.y < 0) {
                s.y = 70;
                s.x = (Math.random() - 0.5) * 110;
                s.z = (Math.random() - 0.5) * 110;
            }
        }

        // Camera progression: lock the whole cinematic to the music duration (end together).
        const tNorm = audioSync.timeNorm();
        if (tNorm !== null) {
            if (tNorm < TL_TRAVEL_END) {
                state = 'traveling';
                progress = tNorm / TL_TRAVEL_END;
            } else if (tNorm < TL_FLASH_END) {
                state = 'flashing';
                progress = 1;
                if (!flashStart) flashStart = now;
            } else {
                state = 'zooming_out';
                const tz = (tNorm - TL_FLASH_END) / Math.max(1e-6, (1 - TL_FLASH_END));
                progress = Math.max(0.7, 1 - tz * 0.30);
            }
        } else {
            // Fallback when duration not known / audio not playing yet.
            if (state === 'traveling') {
                progress += speed * (dt * 60) * audioSync.speedMul();
                if (progress >= 1) {
                    progress = 1;
                    state = 'flashing';
                    flashStart = now;
                }
            }
        }

        // Camera and targets
        const cam = cameraPathAt(progress);
        const camPos = vec3(cam.x, cam.y, cam.z);
        const target = vec3(0, cam.lookY, 0);
        const starPos = vec3(0, CONFIG.treeHeight + 1, 0);

        // Ground hint
        ctx.fillStyle = 'rgba(0,40,80,0.25)';
        ctx.fillRect(0, height * 0.82, width, height * 0.18);

        // Draw snow (behind tree) - project and draw image
        for (const s of snow) {
            const sp = project(vec3(s.x, s.y, s.z), camPos, target, width, height);
            if (!sp) continue;
            const fog = Math.min(1, Math.max(0, (sp.z - 10) / 120));
            const alpha = s.alpha * (1 - fog * 0.65);
            const pxSize = (12 * s.size) / Math.max(0.6, sp.z / 28);

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(sp.x, sp.y);
            ctx.rotate(s.rot);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(snowBmp, -pxSize / 2, -pxSize / 2, pxSize, pxSize);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
        }

        // Draw tree trunk
        const trunkBottom = project(vec3(0, 0, 0), camPos, target, width, height);
        const trunkTop = project(vec3(0, CONFIG.treeHeight * 0.5, 0), camPos, target, width, height);
        if (trunkBottom && trunkTop) {
            const trunkW = 18 / Math.max(1, trunkBottom.z / 20);
            const grd = ctx.createLinearGradient(trunkTop.x, trunkTop.y, trunkBottom.x, trunkBottom.y);
            grd.addColorStop(0, 'rgba(90,90,120,0.75)');
            grd.addColorStop(1, 'rgba(40,40,60,0.85)');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.roundRect(trunkTop.x - trunkW * 0.35, trunkTop.y, trunkW * 0.7, trunkBottom.y - trunkTop.y, trunkW * 0.25);
            ctx.fill();
        }

        // Draw needles
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1;
        for (let i = 0; i < needles.length; i++) {
            const n = needles[i];
            const p1 = project(vec3(n.x, n.y, n.z), camPos, target, width, height);
            const p2 = project(vec3(n.x2, n.y2, n.z2), camPos, target, width, height);
            if (!p1 || !p2) continue;
            // Fog and distance fade
            const fog = Math.min(1, Math.max(0, (p1.z - 12) / 110));
            const alpha = 0.55 * (1 - fog * 0.75);
            if (alpha <= 0.02) continue;
            ctx.strokeStyle = `rgba(${Math.floor(n.r * 255)},${Math.floor(n.g * 255)},${Math.floor(n.b * 255)},${alpha})`;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }
        ctx.restore();

        // Draw big decorative snowflakes around the tree (foreground accents)
        for (const f of bigFlakes2d) {
            const ang = f.baseAngle + (now * 0.001) * f.orbit;
            const bob = Math.sin(now * 0.0012 + f.phase) * 0.35;
            const yy = f.y + bob;
            // Stick to the cone surface radius at this height (plus tiny outward offset)
            const rr = treeSurfaceRadiusAtY(yy) + f.out;
            const wp = vec3(Math.cos(ang) * rr, yy, Math.sin(ang) * rr);
            const sp = project(wp, camPos, target, width, height);
            if (!sp) continue;

            const fog = Math.min(1, Math.max(0, (sp.z - 10) / 120));
            const alpha = (0.65 * (1 - fog * 0.75));
            if (alpha <= 0.03) continue;

            const pxSize = (150 * f.sizeW) / Math.max(0.9, sp.z / 26);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(sp.x, sp.y);
            ctx.rotate(now * 0.001 * f.spin);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(snowBmp, -pxSize / 2, -pxSize / 2, pxSize, pxSize);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
        }

        // Light rays: follow the motion path so the trail visibly curves.
        // If a path-sampled point is behind the camera (projection culls), fall back to a guaranteed in-front point.
        const forward2 = norm(sub(target, camPos));
        const worldUp2 = vec3(0, 1, 0);
        const right2 = norm(cross(forward2, worldUp2));
        const up2 = cross(right2, forward2);

        const sway = Math.sin(now * 0.0016) * 0.9;
        const leadFar = 26;
        const baseDown = -1.1;
        const fallback1 = vec3(
            camPos.x + forward2.x * leadFar + right2.x * (3.2 + sway) + up2.x * baseDown,
            camPos.y + forward2.y * leadFar + right2.y * (3.2 + sway) + up2.y * baseDown,
            camPos.z + forward2.z * leadFar + right2.z * (3.2 + sway) + up2.z * baseDown
        );

        // Preferred: sample along the camera path slightly ahead to make the beam trail bend with the path.
        const pCam = progress;
        const p1 = Math.min(pCam + 0.020, 1);
        const c1 = cameraPathAt(p1);
        const cand1 = vec3(c1.x, c1.y, c1.z);

        const r1w = project(cand1, camPos, target, width, height) ? cand1 : fallback1;
        const star2d = project(starPos, camPos, target, width, height);

        if (state === 'traveling') {
            pushTrail(rayTrail1, r1w);

            // Particle-only beam (no solid stroke)
            const bp = audioSync.beamPulse();

            // Render as particle-beam rays (many particles following the curved trail)
            // Spread radius x2, density ~1/2 (maxParticles halved)
            // Particle size x2 (user request)
            // Particle-only beam: slightly smaller particles, brighter pulse.
            drawParticleBeam(rayTrail1, camPos, target, width, height, now, beamParticleBmp, 16.2, 46.0, 92, bp);

            // Near the star: pull beams into the star with extra particles
            if (progress > 0.94 && star2d && rayTrail1.length) {
                const head1 = rayTrail1[rayTrail1.length - 1];
                const starW = starPos;
                const tmpTrailA = [head1, starW];
                // Particle size x2 (user request)
                drawParticleBeam(tmpTrailA, camPos, target, width, height, now + 77, beamParticleBmp, 10.0, 32.0, 72, bp);
            }
        }

        // Star + convergence + flash
        if (star2d) {
            const baseR = 14 / Math.max(0.8, star2d.z / 30);
            // (No glow-dot here; convergence is handled as line streaks above.)

            if (state === 'flashing') {
                const t = Math.min(1, (now - flashStart) / 1200);
                const flicker = (Math.sin(now * 0.03) * 0.5 + 0.5);
                const glow = 24 + 40 * flicker;
                drawStar2D(star2d.x, star2d.y, baseR * (1.1 + flicker * 0.35), glow, 'rgba(255,245,190,0.95)');

                // after flash: zoom out
                if (t >= 1) {
                    state = 'zooming_out';
                }
            } else {
                const tw = (Math.sin(now * 0.01) * 0.5 + 0.5);
                drawStar2D(star2d.x, star2d.y, baseR * (1.0 + tw * 0.12), 18 + 18 * tw, 'rgba(255,245,190,0.85)');
            }
        }

        if (state === 'zooming_out' && tNorm === null) {
            // fallback-only easing
            progress = Math.max(0.7, progress - dt * 0.02);
            const tw = (Math.sin(now * 0.01) * 0.5 + 0.5);
            // subtle vignette
            const vg = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.15, width / 2, height / 2, Math.min(width, height) * 0.75);
            vg.addColorStop(0, 'rgba(0,0,0,0)');
            vg.addColorStop(1, 'rgba(0,0,0,0.25)');
            ctx.fillStyle = vg;
            ctx.fillRect(0, 0, width, height);
            // keep a gentle star twinkle
            if (star2d) {
                drawStar2D(star2d.x, star2d.y, 10 * (1 + tw * 0.1), 18 + 10 * tw, 'rgba(255,245,190,0.75)');
            }
        }

        requestAnimationFrame(frame);
    }

    hideLoading();
    requestAnimationFrame(frame);

    window.addEventListener('resize', () => {
        canvas.width = Math.floor(window.innerWidth * (window.devicePixelRatio || 1));
        canvas.height = Math.floor(window.innerHeight * (window.devicePixelRatio || 1));
        const nextDpr = window.devicePixelRatio || 1;
        ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
    });
}

// Decide renderer
const testCanvas = document.createElement('canvas');
const testGl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
if (!testGl) {
    showFatal(
        'WebGL is disabled (edge://gpu shows WebGL: Disabled). Using a Canvas 2D fallback renderer instead.',
        'To enable WebGL: turn on hardware acceleration in Edge, restart, and ensure WebGL is not Disabled in edge://gpu.'
    );
    startCanvasFallback();
} else {
    startThree();
}

function startThree() {

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bgColor);
scene.fog = new THREE.FogExp2(CONFIG.bgColor, 0.02);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ReinhardToneMapping;
containerEl.appendChild(renderer.domElement);

// --- Post Processing (Bloom) ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.2;
bloomPass.strength = 1.5; // Glow strength
bloomPass.radius = 0.5;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Textures ---
function createSnowflakeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    
    ctx.translate(32, 32);
    
    // Draw a simple 6-branch snowflake
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 28);
        ctx.stroke();
        
        // Branch details
        ctx.beginPath();
        ctx.moveTo(0, 15);
        ctx.lineTo(10, 20);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(0, 15);
        ctx.lineTo(-10, 20);
        ctx.stroke();

        ctx.rotate(Math.PI / 3);
    }
    
    // Add a soft glow center
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

// --- Objects ---

// 1. The Tree
function createTree() {
    const treeGroup = new THREE.Group();

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(1, 3, CONFIG.treeHeight / 2, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = CONFIG.treeHeight / 4;
    treeGroup.add(trunk);

    // Needles (The foliage)
    // We will use many LineSegments to simulate pine needles
    const needleCount = 20000;
    const positions = [];
    const colors = [];
    const color1 = new THREE.Color(CONFIG.treeColor1);
    const color2 = new THREE.Color(CONFIG.treeColor2);

    // Create cone layers
    const layers = 12;
    for (let l = 0; l < layers; l++) {
        const t = l / layers; // 0 at bottom, 1 at top
        const layerY = t * CONFIG.treeHeight;
        const layerRadius = CONFIG.treeRadius * (1 - t) + 1; // Taper to top
        
        const needlesInLayer = needleCount / layers;
        
        for (let i = 0; i < needlesInLayer; i++) {
            // Random position within this layer's cone volume
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * layerRadius;
            const yOffset = (Math.random() - 0.5) * 3; // Thickness of layer
            
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const y = layerY + yOffset;

            // Needle vector (pointing slightly out and up)
            const nx = x * 0.2;
            const ny = 1.0;
            const nz = z * 0.2;
            
            // Start point
            positions.push(x, y, z);
            // End point
            positions.push(x + nx, y + ny, z + nz);

            // Color mix
            const mixedColor = color1.clone().lerp(color2, Math.random());
            colors.push(mixedColor.r, mixedColor.g, mixedColor.b);
            colors.push(mixedColor.r, mixedColor.g, mixedColor.b); // Same color for end point
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({ 
        vertexColors: true, 
        transparent: true, 
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    const foliage = new THREE.LineSegments(geometry, material);
    treeGroup.add(foliage);

    // (Decorations moved to a dedicated big-snowflake ring around the tree.)

    return treeGroup;
}

const tree = createTree();
scene.add(tree);

function treeSurfaceRadiusAtY3D(y) {
    const t = THREE.MathUtils.clamp(y / CONFIG.treeHeight, 0, 1);
    return (CONFIG.treeRadius * (1 - t) + 1);
}

// 2. The Star
const starGeo = new THREE.IcosahedronGeometry(1.5, 0);
const starMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
const star = new THREE.Mesh(starGeo, starMat);
star.position.y = CONFIG.treeHeight + 1;
scene.add(star);

// Star Glow (PointLight)
const starLight = new THREE.PointLight(0xffffaa, 0, 50); // Start with 0 intensity
starLight.position.copy(star.position);
scene.add(starLight);

// 3. Snow
const snowGeo = new THREE.BufferGeometry();
const snowPos = [];
for (let i = 0; i < CONFIG.snowCount; i++) {
    snowPos.push(
        (Math.random() - 0.5) * 100,
        Math.random() * 60,
        (Math.random() - 0.5) * 100
    );
}
snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(snowPos, 3));
const snowflakeTex = createSnowflakeTexture();
const snowMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.8,
    map: snowflakeTex,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const snowSystem = new THREE.Points(snowGeo, snowMat);
scene.add(snowSystem);

// Big decorative snowflakes (only 5–6, ringed around the tree at different heights)
function createBigSnowflakeRing(texture) {
    const group = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const count = 10;
    for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const y = 4 + t * (CONFIG.treeHeight - 6);
        const baseAngle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
        const size = 4.2 + Math.random() * 2.4;

        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(size, size, size);
        mesh.userData.baseAngle = baseAngle;
        mesh.userData.baseY = y;
        mesh.userData.orbit = (Math.random() < 0.5 ? -1 : 1) * (0.10 + Math.random() * 0.10);
        mesh.userData.spin = (Math.random() - 0.5) * 1.2;
        mesh.userData.phase = Math.random() * Math.PI * 2;
        mesh.userData.bob = 0.35 + Math.random() * 0.25;
        mesh.userData.out = 0.30 + Math.random() * 0.20;

        group.add(mesh);
    }
    scene.add(group);
    return group;
}

const bigSnowflakes = createBigSnowflakeRing(snowflakeTex);

// 4. Ground (Reflection)
const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({ 
    color: 0x001133, 
    roughness: 0.1, 
    metalness: 0.5 
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// 5. Lighting
const ambientLight = new THREE.AmbientLight(0x4466ff, 0.5);
scene.add(ambientLight);

// 6. The "Light Rays" (Guides)
const rayTrailLength = 96;
// Particle density (increase to make beam clearly particle-composed).
const rayParticleCount = 160;

function createRayParticleBeam() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(rayParticleCount * 3);
    const aColor = new Float32Array(rayParticleCount * 3);
    const aAlpha = new Float32Array(rayParticleCount);
    const aSize = new Float32Array(rayParticleCount);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            // Visibility floor: keep it clearly readable across displays.
            uOpacity: { value: 0.40 },
        },
        vertexShader: `
            precision highp float;
            attribute vec3 aColor;
            attribute float aAlpha;
            attribute float aSize;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                vColor = aColor;
                vAlpha = aAlpha;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float dist = max(1.0, -mvPosition.z);
                // Particle size x2 (user request)
                gl_PointSize = aSize * (300.0 / dist);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform float uOpacity;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                vec2 uv = gl_PointCoord - vec2(0.5);
                float d = length(uv);
                float soft = smoothstep(0.5, 0.0, d);
                float core = smoothstep(0.18, 0.0, d);
                float a = (soft * 0.40 + core * 0.22) * vAlpha * uOpacity;
                gl_FragColor = vec4(vColor, a);
            }
        `,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);

    return { points, geo, positions, aColor, aAlpha, aSize, trail: [] };
}

function pushRayPoint(trail, point) {
    trail.points.push(point.clone());
    if (trail.points.length > rayTrailLength) trail.points.shift();
}

function hash01(n) {
    const x = Math.sin(n) * 43758.5453123;
    return x - Math.floor(x);
}

function updateRayParticleBeam(beam, camera, time, baseRadiusWorld) {
    const n = beam.trail.length;
    if (n < 2) {
        beam.points.visible = false;
        return;
    }
    beam.points.visible = true;

    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    const p = new THREE.Vector3();

    const baseBlue = new THREE.Color(0xaaddff);
    const baseWhite = new THREE.Color(0xffffff);

    for (let i = 0; i < rayParticleCount; i++) {
        const u0 = i / Math.max(1, rayParticleCount - 1);
        const seed = i * 17.13;
        const u = Math.min(1, Math.max(0, u0 + (hash01(seed + time * 0.35) - 0.5) * 0.02));

        const f = u * (n - 1);
        const idx = Math.min(n - 2, Math.max(0, Math.floor(f)));
        const t = f - idx;
        p.copy(beam.trail[idx]).lerp(beam.trail[idx + 1], t);

        tangent.copy(beam.trail[idx + 1]).sub(beam.trail[idx]);
        if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
        tangent.normalize();

        n1.copy(tangent).cross(up);
        if (n1.lengthSq() < 1e-10) n1.copy(tangent).cross(new THREE.Vector3(1, 0, 0));
        n1.normalize();
        n2.copy(tangent).cross(n1).normalize();

        const ang = (hash01(seed + 3.7) * Math.PI * 2) + time * (0.25 + 0.35 * u);
        // Tube-like radius: much less widening and less randomness
        const rr = baseRadiusWorld * (0.55 + 0.25 * Math.pow(u, 1.05)) * (0.80 + 0.20 * hash01(seed + 9.1));
        p.addScaledVector(n1, Math.cos(ang) * rr);
        p.addScaledVector(n2, Math.sin(ang) * rr);

        const alpha = 0.040 + 0.28 * Math.pow(u, 2.0);
        const size = (1.8 + 4.8 * Math.pow(u, 1.25)) * 1.00;
        const c = baseBlue.clone().lerp(baseWhite, 0.2 + 0.15 * u);
        c.multiplyScalar(0.12 + 0.22 * Math.pow(u, 1.55));

        const pi = i * 3;
        beam.positions[pi + 0] = p.x;
        beam.positions[pi + 1] = p.y;
        beam.positions[pi + 2] = p.z;
        beam.aColor[pi + 0] = c.r;
        beam.aColor[pi + 1] = c.g;
        beam.aColor[pi + 2] = c.b;
        beam.aAlpha[i] = alpha;
        beam.aSize[i] = size;
    }

    beam.geo.attributes.position.needsUpdate = true;
    beam.geo.attributes.aColor.needsUpdate = true;
    beam.geo.attributes.aAlpha.needsUpdate = true;
    beam.geo.attributes.aSize.needsUpdate = true;

}

const ray1Beam = createRayParticleBeam();
ray1Beam.points.visible = false;


// --- Animation Logic ---

// Define the path
// 1. Ground approach: Far -> Near Root
// 2. Spiral Up: Root -> Top
const curvePoints = [];

// Phase 1: Approach
for (let i = 0; i < 5; i++) {
    curvePoints.push(new THREE.Vector3(0, 2, 60 - i * 10)); // 60, 50, 40, 30, 20
}

// Phase 2: Spiral Up
const spiralLoops = 3;
const spiralHeight = CONFIG.treeHeight;
for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const angle = t * Math.PI * 2 * spiralLoops;
    const radius = 15 * (1 - t) + 5; // Get closer as we go up
    const y = 2 + t * spiralHeight;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    curvePoints.push(new THREE.Vector3(x, y, z));
}

// Phase 3: Top (Star location)
curvePoints.push(new THREE.Vector3(0, CONFIG.treeHeight, 2)); // Just in front of star
curvePoints.push(new THREE.Vector3(0, CONFIG.treeHeight + 1, 0.5)); // Very close

const cameraPath = new THREE.CatmullRomCurve3(curvePoints);

let progress = 0;
const speed = 0.0005; // Base speed
let state = 'traveling'; // traveling, flashing, zooming_out

// Animation Loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    audioSync.update(performance.now());

    // Timeline fractions (0..1 audio-normalized)
    const TL_TRAVEL_END = 0.84;
    const TL_FLASH_END = 0.92;

    // Snow Animation
    const positions = snowSystem.geometry.attributes.position.array;
    for (let i = 1; i < positions.length; i += 3) {
        positions[i] -= delta * 5; // Fall down
        if (positions[i] < 0) positions[i] = 60; // Reset to top
    }
    snowSystem.geometry.attributes.position.needsUpdate = true;
    snowSystem.rotation.y = time * 0.05; // Rotate snow system slightly

    const tNorm = audioSync.timeNorm();
    if (tNorm !== null) {
        if (tNorm < TL_TRAVEL_END) {
            state = 'traveling';
            progress = tNorm / TL_TRAVEL_END;
        } else if (tNorm < TL_FLASH_END) {
            state = 'flashing';
            progress = 1;
        } else {
            state = 'zooming_out';
        }
    } else {
        // Fallback to previous behavior until audio duration is known.
        if (state === 'traveling') {
            progress += speed * (delta * 60) * audioSync.speedMul();
            if (progress > 1) {
                progress = 1;
                state = 'flashing';
            }
        }
    }

    // Camera & Ray Animation
    if (state === 'traveling') {

        // Get positions on curve
        // Ray is slightly ahead of the camera on the path
        const p1 = Math.min(progress + 0.02, 1);
        const pCam = progress;

        let pos1 = cameraPath.getPointAt(p1);
        const posCam = cameraPath.getPointAt(pCam);

        // If we are near the end (Star), pull the ray into the star
        if (progress > 0.95) {
            const k = (progress - 0.95) * 20;
            pos1 = pos1.clone().lerp(star.position, k);
        }

        ray1Beam.trail.push(pos1.clone());
        if (ray1Beam.trail.length > rayTrailLength) ray1Beam.trail.shift();

        // Tighter beam: smaller spread radius
        updateRayParticleBeam(ray1Beam, camera, time, 0.55);

        // Beat-pulse the ray opacity a bit for clearer “卡点”
        const rayPulse = audioSync.beamPulse();
        if (ray1Beam.points && ray1Beam.points.material && ray1Beam.points.material.uniforms && ray1Beam.points.material.uniforms.uOpacity) {
            ray1Beam.points.material.uniforms.uOpacity.value = 0.92 * rayPulse;
        }
        
        // Camera follows
        camera.position.copy(posCam);
        
        // Camera looks at a point further ahead on the curve
        const lookAtP = Math.min(progress + 0.05, 1);
        const lookAtPos = cameraPath.getPointAt(lookAtP);
        camera.lookAt(lookAtPos);

        // If we are near the end (Star), look at the star
        if (progress > 0.95) {
            camera.lookAt(star.position);
        }

        // Animate big snowflake ring (gentle orbit + bob + spin) and keep them attached to the cone surface.
        if (bigSnowflakes) {
            bigSnowflakes.children.forEach((m) => {
                const ang = m.userData.baseAngle + time * m.userData.orbit;
                const bob = Math.sin(time * 0.9 + m.userData.phase) * m.userData.bob;
                const y = m.userData.baseY + bob;
                const r = treeSurfaceRadiusAtY3D(y) + m.userData.out;
                const x = Math.cos(ang) * r;
                const z = Math.sin(ang) * r;
                m.position.set(x, y, z);

                // Surface normal for a cone-like radius function r(y)
                const drdy = -CONFIG.treeRadius / Math.max(1e-6, CONFIG.treeHeight);
                // Two tangents
                const tAng = new THREE.Vector3(-r * Math.sin(ang), 0, r * Math.cos(ang));
                const tY = new THREE.Vector3(drdy * Math.cos(ang), 1, drdy * Math.sin(ang));
                const normal = new THREE.Vector3().crossVectors(tAng, tY).normalize();
                if (normal.lengthSq() < 1e-10) normal.set(Math.cos(ang), 0, Math.sin(ang));

                // Align plane +Z with outward normal (Object3D.lookAt aligns -Z toward target)
                m.lookAt(m.position.clone().sub(normal));
                m.rotateZ(time * m.userData.spin);
            });
        }

    } else if (state === 'flashing') {
        // Rays have hit the star
        ray1Beam.points.visible = false;

        // Flash the star
        const flashSpeed = 2;
        const intensity = Math.sin(time * 10) * 0.5 + 0.5; // Flicker
        starMat.color.setHSL(0.16, 1, 0.5 + intensity * 0.5);
        starLight.intensity = THREE.MathUtils.lerp(starLight.intensity, 5, 0.1);
        bloomPass.strength = 3.0; // High bloom

        // Wait a bit then zoom out
        if (starLight.intensity > 4) {
            setTimeout(() => { state = 'zooming_out'; }, 1000);
        }

    } else if (state === 'zooming_out') {
        // Pull camera back and up
        const targetPos = new THREE.Vector3(0, 30, 80);
        // If audio drives timeline, make zoom-out reach target exactly at music end.
        if (tNorm !== null) {
            const tz = (tNorm - TL_FLASH_END) / Math.max(1e-6, (1 - TL_FLASH_END));
            const tClamped = Math.min(1, Math.max(0, tz));
            // Smoothstep for nicer easing
            const eased = tClamped * tClamped * (3 - 2 * tClamped);
            camera.position.lerp(targetPos, 0.02 + eased * 0.10);
        } else {
            camera.position.lerp(targetPos, 0.01);
        }
        camera.lookAt(0, 20, 0);
        
        // Star continues to twinkle
        const intensity = Math.sin(time * 5) * 0.5 + 0.5;
        starMat.color.setHSL(0.16, 1, 0.5 + intensity * 0.5);
        bloomPass.strength = THREE.MathUtils.lerp(bloomPass.strength, 1.5, 0.05);

        ray1Beam.points.visible = false;
    }

    // Render
    composer.render();
}

// Start
hideLoading();
animate();

// Handle Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

}
