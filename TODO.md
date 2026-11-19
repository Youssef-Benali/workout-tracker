# Build checklist

## M1 — Foundation
- [x] Initialize repository and project docs
- [x] Generate and verify PWA icons (192, 512, maskable 512)
- [x] Add shared visual foundation (tokens, typography, layout)

## M2 — App core
- [x] Storage layer with `wt.v1.` keys and guarded access
- [x] Seeded Upper and Lower programs
- [x] Hash router with browser Back support
- [x] Shared header, icon buttons, illustrations

## M3 — Programs
- [x] Program list cards, add program and header actions
- [x] Program editor title editing and save states
- [x] Exercise add, rename, remove
- [x] Pointer drag reorder and keyboard reorder
- [x] Start workout from the editor

## M4 — Workout
- [x] Idle workout chooser
- [x] Active workout layout and break selector
- [x] Timestamp rest timer, double tap reset, completion state
- [x] Weight, set boxes, reps stepper, autosave
- [x] Exercise navigation, swipe, finish and session history
- [x] Screen Wake Lock handling

## M5 — History and progress
- [x] Calendar month grid, trained/today/selected states
- [x] Day selection, folded session cards and in-progress session
- [x] Progress sparklines, deltas and empty state

## M6 — PWA and docs
- [x] Manifest, icons and metadata
- [x] Service worker caching and registration
- [x] README install/update/limitations
- [x] ASSUMPTIONS review

## M7 — Verification
- [x] Playwright automated behaviour suite
- [x] Manifest, icon, service worker, console checks
- [x] 360x740 overflow and top-bar layout checks

## M8 — Visual QA
- [x] Light screenshots of all six screens
- [x] Dark screenshots of all six screens
- [x] Review and fix visual defects

## M9 — Release
- [x] Final regression run
- [x] All work committed to `main`
- [x] Push attempted and result recorded

## M10 — Historical import
- [x] One-time `importV1` merge of the seven November 2026 sessions
- [x] Skip dates that already have a session; preserve all existing data
- [x] Cache bumped to `wt-v3`

## M11 — Barbell weight fix
- [x] Correct Bench and Squat weights in the fresh-import data
- [x] One-time `barFixV1` migration for already imported sessions
- [x] Cache bumped to `wt-v4`

## M12 — Inline exercise editing
- [x] Tappable exercise rows in session cards and on Progress
- [x] Inline name and per-set weight editor with validation
- [x] Global renames across sessions and programs
- [x] Cache bumped to `wt-v5`

Push result: local commits only. `git push -u origin main` failed because no remote was supplied with the brief:

```text
fatal: 'origin' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.
```
