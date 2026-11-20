-- Source: OpenMap v0.8.5 map label ranges in docs/wow-forever-map-level-ranges.md.
-- These bounds are the same as the world map hover labels.
-- Refresh with tools/update_exploration_levels.py. Missing levels stay absent.
local _, ns = ...
ns.ExplorationLevels = {
    [1420] = { min = 1, max = 10 }, -- 提瑞斯法林地
    [1426] = { min = 1, max = 10 }, -- 丹莫罗
    [1429] = { min = 1, max = 10 }, -- 艾尔文森林
    [1421] = { min = 10, max = 20 }, -- 银松森林
    [1432] = { min = 10, max = 20 }, -- 洛克莫丹
    [1436] = { min = 10, max = 20 }, -- 西部荒野
    [1433] = { min = 15, max = 25 }, -- 赤脊山
    [1431] = { min = 18, max = 30 }, -- 暮色森林
    [1424] = { min = 20, max = 30 }, -- 希尔斯布莱德丘陵
    [1437] = { min = 20, max = 30 }, -- 湿地
    [1416] = { min = 30, max = 40 }, -- 奥特兰克山脉
    [1417] = { min = 30, max = 40 }, -- 阿拉希高地
    [1434] = { min = 30, max = 45 }, -- 荆棘谷
    [1418] = { min = 35, max = 45 }, -- 荒芜之地
    [1435] = { min = 35, max = 45 }, -- 悲伤沼泽
    [2548] = { min = 35, max = 45 }, -- 河林
    [1425] = { min = 40, max = 50 }, -- 辛特兰
    [1427] = { min = 45, max = 50 }, -- 灼热峡谷
    [1419] = { min = 45, max = 55 }, -- 诅咒之地
    [1428] = { min = 50, max = 58 }, -- 燃烧平原
    [1422] = { min = 51, max = 58 }, -- 西瘟疫之地
    [1423] = { min = 53, max = 60 }, -- 东瘟疫之地
    [1430] = { min = 55, max = 60 }, -- 逆风小径
    [1411] = { min = 1, max = 10 }, -- 杜隆塔尔
    [1412] = { min = 1, max = 10 }, -- 莫高雷
    [1438] = { min = 1, max = 10 }, -- 泰达希尔
    [1439] = { min = 10, max = 20 }, -- 黑海岸
    [1413] = { min = 10, max = 25 }, -- 贫瘠之地
    [1442] = { min = 15, max = 27 }, -- 石爪山脉
    [1440] = { min = 18, max = 30 }, -- 灰谷
    [1441] = { min = 25, max = 35 }, -- 千针石林
    [1443] = { min = 30, max = 40 }, -- 凄凉之地
    [1445] = { min = 35, max = 45 }, -- 尘泥沼泽
    [1444] = { min = 40, max = 50 }, -- 菲拉斯
    [1446] = { min = 40, max = 50 }, -- 塔纳利斯
    [1447] = { min = 45, max = 55 }, -- 艾萨拉
    [1448] = { min = 48, max = 55 }, -- 费伍德森林
    [1449] = { min = 48, max = 55 }, -- 安戈洛环形山
    [1450] = { min = 55, max = 60 }, -- 月光林地
    [1451] = { min = 55, max = 60 }, -- 希利苏斯
    [1452] = { min = 55, max = 60 }, -- 冬泉谷
    [2521] = { min = 1, max = 12 }, -- 泽风岛
}
