import { describe, expect, it } from "vitest";
import { scan } from "./engine";
import {
  type Network,
  blankNetwork,
  emptyCell,
  exampleNetworks,
  freshMemory,
  placeCell,
} from "./model";

function inputs(on: number[] = []): boolean[] {
  const bits = Array(10).fill(false);
  for (const index of on) bits[index] = true;
  return bits;
}

function put(network: Network, row: number, col: number, cell: ReturnType<typeof placeCell> | Network["cells"][number]) {
  network.cells[row * network.cols + col] = cell;
}

describe("drabinka", () => {
  it("szereg styku NO zasila cewkę", () => {
    const network = blankNetwork("and", 1, 3);
    put(network, 0, 0, { ...placeCell("no", false), op: { type: "bit", addr: { area: "I", index: 0 } } });
    put(network, 0, 1, { ...placeCell("no", false), op: { type: "bit", addr: { area: "I", index: 1 } } });
    put(network, 0, 2, { ...placeCell("coil", false), op: { type: "bit", addr: { area: "Q", index: 0 } } });

    const off = scan([network], freshMemory(), inputs([0]));
    expect(off.memory.Q[0]).toBe(false);

    const on = scan([network], freshMemory(), inputs([0, 1]));
    expect(on.memory.Q[0]).toBe(true);
  });

  it("styk NC przewodzi przy zerze i rozłącza przy jedynce", () => {
    const network = blankNetwork("nc", 1, 2);
    put(network, 0, 0, { ...placeCell("nc", false), op: { type: "bit", addr: { area: "I", index: 0 } } });
    put(network, 0, 1, { ...placeCell("coil", false), op: { type: "bit", addr: { area: "Q", index: 0 } } });

    expect(scan([network], freshMemory(), inputs()).memory.Q[0]).toBe(true);
    expect(scan([network], freshMemory(), inputs([0])).memory.Q[0]).toBe(false);
  });

  it("gałąź sumuje dwa styki", () => {
    const network = blankNetwork("or", 2, 2);
    put(network, 0, 0, {
      ...placeCell("no", true),
      op: { type: "bit", addr: { area: "I", index: 0 } },
    });
    put(network, 1, 0, { ...placeCell("no", false), op: { type: "bit", addr: { area: "I", index: 1 } } });
    put(network, 0, 1, { ...placeCell("coil", false), op: { type: "bit", addr: { area: "Q", index: 0 } } });

    expect(scan([network], freshMemory(), inputs([1])).memory.Q[0]).toBe(true);
    expect(scan([network], freshMemory(), inputs([0])).memory.Q[0]).toBe(true);
    expect(scan([network], freshMemory(), inputs()).memory.Q[0]).toBe(false);
  });

  it("przykład zatrzasku trzyma się po puszczeniu startu i puszcza na stopie", () => {
    const [latch] = exampleNetworks();
    let memory = freshMemory();

    memory = scan([latch], memory, inputs([0])).memory;
    expect(memory.Q[0]).toBe(true);
    expect(memory.M[0]).toBe(true);

    memory = scan([latch], memory, inputs()).memory;
    expect(memory.Q[0]).toBe(true);
    expect(memory.M[0]).toBe(true);

    memory = scan([latch], memory, inputs([1])).memory;
    expect(memory.Q[0]).toBe(false);
    expect(memory.M[0]).toBe(false);
  });

  it("cewka S zostawia bit, cewka R go kasuje", () => {
    const setNet = blankNetwork("set", 1, 2);
    put(setNet, 0, 0, { ...placeCell("no", false), op: { type: "bit", addr: { area: "I", index: 0 } } });
    put(setNet, 0, 1, { ...placeCell("set", false), op: { type: "bit", addr: { area: "M", index: 2 } } });
    const resetNet = blankNetwork("reset", 1, 2);
    put(resetNet, 0, 0, { ...placeCell("no", false), op: { type: "bit", addr: { area: "I", index: 1 } } });
    put(resetNet, 0, 1, { ...placeCell("reset", false), op: { type: "bit", addr: { area: "M", index: 2 } } });

    let memory = scan([setNet, resetNet], freshMemory(), inputs([0])).memory;
    expect(memory.M[2]).toBe(true);
    memory = scan([setNet, resetNet], memory, inputs()).memory;
    expect(memory.M[2]).toBe(true);
    memory = scan([setNet, resetNet], memory, inputs([1])).memory;
    expect(memory.M[2]).toBe(false);
  });

  it("styk P przewodzi tylko w cyklu zbocza", () => {
    const network = blankNetwork("edge", 1, 2);
    put(network, 0, 0, { ...placeCell("p", false), op: { type: "bit", addr: { area: "I", index: 0 } } });
    put(network, 0, 1, { ...placeCell("coil", false), op: { type: "bit", addr: { area: "Q", index: 4 } } });

    let memory = freshMemory();
    memory = scan([network], memory, inputs([0])).memory;
    expect(memory.Q[4]).toBe(true);
    memory = scan([network], memory, inputs([0])).memory;
    expect(memory.Q[4]).toBe(false);
    memory = scan([network], memory, inputs()).memory;
    memory = scan([network], memory, inputs([0])).memory;
    expect(memory.Q[4]).toBe(true);
  });

  it("CTU liczy zbocza, trzyma Q i zeruje się z R", () => {
    const [, counterNet] = exampleNetworks();
    let memory = freshMemory();

    const pulse = (high: boolean) => {
      memory = scan([counterNet], memory, inputs(high ? [2] : [])).memory;
    };

    pulse(true);
    expect(memory.counters[0].cv).toBe(1);
    pulse(true);
    expect(memory.counters[0].cv).toBe(1);
    pulse(false);
    pulse(true);
    pulse(false);
    pulse(true);
    expect(memory.counters[0].cv).toBe(3);
    expect(memory.counters[0].q).toBe(true);
    expect(memory.Q[1]).toBe(true);

    pulse(false);
    expect(memory.Q[1]).toBe(true);

    memory = scan([counterNet], memory, inputs([3])).memory;
    expect(memory.counters[0].cv).toBe(0);
    expect(memory.Q[1]).toBe(false);
  });

  it("wyjście bez cewki gaśnie", () => {
    const memory = freshMemory();
    memory.Q[3] = true;
    const network = blankNetwork("pusta", 1, 1);
    network.cells[0] = emptyCell();
    expect(scan([network], memory, inputs()).memory.Q[3]).toBe(false);
  });

  it("CTD ładuje PV i odlicza do zera", () => {
    const network = blankNetwork("ctd", 1, 3);
    put(network, 0, 0, { ...placeCell("no", false), op: { type: "bit", addr: { area: "I", index: 0 } } });
    network.cells[1] = {
      ...placeCell("ctd", false),
      counter: 1,
      pv: 2,
      aux: { area: "I", index: 1 },
    };
    put(network, 0, 2, { ...placeCell("coil", false), op: { type: "bit", addr: { area: "Q", index: 2 } } });

    let memory = scan([network], freshMemory(), inputs([1])).memory;
    expect(memory.counters[1].cv).toBe(2);
    expect(memory.Q[2]).toBe(false);

    memory = scan([network], memory, inputs([0])).memory;
    expect(memory.counters[1].cv).toBe(1);
    memory = scan([network], memory, inputs()).memory;
    memory = scan([network], memory, inputs([0])).memory;
    expect(memory.counters[1].cv).toBe(0);
    expect(memory.Q[2]).toBe(true);
  });
});

const I = (index: number) => ({ type: "bit" as const, addr: { area: "I" as const, index } });
const Qb = (index: number) => ({ type: "bit" as const, addr: { area: "Q" as const, index } });

/** I0 → timer → Q0. Zwraca kolejne wartości Q0 dla listy stanów I0, dt = 50 ms. */
function runTimer(kind: "ton" | "tof" | "tp", pv: number, input: boolean[]): boolean[] {
  const network = blankNetwork(kind, 1, 3);
  network.cells[0] = { ...placeCell("no", false), op: I(0) };
  network.cells[1] = { ...placeCell(kind, false), pv, timer: 2 };
  network.cells[2] = { ...placeCell("coil", false), op: Qb(0) };
  let memory = freshMemory();
  return input.map((on) => {
    memory = scan([network], memory, inputs(on ? [0] : []), 50).memory;
    return memory.Q[0];
  });
}

const rep = (v: boolean, n: number) => Array(n).fill(v) as boolean[];

describe("timery", () => {
  it("TON załącza po PT i gaśnie od razu po zaniku IN", () => {
    // PT = 100 ms = 2 cykle po cyklu zbocza
    const q = runTimer("ton", 100, [...rep(true, 4), false, true, false]);
    expect(q).toEqual([false, false, true, true, false, false, false]);
  });

  it("TON przerwany przed PT nie załącza się", () => {
    const q = runTimer("ton", 200, [true, true, true, false, true, true, true, false]);
    expect(q.every((v) => v === false)).toBe(true);
  });

  it("TOF trzyma Q przez PT po zaniku IN", () => {
    const q = runTimer("tof", 100, [false, true, true, false, false, false, false]);
    expect(q).toEqual([false, true, true, true, true, false, false]);
  });

  it("TOF: ponowne zasilenie w trakcie odliczania zeruje opóźnienie", () => {
    const q = runTimer("tof", 150, [true, false, false, true, false, false, false, false]);
    expect(q).toEqual([true, true, true, true, true, true, true, false]);
  });

  it("TP daje impuls PT i ignoruje zbocze w trakcie impulsu", () => {
    // PT = 100 ms: impuls trwa 2 cykle; zbocze w 3. cyklu (w trakcie impulsu) nie startuje nowego,
    // a przytrzymane IN po końcu impulsu też nie, dopiero nowe zbocze w 7. cyklu.
    const q = runTimer("tp", 100, [true, false, true, true, true, false, true]);
    expect(q).toEqual([true, true, false, false, false, false, true]);
  });

  it("styk T·Q odczytuje wyjście timera", () => {
    const network = blankNetwork("tq", 1, 3);
    network.cells[0] = { ...placeCell("no", false), op: I(0) };
    network.cells[1] = { ...placeCell("ton", false), pv: 0, timer: 3 };
    network.cells[2] = { ...placeCell("coil", false), op: { type: "bit", addr: { area: "M", index: 0 } } };
    const second = blankNetwork("use", 1, 2);
    second.cells[0] = { ...placeCell("no", false), op: { type: "tq", id: 3 } };
    second.cells[1] = { ...placeCell("coil", false), op: Qb(1) };
    const r = scan([network, second], freshMemory(), inputs([0]), 50);
    expect(r.memory.Q[1]).toBe(true);
  });

  it("czas upływa zgodnie z dt, a nie z liczbą cykli", () => {
    const network = blankNetwork("dt", 1, 3);
    network.cells[0] = { ...placeCell("no", false), op: I(0) };
    network.cells[1] = { ...placeCell("ton", false), pv: 1000 };
    network.cells[2] = { ...placeCell("coil", false), op: Qb(0) };
    let memory = scan([network], freshMemory(), inputs([0]), 50).memory;
    memory = scan([network], memory, inputs([0]), 500).memory;
    expect(memory.Q[0]).toBe(false);
    memory = scan([network], memory, inputs([0]), 500).memory;
    expect(memory.Q[0]).toBe(true);
    expect(memory.timers[0].et).toBe(1000);
  });
});

describe("CTUD", () => {
  function build(pv: number) {
    const network = blankNetwork("ctud", 1, 3);
    network.cells[0] = { ...placeCell("no", false), op: I(0) }; // CU
    network.cells[1] = {
      ...placeCell("ctud", false),
      counter: 4,
      pv,
      aux: { area: "I", index: 1 }, // CD
      aux2: { area: "I", index: 2 }, // R
      aux3: { area: "I", index: 3 }, // LD
    };
    network.cells[2] = { ...placeCell("coil", false), op: Qb(0) };
    return network;
  }
  const step = (n: Network, m: ReturnType<typeof freshMemory>, on: number[]) => scan([n], m, inputs(on)).memory;

  it("liczy w górę i w dół na zboczach, QU przy CV ≥ PV", () => {
    const n = build(2);
    let m = freshMemory();
    m = step(n, m, [0]); m = step(n, m, []);
    expect(m.counters[4].cv).toBe(1);
    m = step(n, m, [0]); m = step(n, m, []);
    expect(m.counters[4].cv).toBe(2);
    expect(m.Q[0]).toBe(true);
    m = step(n, m, [1]); m = step(n, m, []);
    expect(m.counters[4].cv).toBe(1);
    expect(m.Q[0]).toBe(false);
  });

  it("przytrzymane CU liczy tylko raz", () => {
    const n = build(5);
    let m = freshMemory();
    for (let i = 0; i < 5; i++) m = step(n, m, [0]);
    expect(m.counters[4].cv).toBe(1);
  });

  it("zbocza CU i CD w tym samym cyklu znoszą się", () => {
    const n = build(5);
    const m = step(n, freshMemory(), [0, 1]);
    expect(m.counters[4].cv).toBe(0);
  });

  it("R zeruje, LD ładuje PV, R ma pierwszeństwo", () => {
    const n = build(3);
    let m = step(n, freshMemory(), [3]);
    expect(m.counters[4].cv).toBe(3);
    expect(m.Q[0]).toBe(true);
    m = step(n, m, [2, 3]);
    expect(m.counters[4].cv).toBe(0);
  });

  it("CV schodzi poniżej zera, a QD (CV ≤ 0) jest dostępne stykiem", () => {
    const n = build(5);
    let m = step(n, freshMemory(), [1]);
    expect(m.counters[4].cv).toBe(-1);
    expect(m.counters[4].qd).toBe(true);
    m = step(n, m, [2]);
    expect(m.counters[4].cv).toBe(0);
  });
});
