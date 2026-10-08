// ─── FORUM ───
// Reddit-style forum: posts with flairs, up/down votes, Hot/New/Top sorting and
// threaded comments. Demo mode: everything is stored in this browser through
// ForumStore, and other open tabs update live via the `storage` event. To make
// it shared between people, replace ForumStore with a backend (e.g. Supabase:
// load = select, save = upsert, subscribe = realtime channel) — nothing else
// needs to change.

const FORUM_KEY = 'srot.forum.v1';
const FORUM_VOTES_KEY = 'srot.forum.votes';
const FORUM_NAME_KEY = 'srot.forum.name';
const FORUM_MINE_KEY = 'srot.forum.mine';

const FORUM_FLAIRS = [
  { id: 'feedback',   label: 'Feedback request', cls: 'ff-green' },
  { id: 'materials',  label: 'Materials',        cls: 'ff-teal' },
  { id: 'lca',        label: 'Carbon & LCA',     cls: 'ff-amber' },
  { id: 'built',      label: 'Built project',    cls: 'ff-blue' },
  { id: 'vernacular', label: 'Vernacular',       cls: 'ff-brown' },
  { id: 'research',   label: 'Research & data',  cls: 'ff-purple' },
  { id: 'general',    label: 'General',          cls: 'ff-gray' },
];

const ForumStore = {
  load() {
    try { return JSON.parse(localStorage.getItem(FORUM_KEY)); } catch (e) { return null; }
  },
  save(state) {
    try { localStorage.setItem(FORUM_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  },
  subscribe(onChange) {
    window.addEventListener('storage', e => { if (e.key === FORUM_KEY) onChange(); });
  },
};

function forumReadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
}
function forumWriteJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}

let forumState = null;
let forumVotes = {};          // id → 1 | -1 (this browser's votes)
let forumMine = [];           // ids created in this browser (can delete)
let forumSort = 'hot';
let forumFlair = null;        // flair filter
let forumOpenId = null;       // post being viewed
let forumReplyTo = null;      // comment id with an open reply box
let forumCollapsed = new Set();
let forumInited = false;

// ─── seed ───
function forumSeed() {
  const now = Date.now(), h = 3600e3;
  const c = (id, parentId, author, body, hoursAgo, score) => ({ id, parentId, author, body, created: now - hoursAgo * h, score });
  return {
    posts: [
      {
        id: 'p1', sample: true, flair: 'feedback', author: 'Meera Lal', created: now - 3 * h, score: 14,
        title: 'Feedback wanted: swapping a CMU party wall for stabilized rammed earth',
        body: 'Two-storey mixed-use scheme in a hot-dry climate. The analysis below is for one 10 m party wall. Rammed earth looks like a big carbon win, but I\'m unsure about the 300 mm thickness for fire separation and acoustic performance between units.\n\nHas anyone taken rammed earth through a fire rating for a party wall?',
        attachment: { title: 'SROT analysis · Wall · 30 m² / 9 m³', lines: ['CMU Block — 130 kgCO₂e/m² · total 3.9 tCO₂e', 'Rammed Earth — 70 kgCO₂e/m³ · total 630 kgCO₂e'] },
        comments: [
          c('c1', null, 'Sara Kovač', 'We built a 450 mm stabilized wall on a house in Dalmatia. Our engineer was comfortable with it as a separating wall, but the fire rating came from test data the supplier already had — ask your rammed earth contractor for theirs before you size it.', 2.5, 9),
          c('c2', 'c1', 'Meera Lal', 'That\'s really useful, thanks. Did you need a render on the face, or was it left exposed?', 2, 4),
          c('c3', 'c2', 'Sara Kovač', 'Exposed inside, with a breathable silicate sealer on the weather side.', 1.5, 5),
          c('c4', null, 'James Osei', 'For acoustics the mass helps a lot. Watch the junction with the floor slab — flanking through a stiff concrete slab can undo the gain.', 1, 6),
        ],
      },
      {
        id: 'p2', sample: true, flair: 'lca', author: 'Aarav Rao', created: now - 20 * h, score: 31,
        title: 'Sharing our cradle-to-gate LCA for engineered bamboo columns',
        body: 'We just finished an LCA for laminated bamboo columns on a school project in Karnataka. Happy to share the inventory and assumptions. The biggest swing factor was the adhesive and kiln drying energy, not the bamboo itself.\n\nWhat would be most useful for others: the spreadsheet, or a short write-up?',
        comments: [
          c('c5', null, 'Meera Lal', 'Spreadsheet please! Especially the transport assumptions.', 18, 7),
          c('c6', null, 'James Osei', 'A write-up with the system boundary diagram would help people reuse it correctly.', 16, 5),
        ],
      },
      {
        id: 'p3', sample: true, flair: 'built', author: 'James Osei', created: now - 2 * 24 * h, score: 22,
        title: 'Mycelium insulation pilot — first year of monitoring',
        body: 'Our pilot in Kumasi used mycelium-grown insulation panels in the roof of a small workshop. One year in: no visible mould, and indoor temperatures track the control building within about a degree. Humidity is the open question for the next rainy season.',
        comments: [
          c('c7', null, 'Aarav Rao', 'Did you log moisture content in the panels themselves, or just room humidity?', 40, 3),
        ],
      },
      {
        id: 'p4', sample: true, flair: 'vernacular', author: 'Sara Kovač', created: now - 4 * 24 * h, score: 12,
        title: 'Dry-stone walls in the Croatian islands — what can new builds borrow?',
        body: 'Collecting examples of dry-stone details (corbelling, through-stones, lime pointing) that could translate into contemporary low-carbon work. Photos and drawings welcome.',
        comments: [],
      },
    ],
  };
}

// ─── state ───
function forumInit() {
  if (forumInited) { forumRender(); return; }
  forumInited = true;
  forumState = ForumStore.load();
  if (!forumState || !Array.isArray(forumState.posts)) { forumState = forumSeed(); ForumStore.save(forumState); }
  forumVotes = forumReadJSON(FORUM_VOTES_KEY, {});
  forumMine = forumReadJSON(FORUM_MINE_KEY, []);
  let name = '';
  try { name = localStorage.getItem(FORUM_NAME_KEY) || ''; } catch (e) { /* ignore */ }
  document.getElementById('forum-name').value = name;
  forumRenderFlairs();
  forumRender();
  ForumStore.subscribe(() => {
    forumState = ForumStore.load() || forumState;
    forumToast('New activity');
    forumRender();
  });
  setInterval(() => { if (document.getElementById('panel-forum').classList.contains('show')) forumRender(); }, 60e3);
}

function forumSave() { ForumStore.save(forumState); }

function forumName() {
  const n = document.getElementById('forum-name').value.trim().slice(0, 40);
  return n || 'Guest';
}

function forumSaveName() {
  try { localStorage.setItem(FORUM_NAME_KEY, document.getElementById('forum-name').value.trim().slice(0, 40)); } catch (e) { /* ignore */ }
}

function forumId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function forumFindPost(id) { return forumState.posts.find(p => p.id === id); }

// ─── helpers ───
function forumEsc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function forumParas(s) {
  return forumEsc(s).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function forumAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString();
}

function forumInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

function forumAvatarCls(name) {
  const cls = ['av-teal', 'av-blue', 'av-amber', 'av-purple'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return cls[h % cls.length];
}

function forumFlairChip(id) {
  const f = FORUM_FLAIRS.find(x => x.id === id) || FORUM_FLAIRS[FORUM_FLAIRS.length - 1];
  return `<span class="forum-flair ${f.cls}">${f.label}</span>`;
}

function forumVoteBox(kind, id, score, postId) {
  const v = forumVotes[id] || 0;
  const pid = postId ? `,'${postId}'` : '';
  return `<div class="forum-vote ${kind}">
    <button class="${v === 1 ? 'up on' : 'up'}" onclick="event.stopPropagation();forumVote('${kind}','${id}',1${pid})" aria-label="Upvote"><i class="ti ti-arrow-big-up"></i></button>
    <span class="${v === 1 ? 'up' : v === -1 ? 'down' : ''}">${score}</span>
    <button class="${v === -1 ? 'down on' : 'down'}" onclick="event.stopPropagation();forumVote('${kind}','${id}',-1${pid})" aria-label="Downvote"><i class="ti ti-arrow-big-down"></i></button>
  </div>`;
}

function forumToast(msg) {
  const el = document.getElementById('forum-toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(forumToast._t);
  forumToast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ─── actions ───
function forumVote(kind, id, dir, postId) {
  const item = kind === 'post' ? forumFindPost(id) : (forumFindPost(postId) || { comments: [] }).comments.find(c => c.id === id);
  if (!item) return;
  const prev = forumVotes[id] || 0;
  const next = prev === dir ? 0 : dir;
  item.score += next - prev;
  if (next) forumVotes[id] = next; else delete forumVotes[id];
  forumWriteJSON(FORUM_VOTES_KEY, forumVotes);
  forumSave();
  forumRender();
}

function forumSetSort(sort) { forumSort = sort; forumRender(); }

function forumSetFlair(id) {
  forumFlair = forumFlair === id ? null : id;
  forumOpenId = null;
  forumRenderFlairs();
  forumRender();
}

function forumOpen(id) {
  forumOpenId = id;
  forumReplyTo = null;
  forumRender();
  document.getElementById('panel-forum').scrollTop = 0;
}

function forumBack() { forumOpenId = null; forumRender(); }

function forumExpandComposer() {
  document.getElementById('forum-composer').classList.add('open');
  const btn = document.getElementById('forum-attach-btn');
  btn.style.display = forumAnalysisSummary() ? '' : 'none';
}

function forumCancelPost() {
  ['forum-title', 'forum-body'].forEach(id => document.getElementById(id).value = '');
  forumComposerAttachment = null;
  document.getElementById('forum-attach-preview').innerHTML = '';
  document.getElementById('forum-composer').classList.remove('open');
}

let forumComposerAttachment = null;

// Summary of the current Analyse results, if the analysis is showing
function forumAnalysisSummary() {
  if (typeof userMaterials === 'undefined' || !userMaterials.length) return null;
  if (document.getElementById('screen-analysis').style.display === 'none') return null;
  const comp = activeComp.charAt(0).toUpperCase() + activeComp.slice(1);
  const qty = analysisQty ? [analysisQty.area && fmtNum(analysisQty.area) + ' m²', analysisQty.volume && fmtNum(analysisQty.volume) + ' m³'].filter(Boolean).join(' / ') : '';
  return {
    title: 'SROT analysis · ' + comp + (qty ? ' · ' + qty : ''),
    lines: userMaterials.map(m => {
      const d = MATERIAL_DATA[m];
      if (!d) return m;
      const t = materialTotal(d);
      const rate = d.perM3 && analysisQty && analysisQty.volume ? d.perM3 + ' kgCO₂e/m³' : d.carbon + ' kgCO₂e/m²';
      return m + ' — ' + rate + (t ? ' · total ' + fmtCarbon(t.kg) : '');
    }),
  };
}

function forumAttachAnalysis() {
  forumComposerAttachment = forumAnalysisSummary();
  document.getElementById('forum-attach-preview').innerHTML = forumComposerAttachment ? forumAttachmentHTML(forumComposerAttachment) : '';
  if (!document.getElementById('forum-flair').value || document.getElementById('forum-flair').value === 'general') document.getElementById('forum-flair').value = 'feedback';
}

function forumSubmitPost() {
  const title = document.getElementById('forum-title').value.trim().slice(0, 300);
  const body = document.getElementById('forum-body').value.trim().slice(0, 10000);
  if (!title) { document.getElementById('forum-title').focus(); return; }
  const post = {
    id: forumId(), title, body, flair: document.getElementById('forum-flair').value,
    author: forumName(), created: Date.now(), score: 1, comments: [],
  };
  if (forumComposerAttachment) post.attachment = forumComposerAttachment;
  forumState.posts.unshift(post);
  forumVotes[post.id] = 1;
  forumMine.push(post.id);
  forumWriteJSON(FORUM_VOTES_KEY, forumVotes);
  forumWriteJSON(FORUM_MINE_KEY, forumMine);
  forumSave();
  forumCancelPost();
  forumSort = 'new';
  forumOpen(post.id);
}

function forumAddComment(postId, parentId) {
  const box = document.getElementById(parentId ? 'forum-reply-' + parentId : 'forum-comment-body');
  const body = box.value.trim().slice(0, 10000);
  if (!body) { box.focus(); return; }
  const post = forumFindPost(postId);
  if (!post) return;
  const c = { id: forumId(), parentId: parentId || null, author: forumName(), body, created: Date.now(), score: 1 };
  post.comments.push(c);
  forumVotes[c.id] = 1;
  forumMine.push(c.id);
  forumWriteJSON(FORUM_VOTES_KEY, forumVotes);
  forumWriteJSON(FORUM_MINE_KEY, forumMine);
  forumSave();
  box.value = '';
  forumReplyTo = null;
  forumRender();
}

function forumToggleReply(id) {
  forumReplyTo = forumReplyTo === id ? null : id;
  forumRender();
  if (forumReplyTo) { const el = document.getElementById('forum-reply-' + id); if (el) el.focus(); }
}

function forumToggleCollapse(id) {
  forumCollapsed.has(id) ? forumCollapsed.delete(id) : forumCollapsed.add(id);
  forumRender();
}

function forumDeletePost(id) {
  if (!confirm('Delete this post and its comments?')) return;
  forumState.posts = forumState.posts.filter(p => p.id !== id);
  forumSave();
  forumOpenId = null;
  forumRender();
}

function forumDeleteComment(postId, id) {
  const post = forumFindPost(postId);
  if (!post) return;
  // Keep the thread shape: replies stay, the comment shows as deleted
  const c = post.comments.find(x => x.id === id);
  if (!c) return;
  c.deleted = true;
  c.body = '';
  forumSave();
  forumRender();
}

// ─── render ───
function forumRenderFlairs() {
  document.getElementById('forum-flairs').innerHTML = FORUM_FLAIRS.map(f =>
    `<button class="forum-flair ${f.cls}${forumFlair === f.id ? ' sel' : ''}" onclick="forumSetFlair('${f.id}')">${f.label}</button>`
  ).join('');
  document.getElementById('forum-flair').innerHTML = FORUM_FLAIRS.map(f =>
    `<option value="${f.id}"${f.id === 'general' ? ' selected' : ''}>${f.label}</option>`
  ).join('');
}

function forumSorted() {
  let posts = forumState.posts.slice();
  if (forumFlair) posts = posts.filter(p => p.flair === forumFlair);
  const hours = p => (Date.now() - p.created) / 3600e3;
  if (forumSort === 'new') posts.sort((a, b) => b.created - a.created);
  else if (forumSort === 'top') posts.sort((a, b) => b.score - a.score);
  else posts.sort((a, b) => (b.score + 1) / Math.pow(hours(b) + 2, 1.5) - (a.score + 1) / Math.pow(hours(a) + 2, 1.5));
  return posts;
}

function forumAttachmentHTML(a) {
  return `<div class="forum-attach">
    <div class="forum-attach-title"><i class="ti ti-chart-bar"></i> ${forumEsc(a.title)}</div>
    ${a.lines.map(l => `<div class="forum-attach-line">${forumEsc(l)}</div>`).join('')}
  </div>`;
}

function forumMeta(p) {
  return `<span class="forum-av ${forumAvatarCls(p.author)}">${forumEsc(forumInitials(p.author))}</span>
    <span class="forum-author">${forumEsc(p.author)}</span> · ${forumAgo(p.created)}`;
}

function forumRender() {
  if (!forumState) return;
  // Keep any half-typed reply across live re-renders
  const draftEl = forumReplyTo && document.getElementById('forum-reply-' + forumReplyTo);
  const draft = draftEl ? draftEl.value : '';
  const commentEl = document.getElementById('forum-comment-body');
  const commentDraft = commentEl ? commentEl.value : '';

  document.querySelectorAll('.forum-sort button').forEach(b => b.classList.toggle('on', b.dataset.sort === forumSort));
  const post = forumOpenId && forumFindPost(forumOpenId);
  document.getElementById('forum-feed-head').style.display = post ? 'none' : '';
  document.getElementById('forum-main').innerHTML = post ? forumPostHTML(post) : forumFeedHTML();

  if (draft) { const el = document.getElementById('forum-reply-' + forumReplyTo); if (el) el.value = draft; }
  if (commentDraft) { const el = document.getElementById('forum-comment-body'); if (el) el.value = commentDraft; }
}

function forumFeedHTML() {
  const posts = forumSorted();
  if (!posts.length) {
    return `<div class="empty-state"><i class="ti ti-messages"></i><div class="empty-state-title">No posts here yet</div><div class="empty-state-text">Start the conversation with the box above.</div></div>`;
  }
  return posts.map(p => {
    const n = p.comments.filter(c => !c.deleted).length;
    const preview = p.body.length > 220 ? p.body.slice(0, 220).trimEnd() + '…' : p.body;
    return `<div class="forum-card" onclick="forumOpen('${p.id}')">
      ${forumVoteBox('post', p.id, p.score)}
      <div class="forum-card-body">
        <div class="forum-meta">${forumMeta(p)} ${forumFlairChip(p.flair)}${p.sample ? '<span class="forum-sample">Example</span>' : ''}</div>
        <div class="forum-title">${forumEsc(p.title)}</div>
        ${preview ? `<div class="forum-preview">${forumEsc(preview)}</div>` : ''}
        ${p.attachment ? `<div class="forum-attach-pill"><i class="ti ti-chart-bar"></i> ${forumEsc(p.attachment.title)}</div>` : ''}
        <div class="forum-actions"><span><i class="ti ti-message-circle"></i> ${n} comment${n === 1 ? '' : 's'}</span></div>
      </div>
    </div>`;
  }).join('');
}

function forumPostHTML(p) {
  const mine = forumMine.includes(p.id);
  const n = p.comments.filter(c => !c.deleted).length;
  return `<button class="forum-back" onclick="forumBack()"><i class="ti ti-arrow-left"></i> All posts</button>
    <div class="forum-card open">
      ${forumVoteBox('post', p.id, p.score)}
      <div class="forum-card-body">
        <div class="forum-meta">${forumMeta(p)} ${forumFlairChip(p.flair)}${p.sample ? '<span class="forum-sample">Example</span>' : ''}</div>
        <div class="forum-title big">${forumEsc(p.title)}</div>
        <div class="forum-text">${forumParas(p.body)}</div>
        ${p.attachment ? forumAttachmentHTML(p.attachment) : ''}
        <div class="forum-actions"><span><i class="ti ti-message-circle"></i> ${n} comment${n === 1 ? '' : 's'}</span>
          ${mine ? `<button onclick="forumDeletePost('${p.id}')"><i class="ti ti-trash"></i> Delete</button>` : ''}</div>
      </div>
    </div>
    <div class="forum-comment-box">
      <div class="forum-comment-as">Comment as <strong>${forumEsc(forumName())}</strong></div>
      <textarea id="forum-comment-body" class="mat-input forum-textarea" rows="3" placeholder="What are your thoughts?"></textarea>
      <div class="forum-row-end"><button class="btn-primary" onclick="forumAddComment('${p.id}')">Comment</button></div>
    </div>
    <div class="forum-thread">${forumCommentsHTML(p, null, 0) || '<div class="forum-empty-comments">No comments yet — be the first to give feedback.</div>'}</div>`;
}

function forumCommentsHTML(p, parentId, depth) {
  return p.comments
    .filter(c => (c.parentId || null) === parentId)
    .sort((a, b) => b.score - a.score || a.created - b.created)
    .map(c => {
      const collapsed = forumCollapsed.has(c.id);
      const kids = forumCommentsHTML(p, c.id, depth + 1);
      const mine = forumMine.includes(c.id) && !c.deleted;
      const author = c.deleted ? '[deleted]' : c.author;
      return `<div class="forum-comment">
        <div class="forum-comment-rail" onclick="forumToggleCollapse('${c.id}')" title="${collapsed ? 'Expand' : 'Collapse'}"></div>
        <div class="forum-comment-main">
          <div class="forum-meta">${c.deleted ? '<span class="forum-author">[deleted]</span>' : `<span class="forum-av ${forumAvatarCls(author)}">${forumEsc(forumInitials(author))}</span><span class="forum-author">${forumEsc(author)}</span>`}
            ${c.author === p.author && !c.deleted ? '<span class="forum-op">OP</span>' : ''} · ${forumAgo(c.created)}
            ${collapsed ? `<button class="forum-link" onclick="forumToggleCollapse('${c.id}')">[+] expand</button>` : ''}</div>
          ${collapsed ? '' : `
            <div class="forum-text">${c.deleted ? '<p class="forum-deleted">Comment deleted</p>' : forumParas(c.body)}</div>
            <div class="forum-actions">
              ${forumVoteBox('comment', c.id, c.score, p.id)}
              ${depth < 6 && !c.deleted ? `<button onclick="forumToggleReply('${c.id}')"><i class="ti ti-message-circle"></i> Reply</button>` : ''}
              ${mine ? `<button onclick="forumDeleteComment('${p.id}','${c.id}')"><i class="ti ti-trash"></i> Delete</button>` : ''}
            </div>
            ${forumReplyTo === c.id ? `<div class="forum-reply-box">
              <textarea id="forum-reply-${c.id}" class="mat-input forum-textarea" rows="2" placeholder="Reply to ${forumEsc(author)}…"></textarea>
              <div class="forum-row-end"><button class="btn-ghost" onclick="forumToggleReply('${c.id}')">Cancel</button><button class="btn-primary" onclick="forumAddComment('${p.id}','${c.id}')">Reply</button></div>
            </div>` : ''}
            ${kids}`}
        </div>
      </div>`;
    }).join('');
}
