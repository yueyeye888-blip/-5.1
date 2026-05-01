# CDP Helper Tools

CDP helper 位于 `C:\Users\Administrator\cdp_helper.js`，通过 node 运行：

```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js <command> [args...] <tab_keyword>
```

## 命令列表

| 命令 | 用法 | 说明 |
|------|------|------|
| list | `list` | 列出所有 Chrome 标签页 |
| navigate | `navigate "url" xiumi` | 导航到指定 URL |
| js_file | `js_file "path.js" xiumi` | 在页面上执行 JS 文件 |
| eval | `eval "js_code" xiumi` | 直接执行 JS 代码 |
| screenshot | `screenshot "path.png" xiumi` | 截图保存 |

## 秀米图文发布流程 (6 步)

### 概览
1. 导航到模板 → 等待 12 秒
2. 另存一个图文 (click_save_as.js) → 等待 10 秒
3. 填充内容 (fill_content.js) → 等待 4 秒
4. 设置标题 (set_title.js) → 等待 3 秒
5. 保存 (save.js) → 等待 5 秒
6. 同步到公众号 (click_sync.js) → 等待 30 秒

### 详细步骤

**Step 1: 导航到模板**
```
navigate "https://xiumi.us/studio/v5#/paper/for/688555738/cube/0" xiumi
```
⚠️ URL 必须包含 `/cube/0`，否则页面不会完整加载。
等待 12 秒让页面完全加载。

**Step 2: 另存一个图文**
```
js_file "C:\Users\Administrator\click_save_as.js" xiumi
```
调用 Angular scope 的 `onBtnClickSaveAs()` 函数，创建模板的一个新副本。
- 成功返回 `SAVEAS_TRIGGERED`
- URL 应该从 `for/688555738` 变为新的文档 ID（如 `for/690xxxxx`）
- 等待 10 秒让新页面加载

**Step 3: 填充内容**
```
js_file "C:\Users\Administrator\fill_content.js" xiumi
```
通过 Angular 模型 (`comp.txt1.text`) 直接更新各段落内容。

fill_content.js 模板格式如下（每次发新文章，替换大括号内的变量）：
```javascript
(function(){
var ps=document.querySelectorAll('p');
var results=[];
function sm(idx,html){
  var p=ps[idx];
  if(!p){results.push('MISS:'+idx);return;}
  try{
    var scope=angular.element(p).scope();
    if(scope&&scope.comp&&scope.comp.txt1){
      scope.comp.txt1.text=html;
      scope.$apply();
      results.push('OK:'+idx);
    }else{results.push('NO_MODEL:'+idx);}
  }catch(e){results.push('ERR:'+idx+':'+e.message);}
}

// 引言
sm(11,'{INTRO}');
// 01 标题
sm(16,'{S01}');  // 不要带【01】编号
// 01 正文
sm(18,'{B01}');
// 02 标题
sm(23,'{S02}');  // 不要带【02】编号
// 02 正文
sm(25,'{B02}');
// 03 标题
sm(30,'{S03}');  // 不要带【03】编号
// 03 正文
sm(32,'{B03}');
// 结语
sm(35,'{OUTRO}');

return JSON.stringify(results);
})()
```

⚠️ **重要规则**：
- 必须填充全部 8 个位置（引言、01标题、01正文、02标题、02正文、03标题、03正文、结语）
- **绝对不能 cl() 清除或 sm() 覆盖 p[37] 及之后的任何段落**，那些是底部固定内容（关注我们、合作对接、联系方式、免责声明等）
- **03 标题和正文必须填写**，不能跳过或清除
- **小标题中不要带【01】【02】【03】编号**，直接写标题内容即可（如 `<p>1.6 倍超额抵押：穆迪如何给比特币定价</p>`，而不是 `<p>【01】1.6 倍超额抵押...</p>`）
- 文本格式为 HTML：`<p>段落内容</p>`，多段用 `\n\n` 分隔
- 中文必须使用 Unicode 转义（`\uXXXX`）

成功返回类似 `["OK:11","OK:16","OK:18","OK:23","OK:25","OK:30","OK:32","OK:35"]`
等待 4 秒

**Step 4: 设置标题**
```
js_file "C:\Users\Administrator\set_title.js" xiumi
```
通过 Angular 模型 `deskCtrl.showData.title` 更新标题。

set_title.js 模板格式：
```javascript
(function(){
var title='{TITLE}';
var input=document.querySelector('input.title')||document.querySelector('input[placeholder]');
if(!input)return'ERROR:NO_INPUT';
input.value=title;
input.dispatchEvent(new Event('input',{bubbles:true}));
var scope=angular.element(input).scope();
if(!scope)return'ERROR:NO_SCOPE';
var s=scope;
while(s&&!s.deskCtrl)s=s.$parent;
if(!s||!s.deskCtrl)return'ERROR:NO_DESKCTRL';
s.deskCtrl.showData.title=title;
s.$apply();
return'TITLE_OK:'+title;
})()
```

- set_title.js 需要预先写入新标题（使用 Unicode 转义）
- 成功返回 `TITLE_OK: 新标题`

**Step 5: 保存**
```
js_file "C:\Users\Administrator\save.js" xiumi
```
调用 Angular scope 的 `onBtnClickSave()` 函数保存文档。
- 成功返回 `SAVE_OK:{...}` 包含保存的标题和文档 ID
- 等待 5 秒

**Step 6: 同步到公众号**
```
js_file "C:\Users\Administrator\click_sync.js" xiumi
```
调用 Angular scope 的 `onBtnClickSend('origin')` 函数同步到微信公众号。
- 成功返回 `SYNC_TRIGGERED`（或 Promise 返回 `{ok:true, media_id:...}`）
- 等待 30 秒确保同步完成

## 模板段落索引（基于模板 688555738）

```
p[10]  → "引言："     （标记，不要修改）
p[11]  → 引言正文     ← 填充 {INTRO}
p[15]  → "01"         （标记，不要修改）
p[16]  → 01 小标题    ← 填充 {S01}
p[18]  → 01 正文      ← 填充 {B01}
p[22]  → "02"         （标记，不要修改）
p[23]  → 02 小标题    ← 填充 {S02}
p[25]  → 02 正文      ← 填充 {B02}
p[29]  → "03"         （标记，不要修改）
p[30]  → 03 小标题    ← 填充 {S03}
p[32]  → 03 正文      ← 填充 {B03}
p[34]  → "结语："     （标记，不要修改）
p[35]  → 结语正文     ← 填充 {OUTRO}
p[37+] → 底部内容     ⛔ 禁止修改（关注我们、合作对接、联系方式、免责声明）
```

## 关键技术点

1. **Angular 模型**: 秀米使用 AngularJS，内容修改必须通过 Angular 模型进行，不能只改 DOM
2. **文本存储格式**: 每个段落的文本在 `comp.txt1.text` 中，格式为 HTML（如 `<p>内容</p>`）
3. **标题模型**: 标题绑定到 `deskCtrl.showData.title`（ng-model）
4. **中文编码**: JS 文件中的中文必须使用 Unicode 转义（`\uXXXX`）
5. **模板 URL**: `https://xiumi.us/studio/v5#/paper/for/688555738/cube/0`（必须带 /cube/0）
6. **公众号账号**: Web3领航团队（appId: 45de8c6a3d...），已授权并自动选中
7. **底部保护**: p[37] 及之后的段落是固定底部内容（关注我们、合作对接、联系方式、End、免责声明），绝对不能修改或清除

## JS 文件列表

| 文件 | 功能 | 修改方式 |
|------|------|---------|
| click_save_as.js | 另存图文 | Angular scope onBtnClickSaveAs() — 固定不变 |
| fill_content.js | 填充文章内容 | Angular 模型 comp.txt1.text — 每篇文章重写 |
| set_title.js | 设置标题 | Angular 模型 deskCtrl.showData.title — 每篇文章重写 |
| save.js | 保存文档 | Angular scope onBtnClickSave() — 固定不变 |
| click_sync.js | 同步到公众号 | Angular scope onBtnClickSend('origin') — 固定不变 |
