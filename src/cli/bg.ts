import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type SessionStatus = 'running' | 'completed' | 'failed' | 'stopped';

type BackgroundSession = {
  id: string;
  pid: number;
  command: string[];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  exitCode?: number | null;
  logPath: string;
};

function sessionsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
}

function sessionPath(id: string): string {
  return join(sessionsDir(), `${id}.json`);
}

function logPath(id: string): string {
  return join(sessionsDir(), `${id}.log`);
}

/** Let a detached child record its real exit status after the launcher exits. */
export function installBackgroundExitHandler(): void {
  const id = process.env.CLAUDE_CODE_BACKGROUND_SESSION;
  if (!id) return;
  process.on('exit', (code) => {
    try {
      const path = sessionPath(id);
      const session = JSON.parse(readFileSync(path, 'utf8')) as BackgroundSession;
      if (session.status !== 'stopped') {
        session.status = code === 0 ? 'completed' : 'failed';
        session.exitCode = code;
        session.updatedAt = new Date().toISOString();
        writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
      }
    } catch {
      // The registry may have been removed while the child was exiting.
    }
  });
}

async function save(session: BackgroundSession): Promise<void> {
  session.updatedAt = new Date().toISOString();
  const target = sessionPath(session.id);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

async function load(id: string): Promise<BackgroundSession | undefined> {
  try {
    return JSON.parse(await readFile(sessionPath(id), 'utf8')) as BackgroundSession;
  } catch {
    return undefined;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function refresh(session: BackgroundSession): Promise<BackgroundSession> {
  if (session.status === 'running' && !isRunning(session.pid)) {
    // A detached launcher cannot observe the child's exit event after it has
    // returned. Absence of an exit code therefore means the process ended and
    // is treated as completed; explicit non-zero codes remain failures.
    session.status = session.exitCode === undefined || session.exitCode === null || session.exitCode === 0 ? 'completed' : 'failed';
    await save(session);
  }
  return session;
}

async function allSessions(): Promise<BackgroundSession[]> {
  await mkdir(sessionsDir(), { recursive: true });
  const files = await readdir(sessionsDir());
  const sessions = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
    const id = file.slice(0, -'.json'.length);
    const session = await load(id);
    return session ? refresh(session) : undefined;
  }));
  return sessions.filter((session): session is BackgroundSession => session !== undefined)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function printError(message: string): void {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

async function startBackground(command: string[], cwd: string): Promise<BackgroundSession | undefined> {
  if (command.length === 0) return undefined;
  await mkdir(sessionsDir(), { recursive: true });
  const id = randomUUID();
  const now = new Date().toISOString();
  const session: BackgroundSession = {
    id,
    pid: 0,
    command,
    cwd,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    logPath: logPath(id),
  };
  // Pass an inherited file descriptor to the child. Closing a stream object
  // immediately after spawn can close the child's redirected handle on Windows.
  const outputFd = openSync(session.logPath, 'a');
  // Publish the record before spawning so even a fast-path child can update
  // its terminal status from the exit handler.
  await save(session);
  const cliEntry = process.argv[1] || join(process.cwd(), 'dist', 'cli.js');
  const child = spawn(process.execPath, [cliEntry, ...command], {
    cwd: session.cwd,
    detached: process.platform !== 'win32',
    env: { ...process.env, CLAUDE_CODE_BACKGROUND_SESSION: id },
    stdio: ['ignore', outputFd, outputFd],
  });
  child.on('error', (error) => {
    try { writeFileSync(session.logPath, `Background process error: ${error.message}\n`, { flag: 'a' }); } catch {}
  });
  // Keep the descriptor open in the launcher until it exits. On Windows,
  // closing it immediately after spawn can invalidate the inherited handle.
  session.pid = child.pid ?? 0;
  await save(session);
  child.unref();
  return session;
}

export async function handleBgFlag(args: string[]): Promise<void> {
  const command = args.filter((arg) => arg !== '--bg' && arg !== '--background');
  const session = await startBackground(command, process.cwd());
  if (!session) {
    printError('Background mode needs a Claude command, for example: claude --bg -p "run tests".');
    return;
  }
  console.log(JSON.stringify({ id: session.id, pid: session.pid, status: session.status }));
}

export async function psHandler(args: string[]): Promise<void> {
  const sessions = await allSessions();
  if (args.includes('--json')) {
    console.log(JSON.stringify(sessions));
    return;
  }
  if (sessions.length === 0) {
    console.log('No background sessions.');
    return;
  }
  console.log('ID                                   STATUS     PID    COMMAND');
  for (const session of sessions) {
    console.log(`${session.id}  ${session.status.padEnd(10)} ${String(session.pid).padEnd(6)} ${session.command.join(' ')}`);
  }
}

export async function logsHandler(id: string | undefined): Promise<void> {
  if (!id) return printError('Usage: claude logs <session-id>');
  const session = await load(id);
  if (!session) return printError(`Background session ${id} was not found.`);
  try {
    process.stdout.write(await readFile(session.logPath, 'utf8'));
  } catch {
    printError(`No log is available for background session ${id}.`);
  }
}

export async function attachHandler(id: string | undefined, follow = false): Promise<void> {
  if (!id) return printError('Usage: claude attach <session-id> [--follow]');
  const session = await load(id);
  if (!session) return printError(`Background session ${id} was not found.`);
  let offset = 0;
  const emitNewLog = async (): Promise<void> => {
    try {
      const content = await readFile(session.logPath, 'utf8');
      if (content.length > offset) process.stdout.write(content.slice(offset));
      offset = content.length;
    } catch {
      // The child may not have created its log yet.
    }
  };
  await emitNewLog();
  if (!follow) return;
  while (true) {
    const refreshed = await refresh((await load(id)) ?? session);
    await emitNewLog();
    if (refreshed.status !== 'running') return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function killHandler(id: string | undefined): Promise<void> {
  if (!id) return printError('Usage: claude stop <session-id>');
  const session = await load(id);
  if (!session) return printError(`Background session ${id} was not found.`);
  if (isRunning(session.pid)) {
    try {
      if (process.platform !== 'win32') {
        process.kill(-session.pid, 'SIGTERM');
      } else {
        // Windows has no POSIX process groups; taskkill /T recursively
        // terminates the detached CLI and every descendant it spawned.
        const result = spawnSync('taskkill', ['/PID', String(session.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        if (result.status !== 0) process.kill(session.pid, 'SIGTERM');
      }
    } catch {
      process.kill(session.pid, 'SIGTERM');
    }
  }
  await save({ ...session, status: 'stopped' });
  console.log(`Stopped ${id}.`);
}

export async function removeHandler(id: string | undefined): Promise<void> {
  if (!id) return printError('Usage: claude rm <session-id>');
  const session = await load(id);
  if (!session) return printError(`Background session ${id} was not found.`);
  if (isRunning(session.pid)) return printError(`Background session ${id} is still running; stop it first.`);
  await rm(sessionPath(id), { force: true });
  await rm(session.logPath, { force: true });
  console.log(`Removed ${id}.`);
}

export async function respawnHandler(id: string | undefined): Promise<void> {
  if (!id) return printError('Usage: claude respawn <session-id>');
  const previous = await load(id);
  if (!previous) return printError(`Background session ${id} was not found.`);
  if (isRunning(previous.pid)) return printError(`Background session ${id} is still running.`);
  const session = await startBackground(previous.command, previous.cwd);
  if (!session) return printError(`Background session ${id} has no command to restart.`);
  console.log(JSON.stringify({ id: session.id, respawnedFrom: id, pid: session.pid, status: session.status }));
}
