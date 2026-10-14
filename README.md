# Leitura de Prova

Aplicação web (PWA) para a medida de adaptação **leitura de enunciados**: o professor
carrega o teste e o aluno toca numa pergunta para a ouvir em voz alta, as vezes que
quiser, saltando entre perguntas, ao ritmo que precisar.

## Como usar

**Professor**
1. **Importar PDF ou foto** (ou 📷 tirar foto ao teste, ou escrever/colar o texto).
2. Rever o texto reconhecido no editor: separar *Texto* e *Pergunta*, corrigir números e acentos.
3. **Guardar e ler**.

**Aluno**
- Toca no número da pergunta → a app lê o texto de apoio e depois a pergunta (a frase lida fica realçada).
- *Só a pergunta*, *Só o texto*, *Repetir*, *Pausar/Continuar*, *Anterior/Seguinte*.
- A velocidade da voz e o tamanho da letra ajustam-se no topo.

No editor, cada pergunta é lida com o **último texto** que a antecede. Linhas como `1.`, `1.1`, `2)` ou
`Pergunta 3` são reconhecidas como perguntas na importação.

## Como funciona

| Parte | Tecnologia |
|---|---|
| Voz | `speechSynthesis` do navegador (pt-PT se existir no dispositivo) |
| PDF | [pdf.js](https://mozilla.github.io/pdf.js/); PDF digitalizado cai automaticamente para OCR |
| Foto | [tesseract.js](https://github.com/naptha/tesseract.js) (OCR em português) |
| Dados | `localStorage` — **ficam só no dispositivo**; exportar/importar JSON como cópia de segurança |
| Offline | Service worker; as bibliotecas de importação são descarregadas (e guardadas) na primeira utilização |

Não há servidor nem contas: nenhum dado de alunos ou testes sai do dispositivo.

## Executar

Não precisa de build. Servir a pasta por HTTP (o service worker e a câmara exigem `http://localhost` ou HTTPS):

```bash
python3 -m http.server 8000   # abrir http://localhost:8000
```

## Publicar no Cloudflare Pages

Site estático, sem build. No painel da Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**,
escolher este repositório e usar:

- **Production branch:** a branch a publicar (ex.: `main`)
- **Build command:** *(vazio)*
- **Build output directory:** `/`

Ou, por linha de comandos: `npx wrangler pages deploy . --project-name leitura-de-prova`.
O ficheiro `_headers` já configura cache e segurança. A Cloudflare dá um endereço `https://<nome>.pages.dev`
(HTTPS, necessário para câmara e instalação no ecrã principal), que se envia à colega.
Num telemóvel/tablet pode "Adicionar ao ecrã principal".

## Testes

```bash
node --test tests/parser.test.js
```

## Limitações conhecidas (MVP)

- O reconhecimento de fotos pode errar: **rever sempre** antes de usar com o aluno.
- As vozes variam por dispositivo; confirmar que existe uma voz em português e testar em "Voz e cópia de segurança".
- Imagens/gráficos do teste não são lidos (só texto).
- Confirmar com a direção/agrupamento que a leitura por app é aceite em avaliações formais.
