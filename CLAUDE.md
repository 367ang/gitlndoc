# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This is the design + source repository for **「Git 时间旅人」 / "Git Time Traveler"** — a pure-browser, single-player, time-travel-themed game for learning Git. The player fixes broken "timelines" (git repos) by executing real Git commands. Three documents form the project's source of truth; any code work should align with them:

- `game-design.md` (GDD) — game concept, narrative, full level list with difficulty/输入 mode/关联笔记 mapping.
- `development-refinement.md` — engineering spec derived from the GDD: tech stack, layered architecture, the `src/` directory layout, core domain models, scoring system, persistence, test strategy, milestone plan. **This is the authoritative reference for any implementation work** — match its §4/§7/§8 to the GDD.
- `notes/*.md` — 8 Git learning notes. These are the **knowledge basis** the levels are derived from (each level references `relatedKnowledge` ids). The GDD chapters map 1:1 to these notes.
- `other/frontend-changes.md` — changelog of changes made to the notes; **append to this file whenever you restructure/modify notes** (do not ask permission to edit it — this is the established convention from `.claude/commands/implement-feature.md`).
- `practice/server/gitrunner.mjs` — a standalone Node sandbox helper (`createSandbox` / `runCommand` / `getGitState`) that executes real git in a temp dir, blocks a curated `BLOCKED_SUBCOMMANDS` set, and forces a fixed learner identity. Reference for how the project expects command sandboxing + subcommand allowlisting to behave.

## Language convention

Commit **descriptive content in Chinese** (per README "## Language" and the implement-feature command). Conventional Commits types (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`) are used; the description after the type is Chinese. Example: `feat: 添加第一章关卡数据`.

## Current state

The frontend is being bootstrapped. `package.json`, `vite.config.ts`, `tsconfig.json`/`tsconfig.node.json`, and `index.html` exist, but **`src/` does not yet exist** — `index.html` references `/src/main.tsx` which is the intended entry point per `development-refinement.md` §3. When starting M1 work, create the `src/` skeleton laid out in §3.

## Commands

```bash
npm run dev          # Vite dev server (HMR)
npm run build        # tsc -b && vite build  (typecheck is part of build)
npm run preview      # preview production build
npm run typecheck    # tsc --noEmit  (fast typecheck without emit; run before commits)
```

Package manager: the spec mentions `pnpm` but the lockfile/`package.json` here use npm scripts directly — use `npm run <script>`.

No test runner is configured yet. The spec (§11) calls for **Vitest + @testing-library/react** with tests under `src/__tests__/`. Once added, the expected commands will be `npm test` and `npx vitest run <file>` for a single test. The first tests to write are `tokenize.test.ts`, `scoring.test.ts`, `targetState.test.ts`, `executor.test.ts`.

## Architecture (the big picture)

The app is a single-page SPA. There is no router — a view state machine in `viewStore` drives root-component switching. Layered responsibilities (see `development-refinement.md` §2, §5):

```
UI Layer (ui/components, ui/hooks)
        ↓ subscribes / dispatches
Store / State (store/: sessionStore, progressStore, viewStore)   ← single source of truth
        ↓
Game Service (game/: command/, validate/, scoring/)  ← pure functions
        ↓
Git Execution Layer (engine/: fs, gitApi, sandbox, errors)
        ↓
isomorphic-git + LightningFS  ← real git object/index ops, in-browser, no backend
        ↓
Level Data + Runtime (levels/, persistence/)
```

Key architectural rules to preserve:

- **UI is pure presentational** — no business logic; it subscribes via hooks and dispatches actions.
- **Game Service is pure functions** — command tokenize → grammar validate → executor orchestration → target-state comparison → scoring. Keep side effects out of here.
- **Git Execution Layer is a thin wrapper** over isomorphic-git. All player commands go through `gitApi.*`; errors are normalized into business exceptions (`GitCommandError` etc.). The `gitrunner.mjs` practice file shows the intended subcommand allowlist/sandbox discipline — the browser engine should mirror it.
- **View state machine**: `boot → intro → menu → chapter → level → levelComplete → (menu/chapter)`; full clearance unlocks `gameComplete` from the menu. `boot` initializes LightningFS + loads persisted progress and decides intro-vs-menu.
- **No `react-router`** — by design, to keep the linear flow simple. Routing = discriminated-union `view` in `viewStore`.

### Sandbox model

One singleton LightningFS `fs` mounted at virtual root `/`. Per-level convention: `/repo` (player's main repo), `/remote.git` (bare "remote universe" for the Ch.4 remote levels). Each level start: clear virtual root and rebuild from `LevelInit` (`sandbox.ts::reset`).

### Core domain models (§4)

- `Level` — id (`chN-M`), chapter, objective, difficulty 1–5, `inputMode: 'free' | 'half' | 'menu'`, `relatedKnowledge[]`, `LevelInit`, `TargetCondition[]`, `winScore`, `ScoringParams`, `HintStep[]`.
- `LevelInit` — `template`, `files`, `commits`, `branches`, `tags`, `remotes`. Implemented by writing files via fs + building commits/branches/tags via gitApi to get **real object DB**.
- `TargetCondition` — discriminated union (`file`/`branch`/`headBranch`/`commitCount`/`commitMessage`/`commitExists`/`tag`/`merged`/`logOrder`/`workdirClean`/`remote`). A level passes only when **all** targets are satisfied.
- `CommandEntry` — input + tokens + ok + output + error + ts + `undoable` (drives scoring).

### Scoring philosophy: 奖励理解、惩罚试错 (reward understanding, penalize trial-and-error)

- Base score scaled by target satisfaction; **all targets must be met to pass**.
- Penalties: undo-class commands (reset/revert/`checkout --`/stash drop), redoing the same target, using hints.
- Bonuses: optimal command sequence, flawless first-try (0 undo 0 hint), small probe bonus for read-only exploration (status/log/branch).
- Stars: ★ pass; ★★ ≥0.8·winScore and no undo; ★★★ ≥0.95·winScore and 0 hint 0 undo.
- Refinement: distinguish reset modes — `--soft/--mixed` light penalty, `--hard` heavy.

### Persistence (§10)

localStorage (versioned keys `gtp:progress:v1`, `gtp:achievements:v1`, `gtp:settings:v1`) + IndexedDB for repo snapshots (`gtp:snapshot:<levelId>`) to survive refresh/crash mid-level.

## Input modes evolve by chapter (GDD §3.2)

Ch.1–2 **menu/拼接** (command-piece drag/click) → Ch.3–4 **half** (skeleton + fill-in) → Ch.5–7 + finale **free** (full typing, aliases supported). The grammar layer must support the half-mode "partial token" highlight flow.

## Git subcommand coverage caveats

isomorphic-git has incomplete support for `revert`/`stash`/`pull` auto-merge — `gitApi` must compose these from primitives. For anything outside the supported subset, the grammar layer gives a "该版本不支持" message rather than faking execution. Prefer keeping per-level repos small to avoid LightningFS perf issues.

## Milestones (§13)

Work proceeds M1 (engine skeleton + stores + init/add/commit viz) → M2 (level framework + Ch.1 playable) → M3 (scoring/stars/achievements) → M4 (Ch.2–3, GitGraph, BranchPanel, tab completion) → M5 (undo + remote, snapshot persistence) → M6 (tags + comprehensive finale) → M7 (polish, tuning, E2E). Run `typecheck` + `test` + `build` at the end of each stage so `main` stays runnable.
