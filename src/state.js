// ============================================================
// 珠珠快跑 — 全局可变状态
// 所有模块通过 import { S } from '../state.js' 访问
// ============================================================

export const S = {};

// === Canvas / 屏幕 ===
S.canvas = null;
S.ctx = null;
S.sysInfo = null;
S.dpr = 1;
S.screenW = 375;
S.screenH = 667;
S.SCALE = 1;
S.W = 375;
S.H = 667;
S.capsuleRect = null;

// === 游戏主状态 ===
S.gameState = '';  // 初始值由 init() 设置
S.gameMode = 'endless';
S.currentLevel = 1;
S.maxUnlockedLevel = 1;
S.openDataContext = null;

// === 经典模式 ===
S.classicData = null;
S.classicShowModeSelect = false;
S.classicDisclaimerPopup = false;
S.classicDisclaimerSkip = false;

// === 用户信息 ===
S.userProfile = { nickname: '', avatar: '' };
S._userInfoBtn = null;
S._authInProgress = false;

// === 游戏核心 ===
S.chargePower = 0;
S.score = 0;
S.bestScore = 0;
S.comboCount = 0;
S.animTimer = 0;

// === 游戏进度 ===
S.progress = {
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
  unlockedTitles: ['beginner'],
  equippedTitle: '初来乍到',
};

// === 体力 ===
S.livesData = { lives: 3, lastResetDate: '', sharesToday: 0, adsToday: 0 };

// === 世界实体 ===
S.marble = {
  worldX: 0.5, worldY: 0,
  vx: 0, vy: 0,
  radius: 0.045,
  rotation: 0,
  texOffX: 0, texOffY: 0,
  scale: 1, alpha: 1,
};
S.pits = [];
S.currentPitIndex = 0;
S.pitIdCounter = 0;
S.camera = { worldY: 0, targetY: 0 };

// === 输入状态 ===
S.btnPressed = false;
S.touchId = null;
S.chargeStartTime = 0;
S.chargeDir = 0;
S.floatingHearts = [];

// === 纹理缓存 ===
S.marbleCache = null;
S.bgImage = null;
S.pitImage = null;
S.backImage = null;
S.classicBgImg = null;
S.currentScene = 'grandma_backyard';
S.btnBg1 = null; S.btnBg2 = null; S.btnBg3 = null;
S.bguImg = null; S.bgmImg = null; S.bgbImg = null;
S.marbleSkinCache = {};
S.marbleTilingCache = {};
S.uiIcons = {};

// === 音频 ===
S.bgmAudio = null;
S.musicOn = true;
S.musicVolume = 0.35;
S.sfxOn = true;
S.sfxPool = {};

// === 皮肤 ===
S.skinTab = 0;
S.skinScrollY = 0;

// === 勋章 ===
S.badgeTab = 0;
S.badgeScrollY = 0;
S.badgeDates = {};

// === 排行 ===
S.rankTab = 0;
S.rankScrollY = 0;
S.rankData = [];
S.rankMyScore = 0;
S.rankMyRank = null;
S.rankTotalPlayers = 0;

// === 宝物 ===
S.treasureData = { found: [], viewed: [], newFound: {}, foundDates: {} };
S.treasureTab = 0;
S.treasureDetailIdx = -1;
S.treasureScrollY = 0;
S.treasureDaily = { date: '', endlessDrops: 0, endlessPitSeg: 0, todayNew: 0, todayTotal: 0, todayLevel: 0 };
S.treasureLevelProb = {};
S.quietMode = false;
S.treasurePopup = null;
S.treasureParticles = [];
S.treasurePopSkipped = false;
S._treasurePopupBtnY = 300;
S._treasurePopupCbY = 350;
S.treasureWaitingParticles = false;
S.pendingTreasureCount = 0;
S.pitTreasureIcon = null;
S.justShared = false;
S.shareTimestamp = 0;
S.shareRewardHeart = null;
S.treasureTargetIcon = { x: 0, y: 0, w: 0, h: 0 };
S.treasureLastPitScreen = { x: 0, y: 0 };
S.pendingLevelWin = false;
S.treasureGoConfirm = false;
S.sessionTreasureCount = 0;
S.sessionTreasureList = [];
S.sessionTreasureCounts = {};
S.treasureExchanged = false;
S.treasureExchangedHearts = 0;
S.duplicateTreasureStash = {};
S.dupExchangePopup = false;

// === 道具 ===
S.zhuzhuProps = { heart: 0, jump: 0, force: 0 };
S.freePropsGivenToday = false;
S.sessionProps = { heart: 0, jump: 0, force: 0 };
S.propGetPopup = false;
S.propGetType = '';
S.propMagnetActive = false;
S.propMagnetPitIndex = -1;
S.propHeartFly = null;
S.propHeartQueue = 0;
S.propHeartFlyActive = false;
S.gameOverAutoContinue = false;
S.pendingPropType = null;
S.pendingPropList = [];
S.propIconParticles = [];
S.propSharePending = false;
S.pendingPropShareType = '';

// === 签到 ===
S.checkinData = { days: [], lastDate: '' };
S.seenBadges = [];
S.seenMarbles = [];
S.seenScenes = [];
S.badgeDates = {};
S.checkinRewardShow = null;
S.pendingCheckinTreasure = null;

// === 反馈 ===
S.feedbackText = '';
S.feedbackContact = '';
S.feedbackImages = [];
S.feedbackAgree = false;
S.feedbackScrollY2 = 0;
S.feedbackTouchY2 = 0;
S.feedbackFocus = false;

// === 关卡选择 ===
S.levelSelScrollY = 0;
S.levelSelTouchY = 0;
S.levelSelDragging = false;

// === 故事 ===
S.storyLevel = 0;
S.storyScrollY = 0;
S.storySceneImages = {};
S.storySlideImages = {};

// === 首页 ===
S.homeMarbles = [];
S.homeAnimTime = 0;
S.homeDragMarble = null;
S.homeDragLastX = 0;
S.homeDragLastY = 0;

// === 主循环 ===
S.lastTime = 0;
S.showTip = true;
S.tipTimer = 0;

// === 粒子 ===
S.chargeParticles = [];

// === 辅助 ===
S._subBgScenes = ['river_pebbles','old_locust_tree','summer_threshing','winter_snow','memory_lane','Forever_Childhood'];

// === 掉落追踪 ===
S.treasureFirstPitIndex = 0;
S.treasureNextPitSeq = [];
S.friendImages = [];
S.friendImgNextSeq = 0;
S.endlessPool3 = [];
S.endlessChestsPlaced = 0;
S.endlessTypesRevealed = [];
S.endlessChestPitIndex = 0;
S.levelChestPitIndex = 0;
S.levelChestTreasures = [];

// === 道具图标 ===
S.titleIcons = {};
S.badgeIcons = {};
S.treasureIcons = {};
