# pi-pr-status

A [pi](https://github.com/mariozechner/pi-coding-agent) extension that shows your current branch's GitHub PR status in the footer status bar.

When you're on a branch with an open PR, the status bar shows the PR number (clickable link), CI check results, and unresolved review threads. Polls every 5 minutes, stops when you switch away from a PR branch.

## Requirements

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (`gh auth login`)

## Installation

```bash
pi package install ./pi-pr-status
```

## Development

```bash
just        # list available tasks
just test   # run tests
just check  # format check
just fix    # auto-format
```
