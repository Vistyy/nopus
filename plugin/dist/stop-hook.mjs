#!/usr/bin/env node
import{c as r}from"./chunks/chunk-U6ZS5BVK.mjs";import{g as e}from"./chunks/chunk-CXWYUKXZ.mjs";var n="";for await(let o of process.stdin)n+=o;try{let o=JSON.parse(n),t=e(),s=r(o,t.complexitySensitivity,t.includeEvidence,t.extraSimple);process.stdout.write(`${JSON.stringify(s)}
`)}catch(o){process.stderr.write(`nopus Stop hook failed: ${o instanceof Error?o.message:String(o)}
`),process.exitCode=1}
