/* Keep classic global scopes and execution order, but yield after core startup.
   No eval, synthetic browser lifecycle event, or weakening of script integrity. */
(function () {
  'use strict';
  var nodes=Array.from(document.querySelectorAll('script[type="application/x-dl-boot"]'));
  var optional=Array.from(document.querySelectorAll('script[type="application/x-dl-deferred"]'));
  var loadEvent=null, index=0, queued=0, optionalQueued=0;
  function hint(node){
    var link=document.createElement('link');link.rel='preload';link.as='script';
    link.href=node.dataset.dlSrc;link.integrity=node.dataset.dlIntegrity;link.fetchPriority='low';document.head.appendChild(link);
  }
  function preloadOptional(loaded){
    while(optionalQueued<Math.min(optional.length,loaded+12))hint(optional[optionalQueued++]);
  }
  window.DLBOOT={ready:false,loaded:0,total:nodes.length,preloadOptional:preloadOptional,onLoad:function(callback,options){
    if(loadEvent)setTimeout(function(){callback.call(window,loadEvent);},0);
    else window.addEventListener('load',callback,options);
  }};
  function preload(){
    while(queued<Math.min(nodes.length,index+12)){
      hint(nodes[queued++]);
    }
    if(queued===nodes.length)preloadOptional(0);
  }

  function next(){
    if(index===nodes.length){
      window.DLBOOT.ready=true;
      window.dispatchEvent(new CustomEvent('dl:boot-ready'));
      return;
    }
    preload();
    var node=nodes[index],script=document.createElement('script');
    script.src=node.dataset.dlSrc;script.integrity=node.dataset.dlIntegrity;script.async=false;
    script.onload=function(){node.remove();index++;window.DLBOOT.loaded=index;setTimeout(next,0);};
    script.onerror=function(){window.DLBOOT.error=script.src;console.error('[DexLadder] Startup module failed integrity or network checks',script.src);};
    document.body.appendChild(script);
  }
  window.addEventListener('load',function(event){
    loadEvent=event;
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      if(typeof window.CBX?.preview!=='function'||typeof window.SV82?.exportBundle!=='function'){window.DLHOSTED.error='Core modules did not initialize';return;}
      document.querySelectorAll('.page[inert]').forEach(function(p){p.inert=false;p.removeAttribute('aria-busy');});
      window.DLHOSTED.coreReady=true;performance.mark('dl-basic-ready');
      next();
    });});
  },{once:true});
})();
