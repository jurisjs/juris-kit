// A stand-in for a browser page, for the examples tagged ```js dom: check-examples.mjs installs it
// before such an example runs, as the globals a page has (document, window, Node, Element, Text,
// Comment, DocumentFragment). It is not a browser. It does what the DOM renderer asks of it, and
// reads back as a browser would: innerHTML and outerHTML serialize as the HTML standard says, and
// setting innerHTML parses simple markup. It has an address bar and a session history, for the
// router (location, history, popstate, scrollTo: below). What it leaves out: layout, CSS parsing (a
// style value a browser would refuse is kept), MutationObserver, custom elements, a page load (no
// navigation leaves the page: location.reload() does nothing), events beyond dispatch with bubbling
// (element.click() dispatches a primary-button click; nothing has a default action; pagehide and
// pageshow are a PageTransitionEvent an example dispatches on window).

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";

const VOID = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const RAW_TEXT = new Set(["style", "script", "xmp", "iframe", "noembed", "noframes", "plaintext", "noscript"]);
const ESCAPABLE_RAW_TEXT = new Set(["textarea", "title"]);
// SVG names the parser gives their case back to.
const SVG_TAGS = new Map(
    ["foreignObject", "clipPath", "linearGradient", "radialGradient", "textPath"]
        .map((tag) => [tag.toLowerCase(), tag]),
);

// ---- events -----------------------------------------------------------------------------------

class Target {
    #listeners = new Map(); // type -> [{ listener, once }]

    addEventListener(type, listener, options) {
        if (!listener) return;
        const list = this.#listeners.get(type) ?? [];
        if (list.some((entry) => entry.listener === listener)) return;
        list.push({ listener, once: Boolean(options?.once) });
        this.#listeners.set(type, list);
    }

    removeEventListener(type, listener) {
        const list = this.#listeners.get(type);
        if (list) this.#listeners.set(type, list.filter((entry) => entry.listener !== listener));
    }

    // Runs the listeners on the target, then, for an event that bubbles, on each ancestor.
    dispatchEvent(event) {
        Object.defineProperty(event, "target", { value: this, configurable: true });
        for (let node = this; node; node = event.bubbles ? node.parentNode ?? null : null) {
            Object.defineProperty(event, "currentTarget", { value: node, configurable: true });
            for (const entry of [...(node.#listeners.get(event.type) ?? [])]) {
                if (entry.once) node.removeEventListener(event.type, entry.listener);
                if (typeof entry.listener === "function") entry.listener.call(node, event);
                else entry.listener.handleEvent(event);
            }
            if (event.cancelBubble) break;
        }
        return !event.defaultPrevented;
    }
}

// ---- nodes ------------------------------------------------------------------------------------

export class Node extends Target {
    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
    static COMMENT_NODE = 8;
    static DOCUMENT_NODE = 9;
    static DOCUMENT_FRAGMENT_NODE = 11;

    constructor(nodeType, ownerDocument) {
        super();
        this.nodeType = nodeType;
        this.ownerDocument = ownerDocument ?? null;
        this.parentNode = null;
        this.childNodes = [];
    }

    get firstChild() {
        return this.childNodes[0] ?? null;
    }

    get lastChild() {
        return this.childNodes[this.childNodes.length - 1] ?? null;
    }

    get nextSibling() {
        const siblings = this.parentNode?.childNodes;
        return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
    }

    get nextSibling() {
        const siblings = this.parentNode?.childNodes;
        return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
    }

    get previousSibling() {
        const siblings = this.parentNode?.childNodes;
        return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
    }

    get parentElement() {
        return this.parentNode?.nodeType === Node.ELEMENT_NODE ? this.parentNode : null;
    }

    get children() {
        return this.childNodes.filter((node) => node.nodeType === Node.ELEMENT_NODE);
    }

    get firstElementChild() {
        return this.children[0] ?? null;
    }

    get isConnected() {
        let node = this;
        while (node.parentNode) node = node.parentNode;
        return node.nodeType === Node.DOCUMENT_NODE;
    }

    get textContent() {
        return this.childNodes
            .filter((node) => node.nodeType !== Node.COMMENT_NODE)
            .map((node) => node.textContent)
            .join("");
    }

    set textContent(value) {
        for (const child of [...this.childNodes]) this.removeChild(child);
        const text = value === null || value === undefined ? "" : String(value);
        if (text !== "") this.appendChild(this.document.createTextNode(text));
    }

    get document() {
        return this.ownerDocument ?? this;
    }

    hasChildNodes() {
        return this.childNodes.length > 0;
    }

    contains(node) {
        for (let current = node; current; current = current.parentNode) if (current === this) return true;
        return false;
    }

    appendChild(node) {
        return this.insertBefore(node, null);
    }

    insertBefore(node, reference) {
        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            for (const child of [...node.childNodes]) this.insertBefore(child, reference);
            return node;
        }
        if (node.contains(this)) throw domError("HierarchyRequestError", "The new child contains the parent");
        if (reference && reference.parentNode !== this) {
            throw domError("NotFoundError", "The node before which to insert is not a child");
        }
        if (node.parentNode) node.parentNode.removeChild(node);
        const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
        this.childNodes.splice(index, 0, node);
        node.parentNode = this;
        return node;
    }

    removeChild(node) {
        const index = this.childNodes.indexOf(node);
        if (index === -1) throw domError("NotFoundError", "The node to remove is not a child");
        this.childNodes.splice(index, 1);
        node.parentNode = null;
        return node;
    }

    replaceChild(node, old) {
        this.insertBefore(node, old);
        return this.removeChild(old);
    }

    remove() {
        this.parentNode?.removeChild(this);
    }

    replaceWith(...nodes) {
        const parent = this.parentNode;
        if (!parent) return;
        for (const node of nodes) parent.insertBefore(this.#asNode(node), this);
        parent.removeChild(this);
    }

    append(...nodes) {
        for (const node of nodes) this.appendChild(this.#asNode(node));
    }

    prepend(...nodes) {
        const first = this.firstChild;
        for (const node of nodes) this.insertBefore(this.#asNode(node), first);
    }

    before(...nodes) {
        for (const node of nodes) this.parentNode?.insertBefore(this.#asNode(node), this);
    }

    after(...nodes) {
        const next = this.nextSibling;
        for (const node of nodes) this.parentNode?.insertBefore(this.#asNode(node), next);
    }

    #asNode(value) {
        return value instanceof Node ? value : this.document.createTextNode(String(value));
    }

    querySelectorAll(selector) {
        const matcher = compileSelector(selector);
        const found = [];
        const walk = (node) => {
            for (const child of contentOf(node).childNodes) {
                if (child.nodeType !== Node.ELEMENT_NODE) continue;
                if (matcher(child, this)) found.push(child);
                walk(child);
            }
        };
        walk(this);
        return found;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
    }
}

export class CharacterData extends Node {
    constructor(nodeType, data, ownerDocument) {
        super(nodeType, ownerDocument);
        this.data = String(data);
    }

    get nodeValue() {
        return this.data;
    }

    set nodeValue(value) {
        this.data = String(value);
    }

    get textContent() {
        return this.data;
    }

    set textContent(value) {
        this.data = String(value);
    }

    get length() {
        return this.data.length;
    }

    cloneNode() {
        return new this.constructor(this.data, this.ownerDocument);
    }
}

export class Text extends CharacterData {
    constructor(data = "", ownerDocument = null) {
        super(Node.TEXT_NODE, data, ownerDocument);
    }

    get nodeName() {
        return "#text";
    }
}

export class Comment extends CharacterData {
    constructor(data = "", ownerDocument = null) {
        super(Node.COMMENT_NODE, data, ownerDocument);
    }

    get nodeName() {
        return "#comment";
    }
}

export class DocumentFragment extends Node {
    constructor(ownerDocument = null) {
        super(Node.DOCUMENT_FRAGMENT_NODE, ownerDocument);
    }

    get nodeName() {
        return "#document-fragment";
    }

    get innerHTML() {
        return this.childNodes.map(serialize).join("");
    }

    cloneNode(deep = false) {
        const copy = new DocumentFragment(this.ownerDocument);
        if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
        return copy;
    }
}

// ---- elements ---------------------------------------------------------------------------------

export class Element extends Node {
    #attributes = new Map(); // qualified name -> { namespace, value }

    constructor(localName, namespaceURI, ownerDocument) {
        super(Node.ELEMENT_NODE, ownerDocument);
        this.localName = localName;
        this.namespaceURI = namespaceURI;
        this.classList = new TokenList(this);
        this.style = styleOf(this);
        this.dataset = datasetOf(this);
        if (localName === "template" && namespaceURI === HTML) this.content = new DocumentFragment(ownerDocument);
        defineFormProperties(this);
    }

    get tagName() {
        return this.namespaceURI === HTML ? this.localName.toUpperCase() : this.localName;
    }

    get nodeName() {
        return this.tagName;
    }

    // HTML elements lower-case an attribute's name; SVG and MathML ones keep it.
    #qualified(name) {
        return this.namespaceURI === HTML ? String(name).toLowerCase() : String(name);
    }

    getAttribute(name) {
        return this.#attributes.get(this.#qualified(name))?.value ?? null;
    }

    getAttributeNS(namespace, name) {
        for (const [qualified, entry] of this.#attributes) {
            if (entry.namespace === namespace && qualified.split(":").pop() === name) return entry.value;
        }
        return null;
    }

    setAttribute(name, value) {
        const qualified = this.#qualified(name);
        if (!/^[^\s"'>/=\0]+$/.test(qualified)) {
            throw domError("InvalidCharacterError", `"${name}" is not a valid attribute name`);
        }
        this.#attributes.set(qualified, { namespace: null, value: String(value) });
    }

    setAttributeNS(namespace, name, value) {
        this.#attributes.set(String(name), { namespace, value: String(value) });
    }

    hasAttribute(name) {
        return this.#attributes.has(this.#qualified(name));
    }

    removeAttribute(name) {
        this.#attributes.delete(this.#qualified(name));
    }

    removeAttributeNS(namespace, name) {
        for (const [qualified, entry] of this.#attributes) {
            if (entry.namespace !== namespace || qualified.split(":").pop() !== name) continue;
            this.#attributes.delete(qualified);
        }
    }

    toggleAttribute(name, force) {
        const on = force ?? !this.hasAttribute(name);
        if (on && !this.hasAttribute(name)) this.setAttribute(name, "");
        if (!on) this.removeAttribute(name);
        return on;
    }

    getAttributeNames() {
        return [...this.#attributes.keys()];
    }

    get attributes() {
        return [...this.#attributes].map(([name, { namespace, value }]) => ({ name, namespaceURI: namespace, value }));
    }

    get id() {
        return this.getAttribute("id") ?? "";
    }

    set id(value) {
        this.setAttribute("id", value);
    }

    get className() {
        return this.getAttribute("class") ?? "";
    }

    set className(value) {
        this.setAttribute("class", value);
    }

    get innerHTML() {
        return contentOf(this).childNodes.map(serialize).join("");
    }

    set innerHTML(markup) {
        const holder = contentOf(this);
        for (const child of [...holder.childNodes]) holder.removeChild(child);
        parseInto(holder, String(markup ?? ""), this.namespaceURI === HTML ? null : this.namespaceURI);
    }

    get outerHTML() {
        return serialize(this);
    }

    matches(selector) {
        return compileSelector(selector)(this, null);
    }

    closest(selector) {
        const matcher = compileSelector(selector);
        for (let node = this; node?.nodeType === Node.ELEMENT_NODE; node = node.parentNode) {
            if (matcher(node, null)) return node;
        }
        return null;
    }

    cloneNode(deep = false) {
        const copy = this.document.createElementNS(this.namespaceURI, this.localName);
        for (const [name, { namespace, value }] of this.#attributes) copy.#attributes.set(name, { namespace, value });
        if (deep) {
            for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
            for (const child of this.content?.childNodes ?? []) copy.content.appendChild(child.cloneNode(true));
        }
        return copy;
    }

    click() {
        this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }

    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }

    blur() {
        if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
    }

    getBoundingClientRect() {
        return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    attachShadow({ mode = "open" } = {}) {
        const root = new DocumentFragment(this.ownerDocument);
        root.host = this;
        root.mode = mode;
        if (mode === "open") this.shadowRoot = root;
        return root;
    }
}

// What a <template> holds is its content, as the parser puts it.
const contentOf = (node) => node.content ?? node;

// classList: the class attribute as tokens, throwing where a browser throws.
class TokenList {
    #element;

    constructor(element) {
        this.#element = element;
    }

    #tokens() {
        return (this.#element.getAttribute("class") ?? "").split(/[\t\n\f\r ]+/).filter(Boolean);
    }

    #write(tokens) {
        this.#element.setAttribute("class", [...new Set(tokens)].join(" "));
    }

    #check(token) {
        if (token === "") throw domError("SyntaxError", "The token provided must not be empty");
        if (/[\t\n\f\r ]/.test(token)) {
            throw domError("InvalidCharacterError", `The token provided ('${token}') contains HTML space characters`);
        }
    }

    get length() {
        return this.#tokens().length;
    }

    get value() {
        return this.#element.getAttribute("class") ?? "";
    }

    item(index) {
        return this.#tokens()[index] ?? null;
    }

    contains(token) {
        return this.#tokens().includes(token);
    }

    add(...tokens) {
        tokens.forEach((token) => this.#check(token));
        this.#write([...this.#tokens(), ...tokens]);
    }

    remove(...tokens) {
        tokens.forEach((token) => this.#check(token));
        if (this.#element.hasAttribute("class")) this.#write(this.#tokens().filter((token) => !tokens.includes(token)));
    }

    toggle(token, force) {
        this.#check(token);
        const on = force ?? !this.contains(token);
        if (on) this.add(token);
        else this.remove(token);
        return on;
    }

    [Symbol.iterator]() {
        return this.#tokens()[Symbol.iterator]();
    }
}

// element.style: the style attribute read as declarations, and written back as a browser
// serializes it (`margin-top: 4px; color: red;`). camelCase names are the CSS names
// (`marginTop`, `cssFloat` for `float`, `WebkitTransform` for `-webkit-transform`).
function styleOf(element) {
    const read = () => {
        const declarations = new Map();
        for (const part of (element.getAttribute("style") ?? "").split(";")) {
            const colon = part.indexOf(":");
            if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        return declarations;
    };
    const write = (declarations) => {
        if (!declarations.size && !element.hasAttribute("style")) return;
        element.setAttribute("style", [...declarations].map(([name, value]) => `${name}: ${value};`).join(" "));
    };
    const style = {
        getPropertyValue: (name) => read().get(name) ?? "",
        setProperty(name, value) {
            const declarations = read();
            const text = value === null || value === undefined ? "" : String(value);
            if (text === "") declarations.delete(name);
            else declarations.set(name, text);
            write(declarations);
        },
        removeProperty(name) {
            const declarations = read();
            const previous = declarations.get(name) ?? "";
            declarations.delete(name);
            write(declarations);
            return previous;
        },
    };
    return new Proxy(style, {
        get(target, key) {
            if (typeof key !== "string" || key in target) return target[key];
            if (key === "cssText") return element.getAttribute("style") ?? "";
            if (key === "length") return read().size;
            return target.getPropertyValue(cssName(key));
        },
        set(target, key, value) {
            if (typeof key !== "string") return false;
            if (key === "cssText") {
                if (value === "" || value === null || value === undefined) element.removeAttribute("style");
                else element.setAttribute("style", String(value));
                write(read());
            } else {
                target.setProperty(cssName(key), value);
            }
            return true;
        },
    });
}

function cssName(key) {
    if (key.startsWith("--")) return key;
    if (key === "cssFloat") return "float";
    const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    return /^(webkit|moz|ms)-/.test(name) ? `-${name}` : name;
}

// element.dataset: the data-* attributes by their camelCase names.
function datasetOf(element) {
    const attribute = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, {
        get: (_, key) => (typeof key === "string" ? element.getAttribute(attribute(key)) ?? undefined : undefined),
        set: (_, key, value) => {
            element.setAttribute(attribute(key), value);
            return true;
        },
        has: (_, key) => typeof key === "string" && element.hasAttribute(attribute(key)),
        deleteProperty: (_, key) => {
            element.removeAttribute(attribute(key));
            return true;
        },
        ownKeys: () => element.getAttributeNames()
            .filter((name) => name.startsWith("data-"))
            .map((name) => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())),
        getOwnPropertyDescriptor: (_, key) => {
            const value = element.getAttribute(attribute(key));
            return value === null ? undefined : { value, enumerable: true, configurable: true, writable: true };
        },
    });
}

// `value` and `checked`, as a browser has them: an <input>, <textarea> and <select> keep a value of
// their own (the attribute is only the default); an <option>'s value reflects its attribute and
// falls back to its text; an <output>'s value is its text; the rest reflect the attribute.
const OWN_VALUE = new Set(["input", "textarea", "select"]);
const REFLECTED_VALUE = new Set(["button", "data", "li", "meter", "progress", "param", "option"]);

function defineFormProperties(element) {
    if (element.namespaceURI !== HTML) return;
    const tag = element.localName;
    if (OWN_VALUE.has(tag)) {
        let own = null;
        Object.defineProperty(element, "value", {
            get: () => own ?? (tag === "textarea" ? element.textContent : element.getAttribute("value") ?? ""),
            set: (value) => {
                own = value === null || value === undefined ? "" : String(value);
            },
        });
    } else if (REFLECTED_VALUE.has(tag)) {
        Object.defineProperty(element, "value", {
            get: () => element.getAttribute("value") ?? (tag === "option" ? element.textContent.trim() : ""),
            set: (value) => element.setAttribute("value", value),
        });
    } else if (tag === "output") {
        Object.defineProperty(element, "value", {
            get: () => element.textContent,
            set: (value) => {
                element.textContent = value;
            },
        });
    }
    if (tag === "input") {
        let checked = null;
        Object.defineProperty(element, "checked", {
            get: () => checked ?? element.hasAttribute("checked"),
            set: (value) => {
                checked = Boolean(value);
            },
        });
    }
}

// ---- the document -----------------------------------------------------------------------------

export class Document extends Node {
    constructor() {
        super(Node.DOCUMENT_NODE, null);
        this.documentElement = this.createElement("html");
        this.head = this.createElement("head");
        this.body = this.createElement("body");
        this.documentElement.append(this.head, this.body);
        this.appendChild(this.documentElement);
        this.activeElement = this.body;
        this.title = "";
        // A tab in the foreground. An example that hides it defines its own (and dispatches
        // visibilitychange), as a browser test does.
        this.visibilityState = "visible";
        this.hidden = false;
    }

    get nodeName() {
        return "#document";
    }

    createElement(tag) {
        return new Element(String(tag).toLowerCase(), HTML, this);
    }

    createElementNS(namespace, tag) {
        return new Element(String(tag), namespace ?? null, this);
    }

    createTextNode(text) {
        return new Text(text, this);
    }

    createComment(text) {
        return new Comment(text, this);
    }

    createDocumentFragment() {
        return new DocumentFragment(this);
    }

    getElementById(id) {
        const find = (node) => {
            for (const child of contentOf(node).childNodes) {
                if (child.nodeType !== Node.ELEMENT_NODE) continue;
                if (child.getAttribute("id") === id) return child;
                const inside = find(child);
                if (inside) return inside;
            }
            return null;
        };
        return find(this);
    }
}

// ---- serializing, as the HTML standard does ------------------------------------------------------

const REFERENCES = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;", "\u00a0": "&nbsp;" };
const escapeText = (text) => text.replace(/[&<>\u00a0]/g, (c) => REFERENCES[c]);
const escapeAttribute = (text) => text.replace(/[&"<>\u00a0]/g, (c) => REFERENCES[c]);

function serialize(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentNode;
        const html = parent?.nodeType === Node.ELEMENT_NODE && parent.namespaceURI === HTML;
        return html && RAW_TEXT.has(parent.localName) ? node.data : escapeText(node.data);
    }
    if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.data}-->`;
    if (node.nodeType !== Node.ELEMENT_NODE) return node.childNodes.map(serialize).join("");
    let html = `<${node.localName}`;
    for (const { name, value } of node.attributes) html += ` ${name}="${escapeAttribute(value)}"`;
    html += ">";
    if (node.namespaceURI === HTML && VOID.has(node.localName)) return html;
    return `${html}${contentOf(node).childNodes.map(serialize).join("")}</${node.localName}>`;
}

// ---- parsing, simple markup only ------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const decode = (text) =>
    text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
        if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
        const hex = name[1] === "x" || name[1] === "X";
        return String.fromCodePoint(hex ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    });
// An open element these start tags close, as the parser closes them.
const CLOSES = {
    p: ["p"],
    li: ["li"],
    option: ["option"],
    dt: ["dt", "dd"],
    dd: ["dt", "dd"],
    tr: ["tr"],
    td: ["td", "th"],
    th: ["td", "th"],
};
const BLOCKS_CLOSING_P = new Set([
    "div", "ul", "ol", "p", "section", "article", "header", "footer", "nav", "table", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote",
]);

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const START_TAG = new RegExp(`^<([A-Za-z][^\\s/>]*)((?:\\s+${ATTRIBUTE.source})*)\\s*(\\/?)>`);

function parseInto(root, markup, namespace) {
    const document = root.document;
    const open = [{ node: root, namespace }];
    const top = () => open[open.length - 1];
    let i = 0;
    while (i < markup.length) {
        if (markup.startsWith("<!--", i)) {
            const end = markup.indexOf("-->", i + 4);
            const text = markup.slice(i + 4, end === -1 ? markup.length : end);
            contentOf(top().node).appendChild(document.createComment(text));
            i = end === -1 ? markup.length : end + 3;
            continue;
        }
        const end = /^<\/([A-Za-z][^\s/>]*)\s*>/.exec(markup.slice(i));
        if (end) {
            const name = end[1].toLowerCase();
            const at = open.findLastIndex((entry, n) => n > 0 && entry.node.localName.toLowerCase() === name);
            if (at > 0) open.length = at;
            i += end[0].length;
            continue;
        }
        const start = START_TAG.exec(markup.slice(i));
        if (start) {
            let name = start[1].toLowerCase();
            if (!top().namespace) {
                const closes = CLOSES[name] ?? (BLOCKS_CLOSING_P.has(name) ? ["p"] : []);
                const last = top().node.localName;
                if (open.length > 1 && closes.includes(last)) open.pop();
            }
            const inherited = top().namespace;
            const elementNamespace = inherited ?? (name === "svg" ? SVG : name === "math" ? MATHML : null);
            if (elementNamespace === SVG) name = SVG_TAGS.get(name) ?? name;
            const element = elementNamespace
                ? document.createElementNS(elementNamespace, name)
                : document.createElement(name);
            for (const attribute of start[2].matchAll(ATTRIBUTE)) {
                const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
                const viewBox = elementNamespace === SVG && attribute[1].toLowerCase() === "viewbox";
                const attributeName = viewBox ? "viewBox" : attribute[1];
                if (!element.hasAttribute(attributeName)) element.setAttribute(attributeName, decode(value));
            }
            contentOf(top().node).appendChild(element);
            i += start[0].length;
            const html = !elementNamespace;
            if (html && (RAW_TEXT.has(name) || ESCAPABLE_RAW_TEXT.has(name))) {
                const close = new RegExp(`</${name}\\s*>`, "i").exec(markup.slice(i));
                const text = close ? markup.slice(i, i + close.index) : markup.slice(i);
                if (text) element.appendChild(document.createTextNode(RAW_TEXT.has(name) ? text : decode(text)));
                i = close ? i + close.index + close[0].length : markup.length;
                continue;
            }
            const selfClosing = start[3] === "/" && !html;
            if ((html && VOID.has(name)) || selfClosing) continue;
            const inside = elementNamespace === SVG && name === "foreignObject" ? null : elementNamespace;
            open.push({ node: element, namespace: inside });
            continue;
        }
        const next = markup.indexOf("<", i + 1);
        const text = markup.slice(i, next === -1 ? markup.length : next);
        contentOf(top().node).appendChild(document.createTextNode(decode(text)));
        i += text.length;
    }
}

// ---- selectors: tags, #id, .class, [attr], [attr=value], *, descendant and child combinators, lists

function compileSelector(selector) {
    const alternatives = String(selector).split(",").map((part) => part.trim());
    if (alternatives.some((part) => !part)) throw domError("SyntaxError", `'${selector}' is not a valid selector`);
    const chains = alternatives.map(parseChain);
    return (element, scope) => chains.some((chain) => matchChain(element, chain, chain.length - 1, scope));
}

function parseChain(text) {
    const chain = [];
    let combinator = " ";
    for (const piece of text.replace(/\s*>\s*/g, " > ").split(/\s+/)) {
        if (piece === ">") {
            combinator = ">";
            continue;
        }
        chain.push({ combinator, test: parseCompound(piece) });
        combinator = " ";
    }
    return chain;
}

function parseCompound(text) {
    const tests = [];
    // A tag or `*`, #id, .class, [name] or [name op value], :scope.
    const pattern = new RegExp(
        String.raw`([A-Za-z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|` +
            String.raw`\[([\w:-]+)(?:([~^$*|]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|(:scope)`,
        "gy",
    );
    let at = 0;
    while (at < text.length) {
        const m = pattern.exec(text);
        if (!m) break;
        at = pattern.lastIndex;
        const [, tag, id, className, name, operator, double, single, bare, scoped] = m;
        if (tag && tag !== "*") tests.push((el) => el.localName.toLowerCase() === tag.toLowerCase());
        else if (id) tests.push((el) => el.getAttribute("id") === id);
        else if (className) tests.push((el) => el.classList.contains(className));
        else if (name) tests.push(attributeTest(name, operator, double ?? single ?? bare));
        else if (scoped) tests.push((el, scope) => el === scope);
    }
    if (at !== text.length) throw domError("SyntaxError", `'${text}' is not a selector this stand-in reads`);
    return (element, scope) => tests.every((test) => test(element, scope));
}

function attributeTest(name, operator, expected) {
    return (element) => {
        const value = element.getAttribute(name);
        if (value === null) return false;
        if (!operator) return true;
        if (operator === "=") return value === expected;
        if (operator === "~=") return value.split(/\s+/).includes(expected);
        if (operator === "^=") return value.startsWith(expected);
        if (operator === "$=") return value.endsWith(expected);
        if (operator === "*=") return value.includes(expected);
        return value === expected || value.startsWith(`${expected}-`);
    };
}

function matchChain(element, chain, index, scope) {
    if (!chain[index].test(element, scope)) return false;
    if (index === 0) return true;
    const combinator = chain[index].combinator;
    for (let parent = element.parentNode; parent?.nodeType === Node.ELEMENT_NODE; parent = parent.parentNode) {
        if (matchChain(parent, chain, index - 1, scope)) return true;
        if (combinator === ">") return false;
    }
    return false;
}

function domError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
}

// ---- events a page dispatches ---------------------------------------------------------------------

// What element.click() dispatches: the primary button, no modifier key, as a browser's click() does.
export class MouseEvent extends Event {
    constructor(type, init = {}) {
        super(type, init);
        this.button = init.button ?? 0;
        this.buttons = init.buttons ?? 0;
        this.ctrlKey = Boolean(init.ctrlKey);
        this.shiftKey = Boolean(init.shiftKey);
        this.altKey = Boolean(init.altKey);
        this.metaKey = Boolean(init.metaKey);
    }
}

export class PopStateEvent extends Event {
    constructor(type, init = {}) {
        super(type, init);
        this.state = init.state ?? null;
    }
}

// What pagehide and pageshow carry: `persisted`, whether the page is put in the back/forward cache
// (pagehide) or shown from it (pageshow). An example dispatches them on window itself.
export class PageTransitionEvent extends Event {
    constructor(type, init = {}) {
        super(type, init);
        this.persisted = Boolean(init.persisted);
    }
}

// ---- the address bar and the session history, for the router ------------------------------------

// The tab's entries, each a URL and a state, as a browser keeps them. pushState drops the entries
// ahead and adds one; replaceState changes the current one (both copy the state, as a browser
// clones it). back(), forward() and go(n) move in a later task, then fire popstate on window with
// the entry's state, as a browser does: an example awaits that event. A move past either end, or
// go(0) (a reload), does nothing.
class SessionHistory {
    #window;
    #entries = [{ url: new URL("http://localhost/"), state: null }];
    #index = 0;

    constructor(window) {
        this.#window = window;
    }

    get length() {
        return this.#entries.length;
    }

    get state() {
        return this.#entries[this.#index].state;
    }

    // The current entry's URL, for location.
    get url() {
        return this.#entries[this.#index].url;
    }

    pushState(state, unused, url) {
        const entry = { url: new URL(url ?? this.url.href, this.url), state: structuredClone(state) };
        this.#entries.splice(this.#index + 1, Infinity, entry);
        this.#index += 1;
    }

    replaceState(state, unused, url) {
        this.#entries[this.#index] = { url: new URL(url ?? this.url.href, this.url), state: structuredClone(state) };
    }

    back() {
        this.go(-1);
    }

    forward() {
        this.go(1);
    }

    go(delta = 0) {
        const target = this.#index + Number(delta);
        if (!delta || target < 0 || target >= this.#entries.length) return;
        setTimeout(() => {
            this.#index = target;
            this.#window.dispatchEvent(new PopStateEvent("popstate", { state: this.state }));
        });
    }
}

// The address bar: the current entry's URL, read. An example sets it as a page does, with
// history.replaceState(null, "", "/orders?sort=date").
class Location {
    #history;

    constructor(history) {
        this.#history = history;
    }

    get href() {
        return this.#history.url.href;
    }

    get origin() {
        return this.#history.url.origin;
    }

    get protocol() {
        return this.#history.url.protocol;
    }

    get host() {
        return this.#history.url.host;
    }

    get hostname() {
        return this.#history.url.hostname;
    }

    get port() {
        return this.#history.url.port;
    }

    get pathname() {
        return this.#history.url.pathname;
    }

    get search() {
        return this.#history.url.search;
    }

    get hash() {
        return this.#history.url.hash;
    }

    // No page load here: the page stays as it is.
    reload() {}

    toString() {
        return this.href;
    }
}

// ---- the page ---------------------------------------------------------------------------------

// Makes the page: a document with a <head> and a <body>, as the globals a browser gives a module.
export function installDom() {
    const document = new Document();
    const window = new Target();
    const history = new SessionHistory(window);
    const location = new Location(history);
    Object.assign(window, {
        document,
        Node,
        Element,
        Text,
        Comment,
        DocumentFragment,
        Document,
        Event,
        CustomEvent,
        MouseEvent,
        PopStateEvent,
        PageTransitionEvent,
        history,
        location,
        scrollX: 0,
        scrollY: 0,
    });
    // window.scrollTo(x, y) or ({ left, top }): no layout, so it only moves scrollX and scrollY.
    window.scrollTo = (x, y) => {
        const to = typeof x === "object" && x !== null ? x : { left: x, top: y };
        window.scrollX = Number(to.left ?? window.scrollX);
        window.scrollY = Number(to.top ?? window.scrollY);
    };
    window.window = window;
    Object.assign(globalThis, {
        document,
        window,
        Node,
        Element,
        HTMLElement: Element,
        Text,
        Comment,
        DocumentFragment,
        Document,
        MouseEvent,
        PopStateEvent,
        PageTransitionEvent,
        history,
        location,
    });
    return document;
}
