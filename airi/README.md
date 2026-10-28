# 魔兽陪伴精灵

Windows 桌面端，提供魔兽世界角色陪伴、模型聊天、语音字幕和插件管理。

## 使用

1. 在同级 `WOWAddons` 目录运行 `Start-WoWCompanion.cmd`。
2. 打开设置，配置聊天模型、语音服务和角色形象。软件无需账号登录。
3. 在“魔兽世界正式服”或“魔兽世界：无限”中开启游戏陪伴。
4. 在“魔兽插件中心”中配置 CurseForge API Key 和各版本游戏目录，浏览并安装插件。

详细说明见同级 `WOWAddons/魔兽陪伴精灵-使用说明.html` 和 `WOWAddons/wow-companion-implementation.html`。

## 开发

使用仓库指定的 Node.js 和 pnpm 版本，安装依赖后运行：

```powershell
pnpm -F @proj-airi/i18n build
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm -F @proj-airi/stage-tamagotchi build
```

源目录名、工作区包名、通信协议和存储标识保持稳定，现有用户无需迁移模型配置和角色资料。

## 开源许可

保留 [MIT 许可证](LICENSE) 以及各组件的版权与许可证。第三方组件继续遵循原许可证。

项目地址：https://github.com/LoveWood233/wow-airi-companion
