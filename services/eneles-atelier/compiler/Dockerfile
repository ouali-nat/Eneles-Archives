# ──────────────────────────────────────────────────────────────
# Eneles Compiler Service
# TeX Live (basic scheme) + Node.js Express
# ──────────────────────────────────────────────────────────────

# Stage 1: TeX Live base
FROM debian:bookworm-slim AS base

# Install TeX Live (basic scheme) + common packages + Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    perl \
    fontconfig \
    libfreetype6 \
    ca-certificates \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install TeX Live (basic scheme) via install-tl
ENV TEXLIVE_VERSION=2024
ENV TEXLIVE_INSTALL_DIR=/usr/local/texlive/${TEXLIVE_VERSION}

RUN mkdir -p /tmp/texlive-install && cd /tmp/texlive-install \
    && wget -q https://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz \
    && tar -xzf install-tl-unx.tar.gz --strip-components=1 \
    && echo "selected_scheme scheme-basic" > texlive.profile \
    && echo "TEXDIR ${TEXLIVE_INSTALL_DIR}" >> texlive.profile \
    && echo "TEXMFLOCAL ${TEXLIVE_INSTALL_DIR}/texmf-local" >> texlive.profile \
    && echo "TEXMFSYSCONFIG ${TEXLIVE_INSTALL_DIR}/texmf-config" >> texlive.profile \
    && echo "TEXMFSYSVAR ${TEXLIVE_INSTALL_DIR}/texmf-var" >> texlive.profile \
    && echo "TEXMFHOME ~/texmf" >> texlive.profile \
    && echo "binary_x86_64-linux 1" >> texlive.profile \
    && echo "instopt_adjustpath 0" >> texlive.profile \
    && echo "instopt_adjustrepo 1" >> texlive.profile \
    && echo "instopt_letter 0" >> texlive.profile \
    && echo "tlpdbopt_autobackup 0" >> texlive.profile \
    && echo "tlpdbopt_install_docfiles 0" >> texlive.profile \
    && echo "tlpdbopt_install_srcfiles 0" >> texlive.profile \
    && ./install-tl --profile=texlive.profile \
    && rm -rf /tmp/texlive-install

# Add TeX Live to PATH
ENV PATH="${TEXLIVE_INSTALL_DIR}/bin/x86_64-linux:${PATH}"

# Install commonly needed LaTeX packages
# Split into two layers: fonts first (rarely changes), then packages
# NOTE: Avoid `collection-fontsrecommended`, because it runs updmap-sys which
#       fails in minimal Docker environments. Install individual fonts instead.
RUN tlmgr install \
    # Core packages
    latex-bin \
    latexmk \
    xetex \
    # Individual font packages (replaces collection-fontsrecommended)
    ec \
    lm \
    cm-super \
    fontspec \
    mathpazo \
    helvet \
    courier \
    times \
    newtx \
    newpx \
    libertine \
    sourcecodepro \
    sourcesans \
    # Math
    amsmath \
    amscls \
    amssymb \
    amsfonts \
    mathtools \
    amscd \
    # Document classes
    koma-script \
    memoir \
    beamer \
    revtex \
    elsarticle \
    ieeetran \
    acmart \
    llncs \
    # Graphics
    pgf \
    tikz-cd \
    pgfplots \
    quantikz \
    xstring \
    circuitikz \
    tikz-3dplot \
    chemfig \
    simplekv \
    forest \
    tikz-feynman \
    zx-calculus \
    optikz \
    dynkin-diagrams \
    braids \
    tensormatrix \
    tikzorbital \
    polyhedra \
    tilings \
    tikz-nfold \
    neuralnetwork \
    venndiagram \
    chronology \
    xcolor \
    graphicx \
    # Tables
    booktabs \
    multirow \
    tabularx \
    # Layout
    geometry \
    fancyhdr \
    titlesec \
    enumitem \
    caption \
    float \
    # Code listings
    listings \
    minted \
    fancyvrb \
    # Bibliography
    biblatex \
    biber \
    natbib \
    # References
    hyperref \
    cleveref \
    url \
    # Utilities
    etoolbox \
    xkeyval \
    xargs \
    ifthen \
    iftex \
    xparse \
    l3kernel \
    l3packages \
    synctex \
    microtype \
    parskip \
    setspace \
    babel \
    csquotes \
    inputenc \
    fontenc \
    textcomp \
    # XeLaTeX / LuaLaTeX support
    xunicode \
    xltxtra \
    luatexbase \
    luaotfload \
    unicode-math \
    # Algorithm packages
    algorithm2e \
    algorithmicx \
    algorithms \
    # Author/title formatting
    authblk \
    titling \
    preprint \
    # Theorem environments
    amsthm \
    thmtools \
    mdframed \
    # Drawing / diagrams
    tikz-bayesnet \
    standalone \
    # CV / resume classes
    moderncv \
    # Letters
    lettre \
    # Symbols
    wasysym \
    marvosym \
    pifont \
    dingbat \
    # Math extras
    bm \
    bbm \
    bbm-macros \
    stmaryrd \
    mathdots \
    yhmath \
    tensor \
    diffcoeff \
    derivative \
    # CS / pseudocode
    clrscode3e \
    # Linguistics / misc academic
    linguex \
    gb4e \
    # Formatting / layout extras
    titletoc \
    tocloft \
    fancybox \
    framed \
    changepage \
    lastpage \
    afterpage \
    placeins \
    flafter \
    marginnote \
    footmisc \
    endnotes \
    lineno \
    soul \
    ulem \
    contour \
    # Tables extras
    longtable \
    ltablex \
    tabu \
    makecell \
    colortbl \
    arydshln \
    # Lists
    paralist \
    # Links / refs
    bookmark \
    xr \
    xr-hyper \
    # PDF tools
    pdfcomment \
    # Color
    xcolor-solarized \
    # Drawings
    pstricks \
    pst-plot \
    auto-pst-pdf \
    # Academic tools
    glossaries \
    glossaries-extra \
    savetrees \
    sttools \
    balance \
    units \
    ntheorem \
    isodate \
    datetime \
    # Misc popular
    multicol \
    array \
    dcolumn \
    threeparttable \
    tabularray \
    csvsimple \
    datatool \
    fontawesome5 \
    epsfig \
    epstopdf \
    latexsym \
    subcaption \
    wrapfig \
    pdfpages \
    pdflscape \
    appendix \
    tcolorbox \
    environ \
    trimspaces \
    adjustbox \
    collectbox \
    varwidth \
    spath3 \
    todonotes \
    siunitx \
    physics \
    cancel \
    ifdraft \
    comment \
    verbatim \
    xspace \
    lipsum \
    blindtext \
    kantlipsum \
    mwe \
    # XeLaTeX multilingual documents (Byblex: English, French, Arabic)
    polyglossia \
    bidi \
    luabidi \
    amiri \
    tex-gyre \
    needspace \
    hyphen-french \
    hyphen-arabic \
    # Used by the Learn lessons and by multi-file projects: language rules for French and German, and \subfile
    babel-french \
    babel-german \
    hyphen-german \
    subfiles \
    ; exit 0

# ──────────────────────────────────────────────────────────────
# Make TeX Live's OpenType fonts visible to fontconfig.
#
# fontspec (XeLaTeX/LuaLaTeX) resolves fonts BY NAME through fontconfig, not by
# file path. Installing `amiri` or `tex-gyre` puts the .otf files inside TeX
# Live's tree, which fontconfig knows nothing about, so `\setmainfont{Amiri}`
# fails with "font cannot be found" while `tlmgr` insists it is installed.
#
# TeX Live ships a snippet for this (texlive-fontconfig.conf) but scheme-basic
# with docfiles disabled does not include it, so it is written here directly.
# It is nothing more than a list of the font directories.
# ──────────────────────────────────────────────────────────────
RUN set -eu; \
    mkdir -p /etc/fonts/conf.d; \
    { \
      echo '<?xml version="1.0"?>'; \
      echo '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">'; \
      echo '<fontconfig>'; \
      echo "  <dir>${TEXLIVE_INSTALL_DIR}/texmf-dist/fonts/opentype</dir>"; \
      echo "  <dir>${TEXLIVE_INSTALL_DIR}/texmf-dist/fonts/truetype</dir>"; \
      echo "  <dir>${TEXLIVE_INSTALL_DIR}/texmf-dist/fonts/type1</dir>"; \
      echo '</fontconfig>'; \
    } > /etc/fonts/conf.d/09-texlive.conf; \
    fc-cache -fs; \
    # Prove the two fonts fontspec will ask for by name are actually resolvable.
    # If either is missing here, tlmgr silently failed to install its package
    # (the install step ends in `; exit 0`), and this is where that surfaces.
    for font in "TeX Gyre Termes" "Amiri"; do \
      if ! fc-list | grep -qi "${font}"; then \
        echo ""; \
        echo "ERROR: fontconfig cannot see '${font}'."; \
        echo "Either its tlmgr package (tex-gyre / amiri) failed to install,"; \
        echo "or the font directory below is wrong for this TeX Live layout:"; \
        ls -d ${TEXLIVE_INSTALL_DIR}/texmf-dist/fonts/*/ 2>/dev/null || echo "  (no fonts directory found at all)"; \
        echo ""; \
        exit 1; \
      fi; \
    done; \
    echo "fontconfig sees TeX Live fonts (TeX Gyre Termes, Amiri resolvable)."

# ──────────────────────────────────────────────────────────────
# Verify the packages the TikZ library and Byblex actually depend on.
#
# The bulk `tlmgr install` above ends in `; exit 0` so that one unavailable
# package cannot fail a 200-package build. The cost of that tolerance is that a
# renamed or missing package ships a silently broken compiler, and the failure
# only shows up as an unrenderable example in production.
#
# The check asks tlmgr what it installed, rather than probing for a .sty file.
# Several of these are TikZ libraries (tikz-nfold, braids, tilings) that ship
# `tikzlibrary<name>.code.tex` and no .sty at all, so a kpsewhich probe for
# `<name>.sty` reports them missing when they are perfectly fine. tlmgr's own
# installed list is the source of truth and needs no knowledge of file layout.
#
# Keep this list in step with the `\usepackage` and `\usetikzlibrary` lines in
# frontend/lib/tikz/libraries.ts, plus whatever external projects require.
# ──────────────────────────────────────────────────────────────
RUN set -eu; \
    installed="$(tlmgr list --only-installed 2>/dev/null | sed -n 's/^i \([^:]*\):.*/\1/p')"; \
    missing=""; \
    for pkg in \
        pgf pgfplots tikz-cd quantikz circuitikz tikz-3dplot chemfig \
        forest tikz-feynman zx-calculus optikz dynkin-diagrams \
        tensormatrix tikzorbital polyhedra tilings braids tikz-nfold \
        neuralnetwork venndiagram chronology standalone \
        xetex luatex polyglossia bidi luabidi fontspec amiri tex-gyre needspace lastpage fancyhdr \
        hyphen-french hyphen-arabic babel-french babel-german hyphen-german \
        subfiles mwe varwidth booktabs enumitem mathtools listings beamer biblatex; do \
      if ! printf '%s\n' "${installed}" | grep -qx "${pkg}"; then \
        missing="${missing} ${pkg}"; \
      fi; \
    done; \
    if [ -n "${missing}" ]; then \
      echo ""; \
      echo "ERROR: required TeX Live packages did not install:${missing}"; \
      echo "Check each name against CTAN (https://ctan.org/pkg/<name>) and the"; \
      echo "tlmgr install list above. A wrong name is skipped silently there."; \
      echo ""; \
      exit 1; \
    fi; \
    echo "All required TeX Live packages installed."; \
    # A package can be listed as installed while its binary is not (a failed
    # download of xetex.x86_64-linux shipped an image with xelatex.ini but no
    # xelatex), and /health then silently drops the engine. Check the binaries.
    for engine in pdflatex xelatex lualatex latex; do \
      command -v "${engine}" >/dev/null || { echo "ERROR: engine ${engine} is not on PATH"; exit 1; }; \
    done; \
    echo "All engines present."

# Rebuild file database and font maps (tolerate updmap-sys failures in minimal environments)
RUN mktexlsr && (updmap-sys || true)

# LuaTeX's font-name cache, built once system-wide so the engine user (below)
# reads it instead of rebuilding it for every job.
RUN luaotfload-tool -u || true

# The engine runs as its own unprivileged user. TeX can read any file its
# user can, including /proc/<pid>/environ; as a separate user it cannot read
# this service's environment, where the shared secrets live.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin texrun
ENV TEX_RUN_UID=10001

# ──────────────────────────────────────────────────────────────
# Stage 2: Application
# ──────────────────────────────────────────────────────────────

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

# Create temp directory for compilation jobs. 711: the engine user can enter
# its own job folder but cannot list the others.
RUN mkdir -p /tmp/texer-jobs && chmod 711 /tmp/texer-jobs

EXPOSE 3500

ENV PORT=3500
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s \
    CMD sh -c 'curl -f "http://localhost:${PORT:-3500}/health" || exit 1'

CMD ["node", "server.js"]
