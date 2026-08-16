# VSCode 扩展开发经验文档

## Goal

把当前仓库 Claude Task Monitor (CTM) 的开发经验整理成一份**可复用的指南文档**,作为后续开发其他 VSCode 扩展的模板。文档不是 CTM 的开发手册,而是一份从 CTM 提炼出来的"扩展开发 SOP"。

## Scope

**In scope** — 文档必须包含以下 5 个章节,每章都要有可执行的命令和真实的踩坑记录:

1. **项目结构与初始化** — 仓库结构、关键文件、`package.json` 关键字段
2. **开发流程** — 写代码、本地调试、`.vscode/launch.json` + `.vscode/tasks.json` 配置
3. **测试** — 单元测试(vitest)、集成测试(@vscode/test-electron)、CI 策略
4. **发布到 Open VSX** — `vsce package` 打 `.vsix`、手动上传、命名空间认领、token 配置
5. **发布到 GitHub Release** — 打 tag、`gh release create`、附 `.vsix` 资产
6. **工具栈清单** — pnpm / tsup / vitest / vsce / chokidar 等,每项一句话注解"为什么用它"

**Out of scope** — 以下内容**不**写进文档,避免和 CTM 业务耦合:

- CTM 的具体业务功能(三态徽标、hook.sh、liveness 检测等)
- CTM 的架构选型理由(reducer、chokidar 等只在"为什么这样选"出现一句)
- 国际化、市场营销素材
- 其它注册市场(Microsoft Marketplace、JetBrains 等)

## Constraints

- **基于真实仓库**: 文档里的每条命令、每个文件路径都必须能在 CTM 仓库里找到出处;不可虚构配置项
- **可复用性**: 读这份文档应该能克隆出第二个扩展仓库并跑通 `build → test → publish`,而不是只复述 CTM
- **中文为主,技术术语保留英文**: 遵循 [[user_language]] 的偏好
- **决策点要有"为什么"**: 不只是"用 tsup",而是"用 tsup,因为 esbuild 后端、零配置支持 vscode external、产物单文件易分发"
- **踩坑必须留痕**: CTM 实际踩过的坑(命名空间认领、`.vsix` 路由到 `packages/`、node16 迁移、test cleanup 漏 session 文件等)必须写进"踩坑"或"注意事项"段落,不能只写 happy path

## Acceptance Criteria

- [x] 文档存在,且路径明确(放在仓库根目录 `VSCODE-EXT-DEV.md`)
- [x] 6 个章节齐全,每个章节有"操作步骤 / 命令 / 注意事项"三层
- [x] 命令清单可直接 `pnpm install && pnpm build && pnpm test` 跑通
- [x] 发布章节包含 Open VSX 的**命名空间认领**子流程(§4.6,走 Option 4 / Other 路径)
- [x] 工具栈清单列出 CTM 实际依赖,并标注每个工具是 `dependencies` / `devDependencies` / 全局工具(§6)
- [x] 至少 3 条"踩坑"条目(实际写了 11 条,从 CHANGELOG 和 git log 提取)
- [x] 不包含 CTM 业务专属内容(CTM 业务只在举例时一笔带过,文档是通用 SOP)
- [x] 文档末尾给出"基于本指南新建扩展"的最小清单(附录 A)

## Deliverables

- 一份 Markdown 文档 `VSCODE-EXT-DEV.md`(放在仓库根目录)
- 受众:自己参考 — 保留踩坑记录与决策原因,不追求对外通用化
- 文档末尾附加三个模块:
  - **最小骨架文件清单** — 新建扩展时的最小骨架,含必需文件、必填字段、必跑命令
  - **GitHub Actions 发布工作流示例** — `Open VSX + GitHub Release` 自动发布模式(CTM 暂未启用,作为"进阶"参考)
  - **vsce publish vs ovsx publish vs 手动上传** 决策树 — 什么时候用哪个

## Open Questions

(已与用户确认 — 见 Deliverables)

## Notes

- 本任务为**轻量任务** — PRD-only,不需要 `design.md` / `implement.md`
- 完成定义:文档可读 + 验收清单全打勾 + 用户认可
- 不动 CTM 业务代码