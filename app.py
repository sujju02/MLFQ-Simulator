"""
MLFQ CPU Scheduling Simulator - Flask Backend
===============================================
Bridges the C scheduling engine with the web frontend.
Compiles scheduler.c on first run and executes it safely via subprocess.
"""

import os
import sys
import json
import subprocess
import platform
from pathlib import Path
from flask import Flask, request, jsonify, render_template, send_from_directory

app = Flask(__name__)

# ── Paths ────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.resolve()
SRC_FILE    = BASE_DIR / "scheduler.c"
BIN_NAME    = "scheduler.exe" if platform.system() == "Windows" else "scheduler"
BIN_FILE    = BASE_DIR / BIN_NAME

# ── Compilation ──────────────────────────────────────────────────────
def compile_scheduler() -> tuple[bool, str]:
    """Compile scheduler.c → binary. Returns (success, message)."""
    if not SRC_FILE.exists():
        return False, f"Source file not found: {SRC_FILE}"

    cmd = ["gcc", str(SRC_FILE), "-o", str(BIN_FILE), "-O2", "-Wall"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            return False, f"Compilation failed:\n{result.stderr}"
        return True, "Compilation successful"
    except FileNotFoundError:
        return False, ("GCC not found. Please install MinGW-w64 and add it to PATH.\n"
                       "Download from: https://winlibs.com/")
    except subprocess.TimeoutExpired:
        return False, "Compilation timed out"


def ensure_binary() -> tuple[bool, str]:
    """Make sure the binary exists (compile if needed)."""
    if not BIN_FILE.exists():
        return compile_scheduler()
    # Recompile if source is newer
    if SRC_FILE.stat().st_mtime > BIN_FILE.stat().st_mtime:
        return compile_scheduler()
    return True, "Binary up to date"


# ── Input Validation ─────────────────────────────────────────────────
def validate_processes(processes: list) -> tuple[bool, str]:
    if not processes:
        return False, "No processes provided"
    if len(processes) > 64:
        return False, "Maximum 64 processes allowed"

    pids_seen = set()
    for p in processes:
        pid = str(p.get("pid", "")).strip()
        if not pid or len(pid) > 15:
            return False, f"Invalid PID: '{pid}' (must be 1–15 characters)"
        # Allow only safe PID characters
        if not all(c.isalnum() or c in "_-" for c in pid):
            return False, f"PID '{pid}' contains invalid characters (use alphanumeric, _, -)"
        if pid in pids_seen:
            return False, f"Duplicate PID: '{pid}'"
        pids_seen.add(pid)

        try:
            at = int(p.get("arrival_time", -1))
            bt = int(p.get("burst_time",   -1))
        except (ValueError, TypeError):
            return False, f"Process '{pid}': arrival_time and burst_time must be integers"

        if at < 0:
            return False, f"Process '{pid}': arrival_time must be ≥ 0"
        if bt <= 0 or bt > 10000:
            return False, f"Process '{pid}': burst_time must be 1–10000"

    return True, "OK"


def validate_config(config: dict) -> tuple[bool, str]:
    try:
        q0 = int(config.get("q0_quantum",      4))
        q1 = int(config.get("q1_quantum",      8))
        ag = int(config.get("aging_threshold", 10))
    except (ValueError, TypeError):
        return False, "Config values must be integers"

    if q0 <= 0 or q0 > 1000:
        return False, "Q0 quantum must be 1–1000"
    if q1 <= 0 or q1 > 1000:
        return False, "Q1 quantum must be 1–1000"
    if ag <= 0 or ag > 10000:
        return False, "Aging threshold must be 1–10000"

    return True, "OK"


# ── Routes ───────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/compile", methods=["POST"])
def api_compile():
    ok, msg = compile_scheduler()
    return jsonify({"success": ok, "message": msg})


@app.route("/api/schedule", methods=["POST"])
def api_schedule():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400

    processes = data.get("processes", [])
    config    = data.get("config",    {})

    # Validate inputs
    ok, msg = validate_processes(processes)
    if not ok:
        return jsonify({"error": msg}), 400

    ok, msg = validate_config(config)
    if not ok:
        return jsonify({"error": msg}), 400

    # Ensure binary
    ok, msg = ensure_binary()
    if not ok:
        return jsonify({"error": msg, "gcc_missing": "GCC not found" in msg}), 500

    # Build command args
    n = len(processes)
    q0 = int(config.get("q0_quantum",      4))
    q1 = int(config.get("q1_quantum",      8))
    ag = int(config.get("aging_threshold", 10))

    args = [str(BIN_FILE), str(n)]
    for p in processes:
        args += [str(p["pid"]), str(int(p["arrival_time"])), str(int(p["burst_time"]))]
    args += [str(q0), str(q1), str(ag)]

    # Execute
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=10
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Scheduler timed out (possible infinite loop)"}), 500
    except Exception as e:
        return jsonify({"error": f"Execution error: {str(e)}"}), 500

    if result.returncode != 0:
        return jsonify({"error": f"Scheduler error: {result.stderr.strip()}"}), 500

    # Parse JSON output from C program
    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        return jsonify({
            "error": f"Failed to parse scheduler output: {e}",
            "raw_output": result.stdout[:500]
        }), 500

    return jsonify(output)


@app.route("/api/health", methods=["GET"])
def api_health():
    binary_exists = BIN_FILE.exists()
    gcc_available = False
    try:
        r = subprocess.run(["gcc", "--version"], capture_output=True, timeout=5)
        gcc_available = (r.returncode == 0)
    except Exception:
        pass

    return jsonify({
        "status":         "ok",
        "binary_exists":  binary_exists,
        "gcc_available":  gcc_available,
        "binary_path":    str(BIN_FILE),
        "source_path":    str(SRC_FILE),
    })


if __name__ == "__main__":
    print("=" * 60)
    print("  MLFQ CPU Scheduling Simulator")
    print("=" * 60)

    # Try to compile on startup
    ok, msg = ensure_binary()
    if ok:
        print(f"  ✓ {msg}")
    else:
        print(f"  ✗ {msg}")
        print("  → Run 'POST /api/compile' after installing GCC")

    print(f"  ✓ Starting Flask server...")
    print(f"  → Open: http://127.0.0.1:5000")
    print("=" * 60)
    app.run(debug=True, host="127.0.0.1", port=5000)
