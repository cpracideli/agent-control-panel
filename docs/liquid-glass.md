# Liquid Glass

Material: presets "Regular Glass" (light theme) and "Dark Glass" (dark theme) from
https://liquid-glass.ybouane.com/.

## Where the WebGL library (@ybouane/liquidglass) runs

`src/liquidglass.js`. It is on only for **desktop pointers** (`hover: hover` and `pointer: fine`) with WebGL.
It is off for touch devices, the terminal theme, reduced motion, reduced transparency and increased contrast.

- Chat composer: root `.chat-main`, glass `.composer-dock`, content `.chat-head` / `.chat-scroll`.
- Tab bar: root `.shell`, glass `.dock`. On desktop the dock is hidden, so in practice it only runs there if
  the phone layout is forced on a desktop browser.
- Header capsule, glass buttons, sheets, modals, menus and Cmd+K keep the CSS glass. The library needs the
  glass to be a direct child of the root that also contains the content behind it, and a sheet's backdrop
  is the whole app (another subtree). Doing it would mean rasterising the entire app on every open.

The library does not follow scrolling: html-to-image clones a scroll container from its top. The integration
replaces the capture for scrolling wrappers: it keeps only the children behind the glass and offsets them by
the scroll position, so the glass refracts what is actually behind it.

### Hybrid mode

Each html-to-image capture is a main-thread long task. So the integration never captures while the content
moves. On scroll or a DOM change (streaming) the glass gets `.lgl-moving`: the WebGL canvas fades out and the
CSS glass shows. When the content has been still for 450 ms, it captures once and the WebGL glass fades back in.

## Measurements (Playwright, server ARM A1 CPU, chat with 150 messages)

Unthrottled, one capture of `.chat-scroll` / `.chat-head` took 465-1090 ms. Each one produced 100-560 ms long
tasks. With 4x CPU throttling and a capture on every change, a 40-step scroll plus streaming froze the page
(over 190 s without finishing).

Hybrid mode, 4x CPU throttling (scroll = 40 steps of 60 px; stream = 80 tokens every 40 ms):

| case | scroll fps / max frame / long tasks | stream fps / max frame / long tasks |
|---|---|---|
| desktop, CSS | 31.9 / 67 ms / 0 | 27.3 / 83 ms / 0 |
| desktop, lib | 29.4 / 517 ms / 2 (735 ms) | 20.7 / 267 ms / 14 (1201 ms) |
| phone, CSS | 59.6 / 33 ms / 0 | 46.2 / 83 ms / 2 (114 ms) |
| phone, lib (forced) | 39.8 / 817 ms / 2 (966 ms) | 24.7 / 1017 ms / 9 (1855 ms) |

Headless Chromium here renders WebGL in software (SwiftShader, "GPU stall due to ReadPixels"), so the lib
numbers are pessimistic for real GPUs. The html-to-image cost is CPU-bound, though, and it is what freezes
touch scrolling.

Switches: `?lg-css` forces the CSS glass and `?lg-lib` forces the library (for tests).

## v8 — WebGL em todas as superfícies de vidro (23/11/2026)

- `src/lgengine.js`: usa o `GlassRenderer` da própria lib (mesmo shader e presets Regular/Dark) num ÚNICO contexto WebGL compartilhado para header (`.head-capsule`, `.chat-head .nav-btn`), `.glass-btn`, `.glass-bar`, `.iv-btn`, `.wf-bar`, `.toast`, menus (`.ctx-menu`, `.bot-picker-menu`, `.pg-more-menu`), sheets/modais (`.sheet`, `.modal`, `.asheet-group`, `.asheet-btn.cancel`) e Cmd+K (`.gsearch-panel`).
- Cena atrás de cada elemento: cor de fundo + itens do scroller por baixo (cache por item compartilhado, `src/lgitems.js`) + canvases de vidro abaixo (header/composer/dock sob sheet/toast) + scrim do overlay.
- Render sob demanda (scroll do scroller por baixo, item capturado, tamanho/posição, tema), no máximo 18 elementos ativos; fora da tela/fechado = CSS. Elementos em movimento re-sombreiam a cada 90 ms.
- Composer e tab bar continuam na lib (`src/liquidglass.js`, modo ao vivo).
- Fica em CSS: `.nav` (sidebar desktop, painel de altura total), `.topbar::before`/`.chat-head::before` (pseudo-elementos), `.glass-input` (campos dentro de painéis já com vidro), e tudo com `?lg-css`, sem WebGL, tema terminal, reduzir transparência/movimento ou mais contraste.
- `hasWebGL()` agora testa uma vez só e libera o contexto; instâncias da lib destruídas chamam `loseContext()` (antes vazavam contextos — "Too many active WebGL contexts").
