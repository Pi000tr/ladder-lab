import {
  type BitAddr,
  type Cell,
  type CellFlow,
  type Memory,
  type Network,
  type NetworkFlow,
  type Operand,
  COUNTER_COUNT,
  OUTPUT_COUNT,
  SCAN_MS,
  TIMER_COUNT,
} from "./model";

export function readBit(memory: Memory, addr: BitAddr): boolean {
  const bank = addr.area === "I" ? memory.I : addr.area === "Q" ? memory.Q : memory.M;
  return Boolean(bank[addr.index]);
}

export function readOperand(memory: Memory, op: Operand | null): boolean {
  if (!op) return false;
  if (op.type === "cq") {
    const c = memory.counters[op.id];
    return Boolean(op.down ? c?.qd : c?.q);
  }
  if (op.type === "tq") return Boolean(memory.timers[op.id]?.q);
  return readBit(memory, op.addr);
}

function writeBit(memory: Memory, addr: BitAddr, value: boolean) {
  if (addr.area === "I") return;
  const bank = addr.area === "Q" ? memory.Q : memory.M;
  if (addr.index >= 0 && addr.index < bank.length) bank[addr.index] = value;
}

function cloneMemory(memory: Memory): Memory {
  return {
    I: memory.I.slice(),
    Q: memory.Q.slice(),
    M: memory.M.slice(),
    counters: memory.counters.map((counter) => ({ ...counter })),
    timers: memory.timers.map((timer) => ({ ...timer })),
  };
}

function referencedOutputs(networks: Network[]): Set<number> {
  const used = new Set<number>();
  for (const network of networks) {
    for (const cell of network.cells) {
      if (cell.kind !== "coil" && cell.kind !== "set" && cell.kind !== "reset") continue;
      if (cell.op?.type === "bit" && cell.op.addr.area === "Q") used.add(cell.op.addr.index);
    }
  }
  return used;
}

interface EvalResult {
  pass: boolean;
  closed: boolean;
}

function evaluate(cell: Cell, left: boolean, memory: Memory, before: Memory, dt: number): EvalResult {
  switch (cell.kind) {
    case "empty":
      return { pass: false, closed: false };
    case "wire":
      return { pass: left, closed: true };
    case "no": {
      const closed = readOperand(memory, cell.op);
      return { pass: left && closed, closed };
    }
    case "nc": {
      const closed = !readOperand(memory, cell.op);
      return { pass: left && closed, closed };
    }
    case "p": {
      const closed = readOperand(memory, cell.op) && !readOperand(before, cell.op);
      return { pass: left && closed, closed };
    }
    case "n": {
      const closed = !readOperand(memory, cell.op) && readOperand(before, cell.op);
      return { pass: left && closed, closed };
    }
    case "coil": {
      if (cell.op?.type === "bit") writeBit(memory, cell.op.addr, left);
      return { pass: left, closed: left };
    }
    case "set": {
      if (left && cell.op?.type === "bit") writeBit(memory, cell.op.addr, true);
      return { pass: left, closed: left };
    }
    case "reset": {
      if (left && cell.op?.type === "bit") writeBit(memory, cell.op.addr, false);
      return { pass: left, closed: left };
    }
    case "ctu":
      return evalCtu(cell, left, memory);
    case "ctd":
      return evalCtd(cell, left, memory);
    case "ctud":
      return evalCtud(cell, left, memory);
    case "ton":
      return evalTon(cell, left, memory, dt);
    case "tof":
      return evalTof(cell, left, memory, dt);
    case "tp":
      return evalTp(cell, left, memory, dt);
    default:
      return { pass: false, closed: false };
  }
}

function counterOf(memory: Memory, id: number) {
  const index = Math.min(COUNTER_COUNT - 1, Math.max(0, id));
  return memory.counters[index];
}

function evalCtu(cell: Cell, left: boolean, memory: Memory): EvalResult {
  const counter = counterOf(memory, cell.counter);
  const reset = cell.aux ? readBit(memory, cell.aux) : false;
  if (reset) counter.cv = 0;
  else if (left && !counter.cuPrev) counter.cv = Math.min(9999, counter.cv + 1);
  counter.cuPrev = left;
  counter.q = counter.cv >= cell.pv;
  counter.qd = counter.cv <= 0;
  return { pass: counter.q, closed: counter.q };
}

function evalCtd(cell: Cell, left: boolean, memory: Memory): EvalResult {
  const counter = counterOf(memory, cell.counter);
  const load = cell.aux ? readBit(memory, cell.aux) : false;
  if (load) counter.cv = cell.pv;
  else if (left && !counter.cdPrev && counter.cv > 0) counter.cv -= 1;
  counter.cdPrev = left;
  counter.q = counter.cv <= 0;
  counter.qd = counter.q;
  return { pass: counter.q, closed: counter.q };
}

/**
 * CTUD (IEC 61131-3): zasilanie = CU, aux = CD, aux2 = R, aux3 = LD.
 * R ma pierwszeństwo przed LD. Zbocza CU i CD w tym samym cyklu znoszą się.
 * Wyjście przewodzące dalej to QU (CV ≥ PV); QD (CV ≤ 0) jest dostępne stykiem C·QD.
 */
function evalCtud(cell: Cell, left: boolean, memory: Memory): EvalResult {
  const counter = counterOf(memory, cell.counter);
  const cd = cell.aux ? readBit(memory, cell.aux) : false;
  const reset = cell.aux2 ? readBit(memory, cell.aux2) : false;
  const load = cell.aux3 ? readBit(memory, cell.aux3) : false;
  const cuEdge = left && !counter.cuPrev;
  const cdEdge = cd && !counter.cdPrev;
  if (reset) counter.cv = 0;
  else if (load) counter.cv = cell.pv;
  else if (cuEdge && !cdEdge) counter.cv = Math.min(9999, counter.cv + 1);
  else if (cdEdge && !cuEdge) counter.cv = Math.max(-9999, counter.cv - 1);
  counter.cuPrev = left;
  counter.cdPrev = cd;
  counter.q = counter.cv >= cell.pv;
  counter.qd = counter.cv <= 0;
  return { pass: counter.q, closed: counter.q };
}

function timerOf(memory: Memory, id: number) {
  return memory.timers[Math.min(TIMER_COUNT - 1, Math.max(0, id))];
}

/** TON: Q = 1, gdy IN trwa nieprzerwanie co najmniej PT. */
function evalTon(cell: Cell, left: boolean, memory: Memory, dt: number): EvalResult {
  const t = timerOf(memory, cell.timer);
  if (!left) {
    t.et = 0;
    t.q = false;
  } else {
    t.et = t.inPrev ? Math.min(cell.pv, t.et + dt) : 0;
    t.q = t.et >= cell.pv;
  }
  t.inPrev = left;
  return { pass: t.q, closed: t.q };
}

/** TOF: Q = 1 przy IN = 1 i jeszcze PT po zaniku IN. */
function evalTof(cell: Cell, left: boolean, memory: Memory, dt: number): EvalResult {
  const t = timerOf(memory, cell.timer);
  if (left) {
    t.et = 0;
    t.q = true;
  } else if (t.inPrev) {
    t.et = 0;
    t.q = cell.pv > 0;
  } else if (t.q) {
    t.et = Math.min(cell.pv, t.et + dt);
    if (t.et >= cell.pv) t.q = false;
  }
  t.inPrev = left;
  return { pass: t.q, closed: t.q };
}

/** TP: impuls PT od zbocza narastającego IN, bez retriggeru. */
function evalTp(cell: Cell, left: boolean, memory: Memory, dt: number): EvalResult {
  const t = timerOf(memory, cell.timer);
  if (t.q) {
    t.et = Math.min(cell.pv, t.et + dt);
    if (t.et >= cell.pv) t.q = false;
  } else if (left && !t.inPrev) {
    t.et = 0;
    t.q = cell.pv > 0;
  } else if (!left) {
    t.et = 0;
  }
  t.inPrev = left;
  return { pass: t.q, closed: t.q };
}

function scanNetwork(network: Network, memory: Memory, before: Memory, dt: number): NetworkFlow {
  const { rows, cols, cells } = network;
  const nodes = Array.from({ length: rows }, () => Array(cols + 1).fill(false));
  for (let row = 0; row < rows; row++) nodes[row][0] = true;

  const flows: CellFlow[] = cells.map(() => ({ left: false, right: false, closed: false }));

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const index = row * cols + col;
      const left = nodes[row][col];
      const result = evaluate(cells[index], left, memory, before, dt);
      nodes[row][col + 1] = result.pass;
      flows[index] = { left, right: result.pass, closed: result.closed };
    }

    let guard = 0;
    let changed = true;
    while (changed && guard++ < rows + 2) {
      changed = false;
      for (let row = 0; row < rows - 1; row++) {
        if (!cells[row * cols + col].branch) continue;
        const above = nodes[row][col + 1];
        const below = nodes[row + 1][col + 1];
        const merged = above || below;
        if (above !== merged || below !== merged) {
          nodes[row][col + 1] = merged;
          nodes[row + 1][col + 1] = merged;
          changed = true;
        }
      }
    }

    for (let row = 0; row < rows; row++) {
      flows[row * cols + col].right = nodes[row][col + 1];
    }
  }

  return { cells: flows, nodes };
}

export interface ScanResult {
  memory: Memory;
  flows: NetworkFlow[];
}

/**
 * Jeden cykl PLC: wejścia z obrazu, sieci od góry, cewki zapisują od razu.
 * `dtMs` to czas, który upłynął od poprzedniego cyklu (dla timerów).
 */
export function scan(networks: Network[], memory: Memory, inputs: boolean[], dtMs: number = SCAN_MS): ScanResult {
  const before = cloneMemory(memory);
  const next = cloneMemory(memory);
  next.I = inputs.slice(0, next.I.length);
  while (next.I.length < memory.I.length) next.I.push(false);

  const driven = referencedOutputs(networks);
  for (let index = 0; index < OUTPUT_COUNT; index++) {
    if (!driven.has(index)) next.Q[index] = false;
  }

  const flows = networks.map((network) => scanNetwork(network, next, before, dtMs));
  return { memory: next, flows };
}
