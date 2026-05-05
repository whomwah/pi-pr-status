/**
 * PR Status Extension
 *
 * Shows the current PR status in the footer status bar via setStatus("pr-status", ...).
 * Async, non-blocking — uses pi.exec(). Polls every 5 minutes when a PR exists;
 * stops polling when no PR is found on the current branch.
 *
 * Requires `gh` CLI authenticated with `gh auth login`.
 * Silent no-op if `gh` is unavailable or unauthenticated.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CheckStatus {
  total: number;
  pass: number;
  fail: number;
  pending: number;
}

interface PrInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  checks: CheckStatus;
  unresolvedThreads: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5 * 60_000; // 5 minutes
const STATUS_KEY = "pr-status";
const GH_TIMEOUT = 10_000;

// Pre-compiled regex for extracting owner/name from PR URL
const REPO_REGEX = /github\.com\/([^/]+)\/([^/]+)\/pull\//;

// Sets for O(1) check status lookups instead of chained string comparisons
const PASS_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAIL_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
]);
const PENDING_STATUSES = new Set([
  "IN_PROGRESS",
  "QUEUED",
  "PENDING",
  "WAITING",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if gh CLI is available and authenticated. */
async function hasGh(pi: ExtensionAPI): Promise<boolean> {
  try {
    const result = await pi.exec("gh", ["auth", "status"], { timeout: 5000 });
    const code = (result as any).exitCode ?? (result as any).code;
    return code === 0;
  } catch {
    return false;
  }
}

/** Get the current git branch, or undefined. */
async function getBranch(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string | undefined> {
  try {
    const result = await pi.exec("git", ["branch", "--show-current"], {
      cwd,
      timeout: 3000,
    });
    const code = (result as any).exitCode ?? (result as any).code;
    if (code !== 0) return undefined;
    const branch = result.stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

/** Parse CI check statuses from gh pr view JSON. */
export function parsePrChecks(statusCheckRollup: unknown[]): CheckStatus {
  const checks: CheckStatus = { total: 0, pass: 0, fail: 0, pending: 0 };

  for (const check of statusCheckRollup) {
    const c = check as Record<string, string>;
    const conclusion = (c.conclusion || "").toUpperCase();
    const status = (c.status || "").toUpperCase();
    const name = c.name || "";

    // Skip ghost checks with no meaningful data (e.g. Vercel deployment statuses)
    if (!name && !conclusion && !status) continue;

    checks.total++;
    if (PASS_CONCLUSIONS.has(conclusion)) {
      checks.pass++;
    } else if (FAIL_CONCLUSIONS.has(conclusion)) {
      checks.fail++;
    } else if (PENDING_STATUSES.has(status)) {
      checks.pending++;
    } else if (status === "COMPLETED") {
      checks.pass++;
    } else {
      checks.pending++;
    }
  }

  return checks;
}

/** Resolve unresolved review thread count via GraphQL. */
async function getUnresolvedThreads(
  pi: ExtensionAPI,
  owner: string,
  name: string,
  prNumber: number,
): Promise<number> {
  try {
    const query = `{ repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${prNumber}) { reviewThreads(first: 100) { nodes { isResolved } } } } }`;
    const result = await pi.exec(
      "gh",
      ["api", "graphql", "-f", `query=${query}`],
      {
        timeout: GH_TIMEOUT,
      },
    );
    const code = (result as any).exitCode ?? (result as any).code;
    if (code !== 0) return 0;

    const data = JSON.parse(result.stdout);
    const threads = data?.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!Array.isArray(threads)) return 0;

    return threads.filter((t: { isResolved: boolean }) => !t.isResolved).length;
  } catch {
    return 0;
  }
}

/** Fetch PR info for the current branch. */
async function getPrForBranch(
  pi: ExtensionAPI,
  cwd: string,
): Promise<PrInfo | undefined> {
  try {
    const result = await pi.exec(
      "gh",
      ["pr", "view", "--json", "number,title,url,state,statusCheckRollup"],
      { cwd, timeout: GH_TIMEOUT },
    );
    const code = (result as any).exitCode ?? (result as any).code;
    if (code !== 0 || !result.stdout.trim()) return undefined;

    const pr = JSON.parse(result.stdout);
    if (!pr.number || !pr.url) return undefined;

    const checks = Array.isArray(pr.statusCheckRollup)
      ? parsePrChecks(pr.statusCheckRollup)
      : { total: 0, pass: 0, fail: 0, pending: 0 };

    // Extract owner/name from PR URL: https://github.com/owner/name/pull/N
    const repoMatch = pr.url?.match(REPO_REGEX);
    let unresolvedThreads = 0;
    if (repoMatch) {
      unresolvedThreads = await getUnresolvedThreads(
        pi,
        repoMatch[1],
        repoMatch[2],
        pr.number,
      );
    }

    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      checks,
      unresolvedThreads,
    };
  } catch {
    return undefined;
  }
}

/** Format a PR into a compact status string with OSC 8 hyperlink. */
export function formatPrStatus(pr: PrInfo): string {
  const stateIcon =
    pr.state === "MERGED" ? "🟣" : pr.state === "CLOSED" ? "🔴" : "🟢";

  // OSC 8 hyperlink around the PR number
  const linkedPr = `\x1b]8;;${pr.url}\x1b\\PR #${pr.number}\x1b]8;;\x1b\\`;
  const parts: string[] = [`${stateIcon} ${linkedPr}`];

  // CI status
  if (pr.checks.total > 0) {
    if (pr.checks.fail > 0) {
      parts.push(`❌ ${pr.checks.fail} fail`);
    } else if (pr.checks.pending > 0) {
      parts.push("⏳");
    } else {
      parts.push("✅");
    }
  }

  // Unresolved threads
  if (pr.unresolvedThreads > 0) {
    parts.push(`💬 ${pr.unresolvedThreads}`);
  }

  return parts.join(" · ");
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  // Check gh availability once on load
  const ghAvailable = await hasGh(pi);
  if (!ghAvailable) return;

  let timer: ReturnType<typeof setInterval> | undefined;
  let lastBranch: string | undefined;
  let cwd: string | undefined;
  let updateUi:
    | { setStatus: (key: string, value: string | undefined) => void }
    | undefined;

  async function poll() {
    if (!cwd || !updateUi) return;

    const branch = await getBranch(pi, cwd);
    const branchChanged = branch !== lastBranch;
    lastBranch = branch;

    if (!branch) {
      // No branch — clear status, stop polling
      updateUi.setStatus(STATUS_KEY, undefined);
      stopPolling();
      return;
    }

    if (branchChanged) {
      // Branch changed — clear stale status, re-poll immediately
      updateUi.setStatus(STATUS_KEY, undefined);
    }

    const pr = await getPrForBranch(pi, cwd);

    if (pr) {
      updateUi.setStatus(STATUS_KEY, formatPrStatus(pr));
      startPolling(); // Ensure polling is active while PR exists
    } else {
      updateUi.setStatus(STATUS_KEY, undefined);
      stopPolling(); // No PR on this branch, stop polling
    }
  }

  function startPolling() {
    if (timer) return; // Already polling
    timer = setInterval(poll, POLL_INTERVAL);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    updateUi = ctx.ui;

    // Initial poll
    await poll();
  });

  pi.on("session_shutdown", () => {
    stopPolling();
    cwd = undefined;
    updateUi = undefined;
  });
}
