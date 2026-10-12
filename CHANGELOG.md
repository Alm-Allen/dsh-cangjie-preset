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
