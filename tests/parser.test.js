const test = require('node:test');
const assert = require('node:assert');
const P = require('../parser.js');

const SAMPLE = `Texto 1
O gato Tom vivia numa casa pequena. Tinha 1.5 metros de cauda!

1. Qual é o título do texto?
1.1. Onde vivia o Tom?
a) Numa casa
b) Numa árvore
2) Quantos metros tinha a cauda?

Texto 2
Era uma vez uma menina.
Pergunta 3: Como se chamava a menina?`;

test('parse separa texto e perguntas', () => {
  const b = P.parse(SAMPLE);
  assert.deepStrictEqual(b.map((x) => x.type + ':' + x.label),
    ['text:', 'question:1', 'question:1.1', 'question:2', 'text:', 'question:3']);
  assert.match(b[0].text, /^Texto 1\n\nO gato Tom/);
  assert.strictEqual(b[2].text, 'Onde vivia o Tom?\na) Numa casa\nb) Numa árvore');
  assert.strictEqual(b[5].text, 'Como se chamava a menina?');
});

test('questionsWithContext usa o último texto', () => {
  const qs = P.questionsWithContext(P.parse(SAMPLE));
  assert.strictEqual(qs.length, 4);
  assert.match(qs[1].ctx[0].text, /gato Tom/);
  assert.match(qs[3].ctx[0].text, /menina/);
});

test('sentences não parte decimais', () => {
  assert.deepStrictEqual(P.sentences('Tinha 1.5 metros! Era grande.\nFim'),
    ['Tinha 1.5 metros!', 'Era grande.', 'Fim']);
});

test('spokenLabel', () => {
  assert.strictEqual(P.spokenLabel('1.1'), 'Pergunta 1 ponto 1');
  assert.strictEqual(P.spokenLabel('2'), 'Pergunta 2');
});

test('texto vazio', () => assert.deepStrictEqual(P.parse('  \n '), []));
