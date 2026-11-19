# Assumptions and decisions

The product brief is the source of truth. Where it leaves a detail open, this file records the decision used in the app.

## Repository and hosting

- The brief contains the literal placeholder `<PASTE REPO URL>`; no GitHub repository URL was supplied. The working directory was not a Git repository, so it was initialized on branch `main`. No remote could be configured. A push was attempted at release time and failed: `fatal: 'origin' does not appear to be a git repository`. The complete app and commits are therefore local until a real remote is provided.
- The static app was also tested mounted at a `/workout/` sub-path to match the intended GitHub Pages URL shape: relative assets, manifest URLs and service worker scope all resolve correctly.
- The app is completely static. It is designed to live at a GitHub Pages sub-path and every app URL is relative (`./`).
- Test tooling is not part of the deployed app and does not introduce a runtime dependency.

## Data

- The initial break is 120 seconds. It is persisted in `wt.v1.settings` only after the user changes it.
- New exercises created in the editor use 3 sets and body-weight (0 kg). The brief deliberately gives the editor no weight or set controls; the weight is editable during a workout and is written back to the program item.
- New programs start with no exercise rows. They can be saved empty; "Start workout" remains disabled until at least one row exists.
- Blank exercise names are tolerated in the editor. If a workout is started anyway, a blank name is displayed and stored as "Exercise".
- Program edits made outside a workout are explicit (Save program). Starting from the editor uses the current draft even if it has not been saved.
- Weight edits during a workout are applied to the active snapshot and, when the workout came from a saved program, written back to that program item.
- A completed session includes every exercise in the workout snapshot. Exercises without logged sets remain in the session but do not contribute to progress.
- The timer state is stored with the active workout as accumulated milliseconds plus the wall-clock time it last started. A reload therefore keeps a paused value or resumes a running count from its actual timestamp. If the break elapsed while the app was closed, the timer opens already complete without replaying the completion vibration.
- A finished session is dated on the local day it is finished. `sessions` and `settings` keys are not created on first run. Only `wt.v1.programs` is seeded.

## Navigation

- All screens share the hash routes `#list`, `#program`, `#work`, `#log` and `#progress`. Program context is kept in memory; opening `#program` directly edits the first saved program.
- Internal navigation creates browser history entries. Back buttons use browser history so they return to the exact page the user came from. Direct-entry routes have a sensible fallback (`#list`).
- The active workout's calendar, progress and edit actions push a new history entry; Back returns to the active workout.

## Workout behaviour

- The rest timer counts up to the selected break. Starting, pausing, completing or changing presets is persisted with the active workout. A reload reconstructs the timer from its saved timestamps, so the count does not lose time.
- A completed timer shows the full break, turns green and vibrates `[80, 60, 80]` when vibration is available. Tapping a completed dial resets it and starts a fresh count.
- Switching exercises resets the rest timer. Set logs and reps are retained per exercise.
- The bottom Previous button is disabled on the first exercise.
- "Finish workout" saves only when at least one set is checked; it always clears the active workout and opens the calendar. Sessions can be multiple on one day.
- Swipe navigation is horizontal only (more than 50 px and clearly horizontal), so vertical scrolling still works.

## Calendar and progress

- An unfinished workout is counted on today's date as an in-progress session, matching the brief's "Today, in progress" requirement. It contributes a trained marker and a folded session card, but is not included in Progress until finished.
- When the calendar is opened, the latest trained day is selected, otherwise today. Navigating to a month without a visible selection chooses that month's latest trained day, otherwise the first of the month.
- The Progress metric is the best logged set weight for weighted exercises. If every logged weight for an exercise is zero, the metric is total reps for each session. An exercise is shown once it has logged sets in at least two sessions.
- "Best set" is the greatest weight in the session, not the average.
- A calendar session card shows one weight per exercise: the highest weight logged in that exercise for that session. Its reps line lists the logged reps in set order.

## Visual and accessibility details

- All dynamic user strings are rendered with DOM text nodes and attributes. The only `innerHTML` assignments use closed, hard-coded SVG icon and illustration maps; no user text is ever interpolated into markup.
- Illustrations are a deliberately consistent family: 120×120 viewBox, 6 px accent strokes, round caps/joins, card-filled head and track-filled torso. No other fills are used.
- The app limits itself to a 420 px content column. At the narrow 360 px verification width, outer and calendar padding tighten slightly so every calendar cell still meets the 44 px touch-target requirement.
- Reduced-motion preferences disable non-essential animation, including the set pop and screen transitions.
- No modal native dialogs are used anywhere.
