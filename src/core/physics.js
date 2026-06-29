// ============================================================
// 珠珠快跑 — 物理系统
// 提取自 game.js
// ============================================================

import { S } from '../state.js';
import { CFG } from '../config.js';
import { startSinkAnimation } from './animation.js';
import { gameOver } from './animation.js';
import { playSfx } from './audio.js';

export function worldToScreen(worldX, worldY) {
  const relX = worldX - 0.5;
  const relY = worldY - S.camera.worldY;
  return {
    x: S.W / 2 + relX * S.W * 0.5,
    y: S.H * 0.70 - relY * S.H * 0.4,
    depth: relY,
    dScale: 1,
  };
}

export function createPit(worldX, worldY, radius) {
  return {
    worldX, worldY, radius,
    visited: false,
    _index: S.pitIdCounter++,
    alpha: 0,
    rotation: Math.random() * Math.PI * 2,
    hasTreasure: false,
    treasureId: null,
    hasFriendImg: false,
    friendImgIdx: -1,
  };
}

export function spawnPitAt(worldX, worldY, radius) {
  S.pits.push(createPit(worldX, worldY, radius));
}

export function spawnNextPit() {
  const lastPit = S.pits.length > 0 ? S.pits[S.pits.length - 1] : null;
  let worldX, worldY, radius;

  if (!lastPit) {
    worldX = 0.58 + Math.random() * 0.08;
    radius = CFG.PIT_RADIUS_MIN + Math.random() * 0.015;
    worldY = S.marble.worldY + radius * 2 * 4;
  } else {
    const tp2 = (S.progress.totalPits || 0);
    const spread = tp2 < 20 ? 0.32 : (tp2 < 50 ? 0.42 : 0.52);
    const angleVariation = (Math.random() - 0.5) * 1.4;
    const baseAngle = lastPit.worldX > 0.5 ? Math.PI : 0;
    const dirAngle = baseAngle + angleVariation;
    worldX = 0.5 + Math.sin(dirAngle) * (0.18 + Math.random() * spread);

    const diameter = lastPit.radius * 2;
    const tp = (S.progress.totalPits || 0);
    var minMul, maxMul;
    if (tp < 20) { minMul = 5.5; maxMul = 6.0; }
    else if (tp < 50) { minMul = 5.0; maxMul = 7.5; }
    else { minMul = 4.0; maxMul = 8.0; }
    const multiplier = minMul + Math.random() * (maxMul - minMul);
    worldY = lastPit.worldY + diameter * multiplier;

    var rMin = CFG.PIT_RADIUS_MIN, rMax = CFG.PIT_RADIUS_MAX;
    if (tp >= 20 && tp < 50) { rMin = 0.040; rMax = 0.058; }
    else if (tp >= 50) { rMin = 0.038; rMax = 0.052; }
    radius = rMin + Math.random() * (rMax - rMin);
  }

  const pit = createPit(worldX, worldY, radius);
  S.pits.push(pit);
  return pit;
}

export function getCurrentTargetPit() {
  return S.pits.find(function(p) { return !p.visited; }) || null;
}

export function updateRolling(dt) {
  const decay = Math.exp(-CFG.FRICTION * dt);
  S.marble.vy *= decay;
  S.marble.vx *= decay;

  const spd2 = Math.sqrt(S.marble.vx * S.marble.vx + S.marble.vy * S.marble.vy);
  if (spd2 < 0.8 && spd2 > 0.001) {
    const lowDrag = (0.8 - spd2) * 1.3;
    const extraDecay = Math.exp(-lowDrag * dt);
    S.marble.vx *= extraDecay;
    S.marble.vy *= extraDecay;
  }

  const GRAVITY = 1.5;
  const bottomX = S.marble.worldX;
  const bottomY = S.marble.worldY + CFG.MARBLE_RADIUS;
  let overPit = false;
  for (const pit of S.pits) {
    if (pit.visited) continue;
    const dx = bottomX - pit.worldX;
    const dy = bottomY - pit.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const pullRange = pit.radius * 1.5;
    if (dist < pullRange && dist > 0.01) {
      overPit = true;
      const strength = (1 - dist / pullRange) * GRAVITY;
      S.marble.vx -= (dx / dist) * strength * dt;
      S.marble.vy -= (dy / dist) * strength * dt;
    }
  }

  S.marble.worldY += S.marble.vy * dt;
  S.marble.worldX += S.marble.vx * dt;
  S.marble.texOffX = (S.marble.texOffX - S.marble.vx * dt * 220) % 1200;
  S.marble.texOffY = (S.marble.texOffY + S.marble.vy * dt * 220) % 1200;

  const targetScale = overPit ? 0.96 : 1.0;
  const lerpSpeed = overPit ? 0.35 : 0.15;
  S.marble.scale += (targetScale - S.marble.scale) * lerpSpeed;

  const speed = Math.sqrt(S.marble.vx * S.marble.vx + S.marble.vy * S.marble.vy);
  if (speed < CFG.STOP_THRESHOLD) {
    S.marble.vx = 0;
    S.marble.vy = 0;
    checkPitResult();
  }
}

export function checkPitResult() {
  const targetPit = getCurrentTargetPit();
  if (!targetPit) {
    gameOver();
    return;
  }

  const mx = S.marble.worldX;
  const my = S.marble.worldY + CFG.MARBLE_RADIUS;
  const dx = mx - targetPit.worldX;
  const dy = my - targetPit.worldY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  var tolerance2 = CFG.HIT_TOLERANCE;
  if (S.propMagnetActive && targetPit._index === S.propMagnetPitIndex) {
    tolerance2 = 99;
  }
  if (dist <= targetPit.radius * tolerance2) {
    if (S.propMagnetActive && targetPit._index === S.propMagnetPitIndex) {
      S.propMagnetActive = false; S.propMagnetPitIndex = -1; S.magnetParticles = [];
    }
    S.currentPitIndex = targetPit._index;
    startSinkAnimation(targetPit);
  } else {
    playSfx('fail');
    S.gameState = 'lost'; // STATE.LOST
  }
}
