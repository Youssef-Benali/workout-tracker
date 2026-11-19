/* ==========================================================================
   Workout Tracker
   A dependency-free offline workout journal.
   ========================================================================== */

(() => {
  "use strict";

  const APP_NAME = "Workout Tracker";
  const BREAKS = [60, 120, 180];
  const DEFAULT_BREAK = 120;
  const VALID_VIEWS = new Set(["list", "program", "work", "log", "progress"]);
  const STORAGE_KEYS = Object.freeze({
    programs: "wt.v1.programs",
    sessions: "wt.v1.sessions",
    active: "wt.v1.active",
    settings: "wt.v1.settings"
  });
  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const MONTHS_SHORT = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
  const WEEKDAYS_LONG = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];
  const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAYS_MONDAY_FIRST = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const VIEW_TITLES = Object.freeze({
    list: "Programs",
    program: "Edit program",
    work: "Workout",
    log: "Calendar",
    progress: "Progress"
  });
  const SVG_NS = "http://www.w3.org/2000/svg";

  const appEl = document.getElementById("app");
  const liveEl = document.getElementById("app-live");

  let programs = [];
  let sessions = [];
  let activeWorkout = null;
  let settings = { break: DEFAULT_BREAK };
  let editor = null;
  let editorUi = null;
  let workUi = null;
  let calendar = null;
  let currentView = null;
  let timerInterval = null;
  let wakeLock = null;
  let wakeLockRequest = null;
  let dialTapTimer = null;
  let routeRenderQueued = false;
  let dragState = null;
  let swipeState = null;

  /* -----------------------------------------------------------------------
     Small utilities
     ----------------------------------------------------------------------- */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampInt(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return clamp(Math.round(number), min, max);
  }

  function normalizeWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(1000, Math.round(number * 100) / 100);
  }

  function normalizeReps(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return clampInt(number, 1, 999);
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    const rounded = Math.round(number * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "");
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function uid(prefix) {
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return `${prefix}-${globalThis.crypto.randomUUID()}`;
      }
    } catch (error) {
      // A timestamp fallback is enough for a single-device, single-user app.
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayLocalDate() {
    return localDateString(new Date());
  }

  function isValidDateString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
    return (
      date.getFullYear() === parts[0] &&
      date.getMonth() === parts[1] - 1 &&
      date.getDate() === parts[2]
    );
  }

  function dateFromString(value) {
    if (!isValidDateString(value)) return null;
    const parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }

  function formatClock(date = new Date()) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatSessionDate(value) {
    const date = dateFromString(value);
    if (!date) return "";
    return `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  }

  function formatLongDay(value) {
    const date = dateFromString(value);
    if (!date) return "";
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  }

  function formatFullDateForLabel(value) {
    const date = dateFromString(value);
    if (!date) return "";
    return `${WEEKDAYS_LONG[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  function formatMonthYear(year, month) {
    return `${MONTHS[month]} ${year}`;
  }

  function firstWeekdayOffset(year, month) {
    const day = new Date(year, month, 1, 12, 0, 0, 0).getDay();
    return (day + 6) % 7;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0, 12, 0, 0, 0).getDate();
  }

  function formatDurationMs(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${pad2(totalSeconds % 60)}`;
  }

  function formatRepsList(reps) {
    if (!Array.isArray(reps) || reps.length === 0) return "";
    return `${reps.join(", ")} reps`;
  }

  function pluralize(value, singular, plural = `${singular}s`) {
    return Number(value) === 1 ? singular : plural;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return entities[character];
    });
  }

  function announce(message) {
    if (!liveEl) return;
    liveEl.textContent = "";
    window.requestAnimationFrame(() => {
      liveEl.textContent = message;
    });
  }

  function vibrate(pattern) {
    try {
      if (navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);
      }
    } catch (error) {
      // Vibration is an enhancement and is unavailable on many browsers.
    }
  }

  function makeId(prefix) {
    return uid(prefix);
  }

  /* -----------------------------------------------------------------------
     DOM helpers
     ----------------------------------------------------------------------- */

  function el(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") {
        node.className = value;
      } else if (key === "text") {
        node.textContent = String(value);
      } else if (key === "dataset") {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          node.dataset[dataKey] = String(dataValue);
        }
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    }
    const appendChild = (child) => {
      if (child === undefined || child === null || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    };
    children.flat(Infinity).forEach(appendChild);
    return node;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  const ICON_PATHS = Object.freeze({
    dumbbell:
      '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    trendingUp:
      '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    arrowLeft:
      '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
    chevronRight:
      '<path d="M9 18l6-6-6-6"/>',
    chevronLeft:
      '<path d="M15 18l-6-6 6-6"/>',
    chevronDown:
      '<path d="M6 9l6 6 6-6"/>',
    plus:
      '<path d="M12 5v14M5 12h14"/>',
    x:
      '<path d="M18 6L6 18M6 6l12 12"/>',
    check:
      '<path d="M20 6L9 17l-5-5"/>',
    pencil:
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    minus:
      '<path d="M5 12h14"/>',
    grip:
      '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>'
  });

  function makeIcon(name, className = "") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (className) svg.setAttribute("class", className);
    // Only trusted, hard-coded icon path data is ever sent through innerHTML.
    svg.innerHTML = ICON_PATHS[name] || "";
    return svg;
  }

  function iconButton(name, label, onClick, extraClass = "") {
    const button = el(
      "button",
      {
        class: `icon-btn${extraClass ? ` ${extraClass}` : ""}`,
        type: "button",
        "aria-label": label
      },
      makeIcon(name)
    );
    if (typeof onClick === "function") {
      button.addEventListener("click", onClick);
    }
    return button;
  }

  function makeBackButton(fallback) {
    const button = el(
      "button",
      { class: "back-button", type: "button", "aria-label": "Back" },
      makeIcon("arrowLeft")
    );
    button.addEventListener("click", () => goBack(fallback));
    return button;
  }

  function makeExerciseArt(name) {
    const key = getIllustrationKey(name);
    const wrapper = el("span", {
      class: "exercise-art",
      "aria-hidden": "true",
      dataset: { illustration: key }
    });
    // The SVG family is a closed, hard-coded map and never contains user text.
    wrapper.innerHTML = ILLUSTRATIONS[key] || ILLUSTRATIONS.generic;
    return wrapper;
  }

  /* -----------------------------------------------------------------------
     Exercise illustrations
     A single visual family: 120x120, accent stroke 6, round joins, card head,
     track torso. The rest of every drawing is stroke-only.
     ----------------------------------------------------------------------- */

  const ILLUSTRATIONS = Object.freeze({
    bench: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M34 24h52"/>
      <path d="M34 17v14M86 17v14"/>
      <circle cx="34" cy="65" r="10" fill="var(--card)"/>
      <path d="M43 67c12-8 27-7 36 2l-4 10c-12-2-24-2-34 1z" fill="var(--track)"/>
      <path d="M52 64l-7 10"/>
      <path d="M48 51l-6-13 5-14M70 52l8-14-5-14"/>
      <path d="M21 84h76M31 84v20M87 84v20"/>
      <path d="M76 75l11 10 11 1"/>
    </g></svg>`,
    pullup: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 20h84"/>
      <circle cx="60" cy="37" r="10" fill="var(--card)"/>
      <path d="M49 56c5-7 17-7 22 0l-2 26c-5 5-13 5-18 0z" fill="var(--track)"/>
      <path d="M50 55l-10-12-2-23M70 55l10-12 2-23"/>
      <path d="M54 81l-5 23h-8M66 81l6 21h10"/>
    </g></svg>`,
    pushup: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 105h100"/>
      <circle cx="31" cy="55" r="10" fill="var(--card)"/>
      <path d="M39 59c12-6 29-2 43 10l-3 11c-14-8-27-11-39-9z" fill="var(--track)"/>
      <path d="M47 69l-7 21-2 15M59 74l-6 21-2 10"/>
      <path d="M80 79l19 12 9 14"/>
      <path d="M103 98l7 7"/>
    </g></svg>`,
    latpull: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 24h76M22 17v14M98 17v14"/>
      <path d="M60 4v16"/>
      <circle cx="60" cy="52" r="10" fill="var(--card)"/>
      <path d="M51 63c6-6 12-6 18 0l3 24c-8 6-16 6-24 0z" fill="var(--track)"/>
      <path d="M53 64L37 45 27 27M67 64l16-19 10-18"/>
      <path d="M48 86h24M60 88v11M51 109h18M42 91h36"/>
    </g></svg>`,
    lateralraise: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="60" cy="24" r="10" fill="var(--card)"/>
      <path d="M51 40c6-5 12-5 18 0l-2 36c-5 4-9 4-14 0z" fill="var(--track)"/>
      <path d="M52 48L23 48M68 48l29 0"/>
      <path d="M19 40v16M12 44v8M101 40v16M108 44v8"/>
      <path d="M54 75l-9 17-7 16M66 75l9 17 7 16"/>
    </g></svg>`,
    bicepscur: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="51" cy="25" r="10" fill="var(--card)"/>
      <path d="M43 40c6-5 13-5 18 0l-1 39c-5 4-10 4-15 0z" fill="var(--track)"/>
      <path d="M60 50l21 18-4-32"/>
      <path d="M43 78L36 98l-7 12M57 79l7 18 8 13"/>
      <path d="M68 34h22M68 27v14M90 27v14"/>
      <path d="M43 48L31 70l7 12"/>
    </g></svg>`,
    triceps: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M106 12v94M98 108h16M106 34h-7"/>
      <circle cx="96" cy="24" r="8"/>
      <path d="M94 32l-12 26"/>
      <circle cx="43" cy="27" r="10" fill="var(--card)"/>
      <path d="M35 42c7-6 14-6 20 0l-2 37c-6 5-11 5-16 0z" fill="var(--track)"/>
      <path d="M55 51l20-13 7 20"/>
      <path d="M82 58l-6 7M84 61l2 9"/>
      <path d="M38 78l-6 19-7 12M53 79l6 18 8 13"/>
      <path d="M37 47L25 68l8 10"/>
    </g></svg>`,
    squat: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 46h84M24 38v16M96 38v16"/>
      <circle cx="60" cy="24" r="10" fill="var(--card)"/>
      <path d="M51 50c6-5 12-5 18 0l-2 26c-5 4-9 4-14 0z" fill="var(--track)"/>
      <path d="M52 48l-9-4M68 48l9-4"/>
      <path d="M54 74l-20 9-6 22M66 74l20 9 6 22"/>
      <path d="M25 103h12M83 103h12"/>
    </g></svg>`,
    legcurl: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 84h84M30 84v18M90 84v18"/>
      <circle cx="28" cy="58" r="10" fill="var(--card)"/>
      <path d="M36 66c12-6 28-5 42 2l-2 12c-13-4-27-4-40 0z" fill="var(--track)"/>
      <path d="M44 78l-5 14"/>
      <path d="M77 73l18 4-7 22"/>
      <path d="M88 99l-5 8M95 99l-3 8"/>
      <circle cx="86" cy="55" r="5"/>
    </g></svg>`,
    calfraise: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 110h80"/>
      <path d="M30 102h60M34 102v8M86 102v8"/>
      <circle cx="60" cy="18" r="10" fill="var(--card)"/>
      <path d="M51 33c6-5 12-5 18 0l-2 34c-5 4-9 4-14 0z" fill="var(--track)"/>
      <path d="M52 41L36 54l-3 13M68 41l16 13 3 13"/>
      <path d="M55 71l-2 10M65 71l2 10"/>
      <path d="M53 81L39 98l-4 4M67 81l14 17 4 4"/>
    </g></svg>`,
    abs: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 103h96"/>
      <circle cx="31" cy="56" r="10" fill="var(--card)"/>
      <path d="M39 63c5-7 12-8 18-3l19 19c5 5 3 13-4 15l-9 1-16-11-11-12z" fill="var(--track)"/>
      <path d="M45 67l16 8 15 8"/>
      <path d="M72 91l18-27 14 22"/>
      <path d="M93 96l8 5"/>
    </g></svg>`,
    backextension: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 106h96"/>
      <path d="M34 82l50-18M42 82v20M80 68v34"/>
      <circle cx="26" cy="47" r="10" fill="var(--card)"/>
      <path d="M34 56c10 4 22 8 38 14l-4 12c-16-5-28-7-40-7z" fill="var(--track)"/>
      <path d="M40 62l11 10M50 58l8 8"/>
      <path d="M70 80l20 8 13 12"/>
      <path d="M101 97l7 8"/>
    </g></svg>`,
    generic: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="58" cy="23" r="10" fill="var(--card)"/>
      <path d="M49 38c6-5 13-5 18 0l-1 36c-5 4-10 4-15 0z" fill="var(--track)"/>
      <path d="M50 45L34 66M66 45l13 18"/>
      <path d="M52 74l-8 17-5 11M64 74l8 17 5 11"/>
      <path d="M31 68h14M31 62v12M25 65v6M45 65v6"/>
    </g></svg>`
  });

  function getIllustrationKey(name) {
    const normalized = String(name || "").trim().toLowerCase();

    // Precise compound movements intentionally come first.
    if (/(lat\s*pull|lat\s*pulldown|pulldown|pull\s*down)/.test(normalized)) {
      return "latpull";
    }
    if (/(leg\s*curl)/.test(normalized)) {
      return "legcurl";
    }
    if (/(pull[\s-]*up|chin[\s-]*up|pullup|chinup)/.test(normalized)) {
      return "pullup";
    }
    if (/(push[\s-]*up|pushup)/.test(normalized)) {
      return "pushup";
    }
    if (/bench/.test(normalized)) {
      return "bench";
    }
    if (/(lateral\s*raise|lateral|side\s*raise|abduction)/.test(normalized)) {
      return "lateralraise";
    }
    if (/(biceps?|bicep|arm\s*curl|\bcurl\b)/.test(normalized)) {
      return "bicepscur";
    }
    if (/(triceps?|tricep|cable\s*push\s*down|rope\s*push\s*down)/.test(normalized)) {
      return "triceps";
    }
    if (/squat/.test(normalized)) {
      return "squat";
    }
    if (/(calve|calf|heel\s*raise)/.test(normalized)) {
      return "calfraise";
    }
    if (/(\babs?\b|crunch|sit[\s-]*up|\bcore\b)/.test(normalized)) {
      return "abs";
    }
    if (/(lombaire|elevation|back\s*extension|hyper\s*extension)/.test(normalized)) {
      return "backextension";
    }
    return "generic";
  }

  /* -----------------------------------------------------------------------
     Local storage
     Every localStorage access goes through these guarded helpers.
     ----------------------------------------------------------------------- */

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStorage(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Storage can be unavailable in private browsing or with strict settings.
    }
  }

  function parseJson(raw, fallback) {
    if (typeof raw !== "string") return fallback;
    try {
      const value = JSON.parse(raw);
      return value === undefined || value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function readJson(key, fallback) {
    return parseJson(readStorage(key), fallback);
  }

  function writeJson(key, value) {
    try {
      return writeStorage(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
  }

  function persistPrograms() {
    return writeJson(STORAGE_KEYS.programs, programs);
  }

  function persistSessions() {
    return writeJson(STORAGE_KEYS.sessions, sessions);
  }

  function persistActive() {
    if (activeWorkout) {
      return writeJson(STORAGE_KEYS.active, activeWorkout);
    }
    removeStorage(STORAGE_KEYS.active);
    return true;
  }

  function persistSettings() {
    return writeJson(STORAGE_KEYS.settings, settings);
  }

  function createSeedPrograms() {
    return [
      {
        id: makeId("upper"),
        title: "Upper",
        items: [
          { n: "Bench", w: 67.5, sets: 3 },
          { n: "Lat Pull Down", w: 59, sets: 3 },
          { n: "Lateral raise", w: 10, sets: 2 },
          { n: "Biceps curl", w: 14, sets: 2 },
          { n: "Triceps cable", w: 27, sets: 2 }
        ]
      },
      {
        id: makeId("lower"),
        title: "Lower",
        items: [
          { n: "Squat", w: 77.5, sets: 3 },
          { n: "Leg curl", w: 42.5, sets: 3 },
          { n: "Calve", w: 70, sets: 2 },
          { n: "Abs", w: 0, sets: 2 },
          { n: "Elevation (lombaire)", w: 0, sets: 2 }
        ]
      }
    ];
  }

  function sanitizePrograms(value) {
    if (!Array.isArray(value)) return [];
    const seenIds = new Set();
    const sanitized = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      let id = typeof entry.id === "string" && entry.id.trim() ? entry.id : makeId("program");
      if (seenIds.has(id)) id = makeId("program");
      seenIds.add(id);
      const title =
        typeof entry.title === "string" && entry.title.trim()
          ? entry.title
          : "My program";
      const items = Array.isArray(entry.items)
        ? entry.items
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
              n: typeof item.n === "string" ? item.n : "",
              w: normalizeWeight(item.w),
              sets: clampInt(item.sets, 1, 6)
            }))
        : [];
      sanitized.push({ id, title, items });
    }
    return sanitized;
  }

  function sanitizeSessions(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      if (!isValidDateString(entry.date)) continue;
      const exercises = Array.isArray(entry.exercises)
        ? entry.exercises
            .filter((exercise) => exercise && typeof exercise === "object")
            .map((exercise) => {
              const sets = Array.isArray(exercise.sets)
                ? exercise.sets
                    .filter((set) => set && typeof set === "object")
                    .map((set) => ({
                      r: normalizeReps(set.r),
                      w: normalizeWeight(set.w),
                      t:
                        typeof set.t === "string" && /^\d{2}:\d{2}$/.test(set.t)
                          ? set.t
                          : "00:00"
                    }))
                : [];
              return {
                n: typeof exercise.n === "string" ? exercise.n : "Exercise",
                sets
              };
            })
        : [];
      result.push({
        id: typeof entry.id === "string" && entry.id ? entry.id : makeId("session"),
        date: entry.date,
        title:
          typeof entry.title === "string" && entry.title.trim()
            ? entry.title
            : "Workout",
        exercises
      });
    }
    return result;
  }

  function sanitizeTimer(value, breakSeconds) {
    if (!value || typeof value !== "object") return null;
    const maxMs = breakSeconds * 1000;
    const elapsed = clamp(Number(value.elapsed) || 0, 0, maxMs);
    let running = Boolean(value.running);
    let startedAt = Number(value.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      running = false;
      startedAt = null;
    }
    if (elapsed >= maxMs) {
      return { elapsed: maxMs, running: false, startedAt: null };
    }
    return {
      elapsed,
      running,
      startedAt: running ? startedAt : null
    };
  }

  function sanitizeActive(value, breakSeconds) {
    if (!value || typeof value !== "object") return null;
    const rawExercises = Array.isArray(value.exercises) ? value.exercises : [];
    if (rawExercises.length === 0) return null;
    const exercises = rawExercises
      .filter((exercise) => exercise && typeof exercise === "object")
      .map((exercise) => {
        const setCount = clampInt(exercise.sets, 1, 6);
        const doneRaw = Array.isArray(exercise.done) ? exercise.done : [];
        const done = Array.from({ length: setCount }, (_, index) => {
          const log = doneRaw[index];
          if (!log || typeof log !== "object") return null;
          return {
            r: normalizeReps(log.r),
            w: normalizeWeight(log.w),
            t:
              typeof log.t === "string" && /^\d{2}:\d{2}$/.test(log.t)
                ? log.t
                : "00:00"
          };
        });
        return {
          n:
            typeof exercise.n === "string" && exercise.n.trim()
              ? exercise.n
              : "Exercise",
          w: normalizeWeight(exercise.w),
          sets: setCount,
          done,
          reps: normalizeReps(exercise.reps ?? value.reps ?? 10),
          sourceIndex: Number.isInteger(exercise.sourceIndex)
            ? exercise.sourceIndex
            : null
        };
      });
    if (exercises.length === 0) return null;
    const currentIndex = clampInt(value.currentIndex, 0, exercises.length - 1);
    return {
      id: typeof value.id === "string" && value.id ? value.id : makeId("workout"),
      programId: typeof value.programId === "string" ? value.programId : null,
      title:
        typeof value.title === "string" && value.title.trim()
          ? value.title
          : "Workout",
      date: isValidDateString(value.date) ? value.date : todayLocalDate(),
      currentIndex,
      reps: normalizeReps(value.reps ?? exercises[currentIndex].reps ?? 10),
      break: BREAKS.includes(Number(value.break)) ? Number(value.break) : breakSeconds,
      exercises,
      timer: sanitizeTimer(value.timer, breakSeconds)
    };
  }

  function sanitizeSettings(value) {
    const requested = Number(value && value.break);
    return {
      break: BREAKS.includes(requested) ? requested : DEFAULT_BREAK
    };
  }

  function loadData() {
    const storedPrograms = readStorage(STORAGE_KEYS.programs);
    if (storedPrograms === null) {
      programs = createSeedPrograms();
      persistPrograms();
    } else {
      programs = sanitizePrograms(parseJson(storedPrograms, []));
    }

    settings = sanitizeSettings(readJson(STORAGE_KEYS.settings, {}));
    sessions = sanitizeSessions(readJson(STORAGE_KEYS.sessions, []));
    activeWorkout = sanitizeActive(
      readJson(STORAGE_KEYS.active, null),
      settings.break
    );
  }

  /* -----------------------------------------------------------------------
     Router and view lifecycle
     ----------------------------------------------------------------------- */

  function routeFromLocation() {
    const raw = String(window.location.hash || "")
      .replace(/^#/, "")
      .replace(/^\/+/, "")
      .trim();
    return VALID_VIEWS.has(raw) ? raw : "list";
  }

  function navigationState(route, depth) {
    return { app: true, route, depth };
  }

  function currentDepth() {
    const depth = Number(history.state && history.state.depth);
    return Number.isInteger(depth) && depth >= 0 ? depth : 0;
  }

  function setInitialRoute() {
    let route = routeFromLocation();
    if (!window.location.hash) {
      route = "list";
    } else if (!VALID_VIEWS.has(window.location.hash.replace(/^#\/?/, ""))) {
      route = "list";
    }
    if (route === "list" && programs.length === 0) {
      editor = createNewEditor();
      route = "program";
    }
    const hash = `#${route}`;
    try {
      history.replaceState(navigationState(route, 0), "", hash);
    } catch (error) {
      window.location.hash = route;
    }
    currentView = null;
  }

  function navigate(view, options = {}) {
    if (!VALID_VIEWS.has(view)) return;
    const { replace = false } = options;
    const route = routeFromLocation();
    if (route === view) {
      return;
    }
    const target = `#${view}`;
    const state = navigationState(view, currentDepth() + 1);
    try {
      if (replace) {
        history.replaceState(state, "", target);
      } else {
        history.pushState(state, "", target);
      }
    } catch (error) {
      window.location.hash = view;
    }
    renderRoute();
  }

  function goBack(fallback = "list") {
    const depth = currentDepth();
    if (history.state && history.state.app === true && depth > 0) {
      history.back();
      return;
    }
    const safeFallback = VALID_VIEWS.has(fallback) ? fallback : "list";
    navigate(safeFallback, { replace: true });
  }

  function scheduleRouteRender() {
    if (routeRenderQueued) return;
    routeRenderQueued = true;
    queueMicrotask(() => {
      routeRenderQueued = false;
      const raw = String(window.location.hash || "").replace(/^#\/?/, "");
      if (raw && !VALID_VIEWS.has(raw)) {
        try {
          history.replaceState(
            navigationState(routeFromLocation(), currentDepth()),
            "",
            "#list"
          );
        } catch (error) {
          // The route fallback still renders even if history cannot be rewritten.
        }
      }
      renderRoute();
    });
  }

  function renderRoute() {
    stopTimerInterval();
    clearDialTap();
    editorUi = null;
    workUi = null;

    let nextView = routeFromLocation();
    const previousView = currentView;

    if (nextView === "list" && programs.length === 0) {
      if (!editor) editor = createNewEditor();
      nextView = "program";
      try {
        history.replaceState(navigationState("program", currentDepth()), "", "#program");
      } catch (error) {
        // In-memory rendering is still correct without a history rewrite.
      }
    }

    if (previousView === "program" && nextView !== "program") {
      editor = null;
    }

    if (nextView === "program" && !editor) {
      editor = programs.length
        ? cloneProgramIntoEditor(programs[0])
        : createNewEditor();
    }

    if (nextView === "log" && previousView !== "log") {
      initializeCalendar();
    }

    if (previousView !== nextView && previousView !== null) {
      closeDrag();
      swipeState = null;
    }

    currentView = nextView;

    let screen;
    switch (nextView) {
      case "program":
        screen = renderProgramEditor();
        break;
      case "work":
        screen = activeWorkout ? renderActiveWorkout() : renderIdleWorkout();
        break;
      case "log":
        screen = renderCalendarScreen();
        break;
      case "progress":
        screen = renderProgressScreen();
        break;
      case "list":
      default:
        screen = renderProgramList();
        break;
    }

    appEl.replaceChildren(screen);
    document.title = `${VIEW_TITLES[nextView] || APP_NAME} — ${APP_NAME}`;

    if (nextView === "work" && activeWorkout) {
      syncWakeForActiveWorkout();
      startTimerIntervalIfNeeded();
    } else {
      releaseWakeLock();
    }

    try {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch (error) {
      window.scrollTo(0, 0);
    }
  }

  /* -----------------------------------------------------------------------
     Program list
     ----------------------------------------------------------------------- */

  function renderProgramList() {
    const screen = el("main", { class: "screen screen-list" });

    const header = el(
      "header",
      { class: "list-top" },
      el(
        "div",
        { class: "list-heading" },
        el("p", { class: "eyebrow", text: "Workout Tracker" }),
        el("h1", { class: "page-title", text: "Programs" })
      ),
      el(
        "nav",
        { class: "header-actions", "aria-label": "Quick links" },
        iconButton("dumbbell", "Open workout", () => navigate("work")),
        iconButton("calendar", "Open training calendar", () => navigate("log")),
        iconButton("trendingUp", "Open progress", () => navigate("progress"))
      )
    );

    const list = el("section", {
      class: "program-list",
      "aria-label": "Saved programs"
    });

    programs.forEach((program) => {
      const count = program.items.length;
      const card = el(
        "button",
        {
          class: "program-card",
          type: "button",
          "aria-label": `Edit ${program.title}, ${count} ${pluralize(count, "exercise")}`
        },
        el(
          "span",
          { class: "program-card-copy" },
          el("span", { class: "program-card-title", text: program.title }),
          el("span", {
            class: "program-card-meta",
            text: `${count} ${pluralize(count, "exercise")}`
          })
        ),
        el(
          "span",
          { class: "program-card-chevron", "aria-hidden": "true" },
          makeIcon("chevronRight")
        )
      );
      card.addEventListener("click", () => openProgramEditor(program));
      list.append(card);
    });

    const addButton = el(
      "button",
      {
        class: "add-program",
        type: "button",
        "aria-label": "Add a new program"
      },
      makeIcon("plus"),
      el("span", { text: "Add a new program" })
    );
    addButton.addEventListener("click", () => {
      editor = createNewEditor();
      navigate("program");
    });

    screen.append(header, list, addButton);
    return screen;
  }

  /* -----------------------------------------------------------------------
     Program editor
     ----------------------------------------------------------------------- */

  function cloneProgramIntoEditor(program) {
    return {
      id: program.id,
      title: program.title,
      items: program.items.map((item) => ({
        key: makeId("row"),
        n: item.n,
        w: normalizeWeight(item.w),
        sets: clampInt(item.sets, 1, 6)
      })),
      originalSignature: programSignature(program.title, program.items),
      backWasAvailable: programs.length > 0
    };
  }

  function createNewEditor() {
    return {
      id: null,
      title: "My program",
      items: [],
      originalSignature: null,
      backWasAvailable: programs.length > 0
    };
  }

  function normalizedTitle(value) {
    const title = String(value || "").trim();
    return title || "My program";
  }

  function editorItemsForSignature() {
    if (!editor) return [];
    return editor.items.map((item) => ({
      n: String(item.n ?? ""),
      w: normalizeWeight(item.w),
      sets: clampInt(item.sets, 1, 6)
    }));
  }

  function currentEditorSignature() {
    if (!editor) return "";
    return programSignature(editor.title, editorItemsForSignature());
  }

  function programSignature(title, items) {
    return JSON.stringify({
      title: String(title ?? ""),
      items: items.map((item) => ({
        n: String(item.n ?? ""),
        w: normalizeWeight(item.w),
        sets: clampInt(item.sets, 1, 6)
      }))
    });
  }

  function isEditorDirty() {
    if (!editor || editor.originalSignature === null) return true;
    return currentEditorSignature() !== editor.originalSignature;
  }

  function updateEditorControls() {
    if (!editorUi || !editor) return;
    const dirty = isEditorDirty();
    editorUi.saveButton.disabled = !dirty;
    editorUi.saveButton.textContent = dirty ? "Save program" : "Saved";
    editorUi.startButton.disabled = editor.items.length === 0;
    if (editorUi.backButton) {
      editorUi.backButton.hidden = !(programs.length > 0);
    }
    updateHandleLabels();
  }

  function updateHandleLabels() {
    if (!editorUi || !editor) return;
    const rows = Array.from(editorUi.list.querySelectorAll(".exercise-row"));
    rows.forEach((row, index) => {
      const handle = row.querySelector(".drag-handle");
      const nameInput = row.querySelector(".exercise-name");
      if (!handle) return;
      const name = (nameInput && nameInput.value.trim()) || "exercise";
      handle.setAttribute(
        "aria-label",
        `Reorder ${name}, position ${index + 1} of ${rows.length}. Drag, or use the arrow keys.`
      );
      handle.dataset.index = String(index);
    });
  }

  function renderProgramEditor() {
    const screen = el("main", { class: "screen screen-editor" });

    const top = el("header", { class: "editor-top" });
    const backButton = makeBackButton("list");
    backButton.hidden = programs.length === 0;
    top.append(backButton);
    screen.append(top);

    screen.append(el("h1", { class: "sr-only", text: "Edit program" }));

    const titleInput = el("input", {
      class: "editor-title",
      type: "text",
      value: editor.title,
      placeholder: "My program",
      maxlength: "70",
      "aria-label": "Program title",
      autocomplete: "off",
      spellcheck: "false"
    });
    titleInput.addEventListener("input", () => {
      editor.title = titleInput.value;
      updateEditorControls();
    });
    titleInput.addEventListener("blur", () => {
      editor.title = normalizedTitle(titleInput.value);
      titleInput.value = editor.title;
      updateEditorControls();
    });
    screen.append(titleInput);

    const list = el("div", {
      class: "exercise-list",
      role: "list",
      "aria-label": "Exercises"
    });
    editor.items.forEach((item) => {
      list.append(createExerciseRow(item));
    });
    screen.append(list);

    const addExercise = el(
      "button",
      {
        class: "add-exercise",
        type: "button",
        "aria-label": "Add exercise"
      },
      makeIcon("plus"),
      el("span", { text: "Add exercise" })
    );
    addExercise.addEventListener("click", () => {
      const item = {
        key: makeId("row"),
        n: "",
        w: 0,
        sets: 3
      };
      editor.items.push(item);
      const row = createExerciseRow(item);
      list.append(row);
      updateEditorControls();
      window.requestAnimationFrame(() => {
        const input = row.querySelector(".exercise-name");
        if (input) input.focus();
      });
      announce(
        `Exercise added. ${editor.items.length} ${pluralize(editor.items.length, "exercise")}.`
      );
    });
    screen.append(addExercise);

    const saveButton = el("button", {
      class: "btn btn-secondary",
      type: "button",
      text: "Saved"
    });
    saveButton.addEventListener("click", saveEditorProgram);

    const startButton = el("button", {
      class: "btn btn-primary",
      type: "button",
      text: "Start workout"
    });
    startButton.addEventListener("click", startWorkoutFromEditor);

    const bottom = el(
      "footer",
      { class: "editor-bottom" },
      el("div", { class: "editor-actions" }, saveButton, startButton)
    );
    screen.append(bottom);

    editorUi = {
      screen,
      titleInput,
      list,
      backButton,
      saveButton,
      startButton,
      addExercise
    };

    updateEditorControls();
    return screen;
  }

  function createExerciseRow(item) {
    const row = el("div", {
      class: "exercise-row",
      role: "listitem",
      dataset: { key: item.key }
    });

    const handle = el(
      "button",
      {
        class: "drag-handle",
        type: "button",
        "aria-label": "Reorder exercise",
        "aria-keyshortcuts": "ArrowUp ArrowDown"
      },
      makeIcon("grip")
    );
    handle.addEventListener("pointerdown", (event) => {
      beginRowDrag(event, handle, row);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      moveRowWithKeyboard(event.key === "ArrowUp" ? -1 : 1, item.key, handle);
    });

    const nameInput = el("input", {
      class: "exercise-name",
      type: "text",
      value: item.n,
      placeholder: "Exercise name",
      "aria-label": "Exercise name",
      maxlength: "80",
      autocomplete: "off",
      spellcheck: "false"
    });
    nameInput.addEventListener("input", () => {
      item.n = nameInput.value;
      updateEditorControls();
    });

    const remove = el(
      "button",
      {
        class: "row-remove",
        type: "button",
        "aria-label": "Remove exercise"
      },
      makeIcon("x")
    );
    remove.addEventListener("click", () => {
      removeExercise(item.key);
    });

    row.append(handle, nameInput, remove);
    return row;
  }

  function removeExercise(key) {
    if (!editor || !editorUi) return;
    const index = editor.items.findIndex((item) => item.key === key);
    if (index < 0) return;
    const [removed] = editor.items.splice(index, 1);
    const row = editorUi.list.querySelector(`.exercise-row[data-key="${cssEscape(key)}"]`);
    if (row) row.remove();
    updateEditorControls();
    announce(
      `${removed && removed.n ? removed.n : "Exercise"} removed. ${editor.items.length} remaining.`
    );
  }

  function cssEscape(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function openProgramEditor(program) {
    editor = cloneProgramIntoEditor(program);
    navigate("program");
  }

  function saveEditorProgram() {
    if (!editor) return;
    const title = normalizedTitle(editor.title);
    if (title !== editor.title) {
      editor.title = title;
      if (editorUi && editorUi.titleInput) editorUi.titleInput.value = title;
    }

    const items = editor.items.map((item) => ({
      n: String(item.n ?? ""),
      w: normalizeWeight(item.w),
      sets: clampInt(item.sets, 1, 6)
    }));

    if (editor.id) {
      const index = programs.findIndex((program) => program.id === editor.id);
      if (index >= 0) {
        programs[index] = { id: editor.id, title, items };
      } else {
        programs.push({ id: editor.id, title, items });
      }
    } else {
      editor.id = makeId("program");
      const newProgram = { id: editor.id, title, items };
      programs.push(newProgram);
    }

    persistPrograms();
    editor.originalSignature = programSignature(editor.title, editor.items);
    editor.backWasAvailable = programs.length > 0;

    if (activeWorkout && activeWorkout.programId === editor.id) {
      activeWorkout.title = title;
      persistActive();
    }

    updateEditorControls();
    announce("Program saved.");
  }

  function startWorkoutFromEditor() {
    if (!editor || editor.items.length === 0) return;
    const title = normalizedTitle(editor.title);
    const items = editor.items.map((item, index) => ({
      n: String(item.n ?? "").trim() || "Exercise",
      w: normalizeWeight(item.w),
      sets: clampInt(item.sets, 1, 6),
      sourceIndex: index
    }));
    startWorkout({
      programId: editor.id,
      title,
      items
    });
  }

  function beginRowDrag(event, handle, row) {
    if (!editor || !editorUi) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.isPrimary === false) return;
    if (dragState) return;

    event.preventDefault();
    try {
      handle.focus({ preventScroll: true });
    } catch (error) {
      handle.focus();
    }

    const key = row.dataset.key;
    const item = editor.items.find((entry) => entry.key === key);
    if (!item) return;

    const startY = event.clientY;
    let adjustment = 0;
    const pointerId = event.pointerId;

    dragState = {
      pointerId,
      key,
      row,
      handle,
      startY,
      adjustment,
      active: true,
      onMove: null,
      onEnd: null,
      onCancel: null
    };

    row.classList.add("is-dragging");
    document.body.classList.add("is-reordering");

    const positionRow = (clientY) => {
      const delta = clientY - startY + dragState.adjustment;
      row.style.transform = `translateY(${delta}px)`;
    };

    const move = (moveEvent) => {
      if (!dragState || moveEvent.pointerId !== pointerId) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      positionRow(moveEvent.clientY);

      let guard = 0;
      while (guard < 20) {
        guard += 1;
        const rows = Array.from(editorUi.list.querySelectorAll(".exercise-row"));
        const rowIndex = rows.indexOf(row);
        const rect = row.getBoundingClientRect();
        const rowCenter = rect.top + rect.height / 2;

        if (rowIndex < 0) break;

        if (rowIndex < rows.length - 1) {
          const nextRow = rows[rowIndex + 1];
          const nextRect = nextRow.getBoundingClientRect();
          const nextCenter = nextRect.top + nextRect.height / 2;
          if (rowCenter > nextCenter) {
            const beforeTop = row.getBoundingClientRect().top;
            nextRow.after(row);
            swapEditorItems(key, 1);
            const afterTop = row.getBoundingClientRect().top;
            dragState.adjustment += beforeTop - afterTop;
            positionRow(moveEvent.clientY);
            continue;
          }
        }

        if (rowIndex > 0) {
          const previousRow = rows[rowIndex - 1];
          const previousRect = previousRow.getBoundingClientRect();
          const previousCenter = previousRect.top + previousRect.height / 2;
          if (rowCenter < previousCenter) {
            const beforeTop = row.getBoundingClientRect().top;
            previousRow.before(row);
            swapEditorItems(key, -1);
            const afterTop = row.getBoundingClientRect().top;
            dragState.adjustment += beforeTop - afterTop;
            positionRow(moveEvent.clientY);
            continue;
          }
        }

        break;
      }

      updateEditorControls();
    };

    const finish = (cancel = false) => {
      if (!dragState) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", cancelDrag);
      row.style.transform = "";
      row.classList.remove("is-dragging");
      document.body.classList.remove("is-reordering");
      const movedName =
        (row.querySelector(".exercise-name") &&
          row.querySelector(".exercise-name").value.trim()) ||
        "Exercise";
      dragState = null;
      updateEditorControls();
      const index = editor.items.findIndex((entry) => entry.key === key);
      if (!cancel) {
        announce(`${movedName} moved to position ${index + 1}.`);
      }
      try {
        handle.focus({ preventScroll: true });
      } catch (error) {
        handle.focus();
      }
    };

    const end = (upEvent) => {
      if (!dragState || upEvent.pointerId !== pointerId) return;
      finish(false);
    };

    const cancelDrag = (cancelEvent) => {
      if (!dragState || cancelEvent.pointerId !== pointerId) return;
      finish(true);
    };

    dragState.onMove = move;
    dragState.onEnd = end;
    dragState.onCancel = cancelDrag;
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", cancelDrag);
  }

  function swapEditorItems(key, direction) {
    const index = editor.items.findIndex((item) => item.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= editor.items.length) return;
    const [item] = editor.items.splice(index, 1);
    editor.items.splice(target, 0, item);
  }

  function closeDrag() {
    if (!dragState) return;
    if (dragState.onMove) {
      document.removeEventListener("pointermove", dragState.onMove);
    }
    if (dragState.onEnd) {
      document.removeEventListener("pointerup", dragState.onEnd);
    }
    if (dragState.onCancel) {
      document.removeEventListener("pointercancel", dragState.onCancel);
    }
    dragState.row.style.transform = "";
    dragState.row.classList.remove("is-dragging");
    document.body.classList.remove("is-reordering");
    dragState = null;
  }

  function moveRowWithKeyboard(direction, key, handle) {
    if (!editor || !editorUi) return;
    const index = editor.items.findIndex((item) => item.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= editor.items.length) {
      announce(direction < 0 ? "Already first." : "Already last.");
      return;
    }
    const row = handle.closest(".exercise-row");
    if (!row) return;
    if (direction < 0) {
      row.previousElementSibling.before(row);
    } else {
      row.nextElementSibling.after(row);
    }
    swapEditorItems(key, direction);
    updateEditorControls();
    try {
      handle.focus({ preventScroll: true });
    } catch (error) {
      handle.focus();
    }
    const name =
      (row.querySelector(".exercise-name") &&
        row.querySelector(".exercise-name").value.trim()) ||
      "Exercise";
    announce(`${name} moved to position ${target + 1} of ${editor.items.length}.`);
  }

  /* -----------------------------------------------------------------------
     Workout
     ----------------------------------------------------------------------- */

  function makeActiveExercise(item, index) {
    const setCount = clampInt(item.sets, 1, 6);
    return {
      n: String(item.n ?? "").trim() || "Exercise",
      w: normalizeWeight(item.w),
      sets: setCount,
      done: Array.from({ length: setCount }, () => null),
      reps: 10,
      sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : index
    };
  }

  function startWorkout(source) {
    const items = Array.isArray(source.items) ? source.items : [];
    if (items.length === 0) return;
    stopTimerInterval();
    clearDialTap();
    activeWorkout = {
      id: makeId("workout"),
      programId: source.programId || null,
      title: normalizedTitle(source.title),
      date: todayLocalDate(),
      currentIndex: 0,
      reps: 10,
      break: BREAKS.includes(settings.break) ? settings.break : DEFAULT_BREAK,
      exercises: items.map(makeActiveExercise),
      timer: null
    };
    persistActive();
    announce(`Workout started: ${activeWorkout.title}.`);
    if (routeFromLocation() === "work") {
      renderRoute();
    } else {
      navigate("work");
    }
  }

  function startWorkoutFromProgram(program) {
    startWorkout({
      programId: program.id,
      title: program.title,
      items: program.items.map((item, index) => ({
        n: item.n,
        w: item.w,
        sets: item.sets,
        sourceIndex: index
      }))
    });
  }

  function renderIdleWorkout() {
    const screen = el("main", { class: "screen screen-work-idle" });
    const wrap = el("div", { class: "idle-wrap" });

    wrap.append(el("h1", { class: "idle-title", text: "Choose program to start" }));

    const disc = el(
      "button",
      {
        class: "idle-disc",
        type: "button",
        "aria-label": "Choose a program from the program list"
      },
      makeIcon("dumbbell")
    );
    disc.addEventListener("click", () => navigate("list"));
    wrap.append(disc);

    const pillList = el("div", {
      class: "idle-programs",
      "aria-label": "Start a workout"
    });
    programs.forEach((program) => {
      const pill = el("button", {
        class: "program-pill",
        type: "button",
        text: program.title,
        "aria-label": `Start ${program.title} workout`
      });
      pill.addEventListener("click", () => startWorkoutFromProgram(program));
      pillList.append(pill);
    });
    wrap.append(pillList);
    screen.append(wrap);
    return screen;
  }

  function renderActiveWorkout() {
    if (!activeWorkout) return renderIdleWorkout();

    activeWorkout.currentIndex = clampInt(
      activeWorkout.currentIndex,
      0,
      activeWorkout.exercises.length - 1
    );
    const exerciseIndex = activeWorkout.currentIndex;
    const exercise = activeWorkout.exercises[exerciseIndex];
    activeWorkout.reps = normalizeReps(activeWorkout.reps || exercise.reps || 10);
    exercise.reps = activeWorkout.reps;

    const screen = el("main", { class: "screen screen-work-active" });

    const topbar = el("header", { class: "work-topbar" });
    const breakSwitch = el("div", {
      class: "break-switch",
      role: "group",
      "aria-label": "Rest break length"
    });
    const breakButtons = [];
    BREAKS.forEach((seconds) => {
      const selected = settings.break === seconds;
      const button = el("button", {
        class: `break-option${selected ? " is-selected" : ""}`,
        type: "button",
        text: `${seconds}s`,
        "aria-pressed": selected ? "true" : "false",
        "aria-label": `${seconds} second rest break`
      });
      button.addEventListener("click", () => selectBreak(seconds));
      breakButtons.push(button);
      breakSwitch.append(button);
    });

    const topActions = el("nav", {
      class: "work-top-actions",
      "aria-label": "Workout actions"
    });
    const editButton = iconButton("pencil", "Edit program", () =>
      openActiveProgramEditor()
    );
    const calendarButton = iconButton("calendar", "Open training calendar", () =>
      navigate("log")
    );
    const progressButton = iconButton("trendingUp", "Open progress", () =>
      navigate("progress")
    );
    topActions.append(editButton, calendarButton, progressButton);
    topbar.append(breakSwitch, topActions);
    screen.append(topbar);

    const main = el("div", { class: "work-main" });
    main.append(el("h1", { class: "work-exercise-name", text: exercise.n }));

    const timerEl = el("div", {
      class: "work-timer",
      role: "timer",
      "aria-label": "Rest timer",
      text: "0:00"
    });
    main.append(timerEl);

    const dialSvg = createDialSvg();
    const dial = el("button", {
      class: "dial",
      type: "button",
      "aria-label":
        "Rest timer. Tap to start, pause or resume. Double tap to reset."
    });
    const dialCenter = el("span", { class: "dial-center" });
    dialCenter.append(makeExerciseArt(exercise.n));
    dial.append(dialSvg.svg, dialCenter);
    dial.addEventListener("click", handleDialClick);
    main.append(dial);

    const card = el("section", {
      class: "work-card",
      "aria-label": `${exercise.n} sets`
    });

    const weightRow = el("div", { class: "weight-row" });
    const weightInput = el("input", {
      class: "weight-input",
      type: "number",
      inputmode: "decimal",
      min: "0",
      max: "1000",
      step: "0.5",
      placeholder: "Body weight",
      "aria-label": `Weight for ${exercise.n} in kilograms; leave blank for body weight`,
      autocomplete: "off"
    });
    if (exercise.w > 0) weightInput.value = formatNumber(exercise.w);
    const weightUnit = el("span", {
      class: `weight-unit${exercise.w > 0 ? " is-visible" : ""}`,
      "aria-hidden": "true",
      text: "kg"
    });
    weightRow.append(weightInput, weightUnit);
    weightInput.addEventListener("input", () => {
      const parsed = weightInput.value === "" ? 0 : Number(weightInput.value);
      exercise.w = normalizeWeight(parsed);
      weightUnit.classList.toggle("is-visible", exercise.w > 0);
      persistActive();
      writeWeightBackToProgram(exercise);
    });
    weightInput.addEventListener("blur", () => {
      if (weightInput.value !== "") {
        weightInput.value = exercise.w > 0 ? formatNumber(exercise.w) : "";
      }
      weightUnit.classList.toggle("is-visible", exercise.w > 0);
    });
    card.append(weightRow);

    const setsGrid = createSetsGrid(exercise, exerciseIndex);
    card.append(setsGrid);

    const repsRow = el("div", { class: "reps-row" });
    repsRow.append(el("span", { class: "reps-label", text: "Reps" }));
    const stepper = el("div", { class: "stepper" });
    const minusButton = el(
      "button",
      {
        class: "step-btn",
        type: "button",
        "aria-label": "Decrease reps"
      },
      makeIcon("minus")
    );
    const repsInput = el("input", {
      class: "reps-input",
      type: "number",
      inputmode: "numeric",
      min: "1",
      max: "999",
      step: "1",
      value: String(activeWorkout.reps),
      "aria-label": "Reps per set"
    });
    const plusButton = el(
      "button",
      {
        class: "step-btn",
        type: "button",
        "aria-label": "Increase reps"
      },
      makeIcon("plus")
    );
    stepper.append(minusButton, repsInput, plusButton);
    repsRow.append(stepper);
    card.append(repsRow);
    main.append(card);

    const programName = el("p", {
      class: "work-program-name",
      text: activeWorkout.title
    });
    main.append(programName);

    const bottom = el("footer", { class: "work-bottom" });
    const previousButton = el(
      "button",
      {
        class: "btn btn-secondary prev-button",
        type: "button",
        "aria-label": "Previous exercise"
      },
      makeIcon("chevronLeft"),
      el("span", { text: "Prev" })
    );
    previousButton.disabled = exerciseIndex === 0;
    previousButton.addEventListener("click", () => changeExercise(-1, false));
    const isLast = exerciseIndex === activeWorkout.exercises.length - 1;
    const nextButton = el(
      "button",
      {
        class: "btn btn-primary next-button",
        type: "button",
        text: isLast ? "Finish workout" : "Next exercise"
      },
      makeIcon(isLast ? "check" : "chevronRight")
    );
    nextButton.addEventListener("click", () => {
      if (isLast) {
        finishWorkout();
      } else {
        changeExercise(1, false);
      }
    });
    bottom.append(previousButton, nextButton);
    screen.append(main, bottom);

    workUi = {
      screen,
      timerEl,
      dial,
      progressCircle: dialSvg.progress,
      breakButtons,
      weightInput,
      weightUnit,
      setsGrid,
      repsInput,
      minusButton,
      plusButton,
      exerciseIndex
    };

    const paintReps = () => {
      const value = normalizeReps(activeWorkout.reps);
      if (document.activeElement !== repsInput) {
        repsInput.value = String(value);
      }
      minusButton.disabled = value <= 1;
      plusButton.disabled = value >= 999;
    };

    const applyReps = (value, updateInput = true) => {
      activeWorkout.reps = normalizeReps(value);
      exercise.reps = activeWorkout.reps;
      persistActive();
      if (updateInput) repsInput.value = String(activeWorkout.reps);
      paintReps();
    };

    minusButton.addEventListener("click", () => {
      applyReps(activeWorkout.reps - 1);
    });
    plusButton.addEventListener("click", () => {
      applyReps(activeWorkout.reps + 1);
    });
    repsInput.addEventListener("input", () => {
      if (repsInput.value === "") return;
      const value = Number(repsInput.value);
      if (Number.isFinite(value) && value >= 1 && value <= 999) {
        activeWorkout.reps = clampInt(value, 1, 999);
        exercise.reps = activeWorkout.reps;
        persistActive();
        paintReps();
      }
    });
    repsInput.addEventListener("blur", () => {
      if (String(repsInput.value).trim() === "") {
        repsInput.value = String(activeWorkout.reps);
        paintReps();
        return;
      }
      const value = clampInt(repsInput.value, 1, 999);
      applyReps(value);
    });
    paintReps();

    bindWorkoutSwipe(main);

    if (activeWorkout.timer && activeWorkout.timer.running) {
      const elapsed = getTimerElapsedMs(activeWorkout.timer);
      if (elapsed >= getBreakMs()) {
        activeWorkout.timer.elapsed = getBreakMs();
        activeWorkout.timer.running = false;
        activeWorkout.timer.startedAt = null;
        persistActive();
      }
    }
    paintTimer();

    return screen;
  }

  function createDialSvg() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 240 240");
    svg.setAttribute("class", "dial-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("class", "dial-track");
    track.setAttribute("cx", "120");
    track.setAttribute("cy", "120");
    track.setAttribute("r", "112");

    const progress = document.createElementNS(SVG_NS, "circle");
    progress.setAttribute("class", "dial-progress");
    progress.setAttribute("cx", "120");
    progress.setAttribute("cy", "120");
    progress.setAttribute("r", "112");
    progress.setAttribute("pathLength", "1");
    progress.style.strokeDasharray = "1";
    progress.style.strokeDashoffset = "1";
    progress.style.opacity = "0";

    svg.append(track, progress);
    return { svg, progress };
  }

  function getCurrentSetIndex(exercise) {
    return exercise.done.findIndex((entry) => !entry);
  }

  function setBoxLabel(exercise, index, log, currentIndex) {
    const base = `Set ${index + 1}`;
    if (log) {
      return `${base}, logged, ${log.r} reps at ${
        log.w > 0 ? `${formatNumber(log.w)} kilograms` : "body weight"
      }`;
    }
    if (index === currentIndex) return `${base}, next set, not logged`;
    return `${base}, not logged`;
  }

  function createSetsGrid(exercise, exerciseIndex) {
    const grid = el("div", {
      class: "sets-grid",
      role: "group",
      "aria-label": "Set logging"
    });
    grid.style.setProperty("--set-count", String(exercise.sets));

    for (let index = 0; index < exercise.sets; index += 1) {
      const cell = el("div", { class: "set-cell" });
      const box = el("button", {
        class: "set-box",
        type: "button",
        "data-set-index": String(index)
      });
      box.addEventListener("animationend", () => {
        box.classList.remove("pop");
      });
      box.addEventListener("click", () => {
        toggleSet(exerciseIndex, index);
      });
      const logLabel = el("span", { class: "set-log", "aria-hidden": "true" });
      cell.append(box, logLabel);
      grid.append(cell);
    }

    refreshSetGrid(grid, exercise);
    return grid;
  }

  function refreshSetGrid(grid, exercise, popIndex = null) {
    if (!grid) return;
    const currentIndex = getCurrentSetIndex(exercise);
    const boxes = grid.querySelectorAll(".set-box");
    boxes.forEach((box, index) => {
      const log = exercise.done[index];
      const isCurrent = index === currentIndex && !log;
      box.classList.toggle("is-done", Boolean(log));
      box.classList.toggle("is-current", isCurrent);
      box.setAttribute("aria-pressed", log ? "true" : "false");
      box.setAttribute("aria-label", setBoxLabel(exercise, index, log, currentIndex));
      clearNode(box);
      if (log) {
        box.append(makeIcon("check"));
      } else {
        box.append(document.createTextNode(String(index + 1)));
      }
      const label = box.parentElement
        ? box.parentElement.querySelector(".set-log")
        : null;
      if (label) label.textContent = log ? String(log.r) : "";
      if (index === popIndex) {
        box.classList.remove("pop");
        void box.offsetWidth;
        box.classList.add("pop");
      }
    });
  }

  function toggleSet(exerciseIndex, setIndex) {
    if (!activeWorkout || !workUi) return;
    if (exerciseIndex !== activeWorkout.currentIndex) return;
    const exercise = activeWorkout.exercises[exerciseIndex];
    if (!exercise || setIndex < 0 || setIndex >= exercise.sets) return;
    if (exercise.done[setIndex]) {
      exercise.done[setIndex] = null;
    } else {
      exercise.reps = activeWorkout.reps;
      exercise.done[setIndex] = {
        r: normalizeReps(activeWorkout.reps),
        w: normalizeWeight(exercise.w),
        t: formatClock()
      };
    }
    persistActive();
    refreshSetGrid(workUi.setsGrid, exercise, exercise.done[setIndex] ? setIndex : null);
    vibrate(15);
  }

  function writeWeightBackToProgram(exercise) {
    if (!activeWorkout || !activeWorkout.programId) return;
    const program = programs.find((entry) => entry.id === activeWorkout.programId);
    if (!program) return;
    let target = null;
    if (
      Number.isInteger(exercise.sourceIndex) &&
      program.items[exercise.sourceIndex] &&
      program.items[exercise.sourceIndex].n === exercise.n
    ) {
      target = program.items[exercise.sourceIndex];
    }
    if (!target) {
      target = program.items.find((item) => item.n === exercise.n) || null;
    }
    if (target && target.w !== exercise.w) {
      target.w = exercise.w;
      persistPrograms();
    }
  }

  function changeExercise(delta, allowFinish = false) {
    if (!activeWorkout) return;
    const targetIndex = activeWorkout.currentIndex + delta;
    if (targetIndex < 0) return;
    if (targetIndex >= activeWorkout.exercises.length) {
      if (allowFinish) finishWorkout();
      return;
    }
    const currentExercise = activeWorkout.exercises[activeWorkout.currentIndex];
    currentExercise.reps = normalizeReps(activeWorkout.reps);
    const targetExercise = activeWorkout.exercises[targetIndex];
    activeWorkout.currentIndex = targetIndex;
    activeWorkout.reps = normalizeReps(targetExercise.reps || 10);
    targetExercise.reps = activeWorkout.reps;
    activeWorkout.timer = null;
    persistActive();
    stopTimerInterval();
    clearDialTap();
    renderRoute();
    announce(
      `${targetExercise.n}, exercise ${targetIndex + 1} of ${activeWorkout.exercises.length}.`
    );
  }

  function finishWorkout() {
    if (!activeWorkout) return;
    const hasLoggedSets = activeWorkout.exercises.some((exercise) =>
      exercise.done.some(Boolean)
    );
    if (hasLoggedSets) {
      const sessionExercises = activeWorkout.exercises.map((exercise) => ({
        n: exercise.n,
        sets: exercise.done
          .filter(Boolean)
          .map((set) => ({ r: set.r, w: set.w, t: set.t }))
      }));
      sessions.push({
        id: makeId("session"),
        date: todayLocalDate(),
        title: normalizedTitle(activeWorkout.title),
        exercises: sessionExercises
      });
      persistSessions();
    }
    activeWorkout = null;
    persistActive();
    stopTimerInterval();
    clearDialTap();
    releaseWakeLock();
    announce(
      hasLoggedSets
        ? "Workout finished and saved to your calendar."
        : "Workout ended without any logged sets."
    );
    navigate("log");
  }

  function openActiveProgramEditor() {
    if (!activeWorkout) return;
    const program = programs.find(
      (entry) => entry.id === activeWorkout.programId
    );
    if (program) {
      editor = cloneProgramIntoEditor(program);
    } else {
      editor = {
        id: null,
        title: normalizedTitle(activeWorkout.title),
        items: activeWorkout.exercises.map((exercise) => ({
          key: makeId("row"),
          n: exercise.n,
          w: exercise.w,
          sets: exercise.sets
        })),
        originalSignature: null,
        backWasAvailable: programs.length > 0
      };
    }
    navigate("program");
  }

  function bindWorkoutSwipe(container) {
    container.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        swipeState = null;
        return;
      }
      if (
        event.target.closest(
          "button, input, textarea, select, a, label, .stepper, .set-box"
        )
      ) {
        swipeState = null;
        return;
      }
      swipeState = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY
      };
    });

    container.addEventListener("pointerup", (event) => {
      if (!swipeState || swipeState.pointerId !== event.pointerId) {
        swipeState = null;
        return;
      }
      const deltaX = event.clientX - swipeState.x;
      const deltaY = event.clientY - swipeState.y;
      swipeState = null;
      if (
        Math.abs(deltaX) >= 50 &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.4
      ) {
        changeExercise(deltaX < 0 ? 1 : -1, false);
      }
    });

    container.addEventListener("pointercancel", () => {
      swipeState = null;
    });
  }

  /* -----------------------------------------------------------------------
     Rest timer
     ----------------------------------------------------------------------- */

  const DIAL_TAP_DELAY = 260;

  function getBreakMs() {
    const seconds = BREAKS.includes(Number(settings.break))
      ? Number(settings.break)
      : DEFAULT_BREAK;
    return seconds * 1000;
  }

  function getTimerElapsedMs(timer) {
    if (!timer) return 0;
    const accumulated = Number(timer.elapsed) || 0;
    let live = 0;
    if (timer.running) {
      const startedAt = Number(timer.startedAt);
      if (Number.isFinite(startedAt) && startedAt > 0) {
        live = Math.max(0, Date.now() - startedAt);
      }
    }
    return clamp(accumulated + live, 0, getBreakMs());
  }

  function paintTimer() {
    if (!workUi || !activeWorkout) return;
    const timer = activeWorkout.timer;
    const elapsed = getTimerElapsedMs(timer);
    const breakMs = getBreakMs();
    const complete = Boolean(timer && elapsed >= breakMs);
    const running = Boolean(timer && timer.running && !complete);

    workUi.timerEl.textContent = formatDurationMs(elapsed);
    workUi.timerEl.classList.toggle("is-complete", complete);
    workUi.dial.classList.toggle("is-running", running);
    workUi.dial.classList.toggle("is-complete", complete);
    const fraction = breakMs > 0 ? clamp(elapsed / breakMs, 0, 1) : 0;
    workUi.progressCircle.style.strokeDashoffset = String(1 - fraction);
    workUi.progressCircle.style.opacity = fraction > 0 ? "1" : "0";
  }

  function startTimerIntervalIfNeeded() {
    stopTimerInterval();
    if (
      currentView !== "work" ||
      !activeWorkout ||
      !workUi ||
      !activeWorkout.timer ||
      !activeWorkout.timer.running
    ) {
      return;
    }
    timerInterval = window.setInterval(tickRestTimer, 100);
    tickRestTimer();
  }

  function stopTimerInterval() {
    if (timerInterval !== null) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function tickRestTimer() {
    if (!activeWorkout || !workUi || !activeWorkout.timer) {
      stopTimerInterval();
      return;
    }
    const timer = activeWorkout.timer;
    const elapsed = getTimerElapsedMs(timer);
    if (elapsed >= getBreakMs()) {
      timer.elapsed = getBreakMs();
      timer.running = false;
      timer.startedAt = null;
      persistActive();
      stopTimerInterval();
      paintTimer();
      vibrate([80, 60, 80]);
      announce("Rest complete.");
      return;
    }
    paintTimer();
  }

  function startOrResumeRestTimer(restart = false) {
    if (!activeWorkout) return;
    let timer = activeWorkout.timer;
    if (
      !timer ||
      restart ||
      getTimerElapsedMs(timer) >= getBreakMs()
    ) {
      timer = {
        elapsed: 0,
        running: true,
        startedAt: Date.now()
      };
    } else {
      timer.elapsed = getTimerElapsedMs(timer);
      timer.running = true;
      timer.startedAt = Date.now();
    }
    activeWorkout.timer = timer;
    persistActive();
    paintTimer();
    startTimerIntervalIfNeeded();
    announce("Rest timer started.");
  }

  function pauseRestTimer() {
    if (!activeWorkout || !activeWorkout.timer) return;
    const timer = activeWorkout.timer;
    const elapsed = getTimerElapsedMs(timer);
    if (elapsed >= getBreakMs()) {
      timer.elapsed = getBreakMs();
      timer.running = false;
      timer.startedAt = null;
      persistActive();
      stopTimerInterval();
      paintTimer();
      return;
    }
    timer.elapsed = elapsed;
    timer.running = false;
    timer.startedAt = null;
    persistActive();
    stopTimerInterval();
    paintTimer();
    announce("Rest timer paused.");
  }

  function resetRestTimer(startAfterReset = false, shouldAnnounce = true) {
    if (!activeWorkout) return;
    stopTimerInterval();
    activeWorkout.timer = startAfterReset
      ? { elapsed: 0, running: true, startedAt: Date.now() }
      : null;
    persistActive();
    paintTimer();
    if (startAfterReset) {
      startTimerIntervalIfNeeded();
    }
    if (shouldAnnounce) {
      announce(
        startAfterReset
          ? "Rest timer restarted."
          : "Rest timer reset to zero."
      );
    }
  }

  function handleDialClick() {
    if (!activeWorkout || !workUi) return;
    if (dialTapTimer !== null) {
      window.clearTimeout(dialTapTimer);
      dialTapTimer = null;
      resetRestTimer(false);
      return;
    }
    dialTapTimer = window.setTimeout(() => {
      dialTapTimer = null;
      singleDialAction();
    }, DIAL_TAP_DELAY);
  }

  function singleDialAction() {
    if (!activeWorkout || !workUi) return;
    const timer = activeWorkout.timer;
    if (!timer) {
      startOrResumeRestTimer(false);
      return;
    }
    if (timer.running) {
      pauseRestTimer();
      return;
    }
    if (getTimerElapsedMs(timer) >= getBreakMs()) {
      resetRestTimer(true, false);
      return;
    }
    startOrResumeRestTimer(false);
  }

  function clearDialTap() {
    if (dialTapTimer !== null) {
      window.clearTimeout(dialTapTimer);
      dialTapTimer = null;
    }
  }

  function selectBreak(seconds) {
    if (!BREAKS.includes(seconds)) return;
    const changed = settings.break !== seconds;
    if (!changed) return;
    settings.break = seconds;
    persistSettings();
    clearDialTap();
    if (activeWorkout) {
      activeWorkout.break = seconds;
      activeWorkout.timer = null;
      persistActive();
    }
    stopTimerInterval();
    if (workUi) {
      workUi.breakButtons.forEach((button, index) => {
        const selected = BREAKS[index] === seconds;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
      paintTimer();
    }
    announce(`Rest break set to ${seconds} seconds. Timer reset.`);
  }

  /* -----------------------------------------------------------------------
     Calendar
     ----------------------------------------------------------------------- */

  function activeCalendarSession() {
    if (!activeWorkout) return null;
    return {
      id: `active-${activeWorkout.id}`,
      date: todayLocalDate(),
      title: normalizedTitle(activeWorkout.title),
      exercises: activeWorkout.exercises.map((exercise) => ({
        n: exercise.n,
        sets: exercise.done
          .filter(Boolean)
          .map((set) => ({ r: set.r, w: set.w, t: set.t }))
      })),
      inProgress: true
    };
  }

  function eventsByDate() {
    const map = new Map();
    const add = (session) => {
      if (!map.has(session.date)) map.set(session.date, []);
      map.get(session.date).push(session);
    };
    const activeSession = activeCalendarSession();
    if (activeSession) add(activeSession);
    sessions.forEach(add);
    return map;
  }

  function initializeCalendar() {
    const events = eventsByDate();
    const trainedDates = Array.from(events.keys()).sort();
    const latest = trainedDates.length
      ? trainedDates[trainedDates.length - 1]
      : todayLocalDate();
    const date = dateFromString(latest) || new Date();
    calendar = {
      year: date.getFullYear(),
      month: date.getMonth(),
      selected: latest
    };
  }

  function trainedDatesInMonth(map, year, month) {
    const prefix = `${year}-${pad2(month + 1)}-`;
    return Array.from(map.keys())
      .filter((date) => date.startsWith(prefix))
      .sort();
  }

  function changeCalendarMonth(delta) {
    if (!calendar) initializeCalendar();
    const base = new Date(calendar.year, calendar.month + delta, 1, 12, 0, 0, 0);
    calendar.year = base.getFullYear();
    calendar.month = base.getMonth();
    const events = eventsByDate();
    const dates = trainedDatesInMonth(events, calendar.year, calendar.month);
    const selectedDate = dateFromString(calendar.selected);
    const selectedVisible =
      selectedDate &&
      selectedDate.getFullYear() === calendar.year &&
      selectedDate.getMonth() === calendar.month;
    if (!selectedVisible) {
      if (dates.length) {
        calendar.selected = dates[dates.length - 1];
      } else {
        const today = new Date();
        const isCurrentMonth =
          today.getFullYear() === calendar.year &&
          today.getMonth() === calendar.month;
        calendar.selected = isCurrentMonth
          ? todayLocalDate()
          : `${calendar.year}-${pad2(calendar.month + 1)}-01`;
      }
    }
    renderRoute();
  }

  function selectCalendarDay(dateString) {
    if (!calendar || !isValidDateString(dateString)) return;
    calendar.selected = dateString;
    renderRoute();
  }

  function firstTitleLetter(title) {
    const cleaned = String(title || "").trim();
    return cleaned ? cleaned.charAt(0).toUpperCase() : "•";
  }

  function totalLoggedSets(session) {
    return session.exercises.reduce(
      (total, exercise) => total + (exercise.sets ? exercise.sets.length : 0),
      0
    );
  }

  function createDayCell(
    dateString,
    dayNumber,
    isTrained,
    isToday,
    isSelected,
    marks
  ) {
    const labelParts = [formatFullDateForLabel(dateString)];
    if (isToday) labelParts.push("today");
    if (isTrained) {
      labelParts.push(
        `${marks.count} ${pluralize(marks.count, "session")} trained`
      );
    }
    if (isSelected) labelParts.push("selected");
    const day = el(
      "button",
      {
        class: [
          "day",
          isTrained ? "is-trained" : "",
          isToday ? "is-today" : "",
          isSelected ? "is-selected" : ""
        ]
          .filter(Boolean)
          .join(" "),
        type: "button",
        "aria-label": labelParts.join(", "),
        "aria-pressed": isSelected ? "true" : "false",
        "aria-current": isToday ? "date" : false
      },
      el("span", { class: "day-number", text: String(dayNumber) }),
      el("span", {
        class: "day-mark",
        text: isTrained ? `${marks.letter}${marks.count > 1 ? "+" : ""}` : "",
        "aria-hidden": "true"
      })
    );
    day.addEventListener("click", () => selectCalendarDay(dateString));
    return day;
  }

  function renderCalendarScreen() {
    if (!calendar) initializeCalendar();
    const screen = el("main", { class: "screen screen-calendar" });
    const top = el("header", { class: "page-top" }, makeBackButton("list"));
    screen.append(top);

    const card = el("section", {
      class: "calendar-card",
      "aria-labelledby": "calendar-month-heading"
    });

    const events = eventsByDate();
    const monthDates = trainedDatesInMonth(events, calendar.year, calendar.month);
    const calendarTop = el("div", { class: "calendar-top" });
    const previousMonthButton = el(
      "button",
      {
        class: "calendar-arrow",
        type: "button",
        "aria-label": "Previous month"
      },
      makeIcon("chevronLeft")
    );
    previousMonthButton.addEventListener("click", () => changeCalendarMonth(-1));
    const nextMonthButton = el(
      "button",
      {
        class: "calendar-arrow",
        type: "button",
        "aria-label": "Next month"
      },
      makeIcon("chevronRight")
    );
    nextMonthButton.addEventListener("click", () => changeCalendarMonth(1));
    const monthHeading = el("h1", {
      class: "month-title",
      id: "calendar-month-heading",
      text: formatMonthYear(calendar.year, calendar.month),
      "aria-live": "polite"
    });
    calendarTop.append(previousMonthButton, monthHeading, nextMonthButton);
    card.append(calendarTop);

    const trainedCount = monthDates.length;
    card.append(
      el("p", {
        class: "month-sub",
        text:
          trainedCount > 0
            ? `${trainedCount} trained ${pluralize(trainedCount, "day")}`
            : "No training"
      })
    );

    const weekdays = el("div", {
      class: "weekday-grid",
      "aria-hidden": "true"
    });
    WEEKDAYS_MONDAY_FIRST.forEach((name) => {
      weekdays.append(el("span", { class: "weekday", text: name }));
    });
    card.append(weekdays);

    const daysGrid = el("div", {
      class: "days-grid",
      role: "group",
      "aria-label": `${formatMonthYear(calendar.year, calendar.month)} days`
    });
    const offset = firstWeekdayOffset(calendar.year, calendar.month);
    const numberOfDays = daysInMonth(calendar.year, calendar.month);
    const totalCells = Math.ceil((offset + numberOfDays) / 7) * 7;
    const today = todayLocalDate();

    for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
      const dayNumber = cellIndex - offset + 1;
      if (dayNumber < 1 || dayNumber > numberOfDays) {
        daysGrid.append(
          el("div", { class: "day is-blank", "aria-hidden": "true" })
        );
        continue;
      }
      const dateString = `${calendar.year}-${pad2(calendar.month + 1)}-${pad2(dayNumber)}`;
      const dayEvents = events.get(dateString) || [];
      const marks = {
        count: dayEvents.length,
        letter: dayEvents.length ? firstTitleLetter(dayEvents[0].title) : ""
      };
      daysGrid.append(
        createDayCell(
          dateString,
          dayNumber,
          dayEvents.length > 0,
          dateString === today,
          dateString === calendar.selected,
          marks
        )
      );
    }
    card.append(daysGrid);
    screen.append(card);

    const selectedEvents = events.get(calendar.selected) || [];
    if (selectedEvents.length === 0) {
      screen.append(
        el("p", {
          class: "empty-day",
          text: `Nothing logged on ${formatLongDay(calendar.selected)}.`
        })
      );
    } else {
      const list = el("div", {
        class: "session-list",
        "aria-label": `Sessions on ${formatFullDateForLabel(calendar.selected)}`
      });
      selectedEvents.forEach((session) => {
        list.append(createSessionCard(session));
      });
      screen.append(list);
    }

    return screen;
  }

  function createSessionCard(session) {
    const setCount = totalLoggedSets(session);
    const card = el("article", { class: "session-card" });
    const bodyId = makeId("session-body");
    const header = el("button", {
      class: "session-head",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": bodyId
    });
    const copy = el("span", { class: "session-head-copy" });
    copy.append(el("span", { class: "session-title", text: session.title }));

    const meta = el("span", { class: "session-meta" });
    if (session.inProgress) {
      meta.append(
        el("span", {
          class: "session-status",
          text: "Today, in progress"
        })
      );
    } else {
      meta.append(
        el("span", { text: formatSessionDate(session.date) })
      );
    }
    meta.append(el("span", { class: "session-meta-dot", text: "·" }));
    meta.append(
      el("span", {
        text: `${setCount} ${pluralize(setCount, "set")}`
      })
    );
    copy.append(meta);
    header.append(
      copy,
      el(
        "span",
        { class: "session-chevron", "aria-hidden": "true" },
        makeIcon("chevronDown")
      )
    );

    const body = el("div", { class: "session-body", id: bodyId, hidden: true });
    const loggedExercises = session.exercises.filter(
      (exercise) => exercise.sets && exercise.sets.length > 0
    );
    if (loggedExercises.length === 0) {
      body.append(
        el("p", {
          class: "session-exercises-empty",
          text: "No sets checked yet."
        })
      );
    } else {
      loggedExercises.forEach((exercise) => {
        const weights = exercise.sets.map((set) => Number(set.w) || 0);
        const bestWeight = Math.max(...weights);
        const reps = exercise.sets.map((set) => Number(set.r));
        const row = el(
          "div",
          { class: "session-exercise" },
          el("span", { class: "session-ex-name", text: exercise.n }),
          el(
            "span",
            { class: "session-ex-data" },
            el("span", {
              class: "session-ex-weight",
              text:
                bestWeight > 0
                  ? `${formatNumber(bestWeight)} kg`
                  : "Body weight"
            }),
            el("span", {
              class: "session-ex-reps",
              text: formatRepsList(reps)
            })
          )
        );
        body.append(row);
      });
    }

    header.addEventListener("click", () => {
      const expanded = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", expanded ? "false" : "true");
      body.hidden = expanded;
    });

    card.append(header, body);
    return card;
  }

  /* -----------------------------------------------------------------------
     Progress
     ----------------------------------------------------------------------- */

  function buildProgressEntries() {
    const orderedSessions = sessions
      .map((session, index) => ({ session, index }))
      .sort(
        (a, b) =>
          a.session.date.localeCompare(b.session.date) || a.index - b.index
      );
    const entries = new Map();
    const firstSeen = [];

    orderedSessions.forEach(({ session }) => {
      const perExercise = new Map();
      session.exercises.forEach((exercise) => {
        if (!exercise.sets || exercise.sets.length === 0) return;
        const key = String(exercise.n || "").trim().toLowerCase();
        if (!key) return;
        if (!perExercise.has(key)) {
          perExercise.set(key, {
            name: String(exercise.n).trim(),
            sets: []
          });
        }
        perExercise.get(key).sets.push(...exercise.sets);
      });

      perExercise.forEach((data, key) => {
        if (!entries.has(key)) {
          entries.set(key, {
            key,
            name: data.name,
            sessionSets: []
          });
          firstSeen.push(key);
        }
        entries.get(key).sessionSets.push(data.sets);
      });
    });

    return firstSeen
      .map((key) => entries.get(key))
      .filter((entry) => entry && entry.sessionSets.length >= 2)
      .map((entry) => {
        const allSets = entry.sessionSets.flat();
        const weighted = allSets.some((set) => Number(set.w) > 0);
        const values = entry.sessionSets.map((sets) => {
          if (weighted) {
            return Math.max(...sets.map((set) => Number(set.w) || 0));
          }
          return sets.reduce((sum, set) => sum + (Number(set.r) || 0), 0);
        });
        const first = values[0];
        const latest = values[values.length - 1];
        const delta = Math.round((latest - first) * 100) / 100;
        return {
          name: entry.name,
          values,
          first,
          latest,
          delta,
          unit: weighted ? "kg" : "reps"
        };
      });
  }

  function createSparkline(values) {
    const width = 84;
    const height = 32;
    const padding = 5;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "sparkline");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const points = values.map((value, index) => {
      const x =
        values.length === 1
          ? width / 2
          : padding + (index / (values.length - 1)) * (width - padding * 2);
      const normalized = range === 0 ? 0.5 : (value - min) / range;
      const y = padding + (1 - normalized) * (height - padding * 2);
      return { x, y };
    });

    const polyline = document.createElementNS(SVG_NS, "polyline");
    polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "currentColor");
    polyline.setAttribute("stroke-width", "2.5");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.append(polyline);

    const last = points[points.length - 1];
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(last.x));
    dot.setAttribute("cy", String(last.y));
    dot.setAttribute("r", "3.2");
    dot.setAttribute("fill", "currentColor");
    svg.append(dot);
    return svg;
  }

  function formatDelta(delta) {
    const rounded = Math.round(delta * 100) / 100;
    if (rounded > 0) return `+${formatNumber(rounded)}`;
    if (rounded < 0) return `-${formatNumber(Math.abs(rounded))}`;
    return "0";
  }

  function renderProgressScreen() {
    const screen = el("main", { class: "screen screen-progress" });
    screen.append(el("header", { class: "page-top" }, makeBackButton("list")));
    const entries = buildProgressEntries();
    const card = el("section", {
      class: "progress-card",
      "aria-labelledby": "progress-title"
    });
    card.append(
      el("h1", {
        class: "progress-title",
        id: "progress-title",
        text: "Progress"
      })
    );

    if (entries.length === 0) {
      card.append(
        el("p", {
          class: "progress-hint",
          text: "Log at least two sessions to see progress."
        })
      );
    } else {
      const list = el("div", { class: "progress-list" });
      entries.forEach((entry) => {
        const metrics = el("div", { class: "progress-metrics" });
        const latest = el("div", { class: "progress-latest" });
        latest.append(document.createTextNode(formatNumber(entry.latest)));
        latest.append(
          el("span", { class: "progress-latest-unit", text: entry.unit })
        );
        const delta = el("span", {
          class: `progress-delta${entry.delta > 0 ? " is-positive" : ""}`,
          text: formatDelta(entry.delta)
        });
        metrics.append(latest, delta);
        list.append(
          el(
            "div",
            { class: "progress-row" },
            el("p", { class: "progress-name", text: entry.name }),
            createSparkline(entry.values),
            metrics
          )
        );
      });
      card.append(list);
    }

    screen.append(card);
    return screen;
  }

  /* -----------------------------------------------------------------------
     Screen Wake Lock
     ----------------------------------------------------------------------- */

  function supportsWakeLock() {
    return (
      typeof navigator !== "undefined" &&
      navigator.wakeLock &&
      typeof navigator.wakeLock.request === "function"
    );
  }

  function syncWakeForActiveWorkout() {
    if (!activeWorkout || currentView !== "work") return;
    if (document.visibilityState !== "visible") return;
    if (!supportsWakeLock() || wakeLock || wakeLockRequest) return;
    try {
      wakeLockRequest = navigator.wakeLock.request("screen");
      wakeLockRequest
        .then((sentinel) => {
          wakeLockRequest = null;
          if (
            currentView !== "work" ||
            !activeWorkout ||
            document.visibilityState !== "visible"
          ) {
            try {
              sentinel.release();
            } catch (error) {
              // A released or inactive sentinel is harmless.
            }
            return;
          }
          wakeLock = sentinel;
          sentinel.addEventListener("release", () => {
            if (wakeLock === sentinel) wakeLock = null;
          });
        })
        .catch(() => {
          wakeLockRequest = null;
        });
    } catch (error) {
      wakeLockRequest = null;
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    const sentinel = wakeLock;
    wakeLock = null;
    if (!sentinel) return;
    try {
      const result = sentinel.release();
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (error) {
      // Wake locks are best-effort.
    }
  }

  /* -----------------------------------------------------------------------
     Service worker and global lifecycle
     ----------------------------------------------------------------------- */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const host = window.location.hostname;
    const secure =
      window.location.protocol === "https:" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]";
    if (!secure) return;
    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {
          // A failed registration is non-fatal; the app still runs offline
          // only when the browser has already cached the page.
        });
      },
      { once: true }
    );
  }

  function bindGlobalEvents() {
    window.addEventListener("popstate", scheduleRouteRender);
    window.addEventListener("hashchange", scheduleRouteRender);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (currentView === "work" && activeWorkout) {
        syncWakeForActiveWorkout();
        if (activeWorkout.timer && activeWorkout.timer.running) {
          paintTimer();
          startTimerIntervalIfNeeded();
        }
      }
    });
  }

  function boot() {
    loadData();
    setInitialRoute();
    bindGlobalEvents();
    renderRoute();
    registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
