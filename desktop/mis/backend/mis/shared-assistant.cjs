'use strict';
const path=require('node:path'),{SharedClient}=require('./shared-client.cjs'),{GpuAssistant}=require('./gpu-assistant.cjs');
class SharedAssistant {
 constructor(options){const exe=options.exe||path.join(__dirname,'../bin',process.platform+'-'+process.arch,'puzzlescript-guided-service'+(process.platform==='win32'?'.exe':''));
  const shared=new SharedClient(exe,options.directory),assistant=new GpuAssistant({...options,exe,sharedClient:shared.view('greedy')});assistant.shared=shared;return assistant;}
}
module.exports={SharedAssistant};
