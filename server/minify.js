// A dependency-free, deliberately conservative minifier for the JS and CSS a server hands the
// browser, at serve time and in production only: in development a server sends the source
// untouched, so a stack trace still points at a real line.
//
// "Conservative" is the entire design. It removes comments, indentation, trailing whitespace and
// blank lines, and collapses each run of insignificant whitespace to ONE character — a newline if
// the run contained one (any of JavaScript's line terminators), otherwise a single space. That is
// all. It never joins two lines, never deletes the space between two tokens, and never looks inside
// a string, a template literal's text or a regular expression. So token boundaries and automatic-semicolon-insertion come out exactly as the
// author wrote them: it cannot change what the code does. It is not a full minifier and does not
// rename or fold anything — it trades the last slice of compression for that guarantee. In code
// that is heavily commented and deeply indented, comments + indentation are most of the bytes, so
// the guarantee is nearly free.
//
// The only real parsing it does is cutting the source into tokens (`jsTokens`, which the module
// server's import stamping reads too), so that it does not mistake the contents of a string, a
// template or a regex for a comment (a `//` inside a regex, a `/*` inside a string). The
// regex-vs-division call is made from the token before the `/` and the brackets open around it (see
// jsTokens). Its own tests run each case before and after (tests/server.test.mjs). An app
// that serves through it should also minify every file it serves, `node --check` the result, and
// compare every string literal before and after — a syntax error would be loud, but a changed string
// would be silent.

const WS = /\s/;
const WORD = /[A-Za-z0-9_$]/;
// A letter outside ASCII is part of a name (`café`): nothing else outside ASCII is code but
// whitespace (a no-break space, U+2028, …), which ends a name as a space does. Read as part of one,
// `return` and a no-break space before a regex were one name, divided.
const isWord = (c) => c !== undefined && (WORD.test(c) || (c > "\x7f" && !WS.test(c)));
// Every line terminator JavaScript has, not only "\n": a bare "\r", U+2028 and U+2029 end a line
// comment and a regex, and decide semicolon insertion (`return\rx` returns nothing). Read as spaces,
// a run of whitespace holding one collapsed to " ", and `return x` returned x.
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const isLineTerminator = (c) => c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";

// A `/` right after one of these begins a regex literal, not division. `)` and `}` are decided by
// what they close (below), and `]` always ends an expression.
const REGEX_PUNCT = new Set([..."([{,;:=!&|?+-*/%<>~^"]);
const REGEX_WORDS = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "do", "else", "yield", "await", "case", "throw", "default", "extends",
]);
// The statements whose parenthesised head is followed by a statement, which may begin with a regex:
// `if (u) /^https?:/.test(u)`. After any other `)` the parenthesis was an expression's.
const CONTROL_WORDS = new Set(["if", "while", "for", "with"]);
// After these a `{` opens a block; after the words in REGEX_WORDS, an object literal.
const BLOCK_WORDS = new Set(["else", "do", "try", "finally"]);

// Read a string literal starting at i (src[i] is the quote). Returns the end index (past the close).
function readString(src, i) {
    const q = src[i];
    let j = i + 1;
    const n = src.length;
    while (j < n && src[j] !== q) { if (src[j] === "\\") j += 1; j += 1; }
    return j + 1;
}

// Read a regex literal starting at i (src[i] === "/"). Returns the end index, or -1 if it is not a
// regex after all (unterminated on the line → it was division).
function readRegex(src, i) {
    const n = src.length;
    let j = i + 1;
    let inClass = false;
    while (j < n) {
        const c = src[j];
        if (c === "\\") { if (isLineTerminator(src[j + 1])) return -1; j += 2; continue; }
        if (isLineTerminator(c)) return -1;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { j += 1; break; }
        j += 1;
    }
    if (j > n) return -1;
    while (j < n && /[a-z]/i.test(src[j])) j += 1;   // flags
    return j;
}

// Read one piece of a template literal's text, from its opening backtick, or from the `}` that closes
// a substitution, to its closing backtick or the next `${`. Returns [end, open]: `open` when it
// stopped at a `${`, so what follows is code until the matching `}`.
function readTemplatePart(src, i) {
    const n = src.length;
    let j = i + 1;
    while (j < n) {
        const c = src[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "`") return [j + 1, false];
        if (c === "$" && src[j + 1] === "{") return [j + 2, true];
        j += 1;
    }
    return [n, false];
}

// The source cut into tokens, whose texts joined are the source again: `space` (a run of whitespace),
// `comment`, `string`, `template` (a piece of a template literal's text: `open` when it ends at a
// `${`), `regex`, `word` (a name, a keyword or a number; `property` when it follows a `.`) and
// `punct` (one character). The substitutions of a template are code, cut like any other, so an
// `import()` inside one is found.
//
// The one real decision is whether a `/` begins a regex or is division, and it is made from the
// token before it: after a name or a literal, division; after an operator or an opening bracket,
// a regex; after a keyword that takes an expression (`return`, `typeof`, …), a regex, unless it is a
// property (`x.return / 2`), and `of` only in a `for` head. A `)` is followed by a regex only when
// it closes the head of `if`, `while`, `for` or `with`, and a `}` only when it closes a block, not an
// object literal or the body of a function or class expression (`f = function () {} / 2`), which is
// one where an operand is due, not a statement: so the brackets are kept on a stack, and so is each
// one's count of the ternary `?` still waiting for their `:`, since a `{` after a ternary's `:` or a
// property's is an object, and after a label's or a `case`'s a block. Read the other way, a regex's
// `//` was a line comment (the rest of the line deleted), and a division's `/` opened a "regex" that
// swallowed a string's spaces.
//
// It reads brackets as code is written, not as a parser does: a function or class expression is
// told by what comes before its keyword, and its body is the next `{` at that depth that is not an
// object's (`c = class extends class {} {}` opens two such bodies, the heritage's first).
export function jsTokens(src) {
    const n = src.length;
    const tokens = [];
    // The open brackets, innermost last: `open` is "(", "[", "{" or "${" (a template's substitution),
    // `control` the statement a "(" is the head of, `kind` what a "{" opens ("block", "object", or
    // "body", a function or class expression's), `questions` the ternaries opened inside it and not
    // yet closed, and `bodies` the function and class expressions begun inside it whose bodies are
    // still to open, each the next "{" at this depth that is not an object's. The first stands for
    // the top level.
    const nest = [{ open: "", control: "", kind: "block", questions: 0, bodies: 0 }];
    const top = () => nest[nest.length - 1];
    const close = (open) => (nest.length > 1 && top().open === open ? nest.pop() : null);
    let last = null;                  // the last token that is not space or a comment
    let before = null;                // the one before it
    let touching = false;             // no space or comment between `before` and `last`
    let gap = false;                  // space or a comment since `last`
    let closedControl = false;        // the last ")" closed the head of if/while/for/with
    let closedBlock = false;          // the last "}" closed a block
    let asyncOperand = false;         // an operand was due before the last `async`
    let i = 0;

    const push = (type, text, extra) => {
        const token = { type, text, ...extra };
        tokens.push(token);
        if (type === "space" || type === "comment") { gap = true; return; }
        touching = !gap;
        gap = false;
        before = last;
        last = token;
    };
    const isPunct = (token, text) => token?.type === "punct" && token.text === text;
    const keyword = (token) => (token?.type === "word" && !token.property ? token.text : "");
    // `i++`, `i--`: a postfix ++ or -- ENDS an expression.
    const postfix = () => (last.text === "+" || last.text === "-") && touching && isPunct(before, last.text);

    const regexAllowed = () => {
        if (last === null) return true;
        if (last.type === "word") {
            const word = keyword(last);
            if (word === "of") return top().open === "(" && top().control === "for";   // `var of = 6; of / 2`
            return REGEX_WORDS.has(word);
        }
        if (last.type === "template") return last.open;
        if (last.type !== "punct") return false;          // a string, a template's end, a regex
        if (last.text === ")") return closedControl;
        if (last.text === "}") return closedBlock;
        if (postfix()) return false;                      // `i++ / 2`
        return REGEX_PUNCT.has(last.text);
    };
    // What a "{" opens, from the token before it.
    const braceKind = () => {
        if (last === null) return "block";
        if (last.type === "word") {
            const word = keyword(last);
            if (BLOCK_WORDS.has(word)) return "block";
            return last.property || REGEX_WORDS.has(word) ? "object" : "block";   // `class A {`, `extends B {`
        }
        // After a string, a regex or a template, a statement ended (`"use strict"`, then a `{` on the
        // next line); after a template's `${`, an expression begins.
        if (last.type !== "punct") return last.type === "template" && last.open ? "object" : "block";
        // So did one that ends in `]` or a postfix ++ or -- (`i++`, then a `{` on the next line).
        if (["]", ")", ";", "{", "}"].includes(last.text) || postfix()) return "block";
        if (last.text === ">" && touching && isPunct(before, "=")) return "block";   // `=> {`
        if (last.text === ":") return last.colon === "label" ? "block" : "object";   // `case 1: {`, `a ? b : {}`
        return "object";
    };
    // Whether an operand is due here, not a statement: where a `function` or a `class` is an
    // expression (`f = function () {}`), not a declaration. A regex may begin there, and a `{` would
    // be an object or an arrow's body; `export default function` declares one.
    const operandDue = () => regexAllowed() && (braceKind() === "object" || isPunct(last, ">")) && keyword(last) !== "default";

    while (i < n) {
        const c = src[i];
        if (WS.test(c)) {
            let j = i + 1;
            while (j < n && WS.test(src[j])) j += 1;
            push("space", src.slice(i, j)); i = j; continue;
        }
        if (c === "/" && src[i + 1] === "/") {           // line comment, to the line terminator
            let j = i + 2;
            while (j < n && !isLineTerminator(src[j])) j += 1;
            push("comment", src.slice(i, j)); i = j; continue;
        }
        if (c === "/" && src[i + 1] === "*") {           // block comment
            const close = src.indexOf("*/", i + 2);
            const j = close < 0 ? n : close + 2;
            push("comment", src.slice(i, j)); i = j; continue;
        }
        if (c === '"' || c === "'") {
            const end = Math.min(readString(src, i), n);
            push("string", src.slice(i, end)); i = end; continue;
        }
        if (c === "`" || (c === "}" && top().open === "${")) {
            if (c === "}") close("${");
            const [end, open] = readTemplatePart(src, i);
            if (open) nest.push({ open: "${", control: "", kind: "", questions: 0, bodies: 0 });
            push("template", src.slice(i, end), { open }); i = end; continue;
        }
        if (c === "/" && regexAllowed()) {
            const end = readRegex(src, i);
            if (end > 0) { push("regex", src.slice(i, end)); i = end; continue; }
            // not a regex → an ordinary division char, below
        }
        if (isWord(c)) {
            let j = i + 1;
            while (j < n && isWord(src[j])) j += 1;
            const text = src.slice(i, j);
            // A name after a single `.` (not a spread's `...`) is a property, never a keyword.
            const property = isPunct(last, ".") && !(touching && isPunct(before, "."));
            // A function or class expression: its body is the next `{` here that is not an object's.
            // After `async`, whether an operand was due is read from before it.
            if (!property && (text === "function" || text === "class") && (keyword(last) === "async" ? asyncOperand : operandDue())) top().bodies += 1;
            if (!property && text === "async") asyncOperand = operandDue();
            push("word", text, { property }); i = j; continue;
        }
        let colon;
        if (c === "(") {
            const word = keyword(last);
            const control = CONTROL_WORDS.has(word) ? word : word === "await" && keyword(before) === "for" ? "for" : "";
            nest.push({ open: "(", control, kind: "", questions: 0, bodies: 0 });
        } else if (c === ")") {
            closedControl = Boolean(close("(")?.control);
        } else if (c === "[") {
            nest.push({ open: "[", control: "", kind: "", questions: 0, bodies: 0 });
        } else if (c === "]") {
            close("[");
        } else if (c === "{") {
            const frame = top();
            const kind = braceKind();
            const body = kind === "block" && frame.bodies > 0;
            if (body) frame.bodies -= 1;
            nest.push({ open: "{", control: "", kind: body ? "body" : kind, questions: 0, bodies: 0 });
        } else if (c === "}") {
            closedBlock = (close("{")?.kind ?? "block") === "block";
        } else if (c === "?") {
            // `??` and `?.` (not `?.5`, a ternary before a number) are not a ternary's.
            if (src[i + 1] === "?") { push("punct", c); push("punct", c); i += 2; continue; }
            if (!(src[i + 1] === "." && !/[0-9]/.test(src[i + 2] ?? ""))) top().questions += 1;
        } else if (c === ":") {
            const frame = top();
            if (frame.questions > 0) { frame.questions -= 1; colon = "ternary"; }
            else colon = frame.open === "{" && frame.kind === "object" ? "property" : "label";
        }
        push("punct", c, colon ? { colon } : undefined); i += 1;
    }
    return tokens;
}

export function minifyJs(src) {
    let out = "";
    let pending = "";                  // the whitespace owed before the next token: "", " " or "\n"
    for (const { type, text } of jsTokens(src)) {
        if (type === "space" || type === "comment") {
            // A comment stands in for the whitespace it occupied: a line's worth if it held a line
            // terminator (a line comment's own terminator is the space after it).
            pending = pending === "\n" || LINE_TERMINATOR.test(text) ? "\n" : " ";
            continue;
        }
        out += pending + text;
        pending = "";
    }
    return out;
}

// CSS is far simpler and has no ASI: strip /* */ comments (never inside a string), collapse
// whitespace, and drop it around the structural punctuation where it cannot matter. Strings
// (url("…"), content: "…") pass through untouched: the `;` dropped before a `}` and the `;` of a run
// are dropped as the rule is read, never by a pass over the text, which took `content: "x;}"` for
// one and wrote `"x}"`.
//
// A comment is not whitespace in CSS: `.a/**/.b` is `.a.b`, one element that is both. It is dropped,
// and leaves a space only between two characters of a name or a number (`0/**/auto`), which would
// otherwise run together into one token. Written as a space everywhere, it made `.a .b`, a
// descendant.
//
// The space before a colon is kept wherever it was written, and only there. Among selectors, at the
// top level, inside @media, or nested in a rule, it is a descendant combinator: ".a :is(.b)" (a .b
// inside .a) is not ".a:is(.b)" (an .a that is a .b), and `.title :first-child` nested in a rule is
// not `.title:first-child`. A declaration's `color : red` keeps it too, which costs a byte and cannot
// change anything.
const cssWord = (c) => c !== undefined && c !== "" && (/[\w-]/.test(c) || c > "\x7f");
export function minifyCss(src) {
    const n = src.length;
    let out = "";
    let i = 0;
    let pendingWs = false;
    let comment = false;               // a comment since the last character written, and no space
    const STRUCT = "{};:,>";

    while (i < n) {
        const c = src[i];
        if (c === "/" && src[i + 1] === "*") {
            i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
            i += 2; comment = true; continue;
        }
        if (c === '"' || c === "'") {
            const end = readString(src, i);
            if (pendingWs && out && !STRUCT.includes(out[out.length - 1])) out += " ";
            pendingWs = false; comment = false;
            out += src.slice(i, end); i = end; continue;
        }
        if (WS.test(c)) { pendingWs = true; i += 1; continue; }

        const prev = out[out.length - 1] ?? "";
        if (pendingWs) {
            if (out && !STRUCT.includes(prev) && (!STRUCT.includes(c) || c === ":")) out += " ";
        } else if (comment && cssWord(prev) && cssWord(c)) {
            out += " ";
        }
        pendingWs = false; comment = false;
        // A semicolon right before a closing brace is redundant, and so is a run of them.
        if (c === ";" && prev === ";") { i += 1; continue; }
        if (c === "}") out = out.replace(/;+$/, "");
        out += c; i += 1;
    }
    return out.trim();
}
