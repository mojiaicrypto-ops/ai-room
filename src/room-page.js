/** Room page and small, testable mention operations; no server-side routing. */
export function mentionAtCaret(value, start, end = start) {
  if (start !== end) return null;
  const before = value.slice(0, start);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const at = start - match[1].length - 1;
  let tokenEnd = start;
  while (tokenEnd < value.length && !/[\s@]/.test(value[tokenEnd])) tokenEnd++;
  return { start: at, end: tokenEnd, query: match[1] };
}

export function matchingMembers(members, query, self) {
  const normalized = query.toLocaleLowerCase();
  return members.filter(member => member.name !== self && member.name.toLocaleLowerCase().includes(normalized));
}

export function insertMention(value, range, name) {
  const rawPrefix = value.slice(0, range.start);
  const prefix = rawPrefix + (rawPrefix && !/\s$/.test(rawPrefix) ? ' ' : '');
  const suffix = value.slice(range.end);
  const separator = suffix.startsWith(' ') ? '' : ' ';
  const inserted = `@${name}${separator}`;
  return { value: prefix + inserted + suffix, caret: prefix.length + inserted.length + (separator ? 0 : 1) };
}

function roomClient() {
  const byId = id => document.getElementById(id);
  const roomId = byId('room-app').dataset.roomId;
  const messages = byId('messages');
  const input = byId('message-input');
  const sendButton = byId('send');
  const status = byId('connection-status');
  const memberList = byId('member-list');
  const menu = byId('mention-menu');
  const options = byId('mention-options');
  const count = byId('member-count');
  const notice = byId('composer-notice');
  const empty = byId('empty-state');
  let members = [];
  let selfName = '';
  let desiredName = 'Human';
  let ws;
  let connected = false;
  let retryTimer;
  let heartbeat;
  let retryAttempt = 0;
  let composing = false;
  let mentionRange = null;
  let candidates = [];
  let activeIndex = 0;
  let dismissedAt = null;
  const seen = new Set();
  const palette = ['#def0e6', '#e7e4f6', '#fae7d9', '#dcecf7', '#f3e2e8'];
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const avatar = (name, role) => {
    const result = node('span', 'avatar ' + (role === 'ai' ? 'avatar-ai' : ''), Array.from(name.trim())[0]?.toLocaleUpperCase() || '?');
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    result.style.backgroundColor = palette[hash % palette.length];
    result.setAttribute('aria-hidden', 'true');
    return result;
  };
  const isNearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  const scrollToBottom = () => { messages.scrollTop = messages.scrollHeight; byId('new-messages').hidden = true; };
  const roleLabel = role => role === 'ai' ? 'AI 助手' : '人类';
  function updateComposer() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    byId('new-messages').style.bottom = input.closest('footer').offsetHeight + 12 + 'px';
    byId('character-count').textContent = input.value.length + ' / 16384';
    sendButton.disabled = !connected || !input.value.trim() || composing;
    byId('mention-trigger').disabled = !connected;
  }
  function setConnection(state) {
    connected = state === 'connected';
    status.dataset.state = state;
    status.textContent = connected ? '已连接' : state === 'connecting' ? '连接中…' : '重新连接中…';
    notice.textContent = connected ? '' : '正在连接房间，未发送的文字会保留。';
    if (!connected) { members = []; renderMembers(); hideMentions(); }
    updateComposer();
  }
  function renderMembers() {
    memberList.replaceChildren();
    count.textContent = String(members.length);
    if (!members.length) memberList.append(node('p', 'members-empty', connected ? '等待其他成员加入' : '连接后显示在线成员'));
    for (const member of members) {
      const own = member.name === selfName;
      const button = node('button', 'member-card');
      button.type = 'button';
      button.disabled = own;
      button.setAttribute('aria-label', own ? member.name + '，我，' + roleLabel(member.role) : '提及 ' + member.name + '，' + roleLabel(member.role));
      button.append(avatar(member.name, member.role));
      const info = node('span', 'member-info');
      info.append(node('span', 'member-name', member.name));
      info.append(node('span', 'member-role', roleLabel(member.role) + (own ? ' · 我' : '')));
      button.append(info, node('span', 'online-dot'));
      button.addEventListener('click', () => insertMember(member.name));
      memberList.append(button);
    }
    if (!menu.hidden) updateMentions();
  }
  function addMessage(message, history = false) {
    if (message.type !== 'message' || !message.id || seen.has(message.id)) return;
    const nearBottom = isNearBottom();
    seen.add(message.id);
    // More than server history size, while bounding memory for long-running pages.
    if (seen.size > 1000) seen.delete(seen.values().next().value);
    empty.hidden = true;
    const own = message.from === selfName && message.role === 'human';
    const item = node('article', 'message' + (own ? ' message-own' : ''));
    item.dataset.messageId = message.id;
    item.append(avatar(String(message.from || '匿名'), message.role));
    const content = node('div', 'message-content');
    const meta = node('div', 'message-meta');
    meta.append(node('strong', '', own ? message.from + ' · 我' : String(message.from || '匿名')));
    meta.append(node('span', 'role-badge ' + (message.role === 'ai' ? 'badge-ai' : ''), roleLabel(message.role)));
    const time = node('time', '', new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    meta.append(time);
    content.append(meta, node('div', 'message-bubble', String(message.content || '')));
    item.append(content);
    messages.append(item);
    // Bound rendered transcript independently of the unread/scroll state.
    const transcript = messages.querySelectorAll('.message');
    if (transcript.length > 400) transcript[0].remove();
    if (nearBottom || own || history && messages.querySelectorAll('.message').length < 2) scrollToBottom();
    else byId('new-messages').hidden = false;
  }
  function systemMessage(text) {
    const nearBottom = isNearBottom();
    messages.append(node('p', 'system-message', text));
    const notices = messages.querySelectorAll('.system-message');
    if (notices.length > 30) notices[0].remove();
    if (nearBottom) scrollToBottom();
  }
  function hideMentions() {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    mentionRange = null;
    candidates = [];
  }
  function renderCandidates() {
    options.replaceChildren();
    if (!candidates.length) options.append(node('p', 'mention-empty', members.filter(m => m.name !== selfName).length ? '没有匹配的成员，试试其他名字' : '暂无其他在线成员'));
    candidates.forEach((member, index) => {
      const option = node('button', 'mention-option' + (index === activeIndex ? ' is-active' : ''));
      option.type = 'button';
      option.id = 'mention-option-' + index;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === activeIndex));
      option.tabIndex = -1;
      option.append(avatar(member.name, member.role));
      const info = node('span', 'member-info');
      info.append(node('span', 'member-name', member.name), node('span', 'member-role', roleLabel(member.role)));
      option.append(info, node('span', 'mention-symbol', '@'));
      // Keep the caret/textarea focus on pointer selection, including touch.
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => insertMember(member.name, true));
      options.append(option);
    });
    if (candidates.length) {
      input.setAttribute('aria-activedescendant', 'mention-option-' + activeIndex);
      byId('mention-option-' + activeIndex).scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function updateMentions() {
    if (composing || !connected || document.activeElement !== input) { hideMentions(); return; }
    const range = mentionAtCaret(input.value, input.selectionStart, input.selectionEnd);
    if (!range || dismissedAt === input.value + ':' + input.selectionStart) { hideMentions(); return; }
    const previousQuery = mentionRange?.query;
    mentionRange = range;
    candidates = matchingMembers(members, range.query, selfName);
    if (previousQuery !== range.query) activeIndex = 0;
    activeIndex = Math.min(activeIndex, Math.max(0, candidates.length - 1));
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    renderCandidates();
  }
  function insertMember(name, fromMenu = false) {
    if (!connected || !members.some(member => member.name === name && member.name !== selfName)) return;
    const currentRange = mentionAtCaret(input.value, input.selectionStart, input.selectionEnd);
    if (fromMenu && !currentRange) { hideMentions(); return; }
    const range = currentRange || { start: input.selectionStart, end: input.selectionEnd };
    const result = insertMention(input.value, range, name);
    if (result.value.length > 16384) { notice.textContent = '消息已达到长度上限，请先删减一些文字。'; return; }
    input.value = result.value;
    input.focus();
    input.setSelectionRange(result.caret, result.caret);
    hideMentions();
    updateComposer();
  }
  function connect() {
    clearTimeout(retryTimer);
    clearInterval(heartbeat);
    setConnection('connecting');
    const url = new URL('/room/' + roomId + '/ws', location.origin);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('name', desiredName);
    url.searchParams.set('role', 'human');
    const socket = new WebSocket(url);
    ws = socket;
    let lastPong = Date.now();
    heartbeat = setInterval(() => {
      if (socket !== ws) return;
      if (Date.now() - lastPong > 60000) { socket.close(); return; }
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
    socket.onopen = () => { if (socket === ws) setConnection('connected'); };
    socket.onclose = () => {
      if (socket !== ws) return;
      clearInterval(heartbeat);
      setConnection('reconnecting');
      retryTimer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(retryAttempt++, 5), 30000));
    };
    socket.onerror = () => { if (socket === ws) notice.textContent = '连接暂时不可用，正在重试。'; };
    socket.onmessage = event => {
      if (socket !== ws) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome') {
        selfName = String(message.you?.name || desiredName);
        byId('self-name').textContent = selfName;
        byId('self-avatar').textContent = Array.from(selfName)[0]?.toLocaleUpperCase() || '?';
        if (byId('name').value === desiredName) byId('name').value = selfName;
        retryAttempt = 0;
      } else if (message.type === 'participants') {
        members = (message.list || []).filter(member => typeof member.name === 'string').map(member => ({ name: member.name, role: member.role === 'ai' ? 'ai' : 'human' }));
        renderMembers();
      } else if (message.type === 'history') {
        const nearBottom = isNearBottom();
        for (const item of message.messages || []) addMessage(item, true);
        if (nearBottom) scrollToBottom();
      } else if (message.type === 'message') addMessage(message);
      else if (message.type === 'join' || message.type === 'leave') systemMessage(String(message.name) + (message.type === 'join' ? ' 加入了房间' : ' 离开了房间'));
      else if (message.type === 'pong') lastPong = Date.now();
      else if (message.type === 'error') notice.textContent = String(message.message || '消息暂时无法发送');
    };
  }
  function send() {
    if (composing || !connected || ws?.readyState !== 1 || !input.value.trim()) return;
    try { ws.send(JSON.stringify({ type: 'message', content: input.value.trim() })); }
    catch { notice.textContent = '发送失败，文字已保留，请稍后重试。'; return; }
    input.value = '';
    notice.textContent = '';
    dismissedAt = null;
    hideMentions();
    updateComposer();
    input.focus();
  }
  input.addEventListener('input', () => { dismissedAt = null; notice.textContent = connected ? '' : notice.textContent; updateComposer(); updateMentions(); });
  input.addEventListener('compositionstart', () => { composing = true; hideMentions(); updateComposer(); });
  input.addEventListener('compositionend', () => { composing = false; updateComposer(); updateMentions(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (!menu.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); dismissedAt = input.value + ':' + input.selectionStart; hideMentions(); return; }
      if (candidates.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key) && !event.shiftKey) {
        event.preventDefault();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
          renderCandidates();
        } else insertMember(candidates[activeIndex].name, true);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  });
  input.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) updateMentions(); });
  input.addEventListener('select', updateMentions);
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) updateMentions(); });
  input.addEventListener('click', updateMentions);
  input.addEventListener('focus', updateMentions);
  input.addEventListener('blur', () => hideMentions());
  byId('mention-trigger').addEventListener('click', () => {
    input.focus();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const prefix = input.value.slice(0, start);
    const inserted = (prefix && !/\s$/.test(prefix) ? ' ' : '') + '@';
    if (input.value.length - (end - start) + inserted.length > 16384) return;
    input.setRangeText(inserted, start, end, 'end');
    dismissedAt = null;
    updateComposer(); updateMentions();
  });
  sendButton.addEventListener('click', send);
  byId('identity-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = byId('name').value.trim();
    if (!name) { byId('name').focus(); return; }
    desiredName = name;
    byId('identity').open = false;
    const previous = ws;
    ws = null;
    previous?.close();
    connect();
  });
  byId('new-messages').addEventListener('click', scrollToBottom);
  messages.addEventListener('scroll', () => { if (isNearBottom()) byId('new-messages').hidden = true; });
  window.addEventListener('resize', updateComposer);
  window.addEventListener('pagehide', () => { clearTimeout(retryTimer); clearInterval(heartbeat); const previous = ws; ws = null; previous?.close(); });
  connect();
  updateComposer();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function viewerHtml(roomId) {
  const room = escapeHtml(roomId);
  // Wrangler's keep-names transform may wrap local functions with __name.
  // The page only needs their behavior, so provide the naming helper locally.
  const script = 'const __name = value => value;\n' + [mentionAtCaret, matchingMembers, insertMention].map(fn => fn.toString()).join('\n') + '\n(' + roomClient.toString() + ')();';
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Room · ${room}</title>
<style>
:root{color-scheme:light;--ink:#21352e;--muted:#78837d;--green:#275c46;--line:#e4e9e3;--surface:#fff;--bg:#f3f5f1}*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:var(--ink);background:var(--bg);height:100vh;height:100dvh}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default}button:focus-visible,summary:focus-visible{outline:3px solid #90b8a0;outline-offset:3px}[hidden]{display:none!important}.app{height:100%;max-width:1440px;margin:auto;display:flex;flex-direction:column;padding:0 32px 24px}.topbar{height:96px;flex-shrink:0;display:flex;align-items:center;gap:16px}.brand-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:var(--green);color:#fff;font-weight:700;font-size:19px}.brand-title{font-size:20px;font-weight:700;letter-spacing:-.5px}.brand-subtitle{font-size:12px;color:var(--muted);margin-top:5px}.connection{margin-left:auto;font-size:12px;display:flex;align-items:center;gap:7px;color:var(--muted);white-space:nowrap}.connection:before{content:"";width:7px;height:7px;border-radius:50%;background:#d3a55c}.connection[data-state=connected]:before{background:#65a882}.identity{position:relative}.identity summary{list-style:none;display:flex;align-items:center;gap:8px;cursor:pointer;border:1px solid var(--line);padding:6px 10px 6px 6px;border-radius:24px;background:white;font-size:13px;max-width:190px}.identity summary::-webkit-details-marker{display:none}.identity summary #self-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.identity-popup{position:absolute;right:0;top:48px;z-index:20;width:240px;padding:18px;border:1px solid var(--line);border-radius:16px;background:white;box-shadow:0 12px 35px #1d352619}.identity-popup label{display:block;font-size:13px;font-weight:600;margin-bottom:10px}.identity-popup input{width:100%;padding:10px;border:1px solid #cbd5cd;border-radius:8px}.identity-popup button{width:100%;margin-top:10px;padding:9px;border:0;border-radius:8px;background:var(--green);color:white}.identity-popup p{font-size:12px;color:var(--muted);line-height:1.6;margin:10px 0 0}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 264px;gap:20px;flex:1;min-height:0}.chat-panel{min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;background:white;border:1px solid var(--line);border-radius:24px;overflow:hidden;box-shadow:0 8px 30px #21352e04}.chat-heading{display:flex;align-items:center;gap:12px;padding:22px 26px;border-bottom:1px solid #edf0eb;flex-shrink:0}.room-mark{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;background:#ecf3ed;color:var(--green);font-size:22px}.chat-heading h1{font-size:16px;margin:0 0 5px}.chat-heading p{font-size:12px;color:var(--muted);margin:0}.live-label{margin-left:auto;font-size:11px;letter-spacing:1.6px;color:#658671}.messages{flex:1;min-height:0;overflow-y:auto;padding:26px;scrollbar-width:thin;overscroll-behavior:contain}.empty-state{padding:40px 15px;text-align:center;color:var(--muted)}.empty-state .empty-symbol{width:64px;height:64px;border-radius:22px;background:#f0f5ed;color:var(--green);font-size:28px;display:grid;place-items:center;margin:0 auto 18px}.empty-state h2{font-size:18px;color:var(--ink);margin:0 0 10px}.empty-state p{font-size:13px;line-height:1.8;margin:0}.message{display:flex;align-items:flex-start;gap:12px;margin:0 0 24px}.avatar{width:36px;height:36px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:650;color:#385146;flex-shrink:0}.avatar-ai{border-radius:10px}.message-content{min-width:0;max-width:84%}.message-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:2px 0 9px;font-size:12px}.message-meta strong{font-weight:600;overflow-wrap:anywhere}.message-meta time{font-size:11px;color:#929b95}.role-badge{font-size:10px;padding:2px 5px;border-radius:4px;color:#7d877e;background:#f1f3f0}.badge-ai{color:#647e63;background:#edf4e8}.message-bubble{font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;padding:13px 17px;background:#f5f6f3;border:1px solid #ecf0e9;border-radius:2px 15px 15px 15px}.message-own{flex-direction:row-reverse}.message-own .message-meta{justify-content:flex-end}.message-own .message-bubble{background:#eaf3eb;border-color:#deebde;border-radius:15px 2px 15px 15px}.system-message{text-align:center;font-size:11px;color:#929a94;margin:12px 0 20px}.composer-zone{padding:0 22px 18px;flex-shrink:0;position:relative}.composer{border:1px solid #dce4db;background:#fcfdfb;border-radius:17px;padding:14px 15px 10px;transition:box-shadow .15s,border-color .15s}.composer:focus-within{border-color:#93b39b;box-shadow:0 0 0 3px #eff5ed}.composer textarea{display:block;resize:none;outline:none;border:0;background:transparent;width:100%;min-height:56px;max-height:180px;padding:0 2px;font-size:14px;line-height:1.65;color:var(--ink);overflow-y:auto}.composer textarea::placeholder{color:#99a199}.composer-toolbar{display:flex;align-items:center;gap:12px;border-top:1px solid #edf0e9;padding-top:9px}.mention-trigger{border:0;background:none;color:#68816b;font-weight:600;font-size:12px;padding:7px 2px}.mention-trigger:hover{color:var(--green)}.keyboard-hint{color:#9ca49c;font-size:11px}.send-button{margin-left:auto;background:var(--green);border:0;color:#fff;border-radius:10px;padding:9px 16px;display:flex;gap:9px;align-items:center;font-size:12px}.send-button:hover:not(:disabled){background:#1c4935}.send-button:disabled{background:#e4e9e2;color:#99a498}.composer-footnote{display:flex;justify-content:space-between;gap:10px;color:#98a095;font-size:10px;padding:9px 4px 0;min-height:22px}.composer-notice{color:#9c7351}.member-panel{display:flex;flex-direction:column;min-height:0;padding:20px 0}.member-heading{display:flex;align-items:center;gap:8px;padding:0 12px}.member-heading h2{font-size:13px;margin:0;font-weight:650}.member-count{font-size:11px;padding:2px 6px;border-radius:5px;background:#e7ebe4;color:#627361}.member-caption{padding:0 12px;color:#8a9489;font-size:11px;margin:8px 0 20px;line-height:1.6}.member-list{min-height:0;overflow-y:auto;scrollbar-width:thin}.member-card{width:100%;display:flex;align-items:center;gap:10px;border:1px solid transparent;background:none;text-align:left;padding:12px;border-radius:14px;color:var(--ink);margin-bottom:4px;min-width:0}.member-card:not(:disabled):hover{background:#fff;border-color:var(--line)}.member-card:disabled{opacity:1}.member-info{display:flex;flex-direction:column;gap:5px;min-width:0;text-align:left}.member-name{font-size:13px;font-weight:550;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.member-role{font-size:10px;color:#8a958a}.online-dot{width:6px;height:6px;background:#7aa487;border-radius:50%;margin-left:auto;flex-shrink:0}.members-empty{font-size:12px;line-height:1.8;padding:12px;color:#8a9489}.room-note{margin-top:auto;padding:20px 12px 0;font-size:11px;line-height:1.8;color:#99a297}.room-note strong{display:block;font-weight:500;color:#7c887a;margin-bottom:4px}.mention-menu{position:absolute;bottom:calc(100% - 2px);left:22px;width:min(360px,calc(100% - 44px));padding:8px;border:1px solid #e0e8dd;border-radius:16px;background:white;box-shadow:0 14px 45px #19322020;z-index:10}.mention-heading{font-size:11px;display:flex;align-items:center;justify-content:space-between;color:#8a9488;padding:6px 8px 10px}.mention-options{max-height:240px;overflow-y:auto}.mention-option{width:100%;display:flex;gap:10px;align-items:center;padding:10px;border:0;border-radius:10px;background:white;color:var(--ink)}.mention-option.is-active{background:#eff5ec}.mention-option:hover{background:#e9f2e5}.mention-symbol{margin-left:auto;color:#96aa8f;font-size:18px}.mention-empty{font-size:12px;padding:16px 10px;color:#889281}.new-messages{position:absolute;bottom:180px;left:50%;transform:translateX(-50%);background:white;border:1px solid #d5e2d4;box-shadow:0 3px 14px #254e2315;border-radius:20px;padding:8px 14px;font-size:12px;color:var(--green);z-index:4;white-space:nowrap}
@media(min-width:1600px){.app{max-width:1500px;padding-top:12px;padding-bottom:36px}.topbar{height:108px}}@media(max-width:900px){.app{padding:0 18px 16px}.workspace{grid-template-columns:minmax(0,1fr) 210px;gap:12px}.chat-heading{padding:18px 20px}.messages{padding:22px 20px}.member-card{padding:10px 6px}.keyboard-hint{display:none}}@media(max-width:680px){.app{padding:0 10px 10px}.topbar{height:76px;gap:10px;padding:0 4px}.brand-icon{width:34px;height:34px;border-radius:11px;font-size:15px}.brand-title{font-size:17px}.brand-subtitle{font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis}.connection{font-size:10px;gap:5px}.identity summary{max-width:104px;font-size:11px;padding:4px 7px 4px 4px;gap:5px}.identity summary .avatar{width:25px;height:25px;font-size:11px;border-radius:9px}.identity-popup{top:42px}.workspace{display:flex;flex-direction:column;gap:10px}.member-panel{order:-1;flex-shrink:0;padding:4px 0 0;max-height:108px}.member-heading{padding:0 6px}.member-caption,.room-note{display:none}.member-list{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:5px 0}.member-card{width:auto;min-width:126px;max-width:200px;flex-shrink:0;margin:0;padding:8px;background:#fafbf8;border-color:var(--line);border-radius:12px;gap:8px}.member-card .avatar{width:28px;height:28px;font-size:12px;border-radius:9px}.member-card .member-name{font-size:11px}.member-card .member-role{font-size:9px}.member-card .online-dot{display:none}.member-panel .members-empty{margin:0;padding:6px;font-size:11px}.chat-panel{flex:1;border-radius:18px}.chat-heading{padding:14px 16px}.chat-heading h1{font-size:14px}.chat-heading p{font-size:11px}.room-mark{width:30px;height:30px;font-size:19px}.live-label{font-size:9px}.messages{padding:18px 14px}.message{gap:8px;margin-bottom:20px}.message>.avatar{width:28px;height:28px;font-size:11px;border-radius:9px}.message-content{max-width:88%}.message-meta{font-size:11px;gap:5px}.message-meta time{font-size:9px}.message-bubble{font-size:13px;padding:10px 13px}.composer-zone{padding:0 10px 10px}.composer{padding:11px 12px 9px;border-radius:14px}.composer textarea{font-size:16px;min-height:42px}.composer-footnote{font-size:9px}.composer-footnote .privacy-note{max-width:65%}.mention-menu{left:10px;width:calc(100% - 20px);max-width:360px}.new-messages{bottom:156px}.empty-state{padding:24px 10px}.empty-state h2{font-size:16px}}
</style></head>
<body><div class="app" id="room-app" data-room-id="${room}">
<header class="topbar"><div class="brand-icon" aria-hidden="true">ai</div><div><div class="brand-title">AI Room</div><div class="brand-subtitle">让想法在这里相遇</div></div><span class="connection" id="connection-status" role="status" data-state="connecting">连接中…</span>
<details class="identity" id="identity"><summary aria-label="编辑我的聊天昵称"><span class="avatar" id="self-avatar">H</span><span id="self-name">Human</span><span aria-hidden="true">⌄</span></summary><form class="identity-popup" id="identity-form"><label for="name">聊天昵称</label><input id="name" value="Human" maxlength="64" required autocomplete="nickname"><button type="submit">更新昵称</button><p>更新后会重新加入房间，未发送的文字会保留。</p></form></details></header>
<main class="workspace"><section class="chat-panel" aria-label="房间聊天"><header class="chat-heading"><span class="room-mark" aria-hidden="true">#</span><div><h1>一起聊聊</h1><p>房间 ${room}</p></div><span class="live-label">LIVE ROOM</span></header>
<div class="messages" id="messages" aria-label="聊天消息"><div class="empty-state" id="empty-state"><div class="empty-symbol" aria-hidden="true">✳</div><h2>从一句你好开始</h2><p>和房间里的成员一起讨论想法。<br>输入 @，选择你想对话的人。</p></div></div><button type="button" class="new-messages" id="new-messages" hidden>新消息 ↓</button>
<footer class="composer-zone"><div class="mention-menu" id="mention-menu" hidden><div class="mention-heading"><span>选择在线成员</span><span>↑ ↓ 选择 · Enter 确认</span></div><div class="mention-options" id="mention-options" role="listbox" aria-label="在线成员提及"></div></div>
<div class="composer"><textarea id="message-input" rows="2" maxlength="16384" placeholder="分享你的想法，输入 @ 提及成员…" aria-label="聊天消息输入框" aria-autocomplete="list" aria-controls="mention-options" aria-expanded="false" aria-describedby="input-help composer-notice"></textarea><div class="composer-toolbar"><button type="button" class="mention-trigger" id="mention-trigger">@ 提及成员</button><span class="keyboard-hint" id="input-help">Enter 发送 · Shift + Enter 换行</span><button type="button" class="send-button" id="send" disabled>发送 <span aria-hidden="true">↑</span></button></div></div>
<div class="composer-footnote"><span class="privacy-note">房间内的成员都能看到你的消息</span><span id="character-count">0 / 16384</span></div><div class="composer-notice" id="composer-notice" role="status"></div></footer></section>
<aside class="member-panel" aria-label="在线成员"><div class="member-heading"><h2>在线成员</h2><span class="member-count" id="member-count">0</span></div><p class="member-caption">点击成员，开始一次对话</p><div class="member-list" id="member-list"></div><div class="room-note"><strong>一个房间，多种视角。</strong>人类与 AI 在同一段对话里，<br>一起把想法向前推进。</div></aside></main></div>
<script>${script}</script></body></html>`;
}
