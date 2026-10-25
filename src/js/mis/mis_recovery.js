'use strict';

// Durable workspace snapshots. IndexedDB commits each replacement atomically,
// so a failed save leaves the last complete snapshot available.
(function (root) {
	function create(options) {
		options = options || {};
		var key = options.key === undefined ? 'mis95-workspace' : options.key;
		var database = null;
		var opening = null;
		var queue = Promise.resolve();
		var reportedFailure = false;

		function openDatabase() {
			if (database) return Promise.resolve(database);
			if (!opening) {
				opening = new Promise(function (resolve, reject) {
					var settled = false;
					var timer;
					function fail(error) {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						reject(error);
					}
					try {
						var factory = Object.prototype.hasOwnProperty.call(options, 'indexedDB') ? options.indexedDB : root.indexedDB;
						if (!factory) throw new Error('IndexedDB is unavailable.');
						var request = factory.open('mis95-recovery');
						timer = setTimeout(function () { fail(new Error('Opening recovery storage timed out.')); }, 5000);
						request.onupgradeneeded = function () {
							if (settled) { request.transaction.abort(); return; }
							try {
								if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots');
							} catch (error) {
								request.transaction.abort();
								fail(error);
							}
						};
						request.onsuccess = function () {
							if (settled) { request.result.close(); return; }
							settled = true;
							clearTimeout(timer);
							resolve(request.result);
						};
						request.onerror = function () { fail(request.error || new Error('Could not open recovery storage.')); };
						request.onblocked = function () { fail(new Error('Opening recovery storage was blocked by another page.')); };
					} catch (error) {
						fail(error);
					}
				}).then(function (db) {
					database = db;
					opening = null;
					// Opening without a fixed version lets this instance reconnect after
					// another page upgrades the database.
					db.onversionchange = function () {
						db.close();
						if (database === db) database = null;
					};
					db.onclose = function () { if (database === db) database = null; };
					return db;
				}, function (error) {
					opening = null;
					throw error;
				});
			}
			return opening;
		}

		function transact(db, operation, record) {
			return new Promise(function (resolve, reject) {
				var transaction = db.transaction('snapshots', operation === 'load' ? 'readonly' : 'readwrite');
				var store = transaction.objectStore('snapshots');
				var request;
				transaction.oncomplete = function () {
					resolve(operation === 'load' ? (request.result === undefined ? null : request.result) : true);
				};
				transaction.onabort = function () { reject(transaction.error || new Error('Recovery transaction was aborted.')); };
				try {
					if (operation === 'save') request = store.put(record, key);
					else if (operation === 'clear') request = store.delete(key);
					else request = store.get(key);
				} catch (error) {
					transaction.abort();
					reject(error);
				}
			});
		}

		function enqueue(operation, record, snapshotError) {
			// Every operation joins the same queue, including reads and clears.
			// An older save can never commit after a newer save from this helper.
			var result = queue.then(function () {
				if (snapshotError) throw snapshotError;
				return openDatabase().then(function (db) { return transact(db, operation, record); });
			}).then(function (value) {
				reportedFailure = false;
				return value;
			}, function (error) {
				if (!reportedFailure) {
					reportedFailure = true;
					var report = new Error('Recovery ' + operation + ' failed: ' + (error && error.message ? error.message : String(error)));
					report.cause = error;
					if (typeof options.onError === 'function') {
						try { options.onError(report); } catch (_) { /* Error display must not break persistence. */ }
					}
				}
				return operation === 'load' ? null : false;
			});
			queue = result.then(function () {});
			return result;
		}

		return {
			save: function (record) {
				// Capture now, before queued writes or the caller can mutate arrays.
				try { return enqueue('save', root.structuredClone(record)); }
				catch (error) { return enqueue('save', null, error); }
			},
			load: function () { return enqueue('load'); },
			clear: function () { return enqueue('clear'); }
		};
	}

	var api = { create: create };
	root.MISRecovery = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
