// Server-side renderer for Juris: the same layouts and components, serialized to an HTML string.
// Every reactive function is evaluated once, untracked: no capture, no subscription, no proxies, no
// listeners. The renderer keeps no node registries at all; the only per-render state is the list of
// component instances it invoked, whose cleanups (including computeds registered during setup) run
// when the render ends.
//
// It is the kit's, Node only, so no browser downloads it. An instance is given it as a feature, and
// it installs itself as the instance's renderer (`juris.ssrRenderer`), which the core's
// renderToString, renderRequest, renderTrace and markRender use; the kit's server does that for its
// own instance (kernel.js):
//
//   const juris = new Juris({ isServer: true, features: { ssr: SSRRenderer } });

import { FallbackSignal } from "juris/errors.js";
import { checkAttribute, checkInnerHTML, checkStyle, checkTag, classTokens } from "juris/html-safety.js";

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// HTML's boolean attributes, as dom-renderer.js keeps them: present or absent on an HTML element, and
// on an SVG or MathML element an attribute like any other, written as given (MathML's `open`).
const BOOLEAN_ATTRIBUTES = new Set([
    "allowfullscreen",
    "alpha",
    "async",
    "autofocus",
    "autoplay",
    "checked",
    "controls",
    "default",
    "defer",
    "disabled",
    "formnovalidate",
    "hidden",
    "inert",
    "ismap",
    "itemscope",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "readonly",
    "required",
    "reversed",
    "selected",
    "shadowrootclonable",
    "shadowrootcustomelementregistry",
    "shadowrootdelegatesfocus",
    "shadowrootserializable",
]);
// `hidden="until-found"` (in any case) is a value of its own, written as given (see dom-renderer.js).
const untilFound = (name, value) => name.toLowerCase() === "hidden" && typeof value === "string" && value.toLowerCase() === "until-found";
const ATTRIBUTE_ALIASES = {
    className: "class",
    htmlFor: "for",
};
const NAMESPACES = {
    math: "http://www.w3.org/1998/Math/MathML",
    svg: "http://www.w3.org/2000/svg",
};
// The HTML parser's integration points, as dom-renderer.js keeps them (the same rule, so what the
// browser parses from this markup is what the client draws): inside SVG's foreignObject, desc and
// title, inside MathML's mi, mo, mn, ms and mtext (but for mglyph and malignmark), and inside an
// annotation-xml whose encoding is text/html or application/xhtml+xml, in any case, the markup is
// HTML again; an annotation-xml of another encoding holds MathML, but for an <svg>. Only the
// namespace passed down changes here (it decides void elements and `value`): the markup is the same.
const HTML_INSIDE_SVG = new Set(["foreignobject", "desc", "title"]);
const TEXT_INSIDE_MATH = new Set(["mi", "mo", "mn", "ms", "mtext"]);
const HTML_ENCODINGS = new Set(["text/html", "application/xhtml+xml"]);
const IN_MATH_TEXT = Symbol("inside a MathML token element");
const IN_ANNOTATION = Symbol("inside an annotation-xml of no HTML encoding");
const elementNamespace = (inherited, lowerTag) => {
    if (inherited === IN_MATH_TEXT) return lowerTag === "mglyph" || lowerTag === "malignmark" ? NAMESPACES.math : NAMESPACES[lowerTag] ?? null;
    if (inherited === IN_ANNOTATION) return lowerTag === "svg" ? NAMESPACES.svg : NAMESPACES.math;
    return inherited || NAMESPACES[lowerTag] || null;
};
const namespaceInside = (namespace, lowerTag, encoding) => {
    if (namespace === NAMESPACES.svg) return HTML_INSIDE_SVG.has(lowerTag) ? null : namespace;
    if (namespace === NAMESPACES.math) {
        if (TEXT_INSIDE_MATH.has(lowerTag)) return IN_MATH_TEXT;
        if (lowerTag === "annotation-xml") return HTML_ENCODINGS.has(String(encoding ?? "").toLowerCase()) ? null : IN_ANNOTATION;
    }
    return namespace;
};
const foreignContext = (inherited) => (inherited === IN_MATH_TEXT ? null : inherited);

export const escapeText = (value) => String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// Both quotes, so the value is safe whichever one the markup around it uses: the renderer writes
// double quotes, but an app's own shell or head may single-quote an attribute.
export const escapeAttribute = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export default class SSRRenderer {
    // Constructed with (juris, config), as every feature is; it needs only the instance.
    constructor(juris) {
        this.juris = juris;
        juris.ssrRenderer = this; // installs itself: the core renders to a string through it
        this.instances = null; // non-null while a render is in progress
        this.owner = null; // the component being rendered (its boundaries get the errors)
        // > 0 while what is inside a <noscript> or a <select> is written, at any depth, where the
        // parser may not read a <style> start tag as one (see element): there a <style>'s raw text
        // could be read as markup.
        this.styleAsMarkup = 0;
    }

    get stateManager() {
        return this.juris.stateManager;
    }

    get componentManager() {
        return this.juris.componentManager;
    }

    get devMode() {
        return this.juris.devMode;
    }

    // ---- entry point -----------------------------------------------------------------

    // Returns the HTML for `layout`. Synchronous: a function that yields a real promise renders as
    // nothing (preload it, or set requirePreload so the miss throws instead). Re-entrancy is refused:
    // the instance is shared, and a render inside a render would tear down the outer one's instances.
    // options.trace: record what the render depended on, readable afterwards as `lastTrace`:
    //   reactive  how many reactive functions ran (0 means the markup is a pure function of the layout)
    //   paths     every state path read through getState or api.peek
    //   calls     every api.call key answered during the render (`name:JSON(args)`)
    //   live      every api.live query name subscribed
    //   flags     anything a plugin marked with juris.markRender (a clock read, a random value…)
    //   unknown   every capitalised tag outside <svg>/<math> with no component registered under it, drawn or
    //             refused as a tag (Juris.unknownComponent)
    // Nothing about the render changes when tracing — no proxies, no subscriptions — so the HTML is
    // identical either way. It exists so a server can decide whether this HTML can be cached, and
    // what would have to change for it to be stale.
    renderToString(layout, namespace = null, options = {}) {
        if (this.instances) throw new Error("Juris.renderToString: a render is already in progress on this instance");
        this.instances = [];
        this.trace = options.trace ? { reactive: 0, paths: new Set(), calls: new Set(), live: new Set(), flags: new Set(), unknown: new Set() } : null;
        const previousReads = this.stateManager.activeReads;
        this.stateManager.activeReads = this.trace ? this.trace.paths : null;
        try {
            return this.node(layout, namespace, null);
        } finally {
            this.stateManager.activeReads = previousReads;
            this.lastTrace = this.trace;
            this.trace = null;
            const instances = this.instances;
            this.instances = null;
            // Computeds and onCleanup handlers registered during setup must not outlive the request.
            // The last instance set up goes first. The client's order differs (REFERENCE.md, "The
            // component api": outside in, so a cleanup finds nothing around it bound to draw again),
            // which nothing here can tell apart: nothing here is bound.
            for (let index = instances.length - 1; index >= 0; index -= 1) {
                const cleanups = instances[index].cleanups;
                instances[index].cleanups = [];
                for (const cleanup of cleanups) cleanup();
            }
        }
    }

    // ---- values -----------------------------------------------------------------------

    // Runs a reactive function once. A settled value (a preloaded api.call, or a chain on one) is
    // unwrapped on the spot; a real promise cannot be waited for, so its position renders empty.
    evaluate(fn) {
        if (this.trace) this.trace.reactive += 1;
        try {
            return this.resolve(fn(null)); // on the client the function receives its element; here there is none
        } catch (error) {
            return this.fail(error, "binding");
        }
    }

    // Offers an error to the owner's boundaries: a fallback becomes a signal for that boundary's
    // component() to render; a swallowed error renders empty; an unhandled one is thrown (500).
    fail(error, phase) {
        if (error instanceof FallbackSignal) throw error;
        const handled = this.juris.resolveError(this.owner, error, { phase, component: this.owner?.name });
        if (!handled) throw error;
        if (handled.layout) throw new FallbackSignal(handled.boundary, handled.layout, error);
        return undefined;
    }

    resolve(value) {
        if (this.stateManager.isSettled(value)) {
            if ("error" in value) {
                // A preloaded rejection: the boundary may show a fallback; otherwise it renders empty
                // (the client reproduces the rejection and handles it there).
                const handled = this.juris.resolveError(this.owner, value.error, { phase: "async", component: this.owner?.name });
                if (handled?.layout) throw new FallbackSignal(handled.boundary, handled.layout, value.error);
                if (!handled && this.devMode) console.error("Juris.renderToString: settled value is an error; rendering empty", value.error);
                return undefined;
            }
            return this.resolve(value.value);
        }
        if (this.stateManager.isThenable(value)) {
            // A real promise cannot be waited for, so this slot renders empty — and the page is
            // incomplete. The trace says so, so a cache will not store the hole as a finished page.
            this.trace?.flags.add("unresolved");
            if (this.devMode) console.warn("Juris.renderToString: a reactive function returned a promise; it renders empty on the server (preload it)");
            return undefined;
        }
        return value;
    }

    // Layouts only mean something in a child position. An object given where text goes need not be
    // one (`"data-cart": { items: 2 }`), so devMode says what it was given, as the DOM renderer does.
    // `content` and `tag` are given where the value may come from a function that is a tag's whole
    // content, and read only here, once something is refused (Juris.layoutInValue).
    rejectLayout(value, position, content = null, tag = null) {
        if (value === null || typeof value !== "object") return false;
        if (this.devMode) {
            const wholeContent = this.juris.wholeContentOf(content, tag);
            const reason = this.juris.layoutInValue(value, position, wholeContent);
            this.juris.refused("layout-in-value", reason, { name: position, value, component: this.owner });
        }
        return true;
    }

    // ---- nodes ------------------------------------------------------------------------

    // `select` carries the enclosing <select>'s value so the matching <option> is marked selected.
    node(layout, namespace, select) {
        // A list a function in one child's place gives (a seat) is refused, as a component's result is
        // (component), in the words the DOM renderer uses (Juris.oneLayout).
        if (this.juris.isSeatLayout(layout)) {
            const value = this.evaluate(layout);
            return this.node(this.juris.oneLayout(value, "seat"), namespace, select);
        }
        if (this.juris.isTextLayout(layout)) return escapeText(this.juris.textOf(layout));

        const { content: rawContent, tag } = this.juris.getLayoutEntry(layout);
        if (this.componentManager.has(tag)) return this.component(tag, rawContent, namespace, select);
        // A tag from data is an element the layout never asked for — see checkTag. Nothing is
        // rendered for it, exactly as an attribute that fails its check is not written.
        const check = checkTag(tag, this.juris.allowTags);
        // A component's name with nothing registered under it: recorded in the trace, and said or
        // refused as the instance's `unknownComponents` says (Juris.unknownComponent), whether or not
        // the tag is drawn, and told which. Inside <svg> or <math> it is an element, never unknown.
        if (/^[A-Z]/.test(tag)) this.juris.unknownComponent(tag, foreignContext(namespace), check.ok);
        if (!check.ok) {
            if (this.devMode) this.juris.refused(check.rule, check.reason, { name: tag, value: rawContent, component: this.owner });
            return "";
        }
        return this.element(tag, this.juris.normalizeContent(rawContent), namespace, select);
    }

    component(name, rawContent, namespace, select) {
        const props = this.juris.normalizeContent(rawContent);
        if (this.componentManager.getOptions(name).ssr === false) {
            // Client-only: nothing of it exists in the HTML; the client render creates it.
            return `<!--juris:client ${escapeText(name)}-->`;
        }
        const instance = { name, props, cleanups: [], disposeBinding: () => { }, ssr: true, parent: this.owner };
        this.instances.push(instance);
        const previous = this.owner;
        this.owner = instance;
        try {
            let result = this.juris.invokeDefinition(instance, props);
            if (typeof result === "function") result = this.evaluate(result);
            // A promise cannot be waited for: this place renders empty, and the page is incomplete.
            if (this.stateManager.isThenable(result)) this.trace?.flags.add("unresolved");
            const layout = this.juris.definitionLayout(result, instance);
            return this.node(this.juris.withKey(layout, props.key), namespace, select);
        } catch (error) {
            if (error instanceof FallbackSignal) {
                if (error.boundary !== instance) throw error;
                return this.node(this.juris.withKey(error.layout, props.key), namespace, select);
            }
            const handled = this.juris.resolveError(instance, error, { phase: "setup", component: name });
            if (!handled) throw error;
            if (handled.boundary !== instance) {
                if (handled.layout) throw new FallbackSignal(handled.boundary, handled.layout, error);
                return "";
            }
            return handled.layout === undefined ? "" : this.node(this.juris.withKey(handled.layout, props.key), namespace, select);
        } finally {
            this.owner = previous;
        }
    }

    element(tag, content, namespace, select) {
        const lowerTag = tag.toLowerCase();
        const drawnIn = elementNamespace(namespace, lowerTag);

        const attributes = new Map(); // name -> string (escaped on output) | true (boolean, present)
        let classKey = null; // `class` or `className`, the later of the two: the earlier is never used
        const classDecisions = []; // the [className, on] pairs the classList gives, in the order of its keys
        let value = undefined;
        let hasValue = false;
        let inner = null; // textContent (escaped) or innerHTML (raw), or an <option>'s children, drawn early (below)
        let text = null; // textContent as given, for a <style>
        // `textContent`, or an `innerHTML` the instance allows, the later of the two: given either, it
        // is all the element holds, whatever its value (see below).
        let held = null;
        // An HTML <style> (drawn only when allowTags names it) holds CSS the parser reads raw, up to
        // the first `</style`: escaped, `a > b` reached the browser as `a &gt; b`. Its text is written
        // as given, and the element is left out when the text would end it early, as renderDocument
        // refuses an inline style's. Inside <svg> a <style>'s text is ordinary text, and is escaped.
        // Inside a <noscript> or a <select>, at any depth (styleAsMarkup), the parser may not read
        // the <style> start tag as one: with scripting on, what is inside a <noscript> is text up to
        // `</noscript`, and the parsers of the browser floor ignore a <style> inside a <select> and
        // read what follows as markup. There the text is kept only with no `<` in it, which no tag
        // can start without, and the element is left out otherwise.
        const rawStyle = lowerTag === "style" && !drawnIn;

        for (const key in content) {
            const raw = content[key];
            if (key === "children") continue;
            if (key === "key") {
                if (raw !== undefined) attributes.set("data-key", String(raw));
                continue;
            }
            if (key.startsWith("on") && typeof raw === "function") continue; // listeners have no HTML
            if (key === "class" || key === "className" || key === "classList") {
                if (!attributes.has("class")) attributes.set("class", ""); // keeps the attribute where it first appeared
            }
            if (key === "class" || key === "className") {
                classKey = key; // drawn once every key is read (below)
                continue;
            }
            if (key === "classList") {
                // A key is class names, split as the DOM renderer splits it (html-safety.js); one that
                // names none is nothing, its value never asked. A function gives the whole object, and
                // is run once for it; what is in that object is used as it is, as the DOM renderer uses
                // it: a function there is not run, and is true.
                if (typeof raw === "function") {
                    const given = this.evaluate(raw);
                    for (const className in given) {
                        const on = Boolean(given[className]);
                        for (const token of classTokens(className)) classDecisions.push([token, on]);
                    }
                } else {
                    for (const className in raw) {
                        const tokens = classTokens(className);
                        if (tokens.length === 0) continue;
                        const on = Boolean(this.value(raw[className]));
                        for (const token of tokens) classDecisions.push([token, on]);
                    }
                }
                continue;
            }
            if (key === "innerHTML") {
                // Markup, written as given, so only when the instance says so (html-safety.js); a
                // refused one is left out whole, its function never run.
                const check = checkInnerHTML(this.juris?.allowInnerHTML === true);
                if (!check.ok) { if (this.devMode) this.juris.refused(check.rule, check.reason, { name: key, value: raw, component: this.owner }); continue; }
            }
            // HTML has no `indeterminate` attribute: it is an <input>'s property alone, which the client
            // sets, so nothing is written for it here, its function never run.
            if (key === "indeterminate" && lowerTag === "input" && !drawnIn) continue;
            const resolved = this.value(raw);
            // Text as a text layout is (Juris textOf): null, undefined, true and false are nothing.
            if (key === "textContent") {
                held = key;
                if (!this.rejectLayout(resolved, key, content, tag)) {
                    text = this.juris.textOf(resolved);
                    inner = escapeText(text);
                }
            } else if (key === "innerHTML") {
                held = key;
                if (!this.rejectLayout(resolved, key)) {
                    inner = this.juris.textOf(resolved);
                    text = null;
                }
            } else if (key === "style") {
                const css = this.style(resolved);
                if (css) attributes.set("style", css);
            } else if (BOOLEAN_ATTRIBUTES.has(key.toLowerCase()) && !drawnIn) {
                if (untilFound(key, resolved)) attributes.set(key, resolved);
                else if (resolved) attributes.set(key, true);
            } else if (key === "value" && drawnIn !== NAMESPACES.svg) {
                hasValue = true;
                value = resolved;
            } else {
                if (this.rejectLayout(resolved, key) || resolved === null || resolved === undefined) continue;
                const name = ATTRIBUTE_ALIASES[key] || key;
                // A name from data, or a URL whose scheme runs code, never reaches the markup.
                const check = checkAttribute(name, resolved, this.juris.allowSchemes);
                if (!check.ok) { if (this.devMode) this.juris.refused(check.rule, check.reason, { name, value: resolved, component: this.owner }); continue; }
                attributes.set(name, String(resolved));
            }
        }

        // The class attribute, by the rule the DOM renderer draws it with (Juris classAttribute): the
        // base `class` or `className` gives, a layout or a list in it refused as in any attribute, and
        // the classList's classes on it, the last key naming a class deciding it.
        let classBase = null;
        if (classKey !== null) {
            const resolved = this.value(content[classKey]);
            if (!this.rejectLayout(resolved, classKey) && resolved !== null && resolved !== undefined) {
                classBase = String(resolved);
            }
        }
        const classValue = this.juris.classAttribute(classBase, classDecisions);
        if (classValue === null) attributes.delete("class");
        else attributes.set("class", classValue);

        // `value`: an attribute on inputs, the text of a <textarea>, the selected <option> of a <select>,
        // and the text of an <output>, which has no such attribute: its value is what it shows, and the
        // client's `output.value = …` replaces its text.
        const valueText = value === null || value === undefined ? "" : String(value);
        const valueIsText = lowerTag === "textarea" || lowerTag === "output";
        if (hasValue && lowerTag !== "select" && !valueIsText) attributes.set("value", valueText);
        if (lowerTag === "option" && select !== null && select !== undefined && !attributes.has("selected")) {
            // With no value attribute it is matched by the text it shows (optionText): what is inside
            // it is drawn first, for that, and written below as it was drawn.
            if (!attributes.has("value") && held === null) {
                const inside = namespaceInside(drawnIn, lowerTag, attributes.get("encoding"));
                inner = this.children(content.children, inside, null);
            }
            const optionValue = attributes.has("value") ? attributes.get("value") : this.optionText(inner ?? "");
            if (optionValue === String(select)) attributes.set("selected", true);
        }

        let html = `<${tag}`;
        for (const [name, attributeValue] of attributes) {
            html += attributeValue === true ? ` ${name}=""` : ` ${name}="${escapeAttribute(attributeValue)}"`;
        }
        if (VOID_ELEMENTS.has(lowerTag) && !drawnIn) return `${html}>`;
        html += ">";

        // What the element holds is one thing (REFERENCE.md, "Components and layouts"): its
        // textContent, or an innerHTML the instance allows, the later of the two (`held`); else an
        // <output>'s or a <textarea>'s value; else its children. The keys decide it, whatever their
        // values and order, as on the client; what else the layout gives for it is left out, and
        // named in devMode.
        const holder = held ?? (hasValue && valueIsText ? "value" : null);
        if (holder !== null && this.devMode) {
            if (holder !== "value" && hasValue && valueIsText) this.leftOut(tag, "value", value, holder);
            if (content.children !== null && content.children !== undefined) {
                this.leftOut(tag, "children", content.children, holder);
            }
        }

        if (rawStyle && (text !== null || held === null)) {
            const css = text ?? this.styleText(content.children);
            if (/<\/style/i.test(css)) {
                if (this.devMode) this.juris.refused(null, "<style>: its text contains </style, which would end the element", { name: "style", value: css, component: this.owner });
                return "";
            }
            if (this.styleAsMarkup > 0 && css.includes("<")) {
                if (this.devMode) this.juris.refused(null, "<style>: inside a <noscript> or a <select> its text may hold no <, which the parser could read as markup there", { name: "style", value: css, component: this.owner });
                return "";
            }
            html += css;
        } else if (held !== null || inner !== null) {
            html += inner ?? "";
        } else if (hasValue && valueIsText) {
            html += escapeText(valueText);
        } else {
            // A <select> hands its value down so the matching <option> can mark itself selected; an
            // <optgroup> is transparent and passes that value through, so an option inside a group is
            // matched too. Every other element stops it, so a nested <select> starts its own.
            const childSelect = lowerTag === "select" ? (hasValue ? value : null) : lowerTag === "optgroup" ? select : null;
            // What is inside is in this element's namespace, but at an integration point (above).
            const styleAsMarkup = !drawnIn && (lowerTag === "noscript" || lowerTag === "select");
            if (styleAsMarkup) this.styleAsMarkup += 1;
            try {
                html += this.children(content.children, namespaceInside(drawnIn, lowerTag, attributes.get("encoding")), childSelect);
            } finally {
                if (styleAsMarkup) this.styleAsMarkup -= 1;
            }
        }
        return `${html}</${tag}>`;
    }

    // devMode's word for what an element's content leaves out (see element): `key` is the children or
    // the value beside what it holds, `holder` the key it holds.
    leftOut(tag, key, value, holder) {
        const reason = `${key}: <${tag}> holds its ${holder}, and nothing beside it`;
        this.juris.refused(null, reason, { name: key, value, component: this.owner });
    }

    // The text an <option> shows, for matching a <select> value when it has no value attribute: the
    // text of everything drawn inside it, the elements' included (`<option>2<b>x</b></option>` shows
    // "2x", as option.text reads the DOM), read back from that markup: its tags and comments left
    // out, and the references escapeText writes read back. Markup written as given (innerHTML) is
    // read the same way. Its ASCII whitespace is then stripped and collapsed, as the DOM's
    // option.value does with that text (` a \n b ` is "a b"); other whitespace (U+00A0) stays.
    optionText(inside) {
        const text = inside.replace(/<!--[\s\S]*?-->|<[^>]*>/g, "").replace(/&(amp|lt|gt);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">" })[name]);
        return text.replace(/[\t\n\f\r ]+/g, " ").replace(/^ | $/g, "");
    }

    // The text of an HTML <style>'s children (see element): text and seats, joined as given.
    styleText(children) {
        const resolved = this.value(children);
        if (resolved === null || resolved === undefined) return "";
        let css = "";
        for (let child of Array.isArray(resolved) ? resolved : [resolved]) {
            while (this.juris.isSeatLayout(child)) child = this.evaluate(child);
            if (this.juris.isTextLayout(child)) css += this.juris.textOf(child);
            else if (this.devMode) console.warn("Juris: a layout inside <style> is not CSS; ignored", child);
        }
        return css;
    }

    children(children, namespace, select) {
        const resolved = this.value(children);
        if (resolved === null || resolved === undefined) return "";
        const list = Array.isArray(resolved) ? resolved : [resolved];
        let html = "";
        for (const child of list) html += this.node(child, namespace, select);
        return html;
    }

    // A property value: static, or a function evaluated once.
    value(raw) {
        return typeof raw === "function" ? this.evaluate(raw) : this.resolve(raw);
    }

    // A style is CSS, and CSS built from data is an injection of its own kind: `background:
    // url(https://elsewhere/?v=<something the page knows>)` makes the browser fetch it, and an
    // attacker-supplied value reaches the attacker. Values are escaped for the attribute, so this
    // cannot break out of the style — but it can still say things inside it. Nothing here can tell
    // a string a component wrote from one a row carried, so the rule is for the caller: build a
    // style from an object with known keys, not from a string that came from data.
    // An object's keys and values are held to the rule the DOM renderer applies (checkStyle in
    // html-safety.js): a value that would end its declaration and start another, or a key that is no
    // property, is left out, where it used to be written as it came.
    style(styles) {
        if (styles === null || styles === undefined) return "";
        if (typeof styles === "string") return styles;
        const declarations = [];
        for (const [key, value] of Object.entries(styles)) {
            if (value === null || value === undefined || value === "") continue;
            const check = checkStyle(key, value);
            if (!check.ok) { if (this.devMode) this.juris.refused(check.rule, check.reason, { name: key, value, component: this.owner }); continue; }
            declarations.push(`${check.name}:${value}`);
        }
        return declarations.join(";");
    }
}