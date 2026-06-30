// ============================================================
// 珠珠快跑 — 微信小游戏入口
// 等距正交视角 + 蓄力滚动 + 入坑玩法
// ============================================================

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

// 云开发初始化
try { wx.cloud.init({ env: 'glassmarble-d2gvr9flw08836ddd' }); } catch(e) {}

// 云端图片加载
const sysInfo = wx.getSystemInfoSync();
const dpr = sysInfo.pixelRatio || 1;
const screenW = sysInfo.screenWidth;
const screenH = sysInfo.screenHeight;

canvas.width = screenW * dpr;
canvas.height = screenH * dpr;
ctx.scale(dpr, dpr);

// 逻辑画布：以屏幕实际宽度为基准
const SCALE = 1;
const W = screenW;
const H = screenH;

// 胶囊按钮位置
let capsuleRect = { left: W - 100, top: 30, width: 87, height: 32, right: W - 13 };
try {
  const cr = wx.getMenuButtonBoundingClientRect();
  if (cr) capsuleRect = cr;
} catch (e) { /* 降级默认值 */ }

// ============================================================
// 一、全局配置
// ============================================================
const CFG = {
  // 透视投影
  CAMERA_OFFSET: 0.0,         // 相机与珠珠同步

  // 珠珠
  MARBLE_RADIUS: 0.045,       // 世界半径

  // 蓄力
  CHARGE_RATE: 0.50,          // 蓄力速度 (约2秒满)
  MIN_SPEED: 0.35,            // 最小滚动速度（单位/秒）
  MAX_SPEED: 2.80,            // 最大滚动速度（单位/秒）

  // 物理（基于时间的连续模型）
  FRICTION: 1.4,              // 每秒速度衰减系数
  STOP_THRESHOLD: 0.04,       // 判定停止的速度阈值（单位/秒）
  ROLL_FACTOR: 2.3,           // 滚动角度系数

  // 坑
  PIT_SPACING_MIN: 4.0,       // 间距 = 坑直径 × (4~7倍随机，平方分布)
  PIT_SPACING_MAX: 7.0,
  PIT_RADIUS_MIN: 0.065,      // 坑半径（固定）
  PIT_RADIUS_MAX: 0.065,      // 坑半径（固定）
  HIT_TOLERANCE: 1.50,        // 弹珠中心距坑心 ≤ 坑半径×1.50 即入坑

  // 相机
  CAMERA_LERP_IDLE: 0.07,     // 静止时平滑系数
  CAMERA_LERP_ROLL: 0.15,     // 滚动时跟随更快

  // 动画
  SINK_DURATION: 1.2,         // 入坑动画总时长（滑入+暂停+跳出）
  RESPAWN_DURATION: 0.20,     // 重生出现时长
};

// ============================================================
// 二、游戏状态
// ============================================================
const STATE = {
  HOME: 'home',
  INTRO: 'intro',
  IDLE: 'idle',
  CHARGING: 'charging',
  ROLLING: 'rolling',
  SINKING: 'sinking',
  RESPAWN: 'respawn',
  GAMEOVER: 'gameover',
  LOST: 'lost',
  WIN: 'win',
  SKIN: 'skin',
  SETTINGS: 'settings',
  CONFIRM: 'confirm',
  RANK: 'rank',
  BADGES: 'badges',   // 成就勋章
  CLASSIC: 'classic', // 经典模式
  STORY: 'story',     // 故事回顾
  FEEDBACK: 'feedback', // 意见反馈
  CHECKIN: 'checkin',   // 每日签到
  TREASURE: 'treasure', // 宝箱
  LEVELSEL: 'levelsel', // 关卡选择
};

let gameState = STATE.HOME;
let gameMode = 'endless';  // 'endless' | 'levels' | 'classic'
let currentLevel = 1;
let maxUnlockedLevel = 1; // 最高解锁关卡（不受选择影响）
let openDataContext = null; // 开放数据域（好友排行）

// ============================================================
// 经典模式数据
// ============================================================
const CLASSIC_PHASE = {
  MODE_SELECT: 'modeSelect',
  INTRO: 'intro',
  SERVING: 'serving',
  ROLLING: 'rolling',
  TARGET_SELECT: 'targetSelect',
  AIMING: 'aiming',
  GAMEOVER: 'gameover',
};

const CLASSIC_PIT_COUNT = 3;
const CLASSIC_PIT_SPACING = 1.0;    // 坑间距1米
const CLASSIC_START_DIST = 1.0;     // 出发线距坑1下方1米→满蓄力刚好到
const CLASSIC_SAME_DIST_THRESH = 0.03; // 等距判定阈值
const CLASSIC_MARBLE_R = 0.056;     // 经典模式弹珠半径
const CLASSIC_PIT_VISUAL_R = 0.1;   // 经典模式坑背景视觉半径

let classicData = null;
let classicShowModeSelect = false; // 首页弹出模式选择

// === 微信用户头像昵称 ===
var userProfile = { nickname: '', avatar: '' }; // avatar为base64或本地路径
var _userInfoBtn = null; // 原生授权按钮
var _authInProgress = false; // 授权进行中，防止重复创建按钮

function loadUserProfile() {
  try {
    var up = wx.getStorageSync('zhuzhu_user_profile');
    if (up) { userProfile.nickname = up.nickname || ''; userProfile.avatar = up.avatar || ''; }
  } catch(e) {}
}
function saveUserProfile() {
  try { wx.setStorageSync('zhuzhu_user_profile', { nickname: userProfile.nickname, avatar: userProfile.avatar }); } catch(e) {}
}

// 保存头像到userProfile（先存原始URL立即回调，再异步转base64）
function _saveAvatarInfo(nickName, avatarUrl, onDone) {
  userProfile.nickname = nickName || '';
  // 先存原始URL，确保头像立即可用
  userProfile.avatar = avatarUrl || '';
  // 清除旧缓存，下次渲染时重新加载
  userProfile._avatarImg = null;
  saveUserProfile();
  submitScoreToCloud(); // 授权后重传最高分，更新云端昵称头像
  if (onDone) onDone();
  // 后台异步转base64（静默，不影响交互）
  if (avatarUrl) {
    wx.getImageInfo({
      src: avatarUrl,
      success: function(imgRes) {
        try {
          var fs = wx.getFileSystemManager();
          var b64 = fs.readFileSync(imgRes.path, 'base64');
          var ext = (imgRes.type || 'jpg') === 'jpeg' ? 'jpg' : (imgRes.type || 'jpg');
          userProfile.avatar = 'data:image/' + ext + ';base64,' + b64;
          userProfile._avatarImg = null; // 触发重新加载
          saveUserProfile();
        } catch(e) {}
      },
      fail: function() {}
    });
  }
}

// 静默获取用户信息（wx.getSetting + wx.getUserInfo）
// 成功时调用 onSuccess()，失败时调用 onNeedAuth()（需要手动授权）
function trySilentAuth(onSuccess, onNeedAuth) {
  if (typeof wx === 'undefined' || !wx.getSetting) {
    if (onNeedAuth) onNeedAuth();
    return;
  }
  wx.getSetting({
    success: function(settingRes) {
      if (settingRes.authSetting['scope.userInfo'] === true) {
        // 已授权，静默获取
        wx.getUserInfo({
          success: function(infoRes) {
            var info = infoRes.userInfo;
            _saveAvatarInfo(info.nickName, info.avatarUrl, onSuccess);
          },
          fail: function() {
            // getUserInfo 失败，需要手动授权
            if (onNeedAuth) onNeedAuth();
          }
        });
      } else {
        // 未授权
        if (onNeedAuth) onNeedAuth();
      }
    },
    fail: function() {
      if (onNeedAuth) onNeedAuth();
    }
  });
}

// 创建原生授权按钮
// opts: { fullScreen, onSuccess, onDecline }
function showUserInfoButton(opts) {
  if (typeof wx === 'undefined' || !wx.createUserInfoButton) return;
  if (_authInProgress) return;
  hideUserInfoButton();
  _authInProgress = true;
  try {
    var isFull = opts && opts.fullScreen;
    var sysInfo = wx.getSystemInfoSync();
    var btnStyle;
    if (isFull) {
      btnStyle = {
        left: 0, top: 0,
        width: sysInfo.screenWidth, height: sysInfo.screenHeight,
        backgroundColor: 'rgba(0,0,0,0.05)',
        color: 'rgba(255,255,255,0.05)',
        fontSize: 20, textAlign: 'center',
        lineHeight: sysInfo.screenHeight
      };
    } else {
      btnStyle = {
        left: 30, top: sysInfo.screenHeight * 0.4, width: sysInfo.screenWidth - 60, height: 48,
        lineHeight: 48, backgroundColor: '#07C160', color: '#fff',
        fontSize: 16, borderRadius: 8, textAlign: 'center'
      };
    }
    var btn = wx.createUserInfoButton({
      type: 'text',
      text: isFull ? '·' : '获取微信头像昵称',
      style: btnStyle
    });
    btn.onTap(function(res) {
      var userInfo = res.userInfo;
      if (!userInfo && res.rawData) {
        try { userInfo = JSON.parse(res.rawData); } catch(e) {}
      }
      if (userInfo) {
        _saveAvatarInfo(userInfo.nickName, userInfo.avatarUrl, function() {
          hideUserInfoButton();
          _authInProgress = false;
          if (opts && opts.onSuccess) opts.onSuccess();
        });
      } else {
        hideUserInfoButton();
        _authInProgress = false;
        if (opts && opts.onDecline) opts.onDecline();
      }
    });
    _userInfoBtn = btn;
  } catch(e) {
    _authInProgress = false;
    console.error('[auth] createUserInfoButton err:', e);
  }
}

function hideUserInfoButton() {
  if (_userInfoBtn) { try { _userInfoBtn.destroy(); } catch(e) {} _userInfoBtn = null; }
}

// 请求授权：先静默尝试，失败则弹按钮
// opts: { fullScreen, onSuccess, onDecline }
function requestUserAuth(opts) {
  if (_authInProgress) return; // 授权进行中，不重复请求
  trySilentAuth(
    // 静默成功
    function() {
      if (opts && opts.onSuccess) opts.onSuccess();
    },
    // 需要手动授权 → 弹按钮
    function() {
      showUserInfoButton(opts);
    }
  );
}

// 获取经典模式玩家显示名称
function classicPlayerName(idx) {
  var cd = classicData;
  if (idx === 0) return '你';
  if (cd && cd.players[idx] && cd.players[idx].name && cd._multiMode === 'game') return cd.players[idx].name;
  return '小迪';
}

function resetClassicData() {
  classicData = {
    phase: CLASSIC_PHASE.INTRO,
    players: [
      { name: userProfile.nickname || '玩家', avatar: userProfile.avatar || '', skin: 'classic_blue', order: 0, tiger: false, alive: true, locked: true, pitProgress: [], ballX: 0.5, ballY: 0, ballVX: 0, ballVY: 0, ballRotation: 0, ballTexOffX: 0, ballTexOffY: 0, ballScale: 1, distToPit1: 0 },
      { name: '小迪', avatar: '', skin: 'classic_green', order: 1, tiger: false, alive: true, locked: true, pitProgress: [], ballX: 0.5, ballY: 0, ballVX: 0, ballVY: 0, ballRotation: 0, ballTexOffX: 0, ballTexOffY: 0, ballScale: 1, distToPit1: 0 },
    ],
    currentPlayer: 0,
    pits: [],
    chargePower: 0,
    chargeDir: 1,
    aimingAngle: -Math.PI / 2,
    selectedTarget: null,
    targetOptions: [],
    winner: -1,
    serveOrder: [0, 1],
    serveCount: 0,        // 已弹球人数
    serveDist1: [],        // 两球离坑1的距离
    bothServed: false,
    hintText: '',
    hintTimer: 0,
    ballInPit: null,
    tigerBallPlayer: -1,
    cameraTargetX: 0.5,
    cameraTargetY: 0,
    cameraZoom: 1.0,
    animTimer: 0,
    aiDelayTimer: 0,
    chargeStartTime: 0,
    btnPressed: false,
    touchId: -1,
    introAnimTimer: 0,
    showRules: false,     // 规则弹窗
    _draggingJoy: false,  // 正在拖动方向盘
    _draggingGround: false, // 拖地中
    _pinchActive: false,  // 双指缩放中
    _ruleScroll: 0,       // 规则弹窗滚动
    _ruleTouchY: 0,       // 规则弹窗触摸Y
    _ruleDragStart: 0,    // 规则弹窗拖动起始
    _draggingRule: false, // 规则弹窗拖动中
    _viewToggle: false,   // 视角切换：false=跟球，true=全景
    _viewManual: false,   // 是否手动切换过视角
    _pitSuck: false,      // 引力吸入坑中
    _pitSuckPit: null,
    _pitSuckPlayer: -1,
    _pitSuckTimer: 0,
    _pitSuckFromScale: 1,
    _pitRollback: false,    // 回滚到坑心
    _pitRollbackPlayer: -1,
    _pitRollbackFromX: 0, _pitRollbackFromY: 0,
    _pitRollbackFromScale: 1,
    _pitRollbackToX: 0, _pitRollbackToY: 0,
    _pitRollbackTimer: 0,
    _countdown: 0,          // 倒计时秒数（0=不显示）
    _countdownTimer: 0,     // 倒计时计时器
    _countdownNext: null,   // 倒计时结束后执行的动作
    _countdownHint: '',     // 倒计时下方提示文字
    _focusTimer: 0,         // 聚焦延时计时（0=不触发）
    _winDelay: 0,           // 获胜延迟计时（0=未触发）
    _winSfx: '',            // 延迟播放的音效
    _fireworkDelay: 0,      // 烟花延迟计时
    _fireworks: [],         // 烟花粒子
    _multiMode: null,       // 多人模式：null=人机, 'lobby'=等待, 'game'=游戏中
    _multiPlayers: [],      // 多人玩家列表
    _multiRoomId: '',       // 多人房间ID
    _multiPollTimer: 0,     // 房间轮询计时器
    _multiIsHost: false,    // 是否房主
    _multiMyIndex: 0,       // 我在players中的索引
    _multiSyncTimer: 0,     // 同步计时器
    _multiWatcher: null,    // 实时监听器
    _multiInput: null,      // 远程玩家输入数据
    _myTurnRemote: false,   // 是否轮到自己（远程玩家）
    _multiNotified: false,  // 是否已通知远程玩家
    _multiShot: false,      // 远程玩家是否已发射
    _collisionTimer: 0,   // 碰撞冷却计时
    _hitOpponent: false,  // 本轮是否击中过对手球
    _pinchDist: 0,        // 初始双指距离
    _pinchZoom: 1,        // 缩放起始值
    _camX: 0, _camY: 0, _camZoom: 1, // 相机插值状态
  };
}

// 闯关模式配置
const LEVEL_TARGETS = [0, 10, 30, 60, 100, 150, 210, 280, 360, 500];
const LEVEL_SCENES = ['', 'grandma_backyard', 'school_sandpit', 'after_rain_mud', 'river_pebbles', 'old_locust_tree', 'summer_threshing', 'winter_snow', 'memory_lane', 'eternal_childhood'];
const LEVEL_NAMES = ['', '外婆的后院', '学校的沙坑', '雨后的泥地', '河边的卵石滩', '老槐树下', '夏日傍晚的晒谷场', '初雪的院子', '回忆的小巷', '永远的童年'];
const LEVEL_STORIES = [
  '',
  {
    title: '外婆的后院',
    pages: [
      '记忆里的夏天总是很长\n外婆坐在堂屋门槛上摇着蒲扇\n一下 一下\n像时钟在数着午后的光',
      '我蹲在她身后的泥地上\n用手指挖出了人生中第一个坑\n泥土是温热的\n带着太阳晒过的味道',
      '那颗天蓝色的玻璃珠\n是外婆从镇上赶集时给我买的\n五毛钱 她说：\n可以换你一个下午的快乐',
      '我把珠珠放在坑边\n轻轻一推 ——\n它滚进去了\n发出"嗒"的一声脆响\n那一刻\n连树上的知了都安静了',
      '外婆回头看了我一眼\n笑了笑 什么也没说\n很多年以后我才明白\n她摇扇子的节奏\n就是童年远去的倒计时',
      '外婆，我想你了！',
    ]
  },
  {
    title: '学校的沙坑',
    pages: [
      '放学铃是世界上最动听的声音\n老师还没说完 下课\n我们的心已经飞到了\n操场角落的沙坑里',
      '那里是只属于孩子的领土\n沙子里偶尔能挖出\n不知谁丢的半截橡皮\n一颗生了锈的图钉\n每一件都是考古发现',
      '小明有一颗天蓝色的弹珠\n他说那是他爷爷小时候玩的\n我们都不信\n但他护得比命还紧',
      '多年后的同学会上\n小明已经不叫小明了\n他西装革履\n聊着房价和股票\n我问他那颗弹珠还在吗\n他愣了一下\n眼眶突然就红了',
      '有些东西丢了就找不回来了\n不是弹珠\n是那个一放学就奔向沙坑的自己',
    ]
  },
  {
    title: '雨后的泥地',
    pages: [
      '城里的雨后只有堵车和外卖迟到\n但在小时候的村子里\n一场暴雨过后\n整个世界都是新的',
      '空气被洗得干干净净\n混着泥土和青草的味道\n那是世界上最好闻的香水\n不花钱 但后来再也没闻到过',
      '我们赤着脚踩在泥里\n凉凉的、软软的\n脚趾间挤出一坨坨泥巴\n大人在屋里喊别感冒了\n我们假装听不见',
      '泥地里的坑最好挖\n但珠珠也最容易脏\n每进一个坑\n就要在旁边的水洼里洗一洗\n洗着洗着\n就开始打水仗了',
      '那时候快乐很简单 ——\n一场雨\n一块泥地\n一颗珠子\n就能撑起一整个下午\n后来我们有了很多东西\n但好像再也没有\n一个那样的下午了',
    ]
  },
  {
    title: '河边的卵石滩',
    pages: [
      '小河的南岸有一片卵石滩\n每一块石头都被流水打磨了不知多少年\n光脚踩上去\n石头硌得脚底又疼又痒\n但我们从来不在乎',
      '在这儿挖坑要先搬石头\n像在开荒\n我们用卵石围成圆圈\n比任何人工的球场都好看\n河水就在旁边哗哗地流\n像永远不会停的时间',
      '有一次我的珠珠滚进了河里\n我沿着河岸追了好远好远\n最后还是没追上\n我坐在石滩上哭\n觉得天都塌了',
      '现在想想\n那条河其实很浅\n浅到大人能一步跨过去\n但在那个年纪\n失去一颗弹珠\n就是人生最大的悲剧',
      '我们也曾像河里的石头\n被时间冲刷\n被磨去棱角\n但那些圆润光滑的记忆\n反而成了最珍贵的',
    ]
  },
  {
    title: '老槐树下',
    pages: [
      '村口的槐树不知道多少岁了\n爷爷说他小时候就在\n爷爷的爷爷小时候也在\n树皮皴裂得像老人的手背\n但每年春天还是会开出新的花',
      '树荫大得能装下十几个小孩\n我们在树根之间挖坑\n树根隆起来的地方\n就是天然的障碍\n有时候蚂蚁排着队路过\n我们就停下来看\n一等就是半天',
      '有一回我在树下捡到一颗珠子\n不是玻璃的是石头磨的\n爷爷说那是他小时候玩的\n那时候买不起玻璃珠\n就在河滩上找圆的石头\n他说这话的时候\n眼睛里有一种我从没见过的光',
      '后来我才明白\n那道光叫"回不去的时光"\n槐树还在\n但树下玩弹珠的孩子\n换了一拨又一拨\n树是永恒的\n童年是借来的',
    ]
  },
  {
    title: '夏日傍晚的晒谷场',
    pages: [
      '生产队的晒谷场\n白天是属于稻谷的\n只有到了傍晚\n稻谷收进麻袋\n水泥地才空出来\n变成我们的王国',
      '地面被太阳晒了一整天\n踩上去还带着微微的热气\n那种热从脚底板传上来\n一直暖到心里\n后来我在城里住过地暖的房子\n但再也找不到那种\n从下往上、从外到内的温度了',
      '夕阳把一切都染成了金色\n金色的水泥地\n金色的玻璃珠\n金色的笑脸\n我们在地上滚弹珠\n影子被拉得老长老长',
      '不知道从哪一天起\n晒谷场变成了停车场\n水泥地还在\n但没有稻谷的香味了\n也没有小孩趴在地上玩弹珠了\n时代就是这样\n悄无声息地把我们的乐园\n一个接一个地收走',
    ]
  },
  {
    title: '初雪的院子',
    pages: [
      '那年的第一场雪来得很突然\n早上推开门\n整个世界都白了\n院子里那棵枣树的枝丫上\n堆着一层蓬松的白',
      '雪地里的弹珠最好看\n蓝色玻璃珠在白雪上滚过\n留下一道细细的痕迹\n像在纸上画了一条\n歪歪扭扭的线',
      '但是雪地挖坑太难了\n手指冻得通红\n外婆从屋里出来\n给我戴上她的毛线手套\n手套太大了\n指尖空出一截\n但暖和得让人想哭',
      '外婆说：别急 慢慢挖\n这句话我记了很多年\n后来我在很多事情上着急\n考试、工作、买房、结婚\n但每当我想起外婆戴着老花镜\n给我织手套的样子\n就会想起那句话：\n别急 慢慢来',
      '外婆走了很多年了\n但每年冬天下第一场雪的时候\n我都会想起她\n雪会融化\n但那份温暖不会',
    ]
  },
  {
    title: '回忆的小巷',
    pages: [
      '老街要拆了\n推土机停在巷口\n像一只等着吞噬记忆的怪兽\n我赶在拆迁前回去了一趟',
      '青石板路还在\n被几十年的脚步磨得发亮\n两边的墙上还留着\n我们当年用粉笔画的小人和箭头\n墙角下\n那个我们挖过无数弹珠坑的地方\n长了一层薄薄的青苔',
      '巷子深处\n王爷爷还坐在门口剥毛豆\n他已经老得认不出我了\n但他看到我手里拿着的弹珠时\n突然说：\n我这里也有一颗\n在抽屉里放了六十年',
      '他颤颤巍巍地进屋\n拿出一个铁盒子\n里面有一颗灰扑扑的弹珠\n和一张泛黄的奖状\n这是我小时候打弹珠比赛赢的\n一直舍不得扔',
      '我握着那颗六十年前的弹珠\n突然觉得它好重\n那不是一颗珠子\n是一个人全部的童年\n老街会拆\n但有些东西\n永远不该被推平',
    ]
  },
  {
    title: '永远的童年',
    pages: [
      '我今年三十岁了\n在城市的写字楼里上班\n每天挤地铁\n喝咖啡\n开没完没了的会',
      '有一天清理旧物\n从箱底翻出一个铁盒子\n打开一看 ——\n几颗弹珠\n静静地躺在里面\n蓝色的、绿色的、透明的\n像被封存的宝石',
      '我拿起一颗对着光看\n里面有细微的气泡\n小时候从没发现过\n原来玻璃珠的心里\n也藏着不完美',
      '我忽然意识到\n我已经很多年没有\n蹲在地上认真地做一件事了\n不是工作\n不是赚钱\n就是单纯地\n不带任何目的地\n做一件让自己快乐的事',
      '于是我带着三岁的儿子\n回到外婆的老房子\n院子已经荒了\n但土地还在\n我在当年的位置\n又挖了一个坑\n儿子开心地把弹珠滚了进去',
      '"嗒"的一声\n和三十年前一模一样\n世界是一个圆\n我们从起点出发\n兜兜转转\n又回到了原点\n童年从来没有离开过\n它只是在等我们\n有时间回头',
    ]
  },
];
let chargePower = 0;           // 0 ~ 1
let score = 0;                 // 连续入坑数
let bestScore = 0;             // 最高纪录
let comboCount = 0;            // 当前连续入坑
let sessionBestCombo = 0;      // 当局最高连击
let animTimer = 0;             // 动画计时器

// 进度数据
let progress = {
  totalPits: 0,
  bestCombo: 0,
  centerHits: 0,
  loginDays: 0,
  lastLoginDate: '',
  unlockedMarbles: ['classic_blue'],
  equippedMarble: 'classic_blue',
  unlockedScenes: ['grandma_backyard'],
  equippedScene: 'grandma_backyard',
  unlockedBadges: [],
  unlockedTitles: [],
  titleDates: {},     // 称号获得日期 { titleId: timestamp }
  equippedTitle: '',
};

// 生命数据
let livesData = {
  lives: 3,
  lastResetDate: '',
  dailyPits: 0,
  dailyBestCombo: 0,
  sharesToday: 0,
  adsToday: 0,
};

// ============================================================
// 三、世界实体
// ============================================================
// 珠珠 (世界坐标)
let marble = {
  worldX: -0.3,     // 左下角屏幕外
  worldY: -0.6,     // 左下角屏幕外
  vx: 2.0, vy: 1.5,  // 初速度：自然滚到中心
  radius: CFG.MARBLE_RADIUS,
  rotation: 0,
  scale: 1,
  alpha: 1,
  sinkY: 0,
  texOffX: 60,  // 初始偏移50%
  _jumpPropAnim: false, _jumpSfxPlayed: false, _jumpFromX2: 0, _jumpFromY2: 0, _jumpToX: 0, _jumpToY: 0, _jumpTargetPit: -1, _jumpTargetPit2: -1, _rollingBack: false, _rollbackFromX: 0, _rollbackFromY: 0, _rollbackFromScale: 1, _rollbackToX: 0, _rollbackToY: 0, _rollbackPit: null, _rollbackTimer: 0,
  texOffY: 60,
};

// 坑数组 (动态生成)
let pits = [];
let currentPitIndex = 0;       // 上次入的坑 _index

// 相机
let camera = { worldX: 0, worldY: 0, targetX: 0, targetY: 0 };

// ============================================================
// 四、俯视投影（顶视角，无透视）
// ============================================================
function worldToScreen(worldX, worldY) {
  const relX = worldX - 0.5;
  const relY = worldY - camera.worldY;

  return {
    x: W / 2 + relX * W * 0.5,
    y: H * 0.70 - relY * H * 0.4,
    depth: relY,
    dScale: 1,   // 无缩放
  };
}

// ============================================================
// 五、坑系统
// ============================================================
let pitIdCounter = 0;

function createPit(worldX, worldY, radius) {
  return { worldX, worldY, radius, visited: false, _index: pitIdCounter++, alpha: 0, rotation: Math.random() * Math.PI * 2, hasTreasure: false, treasureId: null, hasFriendImg: false, friendImgIdx: -1 };
}

function spawnPitAt(worldX, worldY, radius) {
  pits.push(createPit(worldX, worldY, radius));
}

function spawnNextPit() {
  const lastPit = pits.length > 0 ? pits[pits.length - 1] : null;

  let worldX, worldY, radius;

  if (!lastPit) {
    // 第一个坑：在珠珠前方偏右
    worldX = 0.58 + Math.random() * 0.08;
    radius = CFG.PIT_RADIUS_MIN;
    var introEndY2 = -CFG.MARBLE_RADIUS;
    worldY = introEndY2 + radius * 2 * (3 + Math.random() * 1);  // 3~4倍直径
  } else {
    // 方向随机变化（不只左右交替），难度越高横向偏移越大
    const totalP = (progress.totalPits || 0);
    const spread = totalP < 150 ? 0.32 : (totalP < 600 ? 0.42 : 0.52);
    const angleVariation = (Math.random() - 0.5) * 1.4;  // ±0.7 弧度 ≈ ±40°
    const baseAngle = lastPit.worldX > 0.5 ? Math.PI : 0; // 大方向交替
    const dirAngle = baseAngle + angleVariation;
    worldX = 0.5 + Math.sin(dirAngle) * (0.18 + Math.random() * spread);

    // 间距 = 坑直径 × 随机倍数，难度阶梯
    const diameter = lastPit.radius * 2;
    var minMul, maxMul;
    if (totalP < 150) {
      minMul = 3.0; maxMul = 4.5;
    } else if (totalP < 600) {
      minMul = 3.0; maxMul = 6.0;
    } else {
      minMul = 3.0; maxMul = 7.0;
    }
    const multiplier = minMul + Math.random() * (maxMul - minMul);
    worldY = lastPit.worldY + diameter * multiplier;

    // 坑大小：固定 0.13 直径
    radius = CFG.PIT_RADIUS_MIN;
  }

  const pit = createPit(worldX, worldY, radius);
  pits.push(pit);
  return pit;
}

function getCurrentTargetPit() {
  // 找第一个未访问的坑
  return pits.find(p => !p.visited) || null;
}

// ============================================================
// 六、物理系统（基于 dt）
// ============================================================
function updateRolling(dt) {
  // 回滚入坑：位置回位，缩放继续向 0.80 lerp
  if (marble._rollingBack) {
    marble._rollbackTimer += dt;
    var dur = 0.18;
    var t = Math.min(marble._rollbackTimer / dur, 1);
    var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    var prevX = marble.worldX, prevY = marble.worldY;
    marble.worldX = marble._rollbackFromX + (marble._rollbackToX - marble._rollbackFromX) * ease;
    marble.worldY = marble._rollbackFromY + (marble._rollbackToY - marble._rollbackFromY) * ease;
    // 缩放：和引力用同一套 lerp，不切曲线
    marble.scale += (0.80 - marble.scale) * 0.25;
    var ddx = marble.worldX - prevX, ddy = marble.worldY - prevY;
    marble.texOffX += ddx * 220;
    marble.texOffY -= ddy * 220;
    if (t >= 1) {
      marble._rollingBack = false;
      marble.worldX = marble._rollbackToX;
      marble.worldY = marble._rollbackToY;
      marble.scale = 0.80;
      marble.vx = 0; marble.vy = 0;
      startSinkAnimation(marble._rollbackPit);
    }
    return;
  }

  // 连续摩擦力
  const decay = Math.exp(-CFG.FRICTION * dt);
  marble.vy *= decay;
  marble.vx *= decay;

  // 低速额外阻力：越慢刹得越快，防止越过坑
  const spd2 = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
  if (spd2 < 0.8 && spd2 > 0.001) {
    const lowDrag = (0.8 - spd2) * 1.3;
    const extraDecay = Math.exp(-lowDrag * dt);
    marble.vx *= extraDecay;
    marble.vy *= extraDecay;
  }

  // ===== 强磁道具：引力吸入 + 渐进缩放 =====
  if (propMagnetActive) {
    const GRAVITY = 1.2;
    const bottomX2 = marble.worldX;
    const bottomY2 = marble.worldY + CFG.MARBLE_RADIUS;
    for (const pit of pits) {
      if (pit.visited) continue;
      if (pit._index !== propMagnetPitIndex) continue;
      const dx2 = bottomX2 - pit.worldX;
      const dy2 = bottomY2 - pit.worldY;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      const pullRange2 = 999; // 全屏吸引
      if (dist2 > 0.01) {
        const ts2 = Math.max(0.05, 1 - Math.min(dist2 / 100, 0.95));
        const strength = ts2 * GRAVITY;
        marble.vx -= (dx2 / dist2) * strength * dt;
        marble.vy -= (dy2 / dist2) * strength * dt;
        var targetScale2 = 1.0 - ts2 * 0.20;
        marble.scale += (targetScale2 - marble.scale) * 0.25;
      }
    }
  } else {
    // ===== 普通滑入：球心未过坑心，在命中范围内 → 加速靠近 + 缩放 =====
    var targetPit2 = getCurrentTargetPit();
    if (targetPit2) {
      var dx3 = marble.worldX - targetPit2.worldX;
      var dy3 = marble.worldY - targetPit2.worldY;
      var dist3 = Math.sqrt(dx3 * dx3 + dy3 * dy3);
      var pullRange3 = targetPit2.radius * 1.1;
      if (dist3 < pullRange3 && dist3 > 0.005 && marble.worldY <= targetPit2.worldY) {
        var ts3 = 1 - (dist3 / pullRange3); // 0(边缘) → 1(中心)
        var strength3 = ts3 * 0.8;
        marble.vx -= (dx3 / dist3) * strength3 * dt;
        marble.vy -= (dy3 / dist3) * strength3 * dt;
        var targetScale3 = 1.0 - ts3 * 0.20;
        marble.scale += (targetScale3 - marble.scale) * 0.25;
      }
    }
  }

  // ===== 坑中心吸力 =====
  var suckPit = getCurrentTargetPit();
  var suckDist = Infinity, suckRange = 1;
  if (suckPit) {
    var scx = marble.worldX - suckPit.worldX;
    var scy = marble.worldY - suckPit.worldY;
    suckDist = Math.sqrt(scx*scx + scy*scy);
    suckRange = suckPit.radius * 2.0;
  }
  var inSuck = suckPit && suckDist < suckRange && suckDist > 0.01 && !propMagnetActive;
  if (inSuck) {
    var st = 1 - (suckDist / suckRange);
    var ss = st * 1.0;
    marble.vx -= (scx / suckDist) * ss * dt;
    marble.vy -= (scy / suckDist) * ss * dt;
    // 近坑急刹：越靠近坑心减速越快，防止越过
    if (suckDist < suckPit.radius * 0.5) {
      var brake = 8.0 * (1 - suckDist / (suckPit.radius * 0.5));
      marble.vx *= Math.exp(-brake * dt);
      marble.vy *= Math.exp(-brake * dt);
    }
    var sts = 1 - st * 0.20;
    marble.scale += (sts - marble.scale) * 0.25;
  }

  // 位置更新
  marble.worldY += marble.vy * dt;
  marble.worldX += marble.vx * dt;

  // 纹理滚动（位移驱动，定期取模防溢出）
  marble.texOffX = (marble.texOffX - marble.vx * dt * 220) % 1200;
  marble.texOffY = (marble.texOffY + marble.vy * dt * 220) % 1200;

  // 远离坑时缩放恢复到 1.0
  if (!propMagnetActive && !marble._rollingBack && !inSuck) {
    marble.scale += (1.0 - marble.scale) * 0.15;
  }

  // 检查是否停止
  const speed = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
  if (speed < CFG.STOP_THRESHOLD) {
    marble.vx = 0;
    marble.vy = 0;
    checkPitResult();
  }
}

function checkPitResult() {
  // 只检测下一个未访问的坑（跳过=输）
  const targetPit = getCurrentTargetPit();

  if (!targetPit) {
    gameOver();
    return;
  }

  // 弹珠中心到坑心距离
  const mx = marble.worldX;
  const my = marble.worldY;
  const dx = mx - targetPit.worldX;
  const dy = my - targetPit.worldY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  var hitRange = targetPit.radius * 1.1;
  if (propMagnetActive && targetPit._index === propMagnetPitIndex) {
    hitRange = 999; // 强磁：必定命中
  }
  if (dist <= hitRange) {
    if (propMagnetActive && targetPit._index === propMagnetPitIndex) {
      propMagnetActive = false; propMagnetPitIndex = -1; magnetParticles = [];
    }
    currentPitIndex = targetPit._index;
    var overCenter = my > targetPit.worldY;
    if (dist < 0.005) {
      // 已在坑心，直接入坑
      marble.scale = 0.80;
      startSinkAnimation(targetPit);
    } else if (overCenter) {
      // 球心超过坑心 → 回滚
      marble._rollingBack = true;
      marble._rollbackFromX = mx;
      marble._rollbackFromY = my;
      marble._rollbackFromScale = marble.scale;
      marble._rollbackToX = targetPit.worldX;
      marble._rollbackToY = targetPit.worldY;
      marble._rollbackPit = targetPit;
      marble._rollbackTimer = 0;
      marble.vx = 0; marble.vy = 0;
    } else {
      // 球心未到坑心但已在范围内 → 前方刹停，也算命中
      marble.scale = 0.80;
      startSinkAnimation(targetPit);
    }
  } else {
    // 没进坑
    playSfx('fail');
    gameState = STATE.LOST;
  }
}

// ============================================================
// 七、动画系统
// ============================================================
function startSinkAnimation(pit) {
  gameState = STATE.SINKING;
  animTimer = 0;
  marble.sinkY = 0;
  marble.alpha = 1;
  marble._sinkStartScale = marble.scale; // 滑入起点（保持引力缩放的连续性）
  // 入口位置（珠珠停下的地方）
  marble._entryX = marble.worldX;
  marble._entryY = marble.worldY;
  // 已在坑心则跳过滑入阶段
  var dx2 = marble.worldX - pit.worldX, dy2 = marble.worldY - pit.worldY;
  marble._skipSlide = (Math.sqrt(dx2*dx2 + dy2*dy2) < 0.005);
  // 落点：圆心在坑中心→下一坑的连线上
  const nextPit = pits.find(p => !p.visited && p.worldY > pit.worldY);
  let angle = 0;
  if (nextPit) {
    angle = Math.atan2(nextPit.worldX - pit.worldX, nextPit.worldY - pit.worldY);
  }
  // 圆心距 = 坑半径 + 珠珠半径 + 5px
  const dist = pit.radius + CFG.MARBLE_RADIUS + 0.04;  // 0.04 ≈ 10px
  marble._landX = pit.worldX + Math.sin(angle) * dist;
  marble._landY = pit.worldY + Math.cos(angle) * dist;
}

function updateSinking(dt) {
  // 弹窗/光点期间全体冻结
  if (treasurePopup || treasureWaitingParticles) return;
  // 跳过道具动画
  if (marble._jumpPropAnim) { updateJumpPropAnim(dt); return; }
  // 跳过道具的跳出阶段：使用已保存的坑位置
  var pit2;
  if (marble._jumpTargetPit2 >= 0) {
    pit2 = pits.find(function(p){ return p._index === marble._jumpTargetPit2; });
    if (!pit2) { marble._jumpTargetPit2 = -1; finishSink(); return; }
  } else {
    pit2 = getCurrentTargetPit();
    if (!pit2) { finishSink(); return; }
  }
  animTimer += dt;
  var slideDur = 0.10;
  var pauseDur = 0.12;
  var jumpDur = 0.25;
  var totalDur = slideDur + pauseDur + jumpDur;
  var raw = animTimer;

  // 暂停阶段检测宝物，有宝物则冻结在坑内
  if (raw >= slideDur && raw < slideDur + pauseDur) {
    var hasT = false;
    if (gameMode === 'endless' || gameMode === 'levels') {
      var tp3 = pits.find(function(p){ return p._index === currentPitIndex; });
      if (tp3 && tp3.hasTreasure) hasT = true;
    }
    if (hasT) {
      // 冻结在坑中心，等弹窗/光点处理完
      marble.worldX = pit2.worldX;
      marble.worldY = pit2.worldY;
      marble.scale = 0.80;
      marble.sinkY = 0;
      marble.alpha = 1;
      if (!treasurePopup && !treasureWaitingParticles) {
        // 首次触发：执行宝物掉落
        finishSink();
      }
      if (treasurePopup || treasureWaitingParticles) return;
    }
  }

  if (marble._skipSlide && raw < slideDur) {
    // 已在坑心，跳过滑入动画，静置等时间走完
    marble.worldX = pit2.worldX;
    marble.worldY = pit2.worldY;
    marble.scale = 0.80;
    marble.sinkY = 0; marble.alpha = 1;
  } else if (!marble._skipSlide && raw < slideDur) {
    var p3 = raw / slideDur;
    var ease2 = p3 * p3;
    var prevX2 = marble.worldX, prevY2 = marble.worldY;
    marble.worldX = marble._entryX + (pit2.worldX - marble._entryX) * ease2;
    marble.worldY = marble._entryY + (pit2.worldY - marble._entryY) * ease2;
    marble.texOffX -= (marble.worldX - prevX2) * 220;
    marble.texOffY += (marble.worldY - prevY2) * 220;
    marble.scale = marble._sinkStartScale + (0.80 - marble._sinkStartScale) * ease2;
    marble.sinkY = 0; marble.alpha = 1;
  } else if (raw < slideDur + pauseDur) {
    marble.worldX = pit2.worldX;
    marble.worldY = pit2.worldY;
    marble.scale = 0.80;
    marble.sinkY = 0; marble.alpha = 1;
  } else {
    var p4 = (raw - slideDur - pauseDur) / jumpDur;
    marble.worldX = pit2.worldX + (marble._landX - pit2.worldX) * p4;
    marble.worldY = pit2.worldY + (marble._landY - pit2.worldY) * p4;
    var fromMid2 = Math.abs(p4 - 0.5) * 2;
    marble.scale = 0.80 + (1 - fromMid2) * 0.20;
    marble.sinkY = Math.sin(p4 * Math.PI) * -12;
    marble.alpha = 1;
  }

  if (raw >= totalDur && gameState === STATE.SINKING) {
    playSfx('luo');
    marble.sinkY = 0; marble.scale = 1; marble.alpha = 1;
    marble.vx = 0; marble.vy = 0;
    if (marble._jumpTargetPit2 >= 0) {
      // 跳过道具退出：已做过房务，直接重生
      marble._jumpTargetPit2 = -1;
      gameState = STATE.RESPAWN; animTimer = 0;
    } else {
      finishSink();
    }
  }
}

function finishSink() {
  score++;
  comboCount++;
  marble.alpha = 1;
  marble.vx = 0;
  marble.vy = 0;

  if (score > bestScore) { bestScore = score; submitScoreToCloud(); }

  // 进度追踪（必须在通关检测之前，确保最后一坑也能触发勋章/皮肤解锁）
  progress.totalPits = (progress.totalPits || 0) + 1;
  livesData.dailyPits = (livesData.dailyPits || 0) + 1;
  if (comboCount > (progress.bestCombo || 0)) progress.bestCombo = comboCount;
  if (comboCount > sessionBestCombo) sessionBestCombo = comboCount;
  if (comboCount > (livesData.dailyBestCombo || 0)) livesData.dailyBestCombo = comboCount;
  checkMilestones();

  // 闯关模式通关检测
  if (gameMode === 'levels') {
    const target = LEVEL_TARGETS[currentLevel] || 10;
    if (score >= target && currentLevel < 9) {
      if (!treasurePopup && !treasureWaitingParticles) {
        gameState = STATE.WIN;
        maxUnlockedLevel = Math.max(maxUnlockedLevel, currentLevel + 1);
        saveAllData();
        if (bgmAudio) bgmAudio.pause();
        playSfx('victory');
      } else {
        pendingLevelWin = true;
      }
      return;
    }
  }

  // 标记当前坑已访问
  const targetPit = getCurrentTargetPit();
  if (targetPit) {
    targetPit.visited = true;
    currentPitIndex = targetPit._index;
  }
  // 保存当前坑的屏幕坐标和直径（用于宝物光点）
  var pitScreenX = W/2, pitScreenY = H * 0.55, pitScreenDia = 50;
  if (targetPit) {
    var sp3 = worldToScreen(targetPit.worldX, targetPit.worldY);
    pitScreenX = sp3.x; pitScreenY = sp3.y;
    pitScreenDia = targetPit.radius * W; // 屏幕直径
  }
  treasureLastPitScreen = { x: pitScreenX, y: pitScreenY, dia: pitScreenDia };

  // 不直接删除，让渲染层渐隐处理
  // 只清理已经完全透明的坑
  pits = pits.filter(p => p.alpha > 0.01);
  // 确保前方有至少 4 个未走过的坑
  while (pits.filter(p => !p.visited).length < 4) {
    spawnNextPit();
  }
  // 总数控制
  while (pits.length > 12) pits.shift();

  // 标记新坑宝物
  markTreasureForNewPits();

  // 无尽模式/闯关模式宝物掉落
  if (gameMode === 'endless') {
    checkEndlessTreasureDrop(score);
  } else if (gameMode === 'levels') {
    checkLevelTreasureDropPit();
  }

  // 如果有宝物弹窗或等待光点，暂停不进入重生
  if (treasurePopup || treasureWaitingParticles) return;

  // 短暂重生状态
  if (marble._jumpFromX === undefined) { marble._jumpFromX = marble.worldX; marble._jumpFromY = marble.worldY; }
  if (marble._landX === undefined) { marble._landX = marble.worldX; marble._landY = marble.worldY; }
  gameState = STATE.RESPAWN;
  animTimer = 0;
  saveAllData();
}

function updateRespawn(dt) {
  animTimer += dt;
  var t5 = animTimer / CFG.RESPAWN_DURATION;
  // 平滑跳出：从坑中心移动到落点
  if (marble._jumpFromX !== undefined) {
    var easeJump = t5 < 0.5 ? 2 * t5 * t5 : 1 - Math.pow(-2 * t5 + 2, 2) / 2;
    marble.worldX = marble._jumpFromX + (marble._landX - marble._jumpFromX) * easeJump;
    marble.worldY = marble._jumpFromY + (marble._landY - marble._jumpFromY) * easeJump;
  }
  // 缩放弹跳：从当前 → 1.1 → 1.0
  var startScale = marble._respawnStartScale || 0.80;
  if (t5 < 0.01) marble._respawnStartScale = marble.scale;
  if (t5 < 0.5) {
    marble.scale = startScale + t5 / 0.5 * (1.1 - startScale);
  } else {
    marble.scale = 1.1 - (t5 - 0.5) / 0.5 * 0.1;
  }
  if (animTimer >= CFG.RESPAWN_DURATION) {
    marble.scale = 1;
    marble._jumpFromX = undefined; marble._jumpFromY = undefined;
    gameState = STATE.IDLE;
    animTimer = 0;
    camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
  }
}

function gameOver() {
  gameState = STATE.GAMEOVER;
  playSfx('fail');
  comboCount = 0;
  if (score > bestScore) { bestScore = score; submitScoreToCloud(); }
  progress.totalPits = (progress.totalPits || 0) + score;

  // 闯关模式：检查是否通关
  if (gameMode === 'levels') {
    const target = LEVEL_TARGETS[currentLevel] || 10;
    if (score >= target) {
      // 通关！
      marble._levelCleared = true;
    } else {
      marble._levelFailed = true;
      marble._pitsShort = target - score;
    }
  }

  // 扣命 + 飘爱心
  if (livesData.lives > 0) {
    spawnFloatingHeart();
    consumeLife();
    saveAllData();
  } else {
    // 没命了 → 检查是否有重复宝物可兑换
    var dupCount = countDupItems();
    if (dupCount > 0) {
      dupExchangePopup = true;
      return;
    }
    saveAllData();
  }
}

function spawnFloatingHeart() {
  // 位置与 drawLives 的爱心对齐（right对齐，数字约30px宽，爱心在W-50处）
  floatingHearts.push({
    x: W - 48,
    y: H * 0.15 - 4,
    life: 1.5,
    age: 0,
    driftX: (Math.random() - 0.5) * 25,
    scale: 1,
  });
}

function updateFloatingHearts(dt) {
  for (let i = floatingHearts.length - 1; i >= 0; i--) {
    const h = floatingHearts[i];
    h.age += dt;
    if (h.age >= h.life) {
      floatingHearts.splice(i, 1);
      continue;
    }
    h.x += (h.driftX || 0) * dt;
    h.y -= 40 * dt;  // 向上飘
  }
  // 分享奖励爱心（首页不加）
  if (shareRewardHeart) {
    shareRewardHeart.t += dt;
    if (shareRewardHeart.t >= shareRewardHeart.duration) {
      if (gameState !== STATE.HOME) {
        livesData.lives = Math.min((livesData.lives || 0) + 1, 99);
        try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
      }
      shareRewardHeart = null;
    }
  }
}

function drawFloatingHearts() {
  for (const h of floatingHearts) {
    const t = h.age / h.life;
    // 先放大再缩小
    const scale = t < 0.15 ? 1 + t / 0.15 * 0.5 : 1.5 - (t - 0.15) / 0.85 * 1.5;
    const alpha = 1 - t;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(h.x, h.y);
    ctx.scale(scale, scale);
    if (uiIcons.heart && uiIcons.heart.width) {
      ctx.drawImage(uiIcons.heart, -16, -16, 32, 32);
    } else {
      ctx.fillStyle = '#ff4444';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♥', 0, 0);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }
  // 分享奖励爱心（从屏幕中心飞向爱心图标）
  if (shareRewardHeart) {
    var sr = shareRewardHeart;
    var t3 = sr.t / sr.duration;
    var ease3 = t3 * t3 * (3 - 2 * t3);
    var cx3 = sr.x + (sr.tx - sr.x) * ease3;
    var cy3 = sr.y + (sr.ty - sr.y) * ease3;
    var sc = t3 < 0.2 ? 1 + t3/0.2 * 1.5 : 2.5 - (t3-0.2)/0.8 * 1.5;
    ctx.save();
    ctx.globalAlpha = 1 - t3 * 0.3;
    ctx.translate(cx3, cy3);
    ctx.scale(sc, sc);
    if (uiIcons.heart && uiIcons.heart.width) {
      ctx.drawImage(uiIcons.heart, -24, -24, 48, 48);
    } else {
      ctx.fillStyle = '#ff4444'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('♥', 0, 0); ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }
}

function goHome() {
  if (classicData && classicData._multiWatcher) {
    try { classicData._multiWatcher.close(); } catch(e) {}
  }
  hideUserInfoButton(); // 游戏中不需要授权按钮
  gameState = STATE.HOME;
  gameMode = 'endless';
  livesData.lives = 3;
  classicShowModeSelect = false;
  classicData = null;
  // 清理所有弹窗状态，防止泄漏到首页导致点击失效
  treasurePopup = null;
  treasureGoConfirm = false;
  dupExchangePopup = false;
  propGetPopup = false;
  if (!bgImage || !bgImage.width) switchScene('grandma_backyard');
  initHomeMarbles();
  if (bgmAudio && musicOn) bgmAudio.play();
}

function restartGame() {
  // 重新开始游戏
  levelTreasureSeq = 0; levelTreasureId = ''; levelChestsPlaced = 0; levelTreasureChestNum = 0; levelChestSeq = [];
  endlessPool3 = []; endlessChestsPlaced = 0; endlessTypesRevealed = {};
  duplicateTreasureStash = {};
  sessionProps = { heart: 1, jump: 1, force: 1 };
  // 签到攒的道具叠加到本局
  if (zhuzhuProps.heart > 0) { sessionProps.heart += zhuzhuProps.heart; zhuzhuProps.heart = 0; }
  if (zhuzhuProps.jump > 0) { sessionProps.jump += zhuzhuProps.jump; zhuzhuProps.jump = 0; }
  if (zhuzhuProps.force > 0) { sessionProps.force += zhuzhuProps.force; zhuzhuProps.force = 0; }
  saveProps();
  marble.worldX = -0.3;
  marble.worldY = -0.6;
  marble.vx = 2.0;
  marble.vy = 1.5;
  marble.rotation = 5;
  marble.scale = 1;
  marble.alpha = 1;
  marble.sinkY = 0;
  gameState = STATE.INTRO;
  animTimer = 0;

  // 重置坑
  pits = [];
  currentPitIndex = 0;
  pitIdCounter = 0;
  const r = CFG.PIT_RADIUS_MIN;
  // 第一坑放在 intro 结束后的位置前方（球终点 ≈ -0.045）
var introEndY = -CFG.MARBLE_RADIUS;
spawnPitAt(0.58 + Math.random() * 0.08, introEndY + r * 2 * (3 + Math.random() * 1), r);
  for (let i = 0; i < 3; i++) spawnNextPit();

  // 标记宝物坑
  if (pits.length > 0) { treasureFirstPitIndex = pits[0]._index; treasureNextPitSeq = 6 + Math.floor(Math.random() * 6); friendImgNextSeq = 5 + Math.floor(Math.random() * 6); }
  markTreasureForNewPits();

  // 重置状态
  score = 0;
  comboCount = 0;
  sessionBestCombo = 0;
  duplicateTreasureStash = {};
  sessionProps = { heart: 1, jump: 1, force: 1 };
  // 签到攒的道具叠加到本局
  if (zhuzhuProps.heart > 0) { sessionProps.heart += zhuzhuProps.heart; zhuzhuProps.heart = 0; }
  if (zhuzhuProps.jump > 0) { sessionProps.jump += zhuzhuProps.jump; zhuzhuProps.jump = 0; }
  if (zhuzhuProps.force > 0) { sessionProps.force += zhuzhuProps.force; zhuzhuProps.force = 0; }
  saveProps();
  sessionTreasureCount = 0;
  sessionTreasureList = []; sessionTreasureCounts = {}; treasureExchanged = false;
  propMagnetActive = false; propMagnetPitIndex = -1; propHeartFly = null;
  propHeartQueue = 0; propHeartFlyActive = false; gameOverAutoContinue = false;
  pendingPropType = null; pendingPropList = []; propIconParticles = [];
  treasureParticles = [];
  chargePower = 0;
  marble._levelCleared = false;
  marble._levelFailed = false;
  marble._pitsShort = 0;
  marble._jumpPropAnim = false;
  camera.worldX = -0.8;
  camera.worldY = -0.6;
  camera.targetX = -0.8;
  camera.targetY = -0.6;
}

// ============================================================
// 八-A、进度系统
// ============================================================
function checkMilestones() {
  const tp = progress.totalPits || 0;
  const badges = progress.unlockedBadges || [];

  // 历程勋章 (7)
  var pms = [[50,'first_pit'],[150,'five_pits'],[350,'twenty_pits'],[600,'fifty_pits'],[1000,'hundred_pits'],[2500,'five_hundred'],[5000,'thousand_pits']];
  for (var pi5 = 0; pi5 < pms.length; pi5++) { if (tp >= pms[pi5][0] && !badges.includes(pms[pi5][1])) badges.push(pms[pi5][1]); }

  // 连击勋章 (7)
  var bcm3 = progress.bestCombo || 0;
  var cms = [[2,'combo_2'],[9,'combo_3'],[20,'combo_5'],[40,'combo_10'],[50,'combo_20'],[80,'combo_35'],[120,'combo_50']];
  for (var ci3 = 0; ci3 < cms.length; ci3++) { if (bcm3 >= cms[ci3][0] && !badges.includes(cms[ci3][1])) badges.push(cms[ci3][1]); }

  // 登录勋章 (7)
  var ld4 = progress.loginDays || 0;
  var lbs = [[1,'login_1'],[3,'login_3'],[7,'login_7'],[15,'login_15'],[30,'login_30'],[100,'login_100'],[365,'login_365']];
  for (var li5 = 0; li5 < lbs.length; li5++) { if (ld4 >= lbs[li5][0] && !badges.includes(lbs[li5][1])) badges.push(lbs[li5][1]); }

  // 收集勋章 (7)
  var mc2 = (progress.unlockedMarbles || []).length;
  var sc2 = (progress.unlockedScenes || []).length;
  var cbs = [[3,'skin_3'],[6,'skin_6'],[9,'skin_9'],[12,'skin_12'],[3,'scene_3'],[6,'scene_6'],[9,'scene_9']];
  for (var ci4 = 0; ci4 < cbs.length; ci4++) { var cv2 = cbs[ci4][1].indexOf('skin_')===0 ? mc2 : sc2; if (cv2 >= cbs[ci4][0] && !badges.includes(cbs[ci4][1])) badges.push(cbs[ci4][1]); }

  // 珠珠解锁
  const marbleUnlocks = [
    [80,'moonlight_white'],[200,'emerald_green'],[400,'amber_gold'],
    [800,'tiger_eye_brown'],[1500,'ink_black'],
    [3000,'orange_soda'],[5000,'mint_blue'],[8000,'sakura_pink'],[15000,'rainbow_phantom']
  ];
  for (const [n, id] of marbleUnlocks) {
    if (tp >= n && !progress.unlockedMarbles.includes(id)) progress.unlockedMarbles.push(id);
  }
  if (progress.bestCombo >= 30 && !progress.unlockedMarbles.includes('purple_crystal'))
    progress.unlockedMarbles.push('purple_crystal');
  if (progress.bestCombo >= 50 && !progress.unlockedMarbles.includes('flame_red'))
    progress.unlockedMarbles.push('flame_red');

  // 场景解锁（通关即解锁对应场景）
  const sceneUnlocks = [
    [2,'school_sandpit'],[3,'after_rain_mud'],[4,'river_pebbles'],
    [5,'old_locust_tree'],[6,'summer_threshing'],[7,'winter_snow'],
    [8,'memory_lane'],[9,'eternal_childhood']
  ];
  for (const [n, id] of sceneUnlocks) {
    if (maxUnlockedLevel >= n && !progress.unlockedScenes.includes(id)) progress.unlockedScenes.push(id);
  }

  // 称号
  var tp2 = progress.totalPits || 0;
  var bcm = progress.bestCombo || 0;
  var umc = (progress.unlockedMarbles || []).length;
  var usc = (progress.unlockedScenes || []).length;
  var ld2 = progress.loginDays || 0;
  var titleChecks = [
    [50,'beginner',tp2],[200,'player',tp2],[500,'enthusiast',tp2],
    [1500,'expert',tp2],[3000,'master',tp2],[8000,'legend',tp2],
    [50,'sharpshooter',bcm],[100,'unstoppable',bcm],
    [8,'collector8',umc],[6,'traveler6',usc],
    [30,'loyal30',ld2],[100,'oldfriend',ld2],
  ];
  for (var ti4 = 0; ti4 < titleChecks.length; ti4++) {
    var tc = titleChecks[ti4];
    if (tc[2] >= tc[0] && !progress.unlockedTitles.includes(tc[1])) { progress.unlockedTitles.push(tc[1]); progress.titleDates[tc[1]] = Date.now(); }
  }

  progress.unlockedBadges = badges;
  for (var bi6 = 0; bi6 < badges.length; bi6++) {
    if (!badgeDates[badges[bi6]]) badgeDates[badges[bi6]] = Date.now();
  }
  // 勋章对应宝物自动解锁
  for (var bi5 = 0; bi5 < ALL_TREASURES.length; bi5++) {
    var t3 = ALL_TREASURES[bi5];
    if (t3.badge && badges.indexOf(t3.badge) !== -1 && treasureData.found.indexOf(t3.id) === -1) {
      treasureData.found.push(t3.id);
      treasureData.foundDates[t3.id] = Date.now();
      treasureData.newFound[t3.id] = true;
    }
  }
  try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {}
}

// ============================================================
// 八-B、生命系统
// ============================================================
function resetLivesIfNewDay() {
  const today = getDateString();
  if (livesData.lastResetDate !== today) {
    livesData.lives = 3;
    livesData.lastResetDate = today;
    livesData.dailyPits = 0;
    livesData.dailyBestCombo = 0;
    livesData.sharesToday = 0;
    livesData.adsToday = 0;
    freePropsGivenToday = false;
  }
  // 重置每日宝物掉落计数
  if (treasureDaily.date !== today) {
    treasureDaily = { date: today, endlessDrops: 0, endlessPitSeg: 0, todayNew: 0, todayTotal: 0, todayLevel: 0 };
    try { wx.setStorageSync('zhuzhu_treasure_daily', treasureDaily); } catch(e) {}
  }
}

function getDateString() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function consumeLife() {
  if (livesData.lives > 0) livesData.lives--;
}

function canPlay() {
  return livesData.lives > 0;
}

// ============================================================
// 八-C、数据持久化
// ============================================================
function saveAllData() {
  try {
    wx.setStorageSync('zhuzhu_progress', JSON.stringify(progress));
    wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData));
    wx.setStorageSync('zhuzhu_best_score', String(bestScore));
    wx.setStorageSync('zhuzhu_max_level', String(maxUnlockedLevel));
  } catch (e) { /* ignore */ }
}

function loadAllData() {
  try {
    const sp = wx.getStorageSync('zhuzhu_progress');
    if (sp) {
      const p = JSON.parse(sp);
      progress = Object.assign(progress, p);
    }
    const sl = wx.getStorageSync('zhuzhu_lives');
    if (sl) {
      const l = JSON.parse(sl);
      livesData = Object.assign(livesData, l);
    }
    // 每次启动恢复3条命
    livesData.lives = 3;
    const sb = wx.getStorageSync('zhuzhu_best_score');
    if (sb) bestScore = parseInt(sb) || 0;
    const sml = wx.getStorageSync('zhuzhu_max_level');
    if (sml) { maxUnlockedLevel = parseInt(sml) || 1; currentLevel = maxUnlockedLevel; }
  } catch (e) { /* ignore */ }
}

// ============================================================
// 八、输入系统（点击屏幕任意处）
// ============================================================
let btnPressed = false;
let touchId = null;
let chargeStartTime = 0;
let chargeDir = 1;  // 1=上涨, -1=回落

// 飘爱心特效
let floatingHearts = [];

wx.onTouchStart(function (e) {
  if (!e.touches || e.touches.length === 0) return;
  const t = e.touches[0];
  const tx = (t.x || t.clientX || 0) / SCALE;
  const ty = (t.y || t.clientY || 0) / SCALE;
  // 记录触摸起点，用于判断是否为点击（非滑动）
  uiTouchStartX = tx; uiTouchStartY = ty;

  // 经典模式声明弹窗
  if (classicDisclaimerPopup) { handleClassicDisclaimerTouch(tx, ty); return; }
  // 获取道具弹窗
  if (propGetPopup) { handlePropGetTouch(tx, ty); return; }
  // 重复宝物兑换弹窗
  if (dupExchangePopup) { handleDupExchangeTouch(tx, ty); return; }
  // 宝箱确认弹窗
  if (treasureGoConfirm) { handleTreasureGoConfirmTouch(tx, ty); return; }
  // 宝物弹窗优先处理
  if (treasurePopup) { handleTreasurePopupTouch(tx, ty); return; }

  // 宝箱图标点击（游戏内）
  if (gameState !== STATE.HOME && gameState !== STATE.CLASSIC && gameState !== STATE.STORY && gameState !== STATE.FEEDBACK && gameState !== STATE.CHECKIN && gameState !== STATE.TREASURE && gameState !== STATE.BADGES && gameState !== STATE.RANK && gameState !== STATE.CONFIRM && gameState !== STATE.SETTINGS && gameState !== STATE.SKIN) {
    if (tx > treasureTargetIcon.x && tx < treasureTargetIcon.x + treasureTargetIcon.w && ty > treasureTargetIcon.y && ty < treasureTargetIcon.y + treasureTargetIcon.h) {
      treasureGoConfirm = true; return;
    }
    // 道具栏点击
    handlePropTouch(tx, ty);
  }

  // 反馈
  if (gameState === STATE.FEEDBACK) { feedbackTouchY2 = ty; handleFeedbackTouch(tx, ty); return; }

  // 签到
  if (gameState === STATE.CHECKIN) { handleCheckinTouch(tx, ty); return; }

  // 宝箱（只记录起始位置，不处理点击 — 留给 touchEnd）
  if (gameState === STATE.TREASURE) {
    treasureTouchY3 = ty; treasureDragging = false;
    treasureSwipeX = tx;
    if (treasureDetailIdx >= 0) treasureHoriSwipe = false;
    return;
  }

  // 关卡选择
  if (gameState === STATE.LEVELSEL) { levelSelTouchY = ty; levelSelDragging = false; handleLevelSelTouch(tx, ty); return; }

  // 故事回顾
  if (gameState === STATE.STORY) {
    storyTouchY = ty;
    storyTouchStartY2 = ty;
    storyDragging = false;
    handleStoryTouch(tx, ty);
    return;
  }

  // 经典模式
  if (gameState === STATE.CLASSIC) {
    // 收集所有触点
    var pts = [];
    for (var ti = 0; ti < e.touches.length; ti++) {
      pts.push({
        x: (e.touches[ti].x || e.touches[ti].clientX || 0) / SCALE,
        y: (e.touches[ti].y || e.touches[ti].clientY || 0) / SCALE,
        id: e.touches[ti].identifier
      });
    }
    classicTouchStart(pts, tx, ty);
    return;
  }

  // BADGES 状态
  if (gameState === STATE.BADGES) { handleBadgesTouch(tx, ty); return; }

  // RANK 状态
  if (gameState === STATE.RANK) { if (handleRankTouch(tx, ty)) return; return; }

  // CONFIRM 状态
  if (gameState === STATE.CONFIRM) { handleConfirmTouch(tx, ty); return; }

  // SETTINGS 状态
  if (gameState === STATE.SETTINGS) { handleSettingsTouch(tx, ty); return; }

  // SKIN 状态
  if (gameState === STATE.SKIN) { handleSkinTouch(tx, ty); return; }

  // WIN 状态 → 通关弹窗
  if (gameState === STATE.WIN) {
    if (handleWinTouch(tx, ty)) return;
    return;
  }

  // LOST 状态 → 弹窗按钮选择
  // 输了（含 LOST 和 GAMEOVER）
  if (gameState === STATE.LOST || gameState === STATE.GAMEOVER) {
    var gw2 = W * 0.75, gh2 = livesData.lives > 0 ? 250 : 240;
    var gx2 = Math.floor((W - gw2) / 2);
    var gy2 = Math.floor((H - gh2) / 2);
    // 首页按钮
    if (tx > gx2 + 10 && tx < gx2 + 55 && ty > gy2 + 5 && ty < gy2 + 60) { goHome(); return; }
    // 有爱心 → 重新开始 + 继续
    if (livesData.lives > 0) {
      var gbw = Math.floor(gw2 * 0.4), gbh = 44;
      var gby = gy2 + 160;
      var gbxL = Math.floor((W - gbw*2 - 16) / 2);
      var gbxR = gbxL + gbw + 16;
      if (tx > gbxL && tx < gbxL + gbw && ty > gby && ty < gby + gbh) {
        livesData.lives = 3; restartGame(); return;
      }
      if (tx > gbxR && tx < gbxR + gbw && ty > gby && ty < gby + gbh) {
        spawnFloatingHeart(); consumeLife();
        // 复活到最近走过的坑
        var vpits2 = pits.filter(function(p){ return p.visited; });
        var lp2 = vpits2.length > 0 ? vpits2.reduce(function(a,b){ return a._index > b._index ? a : b; }) : null;
        if (lp2) {
          var np2 = pits.find(function(p){ return !p.visited; });
          var ang2 = 0;
          if (np2) ang2 = Math.atan2(np2.worldX - lp2.worldX, np2.worldY - lp2.worldY);
          var dst2 = lp2.radius + CFG.MARBLE_RADIUS + 0.04;
          marble.worldX = lp2.worldX + Math.sin(ang2) * dst2;
          marble.worldY = lp2.worldY + Math.cos(ang2) * dst2;
        } else {
          marble.worldX = 0.5; marble.worldY = -CFG.MARBLE_RADIUS;
        }
        marble.vx = 0; marble.vy = 0; marble.scale = 1;
        comboCount = 0; gameState = STATE.IDLE;
        camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
        return;
      }
    } else {
      // 没有爱心和道具爱心 → 重新开始 + 获得爱心
      var gbw2 = Math.floor(gw2 * 0.4), gbh2 = 44;
      var gby2 = gy2 + 160;
      var gbxL2 = Math.floor((W - gbw2*2 - 16) / 2);
      var gbxR2 = gbxL2 + gbw2 + 16;
      if (tx > gbxL2 && tx < gbxL2 + gbw2 && ty > gby2 && ty < gby2 + gbh2) {
        livesData.lives = 3; restartGame(); return;
      }
      if (tx > gbxR2 && tx < gbxR2 + gbw2 && ty > gby2 && ty < gby2 + gbh2) {
        justShared = true;

shareTimestamp = Date.now();
        wx.shareAppMessage({ title: '珠珠快跑！一起来怀旧～', imageUrl: 'assets/images/ui/sharepic.jpg', query: '' });
        return;
      }
    }
    return;
  }

  // HOME 状态 → 处理主页点击/拖拽
  if (gameState === STATE.HOME) {
    // 检测是否点到珠珠
    homeDragMarble = null;
    for (const m of homeMarbles) {
      if (Math.sqrt((tx-m.x)**2 + (ty-m.y)**2) < m.r + 10) {
        homeDragMarble = m;
        homeDragLastX = tx; homeDragLastY = ty;
        m.vx = 0; m.vy = 0;
        break;
      }
    }
    if (!homeDragMarble) handleHomeTouch(tx, ty);
    return;
  }

  // INTRO 状态不响应
  if (gameState === STATE.INTRO) return;

  // 关卡选择按钮（chose.png，宝箱下方20px）
  if (gameMode === 'levels' && gameState !== STATE.HOME && gameState !== STATE.GAMEOVER && gameState !== STATE.LOST && gameState !== STATE.INTRO && gameState !== STATE.CONFIRM) {
    var ly2 = H * 0.15;
    if (tx > W - 65 && tx < W - 17 && ty > ly2 + 77 && ty < ly2 + 129) {
      levelSelScrollY = 0; gameState = STATE.LEVELSEL; return;
    }
  }

  // 游戏中的返回按钮
  if (gameState !== STATE.HOME && gameState !== STATE.GAMEOVER && gameState !== STATE.LOST && gameState !== STATE.INTRO && gameState !== STATE.CONFIRM) {
    if (handleBackButton(tx, ty)) {
      if (score > 0) {
        gameState = STATE.CONFIRM;
        return;
      }
      goHome();
      return;
    }
  }

  // IDLE 状态 → 点击屏幕任意处开始蓄力
  if (gameState === STATE.IDLE) {
    hideTip();
    btnPressed = true;
    touchId = e.touches[0].identifier;
    chargePower = 0;
    chargeDir = 1;
    chargeStartTime = Date.now();
    playSfx('power');
    gameState = STATE.CHARGING;
  }
});

wx.onTouchMove(function (e) {
  if (!e.touches || e.touches.length === 0) return;
  const t = e.touches[0];
  const tx = (t.x || t.clientX || 0) / SCALE;
  const ty = (t.y || t.clientY || 0) / SCALE;

  // 经典模式
  if (gameState === STATE.CLASSIC) {
    var pts2 = [];
    for (var ti2 = 0; ti2 < e.touches.length; ti2++) {
      pts2.push({
        x: (e.touches[ti2].x || e.touches[ti2].clientX || 0) / SCALE,
        y: (e.touches[ti2].y || e.touches[ti2].clientY || 0) / SCALE,
        id: e.touches[ti2].identifier
      });
    }
    classicTouchMove(pts2, tx, ty);
    return;
  }

  // 首页拖拽珠珠
  if (gameState === STATE.HOME && homeDragMarble) {
    homeDragMarble.x = tx;
    homeDragMarble.y = ty;
    homeDragMarble.vx = (tx - homeDragLastX) / 0.016;  // 估算速度
    homeDragMarble.vy = (ty - homeDragLastY) / 0.016;
    homeDragLastX = tx; homeDragLastY = ty;
    return;
  }

  // 故事详情滚动（1:1 跟手）
  if (gameState === STATE.STORY && storyLevel > 0) {
    storyScroll += (ty - storyTouchStartY2) * 1.2;
    storyTouchStartY2 = ty;
    storyDragging = true;
    var lineH2 = 30, padT = 30, padB = 10;
    var totalH2 = storyLines.length * lineH2 + padT + padB + 60;
    var visH2 = storyDetailVisibleH || ((H - 60) - (capsuleRect.bottom + 56));
    var minS = -(totalH2 - visH2);
    if (minS > 0) minS = 0;
    if (storyScroll > 0) storyScroll = 0;
    if (storyScroll < minS) storyScroll = minS;
    return;
  }

  // 宝箱滚动
  if (gameState === STATE.TREASURE) { handleTreasureMove(tx, ty); return; }

  // 关卡选择滚动
  if (gameState === STATE.LEVELSEL) { handleLevelSelMove(tx, ty); return; }

  // 反馈滚动
  if (gameState === STATE.FEEDBACK) { handleFeedbackMove(tx, ty); return; }

  // 故事列表滚动
  if (gameState === STATE.STORY && storyLevel === 0) {
    var listTop3 = capsuleRect.bottom + 16;
    if (listTop3 < 70) listTop3 = 70;
    storyScrollY += (ty - storyTouchY) * 0.7;
    storyTouchY = ty;
    var cardH3 = 85, cardGap3 = 12;
    var totalH = 9 * (cardH3 + cardGap3) + 20;
    var visibleH = H - listTop3;
    var minSS = -(totalH - visibleH);
    if (minSS > 0) minSS = 0;
    if (storyScrollY > 0) storyScrollY = 0;
    if (storyScrollY < minSS) storyScrollY = minSS;
  }

  // 成就勋章/称号滚动
  if (gameState === STATE.BADGES) {
    badgeScrollY += (ty - badgeTouchStartY);
    badgeTouchStartY = ty;
    var totalCards2 = badgeTab === 0 ? 28 : 12;
    var cols3 = badgeTab === 0 ? 1 : 3;
    var gap3 = 8;
    var cardH4 = badgeTab === 0 ? 91 : 138;
    var rows = Math.ceil(totalCards2 / cols3);
    var extraH = badgeTab === 0 ? (4 * 34) : 0;
    var contentH = rows * (cardH4 + gap3) + extraH;
    var listH4 = H * 0.66 - 120;
    var maxBS2 = 0, minBS2 = -(contentH - listH4);
    if (minBS2 > 0) minBS2 = 0;
    if (badgeScrollY > maxBS2) badgeScrollY = maxBS2;
    if (badgeScrollY < minBS2) badgeScrollY = minBS2;
    return;
  }

  // 排行榜滚动
  if (gameState === STATE.RANK) {
    if (rankTab === 2 && openDataContext) {
      openDataContext.postMessage({ type: 'scrollFriend', delta: (ty - rankScrollStart2) * 0.5 });
    } else {
      var maxSR = 0, minSR = -(25 * 60 - 200);
      rankScrollY += (ty - rankScrollStart2);
      if (rankScrollY > maxSR) rankScrollY = maxSR;
      if (rankScrollY < minSR) rankScrollY = minSR;
    }
    rankScrollStart2 = ty;
    return;
  }

  if (gameState === STATE.SKIN && skinTab === 1) {
    skinScrollY = skinScrollStart + (ty - skinTouchStartY);
    var maxScroll = 0;
    // 滚动范围动态计算：刚好看到最后一个卡片
    var tabY2 = (H - H*0.66)/2 + 58, listTop2 = tabY2 + 30 + 15;
    var visibleH2 = ((H - H*0.66)/2 + H*0.66 - 10) - listTop2;
    var minScroll = -(Math.max(0, 9 * 88 - visibleH2) + 10);
    if (skinScrollY > maxScroll) skinScrollY = maxScroll;
    if (skinScrollY < minScroll) skinScrollY = minScroll;
  }
});

wx.onTouchEnd(function (e) {
  // 释放拖拽的珠珠（保持甩出速度）
  if (homeDragMarble) {
    homeDragMarble = null;
  }

  // 短点击播放按钮音效（滑动不触发）
  if (e.changedTouches && e.changedTouches.length > 0) {
    var et = e.changedTouches[0];
    var etx = (et.x || et.clientX || 0) / SCALE;
    var ety = (et.y || et.clientY || 0) / SCALE;
    var dx = Math.abs(etx - uiTouchStartX);
    var dy = Math.abs(ety - uiTouchStartY);
    if (dx < 10 && dy < 10) {
      var uiStates2 = [STATE.HOME, STATE.LOST, STATE.GAMEOVER, STATE.WIN, STATE.STORY, STATE.FEEDBACK, STATE.CHECKIN, STATE.TREASURE, STATE.LEVELSEL, STATE.BADGES, STATE.RANK, STATE.CONFIRM, STATE.SETTINGS, STATE.SKIN];
      if (uiStates2.indexOf(gameState) !== -1 || dupExchangePopup || treasureGoConfirm || treasurePopup) {
        playSfx('btn');
      }
    }
  }

  // 经典模式
  if (gameState === STATE.CLASSIC) {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const t2 = e.changedTouches[0];
    classicTouchEnd((t2.x || t2.clientX || 0) / SCALE, (t2.y || t2.clientY || 0) / SCALE);
    return;
  }

  // 宝箱（touchEnd 处理：横滑 或 无拖拽时点击卡片）
  if (gameState === STATE.TREASURE) {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const tt = e.changedTouches[0];
    var ttx3 = (tt.x || tt.clientX || 0) / SCALE;
    var tty3 = (tt.y || tt.clientY || 0) / SCALE;
    // 防止从首页按钮进入时同一触摸触发卡片
    if (treasureJustOpened) { treasureJustOpened = false; return; }
    // 横滑完成：提交切换
    if (treasureDetailIdx >= 0 && treasureHoriSwipe) {
      var dx3 = ttx3 - treasureSwipeX;
      var tl3 = ALL_TREASURES;
      var tc3 = ['all','toy','food','life'][treasureTab];
      if (tc3 !== 'all') { var tcs3 = ['玩具文具','零食','生活用品']; tl3 = tl3.filter(function(t){ return t.cat === tcs3[treasureTab-1]; }); }
      if (Math.abs(dx3) > 40) {
        if (dx3 < 0 && treasureDetailIdx < tl3.length - 1) treasureDetailIdx++;
        else if (dx3 > 0 && treasureDetailIdx > 0) treasureDetailIdx--;
      }
    }
    treasureSlideX = 0; treasureHoriSwipe = false;
    // 没有拖拽滚动才处理点击
    if (!treasureDragging) handleTreasureTouch(ttx3, tty3);
    treasureDragging = false;
    return;
  }

  if (!btnPressed) return;

  let isChargeFinger = false;
  if (e.changedTouches) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        isChargeFinger = true;
        break;
      }
    }
  } else {
    isChargeFinger = true;
  }

  if (isChargeFinger) releaseCharge();
});

wx.onTouchCancel(function () {
  if (btnPressed) releaseCharge();
});

function releaseCharge() {
  if (gameState !== STATE.CHARGING) return;
  stopSfx('power');
  chargeParticles = [];
  btnPressed = false;
  touchId = null;

  // 最小蓄力门槛
  if (chargePower < 0.08) {
    chargePower = 0;
    gameState = STATE.IDLE;
    return;
  }

  playSfx('speed');

  // 蓄力映射到速度 (非线性映射)
  const power = Math.pow(chargePower, 1.1);
  const speed = CFG.MIN_SPEED + power * (CFG.MAX_SPEED - CFG.MIN_SPEED);

  // 方向：珠珠底部顶点 → 目标坑中心
  const targetPit = getCurrentTargetPit();
  const aimX = marble.worldX;
  const aimY = marble.worldY;
  let dx = 0, dy = 1;
  if (targetPit) {
    dx = targetPit.worldX - aimX;
    dy = targetPit.worldY - aimY;
    camera.targetY = targetPit.worldY - CFG.CAMERA_OFFSET;
  } else {
    camera.targetY = marble.worldY + 0.10 - CFG.CAMERA_OFFSET;
  }
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  marble.vx = (dx / dist) * speed;
  marble.vy = (dy / dist) * speed;
  chargePower = 0;
  camera.worldY = marble.worldY;
  camera.targetY = marble.worldY;
  gameState = STATE.ROLLING;
}

// ============================================================
// 九、缓存纹理
// ============================================================
let marbleCache = null;
let bgImage = null;
let pitImage = null;
let backImage = null;
let classicBgImg = null; // 经典模式专用背景（预加载）
let currentScene = 'grandma_backyard';
let btnBg1 = null, btnBg2 = null, btnBg3 = null;
let bguImg = null, bgmImg = null, bgbImg = null;
let marbleSkinCache = {};
let marbleTilingCache = {};

// 图标缓存
const uiIcons = {};
function loadIcon(name, path) {
  const img = wx.createImage();
  img.onload = function () { uiIcons[name] = img; };
  img.src = path;
}

function createMarbleCache() {
  // 加载已装备的皮肤
  const skinId = progress.equippedMarble || 'classic_blue';
  // 优先用缓存
  if (marbleSkinCache[skinId]) {
    marbleCache = marbleSkinCache[skinId];
    return;
  }
  const img = wx.createImage();
  img.onload = function () { marbleCache = img; marbleSkinCache[skinId] = img; };
  img.onerror = function () { createProceduralMarble(); };
  img.src = 'assets/images/marbles/' + skinId + '.png';

  // 加载独立平铺纹理（所有皮肤）
  if (!marbleTilingCache[skinId]) {
    const tilingImg = wx.createImage();
    tilingImg.onload = function () { marbleTilingCache[skinId] = tilingImg; };
    tilingImg.src = 'assets/images/marbles/' + skinId + '0.png';
  }
}

// 程序化纹理（兜底）
function createProceduralMarble() {
  const size = 120;
  const off = wx.createCanvas();
  off.width = size;
  off.height = size;
  const g = off.getContext('2d');
  const cx = size / 2, cy = size / 2, r = 52;
  const bodyGrad = g.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.05, cx, cy, r);
  bodyGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
  bodyGrad.addColorStop(0.3, 'rgba(130,190,230,0.72)');
  bodyGrad.addColorStop(0.7, 'rgba(70,130,190,0.60)');
  bodyGrad.addColorStop(1, 'rgba(18,42,90,0.45)');
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = bodyGrad; g.fill();
  marbleCache = off;
}

// ============================================================
// 十、渲染系统
// ============================================================

// --- 背景（垂直循环滚动） ---
// 场景配置
const SCENE_CONFIG = {
  grandma_backyard: { bg: 'grandma_backyard.jpg', pit: 'keng.png' },
  school_sandpit:   { bg: 'school_sandpit.jpg',   pit: 'keng2.png' },
  after_rain_mud:   { bg: 'after_rain_mud.jpg',   pit: 'keng3.png' },
  river_pebbles:    { bg: 'river_pebbles.jpg',    pit: 'keng4.png' },
  old_locust_tree:  { bg: 'old_locust_tree.jpg',  pit: 'keng5.png' },
  summer_threshing: { bg: 'summer_threshing.jpg', pit: 'keng6.png' },
  winter_snow:      { bg: 'winter_snow.jpg',      pit: 'keng7.png' },
  memory_lane:       { bg: 'memory_lane.jpg',       pit: 'keng8.png' },
  eternal_childhood: { bg: 'Forever_Childhood.jpg', pit: 'keng9.png' },
};

var _subBgScenes = ['river_pebbles','old_locust_tree','summer_threshing','winter_snow','memory_lane','Forever_Childhood'];
function _scenePath(fn) { var b=fn.split('.')[0]; for(var i=0;i<_subBgScenes.length;i++){if(b===_subBgScenes[i])return'subpkg_assets/assets/images/scenes/';} return'assets/images/scenes/'; }

function loadPitImage() {
  const cfg = SCENE_CONFIG[currentScene] || SCENE_CONFIG.grandma_backyard;
  const img = wx.createImage();
  img.onload = function () { pitImage = img; };
  img.src = _scenePath(cfg.pit) + cfg.pit;
}

function loadBackImage() {
  const img = wx.createImage();
  img.onload = function () { backImage = img; };
  img.src = 'assets/images/ui/back.png';
}

function loadBgImage() {
  const cfg = SCENE_CONFIG[currentScene] || SCENE_CONFIG.grandma_backyard;
  const img = wx.createImage();
  img.onload = function () { bgImage = img; };
  img.src = _scenePath(cfg.bg) + cfg.bg;
}

function switchScene(sceneId) {
  currentScene = sceneId;
  bgImage = null; pitImage = null;
  loadBgImage(); loadPitImage();
}

function drawSky() {
  if (bgImage && bgImage.width > 0) {
    // 缩放填满屏幕（cover 模式）
    const iw = bgImage.width, ih = bgImage.height;
    const scale = Math.max(W / iw, H / ih);
    const sw = iw * scale, sh = ih * scale;
    const sx = (W - sw) / 2;

    // 背景跟随坑同步移动，垂直循环
    const scrollH = sh;
    const offset = (camera.worldY * H * 0.4) % scrollH;
    ctx.drawImage(bgImage, sx, offset, sw, sh + 2);
    ctx.drawImage(bgImage, sx, offset - scrollH, sw, sh + 2);
    ctx.drawImage(bgImage, sx, offset + scrollH, sw, sh + 2);
  } else {
    ctx.fillStyle = '#7a9e5e';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawGround() {
  // 由 drawSky 统一处理
}

// --- 坑（俯视圆形） ---
const PIT_R = 39;  // 坑半径（≈ 珠珠30px × 1.3）

function drawPit(pit) {
  const p = worldToScreen(pit.worldX, pit.worldY);
  if (p.y < -60 || p.y > H + 60) return;

  const alpha = (pit.alpha !== undefined) ? pit.alpha : 1;
  if (alpha < 0.02) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (pitImage && pitImage.width > 0) {
    // 使用贴图
    const s = (0.8 + (pit.radius - 0.045) * 4);
    const imgW = pitImage.width;
    const size = PIT_R * 3.5 * s;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(pit.rotation || 0);
    ctx.drawImage(pitImage, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    // 兜底：程序化圆坑
    const s = 0.8 + (pit.radius - 0.045) * 4;
    const r = PIT_R * s;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, '#2a1608');
    g.addColorStop(0.7, '#543018');
    g.addColorStop(1, '#7d4d28');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
}

// --- 珠珠（真实滚动效果 + 投影） ---
const MARBLE_R = 30;  // 屏幕半径（直径60）

function drawMarble() {
  if (!marbleCache) createMarbleCache();

  const p = worldToScreen(marble.worldX, marble.worldY);
  const alpha = marble.alpha;
  if (alpha <= 0.01) return;

  const r = MARBLE_R * marble.scale;
  const x = p.x;
  const y = p.y + (marble.sinkY || 0);

  // ===== 亮色小投影 =====
  const slx = x - r * 0.20;
  const sly = y + r * 0.25;
  const slg = ctx.createRadialGradient(slx, sly, r * 0.4, slx, sly, r * 0.8);
  slg.addColorStop(0, 'rgba(255,255,255,0.30)');
  slg.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  slg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(slx, sly, r * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = slg;
  ctx.fill();

  // ===== 投影（偏左下，硬边） =====
  var popupOff = (gameState === STATE.SKIN || gameState === STATE.RANK || gameState === STATE.BADGES || gameState === STATE.SETTINGS || gameState === STATE.CONFIRM || gameState === STATE.STORY) ? r * 0.5 : 0;
  const sx = x - r * 0.25 + popupOff;
  const sy = y + r * 0.50;
  const sg = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 1.2);
  sg.addColorStop(0, 'rgba(0,0,0,0.50)');
  sg.addColorStop(0.15, 'rgba(0,0,0,0.35)');
  sg.addColorStop(0.4, 'rgba(0,0,0,0.05)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(sx, sy, r * 1.2, 0, Math.PI * 2);
  ctx.fillStyle = sg;
  ctx.fill();

  // ===== 速度线（珠珠下面，拖尾） =====
  const spd = Math.sqrt(marble.vx * marble.vx + marble.vy * marble.vy);
  const nextPit2 = pits.find(p => !p.visited);
  if (spd > 0.15 && gameState === STATE.ROLLING && (!nextPit2 || marble.worldY < nextPit2.worldY)) {
    var dx2 = marble.vx / Math.max(spd, 0.001), dy2 = marble.vy / Math.max(spd, 0.001);
    if (nextPit2) {
      const ldx2 = nextPit2.worldX - marble.worldX, ldy2 = nextPit2.worldY - marble.worldY;
      const ld2 = Math.sqrt(ldx2*ldx2 + ldy2*ldy2) || 1;
      dx2 = ldx2 / ld2; dy2 = ldy2 / ld2;
    }
    const px2 = -dy2, py2 = dx2;
    const la2 = Math.min(0.8, spd * 0.9);
    for (let s = -1; s <= 1; s += 2) {
      for (let j = 0; j < 3; j++) {
        const d2 = r * (0.2 + j * 0.3);
        const sx2 = x + px2 * s * d2, sy2 = y + py2 * s * d2;
        const len2 = r * spd * 3 * (1.2 - j * 0.3);
        const ex2 = sx2 - dx2 * len2, ey2 = sy2 + dy2 * len2;
        ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(ex2, ey2);
        ctx.strokeStyle = 'rgba(255,255,255,' + (la2 * (1 - j * 0.3)) + ')';
        ctx.lineWidth = 1.2 + j * 0.5; ctx.lineCap = 'round'; ctx.stroke();
      }
    }
  }

  // ===== 珠珠主体（纹理滚动 + 循环拼接） =====
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  if (marbleCache) {
    const imgW = marbleCache.width || 120;
    const imgH = marbleCache.height || imgW;
    const baseScale = (r * 2) / imgW;
    const s = baseScale * marble.scale;
    ctx.scale(s, s);

    // 裁剪圆形，先填充底色防黑角
    const clipR = imgW / (2.0 * (marble.scale || 1));
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, clipR), 0, Math.PI * 2);
    ctx.fillStyle = '#1a2a4a';
    ctx.fill();
    ctx.clip();

    // 底层：固定背景（不跟随滚动）
    ctx.globalAlpha = 0.8;
    ctx.drawImage(marbleCache, -imgW/2, -imgH/2);
    ctx.globalAlpha = 1;

    // 纹理偏移（循环取模）
    const ox = ((marble.texOffX || 0) % imgW + imgW) % imgW;
    const oy = ((marble.texOffY || 0) % imgH + imgH) % imgH;

    // 使用独立平铺纹理（所有皮肤）
    const skinId = progress.equippedMarble || 'classic_blue';
    const tilingImg = marbleTilingCache[skinId] || marbleCache;
    const tileW = tilingImg.width || imgW;
    const tileH = tilingImg.height || imgH;

    // 矩阵平铺（不翻转，消除跳帧）
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        const flipX = false;
        const flipY = false;
        // 翻转2次=180°→取消位移；翻转1次→错位50%
        const both = flipX && flipY;
        const offX = (!both && flipY) ? tileW / 2 : 0;
        const offY = (!both && flipX) ? tileH / 2 : 0;
        const dx = -tileW / 2 - ox + col * tileW + offX;
        const dy = -tileH / 2 - oy + row * tileH + offY;
        ctx.save();
        if (flipX || flipY) {
          ctx.translate(dx + (flipX ? tileW / 2 : 0), dy + (flipY ? tileH / 2 : 0));
          ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          ctx.drawImage(tilingImg, -tileW / 2, -tileH / 2);
        } else {
          ctx.drawImage(tilingImg, dx, dy);
        }
        ctx.restore();
      }
    }
  }

  ctx.restore();

  // ===== 内阴影（玻璃球背光面，画在主体之上） =====
  const innerSR = r * 0.80;
  // 外层内阴影（白色光晕，外圈）
  const innerSG = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
  innerSG.addColorStop(0, 'rgba(255,255,255,0)');
  innerSG.addColorStop(0.5, `rgba(255,255,255,${0.04 * alpha})`);
  innerSG.addColorStop(1, `rgba(255,255,255,${0.12 * alpha})`);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2, true);
  ctx.fillStyle = innerSG; ctx.fill();
  // 第二层：小范围深色外圈
  const sgD = ctx.createRadialGradient(x, y, r * 0.7, x, y, r);
  sgD.addColorStop(0, 'rgba(0,0,0,0)');
  sgD.addColorStop(0.3, `rgba(0,0,0,${0.08 * alpha})`);
  sgD.addColorStop(1, `rgba(0,0,0,${0.20 * alpha})`);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x, y, r * 0.7, 0, Math.PI * 2, true);
  ctx.fillStyle = sgD; ctx.fill();

  // ===== 高光（不受旋转影响，始终朝上——模拟固定光源） =====
  if (alpha > 0.5) {
    // 主高光（左上）
    const hx = x - r * 0.3, hy = y - r * 0.38, hr = r * 0.22;
    const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    hl.addColorStop(0, `rgba(255,255,255,${0.90 * alpha})`);
    hl.addColorStop(0.4, `rgba(255,255,255,${0.40 * alpha})`);
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = hl;
    ctx.fill();

    // 次高光（右上小点）
    const sx = x + r * 0.35, sy = y - r * 0.42;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.55 * alpha})`;
    ctx.fill();

    // 底部反光（地面反射的微弱暖光）
    const bx = x - r * 0.1, by = y + r * 0.55, br = r * 0.15;
    const bl = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    bl.addColorStop(0, `rgba(180,150,120,${0.18 * alpha})`);
    bl.addColorStop(1, 'rgba(180,150,120,0)');
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = bl;
    ctx.fill();
  }
}

// --- 蓄力指示环（屏幕居中） ---
// 蓄力粒子
let chargeParticles = [];

function spawnChargeParticle() {
  const p = worldToScreen(marble.worldX, marble.worldY);
  const angle = Math.random() * Math.PI * 2;
  const dist = 50 + Math.random() * 60;
  const r = 2 + Math.random() * 3;
  return {
    x: p.x + Math.cos(angle) * dist,
    y: p.y + Math.sin(angle) * dist,
    r: r,
    life: 0.3 + Math.random() * 0.35,
    age: 0,
    alpha: 0.4 + Math.random() * 0.4,  // 更明显的透明度
    targetX: p.x,
    targetY: p.y,
  };
}

function updateChargeParticles(dt) {
  if (chargeParticles.length < 20) {
    chargeParticles.push(spawnChargeParticle());
  }
  for (let i = chargeParticles.length - 1; i >= 0; i--) {
    const cp = chargeParticles[i];
    cp.age += dt;
    if (cp.age >= cp.life) {
      chargeParticles.splice(i, 1);
      continue;
    }
    // 加速汇聚（乘 6 比之前的 3 快一倍）
    cp.x += (cp.targetX - cp.x) * 8 * dt;
    cp.y += (cp.targetY - cp.y) * 8 * dt;
  }
}

function drawChargeParticles() {
  for (const cp of chargeParticles) {
    const t = cp.age / cp.life;
    const fade = (1 - t) * cp.alpha;
    const r = cp.r;
    // 外层大光晕
    const g1 = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, r * 4);
    g1.addColorStop(0, `rgba(255,215,80,${0.25 * fade})`);
    g1.addColorStop(0.5, `rgba(255,180,40,${0.12 * fade})`);
    g1.addColorStop(1, 'rgba(255,180,40,0)');
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, r * 3.5, 0, Math.PI * 2);
    ctx.fillStyle = g1;
    ctx.fill();
    // 中层光晕
    const g2 = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, r * 2);
    g2.addColorStop(0, `rgba(255,230,120,${0.4 * fade})`);
    g2.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, r * 2, 0, Math.PI * 2);
    ctx.fillStyle = g2;
    ctx.fill();
    // 核心亮点
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,245,200,${0.8 * fade})`;
    ctx.fill();
  }
}

function drawChargeIndicator() {
  // 仅保留蓄力粒子特效，隐藏进度条
  if (gameState === STATE.CHARGING) drawChargeParticles();
  return;

  const barX = W - 38;
  const barW = 16;
  const barH = 133;
  const barY = (H - barH) / 2;

  // 背景槽
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRectPath(barX, barY, barW, barH, barW / 2);
  ctx.fill();

  // 填充（从下往上）
  const fillH = barH * chargePower;
  if (fillH > 0) {
    const fillY = barY + barH - fillH;
    const fillGrad = ctx.createLinearGradient(0, barY + barH, 0, barY);
    fillGrad.addColorStop(0, '#7cc850');
    fillGrad.addColorStop(0.5, '#e6be32');
    fillGrad.addColorStop(1, '#e65032');
    ctx.fillStyle = fillGrad;
    roundRectPath(barX, fillY, barW, fillH, barW / 2);
    ctx.fill();

    // 能量顶部闪烁光点
    const topY = fillY;
    const pcx = barX + barW / 2;
    // 粒子数随蓄力值变化：3→8
    const particleCount = Math.round(3 + chargePower * 5);
    for (let i = 0; i < particleCount; i++) {
      const ang = (Date.now() * 0.003 + i * 0.8) % (Math.PI * 2);
      const d = barW * (0.3 + (i % 3) * 0.3) + Math.sin(Date.now() * 0.01 + i) * 4;
      const px = pcx + Math.cos(ang) * d;
      const py = topY - 4 + Math.sin(ang * 2) * 6;
      const pr = 1 + (i % 4) * 0.8 + Math.sin(Date.now() * 0.015 + i) * 0.5;
      const gl = ctx.createRadialGradient(px, py, 0, px, py, pr * 3);
      gl.addColorStop(0, 'rgba(255,255,220,0.9)');
      gl.addColorStop(0.4, 'rgba(255,220,100,0.5)');
      gl.addColorStop(1, 'rgba(255,200,50,0)');
      ctx.beginPath();
      ctx.arc(px, py, pr * 3, 0, Math.PI * 2);
      ctx.fillStyle = gl;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,240,0.95)';
      ctx.fill();
    }
  }

}

// --- 模式标题 ---
function drawModeTitle() {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  if (gameMode === 'endless') {
    ctx.fillText('无尽模式', W / 2, CAPSULE_MID_Y + 5);
  } else if (gameMode === 'classic') {
    ctx.fillText('经典模式', W / 2, CAPSULE_MID_Y + 5);
  } else {
    ctx.fillText('第' + currentLevel + '关 ' + (LEVEL_NAMES[currentLevel] || ''), W / 2, CAPSULE_MID_Y + 5);
  }
}

// --- 闯关进度条（左侧竖条） ---
function drawLevelProgress() {
  if (gameMode !== 'levels') return;

  const target = LEVEL_TARGETS[currentLevel] || 10;
  const barX = 14, barW = 16, barH = 133, barY = (H - barH) / 2;

  // 背景槽
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  roundRectPath(barX, barY, barW, barH, barW / 2);
  ctx.fill();

  // 填充
  const progress = Math.min(1, score / target);
  const fillH = barH * progress;
  if (fillH > 0) {
    const fillY = barY + barH - fillH;
    const g = ctx.createLinearGradient(0, barY + barH, 0, barY);
    g.addColorStop(0, '#7cc850');
    g.addColorStop(0.5, '#e6be32');
    g.addColorStop(1, '#e65032');
    ctx.fillStyle = g;
    roundRectPath(barX, fillY, barW, fillH, barW / 2);
    ctx.fill();
  }

  // 小球（珠珠纹理 + 投影）
  const ballY = barY + barH - fillH;
  const bcx = barX + barW / 2;
  // 投影
  ctx.beginPath();
  ctx.arc(bcx + 1, ballY + 1, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  if (marbleCache) {
    const br = 10;
    ctx.save();
    ctx.beginPath();
    ctx.arc(bcx, ballY, br, 0, Math.PI * 2);
    ctx.clip();
    const bs = (br * 2) / (marbleCache.width || 120) * 2;
    ctx.drawImage(marbleCache, bcx - marbleCache.width * bs / 2, ballY - marbleCache.width * bs / 2, marbleCache.width * bs, marbleCache.width * bs);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(bcx, ballY, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  // 内阴影
  const isg = ctx.createRadialGradient(bcx + 3, ballY + 2, 1, bcx, ballY, 10);
  isg.addColorStop(0, 'rgba(255,255,255,0)');
  isg.addColorStop(0.6, 'rgba(0,0,0,0)');
  isg.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.beginPath();
  ctx.arc(bcx, ballY, 10, 0, Math.PI * 2);
  ctx.fillStyle = isg;
  ctx.fill();

  // 进度数字
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(target, barX + barW / 2, barY - 8);
}

// --- 分数 ---
function drawScore() {
  // 分数（左上角，闯关模式显示目标）
  const sy = H * 0.15 + 20;
  ctx.textAlign = 'left';

  ctx.font = 'bold 48px sans-serif';
  // 投影
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillText(String(score), 22, sy + 2);
  // 主体
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(score), 20, sy);

  // 当局最高连击
  if (gameMode !== 'classic') {
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillText('连进 ' + sessionBestCombo, 22 + 1, sy + 27);
    ctx.fillStyle = '#fff';
    ctx.fillText('连进 ' + sessionBestCombo, 22, sy + 26);
  }
}

// --- 最高分 ---
function drawBestScore() {
  // 已合并到 drawScore
}

// --- 生命显示（右上角） ---
function drawLives() {
  ctx.textAlign = 'left';
  const ly = H * 0.15;
  if (uiIcons.heart) {
    const hs = 32;
    ctx.drawImage(uiIcons.heart, W - 78, ly - hs / 2, hs, hs);
    // 数字投影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(livesData.lives, W - 41, ly + 7);
    ctx.fillStyle = '#fff';
    ctx.fillText(livesData.lives, W - 43, ly + 6);
  } else {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillText('* ' + livesData.lives, W - 18, ly + 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('* ' + livesData.lives, W - 20, ly);
  }
  // 关卡选择按钮（chose.png，44x44，右移10px）
  if (gameMode === 'levels') {
    if (uiIcons.chose && uiIcons.chose.width) {
      ctx.drawImage(uiIcons.chose, W - 71, ly + 81, 44, 44);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      roundRectPath(W - 71, ly + 81, 44, 44, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('选', W - 49, ly + 108);
    }
  }
}

// --- 游戏结束弹窗 ---
function drawGameOver() {
  // 遮罩（全屏）
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);

  // 弹窗卡片（水平垂直居中）
  const cw = W * 0.75;
  const ch = (gameState === STATE.LOST && livesData.lives > 0) ? 250 : 240;
  const cx = Math.floor((W - cw) / 2);
  const cy = Math.floor((H - ch) / 2);
  drawPopupBg3(cx, cy, cw, ch, 16);

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  if (gameMode === 'levels' && marble._levelCleared) {
    ctx.fillText('通关成功！', W / 2, cy + 40);
  } else if (gameMode === 'levels' && marble._levelFailed) {
    ctx.fillText('很遗憾...', W / 2, cy + 40);
  } else {
    ctx.fillText('珠珠差一点进了', W / 2, cy + 50);
  }

  // 分数
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 52px sans-serif';
  ctx.fillText(String(score), W / 2, cy + 110);

  // 闯关失败提示
  if (gameMode === 'levels' && marble._levelFailed) {
    ctx.fillStyle = '#555';
    ctx.font = '12px sans-serif';
    ctx.fillText('还差 ' + marble._pitsShort + ' 个坑，再接再厉！', W / 2, cy + 138);
  } else if (gameMode === 'levels' && marble._levelCleared) {
    ctx.fillStyle = '#8B6914';
    ctx.font = '13px sans-serif';
    ctx.fillText('🎉 解锁 ' + LEVEL_NAMES[currentLevel] + '！', W / 2, cy + 138);
  } else {
    // 最高分（无尽模式）
    ctx.fillStyle = '#555';
    ctx.font = '13px sans-serif';
    ctx.fillText('最高纪录 ' + bestScore, W / 2, cy + 138);
  }

  // 首页按钮
  if (uiIcons.home) {
    ctx.drawImage(uiIcons.home, cx + 22, cy + 24, 32, 32);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🏠', cx + 10, cy + 28);
  }

  // 按钮区域
  if (gameState === STATE.LOST && livesData.lives > 0) {
    // 两个按钮并排
    var bw = cw * 0.4, bh = 44;
    var by = cy + 160;
    var bx1 = (W - bw*2 - 16) / 2;
    var bx2 = bx1 + bw + 16;

    // 重新开始（左，#ED971C）
    ctx.fillStyle = '#ED971C';
    roundRectPath(bx1, by, bw, bh, 12);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('重新开始', bx1 + bw / 2, by + bh / 2 + 6);

    // * 继续（右，20%）
    ctx.fillStyle = 'rgba(237,151,28,0.2)';
    roundRectPath(bx2, by, bw, bh, 12);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 18px sans-serif';
    if (uiIcons.heart) {
      ctx.drawImage(uiIcons.heart, bx2 + bw / 2 - 28, by + bh / 2 - 9, 18, 18);
      ctx.fillText('继续', bx2 + bw / 2 + 14, by + bh / 2 + 6);
    } else {
      ctx.fillText('* 继续', bx2 + bw / 2, by + bh / 2 + 5);
    }
  } else {
    // 爱心用完 → 两个按钮并排：重新开始 + 获得爱心
    var bw3 = Math.floor(cw * 0.4), bh3 = 44;
    var by3 = cy + 160;
    var bxL = Math.floor((W - bw3*2 - 16) / 2);
    var bxR = bxL + bw3 + 16;
    // 重新开始（左，#ED971C）
    ctx.fillStyle = '#ED971C';
    roundRectPath(bxL, by3, bw3, bh3, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('重新开始', bxL + bw3/2, by3 + bh3/2 + 5);
    // 获得爱心继续（右，#4CAF50）
    ctx.fillStyle = '#4CAF50';
    roundRectPath(bxR, by3, bw3, bh3, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText('获得爱心', bxR + bw3/2, by3 + bh3/2 + 5);
  }
}

// --- 通关弹窗 ---
function drawWinPopup() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);

  const cw = W * 0.75;
  const ch = 240;
  const cx = Math.floor((W - cw) / 2), cy = Math.floor((H - ch) / 2);

  drawPopupBg3(cx, cy, cw, ch, 16);

  ctx.textAlign = 'center';
  // 闯关成功
  ctx.fillStyle = '#ED971C';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('闯关成功', W / 2, cy + 50);

  // 解锁新场景（在上面）
  var nextLevel = currentLevel + 1;
  ctx.fillStyle = '#888';
  ctx.font = '14px sans-serif';
  ctx.fillText('解锁新场景：' + (LEVEL_NAMES[nextLevel] || ''), W / 2, cy + 82);

  // 第X关（显示下一关）
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('第 ' + nextLevel + ' 关', W / 2, cy + 122);

  // 继续游戏按钮
  var bw3 = cw * 0.5, bh3 = 44, by3 = cy + 150;
  ctx.fillStyle = '#ED971C';
  roundRectPath(W/2 - bw3/2, by3, bw3, bh3, 12); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('继续游戏', W/2, by3 + bh3/2 + 6);

  // 下一关目标
  ctx.fillStyle = '#777';
  ctx.font = '12px sans-serif';
  ctx.fillText('下一关目标：' + (LEVEL_TARGETS[nextLevel] || 500) + '个球', W / 2, by3 + bh3 + 22);
}

function handleWinTouch(tx, ty) {
  const cw = W * 0.8, ch = 240;
  const cx = Math.floor((W - cw) / 2), cy = Math.floor((H - ch) / 2);
  if (tx > cx + 10 && tx < cx + 55 && ty > cy + 5 && ty < cy + 60) { currentLevel = maxUnlockedLevel; goHome(); return true; }

  var bw3 = cw * 0.5, bh3 = 44, by3 = cy + 150;
  if (tx > W/2 - bw3/2 && tx < W/2 + bw3/2 && ty > by3 && ty < by3 + bh3) {
    currentLevel++;
    maxUnlockedLevel = Math.max(maxUnlockedLevel, currentLevel);
    livesData.lives = 3;
    switchScene(LEVEL_SCENES[currentLevel] || 'grandma_backyard');
    if (bgmAudio && musicOn) bgmAudio.play();
    restartGame();
    return true;
  }
  return false;
}

// --- 三段式弹窗背景 ---
function drawPopupBg3(cx, cy, cw, ch, radius) {
  ctx.save();
  roundRectPath(cx, cy, cw, ch, radius); ctx.clip();
  if (bguImg && bgmImg && bgbImg && bguImg.width) {
    // 顶部
    var topH = bguImg.height * (cw / bguImg.width);
    ctx.drawImage(bguImg, cx, cy, cw, topH + 1);
    // 底部
    var botH = bgbImg.height * (cw / bgbImg.width);
    ctx.drawImage(bgbImg, cx, cy + ch - botH - 1, cw, botH + 1);
    // 中间循环
    var midTop = cy + topH - 1, midBot = cy + ch - botH + 1;
    if (midBot > midTop && bgmImg.height > 0) {
      var midH = bgmImg.height * (cw / bgmImg.width) || 16;
      for (var my = midTop; my < midBot; my += midH) {
        ctx.drawImage(bgmImg, cx, my, cw, Math.min(midH + 1, midBot - my + 1));
      }
    }
  } else {
    ctx.fillStyle = 'rgba(40,30,20,0.95)';
    ctx.fillRect(cx, cy, cw, ch);
  }
  ctx.restore();
}

// --- 换肤弹窗 ---
const MARBLE_SKINS = [
  { id:'classic_blue', name:'经典蓝珠' },
  { id:'moonlight_white', name:'月光白石' },
  { id:'emerald_green', name:'翡翠青珠' },
  { id:'amber_gold', name:'琥珀金珠' },
  { id:'purple_crystal', name:'紫晶葡萄' },
  { id:'flame_red', name:'赤焰红珠' },
  { id:'tiger_eye_brown', name:'虎眼棕珠' },
  { id:'ink_black', name:'墨玉黑珠' },
  { id:'orange_soda', name:'橘子汽水' },
  { id:'mint_blue', name:'薄荷蓝珠' },
  { id:'sakura_pink', name:'樱花粉珠' },
  { id:'rainbow_phantom', name:'彩虹幻珠' },
];
let skinTab = 0;
let skinScrollY = 0;
let bgmAudio = null;
let musicOn = true;
let musicVolume = 0.35;
let sfxOn = true;

// 音效
let sfxPool = {};
function playSfx(name) {
  if (!sfxOn) return;
  var a = sfxPool[name];
  if (!a) return;
  a.stop();
  a.seek(0);
  a.play();
}
function stopSfx(name) {
  var a = sfxPool[name];
  if (a) { a.stop(); }
}

function drawSkinPopup() {
  drawHomePage();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);

  const cw = W * 0.9, ch = H * 0.66;
  const cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('皮肤', W / 2, cy + 35);

  // 关闭按钮
  ctx.fillStyle = '#222';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  // 标签
  const tabY = cy + 58;
  const tabW = (cw - 50) / 2;
  const tabH = 36;
  ctx.fillStyle = skinTab === 0 ? '#ED971C' : 'rgba(237,151,28,0.5)';
  roundRectPath(cx + 20, tabY, tabW, tabH, 6);
  ctx.fill();
  ctx.fillStyle = skinTab === 0 ? '#1a1a1a' : 'rgba(0,0,0,0.5)';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('珠珠皮肤', cx + 25 + tabW / 2, tabY + tabH / 2 + 5);
  // 场景皮肤标签（右对齐，边距20）
  ctx.fillStyle = skinTab === 1 ? '#ED971C' : 'rgba(237,151,28,0.5)';
  var tabRight = cx + cw - 20;
  roundRectPath(tabRight - tabW, tabY, tabW, tabH, 6);
  ctx.fill();
  ctx.fillStyle = skinTab === 1 ? '#1a1a1a' : 'rgba(0,0,0,0.5)';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('场景皮肤', tabRight - tabW / 2, tabY + tabH / 2 + 5);

  // 珠珠皮肤列表
  if (skinTab === 0) {
    const hGap = 12, cols = 4;
    const itemW = (cw - 50 - hGap * (cols - 1)) / cols, itemH = itemW + 35;
    const startY = tabY + tabH + 15;
    for (let i = 0; i < MARBLE_SKINS.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const ix = cx + 25 + col * (itemW + hGap), iy = startY + row * (itemH + 12);
      const s = MARBLE_SKINS[i];
      const owned = progress.unlockedMarbles.includes(s.id);
      const equipped = progress.equippedMarble === s.id;

      // 背景
      ctx.fillStyle = 'rgba(237,151,28,0.3)';
      roundRectPath(ix, iy + 2, itemW, itemH - 4, 12);
      ctx.fill();

      // 选中描边
      if (equipped) {
        ctx.strokeStyle = '#ED971C';
        ctx.lineWidth = 2;
        roundRectPath(ix, iy + 2, itemW, itemH - 4, 12);
        ctx.stroke();
      }

      // 珠珠图片
      if (owned && marbleSkinCache[s.id]) {
        const ir = itemW / 2 - 12;
        const imgW = marbleSkinCache[s.id].width;
        const imgH = marbleSkinCache[s.id].height;
        const scale = (ir * 2) / Math.max(imgW, imgH);
        const dw = imgW * scale, dh = imgH * scale;
        const mcY = iy + itemW / 2 - 4;
        ctx.save();
        ctx.beginPath();
        ctx.arc(ix + itemW / 2, mcY, ir, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(marbleSkinCache[s.id], ix + itemW/2 - dw/2, mcY - dh/2, dw, dh);
        ctx.restore();
      } else if (!owned) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(ix + itemW / 2, iy + itemW / 2 - 4, itemW / 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // NEW角标（默认经典蓝不显示）
      if (s.id !== 'classic_blue' && owned && (seenMarbles || []).indexOf(s.id) === -1) {
        ctx.beginPath(); ctx.arc(ix + itemW - 10, iy + 10, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#4CAF50'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('NEW', ix + itemW - 10, iy + 12);
      }
      // 名称
      var nameY = iy + itemW / 2 + (itemW/2 - 12) + 16;
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, ix + itemW / 2, nameY);
      // 解锁条件
      var condText = '';
      if (s.id === 'moonlight_white') condText = '累计80坑';
      else if (s.id === 'emerald_green') condText = '累计200坑';
      else if (s.id === 'amber_gold') condText = '累计400坑';
      else if (s.id === 'tiger_eye_brown') condText = '累计800坑';
      else if (s.id === 'ink_black') condText = '累计1500坑';
      else if (s.id === 'purple_crystal') condText = '连击≥30';
      else if (s.id === 'flame_red') condText = '连击≥50';
      else if (s.id === 'orange_soda') condText = '累计3000坑';
      else if (s.id === 'mint_blue') condText = '累计5000坑';
      else if (s.id === 'sakura_pink') condText = '累计8000坑';
      else if (s.id === 'rainbow_phantom') condText = '累计15000坑';
      else if (s.id === 'classic_blue') condText = '初始拥有';
      if (condText) {
        ctx.fillStyle = '#333';
        ctx.font = '9px sans-serif';
        ctx.fillText(condText, ix + itemW / 2, nameY + 15);
      }

      // 使用中标记（右上角绿色圆底白色勾）
      if (equipped) {
        ctx.beginPath();
        ctx.arc(ix + itemW - 4, iy + 6, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#4CAF50';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('✓', ix + itemW - 4, iy + 10);
      }
    }
  } else {
    // 场景列表（可滚动）
    const sceneList = [
      { id:'grandma_backyard', name:'外婆的后院' },
      { id:'school_sandpit', name:'学校的沙坑' },
      { id:'after_rain_mud', name:'雨后的泥地' },
      { id:'river_pebbles', name:'河边的卵石滩' },
      { id:'old_locust_tree', name:'老槐树下' },
      { id:'summer_threshing', name:'夏日傍晚的晒谷场' },
      { id:'winter_snow', name:'初雪的院子' },
      { id:'memory_lane', name:'回忆的小巷' },
      { id:'eternal_childhood', name:'永远的童年' },
    ];
    const listTop = tabY + tabH + 15;
    const listBottom = cy + ch - 25;
    // 裁剪滚动区域
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx + 5, listTop, cw - 10, listBottom - listTop);
    ctx.clip();
    var tabRight3 = cx + 25 + 4 * ((cw - 50) / 4);
    var cardW = tabRight3 - (cx + 25);
    var cardH = 80;
    ctx.textAlign = 'left';
    for (let i = 0; i < sceneList.length; i++) {
      const sc = sceneList[i];
      const sy = listTop + i * (cardH + 8) + skinScrollY;
      if (sy + cardH < listTop || sy > listBottom) continue;  // 裁剪
      const owned = progress.unlockedScenes.includes(sc.id);
      const equipped = progress.equippedScene === sc.id;
      // 场景缩略图（按需加载，修复闭包）
      var sceneImg = marbleSkinCache[sc.id + '_scene'];
      if (!sceneImg && sc.id) {
        (function(sid) {
          var simg = wx.createImage();
          simg.onload = function() { marbleSkinCache[sid + '_scene'] = simg; };
          var cfg = SCENE_CONFIG[sid];
          var fn2 = cfg ? cfg.bg : (sid + '.jpg');
          simg.src = _scenePath(fn2) + fn2;
        })(sc.id);
      }
      // 纯黑背景 + 图片（都在圆角内，未解锁图片20%透明）
      ctx.save();
      roundRectPath(cx + 25, sy, cardW, cardH, 14); ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(cx + 25, sy, cardW, cardH);
      if (sceneImg && sceneImg.width) {
        if (!owned) ctx.globalAlpha = 0.2;
        const iw = sceneImg.width, ih = sceneImg.height;
        const s = Math.max(cardW / iw, cardH / ih);
        const dw = iw * s, dh = ih * s;
        ctx.drawImage(sceneImg, cx + 25 + (cardW - dw) / 2, sy + (cardH - dh) / 2, dw, dh);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // 名称
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(sc.name, cx + 36, sy + cardH - 9);
      ctx.fillStyle = '#fff';
      ctx.fillText(sc.name, cx + 35, sy + cardH - 10);
      // NEW角标（默认外婆后院不显示）
      if (sc.id !== 'grandma_backyard' && owned && (seenScenes || []).indexOf(sc.id) === -1) {
        ctx.beginPath(); ctx.arc(cx + 25 + cardW - 10, sy + 10, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#4CAF50'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('NEW', cx + 25 + cardW - 10, sy + 12);
      }
      // 按钮（右边垂直居中，高36）
      var by = sy + (cardH - 36) / 2;
      var bx = cx + 25 + cardW - 80;
      if (equipped) {
        ctx.fillStyle = '#ED971C';
        roundRectPath(bx, by, 65, 36, 8); ctx.fill();
        ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('使用中', bx + 32, by + 24);
      } else if (owned) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        roundRectPath(bx, by, 65, 36, 8); ctx.fill();
        ctx.fillStyle = '#1a1a1a'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('使用', bx + 32, by + 24);
      } else {
        // 未解锁：锁图标
        var lockX = cx + 25 + cardW - 44, lockY = sy + (cardH - 20) / 2;
        if (uiIcons.lock && uiIcons.lock.width) {
          ctx.drawImage(uiIcons.lock, lockX, lockY, 20, 20);
        }
      }
    }
    ctx.restore();
  }
}

let skinTouchStartY = 0, skinScrollStart = 0;
let rankTouchStartY = 0, rankScrollStart2 = 0;
let homeDragMarble = null;
let homeDragLastX = 0, homeDragLastY = 0;

function handleSkinTouch(tx, ty) {
  const cw = W * 0.9, ch = H * 0.66;
  const cx = (W - cw) / 2, cy = (H - ch) / 2;
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy - 5 && ty < cy + 55) {
    seenMarbles = (progress.unlockedMarbles || []).filter(function(m) { return m !== 'classic_blue'; }); seenScenes = (progress.unlockedScenes || []).filter(function(s) { return s !== 'grandma_backyard'; });
    try { wx.setStorageSync("zhuzhu_seen_marbles", seenMarbles); wx.setStorageSync("zhuzhu_seen_scenes", seenScenes); } catch(e) {}
    gameState = STATE.HOME; return true;
  }
  const tabY = cy + 58, tabH = 36, tabW = (cw - 50) / 2;
  if (ty > tabY && ty < tabY + tabH) {
    if (tx > cx + 20 && tx < cx + 20 + tabW) { skinTab = 0; skinScrollY = 0; return true; }
    if (tx > cx + cw - 20 - tabW && tx < cx + cw - 20) { skinTab = 1; skinScrollY = 0; return true; }
  }
  // 记录滚动起始位置（用于touchMove）
  if (skinTab === 1) {
    skinTouchStartY = ty;
    skinScrollStart = skinScrollY;
  }
  if (skinTab === 0) {
    const hGap = 12, cols = 4;
    const itemW = (cw - 50 - hGap * (cols - 1)) / cols, itemH = itemW + 35;
    const startY = tabY + tabH + 15;
    for (let i = 0; i < MARBLE_SKINS.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const ix = cx + 25 + col * (itemW + hGap), iy = startY + row * (itemH + 12);
      // 点击整个卡片即可装备
      if (tx > ix && tx < ix + itemW - 8 && ty > iy && ty < iy + itemH) {
        const s = MARBLE_SKINS[i];
        if (progress.unlockedMarbles.includes(s.id)) {
          progress.equippedMarble = s.id; saveAllData();
          marbleCache = marbleSkinCache[s.id] || null;
          // 加载独立平铺纹理（所有皮肤）
          if (!marbleTilingCache[s.id]) {
            const tilingImg = wx.createImage();
            tilingImg.onload = function () { marbleTilingCache[s.id] = tilingImg; };
            tilingImg.src = 'assets/images/marbles/' + s.id + '0.png';
          }
        }
        return true;
      }
    }
  } else {
    const sceneList = [
      { id:'grandma_backyard', name:'外婆的后院' },
      { id:'school_sandpit', name:'学校的沙坑' },
      { id:'after_rain_mud', name:'雨后的泥地' },
      { id:'river_pebbles', name:'河边的卵石滩' },
      { id:'old_locust_tree', name:'老槐树下' },
      { id:'summer_threshing', name:'夏日傍晚的晒谷场' },
      { id:'winter_snow', name:'初雪的院子' },
      { id:'memory_lane', name:'回忆的小巷' },
      { id:'eternal_childhood', name:'永远的童年' },
    ];
    const startY = tabY + tabH + 15, cardH = 80;
    for (let i = 0; i < sceneList.length; i++) {
      var sceneCardW = (cx + 25 + 4 * ((cw - 50) / 4)) - (cx + 25);
      var sy2 = startY + i * (80 + 10) + skinScrollY, by2 = sy2 + (80 - 36) / 2, bx2 = cx + 25 + sceneCardW - 80;
      if (tx > bx2 && tx < bx2 + 65 && ty > by2 && ty < by2 + 36) {
        const sc = sceneList[i];
        if (progress.unlockedScenes.includes(sc.id)) {
          progress.equippedScene = sc.id; saveAllData();
          switchScene(sc.id);
        }
        return true;
      }
    }
  }
  return false;
}

// --- 退出确认弹窗 ---
function drawConfirmPopup() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);
  var cw = 260, ch = 144;
  var cx = (W-cw)/2, cy = (H-ch)/2;
  drawPopupBg3(cx, cy, cw, ch, 14);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('退出本次游戏分数将清零', W/2, cy + 55);
  // 取消按钮（36%×36，圆角12，间距16）
  var bw3 = cw * 0.36, bh3 = 36;
  var bx3l = (W - bw3*2 - 16) / 2, bx3r = bx3l + bw3 + 16;
  ctx.fillStyle = 'rgba(237,151,28,0.2)';
  roundRectPath(bx3l, cy+80, bw3, bh3, 12); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('取消', bx3l + bw3/2, cy+103);
  // 确定按钮
  ctx.fillStyle = '#ED971C';
  roundRectPath(bx3r, cy+80, bw3, bh3, 12); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('确定', bx3r + bw3/2, cy+103);
}

function handleConfirmTouch(tx, ty) {
  var cw=260, ch=144, cx=(W-cw)/2, cy=(H-ch)/2;
  var bw3t = cw * 0.36, bh3t = 36;
  var bx3tl = (W - bw3t*2 - 16) / 2, bx3tr = bx3tl + bw3t + 16;
  if (tx>bx3tl&&tx<bx3tl+bw3t&&ty>cy+80&&ty<cy+116) { gameState=STATE.HOME; initHomeMarbles(); return true; }
  if (tx>bx3tr&&tx<bx3tr+bw3t&&ty>cy+80&&ty<cy+116) { goHome(); return true; }
  if (tx>cx+cw-45&&tx<cx+cw&&ty>cy&&ty<cy+40) { gameState=STATE.IDLE; return true; }
  return false;
}

// --- 设置弹窗 ---
function drawSettingsPopup() {
  drawHomePage();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);

  var cw = W * 0.7, ch = 310;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);

  // 关闭按钮
  ctx.fillStyle = '#222';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('设置', W / 2, cy + 35);

  // 背景音乐开关
  var rowY = cy + 75;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('背景音乐', cx + 25, rowY + 12);
  var swImg = musicOn ? uiIcons.open : uiIcons.close;
  if (swImg && swImg.width) {
    var swW2 = 32 * (swImg.width / swImg.height);
    ctx.drawImage(swImg, cx + cw - swW2 - 30, rowY - 6, swW2, 32);
  }

  // 背景音量（行距40px）
  var volY = rowY + 40;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('背景音量', cx + 25, volY + 12);
  var slX = cx + 105, slW = cw - 135, slH = 8;

  // 音效开关（行距40px）
  var sfxY = rowY + 80;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('音效', cx + 25, sfxY + 12);
  var swImg2 = sfxOn ? uiIcons.open : uiIcons.close;
  if (swImg2 && swImg2.width) {
    var swW3 = 32 * (swImg2.width / swImg2.height);
    ctx.drawImage(swImg2, cx + cw - swW3 - 30, sfxY - 6, swW3, 32);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  roundRectPath(slX, volY, slW, slH, slH / 2);
  ctx.fill();
  ctx.fillStyle = '#ED971C';
  roundRectPath(slX, volY, slW * musicVolume, slH, slH / 2);
  ctx.fill();
  // 滑块圆点
  var dotX2 = slX + slW * musicVolume;
  ctx.beginPath();
  ctx.arc(dotX2, volY + slH / 2, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 免打扰（行距40px）
  var qmY3 = rowY + 120;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('免打扰', cx + 25, qmY3 + 12);
  var swImg3 = quietMode ? uiIcons.open : uiIcons.close;
  if (swImg3 && swImg3.width) {
    var swW4 = 32 * (swImg3.width / swImg3.height);
    ctx.drawImage(swImg3, cx + cw - swW4 - 30, qmY3 - 6, swW4, 32);
  }
  ctx.fillStyle = '#666'; ctx.font = '10px sans-serif';
  ctx.fillText('开启后，发现宝物不弹窗不飞光点', cx + 25, qmY3 + 41);

  // 反馈意见
  ctx.fillStyle = '#888';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('反馈意见', W / 2, cy + ch - 30);
}

function handleSettingsTouch(tx, ty) {
  var cw = W * 0.7, ch = 310;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  // 关闭
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy - 5 && ty < cy + 55) {
    gameState = STATE.HOME; return true;
  }
  // 背景音乐开关
  var rowY = cy + 75;
  if (tx > cx + cw - 75 && tx < cx + cw && ty > rowY - 16 && ty < rowY + 20) {
    toggleMusic(); return true;
  }
  // 音效开关
  var sfxY = rowY + 80;
  if (tx > cx + cw - 75 && tx < cx + cw && ty > sfxY - 16 && ty < sfxY + 20) {
    sfxOn = !sfxOn; return true;
  }
  // 免打扰开关
  var qmY4 = rowY + 120;
  if (tx > cx + cw - 75 && tx < cx + cw && ty > qmY4 - 16 && ty < qmY4 + 20) {
    toggleQuietMode(); return true;
  }
  // 音量滑块
  var volY2 = rowY + 40, slX = cx + 105, slW = cw - 135;
  if (ty > volY2 - 15 && ty < volY2 + 25 && tx > slX - 15 && tx < slX + slW + 15) {
    musicVolume = Math.max(0, Math.min(1, (tx - slX) / slW));
    if (bgmAudio) bgmAudio.volume = musicVolume;
    return true;
  }
  // 反馈意见（点击区域从文字上方10px到弹窗底部）
  if (ty > cy + ch - 45 && tx > cx + 50 && tx < cx + cw - 50) { gameState = STATE.FEEDBACK; feedbackText = ''; feedbackContact = ''; feedbackImages = []; feedbackAgree = false; feedbackScrollY2 = 0; return true; }
  return false;
}

// --- 成就弹窗 ---
var badgeTab = 0;
var badgeScrollY = 0;
var storyLevel = 1;       // 当前查看的故事关卡
var storyScrollY = 0;     // 故事列表滚动
var storyTouchY = 0;      // 触摸Y用于滚动
var storyTypedLen = 0;    // 已打出的字符数
var storyFullText = '';   // 完整文本（逗号已替换为换行）
var storyLines = [];      // 分行数组
var storyLineIdx = 0;     // 当前正在打的行号
var storyLinePos = 0;     // 当前行已打字数
var storyPauseTimer = 0;  // 行间暂停计时
var storyCursorBlink = 0; // 光标闪烁计时
var storyScroll = 0;      // 详情文字滚动
var storyTouchStartY2 = 0; // 详情触摸起始Y
var storyDragging = false; // 是否正在拖动
var storySlideIndex = 0;   // 轮播图当前索引
var storySlideTimer = 0;   // 轮播计时器
var storySlideImgs = [];   // 当前关卡的轮播图列表
var storyDetailVisibleTop = 0;  // 文字区域顶部
var storyDetailVisibleH = 0;    // 文字区域高度
var badgeTouchStartY = 0;

function drawBadgesPopup() {
  drawHomePage();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);
  var cw = W * 0.9, ch = H * 0.66;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('成就', W / 2, cy + 35);

  // 关闭按钮
  ctx.fillStyle = '#222';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  // 标签
  var tabY2 = cy + 55, tabW2 = cw / 2 - 25, tabH2 = 32;
  var tabs = ['勋章', '称号'];
  for (var ti = 0; ti < 2; ti++) {
    var tx2 = cx + 20 + ti * (tabW2 + 10);
    ctx.fillStyle = badgeTab === ti ? '#ED971C' : 'rgba(237,151,28,0.5)';
    roundRectPath(tx2, tabY2, tabW2, tabH2, 6); ctx.fill();
    ctx.fillStyle = badgeTab === ti ? '#1a1a1a' : 'rgba(0,0,0,0.5)';
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(tabs[ti], tx2 + tabW2 / 2, tabY2 + tabH2 / 2 + 5);
  }

  if (badgeTab === 0) {
    // 勋章卡片列表（可滚动）
    var allBadges = [
      { name:'初次入坑', cat:'历程勋章', cond:'累计入坑50次', icon:'', target:50, key:'totalPits' , id:'first_pit'},
      { name:'初露锋芒', cat:'历程勋章', cond:'累计入坑150次', icon:'', target:150, key:'totalPits' , id:'five_pits'},
      { name:'小试身手', cat:'历程勋章', cond:'累计入坑350次', icon:'', target:350, key:'totalPits' , id:'twenty_pits'},
      { name:'渐入佳境', cat:'历程勋章', cond:'累计入坑600次', icon:'', target:600, key:'totalPits' , id:'fifty_pits'},
      { name:'百坑不倦', cat:'历程勋章', cond:'累计入坑1000次', icon:'', target:1000, key:'totalPits' , id:'hundred_pits'},
      { name:'弹珠达人', cat:'历程勋章', cond:'累计入坑2500次', icon:'', target:2500, key:'totalPits' , id:'five_hundred'},
      { name:'千锤百炼', cat:'历程勋章', cond:'累计入坑5000次', icon:'', target:5000, key:'totalPits' , id:'thousand_pits'},
      { name:'二连入坑', cat:'精准勋章', cond:'单局连续2坑', icon:'', target:2, key:'bestCombo' , id:'combo_2'},
      { name:'三连入坑', cat:'精准勋章', cond:'单局连续9坑', icon:'', target:9, key:'bestCombo' , id:'combo_3'},
      { name:'五连绝世', cat:'精准勋章', cond:'单局连续20坑', icon:'', target:20, key:'bestCombo' , id:'combo_5'},
      { name:'势不可挡', cat:'精准勋章', cond:'单局连续40坑', icon:'', target:40, key:'bestCombo' , id:'combo_10'},
      { name:'人珠合一', cat:'精准勋章', cond:'单局连续50坑', icon:'', target:50, key:'bestCombo' , id:'combo_20'},
      { name:'天选之珠', cat:'精准勋章', cond:'单局连续80坑', icon:'', target:80, key:'bestCombo' , id:'combo_35'},
      { name:'传说连击', cat:'精准勋章', cond:'单局连续120坑', icon:'', target:120, key:'bestCombo' , id:'combo_50'},
      { name:'初次见面', cat:'陪伴勋章', cond:'累计登录1天', icon:'', target:1, key:'loginDays' , id:'login_1'},
      { name:'三天打鱼', cat:'陪伴勋章', cond:'累计登录3天', icon:'', target:3, key:'loginDays' , id:'login_3'},
      { name:'一周相伴', cat:'陪伴勋章', cond:'累计登录7天', icon:'', target:7, key:'loginDays' , id:'login_7'},
      { name:'半月守望', cat:'陪伴勋章', cond:'累计登录15天', icon:'', target:15, key:'loginDays' , id:'login_15'},
      { name:'月月不离', cat:'陪伴勋章', cond:'累计登录30天', icon:'', target:30, key:'loginDays' , id:'login_30'},
      { name:'百日光阴', cat:'陪伴勋章', cond:'累计登录100天', icon:'', target:100, key:'loginDays' , id:'login_100'},
      { name:'一年之约', cat:'陪伴勋章', cond:'累计登录365天', icon:'', target:365, key:'loginDays' , id:'login_365'},
      { name:'皮肤新手', cat:'收集勋章', cond:'解锁3款珠珠皮肤', icon:'', target:3, key:'marbles' , id:'skin_3'},
      { name:'皮肤达人', cat:'收集勋章', cond:'解锁6款珠珠皮肤', icon:'', target:6, key:'marbles' , id:'skin_6'},
      { name:'皮肤大师', cat:'收集勋章', cond:'解锁9款珠珠皮肤', icon:'', target:9, key:'marbles' , id:'skin_9'},
      { name:'全珠收集', cat:'收集勋章', cond:'解锁12款珠珠皮肤', icon:'', target:12, key:'marbles' , id:'skin_12'},
      { name:'场景行者', cat:'收集勋章', cond:'解锁3款场景', icon:'', target:3, key:'scenes' , id:'scene_3'},
      { name:'场景达人', cat:'收集勋章', cond:'解锁6款场景', icon:'', target:6, key:'scenes' , id:'scene_6'},
      { name:'环球旅行', cat:'收集勋章', cond:'解锁全部9款场景', icon:'', target:9, key:'scenes' , id:'scene_9'},
    ];
    var listY2 = tabY2 + tabH2 + 10;
    var listH2 = ch - 115;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx + 15, listY2, cw - 30, listH2); ctx.clip();
    var cardH2 = 85, cardGap2 = 6, headH = 30;
    var iconSize = 60;
    var yOff = 0, lastCat = '';
    for (var bi2 = 0; bi2 < allBadges.length; bi2++) {
      var bd = allBadges[bi2];
      // 分类标题
      if (bd.cat !== lastCat) {
        lastCat = bd.cat;
        var hy = listY2 + yOff + badgeScrollY;
        if (hy + headH >= listY2 && hy <= listY2 + listH2) {
          ctx.fillStyle = '#8B6914';
          ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(bd.cat, cx + cw / 2, hy + headH / 2 + 5);
        }
        yOff += headH + 4;
      }
      var ry2 = listY2 + yOff + badgeScrollY;
      yOff += cardH2 + cardGap2;
      if (ry2 + cardH2 < listY2 || ry2 > listY2 + listH2) continue;
      var unlocked = progress.unlockedBadges.includes(bd.id);
      var currentVal = (bd.key === 'totalPits') ? (progress.totalPits || 0) : (bd.key === 'bestCombo') ? (progress.bestCombo || 0) : (bd.key === 'loginDays') ? (progress.loginDays || 0) : (bd.key === 'marbles') ? (progress.unlockedMarbles ? progress.unlockedMarbles.length : 0) : (bd.key === 'scenes') ? (progress.unlockedScenes ? progress.unlockedScenes.length : 0) : 0;
      var pct = Math.min(1, currentVal / bd.target);
      ctx.fillStyle = unlocked ? 'rgba(237,151,28,0.3)' : 'rgba(180,180,180,0.3)';
      roundRectPath(cx + 20, ry2, cw - 40, cardH2, 12); ctx.fill();
      // NEW角标（查看过即消失）
      if (unlocked && seenBadges.indexOf(bd.id) === -1) {
        ctx.beginPath(); ctx.arc(cx + cw - 29, ry2 + 9, 10, 0, Math.PI*2);
        ctx.fillStyle = '#4CAF50'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('NEW', cx + cw - 29, ry2 + 11);
      }
      var iconTop = ry2 + 12;
      var bImg = badgeIcons[bd.id];
      if (bImg && bImg.width) {
        if (!unlocked) { ctx.globalAlpha = 0.5; try { ctx.filter = 'grayscale(1) brightness(1.1)'; } catch(e) {} }
        ctx.drawImage(bImg, cx + 28, iconTop, iconSize, iconSize);
        ctx.globalAlpha = 1; try { ctx.filter = 'none'; } catch(e) {}
      } else {
        ctx.fillStyle = unlocked ? '#ED971C' : '#bbb';
        roundRectPath(cx + 28, iconTop, iconSize, iconSize, 12); ctx.fill();
        ctx.fillStyle = unlocked ? '#fff' : '#999';
        ctx.font = '26px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(bd.icon, cx + 28 + iconSize / 2, iconTop + iconSize / 2 + 6);
      }
      ctx.fillStyle = unlocked ? '#1a1a1a' : '#aaa';
      ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(bd.name, cx + 100, ry2 + 29);
      ctx.fillStyle = unlocked ? '#888' : '#bbb';
      ctx.font = '11px sans-serif';
      ctx.fillText(bd.cond, cx + 100, ry2 + 47);
      var barX2 = cx + 100, barW2 = cw - 190, barH2 = 16, barY2 = ry2 + 55;
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      roundRectPath(barX2, barY2, barW2, barH2, 8); ctx.fill();
      if (pct > 0) {
        ctx.fillStyle = unlocked ? '#ED971C' : 'rgba(237,151,28,0.4)';
        roundRectPath(barX2, barY2, Math.max(barW2 * pct, barH2), barH2, 8); ctx.fill();
      }
      var pctText = Math.min(currentVal, bd.target) + '/' + bd.target;
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pctText, barX2 + barW2 / 2, barY2 + barH2 / 2 + 4);

      // 右侧对应宝物
      var linkedT = ALL_TREASURES.find(function(tr){ return tr.badge === bd.id; });
      if (linkedT) {
        var tFound = isTreasureFound(linkedT.id);
        var trSize = 40;
        var trX = cx + cw - trSize - 38;
        var trY = ry2 + (cardH2 - trSize) / 2 - 10;
        // 宝物图标
        var tImg5 = treasureIcons[linkedT.id];
        if (tImg5 && tImg5.width && tFound) {
          ctx.drawImage(tImg5, trX, trY, trSize, trSize);
        } else {
          ctx.fillStyle = tFound ? 'rgba(237,151,28,0.2)' : 'rgba(0,0,0,0.08)';
          roundRectPath(trX, trY, trSize, trSize, 6); ctx.fill();
          ctx.fillStyle = tFound ? '#ED971C' : '#bbb';
          ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
          if (tFound && uiIcons.gift && uiIcons.gift.width) { ctx.drawImage(uiIcons.gift, trX + 6, trY + 6, trSize-12, trSize-12); }
          else if (!tFound && uiIcons.lock && uiIcons.lock.width) { ctx.drawImage(uiIcons.lock, trX + 6, trY + 6, trSize-12, trSize-12); }
        }
        // 宝物名称
        ctx.fillStyle = tFound ? '#1a1a1a' : '#bbb';
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(tFound ? linkedT.name.substring(0,4) : '待发现', trX + trSize / 2, trY + trSize + 14);
      }
    }
    ctx.restore();
  } else {
    // 称号卡片（3列网格）
    var titleData = [
      { name:'初来乍到', icon:'', cond:'累计入坑50次', id:'beginner' },
      { name:'弹珠学徒', icon:'', cond:'累计入坑200次', id:'player' },
      { name:'弹珠爱好者', icon:'', cond:'累计入坑500次', id:'enthusiast' },
      { name:'弹珠高手', icon:'', cond:'累计入坑1500次', id:'expert' },
      { name:'弹珠大师', icon:'', cond:'累计入坑3000次', id:'master' },
      { name:'弹珠传说', icon:'', cond:'累计入坑8000次', id:'legend' },
      { name:'百发百中', icon:'', cond:'单局连续50坑', id:'sharpshooter' },
      { name:'势不可挡', icon:'', cond:'单局连续100坑', id:'unstoppable' },
      { name:'珠珠收藏家', icon:'', cond:'解锁8款珠珠皮肤', id:'collector8' },
      { name:'世界漫游者', icon:'', cond:'解锁6款场景', id:'traveler6' },
      { name:'不离不弃', icon:'', cond:'累计登录30天', id:'loyal30' },
      { name:'老朋友', icon:'', cond:'累计登录100天', id:'oldfriend' },
    ];
    titleData.sort(function(a,b){ var ua=progress.unlockedTitles.includes(a.id)?0:1; var ub=progress.unlockedTitles.includes(b.id)?0:1; return ua-ub; });
    var cols3 = 3, gap3 = 8;
    var cardW3 = (cw - 40 - gap3 * (cols3 - 1)) / cols3;
    var cardH3 = 138;
    var listY3 = tabY2 + tabH2 + 10;
    var listH3 = ch - 120;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx + 15, listY3, cw - 30, listH3); ctx.clip();
    for (var ti2 = 0; ti2 < titleData.length; ti2++) {
      var col = ti2 % cols3, row = Math.floor(ti2 / cols3);
      var cx3 = cx + 20 + col * (cardW3 + gap3);
      var cy3 = listY3 + row * (cardH3 + gap3) + badgeScrollY;
      if (cy3 + cardH3 < listY3 || cy3 > listY3 + listH3) continue;
      var td = titleData[ti2];
      var unlocked2 = progress.unlockedTitles.includes(td.id);
      ctx.fillStyle = unlocked2 ? 'rgba(237,151,28,0.3)' : 'rgba(0,0,0,0.1)';
      roundRectPath(cx3, cy3, cardW3, cardH3, 10); ctx.fill();
      if (unlocked2) {
        ctx.strokeStyle = 'rgba(237,151,28,0.5)'; ctx.lineWidth = 1.5;
        roundRectPath(cx3, cy3, cardW3, cardH3, 10); ctx.stroke();
      }
      var tImg = titleIcons[td.id];
      if (tImg && tImg.width) {
        if (!unlocked2) { ctx.globalAlpha = 0.5; try { ctx.filter = 'grayscale(1) brightness(1.1)'; } catch(e) {} }
        ctx.drawImage(tImg, cx3 + cardW3 / 2 - 32, cy3 + 12, 64, 64);
        ctx.globalAlpha = 1; try { ctx.filter = 'none'; } catch(e) {}
      } else {
        ctx.fillStyle = unlocked2 ? '#1a1a1a' : '#999';
        ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(td.icon, cx3 + cardW3 / 2, cy3 + 36);
      }
      ctx.fillStyle = unlocked2 ? '#1a1a1a' : '#aaa';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(td.name, cx3 + cardW3 / 2, cy3 + 90);
      ctx.fillStyle = unlocked2 ? '#888' : '#999';
      ctx.font = '10px sans-serif';
      ctx.fillText(td.cond, cx3 + cardW3 / 2, cy3 + 106);
      // 获得日期
      var tDate = progress.titleDates && progress.titleDates[td.id];
      ctx.fillStyle = '#bbb';
      ctx.font = '9px sans-serif';
      ctx.fillText(tDate ? formatDate(new Date(tDate)) : '', cx3 + cardW3 / 2, cy3 + 122);
    }
    ctx.restore();
  }
}

function handleBadgesTouch(tx, ty) {
  var cw = W * 0.9, ch = H * 0.66;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  // 关闭时保存已查看
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy && ty < cy + 55) {
    seenBadges = progress.unlockedBadges.slice();
    try { wx.setStorageSync("zhuzhu_seen_badges", seenBadges); } catch(e) {}
    gameState = STATE.HOME; return true;
  }
  var tabY2 = cy + 55, tabH2 = 32, tabW2 = (cw - 50) / 2;
  for (var ti = 0; ti < 2; ti++) {
    var tx2 = cx + 20 + ti * (tabW2 + 10);
    if (tx > tx2 && tx < tx2 + tabW2 && ty > tabY2 && ty < tabY2 + tabH2) {
      badgeTab = ti; badgeScrollY = 0; return true;
    }
  }
  badgeTouchStartY = ty;
  return false;
}

// --- 排行榜弹窗 ---
var rankTab = 0;      // 0=每日, 1=世界, 2=好友
var rankScrollY = 0;
var rankData = { daily:[], world:[], friend:[] };
var rankMyScore = 0;
var rankMyRank = null;
var rankTotalPlayers = 0;

// 提交分数到云端
function submitScoreToCloud() {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) return;
  try {
    wx.cloud.callFunction({
      name: 'rank',
      data: {
        action: 'submitScore',
        score: bestScore,
        nickname: userProfile.nickname || '',
        avatarUrl: userProfile.avatar || ''
      }
    }).then(function(res) {
      if (res.result && res.result.success) {
        rankMyRank = res.result.myRank;
        rankTotalPlayers = res.result.totalPlayers;
      }
    }).catch(function(){});
  } catch(e) {}
}

// 从云端拉取世界排行
function fetchWorldRank(callback) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
    if (callback) callback(null);
    return;
  }
  try {
    wx.cloud.callFunction({
      name: 'rank',
      data: { action: 'getWorldRank', limit: 50 }
    }).then(function(res) {
      if (res.result && res.result.success) {
        rankData.world = res.result.rankList;
        rankMyScore = res.result.myScore;
        rankMyRank = res.result.myRank;
        rankTotalPlayers = res.result.totalPlayers;
        if (callback) callback(rankData.world);
      } else {
        if (callback) callback(null);
      }
    }).catch(function() {
      if (callback) callback(null);
    });
  } catch(e) {
    if (callback) callback(null);
  }
}

// 从云端拉取每日排行
function fetchDailyRank(callback) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
    if (callback) callback(null);
    return;
  }
  try {
    wx.cloud.callFunction({
      name: 'rank',
      data: { action: 'getDailyRank', limit: 50 }
    }).then(function(res) {
      if (res.result && res.result.success) {
        rankData.daily = res.result.rankList;
        if (callback) callback(rankData.daily);
      } else {
        if (callback) callback(null);
      }
    }).catch(function() {
      if (callback) callback(null);
    });
  } catch(e) {
    if (callback) callback(null);
  }
}

function drawRankPopup() {
  drawHomePage();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-W, -H, W * 3, H * 3);

  var cw = W * 0.9, ch = H * 0.66;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('排行榜', W / 2, cy + 35);

  // 关闭按钮
  ctx.fillStyle = '#222';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  // 三个标签
  var tabs = ['每日', '世界', '好友'];
  var tabY2 = cy + 55, tabW2 = (cw - 60) / 3, tabH2 = 32;
  for (var ti = 0; ti < 3; ti++) {
    var tx2 = cx + 20 + ti * (tabW2 + 10);
    ctx.fillStyle = rankTab === ti ? '#ED971C' : 'rgba(237,151,28,0.5)';
    roundRectPath(tx2, tabY2, tabW2, tabH2, 6); ctx.fill();
    ctx.fillStyle = rankTab === ti ? '#1a1a1a' : 'rgba(0,0,0,0.5)';
    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(tabs[ti], tx2 + tabW2 / 2, tabY2 + tabH2 / 2 + 5);
  }

  // 列表数据（每日/世界用云端；好友用开放数据域）
  var myNick = userProfile.nickname || '我';
  var myScore = bestScore || 0;
  [rankData.daily, rankData.world].forEach(function(arr) {
    var foundEntry = arr.find(function(d) { return d.nickname === myNick; });
    if (foundEntry) {
      // 用本地最高分覆盖云端旧数据
      if (myScore > foundEntry.score) foundEntry.score = myScore;
    } else if (myScore > 0) {
      arr.push({ nickname: myNick, score: myScore });
    }
    if (arr.length > 0) arr.sort(function(a, b) { return b.score - a.score; });
  });
  var data = rankTab === 0 ? rankData.daily : (rankTab === 1 ? rankData.world : []);
  // 好友排行：使用开放数据域 sharedCanvas
  if (rankTab === 2 && openDataContext) {
    var listY3 = tabY2 + tabH2 + 10;
    var listH3 = ch - 120;
    var listW3 = cw - 30;
    var sharedCanvas = openDataContext.canvas;
    if (sharedCanvas.width !== listW3) { sharedCanvas.width = listW3; openDataContext.postMessage({ type: 'redraw' }); }
    if (sharedCanvas.height !== listH3) { sharedCanvas.height = listH3; openDataContext.postMessage({ type: 'redraw' }); }
    if (sharedCanvas.width) {
      ctx.drawImage(sharedCanvas, cx + 15, listY3, listW3, listH3);
    }
  }
  var listY = tabY2 + tabH2 + 10;
  var listH = ch - 120;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx + 15, listY, cw - 30, listH);
  ctx.clip();

  var itemH = 60;
  var rankX = cx + 40;
  if (data.length === 0 && rankTab !== 2) {
    ctx.fillStyle = '#999'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('暂无数据', W / 2, listY + 40);
  }
  for (var ri = 0; ri < Math.min(data.length, 99); ri++) {
    var d = data[ri];
    var ry = listY + ri * itemH + rankScrollY;
    if (ry + itemH < listY || ry > listY + listH) continue;
    // 行背景（左右缩进10px）
    var rowX = cx + 20, rowW = cw - 40;
    if (ri % 2 === 0) { ctx.fillStyle = 'rgba(237,151,28,0.10)'; ctx.fillRect(rowX, ry, rowW, itemH); }
    // 排名（居中对齐）
    ctx.textAlign = 'center';
    if (ri < 3) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '22px sans-serif';
      ctx.fillText(['🥇','🥈','🥉'][ri], rankX, ry + 38);
    } else {
      ctx.fillStyle = '#888';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(ri + 1, rankX, ry + 38);
    }
    // 头像占位（圆角8）
    var ax = cx + 68, ay = ry + 12, ar = 18;
    var isSelf = d.nickname === myNick && userProfile.avatar;
    var showRealAvatar = false;
    if (isSelf) {
      if (!userProfile._avatarImg) {
        var img3 = wx.createImage();
        img3.src = userProfile.avatar;
        img3.onload = function() { userProfile._avatarLoaded = true; };
        img3.onerror = function() { userProfile._avatarImg = null; };
        userProfile._avatarImg = img3;
        userProfile._avatarLoaded = false;
      }
      if (userProfile._avatarLoaded || (userProfile._avatarImg && userProfile._avatarImg.width)) {
        showRealAvatar = true;
      }
    }
    if (showRealAvatar) {
      ctx.save();
      roundRectPath(ax, ay, ar*2, ar*2, 8);
      ctx.clip();
      ctx.drawImage(userProfile._avatarImg, ax, ay, ar*2, ar*2);
      ctx.restore();
    } else {
      var avatarColors = ['#ED971C','#5b9bd5','#7a9e5e','#c4a462','#8b4fa3','#d87080','#4d9e96','#c43828'];
      ctx.fillStyle = avatarColors[ri % avatarColors.length];
      roundRectPath(ax, ay, ar*2, ar*2, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.nickname.charAt(0), ax + ar, ay + ar + 4);
    }
    // 昵称（缩进10px）
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '18px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(d.nickname, ax + ar*2 + 12, ry + 38);
    // 分数（缩进10px）
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(d.score, cx + cw - 35, ry + 38);
  }
  ctx.restore();

  // 底部固定自己
  var selfH = 80;
  ctx.strokeStyle = 'rgba(237,151,28,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy + ch - selfH);
  ctx.lineTo(cx + cw, cy + ch - selfH);
  ctx.stroke();

  var selfY = cy + ch - selfH;
  var selfX = cx, selfW = cw;
  var bgdImg = bgbImg;
  if (bgdImg && bgdImg.width) {
    var sc6 = Math.max(selfW / bgdImg.width, selfH / bgdImg.height);
    var sw6 = bgdImg.width * sc6, sh6 = bgdImg.height * sc6;
    ctx.save();
    ctx.beginPath(); ctx.rect(selfX, selfY, selfW, selfH); ctx.clip();
    ctx.drawImage(bgdImg, selfX + (selfW - sw6) / 2, selfY + selfH - sh6, sw6, sh6);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(237,151,28,0.30)';
    ctx.fillRect(selfX, selfY, selfW, selfH);
  }
  // 垂直居中
  var selfCY = selfY + selfH / 2 - 2;
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  var myScore = bestScore || 0;
  var myRank = 1;
  if (rankTab === 1 && rankMyRank) {
    myRank = rankMyRank;
  } else {
    for (var ri2 = 0; ri2 < data.length; ri2++) {
      if (data[ri2].score > myScore) myRank++;
    }
  }
  var rankStr = myRank > 99 ? '99+' : String(myRank);
  ctx.fillText(rankStr, rankX, selfCY);
  var ax2 = cx + 68, ay2 = selfY + (selfH - 36) / 2 - 8;
  var hasSelfAvatar = userProfile.avatar && userProfile._avatarImg && (userProfile._avatarLoaded || userProfile._avatarImg.width);
  if (hasSelfAvatar) {
    ctx.save();
    roundRectPath(ax2, ay2, 36, 36, 8);
    ctx.clip();
    ctx.drawImage(userProfile._avatarImg, ax2, ay2, 36, 36);
    ctx.restore();
  } else {
    ctx.fillStyle = '#ED971C';
    roundRectPath(ax2, ay2, 36, 36, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    var myDispName2 = userProfile.nickname ? (userProfile.nickname.length > 5 ? userProfile.nickname.substring(0,4)+'…' : userProfile.nickname) : '我';
    ctx.fillText(myDispName2.charAt(0), ax2 + 18, ay2 + 23);
  }
  var myDispName = userProfile.nickname ? (userProfile.nickname.length > 5 ? userProfile.nickname.substring(0,4)+'…' : userProfile.nickname) : '我';
  ctx.fillStyle = '#1a1a1a'; ctx.font = '18px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(myDispName, ax2 + 48, selfCY);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(bestScore || '0', cx + cw - 35, selfCY);
}

function handleRankTouch(tx, ty) {
  var cw = W * 0.9, ch = H * 0.66;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  // 关闭
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy && ty < cy + 55) {
    if (rankTab === 2 && openDataContext) openDataContext.postMessage({ type: 'hide' });
    gameState = STATE.HOME; return true;
  }
  // 标签
  var tabY2 = cy + 55, tabH2 = 32, tabW2 = (cw - 60) / 3;
  for (var ti = 0; ti < 3; ti++) {
    var tx2 = cx + 20 + ti * (tabW2 + 10);
    if (tx > tx2 && tx < tx2 + tabW2 && ty > tabY2 && ty < tabY2 + tabH2) {
      rankTab = ti; rankScrollY = 0;
      if (ti === 2 && openDataContext) openDataContext.postMessage({ type: 'showFriendRank', score: bestScore || 0 });
      return true;
    }
  }
  // 滚动（记录起始位置）
  rankScrollStart2 = ty;
  return false;
}

// --- 操作提示 (首次) ---
let showTip = true;

function drawTip(dt) {
  if (!showTip) return;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('按住屏幕蓄力', W / 2, H * 0.78);
  ctx.fillText('松开珠珠弹出', W / 2, H * 0.81);
}

function hideTip() { showTip = false; }


// --- 返回按钮（胶囊左侧，垂直对齐） ---
const CAPSULE_MID_Y = capsuleRect.top + capsuleRect.height / 2;

function drawBackButton() {
  const y = CAPSULE_MID_Y - 12;
  if (backImage && backImage.width > 0) {
    ctx.drawImage(backImage, 12, y, 24, 24);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('←', 16, CAPSULE_MID_Y + 6);
  }
}

function handleBackButton(tx, ty) {
  return tx < 50 && ty < capsuleRect.bottom + 10;
}

// ============================================================
// 十-A、主页面
// ============================================================
let homeMarbles = [];
let homeAnimTime = 0;

function initHomeMarbles() {
  homeMarbles = [];
  var pool = MARBLE_SKINS.slice();
  for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random()*(i+1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  for (var i = 0; i < 6; i++) {
    homeMarbles.push({
      x: W * 0.10 + Math.random() * W * 0.80,
      y: H * 0.34 + Math.random() * H * 0.26,
      vx: (Math.random() - 0.5) * 80,
      vy: (Math.random() - 0.5) * 60,
      r: 16 + Math.random() * 16,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 3,
      color: '#5b9bd5',
      skinId: pool[i % pool.length].id,
    });
  }
}

function updateHomeMarbles(dt) {
  homeAnimTime += dt;
  for (const m of homeMarbles) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.rotation += m.rotSpeed * dt;
    // 轻微阻尼
    m.vx *= 0.998;
    m.vy *= 0.998;
    // 限速
    var spd = Math.sqrt(m.vx*m.vx + m.vy*m.vy);
    if (spd > 300) { m.vx *= 300/spd; m.vy *= 300/spd; }
    // 边界反弹
    if (m.x < 20 || m.x > W - 20) m.vx *= -1;
    if (m.y < H * 0.28 || m.y > H * 0.60) m.vy *= -1;
  }
  // 珠珠间碰撞检测
  for (let i = 0; i < homeMarbles.length; i++) {
    for (let j = i + 1; j < homeMarbles.length; j++) {
      const a = homeMarbles[i], b = homeMarbles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const minDist = a.r + b.r;
      if (dist < minDist && dist > 0.01) {
        // 弹开
        const nx = dx / dist, ny = dy / dist;
        const overlap = minDist - dist;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
        // 交换速度分量
        const relV = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (relV > 0) {
          a.vx -= relV * nx * 0.8;
          a.vy -= relV * ny * 0.8;
          b.vx += relV * nx * 0.8;
          b.vy += relV * ny * 0.8;
          if (relV > 30 && gameState === STATE.HOME) playSfx('peng');
        }
      }
    }
  }
  // 随机微调
  for (const m of homeMarbles) {
    if (Math.random() < 0.02) m.vx += (Math.random() - 0.5) * 30;
    if (Math.random() < 0.02) m.vy += (Math.random() - 0.5) * 20;
  }
}

function drawHomeMarbles() {
  const skinIds = progress.unlockedMarbles || ['classic_blue'];
  for (let i = 0; i < homeMarbles.length; i++) {
    const m = homeMarbles[i];
    var skinId = m.skinId || skinIds[i % skinIds.length];
    var skinImg = marbleSkinCache[skinId];
    const sg = ctx.createRadialGradient(m.x - m.r*0.15, m.y + m.r*0.25, m.r*0.4, m.x - m.r*0.15, m.y + m.r*0.25, m.r*1.1);
    sg.addColorStop(0, 'rgba(0,0,0,0.30)');
    sg.addColorStop(0.5, 'rgba(0,0,0,0.10)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(m.x - m.r*0.15, m.y + m.r*0.25, m.r*1.1, 0, Math.PI*2);
    ctx.fill();

    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rotation);
    if (skinImg && skinImg.width) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, m.r, 0, Math.PI * 2);
      ctx.clip();
      const s = (m.r * 2) / Math.max(skinImg.width, skinImg.height);
      const dw = skinImg.width * s, dh = skinImg.height * s;
      ctx.drawImage(skinImg, -dw/2, -dh/2, dw, dh);
      ctx.restore();
      // 黑色内阴影（外→内）
      const isg = ctx.createRadialGradient(0, 0, m.r * 0.6, 0, 0, m.r);
      isg.addColorStop(0, 'rgba(0,0,0,0)');
      isg.addColorStop(0.6, 'rgba(0,0,0,0.05)');
      isg.addColorStop(1, 'rgba(0,0,0,0.20)');
      ctx.beginPath();
      ctx.arc(0, 0, m.r, 0, Math.PI * 2);
      ctx.fillStyle = isg;
      ctx.fill();
    } else {
      const grad = ctx.createRadialGradient(-m.r*0.2, -m.r*0.25, m.r*0.05, 0, 0, m.r);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.4, m.color);
      grad.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.beginPath(); ctx.arc(0, 0, m.r, 0, Math.PI*2);
      ctx.fillStyle = grad; ctx.fill();
    }
    ctx.restore();
    // 高光（固定方向，不随旋转）
    ctx.beginPath();
    ctx.arc(m.x - m.r*0.25, m.y - m.r*0.3, m.r*0.22, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }
}

// 按钮区域
const HOME_BTNS = {
  endless: { x: W / 2, y: H * 0.66, w: 180, h: 56 },
  levels:  { x: W / 2, y: H * 0.78, w: 180, h: 56 },
  classic: { x: W / 2, y: H * 0.90, w: 180, h: 56 },
  settings:{ x: 34, y: CAPSULE_MID_Y + 50, r: 20 },
  icons: [
    { id: 'checkin',  x: W - 130, y: H * 0.92, r: 18 },
    { id: 'rank',     x: W - 90,  y: H * 0.92, r: 18 },
    { id: 'badges',   x: W - 50,  y: H * 0.92, r: 18 },
  ],
};

function ptInRect(tx, ty, r) {
  return tx > r.x - r.w / 2 && tx < r.x + r.w / 2 && ty > r.y - r.h / 2 && ty < r.y + r.h / 2;
}

function ptInCircle(tx, ty, cx, cy, r) {
  return Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2) < r + 8;
}

function drawHomePage() {
  // 防御：确保 canvas 状态干净
  ctx.globalCompositeOperation = 'source-over';
  // 背景
  drawSky();

  // slogan（背景之上，珠珠之下，50%透明度）
  if (uiIcons.slogan && uiIcons.slogan.width) {
    var sw2 = W * 0.55, sh2 = sw2 * (uiIcons.slogan.height / uiIcons.slogan.width);
    var be2 = HOME_BTNS.endless;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(uiIcons.slogan, (W - sw2) / 2, be2.y - 38 - sh2 - 30, sw2, sh2);
    ctx.globalAlpha = 1;
  }

  // 飘浮珠珠
  drawHomeMarbles();

  // 标题图片（在珠珠之上）
  if (uiIcons.title && uiIcons.title.width) {
    var tw = W * 0.82, th = tw * (uiIcons.title.height / uiIcons.title.width);
    ctx.drawImage(uiIcons.title, (W - tw) / 2, H * 0.12, tw, th);
  }

  // 无尽模式按钮
  const be = HOME_BTNS.endless;
  const bx1 = be.x - be.w / 2, by1 = be.y - be.h / 2;
  // 柔投影
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRectPath(bx1, by1 + 8, be.w, be.h, 16);
  ctx.fill();
  if (btnBg1) {
    ctx.fillStyle = '#000';
    roundRectPath(bx1, by1, be.w, be.h, 16);
    ctx.fill();
    ctx.save();
    roundRectPath(bx1, by1, be.w, be.h, 16);
    ctx.clip();
    ctx.globalAlpha = 0.8;
    var ih1 = btnBg1.height * (be.w / btnBg1.width);
    ctx.drawImage(btnBg1, bx1, by1 + (be.h - ih1) / 2, be.w, ih1);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    roundRectPath(bx1, by1, be.w, be.h, 16);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(40,30,20,0.85)';
    roundRectPath(bx1, by1, be.w, be.h, 16);
    ctx.fill();
  }
  // 最高分
  var txt = '最高进 ' + bestScore + ' · 连进 ' + (progress.bestCombo || 0);
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(txt, W / 2 + 1, be.y - 38);
  ctx.fillText(txt, W / 2 - 1, be.y - 38);
  ctx.fillText(txt, W / 2, be.y - 37);
  ctx.fillText(txt, W / 2, be.y - 39);
  ctx.fillStyle = '#fff';
  ctx.fillText(txt, W / 2, be.y - 38);

  // 按钮内图片
  if (uiIcons.wu && uiIcons.wu.width) {
    var iw2 = uiIcons.wu.width, ih2 = uiIcons.wu.height;
    var s2 = Math.min(be.w * 0.65 / iw2, be.h * 0.6 / ih2);
    ctx.drawImage(uiIcons.wu, W/2 - iw2*s2/2, be.y - ih2*s2/2 + 1, iw2*s2, ih2*s2);
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('无尽模式', W / 2, be.y + 2);
  }

  // 闯关模式按钮
  const bl = HOME_BTNS.levels;
  const bx2 = bl.x - bl.w / 2, by2 = bl.y - bl.h / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRectPath(bx2, by2 + 8, bl.w, bl.h, 16);
  ctx.fill();
  if (btnBg2) {
    ctx.fillStyle = '#000';
    roundRectPath(bx2, by2, bl.w, bl.h, 16);
    ctx.fill();
    ctx.save();
    roundRectPath(bx2, by2, bl.w, bl.h, 16);
    ctx.clip();
    ctx.globalAlpha = 0.8;
    var ih2 = btnBg2.height * (bl.w / btnBg2.width);
    ctx.drawImage(btnBg2, bx2, by2 + (bl.h - ih2) / 2, bl.w, ih2);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    roundRectPath(bx2, by2, bl.w, bl.h, 16);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(40,30,20,0.85)';
    roundRectPath(bx2, by2, bl.w, bl.h, 16);
    ctx.fill();
  }

  // 关卡文字（按钮上方）
  var lvlTxt = '第' + currentLevel + '关';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(lvlTxt, W/2 + 2, bl.y - 38);
  ctx.fillText(lvlTxt, W/2 - 2, bl.y - 38);
  ctx.fillText(lvlTxt, W/2, bl.y - 36);
  ctx.fillText(lvlTxt, W/2, bl.y - 40);
  ctx.fillStyle = '#000';
  ctx.fillText(lvlTxt, W/2, bl.y - 38);

  // 按钮内图片
  if (uiIcons.chuang && uiIcons.chuang.width) {
    var iw3 = uiIcons.chuang.width, ih3 = uiIcons.chuang.height;
    var s3 = Math.min(bl.w * 0.65 / iw3, bl.h * 0.6 / ih3);
    ctx.drawImage(uiIcons.chuang, W/2 - iw3*s3/2, bl.y - ih3*s3/2 + 1, iw3*s3, ih3*s3);
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('闯关模式', W/2, bl.y + 2);
  }

  // 经典模式按钮
  const bc = HOME_BTNS.classic;
  const bx3 = bc.x - bc.w / 2, by3 = bc.y - bc.h / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRectPath(bx3, by3 + 8, bc.w, bc.h, 16);
  ctx.fill();
  if (btnBg3) {
    ctx.fillStyle = '#000';
    roundRectPath(bx3, by3, bc.w, bc.h, 16);
    ctx.fill();
    ctx.save();
    roundRectPath(bx3, by3, bc.w, bc.h, 16);
    ctx.clip();
    ctx.globalAlpha = 0.8;
    var ih3 = btnBg3.height * (bc.w / btnBg3.width);
    ctx.drawImage(btnBg3, bx3, by3 + (bc.h - ih3) / 2, bc.w, ih3);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    roundRectPath(bx3, by3, bc.w, bc.h, 16);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(40,30,20,0.85)';
    roundRectPath(bx3, by3, bc.w, bc.h, 16);
    ctx.fill();
  }

  // 按钮内图片
  if (uiIcons.jing && uiIcons.jing.width) {
    var iw4 = uiIcons.jing.width, ih4 = uiIcons.jing.height;
    var s4 = Math.min(bc.w * 0.65 / iw4, bc.h * 0.6 / ih4);
    ctx.drawImage(uiIcons.jing, W/2 - iw4*s4/2, bc.y - ih4*s4/2 + 1, iw4*s4, ih4*s4);
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('经典模式', W/2, bc.y + 2);
  }

  // 今日数据统计
  var statY2 = bc.y + bc.h / 2 + 24;
  var stxt = '今日进 ' + (livesData.dailyPits || 0) + ' · 连进 ' + (livesData.dailyBestCombo || 0);
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(stxt, W / 2 + 1, statY2);
  ctx.fillText(stxt, W / 2 - 1, statY2);
  ctx.fillText(stxt, W / 2, statY2 + 1);
  ctx.fillText(stxt, W / 2, statY2 - 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(stxt, W / 2, statY2);

  // 设置图标（头像下方间距16px）
  var setY = CAPSULE_MID_Y + 32;
  if (uiIcons.set) {
    ctx.drawImage(uiIcons.set, 16, setY, 36, 36);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚙️', 35, setY + 24);
  }

  // 微信头像昵称（设置按钮上方，宽度根据昵称自适应）
  var profX = 10, profY = CAPSULE_MID_Y - 16, profH = 32;
  var avatarSz = 24, avatarX = profX + 4, avatarY = profY + 4;
  // 先计算文字宽度
  var nickDisp = userProfile.nickname || '匿名玩家';
  if (nickDisp.length > 7) nickDisp = nickDisp.substring(0, 6) + '…';
  ctx.font = 'bold 13px sans-serif';
  var textW = ctx.measureText(nickDisp).width;
  var profW = 4 + avatarSz + 8 + textW + 10; // pad+头像+间距+文字+右侧pad
  if (profW < 90) profW = 90; // 最小宽度
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRectPath(profX, profY, profW, profH, 16);
  ctx.fill();
  // 头像：优先微信头像，否则用默认avatar.jpg
  var avatarImg = null;
  if (userProfile.avatar) {
    if (!userProfile._avatarImg) {
      var img = wx.createImage();
      img.src = userProfile.avatar;
      img.onload = function() { userProfile._avatarLoaded = true; };
      img.onerror = function() { userProfile._avatarImg = null; };
      userProfile._avatarImg = img;
      userProfile._avatarLoaded = false;
    }
    if (userProfile._avatarLoaded || (userProfile._avatarImg && userProfile._avatarImg.width)) {
      avatarImg = userProfile._avatarImg;
    }
  }
  if (!avatarImg || !avatarImg.width) {
    avatarImg = uiIcons.avatar_default;
  }
  if (avatarImg && avatarImg.width) {
    ctx.save();
    roundRectPath(avatarX, avatarY, avatarSz, avatarSz, 12);
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSz, avatarSz);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    roundRectPath(avatarX, avatarY, avatarSz, avatarSz, 12);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👤', avatarX + avatarSz / 2, avatarY + 16);
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(nickDisp, avatarX + avatarSz + 8, profY + 22);

const HOME_ICONS_LEFT = [
  { key: 'box', act: 'treasure' },
  { key: 'story', act: 'story' },
];
const HOME_ICONS_RIGHT = [
  { key: 'share', act: 'share' },
  { key: 'chickin', act: 'checkin' },
  { key: 'rank', act: 'rank' },
  { key: 'achievement', act: 'badges' },
  { key: 'skin', act: 'skin' },
];
  const iconSize = 58;
  // 底部双列图标（距底80px，从下往上排）
  var icosz2 = 58;
  var gap2 = 8;
  var colX1 = 12, colX2 = W - 12 - icosz2;
  var baseY = H - 45;
  // 左列（故事最底，宝箱最顶）
  for (var li5 = 0; li5 < HOME_ICONS_LEFT.length; li5++) {
    var ick = HOME_ICONS_LEFT[li5].key;
    var iy5 = baseY - (HOME_ICONS_LEFT.length - li5) * (icosz2 + gap2);
    if (uiIcons[ick]) ctx.drawImage(uiIcons[ick], colX1, iy5, icosz2, icosz2);
    // 宝箱新宝物红点
    if (ick === 'box') {
      var newCnt = 0;
      for (var nk in treasureData.newFound) { if (treasureData.newFound[nk]) newCnt++; }
      if (newCnt > 0) {
        ctx.beginPath(); ctx.arc(colX1 + icosz2 - 4, iy5 + 4, 9, 0, Math.PI*2);
        ctx.fillStyle = '#E53E3E'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('' + Math.min(newCnt, 99), colX1 + icosz2 - 4, iy5 + 7);
      }
    }
  }
  // 右列（从下往上：皮肤最底，分享最顶）
  for (var ri5 = 0; ri5 < HOME_ICONS_RIGHT.length; ri5++) {
    var ick2 = HOME_ICONS_RIGHT[ri5].key;
    var iy6 = baseY - (HOME_ICONS_RIGHT.length - ri5) * (icosz2 + gap2);
    if (uiIcons[ick2]) ctx.drawImage(uiIcons[ick2], colX2, iy6, icosz2, icosz2);
    // 成就红点
    // 成就红点
    if (ick2 === 'achievement') {
      var newBadges = progress.unlockedBadges.filter(function(b) { return seenBadges.indexOf(b) === -1; });
      if (newBadges.length > 0) {
        var bxx4 = colX2 + icosz2 - 4, byy4 = iy6 + 4, brr4 = 9;
        ctx.beginPath();
        ctx.arc(bxx4, byy4, brr4, 0, Math.PI * 2);
        ctx.fillStyle = '#e74c3c';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('' + Math.min(newBadges.length, 99), bxx4, byy4 + 3);
      }
    }
    // 皮肤/场景红点
    if (ick2 === 'skin') {
      var newMar = (progress.unlockedMarbles || []).filter(function(m) { return m !== 'classic_blue' && (seenMarbles || []).indexOf(m) === -1; });
      var newSc = (progress.unlockedScenes || []).filter(function(s) { return s !== 'grandma_backyard' && (seenScenes || []).indexOf(s) === -1; });
      var nsTotal = newMar.length + newSc.length;
      if (nsTotal > 0) {
        var sxx2 = colX2 + icosz2 - 4, syy2 = iy6 + 4, srr2 = 9;
        ctx.beginPath();
        ctx.arc(sxx2, syy2, srr2, 0, Math.PI * 2);
        ctx.fillStyle = '#e74c3c';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('' + Math.min(nsTotal, 99), sxx2, syy2 + 3);
      }
    }
  }

  // 经典模式选择弹窗（好友模式已取消，此弹窗不再显示）
}

function handleHomeTouch(tx, ty) {
  // === 安全兜底：防止残留状态拦截首页触摸 ===
  ctx.globalCompositeOperation = 'source-over';
  if (treasurePopup) treasurePopup = null;
  if (treasureGoConfirm) treasureGoConfirm = false;
  if (dupExchangePopup) dupExchangePopup = false;
  if (propGetPopup) propGetPopup = false;
  if (classicDisclaimerPopup) classicDisclaimerPopup = false;

  const be = HOME_BTNS.endless;
  const bl = HOME_BTNS.levels;
  const bc = HOME_BTNS.classic;
  const st = HOME_BTNS.settings;

  // 经典模式选择弹窗已取消（好友模式已移除）

  if (ptInRect(tx, ty, be)) {
    gameMode = 'endless';
    playSfx('btn'); startGame();
  } else if (ptInRect(tx, ty, bl)) {
    gameMode = 'levels';
    playSfx('btn'); startGame();
  } else if (ptInRect(tx, ty, bc)) {
    if (!userProfile.avatar) {
      requestUserAuth({
        fullScreen: true,
        onSuccess: function() { showClassicDisclaimerOrStart(); },
        onDecline: function() {
          wx.showToast({ title: '需要授权后才能进入经典模式', icon: 'none', duration: 2000 });
        }
      });
      return;
    }
    showClassicDisclaimerOrStart();
    return;
  } else if (ptInCircle(tx, ty, st.x, st.y, st.r)) {
    gameState = STATE.SETTINGS;
  } else {
    // 底部双列图标
    var ib2 = H - 45;
    if (tx >= 12 && tx <= 70) {
      var ly1 = ib2 - 132, ly2 = ib2 - 66;
      if (ty >= ly1 && ty <= ly1 + 58) { gameState = STATE.TREASURE; treasureTab = 0; treasureScrollY = 0; treasureDetailIdx = -1; treasureJustOpened = true; // 修复不一致：foundDates有但found没有的补上
        for (var fid in treasureData.foundDates) {
          if (treasureData.found.indexOf(fid) === -1) treasureData.found.push(fid);
        }
        try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {} return; }
      if (ty >= ly2 && ty <= ly2 + 58) { gameState = STATE.STORY; storyLevel = 0; storyScrollY = 0; return; }
    }
    if (tx >= W - 70 && tx <= W - 12) {
      var ry1 = ib2 - 330, ry2 = ib2 - 264, ry3 = ib2 - 198, ry4 = ib2 - 132, ry5 = ib2 - 66;
      if (ty >= ry1 && ty <= ry1 + 58) { doShare(); return; }
      if (ty >= ry2 && ty <= ry2 + 58) { gameState = STATE.CHECKIN; return; }
      if (ty >= ry3 && ty <= ry3 + 58) {
        if (!userProfile.avatar) {
          requestUserAuth({
            fullScreen: true,
            onSuccess: function() { gameState = STATE.RANK; rankTab = 0; rankScrollY = 0; fetchDailyRank(); fetchWorldRank(); },
            onDecline: function() {
              wx.showToast({ title: '需要授权后才能查看排名', icon: 'none', duration: 2000 });
            }
          });
          return;
        }
        gameState = STATE.RANK; rankTab = 0; rankScrollY = 0;
        fetchDailyRank(); fetchWorldRank(); return;
      }
      if (ty >= ry4 && ty <= ry4 + 58) { gameState = STATE.BADGES; badgeTab = 0; return; }
      if (ty >= ry5 && ty <= ry5 + 58) { gameState = STATE.SKIN; skinTab = 0; return; }
    }
  }
}

function startGame() {
  hideUserInfoButton();
  if (gameMode === 'classic') return;
  // 闯关模式：确保从未玩过的关卡开始
  if (gameMode === 'levels') currentLevel = maxUnlockedLevel;
  // 闯关模式用关卡场景，无尽模式用装备场景
  var startScene = gameMode === 'levels' ? (LEVEL_SCENES[currentLevel] || 'grandma_backyard') : (progress.equippedScene || 'grandma_backyard');
  switchScene(startScene);
  // 重置闯关模式宝箱
  levelTreasureSeq = 0; levelTreasureId = ''; levelChestsPlaced = 0; levelTreasureChestNum = 0; levelChestSeq = [];
  endlessPool3 = []; endlessChestsPlaced = 0; endlessTypesRevealed = {};
  marble.worldX = -0.3; marble.worldY = -0.6;
  marble.vx = 2.0; marble.vy = 1.5;
  marble.rotation = 5; marble.scale = 1; marble.alpha = 1;
  marble.sinkY = 0;
  gameState = STATE.INTRO;
  animTimer = 0;

  // 重置坑
  pits = [];
  currentPitIndex = 0;
  pitIdCounter = 0;
  const r = CFG.PIT_RADIUS_MIN;
  // 第一坑放在 intro 结束后的位置前方（球终点 ≈ -0.045）
var introEndY = -CFG.MARBLE_RADIUS;
spawnPitAt(0.58 + Math.random() * 0.08, introEndY + r * 2 * (3 + Math.random() * 1), r);
  for (let i = 0; i < 3; i++) spawnNextPit();

  // 标记宝物坑
  if (pits.length > 0) { treasureFirstPitIndex = pits[0]._index; treasureNextPitSeq = 6 + Math.floor(Math.random() * 6); friendImgNextSeq = 5 + Math.floor(Math.random() * 6); }
  markTreasureForNewPits();

  // 重置状态
  score = 0;
  comboCount = 0;
  sessionBestCombo = 0;
  duplicateTreasureStash = {};
  sessionProps = { heart: 1, jump: 1, force: 1 };
  // 签到攒的道具叠加到本局
  if (zhuzhuProps.heart > 0) { sessionProps.heart += zhuzhuProps.heart; zhuzhuProps.heart = 0; }
  if (zhuzhuProps.jump > 0) { sessionProps.jump += zhuzhuProps.jump; zhuzhuProps.jump = 0; }
  if (zhuzhuProps.force > 0) { sessionProps.force += zhuzhuProps.force; zhuzhuProps.force = 0; }
  saveProps();
  sessionTreasureCount = 0;
  sessionTreasureList = []; sessionTreasureCounts = {}; treasureExchanged = false;
  propMagnetActive = false; propMagnetPitIndex = -1; propHeartFly = null;
  propHeartQueue = 0; propHeartFlyActive = false; gameOverAutoContinue = false;
  pendingPropType = null; pendingPropList = []; propIconParticles = [];
  treasureParticles = [];
  chargePower = 0;
  marble._levelCleared = false;
  marble._levelFailed = false;
  marble._pitsShort = 0;
  marble._jumpPropAnim = false;
  camera.worldX = -0.8;
  camera.worldY = -0.6;
  camera.targetX = -0.8;
  camera.targetY = -0.6;
}

// ============================================================
// 十一、主循环
// ============================================================
let lastTime = Date.now();

function loop() {
  try {
    const now = Date.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.016;
    updateFloatingHearts(dt);
    update(dt);
    render(dt);
  } catch(e) {
    console.error('[Loop] ' + e.message);
    // 画出错提示（保持显示）
    ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
    ctx.fillText('Error: ' + e.message, 20, 40);
    ctx.fillText('Line: ' + (e.lineNumber || ''), 20, 60);
  }
  requestAnimationFrame(loop);
}

function update(dt) {
  // 经典模式：独立更新
  if (gameState === STATE.CLASSIC) { classicUpdate(dt); return; }

  // 宝物光点动画 + 道具动画（始终更新）
  updateTreasureParticles(dt);
  updatePropHeartFly(dt);
  updateMagnetParticles(dt);
  updatePropIconParticles(dt);
  // 爱心为0时自动使用道具爱心（宝物流程中不触发，避免打断）
  if (livesData.lives <= 0 && sessionProps.heart > 0 && !propHeartFlyActive && !treasurePopup && !treasureWaitingParticles && !dupExchangePopup) {
    propHeartQueue = sessionProps.heart;
    sessionProps.heart = 0;
    propHeartFlyActive = true;
  }
  // 光点飞完→到账+平滑跳出+重生
  if (treasureWaitingParticles && treasureParticles.length === 0) {
    treasureWaitingParticles = false;
    sessionTreasureCount += pendingTreasureCount;
    pendingTreasureCount = 0;
    pitTreasureIcon = null;
    // 记录起跳位置（当前在坑中心），落点为 _landX, _landY
    marble._jumpFromX = marble.worldX;
    marble._jumpFromY = marble.worldY;
    if (marble._landX === undefined) { marble._landX = marble.worldX; marble._landY = marble.worldY; }
    playSfx('luo');
    marble.scale = 0.80;
    gameState = STATE.RESPAWN; animTimer = 0;
  }

  // 弹窗时冻结游戏逻辑
  if (treasurePopup || treasureGoConfirm || dupExchangePopup || treasureWaitingParticles || propHeartFlyActive || propIconParticles.length > 0) return;
  // 道具爱心补完后自动继续
  if (gameOverAutoContinue) {
    gameOverAutoContinue = false;
    // 复活到最近走过的坑
    var vp4 = pits.filter(function(p){ return p.visited; });
    var lp4 = vp4.length > 0 ? vp4.reduce(function(a,b){ return a._index > b._index ? a : b; }) : null;
    if (lp4) {
      var np4 = pits.find(function(p){ return !p.visited; });
      var an4 = 0;
      if (np4) an4 = Math.atan2(np4.worldX - lp4.worldX, np4.worldY - lp4.worldY);
      var d4 = lp4.radius + CFG.MARBLE_RADIUS + 0.04;
      marble.worldX = lp4.worldX + Math.sin(an4) * d4;
      marble.worldY = lp4.worldY + Math.cos(an4) * d4;
    } else { marble.worldX = 0.5; marble.worldY = -CFG.MARBLE_RADIUS; }
    marble.vx = 0; marble.vy = 0; marble.scale = 1; comboCount = 0;
    gameState = STATE.IDLE;
    camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
    return;
  }

  // 相机平滑跟随（滚动时更快）
  const lerp = (gameState === STATE.ROLLING) ? CFG.CAMERA_LERP_ROLL : CFG.CAMERA_LERP_IDLE;
  camera.worldY += (camera.targetY - camera.worldY) * lerp;

  switch (gameState) {
    case STATE.HOME:
      updateHomeMarbles(dt);
      break;

    case STATE.INTRO:
      updateIntro(dt);
      camera.targetY = -CFG.MARBLE_RADIUS - CFG.CAMERA_OFFSET;
      break;

    case STATE.CHARGING:
      updateCharging(dt);
      updateChargeParticles(dt);
      camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
      break;

    case STATE.ROLLING:
      updateRolling(dt);
      camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
      break;

    case STATE.SINKING:
      updateSinking(dt);
      break;

    case STATE.RESPAWN:
      updateRespawn(dt);
      break;

    case STATE.IDLE:
      camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
      break;

    case STATE.LOST:
    case STATE.GAMEOVER:
    case STATE.WIN:
    case STATE.SKIN:
    case STATE.SETTINGS:
    case STATE.CONFIRM:
    case STATE.RANK:
    case STATE.BADGES:
    case STATE.STORY:
    case STATE.FEEDBACK:
    case STATE.CHECKIN:
    case STATE.TREASURE:
    case STATE.LEVELSEL:
      // 轮播图自动切换（每3秒）
      if (storyLevel > 0) {
        var vs = storySlideImgs.filter(function(img) { return img && img.width > 0; });
        if (vs.length > 1) {
          storySlideTimer += dt;
          if (storySlideTimer >= 3) { storySlideTimer = 0; storySlideIndex++; }
        }
      }
      // 闪烁光标计时
      storyCursorBlink += dt;
      // 打字机动画
      if (storyLevel > 0 && storyLineIdx < storyLines.length) {
        if (storyPauseTimer > 0) {
          storyPauseTimer -= dt;
        } else {
          var prevPos = Math.floor(storyLinePos);
          storyLinePos += 9 * dt;
          var newPos = Math.floor(storyLinePos);
          if (newPos > prevPos && newPos % 3 === 0 && storyLines[storyLineIdx].length > 0) {
            playSfx('type');
          }
          if (storyLinePos >= storyLines[storyLineIdx].length) {
            storyLinePos = storyLines[storyLineIdx].length;
            var isEnd = storyLines[storyLineIdx].length === 0;
            storyPauseTimer = isEnd ? 0.6 : 0.3;
            storyLineIdx++;
            storyLinePos = 0;
          }
        }
        var done2 = 0;
        for (var si2 = 0; si2 < storyLineIdx; si2++) done2 += storyLines[si2].length + 1;
        done2 += Math.floor(storyLinePos);
        storyTypedLen = done2;
      } else if (storyLevel > 0 && storyLineIdx >= storyLines.length && sfxPool['type']) {
        sfxPool['type'].stop();
      }
      break;
  }

  drawTip(dt);
}

function updateIntro(dt) {
  animTimer += dt;
  var targetX = 0.5, targetY = -CFG.MARBLE_RADIUS;
  var startX = -1.5, startY = -2;
  var dur = 1.5;
  var t = Math.min(animTimer / dur, 1);
  var ease = 1 - Math.pow(1 - t, 3);
  marble.worldX = startX + (targetX - startX) * ease;
  marble.worldY = startY + (targetY - startY) * ease;
  marble.vx = (targetX - startX) * 3 * (1-t)*(1-t) / dur;
  marble.vy = (targetY - startY) * 3 * (1-t)*(1-t) / dur;
  marble.texOffX = marble.worldX * 150;
  marble.texOffY = marble.worldY * 150;
  if (t >= 1) {
    marble.worldX = targetX; marble.worldY = targetY;
    marble.vx = 0; marble.vy = 0;
    marble.scale = 1; marble.sinkY = 0;
    gameState = STATE.IDLE; animTimer = 0;
  }
}

function updateCharging(dt) {
  var prevDir = chargeDir;
  chargePower += CFG.CHARGE_RATE * dt * chargeDir;
  if (chargePower >= 1) { chargePower = 1; chargeDir = -1; }
  else if (chargePower <= 0) { chargePower = 0; chargeDir = 1; }
}

// ============================================================
// 十二、渲染主函数
// ============================================================
function render(dt) {
  ctx.clearRect(0, 0, W, H);

  // 经典模式：独立渲染
  if (gameState === STATE.CLASSIC) { classicRender(); return; }

  // 故事回顾
  if (gameState === STATE.STORY) { drawStoryPopup(); return; }

  // 意见反馈
  if (gameState === STATE.FEEDBACK) { drawFeedbackPopup(); return; }

  // 签到
  if (gameState === STATE.CHECKIN) { drawCheckinPopup(); return; }

  // 宝箱
  if (gameState === STATE.TREASURE) { drawTreasurePopup(); return; }

  // 关卡选择
  // 关卡选择在下方，先画游戏场景

  // 主页面
  if (gameState === STATE.HOME) {
    drawHomePage();
    // 弹窗（画在首页之上）
    if (classicDisclaimerPopup) { drawClassicDisclaimerPopup(); }
    return;
  }

  // 1. 背景：程序化无限延伸
  drawSky();
  drawGround();

  // 3. 坑 (从远到近)
  // 按 worldY 升序画（远的先画）
  for (let i = 0; i < pits.length; i++) {
    const pit = pits[i];
    // 渐显：新坑从透明到显现
    if (!pit.visited && pit.alpha < 1) {
      pit.alpha += (1 - pit.alpha) * 0.02;
    }
    // 渐隐：走过的坑超过2个后慢慢消失
    if (pit.visited && pit._index < currentPitIndex - 2) {
      pit.alpha += (0 - pit.alpha) * 0.006;
      if (pit.alpha < 0.01) continue;
    }
    // 前方太远不画
    if (pit.worldY > marble.worldY + 3) continue;
    drawPit(pit);
    // 宝物坑标记（光环动画）
    if (pit.hasTreasure && !pit.visited) {
      var sp4 = worldToScreen(pit.worldX, pit.worldY);
      var pitDia2 = pit.radius * W; // 屏幕直径（投影公式 pit.radius*2 * W*0.5 = pit.radius*W）
      var side2 = sp4.x > W * 0.5 ? -1 : 1;
      var tix3 = sp4.x + side2 * pitDia2 * 5; // 5倍坑直径
      var tiy3 = sp4.y;
      var sz4 = 36;
      // 光环（加粗加亮，呼吸感）
      var now2 = Date.now();
      var ringPeriod = 1200;
      var ringT = (now2 % ringPeriod) / ringPeriod;
      var ringEase = ringT < 0.15 ? ringT / 0.15 * 0.3 : (1 - (ringT - 0.15) / 0.85);
      var ringR = sz4/2 + ringT * pitDia2 * 2;
      var breathe = 1 + 0.2 * Math.sin(now2 * 0.004); // 整体呼吸
      // 外发光（加粗加亮）
      ctx.beginPath(); ctx.arc(tix3, tiy3, ringR, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(237,151,28,' + (ringEase * 0.25 * breathe) + ')';
      ctx.lineWidth = 12; ctx.stroke();
      // 主光环
      ctx.beginPath(); ctx.arc(tix3, tiy3, ringR, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,190,80,' + (ringEase * 0.7 * breathe) + ')';
      ctx.lineWidth = 3; ctx.stroke();
      // 内发光（亮白）
      ctx.beginPath(); ctx.arc(tix3, tiy3, ringR, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,250,220,' + (ringEase * 0.5 * breathe) + ')';
      ctx.lineWidth = 1.5; ctx.stroke();
      // 第二个波纹（错开半周期）
      var ringTb = ((now2 + ringPeriod/2) % ringPeriod) / ringPeriod;
      var ringEb = ringTb < 0.15 ? ringTb / 0.15 * 0.3 : (1 - (ringTb - 0.15) / 0.85);
      var ringRb = sz4/2 + ringTb * pitDia2 * 2;
      var breathe2 = 1 + 0.2 * Math.sin(now2 * 0.004 + Math.PI);
      ctx.beginPath(); ctx.arc(tix3, tiy3, ringRb, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(237,151,28,' + (ringEb * 0.25 * breathe2) + ')';
      ctx.lineWidth = 12; ctx.stroke();
      ctx.beginPath(); ctx.arc(tix3, tiy3, ringRb, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,190,80,' + (ringEb * 0.7 * breathe2) + ')';
      ctx.lineWidth = 3; ctx.stroke();
      // 宝箱图标
      if (uiIcons.tbox && uiIcons.tbox.width) {
        ctx.drawImage(uiIcons.tbox, tix3 - sz4/2, tiy3 - sz4/2, sz4, sz4);
      } else {
        ctx.fillStyle = 'rgba(237,151,28,0.85)'; ctx.beginPath(); ctx.arc(tix3, tiy3, sz4/2, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('[]', tix3, tiy3 + 4);
      }
    }
    // 友情图片（没有宝箱的坑旁边，珠珠经过也不消失）
    if (pit.hasFriendImg && !pit.hasTreasure && friendImages.length > 0 && pit.alpha > 0.01) {
      var fsp = worldToScreen(pit.worldX, pit.worldY);
      var fdia = pit.radius * W;
      var fside = fsp.x > W * 0.5 ? -1 : 1;
      var fix = fsp.x + fside * fdia * 5.5;
      var fiy = fsp.y;
      var fsz = 88;
      var fimg = friendImages[pit.friendImgIdx % friendImages.length];
      if (fimg && fimg.width) {
        ctx.globalAlpha = pit.alpha;
        ctx.drawImage(fimg, fix - fsz/2, fiy - fsz/2, fsz, fsz);
        ctx.globalAlpha = 1;
      }
    }
  }

  // 4. 珠珠
  drawMarble();

  // 4.5 返回按钮
  drawBackButton();

  // 4.6 模式标题
  drawModeTitle();

  drawLevelProgress();


  // 5. 分数
  drawScore();
  drawBestScore();
  drawLives();

  // 6. 蓄力指示环
  drawChargeIndicator();

  // 7. 操作提示
  drawTip(dt);

  // 9. 飘浮爱心
  drawFloatingHearts();

  // 9.5 道具栏 + 磁铁特效
  drawPropBar();
  drawMagnetEffect();
  if (propGetPopup) drawPropGetPopup();
  drawPropHeartFly();
  drawPropIconParticles();

  // 10. 游戏结束
  if (gameState === STATE.BADGES) { drawBadgesPopup(); return; }
  if (gameState === STATE.RANK) { drawRankPopup(); return; }
  if (gameState === STATE.CONFIRM) { drawConfirmPopup(); return; }
  if (gameState === STATE.SETTINGS) { drawSettingsPopup(); return; }
  if (gameState === STATE.SKIN) { drawSkinPopup(); return; }
  if (gameState === STATE.WIN) { drawWinPopup(); }
  // 宝箱小图标（选关弹窗下层）
  var tix2, tiy2;
  var ly3 = H * 0.15;
  if (gameMode === 'levels') {
    tix2 = W - 78; tiy2 = ly3 + 33;
  } else {
    tix2 = W - 78; tiy2 = ly3 + 16 + 30;
  }
  if (gameState !== STATE.HOME && gameState !== STATE.CLASSIC && gameState !== STATE.STORY && gameState !== STATE.FEEDBACK && gameState !== STATE.CHECKIN && gameState !== STATE.TREASURE && gameState !== STATE.BADGES && gameState !== STATE.RANK && gameState !== STATE.CONFIRM && gameState !== STATE.SETTINGS && gameState !== STATE.SKIN) {
    var icoSz2 = 32;
    if (uiIcons.tbox && uiIcons.tbox.width) {
      ctx.drawImage(uiIcons.tbox, tix2, tiy2, icoSz2, icoSz2);
    } else {
      ctx.fillStyle = 'rgba(237,151,28,0.7)'; roundRectPath(tix2, tiy2, icoSz2, icoSz2, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('[]', tix2 + icoSz2/2, tiy2 + icoSz2/2 + 4);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(sessionTreasureCount, W - 26, tiy2 + icoSz2/2 + 7);
    ctx.fillStyle = '#fff';
    ctx.fillText(sessionTreasureCount, W - 28, tiy2 + icoSz2/2 + 6);
    treasureTargetIcon = { x: tix2, y: tiy2, w: icoSz2, h: icoSz2 };
  }
  // 选关弹窗 + 结算
  if (gameState === STATE.LEVELSEL) { drawLevelSelPopup(); }
  if (gameState === STATE.LOST || gameState === STATE.GAMEOVER) { drawGameOver(); }
  // 坑旁宝箱图标（发现宝物时显示在坑旁边，光环动画）
  if (pitTreasureIcon && (treasurePopup || treasureWaitingParticles)) {
    var ptx3 = pitTreasureIcon.x, pty3 = pitTreasureIcon.y;
    var sz3 = 36;
    var pitDia3 = pitTreasureIcon.dia || 50;
    var now3 = Date.now();
    var ringPeriod2 = 1200;
    var ringT2 = (now3 % ringPeriod2) / ringPeriod2;
    var ringEase2 = ringT2 < 0.15 ? ringT2 / 0.15 * 0.3 : (1 - (ringT2 - 0.15) / 0.85);
    var ringR2 = sz3/2 + ringT2 * pitDia3 * 2;
    var breathe3 = 1 + 0.2 * Math.sin(now3 * 0.004);
    // 外发光（加粗加亮）
    ctx.beginPath(); ctx.arc(ptx3, pty3, ringR2, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(237,151,28,' + (ringEase2 * 0.25 * breathe3) + ')';
    ctx.lineWidth = 12; ctx.stroke();
    // 主光环
    ctx.beginPath(); ctx.arc(ptx3, pty3, ringR2, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,190,80,' + (ringEase2 * 0.7 * breathe3) + ')';
    ctx.lineWidth = 3; ctx.stroke();
    // 内发光（亮白）
    ctx.beginPath(); ctx.arc(ptx3, pty3, ringR2, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,250,220,' + (ringEase2 * 0.5 * breathe3) + ')';
    ctx.lineWidth = 1.5; ctx.stroke();
    // 第二个波纹（错开半周期）
    var ringTb2 = ((now3 + ringPeriod2/2) % ringPeriod2) / ringPeriod2;
    var ringEb2 = ringTb2 < 0.15 ? ringTb2 / 0.15 * 0.3 : (1 - (ringTb2 - 0.15) / 0.85);
    var ringRb2 = sz3/2 + ringTb2 * pitDia3 * 2;
    var breathe4 = 1 + 0.2 * Math.sin(now3 * 0.004 + Math.PI);
    ctx.beginPath(); ctx.arc(ptx3, pty3, ringRb2, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(237,151,28,' + (ringEb2 * 0.25 * breathe4) + ')';
    ctx.lineWidth = 12; ctx.stroke();
    ctx.beginPath(); ctx.arc(ptx3, pty3, ringRb2, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(255,190,80,' + (ringEb2 * 0.7 * breathe4) + ')';
    ctx.lineWidth = 3; ctx.stroke();
    if (uiIcons.tbox && uiIcons.tbox.width) {
      ctx.drawImage(uiIcons.tbox, ptx3 - sz3/2, pty3 - sz3/2, sz3, sz3);
    } else {
      ctx.fillStyle = 'rgba(237,151,28,0.85)'; ctx.beginPath(); ctx.arc(ptx3, pty3, sz3/2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('[]', ptx3, pty3 + 4);
    }
  }
  // 宝物发现弹窗（最上层）
  if (treasurePopup) { drawTreasureFoundPopup(); }
  // 前往宝箱确认弹窗
  if (treasureGoConfirm) { drawTreasureGoConfirm(); }
  // 重复宝物兑换弹窗
  if (dupExchangePopup) { drawDupExchangePopup(); }
  // 经典模式声明弹窗（仅首页）
  if (classicDisclaimerPopup && gameState === STATE.HOME) { drawClassicDisclaimerPopup(); }
  // 光点粒子
  drawTreasureParticles();
}

// ============================================================
// 十三、初始化 & 启动
// ============================================================
function preloadSfx() {
  var sfxNames = ['peng','luo','power','jingdian','victory','fail','speed','btn','type'];
  for (var si = 0; si < sfxNames.length; si++) {
    var name = sfxNames[si];
    try {
      var a = wx.createInnerAudioContext();
      a.src = 'assets/audio/sfx/' + name + '.mp3';
      sfxPool[name] = a;
    } catch(e) {
      console.warn('[SFX] Failed to create audio for ' + name + ': ' + e.message);
      // 创建一个哑对象防止后续调用报错
      sfxPool[name] = { play: function(){}, pause: function(){}, stop: function(){}, destroy: function(){}, volume: 0, onEnded: null, src: '' };
    }
  }
}

function initBGM() {
  try {
    if (bgmAudio) { bgmAudio.destroy(); bgmAudio = null; }
    bgmAudio = wx.createInnerAudioContext();
    bgmAudio.src = 'assets/audio/bgm/love.mp3';
    bgmAudio.loop = true;
    bgmAudio.autoplay = false;
    bgmAudio.obeyMuteSwitch = false;
    bgmAudio.volume = musicVolume;
    if (musicOn) { bgmAudio.stop(); bgmAudio.play(); }
    console.log('[BGM] Loaded love.mp3');
  } catch(e) {
    console.warn('[BGM] Failed to init BGM: ' + e.message);
    // 创建哑对象防止后续调用报错
    bgmAudio = { play: function(){}, pause: function(){}, stop: function(){}, destroy: function(){}, volume: 0, loop: false };
  }
}

function toggleMusic() {
  musicOn = !musicOn;
  if (bgmAudio) {
    if (musicOn) bgmAudio.play();
    else bgmAudio.pause();
  }
}

// ============================================================
// 经典模式 — 核心实现
// ============================================================

function showClassicDisclaimerOrStart() {
  if (classicDisclaimerSkip) {
    // 已选不再提醒，直接进入
    gameMode = 'classic';
    playSfx('btn');
    try { startClassicGame('ai'); } catch(e) { console.error(e); }
  } else {
    classicDisclaimerPopup = true;
  }
}

function startClassicGame(mode) {
  classicDisclaimerPopup = false;
  hideUserInfoButton();
  console.log('[Classic] startClassicGame called, mode:', mode);
  var savedMultiMode = classicData ? classicData._multiMode : null;
  var savedMultiPlayers = classicData ? classicData._multiPlayers : [];
  var savedMultiRoomId = classicData ? classicData._multiRoomId : '';
  var savedMultiIsHost = classicData ? classicData._multiIsHost : false;
  resetClassicData();
  propGetPopup = false; propGetType = '';
  loadPlayerProfile();
  // 恢复多人状态（resetClassicData会清掉）
  classicData._multiMode = savedMultiMode;
  classicData._multiPlayers = savedMultiPlayers;
  classicData._multiRoomId = savedMultiRoomId;
  classicData._multiIsHost = savedMultiIsHost;

  // 多人模式初始化
  if (mode === 'multi') {
    var mp = classicData._multiPlayers || [];
    // 确保至少有1人
    if (mp.length < 1) mp = [{ name: '我', order: 0, skin: 'classic_blue', alive: true }];
    classicData.players = [];
    classicData._multiMode = 'game';
    var allSkins2 = MARBLE_SKINS.map(function(s) { return s.id; });
    for (var mi = 0; mi < mp.length; mi++) {
      var skinIdx2 = Math.floor(Math.random() * allSkins2.length);
      if (skinIdx2 >= allSkins2.length) skinIdx2 = 0;
      classicData.players.push({
        name: mp[mi].name || ('玩家' + (mi + 1)),
        avatar: mp[mi].avatar || '',
        skin: allSkins2[skinIdx2] || 'classic_blue',
        order: mi,
        tiger: false,
        locked: true,
        alive: true,
        pitProgress: [],
        ballX: 0.5,
        ballY: 0,
        ballVX: 0, ballVY: 0,
        ballRotation: 0, ballTexOffX: 0, ballTexOffY: 0, ballScale: 1,
        distToPit1: 0,
        isAI: false
      });
      allSkins2.splice(skinIdx2, 1);
    }
    classicData.serveOrder = mp.map(function(p, idx) { return idx; });
    // 找到房主在打乱后的位置
    for (var fi2 = 0; fi2 < mp.length; fi2++) {
      if (mp[fi2].name === '房主' || mp[fi2].isMe) { classicData._multiMyIndex = fi2; break; }
    }
    classicData.currentPlayer = classicData.serveOrder[0];
    var pn0 = classicData.players[classicData.currentPlayer] ? classicData.players[classicData.currentPlayer].name : '?';
    classicData.hintText = '多人[' + mp.length + '人] myIdx=' + classicData._multiMyIndex + ' cur=' + classicData.currentPlayer + ' ' + pn0;
    classicData.phase = CLASSIC_PHASE.SERVING;
    if (classicData.currentPlayer === classicData._multiMyIndex) {
      classicData.players[classicData._multiMyIndex].locked = false;
    }
  } else {
    // 随机分配先后顺序
    const first = Math.random() < 0.5 ? 0 : 1;
    classicData.serveOrder = [first, 1 - first];
    classicData.players[first].order = 0;
    classicData.players[1 - first].order = 1;
    classicData.currentPlayer = classicData.serveOrder[0];

    // 随机分配皮肤（从12种中随机，两人不同）
    const allSkins = MARBLE_SKINS.map(function(s) { return s.id; });
    const idx1 = Math.floor(Math.random() * allSkins.length);
    let idx2 = Math.floor(Math.random() * allSkins.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * allSkins.length);
    classicData.players[0].skin = allSkins[idx1];
    classicData.players[1].skin = allSkins[idx2];
  }

  // 生成3个坑（垂直居中排列，间隔1米）
  classicData.pits = [];
  const pitCenterY = 0.5; // 坑区域中心worldY
  for (let i = 0; i < CLASSIC_PIT_COUNT; i++) {
    classicData.pits.push({
      worldX: 0.5,
      worldY: pitCenterY + (1 - i) * CLASSIC_PIT_SPACING,
      radius: 0.08, // 坑半径
      index: i + 1, // 1, 2, 3
    });
  }
  // 出发线：坑1下方3米
  const startLineY = classicData.pits[0].worldY + CLASSIC_START_DIST;

  // 初始化球位置（都在出发线上，一字排开）
  classicData.players[0].ballX = 0.35;
  classicData.players[0].ballY = startLineY;
  classicData.players[1].ballX = 0.65;
  classicData.players[1].ballY = startLineY;

  // 设置提示
  var firstIdx = classicData.currentPlayer;
  classicData.hintText = firstIdx === 0 ? '你先弹球！瞄准 ① 号坑（进错坑直接输）' : classicPlayerName(firstIdx) + '先弹球';

  // 初始相机：展示坑③到起点线（珠珠位置），占屏幕80%
  // 投影中心在67%处，下方只占33%，需把相机中心上移
  var pit3Y = classicData.pits[2].worldY; // -0.5
  var ballsY = startLineY;                // pits[0].worldY+1.0 = 2.5
  var minY = pit3Y - 0.15;                // 坑③上方留白
  var maxY = ballsY + 0.15;               // 珠珠下方留白
  var spanH = maxY - minY;                // 总跨度
  var fitZ = Math.min(W / (0.35 * 400), H / (spanH * 400)) * 0.8;
  fitZ = Math.min(fitZ, 1.5);
  fitZ = Math.max(fitZ, 0.3);
  // 相机中心：屏幕下33%对准maxY，上67%对准minY
  var viewCY = maxY - spanH * 0.33;       // 让底部留33%=刚好看到珠珠
  classicData.cameraTargetX = 0.5;
  classicData.cameraTargetY = viewCY;
  classicData.cameraZoom = fitZ;
  classicData._camX = 0.5;
  classicData._camY = viewCY;
  classicData._camZoom = fitZ;

  // 初始方向随机
  classicData.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;

  // 锁定所有玩家，等intro后解锁当前玩家
  classicData.players[0].locked = true;
  classicData.players[1].locked = true;

  // 切换到经典模式场景
  switchScene('grandma_backyard');
  gameState = STATE.CLASSIC;
  classicData.phase = CLASSIC_PHASE.INTRO;
  classicData.introAnimTimer = 0;

  // 经典模式继续播放首页背景音乐
}

function loadPlayerProfile() {
  // 使用已缓存的微信头像昵称
  if (userProfile.nickname) {
    classicData.players[0].name = userProfile.nickname;
  } else {
    classicData.players[0].name = '玩家';
  }
  classicData.players[0].avatar = userProfile.avatar || '';
  if (classicData._multiMode !== 'game') {
    classicData.players[1].name = '小迪';
    classicData.players[1].avatar = '';
  }
}

// 多人同步：上传本地状态到云端
function multiSyncUpload() {
  var cd = classicData;
  if (!cd || cd._multiMode !== 'game' || !cd._multiRoomId) return;
  var state = {
    phase: cd.phase,
    currentPlayer: cd.currentPlayer,
    chargePower: cd.chargePower || 0,
    aimingAngle: cd.aimingAngle || 0,
    playerInput: cd._multiInput || null, // 远程玩家输入
    players: cd.players.map(function(p) {
      return { ballX: p.ballX, ballY: p.ballY, ballVX: p.ballVX, ballVY: p.ballVY, pitProgress: p.pitProgress, alive: p.alive, locked: p.locked, tiger: p.tiger, name: p.name, skin: p.skin, order: p.order };
    }),
    pits: cd.pits.map(function(p) { return { worldX: p.worldX, worldY: p.worldY, radius: p.radius, index: p.index, visited: p.visited }; }),
    hintText: cd.hintText || '',
    winner: cd.winner,
    tigerBallPlayer: cd.tigerBallPlayer,
    serveOrder: cd.serveOrder,
    selectedTarget: cd.selectedTarget ? { worldX: cd.selectedTarget.worldX, worldY: cd.selectedTarget.worldY, type: cd.selectedTarget.type, pitIndex: cd.selectedTarget.pitIndex } : null,
    targetOptions: (cd.targetOptions || []).map(function(o) { return { worldX: o.worldX, worldY: o.worldY, type: o.type, pitIndex: o.pitIndex }; }),
    bothServed: cd.bothServed,
    serveCount: cd.serveCount
  };
  try {
    wx.cloud.callFunction({ name: 'roomManager', data: { action: 'updateGame', roomId: cd._multiRoomId, gameData: state } }).catch(function(){});
  } catch(e) {}
}

// 多人同步：从云端下载状态
function multiSyncDownload(callback) {
  var cd = classicData;
  if (!cd || !cd._multiRoomId) return;
  try {
    wx.cloud.callFunction({ name: 'roomManager', data: { action: 'get', roomId: cd._multiRoomId } }).then(function(r) {
      if (r.result && r.result.ok && r.result.room) {
        callback(r.result.room.gameData, r.result.room);
      }
    }).catch(function(){});
  } catch(e) {}
}

function classicUpdate(dt) {
  if (!classicData) return;
  try {
  const cd = classicData;
  cd.animTimer += dt;

  // 相机平滑插值
  var cameraLerp = 0.08;
  cd._camX = cd._camX || cd.cameraTargetX;
  cd._camY = cd._camY || cd.cameraTargetY;
  cd._camZoom = cd._camZoom || cd.cameraZoom;
  cd._camX += (cd.cameraTargetX - cd._camX) * cameraLerp;
  cd._camY += (cd.cameraTargetY - cd._camY) * cameraLerp;
  cd._camZoom += (cd.cameraZoom - cd._camZoom) * cameraLerp;

  // 聚焦延时计时（玩家回合先看全景2秒再聚焦自己）
  if (cd._focusTimer > 0) {
    cd._focusTimer -= dt;
    if (cd._focusTimer <= 0) {
      var cp4 = cd.players[0];
      cd.cameraTargetX = cp4.ballX;
      cd.cameraTargetY = cp4.ballY;
      cd.cameraZoom = 1.5;
      cd._focusTimer = 0;
    }
  }

  // 自动视角：AI回合→全景，玩家回合→先classicFocusPlayer再2秒后聚焦自己
  if (cd.currentPlayer !== 0 && (cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING || cd.phase === CLASSIC_PHASE.ROLLING)) {
    // 对手回合：始终全景，清除发球视角标记
    cd._viewManual = false;
    if (!cd._viewToggle) {
      cd._viewToggle = true;
      classicShowAll(null, false);
    }
  } else if (!cd._viewManual && cd.currentPlayer === 0 && cd.phase === CLASSIC_PHASE.SERVING) {
    // 玩家回合：先聚焦玩家+三坑60%，2秒后聚焦自己球
    if (!cd._viewToggle) {
      classicFocusPlayer();
      cd._focusTimer = 2.0;
    }
  }

  // 多人模式：房间轮询 + 存活检测
  if (cd._multiMode === 'lobby' && cd._multiRoomId) {
    cd._multiPollTimer = (cd._multiPollTimer || 0) + dt;
    if (cd._multiPollTimer > 2.0) {
      cd._multiPollTimer = 0;
      try {
        wx.cloud.callFunction({ name: 'roomManager', data: { action: 'get', roomId: cd._multiRoomId } }).then(function(r) {
          if (r.result && r.result.ok && r.result.room) {
            var room = r.result.room;
            cd._multiPlayers = room.players;
            if (room.status === 'playing') {
              cd._multiMode = 'game';
              cd._multiPlayers = room.players;
              // 找到自己在玩家列表中的索引（非房主=最后一个加入的玩家）
              cd._multiMyIndex = room.players.length - 1;
              cd.players = room.players.map(function(p, idx) {
                return { name: p.name || ('玩家'+(idx+1)), skin: p.skin || 'classic_green', order: p.order, tiger: false, locked: true, alive: p.alive, pitProgress: [], ballX: 0.5, ballY: 0, ballVX: 0, ballVY: 0, ballRotation: 0, ballTexOffX: 0, ballTexOffY: 0, ballScale: 1, distToPit1: 0, isAI: false };
              });
              // 保持云端打乱顺序，找到本地玩家在该顺序中的索引
              var myPIdx2 = room.players.length - 1; // 非房主=最后一个加入的
              cd._multiMyIndex = myPIdx2;
              cd.serveOrder = room.players.map(function(p, idx) { return idx; });
              cd.currentPlayer = room.currentPlayer || 0;
              cd.phase = CLASSIC_PHASE.SERVING;
              // 初始化坑和相机
              cd.pits = [
                { worldX: 0.5, worldY: 1.5, radius: 0.08, index: 1 },
                { worldX: 0.5, worldY: 0.5, radius: 0.083, index: 2 },
                { worldX: 0.5, worldY: -0.5, radius: 0.083, index: 3 }
              ];
              cd.cameraTargetX = 0.5; cd.cameraTargetY = 1.0; cd.cameraZoom = 0.55;
              cd._camX = 0.5; cd._camY = 1.0; cd._camZoom = 0.55;
              cd._viewToggle = true;
            }
          }
        }).catch(function(){});
      } catch(e) {}
    }
  }

  if (cd._multiMode === 'game' && cd.players.length > 2) {
    var aliveCount = 0;
    for (var ai = 0; ai < cd.players.length; ai++) {
      if (cd.players[ai].alive) aliveCount++;
    }
    if (aliveCount <= 1 && cd.phase !== CLASSIC_PHASE.GAMEOVER) {
      var lastAlive = cd.players.find(function(p){ return p.alive; });
      cd.winner = lastAlive ? cd.players.indexOf(lastAlive) : -1;
      cd.phase = CLASSIC_PHASE.GAMEOVER;
      cd.hintText = '游戏结束！\n' + (lastAlive ? lastAlive.name : '') + '获胜！';
    }
  }

  // 碰撞冷却计时
  if (cd._collisionTimer > 0) cd._collisionTimer -= dt;

  // 获胜延迟计时
  if (cd._winDelay > 0) {
    cd._winDelay -= dt;
    if (cd._winDelay <= 0) {
      cd.phase = CLASSIC_PHASE.GAMEOVER;
      cd._winDelay = 0;
      if (cd.winner === 0) cd._fireworkDelay = 0.5; // 玩家赢才放烟花
      if (cd._winSfx) { playSfx(cd._winSfx); cd._winSfx = ''; }
    }
  }
  // 烟花延迟计时
  if (cd._fireworkDelay > 0) {
    cd._fireworkDelay -= dt;
    if (cd._fireworkDelay <= 0) {
      cd._fireworkDelay = 0;
      for (var fi = 0; fi < 50; fi++) {
        var shapeType = Math.random();
        var sides;
        if (shapeType < 0.35) sides = 3;
        else if (shapeType < 0.7) sides = 4;
        else sides = 8 + Math.floor(Math.random() * 6);
        var verts = [];
        for (var vi = 0; vi < sides; vi++) {
          var baseAngle = (vi / sides) * Math.PI * 2;
          var jitter = (Math.random() - 0.5) * Math.PI / sides;
          verts.push({ r: 0.5 + Math.random() * 0.5, a: baseAngle + jitter });
        }
        cd._fireworks.push({
          x: W / 2 + (Math.random() - 0.5) * W * 0.5,
          y: H * 0.8 + (Math.random() - 0.5) * H * 0.1,
          vx: (Math.random() - 0.5) * 250,
          vy: -300 - Math.random() * 400,
          life: 2.2 + Math.random() * 3.0,
          maxLife: 2.2 + Math.random() * 3.0,
          size: 4 + Math.random() * 10,
          color: ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF922B','#845EF7','#F06595','#20C997'][Math.floor(Math.random()*8)],
          rot: Math.random() * Math.PI * 2,
          rotSpd: (Math.random() - 0.5) * 10,
          verts: verts,
        });
      }
    }
  }
  // 烟花粒子更新（始终运行）
  for (var fii = cd._fireworks.length - 1; fii >= 0; fii--) {
    var fw = cd._fireworks[fii];
    fw.x += fw.vx * dt;
    fw.y += fw.vy * dt;
    fw.vy += 300 * dt;
    fw.life -= dt;
    fw.rot += fw.rotSpd * dt;
    if (fw.life <= 0) cd._fireworks.splice(fii, 1);
  }

  // 倒计时更新
  if (cd._countdown > 0) {
    cd._countdownTimer -= dt;
    if (cd._countdownTimer <= 0) {
      cd._countdown--;
      if (cd._countdown <= 0) {
        // 倒计时结束，执行后续动作
        cd._countdown = 0;
        if (cd._countdownNext) { cd._countdownNext(); cd._countdownNext = null; }
      } else {
        cd._countdownTimer = 1.0; // 每秒减1
      }
    }
  }

  // 多人模式：非房主设备只做显示器，不运行游戏逻辑
  if (cd._multiMode === 'game' && cd.players.length > 1) {
    if (!cd._multiIsHost) {
      // 非房主设备：实时watch + 自己的回合时上传输入
      if (!cd._multiWatcher && cd._multiRoomId) {
        try {
          var watcher = wx.cloud.database().collection('multi_rooms').where({ roomId: cd._multiRoomId }).watch({
            onChange: function(snapshot) {
              if (!snapshot.docs || snapshot.docs.length === 0) return;
              var state = snapshot.docs[0].gameData;
              if (!state || !state.players) return;
              var myTurn = false;
              var mySrvIdx2 = cd._multiMyIndex || 0;
              for (var si = 0; si < state.players.length && si < cd.players.length; si++) {
                var sp2 = state.players[si];
                // 自己的球不覆盖（当服务端指示是本人回合时，保留本地物理）
                var isMyActivePhase = (state.phase === 'serving' || state.phase === 'aiming' || state.phase === 'rolling') && state.currentPlayer === mySrvIdx2;
                if (si !== mySrvIdx2 || !isMyActivePhase) {
                  cd.players[si].ballX = sp2.ballX;
                  cd.players[si].ballY = sp2.ballY;
                  cd.players[si].ballVX = sp2.ballVX || 0;
                  cd.players[si].ballVY = sp2.ballVY || 0;
                }
                cd.players[si].pitProgress = sp2.pitProgress || [];
                cd.players[si].alive = sp2.alive;
                cd.players[si].locked = sp2.locked;
                cd.players[si].name = sp2.name;
                cd.players[si].skin = sp2.skin;
              }
              cd.phase = state.phase || cd.phase;
              cd.currentPlayer = state.currentPlayer != null ? state.currentPlayer : cd.currentPlayer;
              cd.hintText = (state.hintText || '观战中') + ' [myIdx=' + (cd._multiMyIndex||0) + ' cur=' + (state.currentPlayer!=null?state.currentPlayer:'?') + ']';
              cd.winner = state.winner;
              cd._viewToggle = true;
              if (state.selectedTarget) cd.selectedTarget = state.selectedTarget; else if (state.phase !== 'targetSelect') cd.selectedTarget = null;
              if (state.targetOptions && state.targetOptions.length > 0) cd.targetOptions = state.targetOptions;
              if (state.serveOrder) cd.serveOrder = state.serveOrder;
              // 检测是否轮到自己
              var mySrvIdx = cd._multiMyIndex || 0;
              if (state.currentPlayer === mySrvIdx && (state.phase === 'serving' || state.phase === 'aiming')) {
                cd.players[mySrvIdx].locked = false;
                myTurn = true;
                if (!cd._myTurnRemote) { try { wx.showToast({ title: '轮到你了(watch)！', icon: 'none', duration: 1500 }); } catch(e) {} }
              }
              cd._myTurnRemote = myTurn;
            },
            onError: function(err) { console.error('watch err', err); }
          });
          cd._multiWatcher = watcher;
        } catch(e) { console.error('watch init err', e); }
      }
      // 自己的回合：直接写数据库（高速，绕过云函数）
      if (cd._myTurnRemote && cd.phase !== 'rolling') {
        cd._multiInput = { aimingAngle: cd.aimingAngle, chargePower: cd.chargePower, btnPressed: cd.btnPressed, shoot: cd._multiInput ? cd._multiInput.shoot : false, ts: Date.now() };
        cd._multiSyncTimer2 = (cd._multiSyncTimer2 || 0) + dt;
        if (cd._multiSyncTimer2 > 0.15) {
          cd._multiSyncTimer2 = 0;
          try {
            var db2 = wx.cloud.database();
            db2.collection('multi_input').where({ roomId: cd._multiRoomId }).get().then(function(r2) {
              if (r2.data.length > 0) {
                db2.collection('multi_input').doc(r2.data[0]._id).update({ data: { input: cd._multiInput, roomId: cd._multiRoomId } }).catch(function(){});
              } else {
                db2.collection('multi_input').add({ data: { roomId: cd._multiRoomId, input: cd._multiInput } }).catch(function(){});
              }
            }).catch(function(){});
          } catch(e) {}
        }
        cd.hintText = 'cur=' + cd.currentPlayer + ' my=' + (cd._multiMyIndex||0) + ' p=' + (cd.chargePower||0).toFixed(1) + ' btn=' + cd.btnPressed + ' shoot=' + (cd._multiInput?cd._multiInput.shoot:false);
      }
      // 后备轮询：以防watch不触发
      cd._multiFallbackTimer = (cd._multiFallbackTimer || 0) + dt;
      if (cd._multiFallbackTimer > 1.0) {
        cd._multiFallbackTimer = 0;
        multiSyncDownload(function(state) {
          if (state && state.players) {
            var myI = cd._multiMyIndex || 0;
            var isMyTurn = state.currentPlayer === myI && (state.phase === 'serving' || state.phase === 'aiming');
            if (isMyTurn) {
              if (!cd._myTurnRemote) { wx.showToast({ title: '轮到你！', icon: 'none', duration: 1500 }); }
              cd._myTurnRemote = true;
              cd.currentPlayer = myI;
              cd.players[myI].locked = false;
            } else {
              cd._myTurnRemote = false;
            }
          }
        });
      }
      // 本地运行必要的游戏逻辑（先跑物理，再跑阶段逻辑）
      for (var pi10 = 0; pi10 < cd.players.length; pi10++) {
        var bp = cd.players[pi10];
        var spd = Math.sqrt(bp.ballVX*bp.ballVX + bp.ballVY*bp.ballVY);
        if (spd < 0.003) { bp.ballVX = 0; bp.ballVY = 0; continue; }
        var decay = Math.exp(-CFG.FRICTION * dt);
        bp.ballVX *= decay; bp.ballVY *= decay;
        bp.ballX += bp.ballVX * dt; bp.ballY += bp.ballVY * dt;
        bp.ballTexOffX += bp.ballVX * dt * 150; bp.ballTexOffY += bp.ballVY * dt * 150;
      }
      if (cd._myTurnRemote && (cd.phase === 'serving' || cd.phase === 'aiming')) {
        if (cd.btnPressed) { cd.chargePower = Math.min(1, (cd.chargePower || 0) + dt / 1.5); }
      }
      if (cd._myTurnRemote) {
        cd.hintText = 'p=' + (cd.chargePower||0).toFixed(2) + ' btn=' + cd.btnPressed + ' v=' + (cd.players[cd._multiMyIndex||0]?Math.sqrt(cd.players[cd._multiMyIndex||0].ballVX*cd.players[cd._multiMyIndex||0].ballVX+cd.players[cd._multiMyIndex||0].ballVY*cd.players[cd._multiMyIndex||0].ballVY).toFixed(2):0);
      }
      return;
    }
    // 房主：运行游戏。远程玩家回合时先上传当前状态，再读取其输入
    if (cd.currentPlayer > 0 && cd.currentPlayer < cd.players.length) {
      cd.aiDelayTimer = 0;
      // 首次切换时上传当前状态（通知好友轮到他们了）
      if (!cd._multiNotified) { multiSyncUpload(); cd._multiNotified = true; }
      cd._multiSyncTimer = (cd._multiSyncTimer || 0) + dt;
      if (cd._multiSyncTimer > 0.2) {
        cd._multiSyncTimer = 0;
        try {
          var dbr = wx.cloud.database();
          dbr.collection('multi_input').where({ roomId: cd._multiRoomId }).get().then(function(rr) {
            if (rr.data.length > 0 && rr.data[0].input) {
              var inp = rr.data[0].input;
            cd.aimingAngle = inp.aimingAngle || cd.aimingAngle;
            // 只在SERVING/AIMING阶段处理shoot，防止ROLLING阶段重复发射
            if (inp.shoot && !cd._multiShot && (cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING)) {
              cd._multiShot = true;
              cd.aimingAngle = inp.aimingAngle;
              cd.chargePower = inp.chargePower;
              cd.btnPressed = false;
              cd.hintText = '远程发射! p=' + (inp.chargePower||0).toFixed(2);
              if (cd.chargePower >= 0.05) { classicShoot(); multiSyncUpload(); }
              else { cd.hintText = '远程蓄力不足 p=' + (inp.chargePower||0).toFixed(2); }
              // 清除shoot标记，让下次回合能重新检测
              cd._multiShot = false;
              try { var dbc2 = wx.cloud.database(); dbc2.collection('multi_input').where({ roomId: cd._multiRoomId }).get().then(function(rc2){ if(rc2.data.length>0) dbc2.collection('multi_input').doc(rc2.data[0]._id).update({data:{input:{shoot:false,ts:Date.now(),roomId:cd._multiRoomId}}}).catch(function(){}); }).catch(function(){}); } catch(e){}
            } else if (!inp.shoot) {
              cd._multiShot = false;
            }
            if (!cd._multiShot && inp.btnPressed && !cd.btnPressed) {
              cd.btnPressed = true; cd.chargePower = 0; cd.hintText = '好友蓄力中...';
            }
            if (cd.btnPressed) { cd.chargePower = Math.min(1, (cd.chargePower || 0) + dt / 1.5); }
          } else {
            cd.hintText = '等待好友操作... cur=' + cd.currentPlayer;
          }
        });
        } catch(e) {}
      }
    } else {
      cd._multiSyncTimer = (cd._multiSyncTimer || 0) + dt;
      if (cd._multiSyncTimer > 0.25) { cd._multiSyncTimer = 0; multiSyncUpload(); }
    }
  }

  // 持续碰撞检测
  classicCheckBallCollision();

  var isGameOver = cd.phase === CLASSIC_PHASE.GAMEOVER || cd._winDelay > 0;

  // 球物理始终运行（让被击飞的球继续滚动）
  for (var pi4 = 0; pi4 < cd.players.length; pi4++) {
    var bp2 = cd.players[pi4];
    var spd3 = Math.sqrt(bp2.ballVX * bp2.ballVX + bp2.ballVY * bp2.ballVY);
    if (spd3 < 0.005) { bp2.ballVX = 0; bp2.ballVY = 0; continue; }
    var decay3 = Math.exp(-CFG.FRICTION * dt);
    bp2.ballVX *= decay3;
    bp2.ballVY *= decay3;
    // 低速额外阻力
    if (spd3 < 0.8 && spd3 > 0.001) {
      var lowDrag3 = (0.8 - spd3) * 1.3;
      var extraDecay3 = Math.exp(-lowDrag3 * dt);
      bp2.ballVX *= extraDecay3;
      bp2.ballVY *= extraDecay3;
    }
    bp2.ballX += bp2.ballVX * dt;
    bp2.ballY += bp2.ballVY * dt;
    bp2.ballTexOffX -= bp2.ballVX * dt * 150;
    bp2.ballTexOffY -= bp2.ballVY * dt * 150;
  }

  if (isGameOver) return;

  switch (cd.phase) {
    case CLASSIC_PHASE.INTRO:
      classicUpdateIntro(dt);
      break;
    case CLASSIC_PHASE.SERVING:
      classicUpdateServing(dt);
      break;
    case CLASSIC_PHASE.ROLLING:
      classicUpdateRolling(dt);
      break;
    case CLASSIC_PHASE.TARGET_SELECT:
      // 等待玩家点击目标
      break;
    case CLASSIC_PHASE.AIMING:
      classicUpdateServing(dt); // 蓄力逻辑相同
      break;
    case CLASSIC_PHASE.GAMEOVER:
      break;
  }

  // 提示计时
  if (cd.hintTimer > 0) {
    cd.hintTimer -= dt;
    if (cd.hintTimer < 0) cd.hintTimer = 0;
  }

  // AI 延迟计时（倒计时期间不计时，多人模式不触发AI）
  if (cd.aiDelayTimer > 0 && cd._countdown <= 0 && cd._multiMode !== 'game') {
    cd.aiDelayTimer -= dt;
    if (cd.aiDelayTimer <= 0) {
      classicAIShoot(cd.currentPlayer);
    }
  }
  } catch(e) { console.error('[ClassicUpdate]', e.message); }
}

function classicUpdateIntro(dt) {
  const cd = classicData;
  cd.introAnimTimer += dt;

  // intro后先全景1秒
  if (cd.introAnimTimer > 0.8 && cd._countdown <= 0) {
    var firstPlayer = cd.currentPlayer;
    // 全景视角
    if (!cd._viewToggle) {
      cd._viewToggle = true;
      classicShowAll(null, true);
    }
    // 1秒后→开始3秒倒计时，玩家先发则倒计时结束后切发球视角
    if (cd.introAnimTimer > 1.8) {
      cd._countdown = 3;
      cd._countdownTimer = 1.0;
      cd._countdownHint = classicPlayerName(firstPlayer) + '弹球';
    }
    if (cd._countdown <= 0) return;
    var cdRef = cd;
    cd._countdownNext = function() {
      cdRef.players[firstPlayer].locked = false;
      cdRef.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;
      cdRef.phase = CLASSIC_PHASE.SERVING;
      cdRef.hintText = classicPlayerName(firstPlayer) + '弹球！瞄准 ① 号坑';
      if (firstPlayer === 0) {
        classicFocusServe();
        cdRef._viewToggle = false;
        cdRef._viewManual = true; // 防止自动视角覆盖发球视角
      }
      if (firstPlayer === 1 && cdRef._multiMode !== 'game') {
        cdRef.aiDelayTimer = 0.4 + Math.random() * 0.3;
      }
    };
  }
}

function classicUpdateServing(dt) {
  const cd = classicData;
  // 蓄力：按住时线性上升 0→1（约1.5秒满）
  if (cd.btnPressed) {
    cd.chargePower = Math.min(1, cd.chargePower + dt / 1.5);
  }
}

function classicUpdateRolling(dt) {
  const cd = classicData;

  // 倒计时中不处理
  if (cd._countdown > 0) return;

  // 引力入坑动画中
  if (cd._pitSuck) {
    cd._pitSuckTimer += dt;
    var suckPit = cd._pitSuckPit;
    var suckP = cd.players[cd._pitSuckPlayer];
    var suckDX = suckPit.worldX - suckP.ballX;
    var suckDY = suckPit.worldY - suckP.ballY;
    var suckDist = Math.sqrt(suckDX*suckDX + suckDY*suckDY);
    var suckSpeed = Math.max(0.1, suckDist * 10) * dt;
    if (suckDist < suckSpeed) {
      // 回滚到坑心
      cd._pitSuck = false;
      cd._pitRollback = true;
      cd._pitRollbackPlayer = cd._pitSuckPlayer;
      cd._pitRollbackFromX = suckP.ballX;
      cd._pitRollbackFromY = suckP.ballY;
      cd._pitRollbackFromScale = suckP.ballScale;
      cd._pitRollbackToX = suckPit.worldX;
      cd._pitRollbackToY = suckPit.worldY;
      cd._pitRollbackTimer = 0;
      suckP.ballVX = 0; suckP.ballVY = 0;
      return;
    }
    suckP.ballX += (suckDX / suckDist) * suckSpeed;
    suckP.ballY += (suckDY / suckDist) * suckSpeed;
    suckP.ballVX = 0; suckP.ballVY = 0;
    // 缩放渐变到 0.80
    suckP.ballScale += (0.80 - suckP.ballScale) * 0.25;
    // 纹理跟随
    suckP.ballTexOffX += (suckDX / suckDist) * suckSpeed * 150;
    suckP.ballTexOffY += (suckDY / suckDist) * suckSpeed * 150;
    return;
  }

  // 回滚动画：球心对准坑心
  if (cd._pitRollback) {
    cd._pitRollbackTimer += dt;
    var rbDur = 0.15;
    var rb = cd._pitRollbackPlayer;
    var rp = cd.players[rb];
    var rt = Math.min(cd._pitRollbackTimer / rbDur, 1);
    var re = rt < 0.5 ? 2*rt*rt : 1 - Math.pow(-2*rt+2,2)/2;
    rp.ballX = cd._pitRollbackFromX + (cd._pitRollbackToX - cd._pitRollbackFromX) * re;
    rp.ballY = cd._pitRollbackFromY + (cd._pitRollbackToY - cd._pitRollbackFromY) * re;
    rp.ballScale += (0.80 - rp.ballScale) * 0.25;
    var rddx = (cd._pitRollbackToX - cd._pitRollbackFromX);
    var rddy = (cd._pitRollbackToY - cd._pitRollbackFromY);
    rp.ballTexOffX += rddx * 150 * dt / rbDur;
    rp.ballTexOffY += rddy * 150 * dt / rbDur;
    if (rt >= 1) {
      rp.ballX = cd._pitRollbackToX;
      rp.ballY = cd._pitRollbackToY;
      rp.ballScale = 0.80;
      cd._pitRollback = false;
      classicOnBallStop();
    }
    return;
  }

  // 非玩家自己弹球时相机跟随（多人模式跟随远程玩家）
  if (cd.currentPlayer > 0) {
    var cp2 = cd.players[cd.currentPlayer];
    cd.cameraTargetX = cp2.ballX;
    cd.cameraTargetY = cp2.ballY;
  }

  // 检查当前玩家球：中心在坑半径×1.1内且动力不足 → 吸入
  var p = cd.players[cd.currentPlayer];
  var speed = Math.sqrt(p.ballVX * p.ballVX + p.ballVY * p.ballVY);
  for (var pi3 = 0; pi3 < cd.pits.length; pi3++) {
    var ptest = cd.pits[pi3];
    var pdx = p.ballX - ptest.worldX;
    var pdy = p.ballY - ptest.worldY;
    var pdist = Math.sqrt(pdx*pdx + pdy*pdy);
    if (pdist < ptest.radius * 1.1 && speed < 0.12) {
      // 中心在坑半径×1.1 内且速度不足，吸入
      cd._pitSuck = true;
      cd._pitSuckPit = ptest;
      cd._pitSuckPlayer = cd.currentPlayer;
      cd._pitSuckTimer = 0;
      cd._pitSuckFromScale = p.ballScale;
      p.ballVX = 0; p.ballVY = 0;
      cd.hintText = '吸入坑中…';
      playSfx('luo');
      return;
    }
  }

  if (speed < 0.015) {
    p.ballVX = 0; p.ballVY = 0;
    classicOnBallStop();
  }
}

function classicOnBallStop() {
  const cd = classicData;
  const p = cd.players[cd.currentPlayer];

  // 记录到坑1的距离
  p.distToPit1 = Math.sqrt(
    (p.ballX - cd.pits[0].worldX) ** 2 +
    (p.ballY - cd.pits[0].worldY) ** 2
  );

  // 检查是否进坑
  let enteredPit = null;
  for (const pit of cd.pits) {
    const dx = p.ballX - pit.worldX;
    const dy = p.ballY - pit.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < pit.radius * 1.1) {
      enteredPit = pit;
      break;
    }
  }

  // === 弹球阶段特殊处理 ===
  if (!cd.bothServed) {
    // 弹球阶段只能进①号坑，进错直接输
    if (enteredPit && enteredPit.index !== 1) {
      var loserN = classicPlayerName(cd.currentPlayer);
      var winnerN = classicPlayerName(1 - cd.currentPlayer);
      classicTriggerWin(1 - cd.currentPlayer, loserN + '进错了坑！' + winnerN + '获胜！', cd.currentPlayer === 0 ? 'fail' : 'victory');
      return;
    }
    // 记录弹球是否直接进坑1
    if (enteredPit && enteredPit.index === 1) {
      if (p.pitProgress.indexOf(1) === -1) p.pitProgress.push(1);
      p.ballX = enteredPit.worldX;
      p.ballY = enteredPit.worldY;
      p.ballVX = 0; p.ballVY = 0;
    }
    cd.serveCount++;
    if (cd.serveCount < 2) {
      // 第一个玩家发完 → 3秒倒计时后轮到第二个
      cd.players[cd.currentPlayer].locked = true;
      cd.hintText = '准备切换弹球…';
      var nextPlayer = cd.serveOrder[1];
      cd._countdown = 3;
      cd._countdownTimer = 1.0;
      cd._countdownHint = classicPlayerName(nextPlayer) + '弹球';
      cd._countdownNext = function() {
        var cd2 = classicData;
        cd2.currentPlayer = nextPlayer;
        cd2.players[cd2.currentPlayer].locked = false;
        cd2.chargePower = 0;
        cd2.chargeDir = 1;
        cd2.btnPressed = false;
        cd2.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;
        cd2.phase = CLASSIC_PHASE.SERVING;
        if (nextPlayer === 0) { classicFocusServe(); cd2._viewToggle = false; cd2._viewManual = true; }
        var pn2 = cd2.players[cd2.currentPlayer] ? cd2.players[cd2.currentPlayer].name : '玩家';
        cd2.hintText = '轮到 ' + pn2 + ' 弹球，瞄准 ① 号坑';
        // 重置球到出发线
        var startY2 = cd2.pits[0].worldY + CLASSIC_START_DIST;
        cd2.players[cd2.currentPlayer].ballX = cd2.currentPlayer === 0 ? 0.35 : 0.65;
        cd2.players[cd2.currentPlayer].ballY = startY2;
        cd2.players[cd2.currentPlayer].ballVX = 0;
        cd2.players[cd2.currentPlayer].ballVY = 0;
        var cp2 = cd2.players[cd2.currentPlayer];
        cd2.cameraTargetX = cp2.ballX;
        cd2.cameraTargetY = cp2.ballY;
        if (cd2.currentPlayer === 1) {
          cd2.aiDelayTimer = 0.4 + Math.random() * 0.3;
        }
      };
      return;
    }

    // 两人都发完了 → 重新计算当前距离（球可能被击飞过）
    cd.bothServed = true;
    var pit1 = cd.pits[0];
    var d0 = Math.sqrt((cd.players[0].ballX - pit1.worldX) ** 2 + (cd.players[0].ballY - pit1.worldY) ** 2);
    var d1 = Math.sqrt((cd.players[1].ballX - pit1.worldX) ** 2 + (cd.players[1].ballY - pit1.worldY) ** 2);

    if (Math.abs(d0 - d1) < CLASSIC_SAME_DIST_THRESH) {
      // 等距 → 倒计时后重新弹球
      cd.serveCount = 0;
      cd.bothServed = false;
      var startYEq = cd.pits[0].worldY + CLASSIC_START_DIST;
      cd.players[0].ballX = 0.35; cd.players[0].ballY = startYEq;
      cd.players[1].ballX = 0.65; cd.players[1].ballY = startYEq;
      cd.players[0].ballVX = 0; cd.players[0].ballVY = 0;
      cd.players[1].ballVX = 0; cd.players[1].ballVY = 0;
      cd.currentPlayer = cd.serveOrder[0];
      cd.players[cd.currentPlayer].locked = false;
      cd.players[1 - cd.currentPlayer].locked = true;
      classicShowAll('距离相同！重新弹球...', true);
      classicFocusServe();
      var firstEq = cd.currentPlayer;
      cd._countdown = 3;
      cd._countdownTimer = 1.0;
      cd._countdownHint = classicPlayerName(firstEq) + '弹球';
      cd._countdownNext = function() {
        var cdE = classicData;
        cdE.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;
        cdE.phase = CLASSIC_PHASE.SERVING;
        if (cdE.currentPlayer === 1) cdE.aiDelayTimer = 0.8 + Math.random() * 0.6;
      };
      return;
    }

    // 距离坑1更近的先弹球
    const closer = d0 < d1 ? 0 : 1;
    cd.currentPlayer = closer;
    cd.players[closer].locked = false;
    cd.players[1 - closer].locked = true;
    cd.chargePower = 0;
    cd.chargeDir = 1;
    cd.btnPressed = false;

    // 检查弹球是否直接进坑1
    var closerP = cd.players[closer];
    var closerPit1 = closerP.pitProgress.indexOf(1) !== -1;
    if ((enteredPit && enteredPit.index === 1) || closerPit1) {
      // 弹球直接进坑1 → 跳过弹球直选目标
      var usePit = enteredPit && enteredPit.index === 1 ? enteredPit : cd.pits[0];
      if (closerP.pitProgress.indexOf(1) === -1) closerP.pitProgress.push(1);
      closerP.ballX = usePit.worldX;
      closerP.ballY = usePit.worldY;
      closerP.ballVX = 0; closerP.ballVY = 0;
      cd.hintText = '入坑成功！请选择目标\n弹球直接进①号坑';
      classicEnterTargetSelect(usePit);
    } else {
      classicShowAll((closer === 0 ? '你' : classicPlayerName(closer)) + '离坑更近，先弹球', true);
      classicFocusServe();
      var closerRef = closer;
      cd._countdown = 3;
      cd._countdownTimer = 1.0;
      cd._countdownHint = classicPlayerName(closerRef) + '弹球';
      cd._countdownNext = function() {
        var cdC = classicData;
        cdC.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;
        cdC.phase = CLASSIC_PHASE.SERVING;
        if (cdC.currentPlayer === 1) cdC.aiDelayTimer = 0.4 + Math.random() * 0.3;
      };
    }
    return;
  }

  // === 正常进坑/未进坑逻辑 ===
  // 击中对手优先于进坑判定（目标是对手球时不应提示"入坑成功"）
  if (cd._hitOpponent) {
    cd._hitOpponent = false;
    cd.hintText = '击中对手！请选择下一个目标';
    // 如果同时也进坑了，记录进度
    if (enteredPit) {
      p.pitProgress.push(enteredPit.index);
      if (classicGetNextPit(p.pitProgress) === null) {
        cd.tigerBallPlayer = cd.currentPlayer;
        playSfx('jingdian');
      }
      p.ballX = enteredPit.worldX;
      p.ballY = enteredPit.worldY;
      classicEnterTargetSelect(enteredPit);
    } else {
      classicEnterTargetSelect(null);
    }
  } else if (enteredPit) {
    var nextPit = classicGetNextPit(p.pitProgress);
    // 进错坑（不是序列中下一个，或已进过）→ 直接输
    if (nextPit === null || enteredPit.index !== nextPit) {
      var loserName = classicPlayerName(cd.currentPlayer);
      var winnerName2 = classicPlayerName(1 - cd.currentPlayer);
      classicTriggerWin(1 - cd.currentPlayer, loserName + '进错了坑！' + winnerName2 + '获胜！', cd.currentPlayer === 0 ? 'fail' : 'victory');
      return;
    }
    // 正确进坑 → 记录
    p.pitProgress.push(enteredPit.index);
    // 检查是否走完序列 → 老虎球
    if (classicGetNextPit(p.pitProgress) === null) {
      cd.tigerBallPlayer = cd.currentPlayer;
      playSfx('jingdian');
    }
    p.ballX = enteredPit.worldX;
    p.ballY = enteredPit.worldY;
    classicEnterTargetSelect(enteredPit);
  } else {
    playSfx('fail');
    classicNextPlayer('对方未进坑');
  }
}

function classicEnterTargetSelect(pit) {
  const cd = classicData;
  const p = cd.players[cd.currentPlayer];
  const opponent = cd.players[1 - cd.currentPlayer];

  cd.ballInPit = pit ? cd.currentPlayer : null;
  cd.targetOptions = [];

  // 老虎球只能选对手球
  if (cd.tigerBallPlayer === cd.currentPlayer) {
    cd.targetOptions.push({ type: 'opponent', worldX: opponent.ballX, worldY: opponent.ballY });
    cd.hintText = '🐯 老虎球！请选择目标\n瞄准对手的球，一击制胜！';
  } else {
    var nextPit = classicGetNextPit(p.pitProgress);
    if (nextPit) {
      cd.targetOptions.push({ type: 'pit', pitIndex: nextPit, worldX: cd.pits[nextPit-1].worldX, worldY: cd.pits[nextPit-1].worldY });
      cd.hintText = cd.hintText || ('入坑成功！请选择目标\n下一个目标：进入 ' + (nextPit === 1 ? '①' : nextPit === 2 ? '②' : '③') + ' 号坑（进错坑直接输！）');
    }
    cd.targetOptions.push({ type: 'opponent', worldX: opponent.ballX, worldY: opponent.ballY });
  }

  cd.phase = CLASSIC_PHASE.TARGET_SELECT;
  // 相机：聚焦下一个目标坑 + 对手球，占屏幕中心60%区域
  var opponentIdx2 = 1 - cd.currentPlayer;
  var opponent2 = cd.players[opponentIdx2];
  var minX2 = pit ? pit.worldX : p.ballX, maxX2 = minX2;
  var minY2 = pit ? pit.worldY : p.ballY, maxY2 = minY2;
  // 包含下一个目标坑
  if (nextPit) {
    var nextPitWorld2 = cd.pits[nextPit - 1];
    if (nextPitWorld2.worldX < minX2) minX2 = nextPitWorld2.worldX;
    if (nextPitWorld2.worldX > maxX2) maxX2 = nextPitWorld2.worldX;
    if (nextPitWorld2.worldY < minY2) minY2 = nextPitWorld2.worldY;
    if (nextPitWorld2.worldY > maxY2) maxY2 = nextPitWorld2.worldY;
  }
  // 包含对手球
  if (opponent2 && opponent2.ballX !== undefined) {
    if (opponent2.ballX < minX2) minX2 = opponent2.ballX;
    if (opponent2.ballX > maxX2) maxX2 = opponent2.ballX;
    if (opponent2.ballY < minY2) minY2 = opponent2.ballY;
    if (opponent2.ballY > maxY2) maxY2 = opponent2.ballY;
  }
  // 加点边距
  minX2 -= 0.15; maxX2 += 0.15; minY2 -= 0.2; maxY2 += 0.2;
  var spanX2 = maxX2 - minX2;
  var spanY2 = maxY2 - minY2;
  var needZoomX2 = W / (Math.max(spanX2, 0.4) * 400) * 0.6;
  var needZoomY2 = H / (Math.max(spanY2, 0.4) * 400) * 0.6;
  cd.cameraTargetX = (minX2 + maxX2) / 2;
  cd.cameraTargetY = (minY2 + maxY2) / 2;
  cd.cameraZoom = Math.min(needZoomX2, needZoomY2, 2.5);

  if (cd.currentPlayer === 1) {
    cd.aiDelayTimer = 0.3 + Math.random() * 0.25;
  }
}

// 根据进坑记录确定下一个目标坑（序列：1→2→3→2→1）
function classicGetNextPit(progress) {
  // 固定序列：1→2→3→2→1，按已完成的坑数推进
  var seq = [1, 2, 3, 2, 1];
  var idx = progress.length;
  if (idx >= seq.length) return null; // 全部完成
  return seq[idx];
}

function classicSelectTarget(option) {
  const cd = classicData;
  const p = cd.players[cd.currentPlayer];

  cd.selectedTarget = option;
  cd.hintText = option.type === 'pit' ? '目标：\n进入 ' + option.pitIndex + ' 号坑' : '目标：\n撞击对手的球！';

  // 球从坑边弹出
  const pit = cd.pits.find(function(pt){ return pt.index === (cd.ballInPit !== null ? cd.pits[0].index : -1); });
  // 使用当前球所在的坑
  let fromPit = null;
  for (const pt of cd.pits) {
    const dx = p.ballX - pt.worldX;
    const dy = p.ballY - pt.worldY;
    if (Math.sqrt(dx*dx+dy*dy) < pt.radius * 1.2) { fromPit = pt; break; }
  }

  if (fromPit) {
    // 球跳到坑边，朝向目标
    const angle = Math.atan2(option.worldX - fromPit.worldX, option.worldY - fromPit.worldY);
    p.ballX = fromPit.worldX + Math.sin(angle) * fromPit.radius * 1.1;
    p.ballY = fromPit.worldY + Math.cos(angle) * fromPit.radius * 1.1;
  }

  cd.ballInPit = null;
  cd._hitOpponent = false;
  cd.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;
  cd.phase = CLASSIC_PHASE.AIMING;
  // 相机：球与目标范围占屏幕中心60%，补偿67%投影偏移
  var minY = Math.min(p.ballY, option.worldY) - 0.2;
  var maxY = Math.max(p.ballY, option.worldY) + 0.2;
  var spanX = Math.abs(option.worldX - p.ballX) + 0.35;
  var spanY = maxY - minY;
  var fitZ = Math.min(W / (spanX * 400), H / (spanY * 400)) * 0.6;
  fitZ = Math.min(fitZ, 2.0);
  fitZ = Math.max(fitZ, 0.3);
  cd.cameraTargetX = (p.ballX + option.worldX) / 2;
  cd.cameraTargetY = maxY - spanY * 0.33;
  cd.cameraZoom = fitZ;

  // 如果是AI，延迟自动操作
  if (cd.currentPlayer === 1) {
    cd.aiDelayTimer = 0.25 + Math.random() * 0.2;
  }
}

// 获胜延迟+烟花
function classicTriggerWin(winnerIdx, hintText, sfxName) {
  var cd = classicData;
  cd.winner = winnerIdx;
  cd._winDelay = 2.0;
  cd.hintText = hintText;
  cd._winSfx = sfxName || ''; // 延迟到弹窗时播放
}

// 聚焦玩家球 + 当前目标坑，占屏幕中心60%
function classicFocusPlayer() {
  var cd = classicData;
  var cp = cd.players[0];
  var minX = cp.ballX, maxX = cp.ballX, minY = cp.ballY, maxY = cp.ballY;
  // 找到当前目标坑
  var nextPitIdx = classicGetNextPit(cp.pitProgress);
  if (nextPitIdx) {
    var tgtPit = cd.pits[nextPitIdx - 1];
    if (tgtPit.worldX < minX) minX = tgtPit.worldX;
    if (tgtPit.worldX > maxX) maxX = tgtPit.worldX;
    if (tgtPit.worldY < minY) minY = tgtPit.worldY;
    if (tgtPit.worldY > maxY) maxY = tgtPit.worldY;
  }
  minX -= 0.15; maxX += 0.15; minY -= 0.2; maxY += 0.2;
  var spanX = maxX - minX, spanY = maxY - minY;
  var fitZ = Math.min(W / (spanX * 400), H / (spanY * 400)) * 0.6;
  fitZ = Math.min(fitZ, 2.0);
  fitZ = Math.max(fitZ, 0.3);
  cd.cameraTargetX = (minX + maxX) / 2;
  cd.cameraTargetY = maxY - spanY * 0.33;
  cd.cameraZoom = fitZ;
  cd._camX = cd.cameraTargetX;
  cd._camY = cd.cameraTargetY;
  cd._camZoom = cd.cameraZoom;
}

// 聚焦起始线+坑①，占屏幕60%
function classicFocusServe() {
  var cd = classicData;
  var pit1Y = cd.pits[0].worldY;           // 1.5
  var startY = pit1Y + CLASSIC_START_DIST; // 2.5
  var minY = pit1Y - 0.1;
  var maxY = startY + 0.1;
  var spanH = maxY - minY;
  var fitZ = Math.min(W / (0.3 * 400), H / (spanH * 400)) * 0.6;
  fitZ = Math.min(fitZ, 1.5);
  fitZ = Math.max(fitZ, 0.25);
  cd.cameraTargetX = 0.5;
  cd.cameraTargetY = maxY - spanH * 0.33;
  cd.cameraZoom = fitZ;
  cd._camX = cd.cameraTargetX;
  cd._camY = cd.cameraTargetY;
  cd._camZoom = cd.cameraZoom;
}

// 缩放镜头以显示所有坑+两球，占屏幕60%，中心偏上50px
function classicShowAll(msg, snap) {
  var cd = classicData;
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var pi2 = 0; pi2 < 2; pi2++) {
    var bp2 = cd.players[pi2];
    if (bp2.ballX < minX) minX = bp2.ballX;
    if (bp2.ballX > maxX) maxX = bp2.ballX;
    if (bp2.ballY < minY) minY = bp2.ballY;
    if (bp2.ballY > maxY) maxY = bp2.ballY;
  }
  for (var qi = 0; qi < cd.pits.length; qi++) {
    var qp = cd.pits[qi];
    if (qp.worldX < minX) minX = qp.worldX;
    if (qp.worldX > maxX) maxX = qp.worldX;
    if (qp.worldY < minY) minY = qp.worldY;
    if (qp.worldY > maxY) maxY = qp.worldY;
  }
  minX -= 0.2; maxX += 0.2; minY -= 0.25; maxY += 0.25;
  var spanX = maxX - minX;
  var spanY = maxY - minY;
  var needZoomX = W / (spanX * 400) * 0.6;
  var needZoomY = H / (spanY * 400) * 0.6;
  cd.cameraZoom = Math.min(needZoomX, needZoomY, 2.5);
  cd.cameraTargetX = (minX + maxX) / 2;
  // 中心偏上50px：补偿投影67%偏移 + 50px上移
  var midWorldY = (minY + maxY) / 2;
  cd.cameraTargetY = midWorldY + (H * 0.17 + 50) / (400 * cd.cameraZoom);
  if (msg) cd.hintText = msg;
  // snap: 直接跳到目标，不平滑过渡
  if (snap) {
    cd._camX = cd.cameraTargetX;
    cd._camY = cd.cameraTargetY;
    cd._camZoom = cd.cameraZoom;
  }
}

function classicNextPlayer(reason) {
  const cd = classicData;
  cd.players[cd.currentPlayer].locked = true;
  // 多人模式：循环找下一个存活的玩家
  if (cd._multiMode === 'game') {
    var nextP = cd.currentPlayer;
    for (var npi = 0; npi < cd.players.length; npi++) {
      nextP = (nextP + 1) % cd.players.length;
      if (cd.players[nextP].alive) break;
    }
    cd.currentPlayer = nextP;
  } else {
    cd.currentPlayer = 1 - cd.currentPlayer;
  }
  cd.players[cd.currentPlayer].locked = false;

  cd.chargePower = 0;
  cd.chargeDir = 1;
  cd.btnPressed = false;
  cd.selectedTarget = null;
  cd.targetOptions = [];
  cd.ballInPit = null;
  cd._hitOpponent = false;

  var nextPit2 = classicGetNextPit(cd.players[cd.currentPlayer].pitProgress);
  var targetHint = nextPit2 ? '\n目标：' + ['①','②','③'][nextPit2 - 1] + '号坑' : '';
  var pName = cd.players[cd.currentPlayer] ? cd.players[cd.currentPlayer].name : '';
  var hintText = reason + targetHint + '\n轮到 ' + (pName || '玩家') + ' 弹球';
  var curP = cd.currentPlayer;

  // 倒计时后开始（常规回合切换，不使用发球视角）
  cd._countdown = 3;
  cd._countdownTimer = 1.0;
  cd._countdownHint = classicPlayerName(curP) + '弹球';
  cd._countdownNext = function() {
    var cdN = classicData;
    cdN.aimingAngle = (Math.random() - 0.5) * 2 * Math.PI;
    cdN.phase = CLASSIC_PHASE.SERVING;
    cdN.hintText = hintText;
    multiSyncUpload();
    if (cdN.currentPlayer === 1 && cdN._multiMode !== 'game') {
      cdN.aiDelayTimer = 0.35 + Math.random() * 0.25;
    }
  };
  // 镜头定位（倒计时期间调整好）
  var cp2 = cd.players[cd.currentPlayer];
  var tgtX = cp2.ballX, tgtY = cp2.ballY, spanX = 0.3, spanY = 0.3;
  if (nextPit2) {
    var tgtPit = cd.pits[nextPit2 - 1];
    tgtX = (cp2.ballX + tgtPit.worldX) / 2;
    tgtY = (cp2.ballY + tgtPit.worldY) / 2;
    spanX = Math.abs(cp2.ballX - tgtPit.worldX) + 0.3;
    spanY = Math.abs(cp2.ballY - tgtPit.worldY) + 0.35;
  }
  // 计算 zoom 让球+目标刚好填满屏幕 80%
  var fitZoomX = W / (spanX * 400) * 0.8;
  var fitZoomY = H / (spanY * 400) * 0.8;
  var targetZoom = Math.min(fitZoomX, fitZoomY, 2.0);
  targetZoom = Math.max(targetZoom, 0.4);
  cd.cameraTargetX = tgtX;
  cd.cameraTargetY = tgtY;
  cd.cameraZoom = targetZoom;
  cd._camX = cd.cameraTargetX;
  cd._camY = cd.cameraTargetY;
  cd._camZoom = cd.cameraZoom;
}

// ============================================================
// 经典模式 — 弹球
// ============================================================
function classicShoot() {
  const cd = classicData;
  const p = cd.players[cd.currentPlayer];

  // 计算速度：指数2.0使低蓄力更细腻，最低5%速度防死区
  var factor = Math.pow(cd.chargePower, 2.0);
  var fullSpeed = CFG.FRICTION * 2.0;  // d = v/F = 2.0m
  var speed = fullSpeed * factor * 0.95 + fullSpeed * 0.05;  // 最低5%速度

  // 应用方向
  p.ballVX = Math.sin(cd.aimingAngle) * speed;
  p.ballVY = Math.cos(cd.aimingAngle) * speed;

  p.ballScale = 1;
  cd.phase = CLASSIC_PHASE.ROLLING;
  cd.chargePower = 0;
  cd.chargeDir = 1;
  cd.btnPressed = false;
  cd._viewManual = false; // 发射后恢复自动视角
  cd.hintText = '球在滚动中...';

  playSfx('speed');
}

// ============================================================
// 经典模式 — AI 逻辑
// ============================================================
function classicAIShoot(pIdx) {
  const cd = classicData;
  if (cd.currentPlayer !== pIdx) return;
  if (cd.currentPlayer !== 1 || cd._multiMode === 'game') return; // 只有小迪是AI（多人模式无AI）

  const p = cd.players[pIdx];
  var opponent = cd.players[1 - pIdx];

  if (cd.phase === CLASSIC_PHASE.TARGET_SELECT) {
    var opts = cd.targetOptions;
    if (opts.length === 0) return;

    // 老虎球 → 必须选对手
    if (cd.tigerBallPlayer === pIdx) {
      var oppOpt = opts.find(function(o) { return o.type === 'opponent'; });
      if (oppOpt) { classicSelectTarget(oppOpt); cd.aiDelayTimer = 0.2 + Math.random() * 0.2; }
      return;
    }

    // 分拣坑和对手
    var pitOpts = opts.filter(function(o) { return o.type === 'pit'; });
    var oppOpts = opts.filter(function(o) { return o.type === 'opponent'; });

    var chosen = null;
    // 80%概率优先选坑推进，20%打对手干扰
    if (pitOpts.length > 0 && Math.random() < 0.8) {
      // 选最近的坑
      var bestPit = null, bestDist = Infinity;
      for (var pi2 = 0; pi2 < pitOpts.length; pi2++) {
        var dxp = pitOpts[pi2].worldX - p.ballX;
        var dyp = pitOpts[pi2].worldY - p.ballY;
        var dp = Math.sqrt(dxp*dxp + dyp*dyp);
        if (dp < bestDist) { bestDist = dp; bestPit = pitOpts[pi2]; }
      }
      chosen = bestPit;
    } else if (oppOpts.length > 0) {
      chosen = oppOpts[0];
    } else if (pitOpts.length > 0) {
      chosen = pitOpts[0];
    }

    if (chosen) {
      classicSelectTarget(chosen);
      cd.aiDelayTimer = 0.2 + Math.random() * 0.25;
    }
    return;
  }

  if (cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING) {
    // 确定目标点
    var targetX, targetY;
    if (cd.selectedTarget) {
      targetX = cd.selectedTarget.worldX;
      targetY = cd.selectedTarget.worldY;
    } else {
      var nextP2 = classicGetNextPit(p.pitProgress);
      if (nextP2) {
        var tp2 = cd.pits[nextP2 - 1];
        targetX = tp2.worldX; targetY = tp2.worldY;
      } else {
        targetX = opponent.ballX; targetY = opponent.ballY;
      }
    }

    // 计算精准角度，加较小随机偏差
    var angleToTarget = Math.atan2(targetX - p.ballX, targetY - p.ballY);
    var deviation = (Math.random() - 0.5) * 2 * (5 * Math.PI / 180); // ±5°
    cd.aimingAngle = angleToTarget + deviation;

    // 精确估算蓄力：距离D → 需要速度 v=D*FRICTION → factor=(v/FRICTION-0.05)/0.95 → power=factor^0.5
    var distToTarget = Math.sqrt((targetX-p.ballX)*(targetX-p.ballX) + (targetY-p.ballY)*(targetY-p.ballY));
    var neededV = distToTarget * CFG.FRICTION;
    var factor = Math.max(0.05, (neededV / CFG.FRICTION - 0.05) / 0.95);
    var idealPower = Math.pow(factor, 0.5);
    cd.chargePower = Math.min(1, idealPower * (0.9 + Math.random() * 0.1));

    // 偶尔失误（10%概率，偏差翻倍+力度不准）
    if (Math.random() < 0.10) {
      cd.aimingAngle += (Math.random() - 0.5) * Math.PI * 0.25;
      cd.chargePower *= 0.5 + Math.random() * 0.4;
    }

    classicShoot();
  }
}

// ============================================================
// 经典模式 — 碰撞检测
// ============================================================
function classicCheckBallCollision() {
  const cd = classicData;
  const np = cd.players.length;
  const contactDist = CLASSIC_MARBLE_R * 2; // 0.112

  // ---- 坑内保护：球中心在坑半径70%内不受碰撞 ----
  var inPit = [];
  for (var pi = 0; pi < np; pi++) {
    inPit[pi] = false;
    var pp2 = cd.players[pi];
    if (pp2.alive === false) continue;
    for (var qi = 0; qi < cd.pits.length; qi++) {
      var qp = cd.pits[qi];
      var pdx = pp2.ballX - qp.worldX;
      var pdy = pp2.ballY - qp.worldY;
      if (pdx*pdx + pdy*pdy < qp.radius * qp.radius * 0.49) { // 0.7²=0.49
        inPit[pi] = true;
        break;
      }
    }
  }

  // ---- 逐对碰撞检测 ----
  for (var a = 0; a < np; a++) {
    if (cd.players[a].alive === false || inPit[a]) continue;
    for (var b = a + 1; b < np; b++) {
      if (cd.players[b].alive === false || inPit[b]) continue;

      var dx = cd.players[a].ballX - cd.players[b].ballX;
      var dy = cd.players[a].ballY - cd.players[b].ballY;
      var dist = Math.sqrt(dx*dx + dy*dy);

      if (dist >= contactDist) continue;

      // ===== 碰撞！ =====
      // 法线方向（a→b）
      if (dist < 0.0001) { dx = 0.0001; dy = 0; dist = 0.0001; }
      var nx = dx / dist;
      var ny = dy / dist;

      // === 老虎球：一击决胜 ===
      var tPlayer = cd.tigerBallPlayer;
      if (tPlayer === a || tPlayer === b) {
        var victim4 = (tPlayer === a) ? b : a;
        var tSpd = Math.sqrt(cd.players[tPlayer].ballVX*cd.players[tPlayer].ballVX + cd.players[tPlayer].ballVY*cd.players[tPlayer].ballVY);
        var bang4 = Math.max(tSpd * 2, 1.5);
        // 被害者弹飞方向：远离老虎球
        var dir4 = (victim4 === b) ? -1 : 1;
        cd.players[victim4].ballVX = dir4 * nx * bang4;
        cd.players[victim4].ballVY = dir4 * ny * bang4;
        playSfx('peng');
        if (cd._multiMode === 'game' && np > 2) {
          cd.players[victim4].alive = false;
          cd.hintText = cd.players[tPlayer].name + '的老虎球击中了' + cd.players[victim4].name + '！出局';
        } else {
          var msg4 = (tPlayer === 0) ? '🎉 老虎球命中！玩家获胜！' : '😢 ' + classicPlayerName(tPlayer) + '的老虎球击中了你的球！';
          classicTriggerWin(tPlayer, msg4, (tPlayer === 0) ? 'victory' : 'fail');
        }
        return;
      }

      // === 普通碰撞 ===
      var overlap = contactDist - dist;
      var spdA = Math.sqrt(cd.players[a].ballVX*cd.players[a].ballVX + cd.players[a].ballVY*cd.players[a].ballVY);
      var spdB = Math.sqrt(cd.players[b].ballVX*cd.players[b].ballVX + cd.players[b].ballVY*cd.players[b].ballVY);

      // 快者为撞击者，慢者为被撞者
      var hitter, victim;
      if (spdA >= spdB) { hitter = a; victim = b; } else { hitter = b; victim = a; }

      // 相对接近速度（沿法线方向），动力不足时弹飞也小
      var relVx = cd.players[a].ballVX - cd.players[b].ballVX;
      var relVy = cd.players[a].ballVY - cd.players[b].ballVY;
      var approachSpeed = -(relVx * nx + relVy * ny);
      if (approachSpeed < 0) approachSpeed = 0;
      var bounce = Math.max(approachSpeed * 2.5, 0.35);
      var dirSign = (victim === b) ? -1 : 1;
      cd.players[victim].ballVX = dirSign * nx * bounce;
      cd.players[victim].ballVY = dirSign * ny * bounce;
      // 撞击者按碰撞强度减速
      var slowFactor = Math.max(0.1, 1 - approachSpeed * 1.2);
      cd.players[hitter].ballVX *= slowFactor;
      cd.players[hitter].ballVY *= slowFactor;

      // 分离重叠（推至不重叠 + 少量边距）
      var push = overlap * 0.55 + 0.005;
      cd.players[a].ballX += nx * push;
      cd.players[a].ballY += ny * push;
      cd.players[b].ballX -= nx * push;
      cd.players[b].ballY -= ny * push;

      cd._hitOpponent = true;
      playSfx('peng');
      return;
    }
  }
}

// ============================================================
// 经典模式 — 坐标转换
// ============================================================
function classicWorldToScreen(wx, wy) {
  const cd = classicData;
  var cx = cd._camX !== undefined ? cd._camX : cd.cameraTargetX;
  var cy = cd._camY !== undefined ? cd._camY : cd.cameraTargetY;
  var zoom = cd._camZoom !== undefined ? cd._camZoom : cd.cameraZoom;
  const sx = (wx - cx) * 400 * zoom + W / 2;
  const sy = (wy - cy) * 400 * zoom + H * 0.67;  // 相机中心在屏幕2/3处
  return { x: sx, y: sy };
}

// ============================================================
// 经典模式 — 渲染
// ============================================================
function classicRender() {
  if (!classicData) { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, W, H); return; }
  try {
  const cd = classicData;
  var rz = cd._camZoom !== undefined ? cd._camZoom : cd.cameraZoom;

  // 多人模式：大厅（好友模式已取消，强制回退到首页）
  if (cd._multiMode === 'lobby') { goHome(); return; }

  // 1. 背景：与坑/线完全锁定在同一世界坐标系
  var bg = classicBgImg || bgImage;
  if (bg && bg.width > 0) {
    var iw = bg.width, ih = bg.height;
    var scl = Math.max(W / iw, H / ih);
    var zoom2 = cd._camZoom !== undefined ? cd._camZoom : cd.cameraZoom;
    var pxPerUnit = 400 * zoom2;
    var sw = iw * scl * zoom2;
    var sh = ih * scl * zoom2;
    var camX2 = cd._camX !== undefined ? cd._camX : cd.cameraTargetX;
    var camY2 = cd._camY !== undefined ? cd._camY : cd.cameraTargetY;
    // 世界原点(0,0)在屏幕上的位置
    var originSX = (0 - camX2) * pxPerUnit + W / 2;
    var originSY = (0 - camY2) * pxPerUnit + H * 0.67;
    // 从原点向四周平铺
    var offX = ((originSX % sw) + sw) % sw - sw;
    var offY = ((originSY % sh) + sh) % sh - sh;
    for (var yy = offY; yy < H + sh; yy += sh) {
      for (var xx = offX; xx < W + sw; xx += sw) {
        ctx.drawImage(bg, xx, yy, sw + 1, sh + 1);
      }
    }
  } else {
    ctx.fillStyle = '#7a9e5e';
    ctx.fillRect(0, 0, W, H);
  }

  // 2. 坑（使用 keng3.png 纹理）
  var kengImg = uiIcons.keng8 || pitImage;
  for (let i = 0; i < cd.pits.length; i++) {
    const pit = cd.pits[i];
    const sp = classicWorldToScreen(pit.worldX, pit.worldY);
    var visualR = CLASSIC_PIT_VISUAL_R * 400 * rz; // 背景图视觉半径
    var pitR = pit.radius * 400 * rz; // 实际坑半径

    // 坑纹理（用视觉半径）
    if (kengImg && kengImg.width) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, visualR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(kengImg, sp.x - visualR, sp.y - visualR, visualR * 2, visualR * 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, visualR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(50,30,15,0.7)';
      ctx.fill();
    }

    // 坑号
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('' + pit.index, sp.x, sp.y + 6);

    // 半透明红色实际坑大小
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, pitR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,0,0,0.2)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 3. 出发线（水平无限延伸，铺满屏幕）
  const startLineY = cd.pits[0].worldY + CLASSIC_START_DIST;
  const slY = classicWorldToScreen(0.5, startLineY).y;
  ctx.beginPath();
  ctx.moveTo(0, slY);
  ctx.lineTo(W, slY);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 3 * rz;
  ctx.stroke();

  // 4. 目标选择圆圈（坑目标）
  if (cd.phase === CLASSIC_PHASE.TARGET_SELECT) {
    for (const opt of cd.targetOptions) {
      if (opt.type !== 'pit') continue;
      const osp = classicWorldToScreen(opt.worldX, opt.worldY);
      const isSelected = cd.selectedTarget === opt;
      ctx.beginPath();
      ctx.arc(osp.x, osp.y, 28 * rz, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(80,200,80,0.5)' : 'rgba(80,180,80,0.3)';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#4caf50' : '#6aaa6a';
      ctx.lineWidth = 5 * rz;
      ctx.stroke();
    }
  }

  // 5. 球（参考无尽模式 — 纹理滚动 + 投影 + 高光 + 速度线）
  for (let i = 0; i < cd.players.length; i++) {
    const p = cd.players[i];
    if (p.alive === false) continue; // 已出局不画（仅多人模式）
    const sp = classicWorldToScreen(p.ballX, p.ballY);

    var ballR = CLASSIC_MARBLE_R * 400 * rz * (p.ballScale || 1); // 球屏幕半径
    var bx = sp.x, by = sp.y;

    // ===== 亮色小投影 =====
    var slx = bx - ballR * 0.20;
    var sly = by + ballR * 0.25;
    var slg = ctx.createRadialGradient(slx, sly, ballR * 0.4, slx, sly, ballR * 0.8);
    slg.addColorStop(0, 'rgba(255,255,255,0.30)');
    slg.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    slg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(slx, sly, ballR * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = slg;
    ctx.fill();

    // ===== 主投影（偏左下，硬边） =====
    var sx = bx - ballR * 0.25;
    var sy = by + ballR * 0.50;
    var sg = ctx.createRadialGradient(sx, sy, ballR * 0.6, sx, sy, ballR * 1.2);
    sg.addColorStop(0, 'rgba(0,0,0,0.50)');
    sg.addColorStop(0.15, 'rgba(0,0,0,0.35)');
    sg.addColorStop(0.4, 'rgba(0,0,0,0.05)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(sx, sy, ballR * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();

    // ===== 球体（纹理滚动 + 循环拼接，参考无尽模式） =====
    const skinImg = marbleSkinCache[p.skin] || marbleCache;
    ctx.save();
    ctx.translate(bx, by);

    if (skinImg && skinImg.width) {
      var imgW = skinImg.width || 120;
      var imgH = skinImg.height || imgW;
      var baseScale = (ballR * 2) / imgW;
      var s = baseScale;
      ctx.scale(s, s);

      // 裁剪圆形
      var clipR = imgW / 2;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, clipR), 0, Math.PI * 2);
      ctx.clip();

      // 底层：固定背景（不跟随滚动）
      ctx.globalAlpha = 0.8;
      ctx.drawImage(skinImg, -imgW / 2, -imgH / 2);
      ctx.globalAlpha = 1;

      // 纹理偏移（循环取模）
      var ox = ((p.ballTexOffX || 0) % imgW + imgW) % imgW;
      var oy = ((p.ballTexOffY || 0) % imgH + imgH) % imgH;

      // 矩阵拼接（相邻水平翻转+垂直翻转，参考无尽模式）
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          var flipX = col % 2 !== 0;
          var flipY = row % 2 !== 0;
          var both = flipX && flipY;
          var offX = (!both && flipY) ? imgW / 2 : 0;
          var offY = (!both && flipX) ? imgH / 2 : 0;
          var dx = -imgW / 2 - ox + col * imgW + offX;
          var dy = -imgH / 2 - oy + row * imgH + offY;
          ctx.save();
          if (flipX || flipY) {
            ctx.translate(dx + (flipX ? imgW / 2 : 0), dy + (flipY ? imgH / 2 : 0));
            ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
            ctx.drawImage(skinImg, -imgW / 2, -imgH / 2);
          } else {
            ctx.drawImage(skinImg, dx, dy);
          }
          ctx.restore();
        }
      }
    } else {
      // 兜底：渐变球
      ctx.beginPath();
      ctx.arc(0, 0, ballR, 0, Math.PI * 2);
      var grad = ctx.createRadialGradient(-5 * rz, -8 * rz, ballR * 0.1, 0, 0, ballR);
      grad.addColorStop(0, 'rgba(255,255,255,0.8)');
      grad.addColorStop(0.5, p.skin === 'classic_blue' ? 'rgba(100,180,230,0.7)' : 'rgba(100,200,130,0.7)');
      grad.addColorStop(1, 'rgba(30,60,120,0.5)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.restore();

    // ===== 内阴影（玻璃球背光面） =====
    var innerSR = ballR * 0.80;
    var innerSG = ctx.createRadialGradient(bx, by, ballR * 0.6, bx, by, ballR);
    innerSG.addColorStop(0, 'rgba(255,255,255,0)');
    innerSG.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    innerSG.addColorStop(1, 'rgba(255,255,255,0.12)');
    ctx.beginPath();
    ctx.arc(bx, by, ballR, 0, Math.PI * 2);
    ctx.arc(bx, by, ballR * 0.6, 0, Math.PI * 2, true);
    ctx.fillStyle = innerSG; ctx.fill();

    var sgD = ctx.createRadialGradient(bx, by, ballR * 0.7, bx, by, ballR);
    sgD.addColorStop(0, 'rgba(0,0,0,0)');
    sgD.addColorStop(0.3, 'rgba(0,0,0,0.08)');
    sgD.addColorStop(1, 'rgba(0,0,0,0.20)');
    ctx.beginPath();
    ctx.arc(bx, by, ballR, 0, Math.PI * 2);
    ctx.arc(bx, by, ballR * 0.7, 0, Math.PI * 2, true);
    ctx.fillStyle = sgD; ctx.fill();

    // ===== 高光 =====
    // 主高光（左上）
    var hx = bx - ballR * 0.3, hy = by - ballR * 0.38, hr = ballR * 0.22;
    var hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    hl.addColorStop(0, 'rgba(255,255,255,0.90)');
    hl.addColorStop(0.4, 'rgba(255,255,255,0.40)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = hl;
    ctx.fill();

    // 次高光（右上小点）
    var hx2 = bx + ballR * 0.35, hy2 = by - ballR * 0.42;
    ctx.beginPath();
    ctx.arc(hx2, hy2, ballR * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();

    // 外圈轮廓
    ctx.beginPath();
    ctx.arc(bx, by, ballR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1 * rz;
    ctx.stroke();

    // 当前玩家球上的方向箭头（弹球/瞄准阶段，小迪不显示）
    if (i === cd.currentPlayer && i === 0 && (cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING)) {
      var shaftEnd = ballR + 12;   // 箭杆终点（固定大小，不随缩放）
      var tipEnd = ballR + 26;     // 三角尖端
      var ax = bx + Math.sin(cd.aimingAngle) * tipEnd;
      var ay = by + Math.cos(cd.aimingAngle) * tipEnd;
      // 箭杆
      ctx.beginPath();
      ctx.moveTo(bx + Math.sin(cd.aimingAngle) * ballR, by + Math.cos(cd.aimingAngle) * ballR);
      ctx.lineTo(bx + Math.sin(cd.aimingAngle) * shaftEnd, by + Math.cos(cd.aimingAngle) * shaftEnd);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      // 箭头三角（尖端超出箭杆）
      var tipLen = 10;
      var arrowBaseX = bx + Math.sin(cd.aimingAngle) * shaftEnd;
      var arrowBaseY = by + Math.cos(cd.aimingAngle) * shaftEnd;
      var perpAngle = cd.aimingAngle + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(arrowBaseX + Math.sin(perpAngle) * tipLen, arrowBaseY + Math.cos(perpAngle) * tipLen);
      ctx.lineTo(arrowBaseX - Math.sin(perpAngle) * tipLen, arrowBaseY - Math.cos(perpAngle) * tipLen);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  // 5.5 目标选择圆圈（球目标，画在球之上）
  if (cd.phase === CLASSIC_PHASE.TARGET_SELECT) {
    for (const opt of cd.targetOptions) {
      if (opt.type !== 'opponent') continue;
      const osp = classicWorldToScreen(opt.worldX, opt.worldY);
      const isSelected = cd.selectedTarget === opt;
      ctx.beginPath();
      ctx.arc(osp.x, osp.y, 28 * rz, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(80,200,80,0.5)' : 'rgba(80,180,80,0.3)';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#4caf50' : '#6aaa6a';
      ctx.lineWidth = 5 * rz;
      ctx.stroke();
    }
  }

  // 6. UI层
  classicDrawUI();
  } catch(e) { console.error('[ClassicRender]', e.message, e.stack); }
}

// 多人模式 — 等待大厅
function drawMultiLobby() {
  var bg = classicBgImg || bgImage;
  if (bg && bg.width > 0) {
    var scl2 = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * scl2) / 2, (H - bg.height * scl2) / 2, bg.width * scl2, bg.height * scl2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);

  var cd = classicData;
  var players = cd._multiPlayers || [];

  ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('弹珠好友邀请空间', W / 2, 80);

  // 五个空位
  var slotW = 60, slotGap = 20, slotY = 130;
  var totalW = 5 * slotW + 4 * slotGap;
  var startSX = (W - totalW) / 2;
  for (var si = 0; si < 5; si++) {
    var sx = startSX + si * (slotW + slotGap);
    if (si < players.length) {
      var pp = players[si];
      ctx.fillStyle = 'rgba(200,180,150,0.8)';
      roundRectPath(sx, slotY, slotW, slotW, 12); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((pp.name || '?').charAt(0), sx + slotW / 2, slotY + slotW / 2 + 8);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(pp.name, sx + slotW / 2, slotY + slotW + 16);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      roundRectPath(sx, slotY, slotW, slotW, 12); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 邀请按钮
  var btnInvY = slotY + slotW + 40;
  ctx.fillStyle = '#4CAF50'; roundRectPath((W - 180) / 2, btnInvY, 180, 44, 10); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('邀请好友', W / 2, btnInvY + 30);

  // 提示文字
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px sans-serif';
  ctx.fillText('已有 ' + players.length + ' 人 · 至少2个人才可以开始游戏', W / 2, btnInvY + 66);

  // 开局按钮（仅房主可见）
  if (cd._multiIsHost) {
    var btnStartY = btnInvY + 96;
    var canStart = players.length >= 1;
    ctx.fillStyle = canStart ? '#ED971C' : '#888';
    roundRectPath((W - 200) / 2, btnStartY, 200, 50, 12); ctx.fill();
    ctx.fillStyle = canStart ? '#000' : '#666'; ctx.font = 'bold 18px sans-serif';
    ctx.fillText('开局', W / 2, btnStartY + 34);
  }

  // 返回按钮
  var bY = CAPSULE_MID_Y - 12;
  if (backImage && backImage.width > 0) ctx.drawImage(backImage, 12, bY, 24, 24);
}

function classicDrawUI() {
  try {
  const cd = classicData;
  var rz = cd._camZoom !== undefined ? cd._camZoom : cd.cameraZoom;

  // === 头像行（左对齐，间距20px） ===
  const avatarY = 112;
  const avatarSize = 44;
  const avatarGap = 20;
  const avatarStartX = 17;

  var playerCount = cd.players.length;
  for (let i = 0; i < playerCount; i++) {
    var pIdx = i < cd.serveOrder.length ? cd.serveOrder[i] : i;
    if (!cd.players[pIdx]) continue;
    const p = cd.players[pIdx];
    const isSelected = cd.currentPlayer === pIdx && !p.locked;
    const isTiger = cd.tigerBallPlayer === pIdx;
    const size = avatarSize;
    const cx = avatarStartX + avatarSize / 2 + i * (avatarSize + avatarGap);
    const ay = avatarY;

    // 头像选中描边（5px）
    ctx.save();
    if (isTiger) {
      ctx.fillStyle = 'rgba(255,40,40,0.35)';
      roundRectPath(cx - size / 2, ay, size, size, 8);
      ctx.fill();
      ctx.strokeStyle = '#ff3333';
      ctx.lineWidth = 5;
      roundRectPath(cx - size / 2, ay, size, size, 8);
      ctx.stroke();
    } else if (isSelected) {
      ctx.strokeStyle = '#4caf50';
      ctx.lineWidth = 5;
      roundRectPath(cx - size / 2, ay, size, size, 8);
      ctx.stroke();
    }
    ctx.restore();

    // 头像背景
    ctx.fillStyle = p.locked ? 'rgba(80,80,80,0.6)' : 'rgba(200,180,150,0.8)';
    roundRectPath(cx - size / 2, ay, size, size, 8);
    ctx.fill();

    // 头像图片或占位
    if (p.name === '小迪' && uiIcons.di_avatar && uiIcons.di_avatar.width) {
      ctx.save();
      roundRectPath(cx - size / 2, ay, size, size, 8);
      ctx.clip();
      ctx.drawImage(uiIcons.di_avatar, cx - size / 2, ay, size, size);
      ctx.restore();
    } else {
      // 玩家微信头像 或 默认avatar.jpg
      var profImg = null;
      if (p.avatar && p.avatar !== '') {
        if (!p._avatarImg) {
          var img = wx.createImage();
          img.src = p.avatar;
          img.onload = function() { p._avatarLoaded = true; };
          img.onerror = function() { p._avatarImg = null; };
          p._avatarImg = img;
          p._avatarLoaded = false;
        }
        if (p._avatarLoaded || (p._avatarImg && p._avatarImg.width)) {
          profImg = p._avatarImg;
        }
      }
      if (!profImg || !profImg.width) {
        profImg = uiIcons.avatar_default; // 默认头像兜底
      }
      if (profImg && profImg.width) {
        ctx.save();
        roundRectPath(cx - size / 2, ay, size, size, 8);
        ctx.clip();
        ctx.drawImage(profImg, cx - size / 2, ay, size, size);
        ctx.restore();
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name.charAt(0), cx, ay + size / 2 + 7);
      }
    }

    // 锁定图标（头像右下角）
    if (p.locked) {
      if (uiIcons.lock && uiIcons.lock.width) { ctx.drawImage(uiIcons.lock, cx + size / 2 - 16, ay + size - 18, 16, 16); }
    }

    // 昵称
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(p.name, cx, ay + size + 18);
  }

  // === 提示框（高度=蓄力按钮直径90px，右侧被圆裁切） ===
  var hintH = 90;
  var hintBoxY = H - 135;
  var hintX = 24, hintW = W - 48;
  var cutCX = W - 70, cutCY = H - 90, cutR = 45;
  // 提示框：右侧被圆裁切成凹弧形（直接路径，不依赖 composite）
  var rb = 24;
  var arcDY = hintH / 2; // 45 = 提示框半高
  var arcDX = Math.sqrt(Math.max(0, cutR * cutR - arcDY * arcDY)); // √(55²-45²) ≈ 31.6
  var arcRX = cutCX + arcDX; // 圆右交点 X = W-38.4
  // 右交点的角度（dx=+arcDX, dy=±arcDY）
  var topAngle = Math.atan2(-arcDY, arcDX);  // atan2(-45, 31.6) ≈ -0.96
  var botAngle = Math.atan2(arcDY, arcDX);    // atan2(45, 31.6) ≈  0.96

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  // 左上角
  ctx.moveTo(hintX + rb, hintBoxY);
  // 顶边：只延伸到圆右交点
  ctx.lineTo(arcRX, hintBoxY);
  // 顺时针画弧 = 沿圆左侧走大弧 = 凹入提示框
  ctx.arc(cutCX, cutCY, cutR, topAngle, botAngle, false);
  // 底边：从圆右交点回到左侧
  ctx.lineTo(hintX + rb, hintBoxY + hintH);
  // 左下圆角
  ctx.arcTo(hintX, hintBoxY + hintH, hintX, hintBoxY + hintH - rb, rb);
  // 左边
  ctx.lineTo(hintX, hintBoxY + rb);
  // 左上圆角
  ctx.arcTo(hintX, hintBoxY, hintX + rb, hintBoxY, rb);
  ctx.closePath();
  ctx.fill();
  // 提示文字（左对齐，垂直居中，超出蓄力按钮左边10px则换行）
  var hintText = cd.hintText || '准备开始';
  var maxTextW = W - 130 - (hintX + 12); // 不超过蓄力按钮左边20px
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  // 手动换行（支持 \n 和宽度换行）
  var hintLines = [];
  var parts = hintText.split('\n');
  for (var pi2 = 0; pi2 < parts.length; pi2++) {
    var remain = parts[pi2];
    while (remain.length > 0) {
      var fit = remain.length;
      for (var ci = 1; ci <= remain.length; ci++) {
        if (ctx.measureText(remain.substring(0, ci)).width > maxTextW) {
          fit = ci - 1;
          break;
        }
      }
      if (fit < 1) fit = 1;
      hintLines.push(remain.substring(0, fit));
      remain = remain.substring(fit);
    }
  }
  var lineH2 = 20;
  var totalTextH = hintLines.length * lineH2;
  var textStartY = hintBoxY + (hintH - totalTextH) / 2 + 14; // 垂直居中 + baseline偏移
  for (var li2 = 0; li2 < hintLines.length; li2++) {
    ctx.fillText(hintLines[li2], hintX + 12, textStartY + li2 * lineH2);
  }

  // === 左侧进度条（序列 1-2-3-2-1） ===
  var progX = 14, progStartY = 240;
  var seq = [1, 2, 3, 2, 1];
  var cP = cd.players[cd.currentPlayer];
  var done = cP.pitProgress.length;

  // 当前玩家头像（比序号大）
  var headR = 18, seqR = 13, seqGap = 3;
  var avatarCX = progX + headR;
  var avatarCY = progStartY + headR;
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, headR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 头像图片或首字
  var diImg2 = uiIcons.di_avatar;
  var isAIPlayer = cd.currentPlayer === 1 && cd._multiMode !== 'game';
  var hasPlayerAvatar = !isAIPlayer && cP.avatar && cP.avatar !== '';
  var showAvatar = false;
  if (hasPlayerAvatar) {
    if (!cP._avatarImg) {
      var img4 = wx.createImage();
      img4.src = cP.avatar;
      img4.onload = function() { cP._avatarLoaded = true; };
      img4.onerror = function() { cP._avatarImg = null; };
      cP._avatarImg = img4;
      cP._avatarLoaded = false;
    }
    if (cP._avatarLoaded || (cP._avatarImg && cP._avatarImg.width)) {
      showAvatar = true;
    }
  }
  if (showAvatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, headR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(cP._avatarImg, avatarCX - headR, avatarCY - headR, headR * 2, headR * 2);
    ctx.restore();
  } else if (isAIPlayer && diImg2 && diImg2.width) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, headR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(diImg2, avatarCX - headR, avatarCY - headR, headR * 2, headR * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    var initial = cP.name ? cP.name.charAt(0) : (cd.currentPlayer === 0 ? '我' : '迪');
    ctx.fillText(initial, avatarCX, avatarCY + 5);
  }

  // 5 个序列圆圈（头像下方5px，水平居中）
  var seqStartY = progStartY + headR * 2 + 5 + seqR;
  for (var si = 0; si < seq.length; si++) {
    var cy2 = seqStartY + si * (seqR * 2 + seqGap);
    ctx.beginPath();
    ctx.arc(avatarCX, cy2, seqR, 0, Math.PI * 2);
    if (si < done) {
      ctx.fillStyle = '#4caf50';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✓', avatarCX, cy2 + 4);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('' + seq[si], avatarCX, cy2 + 4);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 老虎球图标
  if (cd.tigerBallPlayer === cd.currentPlayer) {
    var tigerY = seqStartY + 4 * (seqR * 2 + seqGap) + seqR + 14;
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🐯', avatarCX, tigerY + 8);
  }

  // === 右侧控件组（始终显示：@视角 → 方向滑块 → 蓄力按钮） ===
  const rightCX = W - 70;
  const btnCY = H - 90, btnR = 40;

  // 竖向方向滑块（宽度=视角按钮直径38，高度加1/3=187）
  const sliderW = 38, sliderH = 187;
  const sliderX = rightCX - sliderW / 2;
  const sliderY = btnCY - btnR - 10 - sliderH;
  const sliderCX = sliderX + sliderW / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRectPath(sliderX, sliderY, sliderW, sliderH, sliderW / 2);
  ctx.fill();
    var sliderNorm2 = (1.25 * Math.PI - cd.aimingAngle) / (2.5 * Math.PI);
    sliderNorm2 = ((sliderNorm2 % 1) + 1) % 1;
    var thumbY2 = sliderY + sliderNorm2 * sliderH;
    var thumbR2 = sliderW / 2 - 3;
    // 滑块（direct.png）
    var dirImg = uiIcons.direct;
    if (dirImg && dirImg.width) {
      ctx.save();
      ctx.translate(sliderCX, thumbY2);
      ctx.rotate(cd.aimingAngle + Math.PI / 2);
      ctx.drawImage(dirImg, -thumbR2, -thumbR2, thumbR2 * 2, thumbR2 * 2);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(sliderCX + 1, thumbY2 + 1, thumbR2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sliderCX, thumbY2, thumbR2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      var arrowAngle = cd.aimingAngle + Math.PI / 2;
      ctx.save();
      ctx.translate(sliderCX, thumbY2);
      ctx.rotate(arrowAngle);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▶', 0, 4);
      ctx.restore();
    }

    // 方向标签（滑块上方）
    var dirLabelY = sliderY - 12;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('方向', rightCX, dirLabelY);

    // === 视角切换按钮（me.png / compus.png） ===
    var viewBtnX = rightCX + btnR + 3, viewBtnY = btnCY - btnR - 15, viewBtnR = 19;
    var viewImg = cd._viewToggle ? uiIcons.compus : uiIcons.me;
    if (viewImg && viewImg.width) {
      ctx.drawImage(viewImg, viewBtnX - viewBtnR, viewBtnY - viewBtnR, viewBtnR * 2, viewBtnR * 2);
    } else {
      ctx.beginPath();
      ctx.arc(viewBtnX, viewBtnY, viewBtnR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.fillText('sight', viewBtnX, viewBtnY + 4);
    }

    // === 蓄力按钮（powerbtn.png） ===
    var pbtnImg = uiIcons.powerbtn;
    if (pbtnImg && pbtnImg.width) {
      ctx.globalAlpha = cd.btnPressed ? 1 : 0.7;
      ctx.drawImage(pbtnImg, rightCX - btnR, btnCY - btnR, btnR * 2, btnR * 2);
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.arc(rightCX, btnCY, btnR, 0, Math.PI * 2);
      ctx.fillStyle = cd.btnPressed ? 'rgba(255,150,50,0.6)' : 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

  // === 返回按钮（左上角，胶囊行） ===
  var btnY4 = CAPSULE_MID_Y - 12;
  if (backImage && backImage.width > 0) {
    ctx.drawImage(backImage, 12, btnY4, 24, 24);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRectPath(10, btnY4, 50, 28, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('←', 35, btnY4 + 19);
  }

  // === 规则按钮（贴右，纵向文字，左圆角右平角） ===
  var ruleBtnW = 28, ruleBtnH = 44, ruleR = 10;
  var ruleBtnX = W - ruleBtnW, ruleBtnY = avatarY;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  // 左圆角右平角路径
  ctx.beginPath();
  ctx.moveTo(ruleBtnX + ruleR, ruleBtnY);
  ctx.lineTo(ruleBtnX + ruleBtnW, ruleBtnY);
  ctx.lineTo(ruleBtnX + ruleBtnW, ruleBtnY + ruleBtnH);
  ctx.lineTo(ruleBtnX + ruleR, ruleBtnY + ruleBtnH);
  ctx.arcTo(ruleBtnX, ruleBtnY + ruleBtnH, ruleBtnX, ruleBtnY + ruleBtnH - ruleR, ruleR);
  ctx.arcTo(ruleBtnX, ruleBtnY, ruleBtnX + ruleR, ruleBtnY, ruleR);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  var ruleChars = ['玩', '法'];
  var ruleGap = 16;
  var ruleTextH = ruleChars.length * ruleGap;
  ctx.font = 'bold 11px sans-serif';
  var ruleStartY = ruleBtnY + (ruleBtnH - ruleTextH) / 2 + 10;
  for (var rci = 0; rci < ruleChars.length; rci++) {
    ctx.fillText(ruleChars[rci], ruleBtnX + ruleBtnW / 2, ruleStartY + rci * ruleGap);
  }

  // === 模式标签（胶囊行居中） ===
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('经典模式', W / 2, CAPSULE_MID_Y + 5);

  // === 倒计时大字 ===
  if (cd._countdown > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRectPath(W/2 - 70, H/2 - 70, 140, 170, 16);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('' + cd._countdown, W / 2, H / 2 + 20);
    // 下方提示谁弹球
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(cd._countdownHint || '准备弹球', W / 2, H / 2 + 75);
  }

  // === 规则弹窗 ===
  if (cd.showRules) {
    classicDrawRules();
  }

  // === 游戏结束弹窗 ===
  if (cd.phase === CLASSIC_PHASE.GAMEOVER) {
    classicDrawGameOver();
  }

  // === 烟花粒子（弹窗上层） ===
  for (var fii2 = 0; fii2 < cd._fireworks.length; fii2++) {
    var fw2 = cd._fireworks[fii2];
    var alpha2 = fw2.life / fw2.maxLife;
    ctx.save();
    ctx.translate(fw2.x, fw2.y);
    ctx.rotate(fw2.rot);
    ctx.globalAlpha = alpha2;
    ctx.fillStyle = fw2.color;
    ctx.beginPath();
    var verts2 = fw2.verts;
    for (var si2 = 0; si2 < verts2.length; si2++) {
      var px2 = Math.cos(verts2[si2].a) * fw2.size * verts2[si2].r;
      var py2 = Math.sin(verts2[si2].a) * fw2.size * verts2[si2].r;
      if (si2 === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  } catch(e) { console.error('[ClassicDrawUI]', e.message, e.stack); }
}

function classicDrawRules() {
  var mw = 340, mh = 460;
  var mx = (W - mw) / 2, my = (H - mh) / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, H);
  drawPopupBg3(mx, my, mw, mh, 14);

  // 标题
  ctx.fillStyle = '#3a2a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('经典模式 — 游戏规则', W / 2, my + 36);

  // 关闭按钮（右上角，与标题垂直居中）
  var closeX = mx + mw - 30, closeY = my + 30;
  ctx.fillStyle = '#333';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✕', closeX, closeY + 6);

  var rules = [
    '【模式简介】',
    '1v1 对战，轮流弹球入坑',
    '弹中对手球可以获得继续弹球机会',
    '成功按顺序入坑可以继续弹球',
    '按 ①→②→③→②→① 顺序进坑后',
    '变为老虎球，击中对手即获胜',
    '',
    '【操作说明】',
    '方向竖条(右侧)：上下拖动调整360°方向',
    '下拉顺时针 / 上拉逆时针',
    '蓄力按钮(下方)：按住蓄力，松开弹球，',
    '按住越久，蓄力越长，球弹得更远',
    '按住时移出按钮范围可取消蓄力',
    '靶心按钮(右上方)：切换聚焦/全景视角',
    '双指缩放：放大/缩小画面',
    '拖动画面：移动视角',
    '',
    '【游戏流程】',
    '① 双方从出发线弹球，系统随机安排弹球顺序，开始弹球前都有3秒倒计时',
    '② 离①号坑近者先弹球',
    '③ 进坑后选择目标（坑或对手球）',
    '④ 选目标后方向随机，需手动调整',
    '⑤ 击中对手可继续选目标',
    '⑥ 走完序列变老虎球，击中对手即胜利',
    '',
    '【视角说明】',
    '对手回合：自动全景视角',
    '玩家回合：自动聚焦玩家球+目标坑',
    '发第一球时：展示发球视角(起线+坑①)',
    '',
    '【规则提醒】',
    '进错坑 = 直接输',
    '发球阶段只能进①号坑',
    '等距时重新弹球',
    '球在坑内时不可被碰撞',
    '',
    '【难点与技巧】',
    '通过精准控制方向来瞄准目标',
    '通过精准蓄力时长来控制弹球的距离',
    '通过击飞对手球，影响对手的进程（游戏乐趣所在）',
    '',
    '点击弹窗外任意处关闭',
  ];

  // 计算总高度
  var lineH2 = 22, totalH2 = rules.length * lineH2 + 50;
  var cd = classicData;
  if (cd._ruleScroll > 0) cd._ruleScroll = 0;
  var maxScroll = -(totalH2 - mh + 75);
  if (cd._ruleScroll < maxScroll) cd._ruleScroll = maxScroll;

  ctx.save();
  ctx.beginPath();
  ctx.rect(mx + 24, my + 50, mw - 53, mh - 75);
  ctx.clip();

  ctx.font = '15px sans-serif';
  ctx.textAlign = 'left';
  for (var i = 0; i < rules.length; i++) {
    var ry = my + 70 + i * lineH2 + cd._ruleScroll;
    if (ry < my + 50 || ry > my + mh - 25) continue;
    var isHeader = rules[i].indexOf('【') === 0;
    ctx.fillStyle = rules[i] === '' ? 'transparent' : (isHeader ? '#1a0a00' : '#4a3a2a');
    ctx.font = isHeader ? 'bold 15px sans-serif' : '15px sans-serif';
    if (rules[i]) ctx.fillText(rules[i], mx + 34, ry);
  }

  ctx.restore();

  // 滚动条
  if (totalH2 > mh - 10) {
    var barH3 = (mh - 75) * (mh - 75) / totalH2;
    var barY3 = my + 50 + (-cd._ruleScroll) / (totalH2 - (mh - 75)) * ((mh - 75) - barH3);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    roundRectPath(mx + mw - 17, barY3, 4, barH3, 2);
    ctx.fill();
  }
}

function classicDrawGameOver() {
  const cd = classicData;
  const isWin = cd.winner === 0;
  const cw = 280, ch = 260;
  const cx = (W - cw) / 2, cy = (H - ch) / 2;

  // 半透明遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, H);

  // 弹窗背景
  drawPopupBg3(cx, cy, cw, ch, 14);

  // 标题
  ctx.fillStyle = '#3a2a1a';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isWin ? '🎉 恭喜' : '😢 失败', W / 2, cy + 42);

  // 获胜者头像（8圆角方形）
  const winner = cd.players[cd.winner];
  var avaSize = 52, avaX = W/2 - avaSize/2, avaY = cy + 59;
  var avaImg = null;
  if (cd.winner === 0 && userProfile.avatar) {
    if (!userProfile._avatarImg) { var ai5 = wx.createImage(); ai5.src = userProfile.avatar; ai5.onload = function(){ userProfile._avatarLoaded = true; }; ai5.onerror = function(){ userProfile._avatarImg = null; }; userProfile._avatarImg = ai5; userProfile._avatarLoaded = false; }
    if (userProfile._avatarLoaded || (userProfile._avatarImg && userProfile._avatarImg.width)) avaImg = userProfile._avatarImg;
  } else if (cd.winner === 1 && uiIcons.di_avatar && uiIcons.di_avatar.width) {
    avaImg = uiIcons.di_avatar;
  }
  // 投影
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  roundRectPath(avaX + 2, avaY + 2, avaSize, avaSize, 8);
  ctx.fill();
  if (avaImg && avaImg.width) {
    ctx.save();
    roundRectPath(avaX, avaY, avaSize, avaSize, 8);
    ctx.clip();
    ctx.drawImage(avaImg, avaX, avaY, avaSize, avaSize);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(200,180,150,0.8)';
    roundRectPath(avaX, avaY, avaSize, avaSize, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((winner.name || '?').charAt(0), W/2, avaY + avaSize/2 + 9);
  }
  // 外框
  ctx.strokeStyle = isWin ? '#ED971C' : '#999';
  ctx.lineWidth = 3;
  roundRectPath(avaX, avaY, avaSize, avaSize, 8);
  ctx.stroke();

  // 获胜者名字（与头像拉开距离）
  ctx.fillStyle = '#3a2a1a';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(winner.name, W / 2, cy + 136);
  // 获得胜利（加大）
  ctx.fillStyle = '#6b5a4a';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('获得胜利！', W / 2, cy + 160);

  // 失败原因
  if (!isWin && cd.hintText) {
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#8b4513';
    ctx.fillText(cd.hintText, W / 2, cy + 178);
  }

  // 按钮（上移10px，文字垂直居中）
  const bw = 100, bh = 40;
  var b1x = cx + 30, b2x = cx + cw - bw - 30, by2 = cy + ch - bh - 30;
  var btnTextY = by2 + bh / 2 + 6;

  // 退出游戏
  ctx.fillStyle = 'rgba(100,100,100,0.7)';
  roundRectPath(b1x, by2, bw, bh, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('退出游戏', b1x + bw / 2, btnTextY);

  // 再来一局（主色背景，黑色文字）
  ctx.fillStyle = '#ED971C';
  roundRectPath(b2x, by2, bw, bh, 10);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.fillText('再来一局', b2x + bw / 2, btnTextY);
}

// ============================================================
// 经典模式 — 触摸事件
// ============================================================
function classicTouchStart(pts, tx, ty) {
  if (!classicData) return;
  const cd = classicData;

  // 多人模式大厅
  if (cd._multiMode === 'lobby') {
    var bY = CAPSULE_MID_Y - 12;
    if (tx > 8 && tx < 44 && ty > bY - 4 && ty < bY + 28) { goHome(); return; }
    // 邀请好友按钮
    if (tx > (W - 180) / 2 && tx < (W + 180) / 2 && ty > 230 && ty < 274) {
      if (!cd._multiRoomId) {
        // 先创建房间
        try {
          wx.cloud.callFunction({ name: 'roomManager', data: { action: 'create', playerData: { name: '我', avatar: '', skin: 'classic_blue' } } }).then(function(r) {
            if (r.result && r.result.ok) {
              cd._multiRoomId = r.result.roomId;
              try { wx.setStorageSync('multi_room', cd._multiRoomId); } catch(e) {}
              wx.shareAppMessage({ title: '一起来玩弹珠对战！', imageUrl: 'assets/images/ui/sharepic.jpg', query: 'room=' + cd._multiRoomId });
            }
          }).catch(function(){});
        } catch(e) {}
      } else {
        wx.shareAppMessage({ title: '一起来玩弹珠对战！', imageUrl: 'assets/images/ui/sharepic.jpg', query: 'room=' + cd._multiRoomId });
      }
      return;
    }
    // 开局按钮（仅房主）
    if (cd._multiIsHost && cd._multiPlayers.length >= 1 && tx > (W - 200) / 2 && tx < (W + 200) / 2 && ty > 326 && ty < 376) {
      if (!wx.cloud || !wx.cloud.callFunction) {
        // 无云开发环境，直接本地开局测试
        cd._multiMode = 'game';
        startClassicGame('multi');
        return;
      }
      if (!cd._multiRoomId) {
        try {
          wx.cloud.callFunction({ name: 'roomManager', data: { action: 'create', playerData: { name: '我', avatar: '', skin: 'classic_blue' } } }).then(function(r) {
            if (r.result && r.result.ok) {
              cd._multiRoomId = r.result.roomId;
              wx.cloud.callFunction({ name: 'roomManager', data: { action: 'start', roomId: cd._multiRoomId } }).then(function(r2) {
                if (r2.result && r2.result.ok) {
                  cd._multiMode = 'game';
                  cd._multiPlayers = r2.result.room.players;
                  startClassicGame('multi');
                } else { wx.showToast({ title: '开局失败: ' + (r2.result.msg || '未知'), icon: 'none' }); }
              }).catch(function(e2){ wx.showToast({ title: '云函数调用失败', icon: 'none' }); });
            } else { wx.showToast({ title: '创建房间失败', icon: 'none' }); }
          }).catch(function(e){ wx.showToast({ title: '云函数不可用，请检查部署', icon: 'none' }); });
        } catch(e) { wx.showToast({ title: '云开发未初始化', icon: 'none' }); }
      } else {
        try {
          wx.cloud.callFunction({ name: 'roomManager', data: { action: 'start', roomId: cd._multiRoomId } }).then(function(r) {
            if (r.result && r.result.ok) {
              cd._multiMode = 'game';
              cd._multiPlayers = r.result.room.players;
              startClassicGame('multi');
            } else { wx.showToast({ title: '开局失败: ' + (r.result.msg || '未知'), icon: 'none' }); }
          }).catch(function(e){ wx.showToast({ title: '云函数调用失败，请检查部署', icon: 'none' }); });
        } catch(e) { wx.showToast({ title: '云开发未初始化', icon: 'none' }); }
      }
      return;
    }
    return;
  }

  // 双指缩放：记录初始距离
  if (pts.length >= 2) {
    cd._pinchActive = true;
    cd._pinchDist = Math.sqrt((pts[0].x - pts[1].x) ** 2 + (pts[0].y - pts[1].y) ** 2);
    cd._pinchZoom = cd.cameraZoom;
    cd._pinchCX = (pts[0].x + pts[1].x) / 2;
    cd._pinchCY = (pts[0].y + pts[1].y) / 2;
    cd._draggingJoy = false;
    cd.btnPressed = false;
    return;
  }
  cd._pinchActive = false;

  // 规则弹窗 — 滚动或关闭
  if (cd.showRules) {
    var rmw = 340, rmh = 460;
    var rmx = (W - rmw) / 2, rmy = (H - rmh) / 2;
    // 关闭按钮
    if (tx > rmx + rmw - 44 && tx < rmx + rmw - 16 && ty > rmy + 18 && ty < rmy + 42) {
      cd.showRules = false;
      cd._ruleScroll = 0;
      return;
    }
    // 点弹窗外关闭
    if (tx < rmx || tx > rmx + rmw || ty < rmy || ty > rmy + rmh) {
      cd.showRules = false;
      cd._ruleScroll = 0;
      return;
    }
    // 弹窗内记录滚动起始
    cd._ruleTouchY = ty;
    cd._ruleDragStart = cd._ruleScroll;
    cd._draggingRule = true;
    return;
  }

  // 游戏结束弹窗
  if (cd.phase === CLASSIC_PHASE.GAMEOVER) {
    const cw = 280, ch = 260;
    const cx = (W - cw) / 2, cy = (H - ch) / 2;
    const bw = 100, bh = 40;
    var b1x = cx + 30, b2x = cx + cw - bw - 30, by2 = cy + ch - bh - 30;

    if (tx > b1x && tx < b1x + bw && ty > by2 && ty < by2 + bh) {
      goHome();
      return;
    }
    if (tx > b2x && tx < b2x + bw && ty > by2 && ty < by2 + bh) {
      if (cd._multiMode === 'game') {
        // 多人模式：重新开局（房主）
        startClassicGame('multi');
      } else {
        startClassicGame('ai');
      }
      return;
    }
    return;
  }

  // 目标选择阶段：点到圈就选中，否则继续往下（可拖地）
  if (cd.phase === CLASSIC_PHASE.TARGET_SELECT) {
    var hitTarget = false;
    for (const opt of cd.targetOptions) {
      const osp = classicWorldToScreen(opt.worldX, opt.worldY);
      var hitR2 = 30 * (cd._camZoom || cd.cameraZoom);
      if (Math.sqrt((tx - osp.x) ** 2 + (ty - osp.y) ** 2) < hitR2) {
        classicSelectTarget(opt);
        hitTarget = true;
        break;
      }
    }
    if (hitTarget) return;
    // 没点到圈 → 允许拖地，继续往下执行
  }

  // 视角切换按钮（蓄力按钮右上方）：聚焦自己 ←→ 全景
  var viewBtnX2 = W - 27, viewBtnY2 = H - 145, viewBtnR2 = 19;
  if (Math.sqrt((tx - viewBtnX2) ** 2 + (ty - viewBtnY2) ** 2) < viewBtnR2 + 8) {
    cd._viewToggle = !cd._viewToggle;
    cd._viewManual = true; // 手动切换，自动逻辑不再干预
    cd._focusTimer = 0;    // 手动切时取消自动聚焦计时
    if (cd._viewToggle) {
      classicShowAll('全景视角 — 点击sight切回', true);
    } else {
      var cp5 = cd.players[0];
      cd.cameraTargetX = cp5.ballX;
      cd.cameraTargetY = cp5.ballY;
      cd.cameraZoom = 1.5;
      cd._camX = cd.cameraTargetX;
      cd._camY = cd.cameraTargetY;
      cd._camZoom = cd.cameraZoom;
      cd.hintText = '聚焦视角 — 点击sight切全景';
    }
    return;
  }

  // 规则按钮（贴右，纵向）
  var ruleBtnX2 = W - 28, ruleBtnY2 = 112;
  if (tx > ruleBtnX2 - 4 && tx < ruleBtnX2 + 32 && ty > ruleBtnY2 && ty < ruleBtnY2 + 44) {
    cd.showRules = true;
    return;
  }

  // 返回按钮（左上角，胶囊行）
  var backBtnY4 = CAPSULE_MID_Y - 12;
  if (tx > 8 && tx < 44 && ty > backBtnY4 - 4 && ty < backBtnY4 + 28) {
    goHome();
    return;
  }

  // 弹球/瞄准阶段 —— 仅玩家回合
  if ((cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING) && cd.currentPlayer === (cd._multiMyIndex || 0)) {

    // 蓄力按钮（右下）：按住开始蓄力
    const btnCX = W - 70, btnCY = H - 90, btnR = 40;
    if (Math.sqrt((tx - btnCX) ** 2 + (ty - btnCY) ** 2) < 48) {
      cd.btnPressed = true;
      cd.chargePower = 0;
      cd.chargeStartTime = Date.now();
      cd.hintText = '蓄力中...松开弹球，按住移出按钮范围取消蓄力';
      playSfx('power');
      return;
    }

    // 方向滑块（右侧，蓄力按钮上方）
    const sliderX3 = W - 89, sliderW3 = 38, sliderY3 = H - 327, sliderH3 = 187;
    if (tx > sliderX3 - 15 && tx < sliderX3 + sliderW3 + 15 && ty > sliderY3 - 10 && ty < sliderY3 + sliderH3 + 10) {
      cd._draggingJoy = true;
      var normPos3 = (ty - sliderY3) / sliderH3;
      normPos3 = Math.max(0, Math.min(1, normPos3));
      cd.aimingAngle = 1.25 * Math.PI - normPos3 * 2.5 * Math.PI;
      cd.hintText = '方向已调整，按住右侧蓄力弹球，移出按钮范围取消蓄力';
      return;
    }
  }

  // 非UI区域 → 开始拖地
  if (ty > 120 && ty < H - 20) {
    cd._draggingGround = true;
    cd._dragStartX = tx;
    cd._dragStartY = ty;
    cd._dragCamX = cd.cameraTargetX;
    cd._dragCamY = cd.cameraTargetY;
  }
}

function classicTouchMove(pts, tx, ty) {
  const cd = classicData;

  // 规则弹窗滚动
  if (cd.showRules && cd._draggingRule) {
    cd._ruleScroll = cd._ruleDragStart + (ty - cd._ruleTouchY);
    var rTotalH = 50 * 22 + 50;
    var rMax = -(rTotalH - 460 + 75);
    if (cd._ruleScroll > 0) cd._ruleScroll = 0;
    if (cd._ruleScroll < rMax) cd._ruleScroll = rMax;
    return;
  }

  // 双指缩放
  if (cd._pinchActive && pts.length >= 2) {
    var newDist = Math.sqrt((pts[0].x - pts[1].x) ** 2 + (pts[0].y - pts[1].y) ** 2);
    var scale = newDist / cd._pinchDist;
    cd.cameraZoom = Math.max(0.25, Math.min(2.5, cd._pinchZoom * scale));
    return;
  }

  // 拖地：移动相机
  if (cd._draggingGround) {
    cd._viewManual = true; // 手动拖地，禁止自动弹回
    var zoom2 = cd._camZoom !== undefined ? cd._camZoom : cd.cameraZoom;
    var worldPerPixel = 1 / (400 * (zoom2 || 1));
    cd.cameraTargetX = cd._dragCamX - (tx - cd._dragStartX) * worldPerPixel;
    cd.cameraTargetY = cd._dragCamY - (ty - cd._dragStartY) * worldPerPixel;
  }

  if ((cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING) && cd.currentPlayer === (cd._multiMyIndex || 0)) {
    // 方向滑块拖拽（右侧）
    if (cd._draggingJoy) {
      const sliderX4 = W - 89, sliderW4 = 38, sliderY4 = H - 327, sliderH4 = 187;
      var normPos4 = (ty - sliderY4) / sliderH4;
      normPos4 = Math.max(0, Math.min(1, normPos4));
      cd.aimingAngle = 1.25 * Math.PI - normPos4 * 2.5 * Math.PI;
    }
    // 蓄力中手指移出按钮 → 取消蓄力
    if (cd.btnPressed) {
      var distFromBtn = Math.sqrt((tx - (W - 70)) * (tx - (W - 70)) + (ty - (H - 90)) * (ty - (H - 90)));
      if (distFromBtn > 48) {
        cd.btnPressed = false;
        cd.chargePower = 0;
        stopSfx('power');
        cd.hintText = '已取消蓄力';
      }
    }
  }
}

function classicTouchEnd(tx, ty) {
  const cd = classicData;

  // 蓄力松手 → 弹球（必须最先处理，确保 stopSfx 一定执行）
  if (cd.btnPressed) {
    cd.btnPressed = false;
    stopSfx('power');
    if ((cd.phase === CLASSIC_PHASE.SERVING || cd.phase === CLASSIC_PHASE.AIMING) && cd.currentPlayer === (cd._multiMyIndex || 0)) {
      if (cd.chargePower < 0.10) {
        cd.chargePower = 0;
        cd.hintText = '蓄力不足，请重试';
        return;
      }
      // 多人模式非房主：上传发射指令，由房主执行
      if (cd._multiMode === 'game' && !cd._multiIsHost) {
        cd._multiInput = { aimingAngle: cd.aimingAngle, chargePower: cd.chargePower, btnPressed: false, shoot: true, ts: Date.now() };
        try {
          var dbt = wx.cloud.database();
          dbt.collection('multi_input').where({ roomId: cd._multiRoomId }).get().then(function(rt) {
            if (rt.data.length > 0) { dbt.collection('multi_input').doc(rt.data[0]._id).update({ data: { input: cd._multiInput, roomId: cd._multiRoomId } }); }
            else { dbt.collection('multi_input').add({ data: { roomId: cd._multiRoomId, input: cd._multiInput } }); }
          });
        } catch(e) {}
        classicShoot(); // 本地也执行发射
        // 立即清除shoot标记，防止重复上传导致房主端重复发射
        cd._multiInput.shoot = false;
        cd._multiShot = false;
      } else {
        classicShoot();
      }
    }
    return;
  }

  // 双指结束
  if (cd._pinchActive) {
    cd._pinchActive = false;
    return;
  }

  // 拖地松手
  if (cd._draggingGround) {
    cd._draggingGround = false;
    return;
  }

  // 方向盘松手
  if (cd._draggingJoy) {
    cd._draggingJoy = false;
    return;
  }
}

// ============================================================
// 故事模块（全屏沉浸式，用场景图做背景）
// ============================================================

// 场景图缓存（按需加载）
var storySceneImages = {};
var titleIcons = {};  // 称号图标缓存
var badgeIcons = {};  // 勋章图标缓存

function loadStoryScene(level) {
  if (storySceneImages[level]) return;
  var sceneId = LEVEL_SCENES[level];
  if (!sceneId) return;
  var cfg = SCENE_CONFIG[sceneId];
  var filename = (cfg && cfg.bg) ? cfg.bg : (sceneId + '.png');
  var img = wx.createImage();
  img.onload = function() { storySceneImages[level] = img; };
  img.src = _scenePath(filename) + filename;
}

function loadStorySlides(level) {
  storySlideImgs = [];
  storySlideIndex = 0;
  storySlideTimer = 0;
  for (var si = 1; si <= 5; si++) {
    (function(idx, src) {
      var img = wx.createImage();
      img.onload = function() { storySlideImgs[idx] = img; };
      img.src = src;
    })(si - 1, 'subpkg_assets/assets/images/stories/s' + level + '-' + si + '.jpg');
  }
}

function switchStoryLevel(newLevel) {
  stopSfx('type');
  storyLevel = newLevel;
  var sd2 = LEVEL_STORIES[newLevel];
  var raw2 = (typeof sd2 === 'object') ? sd2.pages.join('\n\n') : String(sd2);
  storyFullText = raw2.replace(/，/g, '\n').replace(/,/g, '\n');
  storyFullText = storyFullText.replace(/[。！？.!?，,、]+\n?/g, '\n');
  storyFullText = storyFullText.replace(/[。！？.!?，,、]+$/gm, '');
  storyLines = storyFullText.split('\n');
  storyLines.push('');      // END 前空两行
  storyLines.push('');
  storyLines.push('END');
  storyLineIdx = 0;
  storyLinePos = 0;
  storyPauseTimer = 0;
  storyCursorBlink = 0;
  storyScroll = 0;
  storyDragging = false;
  loadStoryScene(newLevel);
  loadStorySlides(newLevel);
}

function getStorySceneImg(level) {
  // 预加载
  if (!storySceneImages[level]) loadStoryScene(level);
  return storySceneImages[level] || bgImage; // 兜底用当前场景图
}

function drawStoryPopup() {
  if (storyLevel === 0) {
    drawStoryList();
  } else {
    drawStoryDetail();
  }
}

function drawStoryList() {
  // 全屏背景
  ctx.fillStyle = '#2a1f0f';
  ctx.fillRect(0, 0, W, H);

  // 标题栏（对齐胶囊）
  var headerY = capsuleRect.top - 4;
  var headerH = capsuleRect.height + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, capsuleRect.bottom + 4);

  // 返回按钮
  var btnY = CAPSULE_MID_Y - 12;
  if (backImage && backImage.width > 0) {
    ctx.drawImage(backImage, 12, btnY, 24, 24);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRectPath(10, btnY, 50, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('←', 25, btnY + 19);
  }

  // 标题
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('📖 故事回顾', W / 2, CAPSULE_MID_Y + 5);

  // 卡片列表（裁剪在标题行以下）
  var cardW = W - 30, cardH = 85, cardGap = 12;
  var listTop = capsuleRect.bottom + 16;
  if (listTop < 70) listTop = 70;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, listTop, W, H - listTop);
  ctx.clip();

  for (var li = 1; li <= 9; li++) {
    var cy2 = listTop + (li - 1) * (cardH + cardGap) + storyScrollY;
    if (cy2 + cardH < listTop - 10 || cy2 > H + 10) continue;

    var unlocked = li <= maxUnlockedLevel;
    var scImg = getStorySceneImg(li);
    var sdata = LEVEL_STORIES[li];

    // 卡片背景：场景图
    ctx.save();
    roundRectPath(15, cy2, cardW, cardH, 12);
    ctx.clip();

    if (scImg && scImg.width) {
      // 场景图铺满卡片
      var iw3 = scImg.width, ih3 = scImg.height;
      var sc3 = Math.max(cardW / iw3, cardH / ih3);
      var sw3 = iw3 * sc3, sh3 = ih3 * sc3;
      ctx.drawImage(scImg, 15 + (cardW - sw3) / 2, cy2 + (cardH - sh3) / 2, sw3, sh3);
      // 暗色叠加
      ctx.fillStyle = unlocked ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.65)';
      ctx.fillRect(15, cy2, cardW, cardH);
    } else {
      ctx.fillStyle = unlocked ? 'rgba(60,40,20,0.8)' : 'rgba(40,40,40,0.8)';
      ctx.fillRect(15, cy2, cardW, cardH);
    }

    // 关卡标签
    ctx.fillStyle = unlocked ? 'rgba(255,255,255,0.9)' : 'rgba(180,180,180,0.7)';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    var label = '第' + li + '关';
    var title2 = typeof sdata === 'object' ? sdata.title : '';
    ctx.fillText(label, 30, cy2 + 32);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(title2, 30, cy2 + 58);

    // 右下角"查看"
    if (unlocked) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('查看 →', cardW - 10, cy2 + cardH - 16);
    } else {
      ctx.fillStyle = 'rgba(200,200,200,0.6)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('x 通关后解锁', cardW - 10, cy2 + cardH - 16);
    }

    ctx.restore();
  }

  ctx.restore();
}

function drawStoryDetail() {
  var sdata = LEVEL_STORIES[storyLevel];
  if (typeof sdata !== 'object' && typeof sdata !== 'string') return;
  var title = typeof sdata === 'object' ? sdata.title : '';
  var scImg = getStorySceneImg(storyLevel);

  // 场景图全屏背景
  if (scImg && scImg.width) {
    var iw4 = scImg.width, ih4 = scImg.height;
    var sc4 = Math.max(W / iw4, H / ih4);
    ctx.drawImage(scImg, (W - iw4 * sc4) / 2, (H - ih4 * sc4) / 2, iw4 * sc4, ih4 * sc4);
  } else {
    ctx.fillStyle = '#2a1f0f';
    ctx.fillRect(0, 0, W, H);
  }
  // 半透明遮罩增强文字可读性
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);

  // 顶部栏
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, capsuleRect.bottom + 4);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('第' + storyLevel + '关 · ' + title, W / 2, CAPSULE_MID_Y + 5);

  // 返回按钮
  var btnY2 = CAPSULE_MID_Y - 12;
  if (backImage && backImage.width > 0) {
    ctx.drawImage(backImage, 12, btnY2, 24, 24);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRectPath(10, btnY2, 50, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('←', 25, btnY2 + 19);
  }

  // 轮播图（16:9，固定在标题栏下方）
  var validSlides = storySlideImgs.filter(function(img) { return img && img.width > 0; });
  var hasSlides = validSlides.length > 0;
  var slideW = W - 40, slideH = slideW * 9 / 16;
  var slideY = capsuleRect.bottom + 26;
  var textTopStart = slideY;
  if (hasSlides) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRectPath(20, slideY, slideW, slideH, 8);
    ctx.fill();
    var curImg = validSlides[storySlideIndex % validSlides.length];
    if (curImg && curImg.width) {
      ctx.save();
      roundRectPath(20, slideY, slideW, slideH, 8);
      ctx.clip();
      var iw5 = curImg.width, ih5 = curImg.height;
      var sc5 = Math.max(slideW / iw5, slideH / ih5);
      ctx.drawImage(curImg, 20 + (slideW - iw5 * sc5) / 2, slideY + (slideH - ih5 * sc5) / 2, iw5 * sc5, ih5 * sc5);
      ctx.restore();
    }
    // 指示点（叠加在图片底部）
    var dotsY = slideY + slideH - 14;
    for (var di = 0; di < validSlides.length; di++) {
      ctx.beginPath();
      ctx.arc(W / 2 + (di - validSlides.length / 2 + 0.5) * 14, dotsY, 3, 0, Math.PI * 2);
      ctx.fillStyle = di === (storySlideIndex % validSlides.length) ? '#fff' : 'rgba(255,255,255,0.5)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    textTopStart = slideY + slideH + 6;
  }

  // 打字区域：从轮播图下方到屏幕底部（可滚动）
  var allLines = storyLines;
  var doneLines = storyLineIdx + (storyLinePos > 0 ? 1 : 0);
  var lineH = 30;
  var padTop = 30, padBot = 10;
  var totalH = allLines.length * lineH + padTop + padBot + 60; // END前额外60px
  var visibleTop = textTopStart + padTop;
  var visibleBot = H - 60;
  var visibleH = visibleBot - visibleTop;
  storyDetailVisibleTop = visibleTop;
  storyDetailVisibleH = visibleH;

  // 跟随光标自动滚动：当前行始终在屏幕下方 1/3 处
  if (!storyDragging) {
    var cursorLine2 = Math.min(storyLineIdx, allLines.length - 1);
    var extra = (cursorLine2 >= allLines.length - 1) ? 60 : 0;
    var targetScroll = -(cursorLine2 * lineH + padTop + extra - visibleH * 0.65);
    if (targetScroll > 0) targetScroll = 0;
    // 平滑过渡
    storyScroll += (targetScroll - storyScroll) * 0.1;
    if (storyScroll > 0) storyScroll = 0;
  }

  var textTop = visibleTop + storyScroll + padTop;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, visibleTop, W, visibleH);
  ctx.clip();

  for (var li = 0; li < doneLines; li++) {
    // END 前面额外加 60px 间距
    var extraGap = (allLines[li] === 'END') ? 60 : 0;
    var ly = textTop + li * lineH + extraGap;
    // 调整后续行的Y：在 extraGap 之后的所有行也要偏移
    // 用累计偏移更简单
  }
  // 重新计算：带额外间距
  var cumulativeY = textTop;
  for (var li = 0; li < doneLines; li++) {
    // END 前加 60px
    if (li > 0 && allLines[li] === 'END') cumulativeY += 60;
    var ly = cumulativeY;
    cumulativeY += lineH;
    if (ly + lineH < visibleTop || ly > visibleBot) continue;
    var lineText;
    if (li < storyLineIdx) {
      lineText = allLines[li];
    } else {
      lineText = allLines[li].substring(0, Math.floor(storyLinePos));
    }
    if (lineText) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lineText, W / 2 + 1, ly + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(lineText, W / 2, ly);
    }
  }

  // 闪烁光标（裁剪区域内）
  var cursorLine3 = Math.min(storyLineIdx, allLines.length - 1);
  if (cursorLine3 < allLines.length) {
    var cursorTxt2 = cursorLine3 < storyLineIdx ? allLines[cursorLine3] : allLines[cursorLine3].substring(0, Math.floor(storyLinePos));
    var cursorX3 = W / 2 + ctx.measureText(cursorTxt2).width / 2 + 4;
    var endIdx = allLines.length - 1;
    var cursorExtra = (cursorLine3 >= endIdx && allLines[endIdx] === 'END') ? 60 : 0;
    var cursorY3 = textTop + cursorLine3 * lineH + cursorExtra;
    if (cursorY3 > visibleTop - 10 && cursorY3 < visibleBot + 10) {
      var showCursor = (storyLineIdx >= allLines.length || storyPauseTimer > 0) ? (Math.floor(storyCursorBlink * 2) % 2 === 0) : true;
      if (showCursor) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(cursorX3, cursorY3 - 14, 2, 18);
      }
    }
  }

  ctx.restore();

  // 滚动条
  var barW = 4, barX = W - 10;
  if (totalH > visibleH) {
    var barH = visibleH * visibleH / totalH;
    var barY = visibleTop + (-storyScroll) / (totalH - visibleH) * (visibleH - barH);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    roundRectPath(barX, barY, barW, barH, 2);
    ctx.fill();
  }

  // 底部按钮条（始终显示）
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, H - 50, W, 50);
  if (storyLevel > 1) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('◀ 上一个', 30, H - 20);
  }
  if (storyLevel < 9) {
    var nextUnlocked = (storyLevel + 1) <= maxUnlockedLevel;
    ctx.fillStyle = nextUnlocked ? 'rgba(255,255,255,0.8)' : 'rgba(150,150,150,0.5)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(nextUnlocked ? '下一个 ▶' : '未解锁', W - 30, H - 20);
  }
  ctx.fillStyle = '#aaa';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('返回列表', W / 2, H - 22);
}

function handleStoryTouch(tx, ty) {
  var backBtnY = CAPSULE_MID_Y - 12;
  // 返回按钮（共用 back.png 图标区域 12,backBtnY 24×24）
  if (tx > 8 && tx < 44 && ty > backBtnY - 4 && ty < backBtnY + 28) {
    if (storyLevel === 0) { goHome(); }
    else { storyLevel = 0; storyScrollY = 0; stopSfx('type'); }
    return;
  }

  if (storyLevel === 0) {
    // 卡片"查看"按钮（右下角约100×40）
    var cardW = W - 30, cardH = 85, cardGap = 12;
    var listTop = capsuleRect.bottom + 16;
    for (var li = 1; li <= 9; li++) {
      var cy2 = listTop + (li - 1) * (cardH + cardGap) + storyScrollY;
      var btnX1 = 15 + cardW - 110, btnX2 = 15 + cardW - 5;
      var btnY1 = cy2 + cardH - 40, btnY2 = cy2 + cardH - 2;
      if (tx > btnX1 && tx < btnX2 && ty > btnY1 && ty < btnY2) {
        if (li <= maxUnlockedLevel) {
          storyLevel = li;
          // 准备打字机
          var sd = LEVEL_STORIES[li];
          // 合并文字，逗号换行，段间加空行
          var raw = (typeof sd === 'object') ? sd.pages.join('\n\n') : String(sd);
          storyFullText = raw.replace(/，/g, '\n').replace(/,/g, '\n');
          storyLines = storyFullText.split('\n');
          storyLines.push('END'); // 最后加 END
          storyLineIdx = 0;
          storyLinePos = 0;
          storyPauseTimer = 0;
          storyCursorBlink = 0;
          storyScroll = 0;
          storyDragging = false;
          loadStoryScene(li);
          loadStorySlides(li);
          // 沿用首页BGM，不另起
        }
        return;
      }
    }
  } else {
    // 底部按钮条（始终响应）
    if (ty > H - 50) {
      if (storyLevel > 1 && tx < W / 3) {
        switchStoryLevel(storyLevel - 1);
        return;
      }
      if (tx > W * 2 / 3) {
        if (storyLevel < 9 && (storyLevel + 1) <= maxUnlockedLevel) {
          switchStoryLevel(storyLevel + 1);
        }
        return; // 右区域：已解锁则切换，未解锁则不响应
      }
      // 中间 → 返回列表
      stopSfx('type');
      storyLevel = 0;
      storyScrollY = 0;
      return;
    }
  }
}

// ============================================================
// 宝箱宝物
// ============================================================
var treasureData = { found: [], viewed: [], newFound: {}, foundDates: {} };
var treasureTab = 0; // 0=全部 1=玩具 2=零食 3=生活
var treasureDetailIdx = -1; // 详情查看
var treasureScrollY = 0;
// 宝物掉落系统
var treasureDaily = { date: '', endlessDrops: 0, endlessPitSeg: 0, todayNew: 0, todayTotal: 0, todayLevel: 0 }; // 每日掉落追踪
var treasureLevelProb = {}; // 闯关模式关卡掉落概率 {level: prob}
var quietMode = false; // 免打扰模式
var treasurePopup = null;   // 当前弹窗宝物 {id, imgX, imgY, animT}  null=不显示
var treasureParticles = []; // 光点粒子 [{x,y,tx,ty,t,size,delay}]
var treasurePopSkipped = false; // 用户选了不再提醒
var _treasurePopupBtnY = 300;
var _treasurePopupCbY = 350;
var classicDisclaimerPopup = false; // 经典模式声明弹窗
var classicDisclaimerSkip = false;  // 不再提示声明
var treasureWaitingParticles = false; // 等待光点飞完再跳出
var pendingTreasureCount = 0; // 光点飞完后再加到 sessionTreasureCount
var pitTreasureIcon = null; // 坑旁宝箱图标 {x,y,dia} 光点起点
var justShared = false; // 刚点了分享，等 onShow 处理
var shareTimestamp = 0;  // 分享发起时间（用于判断是否真实分享）
var shareRewardHeart = null; // 分享奖励爱心动画 {x,y,tx,ty,t,duration}
var treasureTargetIcon = { x: 0, y: 0, w: 0, h: 0 }; // 宝箱图标位置（用于光点终点）
var treasureLastPitScreen = { x: 0, y: 0 }; // 当前入坑的屏幕坐标（用于光点起点）
var pendingLevelWin = false; // 闯关模式宝物弹窗后进入WIN
// 道具系统
var zhuzhuProps = { heart: 0, jump: 0, force: 0 }; // 跨局库存
var freePropsGivenToday = false; // 当天是否已送免费道具
var sessionProps = { heart: 0, jump: 0, force: 0 };  // 本局可用
var propGetPopup = false;     // 获取道具弹窗
var propGetType = '';         // 当前获取的道具类型
var propMagnetActive = false; // 强磁激活中
var propMagnetPitIndex = -1;  // 强磁目标坑
var propHeartFly = null;      // 爱心道具飞行动画 {x,y,t}
var propHeartQueue = 0;       // 待飞行的爱心队列
var propHeartFlyActive = false; // 队列激活中
var gameOverAutoContinue = false; // 道具爱心补完后自动继续
var pendingPropType = null;    // 等弹窗关闭后飞向道具栏
var pendingPropList = [];      // 宝箱开出的全部道具类型列表
var propIconParticles = [];    // 道具图标飞行粒子
var propSharePending = false; // 道具获取分享中
var pendingPropShareType = ''; // 道具分享时指定的道具类型
var treasureGoConfirm = false; // 前往宝箱确认弹窗
var sessionTreasureCount = 0; // 本局发现的宝物个数
var sessionTreasureList = []; sessionTreasureCounts = {}; treasureExchanged = false; // 本局发现的宝物ID列表
var sessionTreasureCounts = {}; // 本局每个宝物的累加数量 {id: count}
var treasureExchanged = false; // 当局是否已兑换
var treasureExchangedHearts = 0; // 上次兑换的爱心数
// (sessionPropList 已移除，道具直接加到道具栏)
var duplicateTreasureStash = {}; // 重复宝物暂存 {id: count}，等没命时兑换
var dupExchangePopup = false;   // 重复宝物兑换弹窗

var ALL_TREASURES = [
  // 玩具文具 (28) — 勋章解锁
  {id:'tin_box',name:'铁皮弹珠盒',cat:'玩具文具',rare:'N',badge:'first_pit',desc:'每个玩弹珠的孩子都有一个铁皮盒，盖子开合时"咔嗒"一声是童年最清脆的仪式感'},
  {id:'notebook',name:'拼音本算术本',cat:'玩具文具',rare:'N',badge:'five_pits',desc:'开学第一天发的本子，舍不得用，第一页总是写得最工整'},
  {id:'pencil',name:'中华木质铅笔',cat:'玩具文具',rare:'N',badge:'twenty_pits',desc:'那时候考试用2B，画画用HB，削铅笔是上学前必须完成的仪式'},
  {id:'ink_bottle',name:'英雄蓝黑墨水瓶',cat:'玩具文具',rare:'R',badge:'fifty_pits',desc:'墨水染蓝了手指，也染蓝了作业本的右下角'},
  {id:'sandbag',name:'碎花布沙包',cat:'玩具文具',rare:'N',badge:'hundred_pits',desc:'手工课学缝的第一个沙包，针脚歪歪扭扭但能用一整个学期'},
  {id:'kaleidoscope',name:'万花筒',cat:'玩具文具',rare:'R',badge:'five_hundred',desc:'第一次看万花筒整整看了一下午，以为里面藏了一个宇宙'},
  {id:'water_ring',name:'套圈水机',cat:'玩具文具',rare:'R',badge:'thousand_pits',desc:'那个永远套不上的圈，是童年最执着的遗憾'},
  {id:'cards',name:'洋画片',cat:'玩具文具',rare:'N',badge:'combo_2',desc:'下课铃一响，走廊上全是拍洋画的孩子，手心拍得通红也不在乎'},
  {id:'pencil_box',name:'铁皮铅笔盒',cat:'玩具文具',rare:'N',badge:'combo_3',desc:'铅笔盒里的东西是小孩的"财产"，还有一个藏在夹层的弹珠'},
  {id:'tumbler',name:'不倒翁',cat:'玩具文具',rare:'N',badge:'combo_5',desc:'奶奶说这个不倒翁比爸爸年纪还大，推倒了总能爬起来'},
  {id:'kite',name:'纸风筝',cat:'玩具文具',rare:'R',badge:'combo_10',desc:'春天的麦田上空，风筝飞得比鸟还高，像牵着整个天空'},
  {id:'spinning_top',name:'陀螺',cat:'玩具文具',rare:'R',badge:'combo_20',desc:'冬天在冰面上抽陀螺，鞭子甩得呼呼响，手冻得通红也不回家'},
  {id:'slingshot',name:'弹弓',cat:'玩具文具',rare:'R',badge:'combo_35',desc:'用弹弓打鸟从来没打中过，打碎邻居家的玻璃倒是赔了不少零花钱'},
  {id:'tin_frog',name:'铁皮青蛙',cat:'玩具文具',rare:'SR',badge:'combo_50',desc:'那只铁皮青蛙跳着跳着就不见了，像童年一样不知什么时候跳走了'},
  {id:'cloth_tiger',name:'布老虎玩偶',cat:'玩具文具',rare:'N',badge:'login_1',desc:'这只布老虎是满月时外婆送的，后来抱着它睡了好多年'},
  {id:'iron_hoop',name:'滚铁环',cat:'玩具文具',rare:'R',badge:'login_3',desc:'放学路上，一群孩子推着铁环跑，哗啦啦的声音是整条街的背景音乐'},
  {id:'bamboo_copter',name:'竹蜻蜓',cat:'玩具文具',rare:'N',badge:'login_7',desc:'搓竹蜻蜓的时候手心会发热，它飞起来的时候心也跟着飞起来了'},
  {id:'harmonica',name:'口琴',cat:'玩具文具',rare:'R',badge:'login_15',desc:'爸爸只会吹一首《小星星》，后来我学了三年也没学会但一直带在身边'},
  {id:'green_bag',name:'军绿色书包',cat:'玩具文具',rare:'N',badge:'login_30',desc:'那个书包背了六年，从一年级到六年级，洗得发白也舍不得换'},
  {id:'comic_book',name:'连环画',cat:'玩具文具',rare:'R',badge:'login_100',desc:'这本小人书在班里传阅了至少三十个人，每一页都有不同孩子的指纹'},
  {id:'abacus',name:'玩具算盘',cat:'玩具文具',rare:'SR',badge:'login_365',desc:'爷爷教我用算盘的时候，他的手比算盘珠子还瘦'},
  {id:'tetris',name:'俄罗斯方块掌机',cat:'玩具文具',rare:'R',badge:'skin_3',desc:'班里只有一个人有这台游戏机，排队比做操还整齐'},
  {id:'pull_whistle',name:'拉哨',cat:'玩具文具',rare:'N',badge:'skin_6',desc:'拉绳子的时候铁片飞转发出呜呜的声音，像手里握着一架小飞机'},
  {id:'shuttlecock',name:'毽子',cat:'玩具文具',rare:'N',badge:'skin_9',desc:'运动会毽子比赛我们班拿了第一名，那个毽子踢了两年公鸡毛都踢秃了'},
  {id:'balance_eagle',name:'小平衡鹰',cat:'玩具文具',rare:'SR',badge:'skin_12',desc:'物理老师说这叫"重心原理"，我们管它叫"那只永远不倒的鸟"'},
  {id:'dough_figurine',name:'捏面人',cat:'玩具文具',rare:'R',badge:'scene_3',desc:'赶集的时候花五毛钱捏的，放在窗台上看了两年后来它裂了我哭了很久'},
  {id:'paper_plane',name:'纸飞机',cat:'玩具文具',rare:'N',badge:'scene_6',desc:'从三楼飞下去刚好落在校长头上，我们被罚站了一节课但飞机真的很远'},
  {id:'barbie',name:'芭比娃娃',cat:'玩具文具',rare:'SSR',badge:'scene_9',desc:'那是姐姐攒了三个月零花钱买的，后来她长大了送给了我'},
  // 零食 (12) — 无尽宝箱坑
  {id:'mylikes',name:'麦丽素',cat:'零食',rare:'R',badge:'',desc:'课间花五毛钱买一盒，里面最甜的永远是最后一颗'},
  {id:'white_rabbit',name:'大白兔奶糖',cat:'零食',rare:'R',badge:'',desc:'奶糖嚼着嚼着就粘在牙上了，那个甜从嘴里一直甜到放学'},
  {id:'pop_candy',name:'跳跳糖',cat:'零食',rare:'R',badge:'',desc:'倒进嘴里噼里啪啦，像在舌头上放了一场烟花'},
  {id:'haw_roll',name:'果丹皮',cat:'零食',rare:'N',badge:'',desc:'上课偷吃果丹皮，偷偷撕一小块塞嘴里假装在思考'},
  {id:'bubble_gum',name:'大大泡泡糖',cat:'零食',rare:'N',badge:'',desc:'吹了人生第一个泡泡啪一声糊了一脸，同桌笑得从椅子上摔下来'},
  {id:'cotton_candy',name:'棉花糖',cat:'零食',rare:'R',badge:'',desc:'那个棉花糖比我的头还大，吃一口甜得眯起了眼'},
  {id:'raccoon_noodle',name:'小浣熊干脆面',cat:'零食',rare:'R',badge:'',desc:'面要捏碎了再吃，调料包是宇宙的中心'},
  {id:'jianlibao',name:'健力宝',cat:'零食',rare:'SR',badge:'',desc:'过年过节才能喝到，那个气泡从喉咙一直冲到鼻子'},
  {id:'ice_pop',name:'老式冰棍',cat:'零食',rare:'N',badge:'',desc:'五分钱一根，咬一口冰得脑门疼，吃完嘴唇都白了'},
  {id:'snow_cake',name:'娃娃头雪糕',cat:'零食',rare:'SR',badge:'',desc:'先咬帽子再咬耳朵最后吃脸——每次都要纠结好久从哪开始'},
  {id:'hawthorn_roll',name:'山楂卷',cat:'零食',rare:'SR',badge:'',desc:'吃完果丹皮，玻璃纸留着折成千纸鹤'},
  {id:'spicy_strip',name:'大刀肉辣条',cat:'零食',rare:'SSR',badge:'',desc:'两根辣条配一个馒头，是放学路上最豪华的加餐'},
  // 生活用品 (10) — 闯关奖励
  {id:'enamel_cup',name:'搪瓷茶缸',cat:'生活用品',rare:'N',badge:'',desc:'爷爷的茶缸，里面沏过最浓的茉莉花茶也装过我第一次喝的可乐'},
  {id:'oil_lamp',name:'煤油灯',cat:'生活用品',rare:'N',badge:'',desc:'停电的夜晚，煤油灯照亮了整个房间也照亮了爷爷给我们讲的故事'},
  {id:'enamel_basin',name:'搪瓷脸盆',cat:'生活用品',rare:'N',badge:'',desc:'夏天用这个盆洗脸，水要打半盆，洗完了水还能浇院子里的花'},
  {id:'cream_tin',name:'百雀羚雪花膏',cat:'生活用品',rare:'N',badge:'',desc:'奶奶每天早上用这个擦脸，然后用手心剩下的香香给我擦'},
  {id:'radio',name:'老式收音机',cat:'生活用品',rare:'R',badge:'',desc:'每天下午六点，收音机准时播《小喇叭》，那个声音一直在'},
  {id:'desk_fan',name:'台扇',cat:'生活用品',rare:'R',badge:'',desc:'夏天的命是这个风扇给的，对着它喊"啊"声音就变成了颤音'},
  {id:'clock',name:'机械座钟',cat:'生活用品',rare:'R',badge:'',desc:'那只钟在家里挂了三十年，搬家的时候发现它停了'},
  {id:'bicycle',name:'二八大杠自行车',cat:'生活用品',rare:'SR',badge:'',desc:'爸爸骑这辆车送我上学，风呼呼地从耳朵边刮过'},
  {id:'tv',name:'黑白电视',cat:'生活用品',rare:'SR',badge:'',desc:'全村只有一台电视的时候，晚饭后天井里坐满了人'},
  {id:'washer',name:'双缸洗衣机',cat:'生活用品',rare:'SSR',badge:'',desc:'妈妈用这台洗衣机洗了我的尿布、校服、球鞋，后来搬家换了全自动但她总说老的那台甩得干净'},
];

function isTreasureFound(id) { return treasureData.found.indexOf(id) !== -1; }

// 每日签到
// ============================================================
var checkinData = { days: [], lastDate: '' };
var seenBadges = [];   // 已查看过的勋章
var seenMarbles = [];  // 已查看过的皮肤
var seenScenes = [];   // 已查看过的场景
var badgeDates = {};   // 勋章获得时间

function loadCheckinData() {
  try { var d = wx.getStorageSync('zhuzhu_checkin'); if (d) checkinData = d; } catch(e) {}
}

function saveCheckinData() {
  try { wx.setStorageSync('zhuzhu_checkin', checkinData); } catch(e) {}
}

function todayStr() { var d = new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function formatDate(d) { return d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0'); }

function doShare() {
  if (typeof wx !== 'undefined' && wx.shareAppMessage) {
    justShared = true;
    shareTimestamp = Date.now();
    wx.shareAppMessage({
      title: '终于有人把玻璃珠做成游戏了~',
      imageUrl: 'assets/images/ui/sharepic.jpg',
      query: ''
    });
  }
}

function doCheckin() {
  var today = todayStr();
  if (checkinData.lastDate === today) return false;
  checkinData.lastDate = today;
  if (checkinData.days.indexOf(today) === -1) checkinData.days.push(today);
  saveCheckinData();
  // 同步登录天数（陪伴勋章/称号依赖此值）
  progress.loginDays = checkinData.days.length;
  saveAllData();
  var totalDays = checkinData.days.length;
  var weekDay = (totalDays - 1) % 7; // 0~6

  if (weekDay === 0) {
    // 第1天：1个爱心
    livesData.lives = Math.min(livesData.lives + 1, 99);
    try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
  } else if (weekDay === 1 || weekDay === 3) {
    // 第2/4天：2个爱心
    livesData.lives = Math.min(livesData.lives + 2, 99);
    try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
  } else if (weekDay === 2 || weekDay === 4) {
    // 第3/5天：2个随机道具
    var types = ['heart','jump','force'];
    for (var i = types.length - 1; i > 0; i--) { var j = Math.floor(Math.random()*(i+1)); var t=types[i]; types[i]=types[j]; types[j]=t; }
    for (var k = 0; k < 2; k++) {
      zhuzhuProps[types[k]] = (zhuzhuProps[types[k]] || 0) + 1;
      sessionProps[types[k]] = (sessionProps[types[k]] || 0) + 1;
    }
    saveProps();
  } else if (weekDay === 5) {
    // 第6天：三种道具各1个
    zhuzhuProps.heart = (zhuzhuProps.heart || 0) + 1;
    zhuzhuProps.jump = (zhuzhuProps.jump || 0) + 1;
    zhuzhuProps.force = (zhuzhuProps.force || 0) + 1;
    sessionProps.heart = (sessionProps.heart || 0) + 1;
    sessionProps.jump = (sessionProps.jump || 0) + 1;
    sessionProps.force = (sessionProps.force || 0) + 1;
    saveProps();
  } else if (weekDay === 6) {
    // 第7天：随机1个玩具文具宝物，50%重复率，已拥有则换1爱心
    var toyPool = ALL_TREASURES.filter(function(t){ return t.cat === '玩具文具'; });
    if (toyPool.length > 0) {
      var avail = toyPool.filter(function(t){ return treasureData.found.indexOf(t.id) === -1; });
      var useAvail = (avail.length > 0 && Math.random() > 0.5);
      var pick = useAvail ? avail[Math.floor(Math.random() * avail.length)] : toyPool[Math.floor(Math.random() * toyPool.length)];
      pendingCheckinTreasure = pick.id;
      if (treasureData.found.indexOf(pick.id) === -1) {
        treasureData.found.push(pick.id);
        treasureData.foundDates[pick.id] = Date.now();
        treasureData.newFound[pick.id] = true;
        try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {}
      } else {
        // 已拥有 → 换1个爱心
        livesData.lives = Math.min(livesData.lives + 1, 99);
        try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
      }
    }
  }
  checkMilestones(); // 签到后立即检查陪伴勋章
  return true;
}

var checkinRewardShow = false; // 签到奖励弹窗
var pendingCheckinTreasure = ''; // 签到第7天宝物

function drawCheckinPopup() {
  if (checkinRewardShow) { drawCheckinRewardPopup(); return; }
  drawHomePage(); // 先画首页，再覆盖弹窗
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var cw = W * 0.88, ch = 290;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);

  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('每日签到', W / 2, cy + 35);
  ctx.fillStyle = '#222'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  var today = todayStr();
  var checkedToday = checkinData.lastDate === today;
  var totalDays = checkinData.days.length;

  ctx.fillStyle = '#ED971C';
  ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('已连续签到 ' + totalDays + ' 天', W / 2, cy + 70);

  var gridY = cy + 90, cellW = (cw - 60) / 7, cellH = 50, gap = 4;
  var dayLabels = ['第1天','第2天','第3天','第4天','第5天','第6天','第7天'];
  for (var di = 0; di < 7; di++) {
    var gx = cx + 20 + di * (cellW + gap);
    var isChecked = totalDays > di;
    ctx.fillStyle = isChecked ? 'rgba(237,151,28,0.25)' : 'rgba(0,0,0,0.05)';
    roundRectPath(gx, gridY, cellW, cellH, 8); ctx.fill();
    // 第？天标签
    ctx.fillStyle = '#999'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(dayLabels[di], gx + cellW / 2, gridY + 14);
    if (isChecked) {
      if (uiIcons.flower && uiIcons.flower.width) {
        ctx.drawImage(uiIcons.flower, gx + cellW/2 - 10, gridY + 22, 20, 20);
      } else {
        ctx.fillStyle = '#ED971C'; ctx.font = 'bold 18px sans-serif';
        ctx.fillText('✓', gx + cellW / 2, gridY + 32);
      }
    }
    var rwY = gridY + cellH + 8;
    if (di === 0 && uiIcons.heart) ctx.drawImage(uiIcons.heart, gx+cellW/2-8, rwY, 16, 16);
    else if (di === 1 || di === 3) { if (uiIcons.heart) { ctx.drawImage(uiIcons.heart, gx+cellW/2-10, rwY, 16, 16); ctx.drawImage(uiIcons.heart, gx+cellW/2+6, rwY, 16, 16); } }
    else if (di === 2 && uiIcons.gift) ctx.drawImage(uiIcons.gift, gx+cellW/2-8, rwY, 16, 16);
    else if (di === 4 && uiIcons.tbox) ctx.drawImage(uiIcons.tbox, gx+cellW/2-8, rwY, 16, 16);
    else if (di === 5 && uiIcons.dia) ctx.drawImage(uiIcons.dia, gx+cellW/2-8, rwY, 16, 16);
    else if (di === 6 && uiIcons.tbox) ctx.drawImage(uiIcons.tbox, gx+cellW/2-8, rwY, 16, 16);
    else { ctx.fillStyle = isChecked?'#333':'#bbb'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.fillText('?',gx+cellW/2,rwY+10); }
  }

  var btnY3 = gridY + cellH + 45;
  var btnW3 = 200, btnH3 = 44;
  var btnX3 = (W - btnW3) / 2;
  ctx.fillStyle = checkedToday ? '#ccc' : '#ED971C';
  roundRectPath(btnX3, btnY3, btnW3, btnH3, 10); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(checkedToday ? '已签到' : '签到', W / 2, btnY3 + 30);
  ctx.fillStyle = '#aaa';
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(checkedToday ? '明天继续来签到哦~' : '连续签到7天可获得额外奖励', W / 2, btnY3 + btnH3 + 22);
}

function handleCheckinTouch(tx, ty) {
  if (checkinRewardShow) {
    var cw2 = 260, ch2 = 230;
    var cx2 = (W - cw2) / 2, cy2 = (H - ch2) / 2;
    if (tx > cx2 + cw2 - 55 && tx < cx2 + cw2 && ty > cy2 && ty < cy2 + 55) { checkinRewardShow = false; return; }
    var by5 = cy2 + ch2 - 66, bw5 = 140, bh5 = 38, bx5 = (W - bw5) / 2;
    if (tx > bx5 && tx < bx5 + bw5 && ty > by5 && ty < by5 + bh5) {
      doCheckin();
      checkinRewardShow = false;
      gameState = STATE.HOME;
    }
    return;
  }
  var cw = W * 0.88, ch = 290;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy && ty < cy + 55) { gameState = STATE.HOME; return; }
  var btnY3 = cy + 90 + 50 + 45;
  var btnW3 = 200, btnH3 = 44;
  var btnX3 = (W - btnW3) / 2;
  if (!checkinData.lastDate || checkinData.lastDate !== todayStr()) {
    if (tx > btnX3 && tx < btnX3 + btnW3 && ty > btnY3 && ty < btnY3 + btnH3) { checkinRewardShow = true; }
  }
}

function drawCheckinRewardPopup() {
  drawHomePage();
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, W, H);
  var cw = 260, ch = 230;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('签到奖励', W / 2, cy + 35);
  ctx.fillStyle = '#222'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  var wd = checkinData.days.length % 7;
  var propY = cy + 68;
  var pn = {heart:'复活',jump:'跳过',force:'强磁'};
  if (wd === 0) {
    if (uiIcons.heart) ctx.drawImage(uiIcons.heart, W/2-22, propY, 44, 44);
    ctx.fillStyle = '#333'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('爱心 ×1', W/2, propY+60);
  } else if (wd === 1 || wd === 3) {
    if (uiIcons.heart) { ctx.drawImage(uiIcons.heart, W/2-28, propY, 44, 44); ctx.drawImage(uiIcons.heart, W/2+4, propY, 44, 44); }
    ctx.fillStyle = '#333'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('爱心 ×2', W/2, propY+60);
  } else if (wd === 2 || wd === 4) {
    // 随机2道具，展示三个道具图标其中两个高亮
    var pts = ['heart','jump','force'];
    for (var k = 0; k < 3; k++) {
      var px = W/2 - 70 + k * 56;
      var pi = uiIcons['prop_' + pts[k]];
      if (pi && pi.width) ctx.drawImage(pi, px, propY, 44, 44);
      ctx.fillStyle = '#333'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(pn[pts[k]], px + 22, propY + 60);
    }
    ctx.fillStyle = '#ED971C'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText('以上随机出2种', W/2, propY + 80);
  } else if (wd === 5) {
    var pts2 = ['heart','jump','force'];
    for (var k2 = 0; k2 < 3; k2++) {
      var px2 = W/2 - 70 + k2 * 56;
      var pi2 = uiIcons['prop_' + pts2[k2]];
      if (pi2 && pi2.width) ctx.drawImage(pi2, px2, propY, 44, 44);
      ctx.fillStyle = '#333'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(pn[pts2[k2]] + ' ×1', px2 + 22, propY + 60);
    }
  } else if (wd === 6) {
    var ti = treasureIcons[pendingCheckinTreasure];
    if (ti && ti.width) ctx.drawImage(ti, W/2-35, propY, 70, 70);
    var t7 = ALL_TREASURES.find(function(tr){ return tr.id === pendingCheckinTreasure; });
    ctx.fillStyle = '#333'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(t7 ? t7.name : '随机宝物', W/2, propY + 86);
    // 已拥有 → 提示
    if (t7 && treasureData.found.indexOf(pendingCheckinTreasure) !== -1) {
      ctx.fillStyle = '#E53E3E'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('宝物已拥有，自动换成1个爱心', W/2, propY + 104);
    }
  }
  var btnY = cy + ch - 66;
  var btnW = 140, btnH = 38;
  ctx.fillStyle = '#ED971C'; roundRectPath((W - btnW) / 2, btnY, btnW, btnH, 10); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('领取', W/2, btnY + 26);
}

// 意见反馈
// ============================================================
var feedbackText = '';
var feedbackContact = '';
var feedbackImages = [];
var feedbackAgree = false;
var feedbackScrollY2 = 0;
var feedbackTouchY2 = 0;
var feedbackFocus = ''; // 'text' | 'contact'

function drawFeedbackPopup() {
  drawHomePage();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, W, H);

  var cw = W * 0.9, ch = H * 0.82;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);

  // 标题
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('意见反馈', W / 2, cy + 35);

  // 关闭
  ctx.fillStyle = '#222';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  var scrollY = cy + 65;
  var bottomY = cy + ch - 10;
  var contentH = bottomY - scrollY;

  ctx.save();
  ctx.beginPath(); ctx.rect(cx + 10, scrollY, cw - 20, contentH); ctx.clip();
  var y = scrollY + feedbackScrollY2;

  // 问题描述
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('问题描述', cx + 25, y + 18);
  y += 28;
  var inputW = cw - 50, inputH = 100;
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  roundRectPath(cx + 25, y, inputW, inputH, 10); ctx.fill();
  ctx.strokeStyle = feedbackFocus === 'text' ? '#ED971C' : 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1.5;
  roundRectPath(cx + 25, y, inputW, inputH, 10); ctx.stroke();
  if (feedbackText.length === 0) {
    ctx.fillStyle = '#bbb';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    var hintText = '请填写10字以上的问题描述\n以便我们提供更好的改进';
    var hintLines = hintText.split('\n');
    for (var hl = 0; hl < hintLines.length; hl++) {
      ctx.fillText(hintLines[hl], cx + 35, y + 28 + hl * 20);
    }
  } else {
    ctx.fillStyle = '#333';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    // 自动换行
    var maxChars = Math.floor(inputW / 14); // 每行约14字
    var rawLines = feedbackText.split('\n');
    var wrapped = [];
    for (var rl = 0; rl < rawLines.length; rl++) {
      var line = rawLines[rl];
      while (line.length > maxChars) {
        wrapped.push(line.substring(0, maxChars));
        line = line.substring(maxChars);
      }
      wrapped.push(line);
    }
    for (var wl = 0; wl < wrapped.length; wl++) {
      ctx.fillText(wrapped[wl], cx + 35, y + 25 + wl * 20);
    }
  }
  ctx.fillStyle = '#aaa';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(feedbackText.length + '/200', cx + 25 + inputW, y + inputH + 14);
  y += inputH + 20;

  // 截图
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('截图 ' + feedbackImages.length + '/4', cx + 25, y + 18);
  y += 28;
  var imgW2 = 60, imgGap = 8;
  for (var fi = 0; fi < 4; fi++) {
    var ix2 = cx + 25 + fi * (imgW2 + imgGap);
    if (fi < feedbackImages.length) {
      ctx.save();
      roundRectPath(ix2, y, imgW2, imgW2, 8); ctx.clip();
      var fbImg = feedbackImages[fi];
      if (fbImg && fbImg.width) {
        var scl2 = Math.max(imgW2 / fbImg.width, imgW2 / fbImg.height);
        var dw2 = fbImg.width * scl2, dh2 = fbImg.height * scl2;
        ctx.drawImage(fbImg, ix2 + (imgW2 - dw2) / 2, y + (imgW2 - dh2) / 2, dw2, dh2);
      } else {
        ctx.fillStyle = 'rgba(237,151,28,0.2)';
        ctx.fillRect(ix2, y, imgW2, imgW2);
      }
      ctx.restore();
    } else if (fi === feedbackImages.length && feedbackImages.length < 4) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      roundRectPath(ix2, y, imgW2, imgW2, 8); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ccc';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+', ix2 + imgW2 / 2, y + imgW2 / 2 + 9);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.03)';
      roundRectPath(ix2, y, imgW2, imgW2, 8); ctx.fill();
    }
  }
  y += imgW2 + 20;

  // 联系方式
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('联系方式：邮箱/手机号码', cx + 25, y + 18);
  y += 28;
  var contactH = 38;
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  roundRectPath(cx + 25, y, inputW, contactH, 8); ctx.fill();
  ctx.strokeStyle = feedbackFocus === 'contact' ? '#ED971C' : 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1.5;
  roundRectPath(cx + 25, y, inputW, contactH, 8); ctx.stroke();
  ctx.fillStyle = feedbackContact.length > 0 ? '#333' : '#bbb';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(feedbackContact.length > 0 ? feedbackContact : '请输入邮箱或手机号码', cx + 35, y + 26);
  y += contactH + 16;

  // 同意勾选
  var checkX = cx + 25, checkY = y, checkR = 10;
  ctx.beginPath();
  ctx.arc(checkX + checkR, checkY + checkR, checkR, 0, Math.PI * 2);
  ctx.fillStyle = feedbackAgree ? '#ED971C' : 'rgba(0,0,0,0.1)';
  ctx.fill();
  ctx.strokeStyle = feedbackAgree ? '#ED971C' : 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1.5; ctx.stroke();
  if (feedbackAgree) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✓', checkX + checkR, checkY + checkR + 5);
  }
  ctx.fillStyle = '#666';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('允许开发者在48小时内通过客服消息联系我', checkX + checkR * 2 + 8, checkY + 15);
  y += checkR * 2 + 16;

  // 提交按钮
  var hasContent = feedbackText.length >= 10;
  var btnW3 = 200, btnH3 = 40;
  var btnX3 = (W - btnW3) / 2;
  ctx.fillStyle = hasContent ? '#4CAF50' : '#ccc';
  roundRectPath(btnX3, y, btnW3, btnH3, 10); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('提交', W / 2, y + 28);

  ctx.restore();
}

function handleFeedbackTouch(tx, ty) {
  var cw = W * 0.9, ch = H * 0.82;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  // 关闭
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy && ty < cy + 55) {
    wx.hideKeyboard(); feedbackFocus = ''; gameState = STATE.HOME; return;
  }
  var scrollY = cy + 65;
  var inputW = cw - 50, inputH = 100;
  var y2 = scrollY + feedbackScrollY2;
  var textY = y2 + 28;
  // 文本输入区 → 打开键盘
  if (tx > cx + 25 && tx < cx + 25 + inputW) {
    if (ty > textY && ty < textY + inputH) {
      feedbackFocus = 'text';
      wx.showKeyboard({ defaultValue: feedbackText, maxLength: 200, confirmType: 'done', multiple: true });
    }
    var imgY2 = textY + inputH + 20 + 28;
    if (tx > cx + 25 && tx < cx + 25 + 60 && ty > imgY2 && ty < imgY2 + 60 && feedbackImages.length < 4) {
      wx.chooseImage({ count: 4 - feedbackImages.length, sizeType: ['compressed'], sourceType: ['album','camera'], success: function(res){ if(res.tempFilePaths){ for(var fpi=0;fpi<res.tempFilePaths.length;fpi++){ var fbImg=wx.createImage();fbImg.src=res.tempFilePaths[fpi];feedbackImages.push(fbImg); } } } });
    }
    var contactTop = imgY2 + 60 + 28 + 28;
    if (ty > contactTop && ty < contactTop + 38) {
      feedbackFocus = 'contact';
      wx.showKeyboard({ defaultValue: feedbackContact, maxLength: 100, confirmType: 'done' });
    }
    var checkTop = contactTop + 38 + 16;
    if (tx > cx + 25 && tx < cx + 25 + 120 && ty > checkTop && ty < checkTop + 24) {
      feedbackAgree = !feedbackAgree;
    }
    var btnTop = checkTop + 36;
    if (feedbackText.length >= 10 && tx > (W-200)/2 && tx < (W+200)/2 && ty > btnTop && ty < btnTop + 40) {
      wx.hideKeyboard(); feedbackFocus = '';
      // 保存反馈到本地，后续可通过云函数上传
      var fb = { text: feedbackText, contact: feedbackContact, agree: feedbackAgree, time: Date.now() };
      var fblist = [];
      try { var old = wx.getStorageSync('zhuzhu_feedback'); if (old) fblist = JSON.parse(old); } catch(e) {}
      fblist.push(fb);
      try { wx.setStorageSync('zhuzhu_feedback', JSON.stringify(fblist)); } catch(e) {}
      // 先上传图片到云存储
      var imgUrls = [];
      var _uploadAndSubmit = function() {
        try { wx.cloud.callFunction({ name: 'rank', data: { action: 'submitFeedback', text: feedbackText, contact: feedbackContact, agree: feedbackAgree, time: Date.now(), images: imgUrls } }).catch(function(){}); } catch(e) {}
      };
      if (feedbackImages.length > 0) {
        var _uploaded = 0;
        feedbackImages.forEach(function(fbImg, fi) {
          // 将Image绘制到离屏canvas转base64
          var cvs = wx.createCanvas(); cvs.width = fbImg.width || 200; cvs.height = fbImg.height || 200;
          var cctx = cvs.getContext('2d'); cctx.drawImage(fbImg, 0, 0);
          var tempPath = (wx.env.USER_DATA_PATH || '') + '/fb_' + Date.now() + '_' + fi + '.png';
          try {
            var fs2 = wx.getFileSystemManager();
            var b64 = cvs.toDataURL ? cvs.toDataURL().split(',')[1] : '';
            if (b64) {
              fs2.writeFileSync(tempPath, b64, 'base64');
              wx.cloud.uploadFile({ cloudPath: 'feedback/' + Date.now() + '_' + fi + '.png', filePath: tempPath, success: function(res) {
                imgUrls.push(res.fileID);
                _uploaded++; if (_uploaded >= feedbackImages.length) _uploadAndSubmit();
              }, fail: function() { _uploaded++; if (_uploaded >= feedbackImages.length) _uploadAndSubmit(); } });
            } else { _uploaded++; if (_uploaded >= feedbackImages.length) _uploadAndSubmit(); }
          } catch(e) { _uploaded++; if (_uploaded >= feedbackImages.length) _uploadAndSubmit(); }
        });
      } else { _uploadAndSubmit(); }
      wx.showToast({ title: '感谢反馈！', icon: 'success' });
      feedbackText = ''; feedbackContact = ''; feedbackImages = []; feedbackAgree = false;
      gameState = STATE.HOME;
    }
  }
}

function handleFeedbackMove(tx, ty) {
  feedbackScrollY2 += (ty - feedbackTouchY2) * 0.7;
  feedbackTouchY2 = ty;
  var maxS = 0, minS = -(300);
  if (feedbackScrollY2 > maxS) feedbackScrollY2 = maxS;
  if (feedbackScrollY2 < minS) feedbackScrollY2 = minS;
}

// ============================================================
// 宝箱弹窗
// ============================================================
function drawTreasurePopup() {
  // 外婆的后院背景
  if (bgImage && bgImage.width > 0) {
    var iw7 = bgImage.width, ih7 = bgImage.height;
    var sc7 = Math.max(W / iw7, H / ih7);
    ctx.drawImage(bgImage, (W - iw7*sc7)/2, (H - ih7*sc7)/2, iw7*sc7, ih7*sc7);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#2a1f0f'; ctx.fillRect(0, 0, W, H);
  }

  // 顶部栏
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, capsuleRect.bottom + 4);
  // 返回按钮
  var btnY5 = CAPSULE_MID_Y - 12;
  if (backImage && backImage.width > 0) {
    ctx.drawImage(backImage, 12, btnY5, 24, 24);
  }
  ctx.fillStyle = '#fff'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('童年宝库', W / 2, CAPSULE_MID_Y + 5);

  var cw = W * 0.94, ch = H - capsuleRect.bottom - 20;
  var cx = (W - cw) / 2, cy = capsuleRect.bottom + 10;

  // 标签
  var tabs = ['全部宝物','玩具文具','零食','生活用品'];
  var tabs2 = ['all','toy','food','life'];
  var tabY = cy + 35, tabH = 44;
  for (var ti = 0; ti < 4; ti++) {
    var tw3 = (cw - 50) / 4, tx3 = cx + 15 + ti * (tw3 + 6);
    ctx.fillStyle = treasureTab === ti ? '#ED971C' : 'rgba(237,151,28,0.4)';
    roundRectPath(tx3, tabY, tw3, tabH, 6); ctx.fill();
    ctx.fillStyle = treasureTab === ti ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(tabs[ti], tx3 + tw3 / 2, tabY + tabH / 2 + 5);
  }

  // 筛选 + 已发现的置顶
  var cats = ['玩具文具','零食','生活用品'];
  var cat = tabs2[treasureTab];
  var list = ALL_TREASURES;
  if (cat !== 'all') list = list.filter(function(t){ return t.cat === cats[treasureTab-1]; });
  list = list.slice().sort(function(a,b){ return (isTreasureFound(b.id)?1:0) - (isTreasureFound(a.id)?1:0); });

  // 进度
  var foundCount = list.filter(function(t){ return isTreasureFound(t.id); }).length;
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('收集 ' + foundCount + ' / ' + list.length, W / 2, cy + ch - 28);

  // 进度条
  var pbarX = cx + 20, pbarW = cw - 40, pbarH = 6, pbarY = cy + ch - 22;
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; roundRectPath(pbarX, pbarY, pbarW, pbarH, 3); ctx.fill();
  if (foundCount > 0) {
    ctx.fillStyle = '#ED971C';
    roundRectPath(pbarX, pbarY, pbarW * foundCount / list.length, pbarH, 3); ctx.fill();
  }

  // 卡片网格（4列）
  var cols = 4, gap = 6;
  var cardW2 = (cw - 32 - gap * 3) / cols, cardH4 = 100;
  var listY = tabY + tabH + 10, listH2 = ch - 150;
  ctx.save(); ctx.beginPath(); ctx.rect(cx + 10, listY, cw - 20, listH2); ctx.clip();
  for (var ti3 = 0; ti3 < list.length; ti3++) {
    var t2 = list[ti3];
    var col2 = ti3 % cols, row2 = Math.floor(ti3 / cols);
    var tx4 = cx + 15 + col2 * (cardW2 + gap);
    var ty4 = listY + row2 * (cardH4 + gap) + treasureScrollY;
    if (ty4 + cardH4 < listY || ty4 > listY + listH2) continue;
    var found = isTreasureFound(t2.id);
    ctx.fillStyle = '#f5ecd7';
    roundRectPath(tx4, ty4, cardW2, cardH4, 8); ctx.fill();
    if (found) { ctx.strokeStyle = 'rgba(237,151,28,0.5)'; ctx.lineWidth = 1.5; roundRectPath(tx4, ty4, cardW2, cardH4, 8); ctx.stroke(); }
    if (found) {
      var tImg3 = treasureIcons[t2.id];
      var sq = Math.min(cardW2 - 8, cardH4 - 14);
      if (tImg3 && tImg3.width) { ctx.drawImage(tImg3, tx4 + (cardW2 - sq) / 2, ty4 + (cardH4 - 14 - sq) / 2 + 1, sq, sq); }
      else { ctx.fillStyle = '#ED971C'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('[]', tx4 + cardW2 / 2, ty4 + 32); }
    } else if (uiIcons.tboxs && uiIcons.tboxs.width) {
      ctx.drawImage(uiIcons.tboxs, tx4 + cardW2/2 - 20, ty4 + 23, 40, 40);
    } else {
      ctx.fillStyle = '#bbb'; ctx.font = '22px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('?', tx4 + cardW2 / 2, ty4 + 32);
    }
    // NEW角标（查看过即消失）
    if (treasureData.newFound[t2.id]) {
      ctx.beginPath(); ctx.arc(tx4 + cardW2 - 12, ty4 + 12, 10, 0, Math.PI*2);
      ctx.fillStyle = '#4CAF50'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('NEW', tx4 + cardW2 - 12, ty4 + 14);
    }
    ctx.fillStyle = found ? '#1a1a1a' : '#999';
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(found ? t2.name : '待发现', tx4 + cardW2 / 2, ty4 + cardH4 - 8);
  }
  ctx.restore();

  // 详情弹窗
  if (treasureDetailIdx >= 0) drawTreasureDetail(list);
}

function drawTreasureDetail(list) {
  var idx = treasureDetailIdx;
  if (idx < 0 || idx >= list.length) return;
  var t3 = list[idx];
  var found = isTreasureFound(t3.id);

  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var mw2 = 280, mh2 = 440;
  var mx2 = (W - mw2) / 2, my2 = (H - mh2) / 2;
  drawPopupBg3(mx2, my2, mw2, mh2, 14);

  // 内容区

  // 图片区
  var imgW = 180, imgH = 180;
  var imgX = mx2 + (mw2 - imgW) / 2, imgY = my2 + 18;
  if (found) {
    var tImg4 = treasureIcons[t3.id];
    if (tImg4 && tImg4.width) {
      ctx.save(); roundRectPath(imgX, imgY, imgW, imgH, 8); ctx.clip();
      var sc7 = Math.max(imgW / tImg4.width, imgH / tImg4.height);
      ctx.drawImage(tImg4, imgX + (imgW - tImg4.width * sc7) / 2, imgY + (imgH - tImg4.height * sc7) / 2, tImg4.width * sc7, tImg4.height * sc7);
      ctx.restore();
    }
  } else if (uiIcons.tboxs && uiIcons.tboxs.width) {
    ctx.drawImage(uiIcons.tboxs, imgX + imgW/2 - 35, imgY + imgH/2 - 35, 70, 70);
  }

  // 右上角序号
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText((idx + 1) + ' / ' + list.length, mx2 + mw2 - 16, my2 + 16);

  // 左右箭头（卡片左下角 & 右下角）
  var aR2 = 20, aY2 = my2 + mh2 - 42;
  if (idx > 0) {
    ctx.beginPath(); ctx.arc(mx2 + 42, aY2, aR2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    if (backImage && backImage.width) ctx.drawImage(backImage, mx2 + 32, aY2 - 10, 20, 20);
  }
  if (idx < list.length - 1) {
    ctx.beginPath(); ctx.arc(mx2 + mw2 - 42, aY2, aR2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    if (backImage && backImage.width) { ctx.save(); ctx.translate(mx2 + mw2 - 42, aY2); ctx.scale(-1, 1); ctx.drawImage(backImage, -10, -10, 20, 20); ctx.restore(); }
  }


  // 标签
  var tagY = imgY + imgH + 6;
  ctx.fillStyle = '#ED971C'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(t3.cat, W / 2, tagY + 14);
  // 星星
  var starCount = t3.rare==='N'?1:t3.rare==='R'?2:t3.rare==='SR'?3:4;
  if (uiIcons.star && uiIcons.star.width) {
    for (var si = 0; si < starCount; si++) {
      ctx.drawImage(uiIcons.star, W/2 + (si - starCount/2 + 0.5) * 18 - 8, tagY + 23, 16, 16);
    }
  }

  // 名称
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 18px sans-serif';
  ctx.fillText(found ? t3.name : '待发现', W / 2, tagY + 62);

  // 简介
  if (found && t3.desc) {
    ctx.fillStyle = '#555'; ctx.font = '13px sans-serif';
    var descLines = t3.desc.split('');
    var l2 = '', y2 = tagY + 87;
    for (var di = 0; di < descLines.length; di++) {
      l2 += descLines[di];
      if (l2.length >= 16 || di === descLines.length - 1) {
        ctx.fillText(l2, W / 2, y2); y2 += 20; l2 = '';
      }
    }
  }

  // 底部序号
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText((idx + 1) + ' / ' + list.length, W / 2, my2 + mh2 - 38);

  // 关闭按钮（白色，底部居中）
  var closeY = my2 + mh2 + 26;
  ctx.fillStyle = '#fff'; ctx.font = '26px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('✕', W / 2, closeY + 10);
}

function handleTreasureTouch(tx, ty) {
  var cw = W * 0.9, ch = H * 0.78;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;

  // 详情弹窗
  if (treasureDetailIdx >= 0) {
    var mw3 = 280, mh3 = 440, mx3 = (W - mw3) / 2, my3 = (H - mh3) / 2;
    var aY3 = my3 + mh3 - 42;
    // 左箭头（卡片左下角）
    if (treasureDetailIdx > 0 && tx > mx3 + 22 && tx < mx3 + 62 && ty > aY3 - 22 && ty < aY3 + 22) { treasureDetailIdx--; return; }
    // 右箭头（卡片右下角）
    var tL = ALL_TREASURES;
    var tC = ['all','toy','food','life'][treasureTab];
    if (tC !== 'all') { var tCs = ['玩具文具','零食','生活用品']; tL = tL.filter(function(t){ return t.cat === tCs[treasureTab-1]; }); }
    if (treasureDetailIdx < tL.length - 1 && tx > mx3 + mw3 - 62 && tx < mx3 + mw3 - 22 && ty > aY3 - 22 && ty < aY3 + 22) { treasureDetailIdx++; return; }
    // 弹窗内保留
    if (tx > mx3 && tx < mx3 + mw3 && ty > my3 && ty < my3 + mh3) return;
    // 弹窗外关闭
    treasureDetailIdx = -1; return;
  }

  // 返回按钮
  var bY2 = CAPSULE_MID_Y - 12;
  if (tx > 8 && tx < 44 && ty > bY2 - 4 && ty < bY2 + 28) { treasureData.newFound = {}; try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {} gameState = STATE.HOME; treasureDetailIdx = -1; return; }

  // 标签
  var tabY3 = capsuleRect.bottom + 45;
  if (ty > tabY3 && ty < tabY3 + 30) {
    var tw4 = (cw - 50) / 4;
    for (var ti4 = 0; ti4 < 4; ti4++) {
      var ttx = cx + 15 + ti4 * (tw4 + 6);
      if (tx > ttx && tx < ttx + tw4) { treasureTab = ti4; treasureScrollY = 0; treasureDetailIdx = -1; return; }
    }
  }

  // 卡片（仅列表可视区域内可点击，底部进度条区域不触发）
  var cols4 = 4, gap4 = 6;
  var cardW4 = (cw - 40 - gap4 * 3) / cols4, cardH5 = 100;
  var listY2 = tabY3 + 30 + 10;
  var listBottom2 = listY2 + (H - capsuleRect.bottom - 170); // 与绘制 clip 对齐
  var dList = ALL_TREASURES;
  var dCat = ['all','toy','food','life'][treasureTab];
  if (dCat !== 'all') { var dCats = ['玩具文具','零食','生活用品']; dList = dList.filter(function(t){ return t.cat === dCats[treasureTab-1]; }); }
  for (var ti5 = 0; ti5 < dList.length; ti5++) {
    var col3 = ti5 % cols4, row3 = Math.floor(ti5 / cols4);
    var ttx2 = cx + 15 + col3 * (cardW4 + gap4);
    var tty2 = listY2 + row3 * (cardH5 + gap4) + treasureScrollY;
    if (ty < listY2 || ty > listBottom2) continue; // 超出可视区域不触发
    if (tx > ttx2 && tx < ttx2 + cardW4 && ty > tty2 && ty < tty2 + cardH5) {
      if (!treasureDragging) { treasureDetailIdx = ti5; }
      return;
    }
  }
}

function handleTreasureMove(tx, ty) {
  // 详情页横滑
  if (treasureDetailIdx >= 0) {
    var dx = tx - treasureSwipeX;
    if (Math.abs(dx) > 10) { treasureHoriSwipe = true; treasureSlideX = dx; }
    return;
  }
  if (treasureHoriSwipe) return;
  if (Math.abs(ty - treasureTouchY3) > 5) treasureDragging = true;
  if (!treasureDragging) return;
  treasureScrollY += (ty - treasureTouchY3);
  treasureTouchY3 = ty;
  var listH3 = H - capsuleRect.bottom - 170;
  var dCat2 = ['all','toy','food','life'][treasureTab];
  var dList2 = ALL_TREASURES;
  if (dCat2 !== 'all') { var dCats2 = ['玩具文具','零食','生活用品']; dList2 = dList2.filter(function(t){ return t.cat === dCats2[treasureTab-1]; }); }
  var rows2 = Math.ceil(dList2.length / 4);
  var totalH2 = rows2 * (100 + 6) + 6;
  var maxT = 0, minT = -(totalH2 - listH3);
  if (minT > 0) minT = 0;
  if (treasureScrollY > maxT) treasureScrollY = maxT;
  if (treasureScrollY < minT) treasureScrollY = minT;
}

var treasureTouchY3 = 0;
var treasureDragging = false;
var treasureSwipeX = 0;
var treasureSlideX = 0;     // 横滑动偏移
var treasureSlideTarget = 0; // 目标偏移
var treasureHoriSwipe = false; // 正在横滑
var treasureJustOpened = false; // 从首页进入时忽略首次触摸
var uiTouchStartX = 0, uiTouchStartY = 0; // 触摸起点，用于判断点击vs滑动
var treasureIcons = {};

// ============================================================
// 道具系统
// ============================================================
function saveProps() {
  try { wx.setStorageSync('zhuzhu_props', zhuzhuProps); } catch(e) {}
  try { wx.setStorageSync('zhuzhu_free_props_given', String(freePropsGivenToday)); } catch(e) {}
}

function useProp(type) {
  if (sessionProps[type] <= 0) return false;
  sessionProps[type]--;
  if (type === 'heart') return true;
  if (type === 'jump') return true;
  if (type === 'force') return true;
  return false;
}

function addPropRandom() {
  var types = ['heart','jump','force'];
  var t = types[Math.floor(Math.random() * types.length)];
  zhuzhuProps[t] = (zhuzhuProps[t] || 0) + 1;
  saveProps();
  return t;
}

function drawPropBar() {
  // 只在游戏内显示（非 HOME、非弹窗状态）
  if (gameState === STATE.HOME || gameState === STATE.CLASSIC || gameState === STATE.STORY || gameState === STATE.FEEDBACK || gameState === STATE.CHECKIN || gameState === STATE.TREASURE || gameState === STATE.LEVELSEL || gameState === STATE.BADGES || gameState === STATE.RANK || gameState === STATE.CONFIRM || gameState === STATE.SETTINGS || gameState === STATE.SKIN) return;
  var types = ['heart','jump','force'];
  var iconKeys = ['prop_heart','prop_jump','prop_force'];
  var sz = 64;
  var gap = (W - sz * 3) / 4; // space-around: 等距分布
  var startX = gap;
  var py = H - 40 - sz;
  for (var i = 0; i < 3; i++) {
    var px = startX + i * (sz + gap);
    var count = sessionProps[types[i]];
    // 图标
    var ico = uiIcons[iconKeys[i]];
    if (ico && ico.width) {
      ctx.drawImage(ico, px, py, sz, sz);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; roundRectPath(px, py, sz, sz, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(types[i], px+sz/2, py+sz/2+4);
    }
    // 气泡/加号
    if (count > 0) {
      ctx.beginPath(); ctx.arc(px + sz - 2, py + 2, 14, 0, Math.PI*2);
      ctx.fillStyle = '#E53E3E'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(count), px + sz - 2, py + 6);
    } else {
      var pls = uiIcons.plus;
      if (pls && pls.width) {
        ctx.drawImage(pls, px + sz - 16, py - 10, 32, 32);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(px+sz-3, py+3, 11, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('+', px+sz-3, py+8);
      }
    }
  }
}

function drawPropGetPopup() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var pw = 240, ph = 220;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  drawPopupBg3(px, py, pw, ph, 14);
  // 关闭
  ctx.fillStyle = '#222'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('✕', px + pw - 24, py + 36);
  // 标题
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('获取道具', W / 2, py + 38);
  // 当前道具图标（64x64，下移10px）
  var iconKey = propGetType === 'heart' ? 'prop_heart' : (propGetType === 'jump' ? 'prop_jump' : 'prop_force');
  var ico2 = uiIcons[iconKey];
  var sz2 = 64;
  if (ico2 && ico2.width) {
    ctx.drawImage(ico2, (W - sz2) / 2, py + 68, sz2, sz2);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; roundRectPath((W-sz2)/2, py+68, sz2, sz2, 10); ctx.fill();
  }
  // 分享按钮（文字垂直居中，上移5px）
  var bw = 160, bh = 40;
  var bx = (W - bw) / 2, by = py + ph - 70;
  ctx.fillStyle = '#4CAF50'; roundRectPath(bx, by, bw, bh, 20); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('免费获得', W / 2, by + bh/2 + 5);
}

function handlePropGetTouch(tx, ty) {
  var pw = 240, ph = 220;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  // 关闭
  if (tx > px + pw - 50 && tx < px + pw && ty > py && ty < py + 50) { propGetPopup = false; return true; }
  // 分享
  var bw = 160, bh = 40;
  var bx = (W - bw) / 2, by = py + ph - 60;
  if (tx > bx && tx < bx + bw && ty > by && ty < by + bh) {
    propSharePending = true;
    pendingPropShareType = propGetType;
    wx.shareAppMessage({ title: '玻璃珠和老物件—你怀念童年了吗？', imageUrl: 'assets/images/ui/sharepic.jpg' });
    return true;
  }
  if (tx < px || tx > px + pw || ty < py || ty > py + ph) { propGetPopup = false; return true; }
  return true;
}

function handlePropTouch(tx, ty) {
  var types = ['heart','jump','force'];
  var sz = 64;
  var gap = (W - sz * 3) / 4; // space-around: 等距分布
  var startX = gap;
  var py = H - 40 - sz;
  for (var i = 0; i < 3; i++) {
    var px = startX + i * (sz + gap);
    if (tx > px && tx < px + sz && ty > py && ty < py + sz) {
      var t = types[i];
      if (sessionProps[t] <= 0) { propGetPopup = true; propGetType = t; return; }
      if (t === 'heart') { useHeartProp(px + sz/2, py + sz/2); return; }
      if (t === 'jump') { useJumpProp(); return; }
      if (t === 'force') { useForceProp(); return; }
    }
  }
}

function useHeartProp(fx, fy) {
  if (!useProp('heart')) return;
  propHeartFly = { x: fx, y: fy, t: 0 };
}

function updatePropHeartFly(dt) {
  if (!propHeartFly && propHeartQueue > 0) {
    // 发射队列中的下一个爱心
    propHeartFly = { x: (W - 192) / 4 + 32, y: H - 40 - 32, t: 0 };
    propHeartQueue--;
  }
  if (!propHeartFly) return;
  propHeartFly.t += dt;
  if (propHeartFly.t >= 1.2) {
    livesData.lives = Math.min(livesData.lives + 1, 99);
    try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
    propHeartFly = null;
    if (propHeartQueue === 0) {
      propHeartFlyActive = false;
      // 爱心补完→继续游戏
      if (gameState === STATE.GAMEOVER && livesData.lives > 0) {
        gameOverAutoContinue = true;
      }
    }
  }
}

function drawPropHeartFly() {
  if (!propHeartFly) return;
  var pf = propHeartFly;
  var t6 = pf.t / 1.2;
  var ease6 = t6 * t6 * (3 - 2 * t6);
  var cx6 = pf.x + (W - 52 - pf.x) * ease6;
  var cy6 = pf.y + (H * 0.15 - 8 - pf.y) * ease6;
  var sc6 = t6 < 0.2 ? 1 + t6/0.2*1.5 : 2.5 - (t6-0.2)/0.8*1.5;
  ctx.save();
  ctx.globalAlpha = 1 - t6 * 0.3;
  ctx.translate(cx6, cy6);
  ctx.scale(sc6, sc6);
  if (uiIcons.heart && uiIcons.heart.width) {
    ctx.drawImage(uiIcons.heart, -24, -24, 48, 48);
  } else {
    ctx.fillStyle = '#ff4444'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('♥', 0, 0); ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function useJumpProp() {
  if (!useProp('jump')) return;
  if (gameState !== STATE.IDLE && gameState !== STATE.CHARGING) return;
  var tp = getCurrentTargetPit();
  if (!tp) return;
  // 记录跳过动画参数
  marble._jumpFromX2 = marble.worldX;
  marble._jumpFromY2 = marble.worldY;
  marble._jumpToX = tp.worldX;
  marble._jumpToY = tp.worldY;
  marble._jumpTargetPit = tp._index;
  currentPitIndex = tp._index;
  marble.vx = 0; marble.vy = 0;
  chargePower = 0; comboCount = 0;
  animTimer = 0;
  gameState = STATE.SINKING;
  marble._jumpPropAnim = true;
  marble._jumpSfxPlayed = false;
}

function updateJumpPropAnim(dt) {
  if (!marble._jumpPropAnim) return false;
  if (marble._jumpFromX2 === undefined || marble._jumpToX === undefined) { marble._jumpPropAnim = false; return false; }
  animTimer += dt;
  var dur = 0.35, pause = 0.3; // 入坑动画 + 坑内停留
  var t7 = Math.min(animTimer / dur, 1);
  if (t7 < 1) {
    // 缓动：先慢后快
    var ease7 = t7 < 0.5 ? 2*t7*t7 : 1 - Math.pow(-2*t7+2, 2)/2;
    marble.worldX = marble._jumpFromX2 + (marble._jumpToX - marble._jumpFromX2) * ease7;
    marble.worldY = marble._jumpFromY2 + (marble._jumpToY - marble._jumpFromY2) * ease7;
    // 缩放：100% → 130% → 90%
    if (t7 < 0.4) {
      marble.scale = 1.0 + t7/0.4 * 0.3;
    } else if (t7 < 0.8) {
      marble.scale = 1.3 - (t7-0.4)/0.4 * 0.4;
    } else {
      marble.scale = 0.80;
    }
    return true;
  }
  // 入坑音效（只播一次）
  if (!marble._jumpSfxPlayed) { playSfx('luo'); marble._jumpSfxPlayed = true; }
  var pt = animTimer - dur;
  marble.worldX = marble._jumpToX;
  marble.worldY = marble._jumpToY;
  marble.scale = 0.80;
  if (pt < pause) return true;
  // 停留结束，走正常跳出动画
  marble._jumpPropAnim = false;
  marble._jumpSfxPlayed = false;
  // 先做房务：计分、标记坑、生成新坑、宝物检查
  var tp5 = pits.find(function(p){ return p._index === marble._jumpTargetPit; });
  var hasT2 = false;
  if (tp5 && !tp5.visited) {
    tp5.visited = true; score++; comboCount++;
    if (score > bestScore) { bestScore = score; submitScoreToCloud(); }
    progress.totalPits = (progress.totalPits || 0) + 1;
    livesData.dailyPits = (livesData.dailyPits || 0) + 1;
    if (comboCount > (progress.bestCombo || 0)) progress.bestCombo = comboCount;
    if (comboCount > sessionBestCombo) sessionBestCombo = comboCount;
    if (comboCount > (livesData.dailyBestCombo || 0)) livesData.dailyBestCombo = comboCount;
    checkMilestones();
    // 闯关通关检测（跳坑道具不走finishSink，需单独判断）
    if (gameMode === 'levels') {
      var tgt2 = LEVEL_TARGETS[currentLevel] || 10;
      if (score >= tgt2 && currentLevel < 9) {
        if (!treasurePopup && !treasureWaitingParticles) {
          gameState = STATE.WIN; maxUnlockedLevel = Math.max(maxUnlockedLevel, currentLevel + 1);
          saveAllData();
          if (bgmAudio) bgmAudio.pause(); playSfx('victory');
        } else { pendingLevelWin = true; }
      }
    }
    if (tp5.hasTreasure && tp5.treasureId) {
      hasT2 = true;
      var sp5 = worldToScreen(tp5.worldX, tp5.worldY);
      treasureLastPitScreen = { x: sp5.x, y: sp5.y, dia: tp5.radius * W };
      treasureDaily.endlessDrops++;
      treasureDaily.todayTotal = (treasureDaily.todayTotal || 0) + 1;
      try { wx.setStorageSync('zhuzhu_treasure_daily', treasureDaily); } catch(e) {}
      var t3 = ALL_TREASURES.find(function(tr){ return tr.id === tp5.treasureId; });
      if (t3) {
        var isNew = treasureData.found.indexOf(tp5.treasureId) === -1;
        if (isNew) {
          if ((treasureDaily.todayNew || 0) >= 3) {
            duplicateTreasureStash[tp5.treasureId] = (duplicateTreasureStash[tp5.treasureId] || 0) + 1;
            // 不持久化，每局清空
          } else {
            treasureData.found.push(tp5.treasureId);
            treasureData.foundDates[tp5.treasureId] = Date.now();
            treasureData.newFound[tp5.treasureId] = true;
            pendingTreasureCount++;
            try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {}
            treasureDaily.todayNew = (treasureDaily.todayNew || 0) + 1;
            try { wx.setStorageSync('zhuzhu_treasure_daily', treasureDaily); } catch(e) {}
          }
        } else {
          // 已拥有→重复暂存
          duplicateTreasureStash[tp5.treasureId] = (duplicateTreasureStash[tp5.treasureId] || 0) + 1;
          // 不持久化，每局清空
        }
        // 无论新旧，都累积宝箱数和显示动画
        sessionTreasureCount++;
        if (sessionTreasureList.indexOf(tp5.treasureId) === -1) sessionTreasureList.push(tp5.treasureId);
        sessionTreasureCounts[tp5.treasureId] = (sessionTreasureCounts[tp5.treasureId] || 0) + 1;
        if (!quietMode && !treasurePopSkipped) {
          pitTreasureIcon = { x: sp5.x + (sp5.x > W*0.5 ? -1 : 1) * tp5.radius * W * 5, y: sp5.y, dia: tp5.radius * W };
          spawnTreasureParticles(pitTreasureIcon.x, pitTreasureIcon.y);
          treasureWaitingParticles = true;
        }
      }
      tp5.hasTreasure = false;
    }
  }
  // 计算落点（提前算好，宝物光点需要用到）
  var pitCenterX = marble._jumpToX, pitCenterY = marble._jumpToY;
  var pitR3 = tp5 ? tp5.radius : CFG.MARBLE_RADIUS + 0.04;
  var np5 = pits.find(function(p){ return !p.visited && p.worldY > pitCenterY; });
  var angJ = 0;
  if (np5) angJ = Math.atan2(np5.worldX - pitCenterX, np5.worldY - pitCenterY);
  var dstJ = pitR3 + CFG.MARBLE_RADIUS + 0.04;
  marble._landX = pitCenterX + Math.sin(angJ) * dstJ;
  marble._landY = pitCenterY + Math.cos(angJ) * dstJ;
  while (pits.filter(function(p){ return !p.visited; }).length < 4) spawnNextPit();
  while (pits.length > 12) pits.shift();
  markTreasureForNewPits();
  saveAllData();
  if (hasT2 && treasureWaitingParticles) return true;
  // 通关或免打扰下不跳出，直接重生
  if (gameState === STATE.WIN) return true;
  // 接正常跳出动画（SINKING 第三段：从坑中心跳到落点）
  marble._entryX = pitCenterX;
  marble._entryY = pitCenterY;
  marble._jumpTargetPit2 = marble._jumpTargetPit;
  animTimer = 0.35;
  gameState = STATE.SINKING;
  return true;
}

function useForceProp() {
  if (!useProp('force')) return;
  var tp = getCurrentTargetPit();
  if (!tp) return;
  propMagnetActive = true;
  propMagnetPitIndex = tp._index;
}

var magnetParticles = [];
function spawnMagnetParticle() {
  var tp = pits.find(function(p){ return p._index === propMagnetPitIndex; });
  if (!tp) return null;
  var p = worldToScreen(tp.worldX, tp.worldY);
  var angle = Math.random() * Math.PI * 2;
  var dist = 70 + Math.random() * 100;
  var r = 2 + Math.random() * 3;
  return {
    x: p.x + Math.cos(angle) * dist,
    y: p.y + Math.sin(angle) * dist,
    r: r, life: 0.25 + Math.random() * 0.3, age: 0,
    alpha: 0.35 + Math.random() * 0.35,
    targetX: p.x, targetY: p.y,
  };
}
function updateMagnetParticles(dt) {
  if (!propMagnetActive) { magnetParticles = []; return; }
  var tp = pits.find(function(p){ return p._index === propMagnetPitIndex; });
  if (!tp) { propMagnetActive = false; magnetParticles = []; return; }
  // 每帧更新汇聚中心（屏幕坐标会随相机移动）
  var pp = worldToScreen(tp.worldX, tp.worldY);
  if (magnetParticles.length < 30) {
    for (var mi = 0; mi < 3; mi++) magnetParticles.push(spawnMagnetParticle());
  }
  for (var i = magnetParticles.length - 1; i >= 0; i--) {
    var cp = magnetParticles[i];
    cp.age += dt;
    if (cp.age >= cp.life) { magnetParticles.splice(i, 1); continue; }
    cp.targetX = pp.x; cp.targetY = pp.y; // 始终汇聚到坑的当前屏幕位置
    cp.x += (cp.targetX - cp.x) * 7 * dt;
    cp.y += (cp.targetY - cp.y) * 7 * dt;
  }
}
function drawMagnetParticles() {
  for (var i = 0; i < magnetParticles.length; i++) {
    var cp = magnetParticles[i];
    if (!cp || !cp.targetX) continue;
    var t = cp.age / cp.life;
    var fade = (1 - t) * cp.alpha;
    ctx.fillStyle = 'rgba(255,255,255,' + fade + ')';
    ctx.beginPath(); ctx.arc(cp.x, cp.y, cp.r, 0, Math.PI*2); ctx.fill();
  }
}
function drawMagnetEffect() {
  drawMagnetParticles();
}

function awardPropOnTreasure() {
  // 约30%概率出道具，1~2种，每种最多1个
  if (Math.random() > 0.30) return null;
  var types = ['jump','force']; // 宝箱不出复活
  var count = 1 + (Math.random() < 0.4 ? 1 : 0);
  for (var i = types.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = types[i]; types[i] = types[j]; types[j] = tmp;
  }
  var awarded = [];
  for (var k = 0; k < count; k++) {
    var pt = types[k];
    awarded.push(pt);
  }
  saveProps();
  pendingPropType = awarded.length > 0 ? awarded[0] : null;
  pendingPropList = awarded;
  return awarded.length > 0 ? awarded[0] : null;
}

function spawnPropIconParticles(type) {
  if (!type || !pitTreasureIcon) return;
  var propIdx = type === 'heart' ? 0 : (type === 'jump' ? 1 : 2);
  var sz4 = 56;
  var gap4 = (W - sz4 * 3) / 4;
  var tx2 = gap4 + propIdx * (sz4 + gap4) + sz4/2;
  var ty2 = H - 50 - sz4/2;
  var fx = pitTreasureIcon.x, fy = pitTreasureIcon.y;
  for (var i = 0; i < 1; i++) {
    propIconParticles.push({
      x: fx, y: fy, tx: tx2, ty: ty2,
      t: 0, type: type,
      delay: i * 0.12,
      duration: 0.9 + Math.random() * 0.3
    });
  }
}

function updatePropIconParticles(dt) {
  for (var i = propIconParticles.length - 1; i >= 0; i--) {
    var p = propIconParticles[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.t += dt;
    if (p.t >= p.duration) {
      zhuzhuProps[p.type] = (zhuzhuProps[p.type] || 0) + 1;
      sessionProps[p.type] = (sessionProps[p.type] || 0) + 1;
      saveProps();
      propIconParticles.splice(i, 1); continue;
    }
    var t2 = p.t / p.duration;
    p.x = p.x + (p.tx - p.x) * t2 * 0.2;
    p.y = p.y + (p.ty - p.y) * t2 * 0.2;
  }
}

function drawPropIconParticles() {
  var iconKeys = { heart: 'prop_heart', jump: 'prop_jump', force: 'prop_force' };
  for (var i = 0; i < propIconParticles.length; i++) {
    var p = propIconParticles[i];
    if (p.delay > 0) continue;
    var t2 = p.t / p.duration;
    var sc = t2 < 0.5 ? 0.3 + t2/0.5 * 1.2 : 1.5 - (t2-0.5)/0.5 * 0.5;
    var alpha = t2 < 0.2 ? t2/0.2 : (t2 > 0.8 ? (1-t2)/0.2 : 1);
    var ico = uiIcons[iconKeys[p.type]];
    if (ico && ico.width) {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.drawImage(ico, p.x - 28*sc, p.y - 28*sc, 56*sc, 56*sc);
      ctx.restore();
    }
  }
}

// ============================================================
// 宝物掉落系统
// ============================================================
function getSnackPool() {
  // 返回 12 件零食宝物
  return ALL_TREASURES.filter(function(t){ return t.cat === '零食'; });
}

function getLevelTreasures(level) {
  // 生活用品池（10件），按关卡分配
  var lifeItems = ALL_TREASURES.filter(function(t){ return t.cat === '生活用品'; });
  // 第2关起每关1件，第8关2件，第9关2件
  var levelMap = {};
  var idx = 0;
  for (var lv = 2; lv <= 9; lv++) {
    var count = (lv === 8 || lv === 9) ? 2 : 1;
    var ids = [];
    for (var ci = 0; ci < count && idx < lifeItems.length; ci++) {
      ids.push(lifeItems[idx].id);
      idx++;
    }
    levelMap[lv] = ids;
  }
  var ids = levelMap[level] || [];
  return ALL_TREASURES.filter(function(t){ return ids.indexOf(t.id) !== -1; });
}

function starForRare(rare) {
  if (rare === 'N') return 1;
  if (rare === 'R') return 2;
  if (rare === 'SR') return 3;
  if (rare === 'SSR') return 4;
  return 1;
}

function pickTreasureByStar(pool, minStar, maxStar, focusMin, focusMax) {
  // 按星级权重随机选取，focusMin/focusMax 为主力星级
  var weighted = [];
  for (var i = 0; i < pool.length; i++) {
    var t = pool[i];
    var star = starForRare(t.rare);
    if (star < minStar || star > maxStar) continue;
    // 主力星级权重加倍
    var weight = (star >= focusMin && star <= focusMax) ? 3 : 1;
    for (var w = 0; w < weight; w++) weighted.push(t);
  }
  if (weighted.length === 0) return pool[Math.floor(Math.random() * pool.length)];
  return weighted[Math.floor(Math.random() * weighted.length)];
}

function awardTreasure(treasureId, fromX, fromY) {
  var t = ALL_TREASURES.find(function(tr){ return tr.id === treasureId; });
  if (!t) return;
  var alreadyOwned = treasureData.found.indexOf(treasureId) !== -1;
  var dailyLimit = (treasureDaily.todayNew || 0) >= 3;
  var isDuplicate = alreadyOwned || dailyLimit;

  // 暂不累加宝箱数（等光点飞完由 pendingTreasureCount 统一加）
  if (sessionTreasureList.indexOf(treasureId) === -1) sessionTreasureList.push(treasureId);
  sessionTreasureCounts[treasureId] = (sessionTreasureCounts[treasureId] || 0) + 1;

  if (isDuplicate) {
    // 重复宝物也计入宝箱数（直接+1，不走pending）
    sessionTreasureCount++;
    // 重复或超限 → 暂存
    duplicateTreasureStash[t.id] = (duplicateTreasureStash[t.id] || 0) + 1;
    // 不持久化，每局清空
    if (treasureExchanged) treasureExchanged = false; // 新重复出现，恢复兑换提示
  } else {
    // 新宝物入库
    treasureData.found.push(treasureId);
    treasureData.foundDates[treasureId] = Date.now();
    treasureData.newFound[treasureId] = true;
    pendingTreasureCount++;
    try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {}
    treasureDaily.todayNew = (treasureDaily.todayNew || 0) + 1;
    try { wx.setStorageSync('zhuzhu_treasure_daily', treasureDaily); } catch(e) {}
  }

  // 免打扰 / 不再提醒：跳过光点和弹窗，直接完成
  if (quietMode || treasurePopSkipped) {
    sessionTreasureCount += pendingTreasureCount;
    pendingTreasureCount = 0;
    pitTreasureIcon = null;
    treasurePopup = null;
    treasureWaitingParticles = false;
    return;
  }

  // 正常弹窗（新旧宝物都弹）
  playSfx('victory');
  // 坑旁宝箱图标位置：水平方向2倍坑直径，选空间大的一侧
  var ptx = fromX || W/2, pty = fromY || H/2;
  var pitDia = treasureLastPitScreen.dia || 50;
  var side = ptx > W * 0.5 ? -1 : 1;
  pitTreasureIcon = { x: ptx + side * pitDia * 5, y: pty, dia: pitDia };
  treasurePopup = { id: treasureId, imgX: ptx, imgY: pty, animT: 0 };
}

function calcDupHearts() {
  // 每个重复宝物兑换1个爱心
  var total = 0;
  for (var tid in duplicateTreasureStash) {
    if (duplicateTreasureStash[tid]) total += duplicateTreasureStash[tid];
  }
  return total;
}

function countDupItems() {
  var total = 0;
  for (var r in duplicateTreasureStash) {
    if (duplicateTreasureStash[r]) total += duplicateTreasureStash[r];
  }
  return total;
}

function spawnTreasureParticles(fromX, fromY) {
  var tx = treasureTargetIcon.x + treasureTargetIcon.w / 2;
  var ty = treasureTargetIcon.y + treasureTargetIcon.h / 2;
  var sizes = [4, 6, 8];
  for (var i = 0; i < 3; i++) {
    treasureParticles.push({
      x: fromX, y: fromY,
      tx: tx + (Math.random() - 0.5) * 20,
      ty: ty + (Math.random() - 0.5) * 20,
      t: 0, size: sizes[i],
      delay: i * 0.1,
      duration: 0.8 + Math.random() * 0.4
    });
  }
}

function updateTreasureParticles(dt) {
  for (var i = treasureParticles.length - 1; i >= 0; i--) {
    var p = treasureParticles[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.t += dt;
    if (p.t >= p.duration) {
      treasureParticles.splice(i, 1);
      if (pendingTreasureCount > 0) { sessionTreasureCount++; pendingTreasureCount--; }
      continue;
    }
    var t2 = p.t / p.duration;
    var ease = t2 * t2 * (3 - 2 * t2);
    p.x = p.x + (p.tx - p.x) * ease * 0.15;
    p.y = p.y + (p.ty - p.y) * ease * 0.15;
    if (t2 > 0.9) { p.size *= 0.92; }
  }
}

function drawTreasureParticles() {
  for (var i = 0; i < treasureParticles.length; i++) {
    var p = treasureParticles[i];
    if (p.delay > 0) continue;
    var t = p.t / p.duration;
    var breathe = 1 + 0.3 * Math.sin(p.t * 15 + i); // 呼吸感
    // 外发光（柔光扩散）
    ctx.fillStyle = 'rgba(255,220,100,' + (0.12 * breathe) + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3.5 * breathe, 0, Math.PI*2); ctx.fill();
    // 中层光晕
    ctx.fillStyle = 'rgba(255,200,50,' + (0.25 * breathe) + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.2 * breathe, 0, Math.PI*2); ctx.fill();
    // 拖尾
    ctx.fillStyle = 'rgba(255,215,0,0.3)';
    ctx.beginPath(); ctx.arc(p.x + 2, p.y + 2, p.size * 1.5, 0, Math.PI*2); ctx.fill();
    // 主体闪烁
    var alpha = 0.7 + 0.3 * Math.sin(p.t * 12);
    ctx.fillStyle = 'rgba(255,215,0,' + alpha + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(p.x - p.size*0.25, p.y - p.size*0.25, p.size*0.35, 0, Math.PI*2); ctx.fill();
  }
}

function drawTreasureFoundPopup() {
  if (!treasurePopup) return;
  var isPropChest = treasurePopup.id === '_prop_chest';
  var t = isPropChest ? null : ALL_TREASURES.find(function(tr){ return tr.id === treasurePopup.id; });
  if (!isPropChest && !t) { treasurePopup = null; return; }
  // 遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
  // 弹窗（高度自适应）
  var hasProps2 = (typeof pendingPropList !== 'undefined') && pendingPropList && pendingPropList.length > 0;
  var pw = 260;
  // 预估算ph：标题36 + 图片区80 + 道具行(若有80) + 提示20 + 按钮40 + 复选框26 + 底部20
  // 精确估算：标题36 + 图片区(含名称)~165 + 道具行~80 + 提示~20 + 按钮40 + 复选框26 + 底部30
  var estPh = 36 + (isPropChest ? 20 : 165) + (hasProps2 ? 80 : 0) + 20 + 40 + 26 + 30;
  if (estPh < 260) estPh = 260;
  var ph = estPh;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  drawPopupBg3(px, py, pw, ph, 14);
  // 第一行：恭喜
  ctx.fillStyle = '#ED971C'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(isPropChest ? '🎉 恭喜获得道具！' : '🎉 恭喜发现宝物！', W / 2, py + 36);
  // 第二行：宝物图片 + 名称 / 道具图标
  var imgSize = 80;
  var imgX2 = (W - imgSize) / 2;
  var imgY2 = py + 48;
  if (isPropChest) {
    // 道具宝箱：不显示宝物图片，标题与道具间距20px
    imgY2 = py + 56; // 标题py+36 → 道具起点+20
  } else {
    var tImg5 = treasureIcons[t.id];
    if (tImg5 && tImg5.width) {
      ctx.drawImage(tImg5, imgX2, imgY2, imgSize, imgSize);
    } else {
      ctx.fillStyle = '#ddd'; roundRectPath(imgX2, imgY2, imgSize, imgSize, 8); ctx.fill();
      ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.fillText('图片加载中', imgX2 + imgSize/2, imgY2 + imgSize/2 + 5);
    }
    // 宝物名称
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.name, W / 2, imgY2 + imgSize + 20);
  }

  // 道具行（宝物下方，道具宝箱无图片直接用imgY2）
  var nextY = isPropChest ? imgY2 : (imgY2 + imgSize + 36);
  if (hasProps2) {
    var propNames = { heart: '复活', jump: '跳过', force: '强磁' };
    var totalPropW = pendingPropList.length * 76 - 10;
    var propStartX = (W - totalPropW) / 2;
    for (var pi7 = 0; pi7 < pendingPropList.length; pi7++) {
      var pt = pendingPropList[pi7];
      var pico = uiIcons['prop_' + pt];
      var pix = propStartX + pi7 * 76;
      if (pico && pico.width) {
        ctx.drawImage(pico, pix, nextY, 60, 60);
      }
      ctx.fillStyle = '#333';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(propNames[pt] || pt, pix + 30, nextY + 74);
    }
    nextY += 80;
  }
  // 提示行
  ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(hasProps2 ? '宝物可在宝箱内查看，道具马上发放！' : '宝物可在宝箱内查看', W / 2, nextY + 16);
  // 按钮 + 复选框（自适应，提示文字下20px）
  var btnW2 = 140, btnH2 = 40;
  var btnX2 = (W - btnW2) / 2, btnY2 = nextY + 36;
  ctx.fillStyle = '#ED971C'; roundRectPath(btnX2, btnY2, btnW2, btnH2, 20); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif';
  ctx.fillText('继续游戏', W / 2, btnY2 + 28);
  var cbY3 = btnY2 + btnH2 + 10;
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5;
  ctx.strokeRect(W/2 - 55, cbY3, 16, 16);
  if (treasurePopSkipped) {
    ctx.fillStyle = '#ED971C'; ctx.fillRect(W/2 - 52, cbY3 + 3, 10, 10);
  }
  ctx.fillStyle = '#999'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('以后不再提醒', W/2 - 35, cbY3 + 12);
  ph = cbY3 + 16 + 30 - py;
  _treasurePopupBtnY = btnY2;
  _treasurePopupCbY = cbY3;
}

function handleTreasurePopupTouch(tx, ty) {
  if (!treasurePopup) return false;
  // 使用渲染时计算的按钮位置
  var btnW2 = 140, btnH2 = 40;
  var btnX2 = (W - btnW2) / 2, btnY2 = _treasurePopupBtnY || 300;
  var cbY3 = _treasurePopupCbY || 350;
  if (tx > btnX2 && tx < btnX2 + btnW2 && ty > btnY2 && ty < btnY2 + btnH2) {
    // 生成光点（从坑旁宝箱图标飞向右上角）
    var t2 = ALL_TREASURES.find(function(tr){ return tr.id === treasurePopup.id; });
    if (t2 && pitTreasureIcon) spawnTreasureParticles(pitTreasureIcon.x, pitTreasureIcon.y);
    // 道具光点（等弹窗关闭后飞）
    if (pendingPropList.length > 0) {
      for (var ppi = 0; ppi < pendingPropList.length; ppi++) {
        if (pitTreasureIcon) spawnPropIconParticles(pendingPropList[ppi]);
      }
      pendingPropType = null;
      pendingPropList = [];
    } else if (pendingPropType) {
      var pt3 = pendingPropType; pendingPropType = null;
      if (pitTreasureIcon) spawnPropIconParticles(pt3);
    }
    // 清除该宝物的NEW标记（玩家已在弹窗中看过）
    if (treasurePopup.id && treasureData.newFound[treasurePopup.id]) {
      delete treasureData.newFound[treasurePopup.id];
      try { wx.setStorageSync('zhuzhu_treasure', treasureData); } catch(e) {}
    }
    treasurePopup = null;
    // 闯关模式：进入WIN
    if (pendingLevelWin) {
      pendingLevelWin = false;
      gameState = STATE.WIN;
      maxUnlockedLevel = Math.max(maxUnlockedLevel, currentLevel + 1);
      saveAllData();
      if (bgmAudio) bgmAudio.pause();
      playSfx('victory');
    } else {
      // 等待光点飞完再跳出
      treasureWaitingParticles = true;
    }
    return true;
  }
  // 复选框
  var cbY3 = _treasurePopupCbY;
  if (tx > W/2 - 55 && tx < W/2 - 39 && ty > cbY3 && ty < cbY3 + 16) {
    treasurePopSkipped = !treasurePopSkipped;
    try { wx.setStorageSync('zhuzhu_treasure_skip', treasurePopSkipped); } catch(e) {}
    if (treasurePopSkipped) { quietMode = true; try { wx.setStorageSync('zhuzhu_quiet_mode', true); } catch(e) {} }
    return true;
  }
  // 点弹窗外不关闭（必须点按钮）
  return true;
}

function drawTreasureGoConfirm() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var hasFound = sessionTreasureList.length > 0;
  var dupHearts = calcDupHearts();
  var hasDup = dupHearts > 0;
  // 动态弹窗高度：按内容 + 底部20px
  var ph;
  if (!hasFound) ph = 178;
  else if (hasDup && !treasureExchanged) ph = 256;
  else ph = 238;
  var pw = 280;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  drawPopupBg3(px, py, pw, ph, 14);
  ctx.fillStyle = '#222'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('✕', px + pw - 24, py + 36);
  if (hasFound) {
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('当局获得宝物', W / 2, py + 38);
    // 宝物图标+名称（卡片式：20%主色填充 + 40%主色描边）
    var iconSz3 = 44, padX3 = 8, padY3 = 6, nameH = 18;
    var cardW = iconSz3 + padX3 * 2, cardH = iconSz3 + padY3 * 2 + nameH;
    var startX2 = (W - sessionTreasureList.length * (cardW + 10)) / 2;
    for (var si2 = 0; si2 < sessionTreasureList.length; si2++) {
      var st = ALL_TREASURES.find(function(t){ return t.id === sessionTreasureList[si2]; });
      if (!st) continue;
      var six = startX2 + si2 * (cardW + 10);
      var cardY = py + 54;
      ctx.fillStyle = 'rgba(237,151,28,0.20)';
      roundRectPath(six, cardY, cardW, cardH, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(237,151,28,0.40)'; ctx.lineWidth = 1.5;
      roundRectPath(six, cardY, cardW, cardH, 8); ctx.stroke();
      var tImg6 = treasureIcons[st.id];
      if (tImg6 && tImg6.width) ctx.drawImage(tImg6, six + padX3, cardY + padY3, iconSz3, iconSz3);
      // 累加数量（右上角）
      var accCnt = sessionTreasureCounts[st.id] || 0;
      if (accCnt > 0) {
        ctx.beginPath(); ctx.arc(six + cardW - 4, cardY + 4, 12, 0, Math.PI*2);
        ctx.fillStyle = '#E53E3E'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('' + accCnt, six + cardW - 4, cardY + 8);
      }
      ctx.fillStyle = '#555'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(st.name, six + cardW/2, cardY + padY3 + iconSz3 + 14);
    }
    if (hasDup && !treasureExchanged) {
      ctx.fillStyle = '#888'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('您有宝物已经拥有，多余宝物', W/2, py + 148);
      ctx.fillStyle = '#ED971C'; ctx.font = 'bold 13px sans-serif';
      ctx.fillText('可以换成 ' + dupHearts + ' 颗爱心', W/2, py + 168);
      var bw4 = 100, bh4 = 38, by4 = py + ph - 68;
      ctx.fillStyle = '#aaa'; roundRectPath(W/2 - bw4 - 16, by4, bw4, bh4, 19); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText('暂时不换', W/2 - bw4/2 - 16, by4 + 26);
      ctx.fillStyle = '#ED971C'; roundRectPath(W/2 + 16, by4, bw4, bh4, 19); ctx.fill();
      ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText('全部兑换', W/2 + bw4/2 + 16, by4 + 26);
    } else if (treasureExchanged) {
      ctx.fillStyle = '#999'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('多余宝物已兑换' + treasureExchangedHearts + '颗爱心', W/2, py + 150);
      var bw5 = 140, bh5 = 38, by5 = py + ph - 68;
      ctx.fillStyle = '#ED971C'; roundRectPath((W-bw5)/2, by5, bw5, bh5, 19); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('继续游戏', W/2, by5 + 26);
    } else {
      ctx.fillStyle = '#888'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('宝物可在宝箱内查看', W/2, py + 150);
      var bw5 = 140, bh5 = 38, by5 = py + ph - 68;
      ctx.fillStyle = '#ED971C'; roundRectPath((W-bw5)/2, by5, bw5, bh5, 19); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('继续游戏', W/2, by5 + 26);
    }
  } else {
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('当局还没有宝物', W/2, py + 60);
    ctx.fillStyle = '#888'; ctx.font = '13px sans-serif';
    ctx.fillText('继续努力！', W/2, py + 90);
    var bw6 = 140, bh6 = 38, by6 = py + ph - 68;
    ctx.fillStyle = '#ED971C'; roundRectPath((W-bw6)/2, by6, bw6, bh6, 19); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText('继续游戏', W/2, by6 + 26);
  }
}

function handleTreasureGoConfirmTouch(tx, ty) {
  var hasFound = sessionTreasureList.length > 0;
  var dupHearts = calcDupHearts();
  var hasDup = dupHearts > 0;
  var ph;
  if (!hasFound) ph = 178;
  else if (hasDup && !treasureExchanged) ph = 256;
  else ph = 238;
  var pw = 280;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  // 关闭
  if (tx > px + pw - 50 && tx < px + pw && ty > py && ty < py + 50) { treasureGoConfirm = false; return true; }
  if (hasFound && hasDup) {
    var bw4 = 100, bh4 = 38, by4 = py + ph - 68;
    if (tx > W/2 - bw4 - 16 && tx < W/2 - 16 && ty > by4 && ty < by4 + bh4) { treasureGoConfirm = false; return true; }
    if (tx > W/2 + 16 && tx < W/2 + bw4 + 16 && ty > by4 && ty < by4 + bh4) {
      livesData.lives = Math.min(livesData.lives + dupHearts, 99);
      duplicateTreasureStash = {};
      // 不持久化，每局清空
      try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
      treasureGoConfirm = false; return true;
    }
  } else {
    var bw5 = 140, bh5 = 38, by5 = py + ph - 68;
    if (tx > (W-bw5)/2 && tx < (W+bw5)/2 && ty > by5 && ty < by5 + bh5) { treasureGoConfirm = false; return true; }
  }
  if (tx < px || tx > px + pw || ty < py || ty > py + ph) { treasureGoConfirm = false; return true; }
  return true;
}

// ============================================================
// 经典模式 — 开发者声明弹窗
// ============================================================
function drawClassicDisclaimerPopup() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var pw = 290, ph = 370;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  drawPopupBg3(px, py, pw, ph, 14);
  // 标题
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('开发者的话', W / 2, py + 35);
  // 正文
  var lines = [
    '做这个小游戏，是想留住属于',
    '8090这一代人一些美好的童年回忆。',
    '',
    '各地玩法不同，我只能按自己的',
    '记忆先做一版。目前是人机对战，',
    '觉得好玩的话，后面出联机模式～',
    '',
    '有问题有想法，随时告诉我 👇',
  ];
  ctx.fillStyle = '#444'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
  for (var li = 0; li < lines.length; li++) {
    ctx.fillText(lines[li], W / 2, py + 62 + li * 22);
  }
  // 意见反馈入口
  ctx.fillStyle = '#ED971C'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('[ 意见反馈 ]', W / 2, py + 250);
  // 不再提醒（居中）+ 知道了按钮
  var cbY = py + ph - 90;
  var cbStartX = W / 2 - 35;
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5;
  ctx.strokeRect(cbStartX, cbY, 14, 14);
  if (classicDisclaimerSkip) {
    ctx.fillStyle = '#ED971C'; ctx.fillRect(cbStartX + 3, cbY + 3, 8, 8);
  }
  ctx.fillStyle = '#999'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('不再提醒', cbStartX + 18, cbY + 11);
  var btnW3 = 100, btnH3 = 36;
  ctx.fillStyle = '#ED971C'; roundRectPath((W - btnW3) / 2, cbY + 22, btnW3, btnH3, 18); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('知道了', W / 2, cbY + 22 + 24);
}

function handleClassicDisclaimerTouch(tx, ty) {
  var pw = 290, ph = 370;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  var cbY = py + ph - 90;
  var cbStartX = W / 2 - 35;
  // 意见反馈
  if (tx > W/2 - 60 && tx < W/2 + 60 && ty > py + 238 && ty < py + 262) {
    classicDisclaimerPopup = false;
    if (classicDisclaimerSkip) {
      try { wx.setStorageSync('zhuzhu_classic_disclaimer_skip', '1'); } catch(e) {}
    }
    gameState = STATE.FEEDBACK; feedbackText = ''; feedbackContact = ''; feedbackImages = []; feedbackAgree = false; feedbackScrollY2 = 0;
    return true;
  }
  // 不再提醒
  if (tx > cbStartX && tx < cbStartX + 14 && ty > cbY && ty < cbY + 14) {
    classicDisclaimerSkip = !classicDisclaimerSkip;
    return true;
  }
  // 知道了
  var btnW3 = 100, btnH3 = 36;
  if (tx > (W - btnW3) / 2 && tx < (W + btnW3) / 2 && ty > cbY + 22 && ty < cbY + 22 + btnH3) {
    classicDisclaimerPopup = false;
    if (classicDisclaimerSkip) {
      try { wx.setStorageSync('zhuzhu_classic_disclaimer_skip', '1'); } catch(e) {}
    }
    // 进入经典模式
    gameMode = 'classic';
    playSfx('btn');
    try { startClassicGame('ai'); } catch(e) { console.error(e); }
    return true;
  }
  return true;
}

function drawDupExchangePopup() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var pw = 280, ph = 180;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  drawPopupBg3(px, py, pw, ph, 14);
  var dupCount = countDupItems();
  var dupHearts = calcDupHearts();
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('你有 ' + dupCount + ' 个宝物已经拥有', W / 2, py + 33);
  ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
  ctx.fillText('您有宝物已经拥有，多余宝物', W / 2, py + 52);
  ctx.fillStyle = '#ED971C'; ctx.font = 'bold 16px sans-serif';
  ctx.fillText('可以换成 ' + dupHearts + ' 颗爱心', W / 2, py + 72);
  // 各稀有度明细
  ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
  var rareCounts = { N:0, R:0, SR:0, SSR:0 };
  for (var tid in duplicateTreasureStash) {
    var cnt = duplicateTreasureStash[tid];
    if (!cnt) continue;
    var tt = ALL_TREASURES.find(function(tr){ return tr.id === tid; });
    if (tt && rareCounts[tt.rare] !== undefined) rareCounts[tt.rare] += cnt;
  }
  var parts = [];
  if (rareCounts.N) parts.push(rareCounts.N + '×★');
  if (rareCounts.R) parts.push(rareCounts.R + '×★★');
  if (rareCounts.SR) parts.push(rareCounts.SR + '×★★★');
  if (rareCounts.SSR) parts.push(rareCounts.SSR + '×★★★★');
  ctx.fillText(parts.join('  ') || '', W / 2, py + 92);
  // 取消 + 兑换（上移10px）
  var bw = 80, bh = 36, by2 = py + ph - 60;
  ctx.fillStyle = '#aaa'; roundRectPath(W/2 - bw - 14, by2, bw, bh, 18); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('取消', W/2 - bw/2 - 14, by2 + 24);
  ctx.fillStyle = '#ED971C'; roundRectPath(W/2 + 14, by2, bw, bh, 18); ctx.fill();
  ctx.fillText('兑换', W/2 + bw/2 + 14, by2 + 24);
}

function handleDupExchangeTouch(tx, ty) {
  var pw = 280, ph = 180;
  var px = (W - pw) / 2, py = (H - ph) / 2;
  var bw = 80, bh = 36, by2 = py + ph - 60;
  // 取消 → 不兑换，直接结束
  if (tx > W/2 - bw - 14 && tx < W/2 - 14 && ty > by2 && ty < by2 + bh) {
    dupExchangePopup = false;
    gameState = STATE.GAMEOVER; saveAllData();
    return true;
  }
  // 兑换 → 清空暂存，加爱心
  if (tx > W/2 + 14 && tx < W/2 + bw + 14 && ty > by2 && ty < by2 + bh) {
    var hearts = calcDupHearts();
    livesData.lives = Math.min(livesData.lives + hearts, 99);
    treasureExchangedHearts = hearts;
    duplicateTreasureStash = {};
    treasureExchanged = true;
    // 不持久化，每局清空
    try { wx.setStorageSync('zhuzhu_lives', JSON.stringify(livesData)); } catch(e) {}
    dupExchangePopup = false;
    // 返回到空闲状态，玩家可以继续
    gameState = STATE.GAMEOVER; saveAllData();
    return true;
  }
  // 点弹窗外 → 取消
  if (tx < px || tx > px + pw || ty < py || ty > py + ph) {
    dupExchangePopup = false;
    gameState = STATE.GAMEOVER; saveAllData();
    return true;
  }
  return true;
}

function checkEndlessTreasureDrop(pitCount) {
  // 检查当前坑是否已标记宝物
  var targetPit3 = pits.find(function(p){ return p._index === currentPitIndex; });
  if (targetPit3 && targetPit3.hasTreasure && targetPit3.treasureId) {
    treasureDaily.endlessDrops++;
    treasureDaily.todayTotal = (treasureDaily.todayTotal || 0) + 1;
    try { wx.setStorageSync('zhuzhu_treasure_daily', treasureDaily); } catch(e) {}
    awardTreasure(targetPit3.treasureId, treasureLastPitScreen.x, treasureLastPitScreen.y);
    var pt = awardPropOnTreasure();
    targetPit3.hasTreasure = false;
    // 免打扰/不再提醒：直接触发重生，不等待弹窗或光点
    if (quietMode || treasurePopSkipped) {
      // 免打扰：直接加道具，不走粒子动画
      if (pendingPropList && pendingPropList.length > 0) {
        for (var _ppi = 0; _ppi < pendingPropList.length; _ppi++) {
          zhuzhuProps[pendingPropList[_ppi]] = (zhuzhuProps[pendingPropList[_ppi]] || 0) + 1;
          sessionProps[pendingPropList[_ppi]] = (sessionProps[pendingPropList[_ppi]] || 0) + 1;
        }
        saveProps();
        pendingPropList = [];
        pendingPropType = null;
      }
      // 补上重生动画需要的起跳位置
      if (marble._jumpFromX === undefined) {
        marble._jumpFromX = marble.worldX;
        marble._jumpFromY = marble.worldY;
      }
      if (marble._landX === undefined) {
        marble._landX = marble.worldX;
        marble._landY = marble.worldY + 0.1;
      }
      gameState = STATE.RESPAWN;
      animTimer = 0;
      playSfx('luo');
    }
    return;
  }
}

// 提前标记哪些坑有宝物（供渲染使用）
var treasureFirstPitIndex = 0; // 本局第一个坑的_index，用于计算坑序号
var treasureNextPitSeq = 0;     // 下一个宝箱坑的序号（无尽模式）
var levelTreasureSeq = 0;       // 闯关模式宝箱坑序号
var levelTreasureId = '';       // 闯关模式宝箱宝物ID
var levelChestsPlaced = 0;      // 本关已放宝箱数（防重复）
var levelTreasureChestNum = 0;  // 第几个宝箱是宝物（随机）
var levelChestSeq = [];         // 预计算的宝箱坑序号
var endlessPool3 = [];          // 无尽模式每局3种宝物池
var endlessChestsPlaced = 0;    // 无尽模式本局已放宝箱数
var endlessTypesRevealed = {};  // 无尽模式本局已出现的宝物类型

// 友情图片
var friendImages = [];          // 预加载的友情图片数组
var friendImgNextSeq = 5;       // 下一个友情图片坑序号

function loadFriendImages() {
  var img = wx.createImage();
  img.onload = function() { friendImages.push(img); };
  img.src = 'assets/images/friends/friend1.png';
}

function markFriendImgsForNewPits() {
  if (!friendImages.length) return;
  if (gameMode !== 'endless' && gameMode !== 'levels') return;
  for (var pi = 0; pi < pits.length; pi++) {
    var pit = pits[pi];
    if (pit.hasTreasure || pit.hasFriendImg) continue;
    var virtualSeq = pit._index - treasureFirstPitIndex + 1;
    if (virtualSeq >= friendImgNextSeq && !pit.hasTreasure) {
      pit.hasFriendImg = true;
      pit.friendImgIdx = Math.floor(Math.random() * friendImages.length);
      // 下一个友情图片在 8~12 个坑后
      friendImgNextSeq = virtualSeq + 8 + Math.floor(Math.random() * 5);
    }
  }
}

function markTreasureForNewPits() {
  var LEVEL_CHEST_COUNTS = [0, 1, 2, 3, 4, 5, 8, 9, 12, 20];
  // 无尽模式：每局随机3种宝物，上限10个宝箱
  if (gameMode === 'endless') {
    var snackPool = getSnackPool();
    if (!snackPool || snackPool.length === 0) return;
    // 本局首次：随机选3种宝物
    if (!endlessPool3.length) {
      var shuffled = snackPool.slice();
      for (var si = shuffled.length - 1; si > 0; si--) {
        var rj = Math.floor(Math.random() * (si + 1));
        var tmp = shuffled[si]; shuffled[si] = shuffled[rj]; shuffled[rj] = tmp;
      }
      endlessPool3 = shuffled.slice(0, 3);
    }
    for (var pi = 0; pi < pits.length; pi++) {
      var pit = pits[pi];
      if (pit.hasTreasure) continue;
      if (endlessChestsPlaced >= 10) return;
      var virtualSeq = pit._index - treasureFirstPitIndex + 1;
      if (virtualSeq >= treasureNextPitSeq) {
        pit.hasTreasure = true;
        endlessChestsPlaced++;
        // 从3种中选：优先已出现过的类型，新类型不超过1种/天
        var pool3 = endlessPool3;
        var todayNew = treasureDaily.todayNew || 0;
        var avail3 = pool3.filter(function(t){ return treasureData.found.indexOf(t.id) === -1; });
        var revealed3 = pool3.filter(function(t){ return endlessTypesRevealed[t.id]; });
        var pick;
        if (todayNew < 1 && avail3.length > 0) {
          // 还有每日新宝物额度，且3种中有未拥有的
          pick = avail3[Math.floor(Math.random() * avail3.length)];
        } else if (revealed3.length > 0) {
          // 优先出已出现过的类型
          pick = revealed3[Math.floor(Math.random() * revealed3.length)];
        } else {
          pick = pool3[Math.floor(Math.random() * pool3.length)];
        }
        endlessTypesRevealed[pick.id] = true;
        pit.treasureId = pick.id;
        if (virtualSeq < 20) {
          treasureNextPitSeq = virtualSeq + 8 + Math.floor(Math.random() * 8);
        } else {
          treasureNextPitSeq = virtualSeq + 18 + Math.floor(Math.random() * 8);
        }
      }
    }
  }
  // 闯关模式：关卡专属宝物+道具宝箱
  else if (gameMode === 'levels') {
    var lvl = currentLevel;
    var maxChests = LEVEL_CHEST_COUNTS[lvl] || 0;
    if (maxChests <= 0) return;
    var levelPool = lvl >= 2 ? getLevelTreasures(lvl) : [];
    if (levelChestsPlaced >= maxChests) return;
    var targetMax = (LEVEL_TARGETS[lvl] || 10) - 2;
    if (targetMax < 3) targetMax = 3;
    // 首次：预定每个宝箱的目标坑序号（均匀散布）
    if (!levelTreasureSeq) {
      levelTreasureSeq = 1;
      levelChestSeq = [];
      var minGap = 4;
      var chestRange = targetMax - minGap;
      for (var ci = 0; ci < maxChests; ci++) {
        var slot = Math.floor((ci + 1) * chestRange / (maxChests + 1)) + minGap;
        slot += Math.floor(Math.random() * 5) - 2; // ±2 随机抖动
        if (slot < minGap) slot = minGap;
        if (slot > targetMax) slot = targetMax;
        levelChestSeq.push(slot);
      }
      levelChestSeq.sort(function(a,b){ return a - b; });
      levelTreasureChestNum = 1 + Math.floor(Math.random() * maxChests);
    }
    // 收集范围内未标记的可选坑
    var candPits = [];
    for (var pj = 0; pj < pits.length; pj++) {
      var ppit = pits[pj];
      if (ppit.visited || ppit.hasTreasure || ppit._levelMarked) continue;
      var vSeq = ppit._index - treasureFirstPitIndex + 1;
      if (vSeq >= levelTreasureSeq && vSeq <= targetMax) {
        candPits.push(ppit);
      }
    }
    // 将未放的宝箱均匀分布在可选坑中
    if (candPits.length > 0 && levelChestsPlaced < maxChests) {
      for (var ci = 0; ci < candPits.length && levelChestsPlaced < maxChests; ci++) {
        var cp = candPits[ci];
        var cvSeq = cp._index - treasureFirstPitIndex + 1;
        if (cvSeq >= levelChestSeq[levelChestsPlaced]) {
          cp.hasTreasure = true;
          cp._levelMarked = true;
          levelChestsPlaced++;
          var giveTreasure = (lvl >= 2 && levelPool.length > 0 && levelChestsPlaced === levelTreasureChestNum);
          if (giveTreasure) {
            cp.treasureId = levelPool[Math.floor(Math.random() * levelPool.length)].id;
            cp._levelIsProp = false;
          } else {
            var pidx = Math.floor(Math.random() * 2);
            cp._levelProps = [['jump','force'][pidx]];
            cp._levelIsProp = true;
          }
        }
      }
      levelTreasureSeq = (candPits[candPits.length-1]._index - treasureFirstPitIndex + 1) + 1;
    }
  }
  markFriendImgsForNewPits();
}

// 闯关模式：检查当前坑是否有宝箱
function checkLevelTreasureDropPit() {
  var targetPit = pits.find(function(p){ return p._index === currentPitIndex; });
  if (!targetPit || !targetPit.hasTreasure) return;
  if (targetPit._levelIsProp) {
    // 道具宝箱（道具等粒子飞到才加）
    var props = targetPit._levelProps || [];
    sessionTreasureCount++;
    if (!quietMode && !treasurePopSkipped) {
      pendingPropList = props;
      pendingPropType = props[0] || null;
      playSfx('victory');
      // 光点和宝箱图标动画（同无尽模式）
      var ptx3 = treasureLastPitScreen.x, pty3 = treasureLastPitScreen.y;
      var pitDia3 = treasureLastPitScreen.dia || 50;
      var side3 = ptx3 > W * 0.5 ? -1 : 1;
      pitTreasureIcon = { x: ptx3 + side3 * pitDia3 * 5, y: pty3, dia: pitDia3 };
      spawnTreasureParticles(pitTreasureIcon.x, pitTreasureIcon.y);
      treasurePopup = { id: '_prop_chest', imgX: ptx3, imgY: pty3, animT: 0 };
    } else {
      // 免打扰：直接加道具，不走粒子动画
      for (var _ppi2 = 0; _ppi2 < props.length; _ppi2++) {
        zhuzhuProps[props[_ppi2]] = (zhuzhuProps[props[_ppi2]] || 0) + 1;
        sessionProps[props[_ppi2]] = (sessionProps[props[_ppi2]] || 0) + 1;
      }
      saveProps();
      pendingPropList = [];
      pendingPropType = null;
      playSfx('luo');
    }
  } else if (targetPit.treasureId) {
    // 宝物宝箱
    treasureDaily.todayLevel = (treasureDaily.todayLevel || 0) + 1;
    treasureDaily.todayTotal = (treasureDaily.todayTotal || 0) + 1;
    try { wx.setStorageSync('zhuzhu_treasure_daily', treasureDaily); } catch(e) {}
    awardTreasure(targetPit.treasureId, treasureLastPitScreen.x, treasureLastPitScreen.y);
    awardPropOnTreasure();
    // 免打扰：宝物宝箱附带的道具直接加，不走粒子动画
    if ((quietMode || treasurePopSkipped) && pendingPropList && pendingPropList.length > 0) {
      for (var _ppi3 = 0; _ppi3 < pendingPropList.length; _ppi3++) {
        zhuzhuProps[pendingPropList[_ppi3]] = (zhuzhuProps[pendingPropList[_ppi3]] || 0) + 1;
        sessionProps[pendingPropList[_ppi3]] = (sessionProps[pendingPropList[_ppi3]] || 0) + 1;
      }
      saveProps();
      pendingPropList = [];
      pendingPropType = null;
    }
  }
  targetPit.hasTreasure = false;
}

// 免打扰模式切换
function toggleQuietMode() {
  quietMode = !quietMode;
  if (!quietMode) { treasurePopSkipped = false; try { wx.setStorageSync('zhuzhu_treasure_skip', false); } catch(e) {} }
  try { wx.setStorageSync('zhuzhu_quiet_mode', quietMode); } catch(e) {}
}

var levelSelScrollY = 0;
var levelSelTouchY = 0;
var levelSelDragging = false;

// 关卡选择弹窗
function drawLevelSelPopup() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
  var cw = W * 0.88, ch = H * 0.48;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  drawPopupBg3(cx, cy, cw, ch, 14);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('选择关卡', W / 2, cy + 35);
  ctx.fillStyle = '#222'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('✕', cx + cw - 24, cy + 40);

  var cardH = 68, gap = 8;
  var listY = cy + 55, listH = ch - 70;
  ctx.save(); ctx.beginPath(); ctx.rect(cx + 10, listY, cw - 20, listH); ctx.clip();
  for (var li = 1; li <= 9; li++) {
    var ly = listY + (li - 1) * (cardH + gap) + levelSelScrollY;
    if (ly + cardH < listY || ly > listY + listH) continue;
    var unlocked2 = li <= maxUnlockedLevel;
    var sceneId = LEVEL_SCENES[li];
    var scImg = storySceneImages[li] || getStorySceneImg(li);

    ctx.save();
    roundRectPath(cx + 24, ly, cw - 48, cardH, 10); ctx.clip();
    // 场景背景图
    if (scImg && scImg.width) {
      var iw6 = scImg.width, ih6 = scImg.height;
      var sc6 = Math.max((cw-48) / iw6, cardH / ih6);
      ctx.drawImage(scImg, cx + 24 + ((cw-48) - iw6*sc6)/2, ly + (cardH - ih6*sc6)/2, iw6*sc6, ih6*sc6);
    }
    // 暗色叠加
    ctx.fillStyle = unlocked2 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(cx + 24, ly, cw - 48, cardH);
    ctx.restore();

    // 边框
    if (li === currentLevel) {
      ctx.strokeStyle = '#ED971C'; ctx.lineWidth = 2.5;
      roundRectPath(cx + 24, ly, cw - 48, cardH, 10); ctx.stroke();
    }

    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('第' + li + '关', cx + 38, ly + 32);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(LEVEL_NAMES[li], cx + 38, ly + 52);
    if (!unlocked2) {
      ctx.fillStyle = '#ccc'; ctx.font = '16px sans-serif'; ctx.textAlign = 'right';
      if (uiIcons.lock && uiIcons.lock.width) { ctx.drawImage(uiIcons.lock, cx + cw - 60, ly + 22, 20, 20); }
    } else if (li === currentLevel) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('当前 ●', cx + cw - 36, ly + 44);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('进入 →', cx + cw - 36, ly + 44);
    }
  }
  ctx.restore();
}

function handleLevelSelTouch(tx, ty) {
  var cw = W * 0.88, ch = H * 0.48;
  var cx = (W - cw) / 2, cy = (H - ch) / 2;
  if (tx > cx + cw - 55 && tx < cx + cw && ty > cy && ty < cy + 55) { gameState = STATE.IDLE; levelSelScrollY = 0; return; }
  var cardH = 68, gap = 8;
  var listY = cy + 55;
  for (var li = 1; li <= 9; li++) {
    var ly = listY + (li - 1) * (cardH + gap) + levelSelScrollY;
    if (tx > cx + cw - 80 && tx < cx + cw - 10 && ty > ly && ty < ly + cardH) {
      if (!levelSelDragging && li <= maxUnlockedLevel && li !== currentLevel) {
        currentLevel = li; switchScene(LEVEL_SCENES[li] || 'grandma_backyard');
        levelTreasureSeq = 0; levelChestsPlaced = 0; levelTreasureChestNum = 0; levelChestSeq = [];
        pits = []; currentPitIndex = 0; pitIdCounter = 0;
        var rr = CFG.PIT_RADIUS_MIN;
        var introEndY3 = -CFG.MARBLE_RADIUS;
        spawnPitAt(0.58+Math.random()*0.08, introEndY3 + rr * 2 * (3 + Math.random() * 1), rr);
        for (var j3=0; j3<3; j3++) spawnNextPit();
        marble.worldX=0.5; marble.worldY=-CFG.MARBLE_RADIUS;
        marble.vx=0; marble.vy=0; marble.rotation=0; marble.scale=1;
        score=0; comboCount=0; gameState=STATE.INTRO; animTimer = 0; levelSelScrollY=0;
      }
      return;
    }
  }
}

function handleLevelSelMove(tx, ty) {
  levelSelDragging = true;
  levelSelScrollY += (ty - levelSelTouchY) * 0.7;
  levelSelTouchY = ty;
  var maxL = 0, minL = -(9 * 76 - (H * 0.48 - 70));
  if (minL > 0) minL = 0;
  if (levelSelScrollY > maxL) levelSelScrollY = maxL;
  if (levelSelScrollY < minL) levelSelScrollY = minL;
}

function init() {
  try {
    console.log('[Init] 游戏启动...');
    loadAllData();
    resetLivesIfNewDay();
    loadCheckinData();
    // 启动时同步签到天数到登录天数（陪伴勋章依赖）
    if (checkinData.days && checkinData.days.length > (progress.loginDays || 0)) {
      progress.loginDays = checkinData.days.length;
      saveAllData();
    }
    loadUserProfile();
    // 开放数据域（好友排行）
    try {
      openDataContext = wx.getOpenDataContext();
      var sc2 = openDataContext.canvas;
      sc2.width = 320; sc2.height = 400;
    } catch(e) {}
    try { var sb = wx.getStorageSync('zhuzhu_seen_badges'); if (sb) seenBadges = sb; } catch(e) {}
    try { var sm = wx.getStorageSync('zhuzhu_seen_marbles'); if (sm) seenMarbles = sm; } catch(e) {}
    try { var ss = wx.getStorageSync('zhuzhu_seen_scenes'); if (ss) seenScenes = ss; } catch(e) {}
    try { var bd3 = wx.getStorageSync('zhuzhu_badge_dates'); if (bd3) badgeDates = bd3; } catch(e) {}
    try { var td2 = wx.getStorageSync('zhuzhu_treasure'); if (td2) treasureData = td2; } catch(e) {}
    try { var tdy = wx.getStorageSync('zhuzhu_treasure_daily'); if (tdy) treasureDaily = tdy; } catch(e) {}
    try { var tlp = wx.getStorageSync('zhuzhu_treasure_level_prob'); if (tlp) treasureLevelProb = tlp; } catch(e) {}
    try { var qm = wx.getStorageSync('zhuzhu_quiet_mode'); if (qm !== undefined && qm !== '') quietMode = !!qm; } catch(e) {}
    try { var tsk = wx.getStorageSync('zhuzhu_treasure_skip'); if (tsk !== undefined && tsk !== '') treasurePopSkipped = !!tsk; } catch(e) {}
    try { var cdSkip = wx.getStorageSync('zhuzhu_classic_disclaimer_skip'); if (cdSkip === '1') classicDisclaimerSkip = true; } catch(e) {}
    // 重复宝物暂存每局清空，不从存储加载
    try { var pp = wx.getStorageSync('zhuzhu_props'); if (pp) zhuzhuProps = pp; } catch(e) {}
    try { var fpg = wx.getStorageSync('zhuzhu_free_props_given'); if (fpg === 'true') freePropsGivenToday = true; } catch(e) {}
    if (!treasureData.foundDates) treasureData.foundDates = {};
    if (!treasureData.newFound) treasureData.newFound = {};
    // 修复不一致数据：foundDates有但found没有的补上
    for (var fid2 in treasureData.foundDates) {
      if (treasureData.found.indexOf(fid2) === -1) treasureData.found.push(fid2);
    }
    // 启用分享
    try {
      wx.showShareMenu({ withShareTicket: false });
    } catch(e) {}
    wx.onShareAppMessage(function() {
      return { title: '快来吐槽一下这玻璃珠游戏吧~', imageUrl: 'assets/images/ui/sharepic.jpg' };
    });
    // 反馈键盘输入
    wx.onKeyboardInput(function(res) {
      if (feedbackFocus === 'text') feedbackText = res.value;
      else if (feedbackFocus === 'contact') feedbackContact = res.value;
    });
    wx.onKeyboardConfirm(function() { wx.hideKeyboard(); feedbackFocus = ''; });
    wx.onKeyboardComplete(function() { feedbackFocus = ''; });
    preloadSfx();
    initBGM();
    console.log('[Init] 存档加载完成 lives:', livesData.lives);

    // 创建缓存
    createMarbleCache();
    loadBgImage();
    loadPitImage();
    loadBackImage();
    loadIcon('heart', 'assets/images/ui/heart.png');
    loadIcon('flower', 'assets/images/ui/flower.png');
    loadIcon('set', 'assets/images/ui/set.png');
    loadIcon('achievement', 'assets/images/ui/achievement.png');
    loadIcon('lock', 'assets/images/ui/lock.png');
    loadIcon('star', 'assets/images/ui/star.png');
    loadIcon('gift', 'assets/images/ui/gift.png');
    loadIcon('tbox', 'assets/images/ui/tbox.png');
    loadIcon('tboxs', 'assets/images/ui/tboxs.png');
    loadIcon('dia', 'assets/images/ui/dia.png');
    loadIcon('flower', 'assets/images/ui/flower.png');
    loadIcon('box', 'assets/images/ui/box.png');
    loadIcon('share', 'assets/images/ui/share.png');
    loadIcon('chickin', 'assets/images/ui/chickin.png');
    loadIcon('story', 'assets/images/ui/story.png');
    loadIcon('rank', 'assets/images/ui/rank.png');
    loadIcon('skin', 'assets/images/ui/skin.png');
    loadIcon('home', 'assets/images/ui/home.png');
    loadIcon('title', 'assets/images/ui/title.png');
    loadIcon('slogan', 'assets/images/ui/slogan.png');
    loadIcon('wu', 'assets/images/ui/wu.png');
    loadIcon('chuang', 'assets/images/ui/chuang.png');
    loadIcon('jing', 'assets/images/ui/jing.png');
    loadIcon('open', 'assets/images/ui/open.png');
    loadIcon('close', 'assets/images/ui/close.png');
    loadIcon('chose', 'assets/images/ui/chose.png');
    loadIcon('prop_heart', 'assets/images/ui/prop_heart.png');
    loadIcon('prop_jump', 'assets/images/ui/prop_jump.png');
    loadIcon('prop_force', 'assets/images/ui/prop_force.png');
    loadIcon('plus', 'assets/images/ui/plus.png');
    loadIcon('powerbtn', 'assets/images/ui/powerbtn.png');
    loadIcon('direct', 'assets/images/ui/direct.png');
    loadIcon('di_avatar', 'assets/images/ui/di.jpg');
    loadIcon('avatar_default', 'assets/images/ui/avatar.jpg');
    loadIcon('me', 'assets/images/ui/me.png');
    loadIcon('compus', 'assets/images/ui/compus.png');
    loadIcon('keng8', _scenePath('keng8.png') + 'keng8.png');
    loadFriendImages();
    // 按钮背景
    { const img = wx.createImage(); img.onload = function(){ btnBg1 = img; }; img.src = _scenePath('btnbg1.jpg') + 'btnbg1.jpg'; }
    { const img = wx.createImage(); img.onload = function(){ btnBg2 = img; }; img.src = _scenePath('btnbg2.jpg') + 'btnbg2.jpg'; }
    { const img = wx.createImage(); img.onload = function(){ btnBg3 = img; }; img.src = _scenePath('btnbg3.jpg') + 'btnbg3.jpg'; }
    { const img = wx.createImage(); img.onload = function(){ bguImg = img; }; img.src = _scenePath('bgu.png') + 'bgu.png'; }
    { const img = wx.createImage(); img.onload = function(){ bgmImg = img; }; img.src = _scenePath('bgm.png') + 'bgm.png'; }
    { const img = wx.createImage(); img.onload = function(){ bgbImg = img; }; img.src = _scenePath('bgb.png') + 'bgb.png'; }
    // 预加载经典模式背景
    { var cbg = wx.createImage(); cbg.onload = function(){ classicBgImg = cbg; }; cbg.src = 'assets/images/scenes/classic.jpg'; }
    // 子包加载后2秒预加载宝物/勋章
    var _preloadSubAssets = function() {
      ALL_TREASURES.forEach(function(t2) {
        try { var timg = wx.createImage(); timg.onload = function() { treasureIcons[t2.id] = timg; }; timg.src = 'subpkg_assets/assets/images/treasures/' + t2.id + '.png'; } catch(e) {}
      });
      ['beginner','player','enthusiast','expert','master','legend','sharpshooter','unstoppable','collector8','traveler6','loyal30','oldfriend'].forEach(function(tid) {
        try { var img = wx.createImage(); img.onload = function() { titleIcons[tid] = img; }; img.src = 'subpkg_assets/assets/images/badges/title_' + tid + '.png'; } catch(e) {}
      });
      ['first_pit','five_pits','twenty_pits','fifty_pits','hundred_pits','five_hundred','thousand_pits','combo_2','combo_3','combo_5','combo_10','combo_20','combo_35','combo_50','login_1','login_3','login_7','login_15','login_30','login_100','login_365','skin_3','skin_6','skin_9','skin_12','scene_3','scene_6','scene_9'].forEach(function(bid) {
        try { var img = wx.createImage(); img.onload = function() { badgeIcons[bid] = img; }; img.src = 'subpkg_assets/assets/images/badges/badge_' + bid + '.png'; } catch(e) {}
      });
    };
    try { wx.loadSubpackage({ name: 'assets' }).then(function() { setTimeout(_preloadSubAssets, 2000); }).catch(function() { setTimeout(_preloadSubAssets, 3000); }); } catch(e) { setTimeout(_preloadSubAssets, 2000); }
    // 预加载所有珠珠皮肤
    MARBLE_SKINS.forEach(function(s) {
      try {
        var img = wx.createImage();
        img.onload = function() { marbleSkinCache[s.id] = img; };
        img.src = 'assets/images/marbles/' + s.id + '.png';
      } catch(e) { console.warn('[Init] Marble img fail:', s.id, e.message); }
    });
    // 预加载所有皮肤独立平铺纹理
    MARBLE_SKINS.forEach(function(s) {
      try {
        var tImg = wx.createImage();
        tImg.onload = function() { marbleTilingCache[s.id] = tImg; };
        tImg.src = 'assets/images/marbles/' + s.id + '0.png';
      } catch(e) { console.warn('[Init] Tiling img fail:', s.id, e.message); }
    });
    // 场景缩略图按需加载（减少启动内存）
    console.log('[Init] 纹理缓存完成');

    // 初始相机
    camera.worldX = -0.5;
    camera.worldY = 0;
    camera.targetX = -0.5;
    camera.targetY = 0;

    // 主页飘浮珠珠
    initHomeMarbles();


    // 启动循环
    lastTime = Date.now();
    loop();
    console.log('[Init] 启动成功');
  } catch(e) {
    // 如果 init 阶段崩溃，直接画错误信息到 canvas
    console.error('[Init] CRASH: ' + e.message + ' @ ' + (e.lineNumber || '?'));
    try {
      ctx.fillStyle = '#8B0000'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
      var em = e.message || '';
      if (em.length > 40) em = em.substring(0, 40) + '...';
      ctx.fillText('Init Error: ' + em, 20, 50);
      ctx.fillText('Line: ' + (e.lineNumber || '?'), 20, 70);
      ctx.fillText('Please clear cache & restart', 20, 90);
      ctx.fillText('请清除缓存后重启游戏', 20, 120);
    } catch(e2) { /* 画布也挂了，放弃 */ }
    // 弹窗提示用户
    try { wx.showModal({ title: '启动失败', content: '请清除小程序缓存后重新进入\n\n错误: ' + (e.message || '').substring(0, 80), showCancel: false }); } catch(e3) {}
    // 即使 init 崩溃也尝试启动循环（至少能运行错误处理）
    try { lastTime = Date.now(); loop(); } catch(e4) {}
  }
}

// 自定义圆角矩形路径（避免微信 roundRect 参数格式不兼容）
function roundRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
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

// 应用分享奖励
function applyShareReward() {
  saveAllData();
  shareRewardHeart = { x: W/2, y: H/2, tx: W - 52, ty: H * 0.15 - 8, t: 0, duration: 1.5 };
  // 游戏中则恢复到最后一个经过的坑位
  if (gameState !== STATE.HOME && pits.length > 0) {
    var vp3 = pits.filter(function(p){ return p.visited; });
    var lp3 = vp3.length > 0 ? vp3.reduce(function(a,b){ return a._index > b._index ? a : b; }) : null;
    if (lp3) {
      var np3 = pits.find(function(p){ return !p.visited; });
      var a3 = 0;
      if (np3) a3 = Math.atan2(np3.worldX - lp3.worldX, np3.worldY - lp3.worldY);
      var d3 = lp3.radius + CFG.MARBLE_RADIUS + 0.04;
      marble.worldX = lp3.worldX + Math.sin(a3) * d3;
      marble.worldY = lp3.worldY + Math.cos(a3) * d3;
    } else {
      marble.worldX = 0.5; marble.worldY = -CFG.MARBLE_RADIUS;
    }
    marble.vx = 0; marble.vy = 0; marble.scale = 1;
    marble._rollingBack = false;
    comboCount = 0;
    gameState = STATE.IDLE;
    camera.targetY = marble.worldY - CFG.CAMERA_OFFSET;
  }
}

// 监听生命周期
wx.onShow((res) => {
  lastTime = Date.now();
  // 恢复爱心
  resetLivesIfNewDay();
  // 道具获取分享奖励（指定道具）
  if (propSharePending) {
    propSharePending = false;
    propGetPopup = false;
    var pt2 = pendingPropShareType || 'heart';
    pendingPropShareType = '';
    zhuzhuProps[pt2] = (zhuzhuProps[pt2] || 0) + 1;
    sessionProps[pt2] = (sessionProps[pt2] || 0) + 1; // 当局也可用
    saveProps();
    return;
  }
  // 游戏结束/首页分享奖励（分享即成功，不再需要云端验证）
  if (justShared) {
    justShared = false;
    var elapsed = Date.now() - shareTimestamp;
    // 离开时间太短（<1秒）→ 没有真实分享
    if (elapsed < 1000) {
      wx.showToast({ title: '请完成分享后再返回', icon: 'none', duration: 2000 });
      return;
    }
    applyShareReward();
  }
});

wx.onHide(() => {
  saveAllData();
});

init();
