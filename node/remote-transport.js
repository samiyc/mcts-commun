import { spawn } from "node:child_process";
import { cp, mkdir, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * How `mcts-backlog` reaches another machine (Sami, 26/10/2026: a rented server, the laptop; docs/distant.md). A
 * machine of `~/.mcts-backlog/machines.json` is reached by ssh (`{ ssh: "root@IP", key: "~/.ssh/mcts_cloud", dir:
 * "mcts" }`) or, for the tests and a shared disk, by a folder (`{ folder: "D:/autre" }`). Both answer the same:
 *
 *   run(command)            a shell command in the machine's folder: `{ code, stdout, stderr }`
 *   start(command)          the same, left running after this process ends (the remote runner)
 *   send(local, name)       a local folder copied to `<dir>/<name>`, without node_modules, .git, logs, tmp, coverage
 *   fetch(relative, local)  `<dir>/<relative>` copied to `<local>/<relative>`
 *   link(project)           `<project>/node_modules/mcts-commun` pointed at the mcts-commun sent beside it
 *
 * No secret here: ssh reads the key the person made; the server is created and deleted by them (docs/distant.md).
 */
export const LEFT_OUT = ["node_modules", ".git", "logs", "tmp", "coverage"];

/**
 * Runs `command` with `args`, its input from `input` (a stream) if given: `{ code, stdout, stderr }`.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, shell?: boolean, input?: import("node:stream").Readable | null }} [options]
 */
function exec(command, args, { cwd, shell = false, input = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => (stderr += error.message));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input) input.pipe(child.stdin);
  });
}

/** A machine reached through a folder of this one: a shared disk, or the tests' stand-in for a server. */
function folderTransport(machine) {
  const root = path.resolve(machine.folder);
  const exists = (file) => stat(file).then(() => true, () => false);
  return {
    describe: root,
    run: (command) => exec(command, [], { cwd: root, shell: true }),
    async start(command) {
      spawn(command, [], { cwd: root, shell: true, detached: true, stdio: "ignore", windowsHide: true }).unref();
    },
    async send(local, name) {
      await mkdir(root, { recursive: true });
      await cp(local, path.join(root, name), { recursive: true, filter: (source) => !LEFT_OUT.includes(path.basename(source)) });
    },
    async fetch(relative, local) {
      if (await exists(path.join(root, relative))) await cp(path.join(root, relative), path.join(local, relative), { recursive: true });
    },
    async link(project) {
      const link = path.join(root, project, "node_modules", "mcts-commun");
      await mkdir(path.dirname(link), { recursive: true });
      await rm(link, { recursive: true, force: true });
      await symlink(path.join(root, "mcts-commun"), link, "junction");
    },
  };
}

/** `text` quoted for a POSIX shell. */
const quote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
/** ssh and tar from the system's own folder, never from PATH: Windows' OpenSSH and bsdtar, or /usr/bin. */
const WINDOWS = process.env.SystemRoot ?? "C:/Windows";
const SYSTEM = process.platform === "win32" ? { ssh: path.join(WINDOWS, "System32", "OpenSSH", "ssh.exe"), tar: path.join(WINDOWS, "System32", "tar.exe") } : { ssh: "/usr/bin/ssh", tar: "/usr/bin/tar" };
const expandHome = (file) => (file.startsWith("~") ? path.join(os.homedir(), file.slice(1)) : file);

/** A machine reached by ssh and tar (OpenSSH and tar come with Windows 10 and later). */
function sshTransport(machine) {
  const dir = machine.dir ?? "mcts";
  const target = ["-o", "BatchMode=yes", ...(machine.key ? ["-i", expandHome(machine.key)] : []), machine.ssh];
  const ssh = (command, input) => exec(SYSTEM.ssh, [...target, command], { input });
  const excluded = LEFT_OUT.flatMap((name) => ["--exclude", name]);
  return {
    describe: `${machine.ssh}:${dir}`,
    run: (command) => ssh(`mkdir -p ${quote(dir)} && cd ${quote(dir)} && ${command}`),
    start: (command) => ssh(`cd ${quote(dir)} && nohup sh -c ${quote(command)} > /dev/null 2>&1 &`),
    async send(local, name) {
      const tar = spawn(SYSTEM.tar, ["-czf", "-", ...excluded, "-C", path.dirname(local), path.basename(local)], { windowsHide: true });
      const result = await ssh(`mkdir -p ${quote(dir)} && tar -xzf - -C ${quote(dir)}`, tar.stdout);
      if (result.code !== 0) throw new Error(`envoi de ${name} : ${result.stderr.trim()}`);
    },
    async fetch(relative, local) {
      await mkdir(local, { recursive: true });
      const remote = spawn(SYSTEM.ssh, [...target, `cd ${quote(dir)} && test -e ${quote(relative)} && tar -czf - ${quote(relative)} || true`], { windowsHide: true });
      const result = await exec(SYSTEM.tar, ["-xzf", "-", "-C", local], { input: remote.stdout });
      if (result.code !== 0 && !/empty|Unrecognized archive/i.test(result.stderr)) throw new Error(`rapatriement de ${relative} : ${result.stderr.trim()}`);
    },
    async link(project) {
      const modules = `${project}/node_modules`;
      const result = await ssh(`cd ${quote(dir)} && mkdir -p ${quote(modules)} && ln -sfn ../../mcts-commun ${quote(modules + "/mcts-commun")}`);
      if (result.code !== 0) throw new Error(`lien de ${project} : ${result.stderr.trim()}`);
    },
  };
}

/** The transport of machine `name` as machines.json describes it. */
export function transportOf(machine, name) {
  if (machine?.folder) return folderTransport(machine);
  if (machine?.ssh) return sshTransport(machine);
  throw new Error(`machine ${name} : ni « ssh » ni « folder » dans machines.json`);
}
