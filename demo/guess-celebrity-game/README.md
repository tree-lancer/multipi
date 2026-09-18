# guess-celebrity-game

Three agents (`gamer-dave`, `gamer-eve`, `gamer-frank`) each have a secret
celebrity that only the *other two* know. They take turns asking
yes/no/partially questions to deduce their own identity, with two guess
attempts before needing to "spend" another question turn to earn a new
guess.

Assignments (each prompt tells its agent the other two's identities and
withholds its own):

| agent        | secret identity        |
| ------------ | ----------------------- |
| gamer-dave   | 曹丕 (Cao Pi)            |
| gamer-eve    | 项羽 (Xiang Yu)          |
| gamer-frank  | 伊丽莎白女王 (Elizabeth II) |

## Why this case is a good wakeup-policy stress test

- **Turn-based, not bursty.** Each round is one question broadcast to two
  recipients, then two replies — a realistic multi-agent coordination
  pattern (see `multipi/skills/multi-agent-orchestration/SKILL.md`), with
  LLM-inference-length gaps between messages (seconds, not milliseconds).
  This is a useful *negative* control for debounce-window tuning: if a
  policy claims large savings on this kind of traffic, that's a red flag,
  not a win — see `demo/README.md`'s note on `debouncedWakeups` vs
  `naiveWakeups` staying close together in a healthy run.
- **Real broadcast fan-out.** Most turns send the same message to two
  destinations at once, exercising the `bySender` grouping in
  `core/wakeup/policy.ts` and the `PendingSenderBreakdown` counts.
- **Long enough to accumulate several full rounds** for meaningful
  `wakeups` / `idleWakeups` counts in `wakeup-metrics.jsonl`, without
  needing a long timeout — 3 minutes (`case.env` default) is normally
  enough to reach at least one participant's first guess.

## Running it

```bash
cd demo
./run_case.sh guess-celebrity-game
```

For a quick iteration loop use a shorter duration:

```bash
./run_case.sh guess-celebrity-game --duration 60
```

## Reading the report

`report.json` / the printed summary give, per agent:

- `messages` — how many bus messages this agent actually received (ground
  truth from sqlite).
- `naiveWakeups` / `debouncedWakeups` — an offline replay of what the
  current debounce window (`--debounce-ms`, default 150) would have
  collapsed, computed purely from message timestamps.
- `runtimeMetrics.wakeups` / `idleWakeups` / `skippedDuplicate` — the real
  numbers recorded live by `WakeupPolicy`/`WakeupMetrics` inside that
  agent's `pi` process (see `multipi/core/wakeup/`), flushed to
  `wakeup-metrics.jsonl` on graceful shutdown.

A healthy run on this case typically shows `naiveWakeups` ≈
`debouncedWakeups` (turn-based traffic rarely bursts within one debounce
window) and `runtimeMetrics.wakeups` matching `messages` closely (few, if
any, idle wakeups) — see `demo/README.md` for why this is expected rather
than a sign the debounce optimization is broken.
