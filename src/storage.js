// ============================================================
// 珠珠快跑 — 本地存储
// 提取自 game.js
// ============================================================

import { S } from '../state.js';

export function saveAllData() {
  try {
    wx.setStorageSync('zhuzhu_progress', S.progress);
    wx.setStorageSync('zhuzhu_lives', S.livesData);
    wx.setStorageSync('zhuzhu_best_score', S.bestScore);
    wx.setStorageSync('zhuzhu_max_level', S.maxUnlockedLevel);
  } catch(e) {}
}

export function loadAllData() {
  try {
    var pd = wx.getStorageSync('zhuzhu_progress');
    if (pd) S.progress = pd;
    var ld = wx.getStorageSync('zhuzhu_lives');
    if (ld) S.livesData = ld;
    var bs = wx.getStorageSync('zhuzhu_best_score');
    if (bs !== '' && bs !== undefined) S.bestScore = bs;
    var ml = wx.getStorageSync('zhuzhu_max_level');
    if (ml) S.maxUnlockedLevel = ml;
  } catch(e) {}
}

export function loadUserProfile() {
  try {
    var d = wx.getStorageSync('zhuzhu_user_profile');
    if (d) S.userProfile = d;
  } catch(e) {}
}

export function saveUserProfile() {
  try {
    wx.setStorageSync('zhuzhu_user_profile', S.userProfile);
  } catch(e) {}
}

export function loadCheckinData() {
  try { var d = wx.getStorageSync('zhuzhu_checkin'); if (d) S.checkinData = d; } catch(e) {}
}

export function saveCheckinData() {
  try { wx.setStorageSync('zhuzhu_checkin', S.checkinData); } catch(e) {}
}

export function loadAllState() {
  loadAllData();
  // 加载宝物数据
  try {
    var td = wx.getStorageSync('zhuzhu_treasure_data');
    if (td) S.treasureData = td;
  } catch(e) {}
  // 加载道具库存
  try {
    var pd2 = wx.getStorageSync('zhuzhu_props');
    if (pd2) S.zhuzhuProps = pd2;
  } catch(e) {}
  // 加载签到
  loadCheckinData();
  // 加载用户头像昵称
  loadUserProfile();
  // 加载勋章状态
  try {
    var sbd = wx.getStorageSync('zhuzhu_seen_badges');
    if (sbd) S.seenBadges = sbd;
    var smr = wx.getStorageSync('zhuzhu_seen_marbles');
    if (smr) S.seenMarbles = smr;
    var ssc = wx.getStorageSync('zhuzhu_seen_scenes');
    if (ssc) S.seenScenes = ssc;
    var bdt = wx.getStorageSync('zhuzhu_badge_dates');
    if (bdt) S.badgeDates = bdt;
  } catch(e) {}
  // 加载免打扰
  try {
    var qm = wx.getStorageSync('zhuzhu_quiet_mode');
    if (qm !== undefined && qm !== '') S.quietMode = qm;
  } catch(e) {}
  // 加载用户偏好
  try {
    var up = wx.getStorageSync('zhuzhu_user_prefs');
    if (up) {
      if (typeof up.musicOn === 'boolean') { S.musicOn = up.musicOn; S._savedMusicOn = up.musicOn; }
      if (typeof up.sfxOn === 'boolean') S.sfxOn = up.sfxOn;
    }
  } catch(e) {}
}

export function saveAllState() {
  saveAllData();
  try { wx.setStorageSync('zhuzhu_treasure_data', S.treasureData); } catch(e) {}
  try { wx.setStorageSync('zhuzhu_props', S.zhuzhuProps); } catch(e) {}
  saveCheckinData();
  try { wx.setStorageSync('zhuzhu_seen_badges', S.seenBadges); } catch(e) {}
  try { wx.setStorageSync('zhuzhu_seen_marbles', S.seenMarbles); } catch(e) {}
  try { wx.setStorageSync('zhuzhu_seen_scenes', S.seenScenes); } catch(e) {}
  try { wx.setStorageSync('zhuzhu_badge_dates', S.badgeDates); } catch(e) {}
  try { wx.setStorageSync('zhuzhu_quiet_mode', S.quietMode); } catch(e) {}
  try {
    wx.setStorageSync('zhuzhu_user_prefs', { musicOn: S.musicOn, sfxOn: S.sfxOn });
  } catch(e) {}
}
