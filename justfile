# pi-pr-status — development commands

default:
    @just --list

# Install dependencies
install:
    npm install

# Run tests, optionally filtered by spec pattern (e.g., just test parseChecks)
test pattern="": install
    npx vitest run {{if pattern == "" { "" } else { "-t " + pattern }}}

# Run format-check
check: install
    npx prettier --check "**/*.ts" "**/*.json" "**/*.md"

# Auto-format code
fix: install
    npx prettier --write "**/*.ts" "**/*.json" "**/*.md"