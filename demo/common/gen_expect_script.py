#!/usr/bin/env python3
"""Generate a tcl `expect` script that spawns a long-lived, non-interactive
`pi` agent process with a given initial prompt.

Motivation: `pi` (interactive mode) exits once it settles if stdin has no
real TTY attached (e.g. under a background shell). Wrapping the spawn in
`expect` allocates a pseudo-TTY, which keeps the underlying `pi` process
alive so its `wait_bus()` background listener can actually run for the
duration of the case.

Usage:
  gen_expect_script.py <output.exp> <prompt-file> -- <command> [args...]

The prompt file's raw text is embedded as the final argument to `pi`,
wrapped in tcl braces `{...}` rather than double quotes, since braces do
not require escaping embedded double quotes (the prompts in this repo are
Chinese text with plenty of them). Only literal braces in the prompt itself
are escaped.
"""
import sys


def main() -> int:
	args = sys.argv[1:]
	if "--" not in args:
		print("usage: gen_expect_script.py <output.exp> <prompt-file> -- <command> [args...]", file=sys.stderr)
		return 2
	sep = args.index("--")
	head = args[:sep]
	command = args[sep + 1:]
	if len(head) != 2 or not command:
		print("usage: gen_expect_script.py <output.exp> <prompt-file> -- <command> [args...]", file=sys.stderr)
		return 2
	output_path, prompt_path = head

	with open(prompt_path, encoding="utf-8") as f:
		prompt = f.read().strip()
	prompt_escaped = prompt.replace("{", "\\{").replace("}", "\\}")

	quoted_command = " ".join(_tcl_quote(part) for part in command)
	script = (
		"set timeout -1\n"
		f"spawn {quoted_command} {{{prompt_escaped}}}\n"
		"expect eof\n"
	)
	with open(output_path, "w", encoding="utf-8") as f:
		f.write(script)
	return 0


def _tcl_quote(value: str) -> str:
	if value and all(c not in value for c in ' \t\n{}[]$"\\;'):
		return value
	escaped = value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
	return "{" + escaped + "}"


if __name__ == "__main__":
	raise SystemExit(main())
