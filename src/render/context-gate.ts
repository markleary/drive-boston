/** Startup GPU work must wait for restoration, and retry if its context changes
 * while an asynchronous shader compilation is pending. Network/CPU setup can
 * continue independently. An interrupted promise need not settle to unblock us. */
export function createContextGate(nativeLost:()=>boolean){
  let lost=false,generation=0;
  const waiters=new Set<()=>void>(),interruptions=new Set<()=>void>();
  const blocked=()=>lost||nativeLost();
  const interrupted=Symbol('context interrupted');
  async function wait(){while(blocked())await new Promise<void>(resolve=>waiters.add(resolve));}
  return{
    lose(){lost=true;generation++;for(const notify of interruptions)notify();},
    restore(){lost=false;for(const resolve of waiters)resolve();waiters.clear();},
    wait,
    async run<T>(operation:()=>T|Promise<T>):Promise<T>{
      for(;;){
        await wait();const version=generation;
        let interrupt!:()=>void;
        const cancelled=new Promise<typeof interrupted>(resolve=>{interrupt=()=>resolve(interrupted);});
        interruptions.add(interrupt);
        try{
          const result=await Promise.race([Promise.resolve().then(()=>blocked()||generation!==version?interrupted:operation()),cancelled]);
          if(result!==interrupted&&generation===version&&!blocked())return result as T;
        }catch(error){if(generation===version&&!blocked())throw error;}
        finally{interruptions.delete(interrupt);}
      }
    },
  };
}
