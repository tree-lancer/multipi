# multipi demo cases

Scripted multi-agent scenarios that spin up real, isolated `pi` + `multipi`
bus sessions end to end, then produce a wakeup-policy evaluation report —
without touching your default `~/.pi/bus` or any interactive session you
might have running.

## Quick start

```bash
cd demo
./run_case.sh guess-celebrity-game
```

This will:

1. start a **fully isolated** bus service (its own port, sqlite file, and
   `wakeup-metrics.jsonl` — none of it touches `~/.pi/bus`),
2. spawn one non-interactive `pi` agent per participant defined in the
   case, each kept alive under a pseudo-TTY (see below for why),
3. wait for every agent to `register_self` and come online,
4. let the case run for a configured duration (`CASE_DURATION_SECONDS` in
   `case.env`, or `--duration <seconds>`),
5. stop every agent **gracefully** (`SIGTERM`, not `SIGKILL`) so `pi`'s
   `session_shutdown` handler runs and flushes wakeup metrics,
6. stop the bus service,
7. analyze the run and print/save a report.

All run artifacts land under `demo/.runs/<case>/<timestamp>/` (git-ignored):
agent logs, the bus sqlite file, `wakeup-metrics.jsonl`, and `report.json`.

Useful flags:

```bash
./run_case.sh guess-celebrity-game --duration 60      # shorter run for iterating
./run_case.sh guess-celebrity-game --port 43950        # avoid a port clash
./run_case.sh guess-celebrity-game --keep-running      # leave it running, print how to attach/stop
```

## Directory layout

```
demo/
  run_case.sh              # the one entry point — always run this
  common/                  # shared, case-agnostic infrastructure
    lib.sh                 # bash helpers: health checks, online polling, process teardown
    spawn_agent.sh          # spawn one non-interactive pi agent under a pseudo-TTY
    stop_agent.sh            # gracefully SIGTERM the real `pi` child so shutdown hooks run
    gen_expect_script.py     # safely embeds a prompt (with quotes/newlines/UTF-8) into an expect script
    analyze_run.cjs          # reads bus sqlite + wakeup-metrics.jsonl, prints/saves a report
  guess-celebrity-game/     # one case
    case.env                 # participant names, prompt files, timing
    prompts/*.txt             # per-agent initial prompt
    README.md                 # what this case is for, expected outcome
  .runs/                    # git-ignored: per-run artifacts
```

## Adding a new case

A case is just a directory under `demo/` with:

- `case.env` — defines `CASE_AGENTS` (bash array of bus agent names) and
  `CASE_PROMPT_FILES` (matching array of filenames under `prompts/`), plus
  optional `CASE_DURATION_SECONDS` / `CASE_STARTUP_TIMEOUT_SECONDS`
  overrides.
- `prompts/<name>.txt` — one initial prompt per agent, in the order given by
  `CASE_AGENTS`.
- `README.md` — what the scenario tests, what a "good" run looks like.

Everything else (starting an isolated bus, keeping non-interactive agents
alive, waiting for them to come online, tearing down cleanly, generating the
report) is handled by `run_case.sh` + `common/`, unchanged. Copy
`guess-celebrity-game/` as a template.

## Why an isolated bus per run

Each run gets its own `PI_BUS_PORT` / `PI_BUS_DATA_DIR` / sqlite file, so:

- it never interferes with a bus you might be running interactively,
- runs are reproducible and don't accumulate history across cases,
- `wakeup-metrics.jsonl` for a run only contains that run's agents.

## Why a pseudo-TTY for non-interactive agents (`expect`)

`pi`'s interactive mode expects a real TTY on stdin. Under a plain
background shell (`cmd &`) or a one-shot pipe, it detects the missing TTY
and exits as soon as it settles the initial turn — which means
`wait_bus()`'s background event listener never gets a chance to actually
run for the duration of the case. `pi --print` has the same problem: it's a
one-shot, non-interactive mode by design and exits after the first response.

The fix used here is `expect`, which allocates a pseudo-TTY (`ttys0xx`) and
keeps stdin open indefinitely (`expect eof` with `timeout -1`). Under that
pseudo-TTY, `pi` behaves as if attached to a real terminal and stays
resident, so `register_self` → `wait_bus()` → ongoing bus interaction all
work exactly as they would in an interactive session.

`gen_expect_script.py` exists only because prompts in this repo are Chinese
text full of double quotes ("是"/"否"/"是也不是"), which break naive
double-quoted tcl strings. It embeds the prompt in tcl brace-quoting
(`{...}`) instead, which does not require escaping embedded `"`.

To stop an agent cleanly, `stop_agent.sh` finds the *real* `pi` child of the
`expect` wrapper process (`pgrep -P <expect-pid>`) and sends it `SIGTERM`
directly — sending `SIGTERM` to `expect` itself does not reliably propagate
to `pi`'s handlers. This was verified against a live case: `SIGTERM` to the
`pi` child triggers its `session_shutdown` extension hook, which flushes
`wakeup-metrics.jsonl` before the process exits, and the `expect` wrapper
then exits on its own once `pi` is gone.

## Why the report is built from sqlite + `wakeup-metrics.jsonl`, not the terminal transcript

An earlier iteration of this evaluation tried scraping captured terminal
output (redirecting a background `pi` process's stdout to a file, then
grepping it for `[bus] N message(s) pending` / `No messages available`).
That approach turned out to be unreliable: `pi`'s TUI repaints the entire
screen on every animation frame while "Working...", so a single real event
(one notify, one idle `recv_from_bus` result) can appear as dozens of
duplicate lines in the raw capture, at irregular intervals that don't
correspond to distinct events. Naively counting matching lines overstates
real counts by 1-2 orders of magnitude and cannot be fixed by simple
deduplication (consecutive identical lines are not always repaints; some
are genuinely distinct events with identical text).

`analyze_run.cjs` instead uses two sources that are not subject to TUI
rendering at all:

1. **The bus sqlite `messages` table** — the ground truth of what was
   actually sent, with real timestamps, independent of any process's
   terminal. Used for message counts and an offline "debounce replay"
   (`replayDebounce`) that estimates, purely from arrival timestamps, how
   many notify events a given `debounceMs` window would have collapsed —
   the same collapsing logic as `wait.ts`'s live debounce timer, applied
   after the fact.
2. **`wakeup-metrics.jsonl`** (`multipi/core/wakeup/persist.ts`) — the
   actual runtime decisions recorded by `WakeupPolicy`/`WakeupMetrics`
   inside each `pi` process, one JSON line per process on clean shutdown:
   real `wakeups`, real `idleWakeups` (a wakeup whose very next
   `recv_from_bus` call returned zero items), real `skippedDuplicate`
   (an SSE reconnect replaying an already-notified backlog). This is the
   only reliable source for "how many wakeups were idle" — it cannot be
   reconstructed from message timestamps alone.

If `wakeup-metrics.jsonl` is missing or empty for a run (e.g. an agent was
killed with `SIGKILL` instead of `SIGTERM`, or crashed before shutdown), the
report still prints message counts and the debounce replay, but flags
`metricsAvailable: false` / "no wakeup-metrics.jsonl entries found for this
agent" for that agent instead of fabricating a number.

## Requirements

- `pi` on `PATH` (built from `multipi/` here, or any compatible install)
  with a working model/provider (`pi auth check --provider <name>`).
- `expect`, `python3`, `node`, `curl` on `PATH`.
- `multipi/service/node_modules` installed (`npm install` in
  `multipi/service`) — `analyze_run.cjs` reuses `better-sqlite3` from there
  instead of duplicating a `node_modules` under `demo/`.
