# Writing examples for REFERENCE.md

Every rule in REFERENCE.md gets one to three small examples right under it, and every example runs:
`scripts/check-examples.mjs` runs each one and checks the results it shows. A reader pauses on a
rule and sees it work; a change to Juris that breaks a rule breaks its example.

## Running the checker

```sh
node scripts/check-examples.mjs REFERENCE.md
node scripts/check-examples.mjs /path/to/chunk.md --verbose
```

It takes any markdown file, a fragment of REFERENCE.md copied anywhere included, and runs from
juris-kit (the programs are written to a temporary `.examples-*` directory inside the kit, removed
afterwards, so `juris/<file>.js` and `juris-kit/server/<file>.js` resolve as
they do from the kit's own files). Each example runs alone, in a process of its own, ten at a time:
REFERENCE.md's examples take under a second. It exits 1 when one fails, naming the heading and the
markdown line:

```text
✗ chunk.md:612  ## The public API › ### Components and layouts
    line 615: renders something else
      expected  <p>Hello</p>
      actual    <p>Hi</p>
```

Options: `--verbose` lists every block that passed, `--keep` keeps the programs (to read what ran),
`--jobs N`, `--timeout ms` (10 000 by default). `npm test` runs it over REFERENCE.md
(`tests/reference-examples.test.mjs`); `tests/check-examples.test.mjs` holds the checker itself.

## The conventions

**Every ```js block is an ES module, run in Node.** It may start with its own imports. Blocks in
other languages (`html`, `sh`, `http`, `text`, `json`) are not run.

**A result is shown, and checked, with a marker comment** (here as an excerpt, parsed only, since
`cart`, `api` and `juris` are not defined on this page):

```js excerpt
cart.items.length; // → 2
api.liveState("cart"); // → "live"
api.getState("cart"); // → { items: [1, 2] }
juris.renderToString({ p: "Hi" }); // → <p>Hi</p>
const total = 1 + 2; // → 3
await api.call("price", "milk"); // → 3
```

- `// → value` after a statement: the value is a JS literal, compared deeply (own keys, whatever
  the prototype); a value that starts with `<` is HTML, compared as an exact string.
- It applies to an expression statement, to `const name = …;` (the name's value), or to
  `return …;`. The statement ends with `;` on the marker's line.
- A marker may stand on its own line, right under its statement; a long value continues on the
  comment lines under it, indented two spaces past the `//`. HTML goes on where it was cut (break
  it between tags); a JS value is read across the lines:

  ```js excerpt
  juris.renderToString(layout);
  // → <ul class="todos"><li>Milk</li>
  //   <li>Eggs</li></ul>
  ```

- `// throws TypeError: start of the message` after a statement that throws (an awaited rejection
  included). The name and the message are each optional; the message is matched from its start.
- `// console.warn: start of the line` (or `log`, `info`, `error`, `debug`): the statement writes
  that line. Use it for what the contract says is "named on the console in `devMode`".
- A marker inside a function is checked each time the statement runs, and reported if it never
  does. A Promise shown without `await` fails with a hint.

**A setup block** (```` ```js setup ````) is prepended to every later js block under the same
heading, down to the next heading of the same or a higher level (its sub-headings included).
Introduce it with a sentence; the reader sees everything that runs:

````text
The examples on this page share one instance, given the kit's string renderer, so a layout is shown
as the HTML a server writes for it.

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
```
````

**Tags** after `js`, in the info string:

| Tag | What the checker does | What the site shows |
| --- | --- | --- |
| `setup` | prepends it, as above (and runs it alone too) | the code |
| `dom` | runs it with a stand-in page: `document`, `window`, `Node`, `Element` (`scripts/examples-dom.mjs`) | the caption "In a browser" |
| `browser` | parses it, never runs it: it needs a real browser (custom elements, layout, a real network) | the caption "In a browser" |
| `excerpt` | parses it, never runs it: a piece of an app, importing the app's own files | the code |
| `known-failure` | runs it; a failure is listed apart and fails nothing, and a pass fails ("take the tag off") | the code |

Prefer runnable. Most of Juris runs in Node: render to a string with the kit's `SSRRenderer`, and
draw into the stand-in page for what only a browser shows (a re-draw, a keyed move, a listener, a
namespace). Keep `browser` and `excerpt` rare, and say in the report how many you used.

**The stand-in page** is not a browser. It does what the DOM renderer asks; `innerHTML` and
`outerHTML` serialize as the HTML standard says (a style as `color: red;`, as a browser writes
it); setting `innerHTML` parses simple markup; `querySelector(All)`, `matches` and `closest` read
tags, `#id`, `.class`, `[attr]`, `[attr="v"]`, descendant and `>` combinators; `element.click()`
dispatches a primary-button `MouseEvent` that bubbles. For the router it has an address bar and a
session history: `location` (read-only, starting at `http://localhost/`; `reload()` does nothing),
`history` (`pushState`, `replaceState`, `back`, `forward`, `go`, a move firing `popstate` in a later
task), `scrollTo`, `scrollX`/`scrollY`, and `document.visibilityState`; an example dispatches a
page's `pagehide` and `pageshow` on `window` as a `PageTransitionEvent` (`{ persisted }`). It has no layout, no CSS
parsing (a value a browser would refuse is kept: use valid CSS), no `MutationObserver`, custom
elements or `sessionStorage` (an example that needs one defines a small one in plain view). An
example that needs more extends `scripts/examples-dom.mjs` or is tagged `browser`. A `setup` that
only a browser can run is `js setup browser`: parsed, and prepended to the `browser` blocks after it. In a `dom` example
`new Juris()` is a browser instance (`isServer` false), so browser-only options work there
(`callCache`) and server-only refusals do not.

## Style

- **One to three examples under every bullet and every paragraph that states a rule**, right under
  the rule: inside the list item, indented to its content, with a blank line before the fence.
- **Never change what the contract says.** A bullet or paragraph that packs several rules may be
  split (into sub-bullets, or paragraphs) at its sentences, each rule with its own example; keep
  every word. A sentence that introduces a section's setup is fine; a new claim is not.
- **Small, one thing, its result shown.** 2 to 10 lines, typically. Show the HTML a layout renders
  to, the value returned, the error thrown, what is left out. A result goes in a marker, never in a
  `console.log` the reader has to imagine.
- **Realistic names:** a cart, a todo list, a user, an order, prices. Not foo and bar.
- **Lines of 80 characters at most** (the docs column fits 80 at 13px, two lists deep; a phone
  shows about 43 before it scrolls). One statement per line; break long calls and objects.
- Type the arrow as `→` (U+2192). `// ->` is reported as a mistake.

## When the docs and the code disagree

Do not edit Juris or the kit, and do not bend the prose or the example. Record the REFERENCE line,
what it says, what the code does, and a minimal repro for the report. Then leave the example out, or
keep the result the contract states in a `known-failure` block, which the checker lists apart.

## Things that catch writers

- `juris.use(plugin)` and `extendApi` give the instance a new `api` object: read a plugin's names
  from `juris.api` (or a component's `api`), not from a `const api = juris.api` taken before.
- In Node without `dom`, `new Juris()` is a server instance: `callCache` is refused, and a failed
  call's words are kept only when `exposeError` allows them (`fail(…)` from `errors.js` does).
- Each block is its own process: nothing carries from one block to the next but the setup.
- On jurisjs.com a section with two or more sub-headings becomes several pages once it passes 5,000
  words, code included, and the pages' URLs change. "Why it is built this way" had 3,116 words and
  "Security defaults and invariants" 2,553 before their examples: keep an eye on them.
- jurisjs.com measures its editor's paste detection on every REFERENCE.md block
  (`test/editor-code.test.mjs`): run `npm test` there too.

## Model examples

These run too (`npm test` checks this file beside REFERENCE.md), on:

```js setup
import Juris from "juris/juris.js";
import SSRRenderer from "juris-kit/server/ssr-renderer.js";

const juris = new Juris({ features: { ssr: SSRRenderer } });
```

A rule and the HTML it renders:

```js
juris.registerComponent("OrderLink", (props) => ({
    a: { href: `/orders/${props.id}`, textContent: `Order ${props.id}` },
}));
juris.renderToString({ OrderLink: { id: 7 } });
// → <a href="/orders/7">Order 7</a>
```

A refusal, and the console line `devMode` writes for it:

```js
const dev = new Juris({ devMode: true, features: { ssr: SSRRenderer } });
dev.renderToString({ p: { innerHTML: "<b>5 items</b>" } }); // → <p></p>
// console.warn: Juris: dropped innerHTML: markup is not written from a layout
```

What only a page shows, tagged `dom` (a keyed list moves its elements):

```js dom
juris.setValue("todos", [{ id: 1, title: "Milk" }, { id: 2, title: "Eggs" }]);
const page = document.createElement("main");
juris.render(page, {
    ul: {
        children: () => juris.getState("todos").map((todo) => ({
            li: { key: todo.id, textContent: todo.title },
        })),
    },
});
const milk = page.querySelector("li");
juris.setValue("todos", [{ id: 2, title: "Eggs" }, { id: 1, title: "Milk" }]);
page.innerHTML; // → <ul><li>Eggs</li><li>Milk</li></ul>
page.querySelector("ul").lastChild === milk; // → true
```
