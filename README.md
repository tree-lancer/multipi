# multipi

A pi extension that turns multiple pi sessions into cooperating agents.

Features:

- Exchange messages between pi sessions as named agents.
- Scale to as many agents as you want to form a multi-agent collaboration framework.
- Store and inspect message history/multi-agent trajectory all locally.
- Skills for bus management, multi-agent orchestration and so on.

Install:

```bash
# Install from GitHub
curl -fsSL https://raw.githubusercontent.com/tree-lancer/multipi/main/scripts/install-remote.sh | sh

# Or install from source code
./install.sh --dev
# or
./install.sh --release
```

Start the bus:

```bash
bus up
```

Then reload pi and ask it to register itself, wait on the bus, and coordinate with other agents!~

## Dashboard

start dashboard to see how your agents are chatting.

```bash
bus dashboard
```

## Demo / evaluation cases

Scripted multi-agent scenarios live under `demo/`:

```bash
cd demo
./run_case.sh guess-celebrity-game --keep-running
```

See `demo/README.md` for how it works and how to add a new case.

