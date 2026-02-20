import { Database } from "bun:sqlite";
import { recomputeRowCost, type BillingLedgerCostRow } from "../services/billing-reconcile.ts";

interface CliOptions {
  dbPath?: string;
  apply: boolean;
  provider?: string;
  projectId?: string;
  chatId?: string;
  chatTitle?: string;
  model?: string;
  from?: number;
  to?: number;
  limit?: number;
  minDelta: number;
}

function printHelp() {
  console.log(`Recalculate billing_ledger.cost_estimate from current pricing settings.

Usage:
  bun run billing:reconcile [options]

Options:
  --apply                 Persist updated costs (default is dry-run)
  --db <path>             SQLite DB path (default: ./data/app.db)
  --provider <name>       Filter by provider (anthropic|openai|google|...)
  --projectId <id>        Filter by project ID
  --chatId <id>           Filter by chat ID
  --chatTitle <title>     Filter by chat title (exact match)
  --model <id>            Filter by model ID
  --from <msEpoch>        Filter created_at >= from
  --to <msEpoch>          Filter created_at <= to
  --limit <n>             Limit number of rows processed
  --min-delta <usd>       Only update rows with abs(delta) >= this value (default: 0.000001)
  --help                  Show this help

Examples:
  bun run billing:reconcile --projectId FceCywv9vPzIgFMfwZkhD
  bun run billing:reconcile --chatTitle "Calculator" --apply
`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    apply: false,
    minDelta: 0.000001,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--apply":
        opts.apply = true;
        break;
      case "--db":
        opts.dbPath = argv[++i];
        break;
      case "--provider":
        opts.provider = argv[++i];
        break;
      case "--projectId":
        opts.projectId = argv[++i];
        break;
      case "--chatId":
        opts.chatId = argv[++i];
        break;
      case "--chatTitle":
        opts.chatTitle = argv[++i];
        break;
      case "--model":
        opts.model = argv[++i];
        break;
      case "--from":
        opts.from = Number(argv[++i]);
        break;
      case "--to":
        opts.to = Number(argv[++i]);
        break;
      case "--limit":
        opts.limit = Number(argv[++i]);
        break;
      case "--min-delta":
        opts.minDelta = Number(argv[++i]);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dbPath) process.env.DB_PATH = opts.dbPath;

  // Dynamic import so DB_PATH override is applied before pricing module initializes DB.
  const { estimateCost } = await import("../services/pricing.ts");

  const dbPath = opts.dbPath || "./data/app.db";
  const sqlite = new Database(dbPath);

  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (opts.provider) {
    conditions.push("provider = ?");
    values.push(opts.provider);
  }
  if (opts.projectId) {
    conditions.push("project_id = ?");
    values.push(opts.projectId);
  }
  if (opts.chatId) {
    conditions.push("chat_id = ?");
    values.push(opts.chatId);
  }
  if (opts.chatTitle) {
    conditions.push("chat_title = ?");
    values.push(opts.chatTitle);
  }
  if (opts.model) {
    conditions.push("model = ?");
    values.push(opts.model);
  }
  if (opts.from !== undefined) {
    conditions.push("created_at >= ?");
    values.push(opts.from);
  }
  if (opts.to !== undefined) {
    conditions.push("created_at <= ?");
    values.push(opts.to);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const limit = opts.limit && Number.isFinite(opts.limit) ? `limit ${Math.max(1, Math.floor(opts.limit))}` : "";
  const sql = `
    select
      id,
      provider,
      model,
      input_tokens as inputTokens,
      output_tokens as outputTokens,
      total_tokens as totalTokens,
      coalesce(cache_creation_input_tokens, 0) as cacheCreationInputTokens,
      coalesce(cache_read_input_tokens, 0) as cacheReadInputTokens,
      cost_estimate as costEstimate
    from billing_ledger
    ${where}
    order by created_at asc
    ${limit}
  `;

  const rows = sqlite.query(sql).all(...values) as BillingLedgerCostRow[];
  if (rows.length === 0) {
    console.log("No billing_ledger rows matched filters.");
    return;
  }

  const updateStmt = sqlite.query("update billing_ledger set cost_estimate = ? where id = ?");
  const updates: Array<{ id: string; oldCost: number; newCost: number; delta: number }> = [];
  let unchanged = 0;

  for (const row of rows) {
    const newCost = recomputeRowCost(row, estimateCost);
    const delta = newCost - row.costEstimate;
    if (Math.abs(delta) < opts.minDelta) {
      unchanged++;
      continue;
    }
    updates.push({ id: row.id, oldCost: row.costEstimate, newCost, delta });
  }

  const totalOld = rows.reduce((sum, r) => sum + r.costEstimate, 0);
  const totalNew = rows.reduce((sum, r) => sum + recomputeRowCost(r, estimateCost), 0);
  const totalDelta = totalNew - totalOld;

  console.log(`Rows scanned: ${rows.length}`);
  console.log(`Rows changed (|delta| >= ${opts.minDelta}): ${updates.length}`);
  console.log(`Rows unchanged: ${unchanged}`);
  console.log(`Total old cost: $${totalOld.toFixed(6)}`);
  console.log(`Total new cost: $${totalNew.toFixed(6)}`);
  console.log(`Total delta: $${totalDelta.toFixed(6)}`);
  console.log(`Mode: ${opts.apply ? "APPLY" : "DRY-RUN"}`);

  if (updates.length > 0) {
    const sample = updates.slice(0, 10);
    console.log("Sample updates:");
    for (const u of sample) {
      console.log(`- ${u.id}: $${u.oldCost.toFixed(6)} -> $${u.newCost.toFixed(6)} (delta $${u.delta.toFixed(6)})`);
    }
    if (updates.length > sample.length) {
      console.log(`...and ${updates.length - sample.length} more`);
    }
  }

  if (!opts.apply || updates.length === 0) return;

  sqlite.exec("begin");
  try {
    for (const u of updates) {
      updateStmt.run(u.newCost, u.id);
    }
    sqlite.exec("commit");
  } catch (err) {
    sqlite.exec("rollback");
    throw err;
  }

  console.log(`Applied ${updates.length} billing_ledger cost updates.`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`billing:reconcile failed: ${message}`);
  process.exit(1);
});
