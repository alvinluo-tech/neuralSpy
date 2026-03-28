-- 清空原有数据（可选）
-- delete from public.category_subcategories;
-- delete from public.categories;

create unique index if not exists categories_name_uidx
on public.categories(name);

create unique index if not exists category_subcategories_category_name_uidx
on public.category_subcategories(category_id, name);

-- 插入主类别
insert into public.categories (name, display_name, sort_order) values
('food', '舌尖美食', 1),
('home', '居家生活', 2),
('entertainment', '娱乐至上', 3),
('nature', '自然生态', 4),
('workplace', '职场百态', 5),
('sports', '运动健康', 6),
('tech', '科技前沿', 7),
('culture', '文化旅行', 8),
('campus', '校园时光', 9),
('abstract', '抽象博弈', 10)
on conflict (name) do nothing;

-- 舌尖美食类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'food'),
  'chinese_snacks',
  '中式点心',
  '{"examples": ["包子", "馒头"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'food'),
  'exotic_cuisine',
  '异国料理',
  '{"examples": ["寿司", "饭团"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'food'),
  'summer_drinks',
  '夏日饮品',
  '{"examples": ["可乐", "雪碧"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'food'),
  'seasonings',
  '调味香料',
  '{"examples": ["味精", "鸡精"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'food'),
  'desserts',
  '甜点派对',
  '{"examples": ["泡芙", "甜甜圈"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'food'),
  'tropical_fruits',
  '热带水果',
  '{"examples": ["榴莲", "菠萝蜜"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'food'),
  'hotpot_ingredients',
  '火锅食材',
  '{"examples": ["鸭血", "猪血"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'food'),
  'breakfast',
  '早餐系列',
  '{"examples": ["豆浆", "牛奶"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'food'),
  'puffed_snacks',
  '膨化零食',
  '{"examples": ["薯片", "虾条"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'food'),
  'coffee_wine',
  '美酒咖啡',
  '{"examples": ["拿铁", "卡布奇诺"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 居家生活类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'home'),
  'kitchenware',
  '厨房厨具',
  '{"examples": ["锅盖", "锅铲"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'home'),
  'bathroom',
  '浴室清洁',
  '{"examples": ["沐浴露", "洗发水"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'home'),
  'bedroom',
  '卧室床品',
  '{"examples": ["被套", "床单"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'home'),
  'cleaning',
  '清洁工具',
  '{"examples": ["拖把", "扫帚"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'home'),
  'stationery',
  '办公文具',
  '{"examples": ["圆珠笔", "签字笔"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'home'),
  'makeup',
  '梳妆打扮',
  '{"examples": ["口红", "唇釉"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'home'),
  'electronics',
  '家电数码',
  '{"examples": ["平板", "电脑"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'home'),
  'storage',
  '收纳神器',
  '{"examples": ["纸箱", "塑料盒"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'home'),
  'lighting',
  '照明系列',
  '{"examples": ["台灯", "吊灯"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'home'),
  'sewing',
  '缝纫手工',
  '{"examples": ["针", "线"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 娱乐至上类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'entertainment'),
  'classic_movies',
  '经典电影',
  '{"examples": ["泰坦尼克号", "珍珠港"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'entertainment'),
  'anime',
  '热门动漫',
  '{"examples": ["火影忍者", "海贼王"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'entertainment'),
  'variety_shows',
  '综艺大观',
  '{"examples": ["奔跑吧", "极限挑战"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'entertainment'),
  'short_video',
  '短视频平台',
  '{"examples": ["抖音", "快手"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'entertainment'),
  'board_games',
  '桌面游戏',
  '{"examples": ["狼人杀", "剧本杀"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'entertainment'),
  'retro_games',
  '怀旧游戏',
  '{"examples": ["超级玛丽", "魂斗罗"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'entertainment'),
  'celebrities',
  '明星大咖',
  '{"examples": ["成龙", "李连杰"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'entertainment'),
  'instruments',
  '乐器之声',
  '{"examples": ["吉他", "尤克里里"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'entertainment'),
  'dance',
  '舞蹈种类',
  '{"examples": ["芭蕾", "现代舞"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'entertainment'),
  'music_genre',
  '音乐流派',
  '{"examples": ["摇滚", "爵士"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 自然生态类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'nature'),
  'pets',
  '陆地萌宠',
  '{"examples": ["猫", "狗"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'nature'),
  'wild_animals',
  '森林猛兽',
  '{"examples": ["老虎", "狮子"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'nature'),
  'marine_life',
  '海洋生物',
  '{"examples": ["海豚", "鲸鱼"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'nature'),
  'birds',
  '飞禽鸟类',
  '{"examples": ["鸽子", "老鹰"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'nature'),
  'insects',
  '昆虫世界',
  '{"examples": ["蝴蝶", "飞蛾"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'nature'),
  'flowers',
  '名贵花卉',
  '{"examples": ["玫瑰", "月季"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'nature'),
  'trees',
  '树木森林',
  '{"examples": ["松树", "柏树"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'nature'),
  'weather',
  '四季气候',
  '{"examples": ["阵雨", "暴雨"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'nature'),
  'astronomy',
  '天文景观',
  '{"examples": ["流星", "彗星"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'nature'),
  'geography',
  '地理地貌',
  '{"examples": ["沙漠", "戈壁"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 职场百态类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'workplace'),
  'white_collar',
  '白领生活',
  '{"examples": ["经理", "总监"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'workplace'),
  'medical',
  '医疗专家',
  '{"examples": ["医生", "护士"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'workplace'),
  'education',
  '教育行业',
  '{"examples": ["老师", "教授"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'workplace'),
  'service',
  '服务行业',
  '{"examples": ["外卖员", "快递员"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'workplace'),
  'artists',
  '艺术大师',
  '{"examples": ["画家", "雕塑家"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'workplace'),
  'family',
  '亲戚称呼',
  '{"examples": ["奶奶", "外婆"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'workplace'),
  'fairy_tales',
  '童话人物',
  '{"examples": ["灰姑娘", "白雪公主"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'workplace'),
  'wuxia',
  '武侠角色',
  '{"examples": ["侠客", "刺客"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'workplace'),
  'superheroes',
  '超级英雄',
  '{"examples": ["蜘蛛侠", "蝙蝠侠"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'workplace'),
  'relationships',
  '职场关系',
  '{"examples": ["同事", "竞争对手"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 运动健康类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'sports'),
  'ball_sports',
  '球类竞赛',
  '{"examples": ["乒乓球", "羽毛球"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'sports'),
  'track_field',
  '田径项目',
  '{"examples": ["长跑", "短跑"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'sports'),
  'water_sports',
  '水上运动',
  '{"examples": ["游泳", "跳水"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'sports'),
  'equipment',
  '健身器材',
  '{"examples": ["哑铃", "杠铃"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'sports'),
  'extreme_sports',
  '极限运动',
  '{"examples": ["蹦极", "跳伞"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'sports'),
  'olympics',
  '奥林匹克',
  '{"examples": ["金牌", "银牌"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'sports'),
  'martial_arts',
  '武术格斗',
  '{"examples": ["空手道", "跆拳道"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'sports'),
  'leisure',
  '休闲运动',
  '{"examples": ["散步", "慢跑"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'sports'),
  'yoga',
  '瑜伽普拉提',
  '{"examples": ["拉伸", "冥想"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'sports'),
  'board_games_sport',
  '棋牌竞技',
  '{"examples": ["象棋", "围棋"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 科技前沿类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'tech'),
  'programming',
  '编程语言',
  '{"examples": ["Python", "Java"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'tech'),
  'os',
  '操作系统',
  '{"examples": ["iOS", "Android"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'tech'),
  'social',
  '社交软件',
  '{"examples": ["微信", "QQ"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'tech'),
  'ai_blockchain',
  '前沿技术',
  '{"examples": ["人工智能", "区块链"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'tech'),
  'hardware',
  '硬件配置',
  '{"examples": ["显卡", "CPU"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'tech'),
  'browsers',
  '网页浏览器',
  '{"examples": ["Chrome", "Safari"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'tech'),
  'smart_home',
  '智能家居',
  '{"examples": ["扫地机", "洗碗机"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'tech'),
  'aerospace',
  '航天器械',
  '{"examples": ["火箭", "卫星"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'tech'),
  'accessories',
  '电子配件',
  '{"examples": ["鼠标", "键盘"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'tech'),
  'vr_ar',
  '虚拟现实',
  '{"examples": ["VR", "AR"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 文化旅行类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'culture'),
  'world_cities',
  '世界名城',
  '{"examples": ["巴黎", "伦敦"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'culture'),
  'china_mountains',
  '中国名山',
  '{"examples": ["泰山", "华山"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'culture'),
  'landmarks',
  '名胜古迹',
  '{"examples": ["长城", "故宫"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'culture'),
  'transport',
  '交通工具',
  '{"examples": ["地铁", "轻轨"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'culture'),
  'accommodation',
  '旅游住宿',
  '{"examples": ["酒店", "民宿"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'culture'),
  'festivals',
  '节日习俗',
  '{"examples": ["春节", "元宵"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'culture'),
  'clothing',
  '服装配饰',
  '{"examples": ["衬衫", "T恤"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'culture'),
  'shoes',
  '鞋履系列',
  '{"examples": ["运动鞋", "帆布鞋"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'culture'),
  'dialects',
  '方言俚语',
  '{"examples": ["普通话", "广东话"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'culture'),
  'dynasties',
  '历史朝代',
  '{"examples": ["唐朝", "宋朝"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 校园时光类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'campus'),
  'subjects',
  '学科知识',
  '{"examples": ["数学", "物理"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'campus'),
  'facilities',
  '校园设施',
  '{"examples": ["图书馆", "操场"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'campus'),
  'exams',
  '考试相关',
  '{"examples": ["中考", "高考"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'campus'),
  'stationery_box',
  '文具盒里',
  '{"examples": ["橡皮", "修正带"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'campus'),
  'activities',
  '课间活动',
  '{"examples": ["跳绳", "踢毽子"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'campus'),
  'clubs',
  '学生社团',
  '{"examples": ["学生会", "广播站"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'campus'),
  'awards',
  '奖项证书',
  '{"examples": ["三好学生", "优秀班干"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'campus'),
  'graduation',
  '毕业相关',
  '{"examples": ["学士服", "毕业证"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'campus'),
  'terminology',
  '专业名词',
  '{"examples": ["学霸", "学渣"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'campus'),
  'dorm_life',
  '宿舍生活',
  '{"examples": ["上下铺", "单人床"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;

-- 抽象博弈类别
insert into public.category_subcategories (category_id, name, display_name, examples, sort_order)
select 
  (select id from public.categories where name = 'abstract'),
  'personality',
  '性格特征',
  '{"examples": ["大方", "慷慨"]}'::jsonb,
  1
union all select 
  (select id from public.categories where name = 'abstract'),
  'emotions',
  '情绪表达',
  '{"examples": ["难过", "悲伤"]}'::jsonb,
  2
union all select 
  (select id from public.categories where name = 'abstract'),
  'colors',
  '颜色辨析',
  '{"examples": ["橙色", "橘色"]}'::jsonb,
  3
union all select 
  (select id from public.categories where name = 'abstract'),
  'shapes',
  '形状感官',
  '{"examples": ["圆形", "椭圆"]}'::jsonb,
  4
union all select 
  (select id from public.categories where name = 'abstract'),
  'time',
  '时间概念',
  '{"examples": ["瞬间", "片刻"]}'::jsonb,
  5
union all select 
  (select id from public.categories where name = 'abstract'),
  'measurements',
  '度量衡',
  '{"examples": ["厘米", "毫米"]}'::jsonb,
  6
union all select 
  (select id from public.categories where name = 'abstract'),
  'business_terms',
  '商业术语',
  '{"examples": ["融资", "贷款"]}'::jsonb,
  7
union all select 
  (select id from public.categories where name = 'abstract'),
  'law',
  '法律相关',
  '{"examples": ["律师", "检察官"]}'::jsonb,
  8
union all select 
  (select id from public.categories where name = 'abstract'),
  'philosophy',
  '哲学思辨',
  '{"examples": ["理想", "现实"]}'::jsonb,
  9
union all select 
  (select id from public.categories where name = 'abstract'),
  'internet_slang',
  '网络热梗',
  '{"examples": ["YYDS", "绝绝子"]}'::jsonb,
  10
on conflict (category_id, name) do update
set
  display_name = excluded.display_name,
  examples = excluded.examples,
  sort_order = excluded.sort_order;
