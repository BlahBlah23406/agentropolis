## 2024-10-25 - High-contrast focus states
**Learning:** Keyboard accessibility requires explicit focus-visible styles, especially on dark themes where default browser outlines might be invisible.
**Action:** Always add explicit `:focus-visible` styles using theme accent colors when building custom UI.

## 2025-05-15 - Tooltips and ARIA Selected State UX
**Learning:** Pairing visual states (like `.on` active classes for tabs) with `aria-selected` is crucial for screen readers, and surfacing global keyboard shortcuts via button tooltips (e.g., `title="Close (Esc)"`) greatly improves discoverability for power users and keyboard accessibility without cluttering the UI.
**Action:** Ensure all future tab-like custom elements toggle `aria-selected` alongside visual classes, and include helpful shortcut hints in standard tooltips.
