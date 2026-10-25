'use strict';

// One bounded generation pool for every level. The host supplies its existing
// initialized worker handles; assignments are sent only after they are ready.
// A revision invalidates a level; an epoch invalidates one worker's context.
const MISGenerationPool = (function () {
	function create(opts) {
		const size = Number.isFinite(opts.size) ? Math.max(1, Math.floor(opts.size)) : 1;
		const jobs = new Map(), workers = new Array(size).fill(null);
		let revision = 0, epoch = 0, destroyed = false, notifying = false;
		let balancing = false, balanceAgain = false;

		function notify() {
			if (notifying || !opts.onChange) return;
			notifying = true;
			try { opts.onChange(); } finally { notifying = false; }
		}

		function deliver(id, index, msg) {
			if (!destroyed && opts.onMessage) opts.onMessage(id, index, msg);
		}

		function detach(slot) {
			const h = slot.h, wasDead = h.dead;
			h.onReady = null; h.onMessage = null; h.dead = true;
			if (!wasDead) {
				try { h.w.terminate(); } catch (_) { /* already stopped */ }
			}
		}

		function failed(slot, message) {
			if (destroyed || workers[slot.index] !== slot) return;
			const affected = Array.from(slot.assignments.values()).filter(function (a) {
				const j = jobs.get(a.jobId);
				return j && j.revision === a.revision;
			});
			// Mutate everything before callbacks: a callback can destroy the pool.
			workers[slot.index] = null;
			affected.forEach(function (a) { jobs.delete(a.jobId); });
			detach(slot);
			rebalance();
			affected.forEach(function (a) {
				deliver(a.jobId, slot.index, Object.assign({}, a, { type: 'genError', message: message }));
			});
			if (!destroyed) notify();
		}

		function post(slot) {
			if (destroyed || workers[slot.index] !== slot) return;
			if (slot.h.dead) { failed(slot, 'Generator worker stopped.'); return; }
			if (!slot.h.ready) return;
			try { slot.h.w.postMessage({ type: 'generationJobs', jobs: Array.from(slot.assignments.values()) }); }
			catch (e) { failed(slot, String(e && e.message || e)); }
		}

		function receive(slot, m) {
			if (destroyed || workers[slot.index] !== slot) return;
			if (slot.h.dead || ((m.type === 'genError' || m.type === 'error') && m.jobId === undefined)) {
				failed(slot, m.message || 'Generator worker failed.'); return;
			}
			const j = jobs.get(m.jobId), a = slot.assignments.get(m.jobId);
			if (!j || !a || j.revision !== m.revision || a.revision !== m.revision || a.generationEpoch !== m.generationEpoch) return;
			if (m.type === 'genError' || m.type === 'error') {
				jobs.delete(m.jobId);
				rebalance();
				deliver(m.jobId, slot.index, m);
				if (!destroyed) notify();
			} else deliver(m.jobId, slot.index, m);
		}

		function ensureWorkers() {
			for (let i = 0; i < size && !destroyed; i++) {
				if (workers[i]) continue;
				const h = opts.spawn();
				const slot = { index: i, h: h, assignments: new Map() };
				workers[i] = slot;
				h.onReady = function (m) {
					if (destroyed || workers[i] !== slot) return;
					if (!m.ok) { failed(slot, m.message || (m.errors || []).join('\n') || 'The game could not be compiled.'); return; }
					h.ready = true;
					post(slot);
				};
				h.onMessage = function (m) { receive(slot, m); };
			}
		}

		function rebalance() {
			if (destroyed) return;
			if (balancing) { balanceAgain = true; return; }
			balancing = true;
			try {
				do {
					balanceAgain = false;
					const slots = workers.filter(Boolean), active = Array.from(jobs.values());
					const next = slots.map(function () { return []; });
					if (active.length >= slots.length && slots.length) {
						// Keep existing contexts on their worker. New levels enter
						// the least loaded worker in round-robin order; only an
						// imbalance caused by removals needs an existing job moved.
						const pending = [];
						active.forEach(function (j) {
							const at = slots.findIndex(function (s) { return s.assignments.has(j.id); });
							if (at < 0) pending.push(j); else next[at].push(j);
						});
						pending.forEach(function (j) {
							let at = 0;
							for (let k = 1; k < next.length; k++) if (next[k].length < next[at].length) at = k;
							next[at].push(j);
						});
						while (true) {
							let lo = 0, hi = 0;
							for (let k = 1; k < next.length; k++) {
								if (next[k].length < next[lo].length) lo = k;
								if (next[k].length > next[hi].length) hi = k;
							}
							if (next[hi].length - next[lo].length <= 1) break;
							next[lo].push(next[hi].pop());
						}
					} else if (active.length) {
						// With spare workers, keep every surviving assignment first.
						// Fill freed slots with the least replicated level; starting
						// another level moves only surplus replicas to make room.
						const replicas = active.map(function () { return 0; });
						function leastReplica() {
							let at = 0;
							for (let k = 1; k < active.length; k++) if (replicas[k] < replicas[at]) at = k;
							return at;
						}
						slots.forEach(function (slot, i) {
							const at = active.findIndex(function (j) { return slot.assignments.has(j.id); });
							if (at >= 0) { next[i].push(active[at]); replicas[at]++; }
						});
						next.forEach(function (assigned) {
							if (assigned.length) return;
							const at = leastReplica();
							assigned.push(active[at]); replicas[at]++;
						});
						while (true) {
							const lo = leastReplica();
							let hi = 0;
							for (let k = 1; k < active.length; k++) if (replicas[k] > replicas[hi]) hi = k;
							if (replicas[hi] - replicas[lo] <= 1) break;
							const available = next.map(function (assigned, i) { return assigned[0] === active[hi] ? i : -1; }).filter(function (i) { return i >= 0; });
							// Round-robin is a tie-breaker among expendable replicas,
							// never a reason to discard an unrelated context.
							const preferred = available.find(function (i) { return i % active.length === lo; });
							const at = preferred === undefined ? available[available.length - 1] : preferred;
							next[at][0] = active[lo]; replicas[hi]--; replicas[lo]++;
						}
					}
					slots.forEach(function (slot, i) {
						if (destroyed) return;
						const assigned = new Map();
						next[i].forEach(function (j) {
							const old = slot.assignments.get(j.id);
							assigned.set(j.id, old && old.revision === j.revision ? old : Object.assign({}, j.payload, {
								jobId: j.id, revision: j.revision, generationEpoch: ++epoch,
								seed: ((j.payload.seed >>> 0) + slot.index * 7919) >>> 0,
							}));
						});
						slot.assignments = assigned;
						post(slot);
					});
				} while (balanceAgain && !destroyed);
			} finally { balancing = false; }
		}

		return {
			start: function (id, payload) {
				if (destroyed) return;
				const current = ++revision;
				jobs.set(id, { id: id, revision: current, payload: Object.assign({}, payload) });
				try { ensureWorkers(); }
				catch (e) {
					jobs.delete(id);
					deliver(id, -1, { type: 'genError', jobId: id, revision: current, message: String(e && e.message || e) });
				}
				rebalance();
				if (!destroyed) notify();
				return current;
			},
			pause: function (id) {
				if (destroyed || !jobs.delete(id)) return;
				rebalance();
				if (!destroyed) notify();
			},
			stopAll: function () {
				if (destroyed || !jobs.size) return;
				jobs.clear(); rebalance();
				if (!destroyed) notify();
			},
			destroy: function () {
				if (destroyed) return;
				destroyed = true; jobs.clear();
				const old = workers.slice(); workers.fill(null);
				old.forEach(function (slot) { if (slot) detach(slot); });
				notify();
			},
			isRunning: function (id) { return jobs.has(id); },
			activeCount: function () { return jobs.size; },
			workerCount: function () { return workers.filter(function (s) { return s && !s.h.dead; }).length; },
		};
	}
	return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MISGenerationPool;
