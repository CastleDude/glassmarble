// ============================================================
const sharedCanvas = wx.getSharedCanvas();
const ctx = sharedCanvas.getContext('2d');
function W() { return sharedCanvas.width; }
function H() { return sharedCanvas.height; }

let rankList = [];
let myScore = 0;
let visible = false;
let myRank = -1;
let authFailed = false;
let scrollY = 0;
let avatarImgs = {};

wx.onMessage(data => {
  if (data.type === 'showFriendRank') {
    myScore = data.score || 0;
    visible = true; scrollY = 0;
    if (!authFailed) loadFriendRank();
  } else if (data.type === 'scrollFriend') {
    scrollY += data.delta || 0;
    var maxS = Math.max(0, rankList.length * 64 - H() + 20);
    if (scrollY < 0) scrollY = 0;
    if (scrollY > maxS) scrollY = maxS;
    if (visible) renderRankList();
  } else if (data.type === 'redraw') {
    if (visible) { if (rankList.length > 0) renderRankList(); else renderEmptyState(); }
  } else if (data.type === 'hide') {
    visible = false; clearCanvas();
  }
});

function loadFriendRank() {
  wx.setUserCloudStorage({ KVDataList: [{ key: 'score', value: String(myScore) }, { key: 'updateTime', value: String(Date.now()) }] });
  wx.getFriendCloudStorage({
    keyList: ['score', 'avatarUrl'],
    success: res => {
      authFailed = false;
      rankList = (res.data || []).map(item => ({
        nickname: item.nickname || '未知玩家',
        avatarUrl: item.avatarUrl || '',
        score: parseInt((item.KVDataList || []).find(kv => kv.key === 'score')?.value) || 0
      })).sort((a, b) => b.score - a.score);
      rankList.forEach(function(item) {
        if (item.avatarUrl && !avatarImgs[item.avatarUrl]) {
          var ai = wx.createImage();
          ai.src = item.avatarUrl;
          ai.onload = function() { avatarImgs[item.avatarUrl] = ai; };
        }
      });
      myRank = rankList.findIndex(r => r.score === myScore);
      if (myRank === -1) myRank = rankList.length;
      renderRankList();
    },
    fail: () => { rankList = []; renderEmptyState('好友数据加载失败'); }
  });
}

var avatarColors = ['#ED971C','#5b9bd5','#7a9e5e','#c4a462','#8b4fa3','#d87080','#4d9e96','#c43828'];

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function renderRankList() {
  if (!visible) return;
  var w = W(), h = H();
  ctx.clearRect(0, 0, w, h);

  var itemH = 64;
  var startY = 4 - scrollY;

  for (var ri = 0; ri < rankList.length; ri++) {
    var d = rankList[ri];
    var ry = startY + ri * itemH;
    if (ry + itemH < 0 || ry > h) continue;

    if (ri % 2 === 0) {
      ctx.fillStyle = 'rgba(237,151,28,0.10)';
      ctx.fillRect(2, ry, w - 4, itemH);
    }

    // 排名
    ctx.textAlign = 'center';
    if (ri < 3) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '22px sans-serif';
      ctx.fillText(['🥇','🥈','🥉'][ri], 28, ry + 42);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(ri + 1, 28, ry + 42);
    }

    // 头像 36x36圆角方形
    var avaSz = 36, ax3 = 52, ay3 = ry + 14;
    var avaImg = d.avatarUrl ? avatarImgs[d.avatarUrl] : null;
    if (avaImg && avaImg.width) {
      ctx.save();
      roundRect(ax3, ay3, avaSz, avaSz, 8);
      ctx.clip();
      ctx.drawImage(avaImg, ax3, ay3, avaSz, avaSz);
      ctx.restore();
    } else {
      ctx.fillStyle = avatarColors[ri % avatarColors.length];
      roundRect(ax3, ay3, avaSz, avaSz, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.nickname.charAt(0), ax3 + avaSz/2, ay3 + avaSz/2 + 4);
    }

    // 昵称
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'left';
    var name = d.nickname.length > 7 ? d.nickname.substring(0, 6) + '…' : d.nickname;
    ctx.fillText(name, ax3 + avaSz + 12, ry + 42);

    // 分数
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(d.score, w - 16, ry + 42);
  }
}

function renderEmptyState(msg) {
  var w = W(), h = H();
  ctx.clearRect(0, 0, w, h);
  ctx.font = '36px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏆', w / 2, h * 0.35);
  ctx.fillStyle = '#999';
  ctx.font = '13px sans-serif';
  ctx.fillText(msg || '还没有好友玩过', w / 2, h * 0.55);
}

function clearCanvas() { ctx.clearRect(0, 0, W(), H()); }
