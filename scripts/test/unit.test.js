const test=require('node:test');
const assert=require('node:assert/strict');
const {mapFont,build}=require('../html2pptx');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const JSZip=require('jszip');
test('font matching respects complete families and priority',()=>{
  for(const [input,expected] of [
    ['Arial, sans-serif','微软雅黑'],['Inter, system-ui, sans-serif','微软雅黑'],
    ['"Noto Sans SC", sans-serif','微软雅黑'],['Georgia, serif','Georgia'],
    ['"Noto Serif SC", serif','宋体'],['monospace','Consolas'],
    ['Consolas, sans-serif','Consolas'],['sans-serif, serif','微软雅黑'],
    ['unknown-family, serif','Georgia']
  ]) assert.equal(mapFont(input),expected,input);
});
test('background raster becomes correctly positioned PPTX media and downgrade count',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-raster-'));
  try{
    const output=path.join(tmp,'out.pptx');
    const result=await build([{bg:'rgb(255,255,255)',shapes:[],svgs:[],texts:[],
      backgroundRaster:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII='}],output);
    assert.equal(result.ok,1);
    const zip=await JSZip.loadAsync(fs.readFileSync(output));
    assert.ok(Object.keys(zip.files).some(n=>/^ppt\/media\/.*\.png$/.test(n)));
    const xml=await zip.file('ppt/slides/slide1.xml').async('string');
    assert.match(xml,/<p:pic>/);assert.match(xml,/<a:off x="0" y="0"/);
    assert.match(xml,/<a:ext cx="12191695" cy="6858000"/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
