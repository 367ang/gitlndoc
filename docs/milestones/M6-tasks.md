# M6 任务：第六章「历史锚点」+ 综合终章 F + 收官 UI

> 状态：**DONE**（全量交付：ch6 五关 + F 两关 + tag 引擎 + 成就/intro/结局/GitGraph 标签徽标）。
> 依据：`development-refinement.md` §13（M6 = 六章 + F-1/F-2、成就完善、intro/结局）、
> `game-design.md` §4（第六章与终章关卡表）、M5-tasks.md「遗留与移交」。

**本文档结构**

- [一、范围与交付](#一范围与交付)
- [二、开工前决策（用户裁定）](#二开工前决策用户裁定)
- [三、任务拆解与执行结果](#三任务拆解与执行结果)
- [四、验收 / 三门禁](#四验收--三门禁)
- [五、⚠️ 实测环境事实](#五-实测环境事实)
- [六、设计缺口（如实记录）](#六设计缺口如实记录)

## 一、范围与交付

| 批次 | 内容 | 状态 |
|---|---|---|
| 标签引擎 | `gitApi.createTag / listTags / deleteTag / resolveTagTarget / describe / pushTag`；`sandbox` 预置 `init.tags`（seedTags）；`targetState.tag` 判定转正；grammar/executor 的 `tag` / `show` / `describe`；push 的标签二义性解析 | ✅ |
| 第六章 5 关 | 6-1 轻量锚点 / 6-2 注解锚点 / 6-3 列出与查看 / 6-4 推送锚点 / 6-5 版本发布（全部 free 模式） | ✅ |
| 终章 2 关 | F-1 崩坏时间线（冲突+合并+历史只增）/ F-2 完整交付（空仓库起步 init→tag 全流程） | ✅ |
| 解锁收官 | `progression` 的 F 解锁 = 全部六章通关；ch6 回到逐级相邻 | ✅ |
| 成就 | 新增 `perfect-game`「完美通关」（全游戏 32 关 ★★★，GDD §5.3 的全游戏口径首次可判） | ✅ |
| 收官 UI | `IntroScreen` / `EndingScreen` 真实化（退役 ViewPlaceholder）；菜单结局入口（全部主线通关后出现） | ✅ |
| GitGraph | 提交图渲染标签徽标（注解实底星色 / 轻量描边） | ✅ |

## 二、开工前决策（用户裁定）

M6 开工前与用户确认三点，全部按建议采纳：

1. **成就完善 = 新增「完美通关」**：GDD §5.3 的全游戏口径，M3 时因章节未齐无法稳定判定，
   M6 终章落地后全游戏关卡集合固定（32 关），全游戏口径自此可用。
2. **intro / 结局真实化**：`ViewPlaceholder` 退役；`EndingScreen` 展示最终统计与收官叙事，
   菜单在全部主线通关后出现「进入结局」入口。
3. **GitGraph 显示标签徽标**：打完标签立刻在提交图可见，教学反馈闭环。

另有两项实施中的裁定（Lead 决定，理由入档）：

- **F 的解锁条件** = 全部六章主线通关（终章 F 可选挑战，不挡结局；F 通关与否只影响
  perfect-game 成就）。替代早前「F 恒锁」的占位规则。
- **`sandbox` 收尾检出位置** 新增显式字段 `LevelInit.stayOnBranch`：默认行为不变
  （预置完成后一律回 main，ch3/ch4 的测试锁定），F-1 显式声明「开局停在 feature」
  （风暴叙事 + `headBranch main` 开局不成立）。**不猜**：曾试过「最后一条预置在哪个
  分支就停哪」的隐式规则，实测破坏了 ch3-2 / ch3-3 / ch4-3 / 4-5 四关的既有前提，
  立即回滚为显式声明。

## 三、任务拆解与执行结果

### 阶段 0：基线与前置

- [x] 0.1 基线三门禁 —— **typecheck 0 / 378 passed / build 187.57 kB gzip**（与 M5b 记录一致）。
- [x] 0.2 探针实测 isomorphic-git 1.27 的 tag 行为（Node 直跑 + 项目内 vitest 真协议，见「实测环境事实」）。

### 阶段 1：标签引擎（`engine/`）

- [x] 1.1 `gitApi.createTag(name, { message?, target? })`：message 有 → `git.annotatedTag`
      （tagger 强制学习者身份）；无 → `git.tag`（轻量）。target 经 `resolveRefInternal`
      支持 ref 表达式（与 reset/revert 同源），缺省 HEAD；unborn 仓库明确拒绝。
- [x] 1.2 `gitApi.listTags()`：`{ name, shortHash, annotated, message? }`；注解读 `readTag().tag.object`
      （peel），轻量直接取 ref 值。
- [x] 1.3 `gitApi.deleteTag(name)`：先解析再删 —— isomorphic-git 的 deleteTag 对缺失 ref
      静默成功，先查一次才能给出对齐真 git 的 `tag '<名>' not found` 报错。
- [x] 1.4 `gitApi.resolveTagTarget(name)`：供 `git show` 与潜在判定用，返回 `{ oid, annotated } | null`。
- [x] 1.5 `gitApi.describe({ tags? })`：沿第一父链找最近的可达标签；落点即标签 → 干净标签名，
      否则 `<tag>-<n>-g<hash>`；缺省忽略轻量标签（真 git 语义），`--tags` 纳入。
- [x] 1.6 `gitApi.pushTag(remote, name)`：本地无该标签先报错（isomorphic-git 的 expand
      报错文案不友好）；ref 规范为 `refs/tags/<名>` 推送，旧标签重推由客户端报
      `PushRejectedError('tag-exists')`（真 git 的 already exists 同义）。

### 阶段 2：沙箱与判定

- [x] 2.1 `sandbox.reset` 支持 `init.tags`（seedTags）：`at` 按预置提交 message 定位
      （与 `seedRemote` 的「语义坐标」同款），message 缺省取 `msg`；`at` 找不到 → fail-fast。
      `DeferredInitField` 清空（机制保留为未来字段的样板）。
- [x] 2.2 `schema.validateInit`：`tags` 结构校验（名字合法性、重复声明、message 非空）
      + 跨字段校验（`at` 必须是本关预置提交信息）。
- [x] 2.3 `targetState` 实现 `tag` 判定（`exists` 正反两向）；`IMPLEMENTED_TARGET_TYPES`
      增至 11 种，`UNIMPLEMENTED_TARGET_TYPES` 清空 —— §4.3 的目标类型**全部实现**。
- [x] 2.4 `types.ts`：`LevelInit.tags` 注释补齐语义（`at` = 预置提交信息、`message` = 注解）；
      新增 `stayOnBranch`。

### 阶段 3：命令层（grammar / executor / completion）

- [x] 3.1 grammar：`tag`（list / create / delete 三形态；`-a` 无 `-m` 拒绝 —— 本游戏无编辑器；
      `-l` / `-s` / `-f` 明确「本版本不支持」）、`show`（仅标签）、`describe`（无参数 / --tags）。
- [x] 3.2 executor：三命令分发与真 git 风格回显（`已创建注解标签 v1.0.0（锚定 xxx）`、
      `已删除标签 v1.0（曾指向 xxx）`、show 的「标签名 → 指向提交 → 注解 → 提交摘要」结构、
      describe 的报错区分「无注解标签」与「轻量需 --tags」）。
- [x] 3.3 **push 的标签二义性**：`git push origin <名>` 先查标签表（`listTags`），
      命中即走 `pushTag`。⚠️ 不能用 `resolveRef` 判定 —— 它对未知名字按「完整引用名」回退，
      `v1.0` 会被解析到 `refs/tags/v1.0`，误把标签当成分支（实测踩到，见实测事实 8）。
- [x] 3.4 completion 词表补 `tag` / `show` / `describe` / `-d` / `-a` / `--tags`。

### 阶段 4：关卡与终章

- [x] 4.1 ch6.ts 五关（free 模式）；presets 补第七章叙事文件。
- [x] 4.2 final.ts 两关（free，★★★★★）；F-1 构造真分叉 + 双侧改信标（合并必然冲突）；
      F-2 用 `template: 'emptyRepo'` 从零起步。
- [x] 4.3 注册 ch6 / F；`playable: true`。
- [x] 4.4 「开局不得即达标」复查（通用断言）抓到 3 处初版设计缺陷并修正：
      6-3 的 `commitCount eq 3` 开局即真 → 改「归档第四阶段 + 命名 v1.1.0」；
      6-4 初版两个判据皆开局即真 → 重构为「定稿归档 + 标签创建」推进项；
      F-2 的 `file` 判据因预置文件开局即真 → 改为玩家亲手创建清单（不预置文件）。
      F-1 的 `headBranch main` 开局即真 → `stayOnBranch: 'feature'`。
- [x] 4.5 F-1 的冲突构造：main 侧「主线观测推进」同时改写信标（漂移版），feature 侧失真版
      —— 两边都改且内容不同，merge 必然冲突（实测验证：两侧都改同一文件才有冲突；
      只有 feature 一侧改过会安静三方合并）。

### 阶段 5：解锁 / 成就 / 收官 UI / GitGraph

- [x] 5.1 `progression.isChapterUnlocked('F')` = 全部六章 `isChapterCleared`。
- [x] 5.2 `perfect-game` 成就：`AchievementContext` 增 `gameStars` / `gameLevelCount`
      （未提供时恒不可得，向后兼容）；LevelComplete 结算时取全游戏星级传入。
- [x] 5.3 `IntroScreen`（三段世界观）与 `EndingScreen`（收官叙事 + 最终统计）；
      App.tsx 接线；MenuScreen 加结局入口（`isChapterUnlocked('F')`）；routes 清理 `M1_VIEWS`；
      删除 `ViewPlaceholder`。
- [x] 5.4 GitGraph：`buildGraphLayout` 第三参收标签清单 → `tagsByHash`；
      `readGraph` 并行采集 `listTags`（失败不阻断整图）；徽标渲染（注解实底星色 / 轻量描边）。

### 阶段 6：测试与冒烟

- [x] 6.1 单测更新（ch6/F 注册、targets 名单、completion 词表、MenuScreen 成就数 5→6、
      executor 白名单收缩、progression 的 F 规则、schema 的 tags 校验）。
- [x] 6.2 新增用例：
      - `targetState.test.ts`：tag 判定三连（创建前/后、注解+轻量、大小写敏感）；
      - `executor.test.ts`：M6 专项 8 例（轻量/注解创建、重复拒绝、空仓库拒绝、
        锚定历史提交、-d 删除、show 输出、describe 三态、`--tags` 语义、push 标签二义性真协议）；
      - `levels.test.ts`：ch6/F 注册与走通用例（7 关全部参考解法过关）、6-4 裸仓
        `refs/tags` 事实断言（真协议）、注解/轻量两分法回归锁、git show/describe 输出形态、
        seedTags 预置与 fail-fast、F-1 冲突全链路、F-2 空仓库全流程。
- [x] 6.3 冒烟：`tools/smoke/run-ch6.cjs`（段6，25/25，两轮无 flake）+ `pnpm smoke:ch6` script。
      覆盖：菜单解锁态、五关真实键盘通关、GitGraph 徽标、结局入口与结局页。
      ⚠️ 三处「一命令即结算」的关卡（6-1 第二条标签 / 6-2 / 6-4 / 6-5 的收尾命令）
      沿用 M5b 的 `captureLastEntry` settled 合成机制；show/describe/push-tag 的回显
      由单测锁定（结算页上读不到）。

## 四、验收 / 三门禁

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` | **0 错误** |
| `pnpm vitest run` | **399 passed**（11 文件），0 todo |
| `pnpm build` | **194.78 kB gzip**（预算 ~350 kB，余量充足） |
| 冒烟段6 | **25/25**（两轮无 flake） |

测试计数对齐 M5b 的 378 → **399**（新增 21：executor +8、targetState +2、levels +11 净增）。

## 五、⚠️ 实测环境事实

以下均为 M6 实测所得，**后续动 `engine/` 或写关卡数据前务必先读**：

1. **注解标签必须走 `git.annotatedTag()`，不能给 `git.tag()` 传 message**：
   isomorphic-git 1.27 的 `tag()` **根本不接收 message 参数**（源码确认 + 探针 P2 实测），
   传了也只产轻量标签 —— 而 `readTag` 随即抛 `ObjectTypeError`（ref 指向的是提交）。
   这个坑的外观是「-a -m 静默变成轻量标签」，很难从报错定位。
2. **`readTag()` 返回 `{ oid, tag: TagObject, payload }`** —— 标签名在 `.tag.tag`，
   目标提交在 `.tag.object`（peel 一层即够；嵌套 tag 不在游戏范围）。
3. **重复创建标签抛 `AlreadyExistsError`**（无 force 即拒绝，与真 git 一致）；
   `git.tag`/`annotatedTag` 的 `object` 传提交 oid 最稳（GitRefManager.resolve 也能解析
   ref 名，但 oid 让「轻量 ref 指向哪个提交」一眼可判）。
4. **`log({ ref: <tag名> })` 自动 peel tag 对象** —— 按标签取提交历史可直接用，
   不需要先解引用。
5. **`listTags` 返回名字数组（字母序）**；注解/轻量的区分靠「readTag 是否成功」，
   轻量标签的 readTag 必然抛 ObjectTypeError（这是判定两分法的既有事实，不是异常路径）。
6. **tag 推送全链路可行**：`git.push({ ref: '<tag名>' })` 经 `refpaths`
   （原名 → refs/ → refs/tags/ → refs/heads/）解析为 `refs/tags/<名>`；无 `remoteRef`
   时远程 ref 与本地同名；注解 tag 的对象由 `listCommitsAndTags` 一并打包 ——
   走既有 fileRemote 服务端，裸仓 `refs/tags/<名>` + tag 对象完整落盘（真协议探针验证）。
7. **旧标签重推被客户端拒**：`PushRejectedError('tag-exists')`（isomorphic-git 在
   `_push` 里对 `refs/tags` 前缀特判），与真 git 的 `! [rejected] (already exists)` 同义。
8. **⚠️ push 的分支参数不能用 `resolveRef` 判定是否为标签**：`resolveRef` 对未知名字
   按「完整引用名」回退解析（`v1.0` → `refs/tags/v1.0`），会把标签误判成分支。
   二义性判定必须查 `listTags` 的名字表（executor 已改为该方案）。
9. **`sandbox` 收尾检出位置的例外必须显式声明**（`stayOnBranch`）：隐式规则
   （「最后一条预置在哪个分支就停哪」）会破坏 ch3-2 / ch3-3 / ch4-3 / 4-5 的既有前提
   （它们的最后一条预置恰好带 `on`，但设计假定收尾回 main）—— 实测 8 个用例失败后回滚。
10. **合并冲突的构造条件再确认**：只有 feature 一侧改过文件时 merge 是安静的三方合并
    （main 侧没改 → 无冲突可言）；「两侧都改且内容不同」才是冲突。F-1 因此在 main 侧
    也预置了一次信标改写。
11. **「一命令即结算」在冒烟里的处理沿用 M5b**：`captureLastEntry` 对已结算关卡合成
    `{ settled: true }`；结算页上读不到回显的命令（show / describe / push tag）改为
    由单测锁定输出格式，冒烟只断言「本关过关」。
12. **jsdom 无 `window.localStorage`** 的垫片（`setup.ts`）、`fake-indexeddb/auto` 等
    M1/M5 既有事实继续成立；smoke 段开头 `resetStorage()` 仍是硬要求。

## 六、设计缺口（如实记录，不假装完备）

1. **「标签已推送到远程」无法用 §4.3 的现有类型判定**（`remote` 只判关联存在性，
   没有「远程 ref 指向何处」）。与 4-2 同款处理：6-4 的判据锚定本地推进项
   （定稿归档 + 标签创建），推送结果由 `levels.test.ts` 的裸仓断言（真协议）与
   冒烟脚本锁定。若未来需要关卡级判定，应新增 `remoteTag` 目标类型。
2. **`tag` 判定不区分注解/轻量**：`{ type: 'tag', name, exists }` 只看存在性 ——
   「用 -a -m 而不是轻量」由 6-2/6-3 的叙事与提示承载，不靠判据强制
   （强行区分需在 TargetCondition 加 `annotated` 字段，改动面超出本轮）。
3. **git describe 的遍历简化**：按 `logAll` 时间倒序逐提交查标签命中（教学仓库
   单线或浅分叉，语义与真 git 一致）；真 git 的拓扑序 + 标签优先级（annotated >
   lightweight，同提交多标签按名字序）未完整复刻 —— 多标签同提交时本实现取
   字母序第一个，已在 describe() 注释中说明。
4. **F-1 的「撤销」成分**：以「历史只增不减」判据 + 预置的反向提交示范表达；
   玩家走 revert 或等价的合法归档都能过关（判终态不锁实现，§14 不为唯一解误伤）。
5. **终章 F 是可选挑战**：结局入口只要求六章主线通关；F 通关与否只影响
   perfect-game 成就（GDD 未明确终章是否必玩，采用「可选 + 成就挂钩」的宽口径）。

## 遗留与移交（→ M7）

- **M7 打磨期**：提示系统分级扣分的数值调参、E2E（Playwright）、真机验证、性能
  —— §13 的 M7 范围不变。
- **`git tag -l <pattern>` 筛选**与**嵌套 tag 解引用**：本版本明确「不支持」，
  如后续章节扩容（如第七章「法则之书」的进阶玩法）再评估。
- **`LevelInit.tags[].message` 缺省行为**：取 `msg ?? name`（与 git.tag 的 message=ref
  行为一致）—— 若关卡作者需要「无注解的预置标签」，需在 sandbox.seedTags 增加
  轻量分支（当前预置恒为注解，6-3 的三个预置标签即如此）。
