#!/usr/bin/env node
import{a as o}from"./chunks/chunk-RRX23IZ3.mjs";import"./chunks/chunk-FVAOCUVR.mjs";try{let r=o(process.argv.slice(2));process.stdout.write(`${r.confirmation}
Configuration: ${r.path}
`)}catch(r){process.stderr.write(`nopus configuration failed: ${r instanceof Error?r.message:String(r)}
`),process.exitCode=1}
