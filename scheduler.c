/*
 * MLFQ CPU Scheduling Simulator
 * ==============================
 * Implements Multilevel Feedback Queue scheduling with:
 *   - Q0: Round Robin, quantum = configurable (default 4 ms)
 *   - Q1: Round Robin, quantum = configurable (default 8 ms)
 *   - Q2: First-Come First-Served (FCFS)
 * Aging: Processes waiting in Q1/Q2 beyond the aging threshold
 *        are promoted to the next-higher queue.
 *
 * Usage:
 *   scheduler <n_processes> <pid1> <at1> <bt1> ... <pid_n> <at_n> <bt_n>
 *             <q0_quantum> <q1_quantum> <aging_threshold>
 *
 * Output: JSON on stdout (including complete timeline snapshots for visual playback)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */
#define MAX_PROCESSES   64
#define MAX_EVENTS      4096
#define MAX_LOG         4096
#define MAX_LOG_MSG     256
#define MAX_TIMELINE    4096
#define INF             999999999

/* ------------------------------------------------------------------ */
/*  Data Structures                                                     */
/* ------------------------------------------------------------------ */
typedef struct {
    char pid[16];
    int  arrival_time;
    int  burst_time;
    int  remaining_time;
    int  queue_level;        /* 0, 1, or 2 */
    int  wait_in_queue;      /* ms waited in current queue (for aging) */
    int  first_start;        /* time of first CPU allocation (-1 = never) */
    int  completion_time;    /* -1 until finished */
    int  done;               /* 1 if completed */
    int  in_queue;           /* 1 if already enqueued */
} Process;

typedef struct {
    int  time;
    char pid[16];
    int  duration;
    int  queue_level;        /* 0,1,2  or -1 for idle */
} GanttBlock;

typedef struct {
    char msg[MAX_LOG_MSG];
} LogEntry;

/* Queue structure (circular buffer of process indices) */
typedef struct {
    int data[MAX_PROCESSES];
    int head, tail, size;
} Queue;

static void q_init(Queue *q) { q->head = q->tail = q->size = 0; }
static int  q_empty(Queue *q) { return q->size == 0; }

static void q_push(Queue *q, int idx) {
    q->data[q->tail] = idx;
    q->tail = (q->tail + 1) % MAX_PROCESSES;
    q->size++;
}

static int q_pop(Queue *q) {
    int v = q->data[q->head];
    q->head = (q->head + 1) % MAX_PROCESSES;
    q->size--;
    return v;
}

/* Timeline snapshot for frontend step-by-step queue animation */
typedef struct {
    int  time;
    char action_type[16];    /* ARRIVE, RUN, DEMOTE, AGING, PREEMPT, DONE, IDLE, TICK */
    char action_pid[16];
    int  from_q;             /* -1 = none / CPU */
    int  to_q;               /* -1 = none / CPU / completed */
    char desc[MAX_LOG_MSG];
    int  running_idx;        /* -1 = idle */
    int  running_rem;
    int  running_qlvl;
    int  q0[MAX_PROCESSES];
    int  q0_count;
    int  q1[MAX_PROCESSES];
    int  q1_count;
    int  q2[MAX_PROCESSES];
    int  q2_count;
    int  completed[MAX_PROCESSES];
    int  comp_count;
} TimelineSnapshot;

/* ------------------------------------------------------------------ */
/*  Globals                                                             */
/* ------------------------------------------------------------------ */
static Process   procs[MAX_PROCESSES];
static int       n_procs;
static int       q0_quantum   = 4;
static int       q1_quantum   = 8;
static int       aging_thresh = 10;

static Queue     queues[3];

static GanttBlock gantt[MAX_EVENTS];
static int       n_gantt = 0;

static LogEntry  log_entries[MAX_LOG];
static int       n_log = 0;

static TimelineSnapshot timeline[MAX_TIMELINE];
static int       n_timeline = 0;

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */
static void add_log(const char *msg) {
    if (n_log < MAX_LOG) {
        strncpy(log_entries[n_log].msg, msg, MAX_LOG_MSG - 1);
        log_entries[n_log].msg[MAX_LOG_MSG - 1] = '\0';
        n_log++;
    }
}

static void add_gantt(int time, const char *pid, int dur, int qlvl) {
    if (n_gantt < MAX_EVENTS) {
        gantt[n_gantt].time        = time;
        strncpy(gantt[n_gantt].pid, pid, 15);
        gantt[n_gantt].pid[15]     = '\0';
        gantt[n_gantt].duration    = dur;
        gantt[n_gantt].queue_level = qlvl;
        n_gantt++;
    }
}

/* Capture current state snapshot for visual animation */
static void capture_snapshot(int time, const char *action_type, const char *action_pid,
                             int from_q, int to_q, const char *desc, int running_idx) {
    if (n_timeline >= MAX_TIMELINE) return;

    TimelineSnapshot *snap = &timeline[n_timeline++];
    snap->time = time;
    strncpy(snap->action_type, action_type, 15);
    snap->action_type[15] = '\0';
    strncpy(snap->action_pid, action_pid ? action_pid : "", 15);
    snap->action_pid[15] = '\0';
    snap->from_q = from_q;
    snap->to_q   = to_q;
    strncpy(snap->desc, desc ? desc : "", MAX_LOG_MSG - 1);
    snap->desc[MAX_LOG_MSG - 1] = '\0';

    snap->running_idx  = running_idx;
    snap->running_rem  = (running_idx >= 0) ? procs[running_idx].remaining_time : 0;
    snap->running_qlvl = (running_idx >= 0) ? procs[running_idx].queue_level : -1;

    /* Copy Queue 0 items in order */
    snap->q0_count = 0;
    for (int i = 0; i < queues[0].size; i++) {
        int idx = queues[0].data[(queues[0].head + i) % MAX_PROCESSES];
        snap->q0[snap->q0_count++] = idx;
    }

    /* Copy Queue 1 items in order */
    snap->q1_count = 0;
    for (int i = 0; i < queues[1].size; i++) {
        int idx = queues[1].data[(queues[1].head + i) % MAX_PROCESSES];
        snap->q1[snap->q1_count++] = idx;
    }

    /* Copy Queue 2 items in order */
    snap->q2_count = 0;
    for (int i = 0; i < queues[2].size; i++) {
        int idx = queues[2].data[(queues[2].head + i) % MAX_PROCESSES];
        snap->q2[snap->q2_count++] = idx;
    }

    /* Copy Completed items */
    snap->comp_count = 0;
    for (int i = 0; i < n_procs; i++) {
        if (procs[i].done) {
            snap->completed[snap->comp_count++] = i;
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Enqueue newly arrived processes                                     */
/* ------------------------------------------------------------------ */
static void enqueue_arrivals(int time, int running_idx) {
    for (int i = 0; i < n_procs; i++) {
        if (!procs[i].done && !procs[i].in_queue && procs[i].arrival_time <= time) {
            procs[i].queue_level   = 0;
            procs[i].wait_in_queue = 0;
            procs[i].in_queue      = 1;
            q_push(&queues[0], i);

            char msg[MAX_LOG_MSG];
            snprintf(msg, sizeof(msg), "t=%d [ARRIVE] %s arrives → Q0", time, procs[i].pid);
            add_log(msg);

            char desc[MAX_LOG_MSG];
            snprintf(desc, sizeof(desc), "%s arrives at t=%d ms and enters Q0", procs[i].pid, time);
            capture_snapshot(time, "ARRIVE", procs[i].pid, -1, 0, desc, running_idx);
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Aging: scan queued processes in Q1 and Q2                          */
/* ------------------------------------------------------------------ */
static int apply_aging(int time, int running_idx) {
    int promoted = 0;

    for (int i = 0; i < n_procs; i++) {
        if (procs[i].done || i == running_idx) continue;
        if (!procs[i].in_queue) continue;
        if (procs[i].queue_level == 1 || procs[i].queue_level == 2) {
            if (procs[i].wait_in_queue >= aging_thresh) {
                int src = procs[i].queue_level;
                int dst = src - 1;

                procs[i].queue_level   = dst;
                procs[i].wait_in_queue = 0;
                promoted = 1;

                char msg[MAX_LOG_MSG];
                snprintf(msg, sizeof(msg),
                    "t=%d [AGING] %s promoted Q%d→Q%d (waited %d ms)",
                    time, procs[i].pid, src, dst, aging_thresh);
                add_log(msg);

                char desc[MAX_LOG_MSG];
                snprintf(desc, sizeof(desc),
                    "%s promoted from Q%d to Q%d (aging: waited %d ms)",
                    procs[i].pid, src, dst, aging_thresh);
                capture_snapshot(time, "AGING", procs[i].pid, src, dst, desc, running_idx);
            }
        }
    }

    if (promoted) {
        /* Rebuild queues to maintain FIFO order */
        Queue old0 = queues[0], old1 = queues[1], old2 = queues[2];
        q_init(&queues[0]); q_init(&queues[1]); q_init(&queues[2]);

        while (!q_empty(&old0)) {
            int idx = q_pop(&old0);
            if (!procs[idx].done && procs[idx].in_queue)
                q_push(&queues[procs[idx].queue_level], idx);
        }
        while (!q_empty(&old1)) {
            int idx = q_pop(&old1);
            if (!procs[idx].done && procs[idx].in_queue)
                q_push(&queues[procs[idx].queue_level], idx);
        }
        while (!q_empty(&old2)) {
            int idx = q_pop(&old2);
            if (!procs[idx].done && procs[idx].in_queue)
                q_push(&queues[procs[idx].queue_level], idx);
        }
    }
    return promoted;
}

/* ------------------------------------------------------------------ */
/*  Main Simulation                                                     */
/* ------------------------------------------------------------------ */
static void simulate(void) {
    int time         = 0;
    int running      = -1;   /* index of running process, -1 = idle */
    int run_elapsed  = 0;    /* ms spent in current quantum slice */
    int quantum      = 0;    /* quantum for running process's queue */
    int done_count   = 0;
    int total_busy   = 0;    /* ms CPU was busy */
    int gantt_start  = 0;    /* start of current Gantt block */
    char gantt_pid[16] = "IDLE";
    int  gantt_qlvl  = -1;

    for (int i = 0; i < 3; i++) q_init(&queues[i]);
    for (int i = 0; i < n_procs; i++) {
        procs[i].remaining_time = procs[i].burst_time;
        procs[i].first_start    = -1;
        procs[i].completion_time= -1;
        procs[i].done           = 0;
        procs[i].in_queue       = 0;
        procs[i].wait_in_queue  = 0;
        procs[i].queue_level    = 0;
    }

    int max_time = 0;
    for (int i = 0; i < n_procs; i++)
        max_time += procs[i].burst_time + procs[i].arrival_time;
    max_time += 20;

    /* Enqueue arrivals at t=0 */
    enqueue_arrivals(0, -1);

    while (done_count < n_procs && time < max_time) {

        /* ---- 1. Check preemption by higher queue ---- */
        if (running != -1) {
            int higher_waiting = 0;
            for (int q = 0; q < procs[running].queue_level; q++) {
                if (!q_empty(&queues[q])) { higher_waiting = 1; break; }
            }
            if (higher_waiting) {
                char msg[MAX_LOG_MSG];
                snprintf(msg, sizeof(msg),
                    "t=%d [PREEMPT] %s preempted from Q%d (remaining %d ms)",
                    time, procs[running].pid, procs[running].queue_level,
                    procs[running].remaining_time);
                add_log(msg);

                char desc[MAX_LOG_MSG];
                snprintf(desc, sizeof(desc),
                    "%s preempted from CPU back to Q%d (rem: %d ms)",
                    procs[running].pid, procs[running].queue_level, procs[running].remaining_time);

                if (time > gantt_start)
                    add_gantt(gantt_start, gantt_pid, time - gantt_start, gantt_qlvl);

                q_push(&queues[procs[running].queue_level], running);
                procs[running].wait_in_queue = 0;

                capture_snapshot(time, "PREEMPT", procs[running].pid, -1, procs[running].queue_level, desc, -1);

                running     = -1;
                run_elapsed = 0;
                gantt_start = time;
                strncpy(gantt_pid, "IDLE", 15);
                gantt_qlvl  = -1;
            }
        }

        /* ---- 2. Pick next process if CPU is idle ---- */
        if (running == -1) {
            for (int q = 0; q < 3; q++) {
                if (!q_empty(&queues[q])) {
                    int idx = q_pop(&queues[q]);
                    running     = idx;
                    run_elapsed = 0;
                    quantum     = (q == 0) ? q0_quantum :
                                  (q == 1) ? q1_quantum : INF;
                    procs[idx].wait_in_queue = 0;

                    if (procs[idx].first_start == -1)
                        procs[idx].first_start = time;

                    char msg[MAX_LOG_MSG];
                    snprintf(msg, sizeof(msg),
                        "t=%d [RUN] %s starts/resumes on Q%d (rem=%d ms)",
                        time, procs[idx].pid, q, procs[idx].remaining_time);
                    add_log(msg);

                    char desc[MAX_LOG_MSG];
                    snprintf(desc, sizeof(desc),
                        "%s dispatched from Q%d to CPU (rem: %d ms, quantum: %s)",
                        procs[idx].pid, q, procs[idx].remaining_time,
                        (q == 2) ? "FCFS" : (q == 0) ? "4ms" : "8ms");

                    if (time > gantt_start)
                        add_gantt(gantt_start, gantt_pid, time - gantt_start, gantt_qlvl);
                    gantt_start = time;
                    strncpy(gantt_pid, procs[idx].pid, 15);
                    gantt_qlvl  = q;

                    capture_snapshot(time, "RUN", procs[idx].pid, q, -1, desc, running);
                    break;
                }
            }
        }

        /* ---- 3. Tick Execution ---- */
        if (running == -1) {
            /* CPU Idle tick */
            time++;
            enqueue_arrivals(time, -1);
            for (int i = 0; i < n_procs; i++) {
                if (!procs[i].done && procs[i].in_queue)
                    procs[i].wait_in_queue++;
            }
            apply_aging(time, -1);
            continue;
        }

        /* Running process executes 1 ms */
        procs[running].remaining_time--;
        run_elapsed++;
        total_busy++;
        time++;

        /* Arrive new processes at this new tick */
        enqueue_arrivals(time, running);

        /* Increment waiting time for non-running ready processes */
        for (int i = 0; i < n_procs; i++) {
            if (!procs[i].done && i != running && procs[i].in_queue)
                procs[i].wait_in_queue++;
        }

        /* Check aging */
        int aged = apply_aging(time, running);

        /* ---- 4. Check if process finished ---- */
        if (procs[running].remaining_time == 0) {
            procs[running].done             = 1;
            procs[running].completion_time  = time;
            done_count++;

            char msg[MAX_LOG_MSG];
            snprintf(msg, sizeof(msg),
                "t=%d [DONE] %s completed (CT=%d)",
                time, procs[running].pid, time);
            add_log(msg);

            char desc[MAX_LOG_MSG];
            snprintf(desc, sizeof(desc),
                "%s finished execution (Completion Time = %d ms)",
                procs[running].pid, time);

            add_gantt(gantt_start, gantt_pid, time - gantt_start, gantt_qlvl);
            gantt_start = time;
            strncpy(gantt_pid, "IDLE", 15);
            gantt_qlvl  = -1;

            capture_snapshot(time, "DONE", procs[running].pid, -1, -1, desc, -1);

            running     = -1;
            run_elapsed = 0;
        }
        /* ---- 5. Check if quantum expired ---- */
        else if (run_elapsed >= quantum) {
            int old_q = procs[running].queue_level;
            int new_q = (old_q < 2) ? old_q + 1 : 2;

            char msg[MAX_LOG_MSG];
            snprintf(msg, sizeof(msg),
                "t=%d [DEMOTE] %s quantum expired on Q%d → Q%d (rem=%d ms)",
                time, procs[running].pid, old_q, new_q,
                procs[running].remaining_time);
            add_log(msg);

            char desc[MAX_LOG_MSG];
            snprintf(desc, sizeof(desc),
                "%s exhausted %d ms quantum on Q%d → demoted to Q%d (rem: %d ms)",
                procs[running].pid, (old_q == 0 ? q0_quantum : q1_quantum), old_q, new_q,
                procs[running].remaining_time);

            add_gantt(gantt_start, gantt_pid, time - gantt_start, gantt_qlvl);
            gantt_start = time;
            strncpy(gantt_pid, "IDLE", 15);
            gantt_qlvl  = -1;

            procs[running].queue_level   = new_q;
            procs[running].wait_in_queue = 0;
            q_push(&queues[new_q], running);

            capture_snapshot(time, "DEMOTE", procs[running].pid, old_q, new_q, desc, -1);

            running     = -1;
            run_elapsed = 0;
        }
        /* ---- 6. Check if aged process now causes preemption ---- */
        else if (aged) {
            int higher = 0;
            for (int q = 0; q < procs[running].queue_level; q++) {
                if (!q_empty(&queues[q])) { higher = 1; break; }
            }
            if (higher) {
                char msg[MAX_LOG_MSG];
                snprintf(msg, sizeof(msg),
                    "t=%d [PREEMPT] %s preempted due to aging promotion (rem=%d ms)",
                    time, procs[running].pid, procs[running].remaining_time);
                add_log(msg);

                char desc[MAX_LOG_MSG];
                snprintf(desc, sizeof(desc),
                    "%s preempted back to Q%d due to aging promotion in higher queue",
                    procs[running].pid, procs[running].queue_level);

                add_gantt(gantt_start, gantt_pid, time - gantt_start, gantt_qlvl);
                gantt_start = time;
                strncpy(gantt_pid, "IDLE", 15);
                gantt_qlvl  = -1;

                q_push(&queues[procs[running].queue_level], running);
                procs[running].wait_in_queue = 0;

                capture_snapshot(time, "PREEMPT", procs[running].pid, -1, procs[running].queue_level, desc, -1);

                running     = -1;
                run_elapsed = 0;
            }
        }
    }

    if (time > gantt_start && running != -1)
        add_gantt(gantt_start, gantt_pid, time - gantt_start, gantt_qlvl);

    /* ---------------------------------------------------------------- */
    /*  Output JSON                                                       */
    /* ---------------------------------------------------------------- */
    printf("{\n");

    /* -- processes -- */
    printf("  \"processes\": [\n");
    for (int i = 0; i < n_procs; i++) {
        int ct  = procs[i].completion_time;
        int at  = procs[i].arrival_time;
        int bt  = procs[i].burst_time;
        int tat = (ct >= 0) ? ct - at : -1;
        int wt  = (tat >= 0) ? tat - bt : -1;
        int rt  = (procs[i].first_start >= 0) ? procs[i].first_start - at : -1;

        printf("    {\"pid\":\"%s\",\"arrival_time\":%d,\"burst_time\":%d,"
               "\"completion_time\":%d,\"turnaround_time\":%d,"
               "\"waiting_time\":%d,\"response_time\":%d}%s\n",
               procs[i].pid, at, bt, ct, tat, wt, rt,
               (i < n_procs - 1) ? "," : "");
    }
    printf("  ],\n");

    /* -- gantt chart -- */
    printf("  \"gantt\": [\n");
    for (int i = 0; i < n_gantt; i++) {
        printf("    {\"time\":%d,\"pid\":\"%s\",\"duration\":%d,\"queue_level\":%d}%s\n",
               gantt[i].time, gantt[i].pid, gantt[i].duration, gantt[i].queue_level,
               (i < n_gantt - 1) ? "," : "");
    }
    printf("  ],\n");

    /* -- event log -- */
    printf("  \"log\": [\n");
    for (int i = 0; i < n_log; i++) {
        printf("    \"");
        for (char *c = log_entries[i].msg; *c; c++) {
            if (*c == '"') printf("\\\"");
            else if (*c == '\\') printf("\\\\");
            else putchar(*c);
        }
        printf("\"%s\n", (i < n_log - 1) ? "," : "");
    }
    printf("  ],\n");

    /* -- summary stats -- */
    double total_tat = 0, total_wt = 0, total_rt = 0;
    int    finished  = 0;
    int    sim_end   = 0;
    for (int i = 0; i < n_procs; i++) {
        if (procs[i].completion_time > sim_end)
            sim_end = procs[i].completion_time;
        if (procs[i].done) {
            finished++;
            int at  = procs[i].arrival_time;
            int bt  = procs[i].burst_time;
            int ct  = procs[i].completion_time;
            total_tat += ct - at;
            total_wt  += (ct - at) - bt;
            total_rt  += procs[i].first_start - at;
        }
    }
    double avg_tat   = finished > 0 ? total_tat / finished : 0;
    double avg_wt    = finished > 0 ? total_wt  / finished : 0;
    double avg_rt    = finished > 0 ? total_rt  / finished : 0;
    double cpu_util  = sim_end > 0 ? (100.0 * total_busy / sim_end) : 0;
    double throughput= sim_end > 0 ? (1.0 * finished / sim_end) : 0;

    printf("  \"summary\": {\n");
    printf("    \"avg_turnaround_time\": %.2f,\n", avg_tat);
    printf("    \"avg_waiting_time\": %.2f,\n",    avg_wt);
    printf("    \"avg_response_time\": %.2f,\n",   avg_rt);
    printf("    \"cpu_utilization\": %.2f,\n",     cpu_util);
    printf("    \"throughput\": %.4f,\n",           throughput);
    printf("    \"total_time\": %d,\n",             sim_end);
    printf("    \"total_busy\": %d\n",              total_busy);
    printf("  },\n");

    printf("  \"config\": {\n");
    printf("    \"q0_quantum\": %d,\n",      q0_quantum);
    printf("    \"q1_quantum\": %d,\n",      q1_quantum);
    printf("    \"aging_threshold\": %d\n",  aging_thresh);
    printf("  },\n");

    /* -- timeline snapshots for visual step-by-step queue animation -- */
    printf("  \"timeline\": [\n");
    for (int t = 0; t < n_timeline; t++) {
        TimelineSnapshot *s = &timeline[t];
        printf("    {\n");
        printf("      \"time\": %d,\n", s->time);
        printf("      \"action\": \"%s\",\n", s->action_type);
        printf("      \"pid\": \"%s\",\n", s->action_pid);
        printf("      \"from_q\": %d,\n", s->from_q);
        printf("      \"to_q\": %d,\n", s->to_q);
        printf("      \"desc\": \"%s\",\n", s->desc);

        /* CPU object */
        if (s->running_idx >= 0) {
            printf("      \"cpu\": {\"pid\":\"%s\",\"remaining\":%d,\"queue\":%d},\n",
                   procs[s->running_idx].pid, s->running_rem, s->running_qlvl);
        } else {
            printf("      \"cpu\": null,\n");
        }

        /* Q0 processes */
        printf("      \"q0\": [");
        for (int i = 0; i < s->q0_count; i++) {
            int idx = s->q0[i];
            printf("{\"pid\":\"%s\",\"remaining\":%d,\"wait\":%d}%s",
                   procs[idx].pid, procs[idx].remaining_time, procs[idx].wait_in_queue,
                   (i < s->q0_count - 1) ? "," : "");
        }
        printf("],\n");

        /* Q1 processes */
        printf("      \"q1\": [");
        for (int i = 0; i < s->q1_count; i++) {
            int idx = s->q1[i];
            printf("{\"pid\":\"%s\",\"remaining\":%d,\"wait\":%d}%s",
                   procs[idx].pid, procs[idx].remaining_time, procs[idx].wait_in_queue,
                   (i < s->q1_count - 1) ? "," : "");
        }
        printf("],\n");

        /* Q2 processes */
        printf("      \"q2\": [");
        for (int i = 0; i < s->q2_count; i++) {
            int idx = s->q2[i];
            printf("{\"pid\":\"%s\",\"remaining\":%d,\"wait\":%d}%s",
                   procs[idx].pid, procs[idx].remaining_time, procs[idx].wait_in_queue,
                   (i < s->q2_count - 1) ? "," : "");
        }
        printf("],\n");

        /* Completed processes */
        printf("      \"completed\": [");
        for (int i = 0; i < s->comp_count; i++) {
            int idx = s->completed[i];
            printf("{\"pid\":\"%s\",\"ct\":%d,\"tat\":%d,\"wt\":%d}%s",
                   procs[idx].pid, procs[idx].completion_time,
                   procs[idx].completion_time - procs[idx].arrival_time,
                   (procs[idx].completion_time - procs[idx].arrival_time) - procs[idx].burst_time,
                   (i < s->comp_count - 1) ? "," : "");
        }
        printf("]\n");

        printf("    }%s\n", (t < n_timeline - 1) ? "," : "");
    }
    printf("  ]\n");

    printf("}\n");
}

/* ------------------------------------------------------------------ */
/*  Entry Point                                                         */
/* ------------------------------------------------------------------ */
int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: scheduler <n> pid at bt ... q0 q1 aging\n");
        return 1;
    }

    n_procs = atoi(argv[1]);
    if (n_procs < 1 || n_procs > MAX_PROCESSES) {
        fprintf(stderr, "Invalid process count: %d\n", n_procs);
        return 1;
    }

    int expected_args = 1 + n_procs * 3 + 3 + 1;
    if (argc != expected_args) {
        fprintf(stderr, "Expected %d args, got %d\n", expected_args, argc);
        return 1;
    }

    int base = 2;
    for (int i = 0; i < n_procs; i++) {
        strncpy(procs[i].pid, argv[base + i*3], 15);
        procs[i].pid[15]       = '\0';
        procs[i].arrival_time  = atoi(argv[base + i*3 + 1]);
        procs[i].burst_time    = atoi(argv[base + i*3 + 2]);

        if (procs[i].arrival_time < 0 || procs[i].burst_time <= 0) {
            fprintf(stderr, "Invalid process data for %s\n", procs[i].pid);
            return 1;
        }
    }

    int cfg_base   = base + n_procs * 3;
    q0_quantum     = atoi(argv[cfg_base]);
    q1_quantum     = atoi(argv[cfg_base + 1]);
    aging_thresh   = atoi(argv[cfg_base + 2]);

    if (q0_quantum <= 0 || q1_quantum <= 0 || aging_thresh <= 0) {
        fprintf(stderr, "Invalid config values\n");
        return 1;
    }

    simulate();
    return 0;
}
