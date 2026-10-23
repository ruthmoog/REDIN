(function () {
  const YEAR = 2026;
  const MONTH = 10; // November (0-indexed)
  const MONTH_NAME = "November";
  const STORAGE_KEY = "read-every-day-2026-11";
  const CATCHUP_STORAGE_KEY = "read-every-day-2026-11-catchup";
  const CATCHUP_DECISION_KEY = "read-every-day-2026-11-catchup-decision";
  const DISMISSED_STORAGE_KEY = "read-every-day-2026-11-dismissed-stickers";
  const THEME_KEY = "read-every-day-theme";
  const MOBILE_QUERY = "(max-width: 600px)";
  const MOCK_DATE_KEY = "read-every-day-mock-date";

  // --- Dev-only date mocking --------------------------------------------
  // Lets you preview catch-up days without waiting for real time to pass.
  // Usage:
  //   ?mockDate=2026-12-05   -> pretend today is 5 Dec 2026
  //   ?mockDate=clear        -> remove the mock and use the real date again
  //
  // Changing to a *different* mock date also resets the "has the user been
  // asked about catch-up days yet?" flag, since that's normally a one-time
  // decision — without this, retesting the prompt while iterating on a
  // mock date would require manually clearing localStorage every time.
  (function initMockDate() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("mockDate")) return;

    const value = (params.get("mockDate") || "").trim();
    try {
      if (value === "clear") {
        localStorage.removeItem(MOCK_DATE_KEY);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const previous = localStorage.getItem(MOCK_DATE_KEY);
        localStorage.setItem(MOCK_DATE_KEY, value);
        if (previous !== value) {
          localStorage.removeItem(CATCHUP_DECISION_KEY);
        }
      } else {
        // Invalid format — surface this clearly rather than silently
        // ignoring it (e.g. wrong separators, missing leading zeros).
        console.warn(
          `[mockDate] "${value}" isn't a valid date — expected YYYY-MM-DD. Ignoring.`
        );
      }
    } catch (e) {
      // ignore storage errors
    }
  })();

  function getMockDateString() {
    try {
      return localStorage.getItem(MOCK_DATE_KEY);
    } catch (e) {
      return null;
    }
  }

  // Returns the mocked "now" if a dev mock date is set, otherwise the
  // real current date/time.
  function getNow() {
    const mock = getMockDateString();
    if (!mock) return new Date();
    const [y, m, d] = mock.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function renderMockDateBanner() {
    const banner = document.getElementById("mock-date-banner");
    const mock = getMockDateString();

    if (!mock) {
      banner.hidden = true;
      document.body.classList.remove("has-mock-banner");
      return;
    }

    const formatted = getNow().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    banner.innerHTML = "";
    banner.append(`DEV MODE — pretending today is ${formatted}. `);

    const clearLink = document.createElement("a");
    clearLink.href = "?mockDate=clear";
    clearLink.textContent = "Clear mock date";
    banner.appendChild(clearLink);

    banner.append(" — ");

    const resetPromptLink = document.createElement("a");
    resetPromptLink.href = "#";
    resetPromptLink.textContent = "Reset catch-up prompt";
    resetPromptLink.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        localStorage.removeItem(CATCHUP_DECISION_KEY);
      } catch (err) {
        // ignore storage errors
      }
      updateProgress();
    });
    banner.appendChild(resetPromptLink);

    banner.hidden = false;
    document.body.classList.add("has-mock-banner");
  }

  renderMockDateBanner();

  const calendarEl = document.getElementById("calendar");
  const progressText = document.getElementById("progress-text");
  const progressFill = document.getElementById("progress-fill");
  const resetBtn = document.getElementById("reset-btn");
  // Reset is a dev/testing convenience — only show it when a mock date is
  // active, so real users don't see (or accidentally trigger) it.
  resetBtn.hidden = !getMockDateString();
  const themeLightBtn = document.getElementById("theme-light-btn");
  const themeDarkBtn = document.getElementById("theme-dark-btn");
  const catchupNotice = document.getElementById("catchup-notice");
  const showDismissedBtn = document.getElementById("show-dismissed-btn");
  const dismissedCountEl = document.getElementById("dismissed-count");

  const resetDialogOverlay = document.getElementById("reset-dialog-overlay");
  const resetDialogCancel = document.getElementById("reset-dialog-cancel");
  const resetDialogConfirm = document.getElementById("reset-dialog-confirm");

  const catchupDialogOverlay = document.getElementById(
    "catchup-dialog-overlay"
  );
  const catchupDialogNo = document.getElementById("catchup-dialog-no");
  const catchupDialogYes = document.getElementById("catchup-dialog-yes");

  const STICKER_THRESHOLD = 5;
  const HALFWAY_DAY = 15;
  const ONE_WEEK_DAY = 23;

  // Each sticker is tied to a reference day in the month, used for the
  // mobile-only "auto dismiss after that date" behaviour below.
  const stickers = [
    {
      el: document.getElementById("milestone-sticker"),
      day: STICKER_THRESHOLD,
      isAchieved: (doneCount) => doneCount >= STICKER_THRESHOLD,
    },
    {
      el: document.getElementById("halfway-sticker"),
      day: HALFWAY_DAY,
      isAchieved: () => !!state[HALFWAY_DAY],
    },
    {
      el: document.getElementById("oneweek-sticker"),
      day: ONE_WEEK_DAY,
      isAchieved: () => !!state[ONE_WEEK_DAY],
    },
    {
      el: document.getElementById("complete-sticker"),
      day: 30,
      isAchieved: (doneCount, totalProgress) => totalProgress >= daysInMonth,
    },
  ];

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // ignore storage errors
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const isLight = theme === "light";
    themeLightBtn.disabled = isLight;
    themeDarkBtn.disabled = !isLight;
    themeLightBtn.setAttribute("aria-pressed", String(isLight));
    themeDarkBtn.setAttribute("aria-pressed", String(!isLight));
  }

  // The inline script in <head> already set data-theme to avoid a flash;
  // read it back here so the buttons match on load.
  let currentTheme =
    document.documentElement.getAttribute("data-theme") ||
    getStoredTheme() ||
    (window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark");
  applyTheme(currentTheme);

  themeLightBtn.addEventListener("click", () => {
    currentTheme = "light";
    applyTheme(currentTheme);
    setStoredTheme(currentTheme);
  });

  themeDarkBtn.addEventListener("click", () => {
    currentTheme = "dark";
    applyTheme(currentTheme);
    setStoredTheme(currentTheme);
  });

  // If the user hasn't explicitly chosen a theme, keep following the
  // OS-level preference as it changes.
  if (!getStoredTheme() && window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: light)")
      .addEventListener("change", (e) => {
        if (getStoredTheme()) return; // user has since made an explicit choice
        currentTheme = e.matches ? "light" : "dark";
        applyTheme(currentTheme);
      });
  }

  const daysInMonth = new Date(YEAR, MONTH + 1, 0).getDate();
  const firstWeekday = new Date(YEAR, MONTH, 1).getDay();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // ignore storage errors (e.g. private mode)
    }
  }

  let state = loadState();

  function loadCatchUpState() {
    try {
      const raw = localStorage.getItem(CATCHUP_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveCatchUpState(catchUpState) {
    try {
      localStorage.setItem(CATCHUP_STORAGE_KEY, JSON.stringify(catchUpState));
    } catch (e) {
      // ignore storage errors (e.g. private mode)
    }
  }

  let catchUpState = loadCatchUpState();

  function loadCatchUpDecision() {
    try {
      return localStorage.getItem(CATCHUP_DECISION_KEY);
    } catch (e) {
      return null;
    }
  }

  function saveCatchUpDecision(decision) {
    try {
      if (decision) {
        localStorage.setItem(CATCHUP_DECISION_KEY, decision);
      } else {
        localStorage.removeItem(CATCHUP_DECISION_KEY);
      }
    } catch (e) {
      // ignore storage errors
    }
  }

  // "accepted" | "declined" | null (not yet asked)
  let catchUpDecision = loadCatchUpDecision();

  function loadDismissedStickers() {
    try {
      const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveDismissedStickers(dismissedStickers) {
    try {
      localStorage.setItem(
        DISMISSED_STORAGE_KEY,
        JSON.stringify(dismissedStickers)
      );
    } catch (e) {
      // ignore storage errors (e.g. private mode)
    }
  }

  let dismissedStickers = loadDismissedStickers();

  function isToday(day) {
    const now = getNow();
    return (
      now.getFullYear() === YEAR &&
      now.getMonth() === MONTH &&
      now.getDate() === day
    );
  }

  // True once the real-world date is after the end of the given day in
  // this month (used to auto-dismiss stickers on mobile, and to know when
  // the whole challenge has finished).
  function isPastDay(day) {
    const now = getNow();
    const endOfDay = new Date(YEAR, MONTH, day, 23, 59, 59, 999);
    return now > endOfDay;
  }

  // True once the challenge month itself has finished in real time (i.e.
  // the whole of November 2026 has passed).
  function isChallengeFinished() {
    return isPastDay(daysInMonth);
  }

  function isMobileView() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function updateStickers(doneCount, totalProgress) {
    const achievedStickers = stickers.filter(
      (sticker) =>
        sticker.isAchieved(doneCount, totalProgress) && !isPastDay(sticker.day)
    );

    let visibleStickers;
    if (isMobileView()) {
      // Mobile: only ever show the single most-recently-achieved sticker
      // (that hasn't been dismissed).
      const candidate = achievedStickers
        .filter((sticker) => !dismissedStickers[sticker.el.id])
        .reduce(
          (latest, sticker) =>
            !latest || sticker.day > latest.day ? sticker : latest,
          null
        );
      visibleStickers = candidate ? [candidate] : [];
    } else {
      // Desktop: show every achieved sticker that hasn't been dismissed.
      visibleStickers = achievedStickers.filter(
        (sticker) => !dismissedStickers[sticker.el.id]
      );
    }

    stickers.forEach((sticker) => {
      sticker.el.hidden = !visibleStickers.includes(sticker);
    });

    // Stickers that have been earned but are currently hidden because the
    // user dismissed them can be brought back via the "view dismissed"
    // control below.
    const dismissedCount = achievedStickers.filter(
      (sticker) => dismissedStickers[sticker.el.id]
    ).length;
    dismissedCountEl.textContent = String(dismissedCount);
    showDismissedBtn.hidden = dismissedCount === 0;
  }

  function getMissingCount(doneCount) {
    return daysInMonth - doneCount;
  }

  // Prompts the user to opt in to catch-up days, either when they tick off
  // day 30 on the real 30th while still short of 30/30, or when they visit
  // the page after November has finished with days still missing. Only
  // ever asks once — the user's choice is remembered from then on.
  function maybePromptForCatchUp(doneCount) {
    if (catchUpDecision) return; // already asked
    if (!catchupDialogOverlay.hidden) return; // already open

    const missingCount = getMissingCount(doneCount);
    if (missingCount <= 0) return;

    const clickedDay30Today = isToday(daysInMonth) && !!state[daysInMonth];
    if (isChallengeFinished() || clickedDay30Today) {
      openCatchupDialog();
    }
  }

  function updateProgress() {
    const doneCount = Object.values(state).filter(Boolean).length;
    const missingCount = getMissingCount(doneCount);
    const catchUpDoneCount = countCatchUpDone(missingCount);
    const totalProgress = Math.min(daysInMonth, doneCount + catchUpDoneCount);

    progressText.textContent = `${totalProgress} / ${daysInMonth} days read`;
    progressFill.style.width = `${(totalProgress / daysInMonth) * 100}%`;

    updateStickers(doneCount, totalProgress);
    renderCatchUpDays(missingCount);
    maybePromptForCatchUp(doneCount);
  }

  // Re-evaluate sticker visibility when crossing the mobile/desktop
  // breakpoint (e.g. rotating a device or resizing a window).
  window.matchMedia(MOBILE_QUERY).addEventListener("change", updateProgress);

  // Wire up each sticker's dismiss ("×") button.
  stickers.forEach((sticker) => {
    const dismissBtn = sticker.el.querySelector(".sticker-dismiss");
    if (!dismissBtn) return;
    dismissBtn.addEventListener("click", () => {
      dismissedStickers[sticker.el.id] = true;
      saveDismissedStickers(dismissedStickers);
      updateProgress();
    });
  });

  // "View dismissed stickers" restores every dismissed sticker so it can
  // be seen again; it stays dismissed only until the user asks for it back.
  showDismissedBtn.addEventListener("click", () => {
    dismissedStickers = {};
    saveDismissedStickers(dismissedStickers);
    updateProgress();
  });

  function countCatchUpDone(missingCount) {
    let count = 0;
    for (let catchUpDay = 1; catchUpDay <= missingCount; catchUpDay++) {
      if (catchUpState[catchUpDay]) count++;
    }
    return count;
  }

  function renderCatchUpDays(missingCount) {
    // Clear any previously rendered catch-up day cells.
    calendarEl.querySelectorAll(".day.catchup").forEach((el) => el.remove());

    const showCatchUpDays = catchUpDecision === "accepted" && missingCount > 0;
    catchupNotice.hidden = !showCatchUpDays;

    if (!showCatchUpDays) return;

    for (let catchUpDay = 1; catchUpDay <= missingCount; catchUpDay++) {
      const cell = document.createElement("div");
      cell.className = "day catchup";
      cell.textContent = `C${catchUpDay}`;
      cell.dataset.catchupDay = String(catchUpDay);
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("aria-label", `Catch-up day ${catchUpDay}`);
      cell.setAttribute("aria-pressed", String(!!catchUpState[catchUpDay]));
      cell.title = `Catch-up day ${catchUpDay}`;

      if (catchUpState[catchUpDay]) cell.classList.add("done");

      const toggleCatchUpDay = () => {
        catchUpState[catchUpDay] = !catchUpState[catchUpDay];
        saveCatchUpState(catchUpState);
        cell.classList.toggle("done", !!catchUpState[catchUpDay]);
        cell.setAttribute(
          "aria-pressed",
          String(!!catchUpState[catchUpDay])
        );
        updateProgress();
      };

      cell.addEventListener("click", toggleCatchUpDay);
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          toggleCatchUpDay();
        }
      });

      calendarEl.appendChild(cell);
    }
  }

  function toggleDay(cell, day) {
    state[day] = !state[day];
    saveState(state);
    cell.classList.toggle("done", !!state[day]);
    cell.setAttribute("aria-pressed", String(!!state[day]));
    updateProgress();
  }

  function render() {
    calendarEl.innerHTML = "";

    // Once the user has opted in to catch-up days, November's own days are
    // locked as a historical record — catch-up days become the active
    // mechanism for making up any days that were missed.
    const isLocked = catchUpDecision === "accepted";

    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement("div");
      empty.className = "day empty";
      empty.setAttribute("aria-hidden", "true");
      calendarEl.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.className = "day";
      cell.textContent = day;
      cell.dataset.day = String(day);

      const isDone = !!state[day];
      if (isToday(day)) cell.classList.add("today");
      if (isDone) cell.classList.add("done");

      if (isLocked) {
        cell.classList.add("locked");
        cell.setAttribute("aria-disabled", "true");
        const lockedLabel = isDone
          ? `${day} ${MONTH_NAME} — marked as read`
          : `${day} ${MONTH_NAME} — missed, use catch-up days instead`;
        cell.setAttribute("aria-label", lockedLabel);
        cell.title = lockedLabel;
      } else {
        // Any day — including earlier ones — can be freely checked or
        // unchecked, so users can backdate their reading.
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");
        cell.setAttribute("aria-label", `check off ${day} ${MONTH_NAME}`);
        cell.setAttribute("aria-pressed", String(isDone));

        cell.addEventListener("click", () => toggleDay(cell, day));
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault();
            toggleDay(cell, day);
          }
        });
      }

      calendarEl.appendChild(cell);
    }

    updateProgress();
  }

  // --- Accessible dialog helper -----------------------------------------
  // Shared open/close/focus-trap behaviour for both the reset and
  // catch-up confirmation dialogs.
  function createDialog(overlay, focusables, defaultFocusEl) {
    let elementFocusedBeforeDialog = null;

    function handleKeydown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === "Tab") {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function open() {
      elementFocusedBeforeDialog = document.activeElement;
      overlay.hidden = false;
      defaultFocusEl.focus();
      document.addEventListener("keydown", handleKeydown);
    }

    function close() {
      overlay.hidden = true;
      document.removeEventListener("keydown", handleKeydown);
      if (elementFocusedBeforeDialog && elementFocusedBeforeDialog.focus) {
        elementFocusedBeforeDialog.focus();
      }
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    return { open, close };
  }

  // --- Reset confirmation dialog ---------------------------------------

  const resetDialog = createDialog(
    resetDialogOverlay,
    [resetDialogCancel, resetDialogConfirm],
    resetDialogCancel
  );

  resetBtn.addEventListener("click", resetDialog.open);
  resetDialogCancel.addEventListener("click", resetDialog.close);

  resetDialogConfirm.addEventListener("click", () => {
    state = {};
    catchUpState = {};
    catchUpDecision = null;
    dismissedStickers = {};
    saveState(state);
    saveCatchUpState(catchUpState);
    saveCatchUpDecision(catchUpDecision);
    saveDismissedStickers(dismissedStickers);
    resetDialog.close();
    render();
  });

  // --- Catch-up opt-in dialog --------------------------------------------

  const catchupDialog = createDialog(
    catchupDialogOverlay,
    [catchupDialogNo, catchupDialogYes],
    catchupDialogNo
  );

  function openCatchupDialog() {
    catchupDialog.open();
  }

  catchupDialogNo.addEventListener("click", () => {
    catchUpDecision = "declined";
    saveCatchUpDecision(catchUpDecision);
    catchupDialog.close();
  });

  catchupDialogYes.addEventListener("click", () => {
    catchUpDecision = "accepted";
    saveCatchUpDecision(catchUpDecision);
    catchupDialog.close();
    render();
  });

  // Persist state proactively when the user leaves/hides the page.
  window.addEventListener("beforeunload", () => {
    saveState(state);
    saveCatchUpState(catchUpState);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveState(state);
      saveCatchUpState(catchUpState);
    }
  });

  render();
})();
