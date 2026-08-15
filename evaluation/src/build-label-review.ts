import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { decideRewrite, type ComplexitySensitivity } from "../../src/policy/decide-rewrite.js";
import { measureProse, type ProseMetrics } from "../../src/analysis/measure-prose.js";

const inputPath = resolve(process.argv[2] ?? "tmp/wink-parity.json");
const outputPath = resolve(process.argv[3] ?? ".lavish/reviews/nopus-calibration.html");
const report = JSON.parse(await readFile(inputPath, "utf8")) as {
  comparisons: Array<{
    messageId: string;
    text: string;
    baseline: { wouldRetry: boolean };
    wink: ProseMetrics & { parityRetry: boolean; productionRetry: boolean };
  }>;
};

const levels: ComplexitySensitivity[] = ["low", "medium", "high"];
const decisions = (metrics: ProseMetrics) => Object.fromEntries(levels.map((level) => {
  const decision = decideRewrite(metrics, level);
  return [level, { rewrite: decision.rewrite, signals: decision.signals }];
}));
const metrics = (value: ProseMetrics) => ({
  uncommonRatio: value.uncommonRatio,
  veryUncommonRatio: value.veryUncommonRatio,
  abstractRatio: value.abstractRatio,
  eligibleSentenceCount: value.eligibleSentenceCount,
  highAbstractSentenceCount: value.highAbstractSentenceCount,
  nounStackCount: value.nounStackCount,
  phraseLoadPer100Words: value.phraseLoadPer100Words,
  styleCueCount: value.styleCueCount,
  styleCues: value.styleCues.map(({ cue, count }) => ({ cue, count })),
});

const disagreementCases = report.comparisons
  .filter(({ baseline, wink }) => baseline.wouldRetry !== wink.parityRetry || baseline.wouldRetry !== wink.productionRetry)
  .map(({ messageId, text, baseline, wink }) => ({
    id: messageId,
    group: "Corpus disagreement",
    text,
    reference: {
      pythonBaseline: baseline.wouldRetry,
      samePolicyWink: wink.parityRetry,
    },
    decisions: decisions(wink),
    metrics: metrics(wink),
  }));

const styleTexts = [
  ["style-formulaic-turn", "Here's where it gets interesting. This paradigm shift changes the execution boundary."],
  ["style-reflective-value", "This result is worth sitting with. It is worth talking about because the migration changes ownership."],
  ["style-grandiose", "This is the first wave of a multi-year transition. The new interface is the whole game."],
  ["style-frontier", "Field notes from the frontier: the load-bearing insight is that review quality compounds."],
  ["style-personal", "I can't stop thinking about this result. We should lean into the new operating model."],
  ["control-load-bearing", "Double-click on the load-bearing model to inspect the calculation."],
  ["control-lean-literal", "Lean into the ladder while another person secures its base."],
  ["control-direct", "Use the cache for repeated reads. Delete it when the source revision changes."],
] as const;

const styleCases = styleTexts.map(([id, text]) => {
  const measured = measureProse(text);
  return {
    id,
    group: id.startsWith("control-") ? "Style control" : "Style cue",
    text,
    reference: undefined,
    decisions: decisions(measured),
    metrics: metrics(measured),
  };
});

const cases = [...disagreementCases, ...styleCases];
const serialized = JSON.stringify(cases).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="en" data-theme="luxury">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nopus calibration review</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :where(.grid, .flex) > * { min-width: 0; }
    :where(p, h1, h2, h3, li, summary, .badge, .label) { overflow-wrap: anywhere; }
    body { min-height: 100vh; }
    .response { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 54vh; overflow: auto; font: 0.94rem/1.62 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .choice:has(input:checked) { outline: 2px solid var(--color-primary); background: color-mix(in oklab, var(--color-primary) 16%, var(--color-base-200)); }
    .choice input { position: absolute; opacity: 0; pointer-events: none; }
    kbd { font-family: ui-monospace, monospace; }
  </style>
</head>
<body class="bg-base-300 text-base-content">
  <main class="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 p-3 sm:p-6 lg:p-8">
    <header class="card card-border bg-base-100 shadow-xl">
      <div class="card-body gap-3 p-4 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Nopus calibration</p>
            <h1 class="text-2xl font-bold sm:text-3xl">Should low sensitivity rewrite this response?</h1>
            <p class="mt-1 max-w-3xl text-sm opacity-75">Judge accumulated prose difficulty. Length and necessary technical terms are not failures.</p>
          </div>
          <div class="stats bg-base-200 shadow-sm">
            <div class="stat px-4 py-2">
              <div class="stat-title">Reviewed</div>
              <div id="reviewed-count" class="stat-value text-2xl">0/${cases.length}</div>
            </div>
          </div>
        </div>
        <progress id="progress" class="progress progress-primary w-full" value="0" max="${cases.length}"></progress>
      </div>
    </header>

    <section class="card card-border min-h-0 flex-1 bg-base-100 shadow-xl">
      <div class="card-body gap-4 p-4 sm:p-6">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span id="case-position" class="badge badge-primary"></span>
            <span id="case-group" class="badge badge-outline"></span>
            <code id="case-id" class="text-xs opacity-65"></code>
          </div>
          <button id="next-unreviewed" class="btn btn-ghost btn-sm">Next unreviewed</button>
        </div>

        <article id="response" class="response rounded-box border border-base-content/10 bg-base-200 p-4 sm:p-5"></article>

        <fieldset class="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Your label">
          <label class="choice btn h-auto min-h-16 justify-start p-3 text-left">
            <input type="radio" name="label" value="accept">
            <span><strong>Accept</strong><br><small class="font-normal opacity-65">Clear enough as written</small></span>
          </label>
          <label class="choice btn h-auto min-h-16 justify-start p-3 text-left">
            <input type="radio" name="label" value="rewrite">
            <span><strong>Rewrite</strong><br><small class="font-normal opacity-65">Unnecessarily difficult</small></span>
          </label>
          <label class="choice btn h-auto min-h-16 justify-start p-3 text-left">
            <input type="radio" name="label" value="uncertain">
            <span><strong>Uncertain</strong><br><small class="font-normal opacity-65">Needs context or discussion</small></span>
          </label>
        </fieldset>

        <label class="form-control">
          <span class="label-text mb-1 text-sm font-medium">Optional note</span>
          <textarea id="note" class="textarea textarea-bordered min-h-20 w-full" placeholder="What made this acceptable or difficult?"></textarea>
        </label>

        <details class="collapse collapse-arrow border border-base-content/10 bg-base-200">
          <summary class="collapse-title font-medium">Reveal Nopus decisions and measurements</summary>
          <div class="collapse-content grid gap-3 lg:grid-cols-2">
            <div>
              <h2 class="mb-2 font-semibold">Decisions</h2>
              <pre id="decisions" class="overflow-auto rounded-box bg-base-300 p-3 text-xs"></pre>
            </div>
            <div>
              <h2 class="mb-2 font-semibold">Measurements</h2>
              <pre id="metrics" class="overflow-auto rounded-box bg-base-300 p-3 text-xs"></pre>
            </div>
          </div>
        </details>

        <div class="card-actions items-center justify-between gap-2">
          <button id="previous" class="btn btn-outline">Previous</button>
          <span id="save-state" class="text-xs opacity-60">Selections save in this browser.</span>
          <button id="next" class="btn btn-primary">Save and next</button>
        </div>
      </div>
    </section>

    <section class="card card-border bg-base-100 shadow-xl" data-lavish-question="nopus-calibration-labels">
      <div class="card-body gap-3 p-4 sm:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="card-title">Send completed labels</h2>
            <p class="text-sm opacity-70">Queue all completed labels, then use Lavish’s Send to Agent control.</p>
          </div>
          <button id="queue-labels" class="btn btn-secondary">Queue completed labels</button>
        </div>
        <div id="summary" class="flex flex-wrap gap-2"></div>
        <p id="queued-state" class="text-sm text-success"></p>
      </div>
    </section>
  </main>

  <script>
    const cases = ${serialized};
    const storageKey = "nopus-calibration-v1";
    const memory = {};
    const stored = (key) => {
      try { return localStorage.getItem(key); }
      catch { return memory[key] || null; }
    };
    const store = (key, value) => {
      memory[key] = value;
      try { localStorage.setItem(key, value); }
      catch { /* Lavish may run the artifact in a storage-restricted frame. */ }
    };
    const labels = JSON.parse(stored(storageKey) || "{}");
    let index = Math.max(0, Math.min(cases.length - 1, Number(stored(storageKey + "-index") || 0)));

    const byId = (id) => document.getElementById(id);
    const save = () => {
      store(storageKey, JSON.stringify(labels));
      store(storageKey + "-index", String(index));
      renderSummary();
    };
    const currentChoice = () => document.querySelector('input[name="label"]:checked')?.value;
    const persistCurrent = () => {
      const item = cases[index];
      const label = currentChoice();
      const note = byId("note").value.trim();
      if (label) labels[item.id] = { label, ...(note ? { note } : {}) };
      else if (note && labels[item.id]) labels[item.id].note = note;
      save();
    };
    const renderSummary = () => {
      const values = Object.values(labels);
      const count = (label) => values.filter((value) => value.label === label).length;
      byId("reviewed-count").textContent = values.length + "/" + cases.length;
      byId("progress").value = values.length;
      byId("summary").innerHTML = [
        ["Accept", count("accept"), "badge-success"],
        ["Rewrite", count("rewrite"), "badge-warning"],
        ["Uncertain", count("uncertain"), "badge-info"],
        ["Remaining", cases.length - values.length, "badge-ghost"],
      ].map(([name, value, cls]) => '<span class="badge badge-lg ' + cls + '">' + name + ': ' + value + '</span>').join("");
    };
    const render = () => {
      const item = cases[index];
      const saved = labels[item.id] || {};
      byId("case-position").textContent = (index + 1) + " of " + cases.length;
      byId("case-group").textContent = item.group;
      byId("case-id").textContent = item.id;
      byId("response").textContent = item.text;
      byId("decisions").textContent = JSON.stringify({ reference: item.reference, nopus: item.decisions }, null, 2);
      byId("metrics").textContent = JSON.stringify(item.metrics, null, 2);
      document.querySelectorAll('input[name="label"]').forEach((input) => { input.checked = input.value === saved.label; });
      byId("note").value = saved.note || "";
      byId("previous").disabled = index === 0;
      byId("next").textContent = index === cases.length - 1 ? "Save label" : "Save and next";
      byId("queued-state").textContent = "";
      save();
    };
    const move = (amount) => {
      persistCurrent();
      index = Math.max(0, Math.min(cases.length - 1, index + amount));
      render();
      scrollTo({ top: 0, behavior: "smooth" });
    };

    document.querySelectorAll('input[name="label"]').forEach((input) => input.addEventListener("change", persistCurrent));
    byId("note").addEventListener("change", persistCurrent);
    byId("previous").addEventListener("click", () => move(-1));
    byId("next").addEventListener("click", () => move(1));
    byId("next-unreviewed").addEventListener("click", () => {
      persistCurrent();
      const next = cases.findIndex((item, candidate) => candidate > index && !labels[item.id]);
      const wrapped = cases.findIndex((item) => !labels[item.id]);
      index = next >= 0 ? next : wrapped >= 0 ? wrapped : index;
      render();
    });
    byId("queue-labels").addEventListener("click", () => {
      persistCurrent();
      const completed = cases.flatMap((item) => labels[item.id] ? [{ id: item.id, group: item.group, ...labels[item.id] }] : []);
      if (completed.length === 0) {
        byId("queued-state").textContent = "Label at least one response first.";
        return;
      }
      window.lavish.queuePrompt(
        "Record and apply these user-approved Nopus calibration labels: " + JSON.stringify(completed),
        {
          tag: "calibration-labels",
          text: "Nopus calibration: " + completed.length + " labels",
          queueKey: "nopus-calibration-labels",
          element: byId("queue-labels"),
          data: { labels: completed },
        },
      );
      byId("queued-state").textContent = completed.length + " labels queued. Use Send to Agent when ready.";
    });
    document.addEventListener("keydown", (event) => {
      if (["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName)) return;
      if (event.key.toLowerCase() === "a") document.querySelector('input[value="accept"]').click();
      if (event.key.toLowerCase() === "r") document.querySelector('input[value="rewrite"]').click();
      if (event.key.toLowerCase() === "u") document.querySelector('input[value="uncertain"]').click();
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
    });
    render();
  </script>
</body>
</html>`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html);
console.log(JSON.stringify({ outputPath, cases: cases.length, disagreementCases: disagreementCases.length, styleCases: styleCases.length }, null, 2));
