'use strict';

// Conservative conflict-serializability certificate. Resource names include
// collision layers because creating an object can erase an unnamed sibling.
// No geometry assumptions: matches at different anchors may still overlap.
function ruleResources(rule, layerOf) {
    const reads = new Set(), writes = new Set();
    let barrier = !!rule.randomRule || !!rule.rigid || (rule.commands || []).length > 0;
    const names = entry => entry.obj ? [entry.obj] : entry.objs || [];
    const resource = (set, prefix, entry) => {
        for (const name of names(entry)) {
            if (!layerOf.has(name)) barrier = true;
            else set.add(prefix + layerOf.get(name));
        }
    };
    const key = entry => JSON.stringify(names(entry));
    for (let r = 0; r < Math.max(rule.lhs.length, rule.rhs.length); r++) {
        const left = rule.lhs[r] || [], right = rule.rhs[r] || [];
        for (let c = 0; c < Math.max(left.length, right.length); c++) {
            const lhs = left[c] || [], rhs = right[c] || [];
            if (lhs.ellipsis || rhs.ellipsis) continue;
            for (const entry of lhs) {
                resource(reads, 'o:', entry);
                if (entry.dir && entry.dir !== 'no') resource(reads, 'm:', entry);
            }
            const positives = cell => new Set(cell.filter(e => e.dir !== 'no').map(key));
            const lhsPositive = positives(lhs), rhsPositive = positives(rhs);
            for (const entry of lhs) {
                if (entry.dir !== 'no' && !rhsPositive.has(key(entry))) {
                    resource(writes, 'o:', entry);
                    resource(writes, 'm:', entry);
                }
                // Removing a movement annotation can clear a movement bit.
                if (entry.dir && entry.dir !== 'no') resource(writes, 'm:', entry);
            }
            for (const entry of rhs) {
                if (entry.dir === 'random' || entry.dir === 'randomdir') barrier = true;
                if (entry.dir === 'no' || !lhsPositive.has(key(entry))) {
                    resource(writes, 'o:', entry);
                    resource(writes, 'm:', entry);
                }
                if (entry.dir && entry.dir !== 'no') resource(writes, 'm:', entry);
            }
        }
    }
    return { reads, writes, barrier };
}

function unionResources(items) {
    const reads = new Set(), writes = new Set();
    for (const item of items) {
        for (const x of item.reads) reads.add(x);
        for (const x of item.writes) writes.add(x);
    }
    return { reads, writes, barrier: items.some(x => x.barrier) };
}

function orderIndependentItems(items) {
    if (items.length < 2) return items;
    const next = items.map(() => new Set()), indegree = items.map(() => 0);
    const writers = new Map(), readers = new Map();
    let barrier = -1, sinceBarrier = [];
    const edge = (from, to) => {
        if (from === undefined || from < 0 || from === to || next[from].has(to)) return;
        next[from].add(to);
        indegree[to]++;
    };
    items.forEach((item, i) => {
        edge(barrier, i);
        if (item.resources.barrier) {
            for (const previous of sinceBarrier) edge(previous, i);
            barrier = i;
            sinceBarrier = [];
            readers.clear();
            writers.clear();
            return;
        }
        sinceBarrier.push(i);
        for (const key of item.resources.reads) {
            edge(writers.get(key), i);
            if (!readers.has(key)) readers.set(key, new Set());
            readers.get(key).add(i);
        }
        for (const key of item.resources.writes) {
            edge(writers.get(key), i);
            for (const previous of readers.get(key) || []) edge(previous, i);
            readers.delete(key);
            writers.set(key, i);
        }
    });
    // A heap keeps large expanded groups from turning the topological sort
    // into repeated quadratic scans. Original index breaks identical-key ties.
    const heap = [];
    const less = (a, b) => items[a].key < items[b].key || (items[a].key === items[b].key && a < b);
    const push = value => {
        let i = heap.length;
        heap.push(value);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (!less(value, heap[p])) break;
            heap[i] = heap[p]; i = p;
        }
        heap[i] = value;
    };
    const pop = () => {
        const result = heap[0], value = heap.pop();
        if (heap.length) {
            let i = 0;
            while (2 * i + 1 < heap.length) {
                let child = 2 * i + 1;
                if (child + 1 < heap.length && less(heap[child + 1], heap[child])) child++;
                if (!less(heap[child], value)) break;
                heap[i] = heap[child]; i = child;
            }
            heap[i] = value;
        }
        return result;
    };
    indegree.forEach((n, i) => { if (n === 0) push(i); });
    const result = [];
    while (heap.length) {
        const i = pop(); result.push(items[i]);
        for (const j of next[i]) if (--indegree[j] === 0) push(j);
    }
    return result;
}

function normalizeCanonicalExecutionOrder(canonical) {
    const layerOf = new Map();
    let duplicateLayerObject = false;
    canonical.collisionLayers.forEach((layer, i) => layer.forEach(name => {
        if (layerOf.has(name) && layerOf.get(name) !== i) duplicateLayerObject = true;
        layerOf.set(name, i);
    }));
    if (duplicateLayerObject) return canonical;
    const key = rule => JSON.stringify(Object.assign({}, rule, { groupNumber: 0 }));
    const groups = [];
    const seenGroups = new Set();
    for (const rule of canonical.rules) {
        let group = groups[groups.length - 1];
        if (!group || group.number !== rule.groupNumber || group.late !== rule.late) {
            // The legacy representation can reuse a number across phases.
            // Leave that schedule intact rather than ambiguously remapping it.
            if (seenGroups.has(rule.groupNumber)) return canonical;
            seenGroups.add(rule.groupNumber);
            group = { number: rule.groupNumber, late: rule.late, items: [] };
            groups.push(group);
        }
        group.items.push({ rule, key: key(rule), resources: ruleResources(rule, layerOf) });
    }
    const loops = canonical.loops || [];
    for (const group of groups) {
        // RANDOM belongs to the whole joined group, even when only its first
        // source rule carries the flag. Candidate enumeration order is part of
        // seeded choice. Treat effectful groups as indivisible schedules too.
        if (!group.items.some(item => item.resources.barrier)) {
            group.items = orderIndependentItems(group.items);
        }
        group.resources = unionResources(group.items.map(x => x.resources));
        group.key = JSON.stringify(group.items.map(x => x.key));
        // Never move a group across a phase or loop boundary.
        group.domain = JSON.stringify([group.late, loops.map(loop =>
            group.number >= loop.startGroup && group.number <= loop.endGroup)]);
    }
    const ordered = [];
    for (let start = 0; start < groups.length;) {
        let end = start + 1;
        while (end < groups.length && groups[end].domain === groups[start].domain) end++;
        ordered.push(...orderIndependentItems(groups.slice(start, end)));
        start = end;
    }
    const groupMap = new Map(), rules = [];
    ordered.forEach((group, i) => {
        groupMap.set(group.number, i);
        for (const item of group.items) rules.push(Object.assign({}, item.rule, { groupNumber: i }));
    });
    const result = Object.assign({}, canonical, { rules });
    if (loops.length) result.loops = loops.map(loop => {
        const members = groups.filter(g => g.number >= loop.startGroup && g.number <= loop.endGroup)
            .map(g => groupMap.get(g.number));
        return { startGroup: Math.min(...members), endGroup: Math.max(...members) };
    });
    return result;
}

module.exports = { normalizeCanonicalExecutionOrder, ruleResources, orderIndependentItems };
