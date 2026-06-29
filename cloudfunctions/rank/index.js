// ============================================================
// 珠珠快跑 — 世界排行榜云函数
// ============================================================
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action } = event;

  switch (action) {

    // ========== 提交分数 ==========
    case 'submitScore': {
      const { score, nickname, avatarUrl } = event;
      const today = getDateString(new Date());

      // 查询已有记录
      const exist = await db.collection('scores')
        .where({ _openid: OPENID })
        .get();

      if (exist.data.length > 0) {
        // 已有记录
        const oldRecord = exist.data[0];
        const oldScore = oldRecord.score;
        const isNewDay = oldRecord.dailyDate !== today;

        const updateData = {};

        // 新分数更高时更新总分
        if (score > oldScore) {
          updateData.score = score;
        }

        // 每日分数：跨天重置，同天取最高
        if (isNewDay) {
          updateData.dailyScore = score;
          updateData.dailyDate = today;
        } else if (score > (oldRecord.dailyScore || 0)) {
          updateData.dailyScore = score;
        }

        // 昵称和头像有变化就更新
        if (nickname && nickname !== oldRecord.nickname) {
          updateData.nickname = nickname;
        }
        if (avatarUrl && avatarUrl !== oldRecord.avatarUrl) {
          updateData.avatarUrl = avatarUrl;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updateTime = db.serverDate();
          await db.collection('scores')
            .doc(oldRecord._id)
            .update({ data: updateData });
        }
      } else {
        // 新玩家
        await db.collection('scores').add({
          data: {
            _openid: OPENID,
            score: score,
            dailyScore: score,
            dailyDate: today,
            nickname: nickname || '',
            avatarUrl: avatarUrl || '',
            updateTime: db.serverDate()
          }
        });
      }

      // 计算排名
      const countResult = await db.collection('scores')
        .where({ score: db.command.gt(score) })
        .count();
      const myRank = countResult.total + 1;
      const totalPlayers = (await db.collection('scores').count()).total;

      return { success: true, myRank, totalPlayers };
    }

    // ========== 获取世界排行 ==========
    case 'getWorldRank': {
      const { limit = 50 } = event;

      // 取前 N 名
      const rankResult = await db.collection('scores')
        .orderBy('score', 'desc')
        .limit(limit)
        .get();

      // 查找当前玩家排名
      const myRecord = await db.collection('scores')
        .where({ _openid: OPENID })
        .get();

      let myRank = null;
      let myScore = 0;
      if (myRecord.data.length > 0) {
        myScore = myRecord.data[0].score;
        const countResult = await db.collection('scores')
          .where({ score: db.command.gt(myRecord.data[0].score) })
          .count();
        myRank = countResult.total + 1;
      }

      const totalPlayers = (await db.collection('scores').count()).total;

      return {
        success: true,
        rankList: rankResult.data.map((item, index) => ({
          rank: index + 1,
          nickname: item.nickname || '神秘玩家',
          avatarUrl: item.avatarUrl || '',
          score: item.score,
        })),
        myRank,
        myScore,
        totalPlayers,
      };
    }

    // ========== 获取每日排行 ==========
    case 'getDailyRank': {
      const { limit = 50 } = event;
      const today = getDateString(new Date());

      const rankResult = await db.collection('scores')
        .where({ dailyDate: today, dailyScore: db.command.gt(0) })
        .orderBy('dailyScore', 'desc')
        .limit(limit)
        .get();

      const myRecord = await db.collection('scores')
        .where({ _openid: OPENID })
        .get();

      let myRank = null, myScore = 0;
      if (myRecord.data.length > 0 && myRecord.data[0].dailyDate === today) {
        myScore = myRecord.data[0].dailyScore || 0;
        const countResult = await db.collection('scores')
          .where({ dailyDate: today, dailyScore: db.command.gt(myScore) })
          .count();
        myRank = countResult.total + 1;
      }

      return {
        success: true,
        rankList: rankResult.data.map((item, index) => ({
          rank: index + 1,
          nickname: item.nickname || '神秘玩家',
          avatarUrl: item.avatarUrl || '',
          score: item.dailyScore || 0,
        })),
        myRank, myScore
      };
    }

    // ========== 提交反馈 ==========
    case 'submitFeedback': {
      const { text, contact, agree, time, images } = event;
      var imgUrls = [];
      if (images && images.length > 0) {
        var urlRes = await cloud.getTempFileURL({ fileList: images });
        if (urlRes.fileList) {
          urlRes.fileList.forEach(function(f) { if (f.tempFileURL) imgUrls.push(f.tempFileURL); });
        }
      }
      await db.collection('feedback').add({
        data: {
          _openid: OPENID,
          text: text || '',
          contact: contact || '',
          agree: !!agree,
          images: images || [],
          viewUrls: imgUrls,
          time: time || Date.now(),
          createTime: db.serverDate()
        }
      });
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown action' };
  }
};

function getDateString(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
