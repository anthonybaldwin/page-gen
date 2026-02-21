import { join } from "path";
import { SHELL_TIMEOUT_MS, SHELL_MAX_OUTPUT_LENGTH } from "../config/pipeline.ts";

const ALLOWED_COMMANDS = ["bun", "npm", "npx", "bunx", "ls", "cat", "echo", "mkdir"];

export async function runShellCommand(
  projectPath: string,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Validate the command is safe
  const firstWord = command.split(/\s+/)[0];
  if (!firstWord || !ALLOWED_COMMANDS.includes(firstWord)) {
    throw new Error(`Command not allowed: ${firstWord}. Allowed: ${ALLOWED_COMMANDS.join(", ")}`);
  }

  // Ensure we're running in the project directory
  const cwd = join(process.cwd(), projectPath);

  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => proc.kill(), SHELL_TIMEOUT_MS);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    clearTimeout(timeout);

    return {
      stdout: stdout.slice(0, SHELL_MAX_OUTPUT_LENGTH),
      stderr: stderr.slice(0, SHELL_MAX_OUTPUT_LENGTH),
      exitCode,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
