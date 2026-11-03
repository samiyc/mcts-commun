import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createAlive, nodeProcesses, pidsOfImage } from "../../node/processes.js";

const OTHER = process.ppid;
const DEAD = 2 ** 30;
const FRESH_MS = 30_000;

/** `createAlive` on a list that counts its calls, and a clock the test moves. */
function fixture(answer) {
  const state = { asked: 0, now: 1_000_000 };
  state.alive = createAlive(
    () => {
      state.asked += 1;
      return answer();
    },
    () => state.now,
  );
  return state;
}

describe("the processes behind the queue's pids", () => {
  it("reads tasklist's rows, whatever the system's language", () => {
    const listing = '"node.exe","16476","Console","1","80 000 Ko"\r\n"Node.EXE","2056","Console","1","12 Ko"\r\n"svchost.exe","25248","Services","0","43 100 Ko"\r\n';
    assert.deepEqual([...pidsOfImage(listing, "node.exe")], [16476, 2056]);
    assert.deepEqual([...pidsOfImage("Information : aucune tâche ne correspond aux critères.\r\n", "node.exe")], []);
  });

  it("reads the rows of ps", () => {
    assert.deepEqual([...pidsOfImage("    12 node\n 25248 sshd\n", "node")], [12]);
  });

  it("finds this very process among the machine's node processes", () => {
    assert.ok(nodeProcesses().has(process.pid));
  });

  it("answers for itself and for a dead pid without any list", () => {
    const state = fixture(() => new Set());
    assert.equal(state.alive(process.pid), true);
    assert.equal(state.alive(DEAD), false);
    assert.equal(state.asked, 0);
  });

  it("says no for a pid another program took, yes for a node process", () => {
    assert.equal(fixture(() => new Set()).alive(OTHER), false);
    assert.equal(fixture(() => new Set([OTHER])).alive(OTHER), true);
  });

  it("asks the machine once in a while: the runner's tick starts no process", () => {
    const stranger = fixture(() => new Set());
    stranger.alive(OTHER);
    stranger.alive(OTHER);
    assert.equal(stranger.asked, 1);
    stranger.now += FRESH_MS;
    stranger.alive(OTHER);
    assert.equal(stranger.asked, 2);

    const node = fixture(() => new Set([OTHER]));
    node.alive(OTHER);
    node.alive(OTHER);
    assert.equal(node.asked, 1);
    node.now += FRESH_MS;
    node.alive(OTHER);
    assert.equal(node.asked, 2);
  });

  it("sees a node process started since the last list, at once", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    const ended = new Promise((resolve) => child.once("exit", resolve));
    try {
      const lists = [new Set([OTHER]), new Set([OTHER, child.pid])];
      const state = fixture(() => lists.shift());
      assert.equal(state.alive(OTHER), true);
      assert.equal(state.alive(child.pid), true);
      assert.equal(state.asked, 2);
    } finally {
      child.kill();
      await ended;
    }
  });

  it("trusts the signal when the machine cannot tell, and leaves the list alone a while", () => {
    const state = fixture(() => null);
    assert.equal(state.alive(OTHER), true);
    assert.equal(state.alive(OTHER), true);
    assert.equal(state.alive(DEAD), false);
    assert.equal(state.asked, 1);
    state.now += FRESH_MS;
    state.alive(OTHER);
    assert.equal(state.asked, 2);
  });
});
