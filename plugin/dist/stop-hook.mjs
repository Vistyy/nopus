#!/usr/bin/env node
import{c as n}from"./chunks/chunk-GM5DE2QW.mjs";import{g as e}from"./chunks/chunk-F65ZYN2L.mjs";var r="";for await(let o of process.stdin)r+=o;try{let o=JSON.parse(r),t=e(),s=n(o,t.complexitySensitivity,t.includeEvidence);process.stdout.write(`${JSON.stringify(s)}
`)}catch(o){process.stderr.write(`nopus Stop hook failed: ${o instanceof Error?o.message:String(o)}
`),process.exitCode=1}
