export const INPUT_COUNT = 10;
export const OUTPUT_COUNT = 10;
export const MARKER_COUNT = 64;
export const COUNTER_COUNT = 8;
export const TIMER_COUNT = 8;
export const MAX_PT_MS = 3_600_000;
export const MAX_ROWS = 10;
export const MAX_COLS = 12;
export const SCAN_MS = 50;

export type Area = "I" | "Q" | "M";

export interface BitAddr {
  area: Area;
  index: number;
}

export type Operand =
| { type: "bit"; addr: BitAddr }
| { type: "cq"; id: number; down?: boolean }
| { type: "tq"; id: number };

export type Kind =
| "empty"
| "wire"
| "no"
| "nc"
| "p"
| "n"
| "coil"
| "set"
| "reset"
| "ctu"
| "ctd"
| "ctud"
| "ton"
| "tof"
| "tp";

export interface Cell {
  kind: Kind;
  op: Operand | null;
  pv: number;
  /** CTU: R, CTD: LD, CTUD: CD. */
  aux: BitAddr | null;
  /** CTUD: R. */
  aux2: BitAddr | null;
  /** CTUD: LD. */
  aux3: BitAddr | null;
  counter: number;
  /** Numer timera (T0…) dla TON/TOF/TP. PT w ms trzymamy w `pv`. */
  timer: number;
  branch: boolean;
}

export interface Network {
  id: string;
  title: string;
  comment: string;
  rows: number;
  cols: number;
  cells: Cell[];
}

export interface CounterState {
  cv: number;
  q: boolean;
  /** CV ≤ 0 (wyjście QD licznika CTUD). */
  qd: boolean;
  cuPrev: boolean;
  cdPrev: boolean;
}

export interface TimerState {
  /** Czas, który upłynął (ms). */
  et: number;
  q: boolean;
  inPrev: boolean;
}

export interface Memory {
  I: boolean[];
  Q: boolean[];
  M: boolean[];
  counters: CounterState[];
  timers: TimerState[];
}

export interface CellFlow {
  left: boolean;
  right: boolean;
  /** Warunek elementu: styk zamknięty, cewka zasilona albo Q licznika. */
  closed: boolean;
}

export interface NetworkFlow {
  cells: CellFlow[];
  nodes: boolean[][];
}

export type Tool =
| "select"
| "no"
| "nc"
| "p"
| "n"
| "coil"
| "set"
| "reset"
| "ctu"
| "ctd"
| "ctud"
| "ton"
| "tof"
| "tp"
| "wire"
| "branch"
| "erase";

export type PlaceTool = Exclude<Tool, "select" | "branch" | "erase">;

export interface Selection {
  netId: string;
  index: number;
}

const KINDS: Kind[] = ["empty", "wire", "no", "nc", "p", "n", "coil", "set", "reset", "ctu", "ctd", "ctud", "ton", "tof", "tp"];

export function emptyCell(): Cell {
  return { kind: "empty", op: null, pv: 5, aux: null, aux2: null, aux3: null, counter: 0, timer: 0, branch: false };
}

export function freshMemory(): Memory {
  return {
    I: Array(INPUT_COUNT).fill(false),
    Q: Array(OUTPUT_COUNT).fill(false),
    M: Array(MARKER_COUNT).fill(false),
    counters: Array.from({ length: COUNTER_COUNT }, () => ({
      cv: 0,
      q: false,
      qd: false,
      cuPrev: false,
      cdPrev: false,
    })),
    timers: Array.from({ length: TIMER_COUNT }, () => ({ et: 0, q: false, inPrev: false })),
  };
}

export function bitLabel(addr: BitAddr): string {
  const byte = Math.floor(addr.index / 8);
  const bit = addr.index % 8;
  return `${addr.area}${byte}.${bit}`;
}

export function operandLabel(op: Operand | null): string {
  if (!op) return "—";
  if (op.type === "cq") return `C${op.id}.${op.down ? "QD" : "Q"}`;
  if (op.type === "tq") return `T${op.id}.Q`;
  return bitLabel(op.addr);
}

export function areaLimit(area: Area): number {
  if (area === "I") return INPUT_COUNT;
  if (area === "Q") return OUTPUT_COUNT;
  return MARKER_COUNT;
}

export function bit(area: Area, index: number): Operand {
  return { type: "bit", addr: { area, index } };
}

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "net-" + Math.random().toString(36).slice(2, 11) + "-" + Date.now().toString(36);
}

export function blankNetwork(title: string, rows = 2, cols = 6): Network {
  return {
    id: uid(),
    title,
    comment: "",
    rows,
    cols,
    cells: Array.from({ length: rows * cols }, emptyCell),
  };
}

function cell(partial: Partial<Cell>): Cell {
  return { ...emptyCell(), ...partial };
}

export function exampleNetworks(): Network[] {
  const latch = blankNetwork("Zatrzask start–stop", 2, 6);
  latch.id = "example-latch";
  latch.comment = "I0.0 start (najlepiej IMP), I0.1 stop, M0.0 trzyma obwód, Q0.0 to lampa.";
  latch.cells = Array.from({ length: 12 }, emptyCell);
  latch.cells[0] = cell({ kind: "no", op: bit("I", 0), branch: true });
  latch.cells[1] = cell({ kind: "nc", op: bit("I", 1) });
  latch.cells[2] = cell({ kind: "coil", op: bit("M", 0) });
  latch.cells[3] = cell({ kind: "coil", op: bit("Q", 0) });
  latch.cells[6] = cell({ kind: "no", op: bit("M", 0) });

  const count = blankNetwork("Licznik impulsów", 1, 6);
  count.id = "example-count";
  count.comment = "I0.2 zlicza zbocza w CTU, I0.3 zeruje licznik. Q0.1 świeci, gdy CV ≥ 3.";
  count.cells[0] = cell({ kind: "no", op: bit("I", 2) });
  count.cells[1] = cell({
    kind: "ctu",
    counter: 0,
    pv: 3,
    aux: { area: "I", index: 3 },
  });
  count.cells[2] = cell({ kind: "coil", op: bit("Q", 1) });

  return [latch, count];
}

export function placeCell(tool: PlaceTool, keepBranch: boolean): Cell {
  const next = emptyCell();
  next.branch = keepBranch;
  next.kind = tool;
  if (tool === "no" || tool === "nc" || tool === "p" || tool === "n") {
    next.op = bit("I", 0);
  } else if (tool === "coil" || tool === "set" || tool === "reset") {
    next.op = bit("Q", 0);
  } else if (tool === "ton" || tool === "tof" || tool === "tp") {
    next.pv = 1000;
  }
  return next;
}

export const isTimerKind = (k: Kind): boolean => k === "ton" || k === "tof" || k === "tp";
export const isCounterKind = (k: Kind): boolean => k === "ctu" || k === "ctd" || k === "ctud";

export function addRow(net: Network, atIndex: number = net.rows): Network {
  if (net.rows >= MAX_ROWS) return net;
  const idx = Math.max(0, Math.min(net.rows, Math.trunc(atIndex)));
  const newRow = Array.from({ length: net.cols }, emptyCell);
  const cells = net.cells.slice();
  cells.splice(idx * net.cols, 0, ...newRow);
  return {
    ...net,
    rows: net.rows + 1,
    cells,
  };
}

export function addCol(net: Network): Network {
  if (net.cols >= MAX_COLS) return net;
  const cells: Cell[] = [];
  for (let r = 0; r < net.rows; r++) {
    cells.push(...net.cells.slice(r * net.cols, (r + 1) * net.cols), emptyCell());
  }
  return { ...net, cols: net.cols + 1, cells };
}

export function removeRow(net: Network, atIndex: number = net.rows - 1): Network {
  if (net.rows <= 1) return net;
  const idx = Math.max(0, Math.min(net.rows - 1, Math.trunc(atIndex)));
  const cells = net.cells.slice();
  cells.splice(idx * net.cols, net.cols);
  return { ...net, rows: net.rows - 1, cells };
}

export function removeCol(net: Network): Network {
  if (net.cols <= 1) return net;
  const cells: Cell[] = [];
  for (let r = 0; r < net.rows; r++) {
    cells.push(...net.cells.slice(r * net.cols, r * net.cols + net.cols - 1));
  }
  return { ...net, cols: net.cols - 1, cells };
}

export function moveCell(net: Network, fromIndex: number, toIndex: number): Network {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= net.cells.length ||
    toIndex >= net.cells.length
  ) {
    return net;
  }
  const source = net.cells[fromIndex];
  if (!source || source.kind === "empty") return net;
  const cells = net.cells.slice();
  const target = cells[toIndex];
  cells[toIndex] = source;
  cells[fromIndex] = target;
  return { ...net, cells };
}

export const TOOLS: { id: Tool; label: string; hint: string; key?: string }[] = [
  {
    id: "select",
    label: "Zaznacz",
    key: "1",
    hint: "Kliknij kratkę, aby ustawić adres, lub przeciągnij element myszką w inne miejsce. Gałąź spina prawą krawędź z linią niżej — styki równoległe daj w tej samej kolumnie.",
  },
{ id: "no", label: "Styk NO", key: "2", hint: "Styk normalnie otwarty. Przewodzi, gdy bit = 1." },
{ id: "nc", label: "Styk NC", key: "3", hint: "Styk normalnie zamknięty. Przewodzi, gdy bit = 0." },
{ id: "p", label: "Zbocze P", key: "4", hint: "Przewodzi przez jeden cykl, gdy bit zmienia się z 0 na 1." },
{ id: "n", label: "Zbocze N", key: "5", hint: "Przewodzi przez jeden cykl, gdy bit zmienia się z 1 na 0." },
{ id: "coil", label: "Cewka", key: "6", hint: "Zapisuje 1, gdy jest zasilona, i 0, gdy nie jest. Tylko wyjścia Q i markery M." },
{ id: "set", label: "Ustaw S", key: "7", hint: "Ustawia bit na 1 i zostawia go, aż cewka R go skasuje." },
{ id: "reset", label: "Kasuj R", key: "8", hint: "Kasuje bit do 0, gdy cewka jest zasilona." },
{
  id: "ctu",
  label: "Licznik CTU",
  key: "9",
  hint: "Liczy zbocza narastające zasilania. Q włącza się, gdy CV ≥ PV. Wejście R zeruje CV.",
},
{
  id: "ctd",
  label: "Licznik CTD",
  key: "0",
  hint: "Odejmuje 1 na zboczu narastającym. LD wpisuje PV do CV. Q = 1, gdy CV ≤ 0.",
},
{
  id: "ctud",
  label: "Licznik CTUD",
  key: "U",
  hint: "Zasilanie = CU (liczy w górę na zboczu). CD, R i LD to bity w panelu poniżej. R zeruje, LD wpisuje PV. Q = QU (CV ≥ PV), a stan CV ≤ 0 (QD) odczytasz stykiem C·QD.",
},
{
  id: "ton",
  label: "Timer TON",
  key: "T",
  hint: "Opóźnienie załączenia. Q = 1, gdy zasilanie trwa nieprzerwanie co najmniej PT (ms). Utrata zasilania zeruje timer.",
},
{
  id: "tof",
  label: "Timer TOF",
  key: "F",
  hint: "Opóźnienie wyłączenia. Q = 1 od razu przy zasilaniu i trzyma jeszcze PT (ms) po jego zaniku. Ponowne zasilenie w tym czasie zeruje odliczanie.",
},
{
  id: "tp",
  label: "Timer TP",
  key: "P",
  hint: "Impuls o stałej długości PT (ms), startuje na zboczu narastającym. W trakcie impulsu kolejne zbocza są ignorowane.",
},
{
  id: "wire",
  label: "Przewód",
  key: "W",
  hint: "Prowadzi zasilanie dalej. Potrzebny na gałęzi równoległej, która ma dogonić drugi styk.",
},
{
  id: "branch",
  label: "Gałąź",
  key: "B",
  hint: "Włącza pion na prawej krawędzi kratki. Łączy ją równolegle z kratką poniżej.",
},
{ id: "erase", label: "Gumka", key: "E", hint: "Czyści kratkę razem z gałęzią." },
];

export function toolHint(tool: Tool): string {
  return TOOLS.find((t) => t.id === tool)?.hint ?? "";
}

function isArea(value: unknown): value is Area {
  return value === "I" || value === "Q" || value === "M";
}

function sanitizeAddr(value: unknown): BitAddr | null {
  if (!value || typeof value !== "object") return null;
  const addr = value as BitAddr;
  if (!isArea(addr.area) || typeof addr.index !== "number" || !Number.isInteger(addr.index)) return null;
  if (addr.index < 0 || addr.index >= areaLimit(addr.area)) return null;
  return { area: addr.area, index: addr.index };
}

function sanitizeOperand(value: unknown): Operand | null {
  if (!value || typeof value !== "object") return null;
  const op = value as Operand;
  if (op.type === "cq") {
    if (typeof op.id !== "number" || op.id < 0 || op.id >= COUNTER_COUNT) return null;
    return op.down ? { type: "cq", id: op.id, down: true } : { type: "cq", id: op.id };
  }
  if (op.type === "tq") {
    if (typeof op.id !== "number" || op.id < 0 || op.id >= TIMER_COUNT) return null;
    return { type: "tq", id: op.id };
  }
  if (op.type === "bit") {
    const addr = sanitizeAddr(op.addr);
    return addr ? { type: "bit", addr } : null;
  }
  return null;
}

function sanitizeCell(value: unknown): Cell {
  const blank = emptyCell();
  if (!value || typeof value !== "object") return blank;
  const raw = value as Partial<Cell>;
  const kind = KINDS.includes(raw.kind as Kind) ? (raw.kind as Kind) : "empty";
  const counter =
  typeof raw.counter === "number" && raw.counter >= 0 && raw.counter < COUNTER_COUNT
  ? raw.counter
  : 0;
  const timer =
  typeof raw.timer === "number" && raw.timer >= 0 && raw.timer < TIMER_COUNT ? Math.trunc(raw.timer) : 0;
  const pvMax = isTimerKind(kind) ? MAX_PT_MS : 9999;
  const pv =
  typeof raw.pv === "number" && Number.isFinite(raw.pv) ? Math.max(0, Math.min(pvMax, Math.trunc(raw.pv))) : isTimerKind(kind) ? 1000 : 5;
  return {
    kind,
    op: sanitizeOperand(raw.op),
    pv,
    aux: sanitizeAddr(raw.aux),
    aux2: sanitizeAddr(raw.aux2),
    aux3: sanitizeAddr(raw.aux3),
    counter,
    timer,
    branch: Boolean(raw.branch),
  };
}

export function sanitizeNetworks(value: unknown): Network[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const networks: Network[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const raw = item as Partial<Network>;
    const rows = typeof raw.rows === "number" ? Math.min(MAX_ROWS, Math.max(1, raw.rows | 0)) : 0;
    const cols = typeof raw.cols === "number" ? Math.min(MAX_COLS, Math.max(1, raw.cols | 0)) : 0;
    if (!rows || !cols || !Array.isArray(raw.cells)) return null;
    const cells = raw.cells.slice(0, rows * cols).map(sanitizeCell);
    while (cells.length < rows * cols) cells.push(emptyCell());
    networks.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
                  title: typeof raw.title === "string" ? raw.title.slice(0, 80) : "Sieć",
                  comment: typeof raw.comment === "string" ? raw.comment.slice(0, 240) : "",
                  rows,
                  cols,
                  cells,
    });
  }
  return networks;
}

export const STORAGE_KEY = "ladder-lab-v1";

export function loadSaved(): { networks: Network[]; bistable: boolean[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { networks?: unknown; bistable?: unknown };
    const networks = sanitizeNetworks(data.networks);
    if (!networks) return null;
    const bistable = Array.isArray(data.bistable) ? data.bistable.slice(0, INPUT_COUNT).map(Boolean) : [];
    while (bistable.length < INPUT_COUNT) bistable.push(false);
    return { networks, bistable };
  } catch {
    return null;
  }
}
