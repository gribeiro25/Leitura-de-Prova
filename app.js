/* Leitura de Prova — lê enunciados em voz alta, pergunta a pergunta.
 * Tudo corre no dispositivo: testes em localStorage, voz do navegador,
 * PDF via pdf.js e fotos via OCR (tesseract.js), carregados só quando preciso. */
(() => {
  'use strict';

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const DEFAULT_RATE = 0.9;

  const $app = document.getElementById('app');

  /* ---------- utilitários ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { alert('Não foi possível guardar no dispositivo (armazenamento cheio ou bloqueado).'); return false; }
    },
  };

  let tests = store.get('lp.tests', []);
  let settings = store.get('lp.settings', { voiceURI: '', fontScale: 1 });
  const saveTests = () => store.set('lp.tests', tests);
  const saveSettings = () => store.set('lp.settings', settings);

  const state = { view: 'home', testId: null, draft: null, imported: false, q: null };

  function go(view, patch) {
    stopSpeech();
    Object.assign(state, { imported: false }, patch, { view });
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    document.documentElement.style.setProperty('--fs', (1.25 * (settings.fontScale || 1)).toFixed(2) + 'rem');
    $app.replaceChildren(state.view === 'edit' ? viewEdit() : state.view === 'read' ? viewRead() : viewHome());
  }

  /* ---------- voz ---------- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  let runId = 0;
  const keepAlive = []; // evita que o navegador apanhe os utterances antes de acabarem

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices();
  }
  if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', () => { loadVoices(); if (state.view === 'home') render(); }); }

  function ptVoices() { return voices.filter((v) => /^pt/i.test(v.lang)); }
  function pickVoice() {
    const all = voices;
    return all.find((v) => v.voiceURI === settings.voiceURI)
      || all.find((v) => /^pt[-_]PT/i.test(v.lang))
      || all.find((v) => /^pt/i.test(v.lang))
      || null;
  }

  function stopSpeech() {
    runId++;
    if (synth) synth.cancel();
  }

  // Lê a lista de frases a partir de `start`. hooks: {sentence(i), done()}
  function speak(list, start, getRate, hooks) {
    if (!synth) { alert('Este navegador não suporta leitura em voz alta.'); return; }
    const run = ++runId;
    const busy = synth.speaking || synth.pending;
    synth.cancel();
    let i = start;
    const next = () => {
      if (run !== runId) return;
      if (i >= list.length) { hooks.done(); return; }
      const idx = i;
      hooks.sentence(idx);
      const u = new SpeechSynthesisUtterance(list[idx].speak);
      const voice = pickVoice();
      u.lang = voice ? voice.lang : 'pt-PT';
      if (voice) u.voice = voice;
      u.rate = getRate();
      const advance = () => {
        const k = keepAlive.indexOf(u); if (k >= 0) keepAlive.splice(k, 1);
        if (run !== runId) return;
        i = idx + 1; next();
      };
      u.onend = advance;
      u.onerror = (e) => { if (e.error === 'canceled' || e.error === 'interrupted') return; advance(); };
      keepAlive.push(u);
      synth.speak(u);
    };
    if (busy) setTimeout(next, 60); else next(); // chamada síncrona preserva o gesto do utilizador (iOS)
  }

  /* ---------- ecrã inicial ---------- */
  function viewHome() {
    const fileAny = h('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true, hidden: true,
      onchange: (e) => importFiles([...e.target.files], e.target) });
    const fileCam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
      onchange: (e) => importFiles([...e.target.files], e.target) });
    const fileJson = h('input', { type: 'file', accept: 'application/json,.json', hidden: true,
      onchange: (e) => importBackup(e.target.files[0], e.target) });

    const list = tests.length
      ? tests.map(testCard)
      : h('div', { class: 'card empty' }, 'Ainda não há testes. Importe um PDF/foto ou crie um teste novo.');

    const pt = ptVoices();
    const voiceSel = h('select', { id: 'voice', 'aria-label': 'Voz', onchange: (e) => { settings.voiceURI = e.target.value; saveSettings(); } },
      h('option', { value: '' }, pt.length ? 'Automática (português)' : 'Automática'),
      (pt.length ? pt : voices).map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === settings.voiceURI }, `${v.name} (${v.lang})`)));

    return h('div', {},
      h('h1', {}, 'Leitura de Prova'),
      h('p', { class: 'sub' }, 'Enunciados lidos em voz alta, pergunta a pergunta, ao ritmo do aluno.'),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: () => fileAny.click() }, '📄 Importar PDF ou foto'),
        h('button', { onclick: () => fileCam.click() }, '📷 Tirar foto ao teste'),
        h('button', { onclick: () => newTest() }, '✍️ Novo teste (escrever/colar)')),
      fileAny, fileCam, fileJson,
      h('h2', {}, 'Os meus testes'),
      list,
      h('details', {},
        h('summary', {}, 'Voz e cópia de segurança'),
        h('label', { class: 'field', for: 'voice' }, 'Voz de leitura'),
        voiceSel,
        pt.length ? null : h('p', { class: 'small' }, 'Não foi encontrada nenhuma voz em português neste dispositivo. Instale uma nas definições de voz/idioma do sistema.'),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { onclick: () => speakSample() }, '🔊 Experimentar voz')),
        h('h2', {}, 'Cópia de segurança'),
        h('p', { class: 'small' }, 'Os testes ficam só neste dispositivo. Exporte para guardar ou passar a outro dispositivo/colega.'),
        h('div', { class: 'row' },
          h('button', { onclick: exportBackup, disabled: !tests.length }, '⬇️ Exportar testes'),
          h('button', { onclick: () => fileJson.click() }, '⬆️ Importar cópia'))));
  }

  function testCard(t) {
    const n = t.blocks.filter((b) => b.type === 'question').length;
    return h('div', { class: 'card' },
      h('h3', {}, t.title || 'Sem título'),
      h('p', { class: 'sub' }, `${n} pergunta${n === 1 ? '' : 's'}`),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: !n, onclick: () => go('read', { testId: t.id, q: null }) }, '▶ Abrir para ler'),
        h('button', { onclick: () => go('edit', { testId: t.id, draft: clone(t) }) }, 'Editar'),
        h('button', { onclick: () => duplicateTest(t) }, 'Duplicar'),
        h('button', { class: 'danger', onclick: () => deleteTest(t) }, 'Apagar')));
  }

  function speakSample() {
    speak([{ speak: 'Pergunta 1 ponto 1. Qual é o título do texto?' }], 0, () => DEFAULT_RATE, { sentence() {}, done() {} });
  }

  function newTest() {
    go('edit', { testId: null, draft: { id: uid(), title: '', rate: DEFAULT_RATE, blocks: [{ type: 'text', label: '', text: '' }, { type: 'question', label: '1', text: '' }] } });
  }
  function duplicateTest(t) {
    const c = clone(t); c.id = uid(); c.title = (t.title || 'Teste') + ' (cópia)';
    tests.unshift(c); saveTests(); render();
  }
  function deleteTest(t) {
    if (!confirm(`Apagar "${t.title || 'Sem título'}"? Esta ação não pode ser desfeita.`)) return;
    tests = tests.filter((x) => x.id !== t.id); saveTests(); render();
  }

  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportBackup() {
    download('leitura-de-prova-testes.json', JSON.stringify({ app: 'leitura-de-prova', version: 1, tests }, null, 2), 'application/json');
  }
  async function importBackup(file, input) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (data.tests || []).filter((t) => t && Array.isArray(t.blocks));
      if (!incoming.length) throw new Error('vazio');
      for (const t of incoming) { t.id = uid(); tests.unshift(t); }
      saveTests(); render();
      alert(`${incoming.length} teste(s) importado(s).`);
    } catch { alert('O ficheiro não é uma cópia de segurança válida.'); }
    input.value = '';
  }

  /* ---------- importação PDF / foto ---------- */
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    return (loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Não foi possível carregar o módulo de importação. É preciso internet na primeira utilização.')); };
      document.head.append(s);
    }));
  }

  const dlg = document.getElementById('progress');
  const dlgMsg = document.getElementById('progress-msg');
  const dlgBar = document.getElementById('progress-bar');
  function progress(msg, pct) {
    if (!dlg.open) dlg.showModal();
    dlgMsg.textContent = msg;
    if (pct == null) dlgBar.removeAttribute('value'); else dlgBar.value = Math.round(pct);
  }
  dlg.addEventListener('cancel', (e) => e.preventDefault());

  async function importFiles(files, input) {
    input.value = '';
    if (!files.length) return;
    try {
      let text = '';
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const tag = files.length > 1 ? `Ficheiro ${i + 1}/${files.length}: ` : '';
        const part = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) ? await readPdf(f, tag) : await ocrImage(f, tag);
        text += part + '\n\n';
      }
      dlg.close();
      if (!text.replace(/\s/g, '')) { alert('Não foi possível reconhecer texto. Experimente uma foto mais nítida e bem iluminada.'); return; }
      const title = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      const blocks = Parser.parse(text);
      go('edit', { testId: null, imported: true, draft: { id: uid(), title: files.length === 1 && !/^(img|image|photo|whatsapp)/i.test(title) ? title : '', rate: DEFAULT_RATE, blocks } });
    } catch (err) {
      dlg.close();
      alert('Erro na importação: ' + (err && err.message ? err.message : err));
    }
  }

  async function readPdf(file, tag) {
    progress(tag + 'A carregar o leitor de PDF…', null);
    await loadScript(PDFJS);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      progress(`${tag}A ler a página ${p} de ${pdf.numPages}…`, (p - 1) / pdf.numPages * 100);
      out += pageText(await (await pdf.getPage(p)).getTextContent()) + '\n\n';
    }
    if (out.replace(/\s/g, '').length >= 40) return out;

    // PDF digitalizado (só imagens): fazer OCR a cada página
    let ocr = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const canvas = h('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      ocr += (await ocrSource(canvas, `${tag}OCR da página ${p} de ${pdf.numPages}`)) + '\n\n';
    }
    return ocr;
  }

  // Reconstrói linhas e parágrafos a partir dos fragmentos do pdf.js
  function pageText(content) {
    let out = '', lastY = null, lastEnd = null;
    for (const it of content.items) {
      if (!it.str && !it.hasEOL) continue;
      const x = it.transform[4], y = it.transform[5], ht = it.height || 10;
      if (lastY !== null && Math.abs(y - lastY) > ht * 0.5) out += lastY - y > ht * 1.8 ? '\n\n' : '\n';
      else if (lastEnd !== null && x - lastEnd > ht * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
      out += it.str;
      lastY = y; lastEnd = x + (it.width || 0);
    }
    return out;
  }

  async function ocrImage(file, tag) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 2200, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return ocrSource(canvas, tag + 'A reconhecer o texto da foto');
  }

  async function ocrSource(source, label) {
    progress(label + '… (a primeira vez demora mais: descarrega o idioma)', null);
    await loadScript(TESSERACT);
    const worker = await Tesseract.createWorker('por', 1, {
      logger: (m) => { if (m.status === 'recognizing text') progress(label + '…', m.progress * 100); },
    });
    try {
      const { data } = await worker.recognize(source);
      return data.text;
    } finally { await worker.terminate(); }
  }

  /* ---------- editor ---------- */
  function viewEdit() {
    const d = state.draft;
    const blocksBox = h('div', {});
    const drawBlocks = () => blocksBox.replaceChildren(...d.blocks.map((b, i) => blockCard(b, i, d, drawBlocks)));
    drawBlocks();

    const paste = h('textarea', { rows: 6, placeholder: 'Cole aqui o texto do teste. As linhas que começam por 1., 1.1, 2) ou "Pergunta 3" passam a perguntas.' });

    return h('div', {},
      h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: () => { if (confirm('Sair sem guardar?')) go('home'); } }, '← Cancelar'),
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => saveDraft(false) }, 'Guardar'),
        h('button', { class: 'primary', onclick: () => saveDraft(true) }, 'Guardar e ler')),
      h('h1', {}, state.testId ? 'Editar teste' : 'Novo teste'),
      state.imported ? h('div', { class: 'banner', role: 'note' }, '⚠️ Reveja o texto importado antes de usar com o aluno. O reconhecimento de fotos pode falhar em palavras, números e acentos — o que for lido deve ser igual ao teste.') : null,
      h('label', { class: 'field', for: 'title' }, 'Título do teste'),
      h('input', { id: 'title', type: 'text', value: d.title, placeholder: 'Ex.: Português 3.º ano – Teste 2', oninput: (e) => { d.title = e.target.value; } }),
      h('h2', {}, 'Texto e perguntas'),
      h('p', { class: 'small' }, 'Cada pergunta é lida com o último texto que a antecede. Use “Texto” para o texto de apoio e “Pergunta” para cada questão (1, 1.1, 2…).'),
      blocksBox,
      h('div', { class: 'row' },
        h('button', { onclick: () => { d.blocks.push({ type: 'text', label: '', text: '' }); drawBlocks(); } }, '+ Texto'),
        h('button', { onclick: () => { d.blocks.push({ type: 'question', label: nextLabel(d.blocks), text: '' }); drawBlocks(); } }, '+ Pergunta')),
      h('details', {},
        h('summary', {}, 'Acrescentar a partir de texto colado'),
        paste,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { onclick: () => {
            const add = Parser.parse(paste.value);
            if (!add.length) return;
            d.blocks.push(...add); paste.value = ''; drawBlocks();
          } }, 'Adicionar'))));
  }

  function nextLabel(blocks) {
    const qs = blocks.filter((b) => b.type === 'question');
    const last = qs.length ? qs[qs.length - 1].label : '';
    const m = /^(\d+)(?:\.\d+)*$/.exec(last);
    return m ? String(parseInt(m[1], 10) + 1) : String(qs.length + 1);
  }

  function blockCard(b, i, d, redraw) {
    const move = (dir) => { const j = i + dir; if (j < 0 || j >= d.blocks.length) return; [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]]; redraw(); };
    const ta = h('textarea', { 'aria-label': b.type === 'question' ? 'Texto da pergunta' : 'Texto de apoio', value: b.text,
      rows: Math.min(12, Math.max(3, Math.ceil(b.text.length / 60))), oninput: (e) => { b.text = e.target.value; } });
    return h('div', { class: 'card block ' + b.type },
      h('div', { class: 'row' },
        h('select', { 'aria-label': 'Tipo', onchange: (e) => { b.type = e.target.value; if (b.type === 'question' && !b.label) b.label = nextLabel(d.blocks.slice(0, i)); redraw(); } },
          h('option', { value: 'text', selected: b.type === 'text' }, 'Texto'),
          h('option', { value: 'question', selected: b.type === 'question' }, 'Pergunta')),
        b.type === 'question' ? h('input', { class: 'label-in', type: 'text', 'aria-label': 'Número da pergunta', placeholder: 'Nº', value: b.label, oninput: (e) => { b.label = e.target.value.trim(); } }) : null,
        h('span', { class: 'spacer' }),
        h('button', { 'aria-label': 'Ouvir', onclick: () => previewBlock(b) }, '🔊'),
        h('button', { 'aria-label': 'Subir', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        h('button', { 'aria-label': 'Descer', disabled: i === d.blocks.length - 1, onclick: () => move(1) }, '↓'),
        h('button', { class: 'danger', 'aria-label': 'Remover', onclick: () => { d.blocks.splice(i, 1); redraw(); } }, '✕')),
      ta);
  }

  function previewBlock(b) {
    const list = [];
    if (b.type === 'question') list.push({ speak: Parser.spokenLabel(b.label) });
    Parser.sentences(b.text).forEach((s) => list.push({ speak: s }));
    speak(list, 0, () => state.draft.rate || DEFAULT_RATE, { sentence() {}, done() {} });
  }

  function saveDraft(thenRead) {
    stopSpeech();
    const d = state.draft;
    d.blocks = d.blocks.filter((b) => b.text.trim());
    d.blocks.forEach((b) => { b.text = b.text.trim(); });
    if (!d.title.trim()) d.title = 'Teste sem título';
    const i = tests.findIndex((t) => t.id === d.id);
    if (i >= 0) tests[i] = d; else tests.unshift(d);
    if (!saveTests()) return;
    if (thenRead && d.blocks.some((b) => b.type === 'question')) go('read', { testId: d.id, q: null });
    else go('home');
  }

  /* ---------- leitor ---------- */
  function viewRead() {
    const t = tests.find((x) => x.id === state.testId);
    if (!t) { return h('div', {}, 'Teste não encontrado.'); }
    const qs = Parser.questionsWithContext(t.blocks);
    const body = h('div', {});
    const nav = h('div', { class: 'qnav', role: 'group', 'aria-label': 'Perguntas' });

    let script = [];          // frases a ler no modo atual
    let pos = 0;              // frase atual
    let mode = 'all';         // all | q | text
    let playing = false;
    let items = { text: [], q: [] };
    const getRate = () => t.rate || DEFAULT_RATE;

    const playBtn = h('button', { class: 'primary' }, '▶ Ouvir');
    const updatePlay = () => {
      playBtn.textContent = playing ? '⏸ Pausar' : (script.length && pos > 0 && pos < script.length ? '▶ Continuar' : '▶ Ouvir');
      playBtn.disabled = state.q == null;
    };

    function clearHl() { body.querySelectorAll('.speaking').forEach((e) => e.classList.remove('speaking')); }

    function play(from) {
      if (state.q == null) return;
      playing = true; updatePlay();
      speak(script, from, getRate, {
        sentence(i) { pos = i; clearHl(); const el = script[i].el; if (el) { el.classList.add('speaking'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } updatePlay(); },
        done() { playing = false; pos = 0; clearHl(); updatePlay(); },
      });
    }

    function startMode(m) {
      if (state.q == null) return;
      stopSpeech(); clearHl();
      mode = m;
      script = m === 'all' ? [...items.text, ...items.q] : m === 'text' ? items.text : items.q;
      pos = 0;
      if (!script.length) { playing = false; updatePlay(); return; }
      play(0);
    }

    function select(i, autoplay = true) {
      stopSpeech(); playing = false;
      state.q = i;
      [...nav.children].forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
      drawQuestion();
      if (autoplay) startMode('all'); else { script = []; pos = 0; updatePlay(); }
    }

    function drawQuestion() {
      items = { text: [], q: [] };
      if (state.q == null) { body.replaceChildren(h('p', { class: 'hint' }, 'Toque numa pergunta para a ouvir.')); return; }
      const { block, ctx } = qs[state.q];

      const sentenceSpans = (text, bucket) => h('p', {}, Parser.sentences(text).map((s, k, arr) => {
        const el = h('span', { class: 's' }, s);
        bucket.push({ speak: s, el });
        return [el, k < arr.length - 1 ? ' ' : ''];
      }));

      const panels = [];
      if (ctx.length) {
        const paras = ctx.map((c) => c.text.split(/\n{2,}/).map((para) => sentenceSpans(para, items.text)));
        panels.push(h('section', { class: 'panel' },
          h('div', { class: 'row' }, h('h2', {}, 'Texto'), h('span', { class: 'spacer' }),
            h('button', { onclick: () => startMode('text') }, '🔊 Só o texto')),
          h('div', { class: 'read' }, paras)));
      }
      const label = h('span', { class: 's qtitle' }, 'Pergunta ' + block.label);
      items.q.push({ speak: Parser.spokenLabel(block.label), el: label });
      panels.push(h('section', { class: 'panel' },
        h('div', { class: 'row' }, h('h2', {}, 'Pergunta'), h('span', { class: 'spacer' }),
          h('button', { onclick: () => startMode('q') }, '🔊 Só a pergunta')),
        h('div', { class: 'read' }, h('p', {}, label), sentenceSpans(block.text, items.q))));
      body.replaceChildren(...panels);
    }

    qs.forEach((q, i) => nav.append(h('button', { 'aria-current': 'false', 'aria-label': 'Pergunta ' + q.block.label, onclick: () => select(i) }, q.block.label || String(i + 1))));

    playBtn.addEventListener('click', () => {
      if (state.q == null) return;
      if (playing) { stopSpeech(); playing = false; updatePlay(); }
      else if (script.length && pos > 0 && pos < script.length) play(pos);
      else startMode(mode);
    });

    const rate = h('input', { type: 'range', min: 0.5, max: 1.5, step: 0.05, value: getRate(), 'aria-label': 'Velocidade da voz',
      oninput: (e) => { t.rate = parseFloat(e.target.value); rateOut.textContent = t.rate.toFixed(2) + '×'; },
      onchange: () => saveTests() });
    const rateOut = h('span', { class: 'small' }, getRate().toFixed(2) + '×');
    const bump = (d) => { settings.fontScale = Math.min(2, Math.max(0.8, +(settings.fontScale + d).toFixed(2))); saveSettings(); document.documentElement.style.setProperty('--fs', (1.25 * settings.fontScale).toFixed(2) + 'rem'); };

    const go2 = (d) => { const i = (state.q == null ? (d > 0 ? 0 : qs.length - 1) : state.q + d); if (i >= 0 && i < qs.length) select(i); };

    drawQuestion(); updatePlay();
    return h('div', {},
      h('div', { class: 'reader-top' },
        h('div', { class: 'row' },
          h('button', { class: 'ghost', onclick: () => go('home') }, '← Início'),
          h('strong', { class: 'spacer' }, t.title),
          h('button', { 'aria-label': 'Letra menor', onclick: () => bump(-0.1) }, 'A−'),
          h('button', { 'aria-label': 'Letra maior', onclick: () => bump(0.1) }, 'A+')),
        h('div', { class: 'slider' }, h('span', { class: 'small' }, 'Velocidade'), rate, rateOut)),
      nav, body,
      h('div', { class: 'controls' }, h('div', { class: 'in' },
        h('button', { onclick: () => go2(-1) }, '⏮ Anterior'),
        h('button', { onclick: () => startMode(mode) }, '⟲ Repetir'),
        playBtn,
        h('button', { onclick: () => go2(1) }, 'Seguinte ⏭'))));
  }

  /* ---------- arranque ---------- */
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
