"use strict";

// v71.3.0 Operation Panel Controller.
// Responsibility: bind the visible lower console to the simulation core's existing controls
// and mirror only operational status. It does not calculate physics, ATC, station logic, or audio.
(() => {
  const $ = selector => document.querySelector(selector);
  const ui = {
    door: $("#v662DoorButton"),
    atc: $("#v662AtcButton"),
    autoCall: $("#v662AutoCallButton"),
    option: $("#v662OptionButton"),
    fullscreen: $("#v662FullscreenButton"),
    reset: $("#v662ResetButton"),
    boardingSkip: $("#v664BoardingSkipButton"),
    run: $("#v662RunStatus"),
    atcState: $("#v662AtcStatus"),
    doorLed: $("#v662DoorLed"),
    passengerEnd: $("#v662PassengerEnd"),
    buzzer: $("#v662BuzzerStatus"),
  };

  const original = {
    door: $("#startButton"),
    atc: $("#atcConfirmFloatButton") || $("#atcConfirmButton"),
    voiceToggle: $("#driverVoiceToggle"),
    option: $("#mixerOptionButton"),
    fullscreen: $("#fullscreenButton"),
    reset: $("#resetButton"),
    status: $("#statusText"),
    doorLamp: $("#doorLamp"),
    phase: $("#phaseValue"),
  };

  const safelyClick = element => {
    if (element && !element.disabled) element.click();
  };

  ui.door?.addEventListener("click", () => safelyClick(original.door));

  const beginAtc = () => {
    if (!original.atc || original.atc.disabled) return;
    original.atc.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  };
  const endAtc = () => {
    if (!original.atc) return;
    original.atc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  };
  ui.atc?.addEventListener("pointerdown", beginAtc);
  ui.atc?.addEventListener("pointerup", endAtc);
  ui.atc?.addEventListener("pointercancel", endAtc);
  ui.atc?.addEventListener("pointerleave", endAtc);

  ui.autoCall?.addEventListener("click", () => {
    if (!original.voiceToggle) return;
    original.voiceToggle.checked = !original.voiceToggle.checked;
    original.voiceToggle.dispatchEvent(new Event("change", { bubbles: true }));
  });
  ui.option?.addEventListener("click", () => safelyClick(original.option));
  ui.fullscreen?.addEventListener("click", () => safelyClick(original.fullscreen));
  ui.reset?.addEventListener("click", () => safelyClick(original.reset));
  ui.boardingSkip?.addEventListener("click", () => window.__SHINKANSEN_TEST__?.skipBoarding?.());

  const sync = () => {
    const statusText = original.status?.textContent?.trim() || "";
    const phase = original.phase?.textContent?.trim() || "";
    const doorClosed = Boolean(original.doorLamp?.classList.contains("on"));
    const doorNeedsAction = Boolean(original.door && !original.door.disabled && /ドア|開|閉/.test(original.door.textContent || ""));
    const atcNeedsAction = Boolean(original.atc && !original.atc.disabled);
    const boarding = /BOARDING|BUZZER_DONE|ARRIVAL_OPEN/.test(phase) || /乗降|客扱/.test(statusText);

    if (ui.run) {
      ui.run.textContent = /走行中|運転中/.test(statusText) ? "運転中" : /終着|終了/.test(statusText) ? "終着" : "停車中";
    }
    if (ui.atcState) {
      ui.atcState.textContent = /ATC.*(制御|ブレーキ)/.test(statusText) ? "ATC制御中" : "ATC監視中";
    }
    ui.doorLed?.classList.toggle("on", doorClosed);
    ui.passengerEnd?.classList.toggle("hidden", !boarding);
    if (ui.buzzer) ui.buzzer.textContent = /BUZZER_DONE/.test(phase) ? "ブザー鳴動済" : "ブザー停止中";

    if (ui.door) {
      ui.door.disabled = Boolean(original.door?.disabled);
      ui.door.classList.toggle("attention", doorNeedsAction);
      ui.door.textContent = "ドア開閉";
    }
    if (ui.atc) {
      ui.atc.disabled = !atcNeedsAction;
      ui.atc.classList.toggle("attention", atcNeedsAction);
      ui.atc.textContent = /確認済/.test(original.atc?.textContent || "") ? "ATC確認済" : "ATC確認";
    }
    if (ui.autoCall) {
      const enabled = Boolean(original.voiceToggle?.checked);
      ui.autoCall.textContent = enabled ? "自動喚呼 ON" : "自動喚呼 OFF";
      ui.autoCall.setAttribute("aria-pressed", String(enabled));
    }
  };

  sync();
  const observed = [original.status, original.doorLamp, original.phase, original.atc, original.voiceToggle].filter(Boolean);
  const observer = new MutationObserver(sync);
  observed.forEach(node => observer.observe(node, { attributes:true, childList:true, subtree:true, characterData:true }));
  window.addEventListener("shinkansen:ui-refresh", sync);
  window.__SHINKANSEN_UI_BUILD__ = "v71.3.0-responsibility-split";
})();
