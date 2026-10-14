/* Converte texto bruto (colado, extraído de PDF ou OCR) em blocos de teste
 * e prepara o texto para ser lido em voz alta. Sem dependências de DOM. */
(function (root) {
  'use strict';

  // "1.", "1)", "1.1", "1.1.", "12.3.4"
  const Q_NUM = /^\s*(\d{1,2}(?:\.\d{1,2})+\.?|\d{1,2}[.)])\s+(\S.*)$/;
  // "Pergunta 3", "Questão 4:"
  const Q_WORD = /^\s*(?:pergunta|quest[aã]o)\s+(\d{1,2}(?:\.\d{1,2})*)\s*[.:)\-–]?\s*(\S.*)?$/i;
  const HEADING = /^\s*(texto|grupo|leia|leitura)\b/i;
  const OPTION = /^\s*\(?[a-eA-E][.)]\s+\S/;
  const LONG_PARAGRAPH = 150;

  function cleanLabel(label) {
    return label.replace(/[.)]+$/, '');
  }

  function matchQuestion(line) {
    let m = Q_WORD.exec(line);
    if (m) return { label: cleanLabel(m[1]), rest: (m[2] || '').trim() };
    m = Q_NUM.exec(line);
    if (m) return { label: cleanLabel(m[1]), rest: m[2].trim() };
    return null;
  }

  function parse(raw) {
    const lines = String(raw || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').split('\n');
    const blocks = [];
    let cur = null;
    let gap = false; // houve linha em branco antes da linha atual

    const push = () => {
      if (cur) {
        delete cur.heading;
        cur.text = cur.text.replace(/[ \t]+/g, ' ').trim();
        if (cur.text || cur.type === 'question') blocks.push(cur);
      }
      cur = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) { gap = true; continue; }

      const q = matchQuestion(line);
      if (q) {
        push();
        cur = { type: 'question', label: q.label, text: q.rest };
      } else if ((!cur || cur.type === 'question' || gap) && HEADING.test(line) && (!cur || cur.type === 'question')) {
        push();
        cur = { type: 'text', label: '', text: line, heading: true };
      } else if (!cur) {
        cur = { type: 'text', label: '', text: line };
      } else if (cur.type === 'question' && gap && line.length > LONG_PARAGRAPH) {
        push();
        cur = { type: 'text', label: '', text: line };
      } else if (cur.type === 'text') {
        cur.text += (gap || cur.heading ? '\n\n' : ' ') + line;
        delete cur.heading;
      } else {
        cur.text += (OPTION.test(line) ? '\n' : ' ') + line;
      }
      gap = false;
    }
    push();
    return blocks;
  }

  // Divide em frases para leitura e realce. Não parte "1.5" nem "n.º".
  function sentences(text) {
    return String(text || '')
      .replace(/([.!?…]+["”»)]*)[ \t]+/g, '$1\u0000')
      .split(/[\u0000\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // "1.1" -> "Pergunta 1 ponto 1"
  function spokenLabel(label) {
    const l = String(label || '').trim();
    if (!l) return 'Pergunta';
    return 'Pergunta ' + l.replace(/\./g, ' ponto ');
  }

  // Associa a cada pergunta o último grupo de blocos de texto que a precede.
  function questionsWithContext(blocks) {
    const out = [];
    let ctx = [];
    let lastWasText = false;
    for (const b of blocks) {
      if (b.type === 'text') {
        if (!lastWasText) ctx = [];
        ctx.push(b);
        lastWasText = true;
      } else {
        out.push({ block: b, ctx: ctx.slice() });
        lastWasText = false;
      }
    }
    return out;
  }

  const api = { parse, sentences, spokenLabel, questionsWithContext };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Parser = api;
})(typeof self !== 'undefined' ? self : this);
