# Juris devtools: a proposal

> **Phase 1 built, 2026-11-05.** "The contract" is now REFERENCE.md's "`devtools.js`" (and the
> sections it changed), as built; "The contract" below records where phase 1 differs from this
> proposal and keeps what phases 2 and 3 add. Line numbers in this file refer to the checkouts as
> they were before phase 1.
>
> **Approved by the author, 2026-11-05: every decision (D1–D19) as written, and every open question
> answered as recommended.**
>
> **Status before approval: a proposal for the author's review, 2026-11-05.** It was written
> against `juris` 0.93.0 and `juris-kit` 0.93.0, the checkouts beside this file, and all line
> numbers refer to them. It was checked against a large real app, which runs 0.92.0 from npm. A
> bold **Dn** marks a decision taken here, with its reason, for the author to overturn. "Open questions", near the end, holds the
> decisions that should not be taken without him. The section "The contract" is written as it would
> read in REFERENCE.md once built.

## Contents

- [In one paragraph](#in-one-paragraph)
- [What devMode gives today](#what-devmode-gives-today), and what blocks a devtools
- [Goals and non-goals](#goals-and-non-goals)
- [The security model](#the-security-model)
- [The contract](#the-contract): now REFERENCE.md's; how phase 1 differs, and what phases 2 and 3 add
- [The nine insights](#the-nine-insights): for each, its source today, what to add, and its shape
- [The server's dev channel](#the-servers-dev-channel)
- [The Chrome extension](#the-chrome-extension)
- [Tests](#tests)
- [Phasing](#phasing)
- [Open questions](#open-questions)
- [Decisions](#decisions), indexed

## In one paragraph

A new browser module, `devtools.js`, is given to a devMode instance as a feature (as the kit gives
a server instance its string renderer). It registers the instance in a small registry on `window`,
and it records what Juris already knows but throws away: which binding draws what, for which
component, reading which paths; which write woke which bindings, in what order, and how long each
took; what was refused and why; and whether the first client draw matched the server's markup. It
answers a versioned, read-only, synchronous request protocol. A Chrome DevTools panel, itself a
Juris app, polls that protocol through `chrome.devtools.inspectedWindow.eval`. The extension needs
no content script, no service worker and no host permission. In development the kit adds a
per-page render record, fetched on request, and marks every live patch with the change that caused
it. With devMode off, no page downloads `devtools.js`, nothing is put on `window`, and a write runs
exactly the code it runs today, which a test holds. One thing must be built before any of this:
`hydrate` cannot turn devMode on today.

## What devMode gives today

All of it was checked in the code.

| Piece | Where | What it gives | What a devtools lacks |
| --- | --- | --- | --- |
| `window.$juris[n]` | `juris.js:216-221` | The whole instance, in devMode, in a browser, never on a server instance (`!this.isServer`) | A version, a stable shape, a way to learn of an instance from outside. It is the instance's internals, which change |
| `componentTree()`, `findComponents(name)`, `onTreeChange(fn)` | `component-manager.js:55-137`, `juris.js:1142-1152` | Instances tracked from `track` (`:55`); a snapshot of `id`, `name`, `key`, raw `props`, `local: { path, values }` (initials included, `juris.js:502-505`), `root` (a DOM node), `adopted`, `disposed`, `children` (`:85-99`); the whole tree passed to every watcher after each draw that changed it (`:123-137`, called from `dom-renderer.js:249`) | Bounded values. The props are unbounded, and in a large real app a row's props hold the row. The whole tree is rebuilt on every change |
| Node to instances | `juris.componentInstances` (`juris.js:1137-1139`), over the renderer's `WeakMap` (`dom-renderer.js:186`) | Root node to `[instance]`, innermost first. **This is public, not devMode-gated** | An instance has an `id` only in devMode (`component-manager.js:57`) |
| `stateManager.observe(fn)` | `state-manager.js:342-361` | `(path, value, previous)` for every write, after the subscribers it woke (within a `batch`, at the write itself) | Which bindings woke, in what order, and how long each took |
| `onChange` | `new Juris({ onChange })` (`juris.js:142`), `state-manager.js:93` (commented "devtools hook"), `:835` | Each changed path, after a pass's binding phase | `hydrate` cannot pass it, and it names paths, not writes |
| devMode console warnings | Tag `dom-renderer.js:1659`; attribute or URL `:740`; style `:710`; `innerHTML` `:1141`; a layout in a value `:794`; unread getter prop `juris.js:1080-1098`; unknown component `juris.js:307`; a binding that read nothing `juris.js:995`; a boundary handled an error `juris.js:388` | Text, using `html-safety.js`'s `reason` (`:79`, `:81`, `:101`, `:142`, `:147`, `:222`, `:224`, `:226`) | A record, a stable rule code, and the element and component |
| `renderTrace()` | `juris.js:909-924`, recorded by `server/ssr-renderer.js:135-157` | `reactive`, `paths`, `roots`, `calls`, `services`, `live`, `flags`, `unknown`, `static`, plus `failed` (`juris.js:890`). The kernel traces every page (`kernel.js:197`) and tells `onRender({ key, decision, trace })` (`kernel.js:253`) | Any way to reach the page it describes |
| `decide` | `server/page-cache.js:46-69`; `put`'s `raced` `:138` | `{ cache, reason }`: `personal`, `not-found`, `untraced`, `failed:…`, `unknown:…`, `volatile:…`, `request-state:…`, `static`, `dependent`. Without a cache: `{ cache: false, reason: "cache off" }` (`kernel.js:252`) | Any way to reach the page. It is decided after the document is written |
| Dispatcher | `server/service-dispatcher.js`: `stats()` `:1140-1147`; groups `:272`; `touch` `:759-772`; `invalidate` `:713-753`; `refresh` and `refreshOnce` `:623-678`; `broadcast` `:517-524`; `emit` `:466-479`; the bus `:1100-1107`, `busStats` `:409` | Counts; the chain mutation, `touches`, `invalidate`, re-run, `diff`, patch | Any identity on a patch: `{ key, full }`, `{ key, set, del }` or `{ key, error }` (`:640`, `:645`, `:634`) |
| Live client | `remote-services.js`: hello `:395-422`; `applyPatch` `:354-379` (one `batch`); `transport.clientId` `:504` | The client id, the status of each path | Nothing to tell a patch apart, or link it to the change behind it |
| Code ids | `server/modules.js:402` (`?v=<hash>-<code id>`), `:431` (every import `?v=<code id>`), `:519`; the loader imports the versioned entry (`server/document.js:180`, `kernel.js:775`) | One code id per build in every module URL | `/version` answers `{ build }` only (`kernel.js:436-438`), so no code id can be matched to a build |
| Dev reload | `server/dev-reload.js`: `/__reload` (`:57`), one broadcast stream per page with `build` and `reload` events (`:62-64`, `:169-177`); answered in the kernel's development slot (`kernel.js:788`), refused outside development (`kernel.js:695`) | A development-only path, answered before `/api/` | Any notion of which page is which |

**What blocks it.**

- **`hydrate` cannot turn devMode on.** Its options are a closed list (`client.js:79-80`). `juris`
  takes `allowTags`, `allowSchemes` and `allowInnerHTML` and refuses anything else
  (`sharedOptions`, `juris.js:44-57`). It builds `new Juris({ ...instanceOptions, state, services
  })` (`client.js:206`). So no page booted by `hydrate` ever has devMode on, a large real app's
  included: it passes `dev` to the kernel, and nothing turns that into the browser's devMode. Every
  insight below waits on this, and phase 1 starts with it.
- **A binding does not know what it draws.** `bindProperty(element, value, apply)`
  (`dom-renderer.js:780-789`) is handed a closure, and the property's name stays in
  `applyProperties` (`:1130`). A subscriber is a bare `refresh` function
  (`state-manager.js:99`, `juris.js:991`), and nothing maps it back to an element or a component.
- **A patch has no identity**, so a client cannot tell which change sent it.
- **There is no `$private`.** The code marks private state with `privatePaths` (`juris.js:156`:
  `$async`, `$server` and the app's own), which `serializeState` strips (`juris.js:847-853`). The
  kernel takes no `privatePaths`, so its private roots are those two.

## Goals and non-goals

**Goals.**

- The nine insights, in three phases.
- One documented, versioned protocol, which is the extension's only access to a page and is held by
  tests like the rest of the contract.
- With devMode off: nothing on `window`, no byte downloaded, no work done.
- A budget for devMode's own overhead, and a way to measure it.
- A panel built with Juris, from plain modules, with no build step.

**Non-goals.**

- **Debugging production.** With devMode off, Juris gives the panel nothing. The one view that
  still works is "Builds", from what the browser itself records (**D15**).
- **Writing from the panel.** The first version is read-only (open question 3).
- **Profiling the browser's own work.** The timeline ends at the DOM write and the next animation
  frame. Layout and paint belong to Chrome's Performance panel.
- **Other browsers' extensions.** The protocol is the same in any browser. The extension is
  Chrome's.
- **Monitoring the server.** The dev channel exists in development only. An app's own SQL and call
  statistics stay the app's.
- **Inspecting a server instance.** It renders every request on one shared instance, and nothing
  about it is per page.
- **Replacing `$juris[n]`.** It stays as the console's shortcut. It is not the protocol.

## The security model

| Rule | How it is kept | What holds it |
| --- | --- | --- |
| devMode only | `Devtools` refuses an instance without `devMode` with a `TypeError`. `hydrate` imports `devtools.js` only when the page's instance is in devMode | `juris-tests/tests/juris/devtools.test.mjs`: "the feature refuses an instance without devMode" |
| Never on a server instance | `Devtools` refuses `isServer`, and the registry is never defined there (as `juris.js:216`). The kernel never gives its instance the feature | "the feature refuses a server instance", and a kit test that the kernel's instance has no `devtools` |
| Nothing exposed, nothing spent, with devMode off | No module imports `devtools.js` statically. Instrumentation replaces methods on the instance, never on a prototype (**D5**). Three things do run with devMode off, and nothing else: one more argument when a binding is created, one property read (`juris.devtools`) per live patch received, and one per event stream opened | `juris/tests/boundary.test.mjs`: "nothing a browser runs imports devtools.js statically" (modelled on its `:92`). `juris/tests/core.test.mjs`: "with devMode off, hydrate imports no devtools.js and exposes nothing", which checks that no `__JURIS_DEVTOOLS__` or `$juris` exists, that no `juris:devtools` event fired, and that `stateManager` and `renderer` have no own `run`, `guard`, `stamp`, `tryCapture`, `resubscribe`, `bindState` or `mount`, using a `node:module` resolve hook that records every module the boot imports |
| Nothing leaves the page unless a panel asks | The page side sends nothing on its own: no request, no `postMessage`. The registry's one event stays on `window`. Data leaves only as the answer to a request the panel evaluates in the page, and the only network request the page side makes is a request-driven `GET` to its own origin (the render record, `/version`) | "a connection that asks nothing receives nothing", and a test that the feature calls no `fetch` until `server` or `builds` is asked |
| The server's dev channel only with `dev: true` | `#juris-dev`, `/__juris/`, the `dev` field on patches and `event: devtools` exist only when the kernel is in development. An app-built handler that says `dev` is refused outside development, as `devReload` is (`kernel.js:695`) | `juris-kit/tests/server.test.mjs`: "with dev: false a page carries no #juris-dev, /__juris/ is a page like any other, and a patch is byte for byte today's" |
| No private state from the server | The render record lists no path under a private root: it gives each such root and a count (**D14**). It carries no state values at all, since the page already carries what it may (`#state`) | "the render record counts the paths under $server and never lists them" |
| No service internals | The channel carries service and query names, the call keys the page already carries (`$ssr.calls`), durations and outcomes. It never carries a service's arguments beyond those keys, a result beyond the patch the stream already carries, a context (`client.ctx`, `service-dispatcher.js:561`), an owner (`identify`), a caller key (an address, `clientKey`), another client's id, or SQL | "a patch's dev field names services and traces and nothing else" |
| No error details that `exposeError` hides | Every failure the channel names is in `publicMessage(error, exposeError)` (`errors.js`), as the page's `$error` (`juris.js:837`) and a failed re-run (`service-dispatcher.js:634`) already are, even in development. The original goes to `onError`, as today | "a preload failing with a secret message reads 'request failed' in the render record" |
| The panel treats the page's data as data | The panel is a Juris app: text is always escaped, `innerHTML` stays refused, and a URL from data passes `safeUrl`. The strings it evaluates in the page are fixed templates whose arguments are `JSON.stringify`ed | Panel test: "a hostile string from the page is drawn as text" |

**What the page side exposes to the page itself.** The registry is on `window`, so any script in
the page can call it. It exposes nothing that `window.$juris[n]` does not already expose in devMode
(the whole instance). The client's whole state may be read, `$async` included: it is the browser's
own bookkeeping, and nothing of `$server` ever reaches a browser.

**What "development only" rules out.** The render trace, the cache decision and the server's half
of the live chain cannot be examined for a production page or a production incident. A QA server
run with `PROD=1` has none of it. A QA server run in development mode has all of it, for anyone who
can load its pages. Each render record is reachable only by its unguessable id, which only that
page carries, and live dev fields go only on streams the dispatcher already binds to their owner.
So a QA server in development mode tells nobody more than the page they can already read, plus the
names of the services whose changes reach the queries that page watches.

## The contract

**Moved to REFERENCE.md, "`devtools.js`", as phase 1 built it** (with the page contract's
`#juris-dev`, `hydrate`'s `devMode`, `juris.refused`, the renderer's labels, the kernel's `dev` and
`renderDocument`'s `jurisDev` in their own sections). REFERENCE.md is the contract from here on;
this file stays the design, and keeps below what phases 2 and 3 still have to build, as proposed.

**Where phase 1 differs from what was proposed here**, each now in REFERENCE.md:

- **Instrumentation.** The feature also replaces the state manager's `compute` (a computed's path
  is known only there) and `affected` (a pass's changed paths, round by round, which `wokeBy` needs
  before the bindings run). It does not wrap a binding's apply: a closure per binding cost about 100
  bytes, half the budget. So `applied` and `pending` are read from what the resolver answered
  (`tryCapture`), and a ran entry's `applyMs` is the callback's time less its read, not the DOM write
  timed alone. A node's bindings are found by going through the live records when asked, with no
  map from element to bindings (about 30 bytes more per binding). Measured: about 190 bytes per
  binding.
- **The renderer's labels.** `bindState(resolver, applyValue, target, key, part)`: a seat or a root
  is labelled with a symbol (its description, `"seat"` or `"root"`, is what the feature reads) and
  passes the node it draws into, or its getter, as `part`, since a seat's `target` is its parent.
  The eleven call sites are the ones listed, through `bindProperty` and `bindChain`.
- **`refused`** is built, and both renderers call it inside their `devMode` checks with today's console
  lines; the feature does not replace it until phase 2, and `rule` is `null` but for
  `"layout-in-value"` until `html-safety.js` answers codes.
- **The protocol, beyond what was proposed:** `drain` answers `more: true` when events are left
  queued, and `{ events: [], dropped: 0, closed: true }` on a connection that is not open; the error
  code `failed` (anything else that threw while answering); the registry's `register({ id,
  endpoint, describe })`, how a second copy of the module registers; the endpoint's `node(handle)`,
  the node itself for `inspect()`; `hello`'s `privateRoots`; `component { id, path, depth, from,
  count }` for props deeper than they were sent; an object's keys paged with `from` and `count` as an
  array's items are; `state`'s `count` at most 1,000; and the value shapes `{ "$": "private", count }`
  and `{ "$": "object", entries }`, and `{ root, count }` in place of private paths.
- **Shapes made precise:** `depth` counts the levels listed (an object or array `depth` levels below
  the value asked for is `more`); a truncated object's `more` is under the key `"…"`; a node handle's
  `id` may be `null`; a ran entry's `binding` may be `null` (a plain subscriber) and its `error` is
  `{ name, message }`; a binding's `passes` are Pass summaries; a pass's `writes` are in the order
  `observe` tells them, the write that caused the pass last; `picked` ends the pick.
- **Not in phase 1:** `call` is not recorded (insight 7), `mount` keeps no server nodes (insight 5),
  and `refusals`, `hydration`, `live`, `server` and `builds` answer `unknown-method`, with `hello`'s
  `topics` listing `tree` and `timeline` only. `#juris-dev` is `{}`, so `hello`'s `dev` is `{ render:
  null }`. `$juris` indexes: `juris.js` now skips one another copy of the core took.

**What phases 2 and 3 add**, as proposed (the names and shapes are the design's until built):

| Method | Params | Result | Phase |
| --- | --- | --- | --- |
| `refusals` | | `[Refusal]`, the last 500 | 2 |
| `hydration` | | `Hydration`, or `null` before the first mount | 2 |
| `live` | | `[{ key, name, args: Value, paths, status }]`, the live client's subscriptions | 3 |
| `server` | | `{ requested: true }`. Fetches this page's render record (`#juris-dev`'s `render`), sent as `server`. `no-dev-channel` when the page carries none | 3 |
| `builds` | `{ version = false }` | `Builds`. With `version`, also `GET /version`, sent as `builds` | 3 |

Topics `refusals` (2) and `live` (3). Events `refusal` (`Refusal`), `live` (`LiveEvent`), `server`
(the render record, or `{ error: "gone" }` or `{ error: "failed" }`) and `builds` (`{ version: {
build, codeId } }`, or `{ error }`). A pass's cause `{ kind: "live", key, trace }`. The error code
`no-dev-channel`.

| Shape | Fields |
| --- | --- |
| `Refusal` | `{ rule, reason, name, value, node, component, side }`. `rule` is the code `html-safety.js` answers, or `"layout-in-value"`. `reason` is its text. `name` is the tag, attribute or style key. `value` is the refused value at depth 0. `node` is the element it was on, or the empty text node a refused tag leaves. `side` is `"client"`, or `"server"` in a render record |
| `Hydration` | `{ at, ms, matched, compared: { elements, texts }, differences, skipped, beforeMount }`. `differences` holds the first 50 `{ kind, where, server, client, node, component }`, where `kind` is `"tag"`, `"attribute"`, `"property"`, `"text"`, `"missing"` or `"extra"`. `skipped` lists the client-only components (`<!--juris:client Name-->`). `beforeMount` says whether `hydrate`'s `beforeMount` ran, and with it a difference may be intended |
| `LiveEvent` | `{ kind, key, status, full, set, del, bytes, trace, by, remote, rerunMs, pass }`. `kind` is `"subscribe"`, `"unsubscribe"`, `"patch"`, `"status"` or `"rerun"` (a server re-run that changed nothing). The fields from `trace` on are the server's `dev` (development only) |
| `Builds` | `{ page, modules, codeIds, mixed, full }`. `page` is the code id of the entry the loader imported. `modules` lists `{ url, codeId }` for every module the page loaded. `codeIds` maps each code id to a count. `mixed` is true when there is more than one. `full` is true when the browser's resource buffer filled, so some may be missing |

**Changes to other sections, still to make.**

- `html-safety.js`: `checkTag`, `checkAttribute`, `checkInnerHTML` and `checkStyle` answer `rule`
  beside `reason` (D11): `checkTag`: `tag-name` (a tag from data) or `tag`; `checkInnerHTML`:
  `inner-html`; `checkStyle`: `style-key` or `style-value`; `checkAttribute`: `attribute-name`,
  `attribute-document` (`srcdoc`) or `url-scheme`. The codes are names a program matches, and they
  never change. The renderers already pass `check.rule` to `refused`.
- The feature replaces `refused` (keeping the last 500) and, while `timeline` is subscribed, `call`;
  its `mount` compares the server's markup with the first client draw (insight 5).
- `remote-services.js`: the live client tells the feature of each patch before it applies it, and
  of each `devtools` event (development only), when the instance has one.
- `juris.js`, for the kit: `renderRequest({ timings: true })` answers `timings`, `{ [call key]: ms
  }`, beside `trace`, and the string renderer, tracing, records its refusals in the trace's
  `refused`. The kernel asks for both in development only.
- `server/kernel.js`, in development only: `#juris-dev` is `{ "render": "<id>" }`, `GET
  /__juris/render/<id>` answers that render's record ("The server's dev channel"), and the kernel
  gives the dispatcher it builds `dev: true`. In every mode: `/version` answers `{ build, codeId }`.
- `server/service-dispatcher.js`: `dev: true` puts a `dev` field on every patch and sends
  `event: devtools` for a re-run that changed nothing.

## The nine insights

Each insight is written as: where its data comes from today; what has to be added, all of it in
`devtools.js` unless named, with its cost; and its shape.

### 1. Why did this element change?

**Today.**

- A binding is `bindState`'s `refresh` closure (`juris.js:985-1029`). Its reads are captured by
  `tryCapture` (`state-manager.js:608-619`), through tracking proxies that record leaf paths
  (`:155-204`), and are subscribed by `resubscribe` (`:648-656`) into `subscribers` (`:99`) and the
  trie (`:658-681`).
- `affected` (`:759-791`) answers which callbacks a write wakes: the trie's subtree, `EXACT` for
  shape changes (`:257-269`), and a scan of the wildcards.
- The renderer makes bindings for properties (`dom-renderer.js:780-789`, from
  `applyProperties` `:1123-1179`), `children` (`:1570-1588`), seats (`createSlot` `:470-493`,
  through `bindChain` `:503-521`), component roots (`:1526`) and adopted roots (`:1082`).
- None of these records what a binding draws.

**To add.**

- **Labels.** The renderer passes the key where it makes a binding (the eleven call sites listed
  under "Changes to other sections"). This is one of the three things that run with devMode off
  ("The security model"): one more argument when a binding is created, a string the layout already
  holds, and nothing per run.
- **A record per binding.** The feature's `bindState` puts the label, its target (an element, or
  the getter a seat or a root keeps), and the owner in a pending slot. The feature's `stamp`, which
  runs before the first run (`juris.js:1018`), attaches it to the `refresh` (`WeakMap`) and to its
  element (`WeakMap` element to `Set`). Seats and roots go in a `Set`, matched by their current
  node when asked. Disposing a binding removes it.
  - **Cost:** about 150 bytes per binding. A large real app's object list after five pages has
    about 1,800 bindings and 500 component instances, so about 270 KB.
- **Reads are not copied.** `node` and `binding` invert `subscribers` when asked (**D7**): about
  2,000 bindings with three reads each, once per click.
- **The last cause.** The feature's `run` keeps each pass's summary (its changed paths, and its
  cause) in a ring of 200. The binding's apply wrapper sets `lastPass`. So "why did this change"
  answers for the last change even when the panel opened after it.
- **Path to bindings** is `wakes`, over `affected`. It is read-only, and it exists already.

**Shape.** `node` → `{ node, roots, owner, bindings: [Binding], lastPass }`. The Elements panel's
sidebar draws it for `$0`: "`href` (property, of `Link` #212) reads `$route.path`,
`nav.items.3.to`; last applied in pass 812, caused by a click on `button`, which wrote
`nav.items.3.to`."

### 2. From a write to the pixels

**Today.**

- `observe` tells each write, at the write (`state-manager.js:336-378`). Inside `batch`, the
  subscribers wait until the outermost batch ends (`:728-736`).
- `run` (`:811-845`) settles the computeds first, then runs each woken binding once, in creation
  order. Every callback goes through `guard` (`:803-809`).
- Nothing times any of it, and nothing says which write woke what.

**To add** (only while `timeline` is subscribed: **D6**):

- `observe` collects the writes made since the last pass, with values at depth 1.
- The feature's `run` opens a pass and closes it.
- Its `guard` times each callback.
- Its `tryCapture` times the resolver's read, and the renderer's apply wrapper times the DOM
  write.
- Its `resubscribe` computes `wokeBy`: it is handed the binding's previous reads, which are exactly
  what could have woken it, and intersects them with the pass's changed paths. No set is kept.
- One `requestAnimationFrame` per frame marks when the frame after the pass came.
- The cause is read at the pass's start:
  - a patch, which the live client said it was applying;
  - a DOM event (`globalThis.event`, set while one is dispatched);
  - `clearState` (the path `""`);
  - otherwise `other`.

**Cost**, while recording: two `performance.now()` calls per callback, one array push per write,
and nothing per write beyond the first 50 values.

**Realism.**

- A live answer in a large real app can be 8 MB. `assign` writes it leaf by leaf when the
  array's length is unchanged (`juris.js:653-676`), so one patch can be tens of thousands of
  writes. They are counted, and only the first 50 are kept.
- A large real app has a component that is one function rebuilding a whole screen. The timeline
  shows it as one `root` binding whose `applyMs` is the redraw, which is the insight wanted there.

**Shape.** `Pass` ("The contract").

### 3. The component tree, live

**Today.**

- `track` and `untrack` (`component-manager.js:55-75`) build the tree, and `snapshot`
  (`:85-99`) reads props and local state raw.
- The tree is flushed whole after each outermost draw (`dom-renderer.js:249`).
- Node to instances is `componentInstances` (`dom-renderer.js:186`), already public
  (`juris.js:1137`).

**To add.**

- `tree` and the `tree` topic send `TreeNode`s: ids, names and handles, no props. They are
  coalesced to one per frame, from `onTreeChange`.
- `component` sends one instance's props and local state as `Value`s, when it is selected.
- `node`, `pick` and `highlight` walk up from a node to the first one `componentInstances` holds.
- The outline is drawn by the page side, in a closed shadow root on a host appended to
  `document.documentElement`, outside the root Juris draws into, so no layout ever sees it.
- **Cost:** nothing beyond devMode's tree, until a connection subscribes.
- **Realism:** about 500 instances in a large real app's object list after five pages, so a `tree`
  message of about 30 KB, sent at most once per frame.

**Shape.** `TreeNode`, `Component`.

### 4. What Juris refused on this page

**Today.**

- Each refusal site warns inside `if (this.devMode)`: `dom-renderer.js:710`, `:740`, `:794`,
  `:1141`, `:1659`; `server/ssr-renderer.js:207`, `:228`, `:304`, `:328`, `:360`, `:364`, `:443`.
- The reason text comes from `html-safety.js`, and it carries the value, cut to 40 or 60
  characters (`:79`, `:147`, `:226`).

**To add.**

- `rule` codes in `html-safety.js` (**D11**). Each site calls `this.juris.refused(rule, reason, {
  name, value, node, component: this.owner })` in place of `console.warn`.
- The feature keeps the last 500 refusals.
- The server's own refusals (the `<style>` text rules, `ssr-renderer.js:360-364`, which only the
  server applies) reach the render record in phase 3.
- Since the client draws every layout again at mount, under the same rules, its list covers the
  page.
- **Cost** with devMode off: none, since it sits inside the existing check. In devMode: one object
  per refusal.

**Shape.** `Refusal`.

### 5. Hydration parity

**Today.**

- `hydrate` mounts at step 8 (`client.js:230`). `mount` draws a fresh tree and then replaces the
  server's markup (`dom-renderer.js:1698-1710`); it does not adopt it. So parity is a comparison of
  two trees, and both exist for a moment.

**To add.**

- The feature's `mount`, on its first call into a target that holds server markup, keeps the
  server's nodes as they are taken off. Once the new tree is in, it compares the two and keeps the
  result, then lets the old nodes go.
- devMode's console says, once, how many differences there were and where the first one is
  (open question 6).
- The comparison follows the two renderers' known differences:
  - `<!--juris:client Name-->` (`server/ssr-renderer.js:238`) stands for that component's subtree,
    which is skipped.
  - Empty text nodes are ignored: the client draws one for an empty seat or a refused tag
    (`dom-renderer.js:1660`), and the server writes nothing.
  - Adjacent text nodes are joined, since the parser joins them.
  - `data-key` is ignored: the server writes it (`ssr-renderer.js:290`), and the client keeps keys
    in a `WeakMap` (`dom-renderer.js:1670`).
  - `value`, `checked` and `selected` are compared as properties: the server writes attributes
    (`ssr-renderer.js:336-347`), and the client sets properties (`dom-renderer.js:764-777`).
  - `class` is compared as a set of tokens, and `style` as a set of declarations.
  - `!important` is reported as the known difference ("Open").
- **Cost:** one walk of both trees, once per page in devMode, timed in the result.

**Shape.** `Hydration`.

### 6. The server's view of this page

**Today.**

- The trace exists for every page (`kernel.js:197`, `:230`), and the cache's decision is made after
  the document is written (`kernel.js:252`).
- Nothing reaches the page but `#state`, which still holds `$ssr.calls` (released from the state
  after mount, `juris.js:808-810`, but the script stays in the document).

**To add (phase 3).**

- The page side already lists the preloads from `$ssr.calls` (phase 1).
- The kit adds the render record ("The server's dev channel"), fetched by `server`.
- **Cost:** in development, a record of about 2 to 20 KB per render, the last 200 kept. Nothing in
  production.

**Shape.** The render record, below.

### 7. The live-query chain

**Today.**

- A service succeeds → `touch(name)` (`service-dispatcher.js:759-772`, run after the answer is
  sent, `:1092`) → `invalidate(targets)` (`:713-753`), which tells `onInvalidate`, publishes to
  the bus, and matches the groups → `refresh` (`:655-678`), which coalesces through `dirty` →
  `refreshOnce` (`:623-654`) runs the query and diffs → `broadcast` → `emit`.
- A bus delivery enters at `:1100-1107` as `invalidate(list, { local: true })`.
- The client batches each patch (`remote-services.js:367-376`).
- No identity crosses any of these steps.

**To add (phase 3).**

- `invalidate` mints a trace id and records its source: the service, `invalidate`, or the bus.
- `refresh` merges the traces of re-runs it coalesces, and `refreshOnce` times the run.
- With `dev: true`, a patch carries `dev: { trace: [id], by: [name], remote, ms, waited }`, and a
  re-run that changed nothing sends `event: devtools` with `{ key, trace, by, remote, ms, outcome:
  "unchanged" }` to the group's streams.
- The client's `applyPatch` ignores the field (it destructures `{ key, full, set, del, error }`,
  `:354`). The feature records it, and the pass the patch caused takes it as its cause. So the
  chain is one line in the panel:

  > `orders.save` (from this tab, 14:02:11.204) → `orders.list:[{"line":3}]` re-ran on this
  > instance in 38 ms → patch: 2 set, 0 del → pass 1031: 4 bindings, 3.1 ms.

- "From this tab" is the last call of that service in the timeline (the feature records `juris.call`
  while `timeline` is on). A patch whose service this tab did not call came from elsewhere
  (**D13**).
- **Cost:** in development, a counter and a timestamp per invalidation, and about 80 bytes per
  patch. In production the dispatcher has no `dev`, and the payload is the same bytes as today.
- **Realism:** a large real app declares 29 live queries with `strictQueries`, and every service
  declares `touches`, so every chain is explicit. Its bus runs only with `BUS=1`.

**Shape.** `LiveEvent`.

### 8. Mixed builds

**Today.**

- Every module URL carries the code id (`modules.js:402`, `:431`), and the loader imports the entry
  under the code id of the build that wrote the page (`document.js:180`).
- `/version` names the build only.
- The browser records every URL it loaded, in Resource Timing.

**To add.**

- `builds` reads `performance.getEntriesByType("resource")` and the loader's text.
- The feature raises the buffer to 2,000 entries (`performance.setResourceTimingBufferSize`) when
  it installs.
- `/version` answers `codeId` too (**D16**).
- Without devMode the panel runs the same read itself, through a fixed read-only expression
  (**D15**), so a production tab mid-deploy can be checked. It reads URLs, nothing else.
- **Cost:** none until asked.

**Shape.** `Builds`, which reads, for example: "the page was written by `a1b2`; 31 modules came
from `a1b2`, and 2 from `c3d4` (`/src/router.js`, `/app/client/records.js`); the server now
answers build `b42`, code id `c3d4`."

### 9. Open in editor

**Today.**

- The VS Code extension indexes every `registerComponent` with a literal name:
  `components()` → `Map name → [{ name, kind, props, location, definition }]`
  (`juris-vscode/src/README.md:171`). A large real app's 131 registrations all use literal names.
- The extension has no URI handler (`extension.js`), and its publisher id is `jurisjs`
  (`package.json:6`).

**What a bridge needs.**

- **In Chrome, with nothing new:** `inspect(__JURIS_DEVTOOLS__.get(id).definition("Home"))`
  through `inspectedWindow.eval` opens the definition in the Sources panel (**D17**).
- **For VS Code:**
  - an `onUri` activation and `vscode.window.registerUriHandler` in `juris-vscode`, answering
    `vscode://jurisjs.juris-vscode/component?name=<Name>`;
  - a lookup in `components()`, with a quick pick when there are several definitions (two suites,
    say);
  - opening the `definition` location, and nothing else: no command run, no file outside the
    workspace.

  VS Code asks the person before it follows such a link from a browser. The panel knows only the
  name, which is enough for literal names. A component registered under a computed name cannot be
  found this way.

## The server's dev channel

**How it rides.** It uses two paths that exist already (**D12**, **D13**).

1. **A per-page record, fetched on request**, answered in the kernel's development slot, where
   `/__reload` is answered (`kernel.js:788`, step 4 of the order): `GET /__juris/render/<id>`,
   JSON, `no-store`. The page learns its id from `#juris-dev`. It is not embedded in the page,
   because the cache's decision is made after the document is written (`kernel.js:252`), and
   because a page nobody inspects should not carry a trace of thousands of paths. It does not ride
   `/__reload`, because that stream is a broadcast with no notion of which page is which
   (`dev-reload.js:169-177`), and because `devReload` is optional.
2. **The live chain, on the live event stream itself**, as a `dev` field on patches and an
   `event: devtools` line. That stream is the client's own, bound to its owner, and ordered with
   the patches, so the chain arrives in order with no second connection. A browser's live client
   ignores an event it has no listener for.

**What the record holds.**

| Field | |
| --- | --- |
| `protocol`, `id`, `at` | `1`, the render's id, when it was rendered |
| `path`, `route` | The canonical path, and `{ name, notFound }` |
| `status`, `guest` | 200 or 404, and whether it was rendered for nobody. Never who the viewer was |
| `ms` | `{ preload, render, total }`, and `calls[].ms` per preloaded call (timed in `preload`, `juris.js:822-842`, when the kernel asks for timings, in development only) |
| `calls` | `[{ key, service, ok, ms, message }]`, with `message` the words the page carries for a failure |
| `trace` | `renderTrace()`'s fields, plus `failed`. `paths` lists every path except those under a private root, which appear as `{ root, count }` |
| `cache` | The pipeline's decision `{ cache, reason, forever, services }`, or `{ asked: false, reason }` for a viewer's or personal page, or with no cache |
| `wouldDecide` | With no cache, what `decide(trace, { viewer, status })` would have said: "with a cache, this page would be kept until `orders.list` or `nav.menu` changes" |
| `document` | `{ bytes, stateBytes }` |
| `refused` | The server's own refusals, as `Refusal`s with `side: "server"` (the string renderer records them while tracing, in development) |

**When.**

- `#juris-dev` goes into every page rendered in development.
- The record is kept for the last 200 renders in the process. An evicted id answers 404, and the
  panel says "the server keeps the last 200 renders; reload the page".
- The `dev` field and `event: devtools` are sent, in development, on every stream: their cost is
  bytes on a local connection.
- A cached page in development carries the id of the render that made its bytes, and the panel says
  so.

**What it never sends** is in "The security model". **What it rules out** is too.

**Across instances.** A re-run applied from the bus says `remote: true`, under the receiving
instance's own trace id. The publishing instance's id does not cross: the bus payload `{ o, t }`
is a name both builds share (REFERENCE, "The buses' names"), and carrying a trace in it is a wire
change (open question 5).

## The Chrome extension

**Its parts (MV3).**

| File | What it is |
| --- | --- |
| `manifest.json` | `manifest_version: 3`, `devtools_page`, and no `permissions`, no `host_permissions`, no `content_scripts`, no `background` |
| `devtools.html`, `devtools.js` | Creates the "Juris" panel, and a "Juris" sidebar pane in the Elements panel |
| `panel.html` | `<script type="module" src="panel/main.js">` and a root element |
| `panel/*.js` | The panel, a Juris app: `new Juris({ … })` and `mount`, drawn from `vendor/juris/*.js` |
| `panel/page.js` | The transport, and the only module that calls `inspectedWindow.eval`. It uses fixed expressions whose arguments are `JSON.stringify`ed |
| `vendor/juris/` | The `juris` package's files, copied by `npm run vendor` (a copy, never a transform), at the version `package.json` pins |

**The parts the brief lists, and why three of them are absent (D4).**

- **The injected main-world script** is Juris's own `devtools.js`, which the app's own server
  already serves into the page. The extension injects nothing.
- **A content script** and **a service worker** would be needed for two things only: injecting at
  `document_start`, which Juris's own buffers make unnecessary, and pushing events, which polling
  replaces. Without them the extension needs no host permission, runs nothing in any page until
  DevTools is open on it, and can reach no tab but the one being inspected.
- If polling proves too slow, the fallback carries the same protocol unchanged:
  - a `world: "MAIN"` script that drains and posts with `window.postMessage`;
  - an isolated content script that forwards to a `runtime` port;
  - the service worker, pairing ports by tab;
  - `host_permissions` for `http://localhost/*` and `http://127.0.0.1/*`, and optional ones per
    site.

**Message flow.**

```
panel (Juris app) ── page.js ── inspectedWindow.eval('__JURIS_DEVTOOLS__.get(1).request("c1","node",{"node":{"$":"node","ref":7}})')
                                        │
                                        ▼  (main world of the inspected tab)
                              devtools.js endpoint ── answers JSON synchronously
panel ◀── result ── page.js ── setValue("inspect.node", result) ── the panel redraws
```

- While the panel is shown (`panel.onShown`), `page.js` drains every 100 ms. It stops on
  `onHidden`.
- On `chrome.devtools.network.onNavigated`, it reconnects.
- On `elements.onSelectionChanged`, the sidebar pane asks `node` for `$0`.
- "Reveal" calls `inspect(node)` (the Elements panel) or `inspect(definition)` (the Sources panel).

**The panel built with Juris.**

- Plain modules, with no build step: MV3 loads `panel/main.js` and its imports as they are.
- MV3's extension-page policy (`script-src 'self'`) allows no `eval` and no inline script. No
  module of the `juris` package uses `eval`, `new Function`, string timers or `import()` of a computed
  specifier (checked), and `panel.html` has no inline script.
- Juris sets style through the CSSOM (`dom-renderer.js:702-728`), and MV3's default policy for
  extension pages restricts no style anyway.
- The panel uses the core alone, with no `client.js`, router or live client.
- Its views are: Components (tree and inspector), Element (insight 1), State (lazy, by path),
  Timeline, Refusals, Hydration, Server, Live, and Builds.

**Detecting the page.** On open, and after each navigation, the panel evaluates one fixed read-only
expression: the registry's `registry` and `list()`, whether a `#state` and a `#juris-dev` JSON
script exist, and the module URLs in Resource Timing.

| Found | The panel says |
| --- | --- |
| No registry, no `#state`, no `/src/juris.js?v=` | "This page does not run Juris." |
| `#state` or `/src/juris.js`, no registry | "This page runs Juris with devMode off: Juris exposes nothing. In development, the kit turns it on; elsewhere, `hydrate({ devMode: true })`." Builds stays available |
| `#juris-dev`, no registry yet | "Booting…", then waiting for `juris:devtools`. After the page's `load` and 10 s, "the page did not boot: its code did not load, or it failed (see the console)" |
| A registry with no protocol this extension speaks | "This page speaks protocol N; this extension speaks 1 to M. Update the extension." |
| Two or more instances | A picker. A second copy of the core is also flagged in Builds |

## Tests

**The Juris hooks.** Each starts as a failing test, in the suite the boundary names: the package's
own `tests/` (`core`, `render`, `boundary`; and the kit's `server`) for the rule, and
`juris-tests` for the full coverage, which must stay at 99%.

| Hook | First failing test |
| --- | --- |
| `hydrate`'s `devMode` | `juris/tests/core.test.mjs`: "hydrate follows #juris-dev, and devMode: false overrides it"; "hydrate refuses a devMode that is not a boolean" (beside `juris-tests/tests/juris/client.test.mjs:60`) |
| Off means nothing | `core.test.mjs`: "with devMode off, hydrate imports no devtools.js and exposes nothing" (see "The security model"); `boundary.test.mjs`: "nothing a browser runs imports devtools.js statically", and `devtools.js` is held to the floor (`:124`) and to flat imports (`:51`) |
| The feature's refusals | `devtools.test.mjs`: "refuses an instance without devMode, and a server instance" |
| The registry | "two copies register in one registry; each registration dispatches juris:devtools; list() names them" |
| Binding records | `render.test.mjs`: "devMode: each binding is labelled with what it draws" (one case per kind: property, class, style, children, seat, root, computed, other); "a disposed binding leaves the record"; "node answers an element's bindings and their reads"; "wakes answers what affected answers" |
| Instrumentation is removable | `devtools.timeline.test.mjs`: "subscribing to timeline installs observe and timing; the last unsubscribe takes both away" (`stateManager.observers.size` back to 0) |
| A pass | "computeds first, then bindings by creation order"; "wokeBy is the reads the pass changed"; "a cause: an event, a patch, a clear"; "writes past 50 are counted, not kept" |
| Values | `devtools.values.test.mjs`: one case per row of the values table, plus "a read for the panel adds no dependency, even inside a capture" and "a drain over 1 MiB is cut and says so" |
| Refusals | `render.test.mjs`: "each refusal site records its rule, element and component" (beside `juris-tests/tests/juris/attributes.test.mjs:198`); `html-safety.test.mjs`: "every refusal answers its rule" |
| Hydration | `devtools.hydration.test.mjs`, on `client-browser.mjs`'s `fakePage`: "a matching page"; one case per normalisation rule; "a changed attribute, a missing element, an extra text"; "beforeMount is reported" |
| Live | `remote-services` suite: "the feature hears each patch before it is applied, with its dev field"; "with no feature, a patch applies as before" |
| Connections | "a connection not drained for 30 s is closed, and its timeline with it" |
| The kit's dev channel | `juris-kit/tests/server.test.mjs`: "dev: a page carries #juris-dev, and its record answers"; "an unknown id is a 404; the 201st render evicts the first"; "private roots are counted"; "a hidden error stays hidden"; "the record says guest, never who"; "wouldDecide without a cache"; "dev: false: none of it"; "an app-built handler with dev is refused outside development" |
| The dispatcher | `juris-tests/tests/juris-kit/service-dispatcher.*`: "dev: a patch carries its trace and service"; "coalesced re-runs merge traces"; "an unchanged re-run sends event: devtools"; "a bus re-run says remote"; "without dev the payload is today's, byte for byte" |
| `/version` | "answers build and codeId" |

**The extension, without a browser.**

- **The panel** is a Juris app, so it renders in Node on the stand-in DOM
  (`juris-tests/tests/support/dom.mjs`, `dom-renderer-dom.mjs`).
- A fake `chrome.devtools` is given whose `inspectedWindow.eval` evaluates `page.js`'s expression
  with `node:vm`, in a context holding a real page instance (devMode, the feature, the stand-in
  DOM, `fakePage`).
- The whole loop (panel → expression → endpoint → JSON → panel) then runs in one process. The tests
  that run this way:
  - each view for a known page;
  - detection for each row of the detection table;
  - "a hostile string from the page is drawn as text";
  - "the panel stops polling when hidden".
- **`page.js`** is tested so that every expression it builds is one of its templates, with JSON
  arguments.

**What needs a real Chrome**, as a checklist in the extension's README, run before each release:

- the manifest loads, and the panel's modules run under MV3's policy;
- `inspectedWindow.eval` works on a page under a strict policy (`script-src 'self' <hashes>`, no
  `unsafe-eval`), and `$0` and `inspect()` work from it;
- `onNavigated`, `onSelectionChanged`, and the sidebar pane;
- the outline's geometry (scrolling, transforms, `position: fixed`);
- Resource Timing for module scripts, and the buffer's limit;
- `window.event` during dispatch;
- the hydration comparison against a real parser (the stand-in DOM is not a parser: whitespace,
  style serialisation, attribute order);
- the overhead budget on a large real app's object list after five pages.

A script (Playwright, with the unpacked extension) can drive the page side through the same
expressions. The panel itself is checked by a person.

## Phasing

| Phase | What | Size |
| --- | --- | --- |
| **1. The protocol, and the extension's first version** | `hydrate`'s `devMode` and `#juris-dev`; `devtools.js` (the registry, connections, values, binding records, the pass ring, the timeline, the tree, `node`, `wakes`, `state`, `preloads`, `highlight`, `pick`); the renderer's labels; `juris.refused` with today's console lines; the REFERENCE section. Extension: manifest, transport, detection, and the Components, Element, State and Timeline views, with the Elements sidebar | Core about 900 lines (`devtools.js` about 750) and about 45 tests. Extension about 1,800 lines and about 20 tests. About four weeks for one person |
| **2. Refusals and hydration parity** | `html-safety.js`'s `rule` codes; the refusal record; the hydration comparison and its console line; the Refusals and Hydration views | Core about 350 lines and about 30 tests. Extension about 500 lines. About two weeks |
| **3. The server channel, the live chain, mixed builds** | `#juris-dev`'s id; the render record and `/__juris/render/<id>`; preload timings; the server's refusals in the trace; the dispatcher's `dev`; `/version`'s `codeId`; the live client's patch hook; Builds (with and without devMode); the Server, Live and Builds views; the VS Code URI handler (in `juris-vscode`, separately) | Kit about 400 lines and about 30 tests. Core about 80 lines. Extension about 700 lines. About three weeks |

Phase 1 starts with `hydrate`'s `devMode`, since nothing else can be seen without it. It can ship on
its own, and a large real app would see devMode's warnings in development for the first time (open
question 1).

## Open questions

These were real decisions for the author. **All seven were answered as recommended (2026-11-05).**

1. **Should development turn the browser's devMode on by default** (the kernel's `dev` → `#juris-dev`
   → `hydrate`)? **Recommendation: yes,** with `hydrate({ devMode: false })` to say no. Today
   devMode cannot be reached through `hydrate` at all, and an app that never asked would start
   seeing its warnings (and `window.$juris`) in development. Juris reads no environment, and this
   keeps that rule: the switch is the `dev` the app gives the kernel.
2. **Should the devtools code live in the core** (`juris/devtools.js`, served at `/src/`,
   held to the floor and the boundary, versioned with the core), or in a package of its own?
   **Recommendation: the core.** It replaces `stamp`, `run`, `guard`, `tryCapture` and
   `resubscribe`, which only the core can keep honest. A test in the same repository fails the day
   one of them changes shape.
3. **Should the protocol ever write** (edit state or props from the panel)? **Recommendation: not in
   these three phases.** A read-only protocol cannot change what the page does, which keeps "the
   panel only asks" a whole answer. Writing can be a protocol 1 addition later, through `setValue`,
   never through a component's internals.
4. **Should the panel show anything on a page with devMode off?** **Recommendation: Builds only,** from
   the browser's own Resource Timing (URLs, nothing of Juris). It is the one insight whose subject
   (a rolling deploy) happens in production, and it reads nothing Juris exposes.
5. **Should a trace id cross the change bus in development?** It would add a field to the payload
   that both builds read (`{ o, t }`). **Recommendation: no, for now.** A remote re-run is marked
   `remote` and timed on its own instance, which answers "locally or via the bus". Correlating two
   instances is worth a wire change only when someone needs it.
6. **Should a hydration mismatch be a console warning at every devMode boot?** **Recommendation:
   yes,** as one line with the count and the first difference: a parity bug is otherwise invisible
   until someone opens the panel. The comparison is made anyway.
7. **Polling through `inspectedWindow.eval`, or pushing through a content script?**
   **Recommendation: polling.** It needs no host permission and no service worker, and injects
   nothing. Its latency (100 ms at most) suits a panel. The push design is kept as the fallback,
   with the same protocol, if the real-Chrome checks find polling wanting.

## Decisions

Each is marked where it is taken. One line each, for overturning.

| | Decision | Why |
| --- | --- | --- |
| **D1** | `devtools.js` is a feature (`features.devtools`), imported by `hydrate` only in devMode | Nothing is downloaded with it off. It is the mechanism `features.ssr` already uses |
| **D2** | `hydrate` takes `devMode`, and follows `#juris-dev` unless told | devMode is unreachable through `hydrate` today (`client.js:79-80`, `juris.js:44-57`) |
| **D3** | A registry owned by Juris on `window`, plus a `juris:devtools` event. It is not owned by the extension, and it is more than an event | A panel that opens late finds instances without an announcement it missed. The protocol version is the page's. Two copies of the core share one registry |
| **D4** | No content script, service worker or host permission: the panel polls through `inspectedWindow.eval` | Least privilege. Nothing runs in a page until DevTools is open on it |
| **D5** | Instrument by replacing methods on the instance, never with `if (devMode)` on a write's path. What runs with devMode off is one argument at a binding's creation, and one property read per live patch and per stream opened | "Off costs nothing" becomes a property a test can check: the instance's methods are the prototype's |
| **D6** | The binding records, the pass ring, the refusals and the hydration comparison exist from boot. The timeline exists only while subscribed | "Why did this change" must work after the fact. Timing every callback should cost only when watched |
| **D7** | A binding's reads are read from `subscribers` when asked, never copied per run | Zero cost per run |
| **D8** | Value limits: 1,000 characters, 100 items, 200 keys, depth 3 (8 at most), 1 MiB per answer | A large real app holds a 2 MB root and 8 MB live answers |
| **D9** | Read-only protocol | See open question 3 |
| **D10** | Hydration is compared once, at the first mount, eagerly | No server nodes kept alive, and no clone. The comparison costs one walk |
| **D11** | `html-safety.js` answers a stable `rule` beside `reason` | The reason's words may change. A panel, like the live client with `LIVE_CODES`, matches a code |
| **D12** | The render record is fetched by an unguessable id, not embedded | The cache's decision comes after the document (`kernel.js:252`). Pages nobody inspects stay small |
| **D13** | The live chain rides the live stream (a `dev` field, `event: devtools`). No response header links a call to its trace: the panel matches by service name and order | Same owner binding, and same order as the patches. No new connection, and no change to the stubs |
| **D14** | Paths under private roots are counted, never listed, and hidden errors stay hidden, even in development | A path can carry an id (`$server.sessions.<token>`). A QA box in development is still a shared box |
| **D15** | Builds works without devMode, from Resource Timing | Rolling deploys happen in production |
| **D16** | `/version` answers `codeId` | A code id in a URL cannot otherwise be matched to a build. It is in every module URL already |
| **D17** | Open in Sources through `inspect(definition)`. Open in VS Code through a URI handler in `juris-vscode`, with the name as the only key | The first needs nothing new. The second needs nothing from Juris |
| **D18** | The panel vendors the core by copying files | No build step, and the panel runs the files a test ran |
| **D19** | The overhead budget is the "What it costs" table, measured by a bench script and in Chrome, and not asserted in CI | Timing assertions are flaky. Structure, which can be asserted, is |
