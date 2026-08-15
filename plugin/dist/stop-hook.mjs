#!/usr/bin/env node
import{c as n}from"./chunks/chunk-QCM2YLOI.mjs";import{g as e}from"./chunks/chunk-WVFWA2LD.mjs";var r="";for await(let o of process.stdin)r+=o;try{let o=JSON.parse(r),t=e(),s=n(o,t.complexitySensitivity,t.includeEvidence);process.stdout.write(`${JSON.stringify(s)}
`)}catch(o){process.stderr.write(`nopus Stop hook failed: ${o instanceof Error?o.message:String(o)}
`),process.exitCode=1}
