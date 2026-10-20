// Minimal JS loader for the tokenizer.json written by autocomplete/train/tokenizer.py.
//
// Supports exactly what that file uses: added special tokens, a Sequence of
// Split(Regex, Isolated) pre-tokenizers followed by ByteLevel (no regex, no prefix
// space), a BPE model with merges, and the ByteLevel decoder. Browser and Node.
//
//   const tok = BpeTokenizer.fromJSON(await (await fetch(url)).json());
//   tok.encode("[ > Player ] -> [ Player ]\n")  // -> number[]
//   tok.decode(ids)                              // -> string

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BpeTokenizer = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // GPT-2 byte <-> unicode table (same as tokenizers' ByteLevel).
    function bytesToUnicode() {
        const bs = [];
        for (let i = 33; i <= 126; i++) bs.push(i);
        for (let i = 161; i <= 172; i++) bs.push(i);
        for (let i = 174; i <= 255; i++) bs.push(i);
        const cs = bs.slice();
        let n = 0;
        for (let b = 0; b < 256; b++) {
            if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
        }
        const map = new Map();
        bs.forEach((b, i) => map.set(b, String.fromCharCode(cs[i])));
        return map;
    }
    const BYTE_TO_CHAR = bytesToUnicode();
    const CHAR_TO_BYTE = new Map();
    BYTE_TO_CHAR.forEach((ch, b) => CHAR_TO_BYTE.set(ch, b));
    const utf8Encoder = new TextEncoder();
    const utf8Decoder = new TextDecoder('utf-8');

    // Split `pieces` (array of strings) with a regex using tokenizers' Isolated behaviour:
    // matches become their own pieces, text between matches stays as pieces.
    function splitIsolated(pieces, re) {
        const out = [];
        for (const piece of pieces) {
            let last = 0;
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(piece)) !== null) {
                if (m[0].length === 0) { re.lastIndex++; continue; }
                if (m.index > last) out.push(piece.slice(last, m.index));
                out.push(m[0]);
                last = m.index + m[0].length;
            }
            if (last < piece.length) out.push(piece.slice(last));
        }
        return out;
    }

    class BpeTokenizer {
        constructor(json) {
            if (json.model.type !== 'BPE') throw new Error('expected a BPE model');
            this.vocab = new Map(Object.entries(json.model.vocab));
            this.idToToken = [];
            this.vocab.forEach((id, tok) => { this.idToToken[id] = tok; });
            this.ranks = new Map();
            json.model.merges.forEach((m, i) => {
                const pair = Array.isArray(m) ? m : m.split(' ');
                this.ranks.set(pair[0] + '\u0000' + pair[1], i);
            });
            this.special = new Map();
            for (const t of json.added_tokens || []) this.special.set(t.content, t.id);
            // longest first so e.g. <PRE> never loses to a shorter overlapping marker
            this.specialRe = this.special.size
                ? new RegExp([...this.special.keys()].sort((a, b) => b.length - a.length)
                    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
                : null;
            this.splits = [];
            const pres = json.pre_tokenizer.type === 'Sequence' ? json.pre_tokenizer.pretokenizers : [json.pre_tokenizer];
            for (const p of pres) {
                if (p.type === 'Split') {
                    if (p.behavior !== 'Isolated' || p.invert) throw new Error('only Split/Isolated is supported');
                    this.splits.push(new RegExp(p.pattern.Regex, 'g'));
                } else if (p.type === 'ByteLevel') {
                    if (p.add_prefix_space || p.use_regex) throw new Error('ByteLevel must have no prefix space and no regex');
                } else {
                    throw new Error('unsupported pre-tokenizer ' + p.type);
                }
            }
            if (!json.decoder || json.decoder.type !== 'ByteLevel') throw new Error('expected a ByteLevel decoder');
            this.cache = new Map();
        }

        static fromJSON(json) { return new BpeTokenizer(json); }

        tokenToId(tok) { return this.vocab.get(tok); }
        idToTokenString(id) { return this.idToToken[id]; }
        get vocabSize() { return this.idToToken.length; }

        _bpe(word) {
            // word: array of byte-level chars; returns array of merged symbols
            if (this.cache.has(word)) return this.cache.get(word);
            let symbols = Array.from(word);
            while (symbols.length > 1) {
                let best = -1, bestRank = Infinity;
                for (let i = 0; i < symbols.length - 1; i++) {
                    const r = this.ranks.get(symbols[i] + '\u0000' + symbols[i + 1]);
                    if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
                }
                if (best < 0) break;
                const merged = symbols[best] + symbols[best + 1];
                const next = symbols.slice(0, best);
                next.push(merged);
                for (let i = best + 2; i < symbols.length; i++) next.push(symbols[i]);
                symbols = next;
            }
            if (this.cache.size < 50000) this.cache.set(word, symbols);
            return symbols;
        }

        _encodeChunk(text, out) {
            let pieces = [text];
            for (const re of this.splits) pieces = splitIsolated(pieces, re);
            for (const piece of pieces) {
                const bytes = utf8Encoder.encode(piece);
                let word = '';
                for (const b of bytes) word += BYTE_TO_CHAR.get(b);
                for (const sym of this._bpe(word)) {
                    const id = this.vocab.get(sym);
                    if (id === undefined) throw new Error('symbol missing from vocab: ' + JSON.stringify(sym));
                    out.push(id);
                }
            }
        }

        encode(text) {
            const out = [];
            if (!this.specialRe) { this._encodeChunk(text, out); return out; }
            let last = 0, m;
            this.specialRe.lastIndex = 0;
            while ((m = this.specialRe.exec(text)) !== null) {
                if (m.index > last) this._encodeChunk(text.slice(last, m.index), out);
                out.push(this.special.get(m[0]));
                last = m.index + m[0].length;
            }
            if (last < text.length) this._encodeChunk(text.slice(last), out);
            return out;
        }

        decode(ids) {
            let text = '';
            let bytes = [];
            const flush = () => { if (bytes.length) { text += utf8Decoder.decode(new Uint8Array(bytes)); bytes = []; } };
            for (const id of ids) {
                const tok = this.idToToken[id];
                if (tok === undefined) throw new Error('unknown id ' + id);
                if (this.special.has(tok)) { flush(); text += tok; continue; }
                for (const ch of tok) {
                    const b = CHAR_TO_BYTE.get(ch);
                    if (b === undefined) throw new Error('bad byte-level char in token ' + JSON.stringify(tok));
                    bytes.push(b);
                }
            }
            flush();
            return text;
        }
    }

    return BpeTokenizer;
}));
