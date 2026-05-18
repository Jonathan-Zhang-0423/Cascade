type Rule = [pattern: RegExp, emoji: string];

const RULES: Rule[] = [
  [/\b(space|rocket|star.?war|ufo|alien|galax)\b|星球|星际|太空|宇宙|星战|外星/i, "🚀"],
  [/\bsnake\b|贪吃蛇|蛇游戏/i, "🐍"],
  [/\b(chess|checkers)\b|国际象棋|象棋|围棋|跳棋/i, "♟️"],
  [/\btetris\b|俄罗斯方块|方块游戏/i, "🟦"],
  [/\bpac.?man\b|吃豆人|吃豆/i, "👾"],
  [/\b(card|poker|blackjack|solitaire)\b|扑克|纸牌|接龙/i, "🃏"],
  [/\b(rpg|dungeon|dragon|adventure|quest|wizard|knight)\b|魔法|角色扮演|冒险|精灵|骑士|巫师/i, "⚔️"],
  [/\b(racing|race|car.?game)\b|赛车|驾驶|赛车游戏/i, "🏎️"],
  [/\b(puzzle|jigsaw|match)\b|拼图|解谜|消除/i, "🧩"],
  [/\b(platform|parkour|mario)\b|跳跳|跑酷/i, "🕹️"],
  [/\b(fight|battle|shooter|shoot)\b|战斗|射击|打架/i, "🎮"],
  [/\bflappy\b|小鸟游戏/i, "🐦"],
  [/\b(dinosaur|dino)\b|恐龙游戏/i, "🦕"],
  [/\b2048\b|数字游戏/i, "🔢"],
  [/\bminesweeper\b|扫雷/i, "💣"],
  [/\b(typing|keyboard)\b|打字游戏|打字练习/i, "⌨️"],
  [/\bgame\b|游戏/i, "🎮"],
  [/\b(portfolio|resume|cv)\b|简历|作品集|个人网站/i, "🎨"],
  [/\b(blog|post|article)\b|博客|日记|文章/i, "✍️"],
  [/\b(todo|task|checklist)\b|待办|任务清单|清单/i, "✅"],
  [/\bweather\b|天气|气温|天气预报/i, "⛅"],
  [/\b(chat|messaging|message)\b|聊天|消息|即时通讯/i, "💬"],
  [/\b(quiz|trivia)\b|问答|测验|知识竞赛/i, "🧠"],
  [/\b(shop|store|e-?commerce)\b|商店|购物|商城/i, "🛒"],
  [/\b(music|song|playlist|player)\b|音乐|歌曲|播放器/i, "🎵"],
  [/\b(calendar|schedule)\b|日历|日程/i, "📅"],
  [/\b(calculator|math|arithmetic)\b|计算器|数学计算/i, "🧮"],
  [/\b(timer|stopwatch|countdown)\b|计时|倒计时/i, "⏱️"],
  [/\b(draw|drawing|paint|canvas)\b|绘画|画图|画板/i, "🖌️"],
  [/\b(story|book|novel)\b|小说|故事/i, "📖"],
  [/\b(map|navigation)\b|地图|导航/i, "🗺️"],
  [/\b(news|feed)\b|新闻|资讯|头条/i, "📰"],
  [/\b(photo|gallery|image)\b|相册|照片|图片/i, "🖼️"],
  [/\b(video|movie|film)\b|视频|电影/i, "🎬"],
  [/\b(food|recipe|cooking|meal)\b|菜谱|食谱|美食/i, "🍳"],
  [/\b(fitness|workout|exercise)\b|健身|运动|锻炼/i, "💪"],
  [/\b(finance|budget|money|expense)\b|财务|账单|理财|投资/i, "💰"],
  [/\b(travel|trip|vacation)\b|旅行|旅游/i, "✈️"],
  [/\b(social|community|network)\b|社交|论坛|社区/i, "🌐"],
  [/\b(ai|chatbot|machine.?learning)\b|人工智能|机器学习|聊天机器人/i, "🤖"],
  [/\b(alarm|clock)\b|闹钟|时钟/i, "🕐"],
  [/\b(note|notes|memo)\b|笔记|备忘/i, "📝"],
  [/\bhello.?world\b|第一个程序|入门程序/i, "👋"],
  [/\b(landing|homepage|home.?page)\b|官网|主页/i, "🏠"],
  [/\b(dashboard|admin)\b|管理后台|后台/i, "📊"],
  [/\b(chart|graph|data|visualization)\b|数据|图表|可视化/i, "📈"],
];

export function getProjectEmoji(text: string): string {
  const t = text.trim().toLowerCase();
  for (const [pattern, emoji] of RULES) {
    if (pattern.test(t)) return emoji;
  }
  return "💻";
}
