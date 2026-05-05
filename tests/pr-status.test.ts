import { describe, it, expect } from "vitest";
import { parseChecks, formatStatus } from "../extensions/pr-status";

// ─── parseChecks ─────────────────────────────────────────────────────────────

describe("parseChecks", () => {
  it("returns zero-counts for empty input", () => {
    expect(parseChecks([])).toEqual({
      total: 0,
      pass: 0,
      fail: 0,
      pending: 0,
    });
  });

  it("skips ghost checks with no name, conclusion, or status", () => {
    const input = [
      { name: "", conclusion: "", status: "" },
      {},
      { name: "real", conclusion: "SUCCESS", status: "COMPLETED" },
    ];
    const result = parseChecks(input);
    expect(result.total).toBe(1);
  });

  it("counts SUCCESS as pass", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "SUCCESS", status: "COMPLETED" }]),
    ).toMatchObject({ total: 1, pass: 1, fail: 0, pending: 0 });
  });

  it("counts NEUTRAL as pass", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "NEUTRAL", status: "COMPLETED" }]),
    ).toMatchObject({ total: 1, pass: 1 });
  });

  it("counts SKIPPED as pass", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "SKIPPED", status: "COMPLETED" }]),
    ).toMatchObject({ total: 1, pass: 1 });
  });

  it("counts FAILURE as fail", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "FAILURE", status: "COMPLETED" }]),
    ).toMatchObject({ total: 1, pass: 0, fail: 1 });
  });

  it("counts TIMED_OUT as fail", () => {
    expect(
      parseChecks([
        { name: "ci", conclusion: "TIMED_OUT", status: "COMPLETED" },
      ]),
    ).toMatchObject({ fail: 1 });
  });

  it("counts CANCELLED as fail", () => {
    expect(
      parseChecks([
        { name: "ci", conclusion: "CANCELLED", status: "COMPLETED" },
      ]),
    ).toMatchObject({ fail: 1 });
  });

  it("counts ACTION_REQUIRED as fail", () => {
    expect(
      parseChecks([
        { name: "ci", conclusion: "ACTION_REQUIRED", status: "COMPLETED" },
      ]),
    ).toMatchObject({ fail: 1 });
  });

  it("counts QUEUED as pending", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "", status: "QUEUED" }]),
    ).toMatchObject({ total: 1, pending: 1 });
  });

  it("counts IN_PROGRESS as pending", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "", status: "IN_PROGRESS" }]),
    ).toMatchObject({ total: 1, pending: 1 });
  });

  it("counts WAITING as pending", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "", status: "WAITING" }]),
    ).toMatchObject({ total: 1, pending: 1 });
  });

  it("counts COMPLETED (no conclusion) as pass", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "", status: "COMPLETED" }]),
    ).toMatchObject({ total: 1, pass: 1 });
  });

  it("treats unknown conclusion/status as pending", () => {
    expect(
      parseChecks([{ name: "ci", conclusion: "WEIRD", status: "ODDBALL" }]),
    ).toMatchObject({ total: 1, pending: 1 });
  });

  it("accumulates multiple checks correctly", () => {
    const input = [
      { name: "lint", conclusion: "SUCCESS", status: "COMPLETED" },
      { name: "test", conclusion: "FAILURE", status: "COMPLETED" },
      { name: "deploy", conclusion: "", status: "IN_PROGRESS" },
    ];
    const result = parseChecks(input);
    expect(result).toEqual({
      total: 3,
      pass: 1,
      fail: 1,
      pending: 1,
    });
  });

  it("handles case-insensitive conclusion/status values", () => {
    const input = [
      { name: "a", conclusion: "success", status: "completed" },
      { name: "b", conclusion: "failure", status: "completed" },
    ];
    const result = parseChecks(input);
    expect(result).toEqual({ total: 2, pass: 1, fail: 1, pending: 0 });
  });
});

// ─── formatStatus ────────────────────────────────────────────────────────────

describe("formatStatus", () => {
  it("shows green dot for OPEN pr", () => {
    const pr = {
      number: 42,
      title: "Fix stuff",
      url: "https://github.com/owner/repo/pull/42",
      state: "OPEN",
      checks: { total: 0, pass: 0, fail: 0, pending: 0 },
      unresolvedThreads: 0,
    };
    expect(formatStatus(pr)).toContain("🟢");
  });

  it("shows purple dot for MERGED pr", () => {
    const pr = {
      number: 42,
      title: "Fix stuff",
      url: "https://github.com/owner/repo/pull/42",
      state: "MERGED",
      checks: { total: 0, pass: 0, fail: 0, pending: 0 },
      unresolvedThreads: 0,
    };
    expect(formatStatus(pr)).toContain("🟣");
  });

  it("shows red dot for CLOSED pr", () => {
    const pr = {
      number: 42,
      title: "Fix stuff",
      url: "https://github.com/owner/repo/pull/42",
      state: "CLOSED",
      checks: { total: 0, pass: 0, fail: 0, pending: 0 },
      unresolvedThreads: 0,
    };
    expect(formatStatus(pr)).toContain("🔴");
  });

  it("includes linked PR number with OSC 8 hyperlink", () => {
    const pr = {
      number: 99,
      title: "Update deps",
      url: "https://github.com/owner/repo/pull/99",
      state: "OPEN",
      checks: { total: 0, pass: 0, fail: 0, pending: 0 },
      unresolvedThreads: 0,
    };
    const output = formatStatus(pr);
    expect(output).toContain("PR #99");
    // OSC 8 uses ESC ]8;; and ESC \\ terminators
    const esc = String.fromCharCode(27);
    expect(output).toContain(
      `${esc}]8;;https://github.com/owner/repo/pull/99${esc}\\`,
    );
  });

  it("shows checkmark when all checks pass", () => {
    const pr = {
      number: 1,
      title: "All green",
      url: "https://github.com/owner/repo/pull/1",
      state: "OPEN",
      checks: { total: 3, pass: 3, fail: 0, pending: 0 },
      unresolvedThreads: 0,
    };
    expect(formatStatus(pr)).toContain("✅");
  });

  it("shows fail count and ❌ when any check fails", () => {
    const pr = {
      number: 1,
      title: "Some broken",
      url: "https://github.com/owner/repo/pull/1",
      state: "OPEN",
      checks: { total: 3, pass: 1, fail: 2, pending: 0 },
      unresolvedThreads: 0,
    };
    const output = formatStatus(pr);
    expect(output).toContain("❌");
    expect(output).toContain("2 fail");
  });

  it("shows hourglass when checks are pending (and none fail)", () => {
    const pr = {
      number: 1,
      title: "Waiting",
      url: "https://github.com/owner/repo/pull/1",
      state: "OPEN",
      checks: { total: 2, pass: 0, fail: 0, pending: 2 },
      unresolvedThreads: 0,
    };
    expect(formatStatus(pr)).toContain("⏳");
  });

  it("shows unresolved thread count", () => {
    const pr = {
      number: 5,
      title: "Discuss me",
      url: "https://github.com/owner/repo/pull/5",
      state: "OPEN",
      checks: { total: 0, pass: 0, fail: 0, pending: 0 },
      unresolvedThreads: 3,
    };
    const output = formatStatus(pr);
    expect(output).toContain("💬");
    expect(output).toContain("3");
  });

  it("combines state, checks, and threads with separator", () => {
    const pr = {
      number: 10,
      title: "Complex PR",
      url: "https://github.com/owner/repo/pull/10",
      state: "OPEN",
      checks: { total: 2, pass: 2, fail: 0, pending: 0 },
      unresolvedThreads: 1,
    };
    const output = formatStatus(pr);
    expect(output).toContain("🟢");
    expect(output).toContain("✅");
    expect(output).toContain("💬 1");
    // Verify separator character
    expect(output).toContain(" · ");
  });
});
