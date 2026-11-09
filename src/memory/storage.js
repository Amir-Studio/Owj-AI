const PREFIX='owj-ai-memory:v1:';
export function createMemoryStorage(adapter=memoryAdapter()) {
  if(!adapter || !['getItem','setItem','removeItem'].every(k=>typeof adapter[k]==='function')) throw new TypeError('Storage adapter must implement getItem, setItem and removeItem');
  const key=id=>{if(typeof id!=='string'||!id.trim())throw new TypeError('userId is required');return PREFIX+encodeURIComponent(id.trim())};
  return Object.freeze({
    async get(id){const raw=await adapter.getItem(key(id));if(!raw)return null;try{const v=typeof raw==='string'?JSON.parse(raw):raw;return v?.schemaVersion===1?v:null}catch{return null}},
    async set(id,value){await adapter.setItem(key(id),JSON.stringify(value))},
    async remove(id){await adapter.removeItem(key(id))}
  });
}
export function createBrowserMemoryStorage(){if(typeof globalThis.localStorage==='undefined')throw new Error('localStorage unavailable');return createMemoryStorage({getItem:async k=>localStorage.getItem(k),setItem:async(k,v)=>localStorage.setItem(k,v),removeItem:async k=>localStorage.removeItem(k)})}
function memoryAdapter(){const map=new Map();return{getItem:async k=>map.get(k)??null,setItem:async(k,v)=>map.set(k,v),removeItem:async k=>map.delete(k)}}