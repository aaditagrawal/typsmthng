// Run with Bun. Baseline packages are benchmark inputs only, never application dependencies.
// bun scripts/bench-owned-adapters.mjs --baseline /tmp/typsmthng-compiler-perf-baseline/node_modules --playwright /path/to/playwright/index.mjs
// To prepare an independent baseline, create a disposable package.json outside this
// project with dependencies {"idb-keyval":"6.3.0","comlink":"4.4.2","zustand":"5.0.15"}.
// Run `bun install` there once, then use its frozen lock for repeat installs.
// React always resolves to this project's installation, including baseline hooks.
// Playwright is an external test driver; --chrome selects the same browser binary
// for both implementations. No network requests occur in measured workloads.
// --only filters workload names; --samples controls paired samples after 3 warmups.
// JSON stores raw milliseconds, medians, p90, min/max and candidate source hashes.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  baseline: { type: 'string', default: '/tmp/typsmthng-compiler-perf-baseline/node_modules' },
  playwright: { type: 'string', default: '/tmp/fleet-stream-test/node_modules/playwright/index.mjs' },
  chrome: { type: 'string', default: process.env.CHROME_PATH || '/usr/bin/google-chrome' },
  output: { type: 'string', default: '/tmp/typsmthng-compiler-perf-benchmark.json' },
  only: { type: 'string', default: '' },
  samples: { type: 'string', default: '11' },
} })
const root = path.resolve(import.meta.dirname, '..')
const baseline = path.resolve(values.baseline)
const sourceHashes = Object.fromEntries(await Promise.all(['src/lib/keyval.ts', 'src/lib/compiler-rpc.ts', 'src/lib/store.ts', 'scripts/bench-owned-adapters.mjs'].map(async file => [file, createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')])))
const versions = { 'idb-keyval': '6.3.0', comlink: '4.4.2', zustand: '5.0.15' }
for (const [name, version] of Object.entries(versions)) {
  const manifest = JSON.parse(await readFile(path.join(baseline, name, 'package.json'), 'utf8'))
  if (manifest.version !== version) throw new Error(`Expected baseline ${name}@${version}`)
}
const folder = await mkdtemp(path.join(tmpdir(), 'owned-adapters-'))
const build = async (file, text) => {
  const entrypoint = path.join(folder, file)
  await writeFile(entrypoint, text)
  const result = await Bun.build({ entrypoints: [entrypoint], target: 'browser', minify: true, plugins: [{ name: 'shared-react', setup(build) { build.onResolve({ filter: /^react$/ }, () => ({ path: path.join(root, 'node_modules/react/index.js') })) } }], define: { 'process.env.NODE_ENV': JSON.stringify('production') } })
  if (!result.success) throw new AggregateError(result.logs, 'Browser bundle failed')
  return result.outputs[0].text()
}
const workerApi = `const api={initCompiler:async()=>{},isCompilerReady:()=>true,compileTypst:async()=>{},compileTypstIncremental:async request=>({kind:'result',result:{vectorData:request.binaryPayloads[0]?.data,success:true,diagnostics:[],pageDimensions:[]}}),compileToPdf:async()=>{},resolveSourceLoc:async()=>undefined,resolveSourceLocBatch:async()=>[],ensurePackagesForCompile:async()=>{throw new TypeError('missing package')}};`
const workerSources = [
  await build('baseline-worker.ts', `import {expose} from ${JSON.stringify(path.join(baseline, 'comlink/dist/esm/comlink.mjs'))};${workerApi}expose(api);`),
  await build('owned-worker.ts', `import {exposeCompilerWorker} from ${JSON.stringify(path.join(root, 'src/lib/compiler-rpc.ts'))};${workerApi}exposeCompilerWorker(api,self);`),
]
const browserSource = await build('benchmark.ts', `
import * as baselineDb from ${JSON.stringify(path.join(baseline, 'idb-keyval/dist/index.js'))};
import * as ownedDb from ${JSON.stringify(path.join(root, 'src/lib/keyval.ts'))};
import {create as baselineCreate} from ${JSON.stringify(path.join(baseline, 'zustand/esm/index.mjs'))};
import {useShallow as baselineShallow} from ${JSON.stringify(path.join(baseline, 'zustand/esm/react/shallow.mjs'))};
import {create as ownedCreate,useShallow as ownedShallow} from ${JSON.stringify(path.join(root, 'src/lib/store.ts'))};
import {wrap} from ${JSON.stringify(path.join(baseline, 'comlink/dist/esm/comlink.mjs'))};
import {connectCompilerWorker} from ${JSON.stringify(path.join(root, 'src/lib/compiler-rpc.ts'))};
import {createElement as h} from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
import {flushSync} from ${JSON.stringify(path.join(root, 'node_modules/react-dom/index.js'))};
const check=(value,message)=>{if(!value)throw Error(message)};
const wait=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
const errorName=async(promise,name)=>{try{await promise;throw Error('expected '+name)}catch(error){check(error.name===name,'wanted '+name+', got '+error.name)}};
window.run=async({workers,samples,only})=>{
 const correctness=[]; console.log('Checking storage');
 const name='owned-migration-'+crypto.randomUUID();
 const old=baselineDb.createStore(name,'projects');
 const fresh=ownedDb.createStore(name,'projects');
 const record={source:'= old project',asset:new Uint8Array([1,2,3])};
 await baselineDb.set('project',record,old);
 let restored=await ownedDb.get('project',fresh);
 check(restored.source===record.source&&restored.asset instanceof Uint8Array&&restored.asset[2]===3,'migration');
 restored.asset[0]=9;check((await ownedDb.get('project',fresh)).asset[0]===1,'structured clone');
 await errorName(ownedDb.get('home-meta',ownedDb.createStore(name,'home')),'NotFoundError');
 await ownedDb.set('settings',{fontSize:16},fresh);check((await ownedDb.keys(fresh)).length===2,'keys');
 await ownedDb.del('project',fresh);check(await ownedDb.get('project',fresh)===undefined,'delete');
 await errorName(ownedDb.set('bad',()=>{},fresh),'DataCloneError');
 await errorName(fresh('readwrite',store=>{const request=store.put('rollback','rollback');request.onsuccess=()=>store.transaction.abort();return request}),'AbortError');
 check(await ownedDb.get('rollback',fresh)===undefined,'abort rollback');
 await old('readonly',store=>{store.transaction.db.close()});
 const upgrade=indexedDB.open(name,2);const upgraded=await wait(upgrade);upgraded.close();
 check((await ownedDb.get('settings',fresh)).fontSize===16,'versionchange reopen');
 correctness.push('legacy records and typed arrays, clone isolation, missing legacy store, get/set/delete/keys, clone failure, transaction rollback, versionchange reopen');
 const libraries=[baselineDb,ownedDb];
 const dbStores=libraries.map((lib,i)=>lib.createStore('owned-bench-'+i+'-'+crypto.randomUUID(),'projects'));
 const source='= Document\\n'+('content '.repeat(1024));const binary=new Uint8Array(256*1024);
 for(let i=0;i<2;i++){await libraries[i].set('record',{source,binary},dbStores[i]);for(let j=0;j<100;j++)await libraries[i].set('file-'+j,source,dbStores[i])}
 console.log('Checking workers'); const connections=workers.map((source,i)=>{const worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})),{type:'module'});const rpc=i===0?{api:wrap(worker),dispose:()=>{}}:connectCompilerWorker(worker);return{...rpc,worker}});
 for(const {api}of connections){await api.initCompiler();check(await api.isCompilerReady(),'worker ready');await api.ensurePackagesForCompile([]).then(()=>{throw Error('expected package failure')},error=>check(error.name==='TypeError'&&error.message==='missing package','worker Error name/message'));check(await api.resolveSourceLoc(new Uint8Array([1]),new Uint32Array([0]))===undefined,'worker undefined');const data=new Uint8Array([1,2,3]);const response=await api.compileTypstIncremental({mainFilePath:'/main.typ',manifest:[],textPayloads:[],binaryPayloads:[{path:'/image',data}]});check(response.result.vectorData instanceof Uint8Array&&response.result.vectorData[2]===3,'worker typed array');response.result.vectorData[0]=9;check(data[0]===1&&data.length===3,'worker buffer ownership');}
 correctness.push('real workers: typed arrays and buffer ownership, Error names/messages, undefined results');
 const request=size=>({mainFilePath:'/main.typ',manifest:[{path:'/image',digest:'binary'}],textPayloads:[{path:'/main.typ',content:source}],binaryPayloads:[{path:'/image',data:new Uint8Array(size)}]});
 const creates=[baselineCreate,ownedCreate],shallows=[baselineShallow,ownedShallow];
 const results=[];
 const benchmark=async(name,run)=>{if(only&&!name.includes(only))return;console.log(name);for(let round=0;round<3;round++)for(const i of round%2?[1,0]:[0,1])await run(i);const times=[[],[]];for(let round=0;round<samples;round++)for(const i of round%2?[1,0]:[0,1]){const t=performance.now();await run(i);times[i].push(performance.now()-t)}const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{median:sorted[Math.floor(sorted.length/2)],p90:sorted[Math.floor((sorted.length-1)*.9)],min:sorted[0],max:sorted.at(-1),samples:values}};const row={name,baseline:stats(times[0]),candidate:stats(times[1])};results.push(row);await window.record(row);};
 await benchmark('idb-startup-first-open-and-write',async i=>{const lib=libraries[i];await lib.set('settings',{fontSize:16},lib.createStore('cold-'+crypto.randomUUID(),'settings'))});
 await benchmark('idb-small-settings-30-write-read-delete',async i=>{const lib=libraries[i],store=dbStores[i];for(let n=0;n<30;n++){await lib.set('settings',{fontSize:16,theme:'dark'},store);await lib.get('settings',store);await lib.del('settings',store)}});
 const textProject={id:'project-bench',name:'Notes',mainFile:'/main.typ',createdAt:0,updatedAt:0,files:[{path:'/main.typ',content:source,isBinary:false,lastModified:0},{path:'/image.png',content:'',isBinary:true,lastModified:0}]};
 for(let i=0;i<2;i++)await libraries[i].set('bin:project-bench:/image.png',binary,dbStores[i]);
 await benchmark('idb-typical-text-only-autosave-30-project-writes',async i=>{const lib=libraries[i],store=dbStores[i];for(let n=0;n<30;n++)await lib.set('project-bench',{...textProject,updatedAt:n},store)});
 await benchmark('idb-binary-payload-20-write-read-256KiB',async i=>{const lib=libraries[i],store=dbStores[i];for(let n=0;n<20;n++){await lib.set('binary-payload',binary,store);await lib.get('binary-payload',store)}});
 await benchmark('idb-large-project-100-parallel-read-and-keys',async i=>{const lib=libraries[i],store=dbStores[i];await Promise.all(Array.from({length:100},(_,n)=>lib.get('file-'+n,store)));await lib.keys(store)});
 await benchmark('idb-adversarial-128-concurrent-writes',async i=>{const lib=libraries[i],store=dbStores[i];await Promise.all(Array.from({length:128},(_,n)=>lib.set('bulk-'+n,{source},store)))});
 await benchmark('rpc-startup-new-worker-and-init',async i=>{const worker=new Worker(URL.createObjectURL(new Blob([workers[i]],{type:'text/javascript'})),{type:'module'});const rpc=i===0?{api:wrap(worker),dispose:()=>{}}:connectCompilerWorker(worker);await rpc.api.initCompiler();rpc.dispose(new Error('done'));worker.terminate()});
 await benchmark('rpc-small-100-sequential-ready',async i=>{for(let n=0;n<100;n++)await connections[i].api.isCompilerReady()});
 const typical=request(128*1024);await benchmark('rpc-typical-30-roundtrip-128KiB',async i=>{for(let n=0;n<30;n++){const reply=await connections[i].api.compileTypstIncremental(typical);check(reply.result.vectorData.length===128*1024,'typed buffer');check(typical.binaryPayloads[0].data.length===128*1024,'not transferred')}});
 const large=request(8*1024*1024);await benchmark('rpc-large-5-roundtrip-8MiB',async i=>{for(let n=0;n<5;n++)await connections[i].api.compileTypstIncremental(large)});
 await benchmark('rpc-adversarial-128-concurrent-errors',async i=>{await Promise.all(Array.from({length:128},()=>connections[i].api.ensurePackagesForCompile([]).catch(error=>check(error.name==='TypeError','typed error'))))});
 for(const listeners of [0,4,32])await benchmark('store-50000-updates-'+listeners+'-subscribers',async i=>{const store=creates[i](()=>({count:0,other:0}));let count=0;for(let n=0;n<listeners;n++)store.subscribe(state=>{count+=state.count%2});for(let n=0;n<50000;n++)store.setState(state=>({count:state.count+1}));check(store.getState().count===50000&&count===listeners*25000,'store behavior')});
 await benchmark('store-react-500-selected-and-unrelated-updates',async i=>{const useStore=creates[i](()=>({count:0,other:0}));let renders=0;function Component(){const {count}=useStore(shallows[i](state=>({count:state.count})));renders++;return h('span',null,count)}const element=document.createElement('div');document.body.append(element);const root=createRoot(element);flushSync(()=>root.render(h(Component)));for(let n=0;n<500;n++){flushSync(()=>useStore.setState({other:n}));flushSync(()=>useStore.setState({count:n+1}))}check(renders===501&&element.textContent==='500','selector renders');root.unmount();element.remove()});
 for(const [fields,rows]of[[5,32],[24,1]])await benchmark('store-react-'+fields+'-fields-'+rows+'-components-100-updates',async i=>{const initial={other:0};for(let n=0;n<fields;n++)initial['field'+n]=0;const useStore=creates[i](()=>initial);let renders=0;function Component(){const selected=useStore(shallows[i](state=>{const selection={};for(let n=0;n<fields;n++)selection['field'+n]=state['field'+n];return selection}));renders++;return h('span',null,selected.field0)}const element=document.createElement('div');document.body.append(element);const root=createRoot(element);flushSync(()=>root.render(h('div',null,Array.from({length:rows},(_,key)=>h(Component,{key})))));for(let n=0;n<100;n++){flushSync(()=>useStore.setState({other:n}));flushSync(()=>useStore.setState({field0:n+1}))}check(renders===101*rows,'wide selector renders');root.unmount();element.remove()});
 if(results.some(row=>row.name.startsWith('store-50000')))correctness.push('selected store workloads asserted immutable merged updates and synchronous subscribers');
 if(results.some(row=>row.name.startsWith('store-react')))correctness.push('selected React workloads asserted selected updates and skipped unrelated rerenders');
 connections.forEach(({dispose,worker})=>{dispose(new Error('done'));worker.terminate()});
 return{correctness,results,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency};
};`)
const { chromium } = await import(path.resolve(values.playwright))
const browser = await chromium.launch({ executablePath: values.chrome, headless: true, args: ['--disable-background-networking'] })
try {
  const progress=[];
  const page = await browser.newPage();
  await page.exposeFunction('record', async row => { progress.push(row); await writeFile(values.output, JSON.stringify({partial:true,base:'d00ebdb489ea6dee562d256a331081ff551f5a52',versions,sourceHashes,results:progress},null,2)+'\n'); console.log(JSON.stringify(row)); }); page.on('console', message => console.log('browser:', message.text())); page.on('pageerror', error => console.error(error))
  await page.route('https://owned-adapters.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('https://owned-adapters.test/')
  await page.addScriptTag({ content: browserSource })
  let deadline
  let output
  try {
    output = await Promise.race([
      page.evaluate(args => window.run(args), { workers: workerSources, samples: Number(values.samples), only: values.only }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Browser checks/measurements exceeded 120 seconds')), 120_000) }),
    ])
  } finally { clearTimeout(deadline) }
  const result = { sourceHashes, only: values.only, label: 'readonly-request-success; write-commit acknowledgement', base: 'd00ebdb489ea6dee562d256a331081ff551f5a52', versions, date: new Date().toISOString(), bun: Bun.version,
    os: execFileSync('uname', ['-srmo'], { encoding: 'utf8' }).trim(), samples: Number(values.samples), warmup: 3, order: 'alternating baseline/candidate per round, same page and origin, sequential workloads; milliseconds per named batch', ...output }
  await writeFile(values.output, JSON.stringify(result, null, 2)+'\n')
  for (const row of result.results) console.log(row.name, JSON.stringify({ baselineMedian: row.baseline.median, candidateMedian: row.candidate.median, baselineP90: row.baseline.p90, candidateP90: row.candidate.p90 }))
  console.log('Correctness:', result.correctness.join('; '))
  console.log('Saved', values.output)
} finally { await browser.close(); await rm(folder, { recursive: true, force: true }) }
