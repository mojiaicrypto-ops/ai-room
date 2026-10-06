# D2 Independent Test — Passed（实机覆盖限制已记录）

Tester /root/test_d2；代码只读，临时脚本在/tmp；真实Wrangler localhost:8788；独立房间r_test_d2_independent。
基线room-page SHA256 701f16c0183be910f12f8284271fb6d684940d22f4bfc9ce4d81ff57ddbb39a9，测试前后相同。

npm test退出0：16/16，0失败0跳过。
真实浏览器桌面1280×720、手机390×844；viewport已恢复；手机整页无溢出；错误日志为空。

Passed行为：成员实时进出6→1/role/me/数量、成员点击含空格名称；@大小写/中文/空/无匹配、Arrow/Enter/Tab/Esc；中部替换“前文 @Code 后文”至“前文 @Codex 后文”，caret10后文保持；Shift+ArrowUp跨行选区2–7关闭候选、不误补全；Shift+Enter多行/Enter发送/空白禁用；昵称重新welcome真实名称Human_2_2、草稿保留/历史不重复；单页断网发送/提及禁用、草稿保留，恢复网络自动连接与去重；旧消息阅读scrollTop保持0，新消息按钮跳底；恶意img/script名字/消息为文本、DOM无新图片或脚本、无弹窗。

IME组合事件独立VM /tmp/d2-ime-independent.mjs通过：compositionstart/end、isComposing、keyCode229守卫；组词不发送，结束后Enter正常。
touch pointerdown独立VM通过：preventDefault、保持焦点、后续click按实时片段替换且保留后文。
实机覆盖限制：iab不支持Input.imeSetComposition与Input.dispatchTouchEvent，真实OS输入法/物理触屏未自动验证。使用代码级事件证据及真实浏览器键盘/窄屏点击证据作为本次非阻塞处置，限制登记known-issues，未宣称实机全覆盖。

截图：desktop-test.jpg、mobile-test.jpg、empty-members-test.jpg；本地临时页面与成员连接已关闭。线上最终冒烟另补。

## 线上独立冒烟 — Passed

新页面HTTP200，新模板/IME处理标记全部存在；原5条历史ID和内容完整，在线Human/Codex。
主Agent经新版UI发送m_d5b47216，Codex回复m_7a988537“已收到你的消息，新版输入框发送正常。”，约6401ms。
独立只读证据保存/tmp/d2-online-independent.json，2026-10-06T06:49:34.663Z；无额外线上发言/用户tab刷新。
线上预览截图online-preview.png显示真实成员与@co筛选。测试页面/临时成员/本地Wrangler已清理；用户房间与既有Codex PID54697保持运行。
