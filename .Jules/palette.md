## 2024-10-25 - High-contrast focus states
**Learning:** Keyboard accessibility requires explicit focus-visible styles, especially on dark themes where default browser outlines might be invisible.
**Action:** Always add explicit `:focus-visible` styles using theme accent colors when building custom UI.

## 2026-10-25 - Interactive Elements inside Clickable Headers
**Learning:** Placing interactive elements (like a search input) inside a clickable 'div' header creates a severe interaction bug where clicking the input triggers the header's click action (e.g. collapsing the view), making the input unusable. Additionally, these clickable divs often lack proper keyboard accessibility roles and tab indexing.
**Action:** When designing clickable container headers, always ensure they are fully accessible via keyboard (add `role="button"`, `tabindex="0"`, `aria-expanded`, and keydown handlers for Enter/Space), and explicitly ignore events that originate from interactive children (e.g. `if (e.target.closest('input')) return;`) rather than relying on global stopPropagation which can break other listeners.
