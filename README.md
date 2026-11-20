# MLFQ CPU Scheduling Simulator

> **Implementation and Performance Analysis of Multilevel Feedback Queue (MLFQ) CPU Scheduling Algorithm**
>
> Operating Systems · College Project

---

## Project Overview

This project implements a fully functional **Multilevel Feedback Queue (MLFQ)** CPU scheduling simulator. The core algorithm is written in **C** and compiled with GCC. A **Python Flask** web server bridges the C engine and a modern browser-based dashboard built with **HTML, CSS, and JavaScript**.

The simulator handles process arrivals, time-quantum-based demotion, preemption by higher-priority queues, and an **aging mechanism** to prevent starvation. Results are presented as a **Gantt chart**, a **per-process metrics table**, and an **event log**.

---

## Problem Statement

Standard CPU scheduling algorithms (FCFS, SJF, Round Robin) each have significant drawbacks:
- FCFS causes long waiting times for short jobs behind long ones.
- SJF requires burst-time prediction and can starve long jobs.
- Round Robin treats all processes equally regardless of their CPU-burst behavior.

**MLFQ** solves this by dynamically adapting priorities based on observed behavior — CPU-intensive jobs sink to lower queues while short-burst or I/O-bound jobs stay at the top.

---

## Objectives

1. Implement the MLFQ algorithm correctly in C.
2. Provide configurable queue parameters (time quanta, aging threshold).
3. Visualize scheduling via a Gantt chart.
4. Calculate and display key scheduling metrics.
5. Demonstrate the aging mechanism to prevent starvation.

---

## Technologies Used

| Component | Technology |
|-----------|-----------|
| Scheduling Engine | C (GCC) |
| Web Backend | Python Flask |
| Frontend | HTML5, Vanilla CSS, Vanilla JavaScript |
| Visualization | HTML5 Canvas (Gantt chart) |

---

## Project Structure

```
MLFQ_Scheduler/
├── scheduler.c          ← Core MLFQ algorithm
├── scheduler.exe        ← Compiled binary (auto-generated)
├── app.py               ← Flask backend
├── requirements.txt     ← Python dependencies
├── README.md
├── templates/
│   └── index.html       ← Dashboard UI
├── static/
│   ├── style.css        ← Dark-theme styles
│   └── script.js        ← Frontend logic + Gantt chart
├── screenshots/         ← UI screenshots
├── report/
│   └── report_outline.md
└── presentation/
    └── presentation_outline.md
```

---

## Installation Instructions

### Prerequisites

| Software | Purpose | Download |
|----------|---------|---------|
| Python 3.8+ | Running Flask backend | https://python.org |
| GCC (MinGW-w64) | Compiling `scheduler.c` | https://winlibs.com/ |
| pip | Installing Python packages | Included with Python |

### Step 1 — Install Python dependencies

```powershell
cd MLFQ_Scheduler
pip install -r requirements.txt
```

### Step 2 — Ensure GCC is on PATH

```powershell
gcc --version
# Should output: gcc (MinGW-w64 ...) 13.x.x
```

If GCC is not found, install MinGW-w64 and add `C:\mingw64\bin` to your system PATH.

---

## Compilation Instructions

The Flask server auto-compiles `scheduler.c` on startup. To compile manually:

```powershell
gcc scheduler.c -o scheduler.exe -O2 -Wall
```

---

## Execution Instructions

```powershell
cd MLFQ_Scheduler
python app.py
```

Then open your browser at: **http://127.0.0.1:5000**

---

## Scheduling Algorithm Explanation

### Queue Structure

| Queue | Algorithm | Time Quantum | Priority |
|-------|-----------|-------------|----------|
| Q0 | Round Robin | 4 ms (configurable) | Highest |
| Q1 | Round Robin | 8 ms (configurable) | Medium |
| Q2 | FCFS | Unlimited | Lowest |

### Rules

1. Every new process enters **Q0**.
2. Higher-priority queues always execute before lower-priority queues.
3. If a process exhausts its quantum, it is **demoted** to the next lower queue.
4. Processes that complete before the quantum are simply removed.
5. A lower-priority process is immediately **preempted** when a higher-priority process becomes ready.
6. Q2 uses FCFS — no quantum limit unless preempted by a higher queue.
7. Remaining burst time is fully preserved across preemptions and demotions.

### Aging Mechanism

Each millisecond a process spends **waiting** in Q1 or Q2, its `wait_in_queue` counter increments.
When this counter reaches the **aging threshold** (default: 10 ms), the process is promoted one level up and the counter resets to 0.

If a promotion places a process in a higher-priority queue than the currently running process, an **immediate preemption** occurs.

This prevents indefinite starvation of long-running low-priority processes.

---

## Performance Metrics

| Metric | Formula |
|--------|---------|
| Completion Time (CT) | Time when process finishes |
| Turnaround Time (TAT) | CT − Arrival Time |
| Waiting Time (WT) | TAT − Burst Time |
| Response Time (RT) | First CPU Start − Arrival Time |
| CPU Utilization | (Busy Time / Total Time) × 100 |
| Throughput | Finished Processes / Total Time |

---

## Test Cases

### Test Case 1 — Basic MLFQ

| Process | Arrival Time | Burst Time |
|---------|-------------|-----------|
| P1 | 0 | 10 |
| P2 | 1 | 5  |
| P3 | 2 | 3  |
| P4 | 3 | 7  |

Config: Q0=4ms, Q1=8ms, Q2=FCFS, Aging=10ms

### Test Case 2 — Aging Demonstration

| Process | Arrival Time | Burst Time |
|---------|-------------|-----------|
| P1 | 0 | 30 |
| P2 | 0 | 30 |
| P3 | 0 | 2  |

Config: Q0=4ms, Q1=8ms, Q2=FCFS, Aging=10ms

P3 finishes quickly in Q0. P1 and P2 cycle through Q0→Q1→Q2. The aging mechanism ensures they are periodically promoted back, preventing indefinite starvation.

---

## Limitations

1. The simulation is discrete (tick-by-tick), which is accurate but may be slow for very large burst times.
2. I/O wait time is not modeled — the simulator treats all processes as CPU-bound.
3. The GCC binary must be compiled for the target OS (auto-compiled on Windows).
4. Maximum 64 processes per simulation.

---

## Author

College OS Project — MLFQ CPU Scheduling Simulator
