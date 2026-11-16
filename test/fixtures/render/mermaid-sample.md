# Diagrams

```mermaid
flowchart LR
  A[Reader] -->|right-click| B(Browsedown)
```

A hostile diagram: its text must reach the page only as escaped code.

```mermaid
flowchart TD
  X["<img src=x onerror=alert(1)>"] --> Y["<script>alert(2)</script>"]
  click X href "javascript:alert(3)"
```

<pre><code class="language-mermaid">graph TD; Raw --> HTML</code></pre>

<figure class="bd-mermaid"><p>A document can't fake the wrapper.</p></figure>

```js
const stillHighlighted = true;
```
