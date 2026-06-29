// ============================================================
// 珠珠快跑 — 云函数调用封装
// 提取自 game.js
// ============================================================

import { S } from '../state.js';

export function submitScoreToCloud() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) return;
  try {
    wx.cloud.callFunction({
      name: 'rank',
      data: {
        action: 'submitScore',
        score: S.bestScore,
        nickname: S.userProfile.nickname || '',
        avatarUrl: S.userProfile.avatar || '',
      },
      success: function(res) {
        if (res.result && res.result.success) {
          // 静默成功
        }
      },
      fail: function() {},
    });
  } catch(e) {}
}

export function fetchWorldRank(callback) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
    if (callback) callback(null);
    return;
  }
  try {
    wx.cloud.callFunction({
      name: 'rank',
      data: { action: 'getWorldRank', limit: 50 },
      success: function(res) {
        if (res.result && res.result.success) {
          S.rankData = (res.result.rankList || []).map(function(item, idx) {
            return {
              rank: idx + 1,
              nickname: item.nickname || '神秘玩家',
              avatarUrl: item.avatarUrl || '',
              score: item.score || 0,
            };
          });
          S.rankMyScore = res.result.myScore || S.bestScore;
          S.rankMyRank = res.result.myRank;
          S.rankTotalPlayers = res.result.totalPlayers || 0;
          if (callback) callback(S.rankData);
        } else {
          if (callback) callback(null);
        }
      },
      fail: function() { if (callback) callback(null); },
    });
  } catch(e) { if (callback) callback(null); }
}

export function fetchDailyRank(callback) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
    if (callback) callback(null);
    return;
  }
  try {
    wx.cloud.callFunction({
      name: 'rank',
      data: { action: 'getDailyRank', limit: 50 },
      success: function(res) {
        if (res.result && res.result.success) {
          S.rankData = (res.result.rankList || []).map(function(item, idx) {
            return {
              rank: idx + 1,
              nickname: item.nickname || '神秘玩家',
              avatarUrl: item.avatarUrl || '',
              score: item.score || 0,
            };
          });
          S.rankMyScore = res.result.myScore || 0;
          S.rankMyRank = res.result.myRank;
          if (callback) callback(S.rankData);
        } else {
          if (callback) callback(null);
        }
      },
      fail: function() { if (callback) callback(null); },
    });
  } catch(e) { if (callback) callback(null); }
}
