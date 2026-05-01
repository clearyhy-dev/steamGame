import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function runCmd(
  cmd: string,
  args: string[],
  opts?: { maxBuffer?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const maxBuffer = opts?.maxBuffer ?? 1024 * 1024 * 80;
  try {
    return await execFileAsync(cmd, args, {
      maxBuffer,
      cwd: opts?.cwd,
      windowsHide: true,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const stderr = e.stderr?.toString() ?? '';
    const stdout = e.stdout?.toString() ?? '';
    throw new Error(`${cmd} failed: ${e.message ?? err}\n${stderr || stdout}`);
  }
}
