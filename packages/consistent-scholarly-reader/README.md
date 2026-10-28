# Consistent Reader Extension for Academic Sites

Decent support

- Arxiv

Planned support:

- IEEE
- Nature
- ACM
- Science

Publisher sites with HTML versions are good for accessibility. However, some sites have distractingly large sidebars and other unimportant bloat floating around the actual paper content, making it more difficult to focus. This discourages the use of the HTML version and readers end up simply going back to the PDF which has a focused, clean format.

This chrome extension adds a "reading mode" to a site- similar to the builtin reading mode. However: 

- It parses it into a custom template (similar to that generated in ./reference).
- Figures and images are still there
- Adds a google scholar pdf reader-style citation hover peek - _can just be text for now, no need to link or look for apis_

## Reading Mark

This also attaches a functionality to the page that adds a "reading mark"- a sentence or equation is highlighted (by default with a semitransparent dark box).

The reading mark can be activated by pressing `R`. It can be pushed to the next sentence via the up and down keys, or Vim-like keybinds hjkl.
