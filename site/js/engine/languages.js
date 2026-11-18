// Language table: how a file is recognised, which category it belongs to by
// default, and how its comments look. Shared by the browser and the CLI.
//
// kind: code | config | docs | data | markup-only ('code' for HTML/CSS etc.)
// cm:   comment style key (see COMMENT_STYLES)

export const COMMENT_STYLES = {
  c: { line: ['//'], block: [['/*', '*/']] },
  cnest: { line: ['//'], block: [['/*', '*/']], nested: true },
  css: { line: [], block: [['/*', '*/']] },
  scss: { line: ['//'], block: [['/*', '*/']] },
  hash: { line: ['#'], block: [] },
  py: { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]], blockAtLineStart: true },
  ruby: { line: ['#'], block: [['=begin', '=end']], blockAtLineStart: true },
  perl: { line: ['#'], block: [['=pod', '=cut'], ['=head1', '=cut']], blockAtLineStart: true },
  julia: { line: ['#'], block: [['#=', '=#']] },
  ps: { line: ['#'], block: [['<#', '#>']] },
  hashc: { line: ['#', '//'], block: [['/*', '*/']] },
  nix: { line: ['#'], block: [['/*', '*/']] },
  php: { line: ['//', '#'], block: [['/*', '*/']] },
  sql: { line: ['--'], block: [['/*', '*/']] },
  lua: { line: ['--'], block: [['--[[', ']]']] },
  haskell: { line: ['--'], block: [['{-', '-}']] },
  dash: { line: ['--'], block: [] },
  semi: { line: [';'], block: [] },
  clj: { line: [';'], block: [] },
  ini: { line: [';', '#'], block: [] },
  percent: { line: ['%'], block: [] },
  matlab: { line: ['%'], block: [['%{', '%}']] },
  erlang: { line: ['%'], block: [] },
  xml: { line: [], block: [['<!--', '-->']] },
  html: { line: [], block: [['<!--', '-->'], ['/*', '*/']] },
  vue: { line: ['//'], block: [['<!--', '-->'], ['/*', '*/']] },
  bat: { line: ['REM ', 'rem ', '::'], block: [] },
  vb: { line: ["'"], block: [] },
  fortran: { line: ['!'], block: [] },
  ocaml: { line: [], block: [['(*', '*)']] },
  fsharp: { line: ['//'], block: [['(*', '*)']] },
  pascal: { line: ['//'], block: [['{', '}'], ['(*', '*)']] },
  asm: { line: [';', '#', '//'], block: [['/*', '*/']] },
  vim: { line: ['"'], block: [] },
  elm: { line: ['--'], block: [['{-', '-}']] },
  twig: { line: [], block: [['{#', '#}'], ['<!--', '-->']] },
  razor: { line: ['//'], block: [['@*', '*@'], ['<!--', '-->']] },
  none: { line: [], block: [] },
};

// [name, kind, comment style, extensions, exact filenames]
const TABLE = [
  // ---- general purpose code
  ['Python', 'code', 'py', ['py', 'pyw', 'pyi', 'pyx', 'pxd'], ['SConstruct', 'SConscript']],
  ['JavaScript', 'code', 'c', ['js', 'mjs', 'cjs', 'jsx'], ['Jakefile']],
  ['TypeScript', 'code', 'c', ['ts', 'tsx', 'mts', 'cts'], []],
  ['Rust', 'code', 'cnest', ['rs'], []],
  ['Go', 'code', 'c', ['go'], []],
  ['Java', 'code', 'c', ['java'], []],
  ['Kotlin', 'code', 'cnest', ['kt', 'kts'], []],
  ['Scala', 'code', 'cnest', ['scala', 'sc', 'sbt'], []],
  ['Groovy', 'code', 'c', ['groovy', 'gvy'], ['Jenkinsfile']],
  ['C', 'code', 'c', ['c', 'h'], []],
  ['C++', 'code', 'c', ['cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++', 'ipp', 'tpp', 'ino'], []],
  ['C#', 'code', 'c', ['cs', 'csx'], []],
  ['F#', 'code', 'fsharp', ['fs', 'fsi', 'fsx'], []],
  ['Visual Basic', 'code', 'vb', ['vb', 'bas', 'vbs', 'cls', 'frm'], []],
  ['Objective-C', 'code', 'c', ['m', 'mm'], []],
  ['Swift', 'code', 'cnest', ['swift'], []],
  ['Dart', 'code', 'c', ['dart'], []],
  ['Ruby', 'code', 'ruby', ['rb', 'rake', 'gemspec', 'ru', 'erb'], ['Rakefile', 'Gemfile', 'Guardfile', 'Podfile', 'Fastfile', 'Vagrantfile', 'Brewfile']],
  ['PHP', 'code', 'php', ['php', 'phtml', 'php3', 'php4', 'php5', 'phps'], []],
  ['Perl', 'code', 'perl', ['pl', 'pm', 't', 'pod'], []],
  ['Lua', 'code', 'lua', ['lua'], []],
  ['R', 'code', 'hash', ['r', 'rmd'], []],
  ['Julia', 'code', 'julia', ['jl'], []],
  ['Elixir', 'code', 'hash', ['ex', 'exs'], []],
  ['Erlang', 'code', 'erlang', ['erl', 'hrl'], []],
  ['Haskell', 'code', 'haskell', ['hs', 'lhs'], []],
  ['Elm', 'code', 'elm', ['elm'], []],
  ['OCaml', 'code', 'ocaml', ['ml', 'mli'], []],
  ['Clojure', 'code', 'clj', ['clj', 'cljs', 'cljc', 'edn'], []],
  ['Lisp', 'code', 'semi', ['lisp', 'lsp', 'el', 'scm', 'ss', 'rkt'], []],
  ['Nim', 'code', 'hash', ['nim', 'nims'], []],
  ['Zig', 'code', 'c', ['zig'], []],
  ['V', 'code', 'c', ['v'], []],
  ['Crystal', 'code', 'hash', ['cr'], []],
  ['D', 'code', 'c', ['d'], []],
  ['Pascal', 'code', 'pascal', ['pas', 'pp', 'dpr', 'lpr'], []],
  ['Fortran', 'code', 'fortran', ['f', 'f90', 'f95', 'f03', 'for'], []],
  ['MATLAB', 'code', 'matlab', [], []], // .m is Objective-C; MATLAB detected by content
  ['Assembly', 'code', 'asm', ['asm', 's', 'nasm'], []],
  ['Solidity', 'code', 'c', ['sol'], []],
  ['GLSL', 'code', 'c', ['glsl', 'vert', 'frag', 'geom', 'comp', 'wgsl'], []],
  ['HLSL', 'code', 'c', ['hlsl', 'fx', 'shader', 'cginc'], []],
  ['CUDA', 'code', 'c', ['cu', 'cuh'], []],
  ['Verilog', 'code', 'c', ['sv', 'svh', 'vh'], []],
  ['VHDL', 'code', 'dash', ['vhd', 'vhdl'], []],
  ['Apex', 'code', 'c', ['apex', 'trigger'], []],
  ['AL', 'code', 'c', ['al'], []],
  ['SQL', 'code', 'sql', ['sql', 'psql', 'plsql', 'pks', 'pkb', 'ddl'], []],
  ['GraphQL', 'code', 'hash', ['graphql', 'gql'], []],
  ['Protocol Buffers', 'code', 'c', ['proto'], []],
  ['Thrift', 'code', 'c', ['thrift'], []],
  ['Shell', 'code', 'hash', ['sh', 'bash', 'zsh', 'ksh', 'fish', 'command', 'csh', 'tcsh', 'nu', 'xsh'], ['.bashrc', '.zshrc', '.profile', '.bash_profile']],
  ['PowerShell', 'code', 'ps', ['ps1', 'psm1', 'psd1'], []],
  ['Batchfile', 'code', 'bat', ['bat', 'cmd'], []],
  ['AutoHotkey', 'code', 'semi', ['ahk'], []],
  ['Vim Script', 'code', 'vim', ['vim'], ['.vimrc']],
  ['HCL', 'code', 'hashc', ['tf', 'tfvars', 'hcl', 'nomad'], []],
  ['Bicep', 'code', 'c', ['bicep'], []],
  ['Nix', 'code', 'nix', ['nix'], []],
  ['Starlark', 'code', 'hash', ['bzl', 'star'], ['BUILD', 'BUILD.bazel', 'WORKSPACE', 'WORKSPACE.bazel', 'Tiltfile']],
  ['Power Query', 'code', 'c', ['pq', 'm365'], []],
  ['DAX', 'code', 'c', ['dax'], []],
  // ---- front end
  ['HTML', 'code', 'html', ['html', 'htm', 'xhtml'], []],
  ['CSS', 'code', 'css', ['css'], []],
  ['SCSS', 'code', 'scss', ['scss', 'sass'], []],
  ['Less', 'code', 'scss', ['less', 'styl'], []],
  ['Vue', 'code', 'vue', ['vue'], []],
  ['Svelte', 'code', 'vue', ['svelte'], []],
  ['Astro', 'code', 'vue', ['astro'], []],
  ['Razor', 'code', 'razor', ['cshtml', 'razor'], []],
  ['Templates', 'code', 'twig', ['hbs', 'handlebars', 'mustache', 'njk', 'jinja', 'jinja2', 'j2', 'twig', 'liquid', 'ejs', 'pug', 'jade', 'haml', 'slim', 'tmpl', 'gotmpl'], []],
  ['XAML', 'code', 'xml', ['xaml', 'axaml'], []],
  // ---- build / infrastructure configuration
  ['Dockerfile', 'config', 'hash', ['dockerfile', 'containerfile'], ['Dockerfile', 'Containerfile']],
  ['Makefile', 'config', 'hash', ['mk', 'mak', 'make'], ['Makefile', 'makefile', 'GNUmakefile', 'Justfile', 'justfile']],
  ['CMake', 'config', 'hash', ['cmake'], ['CMakeLists.txt']],
  ['Gradle', 'config', 'c', ['gradle'], []],
  ['MSBuild', 'config', 'xml', ['csproj', 'vbproj', 'fsproj', 'vcxproj', 'props', 'targets', 'sln', 'proj', 'nuspec', 'resx'], []],
  ['YAML', 'config', 'hash', ['yml', 'yaml'], ['.clang-format', '.clang-tidy']],
  ['TOML', 'config', 'hash', ['toml'], ['Pipfile']],
  ['JSON', 'config', 'none', ['json', 'json5', 'jsonc', 'webmanifest', 'har', 'babelrc', 'eslintrc', 'prettierrc', 'swcrc'], ['.babelrc', '.eslintrc', '.prettierrc', 'composer.json']],
  ['XML', 'config', 'xml', ['xml', 'xsd', 'xsl', 'xslt', 'plist', 'config', 'manifest', 'wsdl', 'pom', 'storyboard', 'xib'], []],
  ['INI', 'config', 'ini', ['ini', 'cfg', 'conf', 'cnf', 'properties', 'prefs', 'inf', 'reg', 'env', 'editorconfig', 'flake8', 'pylintrc', 'npmrc', 'yarnrc', 'gitconfig'],
    ['.editorconfig', '.gitattributes', '.gitignore', '.dockerignore', '.npmignore', '.prettierignore', '.eslintignore', '.gitmodules', '.npmrc', '.nvmrc', '.python-version', '.ruby-version', '.tool-versions', '.env.example', '.env.sample', 'CODEOWNERS', '.mailmap', 'requirements.txt', 'constraints.txt', 'Procfile', '.flake8', '.pylintrc', '.coveragerc', 'MANIFEST.in', 'setup.cfg', 'tox.ini', 'pytest.ini', 'go.mod', 'go.work', '.htaccess', 'nginx.conf']],
  // ---- documentation (counted in words)
  ['Markdown', 'docs', 'xml', ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'qmd'], []],
  ['reStructuredText', 'docs', 'none', ['rst', 'rest'], []],
  ['AsciiDoc', 'docs', 'none', ['adoc', 'asciidoc', 'asc'], []],
  ['Org', 'docs', 'none', ['org'], []],
  ['TeX', 'docs', 'percent', ['tex', 'latex', 'ltx', 'sty', 'cls', 'bib'], []],
  ['Text', 'docs', 'none', ['txt', 'text', 'rtf'], ['README', 'LICENSE', 'LICENCE', 'COPYING', 'AUTHORS', 'CONTRIBUTORS', 'NOTICE', 'CHANGELOG', 'CHANGES', 'HISTORY', 'NEWS', 'TODO', 'INSTALL', 'PATENTS', 'THANKS']],
  ['Jupyter Notebook', 'notebook', 'none', ['ipynb'], []],
  // ---- data
  ['CSV', 'data', 'none', ['csv', 'tsv', 'psv'], []],
  ['Data', 'data', 'none', ['jsonl', 'ndjson', 'geojson', 'topojson', 'parquet', 'avro', 'arff', 'dat', 'log', 'sqlite', 'db', 'mdb', 'accdb', 'textproto', 'prototext', 'pbtxt', 'patch', 'diff', 'tsv', 'xyz', 'pcd', 'gcode', 'nc', 'tap'], []],
];

export const LANGUAGES = {};
export const BY_EXT = new Map();
export const BY_NAME = new Map();
for (const [name, kind, cm, exts, names] of TABLE) {
  LANGUAGES[name] = { name, kind, comments: COMMENT_STYLES[cm] };
  for (const e of exts) if (!BY_EXT.has(e)) BY_EXT.set(e, name);
  for (const n of names) BY_NAME.set(n, name);
}

// Shebang interpreter -> language
export const SHEBANG = [
  [/\b(python[0-9.]*|pypy)\b/, 'Python'],
  [/\b(node|deno|bun)\b/, 'JavaScript'],
  [/\bts-node\b/, 'TypeScript'],
  [/\b(bash|sh|zsh|ksh|dash|fish)\b/, 'Shell'],
  [/\bruby\b/, 'Ruby'],
  [/\bperl\b/, 'Perl'],
  [/\bphp\b/, 'PHP'],
  [/\blua\b/, 'Lua'],
  [/\bRscript\b/, 'R'],
  [/\bpwsh\b/, 'PowerShell'],
];

// Binary / asset extensions -> asset kind. Never fetched or read.
export const ASSET_EXT = {};
const assets = {
  image: 'png jpg jpeg gif bmp ico icns webp avif tif tiff psd ai eps heic raw cr2 nef dds tga exr hdr xcf sketch fig',
  vector: 'svg', // text, but treated as an asset (drawn, not written)
  font: 'ttf otf woff woff2 eot fon',
  audio: 'mp3 wav ogg flac aac m4a wma mid midi aiff opus',
  video: 'mp4 mov avi mkv webm wmv flv m4v mpg mpeg 3gp',
  archive: 'zip tar gz tgz bz2 xz 7z rar zst lz4 jar war ear whl egg nupkg gem deb rpm apk ipa dmg iso msi cab vsix crx xpi',
  binary: 'exe dll so dylib lib a o obj pdb class pyc pyo pyd wasm bin elf node dat_ out app ko sys',
  document: 'pdf doc docx xls xlsx xlsm xlsb ppt pptx odt ods odp pages numbers key vsd vsdx mpp one msg eml',
  cad: 'dwg dxf step stp iges igs stl sldprt sldasm slddrw ipt iam idw 3mf obj_ fbx blend dae gltf glb 3ds max ply x_t sat',
  model: 'onnx pt pth h5 ckpt safetensors pkl pickle joblib tflite mlmodel npy npz',
  database: 'sqlite3 db3 mdf ldf bak frx',
};
for (const [kind, list] of Object.entries(assets)) for (const e of list.split(' ')) ASSET_EXT[e] = kind;

// Colours. Language colours follow the category palette slots assigned by
// rank at report time (see aggregate.js) so they stay CVD-distinguishable.
export const CATEGORY_ORDER = ['code', 'config', 'docs', 'data', 'generated', 'assets', 'vendored', 'other'];
export const CATEGORY_LABEL = {
  code: 'Code', config: 'Config & build', docs: 'Documentation', data: 'Data',
  generated: 'Generated', assets: 'Assets & binaries', vendored: 'Vendored', other: 'Other',
};
