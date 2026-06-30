// ============================================================
// 珠珠快跑 — 勋章 & 称号数据
// 提取自 game.js
// ============================================================

export const ALL_BADGES = [
  { name: '初次入坑', cat: '历程勋章', cond: '累计入坑50次',   icon: '', target: 50,    key: 'totalPits',  id: 'first_pit' },
  { name: '初露锋芒', cat: '历程勋章', cond: '累计入坑150次',  icon: '', target: 150,   key: 'totalPits',  id: 'five_pits' },
  { name: '小试身手', cat: '历程勋章', cond: '累计入坑350次',  icon: '', target: 350,   key: 'totalPits',  id: 'twenty_pits' },
  { name: '渐入佳境', cat: '历程勋章', cond: '累计入坑600次',  icon: '', target: 600,   key: 'totalPits',  id: 'fifty_pits' },
  { name: '百坑不倦', cat: '历程勋章', cond: '累计入坑1000次', icon: '', target: 1000,  key: 'totalPits',  id: 'hundred_pits' },
  { name: '弹珠达人', cat: '历程勋章', cond: '累计入坑2500次', icon: '', target: 2500,  key: 'totalPits',  id: 'five_hundred' },
  { name: '千锤百炼', cat: '历程勋章', cond: '累计入坑5000次', icon: '', target: 5000,  key: 'totalPits',  id: 'thousand_pits' },
  { name: '二连入坑', cat: '精准勋章', cond: '单局连续2坑',    icon: '', target: 2,     key: 'bestCombo',  id: 'combo_2' },
  { name: '三连入坑', cat: '精准勋章', cond: '单局连续9坑',    icon: '', target: 9,     key: 'bestCombo',  id: 'combo_3' },
  { name: '五连绝世', cat: '精准勋章', cond: '单局连续20坑',   icon: '', target: 20,    key: 'bestCombo',  id: 'combo_5' },
  { name: '势不可挡', cat: '精准勋章', cond: '单局连续40坑',   icon: '', target: 40,    key: 'bestCombo',  id: 'combo_10' },
  { name: '人珠合一', cat: '精准勋章', cond: '单局连续50坑',   icon: '', target: 50,    key: 'bestCombo',  id: 'combo_20' },
  { name: '天选之珠', cat: '精准勋章', cond: '单局连续80坑',   icon: '', target: 80,    key: 'bestCombo',  id: 'combo_35' },
  { name: '传说连击', cat: '精准勋章', cond: '单局连续120坑',  icon: '', target: 120,   key: 'bestCombo',  id: 'combo_50' },
  { name: '初次见面', cat: '陪伴勋章', cond: '累计登录1天',    icon: '', target: 1,     key: 'loginDays',  id: 'login_1' },
  { name: '三天打鱼', cat: '陪伴勋章', cond: '累计登录3天',    icon: '', target: 3,     key: 'loginDays',  id: 'login_3' },
  { name: '一周相伴', cat: '陪伴勋章', cond: '累计登录7天',    icon: '', target: 7,     key: 'loginDays',  id: 'login_7' },
  { name: '半月守望', cat: '陪伴勋章', cond: '累计登录15天',   icon: '', target: 15,    key: 'loginDays',  id: 'login_15' },
  { name: '月月不离', cat: '陪伴勋章', cond: '累计登录30天',   icon: '', target: 30,    key: 'loginDays',  id: 'login_30' },
  { name: '百日光阴', cat: '陪伴勋章', cond: '累计登录100天',  icon: '', target: 100,   key: 'loginDays',  id: 'login_100' },
  { name: '一年之约', cat: '陪伴勋章', cond: '累计登录365天',  icon: '', target: 365,   key: 'loginDays',  id: 'login_365' },
  { name: '皮肤新手', cat: '收集勋章', cond: '解锁3款珠珠皮肤', icon: '', target: 3,     key: 'marbles',    id: 'skin_3' },
  { name: '皮肤达人', cat: '收集勋章', cond: '解锁6款珠珠皮肤', icon: '', target: 6,     key: 'marbles',    id: 'skin_6' },
  { name: '皮肤大师', cat: '收集勋章', cond: '解锁9款珠珠皮肤', icon: '', target: 9,     key: 'marbles',    id: 'skin_9' },
  { name: '全珠收集', cat: '收集勋章', cond: '解锁12款珠珠皮肤',icon: '', target: 12,    key: 'marbles',    id: 'skin_12' },
  { name: '场景行者', cat: '收集勋章', cond: '解锁3款场景',    icon: '', target: 3,     key: 'scenes',     id: 'scene_3' },
  { name: '场景达人', cat: '收集勋章', cond: '解锁6款场景',    icon: '', target: 6,     key: 'scenes',     id: 'scene_6' },
  { name: '环球旅行', cat: '收集勋章', cond: '解锁全部9款场景',icon: '', target: 9,     key: 'scenes',     id: 'scene_9' },
];

export const ALL_TITLES = [
  { name: '初来乍到',   cond: '累计入坑10次',    id: 'beginner' },
  { name: '弹珠学徒',   cond: '累计入坑50次',    id: 'player' },
  { name: '弹珠爱好者', cond: '累计入坑100次',   id: 'enthusiast' },
  { name: '弹珠高手',   cond: '累计入坑500次',   id: 'expert' },
  { name: '弹珠大师',   cond: '累计入坑1000次',  id: 'master' },
  { name: '弹珠传说',   cond: '累计入坑5000次',  id: 'legend' },
  { name: '百发百中',   cond: '单局连续15坑',    id: 'sharpshooter' },
  { name: '势不可挡',   cond: '单局连续30坑',    id: 'unstoppable' },
  { name: '珠珠收藏家', cond: '解锁8款珠珠皮肤', id: 'collector8' },
  { name: '世界漫游者', cond: '解锁6款场景',     id: 'traveler6' },
  { name: '不离不弃',   cond: '累计登录30天',    id: 'loyal30' },
  { name: '老朋友',     cond: '累计登录100天',   id: 'oldfriend' },
];
