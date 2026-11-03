import test from "node:test"; import assert from "node:assert";
// Fake D1 holding one GHS 5,000 invoice posted by Finance: Dr AR 500000 / Cr Revenue 500000 (minor units)
const accounts=[{code:"1050",name:"Accounts Receivable",type:"asset",subtype:"ar"},{code:"4010",name:"Website Design Revenue",type:"revenue",subtype:null},
 {code:"4320",name:"Discount Allowed",type:"expense",subtype:"discount_allowed"},{code:"6400",name:"Misc",type:"expense",subtype:null}];
const lines=[
 {jid:"j1",entry_date:"2026-11-03",currency:"GHS",description:"Invoice",account_code:"1050",debit:450000,credit:0},
 {jid:"j1",entry_date:"2026-11-03",currency:"GHS",description:"Invoice",account_code:"4320",debit:50000,credit:0},
 {jid:"j1",entry_date:"2026-11-03",currency:"GHS",description:"Invoice",account_code:"4010",debit:0,credit:500000},
 {jid:"j2",entry_date:"2026-11-04",currency:"GHS",description:"Rent",account_code:"6400",debit:150,credit:0},
 {jid:"j2",entry_date:"2026-11-04",currency:"GHS",description:"Rent",account_code:"1050",debit:0,credit:150}];
const DB:any={prepare:(q:string)=>({all:async()=>({results:q.includes("fin_accounts")?accounts:lines})})};
test("FI derives identical magnitudes from the Finance ledger", async()=>{
  const mod:any=await import("../../../../../functions/api/fi/[[path]].ts");
  const call=async(path:string)=>{const r=await mod.onRequest({request:new Request("https://x.dev/api/fi/"+path),env:{FIN_DB:DB},params:{path:path.split("/").filter(Boolean)}});return r.json();};
  const pnl=await call("pnl"); const bs=await call("balance-sheet"); const d=await call("dashboard");
  assert.equal(pnl.revenue,450000);           // gross 500000 - discount allowed 50000 = net revenue
  assert.equal(pnl.operatingExpenses,150);
  assert.equal(pnl.netProfit,449850);
  assert.equal(bs.assets,449850); assert.equal(bs.balanced,true);
  assert.equal(d.ledger.source,"finance-d1"); assert.equal(d.ledger.postedJournals,2);
});
test("FI no longer posts private entries / demo never touches ledger", async()=>{
  const mod:any=await import("../../../../../functions/api/fi/[[path]].ts");
  await mod.onRequest({request:new Request("https://x.dev/api/fi/seed-demo",{method:"POST"}),env:{FIN_DB:DB},params:{path:["seed-demo"]}});
  const r=await mod.onRequest({request:new Request("https://x.dev/api/fi/pnl"),env:{FIN_DB:DB},params:{path:["pnl"]}});
  assert.equal((await r.json()).revenue,450000);
});
