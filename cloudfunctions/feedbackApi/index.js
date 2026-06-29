// 珠珠冲呀 — 反馈API云函数（保留兼容）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;
  if (action === 'list') {
    const res = await db.collection('feedback').orderBy('createTime', 'desc').limit(50).get();
    return { success: true, data: res.data };
  }
  return { success: false, msg: 'unknown action' };
};
