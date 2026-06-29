// ============================================================
// 珠珠快跑 — 全局配置 & 常量
// 提取自 game.js
// ============================================================

// —— 物理 & 游戏参数
export const CFG = {
  // 透视投影
  CAMERA_OFFSET: 0.0,

  // 珠珠
  MARBLE_RADIUS: 0.045,

  // 蓄力
  CHARGE_RATE: 0.50,
  MIN_SPEED: 0.35,
  MAX_SPEED: 2.80,

  // 物理
  FRICTION: 1.4,
  STOP_THRESHOLD: 0.04,
  ROLL_FACTOR: 2.3,

  // 坑
  PIT_SPACING_MIN: 4.0,
  PIT_SPACING_MAX: 7.0,
  PIT_RADIUS_MIN: 0.045,
  PIT_RADIUS_MAX: 0.070,
  HIT_TOLERANCE: 2.20,

  // 相机
  CAMERA_LERP_IDLE: 0.07,
  CAMERA_LERP_ROLL: 0.15,

  // 动画
  SINK_DURATION: 1.2,
  RESPAWN_DURATION: 0.20,
};

// —— 游戏主状态枚举
export const STATE = {
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
  BADGES: 'badges',
  CLASSIC: 'classic',
  STORY: 'story',
  FEEDBACK: 'feedback',
  CHECKIN: 'checkin',
  TREASURE: 'treasure',
  LEVELSEL: 'levelsel',
};

// —— 经典模式阶段
export const CLASSIC_PHASE = {
  MODE_SELECT: 'modeSelect',
  INTRO: 'intro',
  SERVING: 'serving',
  ROLLING: 'rolling',
  TARGET_SELECT: 'targetSelect',
  AIMING: 'aiming',
  GAMEOVER: 'gameover',
};

export const CLASSIC_PIT_COUNT = 3;
export const CLASSIC_PIT_SPACING = 1.0;
export const CLASSIC_START_DIST = 1.0;
export const CLASSIC_SAME_DIST_THRESH = 0.03;

// —— 场景配置
export const SCENE_CONFIG = {
  grandma_backyard:  { bg: 'grandma_backyard.jpg',  pit: 'keng.png' },
  school_sandpit:    { bg: 'school_sandpit.jpg',    pit: 'keng2.png' },
  after_rain_mud:    { bg: 'after_rain_mud.jpg',    pit: 'keng3.png' },
  river_pebbles:     { bg: 'river_pebbles.jpg',     pit: 'keng4.png' },
  old_locust_tree:   { bg: 'old_locust_tree.jpg',   pit: 'keng5.png' },
  summer_threshing:  { bg: 'summer_threshing.jpg',  pit: 'keng6.png' },
  winter_snow:       { bg: 'winter_snow.jpg',       pit: 'keng7.png' },
  memory_lane:       { bg: 'memory_lane.jpg',        pit: 'keng8.png' },
  eternal_childhood: { bg: 'Forever_Childhood.jpg',  pit: 'keng9.png' },
};

// 子包场景列表
export const SUB_BG_SCENES = ['river_pebbles', 'old_locust_tree', 'summer_threshing', 'winter_snow', 'memory_lane', 'Forever_Childhood'];

// 场景图片路径解析
export function scenePath(fn) {
  var b = fn.split('.')[0];
  for (var i = 0; i < SUB_BG_SCENES.length; i++) {
    if (b === SUB_BG_SCENES[i]) return 'subpkg_assets/assets/images/scenes/';
  }
  return 'assets/images/scenes/';
}

// —— 首页按钮布局
export const HOME_BTNS = {
  endless:  { x: 0, y: 0, w: 180, h: 56 },
  levels:   { x: 0, y: 0, w: 180, h: 56 },
  classic:  { x: 0, y: 0, w: 180, h: 56 },
  settings: { x: 34, y: 0, r: 20 },
  icons: [
    { id: 'checkin', x: 0, y: 0, r: 18 },
    { id: 'rank',    x: 0, y: 0, r: 18 },
    { id: 'badges',  x: 0, y: 0, r: 18 },
  ],
};
