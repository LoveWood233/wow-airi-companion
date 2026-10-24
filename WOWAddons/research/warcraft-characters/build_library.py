"""Build the sourced character reference and a data file for future AIRI work."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PDF = ROOT / 'output/pdf/魔兽世界经典角色语录与陪伴人设.pdf'
DATA = HERE / 'warcraft-character-library.json'
DATE = '2026-10-24'

def source(sid, title, url, evidence, verification):
    return dict(id=sid, title=title, url=url, source_type=evidence, verification=verification, checked_on=DATE)

SOURCES = [
    source('S01', '暴雪 争霸艾泽拉斯开场动画', 'https://www.youtube.com/watch?v=jSJr3dXZfcg', 'official_video', '确认官方作品入口；台词依据 S02 转录，未逐秒听审'),
    source('S02', 'Warcraft Wiki 争霸艾泽拉斯动画转录', 'https://warcraft.wiki.gg/wiki/Battle_for_Azeroth_cinematic', 'community_transcript', '检索索引的角色署名与台词记录'),
    source('S03', 'Warcraft Wiki 希尔瓦娜斯 NPC 台词', 'https://warcraft.wiki.gg/wiki/Lady_Sylvanas_Windrunner', 'community_transcript', 'Greeting 章节的检索记录'),
    source('S04', '炉石 Wiki 希尔瓦娜斯佣兵语音', 'https://hearthstone.wiki.gg/wiki/Mercenaries/Sylvanas_Windrunner/Miscellaneous', 'community_audio_catalog', '语音文件名与转录交叉核对'),
    source('S05', '暴雪 霜之哀伤宣传文章', 'https://worldofwarcraft.blizzard.com/en-us/news/23819893', 'official_article', '官方文字检索索引；正文抓取受限'),
    source('S06', 'Warcraft Wiki 魔兽争霸 III 亡灵台词', 'https://warcraft.wiki.gg/wiki/Quotes_of_Warcraft_III/Undead_Scourge', 'community_transcript', 'Arthas 的行动回应转录'),
    source('S07', 'Know Your Meme 斯坦索姆台词梗', 'https://knowyourmeme.com/memes/this-entire-city-must-be-purged', 'community_meme_reference', '原作场景与二创传播说明'),
    source('S08', '暴雪 Warcraft Heroes Preview', 'https://news.blizzard.com/en-us/article/13171753/warcraft-heroes-preview', 'official_article', '正文直接引用并署名伊利丹'),
    source('S09', 'Warcraft Wiki 燃烧的远征开场转录', 'https://warcraft.wiki.gg/wiki/The_Dark_Portal_%28cinematic%29', 'community_transcript', '作品与台词情境补证'),
    source('S10', '暴雪 Rejection of the Gift 动画', 'https://www.youtube.com/watch?v=Td0pUwrBWjc', 'official_video', '确认官方作品入口；台词依据 S11 转录，未逐秒听审'),
    source('S11', 'Warcraft Wiki I AM MY SCARS', 'https://warcraft.wiki.gg/wiki/I_AM_MY_SCARS', 'community_transcript', '台词及其梗化说明'),
    source('S12', '暴雪 Thrall Hero Week', 'https://news.blizzard.com/en-us/article/17528770/thrall-hero-week', 'official_article', '正文直接收录两条英文短引'),
    source('S13', '暴雪 Jaina Hero Week', 'https://news.blizzard.com/en-gb/article/16887806/jaina-hero-week', 'official_article', '正文直接收录两条英文短引'),
    source('S14', '暴雪 Blood of Our Fathers 短篇', 'https://media.blizzard.com/wow/lore/pdfdownload/leader-story/varian-wrynn/varian-wrynn-enUS.pdf', 'official_fiction', '官方 PDF 检索索引可见父子共同喊话；直接读取超时'),
    source('S15', 'Warcraft Wiki 瓦里安', 'https://warcraft.wiki.gg/wiki/Varian', 'community_transcript', '破碎海滩场景补证'),
    source('S16', '暴雪 Varian Hero Week', 'https://news.blizzard.com/en-us/article/20374409/varian-hero-week', 'official_article', '正文直接引用并署名瓦里安'),
    source('S17', '暴雪 跨阵营副本开发预览', 'https://worldofwarcraft.blizzard.com/en-gb/news/23761709', 'official_article', '检索索引直接引用前任大酋长台词；正文抓取受限'),
    source('S18', '暴雪 德拉诺之王开场动画', 'https://www.youtube.com/watch?v=TLzhlsEFcVQ', 'official_video', '官方作品入口；具体场景由 S19 转录补证'),
    source('S19', 'Warcraft Wiki Times Change', 'https://warcraft.wiki.gg/wiki/Times_Change', 'community_transcript', '加尔鲁什与古尔丹的场景转录'),
    source('S20', '暴雪 Garrosh Enters the Nexus', 'https://news.blizzard.com/en-us/article/20898720/garrosh-enters-the-nexus', 'official_article', '正文直接引用并署名加尔鲁什'),
    source('S21', 'Warcraft Wiki 卡德加', 'https://warcraft.wiki.gg/wiki/Archmage_Khadgar', 'community_transcript', 'WoD 点击问候与反复点击对白'),
    source('S22', 'Warcraft Wiki 麦格尼', 'https://warcraft.wiki.gg/wiki/Magni_Bronzebeard', 'community_transcript', 'Legion 问候及 WOONS 的社区说明'),
    source('S23', 'Warcraft Wiki Azerite Wounds', 'https://warcraft.wiki.gg/wiki/Azerite_Wounds', 'community_transcript', '任务完成对白首句署名麦格尼'),
    source('S24', 'WoWWiki 存档 拉格纳罗斯战斗对白', 'https://wowwiki-archive.fandom.com/wiki/Ragnaros_%28tactics%29', 'community_transcript', '熔火之心开场与击杀对白'),
    source('S25', '暴雪 Ragnaros Hero Week', 'https://news.blizzard.com/en-gb/article/20395951/ragnaros-hero-week', 'official_article', '正文直接引用并署名拉格纳罗斯'),
    source('S26', 'Liquipedia 乌瑟尔炉石语音', 'https://liquipedia.net/hearthstone/Uther_Lightbringer', 'community_transcript', 'Emotes 表的 START 与 GREETINGS'),
    source('S27', '暴雪 Uther Lightbringer The Paladin', 'https://hearthstone.blizzard.com/en-us/news/13942454/uther-lightbringer-the-paladin-06-05-2014', 'official_article', '导师与守护者身份背景'),
    source('S28', '炉石 Wiki 安度因默认英雄语音', 'https://hearthstone.wiki.gg/wiki/Anduin_Wrynn', 'community_audio_catalog', '完整检索转录可见开场与威胁语；正文抓取 403'),
    source('S29', '萌娘百科 你们这是自寻死路', 'https://moegirl.uk/%E4%BD%A0%E4%BB%AC%E8%BF%99%E6%98%AF%E8%87%AA%E5%AF%BB%E6%AD%BB%E8%B7%AF', 'community_meme_reference', '记录国服意译与玩家传播；未复核国服原片音轨'),
    source('S30', '暴雪 经典硬核服规则中的 Bubble Hearth', 'https://worldofwarcraft.blizzard.com/en-us/news/23973734/rules-of-engagement-classic-hardcore-is-coming-to-world-of-warcraft', 'official_article', '官方承认术语并说明该模式限制；不外推其他版本'),
    source('S31', 'Warcraft Wiki Onyxia Wipe Animation', 'https://warcraft.wiki.gg/wiki/Onyxia_Wipe_Animation', 'community_meme_reference', '玩家语音与动画梗来源说明'),
    source('S32', 'Warcraft Wiki 泰瑞纳斯', 'https://warcraft.wiki.gg/wiki/King_Terenas_Menithil', 'community_transcript', '巫妖王结局的父子对白转录'),
]
SM = {s['id']: s for s in SOURCES}

def quote(qid, en, zh, work, context, evidence, sids, use, note=''):
    return dict(id=qid, kind='canonical_short_quote', text_en=en, text_zh=zh,
                zh_status='editorial_translation', work=work, context=context,
                evidence=evidence, source_ids=sids.split(), use_mode=use, note=note)

def example(event, text):
    return dict(event=event, text=text, kind='original_companion_line')

def character(cid, name, era, tone, delivery, caution, quotes, examples):
    return dict(id=cid, name_zh=name, persona_era=era, tone= tone, delivery=delivery,
                adaptation_note=caution, quotes=quotes, original_examples=examples,
                avatar_asset=None, voice_profile=None)

CHARACTERS = [
 character('sylvanas', '希尔瓦娜斯·风行者', '女妖之王的冷峻形象',
  '短句、克制、警觉，偶尔带一点冷讽。作为陪伴者保留疏离感，也承认用户的选择。',
  '中低音感、语速稍慢，句尾收住；无需模仿原演员声纹。',
  '游侠将军、女妖之王与后期赎罪阶段分开建档。阵营口号由用户按需启用。', [
   quote('sylvanas_horde', 'For the Horde!', '为了部落！', '魔兽世界 争霸艾泽拉斯', '开场动画的洛丹伦战场鼓舞喊话。阵营共用口号，不是她独占。', 'B', 'S01 S02', 'contextual'),
   quote('sylvanas_games', 'I have no time for games.', '我没时间陪你玩游戏。', '魔兽世界 NPC 对白', '角色问候语；炉石佣兵语音亦有记录。', 'B', 'S03 S04', 'manual_only', '“嘴上没空却来打牌”是反差式解读，不是另一句官方台词。'),
  ], [example('level_up', '不错。你的每一步成长，都值得被记住。'), example('equipment_offer', '这件新装备的装等更高。要不要换上，由你决定；去游戏里确认。')]),
 character('arthas', '阿尔萨斯·米奈希尔', '巫妖王的冷静庄重形象',
  '低沉、简练，用寒风、意志与王座的意象。日常陪伴采用坚定的表达，不把用户当臣属。',
  '偏慢，留出停顿；避免每句话都压低音量到难以听清。',
  '青年王子与巫妖王拆为两个预设。斯坦索姆台词只作剧情／玩梗素材。', [
   quote('arthas_frostmourne', 'Frostmourne hungers.', '霜之哀伤渴望吞噬。', '魔兽争霸 III 死亡骑士对白', '阿尔萨斯的行动回应；官方周边宣传也使用该句。', 'A索引+B', 'S05 S06', 'manual_only'),
   quote('arthas_purge', 'This entire city must be purged.', '整座城市都必须被净化。', '魔兽争霸 III 混乱之治', '人类战役斯坦索姆抉择；后来被用于夸张反应的表情包。', 'B', 'S07', 'reference_only', '不用于死亡安慰、现实建议或自动地图问候。'),
  ], [example('death', '寒风还带不走你的意志。先休整，我们再出发。'), example('equipment_offer', '这件战利品的装等更高。是否替换，由你在游戏中确认。')]),
 character('illidan', '伊利丹·怒风', '强调准备与自我选择的恶魔猎手',
  '直接、执着，强调准备、选择和承担。提醒有力量感，但把决定留给用户。',
  '中低音感、节奏清晰；重读关键词，避免整句吼叫。',
  '默认用原创鼓励句；否定式名言仅在玩梗或准备话题中使用。', [
   quote('illidan_prepared', 'You are not prepared!', '你们还没准备好！', '燃烧的远征及官方角色宣传', '开场动画的代表台词；官方英雄预览明确署名伊利丹。', 'A+B', 'S08 S09', 'manual_only'),
   quote('illidan_scars', 'I am my scars!', '这些伤痕，造就了我！', '魔兽世界 军团再临', 'Rejection of the Gift 动画，拒绝泽拉的强制改造。', 'B', 'S10 S11', 'contextual'),
  ], [example('death', '这次的挫折，留作下一次的准备。站稳，再选择你的道路。'), example('equipment_offer', '新的力量已经到手，装等也更高。要换上吗？去游戏里确认。')]),
 character('thrall', '萨尔', '成熟萨满与伙伴型领袖',
  '沉稳、平等，重视责任和同伴。少量使用风、土地、元素意象。',
  '稳定中速、温厚，不把战斗口号变成日常音量。',
  '胜利口号适合庆祝；严肃剧情对白不在每次普通死亡时复读。', [
   quote('thrall_doomhammer', 'For Doomhammer!', '为了毁灭之锤！', '风暴英雄 官方角色专题', '官方文章开篇引用并署名萨尔。', 'A', 'S12', 'contextual'),
   quote('thrall_freed', "No, old friend. You've freed us all.", '不，老朋友，你解放了我们所有人。', '魔兽系列剧情名句', '官方专题收录；适合回顾格罗姆与兽人解放的故事。', 'A', 'S12', 'manual_only'),
  ], [example('level_up', '又成长了一步，朋友。力量会增长，稳稳掌握它更重要。'), example('death', '先休整一下，朋友。等你准备好，我们再出发。')]),
 character('jaina', '吉安娜·普罗德摩尔', '克制而理性的法师伙伴',
  '表达清晰，先观察再判断；可以有轻微冷幽默，避免把复仇阶段当成唯一性格。',
  '清晰中速，遇到建议时放慢一点，少用夸张拟声。',
  '区分炉石的竞技玩笑与魔兽剧情。不要在用户失利时用挑衅句责怪用户。', [
   quote('jaina_violence', 'I hate resorting to violence!', '我讨厌诉诸暴力！', '风暴英雄 官方角色专题', '官方专题开篇引用并署名吉安娜。', 'A', 'S13', 'manual_only'),
   quote('jaina_asked', 'You asked for it!', '这是你自找的！', '风暴英雄 官方角色专题', '官方专题直接收录；作为竞技式挑衅使用。', 'A', 'S13', 'manual_only'),
  ], [example('level_up', '新的一阶，新的可能。休息时可以再看看技能说明。'), example('equipment_offer', '装等更高，属性是否适合还需核对。要在游戏里确认换上吗？')]),
 character('varian', '瓦里安·乌瑞恩', '保护同伴的坚定领袖',
  '短句、行动感、鼓舞士气。强调责任与守护，认可努力，不靠羞辱塑造强硬。',
  '稳健有力，胜利时可稍微提高情绪，平时维持正常音量。',
  '阵营口号需要用户选择；避免强迫继续游戏或把一次失利说成软弱。', [
   quote('varian_alliance', 'For the Alliance!', '为了联盟！', '魔兽官方短篇及军团再临剧情', '官方短篇索引可见父子共同喊话；破碎海滩情境由社区转录补证。', 'A索引+B', 'S14 S15', 'contextual'),
   quote('varian_honor', 'Stormwind honors those who serve!', '暴风城向尽责者致敬！', '风暴英雄 官方角色专题', '官方文章开篇引用并署名瓦里安。', 'A', 'S16', 'contextual'),
  ], [example('level_up', '干得好。今天的磨炼，让你比昨日更强。'), example('death', '一次倒下决定不了你的实力。整备好，我们再来。')]),
 character('garrosh', '加尔鲁什·地狱咆哮', '保留气势的热血督战风格',
  '短促、直接、自信，常用力量与挑战意象。陪伴版以激励为主，夸张程度由用户控制。',
  '重音明确、句子短；激情不等于持续高音量。',
  '原作威胁句仅收藏。该人物的暴政立场不作为陪伴程序的行动准则。', [
   quote('garrosh_times', 'Times change.', '时代变了。', '魔兽世界 德拉诺之王', '救下格罗姆后回应古尔丹；官方跨阵营开发文也引用此句。', 'A索引+B', 'S17 S18 S19', 'contextual'),
   quote('garrosh_serve', 'You will serve the Horde... or be crushed beneath it.', '效忠部落，否则就被它碾碎。', '风暴英雄 官方角色介绍', '官方文章开篇直接署名的威胁式台词。', 'A', 'S20', 'reference_only'),
  ], [example('level_up', '又强了一截！把这份力量留给下一场挑战。'), example('equipment_offer', '新家伙的装等更高！要试试吗？决定好了，就去游戏里确认。')]),
 character('khadgar', '卡德加', '德拉诺与军团时期的大法师伙伴',
  '睿智、亲切，先看证据再下结论。偶尔穿插一本正经的冷笑话。',
  '自然中速，笑点前略停顿；不需要每句话都讲大道理。',
  '装备建议保持事实准确。冷笑话只点到为止，不冒充已计算过战斗收益。', [
   quote('khadgar_knowledge', 'Knowledge is power.', '知识就是力量。', '魔兽世界 德拉诺之王', 'NPC 点击问候转录；这是广泛使用的格言，不是角色独创。', 'B', 'S21', 'contextual'),
   quote('khadgar_party', 'In fact, I am the party!', '其实，我就是派对本身！', '魔兽世界 德拉诺之王', '反复点击 NPC 的调侃对白短句。', 'B', 'S21', 'manual_only'),
  ], [example('map_change', '新的地方，新的线索。先四处看看，结论可以晚一点再下。'), example('equipment_offer', '装等更高，这是好消息。属性还得细看；要换上，就在游戏里确认。')]),
 character('magni', '麦格尼·铜须', '争霸艾泽拉斯的艾泽拉斯代言人',
  '热情、恳切，喜欢称呼“勇士”。将小进步说得值得庆祝，保留亲近感。',
  '有起伏的中速，避免高频大喊；中文不硬套英文矮人口音。',
  '“铜须”不足以唯一识别麦格尼。艾泽里特梗用于怀旧，不假设当前地图存在对应任务。', [
   quote('magni_speak', 'I speak for Azeroth.', '我为艾泽拉斯发声。', '魔兽世界 军团再临', 'NPC 问候语的社区转录。', 'B', 'S22', 'contextual'),
   quote('magni_well', 'Ye did well, champion.', '做得好，勇士。', '魔兽世界 争霸艾泽拉斯', 'Azerite Wounds 世界任务完成对白的首句。', 'B', 'S23', 'contextual'),
  ], [example('level_up', '勇士，又进步了！这份努力值得好好庆祝。'), example('gold_summary', '勇士，账本已经整理好了。先看看这一趟的收入和开销，再安排下一步。')]),
 character('ragnaros', '拉格纳罗斯', '熔火之心炎魔之王的戏剧风格',
  '短促、强势、夸张，使用烈焰与熔炉意象。适合低频彩蛋，不适合作为全天高强度播报。',
  '重音夸张但控制峰值音量，不复刻刺耳的吼叫。',
  '玩家死亡时改用原创恢复句。对敌人的侮辱语不直接转向用户。', [
   quote('ragnaros_soon', 'TOO SOON!', '太早了！', '魔兽世界 熔火之心', '被埃克索图斯唤醒时的开场对白短节选。', 'B', 'S24', 'manual_only'),
   quote('ragnaros_insect', 'Die, Insect!', '死吧，虫子！', '魔兽世界及风暴英雄宣传', '官方英雄专题直接署名；社区记录其击杀玩家情境。', 'A+B', 'S25 S24', 'reference_only'),
  ], [example('level_up', '新的力量已经铸成！让下一次挑战见识你的成长！'), example('death', '炉火尚未熄灭。先修整，再点燃下一次尝试。')]),
 character('uther', '乌瑟尔·光明使者', '生前圣骑士导师形象',
  '庄重、克制，鼓励责任与守护同伴。语气像可靠导师，少做训诫。',
  '稳重中慢速，停顿充分，温和而清楚。',
  '本页短引来自炉石，不能改标为 WoW 台词。与暗影界阶段分别设定。', [
   quote('uther_honor', 'I will fight with honor!', '我将以荣誉而战！', '炉石传说 默认圣骑士英雄', '乌瑟尔的开场语。', 'B', 'S26', 'contextual'),
   quote('uther_met', 'Well met!', '幸会！', '炉石传说 默认圣骑士英雄', '问候表情语；并非角色独有表达。', 'B', 'S26', 'contextual'),
  ], [example('death', '一次失利不会抹去你的努力。整理好装备，我们仍能守住下一道防线。'), example('equipment_offer', '这件装备的装等更高。请先核对属性，再在游戏里决定是否换上。')]),
 character('anduin', '安度因·乌瑞恩', '温和牧师与年轻领袖的陪伴方向',
  '温和、诚恳，先照顾感受再给建议。使用希望与圣光意象，但不许诺必胜。',
  '清楚、柔和的中速；鼓励有分寸，避免过度感伤。',
  '不要把炉石威胁表情当作日常人设。不同剧情时期的创伤与成长需分开处理。', [
   quote('anduin_victory', 'The Light shall bring victory!', '圣光将带来胜利！', '炉石传说 默认牧师英雄', '安度因的对局开场语。', 'B', 'S28', 'contextual'),
   quote('anduin_burn', 'The Light shall burn you!', '圣光将灼烧你！', '炉石传说 默认牧师英雄', '威胁表情语。中文社区常用“圣光会制裁你”指称它。', 'B', 'S28', 'manual_only', '本文译文不等于已核验的国服字幕；不要误归到乌瑟尔。'),
  ], [example('death', '先缓一缓吧。一次失败不会抹去你已经走过的路。'), example('level_up', '又向前一步了。愿这份成长，让接下来的旅途轻松一些。')]),
]

MEMES = [
 dict(id='meme_illidan_localization', term='你们这是自寻死路', kind='community_documented_localization', character_ids=['illidan'], source_ids=['S29'],
      explanation='社区条目将其记为燃烧的远征简中片头的经典意译。本次没有对照国服原片音轨，因此不标为“已核验官方中文”。', usage='与英文原句关联保存，但不要把两个中文版本合并成同一条精确字幕。'),
 dict(id='meme_magni_woons', term='WOONS', kind='community_meme', character_ids=['magni'], source_ids=['S22'],
      explanation='玩家模仿麦格尼说 wounds 的口音，并调侃反复出现的艾泽里特世界任务。不是一条固定的官方中文台词。', usage='怀旧或玩梗模式低频使用。中文新增句子标为二创，例如“勇士，艾泽拉斯还在等你！”'),
 dict(id='meme_bubble_hearth', term='无敌炉石', kind='player_terminology', character_ids=[], source_ids=['S30'],
      explanation='圣骑士玩法术语，英文称 Bubble Hearth。暴雪经典硬核服规则专门讨论并限制该组合；不是乌瑟尔专属名言。', usage='可用作回城、休息的笑话。具体版本与技能可用性另查，不由这个梗推断可执行操作。'),
 dict(id='meme_more_dots', term='More dots!', kind='player_audio_meme', character_ids=[], source_ids=['S31'],
      explanation='来自玩家团队语音及奥妮克希亚灭团动画相关传播。DoT 指持续伤害，不应机械译成“更多点”。', usage='归入玩家梗库，不分配给奥妮克希亚或其他 NPC 作为原台词。'),
 dict(id='meme_times_change', term='时代变了', kind='quote_derived_meme', character_ids=['garrosh'], source_ids=['S17','S19'],
      explanation='加尔鲁什的短句被梗化使用。带“大人”等扩写的版本不在本次核对的英文原句内。', usage='升级或装备变化时可偶尔引用。原句与扩写应保存为不同条目。'),
 dict(id='misattribution_king', term='王权没有永恒', kind='attribution_correction', character_ids=['arthas'], source_ids=['S32'],
      explanation='在巫妖王结局的父子场景中，这句话由泰瑞纳斯对阿尔萨斯说。不能因画面主角是阿尔萨斯，就标成他的原话。', usage='可作为剧情知识条目；不放进阿尔萨斯的可自动引用台词池。'),
]

RULES = {
 'status': 'design_proposal_not_implemented',
 'style_profiles_are_editorial': True,
 'all_chinese_quote_translations': 'editorial_translation_not_verified_zhCN_audio',
 'original_line_label': 'original_companion_line',
 'suggested_defaults': {'quote_probability_in_casual_chat': 0.10, 'max_quotes_per_response': 1,
    'same_quote_cooldown_minutes': 30, 'meme_mode': False, 'faction_slogans': 'opt_in'},
 'cooldown_scope': 'Decorative quotations only. Do not suppress required equipment confirmation text.',
 'equipment_action': 'Keep the current in-game confirmation flow. Persona changes wording only.',
 'source_validation': 'A = official text; A索引 = official indexed excerpt; B = community transcript, sometimes paired with an official video. No claim of direct audio review.',
 'asset_status': 'No avatar model, actor voice recording, or asset permission is supplied by this reference.',
}

def validate():
    assert len(CHARACTERS) == 12
    assert sum(len(c['quotes']) for c in CHARACTERS) == 24
    ids = [q['id'] for c in CHARACTERS for q in c['quotes']]
    assert len(ids) == len(set(ids))
    budget = defaultdict(int)
    for c in CHARACTERS:
        for q in c['quotes']:
            assert all(s in SM for s in q['source_ids'])
            for s in q['source_ids']:
                budget[s] += len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", q['text_en']))
    assert max(budget.values()) <= 25, dict(budget)
    assert all(s in SM for m in MEMES for s in m['source_ids'])
    return dict(budget)

def build_pdf():
    pdfmetrics.registerFont(TTFont('YaHei', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
    pdfmetrics.registerFont(TTFont('YaHeiBold', 'C:/Windows/Fonts/msyhbd.ttc', subfontIndex=0))
    pdfmetrics.registerFontFamily('YaHei',normal='YaHei',bold='YaHeiBold',italic='YaHei',boldItalic='YaHeiBold')
    ink, muted, teal = colors.HexColor('#16282e'), colors.HexColor('#52636b'), colors.HexColor('#176c69')
    styles = {
      'title': ParagraphStyle('Title',fontName='YaHeiBold',fontSize=24,leading=33,textColor=ink,spaceAfter=14,wordWrap='CJK'),
      'h1': ParagraphStyle('H1',fontName='YaHeiBold',fontSize=18,leading=26,textColor=ink,spaceAfter=12,wordWrap='CJK'),
      'h2': ParagraphStyle('H2',fontName='YaHeiBold',fontSize=14,leading=20,textColor=ink,spaceBefore=5,spaceAfter=5,wordWrap='CJK'),
      'body': ParagraphStyle('Body',fontName='YaHei',fontSize=10,leading=16,textColor=ink,spaceAfter=7,wordWrap='CJK'),
      'small': ParagraphStyle('Small',fontName='YaHei',fontSize=8.7,leading=13,textColor=muted,spaceAfter=5,wordWrap='CJK'),
      'quote': ParagraphStyle('Quote',fontName='YaHeiBold',fontSize=10.5,leading=16,textColor=teal,spaceAfter=2,wordWrap='CJK'),
      'en': ParagraphStyle('English',fontName='YaHei',fontSize=8.7,leading=12,textColor=muted,spaceAfter=3,wordWrap='CJK'),
      'cell': ParagraphStyle('Cell',fontName='YaHei',fontSize=9,leading=14,textColor=ink,wordWrap='CJK'),
      'cellhead': ParagraphStyle('CellHead',fontName='YaHeiBold',fontSize=9,leading=14,textColor=colors.white,wordWrap='CJK'),
      'code': ParagraphStyle('Code',fontName='YaHei',fontSize=9.2,leading=15,textColor=ink,spaceAfter=7,wordWrap='CJK'),
      'sourcehead': ParagraphStyle('SourceHead',fontName='YaHei',fontSize=9.2,leading=13,textColor=ink,spaceAfter=2,wordWrap='CJK'),
      'sourcedetail': ParagraphStyle('SourceDetail',fontName='YaHei',fontSize=8.2,leading=12,textColor=muted,spaceAfter=4,wordWrap='CJK'),
    }
    def p(text, style='body'):
        return Paragraph(text, styles[style])
    def refs(sids):
        return ' '.join(f'<a href="{escape(SM[s]["url"],quote=True)}" color="#176c69">[{s}]</a>' for s in sids)
    def table(rows, widths):
        t=Table([[p(escape(str(x)), 'cellhead' if i==0 else 'cell') for x in row] for i,row in enumerate(rows)],colWidths=widths,hAlign='LEFT',repeatRows=1)
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),teal),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f2f6f6')]),('GRID',(0,0),(-1,-1),0.45,colors.HexColor('#d4dfe0')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        return t
    def header_footer(canvas, doc):
        canvas.setStrokeColor(colors.HexColor('#d4dfe0'));canvas.setLineWidth(.5)
        canvas.line(46, A4[1]-38, A4[0]-46, A4[1]-38)
        canvas.setFont('YaHei',8);canvas.setFillColor(muted)
        canvas.drawString(46,A4[1]-28,'魔兽世界角色语料  /  AIRI 陪伴开发参考')
        canvas.drawString(46,27,'资料核对 2026.10.24   ·   中文台词为本文译写，原声措辞待核验')
        canvas.drawRightString(A4[0]-46,27,str(doc.page))
    story=[]
    story += [p('魔兽世界经典角色语录<br/>与陪伴人设','title'),p('12 位角色 · 24 条代表短句 · 6 项梗与归属辨析','h2'),
        p('这份资料用于未来为 AIRI 选择魔兽经典形象，并让日常聊天、升级祝贺和装备提醒带有对应语气。每位角色保留两条短句作为识别锚点，同时给出原创陪伴示例，避免每次回应都重复名言。'),
        p('范围包含魔兽世界、魔兽争霸 III，以及炉石和风暴英雄中的同一角色。跨作品条目已标明。本稿是语料与开发建议，不代表形象切换功能已经实现。'),
        p('人物速查','h2')]
    rows=[['人物','建议陪伴方向','主要语言特征']]
    short=[('希尔瓦娜斯','冷峻游侠','克制、警觉、轻微冷讽'),('阿尔萨斯','巫妖王风格','庄重、简短、寒冰意象'),('伊利丹','坚定教练','准备、选择、承担'),('萨尔','沉稳伙伴','平等、责任、元素意象'),('吉安娜','理性法师','观察、分析、冷幽默'),('瓦里安','坚定领袖','行动、守护、鼓舞'),('加尔鲁什','热血督战','直截了当、挑战、气势'),('卡德加','睿智导师','证据、好奇、冷笑话'),('麦格尼','热情代言人','勇士称呼、庆祝、恳切'),('拉格纳罗斯','炎魔彩蛋','烈焰意象、短促、夸张'),('乌瑟尔','圣骑士导师','荣誉、责任、守护'),('安度因','温和伙伴','关怀、希望、分寸')]
    story += [table(rows+short,[104,130,269]),Spacer(1,11),p('怎样阅读这份资料','h2'),
      p('<b>A</b> 表示官方文字直证；<b>A索引</b> 表示可见官方检索摘要，正文抓取受限；<b>B</b> 表示社区转录，部分另附官方影片入口。没有把视频链接当成已听审音轨。','small'),
      p('所有中文短句均标为整理者译写，不声称逐字匹配国服字幕。人物风格和“原创陪伴示例”是本稿的创作建议。来源编号可点击，末尾附完整索引。','small'),PageBreak()]

    use_labels={'contextual':'情境合适时可用','manual_only':'用户点梗时使用','reference_only':'收藏参考 默认不播'}
    for idx,c in enumerate(CHARACTERS):
        block=[p(c['name_zh'],'h1'),p(f'{escape(c["persona_era"])}  ·  人设方向为编辑提炼','small'),p(escape(c['tone'])),p('代表短句','h2')]
        for q in c['quotes']:
            block += [p('“'+escape(q['text_zh'])+'”','quote'),p(escape(q['text_en']),'en'),
                p(f'{escape(q["work"])}。{escape(q["context"])} <b>{escape(q["evidence"])}</b> {refs(q["source_ids"])}','small'),
                p(f'使用建议：{use_labels[q["use_mode"]]}。'+escape(q['note']),'small')]
        block += [p('原创陪伴示例','h2')]
        ev={'level_up':'升级','death':'死亡后','equipment_offer':'更高装等候选','map_change':'进入新区域','gold_summary':'查看金币汇总'}
        for e in c['original_examples']:
            block.append(p(f'<b>{ev[e["event"]]}</b>　{escape(e["text"])}','small'))
        block += [p('语音方向：'+escape(c['delivery']),'small'),p('适配注意：'+escape(c['adaptation_note']),'small')]
        story.append(KeepTogether(block))
        if idx%2==0: story.append(Spacer(1,18))
        else: story.append(PageBreak())

    story += [p('玩家梗与归属辨析','h1'),p('这些条目补充文化语境。“经典”不等于角色独有，“常见”也不代表本次做过热度排行或最早出处考证。')]
    for m in MEMES:
        story += [p(m['term'],'h2'),p(escape(m['explanation'])+' '+refs(m['source_ids'])),p('入库建议：'+escape(m['usage']),'small')]
    story += [p('额外归属提醒','h2'),p('安度因的炉石威胁表情对应第 7 页的英文短句，不应归给乌瑟尔。“为了圣光”一类职业风格词，也不能在没有证据时标成某位人物的独占名言。 '+refs(['S28']), 'small'),PageBreak()]

    story += [p('未来在 AIRI 中怎样使用','h1'),p('优先做角色语气，再添加少量名言。形象、说话风格和声音分别配置，允许用户只换其中一项。以下都是后续开发建议。'),
      p('角色预设','h2'),p('设置页可提供人物、剧情时期、台词强度和玩梗开关。阿尔萨斯至少区分青年王子与巫妖王；希尔瓦娜斯和吉安娜也应固定一个人格阶段，避免同一段对话混用互相冲突的立场。'),
      p('三层内容','h2'),p('第一层是本稿的少量短引，保存原文与出处；第二层是明确标为原创的事件句；第三层是词汇、句长、幽默程度等语气规则。大多数回应采用第二、三层，名言作为点缀。'),
      table([['场景','适合的处理'],['普通聊天','保留角色语气，偶尔引用；不要在每句开头加称号。'],['升级与探索','原创祝贺或好奇的观察；不捏造刚解锁的技能、任务或奖励。'],['角色死亡','先鼓励休整；不使用威胁、贬低或“你自找的”式句子。'],['更高装等装备','准确说出装等比较与选择提示；名言不能替代确认文本。'],['战斗免打扰','沿用现有规则；不为了一句梗强行插播。'],['金币汇总','按实际账本解释流入和流出；不因角色风格捏造收益。']],[112,391]),
      Spacer(1,10),p('建议的初始频率','h2'),p('日常聊天可从 10% 的名言点缀概率开始，每次至多一句，同一句 30 分钟内不重复。玩梗默认关闭，阵营口号单独选择。这些数值是待实测的产品建议，不是当前程序设置。'),
      p('冷却只约束装饰性台词。装备询问等必要信息仍须完整显示，不能因为台词冷却被吞掉。用户连续受挫或主动关闭玩梗时，使用朴素鼓励。'),
      p('装备提示如何衔接','h2'),p('游戏候选数据 → 角色文案格式化 → 语音或文字气泡 → 用户选择 → 游戏内确认。当前装备提醒直接朗读固定文本，后续可在这一步加入人物文案。保留原有语音结束后选择、10 秒关闭、失效取消和游戏内确认规则。'),
      p('措辞必须区分“装等更高”和“空槽可用”。套装、特效与属性收益未计算时，不能借角色口吻断言伤害一定提高。'),PageBreak()]

    story += [p('提示词与数据结构示例','h1'),p('下面的提示词是原创开发草案。它描述表达风格，不应让角色设定覆盖游戏事实、用户选择或程序动作规则。'),
      p('伊利丹风格提示词草案','h2'),
      p('你采用伊利丹式的坚定、简洁语气陪伴用户。强调准备、选择与承担，保留用户的决定权。默认使用原创中文短句。只在上下文合适且通过冷却检查时，引用提供的短句 ID；不要把新编句子称为官方台词。','code'),
      p('以输入的角色、地图和装备数据为事实依据。未知信息直接说未知。用户死亡时给予克制鼓励，不责备用户。装备候选只描述实际装等或空槽原因，明确请用户在游戏内确认，不能说已经替用户换装。','code'),
      p('记录结构','h2'),
      table([['字段','用途'],['id / persona_era','稳定人物 ID 与明确的人格时期'],['quotes','英文短引、中文译写、作品场景、证据与来源编号'],['use_mode','情境可用、仅用户点梗、仅收藏参考'],['original_examples','按事件标注原创陪伴句，和原台词分开'],['tone / delivery','语言风格与普通 TTS 表达方向'],['avatar_asset / voice_profile','未来资源绑定；本稿设为 null，不冒充已有模型'],['sources','可追溯来源 URL、资料类别、核对方法与日期']],[155,348]),
      Spacer(1,12),p('未来实现时的检查','h2'),
      p('① 切换角色后，正文、字幕和语音采用同一人物设定。② 同一句不反复触发。③ 玩家梗不会被标为原台词。④ 无语音配置时仍能显示人物文案。⑤ 更换人物不会改变金币、装备判断和游戏内确认结果。'),
      p('本文附带 JSON 是研究语料，不是 AIRI 当前可直接导入的配置格式。需要新增加载、筛选和提示词注入逻辑后才能使用。'),
      p('资料与资源边界','h2'),p('本稿提供短句引用、出处和原创改写，没有附带角色模型或原声录音。后续选择可使用的形象资源和语音配置，并补充对应国服版本的字幕核对。角色资料中的链接仅作参考来源。'),PageBreak()]

    # Split the source index into two predictable pages, keeping every entry readable.
    for start in (0,16):
        story += [p('来源索引' + (' 续' if start else ''),'h1'),p('点击条目打开来源。所有条目的核对日期为 2026-10-24；索引可读不等于已听审视频配音。','small')]
        for s in SOURCES[start:start+16]:
            story += [KeepTogether([p(f'<b>{s["id"]}</b>  <a href="{escape(s["url"],quote=True)}" color="#176c69">{escape(s["title"])}</a>','sourcehead'),p(escape(s['verification']),'sourcedetail'),Spacer(1,2)])]
        if start==0:story.append(PageBreak())
    PDF.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(PDF),pagesize=A4,rightMargin=46,leftMargin=46,topMargin=51,bottomMargin=47,
                          title='魔兽世界经典角色语录与陪伴人设',author='魔兽陪伴项目资料整理')
    doc.build(story,onFirstPage=header_footer,onLaterPages=header_footer)

def main():
    budget=validate()
    payload=dict(schema_version=1,title='魔兽世界经典角色语录与陪伴人设',checked_on=DATE,
                 status='research_reference_not_airi_config',characters=CHARACTERS,memes=MEMES,
                 adaptation_rules=RULES,sources=SOURCES,english_quote_words_by_source=budget)
    DATA.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    build_pdf()
    print(f'Wrote {PDF}')
    print(f'Wrote {DATA}')
    print(f'12 characters, 24 quotes, {len(MEMES)} meme/correction entries, {len(SOURCES)} sources')

if __name__=='__main__':main()
