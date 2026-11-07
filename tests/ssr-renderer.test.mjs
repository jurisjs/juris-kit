// The string renderer (server/ssr-renderer.js), given to an instance as `features: { ssr }`: what it
// refuses to write, and the rules it shares with the DOM renderer (the juris package's html-safety.js),
// held on its output; and the core's server rendering through it (renderRequest), held on what a
// request renders. These were the juris package's own tests (render.test.mjs, core.test.mjs and
// headless.test.mjs) until the renderer moved here; their DOM halves are still there.
import { test } from "node:test";
import assert from "node:assert/strict";

import Juris from "juris/juris.js";
import { sseClient } from "juris/remote-services.js";
import { HeadlessManager } from "juris/headless.js";
import SSRRenderer from "../server/ssr-renderer.js";

// A server instance that renders to a string: the renderer is the kit's feature.
const server = (options = {}) => new Juris({ isServer: true, ...options, features: { ssr: SSRRenderer, ...options.features } });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Replaces globalThis[name] for the length of `fn`, and puts it back whatever happens.
async function withGlobal(values, fn) {
    const before = {};
    for (const [name, value] of Object.entries(values)) {
        before[name] = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    }
    try {
        return await fn();
    } finally {
        for (const [name, descriptor] of Object.entries(before)) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
}

// Collects console.warn while `fn` runs.
function warnings(fn) {
    const said = [];
    const original = console.warn;
    console.warn = (...args) => said.push(args.map(String).join(" "));
    try {
        fn();
    } finally {
        console.warn = original;
    }
    return said;
}

const PAYLOAD = '<img src=x onerror="alert(1)">';

// ---- F1: innerHTML ---------------------------------------------------------------------------

test("F1 SSR: innerHTML is left out by default, wherever the layout carries it", () => {
    const juris = server();
    assert.equal(juris.renderToString({ p: { innerHTML: PAYLOAD } }), "<p></p>");
    // a row that lands in a child position, and one spread into props
    const row = { p: { innerHTML: PAYLOAD } };
    assert.equal(juris.renderToString({ div: { children: [row] } }), "<div><p></p></div>");
    assert.equal(juris.renderToString({ section: { ...row.p, className: "x" } }), '<section class="x"></section>');
    // a reactive value, and through a component that forwards ...rest (Await)
    assert.equal(juris.renderToString({ p: { innerHTML: () => PAYLOAD } }), "<p></p>");
    const html = juris.renderToString({ Await: { group: "g", tag: "div", innerHTML: PAYLOAD, children: [] } });
    assert.ok(!html.includes("<img"), html);
    assert.ok(!juris.api.renderToString({ p: { innerHTML: PAYLOAD } }).includes("<img"));
});

test("F1 SSR: the refusal is named on the console in devMode", () => {
    const juris = server({ devMode: true });
    const said = warnings(() => juris.renderToString({ p: { innerHTML: PAYLOAD } }));
    assert.ok(said.some((line) => /innerHTML/.test(line)), said.join("\n"));
});

test("F1 SSR: allowInnerHTML draws it as given", () => {
    const juris = server();
    juris.allowInnerHTML = true;
    assert.equal(juris.renderToString({ p: { innerHTML: "<b>bold</b>" } }), "<p><b>bold</b></p>");
});

// ---- F2: plaintext and style -----------------------------------------------------------------

test("F2 SSR: plaintext and style are left out, in HTML and in SVG", () => {
    const juris = server();
    assert.equal(juris.renderToString({ div: { children: [{ plaintext: "x" }, { p: "after" }] } }), "<div><p>after</p></div>");
    assert.equal(juris.renderToString({ style: "body{display:none}" }), "");
    assert.equal(juris.renderToString({ svg: { children: [{ style: "*{fill:red}" }] } }), "<svg></svg>");
});

// ---- F3: style objects -----------------------------------------------------------------------

test("F3 SSR: a style object writes only what the rule allows", () => {
    const juris = server();
    const html = juris.renderToString({
        div: { style: { color: "red;background:url(//evil)", "x;y": "1", cssText: "position:fixed", marginTop: 4, "--accent": "blue", opacity: "" } },
    });
    assert.equal(html, '<div style="margin-top:4;--accent:blue"></div>');
    const said = warnings(() => server({ devMode: true }).renderToString({ div: { style: { color: "red;x:y" } } }));
    assert.ok(said.some((line) => /color/.test(line)), said.join("\n"));
});

// ---- F4: classList keys ----------------------------------------------------------------------

test("F4 SSR: classList keys become tokens", () => {
    const html = server().renderToString({ div: { class: "x", classList: { "a b": true, "": true, " c ": true, off: false } } });
    assert.equal(html, '<div class="x a b c"></div>');
});

// ---- lower: style text with allowTags --------------------------------------------------------

test("SSR: an allowed <style> writes its text raw, and is left out if the text would end it", () => {
    const juris = server({ allowTags: ["style"] });
    assert.equal(juris.renderToString({ style: "a > b { color: red }" }), "<style>a > b { color: red }</style>");
    assert.equal(juris.renderToString({ style: { children: ["a > b", () => " {}"] } }), "<style>a > b {}</style>");
    assert.equal(juris.renderToString({ style: "x</STYLE><script>alert(1)</script>" }), "");
    assert.equal(juris.renderToString({ style: { children: ["x</st", "yle>"] } }), "");
    // inside <svg> a <style>'s text is ordinary text to the parser, and stays escaped
    assert.equal(juris.renderToString({ svg: { children: [{ style: "a > b" }] } }), "<svg><style>a &gt; b</style></svg>");
});

// ---- F5: a preloaded answer, or a state root, is the request's own ------------------------------

test("F5: a service's cached answer is never mutated by a render, nor carried into the next", async () => {
    const master = { units: ["kg"], meta: { v: 1 } };
    const juris = server({ services: { master: async () => master } });
    let write = true;
    juris.registerComponent("Page", (props, api) => {
        api.live("m", "master");
        if (write) {
            api.setValue("m.meta.v", 2);
            api.setValue("m.extra", "mutated");
        }
        return { div: () => JSON.stringify(api.getState("m")) };
    });
    const first = await juris.renderRequest({ preload: [["master"]], layout: { Page: {} } });
    assert.match(first.html, /mutated/);
    write = false;
    const second = await juris.renderRequest({ preload: [["master"]], layout: { Page: {} } });
    assert.deepEqual(master, { units: ["kg"], meta: { v: 1 } });
    assert.doesNotMatch(second.json, /mutated/);
    assert.equal(JSON.parse(second.json).m.meta.v, 1);
    assert.deepEqual(second.result("master"), { units: ["kg"], meta: { v: 1 } });
});

test("F5: renderRequest copies the state it is given", async () => {
    const shared = { cfg: { mode: "a", list: [1, 2] } };
    const juris = server();
    juris.registerComponent("Page", (props, api) => {
        api.setValue("cfg.mode", "b");
        api.setValue("cfg.list.0", 9);
        return { p: "x" };
    });
    await juris.renderRequest({ state: shared, layout: { Page: {} } });
    assert.deepEqual(shared, { cfg: { mode: "a", list: [1, 2] } });
});

// ---- F6: an async group belongs to its request ---------------------------------------------------

test("F6: on a server, a group pending in one request does not hold the next one's Await", async () => {
    const juris = server();
    juris.clearState({});
    juris.api.group("panel").track(new Promise(() => { })); // hung, forever
    const { html } = await juris.renderRequest({
        layout: { Await: { group: "panel", fallback: { p: "Loading" }, children: [{ p: "Ready" }] } },
    });
    assert.doesNotMatch(html, /Loading/);
    assert.match(html, /Ready/);
});

// ---- F12: live data says whether it is current ------------------------------------------------------

class FakeEventSource {
    static last = null;
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.listeners = new Map();
        FakeEventSource.last = this;
    }
    addEventListener(type, fn) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    emit(type, data) {
        for (const fn of this.listeners.get(type) ?? []) fn({ data: data === undefined ? undefined : JSON.stringify(data) });
    }
    close() {
        this.readyState = 2;
    }
}

// A client instance with a live client whose subscribes the server answers with `answer(body)`.
async function liveClient(answer = () => ({ ok: true }), fn) {
    const posts = [];
    const fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        posts.push(body);
        const said = answer(body) ?? { ok: true };
        return { ok: said.ok, status: said.status ?? 200, statusText: "", json: async () => said.body ?? {} };
    };
    return withGlobal({ fetch }, async () => {
        const juris = new Juris({ isServer: false, services: { rows: async () => [] } });
        const plugin = sseClient({ EventSourceImpl: FakeEventSource, idleMs: 0, backoff: { minMs: 5, maxMs: 5 } });
        juris.use(plugin);
        try {
            await fn(juris, posts);
        } finally {
            plugin.dispose();
        }
    });
}

test("F12: on a server, a preloaded live path is live; the browser's first render agrees", async () => {
    const juris = server({ services: { rows: async () => [{ id: 1 }] } });
    juris.registerComponent("Page", (props, api) => {
        api.live("rows.list", "rows");
        return { p: () => api.liveState("rows.list") };
    });
    const { html, json } = await juris.renderRequest({ preload: [["rows"]], layout: { Page: {} } });
    assert.match(html, />live</);
    assert.doesNotMatch(json, /"live"/, "the status is not in the page's state");
    // The browser, with its live client, starts from the same transfer.
    await liveClient(undefined, async (client) => {
        client.clearState(JSON.parse(json));
        client.live("rows.list", "rows");
        assert.equal(client.api.liveState("rows.list"), "live");
    });
});

// ---- headless components, drawn on the server ---------------------------------------------------

const Cart = (props, context) => ({
    api: {
        add: (item) => context.setState("cart.items", [...context.getState("cart.items", []), item]),
        count: () => context.getState("cart.items", []).length,
        props: () => props,
    },
});

test("the 0.91 usage: features and headlessComponents, autoInit with its options as props, the api everywhere", () => {
    const juris = server({
        features: { headless: HeadlessManager },
        headlessComponents: { cart: { fn: Cart, options: { autoInit: true, size: 3 } }, idle: Cart },
    });
    assert.ok(juris.headlessManager instanceof HeadlessManager);
    const cart = juris.getHeadlessAPI("cart");
    assert.deepEqual(cart.props(), { autoInit: true, size: 3 });
    cart.add("pen");
    assert.equal(cart.count(), 1);
    assert.equal(juris.api.cart, cart);
    assert.equal(juris.headlessAPIs.cart, cart);
    assert.equal(juris.headlessManager.context.cart, cart);
    assert.equal(juris.getHeadlessAPI("idle"), undefined, "registered without autoInit: not made");
    assert.deepEqual(juris.getHeadlessStatus(), { registered: ["cart", "idle"], initialized: ["cart"], queued: [], apis: ["cart"] });

    juris.registerComponent("Count", (props, api) => ({ p: { textContent: () => `${api.cart.count()} item(s)` } }));
    assert.match(juris.renderToString({ Count: {} }), /1 item\(s\)/);
});

test("refusals: the string renderer's go through juris.refused, which writes the console lines it wrote before", () => {
    const juris = server({ devMode: true, allowTags: ["style"] });
    const told = [];
    juris.refused = (...args) => { told.push(args); return Juris.prototype.refused.apply(juris, args); };
    juris.registerComponent("Card", () => ({ div: { children: [
        { iframe: { src: "/x" } },
        { a: { href: "javascript:alert(1)", style: { color: "red;background:url(x)" }, innerHTML: "<b>x</b>", title: { b: "layout" } } },
        { style: { textContent: "p{}</style>" } },
    ] } }));
    const said = [];
    const warn = console.warn;
    console.warn = (...args) => said.push(args);
    try {
        juris.renderToString({ Card: {} });
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(told.map(([rule, , detail]) => [rule ?? null, detail.name, detail.component?.name]), [
        [null, "iframe", "Card"],
        [null, "href", "Card"],
        [null, "color", "Card"],
        [null, "innerHTML", "Card"],
        ["layout-in-value", "title", "Card"],
        [null, "style", "Card"],
    ]);
    assert.deepEqual(said.map((args) => args[0]), told.map(([rule, reason]) => (rule === "layout-in-value" ? `Juris: ${reason}; ignored` : `Juris: dropped ${reason}`)));
    assert.equal(
        said[4][0],
        'Juris: "title" was given an object, and takes text (a string or a number; a layout goes in children); ignored',
    );
    assert.equal(said[5][0], "Juris: dropped <style>: its text contains </style, which would end the element");
});
