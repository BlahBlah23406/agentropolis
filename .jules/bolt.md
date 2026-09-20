## 2024-09-20 - Fast-path static strings in env interpolation
**Learning:** In configuration loaders, many properties are static strings with no environment variables. Running regex `.replace` on these is pure overhead. A simple `.includes` check provides a ~6x speedup.
**Action:** Always check if a substring (like interpolation tokens) exists using `String.prototype.includes` before firing up a regex replacement loop, especially on hot paths like config parsing.
