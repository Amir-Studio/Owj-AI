import {readdir} from 'node:fs/promises';import {join} from 'node:path';
async function walk(d){const out=[];for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())out.push(...await walk(p));else if(e.name.endsWith('.js'))out.push(p)}return out}
const files=await walk('src');for(const f of files)await import(new URL('../'+f.replaceAll('\\\\','/'),import.meta.url));console.log('Syntax OK:',files.length,'files');
