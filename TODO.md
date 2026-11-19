# Build checklist

## M1 — Foundation
- [x] Initialize repository and project docs
- [x] Generate and verify PWA icons (192, 512, maskable 512)
- [x] Add shared visual foundation (tokens, typography, layout)

## M2 — App core
- [x] Storage layer with `wt.v1.` keys and guarded access
- [x] Seeded Upper and Lower programs, no history
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
- [ ] Manifest, icons and metadata
- [ ] Service worker caching and registration
- [ ] README install/update/limitations
- [ ] ASSUMPTIONS review

## M7 — Verification
- [ ] Playwright automated behaviour suite
- [ ] Manifest, icon, service worker, console checks
- [ ] 360x740 overflow and top-bar layout checks

## M8 — Visual QA
- [ ] Light screenshots of all six screens
- [ ] Dark screenshots of all six screens
- [ ] Review and fix visual defects

## M9 — Release
- [ ] Final regression run
- [ ] All work committed to `main`
- [ ] Push attempted and result recorded
