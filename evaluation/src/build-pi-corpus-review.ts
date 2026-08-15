import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CorpusSample, MediumAnchorLabel, PrivateCandidate } from "./pi-corpus-schema.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function jsonLines<T>(path: string): Promise<T[]> {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

const configuredState = process.env.XDG_STATE_HOME?.trim();
if (configuredState && !isAbsolute(configuredState)) throw new Error("XDG_STATE_HOME must be an absolute path.");
const defaultRoot = join(configuredState || join(homedir(), ".local", "state"), "nopus", "evaluation", "pi-corpus", "v1");
const root = resolve(argument("--root") ?? defaultRoot);
const output = resolve(argument("--output") ?? join(root, "calibration-review.html"));
const offset = Number(argument("--offset") ?? 0);
const limit = Number(argument("--limit") ?? 30);
const idsPath = argument("--ids");
const sample = JSON.parse(await readFile(join(root, "sample.json"), "utf8")) as CorpusSample;
if (sample.schemaVersion !== 1 || typeof sample.sampleId !== "string" || !sample.sampleId) {
  throw new Error("The private sample is incompatible. Replace it before labeling.");
}
const candidates = await jsonLines<PrivateCandidate>(join(root, "candidates.jsonl"));
const sanitized = await jsonLines<{ candidateId: string; redactedText?: string; error?: string; requiresReview?: boolean }>(join(root, "sanitized-review.jsonl"));
if (sanitized.length === 0) throw new Error("Run the local privacy filter before generating a review batch.");
const labels = await jsonLines<MediumAnchorLabel>(join(root, "medium-anchor-labels.jsonl"));
if (labels.some((label) => label.sampleId !== sample.sampleId)) throw new Error("The private medium-anchor labels belong to a different frozen sample.");
const existing = new Set(labels.map(({ candidateId }) => candidateId));
const candidateById = new Map(candidates.map((value) => [value.candidateId, value]));
const sanitizedById = new Map(sanitized.map((value) => [value.candidateId, value]));
let reviewIds = sample.calibrationIds;
if (idsPath !== undefined) {
  const parsed = JSON.parse(await readFile(resolve(idsPath), "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) throw new Error("--ids must name a JSON array of candidate IDs.");
  const calibration = new Set(sample.calibrationIds);
  if (parsed.some((id) => !calibration.has(id))) throw new Error("Every targeted review ID must belong to the calibration sample.");
  if (new Set(parsed).size !== parsed.length) throw new Error("The targeted review IDs must be unique.");
  reviewIds = parsed;
}
const cases = reviewIds
  .filter((id) => !existing.has(id))
  .slice(offset, offset + limit)
  .map((id) => {
    const candidate = candidateById.get(id);
    const filtered = sanitizedById.get(id);
    if (candidate === undefined) throw new Error(`Missing candidate: ${id}`);
    if (filtered?.error) throw new Error(`Privacy Filter failed for ${id}: ${filtered.error}`);
    if (filtered?.requiresReview) throw new Error(`Privacy Filter requires a separate privacy review for ${id}`);
    if (filtered?.redactedText === undefined) throw new Error(`Missing Privacy Filter output for ${id}`);
    return { id, text: filtered.redactedText };
  });
if (cases.length === 0) throw new Error("No unlabeled calibration responses remain in this batch.");
const serialized = JSON.stringify(cases).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="en" data-theme="corporate">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nopus profile calibration</title>
  <style>
    :root{color-scheme:light;--ink:#172033;--muted:#657086;--paper:#fff;--ground:#eef1f6;--line:#d8deea;--accent:#3157d5;--accent-soft:#e9edff;--shadow:0 12px 32px rgba(31,45,78,.09)}
    *,*::before,*::after{box-sizing:border-box}body{min-height:100vh;margin:0;background:var(--ground);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(100% - 24px,960px);min-height:100vh;margin:auto;padding:24px 0;display:flex;flex-direction:column;gap:16px}.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}.card-body{padding:24px;display:flex;flex-direction:column;gap:16px}h1,h2,p{margin:0}h1{font-size:clamp(24px,4vw,34px);line-height:1.15}h2{font-size:18px}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.muted{color:var(--muted)}.header-row,.nav,.actions,.summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.counter{min-width:105px;padding:10px 14px;border-radius:12px;background:var(--ground);text-align:center}.counter strong{display:block;font-size:22px}.progress{width:100%;height:8px;border:0;border-radius:99px;overflow:hidden;background:var(--ground)}progress::-webkit-progress-value{background:var(--accent)}progress::-moz-progress-bar{background:var(--accent)}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:700}.response{white-space:pre-wrap;overflow-wrap:anywhere;max-height:52vh;overflow:auto;border:1px solid var(--line);border-radius:12px;background:#f8f9fc;padding:18px;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.choice{position:relative;min-height:74px;padding:12px;border:1px solid var(--line);border-radius:11px;background:var(--paper);cursor:pointer}.choice:hover{border-color:#9bacde}.choice:has(input:checked){outline:2px solid var(--accent);background:var(--accent-soft)}.choice input{position:absolute;opacity:0}.choice small{color:var(--muted)}textarea{width:100%;min-height:76px;padding:10px;border:1px solid var(--line);border-radius:10px;font:inherit}.btn{appearance:none;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);padding:10px 14px;font-weight:700;cursor:pointer}.btn.primary{border-color:var(--accent);background:var(--accent);color:#fff}.btn.secondary{border-color:#6d46c7;background:#6d46c7;color:#fff}.btn:disabled{opacity:.4;cursor:not-allowed}.state{font-size:12px;color:var(--muted)}.backup{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{border-radius:10px;background:var(--ground);padding:10px}summary{cursor:pointer;font-weight:700}@media(max-width:700px){main{padding:12px 0}.card-body{padding:16px}.choices{grid-template-columns:1fr 1fr}}@media(max-width:430px){.choices{grid-template-columns:1fr}}
  </style>
</head>
<body class="bg-base-200 text-base-content">
<main class="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-3 sm:p-6">
  <header class="card bg-base-100 shadow"><div class="card-body gap-2 p-4 sm:p-6">
    <div class="header-row"><div><p class="eyebrow">Nopus medium anchor</p><h1>Should medium sensitivity rewrite this response?</h1><p class="muted">Judge unnecessary prose difficulty. Do not penalize length or necessary technical terms. Later batches will refine the low and high boundaries.</p></div><div class="counter"><span class="muted">Labeled</span><strong id="count">0/${cases.length}</strong></div></div>
    <progress id="progress" class="progress progress-primary w-full" max="${cases.length}" value="0"></progress>
  </div></header>
  <section class="card min-h-0 flex-1 bg-base-100 shadow"><div class="card-body gap-4 p-4 sm:p-6">
    <div class="nav"><span id="position" class="badge"></span><code id="case-id" class="muted"></code></div>
    <article id="response" class="response rounded-box border border-base-content/10 bg-base-200 p-4"></article>
    <fieldset class="choices" aria-label="Medium sensitivity decision">
      <label class="choice btn p-3"><input type="radio" name="label" value="accept"><span><strong>Accept at medium</strong><br><small class="font-normal opacity-65">A rewrite would be unnecessary</small></span></label>
      <label class="choice btn p-3"><input type="radio" name="label" value="rewrite"><span><strong>Rewrite at medium</strong><br><small class="font-normal opacity-65">The prose is unnecessarily difficult</small></span></label>
      <label class="choice btn p-3"><input type="radio" name="label" value="uncertain"><span><strong>Uncertain</strong><br><small class="font-normal opacity-65">Defer this response</small></span></label>
    </fieldset>
    <label><span class="mb-1 block text-sm font-medium">Optional note</span><textarea id="note" class="textarea textarea-bordered min-h-20 w-full"></textarea></label>
    <div class="actions"><button id="previous" class="btn">Previous</button><span id="state" class="state">Use Download or Queue before closing this page.</span><button id="next" class="btn primary">Save and next</button></div>
  </div></section>
  <section class="card bg-base-100 shadow" data-lavish-question="nopus-pi-labels"><div class="card-body gap-3 p-4 sm:p-6">
    <div class="header-row"><div><h2>Preserve this batch</h2><p class="muted">Download is a local backup. Queue sends labels to the agent.</p></div><div class="actions"><button id="download" class="btn">Download labels</button><button id="queue" class="btn secondary">Queue labels</button></div></div>
    <div id="summary" class="summary"></div><p id="queued"></p>
    <details class="collapse collapse-arrow bg-base-200"><summary class="collapse-title font-medium">Copyable JSON backup</summary><pre id="backup" class="backup collapse-content text-xs"></pre></details>
  </div></section>
</main>
<script>
const cases=${serialized}; const labels={}; let index=0; const el=id=>document.getElementById(id);
const payload=()=>cases.flatMap(item=>labels[item.id]?[{schemaVersion:1,sampleId:${JSON.stringify(sample.sampleId)},candidateId:item.id,profile:'medium',decision:labels[item.id].choice,rubricVersion:1,...(labels[item.id].note?{note:labels[item.id].note}:{})}]:[]);
function persist(){const choice=document.querySelector('input[name="label"]:checked')?.value,note=el('note').value.trim(),item=cases[index];if(choice)labels[item.id]={choice,...(note?{note}:{})};else if(note&&labels[item.id])labels[item.id].note=note;summary()}
function summary(){const values=Object.values(labels);el('count').textContent=values.length+'/'+cases.length;el('progress').value=values.length;const count=x=>values.filter(v=>v.choice===x).length;el('summary').innerHTML=['accept','rewrite','uncertain'].map(x=>'<span class="badge badge-lg">'+x+': '+count(x)+'</span>').join('');el('backup').textContent=payload().map(x=>JSON.stringify(x)).join('\\n')}
function render(){const item=cases[index],saved=labels[item.id]||{};el('position').textContent=(index+1)+' of '+cases.length;el('case-id').textContent=item.id;el('response').textContent=item.text;document.querySelectorAll('input[name="label"]').forEach(x=>x.checked=x.value===saved.choice);el('note').value=saved.note||'';el('previous').disabled=index===0;el('next').textContent=index===cases.length-1?'Save label':'Save and next';summary()}
function move(n){persist();index=Math.max(0,Math.min(cases.length-1,index+n));render();scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('input[name="label"]').forEach(x=>x.addEventListener('change',persist));el('note').addEventListener('change',persist);el('previous').onclick=()=>move(-1);el('next').onclick=()=>move(1);
el('download').onclick=()=>{persist();const blob=new Blob([payload().map(x=>JSON.stringify(x)).join('\\n')+'\\n'],{type:'application/x-ndjson'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='nopus-medium-anchor-labels.jsonl';a.click();URL.revokeObjectURL(a.href)};
el('queue').onclick=()=>{persist();const data=payload();if(!data.length){el('queued').textContent='Label at least one response first.';return}window.lavish.queuePrompt('Record these Nopus medium-anchor labels: '+JSON.stringify(data),{tag:'pi-medium-anchor-labels',text:'Nopus medium anchor: '+data.length+' labels',queueKey:'nopus-pi-labels',element:el('queue'),data:{labels:data}});el('queued').textContent=data.length+' labels queued. Use Send to Agent when ready.'};
document.addEventListener('keydown',e=>{if(['TEXTAREA','INPUT'].includes(document.activeElement?.tagName))return;const keys={a:'accept',r:'rewrite',u:'uncertain'};if(keys[e.key.toLowerCase()])document.querySelector('input[value="'+keys[e.key.toLowerCase()]+'"]').click();if(e.key==='ArrowRight')move(1);if(e.key==='ArrowLeft')move(-1)});render();
</script></body></html>`;
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await chmod(dirname(output), 0o700);
await writeFile(output, html, { mode: 0o600 });
await chmod(output, 0o600);
console.log(JSON.stringify({ output, cases: cases.length, usesSanitizedText: true }, null, 2));
