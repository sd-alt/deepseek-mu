# DeepSeek++ Mobile Userscript

原项目是deepseek-pp ，这是二改版，这是给网页端准备的轻量版 DeepSeek++。它不是 Chrome 扩展，而是 userscript，可以在安卓浏览器里通过脚本管理器运行。

## 功能

- 本地长期记忆注入
- 明确记忆指令直存：`记住：...`、`帮我记一下 ...`、`以后记得 ...`
- 指令块直存：`[System Directive]...[/System Directive]`、`[系统指令]...[/系统指令]`
- `/skill` 触发内置或自定义 Skill
- `/project-setup` 自动归档大段项目设定到规则、预设和常驻记忆
- 多窗口项目隔离：新窗口按输入自动匹配项目，老窗口沿用原项目规则/预设/记忆
- 系统提示词预设
- 项目规则模块：固定注入创作设定、风格、输出格式和边界说明
- WebDAV 同步：同步记忆、Skill、预设和移动端项目规则
- Expert 模式开关
- DeepSeek 回复中的 `memory_save`、`memory_update`、`memory_delete` 自动执行
- 页面右下角 `D+` 悬浮按钮管理数据
- 导入/导出本地数据

## 安卓安装方式

推荐任选一种：

1. Firefox Android + Tampermonkey/Violentmonkey
2. Kiwi Browser + Tampermonkey
3. Lemur Browser + Tampermonkey

安装脚本管理器后，新建脚本，把 `deepseek-pp-mobile.user.js` 的内容粘进去并保存。然后打开：

```text
https://chat.deepseek.com/
```

页面右下角出现 `D+` 按钮即表示已启用。

## 使用

- 点 `D+` 打开管理面板
- 在“记忆”里手动添加记忆，或让 AI 自动保存
- 输入 `记住：我喜欢简洁一点的回答` 会直接保存到 DeepSeek++ Mobile 本地记忆库
- 输入 `[System Directive]...[/System Directive]` 这类指令块会保存成常驻项目规则
- 明确记忆会自动粗分类型：偏好/输出规则归为反馈，身份信息归为用户，链接资料归为参考，其余归为话题
- “常驻注入”的记忆会每次对话优先带上，适合身份、固定偏好、长期规则；普通记忆会按当前问题相关度带上
- 在“规则”里启用项目规则后，每次请求都会先注入这段项目级提示词
- 在“设置”的 WebDAV 同步里填写地址、用户名、密码和远程路径，然后按需要选择合并、上传或拉取
- 在输入框开头输入 `/` 会弹出 Skill 候选
- 粘贴大段项目设定时，可以用 `/project-setup 你的完整设定`，脚本会自动保存到“规则”“预设”和“常驻记忆”
- 新窗口第一条输入会按关键词匹配已保存项目；匹配后会绑定到 DeepSeek 链接里的 `/s/<会话ID>`，之后该窗口固定使用对应项目规则、预设和项目记忆
- 例如输入：

```text
/frontend-design 做一个手机端登录页
```

项目设定示例：

```text
/project-setup 人生模拟游戏
请基于以下内容为我生成一个高自由度的人生模拟游戏。
背景
...
```

保存后：

- “规则”会启用项目级长期设定
- “预设”会新增一个启动预设
- “记忆”会新增一条常驻项目摘要

## 和桌面扩展版的区别

- 没有 Chrome extension background service worker
- 数据保存在脚本管理器/浏览器本地，不是 DeepSeek 官方账号记忆，也不会自动同步到桌面扩展版
- WebDAV 同步依赖脚本管理器支持 `GM_xmlhttpRequest`，推荐 Tampermonkey/Violentmonkey
- 没有独立侧边栏，改成网页内底部面板

项目规则模块用于管理合法创作项目的固定设定、风格和格式要求，不用于绕过平台或模型的安全规则。

## WebDAV 同步

同步会在远程路径下读写这些文件：

```text
memories.json
skills.json
presets.json
mobile-state.json
```

前三个文件尽量兼容桌面扩展；`mobile-state.json` 保存安卓移动版的项目规则。密码会保存在脚本管理器/浏览器本地，建议使用 WebDAV 服务的应用密码。

同步按钮含义：

- `合并同步`：本地和云端按更新时间合并，适合多端都新增了数据的情况。
- `上传覆盖`：用本地数据覆盖云端，适合你在手机上删改后，希望云端也按手机为准。
- `拉取覆盖`：用云端数据覆盖本地，适合换手机、重装浏览器后恢复数据。

如果你刚删除了某些记忆，不要用“合并同步”，否则云端旧数据可能又回来；应该用“上传覆盖”。

清除浏览器数据或卸载脚本管理器前，建议先在“设置”里导出数据。
