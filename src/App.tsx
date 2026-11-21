import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INPUT_COUNT,
  OUTPUT_COUNT,
  MARKER_COUNT,
  COUNTER_COUNT,
  TIMER_COUNT,
  MAX_PT_MS,
  MAX_ROWS,
  SCAN_MS,
  type Area,
  type BitAddr,
  type Cell,
  type Memory,
  type Network,
  type Operand,
  type Tool,
  addCol,
  addRow,
  areaLimit,
  bitLabel,
  blankNetwork,
  emptyCell,
  exampleNetworks,
  freshMemory,
  isCounterKind,
  isTimerKind,
  loadSaved,
  moveCell,
  operandLabel,
  placeCell,
  removeCol,
  removeRow,
  TOOLS,
  STORAGE_KEY,
  toolHint,
} from "./model";
import { scan, type ScanResult } from "./engine";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface Selection {
  netId: string;
  index: number;
}

const fieldStyle = {
  background: "var(--panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 6px",
} as const;

/** Wybór opcjonalnego bitu (np. R, LD, CD): obszar "—" oznacza brak podłączenia. */
function AddrField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BitAddr | null;
  onChange: (area: Area | null, index: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ width: 28, fontSize: 11, color: "var(--muted)" }}>{label}</span>
    <select
    value={value?.area ?? ""}
    onChange={(e) => onChange((e.target.value || null) as Area | null, value?.index ?? 0)}
    style={fieldStyle}
    >
    <option value="">—</option>
    <option value="I">I</option>
    <option value="Q">Q</option>
    <option value="M">M</option>
    </select>
    <input
    type="number"
    min={0}
    disabled={!value}
    value={value?.index ?? 0}
    onChange={(e) => value && onChange(value.area, parseInt(e.target.value, 10) || 0)}
    title="Numer bitu"
    style={{ ...fieldStyle, width: 64 }}
    />
    <span style={{ fontSize: 11, color: "var(--muted)" }}>{value ? bitLabel(value) : "brak"}</span>
    </div>
  );
}

function blankInputs(): boolean[] {
  return Array.from({ length: INPUT_COUNT }, () => false);
}

function initialProject(): { networks: Network[]; bistable: boolean[] } {
  const saved = loadSaved();
  if (saved) return saved;
  return { networks: exampleNetworks(), bistable: Array.from({ length: INPUT_COUNT }, () => false) };
}

export default function App() {
  const initial = useMemo(initialProject, []);
  const [networks, setNetworks] = useState<Network[]>(initial.networks);
  const [bistable, setBistable] = useState<boolean[]>(initial.bistable);
  const [activeId, setActiveId] = useState<string>(initial.networks[0].id);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [inputs, setInputs] = useState<boolean[]>(blankInputs);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTool, setDragTool] = useState<Tool | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [result, setResult] = useState<{ memory: Memory; flows: ScanResult["flows"] }>(() => {
    const r = scan(initial.networks, freshMemory(), blankInputs(), 0);
    return { memory: r.memory, flows: r.flows };
  });
  const [status, setStatus] = useState("Gotowy.");

  const networksRef = useRef(networks);
  const inputsRef = useRef(inputs);
  const memoryRef = useRef(result.memory);
  networksRef.current = networks;
  inputsRef.current = inputs;
  memoryRef.current = result.memory;

  const lastTickRef = useRef(performance.now());

  const tick = useCallback(() => {
    // Rzeczywisty czas od poprzedniego cyklu (timery nie zwalniają, gdy przeglądarka dławi interwał).
    const now = performance.now();
    const dt = Math.min(1000, Math.max(0, now - lastTickRef.current));
    lastTickRef.current = now;
    const r = scan(networksRef.current, memoryRef.current, inputsRef.current, dt);
    memoryRef.current = r.memory;
    setResult({ memory: r.memory, flows: r.flows });
  }, []);

  useEffect(() => {
    const id = window.setInterval(tick, SCAN_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  useEffect(() => {
    const id = window.setInterval(tick, SCAN_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;
        const ok = window.confirm(
          `Dostępna jest nowa wersja programu (${update.version}). Zainstalować teraz?`
        );
        if (!ok || cancelled) return;
        setStatus(`Pobieranie aktualizacji ${update.version}...`);
        await update.downloadAndInstall();
        await relaunch();
      } catch {
        // Brak internetu lub uruchomienie w zwykłej przeglądarce — ignorujemy
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeNetwork = networks.find((n) => n.id === activeId) ?? networks[0];

  const activeFlowIndex = networks.findIndex((n) => n.id === activeNetwork.id);
  const flow = result.flows[activeFlowIndex];
  const selectedCell =
  selection && selection.netId === activeNetwork.id ? activeNetwork.cells[selection.index] : null;

  const updateActive = useCallback(
    (fn: (net: Network) => Network) => {
      setNetworks((prev) => prev.map((n) => (n.id === activeId ? fn(n) : n)));
    },
    [activeId]
  );

  const insertRowAt = useCallback(
    (atIndex: number) => {
      if (activeNetwork.rows >= MAX_ROWS) return;
      setNetworks((prev) => prev.map((n) => (n.id === activeId ? addRow(n, atIndex) : n)));
      setSelection((prev) => {
        if (!prev || prev.netId !== activeId) return prev;
        const selRow = Math.floor(prev.index / activeNetwork.cols);
        return selRow >= atIndex ? { ...prev, index: prev.index + activeNetwork.cols } : prev;
      });
      setStatus(`Dodano wiersz na pozycji ${atIndex + 1}.`);
    },
    [activeId, activeNetwork.cols, activeNetwork.rows]
  );

  const deleteRowAt = useCallback(
    (atIndex: number) => {
      if (activeNetwork.rows <= 1) return;
      setNetworks((prev) => prev.map((n) => (n.id === activeId ? removeRow(n, atIndex) : n)));
      setSelection((prev) => {
        if (!prev || prev.netId !== activeId) return prev;
        const selRow = Math.floor(prev.index / activeNetwork.cols);
        if (selRow === atIndex) return null;
        return selRow > atIndex ? { ...prev, index: prev.index - activeNetwork.cols } : prev;
      });
      setStatus(`Usunięto wiersz ${atIndex + 1}.`);
    },
    [activeId, activeNetwork.cols, activeNetwork.rows]
  );

  const updateCell = useCallback(
    (updater: (cell: Cell) => Partial<Cell>) => {
      if (!selection) return;
      updateActive((net) => {
        const cells = net.cells.slice();
        const idx = selection.index;
        if (!cells[idx]) return net;
        cells[idx] = { ...cells[idx], ...updater(cells[idx]) };
        return { ...net, cells };
      });
    },
    [selection, updateActive]
  );

  const applyToolToCell = useCallback(
    (index: number, activeTool: Tool) => {
      if (activeTool === "select") {
        setSelection({ netId: activeId, index });
        return;
      }
      setNetworks((prev) =>
      prev.map((n) => {
        if (n.id !== activeId) return n;
        const cells = n.cells.slice();
        const base = cells[index] ?? emptyCell();
        if (activeTool === "branch") {
          cells[index] = { ...base, branch: !base.branch };
          return { ...n, cells };
        }
        if (activeTool === "erase") {
          cells[index] = emptyCell();
          return { ...n, cells };
        }
        const placed = placeCell(activeTool, base.branch);
        const keepCounter = isCounterKind(placed.kind) && isCounterKind(base.kind);
        const keepTimer = isTimerKind(placed.kind) && isTimerKind(base.kind);
        cells[index] = {
          ...placed,
          pv: keepCounter || keepTimer ? base.pv : placed.pv,
          counter: base.counter,
          timer: base.timer,
          aux: keepCounter ? base.aux : null,
          aux2: keepCounter ? base.aux2 : null,
          aux3: keepCounter ? base.aux3 : null,
        };
        return { ...n, cells };
      })
      );
      setSelection({ netId: activeId, index });
    },
    [activeId]
  );

  const clickCell = useCallback(
    (index: number) => {
      applyToolToCell(index, tool);
    },
    [applyToolToCell, tool]
  );

  const HOLD_MS = 300;
  const pressRef = useRef<{ i: number; at: number; wasOn: boolean } | null>(null);

  const setInput = useCallback((i: number, value: boolean) => {
    setInputs((prev) => {
      if (prev[i] === value) return prev;
      const next = prev.slice();
      next[i] = value;
      return next;
    });
  }, []);

  // Tryb BIST: klik przełącza. Tryb AUTO: krótki klik przełącza (zatrzask),
  // przytrzymanie dłużej niż HOLD_MS działa jak impuls (puszczenie = 0).
  const pressDown = useCallback(
    (i: number) => {
      if (bistable[i]) return;
      pressRef.current = { i, at: performance.now(), wasOn: inputsRef.current[i] };
      setInput(i, true);
    },
    [bistable, setInput]
  );

  const pressUp = useCallback(
    (i: number) => {
      const p = pressRef.current;
      if (bistable[i] || !p || p.i !== i) return;
      pressRef.current = null;
      const held = performance.now() - p.at;
      setInput(i, held < HOLD_MS ? !p.wasOn : false);
    },
    [bistable, setInput]
  );

  const pressCancel = useCallback(
    (i: number) => {
      const p = pressRef.current;
      if (!p || p.i !== i) return;
      pressRef.current = null;
      setInput(i, p.wasOn);
    },
    [setInput]
  );

  const toggleBistable = useCallback((i: number) => {
    setBistable((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }, []);

  const setOperand = useCallback(
    (area: Area | "C" | "T", num: number, down?: boolean) => {
      updateCell((cell) => {
        if (area === "C") {
          const keepDown = down ?? (cell.op?.type === "cq" && cell.op.down === true);
          const id = Math.max(0, Math.min(COUNTER_COUNT - 1, num));
          const op: Operand = keepDown ? { type: "cq", id, down: true } : { type: "cq", id };
          return { op };
        }
        if (area === "T") {
          const op: Operand = { type: "tq", id: Math.max(0, Math.min(TIMER_COUNT - 1, num)) };
          return { op };
        }
        const index = Math.max(0, Math.min(areaLimit(area) - 1, num));
        const op: Operand = { type: "bit", addr: { area, index } };
        return { op };
      });
    },
    [updateCell]
  );

  const setAux = useCallback(
    (field: "aux" | "aux2" | "aux3", area: Area | null, num: number) => {
      updateCell(() => {
        if (!area) return { [field]: null };
        const index = Math.max(0, Math.min(areaLimit(area) - 1, num));
        return { [field]: { area, index } };
      });
    },
    [updateCell]
  );

  const setPv = useCallback(
    (num: number) =>
    updateCell((cell) => ({
      pv: Math.max(0, Math.min(isTimerKind(cell.kind) ? MAX_PT_MS : 9999, Math.trunc(num) || 0)),
    })),
    [updateCell]
  );

  const setCounterIndex = useCallback(
    (num: number) => updateCell(() => ({ counter: Math.max(0, Math.min(COUNTER_COUNT - 1, num)) })),
                                      [updateCell]
  );

  const setTimerIndex = useCallback(
    (num: number) => updateCell(() => ({ timer: Math.max(0, Math.min(TIMER_COUNT - 1, num)) })),
                                    [updateCell]
  );

  const saveProject = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ networks, bistable }));
      setStatus("Projekt zapisany w przeglądarce.");
    } catch {
      setStatus("Nie udało się zapisać w pamięci przeglądarki.");
    }
  }, [networks, bistable]);

  const resetSimulation = useCallback(() => {
    const r = scan(networks, freshMemory(), inputsRef.current, 0);
    lastTickRef.current = performance.now();
    memoryRef.current = r.memory;
    setResult({ memory: r.memory, flows: r.flows });
    setStatus("Pamięć PLC wyzerowana.");
  }, [networks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const hit = TOOLS.find((t) => t.key && t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) setTool(hit.id);
    };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isContact = selectedCell && (selectedCell.kind === "no" || selectedCell.kind === "nc" || selectedCell.kind === "p" || selectedCell.kind === "n");
  const isCoil = selectedCell && (selectedCell.kind === "coil" || selectedCell.kind === "set" || selectedCell.kind === "reset");
  const isCounter = selectedCell && isCounterKind(selectedCell.kind);
  const isTimer = selectedCell && isTimerKind(selectedCell.kind);
  const selOp = selectedCell?.op ?? null;
  const selArea: Area | "C" | "T" = selOp ? (selOp.type === "cq" ? "C" : selOp.type === "tq" ? "T" : selOp.addr.area) : "I";
  const selNum = selOp ? (selOp.type === "bit" ? selOp.addr.index : selOp.id) : 0;
  const selDown = selOp?.type === "cq" && selOp.down === true;
  // Ten sam licznik/timer w kilku kratkach współdzieli stan, więc ostrzegamy.
  const instanceUses = selectedCell
  ? networks.reduce(
    (sum, n) =>
    sum +
    n.cells.filter((c) =>
    isCounterKind(selectedCell.kind)
    ? isCounterKind(c.kind) && c.counter === selectedCell.counter
    : isTimerKind(c.kind) && c.timer === selectedCell.timer
    ).length,
    0
  )
  : 0;

  const cellSymbol = (cell: Cell): string => {
    switch (cell.kind) {
      case "no": return "─[ ]";
      case "nc": return "─[/]";
      case "p": return "─[P]";
      case "n": return "─[N]";
      case "coil": return "─( )";
      case "set": return "─(S)";
      case "reset": return "─(R)";
      case "wire": return "───";
      case "ctu": return `CTU`;
      case "ctd": return `CTD`;
      case "ctud": return `CTUD`;
      case "ton": return `TON`;
      case "tof": return `TOF`;
      case "tp": return `TP`;
      default: return "";
    }
  };

  return (
    <div className="app">
    <div className="topbar">
    <h1>🧪 Ladder Lab – Siemens TIA Portal</h1>
    <div className="clock">{status}</div>
    </div>
    <div className="main">
    <div className="sidebar">
    <h2>Narzędzia (kliknij lub przeciągnij)</h2>
    <div className="tool-grid">
    {TOOLS.map((t) => {
      const isDraggableTool = t.id !== "select";
      const isBeingDragged = dragTool === t.id;
      return (
        <button
        key={t.id}
        draggable={isDraggableTool}
        className={`tool-btn ${tool === t.id ? "active" : ""}`}
        style={{
          cursor: isDraggableTool ? "grab" : "pointer",
          opacity: isBeingDragged ? 0.5 : 1,
        }}
        title={isDraggableTool ? `${t.label} — kliknij lub przeciągnij na kratkę` : t.label}
        onClick={() => setTool(t.id)}
        onDragStart={(e) => {
          if (!isDraggableTool) {
            e.preventDefault();
            return;
          }
          setDragTool(t.id);
          setDragFrom(null);
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("application/x-ladder-tool", t.id);
        }}
        onDragEnd={() => {
          setDragTool(null);
          setDragOver(null);
        }}
        >
        <span>{t.label}</span>
        {t.key && <kbd>{t.key}</kbd>}
        </button>
      );
    })}
    </div>
    <div className="hint-box" style={{ marginTop: 8 }}>{toolHint(tool)}</div>

    <h2>Projekt</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <button className="tool-btn" onClick={saveProject} style={{ width: "100%" }}>💾 Zapisz projekt</button>
    <button className="tool-btn" onClick={resetSimulation} style={{ width: "100%" }}>♻ Reset PLC</button>
    <button
    className="tool-btn"
    style={{ width: "100%" }}
    onClick={() => {
      const n = blankNetwork(`Sieć ${networks.length + 1}`, 2, 6);
      setNetworks((p) => [...p, n]);
      setActiveId(n.id);
      setSelection(null);
    }}
    >+ Nowa sieć</button>
    </div>

    <h2>Wyjścia – lampki (Q)</h2>
    <div className="io-grid">
    {Array.from({ length: OUTPUT_COUNT }).map((_, i) => (
      <div key={i} className={`io-btn ${result.memory.Q[i] ? "on" : ""}`} style={{ cursor: "default" }} title={`Q${i}`}>
      <span className={`lamp ${result.memory.Q[i] ? "on" : ""}`} />
      <span>{bitLabel({ area: "Q", index: i })}</span>
      </div>
    ))}
    </div>

    <h2>Wejścia (10)</h2>
    <div className="io-group-label">Klik = bistabilnie · Przytrzymaj = impuls</div>
    <div className="io-grid">
    {Array.from({ length: INPUT_COUNT }).map((_, i) => (
      <button
      key={i}
      className={`io-btn ${inputs[i] ? "on" : ""} ${bistable[i] ? "tog" : ""}`}
      onClick={(e) => {
        // bistabilny: klik myszą/dotykiem lub klawiaturą (Enter/Spacja)
        if (bistable[i] || e.detail === 0) setInput(i, !inputsRef.current[i]);
      }}
      onPointerDown={(e) => {
        if (bistable[i]) return;
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* przechwycenie wskaźnika jest tylko ulepszeniem */
        }
        pressDown(i);
      }}
      onPointerUp={() => pressUp(i)}
      onPointerCancel={() => pressCancel(i)}
      >
      <span className={`lamp ${inputs[i] ? "on" : ""}`} />
      <span>{bitLabel({ area: "I", index: i })}{bistable[i] ? " B" : ""}</span>
      </button>
    ))}
    </div>
    <div className="io-grid" style={{ marginTop: 6 }}>
    {Array.from({ length: INPUT_COUNT }).map((_, i) => (
      <button
      key={i}
      className={`tool-btn ${bistable[i] ? "active" : ""}`}
      style={{ justifyContent: "center", padding: "4px 6px", fontSize: 11 }}
      onClick={() => toggleBistable(i)}
      title="BIST = tylko przełącznik · AUTO = klik przełącza, przytrzymanie = impuls"
      >
      {bitLabel({ area: "I", index: i })} {bistable[i] ? "BIST" : "AUTO"}
      </button>
    ))}
    </div>

    <h2>Markery (M)</h2>
    <div className="io-grid">
    {Array.from({ length: MARKER_COUNT }).map((_, i) => (
      <div key={i} className={`io-btn ${result.memory.M[i] ? "on" : ""}`} style={{ cursor: "default", minHeight: 30 }} title={`M${i} = ${bitLabel({ area: "M", index: i })}`}>
      <span className="lamp" style={{ width: 10, height: 10, ...(result.memory.M[i] ? { background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" } : {}) }} />
      <span style={{ fontSize: 10 }}>{bitLabel({ area: "M", index: i })}</span>
      </div>
    ))}
    </div>

    <h2>Liczniki (C)</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    {Array.from({ length: COUNTER_COUNT }).map((_, i) => {
      const c = result.memory.counters[i];
      return (
        <div key={i} className="io-btn" style={{ cursor: "default", minHeight: 28, alignItems: "flex-start" }}>
        <span>C{i}: CV={c.cv} · Q={c.q ? 1 : 0} · QD={c.qd ? 1 : 0}</span>
        </div>
      );
    })}
    </div>

    <h2>Timery (T)</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    {Array.from({ length: TIMER_COUNT }).map((_, i) => {
      const t = result.memory.timers[i];
      return (
        <div key={i} className="io-btn" style={{ cursor: "default", minHeight: 28, alignItems: "flex-start" }}>
        <span>T{i}: ET={t.et} ms · Q={t.q ? 1 : 0}</span>
        </div>
      );
    })}
    </div>
    </div>

    <div className="ladder-wrap">
    <div className="canvas-scroll">
    <div className="ladder-canvas">
    <div className="ladder-title">
    <span>{activeNetwork.title}</span>
    <span>wiersze {activeNetwork.rows} × kolumny {activeNetwork.cols}</span>
    </div>
    {activeNetwork.comment && (
      <div className="hint-box" style={{ marginBottom: 8 }}>{activeNetwork.comment}</div>
    )}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
    <button className="tool-btn" disabled={activeNetwork.rows >= MAX_ROWS} onClick={() => insertRowAt(0)}>+ Wiersz na górze</button>
    <button className="tool-btn" disabled={activeNetwork.rows >= MAX_ROWS} onClick={() => insertRowAt(activeNetwork.rows)}>+ Wiersz na dole</button>
    <button className="tool-btn" disabled={activeNetwork.rows <= 1} onClick={() => deleteRowAt(activeNetwork.rows - 1)}>– Wiersz</button>
    <button className="tool-btn" onClick={() => setNetworks((p) => p.map((n) => (n.id === activeId ? addCol(n) : n)))}>+ Kolumna</button>
    <button className="tool-btn" onClick={() => { setNetworks((p) => p.map((n) => (n.id === activeId ? removeCol(n) : n))); setSelection(null); }}>– Kolumna</button>
    </div>
    <div style={{ display: "inline-block", border: "1px solid var(--grid)" }}>
    {Array.from({ length: activeNetwork.rows }).map((_, r) => (
      <div key={r} style={{ display: "grid", gridTemplateColumns: `28px repeat(${activeNetwork.cols}, 56px) 74px` }}>
      <div className="rownum" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--muted)", background: "var(--panel-2)", borderRight: "1px solid var(--grid)", borderBottom: "1px solid var(--grid)" }}>{r + 1}</div>
      {activeNetwork.cells.slice(r * activeNetwork.cols, (r + 1) * activeNetwork.cols).map((cell, c) => {
        const i = r * activeNetwork.cols + c;
        const cellFlow = flow?.cells[i];
        const energized = cellFlow ? cellFlow.closed && cellFlow.left : false;
        const isSel = selection?.index === i && selection?.netId === activeNetwork.id;
        const isDragging = dragFrom === i;
        const isDropTarget =
        dragOver === i && ((dragFrom !== null && dragFrom !== i) || dragTool !== null);
        const isOut = cell.kind === "coil" || cell.kind === "set" || cell.kind === "reset";
        const isCounterCell = isCounterKind(cell.kind);
        const isTimerCell = isTimerKind(cell.kind);
        const bg = isDropTarget
        ? "rgba(61, 220, 151, 0.22)"
        : isSel
        ? "var(--accent-dim)"
        : energized
        ? "rgba(61, 220, 151, 0.25)"
        : isOut
        ? "rgba(61, 220, 151, 0.12)"
        : isCounterCell
        ? "rgba(88, 166, 255, 0.12)"
        : isTimerCell
        ? "rgba(210, 153, 34, 0.14)"
        : "var(--panel-2)";
        const draggable = cell.kind !== "empty";
        return (
          <div
          key={c}
          draggable={draggable}
          onClick={() => clickCell(i)}
          onDragStart={(e) => {
            if (!draggable) {
              e.preventDefault();
              return;
            }
            setDragFrom(i);
            setDragTool(null);
            setDragOver(i);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(i));
          }}
          onDragOver={(e) => {
            if (dragFrom === null && dragTool === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = dragTool ? "copy" : "move";
            if (dragOver !== i) setDragOver(i);
          }}
          onDragLeave={() => {
            if (dragOver === i) setDragOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const rawTool = e.dataTransfer.getData("application/x-ladder-tool") as Tool | "";
            const droppedTool = dragTool ?? (rawTool || null);

            if (droppedTool) {
              applyToolToCell(i, droppedTool);
              const toolMeta = TOOLS.find((t) => t.id === droppedTool);
              setStatus(`Wstawiono: ${toolMeta?.label ?? droppedTool}.`);
              setDragTool(null);
              setDragFrom(null);
              setDragOver(null);
              return;
            }

            const raw = e.dataTransfer.getData("text/plain");
            const from = dragFrom ?? (raw !== "" ? Number(raw) : null);
            if (from !== null && !Number.isNaN(from) && from !== i) {
              setNetworks((p) => p.map((n) => (n.id === activeId ? moveCell(n, from, i) : n)));
              setSelection({ netId: activeId, index: i });
              setStatus("Przeniesiono element.");
            }
            setDragFrom(null);
            setDragTool(null);
            setDragOver(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDragTool(null);
            setDragOver(null);
          }}
          title={`${cell.kind} ${operandLabel(cell.op)}${draggable ? " (przeciągnij, aby przenieść)" : ""}`}
          className="ladder-cell"
          style={{
            height: 38,
            borderRight: "1px solid var(--grid)",
                borderBottom: "1px solid var(--grid)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isDragging ? "grabbing" : draggable ? "grab" : "pointer",
                background: bg,
                opacity: isDragging ? 0.45 : 1,
                outline: isDropTarget ? "2px dashed var(--accent)" : undefined,
                outlineOffset: isDropTarget ? -2 : undefined,
                position: "relative",
                color: energized ? "var(--accent)" : "var(--text)",
                fontSize: 12,
          }}
          >
          {cellSymbol(cell)}
          {cell.op && (
            <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "var(--muted)" }}>
            {operandLabel(cell.op)}
            </span>
          )}
          {isCounterCell && (
            <>
            <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "var(--muted)" }}>C{cell.counter}</span>
            <span style={{ position: "absolute", bottom: 1, right: 2, fontSize: 8, color: "var(--yellow)" }}>
            {result.memory.counters[cell.counter]?.cv ?? 0}/{cell.pv}
            </span>
            </>
          )}
          {isTimerCell && (
            <>
            <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "var(--muted)" }}>T{cell.timer}</span>
            <span style={{ position: "absolute", bottom: 1, right: 2, fontSize: 8, color: "var(--yellow)" }}>
            {((result.memory.timers[cell.timer]?.et ?? 0) / 1000).toFixed(1)}/{(cell.pv / 1000).toFixed(1)}s
            </span>
            </>
          )}
          {cell.branch && (
            <span style={{ position: "absolute", top: 1, right: 2, fontSize: 9, color: "var(--accent)" }}>⑂</span>
          )}
          </div>
        );
      })}
      <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        padding: "0 3px",
        background: "var(--panel-2)",
                                                               borderBottom: "1px solid var(--grid)",
      }}
      >
      <button
      type="button"
      className="row-ctrl-btn"
      disabled={activeNetwork.rows >= MAX_ROWS}
      onClick={() => insertRowAt(r)}
      title="Wstaw wiersz powyżej"
      >
      +↑
      </button>
      <button
      type="button"
      className="row-ctrl-btn"
      disabled={activeNetwork.rows >= MAX_ROWS}
      onClick={() => insertRowAt(r + 1)}
      title="Wstaw wiersz poniżej"
      >
      +↓
      </button>
      <button
      type="button"
      className="row-ctrl-btn del"
      disabled={activeNetwork.rows <= 1}
      onClick={() => deleteRowAt(r)}
      title="Usuń ten wiersz"
      >
      ✕
      </button>
      </div>
      </div>
    ))}
    </div>

    {selectedCell && isContact && (
      <div className="hint-box" style={{ marginTop: 12 }}>
      <strong>Styk: {operandLabel(selOp)}</strong>
      <div className="io-grid" style={{ marginTop: 6, gridTemplateColumns: "repeat(6, 1fr)" }}>
      {(["I", "Q", "M", "C", "T"] as const).map((a) => (
        <button key={a} className={`tool-btn ${selArea === a ? "active" : ""}`} style={{ justifyContent: "center" }} onClick={() => setOperand(a, selNum)}>{a}</button>
      ))}
      <input
      type="number"
      min={0}
      value={selNum}
      onChange={(e) => setOperand(selArea, parseInt(e.target.value, 10) || 0)}
      style={{ width: "100%", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }}
      />
      </div>
      {selArea === "C" && (
        <button
        className={`tool-btn ${selDown ? "active" : ""}`}
        style={{ marginTop: 6 }}
        onClick={() => setOperand("C", selNum, !selDown)}
        title="Q = CV ≥ PV (QU), QD = CV ≤ 0"
        >
        {selDown ? "Wyjście QD (CV ≤ 0)" : "Wyjście Q / QU (CV ≥ PV)"}
        </button>
      )}
      </div>
    )}

    {selectedCell && isCoil && (
      <div className="hint-box" style={{ marginTop: 12 }}>
      <strong>Cewka: {operandLabel(selOp)}</strong>
      <div className="io-grid" style={{ marginTop: 6, gridTemplateColumns: "repeat(4, 1fr)" }}>
      {(["Q", "M"] as const).map((a) => (
        <button key={a} className={`tool-btn ${selArea === a ? "active" : ""}`} style={{ justifyContent: "center" }} onClick={() => setOperand(a, selNum)}>{a}</button>
      ))}
      <input
      type="number"
      min={0}
      value={selNum}
      onChange={(e) => setOperand(selArea === "C" || selArea === "T" ? "Q" : selArea, parseInt(e.target.value, 10) || 0)}
      style={{ width: "100%", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }}
      />
      </div>
      </div>
    )}

    {selectedCell && isCounter && (
      <div className="hint-box" style={{ marginTop: 12 }}>
      <strong>
      Licznik {selectedCell.kind.toUpperCase()} · C{selectedCell.counter} · CV={result.memory.counters[selectedCell.counter]?.cv ?? 0} · PV={selectedCell.pv}
      </strong>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>Nr C</span>
      <input type="number" min={0} max={COUNTER_COUNT - 1} value={selectedCell.counter} onChange={(e) => setCounterIndex(parseInt(e.target.value, 10) || 0)} style={{ ...fieldStyle, width: 64 }} />
      <span style={{ fontSize: 11, color: "var(--muted)" }}>PV</span>
      <input type="number" min={0} max={9999} value={selectedCell.pv} onChange={(e) => setPv(parseInt(e.target.value, 10) || 0)} style={{ ...fieldStyle, width: 80 }} />
      </div>
      {selectedCell.kind === "ctu" && <AddrField label="R" value={selectedCell.aux} onChange={(a, n) => setAux("aux", a, n)} />}
      {selectedCell.kind === "ctd" && <AddrField label="LD" value={selectedCell.aux} onChange={(a, n) => setAux("aux", a, n)} />}
      {selectedCell.kind === "ctud" && (
        <>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>Zasilanie kratki = CU (liczy w górę).</div>
        <AddrField label="CD" value={selectedCell.aux} onChange={(a, n) => setAux("aux", a, n)} />
        <AddrField label="R" value={selectedCell.aux2} onChange={(a, n) => setAux("aux2", a, n)} />
        <AddrField label="LD" value={selectedCell.aux3} onChange={(a, n) => setAux("aux3", a, n)} />
        </>
      )}
      {instanceUses > 1 && (
        <div style={{ fontSize: 11, color: "var(--yellow)" }}>
        Uwaga: C{selectedCell.counter} jest użyty w {instanceUses} kratkach i te kratki współdzielą jeden licznik.
        </div>
      )}
      </div>
      </div>
    )}

    {selectedCell && isTimer && (
      <div className="hint-box" style={{ marginTop: 12 }}>
      <strong>
      Timer {selectedCell.kind.toUpperCase()} · T{selectedCell.timer} · ET={result.memory.timers[selectedCell.timer]?.et ?? 0} ms / PT={selectedCell.pv} ms
      </strong>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>Nr T</span>
      <input type="number" min={0} max={TIMER_COUNT - 1} value={selectedCell.timer} onChange={(e) => setTimerIndex(parseInt(e.target.value, 10) || 0)} style={{ ...fieldStyle, width: 64 }} />
      <span style={{ fontSize: 11, color: "var(--muted)" }}>PT [ms]</span>
      <input type="number" min={0} max={MAX_PT_MS} step={100} value={selectedCell.pv} onChange={(e) => setPv(parseInt(e.target.value, 10) || 0)} style={{ ...fieldStyle, width: 96 }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
      Wynik odczytasz stykiem T{selectedCell.timer}.Q (przycisk „T" w edytorze styku) albo prosto z wyjścia kratki.
      </div>
      {instanceUses > 1 && (
        <div style={{ fontSize: 11, color: "var(--yellow)", marginTop: 6 }}>
        Uwaga: T{selectedCell.timer} jest użyty w {instanceUses} kratkach i te kratki współdzielą jeden timer.
        </div>
      )}
      </div>
    )}

    {selectedCell && !isContact && !isCoil && !isCounter && !isTimer && (
      <div className="hint-box" style={{ marginTop: 12 }}>
      Zaznaczono kratkę ({cellSymbol(selectedCell) || selectedCell.kind}). Przeciągnij element z lewego panelu lub kliknij narzędzie, aby go wstawić.
      </div>
    )}

    <h3 style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>Sieci w projekcie</h3>
    <div className="network-list">
    {networks.map((net) => (
      <div
      key={net.id}
      className={`network-item ${net.id === activeId ? "active" : ""}`}
      onClick={() => {
        setActiveId(net.id);
        setSelection(null);
        setDragFrom(null);
        setDragTool(null);
        setDragOver(null);
      }}
      >
      <span>{net.title}</span>
      <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{net.rows}×{net.cols}</span>
      {networks.length > 1 && (
        <button
        className="tool-btn"
        style={{ padding: "0 6px", marginLeft: 8, fontSize: 12 }}
        title="Usuń sieć"
        onClick={(e) => {
          e.stopPropagation();
          if (!window.confirm(`Usunąć sieć „${net.title}"?`)) return;
          const rest = networks.filter((n) => n.id !== net.id);
          setNetworks(rest);
          if (activeId === net.id) setActiveId(rest[0].id);
          setSelection(null);
          setStatus(`Usunięto sieć „${net.title}".`);
        }}
        >✕</button>
      )}
      </div>
    ))}
    </div>
    </div>
    </div>
    </div>
    </div>
    </div>
  );
}
