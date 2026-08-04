import assert from "node:assert/strict";
import test from "node:test";
import { createOscConnectionUri } from "../src/control/osc-profile.js";

test("OSC QR profile carries the selected host, UDP port, and private first-argument token",()=>{
  const value=createOscConnectionUri({host:"192.168.1.24",port:9101,token:"private token"});
  const parsed=new URL(value);
  assert.equal(parsed.protocol,"playback-v3:");
  assert.equal(parsed.hostname,"osc");
  assert.equal(parsed.searchParams.get("host"),"192.168.1.24");
  assert.equal(parsed.searchParams.get("port"),"9101");
  assert.equal(parsed.searchParams.get("token"),"private token");
  assert.equal(parsed.searchParams.get("tokenArg"),"first");
});
