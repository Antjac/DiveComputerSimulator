// Line icons of the interface buttons (24 × 24, drawn in the button's text colour). Elements with a
// data-icon attribute in index.html get theirs at start (fillIcons).
const PATHS = {
  /** Arrow down into a tray: save to a file. */
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  /** Arrow up out of a tray: load a file. */
  upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  /** Sheet with lines: a report (the dive recap). */
  recap: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/>',
  /** Printer. */
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  /** Bin: erase. */
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): string {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

export function fillIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    if (el.dataset.icon! in PATHS) el.innerHTML = icon(el.dataset.icon as IconName);
  });
}
