# 现场演示层（Live Show Layer）

可编辑层解决的是「改」，这一层解决的是「讲」。当 deck 要拿到现场投屏、边讲边让观众动手时，加上这一层：全屏一键进、示例截图点击放大、提示词一键复制、演示网址一键跳转。

这套能力来自一次真实的线下培训交付（14 课 AI 课程现场分享 deck），全部实跑验证过。

## 用户怎么用

- **⛶ 全屏**：工具栏按钮或按 `F` 键，网页端直接进全屏放映，不用先按浏览器菜单。
- **图片点击放大**：deck 里的示例截图（终端截图、后台界面、成果图）点一下弹出全屏 lightbox 看细节，点任意处或按 ESC 关闭。台下看不清的图，讲的时候点开就行。
- **一键复制提示词**：演示页放一个「复制提示词」按钮，观众现场点一下就把整段 prompt 复制走，直接粘给自己的 agent 跑。比口播念、拍屏幕抄靠谱得多。
- **一键跳转链接**：现场要打开的网址（demo 站、报名页）做成页内大按钮直接点，不要现场手敲网址。
- **P 键**：直接呼出打印（导出 PDF）。

## 几条关键铁律

- **lightbox 打开时接管键盘**。方向键 / 空格 / ESC 这时只负责关图，不翻页。不做这个隔离，讲到一半点开图、按方向键想关图，deck 却在背后翻了三页。
- **点击翻页必须排除按钮和链接**。deck 若做了「点右半屏下一页」，处理器里先 `if(e.target.closest('button,a'))return`，否则观众点「复制提示词」的同时 deck 翻页了。
- **所有演示层覆盖物不进打印**：lightbox、工具栏、复制按钮，`@media print` 一律 `display:none`。
- **复制按钮要有反馈**：点完按钮文字变「已复制」再变回来，观众才知道成了。
- **提示词直接放 `data-prompt` 属性里**，按钮自己带内容，不依赖选中页面文字（观众在放映模式选不了字）。

## 怎么给新做的 deck 加上

把下面这段贴在 deck HTML 的 `</body>` 之前（可以和可编辑层共存，它会把「全屏」按钮挂进已有的 `.he-toolbar`）：

```html
<!-- ===== HeiGe 现场演示层 (drop-in, 单文件零依赖) ===== -->
<style>
  .lb{position:fixed;inset:0;z-index:9999;background:rgba(10,10,10,.95);display:none;
      align-items:center;justify-content:center;cursor:zoom-out}
  .lb.on{display:flex}
  .lb img{max-width:96vw;max-height:92vh;object-fit:contain;
      border:1px solid rgba(255,255,255,.28);box-shadow:0 0 70px rgba(0,0,0,.6)}
  .lb-x{position:fixed;top:2.6vh;right:2.8vw;font-size:14px;letter-spacing:.08em;
      color:rgba(255,255,255,.75);pointer-events:none}
  .slide img[data-zoom]{cursor:zoom-in}
  @media print{.lb,.he-showbar,[data-he-live]{display:none!important}}
</style>
<script>
(function(){
  if (window.__heShow) return; window.__heShow = true;

  // 全屏（按钮 + F 键）
  window.tgFs = function(){ try{ var d=document, el=d.documentElement;
    if (d.fullscreenElement||d.webkitFullscreenElement){ (d.exitFullscreen||d.webkitExitFullscreen).call(d); }
    else { (el.requestFullscreen||el.webkitRequestFullscreen).call(el); } }catch(e){} };

  // 一键复制提示词：<button onclick="copyPrompt(this)" data-prompt="整段提示词">复制提示词</button>
  window.copyPrompt = function(btn){
    var p = btn.getAttribute('data-prompt') || '';
    function flash(txt){ var o=btn.textContent; btn.textContent=txt;
      setTimeout(function(){ btn.textContent=o; },1400); }
    var ok=function(){ flash('已复制'); }, fail=function(){ flash('复制失败，请手动选中'); };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(p).then(ok, fallback);
    } else fallback();
    // fallback 检查 execCommand 返回值：失败时如实提示，不谎报「已复制」
    function fallback(){ var t=document.createElement('textarea'); t.value=p;
      t.style.cssText='position:fixed;left:-9999px;top:0'; document.body.appendChild(t); t.focus(); t.select();
      var okd=false; try{ okd=document.execCommand('copy'); }catch(e){} t.remove();
      okd ? ok() : fail(); }
  };

  // 图片点击放大 lightbox：事件委托到 document（捕获段），免疫可编辑层 restore() 的 innerHTML
  // 替换（直绑到每张 img 的监听器会被 innerHTML 重写抹掉）。想全量接管把选择器换掉即可。
  var lb = document.createElement('div'); lb.className='lb';
  lb.innerHTML = '<span class="lb-x">点任意处 · 或按 ESC 关闭</span><img alt="放大图">';
  document.body.appendChild(lb);
  var big = lb.querySelector('img');
  document.addEventListener('click', function(e){
    var im = e.target.closest && e.target.closest('.slide img[data-zoom]');
    if (!im) return;
    e.stopPropagation(); big.src=im.src; lb.classList.add('on');
  }, true);
  lb.addEventListener('click', function(e){ e.stopPropagation(); lb.classList.remove('on'); });
  window.LBopen  = function(){ return lb.classList.contains('on'); };
  window.LBclose = function(){ lb.classList.remove('on'); };

  // 演示交互元素（复制提示词按钮、现场跳转大按钮）标记出来，@media print 里统一隐藏
  [].forEach.call(document.querySelectorAll('[onclick]'), function(b){
    if (/copyPrompt/.test(b.getAttribute('onclick')||'')) b.setAttribute('data-he-live','');
  });
  [].forEach.call(document.querySelectorAll('a.lk-btn'), function(a){ a.setAttribute('data-he-live',''); });

  // 键盘：lightbox 打开时捕获段吞掉一切翻页键（含翻页笔的 PageUp/Down、上下键、Home/End），
  // 只让关图键触发关闭；F 全屏、P 打印（编辑态、表单里、带修饰键时都不抢键）
  var isField = function(el){ return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName||'')); };
  var CLOSE = ['Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar','Enter'];
  document.addEventListener('keydown', function(e){
    if (isField(document.activeElement)) return;
    if (window.LBopen()){
      e.preventDefault(); e.stopPropagation();
      if (CLOSE.indexOf(e.key)>-1) window.LBclose();
      return;
    }
    if (e.metaKey||e.ctrlKey||e.altKey) return;         // 放行 Cmd/Ctrl+F 查找、Cmd/Ctrl+P 原生打印等
    if (e.key==='f'||e.key==='F') tgFs();
    if (e.key==='p'||e.key==='P') window.print();
  }, true);

  // 工具栏：有可编辑层就挂进它的工具栏，没有就自建一条
  function addBtn(){
    var host = document.querySelector('.he-toolbar');
    var b = document.createElement('button'); b.textContent='⛶ 全屏';
    b.addEventListener('click', function(e){ e.stopPropagation(); tgFs(); });
    if (host){ host.insertBefore(b, host.firstChild); }
    else {
      var bar = document.createElement('div'); bar.className='he-showbar';
      bar.style.cssText='position:fixed;right:16px;bottom:56px;z-index:99999';
      b.style.cssText='font:12px ui-monospace,monospace;cursor:pointer;border:1px solid #2a2a31;'+
        'background:#111114;color:#f3f1ec;padding:7px 11px;border-radius:4px';
      bar.appendChild(b); document.body.appendChild(bar);
    }
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', addBtn);
  else addBtn();
})();
</script>
```

## 页内怎么写演示元素

**提示词页**（观众照抄的整段 prompt）：

```html
<div class="pr-box">
  帮我把这篇文章改写成小红书笔记，要求：口语化、带 emoji、控制在 300 字以内……
  <button onclick="copyPrompt(this)" data-prompt="帮我把这篇文章改写成小红书笔记，要求：口语化、带 emoji、控制在 300 字以内……">复制提示词</button>
</div>
```

注意 `data-prompt` 里放完整原文（HTML 转义），页面展示可以截断，复制到手的必须是全量。

**可放大截图**：给图加 `data-zoom` 即可：`<img src="…" data-zoom alt="后台截图">`。

**现场跳转按钮**：`<a class="lk-btn" href="https://你的demo站" target="_blank">打开现场演示 ↗</a>`，做成大按钮，够大到台上一步点中。

## 和 deck 自己的翻页脚本怎么配合

这段脚本用**捕获阶段**监听键盘，lightbox 打开时会在 deck 自己的 keydown 处理器之前拦下翻页键，所以多数 deck 不用改任何代码。如果 deck 的键盘处理也注册在捕获阶段，就在它的处理器开头补一句：

```js
if (window.LBopen && window.LBopen()) return;
```

deck 若有「点击左右半屏翻页」，处理器开头必须有 `if(e.target.closest('button,a'))return;`（见铁律第二条）。
