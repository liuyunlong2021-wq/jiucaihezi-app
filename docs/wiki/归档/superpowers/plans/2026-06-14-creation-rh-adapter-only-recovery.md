# Creation RH Adapter Only Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep both existing deployable versions untouched, then create a clean branch from `main` that only fixes the creation panel parameter and RunningHub adapter execution chain.

**Architecture:** Treat `main` as the stable product baseline and `codex/opencode-core-execution` as a source branch for selected creation-related work only. Preserve both baselines with pushed backup branches and annotated tags before importing anything. Use a separate git worktree so the current local checkout and both original branches remain untouched.

**Tech Stack:** Git/GitHub branches and tags, Vue 3 + Pinia + Vite frontend, Tauri-adjacent shared code, Python FastAPI-style `rh-adapter`, pnpm, Node test runner, pytest.

---

## File Structure

**Backup refs only, no code changes:**
- Remote branch: `backup/main-stable-<timestamp>` points to `origin/main`.
- Remote branch: `backup/opencode-core-<timestamp>` points to `origin/codex/opencode-core-execution`.
- Remote tag: `backup/main-stable-<timestamp>` points to `origin/main`.
- Remote tag: `backup/opencode-core-<timestamp>` points to `origin/codex/opencode-core-execution`.

**New isolated working branch:**
- Branch: `fix/creation-rh-adapter-only`
- Worktree path: `/Users/by3/Documents/jiucaihezi-creation-rh-fix`
- Base: `origin/main`

**Primary files allowed to change in the clean branch:**
- `rh-adapter/`: RunningHub adapter service, mapping, schemas, task polling, tests.
- `src/api/media-generation.ts`: frontend request builder and polling path for media generation.
- `src/data/mediaModelCapabilities.ts`: visible media model capabilities and form parameter constraints.
- `src/data/creationModels.ts`: creation panel model definitions if this repo version still uses it.
- `src/components/creation/`: creation panel UI controls and parameter binding.
- `src/components/media/`: media result display only if required for creation output visibility.
- `src/stores/mediaTaskStore.ts`: media task lifecycle only if task persistence/refresh is part of the creation bug.
- `src/utils/creationResults.ts`: result URL normalization and persistence only if generated media display is part of the creation bug.
- Tests under the matching `__tests__/` folders and `rh-adapter/tests/`.

**Files not allowed in this recovery unless separately approved:**
- `src/composables/useChat.ts`
- `src/stores/sessionStore.ts`
- `src/components/chat/`
- Gateway login/auth files under `gateway/`
- OpenCode runtime files under `src/opencodeClient/`
- General layout/rail/settings refactors unrelated to creation

---

### Task 1: Create Immutable Backups For Both Existing Versions

**Files:**
- No file edits.
- Git refs only.

- [ ] **Step 1: Fetch remote refs**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-app
git fetch origin
```

Expected: command exits `0`.

- [ ] **Step 2: Create local backup branches and annotated tags**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-app
BACKUP_STAMP=$(date +%Y%m%d-%H%M)
echo "$BACKUP_STAMP" > /tmp/jiucai-backup-stamp.txt

git branch "backup/main-stable-$BACKUP_STAMP" origin/main
git branch "backup/opencode-core-$BACKUP_STAMP" origin/codex/opencode-core-execution

git tag -a "backup/main-stable-$BACKUP_STAMP" origin/main -m "Backup main stable before creation-only recovery"
git tag -a "backup/opencode-core-$BACKUP_STAMP" origin/codex/opencode-core-execution -m "Backup opencode core branch before creation-only recovery"
```

Expected: all four refs are created locally.

- [ ] **Step 3: Push backup refs to GitHub**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-app
BACKUP_STAMP=$(cat /tmp/jiucai-backup-stamp.txt)

git push origin "backup/main-stable-$BACKUP_STAMP"
git push origin "backup/opencode-core-$BACKUP_STAMP"
git push origin "refs/tags/backup/main-stable-$BACKUP_STAMP"
git push origin "refs/tags/backup/opencode-core-$BACKUP_STAMP"
```

Expected: GitHub now has two backup branches and two backup tags. These are the return points.

- [ ] **Step 4: Verify backup refs**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-app
BACKUP_STAMP=$(cat /tmp/jiucai-backup-stamp.txt)

git ls-remote --heads origin "backup/main-stable-$BACKUP_STAMP" "backup/opencode-core-$BACKUP_STAMP"
git ls-remote --tags origin "backup/main-stable-$BACKUP_STAMP" "backup/opencode-core-$BACKUP_STAMP"
```

Expected: four lines are printed.

- [ ] **Step 5: Commit**

No commit for this task because it only creates backup refs.

---

### Task 2: Create A Clean Worktree From `main`

**Files:**
- Create worktree: `/Users/by3/Documents/jiucaihezi-creation-rh-fix`
- No repo file edits yet.

- [ ] **Step 1: Create isolated worktree**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-app
git worktree add /Users/by3/Documents/jiucaihezi-creation-rh-fix -b fix/creation-rh-adapter-only origin/main
```

Expected: new worktree is created from `origin/main`.

- [ ] **Step 2: Verify clean baseline**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git status --short --branch
```

Expected:

```text
## fix/creation-rh-adapter-only
```

No modified or untracked files should be listed.

- [ ] **Step 3: Install dependencies if needed**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
pnpm install
```

Expected: command exits `0`.

- [ ] **Step 4: Baseline verification**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
pnpm run typecheck
```

Expected: typecheck passes on the stable baseline.

- [ ] **Step 5: Commit**

No commit for this task because it creates the worktree only.

---

### Task 3: Import `rh-adapter` Only

**Files:**
- Modify/Create: `rh-adapter/**`
- Test: `rh-adapter/tests/**`

- [ ] **Step 1: Import only `rh-adapter` from the source branch**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git restore --source=origin/codex/opencode-core-execution -- rh-adapter
```

Expected: `git status --short` lists only `rh-adapter/**`.

- [ ] **Step 2: Confirm only adapter files changed**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git status --short
git diff --stat -- rh-adapter
git diff --name-only | grep -v '^rh-adapter/' && exit 1 || true
```

Expected: no changed path outside `rh-adapter/`.

- [ ] **Step 3: Run adapter tests**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix/rh-adapter
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt pytest
pytest
```

Expected: all `rh-adapter` tests pass.

- [ ] **Step 4: Commit adapter import**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git add rh-adapter
git commit -m "chore: sync rh-adapter for creation workflows"
```

Expected: one commit containing only `rh-adapter/**`.

---

### Task 4: Build A Creation Chain Diff Inventory

**Files:**
- Create: `/tmp/jiucai-creation-candidates.txt`
- Create: `/tmp/jiucai-creation-diffstat.txt`
- No repo edits.

- [ ] **Step 1: Generate candidate file list**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --name-status origin/main..origin/codex/opencode-core-execution -- \
  src/api/media-generation.ts \
  src/data/mediaModelCapabilities.ts \
  src/data/creationModels.ts \
  src/components/creation \
  src/components/media \
  src/stores/mediaTaskStore.ts \
  src/utils/creationResults.ts \
  > /tmp/jiucai-creation-candidates.txt

cat /tmp/jiucai-creation-candidates.txt
```

Expected: candidate creation-chain files are listed. This list is the only frontend scope allowed for the next tasks.

- [ ] **Step 2: Generate diffstat**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --stat origin/main..origin/codex/opencode-core-execution -- \
  src/api/media-generation.ts \
  src/data/mediaModelCapabilities.ts \
  src/data/creationModels.ts \
  src/components/creation \
  src/components/media \
  src/stores/mediaTaskStore.ts \
  src/utils/creationResults.ts \
  > /tmp/jiucai-creation-diffstat.txt

cat /tmp/jiucai-creation-diffstat.txt
```

Expected: diffstat excludes chat/session/auth/OpenCode files.

- [ ] **Step 3: Commit**

No commit for this task because it only creates external analysis files.

---

### Task 5: Import Creation Model Definitions And API Mapping

**Files:**
- Modify if present in candidate list: `src/api/media-generation.ts`
- Modify if present in candidate list: `src/data/mediaModelCapabilities.ts`
- Modify if present in candidate list: `src/data/creationModels.ts`
- Test: `src/api/__tests__/mediaGenerationModelGuard.test.ts`
- Test: `src/data/__tests__/mediaModelCapabilities.test.ts`
- Test: `src/data/__tests__/mediaModelInputValidation.test.ts`

- [ ] **Step 1: Import selected data/API files from source branch**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
for path in \
  src/api/media-generation.ts \
  src/data/mediaModelCapabilities.ts \
  src/data/creationModels.ts
do
  if git cat-file -e "origin/codex/opencode-core-execution:$path" 2>/dev/null; then
    git restore --source=origin/codex/opencode-core-execution -- "$path"
  fi
done
```

Expected: only those existing files are modified.

- [ ] **Step 2: Reject accidental broad imports**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --name-only | grep -Ev '^(rh-adapter/|src/api/media-generation.ts|src/data/mediaModelCapabilities.ts|src/data/creationModels.ts)$' && exit 1 || true
```

Expected: no output from `grep`.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
node scripts/run-focused-tests.mjs build
node --test \
  /private/tmp/jc-focused-tests/api/__tests__/mediaGenerationModelGuard.test.js \
  /private/tmp/jc-focused-tests/data/__tests__/mediaModelCapabilities.test.js \
  /private/tmp/jc-focused-tests/data/__tests__/mediaModelInputValidation.test.js
```

Expected: targeted media model tests pass.

- [ ] **Step 4: Commit model/API import**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git add src/api/media-generation.ts src/data/mediaModelCapabilities.ts src/data/creationModels.ts
git commit -m "fix: align creation model parameters with adapter"
```

Expected: one commit containing only media API/data files.

---

### Task 6: Import Creation Panel UI Binding Only If Needed

**Files:**
- Modify if present in candidate list: `src/components/creation/**`
- Test: existing creation/media focused tests from `scripts/run-focused-tests.mjs`

- [ ] **Step 1: Check whether creation UI changed in source branch**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --name-only origin/main..origin/codex/opencode-core-execution -- src/components/creation
```

Expected: if no files are printed, skip to Task 7.

- [ ] **Step 2: Import creation UI files**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git restore --source=origin/codex/opencode-core-execution -- src/components/creation
```

Expected: only `src/components/creation/**` changes are added to the working tree.

- [ ] **Step 3: Guard against non-creation imports**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --name-only | grep -Ev '^(rh-adapter/|src/api/media-generation.ts|src/data/mediaModelCapabilities.ts|src/data/creationModels.ts|src/components/creation/)' && exit 1 || true
```

Expected: no output from `grep`.

- [ ] **Step 4: Run typecheck**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
pnpm run typecheck
```

Expected: typecheck passes.

- [ ] **Step 5: Commit creation UI import**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git add src/components/creation
git commit -m "fix: align creation panel controls"
```

Expected: one commit containing only `src/components/creation/**`.

---

### Task 7: Import Media Result Display And Task Store Only If Needed

**Files:**
- Modify if present in candidate list: `src/components/media/**`
- Modify if present in candidate list: `src/stores/mediaTaskStore.ts`
- Modify if present in candidate list: `src/utils/creationResults.ts`
- Test: `src/stores/__tests__/mediaTaskStore.test.ts`
- Test: `src/utils/__tests__/creationResults.test.ts`

- [ ] **Step 1: Check candidate files**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --name-only origin/main..origin/codex/opencode-core-execution -- \
  src/components/media \
  src/stores/mediaTaskStore.ts \
  src/utils/creationResults.ts
```

Expected: import only printed files that are required for generated result visibility.

- [ ] **Step 2: Import media result files**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
for path in \
  src/components/media \
  src/stores/mediaTaskStore.ts \
  src/utils/creationResults.ts
do
  if git cat-file -e "origin/codex/opencode-core-execution:$path" 2>/dev/null; then
    git restore --source=origin/codex/opencode-core-execution -- "$path"
  fi
done
```

Expected: only media result/task files are modified.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
node scripts/run-focused-tests.mjs build
node --test \
  /private/tmp/jc-focused-tests/stores/__tests__/mediaTaskStore.test.js \
  /private/tmp/jc-focused-tests/utils/__tests__/creationResults.test.js
```

Expected: targeted tests pass.

- [ ] **Step 4: Commit media result import**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git add src/components/media src/stores/mediaTaskStore.ts src/utils/creationResults.ts
git commit -m "fix: keep creation media results visible"
```

Expected: one commit containing only media result/task files.

---

### Task 8: Full Verification And Preview Build

**Files:**
- No planned source edits.
- Output: `dist/`

- [ ] **Step 1: Run full focused and Tauri tests**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
pnpm run test:focused
```

Expected: all focused Node tests and Rust tests pass.

- [ ] **Step 2: Run production web build**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
pnpm run build
```

Expected: `dist/` is generated and `[web-dist] audit passed` is printed.

- [ ] **Step 3: Run adapter tests again**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix/rh-adapter
. .venv/bin/activate
pytest
```

Expected: all adapter tests pass.

- [ ] **Step 4: Check final diff scope**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git diff --name-only origin/main..HEAD | grep -Ev '^(rh-adapter/|src/api/media-generation.ts|src/data/mediaModelCapabilities.ts|src/data/creationModels.ts|src/components/creation/|src/components/media/|src/stores/mediaTaskStore.ts|src/utils/creationResults.ts)' && exit 1 || true
```

Expected: no output from `grep`. If there is output, remove or justify the extra file before continuing.

- [ ] **Step 5: Commit**

No commit for this task if all previous tasks already committed their changes.

---

### Task 9: Push Recovery Branch Without Touching `main`

**Files:**
- No file edits.

- [ ] **Step 1: Push branch**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git push -u origin fix/creation-rh-adapter-only
```

Expected: GitHub branch `fix/creation-rh-adapter-only` exists.

- [ ] **Step 2: Confirm original branches are unchanged**

Run:

```bash
cd /Users/by3/Documents/jiucaihezi-creation-rh-fix
git fetch origin
git rev-parse origin/main
git rev-parse origin/codex/opencode-core-execution
BACKUP_STAMP=$(cat /tmp/jiucai-backup-stamp.txt)
git rev-parse "origin/backup/main-stable-$BACKUP_STAMP"
git rev-parse "origin/backup/opencode-core-$BACKUP_STAMP"
```

Expected: backup branch SHAs match the original refs captured in Task 1. `main` has not been force-pushed or reset.

- [ ] **Step 3: Commit**

No commit for this task.

---

### Task 10: Rollback Commands To Keep Handy

**Files:**
- No file edits.

- [ ] **Step 1: Restore old stable version locally**

Run only when intentionally rolling back:

```bash
cd /Users/by3/Documents/jiucaihezi-app
BACKUP_STAMP=<the timestamp from /tmp/jiucai-backup-stamp.txt>
git switch -c restore-main-stable "backup/main-stable-$BACKUP_STAMP"
```

Expected: local branch `restore-main-stable` contains the old stable version.

- [ ] **Step 2: Restore current experimental/current version locally**

Run only when intentionally rolling back:

```bash
cd /Users/by3/Documents/jiucaihezi-app
BACKUP_STAMP=<the timestamp from /tmp/jiucai-backup-stamp.txt>
git switch -c restore-opencode-core "backup/opencode-core-$BACKUP_STAMP"
```

Expected: local branch `restore-opencode-core` contains the current `codex/opencode-core-execution` version.

- [ ] **Step 3: Commit**

No commit for rollback instructions.

---

## Self-Review

**Spec coverage:** The plan preserves both requested versions before any code import, creates a clean branch from `main`, imports only creation-related scope, verifies adapter/frontend behavior, and avoids touching chat/session/auth/OpenCode areas.

**Placeholder scan:** No `TBD`, `TODO`, or open-ended implementation placeholders remain. Conditional import tasks contain exact commands and exact allowed paths.

**Type consistency:** Branch names, backup ref names, worktree path, and file paths are consistent across tasks. The same timestamp file `/tmp/jiucai-backup-stamp.txt` is used for backup verification and rollback commands.

