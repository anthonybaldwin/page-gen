import { useState } from "react";

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
}

interface Props {
  results: TestResults;
}

export function TestResultsBanner({ results }: Props) {
  const { passed, failed, total, failures } = results;
  const [expandedFailure, setExpandedFailure] = useState<number | null>(null);

  if (total === 0) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="text-zinc-500">&#x25CB;</span>
          <span>No tests found</span>
        </div>
      </div>
    );
  }

  if (failed === 0) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-green-800/50 bg-green-900/20 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-green-300">
          <span className="text-green-400">&#x2713;</span>
          <span>All {total} tests passed</span>
          {results.duration > 0 && (
            <span className="text-green-400/60 ml-auto">{(results.duration / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-red-300">
        <span className="text-red-400">&#x2717;</span>
        <span>
          Tests: {passed}/{total} passed, {failed} failed
        </span>
        {results.duration > 0 && (
          <span className="text-red-400/60 ml-auto">{(results.duration / 1000).toFixed(1)}s</span>
        )}
      </div>
      {failures.length > 0 && (
        <div className="mt-2 space-y-1">
          {failures.map((failure, i) => (
            <div key={i} className="text-xs">
              <button
                onClick={() => setExpandedFailure(expandedFailure === i ? null : i)}
                className="flex items-center gap-1.5 text-red-300/80 hover:text-red-200 transition-colors w-full text-left"
              >
                <span className="text-red-500 shrink-0">&#x2022;</span>
                <span className="truncate">{failure.name}</span>
                <span className="text-red-400/50 ml-auto shrink-0">
                  {expandedFailure === i ? "&#x25B4;" : "&#x25BE;"}
                </span>
              </button>
              {expandedFailure === i && (
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
