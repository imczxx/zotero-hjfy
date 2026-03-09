import { config } from "../../package.json";
import {
  buildHjfyURL,
  extractArxivIDFromManualInput,
  getArxivResolution,
  setManualArxivInput,
} from "./arxiv";
import { getLocaleID, getString } from "../utils/locale";

const STYLE_ID = `${config.addonRef}-hjfy-style`;
const MENU_ITEM_ID = "zotero-itemmenu-hjfy-open";
const INFO_ROW_ARXIV_ID = "hjfy-arxiv-id";
const SECTION_HJFY_URL_ID = "hjfy-url-section";
const SECTION_BUTTON_OPEN_HJFY = "open-hjfy";
const ITEM_TREE_COLUMN_KEY = "hjfy";
const HJFY_URL_ATTR = "data-hjfy-url";
const CELL_LINK_CLASS = "hjfy-cell-link";
const SECTION_BODY_CLASS = "hjfy-section-body";
const SECTION_LINK_CLASS = "hjfy-section-link";
const SECTION_EMPTY_CLASS = "hjfy-section-empty";
const SECTION_ICON = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const WINDOW_HOOKED = new WeakSet<Window>();

function isRegularItem(
  item: Zotero.Item | undefined | null,
): item is Zotero.Item {
  return Boolean(item?.isRegularItem()) && !(item as any).isFeedItem;
}

function showMessage(
  text: string,
  type: "default" | "success" = "default",
): void {
  new ztoolkit.ProgressWindow(config.addonName)
    .createLine({ text, type })
    .show();
}

function getURLLauncher(): ((url: string) => void) | null {
  try {
    const toolkitZotero = ztoolkit.getGlobal("Zotero") as any;
    if (typeof toolkitZotero?.launchURL === "function") {
      return (url: string) => toolkitZotero.launchURL(url);
    }

    if (typeof (Zotero as any).launchURL === "function") {
      return (url: string) => (Zotero as any).launchURL(url);
    }
  } catch (error) {
    Zotero.logError(error as Error);
  }

  return null;
}

function openExternalURL(url: string): boolean {
  const launchURL = getURLLauncher();
  if (!launchURL) {
    showMessage(getString("arxiv-open-not-found"), "default");
    return false;
  }

  try {
    launchURL(url);
    return true;
  } catch (error) {
    Zotero.logError(error as Error);
    showMessage(getString("arxiv-open-not-found"), "default");
    return false;
  }
}

function getResolvedHjfyURL(item: Zotero.Item | undefined | null): string {
  if (!isRegularItem(item)) {
    return "";
  }
  const resolved = getArxivResolution(item).resolved;
  return resolved ? buildHjfyURL(resolved.id) : "";
}

function getSelectedRegularItems(): Zotero.Item[] {
  const pane = ztoolkit.getGlobal("ZoteroPane");
  const items = pane?.getSelectedItems?.() || [];
  return items.filter((item: Zotero.Item) => isRegularItem(item));
}

function getHjfyURLs(items: Zotero.Item[]): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    const url = getResolvedHjfyURL(item);
    if (url) {
      urls.add(url);
    }
  }
  return [...urls];
}

function openItemsInHjfy(items: Zotero.Item[]): void {
  const urls = getHjfyURLs(items);
  if (urls.length === 0) {
    showMessage(getString("arxiv-open-not-found"));
    return;
  }

  for (const url of urls) {
    if (!openExternalURL(url)) {
      return;
    }
  }

  showMessage(
    getString("arxiv-opened-count", { args: { count: urls.length } }),
    "success",
  );
}

function refreshItemPane(): void {
  for (const win of Zotero.getMainWindows()) {
    try {
      (win as any).ZoteroPane?.itemPane?.render?.();
    } catch (error) {
      Zotero.logError(error as Error);
    }
  }
}

function refreshDerivedUI(): void {
  Zotero.ItemPaneManager.refreshInfoRow(INFO_ROW_ARXIV_ID);
  Zotero.ItemTreeManager.refreshColumns();
  refreshItemPane();
}

function persistManualArxivInput(item: Zotero.Item, value: string): void {
  setManualArxivInput(item, value);
  void item
    .saveTx()
    .then(() => {
      refreshDerivedUI();
    })
    .catch((error) => {
      Zotero.logError(error);
      showMessage(getString("arxiv-save-failed"));
    });
}

function renderHjfySectionBody(body: HTMLDivElement, url: string): void {
  const doc = body.ownerDocument;
  body.replaceChildren();
  body.classList.add(SECTION_BODY_CLASS);

  if (!doc) {
    return;
  }

  if (!url) {
    const empty = doc.createElement("div");
    empty.className = SECTION_EMPTY_CLASS;
    empty.textContent = getString("arxiv-open-not-found");
    body.appendChild(empty);
    return;
  }

  const link = doc.createElement("a");
  link.className = `text-link ${SECTION_LINK_CLASS}`;
  link.textContent = url;
  link.href = url;
  link.tabIndex = 0;
  link.setAttribute(HJFY_URL_ATTR, url);
  link.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openExternalURL(url);
  });
  body.appendChild(link);
}

export class ArxivUIFactory {
  static async registerItemTreeColumn() {
    await Zotero.ItemTreeManager.registerColumns({
      pluginID: config.addonID,
      dataKey: ITEM_TREE_COLUMN_KEY,
      label: getString("arxiv-column-label"),
      enabledTreeIDs: ["main"],
      defaultIn: ["default"],
      width: "72",
      fixedWidth: true,
      staticWidth: true,
      dataProvider: (item) => {
        return isRegularItem(item)
          ? getArxivResolution(item).resolved?.id || ""
          : "";
      },
      renderCell(index, data, column, isFirstColumn, doc) {
        void index;
        void isFirstColumn;

        const cell = doc.createElement("a");
        // Pointer events auto is critical in case Zotero disables pointer interaction in rows.
        cell.className = `cell ${column.className} text-link ${CELL_LINK_CLASS}`;
        cell.style.pointerEvents = "auto";
        cell.style.cursor = "pointer";

        if (!data) {
          return cell;
        }

        const url = buildHjfyURL(data);
        cell.textContent = data;
        cell.href = url;
        cell.title = url;
        cell.tabIndex = 0;
        cell.setAttribute(HJFY_URL_ATTR, url);
        cell.addEventListener("mouseup", (event: MouseEvent) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          openExternalURL(url);
        });
        cell.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          openExternalURL(url);
        });
        return cell;
      },
      zoteroPersist: ["width", "hidden", "sortDirection"],
    });
  }

  static registerItemPane() {
    const Zotero = ztoolkit.getGlobal("Zotero");

    (Zotero.ItemPaneManager as any).unregisterInfoRow?.(INFO_ROW_ARXIV_ID);
    (Zotero.ItemPaneManager as any).unregisterSection?.(SECTION_HJFY_URL_ID);

    Zotero.ItemPaneManager.registerInfoRow({
      rowID: INFO_ROW_ARXIV_ID,
      pluginID: config.addonID,
      editable: true,
      label: {
        l10nID: getLocaleID("item-info-row-arxiv-id-label"),
      },
      position: "afterCreators",
      onGetData: ({ item }) => {
        return isRegularItem(item) ? getArxivResolution(item).manualInput : "";
      },
      onSetData: ({ item, value }) => {
        if (!isRegularItem(item)) {
          return;
        }
        const input = String(value || "").trim();
        const nextValue = extractArxivIDFromManualInput(input) || input;
        persistManualArxivInput(item, nextValue);
      },
      onItemChange: ({ item, setEnabled, setEditable }) => {
        const enabled = isRegularItem(item);
        setEnabled(enabled);
        setEditable(enabled);
      },
    });

    Zotero.ItemPaneManager.registerSection({
      paneID: SECTION_HJFY_URL_ID,
      pluginID: config.addonID,
      header: {
        l10nID: getLocaleID("item-section-hjfy-head-text"),
        icon: SECTION_ICON,
      },
      sidenav: {
        l10nID: getLocaleID("item-section-hjfy-sidenav-tooltip"),
        icon: SECTION_ICON,
      },
      sectionButtons: [
        {
          type: SECTION_BUTTON_OPEN_HJFY,
          icon: SECTION_ICON,
          l10nID: getLocaleID("item-section-hjfy-button-tooltip"),
          onClick: ({ item }) => {
            const url = getResolvedHjfyURL(item);
            if (url) {
              openExternalURL(url);
            }
          },
        },
      ],
      onRender: ({ body, item, setSectionButtonStatus, setSectionSummary }) => {
        const url = getResolvedHjfyURL(item);
        renderHjfySectionBody(body, url);
        setSectionButtonStatus(SECTION_BUTTON_OPEN_HJFY, {
          hidden: !url,
        });
        setSectionSummary(url || getString("arxiv-open-not-found"));
      },
      onItemChange: ({ item, setEnabled, setSectionButtonStatus }) => {
        const url = getResolvedHjfyURL(item);
        setEnabled(isRegularItem(item));
        setSectionButtonStatus(SECTION_BUTTON_OPEN_HJFY, {
          hidden: !url,
        });
      },
    });
  }

  static registerMainWindow(win: _ZoteroTypes.MainWindow) {
    if (WINDOW_HOOKED.has(win)) {
      return;
    }
    WINDOW_HOOKED.add(win);

    this.registerStyleSheet(win);
    this.registerRightClickMenuItem();
  }

  static unregisterMainWindow(win: Window) {
    void win;
  }

  static registerStyleSheet(win: _ZoteroTypes.MainWindow) {
    const doc = win.document;
    if (doc.getElementById(STYLE_ID)) {
      return;
    }

    const style = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        id: STYLE_ID,
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${config.addonRef}/content/zoteroPane.css`,
      },
    });
    doc.documentElement?.appendChild(style);
  }

  static registerRightClickMenuItem() {
    const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: MENU_ITEM_ID,
      label: getString("arxiv-menu-open-hjfy"),
      commandListener: () => {
        openItemsInHjfy(getSelectedRegularItems());
      },
      icon: menuIcon,
    });
  }
}
