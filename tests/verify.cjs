"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer, ROOT } = require("./server.cjs");

const results = [];
const temporaryDir = path.join(ROOT, ".tmp");

function makeStringSanitizer() {
  return (value) => String(value || "").replace(/\s+/g, " ").trim();
}

function localDateParts(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  };
}

async function main() {
  fs.mkdirSync(temporaryDir, { recursive: true });
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const sanitize = makeStringSanitizer();

  async function newPage(options = {}) {
    const {
      viewport = { width: 390, height: 844 },
      colorScheme = "light",
      serviceWorkers = "allow",
      startPath = "/"
    } = options;
    const context = await browser.newContext({
      viewport,
      colorScheme,
      locale: "en-GB",
      timezoneId: "Europe/Brussels",
      serviceWorkers
    });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console.error: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    await page.goto(`${baseUrl}${startPath}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen");
    return { context, page, errors, baseUrl, options, startPath };
  }

  async function scenario(name, fn, options = {}) {
    const session = await newPage(options);
    const { page, errors } = session;
    try {
      await fn(session);
      await page.waitForTimeout(40);
      assert.deepEqual(errors, [], `Browser console/page errors:\n${errors.join("\n")}`);
      results.push({ name, ok: true });
      console.log(`PASS  ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`FAIL  ${name}`);
      console.error(error && error.stack ? error.stack : error);
      try {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        await page.screenshot({
          path: path.join(temporaryDir, `failure-${slug}.png`),
          fullPage: true
        });
      } catch (screenshotError) {
        // A page may have crashed; the failure is already recorded.
      }
    } finally {
      await session.context.close();
    }
  }

  async function readStore(page, key) {
    return page.evaluate((storageKey) => {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        return { __invalidJson: true };
      }
    }, key);
  }

  async function getInputValues(page, selector) {
    return page.locator(selector).evaluateAll((elements) =>
      elements.map((element) => element.value)
    );
  }

  async function openUpperEditor(page) {
    await page.locator(".program-card").first().click();
    await page.waitForSelector(".screen-editor");
    await page.waitForFunction(() => location.hash === "#program");
  }

  async function openWorkoutIdle(page) {
    await page.getByLabel("Open workout", { exact: true }).click();
    await page.waitForSelector(".screen-work-idle");
    await page.waitForFunction(() => location.hash === "#work");
  }

  async function startUpperFromIdle(page) {
    await openWorkoutIdle(page);
    await page.getByRole("button", { name: "Start Upper workout" }).click();
    await page.waitForSelector(".screen-work-active");
    await page.waitForFunction(() => location.hash === "#work");
  }

  async function startUpperFromList(page) {
    await openWorkoutIdle(page);
    await page.getByRole("button", { name: "Start Upper workout" }).click();
    await page.waitForSelector(".screen-work-active");
  }

  async function localToday(page) {
    return page.evaluate(() => {
      const pad = (value) => String(value).padStart(2, "0");
      const date = new Date();
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    });
  }

  async function installVibrationSpy(page) {
    await page.evaluate(() => {
      window.__vibrations = [];
      try {
        Object.defineProperty(navigator, "vibrate", {
          configurable: true,
          value: (pattern) => {
            window.__vibrations.push(pattern);
            return true;
          }
        });
      } catch (error) {
        window.__vibrationsUnavailable = true;
      }
    });
  }

  async function storageKeys(page) {
    return page.evaluate(() => Object.keys(localStorage).sort());
  }

  /* ---------------------------------------------------------------------
     1. First run
     --------------------------------------------------------------------- */

  await scenario("First run seeds exactly Upper and Lower with no history", async ({ page }) => {
    assert.deepEqual(await storageKeys(page), ["wt.v1.programs"]);
    assert.equal(await readStore(page, "wt.v1.sessions"), null);
    assert.equal(await readStore(page, "wt.v1.active"), null);
    assert.equal(await readStore(page, "wt.v1.settings"), null);

    const programCards = page.locator(".program-card");
    assert.equal(await programCards.count(), 2);
    assert.equal(
      sanitize(await programCards.nth(0).locator(".program-card-title").textContent()),
      "Upper"
    );
    assert.equal(
      sanitize(await programCards.nth(1).locator(".program-card-title").textContent()),
      "Lower"
    );
    assert.equal(
      sanitize(await programCards.nth(0).locator(".program-card-meta").textContent()),
      "5 exercises"
    );

    const seeded = await readStore(page, "wt.v1.programs");
    assert.deepEqual(
      seeded.map((program) => program.title),
      ["Upper", "Lower"]
    );
    assert.deepEqual(
      seeded[0].items.map((item) => [item.n, item.w, item.sets]),
      [
        ["Bench", 67.5, 3],
        ["Lat Pull Down", 59, 3],
        ["Lateral raise", 10, 2],
        ["Biceps curl", 14, 2],
        ["Triceps cable", 27, 2]
      ]
    );
    assert.deepEqual(
      seeded[1].items.map((item) => [item.n, item.w, item.sets]),
      [
        ["Squat", 77.5, 3],
        ["Leg curl", 42.5, 3],
        ["Calve", 70, 2],
        ["Abs", 0, 2],
        ["Elevation (lombaire)", 0, 2]
      ]
    );

    const quickLinkLabels = await page
      .locator(".header-actions button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    assert.deepEqual(quickLinkLabels, [
      "Open workout",
      "Open training calendar",
      "Open progress"
    ]);

    await page.getByLabel("Open progress", { exact: true }).click();
    await page.waitForSelector(".screen-progress");
    assert.equal(
      sanitize(await page.locator(".progress-hint").textContent()),
      "Log at least two sessions to see progress."
    );

    await page.goBack();
    await page.waitForSelector(".screen-list");

    await page.getByLabel("Open training calendar", { exact: true }).click();
    await page.waitForSelector(".screen-calendar");
    assert.equal(sanitize(await page.locator(".month-sub").textContent()), "No training");
    assert.match(
      sanitize(await page.locator(".empty-day").textContent()),
      /^Nothing logged on \d{1,2} [A-Z][a-z]+\.$/
    );
    assert.equal(await page.locator(".session-card").count(), 0);
  });

  /* ---------------------------------------------------------------------
     2. Program editor: save state, add, rename, delete, discard
     --------------------------------------------------------------------- */

  await scenario("Program editor supports add, rename, delete and save states", async ({ page }) => {
    await openUpperEditor(page);
    assert.equal(await page.locator(".back-button").isVisible(), true);
    assert.equal(sanitize(await page.locator(".editor-title").inputValue()), "Upper");
    assert.equal(await page.locator(".exercise-row").count(), 5);

    const saveButton = page.locator(".editor-actions button").nth(0);
    const startButton = page.locator(".editor-actions button").nth(1);
    assert.equal(sanitize(await saveButton.textContent()), "Saved");
    assert.equal(await saveButton.isDisabled(), true);
    assert.equal(await startButton.isEnabled(), true);

    await page.locator(".editor-title").fill("Upper A");
    assert.equal(sanitize(await saveButton.textContent()), "Save program");
    assert.equal(await saveButton.isEnabled(), true);
    await saveButton.click();
    assert.equal(sanitize(await saveButton.textContent()), "Saved");
    assert.equal(await saveButton.isDisabled(), true);
    let stored = await readStore(page, "wt.v1.programs");
    assert.equal(stored[0].title, "Upper A");

    await page.getByRole("button", { name: "Add exercise", exact: true }).click();
    assert.equal(await page.locator(".exercise-row").count(), 6);
    await page.waitForFunction(
      () => document.activeElement && document.activeElement.classList.contains("exercise-name")
    );
    await page.locator(".exercise-name").last().fill("Face pull");

    const firstInput = page.locator(".exercise-name").first();
    await firstInput.fill("Bench Press");

    const namesBeforeDelete = await getInputValues(page, ".exercise-name");
    const bicepsIndex = namesBeforeDelete.indexOf("Biceps curl");
    assert.notEqual(bicepsIndex, -1);
    await page.locator(".row-remove").nth(bicepsIndex).click();
    assert.equal(await page.locator(".exercise-row").count(), 5);
    const namesAfterDelete = await getInputValues(page, ".exercise-name");
    assert.equal(namesAfterDelete.includes("Biceps curl"), false);
    assert.equal(namesAfterDelete.includes("Face pull"), true);

    assert.equal(sanitize(await saveButton.textContent()), "Save program");
    await saveButton.click();
    assert.equal(sanitize(await saveButton.textContent()), "Saved");
    stored = await readStore(page, "wt.v1.programs");
    assert.equal(stored[0].title, "Upper A");
    assert.equal(stored[0].items[0].n, "Bench Press");
    assert.equal(stored[0].items.some((item) => item.n === "Biceps curl"), false);
    assert.equal(stored[0].items.some((item) => item.n === "Face pull"), true);

    await page.locator(".editor-title").fill("Discard me");
    assert.equal(sanitize(await saveButton.textContent()), "Save program");
    await page.locator(".back-button").click();
    await page.waitForSelector(".screen-list");
    assert.equal(
      sanitize(await page.locator(".program-card-title").first().textContent()),
      "Upper A"
    );
    await page.locator(".program-card").first().click();
    await page.waitForSelector(".screen-editor");
    assert.equal(sanitize(await page.locator(".editor-title").inputValue()), "Upper A");
  });

  /* ---------------------------------------------------------------------
     3. Pointer and keyboard reorder
     --------------------------------------------------------------------- */

  await scenario("Exercises reorder with pointer drag and keyboard", async ({ page }) => {
    await openUpperEditor(page);
    const initialNames = await getInputValues(page, ".exercise-name");
    assert.deepEqual(initialNames.slice(0, 3), ["Bench", "Lat Pull Down", "Lateral raise"]);

    const handle = page.locator(".drag-handle").first();
    assert.equal(
      await handle.evaluate((element) => getComputedStyle(element).touchAction),
      "none"
    );
    const handleBox = await handle.boundingBox();
    assert.ok(handleBox);
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 100, { steps: 12 });

    assert.equal(await page.locator(".exercise-row.is-dragging").count(), 1);
    const dragTransform = await page
      .locator(".exercise-row.is-dragging")
      .evaluate((element) => element.style.transform);
    assert.notEqual(dragTransform, "");
    const namesDuringDrag = await getInputValues(page, ".exercise-name");
    assert.deepEqual(namesDuringDrag.slice(0, 2), ["Lat Pull Down", "Bench"]);

    await page.mouse.up();
    assert.equal(await page.locator(".exercise-row.is-dragging").count(), 0);
    const afterPointer = await getInputValues(page, ".exercise-name");
    assert.deepEqual(afterPointer.slice(0, 2), ["Lat Pull Down", "Bench"]);

    const saveButton = page.locator(".editor-actions button").nth(0);
    assert.equal(await saveButton.isEnabled(), true);
    await saveButton.click();
    let stored = await readStore(page, "wt.v1.programs");
    assert.deepEqual(
      stored[0].items.slice(0, 2).map((item) => item.n),
      ["Lat Pull Down", "Bench"]
    );

    const secondHandle = page.locator(".exercise-row").nth(1).locator(".drag-handle");
    await secondHandle.focus();
    await page.keyboard.press("ArrowUp");
    const afterKeyboard = await getInputValues(page, ".exercise-name");
    assert.deepEqual(afterKeyboard.slice(0, 2), ["Bench", "Lat Pull Down"]);
    const focusedRowName = await page.evaluate(() => {
      const row = document.activeElement && document.activeElement.closest(".exercise-row");
      return row ? row.querySelector(".exercise-name").value : null;
    });
    assert.equal(focusedRowName, "Bench");
    assert.equal(await saveButton.isEnabled(), true);

    await saveButton.click();
    stored = await readStore(page, "wt.v1.programs");
    assert.deepEqual(
      stored[0].items.slice(0, 2).map((item) => item.n),
      ["Bench", "Lat Pull Down"]
    );
  });

  /* ---------------------------------------------------------------------
     4. Adding a program and the no-programs entry state
     --------------------------------------------------------------------- */

  await scenario("Add a new program from the list", async ({ page }) => {
    await page.getByRole("button", { name: "Add a new program" }).click();
    await page.waitForSelector(".screen-editor");
    assert.equal(await page.locator(".back-button").isVisible(), true);
    assert.equal(await page.locator(".editor-title").inputValue(), "My program");
    assert.equal(await page.locator(".exercise-row").count(), 0);
    const saveButton = page.locator(".editor-actions button").nth(0);
    const startButton = page.locator(".editor-actions button").nth(1);
    assert.equal(sanitize(await saveButton.textContent()), "Save program");
    assert.equal(await saveButton.isEnabled(), true);
    assert.equal(await startButton.isDisabled(), true);

    await page.locator(".editor-title").fill("Push");
    await page.getByRole("button", { name: "Add exercise", exact: true }).click();
    await page.locator(".exercise-name").fill("Overhead press");
    assert.equal(await startButton.isEnabled(), true);
    await saveButton.click();
    assert.equal(sanitize(await saveButton.textContent()), "Saved");

    await page.locator(".back-button").click();
    await page.waitForSelector(".screen-list");
    assert.equal(await page.locator(".program-card").count(), 3);
    assert.deepEqual(
      await page
        .locator(".program-card-title")
        .evaluateAll((elements) => elements.map((element) => element.textContent.trim())),
      ["Upper", "Lower", "Push"]
    );
  });

  await scenario("No saved programs opens the editor directly", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem("wt.v1.programs", "[]");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen-editor");
    await page.waitForFunction(() => location.hash === "#program");
    assert.equal(await page.locator(".back-button").isVisible(), false);
    assert.equal(await page.locator(".exercise-row").count(), 0);
    assert.equal(await page.locator(".editor-actions button").nth(1).isDisabled(), true);
  });

  /* ---------------------------------------------------------------------
     5. Starting workouts
     --------------------------------------------------------------------- */

  await scenario("Idle workout chooser starts a pill workout", async ({ page }) => {
    await openWorkoutIdle(page);
    assert.equal(
      sanitize(await page.locator(".idle-title").textContent()),
      "Choose program to start"
    );
    assert.equal(await page.locator(".idle-disc").isVisible(), true);
    assert.equal(await page.locator(".program-pill").count(), 2);
    assert.deepEqual(
      await page
        .locator(".program-pill")
        .evaluateAll((elements) => elements.map((element) => element.textContent.trim())),
      ["Upper", "Lower"]
    );
    assert.equal(await page.locator(".work-timer").count(), 0);
    assert.equal(await page.locator(".work-card").count(), 0);
    assert.equal(await page.locator(".break-switch").count(), 0);
    assert.equal(await page.locator(".work-bottom").count(), 0);

    await page.locator(".idle-disc").click();
    await page.waitForSelector(".screen-list");
    await page.goBack();
    await page.waitForSelector(".screen-work-idle");

    await page.getByRole("button", { name: "Start Upper workout" }).click();
    await page.waitForSelector(".screen-work-active");
    assert.equal(await page.evaluate(() => location.hash), "#work");
    assert.equal(sanitize(await page.locator(".work-exercise-name").textContent()), "Bench");
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "0:00");
    assert.equal(await page.locator(".set-box").count(), 3);
    assert.equal(await page.locator(".break-option.is-selected").textContent(), "120s");
    assert.equal(await page.locator(".work-top-actions button").count(), 3);
    assert.deepEqual(
      await page
        .locator(".work-top-actions button")
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))),
      ["Edit program", "Open training calendar", "Open progress"]
    );
    const active = await readStore(page, "wt.v1.active");
    assert.equal(active.title, "Upper");
    assert.equal(active.exercises[0].n, "Bench");
    assert.equal(await readStore(page, "wt.v1.sessions"), null);
  });

  await scenario("Start workout from the editor without saving", async ({ page }) => {
    await openUpperEditor(page);
    await page.locator(".exercise-name").first().fill("Bench Press");
    await page.getByRole("button", { name: "Start workout" }).click();
    await page.waitForSelector(".screen-work-active");
    assert.equal(
      sanitize(await page.locator(".work-exercise-name").textContent()),
      "Bench Press"
    );
    const stored = await readStore(page, "wt.v1.programs");
    assert.equal(stored[0].items[0].n, "Bench");
    const active = await readStore(page, "wt.v1.active");
    assert.equal(active.exercises[0].n, "Bench Press");
  });

  /* ---------------------------------------------------------------------
     6. Set logging, weight, reps, swipe and reload persistence
     --------------------------------------------------------------------- */

  await scenario("Sets, weight, reps, swipe and reload persistence", async ({ page }) => {
    await startUpperFromList(page);
    await installVibrationSpy(page);

    const weightInput = page.locator(".weight-input");
    assert.equal(await weightInput.inputValue(), "67.5");
    assert.equal(await page.locator(".weight-unit").evaluate((e) => e.classList.contains("is-visible")), true);

    const repsInput = page.locator(".reps-input");
    assert.equal(await repsInput.inputValue(), "10");
    await page.getByLabel("Increase reps").click();
    assert.equal(await repsInput.inputValue(), "11");
    await page.getByLabel("Decrease reps").click();
    assert.equal(await repsInput.inputValue(), "10");
    await repsInput.fill("8");
    assert.equal(await repsInput.inputValue(), "8");

    await weightInput.fill("70");
    assert.equal(
      await page.locator(".weight-unit").evaluate((e) => e.classList.contains("is-visible")),
      true
    );
    let programs = await readStore(page, "wt.v1.programs");
    assert.equal(programs[0].items[0].w, 70);
    let active = await readStore(page, "wt.v1.active");
    assert.equal(active.exercises[0].w, 70);

    const firstSet = page.locator(".set-box").first();
    assert.equal(await firstSet.evaluate((e) => e.classList.contains("is-current")), true);
    await firstSet.click();
    assert.equal(await firstSet.evaluate((e) => e.classList.contains("is-done")), true);
    assert.equal(await firstSet.getAttribute("aria-pressed"), "true");
    assert.equal(sanitize(await page.locator(".set-log").first().textContent()), "8");
    const vibrations = await page.evaluate(() => window.__vibrations);
    assert.ok(vibrations.some((entry) => entry === 15 || (Array.isArray(entry) && entry[0] === 15)));

    active = await readStore(page, "wt.v1.active");
    assert.deepEqual(active.exercises[0].done[0].r, 8);
    assert.deepEqual(active.exercises[0].done[0].w, 70);
    assert.match(active.exercises[0].done[0].t, /^\d{2}:\d{2}$/);

    await firstSet.click();
    assert.equal(await firstSet.evaluate((e) => e.classList.contains("is-done")), false);
    active = await readStore(page, "wt.v1.active");
    assert.equal(active.exercises[0].done[0], null);
    await firstSet.click();

    await page.locator(".exercise-name, .work-exercise-name").first().dispatchEvent("pointerdown", {
      pointerId: 71,
      pointerType: "touch",
      clientX: 300,
      clientY: 160,
      bubbles: true
    });
    await page.locator(".work-exercise-name").dispatchEvent("pointerup", {
      pointerId: 71,
      pointerType: "touch",
      clientX: 160,
      clientY: 164,
      bubbles: true
    });
    await page.waitForFunction(
      () => document.querySelector(".work-exercise-name")?.textContent === "Lat Pull Down"
    );
    assert.equal(await page.locator(".work-exercise-name").textContent(), "Lat Pull Down");
    assert.equal(await page.locator(".reps-input").inputValue(), "10");
    assert.equal(await page.locator(".weight-input").inputValue(), "59");

    await page.getByLabel("Previous exercise").click();
    await page.waitForFunction(
      () => document.querySelector(".work-exercise-name")?.textContent === "Bench"
    );
    assert.equal(await page.locator(".set-box").first().evaluate((e) => e.classList.contains("is-done")), true);
    assert.equal(await page.locator(".reps-input").inputValue(), "8");

    active = await readStore(page, "wt.v1.active");
    assert.equal(active.currentIndex, 0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen-work-active");
    assert.equal(await page.locator(".work-exercise-name").textContent(), "Bench");
    assert.equal(await page.locator(".weight-input").inputValue(), "70");
    assert.equal(await page.locator(".reps-input").inputValue(), "8");
    assert.equal(await page.locator(".set-box").first().evaluate((e) => e.classList.contains("is-done")), true);
    assert.equal(sanitize(await page.locator(".set-log").first().textContent()), "8");
  });

  /* ---------------------------------------------------------------------
     7. Rest timer
     --------------------------------------------------------------------- */

  await scenario("Rest timer start, pause, resume, reset, presets and completion", async ({ page }) => {
    await startUpperFromList(page);
    await installVibrationSpy(page);
    await page.clock.install({ time: new Date("2026-11-19T16:00:00") });

    await page.locator(".break-option").nth(0).click();
    assert.equal(await page.locator(".break-option.is-selected").textContent(), "60s");
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "0:00");

    await page.locator(".dial").click();
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-running")), false);
    await page.clock.fastForward(300);
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-running")), true);
    await page.clock.fastForward(1100);
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "0:01");

    await page.locator(".dial").click();
    await page.clock.fastForward(300);
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-running")), false);
    const pausedValue = sanitize(await page.locator(".work-timer").textContent());
    await page.clock.fastForward(5000);
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), pausedValue);

    await page.locator(".dial").click();
    await page.clock.fastForward(300);
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-running")), true);
    await page.clock.fastForward(900);
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "0:02");
    await page.locator(".dial").click();
    await page.clock.fastForward(300);

    await page.locator(".break-option").nth(2).click();
    assert.equal(await page.locator(".break-option.is-selected").textContent(), "180s");
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "0:00");
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-running")), false);

    await page.locator(".break-option").nth(0).click();
    await page.locator(".dial").click();
    await page.clock.fastForward(300);
    await page.clock.fastForward(61000);
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "1:00");
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-complete")), true);
    assert.equal(await page.evaluate(() => document.querySelector(".work-timer").classList.contains("is-complete")), true);
    await page.waitForTimeout(260);
    const timerColor = await page
      .locator(".work-timer")
      .evaluate((element) => getComputedStyle(element).color);
    assert.equal(timerColor, "rgb(34, 160, 107)");
    const vibrations = await page.evaluate(() => window.__vibrations);
    assert.ok(
      vibrations.some(
        (entry) => Array.isArray(entry) && entry.join(",") === "80,60,80"
      ),
      `Expected the break vibration, received ${JSON.stringify(vibrations)}`
    );

    await page.locator(".dial").click();
    await page.locator(".dial").click();
    await page.clock.fastForward(300);
    assert.equal(sanitize(await page.locator(".work-timer").textContent()), "0:00");
    assert.equal(await page.evaluate(() => document.querySelector(".dial").classList.contains("is-complete")), false);
  });

  /* ---------------------------------------------------------------------
     8. Finish workout, history and calendar
     --------------------------------------------------------------------- */

  await scenario("Finish workout saves a session and the calendar unfolds it", async ({ page }) => {
    await startUpperFromList(page);
    await page.locator(".reps-input").fill("8");
    await page.locator(".set-box").first().click();
    await page.locator(".reps-input").fill("7");
    await page.locator(".set-box").nth(1).click();

    for (let index = 0; index < 4; index += 1) {
      await page.locator(".next-button").click();
      await page.waitForSelector(".screen-work-active");
    }
    assert.equal(sanitize(await page.locator(".next-button").textContent()), "Finish workout");
    await page.locator(".next-button").click();
    await page.waitForSelector(".screen-calendar");
    assert.equal(await page.evaluate(() => location.hash), "#log");

    const sessions = await readStore(page, "wt.v1.sessions");
    assert.equal(Array.isArray(sessions), true);
    assert.equal(sessions.length, 1);
    const today = await localToday(page);
    assert.equal(sessions[0].date, today);
    assert.equal(sessions[0].title, "Upper");
    const benchSession = sessions[0].exercises.find((exercise) => exercise.n === "Bench");
    assert.equal(benchSession.sets.length, 2);
    assert.deepEqual(
      benchSession.sets.map((set) => [set.r, set.w]),
      [
        [8, 67.5],
        [7, 67.5]
      ]
    );
    assert.equal(await readStore(page, "wt.v1.active"), null);

    const todayCell = page.locator(".day.is-today");
    assert.equal(await todayCell.count(), 1);
    assert.equal(await todayCell.evaluate((element) => element.classList.contains("is-trained")), true);
    assert.equal(await todayCell.evaluate((element) => element.classList.contains("is-selected")), true);
    assert.equal(sanitize(await todayCell.locator(".day-mark").textContent()), "U");
    assert.equal(sanitize(await todayCell.locator(".day-number").textContent()), String(localDateParts().day));
    assert.equal(sanitize(await page.locator(".month-sub").textContent()), "1 trained day");

    assert.equal(await page.locator(".session-card").count(), 1);
    assert.equal(sanitize(await page.locator(".session-title").first().textContent()), "Upper");
    const sessionMeta = sanitize(await page.locator(".session-meta").first().textContent());
    assert.match(sessionMeta, /\b2 sets\b/);
    assert.match(sessionMeta, /\b[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}\b/);
    assert.equal(await page.locator(".session-body").first().isVisible(), false);
    const header = page.locator(".session-head").first();
    assert.equal(await header.getAttribute("aria-expanded"), "false");
    await header.click();
    assert.equal(await header.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator(".session-body").first().isVisible(), true);
    const bodyText = sanitize(await page.locator(".session-body").first().textContent());
    assert.match(bodyText, /Bench/);
    assert.match(bodyText, /67\.5 kg/);
    assert.match(bodyText, /8, 7 reps/);

    const untrained = page.locator(".day:not(.is-blank):not(.is-trained)").first();
    await untrained.click();
    await page.waitForTimeout(20);
    assert.match(
      sanitize(await page.locator(".empty-day").textContent()),
      /^Nothing logged on \d{1,2} [A-Z][a-z]+\.$/
    );
    assert.equal(await page.locator(".session-card").count(), 0);

    await page.locator(".back-button").click();
    await page.waitForSelector(".screen-work-idle");
  });

  await scenario("Finishing without a checked set saves nothing", async ({ page }) => {
    await startUpperFromList(page);
    for (let index = 0; index < 4; index += 1) {
      await page.locator(".next-button").click();
      await page.waitForSelector(".screen-work-active");
    }
    await page.locator(".next-button").click();
    await page.waitForSelector(".screen-calendar");
    assert.equal(await readStore(page, "wt.v1.sessions"), null);
    assert.equal(await readStore(page, "wt.v1.active"), null);
    assert.equal(sanitize(await page.locator(".month-sub").textContent()), "No training");
    assert.equal(await page.locator(".session-card").count(), 0);
  });

  await scenario("Edit program from an active workout and Back returns", async ({ page }) => {
    await startUpperFromList(page);
    await page.locator(".set-box").first().click();
    await page.getByLabel("Edit program").click();
    await page.waitForSelector(".screen-editor");
    assert.equal(await page.evaluate(() => location.hash), "#program");
    assert.equal(sanitize(await page.locator(".editor-title").inputValue()), "Upper");
    await page.locator(".back-button").click();
    await page.waitForSelector(".screen-work-active");
    assert.equal(await page.evaluate(() => location.hash), "#work");
    assert.equal(
      await page.locator(".set-box").first().evaluate((element) => element.classList.contains("is-done")),
      true
    );
  });

  await scenario("Two sessions on one day show a plus marker and two cards", async ({ page }) => {
    await page.evaluate(() => {
      const pad = (value) => String(value).padStart(2, "0");
      const date = new Date();
      const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const sets = [{ r: 8, w: 67.5, t: "18:00" }];
      localStorage.setItem(
        "wt.v1.sessions",
        JSON.stringify([
          {
            id: "same-day-upper",
            date: today,
            title: "Upper",
            exercises: [{ n: "Bench", sets }]
          },
          {
            id: "same-day-lower",
            date: today,
            title: "Lower",
            exercises: [{ n: "Squat", sets: [{ r: 6, w: 80, t: "19:00" }] }]
          }
        ])
      );
      location.hash = "#log";
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen-calendar");
    assert.equal(sanitize(await page.locator(".month-sub").textContent()), "1 trained day");
    assert.equal(sanitize(await page.locator(".day.is-today .day-mark").textContent()), "U+");
    assert.equal(await page.locator(".session-card").count(), 2);
    assert.deepEqual(
      await page
        .locator(".session-title")
        .evaluateAll((elements) => elements.map((element) => element.textContent.trim())),
      ["Upper", "Lower"]
    );
  });

  await scenario("Screen Wake Lock is requested while active and released", async ({ page }) => {
    await startUpperFromList(page);
    await page.addInitScript(() => {
      window.__wake = { requests: 0, releases: 0, failed: null };
      try {
        Object.defineProperty(navigator, "wakeLock", {
          configurable: true,
          value: {
            request: async () => {
              window.__wake.requests += 1;
              return {
                addEventListener() {},
                release: async () => {
                  window.__wake.releases += 1;
                }
              };
            }
          }
        });
      } catch (error) {
        window.__wake.failed = String(error);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen-work-active");
    await page.waitForFunction(
      () => window.__wake && (window.__wake.requests > 0 || window.__wake.failed)
    );
    const wake = await page.evaluate(() => window.__wake);
    assert.equal(wake.failed, null);
    assert.ok(wake.requests >= 1);
    await page.getByLabel("Open training calendar").click();
    await page.waitForSelector(".screen-calendar");
    await page.waitForFunction(() => window.__wake.releases >= 1);
    assert.ok((await page.evaluate(() => window.__wake.releases)) >= 1);
  });

  await scenario("An unfinished workout counts as today on the calendar", async ({ page }) => {
    await startUpperFromList(page);
    await page.locator(".set-box").first().click();
    await page.getByLabel("Open training calendar").click();
    await page.waitForSelector(".screen-calendar");

    const todayCell = page.locator(".day.is-today");
    assert.equal(await todayCell.evaluate((element) => element.classList.contains("is-trained")), true);
    assert.equal(await todayCell.evaluate((element) => element.classList.contains("is-selected")), true);
    assert.equal(sanitize(await page.locator(".month-sub").textContent()), "1 trained day");
    assert.equal(
      sanitize(await page.locator(".session-status").textContent()),
      "Today, in progress"
    );
    assert.equal(await page.locator(".session-card").count(), 1);
    assert.equal(await page.locator(".session-body").first().isVisible(), false);
    assert.match(
      sanitize(await page.locator(".session-meta").textContent()),
      /1 set/
    );

    await page.locator(".back-button").click();
    await page.waitForSelector(".screen-work-active");
    assert.equal(await page.evaluate(() => location.hash), "#work");
    assert.equal(await page.locator(".work-exercise-name").textContent(), "Bench");
    assert.equal(
      await page.locator(".set-box").first().evaluate((element) => element.classList.contains("is-done")),
      true
    );
  });

  /* ---------------------------------------------------------------------
     9. Progress
     --------------------------------------------------------------------- */

  await scenario("Progress requires two sessions and draws sparklines and deltas", async ({ page }) => {
    await page.getByLabel("Open progress", { exact: true }).click();
    await page.waitForSelector(".screen-progress");
    assert.equal(
      sanitize(await page.locator(".progress-hint").textContent()),
      "Log at least two sessions to see progress."
    );
    assert.equal(await page.locator(".progress-row").count(), 0);

    await page.evaluate(() => {
      const sessions = [
        {
          id: "fixture-session-1",
          date: "2026-11-17",
          title: "Upper",
          exercises: [
            {
              n: "Bench",
              sets: [
                { r: 8, w: 67.5, t: "18:10" },
                { r: 7, w: 67.5, t: "18:15" }
              ]
            },
            {
              n: "Lat Pull Down",
              sets: [{ r: 10, w: 59, t: "18:20" }]
            },
            {
              n: "Abs",
              sets: [
                { r: 20, w: 0, t: "18:25" },
                { r: 16, w: 0, t: "18:28" }
              ]
            },
            {
              n: "Squat",
              sets: [{ r: 8, w: 80, t: "18:35" }]
            },
            {
              n: "Triceps cable",
              sets: [{ r: 12, w: 27, t: "18:42" }]
            }
          ]
        },
        {
          id: "fixture-session-2",
          date: "2026-11-19",
          title: "Upper",
          exercises: [
            {
              n: "Bench",
              sets: [{ r: 8, w: 70, t: "19:02" }]
            },
            {
              n: "Lat Pull Down",
              sets: [{ r: 11, w: 59, t: "19:07" }]
            },
            {
              n: "Abs",
              sets: [
                { r: 22, w: 0, t: "19:12" },
                { r: 20, w: 0, t: "19:15" }
              ]
            },
            {
              n: "Squat",
              sets: [{ r: 6, w: 75, t: "19:20" }]
            }
          ]
        }
      ];
      localStorage.setItem("wt.v1.sessions", JSON.stringify(sessions));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen-progress");

    assert.equal(await page.locator(".progress-title").textContent(), "Progress");
    const names = await page
      .locator(".progress-name")
      .evaluateAll((elements) => elements.map((element) => element.textContent.trim()));
    assert.deepEqual(names, ["Bench", "Lat Pull Down", "Abs", "Squat"]);
    assert.equal(await page.locator(".progress-row").count(), 4);
    assert.equal(await page.locator(".sparkline polyline").count(), 4);
    assert.equal(await page.locator(".sparkline circle").count(), 4);

    const latest = await page
      .locator(".progress-latest")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          value: element.childNodes[0].textContent.trim(),
          unit: element.querySelector(".progress-latest-unit").textContent.trim()
        }))
      );
    assert.deepEqual(latest, [
      { value: "70", unit: "kg" },
      { value: "59", unit: "kg" },
      { value: "42", unit: "reps" },
      { value: "75", unit: "kg" }
    ]);

    const deltas = await page
      .locator(".progress-delta")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent.trim(),
          positive: element.classList.contains("is-positive")
        }))
      );
    assert.deepEqual(deltas, [
      { text: "+2.5", positive: true },
      { text: "0", positive: false },
      { text: "+6", positive: true },
      { text: "-5", positive: false }
    ]);

    const firstSparklinePoints = await page
      .locator(".sparkline polyline")
      .first()
      .getAttribute("points");
    assert.match(firstSparklinePoints, /^\d/);
    assert.equal(await page.locator(".progress-hint").count(), 0);
  });

  /* ---------------------------------------------------------------------
     10. Illustrations
     --------------------------------------------------------------------- */

  await scenario("Exercise illustrations map by keyword and share one style", async ({ page }) => {
    const expected = [
      ["Bench Press", "bench"],
      ["Pull-up", "pullup"],
      ["Push-up", "pushup"],
      ["Lat Pull Down", "latpull"],
      ["Lateral raise", "lateralraise"],
      ["Biceps curl", "bicepscur"],
      ["Triceps cable", "triceps"],
      ["Squat", "squat"],
      ["Leg curl", "legcurl"],
      ["Calve", "calfraise"],
      ["Abs", "abs"],
      ["Elevation (lombaire)", "backextension"],
      ["Mystery move", "generic"]
    ];
    await page.evaluate((names) => {
      const pad = (value) => String(value).padStart(2, "0");
      const date = new Date();
      const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      localStorage.setItem(
        "wt.v1.active",
        JSON.stringify({
          id: "illustration-check",
          programId: null,
          title: "Illustrations",
          date: today,
          currentIndex: 0,
          reps: 10,
          break: 120,
          timer: null,
          exercises: names.map((name, index) => ({
            n: name,
            w: 0,
            sets: 1,
            done: [null],
            reps: 10,
            sourceIndex: index
          }))
        })
      );
      location.hash = "#work";
    }, expected.map(([name]) => name));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen-work-active");

    const seen = [];
    for (let index = 0; index < expected.length; index += 1) {
      const [expectedName, expectedKey] = expected[index];
      await page.waitForFunction(
        (name) => document.querySelector(".work-exercise-name")?.textContent === name,
        expectedName
      );
      const key = await page.locator(".exercise-art").getAttribute("data-illustration");
      assert.equal(key, expectedKey);
      const style = await page.locator(".exercise-art svg").evaluate((svg) => {
        const group = svg.querySelector("g");
        return {
          viewBox: svg.getAttribute("viewBox"),
          ariaHidden: svg.getAttribute("aria-hidden"),
          rootFill: svg.getAttribute("fill"),
          stroke: group.getAttribute("stroke"),
          strokeWidth: group.getAttribute("stroke-width"),
          linecap: group.getAttribute("stroke-linecap"),
          linejoin: group.getAttribute("stroke-linejoin"),
          fills: Array.from(new Set(
            Array.from(svg.querySelectorAll("[fill]")).map((element) =>
              element.getAttribute("fill")
            )
          )).sort(),
          heads: svg.querySelectorAll('circle[fill="var(--card)"]').length,
          torsos: svg.querySelectorAll('path[fill="var(--track)"]').length
        };
      });
      assert.deepEqual(style, {
        viewBox: "0 0 120 120",
        ariaHidden: "true",
        rootFill: "none",
        stroke: "var(--acc)",
        strokeWidth: "6",
        linecap: "round",
        linejoin: "round",
        fills: ["var(--card)", "var(--track)"],
        heads: 1,
        torsos: 1
      });
      seen.push(key);
      if (index < expected.length - 1) {
        await page.locator(".next-button").click();
      }
    }
    assert.deepEqual(seen, expected.map(([, key]) => key));
  });

  /* ---------------------------------------------------------------------
     11. 360 x 740 layout checks
     --------------------------------------------------------------------- */

  await scenario(
    "No horizontal scroll and a one-line workout top bar at 360x740",
    async ({ page }) => {
      async function assertNoHorizontalOverflow(label) {
        const metrics = await page.evaluate(() => ({
          html: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: window.innerWidth
        }));
        assert.ok(
          metrics.html <= metrics.viewport && metrics.body <= metrics.viewport,
          `${label} overflows horizontally: ${JSON.stringify(metrics)}`
        );
      }

      await assertNoHorizontalOverflow("program list");
      await openUpperEditor(page);
      await assertNoHorizontalOverflow("program editor");
      await page.locator(".back-button").click();
      await page.waitForSelector(".screen-list");

      await openWorkoutIdle(page);
      await assertNoHorizontalOverflow("workout idle");
      await page.getByRole("button", { name: "Start Upper workout" }).click();
      await page.waitForSelector(".screen-work-active");
      await assertNoHorizontalOverflow("workout active");

      const layout = await page.evaluate(() => {
        const bar = document.querySelector(".work-topbar");
        const barRect = bar.getBoundingClientRect();
        const controls = Array.from(bar.querySelectorAll("button")).map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            label: button.getAttribute("aria-label") || button.textContent.trim()
          };
        });
        const setBoxes = Array.from(document.querySelectorAll(".set-box")).map((box) => {
          const rect = box.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        return {
          barWidth: barRect.width,
          barHeight: barRect.height,
          barScrollWidth: bar.scrollWidth,
          barClientWidth: bar.clientWidth,
          flexWrap: getComputedStyle(bar).flexWrap,
          controls,
          setBoxes
        };
      });
      assert.equal(layout.flexWrap, "nowrap");
      assert.equal(new Set(layout.controls.map((control) => control.top)).size, 1);
      assert.ok(layout.barHeight <= 52, `Top bar is too tall: ${layout.barHeight}`);
      assert.ok(layout.barScrollWidth <= layout.barClientWidth + 1);
      layout.controls.forEach((control) => {
        assert.ok(control.height >= 44, `${control.label} touch height is ${control.height}`);
        assert.ok(control.width >= 44, `${control.label} touch width is ${control.width}`);
      });
      layout.setBoxes.forEach((box) => {
        assert.ok(box.width >= 43.5, `Set box width is ${box.width}`);
        assert.ok(box.height >= 43.5, `Set box height is ${box.height}`);
      });

      await page.getByLabel("Open training calendar").click();
      await page.waitForSelector(".screen-calendar");
      await assertNoHorizontalOverflow("calendar");
      const calendarMetrics = await page.evaluate(() => {
        const days = Array.from(document.querySelectorAll(".day:not(.is-blank)")).map((day) => {
          const rect = day.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          days
        };
      });
      assert.ok(calendarMetrics.scrollWidth <= calendarMetrics.viewport);
      calendarMetrics.days.forEach((day) => {
        assert.ok(day.width >= 43.5, `Calendar cell width is ${day.width}`);
        assert.ok(day.height >= 43.5, `Calendar cell height is ${day.height}`);
      });

      await page.locator(".back-button").click();
      await page.waitForSelector(".screen-work-active");
      await page.getByLabel("Open progress").click();
      await page.waitForSelector(".screen-progress");
      await assertNoHorizontalOverflow("progress");
    },
    { viewport: { width: 360, height: 740 } }
  );

  await scenario(
    "Six sets fit at 360 px with 44 px targets",
    async ({ page }) => {
      await page.evaluate(() => {
        const programs = JSON.parse(localStorage.getItem("wt.v1.programs"));
        programs[0].items[0].sets = 6;
        localStorage.setItem("wt.v1.programs", JSON.stringify(programs));
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await startUpperFromList(page);
      assert.equal(await page.locator(".set-box").count(), 6);
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        boxes: Array.from(document.querySelectorAll(".set-box")).map((box) => {
          const rect = box.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })
      }));
      assert.ok(metrics.scrollWidth <= metrics.viewport);
      metrics.boxes.forEach((box) => {
        assert.ok(box.width >= 43.5, `Set width ${box.width}`);
        assert.ok(box.height >= 43.5, `Set height ${box.height}`);
      });
    },
    { viewport: { width: 360, height: 740 } }
  );

  await scenario(
    "App, assets and service worker work from a GitHub Pages sub-path",
    async ({ page, baseUrl }) => {
      assert.equal(await page.evaluate(() => location.pathname), "/workout/");
      assert.equal(await page.locator(".program-card").count(), 2);
      assert.equal(
        await page.locator('link[rel="manifest"]').getAttribute("href"),
        "./manifest.webmanifest"
      );
      const resolvedManifest = await page.evaluate(() => {
        const link = document.querySelector('link[rel="manifest"]');
        return link ? link.href : null;
      });
      assert.equal(resolvedManifest, `${baseUrl}/workout/manifest.webmanifest`);
      const manifestResponse = await page.request.get(resolvedManifest);
      assert.equal(manifestResponse.status(), 200);
      const manifest = await manifestResponse.json();
      assert.equal(manifest.start_url, "./");
      assert.equal(manifest.scope, "./");

      const serviceWorker = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return null;
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 10000))
        ]);
        if (!registration) return null;
        return {
          scope: registration.scope,
          scriptUrl: registration.active ? registration.active.scriptURL : null
        };
      });
      assert.ok(serviceWorker, "Service worker should register under a sub-path");
      assert.ok(serviceWorker.scope.endsWith("/workout/"));
      assert.ok(serviceWorker.scriptUrl.endsWith("/workout/sw.js"));

      await page.getByLabel("Open workout", { exact: true }).click();
      await page.waitForSelector(".screen-work-idle");
      await page.getByRole("button", { name: "Start Upper workout" }).click();
      await page.waitForSelector(".screen-work-active");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".screen-work-active");
      assert.equal(await page.locator(".work-exercise-name").textContent(), "Bench");
    },
    { startPath: "/workout/" }
  );

  /* ---------------------------------------------------------------------
     11. PWA shell and static safety checks
     --------------------------------------------------------------------- */

  await scenario("Manifest, icons, service worker and static safety", async ({ page, baseUrl }) => {
    const manifestResponse = await page.request.get(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifestResponse.status(), 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, "Workout Tracker");
    assert.equal(manifest.short_name, "Workout");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.orientation, "portrait");
    assert.equal(manifest.start_url, "./");
    assert.equal(manifest.scope, "./");
    assert.equal(manifest.theme_color, "#10131A");
    assert.equal(manifest.background_color, "#10131A");
    assert.equal(manifest.icons.length, 3);
    assert.deepEqual(
      manifest.icons.map((icon) => [icon.src, icon.sizes, icon.type, icon.purpose]),
      [
        ["./icons/icon-192.png", "192x192", "image/png", "any"],
        ["./icons/icon-512.png", "512x512", "image/png", "any"],
        ["./icons/icon-maskable-512.png", "512x512", "image/png", "maskable"]
      ]
    );

    const iconFiles = [
      ["icons/icon-192.png", 192],
      ["icons/icon-512.png", 512],
      ["icons/icon-maskable-512.png", 512]
    ];
    iconFiles.forEach(([relativePath, expectedSize]) => {
      const buffer = fs.readFileSync(path.join(ROOT, relativePath));
      assert.equal(buffer.slice(1, 4).toString("ascii"), "PNG");
      assert.equal(buffer.readUInt32BE(16), expectedSize);
      assert.equal(buffer.readUInt32BE(20), expectedSize);
    });

    assert.equal(await page.locator('link[rel="manifest"]').count(), 1);
    assert.equal(await page.locator('link[rel="apple-touch-icon"]').count(), 1);
    assert.equal(await page.locator('meta[name="theme-color"]').count(), 2);

    const swInfo = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return null;
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 10000))
      ]);
      if (!registration) return null;
      const worker = registration.active || registration.waiting || registration.installing;
      if (worker && worker.state !== "activated") {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 8000);
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated" || worker.state === "redundant") {
              clearTimeout(timeout);
              resolve();
            }
          });
        });
      }
      const cacheNames = await caches.keys();
      return {
        scope: registration.scope,
        state: registration.active ? registration.active.state : null,
        scriptUrl: registration.active ? registration.active.scriptURL : null,
        cacheNames
      };
    });
    assert.ok(swInfo, "Service worker did not become ready");
    assert.equal(swInfo.state, "activated");
    assert.ok(swInfo.scriptUrl.endsWith("/sw.js"));
    assert.ok(swInfo.scope.endsWith("/"));
    assert.ok(swInfo.cacheNames.some((name) => name.startsWith("workout-tracker-shell-")));

    const appSource = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    assert.equal(/toISOString\s*\(/.test(appSource), false);
    assert.equal(/\b(?:alert|confirm|prompt)\s*\(/.test(appSource), false);
    assert.ok(appSource.includes('"wt.v1.programs"'));
    const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    assert.match(swSource, /const CACHE_VERSION = "wt-v1";/);
    assert.match(swSource, /skipWaiting/);
    assert.match(swSource, /clients\.claim/);
    assert.match(swSource, /caches\.delete/);
    assert.equal(/toISOString\s*\(/.test(swSource), false);
  });

  /* --------------------------------------------------------------------- */

  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  const failures = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
  if (failures.length) {
    console.error("Failed checks:");
    failures.forEach((failure) => console.error(`- ${failure.name}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
