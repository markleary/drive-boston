type Store=Pick<Storage,'getItem'|'setItem'>;
interface Record {version:1;startedAt:number;updatedAt:number;exit:'active'|'pagehide';report:string;}
const CURRENT='backbay-session-v1',PREVIOUS='backbay-session-report-v1',LIMIT=16000;

/** Two bounded records, saved locally. A process termination cannot run an
 * error handler, so retain the last snapshot before the next page initializes.
 * Missing pagehide is evidence of an unrecorded exit, not proof of a crash. */
export function createSessionJournal(storage:Store|undefined,now=Date.now){
  const read=(key:string)=>{try{return storage?.getItem(key)??'';}catch{return '';}};
  const write=(key:string,value:string)=>{try{storage?.setItem(key,value);}catch{/* Optional diagnostics. */}};
  let previousReport=read(PREVIOUS).slice(0,LIMIT),record:Record|undefined;
  try{
    const prior=JSON.parse(read(CURRENT)||'null');
    if(prior?.version===1&&typeof prior.report==='string'&&prior.report&&Number.isFinite(prior.updatedAt)){
      previousReport=[`Last saved session: ${new Date(prior.updatedAt).toISOString()}`,`Page exit: ${prior.exit==='pagehide'?'pagehide recorded':'no pagehide recorded'}`,'An unrecorded exit does not identify the cause.','',prior.report].join('\n').slice(0,LIMIT);
      write(PREVIOUS,previousReport);
    }
  }catch{/* Ignore invalid or obsolete storage. */}
  return{
    previousReport,
    start(){record??={version:1,startedAt:now(),updatedAt:now(),exit:'active',report:''};},
    capture(report:string){if(!record)return;record={...record,updatedAt:now(),exit:'active',report:report.slice(0,LIMIT)};write(CURRENT,JSON.stringify(record));},
    close(){if(!record)return;record={...record,updatedAt:now(),exit:'pagehide'};write(CURRENT,JSON.stringify(record));},
    get startedAt(){return record?.startedAt;},
  };
}
