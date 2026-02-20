import { useState } from "react";
import { CheckCircle2, XCircle, Circle, Loader2, ChevronDown } from "lucide-react";
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

function TestStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-destructive shrink-0" />;
    default:
      return <Circle className="h-3 w-3 text-muted-foreground shrink-0" />;
  }
}

export function TestResultsBanner({ results }: Props) {
  const { passed, failed, total, testDetails, streaming } = results;
  const [expanded, setExpanded] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  if (total === 0 && !streaming) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-border bg-muted/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Circle className="h-3 w-3" />
          <span>No tests found</span>
        </div>
      </div>
    );
  }

  const allPassed = failed === 0 && !streaming;
  const borderColor = allPassed ? "border-emerald-500/30" : "border-destructive/30";
  const bgColor = allPassed ? "bg-emerald-500/5" : "bg-destructive/5";
  const textColor = allPassed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";

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
        {streaming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
        ) : allPassed ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>
          {streaming
            ? `Running tests... ${passed} passed${failed > 0 ? `, ${failed} failed` : ""}`
            : allPassed
              ? `All ${total} tests passed`
              : `Tests: ${passed}/${total} passed, ${failed} failed`}
        </span>
        {results.duration > 0 && !streaming && (
          <span className="opacity-60 ml-auto">{(results.duration / 1000).toFixed(1)}s</span>
        )}
        {streaming && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-amber-400" />
        )}
        {testDetails && testDetails.length > 0 && !streaming && (
          <ChevronDown className={`ml-2 h-3.5 w-3.5 opacity-50 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {/* Per-test checklist */}
      {expanded && testDetails && testDetails.length > 0 && (
        <div className="mt-3 space-y-2">
          {Array.from(suiteGroups.entries()).map(([suite, tests]) => {
            const suiteName = suite.split("/").pop() || suite;

            return (
              <div key={suite}>
                <div className="text-[10px] text-muted-foreground font-medium mb-1 truncate" title={suite}>
                  {suiteName}
                </div>
                <div className="space-y-0.5 ml-2">
                  {tests.map((test, i) => (
                    <div key={`${test.name}-${i}`}>
                      <button
                        onClick={() => test.error ? setExpandedError(expandedError === `${suite}-${i}` ? null : `${suite}-${i}`) : undefined}
                        className={`flex items-center gap-1.5 text-xs w-full text-left ${
                          test.error ? "cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1" : ""
                        }`}
                      >
                        <TestStatusIcon status={test.status} />
                        <span className={test.status === "passed" ? "text-muted-foreground" : test.status === "failed" ? "text-destructive/80" : "text-muted-foreground/50"}>
                          {test.name}
                        </span>
                        {test.duration !== undefined && (
                          <span className="text-muted-foreground/50 ml-auto text-[10px] shrink-0">{test.duration}ms</span>
                        )}
                      </button>
                      {expandedError === `${suite}-${i}` && test.error && (
                        <pre className="mt-1 ml-5 text-[10px] text-destructive/60 bg-destructive/5 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
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

      {/* Fallback: show failure list when testDetails is absent */}
      {!testDetails && results.failures.length > 0 && (
        <div className="mt-2 space-y-1">
          {results.failures.map((failure, i) => (
            <div key={i} className="text-xs">
              <button
                onClick={() => setExpandedError(expandedError === `legacy-${i}` ? null : `legacy-${i}`)}
                className="flex items-center gap-1.5 text-destructive/80 hover:text-destructive transition-colors w-full text-left"
              >
                <XCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">{failure.name}</span>
                <ChevronDown className={`ml-auto h-3 w-3 opacity-50 shrink-0 transition-transform ${expandedError === `legacy-${i}` ? "rotate-180" : ""}`} />
              </button>
              {expandedError === `legacy-${i}` && (
                <pre className="mt-1 ml-4 text-[10px] text-destructive/60 bg-destructive/5 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
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
