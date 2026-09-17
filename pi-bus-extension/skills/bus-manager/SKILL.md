---
name: bus-manager
description: Manage the global pi multi-agent bus service. Use when the user asks to start, stop, restart, inspect, or view history for the shared bus used by multiple pi agents.
---

# Bus Manager

Use this skill when the task involves operating the global multi-agent bus service.

## Concepts

- The bus service is global for the current user account.
- The service stores agents, session-agent bindings, and message history in SQLite.
- The default database is `~/.pi/bus/bus.sqlite`.
- The default HTTP endpoint is `http://127.0.0.1:43871`.
- The bus command is installed by this project as `bus`.

## Commands

Start the global bus service:

```bash
bus up
```

Stop the global bus service:

```bash
bus down
```

Restart the global bus service after code or dependency changes:

```bash
bus restart
```

Check whether the bus is running:

```bash
bus status
```

Show message history in a pager, newest first, in a git-log-like format:

```bash
bus history
```

Show compact one-line message history, newest first:

```bash
bus history --oneline
```

## Agent Workflow

When asked to prepare an agent for bus participation:

1. Ensure the service is running with `bus status`; if not, run `bus up`.
2. Register the current pi process with `register_self(name, description)`.
3. Start the background event listener with `wait_bus()`.
4. Use `get_all_agents()` to discover peers.
5. Use `send_to_bus()` for `task`, `question`, or `reply` messages.
6. Use `recv_from_bus()` when notified that messages are pending.

## Troubleshooting

If agents cannot see each other:

1. Run `bus status`.
2. Confirm all agents called `register_self`.
3. Confirm all agents called `wait_bus` if they should react asynchronously.
4. Check `bus history --oneline` for whether messages were inserted and delivered.
5. Restart the service with `bus restart` after service code changes.

If a resumed session lost its apparent identity:

1. Run `who_am_i`.
2. If identity is missing, call `register_self` again with the desired name and description.
3. Re-run `wait_bus`.

Repeated `register_self` is allowed and acts as a rename/rebind for the current session.
