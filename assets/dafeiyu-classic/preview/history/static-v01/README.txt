大肥鱼 × 魔兽世界经典怀旧服八职业 / 外观初稿 v0.1

本批交付：8 张 1254 × 1254 RGBA 透明 PNG。内置 image_gen 分职业生成，保留上游角色底图的蓝渐变长发、蓝眼、鱼鳍耳、鲸尾、女仆头带与 Q 版比例。
打开 preview.html 可比较全部外观、切换深浅背景、查看 160px 尺寸。点击角色可看原图。

01 战士 — 愤怒 Battlegear of Wrath
02 猎人 — 巨龙追猎者 Dragonstalker Armor
03 法师 — 灵风 Netherwind Regalia
04 盗贼 — 血牙 Bloodfang Armor
05 圣骑士 — 审判 Judgement Armor
06 术士 — 复仇 Nemesis Raiment
07 牧师 — 卓越 Vestments of Transcendence
08 德鲁伊 — 怒风 Stormrage Raiment

范围：
这是面向外观评审的静态首版。装备为原版 Classic 60 级 T2 视觉元素的 Q 版改编，不是游戏模型精确导出。
尚无动作帧、透明 WebM、分层源文件、骨骼绑定或可直接导入的 pack.json。
实际制作动画时仍需统一画布、安全边距、角色缩放、脚底基线，并逐帧检查装备与尾巴一致性。
本轮未修改或部署 AIRI/游戏业务代码，未执行目标运行时联调。

开发接续：
HANDOVER.md 与相关源码确认桌面端已使用 DSH A/B 视频、2D Canvas 和透明 WebM。
原始动作接口与情绪文件名见 action-contract.reference.json。
generation-record.json 保存完整提示词、图片来源、版本与八职业清单。
validation.json 保存每张 PNG 的尺寸、真实 alpha 通道与透明像素检查结果。

来源：
https://github.com/LoveWood233/wow-airi-companion/blob/main/HANDOVER.md
https://github.com/PC2005-cloud/dsh-pet
角色底图版本：be4536da0ca71947058777d904874977ab9ab841
底图路径：dsh-pet/assets/main-character.png
职业套装名单参考：https://news.blizzard.com/en-gb/article/23764288/season-of-mastery-blackwing-lair-is-now-live

来源与授权记录：
dsh-pet 作者 PC2005-cloud；角色原型「溟月」出自上善无形，DeepSeek 女仆鲸鱼娘版设计出自 ZipZipPipe。
上游 README 将代码 MIT 与角色形象 CC BY-NC-SA 4.0 分别标注；本素材包保留该归属记录，不将角色权利作为 MIT 代码授权处理。
魔兽职业装备参考属于 Blizzard / World of Warcraft 的设计来源，本包不作独立权利授予。
