# 更新记录

按版本从新到旧。每段标题就是 tag 名（`## [2026.10.12] - 2026-10-12`）——推 tag 时由
`.github/workflows/release.yml` 把这一段抽出来当 Release 报告。
所以发版的规矩只有一条：**先在文件顶上补一段，再打标签**。抽不到那一段（或那一段是空的），
Release 就退回 GitHub 自动生成的提交清单。

版本号用日期式（`2026.10.12`），与 `package.json` 的 `version`、tag 名同号。

## [2026.10.12] - 2026-10-12

### 首次以 dsh 插件包发布

- 仓颉模式不再靠 `install-cangjie.ps1` 安装：本仓库就是一个 dsh 插件（bundle），
  `package.json` 的 `dsh.bundle.patch` 指向包内 `cordis.patch.yml`，后者 `insert` 一条
  `preset-cangjie` 声明。安装、更新、卸载全部交给 dsh 自己的插件管理（插件页，或
  `dsh plugin --profile <p> add github:Alm-Allen/dsh-cangjie-preset`）。
- 汉化层 `cangjie-zh.mjs` 搬进包内 `plugins/`，同时是包入口；预设内部那一行改成**包名**——
  预设里的行由挂载该预设的 Loader 以 profile 目录为解析基准，写相对路径会指向不存在的地方。
- 与 2026-10-12 那版素材逐字节一致：插件本体 261857 字节 / 1531 行 / 462 条映射，
  sha256 前 16 位 `C5BEC60984DE6EC5`。
- 自测与审计脚本（`self-test.mjs`、`audit-coverage.mjs`）一并进包，用法见 README。
- 旧的 ps1 安装器、素材与旧 README 已移出本仓库（收在检出目录里被 git 忽略的 `归档/` 下）。

### 改为覆盖原生 ptc 预设，不再新增预设条目

- `cordis.patch.yml` 从「`insert` 一条 `preset-cangjie` 声明」改成「按 Loader 行 id 覆盖
  `@deepseek-ai/dsh-web-app` 那份 `preset-ptc`」：顶层 `- id: preset-ptc` 且不带 `insert`，
  即 Loader 的 override 语义——替换既有行的字段，而 `config` 是**整体替换、绝不深合并**，
  所以 upstream 那份 `plugins` 列表必须完整重述。
- 效果：「设置 → Agent 预设」里仍只有原生的**PTC 模式**（`dsh-client-ui-agent-preset` 的
  `presetPtcName`），名字、位置、`config.id` 全部照旧，本包只换掉它加载的插件列表（多一个
  中文化层 `cangjie-zh`，persona 置空）。预设列表**不再多出条目**；停用或卸载本包即恢复原版。
  dsh 自己会在组合结果里标注归因：
  `# == @deepseek-ai/dsh-web-app, patched by @alm-allen/dsh-cangjie-preset`。
  与雅言模式的区别：雅言覆盖 `standard`（默认预设，装完即是中文），仓颉覆盖 `ptc`——
  它是可选预设，装完仍要在「设置 → Agent 预设」里把会话切到「PTC 模式」才用得上。
- 两版兼容（一份 patch 同时服务 0.2.0-rc.2 与 0.2.1-alpha.2），基准取 **0.2.0-rc.2** 的
  shipped 逐行重述。两版 shipped 的差异已核对：rc.2 有 `tool-subagent-codex` /
  `tool-subagent-claude-code` / `tool-ralph`（三行本来就 `disabled: true`，保留无害），
  persona 带 `suffix: Your working directory is {{cwd}}.`，没有 `time-context` /
  `tool-schedule`；alpha.2 没有那三行，改挂 `time-context` 与 `tool-schedule`，给两个 subagent
  行加了 `toolFilter`，persona 只有 `prefix`。
- `tool-schedule` **故意不收录**：rc.2 的包里没有 `@deepseek-ai/dsh-tool-schedule`（只有
  `dsh-schedule`），而一行引用不到的包会让整个预设激活失败、组不成会话。代价是 Desktop 上少
  一个 schedule 工具行（属可选能力，且 shipped 本身也对 subagent `deny` 了它）。`time-context`
  两版都有包故收录，Desktop 因此不比原生 PTC 模式少这项；alpha.2 的 `toolFilter` 未跟随——
  它在 rc.2 的 schema 里未必被接受，而不 deny 的唯一后果是 subagent 可能多看到几个 schedule
  工具，本文件根本没挂那几行。
- workflow / ralph 三行（`workflow-ptc` / `tool-workflow` / `tool-ralph`）**保持 shipped 的
  `disabled: true`**，与原生 PTC 模式逐行一致——PTC 模式下 `run_code` 本身就是编排面，官方
  引导文案也明说「当前 PTC 预设未启用 workflow 工具」。此前作为独立预设时 `workflow-ptc` 与
  `tool-ralph` 是**启用**的，本次改造按「纯中文化、不改功能面」的口径收回。三行不激活即不注册
  工具，提示词里不会产生对应段落，翻译层也不必为它们保留条目。
- 顺带补回了此前副本漏掉的 `tool-plugin-manager`，并删掉中文的 `name` / `description`，
  让显示名保持原生。
- 缓存与注入审查：`dsh-agent-loop` 的 `RuntimeContextProjection.project()` 拿「自己渲染出的
  文本」与「已落地文本」逐字比较，不等才追加一条 user 消息——两侧同源时恒等、永不重发，
  只改一侧就会每个 step 追加一条。本次改造没有触碰这条路径：汉化层改的是
  `system-prompt/assemble` 的渲染侧（落地即同一份文本），`translateMessage` 也只处理
  `<system-reminder>` 开头的注入块。新增的 `time-context` 走 `agent/pre-step` 追加独立 user
  消息、默认 10 分钟最小间隔，官方文档明确「仅追加；新可见内容位于可复用请求前缀之后，
  不会使现有 KV Cache 条目失效」，且其文本不经过翻译层。另外把 persona 置空顺带修掉了
  shipped 本身的缓存漏洞——原生 ptc 的 persona suffix 含 `{{cwd}}`，会让系统提示词随工作
  目录变化。
