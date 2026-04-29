import { useMemo } from "react";
import { type FileNode, flattenFiles } from "@/stores/ide-store";
import wxPolyfillSrc from "../../../public/wechat-preview/wx-polyfill.js?raw";

interface WeChatPreviewProps {
  files: FileNode[];
  refreshKey: number;
}

const _polyfillInlined = wxPolyfillSrc.replace(/<\/script>/gi, "<\\/script>");
const _closeScript = "<" + "/script>";
const _openScript = "<script>";

function buildWeChatPreviewHtml(files: { path: string; content: string }[]): string {
  const fileMap: Record<string, string> = {};
  for (const f of files) {
    const key = f.path.replace(/^\/project\//, "");
    fileMap[key] = f.content;
  }

  let appJson: { pages?: string[]; window?: Record<string, string>; tabBar?: unknown } = {};
  try { appJson = JSON.parse(fileMap["app.json"] || "{}"); } catch { /* ignore */ }
  const pages = appJson.pages || ["pages/index/index"];
  const entryPage = pages[0] || "pages/index/index";
  const windowConfig = (appJson.window || {}) as Record<string, string>;

  const pageDataEntries = pages.map((pagePath) => {
    const wxml = fileMap[pagePath + ".wxml"] || "<view><text>Page not found</text></view>";
    const wxss = fileMap[pagePath + ".wxss"] || "";
    let pageJson: { navigationBarTitleText?: string } = {};
    try { pageJson = JSON.parse(fileMap[pagePath + ".json"] || "{}"); } catch { /* ignore */ }
    const js = fileMap[pagePath + ".js"] || "Page({data:{}});";
    return { path: pagePath, wxml, wxss, js, title: pageJson.navigationBarTitleText || windowConfig.navigationBarTitleText || "Mini Program" };
  });

  const pagesJsonSafe = JSON.stringify(pageDataEntries).replace(/<\/script>/gi, "<\\/script>");
  const appJs = fileMap["app.js"] || "App({});";
  const appJsJsonSafe = JSON.stringify(appJs).replace(/<\/script>/gi, "<\\/script>");
  const appWxss = (fileMap["app.wxss"] || "").replace(/([\d.]+)rpx/g, (_: string, n: string) => (parseFloat(n) / 7.5).toFixed(3) + "vw");
  const appWxssSafe = appWxss.replace(/<\/style>/gi, "<\\/style>");
  const navBgColor = windowConfig.navigationBarBackgroundColor || "#07c160";
  const navTextStyle = windowConfig.navigationBarTextStyle || "white";
  const navTitle = windowConfig.navigationBarTitleText || "Mini Program";
  const navTextColor = navTextStyle === "white" ? "#fff" : "#000";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>WeChat Mini Program Preview</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:#f5f5f5;font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif}
#__wx_root__{display:flex;flex-direction:column;height:100%}
#__wx_navbar__{display:flex;align-items:center;justify-content:center;position:relative;height:44px;flex-shrink:0;z-index:100;background:${navBgColor};color:${navTextColor}}
.__wx_nav_back__{position:absolute;left:8px;top:50%;transform:translateY(-50%);display:none;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;background:none;border:none;color:inherit}
.__wx_nav_title__{font-size:17px;font-weight:600;color:${navTextColor}}
#__wx_page_container__{flex:1;overflow-y:auto;overflow-x:hidden;position:relative;background:#f5f5f5;-webkit-overflow-scrolling:touch}
div{display:block}span{display:inline}img{display:block;max-width:100%}
button{cursor:pointer;background:#f5f5f5;border:none;padding:8px 16px;border-radius:4px;font-size:14px}
input,textarea{border:1px solid #ddd;border-radius:4px;padding:8px;font-size:14px;width:100%;background:#fff}
a{text-decoration:none;color:inherit}
</style>
<style id="__wx_app_style__">${appWxssSafe}</style>
<style id="__wx_page_style__"></style>
<script>${_polyfillInlined}${_closeScript}
</head>
<body>
<div id="__wx_root__">
  <div id="__wx_navbar__">
    <button class="__wx_nav_back__" onclick="window.__wxNavigateBack&&window.__wxNavigateBack(1)">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <span class="__wx_nav_title__">${navTitle}</span>
  </div>
  <div id="__wx_page_container__"></div>
</div>
${_openScript}
(function(){var oc={};['log','warn','error','info'].forEach(function(l){oc[l]=console[l];console[l]=function(){var m=Array.from(arguments).map(function(a){try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);}}).join(' ');try{window.parent.postMessage({type:'__cascade_console__',level:l,message:m},'*');}catch(e){}oc[l].apply(console,arguments);};});window.onerror=function(msg,src,line){try{window.parent.postMessage({type:'__cascade_console__',level:'error',message:msg+(line?' (line '+line+')':'')},'*');}catch(e){}};})();
${_closeScript}
${_openScript}
var __pages__=${pagesJsonSafe};
var __appConfig__=${JSON.stringify({ navBgColor, navTextStyle, navTitle })};
var __pageStack__=[];
var __currentPageInst__=null;
var __appInst__=null;

window.__wxNavigate=function(url){
  if(!url)return;
  var replace=false;
  if(url.startsWith('__redirect__:')){url=url.slice(13);replace=true;}
  else if(url.startsWith('__tab__:')){url=url.slice(8);}
  else if(url.startsWith('__relaunch__:')){url=url.slice(13);__pageStack__=[];replace=false;}
  var parts=url.split('?'),pagePath=parts[0].charAt(0)==='/'?parts[0].slice(1):parts[0],options={};
  if(parts[1])parts[1].split('&').forEach(function(p){var kv=p.split('=');if(kv[0])options[decodeURIComponent(kv[0])]=kv[1]?decodeURIComponent(kv[1]):'';});
  if(replace&&__pageStack__.length)__pageStack__.pop();
  var page=__pages__.find(function(p){return p.path===pagePath;});
  if(!page){console.warn('[wx] page not found:',pagePath);return;}
  var inst=createPageInst(page,options);
  __pageStack__.push({page:page,inst:inst});
  renderPage(page,inst);
};
window.__wxNavigateBack=function(delta){
  if(__pageStack__.length>1){
    for(var i=0;i<(delta||1)&&__pageStack__.length>1;i++)__pageStack__.pop();
    var prev=__pageStack__[__pageStack__.length-1];
    renderPage(prev.page,prev.inst);
  }
};
function getApp(){return __appInst__||{};}
window.getApp=getApp;
window.getCurrentPages=function(){return __pageStack__.map(function(p){return p.inst;});};

function App(cfg){__appInst__=cfg;window.__wxApp__=cfg;if(cfg.onLaunch)try{cfg.onLaunch.call(cfg,{});}catch(e){console.error(e);}if(cfg.onShow)try{cfg.onShow.call(cfg,{});}catch(e){console.error(e);}}
function Page(cfg){window.__pendingPage__=cfg;}
function Component(cfg){window.__pendingComp__=cfg;}

function createPageInst(page,options){
  window.__pendingPage__=null;
  try{(new Function('Page','Component','getApp','wx',page.js))(Page,Component,getApp,window.wx);}catch(e){console.error('[wx] page js:',e);}
  var cfg=window.__pendingPage__||{data:{}};
  var data=Object.assign({},cfg.data||{});
  var inst={data:data,_cfg:cfg,_page:page,route:page.path,
    setData:function(obj,cb){Object.assign(this.data,obj);renderPage(this._page,this);if(cb)cb();}
  };
  Object.keys(cfg).forEach(function(k){if(typeof cfg[k]==='function')inst[k]=cfg[k].bind(inst);});
  renderPage(page,inst);
  if(cfg.onLoad)try{cfg.onLoad.call(inst,options);}catch(e){console.error(e);}
  if(cfg.onShow)try{cfg.onShow.call(inst);}catch(e){console.error(e);}
  if(cfg.onReady)setTimeout(function(){try{cfg.onReady.call(inst);}catch(e){console.error(e);}},0);
  return inst;
}

function convertWxss(wxss){return(wxss||'').replace(/([\\d.]+)rpx/g,function(_,n){return(parseFloat(n)/7.5).toFixed(3)+'vw';});}

function evalExpr(expr,data){try{return (new Function('data','with(data){return('+expr.trim()+')}'))(data||{});}catch(e){return '';}}
function processBindings(str,data){return str.replace(/\\{\\{([^}]+)\\}\\}/g,function(_,e){var r=evalExpr(e,data);return r==null?'':String(r);});}

var COMP_MAP={view:'div',text:'span',image:'img',button:'button',input:'input',textarea:'textarea','scroll-view':'div',swiper:'div','swiper-item':'div',navigator:'a',form:'form',label:'label',checkbox:'input',radio:'input',switch:'input',slider:'input',picker:'select',block:'template',icon:'span',progress:'progress','rich-text':'div',canvas:'canvas',video:'video',audio:'audio','open-data':'span',map:'div','checkbox-group':'div','radio-group':'div','picker-view':'div','picker-view-column':'div','movable-view':'div','movable-area':'div'};

function convertNode(node,data){
  if(node.nodeType===3)return processBindings(node.textContent||'',data);
  if(node.nodeType!==1)return '';
  var tag=node.tagName.toLowerCase();
  var htmlTag=COMP_MAP[tag]||'div';

  var wxIf=node.getAttribute('wx:if');
  if(wxIf!==null){var cond=evalExpr(wxIf.replace(/^\\{\\{/,'').replace(/\\}\\}$/,''),data);if(!cond)return '';}

  var wxFor=node.getAttribute('wx:for');
  if(wxFor!==null){
    var listExpr=wxFor.replace(/^\\{\\{/,'').replace(/\\}\\}$/,'').trim();
    var list;try{list=(new Function('data','with(data){return '+listExpr+'}'))(data||{});}catch(e){list=[];}
    if(!Array.isArray(list))list=[];
    var itemName=node.getAttribute('wx:for-item')||'item';
    var idxName=node.getAttribute('wx:for-index')||'index';
    return list.map(function(item,idx){
      var cd=Object.assign({},data);cd[itemName]=item;cd[idxName]=idx;
      var clone=node.cloneNode(true);
      clone.removeAttribute('wx:for');clone.removeAttribute('wx:for-item');clone.removeAttribute('wx:for-index');clone.removeAttribute('wx:key');
      return convertNode(clone,cd);
    }).join('');
  }

  var attrs='',events='';
  for(var i=0;i<node.attributes.length;i++){
    var a=node.attributes[i],nm=a.name,val=processBindings(a.value,data);
    if(nm.startsWith('wx:'))continue;
    if(nm.startsWith('bind')||nm.startsWith('catch')||nm.startsWith('mut-bind')){
      var evType=nm.replace(/^(bind|catch|mut-bind)/,'');
      if(evType==='tap')evType='click';
      if(evType==='longtap')evType='contextmenu';
      events+=' on'+evType+'="__wxEvt__(event,\\x27'+a.value+'\\x27)"';
      continue;
    }
    if(nm==='class'){attrs+=' class="'+val+'"';continue;}
    if(nm==='style'){attrs+=' style="'+val+'"';continue;}
    if(nm==='src'){attrs+=' src="'+val+'"';continue;}
    if(nm==='id'){attrs+=' id="'+val+'"';continue;}
    if(nm==='type'){attrs+=' type="'+val+'"';continue;}
    if(nm==='placeholder'){attrs+=' placeholder="'+val.replace(/"/g,'&quot;')+'"';continue;}
    if(nm==='value'){attrs+=' value="'+val.replace(/"/g,'&quot;')+'"';continue;}
    if(nm==='checked'&&val==='true'){attrs+=' checked';continue;}
    if(nm==='disabled'&&val==='true'){attrs+=' disabled';continue;}
    if(nm==='url'&&tag==='navigator'){attrs+=' data-nav-url="'+val.replace(/"/g,'&quot;')+'" href="javascript:void(0)"';continue;}
    if(nm==='mode'&&tag==='image'){attrs+=' data-img-mode="'+val+'"';continue;}
    if(nm==='scroll-y'){attrs+=' data-scroll-y="'+val+'"';continue;}
    if(nm==='scroll-x'){attrs+=' data-scroll-x="'+val+'"';continue;}
    attrs+=' data-wx-'+nm+'="'+val.replace(/"/g,'&quot;')+'"';
  }

  if(tag==='image'){
    return '<img'+attrs+events+' style="display:block;" />';
  }
  var selfClose=new Set(['input','checkbox','radio','switch','slider','progress']);
  if(selfClose.has(tag))return '<'+htmlTag+attrs+events+' />';
  if(tag==='block'||tag==='template'){
    var bc='';for(var c=0;c<node.childNodes.length;c++)bc+=convertNode(node.childNodes[c],data);return bc;
  }
  var children='';
  for(var c=0;c<node.childNodes.length;c++)children+=convertNode(node.childNodes[c],data);
  return '<'+htmlTag+attrs+events+'>'+children+'</'+htmlTag+'>';
}

function wxmlToHtml(wxml,data){
  try{
    var parser=new DOMParser();
    var doc=parser.parseFromString('<wx-root>'+wxml+'</wx-root>','text/html');
    var root=doc.querySelector('wx-root');
    if(!root)return '<div style="color:red;padding:16px;">WXML parse error</div>';
    var out='';
    for(var i=0;i<root.childNodes.length;i++)out+=convertNode(root.childNodes[i],data);
    return out;
  }catch(e){return '<div style="color:red;padding:16px;">WXML Error: '+e.message+'</div>';}
}

function renderPage(page,inst){
  __currentPageInst__=inst;
  var nb=document.getElementById('__wx_navbar__');
  if(nb){
    var t=nb.querySelector('.__wx_nav_title__');
    if(t)t.textContent=page.title||__appConfig__.navTitle;
    var bb=nb.querySelector('.__wx_nav_back__');
    if(bb)bb.style.display=__pageStack__.length>1?'flex':'none';
  }
  var html;
  try{html=wxmlToHtml(page.wxml,inst?inst.data:{});}catch(e){html='<div style="color:red;padding:16px;">Render error: '+e.message+'</div>';}
  var cont=document.getElementById('__wx_page_container__');
  if(!cont)return;
  cont.innerHTML=html;
  var st=document.getElementById('__wx_page_style__');
  if(st)st.textContent=convertWxss(page.wxss||'');
  cont.querySelectorAll('[data-scroll-y="true"]').forEach(function(el){el.style.overflowY='scroll';el.style.webkitOverflowScrolling='touch';});
  cont.querySelectorAll('[data-scroll-x="true"]').forEach(function(el){el.style.overflowX='scroll';});
  cont.querySelectorAll('img[data-img-mode]').forEach(function(el){
    var m=el.getAttribute('data-img-mode');
    var fit={aspectFit:'contain',aspectFill:'cover',scaleToFill:'fill',widthFix:'fill',heightFix:'fill'};
    el.style.objectFit=fit[m]||'fill';
    if(!el.style.width)el.style.width='100%';
    if(!el.style.height)el.style.height='100%';
  });
  cont.querySelectorAll('[data-nav-url]').forEach(function(el){
    el.onclick=function(e){e.preventDefault();window.__wxNavigate(el.getAttribute('data-nav-url'));};
  });
}

window.__wxEvt__=function(event,handlerName){
  if(!__currentPageInst__)return;
  var h=__currentPageInst__[handlerName]||(__currentPageInst__._cfg&&__currentPageInst__._cfg[handlerName]);
  if(typeof h!=='function')return;
  var el=event.currentTarget||event.target;
  var ds={};
  if(el&&el.attributes)for(var i=0;i<el.attributes.length;i++){var a=el.attributes[i];if(a.name.startsWith('data-wx-')){var k=a.name.slice(8).replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});ds[k]=a.value;}}
  var wxe={type:event.type==='click'?'tap':event.type,timeStamp:Date.now(),target:{id:el?el.id:'',dataset:ds},currentTarget:{id:el?el.id:'',dataset:ds},detail:{x:event.clientX||0,y:event.clientY||0},touches:[],changedTouches:[]};
  try{h.call(__currentPageInst__,wxe);}catch(e){console.error('[wx] handler error:',e);}
};

document.addEventListener('DOMContentLoaded',function(){
  try{(new Function('App','getApp','wx',${appJsJsonSafe}))(App,getApp,window.wx);}catch(e){console.error('[wx] app.js:',e);}
  var entryPage=__pages__.find(function(p){return p.path===${JSON.stringify(entryPage)};});
  if(entryPage){var inst=createPageInst(entryPage,{});__pageStack__.push({page:entryPage,inst:inst});renderPage(entryPage,inst);}
});
${_closeScript}
</body>
</html>`;
}

export function WeChatPreview({ files, refreshKey }: WeChatPreviewProps) {
  const flatFiles = useMemo(
    () =>
      flattenFiles(files)
        .filter((f) => f.path && f.content !== undefined)
        .map((f) => ({ path: f.path!, content: f.content || "" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, refreshKey],
  );

  const srcdoc = useMemo(() => buildWeChatPreviewHtml(flatFiles), [flatFiles]);

  return (
    <iframe
      key={refreshKey}
      srcDoc={srcdoc}
      className="w-full h-full border-0"
      title="WeChat Mini Program Preview"
      sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
      data-testid="wechat-preview-iframe"
    />
  );
}
