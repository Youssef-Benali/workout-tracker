"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer, ROOT } = require("./server.cjs");

const OUTPUT = path.join(__dirname, "screenshots");

function pad(value) {
  return String(value).padStart(2, "0");
}

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fixtureSessions() {
  return [
    {
      id: "visual-session-upper",
      date: localDate(0),
      title: "Upper",
      exercises: [
        {
          n: "Bench",
          sets: [
            { r: 8, w: 70, t: "18:12" },
            { r: 8, w: 70, t: "18:17" },
            { r: 7, w: 70, t: "18:22" }
          ]
        },
        {
          n: "Lat Pull Down",
          sets: [
            { r: 10, w: 59, t: "18:28" },
            { r: 9, w: 59, t: "18:33" }
          ]
        },
        {
          n: "Abs",
          sets: [
            { r: 20, w: 0, t: "18:39" },
            { r: 16, w: 0, t: "18:42" }
          ]
        }
      ]
    },
    {
      id: "visual-session-lower",
      date: localDate(0),
      title: "Lower",
      exercises: [
        {
          n: "Squat",
          sets: [
            { r: 6, w: 77.5, t: "17:04" },
            { r: 6, w: 77.5, t: "17:09" },
            { r: 5, w: 77.5, t: "17:14" }
          ]
        },
        {
          n: "Calve",
          sets: [
            { r: 12, w: 70, t: "17:20" },
            { r: 11, w: 70, t: "17:24" }
          ]
        }
      ]
    },
    {
      id: "visual-session-older",
      date: localDate(-7),
      title: "Upper",
      exercises: [
        {
          n: "Bench",
          sets: [
            { r: 8, w: 67.5, t: "18:10" },
            { r: 7, w: 67.5, t: "18:16" }
          ]
        },
        {
          n: "Abs",
          sets: [{ r: 20, w: 0, t: "18:23" }]
        }
      ]
    }
  ];
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
        locale: "en-GB",
        timezoneId: "Europe/Brussels",
        serviceWorkers: "allow"
      });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      const schemeDir = path.join(OUTPUT, scheme);
      fs.mkdirSync(schemeDir, { recursive: true });

      const shot = async (fileName) => {
        await page.evaluate(async () => {
          try {
            await document.fonts.ready;
          } catch (error) {
            // System fallbacks are part of the design.
          }
        });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(schemeDir, fileName),
          fullPage: true
        });
        console.log(`captured ${scheme}/${fileName}`);
      };

      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".screen-list");
      await shot("01-program-list.png");

      await page.locator(".program-card").first().click();
      await page.waitForSelector(".screen-editor");
      await shot("02-program-editor.png");

      await page.locator(".back-button").click();
      await page.waitForSelector(".screen-list");
      await page.getByLabel("Open workout", { exact: true }).click();
      await page.waitForSelector(".screen-work-idle");
      await shot("03-workout-idle.png");

      await page.getByRole("button", { name: "Start Upper workout" }).click();
      await page.waitForSelector(".screen-work-active");
      await page.locator(".reps-input").fill("8");
      await page.locator(".set-box").first().click();
      await shot("04-workout-active.png");

      const fixture = fixtureSessions();
      await page.evaluate((sessions) => {
        localStorage.setItem("wt.v1.sessions", JSON.stringify(sessions));
        localStorage.removeItem("wt.v1.active");
        location.hash = "#log";
      }, fixture);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".screen-calendar");
      await shot("05-calendar.png");

      await page.evaluate(() => {
        location.hash = "#progress";
      });
      await page.waitForSelector(".screen-progress");
      await shot("06-progress.png");

      assert.deepEqual(errors, [], `Console errors while capturing ${scheme} screenshots`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
