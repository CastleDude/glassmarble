// ============================================================
// 珠珠快跑 — 音效系统
// 提取自 game.js
// ============================================================

import { S } from '../state.js';

export function playSfx(name) {
  if (!S.sfxOn) return;
  var a = S.sfxPool[name];
  if (!a) return;
  a.stop();
  a.seek(0);
  a.play();
}

export function stopSfx(name) {
  var a = S.sfxPool[name];
  if (a) { a.stop(); }
}

export function preloadSfx() {
  var sfxFiles = {
    luo: 'assets/audio/sfx/luo.mp3',
    peng: 'assets/audio/sfx/peng.mp3',
    speed: 'assets/audio/sfx/speed.mp3',
    victory: 'assets/audio/sfx/victory.mp3',
    fail: 'assets/audio/sfx/fail.mp3',
    btn: 'assets/audio/sfx/btn.mp3',
    jingdian: 'assets/audio/sfx/jingdian.mp3',
    power: 'assets/audio/sfx/power.mp3',
    type: 'assets/audio/sfx/type.mp3',
  };
  var keys = Object.keys(sfxFiles);
  for (var i = 0; i < keys.length; i++) {
    (function(key) {
      var a = wx.createInnerAudioContext();
      a.src = sfxFiles[key];
      S.sfxPool[key] = a;
    })(keys[i]);
  }
}

export function initBGM() {
  S.bgmAudio = wx.createInnerAudioContext();
  S.bgmAudio.src = 'assets/audio/bgm/love.mp3';
  S.bgmAudio.loop = true;
  S.bgmAudio.volume = S.musicVolume;
  if (S.musicOn) S.bgmAudio.play();
}

export function toggleMusic() {
  S.musicOn = !S.musicOn;
  if (S.bgmAudio) {
    if (S.musicOn) {
      S.bgmAudio.volume = S.musicVolume;
      S.bgmAudio.play();
    } else {
      S.bgmAudio.pause();
    }
  }
}
