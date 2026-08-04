"use strict";

// Canvas-only view. It receives state and calculation callbacks from app.js.
window.ATCDrivingGraphView = (() => {
  function draw({ canvas, train, ROUTE, nextStation, speedKmh, clamp, lerp, getReferenceSpeedAt, getAtcPlan }) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(280, Math.round(rect.width));
    const cssHeight = Math.max(52, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const margin = { left: 30, right: 8, top: 5, bottom: 15 };
    const plotLeft = margin.left;
    const plotTop = margin.top;
    const plotRight = Math.max(plotLeft + 1, cssWidth - margin.right);
    const plotBottom = Math.max(plotTop + 1, cssHeight - margin.bottom);
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const startPosition = Math.max(0, train.position - 1200);
    const endPosition = Math.min(ROUTE.stopPosition, Math.max(nextStation.position, train.position + 5500));
    const positionRange = Math.max(1, endPosition - startPosition);
    const xFor = position => plotLeft + (position - startPosition) / positionRange * plotWidth;
    const yFor = speed => plotTop + (1 - clamp(speed / 320, 0, 1)) * plotHeight;

    ctx.font = "8px system-ui";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(200,225,236,.68)";
    ctx.strokeStyle = "rgba(120,170,190,.18)";
    ctx.lineWidth = 1;
    [0, 100, 200, 300].forEach(speed => {
      const y = yFor(speed);
      ctx.beginPath(); ctx.moveTo(plotLeft, y); ctx.lineTo(plotRight, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(String(speed), plotLeft - 5, y);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(plotLeft, plotTop, plotWidth, plotHeight); ctx.clip();
    const drawLine = (color, width, getValue, dash = []) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const position = lerp(startPosition, endPosition, i / 64);
        const x = xFor(position); const y = yFor(getValue(position));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    };
    drawLine("#4fb6ff", 1.7, getReferenceSpeedAt);
    drawLine("#ffd35a", 1.25, position => {
      const oldPosition = train.position;
      train.position = position;
      const value = getAtcPlan().permittedKmh;
      train.position = oldPosition;
      return value;
    }, [4, 3]);

    const currentX = xFor(train.position);
    const currentY = yFor(speedKmh);
    ctx.strokeStyle = "rgba(109,255,143,.35)";
    ctx.beginPath(); ctx.moveTo(currentX, plotTop); ctx.lineTo(currentX, plotBottom); ctx.stroke();
    ctx.fillStyle = "#6dff8f";
    ctx.beginPath(); ctx.arc(currentX, currentY, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(220,239,246,.76)";
    ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`${Math.max(0, (endPosition - train.position) / 1000).toFixed(1)}km`, plotRight, cssHeight - 3);
  }
  return { draw };
})();
