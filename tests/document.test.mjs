// The page's document (server/document.js): what it writes around a rendered page, held on its
// output.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderDocument } from "../server/document.js";

test("document: the loader is not fooled by an element named requestIdleCallback", () => {
    const page = renderDocument({ html: "", json: "{}" }, { entry: "/app.js" });
    const body = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    const timers = [];
    const saved = globalThis.requestIdleCallback;
    globalThis.requestIdleCallback = { id: "requestIdleCallback" }; // what DOM clobbering leaves on window
    try {
        new Function("document", "setTimeout", "addEventListener", body)({ readyState: "complete" }, (fn) => timers.push(fn), () => { });
    } finally {
        if (saved === undefined) delete globalThis.requestIdleCallback; else globalThis.requestIdleCallback = saved;
    }
    assert.equal(timers.length, 1, "boot was scheduled through setTimeout");
});

test("document: a refresh meta's URL is held to the scheme rules", () => {
    const render = (content, name = "http-equiv") => renderDocument({}, { entry: "/app.js", meta: [{ [name]: "refresh", content }] });
    for (const content of ["0;url=javascript:alert(1)", "0; URL='javascript:alert(1)'", "5 javascript:alert(1)", "0,url=\"vbscript:x\"", "0;url=java\tscript:alert(1)", "0;url=data:text/html,<script>"]) {
        assert.throws(() => render(content), /refresh/, content);
        assert.throws(() => render(content, "HTTP-EQUIV"), /refresh/, content);
    }
    assert.throws(() => renderDocument({}, { entry: "/app.js", meta: [{ "http-equiv": "Refresh", CONTENT: "0;url=javascript:x" }] }), /refresh/);
    for (const content of ["30", "0;url=/login", "0; url=https://example.com/next", "1"]) {
        assert.match(render(content), /http-equiv="refresh"/, content);
    }
});

test("document: jurisDev is written as #juris-dev, JSON with < escaped, beside the state; without it, none", () => {
    const page = renderDocument({ html: "", json: "{}" }, { entry: "/app.js", serviceNames: ["a"], jurisDev: { render: "</script><b>" } });
    const script = page.match(/<script type="application\/json" id="juris-dev">([^<]*)<\/script>/);
    assert.ok(script, "#juris-dev is written");
    assert.deepEqual(JSON.parse(script[1]), { render: "</script><b>" });
    assert.ok(page.indexOf('id="services"') < page.indexOf('id="juris-dev"') && page.indexOf('id="juris-dev"') < page.indexOf('<script type="module">'), "after #services, before the loader");
    assert.ok(!/id="juris-dev"/.test(renderDocument({ html: "", json: "{}" }, { entry: "/app.js" })));
    assert.ok(!/id="juris-dev"/.test(renderDocument({ html: "", json: "{}" }, { entry: "/app.js", jurisDev: null })));
    for (const jurisDev of ["{}", [], 1, true]) {
        assert.throws(() => renderDocument({}, { entry: "/app.js", jurisDev }), { name: "TypeError", message: "renderDocument: jurisDev is the page's development data, a plain object written as JSON in #juris-dev, or null for none" }, JSON.stringify(jurisDev));
    }
});
