"""Run the local API and Vite, and stop both when either exits or on Ctrl-C."""

import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
processes = []


def stop(_signal=None, _frame=None):
    for process in processes:
        if process.poll() is None:
            process.terminate()


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        for command, directory in [
            (["uv", "run", "python", "-m", "app"], "backend"),
            (["pnpm", "dev"], "frontend"),
        ]:
            processes.append(subprocess.Popen(command, cwd=ROOT / directory))
        while all(p.poll() is None for p in processes):
            time.sleep(0.2)
        return next((p.returncode for p in processes if p.returncode is not None), 0)
    finally:
        stop()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
