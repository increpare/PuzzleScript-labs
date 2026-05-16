# PuzzleScript Labs Repository Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `increpare/PuzzleScript-labs` as a standalone GitHub repository seeded from the current `cpp` branch, verify it, and then remove the canonical repo's remote `cpp` branch.

**Architecture:** Keep `increpare/PuzzleScript` as the canonical handcrafted repository and create a sibling local checkout for `PuzzleScript-labs`. The labs checkout has `origin` pointing at `PuzzleScript-labs` and `upstream` pointing at `PuzzleScript`; the existing `PuzzleScript` checkout keeps its canonical `origin` and is used only to delete the remote `cpp` branch after verification.

**Tech Stack:** Git, GitHub CLI (`gh`), GitHub remotes, zsh.

---

## Scope

This plan performs only the repository migration. It does not move solver, static analyser, or native parity files out of `src/tests/`; that is a follow-up labs-only cleanup after `PuzzleScript-labs/master` is safely verified.

## File And Remote Structure

- Create local checkout: `/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs`
- Create GitHub repo: `https://github.com/increpare/PuzzleScript-labs`
- Keep current canonical checkout: `/Users/stephenlavelle/Documents/GitHub/PuzzleScript`
- Modify no source files during execution.
- Use `/private/tmp` for fresh clone verification.

Final remotes in `/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs`:

```text
origin   https://github.com/increpare/PuzzleScript-labs.git
upstream https://github.com/increpare/PuzzleScript.git
```

Final remotes in `/Users/stephenlavelle/Documents/GitHub/PuzzleScript`:

```text
origin https://github.com/increpare/PuzzleScript.git
```

### Task 1: Preflight The Canonical Checkout

**Files:**
- Read: `/Users/stephenlavelle/Documents/GitHub/PuzzleScript`
- Modify: none

- [ ] **Step 1: Verify current directory, branch, and cleanliness**

Run:

```sh
pwd
git status --short --branch
git remote -v
git log --oneline --decorate -5
```

Expected:

```text
/Users/stephenlavelle/Documents/GitHub/PuzzleScript
## cpp...origin/cpp [ahead 26]
origin  https://github.com/increpare/PuzzleScript.git (fetch)
origin  https://github.com/increpare/PuzzleScript.git (push)
```

The short status must not list modified, staged, or untracked files before continuing.

- [ ] **Step 2: Record the source commit**

Run:

```sh
git rev-parse HEAD
```

Expected: a 40-character SHA. Use this exact SHA as `SOURCE_SHA` for later comparisons.

- [ ] **Step 3: Confirm GitHub CLI is available**

Run:

```sh
gh --version
gh auth status
```

Expected: `gh` prints a version and reports authenticated access to `github.com`.

### Task 2: Create The Empty GitHub Repository

**Files:**
- Modify: GitHub repository list for `increpare`

- [ ] **Step 1: Check whether `PuzzleScript-labs` already exists**

Run:

```sh
gh repo view increpare/PuzzleScript-labs --json nameWithOwner,url,defaultBranchRef,isEmpty
```

Expected if the repo does not exist yet: `gh` exits non-zero with a not-found message.

Expected if the repo already exists and is safe to use:

```json
{"isEmpty":true,"nameWithOwner":"increpare/PuzzleScript-labs","url":"https://github.com/increpare/PuzzleScript-labs"}
```

If the repo exists and `isEmpty` is `false`, stop before continuing. Do not push over an existing non-empty labs repo without a separate recovery plan.

- [ ] **Step 2: Create the repository when it does not already exist**

Run:

```sh
gh repo create increpare/PuzzleScript-labs --public --description "AI-assisted companion workspace for PuzzleScript native and tooling experiments" --disable-wiki
```

Expected: `gh` reports that `https://github.com/increpare/PuzzleScript-labs` was created. Do not add a README, license, gitignore, or template content; the repo must accept the existing history.

- [ ] **Step 3: Verify repository metadata**

Run:

```sh
gh repo view increpare/PuzzleScript-labs --json nameWithOwner,url,isPrivate
```

Expected:

```json
{"isPrivate":false,"nameWithOwner":"increpare/PuzzleScript-labs","url":"https://github.com/increpare/PuzzleScript-labs"}
```

### Task 3: Create The Sibling Labs Checkout

**Files:**
- Create: `/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs`
- Modify: local Git remotes in the new checkout

- [ ] **Step 1: Ensure the sibling path is free**

Run:

```sh
test ! -e /Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs
```

Expected: command exits with status `0`. If it exits non-zero, stop and inspect that path before continuing.

- [ ] **Step 2: Clone the current local repository into the sibling labs path**

Run:

```sh
cd /Users/stephenlavelle/Documents/GitHub
git clone --no-hardlinks PuzzleScript PuzzleScript-labs
```

Expected: Git creates `/Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs` and checks out the current source branch.

- [ ] **Step 3: Rename the checked-out labs branch to `master`**

Run:

```sh
cd /Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs
git status --short --branch
git branch --show-current
git branch -m master
git branch --unset-upstream master
git status --short --branch
```

Expected before rename: current branch is `cpp`. Expected after rename:

```text
## master
```

No modified, staged, or untracked files should be listed.

- [ ] **Step 4: Configure remotes in the labs checkout**

Run:

```sh
git remote remove origin
git remote add origin https://github.com/increpare/PuzzleScript-labs.git
git remote add upstream https://github.com/increpare/PuzzleScript.git
git remote -v
```

Expected:

```text
origin  https://github.com/increpare/PuzzleScript-labs.git (fetch)
origin  https://github.com/increpare/PuzzleScript-labs.git (push)
upstream        https://github.com/increpare/PuzzleScript.git (fetch)
upstream        https://github.com/increpare/PuzzleScript.git (push)
```

- [ ] **Step 5: Verify labs checkout still contains the expected labs material**

Run:

```sh
test -d native
test -d tools/vscode-puzzlescript
test -d tools/linguist
test -f docs/superpowers/specs/2026-05-16-puzzlescript-labs-repo-split-design.md
test -f docs/superpowers/plans/2026-05-16-puzzlescript-labs-repo-migration.md
git rev-parse HEAD
```

Expected: all `test` commands exit `0`, and `git rev-parse HEAD` matches `SOURCE_SHA`.

### Task 4: Push Labs Master And Verify GitHub Defaults

**Files:**
- Modify: `increpare/PuzzleScript-labs` remote refs

- [ ] **Step 1: Push `master` to `PuzzleScript-labs`**

Run:

```sh
cd /Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs
git push -u origin master
```

Expected: Git pushes `master` to `https://github.com/increpare/PuzzleScript-labs.git` and sets local `master` to track `origin/master`.

- [ ] **Step 2: Verify remote `master` points at the source commit**

Run:

```sh
git rev-parse HEAD
git ls-remote --heads origin master
```

Expected: both commands show the same commit SHA for `master`, matching `SOURCE_SHA`.

- [ ] **Step 3: Ensure GitHub default branch is `master`**

Run:

```sh
gh repo view increpare/PuzzleScript-labs --json defaultBranchRef
```

Expected:

```json
{"defaultBranchRef":{"name":"master"}}
```

If the default branch is not `master`, run:

```sh
gh repo edit increpare/PuzzleScript-labs --default-branch master
gh repo view increpare/PuzzleScript-labs --json defaultBranchRef
```

Expected after edit:

```json
{"defaultBranchRef":{"name":"master"}}
```

### Task 5: Fresh Clone Verification

**Files:**
- Create: a temporary verification checkout under `/private/tmp`

- [ ] **Step 1: Clone `PuzzleScript-labs` into a temporary directory**

Run:

```sh
VERIFY_DIR=$(mktemp -d /private/tmp/puzzlescript-labs-verify.XXXXXX)
git clone https://github.com/increpare/PuzzleScript-labs.git "$VERIFY_DIR"
cd "$VERIFY_DIR"
```

Expected: Git clones the repository and checks out `master`.

- [ ] **Step 2: Verify branch, commit, and key directories**

Run:

```sh
git status --short --branch
git rev-parse HEAD
test -d native
test -d tools/vscode-puzzlescript
test -d tools/linguist
test -f docs/superpowers/specs/2026-05-16-puzzlescript-labs-repo-split-design.md
test -f docs/superpowers/plans/2026-05-16-puzzlescript-labs-repo-migration.md
```

Expected:

```text
## master...origin/master
```

The commit SHA must match `SOURCE_SHA`, and all `test` commands must exit `0`.

- [ ] **Step 3: Run lightweight repository checks**

Run:

```sh
npm run test:node
npm run test:syntax
```

Expected: both commands complete successfully. If either command fails because dependencies are missing, run `npm install` in the verification checkout, then rerun both commands.

### Task 6: Delete The Canonical Remote `cpp` Branch

**Files:**
- Modify: remote branch refs in `increpare/PuzzleScript`

- [ ] **Step 1: Return to the canonical checkout and verify its remote**

Run:

```sh
cd /Users/stephenlavelle/Documents/GitHub/PuzzleScript
git remote get-url origin
git status --short --branch
```

Expected:

```text
https://github.com/increpare/PuzzleScript.git
## cpp...origin/cpp [ahead 26]
```

The short status must not list modified, staged, or untracked files.

- [ ] **Step 2: Confirm the remote `cpp` branch still exists**

Run:

```sh
git ls-remote --heads origin cpp
```

Expected: one line ending in `refs/heads/cpp`.

- [ ] **Step 3: Delete the canonical remote `cpp` branch**

Run only after Tasks 4 and 5 have passed:

```sh
git push origin --delete cpp
```

Expected: Git reports that `cpp` was deleted from `https://github.com/increpare/PuzzleScript.git`.

- [ ] **Step 4: Verify canonical remote `cpp` is gone**

Run:

```sh
git ls-remote --heads origin cpp
```

Expected: no output.

### Task 7: Final Local Orientation

**Files:**
- Modify: none

- [ ] **Step 1: Verify both local checkouts have the intended identity**

Run:

```sh
cd /Users/stephenlavelle/Documents/GitHub/PuzzleScript
git remote -v
git branch --show-current
cd /Users/stephenlavelle/Documents/GitHub/PuzzleScript-labs
git remote -v
git branch --show-current
```

Expected:

```text
# PuzzleScript
origin  https://github.com/increpare/PuzzleScript.git (fetch)
origin  https://github.com/increpare/PuzzleScript.git (push)
cpp

# PuzzleScript-labs
origin  https://github.com/increpare/PuzzleScript-labs.git (fetch)
origin  https://github.com/increpare/PuzzleScript-labs.git (push)
upstream        https://github.com/increpare/PuzzleScript.git (fetch)
upstream        https://github.com/increpare/PuzzleScript.git (push)
master
```

- [ ] **Step 2: Leave local `cpp` untouched for now**

Do not delete the local `cpp` branch in `/Users/stephenlavelle/Documents/GitHub/PuzzleScript` during this migration. It is a local recovery reference until the user has worked from `PuzzleScript-labs` and is comfortable removing it.

- [ ] **Step 3: Record follow-up work**

Report that the next cleanup should happen in `PuzzleScript-labs`: move solver, static analyser, native parity, and report-builder material out of `src/tests/` into labs-owned directories.
