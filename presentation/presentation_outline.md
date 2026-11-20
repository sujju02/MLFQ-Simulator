# Presentation Outline
## MLFQ CPU Scheduling Simulator

---

## Slide 1 — Title
- **Title**: Implementation and Performance Analysis of MLFQ CPU Scheduling
- Student Name(s)
- Subject: Operating Systems
- Date

---

## Slide 2 — Agenda
1. Problem Statement
2. What is MLFQ?
3. Algorithm Design
4. System Architecture
5. Live Demo
6. Test Cases & Results
7. Conclusion

---

## Slide 3 — Problem Statement
- CPU scheduling is crucial for OS performance
- Existing algorithms have trade-offs:
  - FCFS: convoy effect
  - SJF: requires burst prediction, starvation
  - RR: treats all processes equally
- **Goal**: Adapt priorities dynamically based on behavior

---

## Slide 4 — What is MLFQ?
- Three queues: Q0 (high), Q1 (medium), Q2 (low)
- Q0 and Q1: Round Robin | Q2: FCFS
- New processes start at Q0
- CPU-intensive → demoted; I/O-bound → stays high
- **Aging** prevents starvation

---

## Slide 5 — MLFQ Rules (Visual)
Diagram showing:
- Process entering Q0
- Quantum expiry → demotion
- Arrival preemption
- Aging promotion

---

## Slide 6 — System Architecture
```
Browser ←HTTP→ Flask (app.py) ←subprocess→ scheduler.c (GCC binary)
```
- C engine: pure algorithm, outputs JSON
- Flask: validates input, runs binary safely
- JS/HTML: Gantt chart, metrics, event log

---

## Slide 7 — Gantt Chart (Test Case 1)
- Screenshot / live demo
- P1(BT=10), P2(BT=5), P3(BT=3), P4(BT=7)
- Show queue transitions

---

## Slide 8 — Aging Demonstration (Test Case 2)
- P1(BT=30), P2(BT=30), P3(BT=2)
- P3 finishes immediately in Q0
- P1 and P2 cycle through queues
- Aging promotes back when waiting ≥ 10ms

---

## Slide 9 — Performance Metrics
| Metric | TC1 | TC2 |
|--------|-----|-----|
| Avg TAT | (from simulator) | (from simulator) |
| Avg WT | (from simulator) | (from simulator) |
| CPU Utilization | % | % |
| Throughput | proc/ms | proc/ms |

---

## Slide 10 — Key Features
- ✓ Correct MLFQ with preemption
- ✓ Configurable quanta and aging threshold
- ✓ Real-time Gantt chart
- ✓ Full event log with color coding
- ✓ Per-process metrics table
- ✓ Modern dark-theme dashboard

---

## Slide 11 — Conclusion
- MLFQ is a practical scheduling algorithm used in real OSes (Unix, macOS)
- Aging ensures fairness and prevents starvation
- This simulator provides a complete interactive demonstration
- Possible enhancements: I/O bursts, multi-CPU, comparison charts

---

## Slide 12 — Q&A
Thank you! Questions?
