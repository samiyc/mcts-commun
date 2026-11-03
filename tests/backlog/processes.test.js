import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLiving, nodeProcesses, pidsOfImage } from "../../node/backlog/processes.js";

const STRANGER = process.ppid;
const FAR_PID = 2 ** 30;

describe("the processes behind the views' pids", () => {
  it("reads tasklist's rows, whatever the system's language", () => {
    const listing = '"node.exe","16476","Console","1","80 000 Ko"\r\n"Node.EXE","2056","Console","1","12 Ko"\r\n"svchost.exe","25248","Services","0","43 100 Ko"\r\n';
    assert.deepEqual([...pidsOfImage(listing, "node.exe")], [16476, 2056]);
    assert.deepEqual([...pidsOfImage("Information : aucune tâche ne correspond aux critères.\r\n", "node.exe")], []);
  });

  it("reads the rows of ps", () => {
    assert.deepEqual([...pidsOfImage("    12 node\n 25248 sshd\n", "node")], [12]);
  });

  it("finds this very process among the machine's node processes", async () => {
    assert.ok((await nodeProcesses()).has(process.pid));
  });

  it("drops a pid another program took: a process alive, but no runner (3/11/2026: a svchost shown as a runner)", async () => {
    const living = createLiving(async () => new Set([process.pid]));
    assert.deepEqual(await living([process.pid, STRANGER, FAR_PID]), [process.pid]);
  });

  it("asks the machine once for a pid, as long as it lives: the TUI's tick starts no process", async () => {
    let asked = 0;
    const living = createLiving(async () => {
      asked += 1;
      return new Set([process.pid]);
    });
    await living([process.pid, STRANGER]);
    assert.deepEqual(await living([process.pid, STRANGER]), [process.pid]);
    assert.equal(asked, 1);
    await living([FAR_PID]);
    assert.equal(asked, 1, "a dead pid needs no list");
  });

  it("keeps the pids alive when the machine cannot tell, and asks again", async () => {
    let asked = 0;
    const living = createLiving(async () => {
      asked += 1;
      return null;
    });
    assert.deepEqual(await living([process.pid, FAR_PID]), [process.pid]);
    await living([process.pid]);
    assert.equal(asked, 2);
  });
});
