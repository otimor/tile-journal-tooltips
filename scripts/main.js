const MODULE_ID = "tile-journal-tooltips-fix";
const TOOLTIP_ID = "tjt-tooltip";

const FLAGS = {
  enabled: "enabled",
  journalId: "journalId",
  pageId: "pageId",
  cachedHtml: "cachedHtml",
  cachedTitle: "cachedTitle",
  cachedUpdated: "cachedUpdated"
};

let tooltipEl = null;
let mouseX = 0;
let mouseY = 0;
let hideTimer = null;

const _tjtHover = {
  tileId: null,
  onMove: null,
  onLeave: null
};


/* ------------------------------------------------------------------------- */
/* Tooltip DOM                                                               */
/* ------------------------------------------------------------------------- */

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;

  tooltipEl = document.createElement("div");
  tooltipEl.id = TOOLTIP_ID;
  tooltipEl.style.display = "none";

  document.body.appendChild(tooltipEl);

  return tooltipEl;
}


function positionTooltip() {
  if (!tooltipEl) return;

  const offset = 14;

  tooltipEl.style.left = `${mouseX + offset}px`;
  tooltipEl.style.top = `${mouseY + offset}px`;
}


function showTooltip(html) {
  console.debug(MODULE_ID, "showTooltip")
  ensureTooltipEl();

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";

  positionTooltip();

  // Force layout so CSS transition works reliably.
  tooltipEl.getBoundingClientRect();

  tooltipEl.classList.add("visible");
}


function hideTooltip() {
  if (!tooltipEl) return;

  tooltipEl.classList.remove("visible");

  if (hideTimer) {
    clearTimeout(hideTimer);
  }

  hideTimer = setTimeout(() => {
    if (!tooltipEl) return;

    tooltipEl.style.display = "none";
    tooltipEl.innerHTML = "";
    hideTimer = null;
  }, 180);
}


/* ------------------------------------------------------------------------- */
/* Journal helpers                                                           */
/* ------------------------------------------------------------------------- */

function getJournalPages(journalEntry) {
  const pages =
    journalEntry?.pages?.contents ??
    journalEntry?.pages ??
    [];
  
  console.debug(MODULE_ID, "GETjOURNALpAGES") 
  return Array.isArray(pages) ? pages : [];
}


function buildJournalOptions(selectedJournalId = "") {
  return game.journal
    .map(j => ({
      id: j.id,
      name: j.name
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(o => ({
      ...o,
      selected: o.id === selectedJournalId
    }));
}


function buildPageOptions(journalId = "", selectedPageId = "") {
  if (!journalId) return [];

  const journal = game.journal.get(journalId);

  if (!journal) return [];

  console.debug(MODULE_ID, "buildPAgeOpts", journal)
  return getJournalPages(journal)
    .map(p => ({
      id: p.id,
      name: p.name
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(o => ({
      ...o,
      selected: o.id === selectedPageId
    }));
}


function formatCacheTimestamp(timestamp) {
  if (!timestamp) return "";

  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "";
  }
}


/* ------------------------------------------------------------------------- */
/* Foundry layer helpers                                                     */
/* ------------------------------------------------------------------------- */

function isTokenControlsActive() {
  if (canvas?.activeLayer && canvas?.tokens) {
    return canvas.activeLayer === canvas.tokens;
  }

  const name = canvas?.activeLayer?.options?.name ?? "";
  const id = canvas?.activeLayer?.options?.layer ?? "";

  return name === "TokenLayer" || id === "tokens";
}


/* ------------------------------------------------------------------------- */
/* Cache                                                                     */
/* ------------------------------------------------------------------------- */

function getCachedTooltip(tileDoc) {
  const enabled = !!tileDoc.getFlag(
    MODULE_ID,
    FLAGS.enabled
  );
  console.debug(MODULE_ID, "getCahedTooltip enabled?", enabled, tileDoc)

  if (!enabled) return null;

  const title =
    tileDoc.getFlag(MODULE_ID, FLAGS.cachedTitle) ?? "";

    console.debug(MODULE_ID, "getCahedTooltip title", title)
  const html =
    tileDoc.getFlag(MODULE_ID, FLAGS.cachedHtml) ?? "";

  if (!html.trim()) return null;

  const safeTitle = title
    ? `<div class="tjt-title">${foundry.utils.escapeHTML(title)}</div>`
    : "";

  return `${safeTitle}${html}`;
}


/**
 * Clear cached data.
 *
 * We deliberately use empty values instead of the old "-=field"
 * deletion syntax. Foundry V13 deprecated that syntax.
 */
async function clearCache(tileDoc) {
  console.debug(MODULE_ID, "clearCache", tileDoc)
  await tileDoc.update(
    {
      flags: {
        [MODULE_ID]: {
          [FLAGS.cachedHtml]: "",
          [FLAGS.cachedTitle]: "",
          [FLAGS.cachedUpdated]: null
        }
      }
    },
    {
      render: false
    }
  );
}


/**
 * Build the cached tooltip from a Journal Entry.
 *
 * IMPORTANT:
 * This function does NOT modify enabled/journalId/pageId.
 * Those are configuration values.
 *
 * It only writes:
 *   cachedTitle
 *   cachedHtml
 *   cachedUpdated
 */
async function buildCacheFromJournal(tileDoc, overrides = {}) {
  if (!game.user.isGM) {
    throw new Error("Only a GM can build tooltip caches.");
  }

  const enabled = !!tileDoc.getFlag(
    MODULE_ID,
    FLAGS.enabled
  );

  const journalId =
    overrides.journalId ??
    tileDoc.getFlag(MODULE_ID, FLAGS.journalId) ??
    "";

  const pageId =
    overrides.pageId ??
    tileDoc.getFlag(MODULE_ID, FLAGS.pageId) ??
    "";

  console.debug(
    MODULE_ID,
    "buildCacheFromJournal enabled, journalID, pageId",
    {
      enabled,
      journalId,
      pageId
    }
  );

  if (!enabled || !journalId) {
    await clearCache(tileDoc);
    return false;
  }

  const journal = game.journal.get(journalId);

  if (!journal) {
    console.warn(
      `${MODULE_ID} | Journal ${journalId} not found`
    );

    await clearCache(tileDoc);
    return false;
  }

  const pages = getJournalPages(journal);

  let title = journal.name;
  let enriched = "";

  let page = null;

  if (pageId && pages.length) {
    page = pages.find(p => p.id === pageId) ?? null;
  }

  /*
   * If no page was explicitly selected, use the first page.
   */
  if (!page && pages.length) {
    page = pages[0];
  }

  if (page) {
    title = `${journal.name}: ${page.name}`;

    switch (page.type) {
      case "image": {
        const src = page.src ?? "";

        const caption = page.image?.caption
          ? `<p class="tjt-caption">${foundry.utils.escapeHTML(
              page.image.caption
            )}</p>`
          : "";

        enriched = src
          ? `
            <div class="tjt-image-page">
              <img
                src="${src}"
                alt="${foundry.utils.escapeHTML(page.name)}"
              />
              ${caption}
            </div>
          `
          : "<p><em>(No image set)</em></p>";

        break;
      }

      case "text":
      default: {
        const raw = page.text?.content ?? "";

        enriched = raw.trim()
          ? await TextEditor.enrichHTML(raw, {
              async: true
            })
          : "";

        break;
      }
    }
  } else {
    /*
     * Legacy Journal Entry content.
     */
    const raw = journal.content ?? "";

    enriched = raw.trim()
      ? await TextEditor.enrichHTML(raw, {
          async: true
        })
      : "";
  }

  if (!enriched?.trim()) {
    enriched = "<p><em>(Empty Journal content)</em></p>";
  }

  /*
   * ONLY cache fields are written here.
   *
   * This is important:
   * enabled/journalId/pageId are never touched by this update.
   */
  await tileDoc.update(
    {
      flags: {
        [MODULE_ID]: {
          [FLAGS.cachedTitle]: title,
          [FLAGS.cachedHtml]: enriched,
          [FLAGS.cachedUpdated]: Date.now()
        }
      }
    },
    {
      render: false
    }
  );

  console.debug(
    MODULE_ID,
    "Cache successfully written",
    {
      tileId: tileDoc.id,
      title,
      htmlLength: enriched.length
    }
  );

  return true;
}


/* ------------------------------------------------------------------------- */
/* Tile Configuration UI                                                     */
/* ------------------------------------------------------------------------- */

function addTooltipTabToTileConfig(app, html) {
  const root =
    html instanceof HTMLElement
      ? html
      : html?.[0];

  if (!root) return;

  const nav = root.querySelector(
    'nav.sheet-tabs.tabs[data-application-part="tabs"], nav.sheet-tabs.tabs, nav.tabs'
  );

  if (!nav) return;

  const firstTabAnchor = nav.querySelector(
    'a[data-action="tab"][data-group], a[data-group]'
  );

  const group =
    firstTabAnchor?.dataset?.group ?? "sheet";

  /*
   * Prevent duplicate insertion.
   */
  if (
    nav.querySelector(`a[data-tab="${MODULE_ID}"]`) ||
    root.querySelector(`.tab[data-tab="${MODULE_ID}"]`)
  ) {
    return;
  }

  const existingPanel = root.querySelector(
    `.tab[data-group="${group}"]`
  );

  const panelContainer =
    existingPanel?.parentElement;

  if (!panelContainer) return;

  const tileDoc =
    app.object ??
    app.document ??
    app.tile?.document;

  if (!tileDoc) return;


  /*
   * IMPORTANT:
   * Read configuration from the actual Tile Document every time
   * the configuration window opens.
   */
  console.debug(MODULE_ID, "AddToolTip ", tileDoc)
  const enabled = !!tileDoc.getFlag(
    MODULE_ID,
    FLAGS.enabled
  );

  const selectedJournalId =
    tileDoc.getFlag(
      MODULE_ID,
      FLAGS.journalId
    ) ?? "";

  const selectedPageId =
    tileDoc.getFlag(
      MODULE_ID,
      FLAGS.pageId
    ) ?? "";

  const journalOptions =
    buildJournalOptions(selectedJournalId);

  const pageOptions =
    buildPageOptions(
      selectedJournalId,
      selectedPageId
    );

  const hasJournal = !!selectedJournalId;

  const cachedHtml =
    tileDoc.getFlag(
      MODULE_ID,
      FLAGS.cachedHtml
    ) ?? "";

  const hasCache =
    !!cachedHtml.trim();

  const cacheUpdated =
    formatCacheTimestamp(
      tileDoc.getFlag(
        MODULE_ID,
        FLAGS.cachedUpdated
      )
    );


  /*
   * Add the navigation tab.
   */
  const tabLink =
    document.createElement("a");

  tabLink.dataset.action = "tab";
  tabLink.dataset.group = group;
  tabLink.dataset.tab = MODULE_ID;

  tabLink.innerHTML =
    `<i class="fa-solid fa-comment-dots" inert></i>` +
    `<span>Tooltip</span>`;

  nav.appendChild(tabLink);


  /*
   * Render our Handlebars template.
   *
   * Foundry V13 namespaced API.
   */
  const tplPath =
    `modules/${MODULE_ID}/templates/tile-tooltip-tab.hbs`;

  foundry.applications.handlebars
    .renderTemplate(
      tplPath,
      {
        enabled,
        journalOptions,
        pageOptions,
        hasJournal,
        hasCache,
        cacheUpdated
      }
    )
    .then(markup => {
      if (!markup?.trim()) {
        throw new Error(
          "Tooltip template rendered empty markup."
        );
      }

      const wrapper =
        document.createElement("div");

      wrapper.innerHTML =
        markup.trim();

      const panel =
        wrapper.firstElementChild;

      if (!panel) {
        throw new Error(
          "Tooltip template produced no root element."
        );
      }

      panel.classList.add(
        "tab",
        "scrollable"
      );

      panel.dataset.group = group;
      panel.dataset.tab = MODULE_ID;
      panel.dataset.applicationPart =
        MODULE_ID;

      panelContainer.appendChild(panel);


      /* --------------------------------------------------------------- */
      /* Journal/Page controls                                           */
      /* --------------------------------------------------------------- */

      const journalSelect =
        panel.querySelector(
          "select.tjt-journal"
        );

      const pageSelect =
        panel.querySelector(
          "select.tjt-page"
        );


      /*
       * When Journal changes, rebuild the Page dropdown.
       */
      if (
        journalSelect &&
        pageSelect
      ) {
        const refillPages =
          journalId => {
            pageSelect.innerHTML = "";

            const firstOption =
              document.createElement(
                "option"
              );

            firstOption.value = "";
            firstOption.textContent =
              "— First Page / Entry Content —";

            pageSelect.appendChild(
              firstOption
            );

            const options =
              buildPageOptions(
                journalId,
                ""
              );

            for (const optionData of options) {
              const option =
                document.createElement(
                  "option"
                );

              option.value =
                optionData.id;

              option.textContent =
                optionData.name;

              pageSelect.appendChild(
                option
              );
            }

            pageSelect.disabled =
              !journalId;

            /*
             * Changing Journal intentionally resets
             * the Page selection.
             */
            pageSelect.value = "";
          };

        journalSelect.addEventListener(
          "change",
          event => {
            refillPages(
              event.target.value ?? ""
            );
          }
        );
      }


      /* --------------------------------------------------------------- */
      /* Cache Now                                                       */
      /* --------------------------------------------------------------- */

      const cacheBtn =
        panel.querySelector(
          ".tjt-cache-btn"
        );

      const cacheStatus =
        panel.querySelector(
          ".tjt-cache-status"
        );


      if (cacheBtn) {
        cacheBtn.addEventListener(
          "click",
          async event => {
            event.preventDefault();
            event.stopPropagation();

            if (!game.user.isGM) {
              return;
            }

            if (!tileDoc.id) {
              if (cacheStatus) {
                cacheStatus.textContent =
                  "⚠️ Save the tile first, then cache.";
              }

              return;
            }

            const selectedEnabled =
              panel.querySelector(
                'input[name="flags.tile-journal-tooltips-fix.enabled"]'
              )?.checked ?? false;

            const selectedJournal =
              journalSelect?.value ?? "";

            const selectedPage =
              pageSelect?.value ?? "";


            cacheBtn.disabled = true;

            cacheBtn.innerHTML =
              '<i class="fa-solid fa-rotate fa-spin"></i> Caching…';


            try {
              /*
               * STEP 1:
               *
               * Save ONLY the configuration.
               *
               * This means the values survive closing/reopening
               * the Tile Configuration window.
               */
              await tileDoc.update(
                {
                  flags: {
                    [MODULE_ID]: {
                      [FLAGS.enabled]:
                        selectedEnabled,

                      [FLAGS.journalId]:
                        selectedJournal,

                      [FLAGS.pageId]:
                        selectedPage
                    }
                  }
                },
                {
                  render: false
                }
              );


              /*
               * STEP 2:
               *
               * Build the cache using the now-saved configuration.
               */
              const success =
                await buildCacheFromJournal(
                  tileDoc
                );


              /*
               * Read the timestamp back from the
               * updated Tile Document.
               */
              const timestamp =
                tileDoc.getFlag(
                  MODULE_ID,
                  FLAGS.cachedUpdated
                );


              if (
                cacheStatus
              ) {
                if (
                  success &&
                  timestamp
                ) {
                  cacheStatus.textContent =
                    `✅ Cached (last updated: ${formatCacheTimestamp(timestamp)})`;
                } else {
                  cacheStatus.textContent =
                    "⚠️ Cache was not created.";
                }
              }

            } catch (error) {
              console.error(
                `${MODULE_ID} | Cache Now failed`,
                error
              );

              if (cacheStatus) {
                cacheStatus.textContent =
                  "❌ Cache failed (see console)";
              }

            } finally {
              cacheBtn.disabled = false;

              cacheBtn.innerHTML =
                '<i class="fa-solid fa-rotate"></i> Cache Now';
            }
          }
        );
      }


      /* --------------------------------------------------------------- */
      /* Rebind Foundry tabs                                             */
      /* --------------------------------------------------------------- */

      try {
        if (app._tabs) {
          for (
            const tabController
            of Object.values(app._tabs)
          ) {
            tabController?.bind?.(root);
          }
        }

        if (app.tabs?.bind) {
          app.tabs.bind(root);
        }

      } catch (error) {
        console.warn(
          `${MODULE_ID} | Failed to rebind tabs`,
          error
        );
      }
    })
    .catch(error => {
      console.error(
        `${MODULE_ID} | Failed to render template at ${tplPath}`,
        error
      );
    });
}


/* ------------------------------------------------------------------------- */
/* Hover detection                                                           */
/* ------------------------------------------------------------------------- */

function pointInRotatedRect(
  px,
  py,
  rectX,
  rectY,
  width,
  height,
  rotation
) {
  const centerX =
    rectX + width / 2;

  const centerY =
    rectY + height / 2;

  const dx =
    px - centerX;

  const dy =
    py - centerY;

  const radians =
    (-rotation * Math.PI) / 180;

  const cos =
    Math.cos(radians);

  const sin =
    Math.sin(radians);

  const rx =
    dx * cos - dy * sin;

  const ry =
    dx * sin + dy * cos;

  return (
    Math.abs(rx) <= width / 2 &&
    Math.abs(ry) <= height / 2
  );
}


function getTopmostTooltipTileAt(x, y) {
  const tiles =
    canvas?.tiles?.placeables;

  if (!tiles?.length) {
    return null;
  }

  const ordered =
    tiles
      .map((tile, index) => ({
        tile,
        index,
        document: tile.document
      }))
      .filter(
        item => !!item.document
      )
      .sort((a, b) => {
        const sortA =
          a.document.sort ?? 0;

        const sortB =
          b.document.sort ?? 0;

        if (sortA !== sortB) {
          return sortA - sortB;
        }

        return a.index - b.index;
      });


  /*
   * Reverse order means topmost tile first.
   */
  for (
    let i = ordered.length - 1;
    i >= 0;
    i--
  ) {
    const {
      tile,
      document
    } = ordered[i];


    const enabled =
      !!document.getFlag(
        MODULE_ID,
        FLAGS.enabled
      );

    if (!enabled) {
      continue;
    }


    const cached =
      document.getFlag(
        MODULE_ID,
        FLAGS.cachedHtml
      );

    if (
      !cached ||
      !cached.trim()
    ) {
      continue;
    }


    /*
     * Don't show hidden tiles to players.
     */
    if (
      document.hidden &&
      !game.user.isGM
    ) {
      continue;
    }


    /*
     * Fast bounding-box test.
     */
    const insideAABB =
      x >= document.x &&
      x <= document.x + document.width &&
      y >= document.y &&
      y <= document.y + document.height;


    const rotation =
      document.rotation ?? 0;


    if (
      !insideAABB &&
      rotation === 0
    ) {
      continue;
    }


    const hit =
      rotation
        ? pointInRotatedRect(
            x,
            y,
            document.x,
            document.y,
            document.width,
            document.height,
            rotation
          )
        : insideAABB;


    if (!hit) {
      continue;
    }

    return tile;
  }

  return null;
}


function attachCanvasHoverListener() {
  if (!canvas?.app?.view) return;

  // Remove previous listener if the canvas was recreated.
  if (_tjtHover.onMove) {
    canvas.app.view.removeEventListener(
      "mousemove",
      _tjtHover.onMove
    );
  }

  if (_tjtHover.onLeave) {
    canvas.app.view.removeEventListener(
      "mouseleave",
      _tjtHover.onLeave
    );
  }

  _tjtHover.tileId = null;
  hideTooltip();

  _tjtHover.onMove = (event) => {
    /*
     * Do NOT restrict this to the Token Controls layer.
     * A tooltip belongs to a Tile, so it should work regardless
     * of which Foundry layer is currently active.
     */

    if (!canvas.ready) return;

    /*
     * Convert browser/client coordinates to Foundry canvas
     * coordinates.
     *
     * Foundry V13 provides this specifically for this purpose.
     */
    const point = canvas.canvasCoordinatesFromClient({
      x: event.clientX,
      y: event.clientY
    });

    if (!point) return;

    const tile = getTopmostTooltipTileAt(
      point.x,
      point.y
    );

    const tileDoc = tile?.document;

    /*
     * Mouse isn't over a tooltip-enabled tile.
     */
    if (!tileDoc) {
      if (_tjtHover.tileId !== null) {
        _tjtHover.tileId = null;
        hideTooltip();
      }

      return;
    }

    /*
     * Only update the DOM when the hovered tile changes.
     */
    if (_tjtHover.tileId === tileDoc.id) {
      return;
    }

    _tjtHover.tileId = tileDoc.id;

    const html = getCachedTooltip(tileDoc);

    if (!html) {
      hideTooltip();
      return;
    }

    showTooltip(html);
  };

  _tjtHover.onLeave = () => {
    _tjtHover.tileId = null;
    hideTooltip();
  };

  canvas.app.view.addEventListener(
    "mousemove",
    _tjtHover.onMove
  );

  canvas.app.view.addEventListener(
    "mouseleave",
    _tjtHover.onLeave
  );
}


/* ------------------------------------------------------------------------- */
/* Foundry hooks                                                             */
/* ------------------------------------------------------------------------- */

Hooks.once(
  "ready",
  () => {
    /*
     * Track browser mouse coordinates so the tooltip
     * can follow the cursor.
     */
    window.addEventListener(
      "mousemove",
      event => {
        mouseX =
          event.clientX;

        mouseY =
          event.clientY;


        if (
          tooltipEl?.style.display ===
          "block"
        ) {
          positionTooltip();
        }


        /*
         * Hide tooltip when cursor enters a Foundry
         * application window.
         */
        if (
          event.target?.closest?.(
            ".app, .application"
          )
        ) {
          if (_tjtHover.tileId) {
            _tjtHover.tileId = null;
            hideTooltip();
          }
        }
      }
    );
  }
);


/*
 * Core Foundry Tile Configuration.
 */
Hooks.on(
  "renderTileConfig",
  (app, html) => {
    addTooltipTabToTileConfig(
      app,
      html
    );
  }
);


/*
 * Monk's Active Tile configuration.
 */
Hooks.on(
  "renderActiveTileConfig",
  (app, html) => {
    addTooltipTabToTileConfig(
      app,
      html
    );
  }
);


/*
 * Reattach canvas hover listener when a scene/canvas
 * becomes ready.
 */
Hooks.on(
  "canvasReady",
  () => {
    attachCanvasHoverListener();
  }
);
