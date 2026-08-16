#!/usr/bin/env node
import{a as o}from"./chunks/chunk-MV3QWGMJ.mjs";import"./chunks/chunk-F65ZYN2L.mjs";try{let r=o(process.argv.slice(2));process.stdout.write(`${r.confirmation}
Configuration: ${r.path}
`)}catch(r){process.stderr.write(`nopus configuration failed: ${r instanceof Error?r.message:String(r)}
`),process.exitCode=1}
