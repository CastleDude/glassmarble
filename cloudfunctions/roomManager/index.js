const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { action, roomId, playerData } = event;
    const wxContext = cloud.getWXContext();
    const myOpenid = wxContext.OPENID;
    if (!myOpenid) return { ok: false, msg: 'no openid' };

    const rooms = db.collection('multi_rooms');

    if (action === 'create') {
      const rid = 'r_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      const room = {
        roomId: rid,
        hostOpenid: myOpenid,
        status: 'waiting',
        players: [{
          openid: myOpenid,
          name: (playerData && playerData.name) || '玩家',
          order: 0,
          alive: true,
          skin: 'classic_blue'
        }],
        createTime: Date.now(),
        updateTime: Date.now()
      };
      var addRes = await rooms.add({ data: room });
      return { ok: true, roomId: rid, room: room, _id: addRes._id };
    }

    if (action === 'join') {
      var res = await rooms.where({ roomId: roomId }).get();
      if (res.data.length === 0) return { ok: false, msg: '房间不存在' };
      var room = res.data[0];
      if (room.status !== 'waiting') return { ok: false, msg: '游戏已开始' };
      if (room.players.length >= 5) return { ok: false, msg: '房间已满' };
      if (room.players.find(function(p) { return p.openid === myOpenid; })) {
        return { ok: true, roomId: roomId, room: room, alreadyIn: true };
      }
      room.players.push({
        openid: myOpenid,
        name: (playerData && playerData.name) || ('玩家' + (room.players.length + 1)),
        order: room.players.length,
        alive: true,
        skin: 'classic_green'
      });
      await rooms.doc(res.data[0]._id).update({ data: { players: room.players, updateTime: Date.now() } });
      return { ok: true, roomId: roomId, room: room };
    }

    if (action === 'get') {
      var res = await rooms.where({ roomId: roomId }).get();
      if (res.data.length === 0) return { ok: false, msg: '房间不存在' };
      return { ok: true, room: res.data[0] };
    }

    if (action === 'updateGame') {
      var res = await rooms.where({ roomId: roomId }).get();
      if (res.data.length === 0) return { ok: false };
      // playerInput 单独字段，写得更快
      var updateData = { gameData: event.gameData, updateTime: Date.now() };
      if (event.gameData && event.gameData.playerInput) {
        updateData.playerInput = event.gameData.playerInput;
      }
      await rooms.doc(res.data[0]._id).update({ data: updateData });
      return { ok: true };
    }

    if (action === 'start') {
      var res = await rooms.where({ roomId: roomId }).get();
      if (res.data.length === 0) return { ok: false, msg: '房间不存在' };
      var room = res.data[0];
      if (room.players.length < 1) return { ok: false, msg: '人数不足' };
      for (var i = room.players.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = room.players[i]; room.players[i] = room.players[j]; room.players[j] = tmp;
      }
      for (var k = 0; k < room.players.length; k++) {
        room.players[k].order = k;
      }
      await rooms.doc(res.data[0]._id).update({ data: { status: 'playing', players: room.players, updateTime: Date.now() } });
      return { ok: true, room: room };
    }

    return { ok: false, msg: 'unknown: ' + action };
  } catch (e) {
    return { ok: false, msg: 'err: ' + (e.message || String(e)).substring(0, 100) };
  }
};
