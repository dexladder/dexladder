'use strict';
// Each classic program keeps its own scope and public global names. No bundling,
// identifier/property mangling, eval or runtime compilation is introduced.
const {transformSync}=require('../app/node_modules/esbuild');
const lines=require('node:readline').createInterface({input:process.stdin});
lines.on('line',line=>{
  try {const {body,loader}=JSON.parse(line);const result=transformSync(body,{loader,minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,legalComments:'inline',logLevel:'error'});process.stdout.write(JSON.stringify({code:result.code})+'\n');}
  catch(error){process.stdout.write(JSON.stringify({error:String(error)})+'\n');process.exitCode=1;lines.close();}
});
