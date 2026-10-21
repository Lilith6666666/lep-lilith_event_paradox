"use strict";
// Optional operation-count probe; requires the Git v0.6 baseline at HEAD.
const fs = require("node:fs"), vm = require("node:vm"), cp = require("node:child_process"), path = require("node:path");
const root = path.resolve(__dirname,"..");
const before = cp.execFileSync("git",["show","HEAD:EP/Library.js"],{cwd:root,encoding:"utf8"});
const after = fs.readFileSync(path.join(root,"LEP/Library.js"),"utf8");
function parses(source, prefix, key, type) {
  const box = { state:{}, history:[], info:{actionCount:1,maxChars:10000,memoryLength:0},
    storyCards:[{keys:key,type,entry:"enabled=false"}] };
  source = source.replace("storyCards[index].entry.slice(0, 16000)","(state.parses=(state.parses||0)+1,storyCards[index].entry.slice(0, 16000))");
  new vm.Script(source+"\n"+prefix+"_context(\"plain context\");").runInNewContext(box,{timeout:500});
  return box.state.parses;
}
const result = {before:parses(before,"EP","__EVENT_PARADOX_CONFIG_V1__","Event Paradox — Configuration"),
  after:parses(after,"LEP","__LEP_CONFIG_V1__","LEP — Configuration")};
if(result.before!==2 || result.after!==1)throw Error("Unexpected operation counts: "+JSON.stringify(result));
process.stdout.write("Config parses per Context hook: "+JSON.stringify(result)+"\n");
