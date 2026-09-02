/**
 * WinAnsi (CP1252) text sanitizer for the on-device PDF generators.
 *
 * pdf-lib's StandardFonts (Helvetica et al.) are WinAnsi-encoded. Asking one to
 * draw a character outside that encoding does not degrade - it THROWS
 * (`WinAnsi cannot encode "x" (0x....)`), which aborts the whole document.
 *
 * That is a live field failure, not a theoretical one. A BOL inherits its
 * declared inventory from Actual Inventory (ADR 0026), and the chow/box volume
 * estimator writes notes like "~ 320 cu ft, ~ 2,240 lbs" using U+2248 ALMOST
 * EQUAL TO, which is not in WinAnsi. Every BOL seeded from that estimate threw
 * on generation: the crew could not view or email the signed copy, and the
 * queued PDF upload to Drive failed on every drain. See ADR 0042.
 *
 * Crew-typed free text is the wider version of the same exposure - a phone
 * keyboard reaches arrows, maths symbols and emoji in two taps. So the rule is:
 * **no string reaches pdf-lib without passing through here.**
 *
 * The transform is lossy by design, and prefers a readable stand-in over both a
 * throw and a silent deletion:
 *   1. characters WinAnsi can encode pass through untouched (accents, section
 *      signs, middots, curly quotes, the CP1252 punctuation block - so the
 *      legal text of the BOL is unaffected);
 *   2. known symbols transliterate to their ASCII reading (U+2248 to "~");
 *   3. anything else is decomposed and, failing that, replaced with "?" -
 *      except zero-width/formatting characters and emoji, which are dropped,
 *      because a row of "?" reads worse than an absent sticker.
 */

// The 27 code points CP1252 maps into the 0x80-0x9F range. Everything else
// encodable is a contiguous run, so these are the only singletons to list.
const CP1252_PUNCTUATION = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Can a WinAnsi-encoded standard font draw this code point? */
function encodable(cp: number): boolean {
  if (cp >= 0x20 && cp <= 0x7e) return true;   // printable ASCII
  if (cp >= 0xa1 && cp <= 0xff) return true;   // Latin-1 supplement
  return CP1252_PUNCTUATION.has(cp);
}

/**
 * Characters we translate rather than decompose. Two groups: things WinAnsi
 * cannot encode at all, and two it technically can (no-break space, soft
 * hyphen) whose WinAnsi reading is a plain space / hyphen anyway - normalizing
 * them here keeps line-wrap measurement honest.
 *
 * Written as \u escapes, not literals: several of these are invisible or
 * indistinguishable from ASCII in an editor, and a "tidied" literal is how this
 * table would quietly stop matching.
 */
const TRANSLITERATE: Record<string, string> = {
  "\u00a0": " ",    // no-break space
  "\u00ad": "-",    // soft hyphen
  "\u2010": "-",    // hyphen
  "\u2011": "-",    // non-breaking hyphen
  "\u2012": "-",    // figure dash
  "\u2015": "-",    // horizontal bar
  "\u2212": "-",    // minus sign
  "\u2032": "'",    // prime
  "\u2033": '"',    // double prime
  "\u2044": "/",    // fraction slash
  "\u2248": "~",    // almost equal to - the one that took the BOL down
  "\u2260": "!=",   // not equal to
  "\u2264": "<=",   // less-than or equal to
  "\u2265": ">=",   // greater-than or equal to
  "\u221e": "inf",  // infinity
  "\u2190": "<-",   // leftwards arrow
  "\u2192": "->",   // rightwards arrow
  "\u2194": "<->",  // left right arrow
  "\u21d2": "=>",   // rightwards double arrow
  "\u2713": "[x]",  // check mark
  "\u2714": "[x]",  // heavy check mark
  "\u2717": "[ ]",  // ballot x
  "\u2718": "[ ]",  // heavy ballot x
  "\u2605": "*",    // black star
  "\u2606": "*",    // white star
  "\u25cf": "*",    // black circle
  "\u25a0": "*",    // black square
  "\u25aa": "*",    // black small square
  "\u2103": " C",   // degrees celsius
  "\u2109": " F",   // degrees fahrenheit
  "\u2116": "No.",  // numero
};

// Dropped outright rather than replaced: they carry no reading a "?" would
// stand in for. Cf = format/zero-width, Cs = lone surrogates, Co = private use,
// Mn/Me = combining marks left over after decomposition, Sk = modifier symbols
// (skin-tone selectors), Extended_Pictographic = emoji.
const DROPPABLE = /^[\p{Cf}\p{Cs}\p{Co}\p{Mn}\p{Me}\p{Sk}\p{Extended_Pictographic}]$/u;

/** Last resort for a character with no entry in the table: decompose it and
 * keep whatever survives (o-macron to "o", one-half to "1/2"). */
function decompose(ch: string): string | null {
  const out = [...ch.normalize("NFKD")]
    .filter((c) => encodable(c.codePointAt(0)!))
    .join("");
  return out || null;
}

/**
 * Make `str` safe to hand to a pdf-lib standard font. Newlines are preserved
 * (callers split on "\n" to wrap) and tabs become spaces; other control
 * characters go.
 */
export function toWinAnsi(str: string): string {
  if (!str) return "";
  let out = "";
  // Iterate by code point so astral characters (emoji) are handled as a unit
  // rather than as two lone surrogates.
  for (const ch of str.normalize("NFC")) {
    if (ch === "\n") { out += "\n"; continue; }
    if (ch === "\t") { out += " "; continue; }
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    const cp = ch.codePointAt(0)!;
    if (encodable(cp)) { out += ch; continue; }
    const fallback = decompose(ch);
    if (fallback !== null) { out += fallback; continue; }
    if (DROPPABLE.test(ch) || cp < 0x20 || cp === 0x7f) continue;
    out += "?";
  }
  return out;
}
