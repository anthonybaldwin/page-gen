import { useState } from "react";
import type { TestDetail } from "../../../shared/types.ts";

interface TestFailure {
  name: string;
  error: string;
}

interface TestResults {
  passed: number;
  failed: number;
  total: number;
  duration: number;
  failures: TestFailure[];
  testDetails?: TestDetail[];
  streaming?: boolean;
}

interface Props {
  results: TestResults;
}

const STATUS_ICON: Record<string, string> = {
  passed: "\u2713",   // ✓
  failed: "\u2717",   // ✗
  skipped: "\u25CB",  // ○
};

const STATUS_COLOR: Record<string, string> = {
  passed: "text-green-400",
  failed: "text-red-400",
  skipped: "text-zinc-500",
};

export function TestResultsBanner({ results }: Props) {
  const { passed, failed, total, testDetails, streaming } = results;
  const [expanded, setExpanded] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  if (total === 0 && !streaming) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="text-zinc-500">&#x25CB;</span>
          <span>No tests found</span>
        </div>
      </div>
    );
  }

  const allPassed = failed === 0 && !streaming;
  const borderColor = allPassed ? "border-green-800/50" : "border-red-800/50";
  const bgColor = allPassed ? "bg-green-900/20" : "bg-red-900/20";
  const textColor = allPassed ? "text-green-300" : "text-red-300";
  const accentColor = allPassed ? "text-green-400" : "text-red-400";

  // Group testDetails by suite
  const suiteGroups = new Map<string, TestDetail[]>();
  if (testDetails) {
    for (const detail of testDetails) {
      const existing = suiteGroups.get(detail.suite) || [];
      existing.push(detail);
      suiteGroups.set(detail.suite, existing);
    }
  }

  return (
    <div className={`mx-4 my-2 rounded-lg border ${borderColor} ${bgColor} px-4 py-3`}>
      {/* Summary header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 text-xs ${textColor} w-full text-left`}
      >
        <span className={accentColor}>
          {streaming ? "\u25CF" : allPassed ? "\u2713" : "\u2717"}
        </span>
        <span>
          {streaming
            ? `Running tests... ${passed} passed${failed > 0 ? `, ${failed} failed` : ""}`
            : allPassed
              ? `All ${total} tests passed`
              : `Tests: ${passed}/${total} passed, ${failed} failed`}
        </span>
        {results.duration > 0 && !streaming && (
          <span className={`${accentColor}/60 ml-auto`}>{(results.duration / 1000).toFixed(1)}s</span>
        )}
        {streaming && (
          <div className="ml-auto w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
        )}
        {testDetails && testDetails.length > 0 && !streaming && (
          <span className={`${accentColor}/50 ml-2 shrink-0`}>
            {expanded ? "\u25B4" : "\u25BE"}
          </span>
        )}
      </button>

      {/* Per-test checklist */}
      {expanded && testDetails && testDetails.length > 0 && (
        <div className="mt-3 space-y-2">
          {Array.from(suiteGroups.entries()).map(([suite, tests]) => {
            // Extract just the filename from the full path
            const suiteName = suite.split("/").pop() || suite;

            return (
              <div key={suite}>
                <div className="text-[10px] text-zinc-500 font-medium mb-1 truncate" title={suite}>
                  {suiteName}
                </div>
                <div className="space-y-0.5 ml-2">
                  {tests.map((test, i) => (
                    <div key={`${test.name}-${i}`}>
                      <button
                        onClick={() => test.error ? setExpandedError(expandedError === `${suite}-${i}` ? null : `${suite}-${i}`) : undefined}
                        className={`flex items-center gap-1.5 text-xs w-full text-left ${
                          test.error ? "cursor-pointer hover:bg-zinc-800/50 rounded px-1 -mx-1" : ""
                        }`}
                      >
                        <span className={`${STATUS_COLOR[test.status]} shrink-0`}>
                          {STATUS_ICON[test.status]}
                        </span>
                        <span className={test.status === "passed" ? "text-zinc-400" : test.status === "failed" ? "text-red-300/80" : "text-zinc-600"}>
                          {test.name}
                        </span>
                        {test.duration !== undefined && (
                          <span className="text-zinc-600 ml-auto text-[10px] shrink-0">{test.duration}ms</span>
                        )}
                      </button>
                      {expandedError === `${suite}-${i}` && test.error && (
                        <pre className="mt-1 ml-5 text-[10px] text-red-300/60 bg-red-950/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {test.error}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback: show failure list when testDetails is absent (backward compat) */}
      {!testDetails && results.failures.length > 0 && (
        <div className="mt-2 space-y-1">
          {results.failures.map((failure, i) => (
            <div key={i} className="text-xs">
              <button
                onClick={() => setExpandedError(expandedError === `legacy-${i}` ? null : `legacy-${i}`)}
                className="flex items-center gap-1.5 text-red-300/80 hover:text-red-200 transition-colors w-full text-left"
              >
                <span className="text-red-500 shrink-0">&#x2022;</span>
                <span className="truncate">{failure.name}</span>
                <span className="text-red-400/50 ml-auto shrink-0">
                  {expandedError === `legacy-${i}` ? "\u25B4" : "\u25BE"}
                </span>
              </button>
              {expandedError === `legacy-${i}` && (
                <pre className="mt-1 ml-4 text-[10px] text-red-300/60 bg-red-950/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {failure.error}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
