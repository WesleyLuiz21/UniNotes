import type { HighlighterCore } from 'shiki/core';

// Shiki is loaded on demand with the pure-JS regex engine (no WebAssembly, CSP-friendly).
// Grammars are loaded lazily per language actually used.
const LANGS: Record<string, () => Promise<unknown>> = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  matlab: () => import('shiki/langs/matlab.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
  haskell: () => import('shiki/langs/haskell.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  asm: () => import('shiki/langs/asm.mjs'),
};

const ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps1: 'powershell',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  rs: 'rust',
  kt: 'kotlin',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  tex: 'latex',
  hs: 'haskell',
  htm: 'html',
  xml: 'html',
  golang: 'go',
};

export const resolveLang = (lang: string) => {
  const l = lang.toLowerCase();
  const name = ALIASES[l] ?? l;
  return name in LANGS ? name : null;
};

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

export async function getHighlighter(lang: string) {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ]);
    return createHighlighterCore({
      themes: [light.default, dark.default],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  const h = await highlighter;
  if (!loaded.has(lang)) {
    const mod = (await LANGS[lang]!()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] };
    await h.loadLanguage(mod.default);
    loaded.add(lang);
  }
  return h;
}
