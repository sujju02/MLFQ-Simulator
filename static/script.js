/**
 * MLFQ CPU Scheduling Simulator — script.js
 * ===========================================
 * Handles:
 *  - Tab navigation
 *  - Process table CRUD
 *  - API calls to Flask backend
 *  - Interactive animated queue playback (step-by-step, scrubber, speed controls)
 *  - Visual process movements (arrivals, CPU dispatches, demotions, aging promotions, completions)
 *  - Real-time synchronized Gantt chart
 *  - Performance metrics table
 *  - Event log coloring & syncing
 *  - Toast notifications
 */

"use strict";

/* ══════════════════════════════════════════════════════════════════
   GLOBALS & STATE
══════════════════════════════════════════════════════════════════ */
let processRows     = [];   // { id, pid, arrival, burst }
let rowCounter      = 0;
let lastResults     = null;

// Playback state
let timeline        = [];   // snapshots from C backend
let currentStep     = 0;
let isPlaying       = false;
let playTimer       = null;
let playSpeedMs     = 700;  // 1x default

/* Process color palette (assigned per PID) */
const PROCESS_COLORS = [
  "#6366f1", "#a855f7", "#ec4899", "#3b82f6", "#14b8a6",
  "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4",
  "#f97316", "#84cc16", "#e879f9", "#fb7185", "#34d399",
];
let colorMap = {};

function getColor(pid) {
  if (!colorMap[pid]) {
    const idx = Object.keys(colorMap).length % PROCESS_COLORS.length;
    colorMap[pid] = PROCESS_COLORS[idx];
  }
  return colorMap[pid];
}

/* ══════════════════════════════════════════════════════════════════
   TAB NAVIGATION
══════════════════════════════════════════════════════════════════ */
function switchTab(tabName) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.remove("active"));

  const tabEl  = document.getElementById(`tab-${tabName}`);
  const navBtn = document.getElementById(`nav-${tabName}`);
  if (tabEl)  tabEl.classList.add("active");
  if (navBtn) navBtn.classList.add("active");

  if (tabName === "results" && lastResults) {
    // Redraw Gantt chart when switching to results tab
    setTimeout(() => {
      renderGanttChart(lastResults.gantt || []);
    }, 50);
  }
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ══════════════════════════════════════════════════════════════════
   PROCESS TABLE CRUD
══════════════════════════════════════════════════════════════════ */
function renderTable() {
  const tbody = document.getElementById("process-tbody");
  tbody.innerHTML = "";

  processRows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.id = `row-${row.id}`;
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><input type="text"   id="pid-${row.id}"     value="${row.pid}"     maxlength="15" placeholder="P${idx+1}"  oninput="updateRow(${row.id}, 'pid', this.value)" /></td>
      <td><input type="number" id="at-${row.id}"      value="${row.arrival}" min="0" max="9999"  placeholder="0"     oninput="updateRow(${row.id}, 'arrival', this.value)" /></td>
      <td><input type="number" id="bt-${row.id}"      value="${row.burst}"   min="1" max="10000" placeholder="1"     oninput="updateRow(${row.id}, 'burst', this.value)" /></td>
      <td><button class="btn-del-row" onclick="deleteRow(${row.id})" title="Delete">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function addProcessRow(pid = "", arrival = 0, burst = 1) {
  rowCounter++;
  processRows.push({ id: rowCounter, pid, arrival, burst });
  renderTable();
}

function updateRow(id, field, value) {
  const row = processRows.find(r => r.id === id);
  if (row) row[field] = value;
}

function deleteRow(id) {
  processRows = processRows.filter(r => r.id !== id);
  renderTable();
}

function clearProcesses() {
  pausePlayback();
  processRows = [];
  renderTable();
  showToast("Processes cleared", "");
}

/* ══════════════════════════════════════════════════════════════════
   SAMPLE DATA
══════════════════════════════════════════════════════════════════ */
const SAMPLE_DATA = {
  1: {
    processes: [
      { pid: "P1", arrival: 0, burst: 10 },
      { pid: "P2", arrival: 1, burst: 5  },
      { pid: "P3", arrival: 2, burst: 3  },
      { pid: "P4", arrival: 3, burst: 7  },
    ],
    q0: 4, q1: 8, aging: 10,
  },
  2: {
    processes: [
      { pid: "P1", arrival: 0, burst: 30 },
      { pid: "P2", arrival: 0, burst: 30 },
      { pid: "P3", arrival: 0, burst: 2  },
    ],
    q0: 4, q1: 8, aging: 10,
  },
};

function loadSampleData(n) {
  pausePlayback();
  const sample = SAMPLE_DATA[n];
  if (!sample) return;

  processRows = [];
  rowCounter  = 0;
  colorMap    = {};

  sample.processes.forEach(p => {
    rowCounter++;
    processRows.push({ id: rowCounter, pid: p.pid, arrival: p.arrival, burst: p.burst });
  });

  document.getElementById("q0-quantum").value        = sample.q0;
  document.getElementById("q1-quantum").value        = sample.q1;
  document.getElementById("aging-threshold").value   = sample.aging;

  renderTable();
  updateConfigSummary();
  showToast(`Loaded Sample ${n}`, "success");
  switchTab("simulate");
}

/* ══════════════════════════════════════════════════════════════════
   CONFIG SUMMARY
══════════════════════════════════════════════════════════════════ */
function updateConfigSummary() {
  const q0  = document.getElementById("q0-quantum").value        || 4;
  const q1  = document.getElementById("q1-quantum").value        || 8;
  const ag  = document.getElementById("aging-threshold").value   || 10;

  document.getElementById("summary-q0").textContent      = q0 + " ms";
  document.getElementById("summary-q1").textContent      = q1 + " ms";
  document.getElementById("summary-aging").textContent   = ag + " ms";
  document.getElementById("vis-q0-quantum").textContent  = q0;
  document.getElementById("vis-q1-quantum").textContent  = q1;
  document.getElementById("vis-q1-aging").textContent    = ag;
  document.getElementById("vis-q2-aging").textContent    = ag;
}

["q0-quantum","q1-quantum","aging-threshold"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", updateConfigSummary);
});

/* ══════════════════════════════════════════════════════════════════
   INPUT VALIDATION
══════════════════════════════════════════════════════════════════ */
function validateInputs() {
  if (processRows.length === 0) return "Please add at least one process.";

  const pids = new Set();
  for (const row of processRows) {
    const pid = String(row.pid || "").trim();
    if (!pid) return `Row has an empty PID.`;
    if (!/^[a-zA-Z0-9_-]{1,15}$/.test(pid)) return `PID "${pid}" is invalid. Use letters, digits, _ or - (max 15 chars).`;
    if (pids.has(pid)) return `Duplicate PID: "${pid}"`;
    pids.add(pid);

    const at = Number(row.arrival);
    const bt = Number(row.burst);
    if (!Number.isInteger(at) || at < 0) return `Process "${pid}": Arrival time must be a non-negative integer.`;
    if (!Number.isInteger(bt) || bt <= 0) return `Process "${pid}": Burst time must be a positive integer.`;
  }

  const q0 = Number(document.getElementById("q0-quantum").value);
  const q1 = Number(document.getElementById("q1-quantum").value);
  const ag = Number(document.getElementById("aging-threshold").value);

  if (!Number.isInteger(q0) || q0 <= 0) return "Q0 quantum must be a positive integer.";
  if (!Number.isInteger(q1) || q1 <= 0) return "Q1 quantum must be a positive integer.";
  if (!Number.isInteger(ag) || ag <= 0) return "Aging threshold must be a positive integer.";

  return null;
}

/* ══════════════════════════════════════════════════════════════════
   RUN SIMULATION
══════════════════════════════════════════════════════════════════ */
async function runSimulation() {
  pausePlayback();
  const errorBox = document.getElementById("error-box");
  errorBox.classList.add("hidden");

  const validationError = validateInputs();
  if (validationError) {
    errorBox.textContent = validationError;
    errorBox.classList.remove("hidden");
    return;
  }

  colorMap = {};

  const btn = document.getElementById("btn-run");
  btn.disabled = true;
  btn.textContent = "Running…";
  setStatus("running", "● Simulating");

  const processes = processRows.map(r => ({
    pid:          String(r.pid).trim(),
    arrival_time: parseInt(r.arrival, 10),
    burst_time:   parseInt(r.burst,  10),
  }));

  const config = {
    q0_quantum:      parseInt(document.getElementById("q0-quantum").value,       10),
    q1_quantum:      parseInt(document.getElementById("q1-quantum").value,       10),
    aging_threshold: parseInt(document.getElementById("aging-threshold").value,  10),
  };

  try {
    const resp = await fetch("/api/schedule", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ processes, config }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `Server error ${resp.status}`);
    }

    lastResults = data;
    timeline    = data.timeline || [];

    // Setup scrubber
    const scrubber = document.getElementById("timeline-scrubber");
    scrubber.disabled = false;
    scrubber.min   = 0;
    scrubber.max   = Math.max(0, timeline.length - 1);
    scrubber.value = 0;

    // Render results in results tab
    renderStaticResults(data);

    // Start animated visual playback on Simulate tab
    currentStep = 0;
    renderSnapshot(0);
    startPlayback();

    setStatus("done", "● Visual Playback");
    showToast("Simulation running with animated queues!", "success");

  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
    setStatus("error", "● Error");
    showToast("Simulation failed", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg> Run Simulation`;
  }
}

function resetSimulation() {
  pausePlayback();
  lastResults = null;
  timeline    = [];
  currentStep = 0;
  colorMap    = {};

  document.getElementById("error-box").classList.add("hidden");
  document.getElementById("no-results-msg").classList.remove("hidden");
  document.getElementById("results-content").classList.add("hidden");
  document.getElementById("event-log").innerHTML = '<span class="log-empty">Run a simulation to see events…</span>';

  // Reset scrubber & badges
  const scrubber = document.getElementById("timeline-scrubber");
  scrubber.disabled = true;
  scrubber.value    = 0;
  document.getElementById("step-badge").textContent = "Idle";
  document.getElementById("scrub-time-label").textContent = "t = 0 ms";
  document.getElementById("scrub-step-label").textContent = "Step 0 / 0";

  // Reset action banner
  updateActionBanner("idle", "Ready", "Click 'Run Simulation' to watch processes enter and move between queues", "ℹ");

  // Reset visual queues
  setRunningProcess(null);
  renderQueueLane(0, []);
  renderQueueLane(1, []);
  renderQueueLane(2, []);
  renderCompletedLane([]);

  setStatus("idle", "● Idle");
  showToast("Simulation reset", "");
}

/* ══════════════════════════════════════════════════════════════════
   PLAYBACK ENGINE & ANIMATION
══════════════════════════════════════════════════════════════════ */
function togglePlay() {
  if (isPlaying) {
    pausePlayback();
  } else {
    if (!timeline.length) return;
    if (currentStep >= timeline.length - 1) {
      currentStep = 0;
    }
    startPlayback();
  }
}

function startPlayback() {
  if (!timeline.length) return;
  isPlaying = true;
  const playBtn = document.getElementById("btn-ctrl-play");
  if (playBtn) playBtn.innerHTML = "⏸ Pause";

  if (playTimer) clearInterval(playTimer);
  playTimer = setInterval(() => {
    if (currentStep < timeline.length - 1) {
      currentStep++;
      renderSnapshot(currentStep);
    } else {
      pausePlayback();
      showToast("Simulation animation complete!", "success");
    }
  }, playSpeedMs);
}

function pausePlayback() {
  isPlaying = false;
  const playBtn = document.getElementById("btn-ctrl-play");
  if (playBtn) playBtn.innerHTML = "▶ Play";
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

function stepTimeline(delta) {
  pausePlayback();
  if (!timeline.length) return;
  const next = currentStep + delta;
  if (next >= 0 && next < timeline.length) {
    currentStep = next;
    renderSnapshot(currentStep);
  }
}

function jumpToStep(step) {
  pausePlayback();
  if (!timeline.length) return;
  currentStep = Math.max(0, Math.min(timeline.length - 1, step));
  renderSnapshot(currentStep);
}

function onScrub(val) {
  jumpToStep(parseInt(val, 10));
}

function skipToEnd() {
  pausePlayback();
  if (!timeline.length) return;
  currentStep = timeline.length - 1;
  renderSnapshot(currentStep);
  switchTab("results");
  showToast("Showing final scheduling results", "success");
}

function setSpeed(ms, btn) {
  playSpeedMs = ms;
  document.querySelectorAll(".speed-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  if (isPlaying) {
    pausePlayback();
    startPlayback();
  }
}

/* ══════════════════════════════════════════════════════════════════
   RENDER SNAPSHOT AT CURRENT STEP
══════════════════════════════════════════════════════════════════ */
function renderSnapshot(index) {
  if (!timeline || index < 0 || index >= timeline.length) return;
  const snap = timeline[index];

  // 1. Update Scrubber & Step Labels
  const scrubber = document.getElementById("timeline-scrubber");
  scrubber.value = index;
  document.getElementById("step-badge").textContent = `t = ${snap.time} ms · Step ${index + 1}/${timeline.length}`;
  document.getElementById("scrub-time-label").textContent = `t = ${snap.time} ms`;
  document.getElementById("scrub-step-label").textContent = `Step ${index + 1} / ${timeline.length}`;

  // 2. Action Banner
  updateActionBannerBySnapshot(snap);

  // 3. CPU Core Slot
  if (snap.cpu && snap.cpu.pid !== "IDLE") {
    setRunningProcess({
      pid:       snap.cpu.pid,
      rem:       snap.cpu.remaining,
      queue:     snap.cpu.queue,
      isAction:  (snap.action === "RUN" && snap.pid === snap.cpu.pid),
    });
  } else {
    setRunningProcess(null);
  }

  // 4. Queues 0, 1, 2
  const agingThresh = parseInt(document.getElementById("aging-threshold").value, 10) || 10;
  renderQueueLane(0, snap.q0 || [], snap.pid, snap.action);
  renderQueueLane(1, snap.q1 || [], snap.pid, snap.action, agingThresh);
  renderQueueLane(2, snap.q2 || [], snap.pid, snap.action, agingThresh);

  // 5. Completed Lane
  renderCompletedLane(snap.completed || []);

  // 6. Sync Event Log selection
  highlightActiveLog(snap.time, snap.action, snap.pid);

  // 7. Sync Gantt Chart Timeline Needle
  if (lastResults && lastResults.gantt) {
    renderGanttChart(lastResults.gantt, snap.time);
  }
}

/* ── Action Banner Renderer ─────────────────────────────────────── */
function updateActionBanner(type, title, desc, icon) {
  const banner = document.getElementById("action-banner");
  banner.className = `action-banner banner-${type}`;
  document.getElementById("banner-icon").textContent  = icon;
  document.getElementById("banner-title").textContent = title;
  document.getElementById("banner-desc").textContent  = desc;
}

function updateActionBannerBySnapshot(snap) {
  switch (snap.action) {
    case "ARRIVE":
      updateActionBanner("arrive", `📥 Arrival: ${snap.pid}`, snap.desc || `${snap.pid} arrived into Queue 0`, "📥");
      break;
    case "RUN":
      updateActionBanner("run", `⚡ Dispatch: ${snap.pid} executing`, snap.desc || `${snap.pid} dispatched to CPU`, "⚡");
      break;
    case "DEMOTE":
      updateActionBanner("demote", `⬇️ Demotion: ${snap.pid} moved Q${snap.from_q} → Q${snap.to_q}`, snap.desc || `${snap.pid} quantum expired`, "⬇️");
      break;
    case "AGING":
      updateActionBanner("aging", `⬆️ Aging Promotion: ${snap.pid} promoted Q${snap.from_q} → Q${snap.to_q}`, snap.desc || `${snap.pid} reached aging threshold`, "⭐");
      break;
    case "PREEMPT":
      updateActionBanner("preempt", `⚠️ Preemption: ${snap.pid} yielded CPU`, snap.desc || `${snap.pid} preempted by higher priority process`, "⚠️");
      break;
    case "DONE":
      updateActionBanner("done", `✅ Completed: ${snap.pid}`, snap.desc || `${snap.pid} finished execution`, "✅");
      break;
    default:
      updateActionBanner("idle", `Clock: t = ${snap.time} ms`, snap.desc || "Simulation step", "⏱");
      break;
  }
}

/* ── Running CPU Core ───────────────────────────────────────────── */
function setRunningProcess(proc) {
  const slot = document.getElementById("running-process");
  if (!proc) {
    slot.className = "running-proc-slot empty";
    slot.style.borderColor = "";
    slot.style.background  = "";
    slot.innerHTML = `<span>CPU Idle</span>`;
  } else {
    slot.className = `running-proc-slot has-process running-active`;
    const color = getColor(proc.pid);
    slot.style.borderColor = color;
    slot.style.background  = color + "18";

    slot.innerHTML = `
      <div class="cpu-active-details">
        <div class="cpu-proc-badge" style="color:${color}">
          <span>${proc.pid}</span>
          <span style="font-size:0.68rem;padding:0.1rem 0.4rem;border-radius:4px;background:${color}25;border:1px solid ${color}40">
            Q${proc.queue}
          </span>
        </div>
        <div class="cpu-stat-item">
          <span class="cpu-stat-label">Remaining</span>
          <span class="cpu-stat-val">${proc.rem} ms</span>
        </div>
        <div class="cpu-stat-item" style="margin-left:auto">
          <span class="cpu-stat-label">Status</span>
          <span class="cpu-stat-val" style="color:${color};animation:pulseText 1s infinite">EXECUTING</span>
        </div>
      </div>
    `;
  }
}

/* ── Queue Lanes ────────────────────────────────────────────────── */
function renderQueueLane(qLevel, procs, actionPid, actionType, agingThresh = 0) {
  const el = document.getElementById(`vis-q${qLevel}-procs`);
  if (!el) return;

  if (!procs.length) {
    el.innerHTML = '<span class="empty-lane">Empty</span>';
    return;
  }

  el.innerHTML = procs.map(p => {
    const color    = getColor(p.pid);
    const isTarget = (p.pid === actionPid);
    let extraHighlight = isTarget ? " action-highlight" : "";

    // Aging progress bar for Q1 and Q2
    let agingHtml = "";
    if (agingThresh > 0 && typeof p.wait === "number") {
      const pct = Math.min(100, Math.round((p.wait / agingThresh) * 100));
      agingHtml = `
        <div class="aging-bar-wrapper" title="Waited ${p.wait}/${agingThresh}ms before promotion">
          <div class="aging-bar-bg">
            <div class="aging-bar-fill" style="width:${pct}%;background:${pct >= 80 ? '#ec4899' : '#a855f7'}"></div>
          </div>
          <span class="aging-bar-text">Aging: ${p.wait}/${agingThresh}ms</span>
        </div>
      `;
    }

    return `
      <div class="proc-chip${extraHighlight}" style="border-color:${color}45;background:${color}15">
        <div class="proc-chip-top">
          <span class="proc-chip-pid" style="color:${color}">${p.pid}</span>
          <span class="proc-chip-rem">rem: ${p.remaining}ms</span>
        </div>
        ${agingHtml}
      </div>
    `;
  }).join("");
}

/* ── Completed Lane ─────────────────────────────────────────────── */
function renderCompletedLane(completedProcs) {
  const el = document.getElementById("vis-completed-procs");
  if (!el) return;

  if (!completedProcs.length) {
    el.innerHTML = '<span class="empty-lane">No completed processes yet</span>';
    return;
  }

  el.innerHTML = completedProcs.map(p => {
    const color = getColor(p.pid);
    return `
      <div class="proc-chip chip-done" style="border-color:${color}50">
        <div class="proc-chip-top">
          <span class="proc-chip-pid" style="color:${color}">✔ ${p.pid}</span>
          <span class="chip-done-stats">CT: ${p.ct}ms</span>
        </div>
        <div style="font-size:0.62rem;color:var(--text-secondary)">TAT: ${p.tat}ms · WT: ${p.wt}ms</div>
      </div>
    `;
  }).join("");
}

/* ── Highlight Log Line (Internal container scroll only, page remains completely still) ── */
function highlightActiveLog(time, action, pid) {
  const logContainer = document.getElementById("event-log");
  const entries = document.querySelectorAll("#event-log .log-entry");
  entries.forEach(e => {
    e.style.background = "";
    e.style.fontWeight = "";
    if (e.textContent.startsWith(`t=${time}`) && e.textContent.includes(pid)) {
      e.style.background = "rgba(99,102,241,0.22)";
      e.style.fontWeight = "bold";
      if (logContainer) {
        logContainer.scrollTop = e.offsetTop - logContainer.offsetTop;
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
   STATIC RESULTS RENDERING (Gantt, Tables, Metrics)
══════════════════════════════════════════════════════════════════ */
function renderStaticResults(data) {
  document.getElementById("no-results-msg").classList.add("hidden");
  document.getElementById("results-content").classList.remove("hidden");

  renderEventLog(data.log || []);
  renderGanttChart(data.gantt || []);
  renderSummaryStats(data.summary || {}, data.processes || []);
  renderMetricsTable(data.processes || []);
  renderTransitionLog(data.log || []);
}

/* ── Event Log ──────────────────────────────────────────────────── */
function renderEventLog(logs) {
  const el = document.getElementById("event-log");
  el.innerHTML = "";

  logs.forEach(msg => {
    const div = document.createElement("div");
    div.className = "log-entry " + classifyLog(msg);
    div.textContent = msg;
    el.appendChild(div);
  });
}

function classifyLog(msg) {
  if (msg.includes("[ARRIVE]")) return "log-arrive";
  if (msg.includes("[RUN]"))    return "log-run";
  if (msg.includes("[DONE]"))   return "log-done";
  if (msg.includes("[DEMOTE]")) return "log-demote";
  if (msg.includes("[PREEMPT]"))return "log-preempt";
  if (msg.includes("[AGING]"))  return "log-aging";
  return "log-idle";
}

function clearLog() {
  document.getElementById("event-log").innerHTML = '<span class="log-empty">Log cleared.</span>';
}

/* ── Gantt Chart with Dynamic Playback Needle ───────────────────── */
function renderGanttChart(blocks, activeTime = null) {
  if (!blocks.length) return;

  const canvas    = document.getElementById("gantt-canvas");
  const ctx       = canvas.getContext("2d");
  const container = canvas.parentElement;

  const visible   = blocks.filter(b => b.duration > 0);
  const totalTime = visible.reduce((acc, b) => Math.max(acc, b.time + b.duration), 0);
  const PX_PER_MS = Math.max(28, Math.min(60, Math.floor(container.clientWidth / (totalTime || 1))));
  const ROW_H     = 60;
  const LABEL_H   = 24;
  const PAD       = 8;

  canvas.width  = Math.max(600, totalTime * PX_PER_MS + PAD * 2);
  canvas.height = ROW_H + LABEL_H + PAD;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isLight   = document.documentElement.getAttribute("data-theme") === "light";
  const laneColors = ["rgba(99,102,241,0.06)", "rgba(168,85,247,0.05)", "rgba(100,116,139,0.04)"];

  visible.forEach(block => {
    const x  = PAD + block.time * PX_PER_MS;
    const w  = Math.max(2, block.duration * PX_PER_MS - 1);
    const y  = PAD;
    const h  = ROW_H - 4;

    if (block.pid === "IDLE") {
      ctx.fillStyle = isLight ? "rgba(226,232,240,0.9)" : "rgba(30,41,59,0.8)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = isLight ? "#cbd5e1" : "#1e293b";
      ctx.lineWidth   = 1;
      ctx.strokeRect(x, y, w, h);

      if (w > 24) {
        ctx.fillStyle = isLight ? "#64748b" : "#475569";
        ctx.font      = "11px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText("IDLE", x + w / 2, y + h / 2 + 4);
      }
    } else {
      const color = getColor(block.pid);
      const grad  = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, color + "ee");
      grad.addColorStop(1, color + "88");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);

      if (block.queue_level >= 0 && block.queue_level <= 2) {
        ctx.fillStyle = laneColors[block.queue_level];
        ctx.fillRect(x, y + h * 0.75, w, h * 0.25);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(x, y, w, h);

      if (w > 20) {
        ctx.fillStyle = "#fff";
        ctx.font      = `bold ${Math.min(13, w / 2)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(block.pid, x + w / 2, y + h / 2 - 2);
      }

      if (w > 32 && block.queue_level >= 0) {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.font      = "9px JetBrains Mono, monospace";
        ctx.fillText(`Q${block.queue_level}`, x + w / 2, y + h / 2 + 12);
      }
    }
  });

  // Draw Dynamic Playback Needle if active
  if (activeTime !== null && activeTime >= 0) {
    const needleX = PAD + activeTime * PX_PER_MS;
    ctx.beginPath();
    ctx.strokeStyle = "#ec4899";
    ctx.lineWidth   = 2.5;
    ctx.moveTo(needleX, PAD - 4);
    ctx.lineTo(needleX, PAD + ROW_H + 8);
    ctx.stroke();

    // Triangle cursor cap
    ctx.fillStyle = "#ec4899";
    ctx.beginPath();
    ctx.moveTo(needleX - 5, PAD - 6);
    ctx.lineTo(needleX + 5, PAD - 6);
    ctx.lineTo(needleX, PAD);
    ctx.fill();
  }

  renderGanttTimeline(visible, totalTime, PX_PER_MS, PAD);
  renderGanttLegend(visible);
}

function renderGanttTimeline(blocks, totalTime, pxMs, pad) {
  const container = document.getElementById("gantt-timeline");
  container.innerHTML = "";
  container.style.position = "relative";
  container.style.width    = (Math.max(600, totalTime * pxMs + pad * 2)) + "px";

  const times = new Set([0]);
  blocks.forEach(b => { times.add(b.time); times.add(b.time + b.duration); });

  times.forEach(t => {
    const span = document.createElement("span");
    span.style.position  = "absolute";
    span.style.left      = (pad + t * pxMs) + "px";
    span.style.transform = "translateX(-50%)";
    span.textContent     = t;
    container.appendChild(span);
  });
  container.style.height = "20px";
}

function renderGanttLegend(blocks) {
  const legendEl = document.getElementById("gantt-legend");
  legendEl.innerHTML = "";

  const seen = new Set();
  blocks.forEach(b => {
    if (b.pid === "IDLE" || seen.has(b.pid)) return;
    seen.add(b.pid);

    const item = document.createElement("div");
    item.className = "gantt-legend-item";
    item.innerHTML = `
      <div class="gantt-legend-dot" style="background:${getColor(b.pid)}"></div>
      <span>${b.pid}</span>
    `;
    legendEl.appendChild(item);
  });

  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const idleItem = document.createElement("div");
  idleItem.className = "gantt-legend-item";
  idleItem.innerHTML = `<div class="gantt-legend-dot" style="background:${isLight ? "#e2e8f0" : "#1e293b"};border:1px solid ${isLight ? "#cbd5e1" : "#334155"}"></div><span>Idle</span>`;
  legendEl.appendChild(idleItem);
}

/* ── Summary Stats ──────────────────────────────────────────────── */
function renderSummaryStats(summary, processes) {
  const grid = document.getElementById("stats-grid");
  grid.innerHTML = "";

  const stats = [
    { label: "Avg Turnaround Time", value: summary.avg_turnaround_time?.toFixed(2) ?? "—", unit: "ms", color: "#6366f1" },
    { label: "Avg Waiting Time",    value: summary.avg_waiting_time?.toFixed(2)    ?? "—", unit: "ms", color: "#8b5cf6" },
    { label: "Avg Response Time",   value: summary.avg_response_time?.toFixed(2)   ?? "—", unit: "ms", color: "#a855f7" },
    { label: "CPU Utilization",     value: summary.cpu_utilization?.toFixed(1)     ?? "—", unit: "%",  color: "#3b82f6" },
    { label: "Throughput",          value: summary.throughput?.toFixed(4)          ?? "—", unit: "proc/ms", color: "#14b8a6" },
    { label: "Total Sim Time",      value: summary.total_time                      ?? "—", unit: "ms", color: "#ec4899" },
    { label: "CPU Busy Time",       value: summary.total_busy                      ?? "—", unit: "ms", color: "#f59e0b" },
    { label: "Processes",           value: processes.length,                                unit: "",   color: "#10b981" },
  ];

  stats.forEach(s => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <span class="stat-label">${s.label}</span>
      <span class="stat-value" style="color:${s.color}">${s.value}</span>
      <span class="stat-unit">${s.unit}</span>
    `;
    grid.appendChild(card);
  });
}

/* ── Metrics Table ──────────────────────────────────────────────── */
function renderMetricsTable(processes) {
  const tbody = document.getElementById("metrics-tbody");
  tbody.innerHTML = "";

  processes.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="color:${getColor(p.pid)};font-weight:700">${p.pid}</td>
      <td>${p.arrival_time}</td>
      <td>${p.burst_time}</td>
      <td>${p.completion_time ?? "—"}</td>
      <td>${p.turnaround_time ?? "—"}</td>
      <td>${p.waiting_time ?? "—"}</td>
      <td>${p.response_time ?? "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ── Transition Log ─────────────────────────────────────────────── */
function renderTransitionLog(logs) {
  const el = document.getElementById("transition-log");
  el.innerHTML = "";

  const transitions = logs.filter(l =>
    l.includes("[DEMOTE]") || l.includes("[AGING]") || l.includes("[PREEMPT]") || l.includes("[ARRIVE]")
  );

  if (!transitions.length) {
    el.innerHTML = '<span class="log-empty">No transitions recorded.</span>';
    return;
  }

  transitions.forEach(msg => {
    const div = document.createElement("div");
    div.className = "log-entry " + classifyLog(msg);
    div.textContent = msg;
    el.appendChild(div);
  });
}

/* ══════════════════════════════════════════════════════════════════
   STATUS PILL & TOAST
══════════════════════════════════════════════════════════════════ */
function setStatus(type, text) {
  const pill = document.getElementById("status-pill");
  pill.className   = `status-pill status-${type}`;
  pill.textContent = text;
}

let toastTimer = null;
function showToast(msg, type = "") {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.className   = `toast${type ? " " + type : ""}`;
  toast.classList.remove("hidden");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

/* ══════════════════════════════════════════════════════════════════
   THEME MANAGEMENT (Light / Dark)
══════════════════════════════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("mlfq-theme", theme);

  const icon  = document.getElementById("theme-icon");
  const label = document.getElementById("theme-label");
  if (icon && label) {
    if (theme === "light") {
      icon.textContent  = "🌙";
      label.textContent = "Dark";
    } else {
      icon.textContent  = "☀️";
      label.textContent = "Light";
    }
  }

  // Redraw Gantt chart so canvas matches theme
  if (lastResults && lastResults.gantt) {
    const activeT = (timeline && timeline[currentStep]) ? timeline[currentStep].time : null;
    renderGanttChart(lastResults.gantt, activeT);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next    = (current === "dark") ? "light" : "dark";
  applyTheme(next);
}

/* ══════════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = localStorage.getItem("mlfq-theme") || "dark";
  applyTheme(savedTheme);

  addProcessRow("P1", 0, 10);
  addProcessRow("P2", 1, 5);
  addProcessRow("P3", 2, 3);
  addProcessRow("P4", 3, 7);

  updateConfigSummary();
  switchTab("dashboard");

  fetch("/api/health")
    .then(r => r.json())
    .then(d => {
      if (!d.gcc_available) {
        showToast("⚠ GCC not found — install MinGW-w64", "error");
      }
    })
    .catch(() => {});
});
